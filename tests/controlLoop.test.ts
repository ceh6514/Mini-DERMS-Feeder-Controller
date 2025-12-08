import type { Device } from '../src/repositories/devicesRepo';
import type { TelemetryRow } from '../src/repositories/telemetryRepo';
import type { DeviceWithTelemetry } from '../src/controllers/controlLoop';

const { beforeEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildDeviceLookup,
  computeAllowedShares,
  deviceDeficits,
  deviceSetpoints,
  getCurrentSetpoint,
  prepareEvDevices,
  reconcileDeviceDeficits,
} = require('../src/controllers/controlLoop');
const { optimizeAllocations } = require('../src/controllers/allocationOptimizer');

describe('controlLoop helpers', () => {
  const baseTelemetry: TelemetryRow = {
    device_id: 'ev-1',
    ts: new Date('2024-01-01T00:00:00Z'),
    type: 'ev',
    p_actual_kw: 5,
    site_id: 'site-1',
    feeder_id: 'feeder-1',
  };

  beforeEach(() => {
    deviceSetpoints.clear();
    deviceDeficits.clear();
  });

  it('builds a lookup by device id', () => {
    const devices: Device[] = [
      { id: 'ev-1', type: 'ev', siteId: 'site-1', feederId: 'feeder-1', pMaxKw: 10 },
      { id: 'ev-2', type: 'ev', siteId: 'site-1', feederId: 'feeder-1', pMaxKw: 20 },
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

  it('falls back to p_actual_kw when telemetry setpoint is missing', () => {
    deviceSetpoints.clear();

    const telemetryRows: TelemetryRow[] = [
      {
        ...baseTelemetry,
        p_actual_kw: 4,
      },
      {
        ...baseTelemetry,
        device_id: 'ev-2',
        p_actual_kw: 3,
        p_setpoint_kw: null,
      },
    ];

    for (const telemetry of telemetryRows) {
      assert.strictEqual(getCurrentSetpoint(telemetry.device_id, telemetry), telemetry.p_actual_kw);
    }
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
      { id: 'ev-1', type: 'ev', siteId: 'site-1', feederId: 'feeder-1', pMaxKw: 20 },
      { id: 'ev-2', type: 'ev', siteId: 'site-2', feederId: 'feeder-1', pMaxKw: 9 },
    ];

    const evDevices = prepareEvDevices(telemetryRows, buildDeviceLookup(devices));

    assert.strictEqual(evDevices.length, 2);
    assert.strictEqual(evDevices[0].pMaxKw, 20);
    assert.strictEqual(evDevices[0].currentSetpointKw, 6);
    assert.strictEqual(evDevices[1].pMaxKw, 9);
    assert.strictEqual(evDevices[1].currentSetpointKw, 4);
  });

  it('allocates allowed shares proportionally and caps to pMax', () => {
    const evDevices: DeviceWithTelemetry[] = [
      {
        id: 'ev-1',
        type: 'ev',
        siteId: 'site-1',
        feederId: 'feeder-1',
        pMaxKw: 10,
        telemetry: baseTelemetry,
        currentSetpointKw: 5,
        pActualKw: 4,
        priority: 1,
        soc: null,
        isPhysical: false,
        isSimulated: true,
      },
      {
        id: 'ev-2',
        type: 'ev',
        siteId: 'site-1',
        feederId: 'feeder-1',
        pMaxKw: 5,
        telemetry: { ...baseTelemetry, device_id: 'ev-2' },
        currentSetpointKw: 2,
        pActualKw: 1,
        priority: 1,
        soc: null,
        isPhysical: false,
        isSimulated: true,
      },
    ];

    const allowed = computeAllowedShares(evDevices, 12);

    const totalAllowed = (allowed.get('ev-1') ?? 0) + (allowed.get('ev-2') ?? 0);
    assert.ok(totalAllowed <= 12.0001);
    assert.ok((allowed.get('ev-1') ?? 0) >= (allowed.get('ev-2') ?? 0));
    assert.ok((allowed.get('ev-1') ?? 0) <= 10);
    assert.ok((allowed.get('ev-2') ?? 0) <= 5);

    const noneAllowed = computeAllowedShares(evDevices, 0);
    assert.strictEqual(noneAllowed.get('ev-1'), 0);
    assert.strictEqual(noneAllowed.get('ev-2'), 0);
  });

  it('drops deficits for devices that are not part of the current tick', () => {
    deviceDeficits.set('ev-removed', 5);

    const evDevices: DeviceWithTelemetry[] = [
      {
        id: 'ev-1',
        type: 'ev',
        siteId: 'site-1',
        feederId: 'feeder-1',
        pMaxKw: 10,
        telemetry: baseTelemetry,
        currentSetpointKw: 5,
        pActualKw: 4,
        priority: 1,
        soc: null,
        isPhysical: false,
        isSimulated: true,
      },
    ];

    reconcileDeviceDeficits(evDevices);

    assert.ok(!deviceDeficits.has('ev-removed'));

    const allowed = computeAllowedShares(evDevices, 5);
    assert.ok(allowed.get('ev-1') !== undefined);
  });

  it('optimizes allocations when optimizer mode is enabled', () => {
    const evDevices: DeviceWithTelemetry[] = [
      {
        id: 'ev-low-priority',
        type: 'ev',
        siteId: 'site-1',
        feederId: 'feeder-1',
        pMaxKw: 10,
        telemetry: { ...baseTelemetry, device_id: 'ev-low-priority', soc: 0.2 },
        currentSetpointKw: 2,
        pActualKw: 1,
        priority: 1,
        soc: 0.2,
        isPhysical: false,
        isSimulated: true,
      },
      {
        id: 'ev-high-priority',
        type: 'ev',
        siteId: 'site-1',
        feederId: 'feeder-1',
        pMaxKw: 8,
        telemetry: { ...baseTelemetry, device_id: 'ev-high-priority', soc: 0.5 },
        currentSetpointKw: 1,
        pActualKw: 1,
        priority: 2,
        soc: 0.5,
        isPhysical: false,
        isSimulated: true,
      },
      {
        id: 'ev-at-target',
        type: 'ev',
        siteId: 'site-1',
        feederId: 'feeder-1',
        pMaxKw: 15,
        telemetry: { ...baseTelemetry, device_id: 'ev-at-target', soc: 0.9 },
        currentSetpointKw: 3,
        pActualKw: 3,
        priority: 3,
        soc: 0.9,
        isPhysical: false,
        isSimulated: true,
      },
    ];

    const params = {
      globalKwLimit: 250,
      minSocReserve: 0.2,
      targetSoc: 0.8,
      respectPriority: true,
      socWeight: 1,
      allocationMode: 'optimizer' as const,
      optimizer: { enforceTargetSoc: true, solverEnabled: false },
    };

    const allowed = computeAllowedShares(evDevices, 12, params);

    assert.strictEqual(Math.round((allowed.get('ev-at-target') ?? 0) * 100), 0);
    assert.ok((allowed.get('ev-high-priority') ?? 0) >= 7.9);
    assert.ok((allowed.get('ev-low-priority') ?? 0) <= 4.1);
  });

  it('surfaces infeasible optimizer outcomes from external solvers', () => {
    const evDevices: DeviceWithTelemetry[] = [
      {
        id: 'ev-1',
        type: 'ev',
        siteId: 'site-1',
        feederId: 'feeder-1',
        pMaxKw: 5,
        telemetry: baseTelemetry,
        currentSetpointKw: 2,
        pActualKw: 1,
        priority: 1,
        soc: 0.4,
        isPhysical: false,
        isSimulated: true,
      },
    ];

    const params = {
      globalKwLimit: 250,
      minSocReserve: 0.2,
      targetSoc: 0.8,
      respectPriority: true,
      socWeight: 1,
      allocationMode: 'optimizer' as const,
      optimizer: { enforceTargetSoc: true, solverEnabled: true },
    };

    const objectives = new Map([
      [
        'ev-1',
        {
          weight: 1,
          deficitBoost: 0,
        },
      ],
    ]);

    const result = optimizeAllocations(evDevices, 5, params, objectives, {
      Solve: () => ({ feasible: false }),
    });

    assert.strictEqual(result.feasible, false);
    assert.strictEqual(result.usedExternal, true);
  });
});
