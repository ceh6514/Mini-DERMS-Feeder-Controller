import config from '../config';
import { getCurrentFeederLimit } from '../repositories/eventsRepo';
import {
  getLatestTelemetryPerDevice,
  TelemetryRow,
} from '../repositories/telemetryRepo';
import { getAllDevices, Device, isPhysicalDeviceId, getFeederIds } from '../repositories/devicesRepo';
import { mqttClient } from '../mqttClient';
import { DrProgramRow, getActiveDrProgram } from '../repositories/drProgramsRepo';
import {
  getOfflineDeviceIds,
  markIterationError,
  markIterationStart,
  markIterationSuccess,
  shouldAlertOffline,
  shouldAlertStall,
} from '../state/controlLoopMonitor';
import { notifyOfflineDevices, notifyStalledLoop } from '../alerting';
import { recordDrImpact } from '../state/drImpact';
import { ControlParams, DeviceState } from '../types/control';
import { clampSoc, computeSocAwareAllocations, isDispatchableDevice } from './scheduler';
import { recordTrackingSample } from '../state/trackingError';

// Track the most recent setpoint we have commanded for each device.
export const deviceSetpoints = new Map<string, number>();
// Track per-device deficit/credit used by the allocator to compensate under-served devices.
export const deviceDeficits = new Map<string, number>();

export type DeviceWithTelemetry = DeviceState & {
  telemetry: TelemetryRow;
};

export function buildDeviceLookup(devices: Device[]): Map<string, Device> {
  const lookup = new Map<string, Device>();
  for (const device of devices) {
    lookup.set(device.id, device);
  }
  return lookup;
}

export function getCurrentSetpoint(
  deviceId: string,
  telemetry: TelemetryRow
): number {
  const existing = deviceSetpoints.get(deviceId);
  if (existing !== undefined) return existing;

  if (telemetry.p_setpoint_kw !== undefined && telemetry.p_setpoint_kw !== null) {
    return telemetry.p_setpoint_kw;
  }

  return telemetry.p_actual_kw ?? 0;
}

export function prepareDispatchableDevices(
  latest: TelemetryRow[],
  devices: Map<string, Device>,
): DeviceWithTelemetry[] {
  return latest
    .filter((row) => {
      const meta = devices.get(row.device_id);
      return isDispatchableDevice(meta ?? { id: row.device_id, type: row.type });
    })
    .map((row) => {
      const meta = devices.get(row.device_id);
      const pMax = meta?.pMaxKw ?? row.device_p_max_kw ?? row.p_actual_kw ?? 0;
      const pActual = row.p_actual_kw ?? 0;
      const currentSetpoint = getCurrentSetpoint(row.device_id, row);
      const priority = meta?.priority ?? 1;
      const soc = clampSoc(row.soc ?? null);
      const isPhysical = meta?.isPhysical ?? isPhysicalDeviceId(row.device_id);
      const isSimulated = !isPhysical;

      return {
        id: row.device_id,
        type: meta?.type ?? row.type,
        siteId: meta?.siteId ?? row.site_id,
        feederId: meta?.feederId ?? row.feeder_id,
        pMaxKw: pMax,
        priority: priority > 0 ? priority : 1,
        telemetry: row,
        currentSetpointKw: currentSetpoint,
        pActualKw: pActual,
        soc,
        isPhysical,
        isSimulated,
      };
    });
}

// Backwards compatibility for existing tests and callers
export const prepareEvDevices = prepareDispatchableDevices;

export function reconcileDeviceDeficits(evDevices: DeviceWithTelemetry[]) {
  const activeDeviceIds = new Set(evDevices.map((ev) => ev.id));
  for (const deviceId of [...deviceDeficits.keys()]) {
    if (!activeDeviceIds.has(deviceId)) {
      deviceDeficits.delete(deviceId);
    }
  }
}

