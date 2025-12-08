import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';

import {
  computeAllowedShares,
  deviceDeficits,
  deviceSetpoints,
  DeviceWithTelemetry,
  applyDrPolicy,
} from '../src/controllers/controlLoop';

const baseTelemetry = {
  ts: new Date('2024-01-01T00:00:00Z'),
  type: 'ev',
  p_actual_kw: 2,
  site_id: 'site-a',
  feeder_id: 'feeder-a',
};

describe('integration: multi-feeder allocations and DR policy', () => {
  beforeEach(() => {
    deviceSetpoints.clear();
    deviceDeficits.clear();
  });

  it('balances allocations per feeder with mixed device types', () => {
    const params = {
      globalKwLimit: 200,
      minSocReserve: 0.2,
      targetSoc: 0.8,
      respectPriority: true,
      socWeight: 1,
      allocationMode: 'optimizer' as const,
      optimizer: { enforceTargetSoc: true, solverEnabled: false },
    };

    const feederADevices: DeviceWithTelemetry[] = [
      {
        id: 'ev-a1',
        type: 'ev',
        siteId: 'site-a',
        feederId: 'feeder-a',
        pMaxKw: 10,
        telemetry: { ...baseTelemetry, device_id: 'ev-a1', feeder_id: 'feeder-a' },
        currentSetpointKw: 3,
        pActualKw: 2,
        priority: 2,
        soc: 0.3,
        isPhysical: false,
        isSimulated: true,
      },
      {
        id: 'bat-a2',
        type: 'battery',
        siteId: 'site-a',
        feederId: 'feeder-a',
        pMaxKw: 6,
        telemetry: { ...baseTelemetry, device_id: 'bat-a2', feeder_id: 'feeder-a', type: 'battery' },
        currentSetpointKw: 2,
        pActualKw: 1,
        priority: 1,
        soc: 0.5,
        isPhysical: false,
        isSimulated: true,
      },
    ];

    const feederBDevices: DeviceWithTelemetry[] = [
      {
        id: 'ev-b1',
        type: 'ev',
        siteId: 'site-b',
        feederId: 'feeder-b',
        pMaxKw: 8,
        telemetry: { ...baseTelemetry, device_id: 'ev-b1', feeder_id: 'feeder-b', site_id: 'site-b' },
        currentSetpointKw: 4,
        pActualKw: 3,
        priority: 3,
        soc: 0.6,
        isPhysical: false,
        isSimulated: true,
      },
      {
        id: 'bat-b2',
        type: 'battery',
        siteId: 'site-b',
        feederId: 'feeder-b',
        pMaxKw: 5,
        telemetry: { ...baseTelemetry, device_id: 'bat-b2', feeder_id: 'feeder-b', site_id: 'site-b', type: 'battery' },
        currentSetpointKw: 1,
        pActualKw: 1,
        priority: 1,
        soc: 0.4,
        isPhysical: false,
        isSimulated: true,
      },
    ];

    const allocationsA = computeAllowedShares(feederADevices, 10, params);
    const allocationsB = computeAllowedShares(feederBDevices, 6, params);

    assert.ok((allocationsA.get('ev-a1') ?? 0) > (allocationsA.get('bat-a2') ?? 0));
    assert.ok((allocationsB.get('ev-b1') ?? 0) > (allocationsB.get('bat-b2') ?? 0));
    assert.ok(((allocationsB.get('ev-b1') ?? 0) + (allocationsB.get('bat-b2') ?? 0)) <= 6.01);
  });

  it('applies DR shed and boost policies before allocation', () => {
    const evDevices: DeviceWithTelemetry[] = [
      {
        id: 'ev-dr1',
        type: 'ev',
        siteId: 'site-dr',
        feederId: 'feeder-dr',
        pMaxKw: 12,
        telemetry: { ...baseTelemetry, device_id: 'ev-dr1', feeder_id: 'feeder-dr' },
        currentSetpointKw: 5,
        pActualKw: 4,
        priority: 2,
        soc: 0.25,
        isPhysical: false,
        isSimulated: true,
      },
      {
        id: 'ev-dr2',
        type: 'ev',
        siteId: 'site-dr',
        feederId: 'feeder-dr',
        pMaxKw: 6,
        telemetry: { ...baseTelemetry, device_id: 'ev-dr2', feeder_id: 'feeder-dr' },
        currentSetpointKw: 2,
        pActualKw: 2,
        priority: 1,
        soc: 0.45,
        isPhysical: false,
        isSimulated: true,
      },
    ];

    const shedProgram = {
      id: 1,
      name: 'shed-feeder',
      mode: 'fixed_cap' as const,
      ts_start: new Date('2024-01-01T00:00:00Z'),
      ts_end: new Date('2024-01-02T00:00:00Z'),
      target_shed_kw: 5,
      incentive_per_kwh: 0,
      penalty_per_kwh: 0,
      is_active: true,
    };

    const boostProgram = {
      ...shedProgram,
      id: 2,
      name: 'boost-feeder',
      mode: 'price_elastic' as const,
      target_shed_kw: 2,
      incentive_per_kwh: 30,
      penalty_per_kwh: 0,
    };

    const shedResult = applyDrPolicy(shedProgram, 12, evDevices);
    const boostResult = applyDrPolicy(boostProgram, 8, evDevices);

    assert.strictEqual(shedResult.adjustedAvailable, 7);
    assert.ok(boostResult.adjustedAvailable > 8);

    const params = {
      globalKwLimit: 200,
      minSocReserve: 0.2,
      targetSoc: 0.8,
      respectPriority: true,
      socWeight: 1,
      allocationMode: 'optimizer' as const,
      optimizer: { enforceTargetSoc: true, solverEnabled: false },
    };

    const shedAlloc = computeAllowedShares(evDevices, shedResult.adjustedAvailable, params);
    const boostAlloc = computeAllowedShares(evDevices, boostResult.adjustedAvailable, params);

    assert.ok((shedAlloc.get('ev-dr1') ?? 0) >= (shedAlloc.get('ev-dr2') ?? 0));
    assert.ok((boostAlloc.get('ev-dr1') ?? 0) > (shedAlloc.get('ev-dr1') ?? 0));
  });
});
