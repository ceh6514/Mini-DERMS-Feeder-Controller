import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { mock } from 'node:test';

import { runControlLoopCycle } from '../src/controllers/controlLoop';
import * as devicesRepo from '../src/repositories/devicesRepo';
import { getControlLoopState } from '../src/state/controlLoopMonitor';
import { setDbReady, setMqttReady } from '../src/state/readiness';
import { resetSafetyState } from '../src/state/safetyState';

describe('control loop readiness gating', () => {
  beforeEach(() => {
    mock.restoreAll();
    resetSafetyState();
  });

  afterEach(() => {
    mock.restoreAll();
    resetSafetyState();
  });

  it('skips cycles when the database schema is not ready', async () => {
    setDbReady(false, 'schema_uninitialized');
    setMqttReady(true);

    const devicesSpy = mock.method(devicesRepo, 'getAllDevices', async () => {
      throw new Error('should not query devices when DB not ready');
    });
    const feedersSpy = mock.method(devicesRepo, 'getFeederIds', async () => {
      throw new Error('should not query feeders when DB not ready');
    });

    const result = await runControlLoopCycle();

    assert.equal(result.commandsPublished, 0);
    assert.equal(result.staleTelemetryDropped, 0);
    assert.equal(devicesSpy.mock.callCount(), 0);
    assert.equal(feedersSpy.mock.callCount(), 0);
    const state = getControlLoopState();
    assert.equal(state.status, 'degraded');
    assert.equal(state.degradedReason, 'schema_uninitialized');
  });

  it('skips publish cycles when MQTT is disconnected', async () => {
    setDbReady(true);
    setMqttReady(false, 'mqtt_down');

    const devicesSpy = mock.method(devicesRepo, 'getAllDevices', async () => {
      throw new Error('should not query devices when MQTT is down');
    });

    const result = await runControlLoopCycle();

    assert.equal(result.commandsPublished, 0);
    assert.equal(result.staleTelemetryDropped, 0);
    assert.equal(devicesSpy.mock.callCount(), 0);
    const state = getControlLoopState();
    assert.equal(state.status, 'degraded');
    assert.equal(state.degradedReason, 'mqtt_down');
  });
});