export function computeAllowedShares(
  evDevices: DeviceWithTelemetry[],
  availableForEv: number,
  params: ControlParams = config.controlParams,
): Map<string, number> {
  const allowed = new Map<string, number>();

  reconcileDeviceDeficits(evDevices);

  if (evDevices.length === 0) return allowed;

  if (availableForEv <= 0) {
    for (const ev of evDevices) {
      allowed.set(ev.id, 0);
    }
    return allowed;
  }

  const getWeight = (ev: DeviceWithTelemetry) => {
    const priorityWeight = params.respectPriority
      ? Math.max(ev.priority, 1) * 1.25
      : Math.max(ev.priority, 1);
    const socWeight = (() => {
      const soc = clampSoc(ev.soc);
      if (soc === null) return 1;
      const gap = Math.max(params.targetSoc - soc, 0);
      const reserve = soc < params.minSocReserve ? 0.5 : 0;
      return 1 + params.socWeight * (gap + reserve);
    })();

    return Math.max(1, priorityWeight * socWeight);
  };

  const totalWeight = evDevices.reduce((sum, ev) => sum + getWeight(ev), 0);
  if (totalWeight <= 0) return allowed;

  const quantumPerWeight = availableForEv / totalWeight;

  // Accrue new credit based on weight, then allocate in deficit order to compensate
  // devices that were under-served in previous ticks.
  for (const ev of evDevices) {
    const weight = getWeight(ev);
    const existing = deviceDeficits.get(ev.id) ?? 0;
    deviceDeficits.set(ev.id, existing + weight * quantumPerWeight);
  }

  let remaining = availableForEv;
  const prioritized = [...evDevices].sort((a, b) => {
    const deficitB = deviceDeficits.get(b.id) ?? 0;
    const deficitA = deviceDeficits.get(a.id) ?? 0;
    if (deficitB !== deficitA) return deficitB - deficitA;
    const weightB = getWeight(b);
    const weightA = getWeight(a);
    if (weightB !== weightA) return weightB - weightA;
    return a.id.localeCompare(b.id);
  });

  for (const ev of prioritized) {
    if (remaining <= 0) break;
    const deficit = deviceDeficits.get(ev.id) ?? 0;
    const allocation = Math.min(deficit, ev.pMaxKw, remaining);
    if (allocation > 0) {
      allowed.set(ev.id, allocation);
      deviceDeficits.set(ev.id, deficit - allocation);
      remaining -= allocation;
    } else {
      allowed.set(ev.id, 0);
    }
  }

  if (remaining > 0) {
    for (const ev of prioritized) {
      if (remaining <= 0) break;
      const current = allowed.get(ev.id) ?? 0;
      const headroom = Math.max(0, ev.pMaxKw - current);
      if (headroom <= 0) continue;
      const bonus = Math.min(headroom, remaining);
      allowed.set(ev.id, current + bonus);
      const deficit = deviceDeficits.get(ev.id) ?? 0;
      deviceDeficits.set(ev.id, deficit - bonus);
      remaining -= bonus;
    }
  }

  return allowed;
}

