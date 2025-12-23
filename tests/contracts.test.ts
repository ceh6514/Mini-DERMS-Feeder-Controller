import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { TelemetryHandler } from '../src/messaging/telemetryHandler';
import {
  ContractValidationError,
  contractVersion,
  validateSetpointMessage,
} from '../src/contracts';
import { buildSetpointMessage } from '../src/messaging/setpointBuilder';
import { renderPrometheus, resetMetricsForTest } from '../src/observability/metrics';

function sampleTelemetry(tsMs: number, messageId = '11111111-1111-4111-8111-111111111111') {
  return {
    v: contractVersion,
    messageType: 'telemetry',
    messageId,
    deviceId: 'ev-1',
    deviceType: 'ev',
    timestampMs: tsMs,
    sentAtMs: tsMs,
    source: 'simulator',
    payload: {
      readings: { powerKw: 3.2, soc: 0.5 },
      status: { online: true },
      capabilities: { maxChargeKw: 7, maxDischargeKw: 7 },
      siteId: 'site-1',
      feederId: 'feeder-1',
    },
  };
}

describe('contract validation and idempotency', () => {
  let saved: any[];
  let handler: TelemetryHandler;

  beforeEach(() => {
    saved = [];
    resetMetricsForTest();
    handler = new TelemetryHandler({
      save: async (row) => {
        saved.push(row);
        return saved.length === 1 ? 'inserted' : 'duplicate';
      },
    });
  });

  it('persists valid telemetry', async () => {
    const result = await handler.handle(sampleTelemetry(Date.now()));
    assert.equal(result.status, 'inserted');
    assert.equal(saved.length, 1);
    assert.equal(saved[0].device_id, 'ev-1');
  });

  it('rejects invalid telemetry', async () => {
    await assert.rejects(() => handler.handle({ bad: 'payload' }), ContractValidationError);
    assert.equal(saved.length, 0);
  });

  it('deduplicates by message id', async () => {
    const msg = sampleTelemetry(Date.now());
    const first = await handler.handle(msg);
    const second = await handler.handle(msg);
    assert.equal(first.status, 'inserted');
    assert.equal(second.status, 'duplicate');
  });

  it('flushes telemetry batches with backpressure-aware queue', async () => {
    const batches: any[][] = [];
    handler = new TelemetryHandler(
      {
        saveBatch: async (rows) => {
          batches.push(rows);
          return rows.map(() => 'inserted');
        },
        save: async (row) => {
          saved.push(row);
          return 'inserted';
        },
      },
      { batchSize: 2, flushIntervalMs: 0, maxQueueSize: 10 },
    );

    const now = Date.now();
    const results = await Promise.all([
      handler.handle(sampleTelemetry(now, '11111111-1111-4111-8111-111111111114')),
      handler.handle(sampleTelemetry(now + 1, '11111111-1111-4111-8111-111111111115')),
    ]);

    assert.equal(results.length, 2);
    assert.equal(batches.length, 1);
    assert.equal(batches[0].length, 2);
  });

  it('rejects telemetry when the queue is full', async () => {
    handler = new TelemetryHandler(
      {
        save: async (row) => {
          saved.push(row);
          return 'inserted';
        },
      },
      { batchSize: 5, flushIntervalMs: 100, maxQueueSize: 1 },
    );

    const now = Date.now();
    const first = handler.handle(sampleTelemetry(now, '11111111-1111-4111-8111-111111111116'));
    await assert.rejects(
      () => handler.handle(sampleTelemetry(now + 1, '11111111-1111-4111-8111-111111111117')),
      /backpressure/,
    );
    await first;
  });

  it('tracks out of order samples', async () => {
    const newerTs = Date.now();
    const olderTs = newerTs - 10_000;
    await handler.handle(sampleTelemetry(newerTs, '11111111-1111-4111-8111-111111111112'));
    await handler.handle(sampleTelemetry(olderTs, '11111111-1111-4111-8111-111111111113'));
    const metrics = renderPrometheus();
    assert.ok(metrics.includes('derms_out_of_order_total{messageType="telemetry"} 1'));
  });

  it('builds schema-valid setpoint messages with TTL', () => {
    const validUntil = Date.now() + 30_000;
    const message = buildSetpointMessage({
      deviceId: 'ev-1',
      deviceType: 'ev',
      targetPowerKw: 1.5,
      mode: 'charge',
      validUntilMs: validUntil,
    });
    const validated = validateSetpointMessage(message);
    assert.equal(validated.payload.command.validUntilMs, message.payload.command.validUntilMs);
    assert.ok(validated.payload.command.validUntilMs >= validUntil);
  });
});
