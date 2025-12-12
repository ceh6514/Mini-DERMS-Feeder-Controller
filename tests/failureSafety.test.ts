import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';

import {
  partitionTelemetryForTest,
  publishCommandsForTest,
} from '../src/controllers/controlLoop';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mqttModule = require('../src/mqttClient');
import { getSafetyPolicy, resetSafetyPolicyCache } from '../src/safetyPolicy';
import { recordFailure, getControlStatus, resetSafetyState } from '../src/state/safetyState';
import type { TelemetryRow } from '../src/repositories/telemetryRepo';

describe('safety and failure handling', () => {
  beforeEach(() => {
    resetSafetyPolicyCache();
    resetSafetyState();
    mqttModule.mqttClient = null;
  });

  afterEach(() => {
    delete process.env.TELEMETRY_STALE_MS;
    delete process.env.MAX_CONSECUTIVE_FAILURES;
    resetSafetyPolicyCache();
  });

  it('flags stale telemetry based on policy', () => {
    process.env.TELEMETRY_STALE_MS = '1000';
    resetSafetyPolicyCache();
    const now = Date.now();
    const telemetry: TelemetryRow[] = [
      {
        device_id: 'ev-fresh',
        ts: new Date(now - 200),
        type: 'ev',
        p_actual_kw: 1,
        site_id: 's1',
        feeder_id: 'f1',
      },
      {
        device_id: 'ev-stale',
        ts: new Date(now - 5000),
        type: 'ev',
        p_actual_kw: 1,
        site_id: 's1',
        feeder_id: 'f1',
      },
    ];

    const result = partitionTelemetryForTest(telemetry, now);
    assert.equal(result.fresh.length, 1);
    assert.equal(result.stale.length, 1);
    assert.equal(result.stale[0].device_id, 'ev-stale');
  });

  it('retries MQTT publishes before giving up', async () => {
    let attempts = 0;
    mqttModule.mqttClient = {
      connected: true,
      publish: (_topic: string, _payload: string, _opts: any, cb: any) => {
      attempts += 1;
      if (attempts < 2) {
        cb(new Error('fail'));
      } else {
        cb(null);
      }
      },
    } as any;

    const published = await publishCommandsForTest(
      [{ deviceId: 'ev-1', deviceType: 'ev', newSetpoint: 0, prevSetpoint: 1 }],
      'test',
      Date.now(),
    );

    assert.equal(published, 1);
    assert.ok(attempts >= 2);
  });

  it('enters stopped mode after too many failures', () => {
    process.env.MAX_CONSECUTIVE_FAILURES = '2';
    resetSafetyPolicyCache();
    const policy = getSafetyPolicy();
    recordFailure(policy, 'db', 'db_down');
    recordFailure(policy, 'db', 'db_down');

    const status = getControlStatus();
    assert.ok(status.stoppedReason);
  });
});