function applyDrPolicy(
  program: DrProgramRow | null,
  availableForEv: number,
  evDevices: DeviceWithTelemetry[],
): {
  adjustedAvailable: number;
  shedApplied: number;
  elasticity: number;
} {
  if (!program || availableForEv <= 0) {
    return { adjustedAvailable: availableForEv, shedApplied: 0, elasticity: 1 };
  }

  const targetShed = Math.max(program.target_shed_kw ?? 0, 0);
  const totalEvCapacity = evDevices.reduce((sum, ev) => sum + ev.pMaxKw, 0);

  if (program.mode === 'fixed_cap') {
    const shedApplied = Math.min(targetShed, availableForEv);
    const adjustedAvailable = Math.max(availableForEv - shedApplied, 0);
    const elasticity = availableForEv > 0 ? adjustedAvailable / availableForEv : 1;
    return { adjustedAvailable, shedApplied, elasticity };
  }

  const incentive = Math.max(program.incentive_per_kwh ?? 0, 0);
  const penalty = Math.max(program.penalty_per_kwh ?? 0, 0);
  const netPressure = penalty - incentive;

  if (netPressure > 0) {
    const elasticityFactor = Math.max(0, 1 - Math.min(0.8, netPressure / 100));
    const shedFromPrice = availableForEv * (1 - elasticityFactor);
    const shedFromTarget = targetShed > 0 ? Math.min(targetShed, availableForEv) : 0;
    const shedApplied = Math.max(shedFromPrice, shedFromTarget);
    const adjustedAvailable = Math.max(availableForEv - shedApplied, 0);
    return {
      adjustedAvailable,
      shedApplied,
      elasticity: availableForEv > 0 ? adjustedAvailable / availableForEv : 1,
    };
  }

  if (netPressure < 0) {
    const boostFactor = Math.min(0.5, Math.abs(netPressure) / 100);
    const desiredBoost = (targetShed > 0 ? targetShed : availableForEv) * boostFactor;
    const headroom = Math.max(totalEvCapacity - availableForEv, 0);
    const boostApplied = Math.min(headroom, desiredBoost);
    const adjustedAvailable = availableForEv + boostApplied;
    return {
      adjustedAvailable,
      shedApplied: -boostApplied,
      elasticity: availableForEv > 0 ? adjustedAvailable / availableForEv : 1,
    };
  }

  return { adjustedAvailable: availableForEv, shedApplied: 0, elasticity: 1 };
}

function publishCommands(
  commands: { deviceId: string; newSetpoint: number; prevSetpoint: number }[],
  logContext: string
) {
  if (commands.length === 0) return;

  if (!mqttClient || !mqttClient.connected) {
    console.warn(
      `[controlLoop] MQTT not connected, skipping publish this tick (${logContext})`
    );
    return;
  }

  for (const cmd of commands) {
    try {
      const topic = `der/control/${cmd.deviceId}`;
      const payload = JSON.stringify({ p_setpoint_kw: cmd.newSetpoint });
      mqttClient.publish(topic, payload);
      deviceSetpoints.set(cmd.deviceId, cmd.newSetpoint);
    } catch (err) {
      console.error('[controlLoop] failed to publish command', err);
    }
  }
}

