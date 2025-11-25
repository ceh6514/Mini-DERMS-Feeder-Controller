import type { Device } from '../src/repositories/devicesRepo';
import type { TelemetryRow } from '../src/repositories/telemetryRepo';
import type { DeviceWithTelemetry } from '../src/controllers/controlLoop';

const { beforeEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildDeviceLookup,
  computeAllowedShares,
  deviceSetpoints,
  getCurrentSetpoint,
  prepareEvDevices,
} = require('../src/controllers/controlLoop');

describe('controlLoop helpers', () => {
  const baseTelemetry: TelemetryRow = {
    device_id: 'ev-1',
    ts: new Date('2024-01-01T00:00:00Z'),
    type: 'ev',
    p_actual_kw: 5,
    site_id: 'site-1',
  };

  beforeEach(() => {
    deviceSetpoints.clear();
  });

  it('builds a lookup by device id', () => {
    const devices: Device[] = [
      { id: 'ev-1', type: 'ev', siteId: 'site-1', pMaxKw: 10 },
      { id: 'ev-2', type: 'ev', siteId: 'site-1', pMaxKw: 20 },
    ];

    const lookup = buildDeviceLookup(devices);

    assert.deepStrictEqual(lookup.get('ev-1'), devices[0]);
    assert.deepStrictEqual(lookup.get('ev-2'), devices[1]);
  });

  it('prioritizes cached setpoints over telemetry defaults', () => {
    const telemetry: TelemetryRow = {
      ...baseTelemetry,
      p_setpoint_kw: 12,
    };

    deviceSetpoints.set('ev-1', 7);

    assert.strictEqual(getCurrentSetpoint('ev-1', telemetry), 7);

    deviceSetpoints.clear();
    assert.strictEqual(getCurrentSetpoint('ev-1', telemetry), 12);
  });

  it('prepares EV devices with sensible fallbacks', () => {
    const telemetryRows: TelemetryRow[] = [
      {
        ...baseTelemetry,
        p_actual_kw: 6,
        p_setpoint_kw: null,
        device_p_max_kw: 15,
      },
      {
        ...baseTelemetry,
        device_id: 'ev-2',
        type: 'ev',
        p_actual_kw: 3,
        p_setpoint_kw: 4,
        site_id: 'site-2',
        device_p_max_kw: 8,
      },
      { ...baseTelemetry, device_id: 'hvac-1', type: 'hvac', p_actual_kw: 2 },
    ];

    const devices: Device[] = [
      { id: 'ev-1', type: 'ev', siteId: 'site-1', pMaxKw: 20 },
      { id: 'ev-2', type: 'ev', siteId: 'site-2', pMaxKw: 9 },
    ];

    const evDevices = prepareEvDevices(telemetryRows, buildDeviceLookup(devices));

    assert.strictEqual(evDevices.length, 2);
    assert.strictEqual(evDevices[0].pMax, 20);
    assert.strictEqual(evDevices[0].currentSetpoint, 6);
    assert.strictEqual(evDevices[1].pMax, 9);
    assert.strictEqual(evDevices[1].currentSetpoint, 4);
  });

  it('allocates allowed shares proportionally and caps to pMax', () => {
    const evDevices: DeviceWithTelemetry[] = [
      {
        device: { id: 'ev-1', type: 'ev', siteId: 'site-1', pMaxKw: 10 },
        telemetry: baseTelemetry,
        currentSetpoint: 5,
        pActual: 4,
        pMax: 10,
      },
      {
        device: { id: 'ev-2', type: 'ev', siteId: 'site-1', pMaxKw: 5 },
        telemetry: { ...baseTelemetry, device_id: 'ev-2' },
        currentSetpoint: 2,
        pActual: 1,
        pMax: 5,
      },
    ];

    const allowed = computeAllowedShares(evDevices, 12);

    assert.ok(Math.abs((allowed.get('ev-1') ?? 0) - 8) < 0.001);
    assert.ok(Math.abs((allowed.get('ev-2') ?? 0) - 4) < 0.001);

    const noneAllowed = computeAllowedShares(evDevices, 0);
    assert.strictEqual(noneAllowed.get('ev-1'), 0);
    assert.strictEqual(noneAllowed.get('ev-2'), 0);
  });
});
