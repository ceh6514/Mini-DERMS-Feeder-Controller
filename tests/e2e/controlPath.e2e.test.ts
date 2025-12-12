import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mqttClient } from '../../src/mqttClient';
import { dockerAvailable, startTestStack, waitFor } from './testStack';

const skipReason = dockerAvailable ? undefined : 'Docker is required for e2e tests';

function parseMetric(metrics: string, name: string): number | null {
  const match = metrics.match(new RegExp(`${name}\\s+(-?\\d+(?:\\.\\d+)?)`));
  return match ? Number(match[1]) : null;
}

test('end-to-end control path', { skip: skipReason }, async (t) => {
  await t.test('happy path publishes setpoints and updates metrics', async () => {
    const stack = await startTestStack({ FEEDER_DEFAULT_LIMIT_KW: '8', CONTROL_GLOBAL_KW_LIMIT: '8' });
    const collector = await stack.createSetpointCollector();

    try {
      await stack.publishTelemetry('ev-a', {
        p_actual_kw: 5,
        p_setpoint_kw: 5,
        p_max_kw: 6,
        priority: 1,
      });
      await stack.publishTelemetry('ev-b', {
        p_actual_kw: 5,
        p_setpoint_kw: 5,
        p_max_kw: 6,
        priority: 1,
      });

      await waitFor(async () => {
        const result = await stack.dbPool.query('SELECT COUNT(*) AS count FROM telemetry');
        return Number(result.rows[0].count) >= 2;
      }, 10000, 'telemetry persistence');

      await stack.runControlOnce();

      const messages = await collector.waitForCount(2, 10000);
      assert.equal(messages.length, 2);
      const payloads = messages.map((m) => m.payload.p_setpoint_kw).sort();
      assert.ok(payloads.every((value) => Math.abs(value - 4) < 0.2), 'setpoints should be reduced to ~4kW');

      const metricsText = await (await fetch(`${stack.baseUrl}/metrics`)).text();
      assert.equal(parseMetric(metricsText, 'derms_control_loop_ok'), 1);
      assert.equal(parseMetric(metricsText, 'derms_control_loop_offline_devices'), 0);
    } finally {
      await collector.disconnect();
      await stack.stop();
    }
  });

  await t.test('duplicate and out-of-order telemetry handled safely', async () => {
    const stack = await startTestStack({ FEEDER_DEFAULT_LIMIT_KW: '4', CONTROL_GLOBAL_KW_LIMIT: '4' });
    const collector = await stack.createSetpointCollector();

    try {
      const ts = new Date();
      await stack.publishTelemetry('dup-1', {
        ts: ts.toISOString(),
        p_actual_kw: 4,
        p_setpoint_kw: 4,
        p_max_kw: 6,
        priority: 1,
      });

      await stack.publishTelemetry('dup-1', {
        ts: ts.toISOString(),
        p_actual_kw: 6,
        p_setpoint_kw: 6,
        p_max_kw: 6,
        priority: 1,
      });

      await waitFor(async () => {
        const latest = await stack.dbPool.query(
          'SELECT p_actual_kw FROM telemetry WHERE device_id=$1 ORDER BY ts DESC LIMIT 1',
          ['dup-1'],
        );
        return Number(latest.rows[0]?.p_actual_kw ?? 0) === 6;
      }, 10000, 'deduped telemetry row');

      await stack.publishTelemetry('dup-1', {
        ts: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        p_actual_kw: 2,
        p_setpoint_kw: 2,
        p_max_kw: 6,
      });

      await stack.runControlOnce();
      const messages = await collector.waitForCount(1, 10000);
      assert.equal(messages.length, 1);
      const setpoint = messages[0].payload.p_setpoint_kw;
      assert.ok(setpoint >= 4.5, `expected latest telemetry to drive higher setpoint, got ${setpoint}`);

      const countResult = await stack.dbPool.query(
        'SELECT COUNT(*) as count FROM telemetry WHERE device_id=$1',
        ['dup-1'],
      );
      assert.equal(Number(countResult.rows[0].count), 2);
    } finally {
      await collector.disconnect();
      await stack.stop();
    }
  });

  await t.test('stale telemetry is ignored and tracked', async () => {
    const stack = await startTestStack({ STALE_TELEMETRY_THRESHOLD_SECONDS: '5' });
    const collector = await stack.createSetpointCollector();

    try {
      await stack.publishTelemetry('stale-1', {
        ts: new Date(Date.now() - 15_000).toISOString(),
        p_actual_kw: 3,
        p_setpoint_kw: 3,
        p_max_kw: 5,
      });

      await waitFor(async () => {
        const result = await stack.dbPool.query(
          'SELECT COUNT(*) AS count FROM telemetry WHERE device_id=$1',
          ['stale-1'],
        );
        return Number(result.rows[0].count) === 1;
      }, 8000, 'stale telemetry persistence');

      await stack.runControlOnce();
      await new Promise((resolve) => setTimeout(resolve, 500));
      assert.equal(collector.messages.length, 0, 'no commands should be sent for stale telemetry');

      const metricsText = await (await fetch(`${stack.baseUrl}/metrics`)).text();
      const staleMetric = parseMetric(metricsText, 'derms_stale_telemetry_dropped_total');
      assert.ok((staleMetric ?? 0) >= 1);
    } finally {
      await collector.disconnect();
      await stack.stop();
    }
  });

  await t.test('broker reconnect resumes publishing', async () => {
    const stack = await startTestStack({ FEEDER_DEFAULT_LIMIT_KW: '6', CONTROL_GLOBAL_KW_LIMIT: '6' });
    const collector = await stack.createSetpointCollector();

    try {
      await stack.publishTelemetry('reconnect-1', {
        p_actual_kw: 4,
        p_setpoint_kw: 4,
        p_max_kw: 6,
      });
      await waitFor(async () => {
        const result = await stack.dbPool.query('SELECT COUNT(*) AS count FROM telemetry WHERE device_id=$1', ['reconnect-1']);
        return Number(result.rows[0].count) === 1;
      }, 8000, 'initial telemetry persisted');

      await stack.runControlOnce();
      await collector.waitForCount(1, 10000);

      await stack.restartBroker();
      await waitFor(() => Boolean(mqttClient?.connected), 15000, 'mqtt reconnect');

      await stack.publishTelemetry('reconnect-1', {
        p_actual_kw: 5,
        p_setpoint_kw: 5,
        p_max_kw: 6,
      });
      await stack.runControlOnce();
      await collector.waitForCount(2, 15000);
      assert.ok(collector.messages.length >= 2, 'setpoints should resume after broker restart');
    } finally {
      await collector.disconnect();
      await stack.stop();
    }
  });
});