export function startControlLoop() {
  const intervalMs = config.controlIntervalSeconds * 1000;
  const marginKw = 0.5;
  const epsilon = 0.1;
  const stepKw = 1.0;

  async function runFeederTick(
    feederId: string,
    now: Date,
    offlineDevices: Set<string>,
    devices: Device[],
  ) {
    const limitKw = await getCurrentFeederLimit(now, feederId);
    const latest = await getLatestTelemetryPerDevice(feederId);
    const feederDevices = devices.filter((device) => device.feederId === feederId);
    const deviceLookup = buildDeviceLookup(feederDevices);
    const priorityLookup = new Map(
      feederDevices.map((device) => [device.id, device.priority ?? 1]),
    );

    if (offlineDevices.size > 0) {
      const offlineForFeeder = [...offlineDevices].filter((id) => deviceLookup.has(id));
      if (offlineForFeeder.length > 0) {
        console.warn(
          `[controlLoop:${feederId}] ${offlineForFeeder.length} device(s) offline, excluding from allocation`,
        );
      }
    }

    const onlineTelemetry = latest.filter((row) => !offlineDevices.has(row.device_id));

    if (onlineTelemetry.length === 0) {
      console.log(`[controlLoop:${feederId}] no telemetry yet, skipping tick`);
      return;
    }

    const totalKw = onlineTelemetry.reduce((sum, row) => sum + (row.p_actual_kw || 0), 0);
    const evDevices = prepareDispatchableDevices(onlineTelemetry, deviceLookup);
    reconcileDeviceDeficits(evDevices);
    const totalEvKw = evDevices.reduce((sum, ev) => sum + ev.pActualKw, 0);
    const nonEvKw = totalKw - totalEvKw;
    const feederLimitKw = Math.min(limitKw, config.controlParams.globalKwLimit);
    const availableForEv = Math.max(feederLimitKw - nonEvKw, 0);
    const activeProgram = await getActiveDrProgram(now);
    const { adjustedAvailable, shedApplied, elasticity } = applyDrPolicy(
      activeProgram,
      availableForEv,
      evDevices,
    );
    const effectiveAvailableForEv = adjustedAvailable;

    if (evDevices.length === 0) {
      console.log(`[controlLoop:${feederId}] no dispatchable devices found, skipping control`);
      return;
    }

    for (const ev of evDevices) {
      recordTrackingSample({
        deviceId: ev.id,
        type: ev.type,
        siteId: ev.siteId,
        feederId,
        priority: ev.priority,
        soc: ev.soc,
        isPhysical: ev.isPhysical,
        setpointKw: ev.currentSetpointKw,
        actualKw: ev.pActualKw,
      });
    }

    const overloaded = effectiveAvailableForEv < totalEvKw - marginKw;
    const hasHeadroom = effectiveAvailableForEv > totalEvKw + marginKw;

    const allowedShares = computeAllowedShares(
      evDevices,
      effectiveAvailableForEv,
      config.controlParams,
    );
    const perDeviceImpact = evDevices.map((ev) => {
      const allowed = allowedShares.get(ev.id) ?? ev.currentSetpointKw;
      const utilization = ev.pMaxKw > 0 ? Math.min(Math.max(allowed / ev.pMaxKw, 0), 1) : 0;
      const priority = priorityLookup.get(ev.id) ?? ev.priority ?? 1;
      return {
        deviceId: ev.id,
        allowedKw: allowed,
        pMax: ev.pMaxKw,
        utilizationPct: utilization * 100,
        priority,
      };
    });

    const avgUtilizationPct =
      perDeviceImpact.reduce((sum, d) => sum + d.utilizationPct, 0) /
      (perDeviceImpact.length || 1);
    const totalPriority = perDeviceImpact.reduce((sum, d) => sum + d.priority, 0) || 1;
    const priorityWeightedUtilizationPct =
      perDeviceImpact.reduce((sum, d) => sum + d.utilizationPct * d.priority, 0) /
      totalPriority;

    recordDrImpact({
      timestampIso: now.toISOString(),
      availableBeforeKw: availableForEv,
      availableAfterKw: effectiveAvailableForEv,
      shedAppliedKw: shedApplied,
      elasticityFactor: elasticity,
      totalEvKw,
      nonEvKw,
      avgUtilizationPct,
      priorityWeightedUtilizationPct,
      activeProgram,
      perDevice: perDeviceImpact,
      feederId,
    });

    if (!overloaded && !hasHeadroom) {
      console.log(`[controlLoop:${feederId}] within margin, no changes`);
      return;
    }

    const commands: { deviceId: string; newSetpoint: number; prevSetpoint: number }[] = [];
    const deviceLogs: {
      id: string;
      priority: number;
      deficit: number;
      allowed: number;
      prev: number;
      next: number;
      pMax: number;
    }[] = [];

    for (const ev of evDevices) {
      const previous = deviceSetpoints.get(ev.id) ?? ev.currentSetpointKw;
      let target = previous;

      const allowedShare = allowedShares.get(ev.id) ?? 0;

      if (overloaded) {
        target = allowedShare;
      } else if (hasHeadroom) {
        target = Math.min(ev.pMaxKw, Math.max(previous + stepKw, allowedShare));
      }

      target = Math.min(Math.max(0, target), ev.pMaxKw);

      const delta = target - previous;
      let newSetpoint = previous;
      if (Math.abs(delta) > stepKw) {
        newSetpoint = previous + Math.sign(delta) * stepKw;
      } else {
        newSetpoint = target;
      }

      newSetpoint = Math.min(Math.max(0, newSetpoint), ev.pMaxKw);

      deviceLogs.push({
        id: ev.id,
        priority: priorityLookup.get(ev.id) ?? ev.priority ?? 1,
        deficit: deviceDeficits.get(ev.id) ?? 0,
        allowed: allowedShare,
        prev: previous,
        next: newSetpoint,
        pMax: ev.pMaxKw,
      });

      if (Math.abs(newSetpoint - previous) > epsilon) {
        commands.push({ deviceId: ev.id, newSetpoint, prevSetpoint: previous });
      }
    }

    if (commands.length > 0) {
      const commandSummaries = commands.map((c) => ({
        id: c.deviceId,
        setpoint: c.newSetpoint.toFixed(2),
        priority: priorityLookup.get(c.deviceId) ?? 1,
      }));
      const deficitSummaries = deviceLogs.map((log) => ({
        id: log.id,
        priority: log.priority,
        deficit: log.deficit.toFixed(2),
        allowed: log.allowed.toFixed(2),
        prev: log.prev.toFixed(2),
        next: log.next.toFixed(2),
        pMax: log.pMax.toFixed(2),
      }));
      console.log(
        `[controlLoop:${feederId}] total`,
        totalKw.toFixed(2),
        'limit',
        limitKw.toFixed(2),
        'nonEv',
        nonEvKw.toFixed(2),
        'availableEv',
        availableForEv.toFixed(2),
        'effectiveEv',
        effectiveAvailableForEv.toFixed(2),
        'dr',
        activeProgram
          ? {
              mode: activeProgram.mode,
              shed: shedApplied.toFixed(2),
              elasticity: elasticity.toFixed(2),
            }
          : 'none',
        'ev commands',
        commandSummaries,
        'ev deficits',
        deficitSummaries,
      );
      publishCommands(
        commands,
        `feeder=${feederId} total=${totalKw.toFixed(2)} limit=${limitKw.toFixed(2)} availableForEv=${availableForEv.toFixed(2)} effective=${effectiveAvailableForEv.toFixed(2)}`,
      );
    } else {
      const deficitSummaries = deviceLogs.map((log) => ({
        id: log.id,
        priority: log.priority,
        deficit: log.deficit.toFixed(2),
        allowed: log.allowed.toFixed(2),
        prev: log.prev.toFixed(2),
        next: log.next.toFixed(2),
        pMax: log.pMax.toFixed(2),
      }));
      console.log(`[controlLoop:${feederId}] no setpoint changes beyond epsilon`, deficitSummaries);
    }
  }

  setInterval(async () => {
    const now = new Date();
    const nowMs = now.getTime();
    const stalledState = shouldAlertStall(nowMs);
    if (stalledState) {
      notifyStalledLoop(stalledState);
    }

    const offlineToAlert = shouldAlertOffline(nowMs);
    if (offlineToAlert.length) {
      notifyOfflineDevices(offlineToAlert);
    }

    markIterationStart(nowMs);
    let errored = false;
    try {
      const offlineDevices = getOfflineDeviceIds(nowMs);
      if (offlineDevices.size > 0) {
        console.warn(`[controlLoop] ${offlineDevices.size} device(s) offline across feeders`);
      }
      const devices = await getAllDevices();
      const feederIds = await getFeederIds();
      const activeFeeders = feederIds.length ? feederIds : [config.defaultFeederId];

      for (const feederId of activeFeeders) {
        await runFeederTick(feederId, now, offlineDevices, devices);
      }
    } catch (err) {
      errored = true;
      markIterationError(err, Date.now());
      console.error('[controlLoop] error', err);
    } finally {
      if (!errored) {
        markIterationSuccess(Date.now());
      }
    }
  }, intervalMs);
}
