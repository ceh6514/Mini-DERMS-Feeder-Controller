import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { mock } from 'node:test';

import { runControlLoopCycle } from '../src/controllers/controlLoop';
import * as devicesRepo from '../src/repositories/devicesRepo';
import * as telemetryRepo from '../src/repositories/telemetryRepo';
import * as eventsRepo from '../src/repositories/eventsRepo';
import * as drProgramsRepo from '../src/repositories/drProgramsRepo';
import * as mqttModule from '../src/mqttClient';
import { getControlStatus, resetSafetyState } from '../src/state/safetyState';
import { setDbReady, setMqttReady } from '../src/state/readiness';
import { resetSafetyPolicyCache } from '../src/safetyPolicy';
import { deviceSetpoints, deviceDeficits } from '../src/controllers/controlLoop';

describe('control loop MQTT breaker', () => {
  beforeEach(() => {
    mock.restoreAll();
    resetSafetyState();
    resetSafetyPolicyCache();
    setDbReady(true);
    setMqttReady(true);
    deviceSetpoints.clear();
    deviceDeficits.clear();
    process.env.MQTT_BREAKER_THRESHOLD = '1';
    process.env.MQTT_BREAKER_COOLDOWN_MS = '60000';
  });

  afterEach(() => {
    mock.restoreAll();
    resetSafetyState();
    resetSafetyPolicyCache();
    // @ts-ignore
    mqttModule.mqttClient = null;
  });

  it('opens a breaker after repeated publish failures and skips subsequent publishes', async () => {
    let publishAttempts = 0;
    // @ts-ignore override mutable export for testing
    mqttModule.mqttClient = {
      connected: true,
      publish: (_topic: string, _payload: string, _opts: any, cb: (err?: Error | null) => void) => {
        publishAttempts += 1;
        cb(new Error('broker_down'));
      },
    } as any;

    mock.method(devicesRepo, 'getAllDevices', async () => [
      { id: 'ev-1', type: 'ev', siteId: 'site-1', feederId: 'default-feeder', pMaxKw: 5 },
    ]);
    mock.method(devicesRepo, 'getFeederIds', async () => []);
    mock.method(telemetryRepo, 'getLatestTelemetryPerDevice', async () => [
      {
        device_id: 'ev-1',
        ts: new Date(),
        type: 'ev',
        p_actual_kw: 1,
        site_id: 'site-1',
        feeder_id: 'default-feeder',
      },
    ]);
    mock.method(eventsRepo, 'getCurrentFeederLimit', async () => 5);
    mock.method(drProgramsRepo, 'getActiveDrProgram', async () => null);

    await runControlLoopCycle();
    const attemptsAfterFirst = publishAttempts;
    assert.ok(attemptsAfterFirst > 0, 'should attempt publishes before breaker trips');
    assert.ok(getControlStatus().degradedReason?.includes('mqtt'), 'breaker should mark control degraded');

    await runControlLoopCycle();
    assert.strictEqual(publishAttempts, attemptsAfterFirst, 'breaker should block additional publishes while open');
  });
});
