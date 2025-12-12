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
import { optimizeAllocations } from './allocationOptimizer';
import { clampSoc, computeSocAwareAllocations, isDispatchableDevice } from './scheduler';
import { recordTrackingSample } from '../state/trackingError';
import { recordStaleTelemetry } from '../state/telemetryQuality';
import { getSafetyPolicy, TelemetryMissingBehavior } from '../safetyPolicy';
import {
  getControlStatus,
  getLastCommand,
  recordCommand,
  recordFailure,
  recordSuccess,
} from '../state/safetyState';
import { incrementCounter, observeHistogram, setGauge } from '../observability/metrics';
import logger from '../logger';

// Track the most recent setpoint we have commanded for each device.
export const deviceSetpoints = new Map<string, number>();
// Track per-device deficit/credit used by the allocator to compensate under-served devices.
export const deviceDeficits = new Map<string, number>();

export interface ControlLoopIterationResult {
  offlineDevices: string[];
  commandsPublished: number;
  staleTelemetryDropped: number;
  timestampIso: string;
}

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

  const weights = new Map<string, number>();
  const deviceLookup = new Map(evDevices.map((ev) => [ev.id, ev]));
  for (const ev of evDevices) {
    weights.set(ev.id, getWeight(ev));
  }

  const totalWeight = evDevices.reduce((sum, ev) => sum + (weights.get(ev.id) ?? 0), 0);
  if (totalWeight <= 0) return allowed;

  const quantumPerWeight = availableForEv / totalWeight;

  for (const ev of evDevices) {
    const weight = weights.get(ev.id) ?? 0;
    const existing = deviceDeficits.get(ev.id) ?? 0;
    deviceDeficits.set(ev.id, existing + weight * quantumPerWeight);
  }

  const objectiveWeights = new Map(
    evDevices.map((ev) => [
      ev.id,
      {
        weight: weights.get(ev.id) ?? 1,
        deficitBoost: (deviceDeficits.get(ev.id) ?? 0) / Math.max(ev.pMaxKw, 1),
      },
    ]),
  );

  const mode = params.allocationMode ?? 'heuristic';
  let usedOptimizer = false;
  if (mode === 'optimizer') {
    const result = optimizeAllocations(evDevices, availableForEv, params, objectiveWeights);
    usedOptimizer = result.feasible;
    if (!result.feasible && result.message) {
      console.warn('[controlLoop] optimizer infeasible, falling back to heuristic', {
        reason: result.message,
      });
    }
    if (result.allocations.size > 0) {
      for (const [deviceId, value] of result.allocations.entries()) {
        const device = deviceLookup.get(deviceId);
        const cap = device ? Math.max(device.pMaxKw, 0) : Infinity;
        allowed.set(deviceId, Math.min(Math.max(0, value), cap));
      }
    }
  }

  if (mode !== 'optimizer' || !usedOptimizer) {
    let remaining = availableForEv;
    const prioritized = [...evDevices].sort((a, b) => {
      const deficitB = deviceDeficits.get(b.id) ?? 0;
      const deficitA = deviceDeficits.get(a.id) ?? 0;
      if (deficitB !== deficitA) return deficitB - deficitA;
      const weightB = weights.get(b.id) ?? 0;
      const weightA = weights.get(a.id) ?? 0;
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
  }

  for (const ev of evDevices) {
    if (!allowed.has(ev.id)) {
      allowed.set(ev.id, 0);
    }
    const current = deviceDeficits.get(ev.id) ?? 0;
    const used = allowed.get(ev.id) ?? 0;
    deviceDeficits.set(ev.id, Math.max(0, current - used));
  }

  const totalCap = evDevices.reduce((sum, ev) => {
    const soc = clampSoc(ev.soc);
    const enforceTarget = params.optimizer?.enforceTargetSoc ?? true;
    const eligible = enforceTarget && soc !== null && soc >= params.targetSoc ? 0 : ev.pMaxKw;
    return sum + Math.max(0, eligible);
  }, 0);

  const totalAllowed = [...allowed.values()].reduce((sum, val) => sum + val, 0);
  if (mode === 'optimizer' && usedOptimizer && totalAllowed + 0.01 < Math.min(availableForEv, totalCap)) {
    console.warn('[controlLoop] optimizer could not fully utilize available headroom', {
      availableForEv,
      totalCap,
      allocated: totalAllowed,
      usedOptimizer,
    });
  }

  return allowed;
}

export function applyDrPolicy(
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

async function publishCommands(
  commands: { deviceId: string; newSetpoint: number; prevSetpoint: number }[],
  logContext: string,
  nowMs: number,

): Promise<number> {
  if (commands.length === 0) return 0;

  if (!mqttClient || !mqttClient.connected) {
    console.warn(
      `[controlLoop] MQTT not connected, skipping publish this tick (${logContext})`
    );
    incrementCounter('derms_mqtt_disconnect_total');
    return 0;
  }

  const prefix = config.mqtt.topicPrefix.replace(/\/+$/, '');
  let published = 0;

  for (const cmd of commands) {
    try {
      const topic = `${prefix}/control/${cmd.deviceId}`;
      const payload = JSON.stringify({ p_setpoint_kw: cmd.newSetpoint });
      const start = Date.now();
      const policy = getSafetyPolicy();
      let attempts = 0;
      let success = false;
      let lastError: unknown = null;
      while (attempts <= policy.mqttMaxRetries && !success) {
        attempts += 1;
        try {
          const publishPromise = new Promise<void>((resolve, reject) => {
            mqttClient.publish(
              topic,
              payload,
              { qos: 0 },
              (err: Error | null | undefined) => {
                if (err) reject(err);
                else resolve();
              },
            );
          });
          const timeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('mqtt_publish_timeout')), policy.mqttPublishTimeoutMs),
          );
          await Promise.race([publishPromise, timeout]);
          success = true;
        } catch (err) {
          lastError = err;
          if (attempts > policy.mqttMaxRetries) break;
          const backoff = policy.mqttRetryBackoffMs * Math.pow(2, attempts - 1);
          await new Promise((resolve) => setTimeout(resolve, backoff));
        }
      }

      const latency = Date.now() - start;
      observeHistogram('derms_mqtt_publish_latency_ms', latency);

      if (!success) {
        incrementCounter('derms_mqtt_publish_fail_total', {
          device_id: cmd.deviceId,
        });
        recordFailure(policy, 'mqtt', 'mqtt_publish_failure');
        logger.error(
          { deviceId: cmd.deviceId, err: lastError as Record<string, unknown> },
          '[controlLoop] failed to publish command',
        );
        continue;
      }

      deviceSetpoints.set(cmd.deviceId, cmd.newSetpoint);
      recordCommand(cmd.deviceId, cmd.newSetpoint, nowMs);
      published += 1;
    } catch (err) {
      console.error('[controlLoop] failed to publish command', err);
      incrementCounter('derms_mqtt_publish_fail_total', { device_id: cmd.deviceId });
    }
  }

  return published;
}

export const publishCommandsForTest = publishCommands;

const marginKw = 0.5;
const epsilon = 0.1;
const stepKw = 1.0;

function partitionTelemetry(latest: TelemetryRow[], nowMs: number) {
  const policy = getSafetyPolicy();
  const thresholdMs = policy.telemetryStaleMs;
  const fresh: TelemetryRow[] = [];
  const stale: TelemetryRow[] = [];

  for (const row of latest) {
    const ts = row.ts instanceof Date ? row.ts : new Date(row.ts);
    if (nowMs - ts.getTime() > thresholdMs) {
      stale.push({ ...row, ts });
    } else {
      fresh.push({ ...row, ts });
    }
  }

  return { fresh, stale };
}

export const partitionTelemetryForTest = partitionTelemetry;

async function runFeederTick(
  feederId: string,
  now: Date,
  offlineDevices: Set<string>,
  devices: Device[],
): Promise<{ commandsPublished: number; staleTelemetryDropped: number }> {
  const limitKw = await getCurrentFeederLimit(now, feederId);
  const latest = await getLatestTelemetryPerDevice(feederId);
  const { fresh, stale } = partitionTelemetry(latest, now.getTime());
  const feederDevices = devices.filter((device) => device.feederId === feederId);
  const deviceLookup = buildDeviceLookup(feederDevices);
  const priorityLookup = new Map(
    feederDevices.map((device) => [device.id, device.priority ?? 1]),
  );

  for (const row of stale) {
    recordStaleTelemetry(row);
    incrementCounter('derms_stale_telemetry_total', {
      device_id: row.device_id,
      device_type: row.type,
    });
    logger.warn('[controlLoop] stale telemetry detected', {
      deviceId: row.device_id,
      feederId,
      age_ms: now.getTime() - row.ts.getTime(),
    });
  }

  const missingDeviceIds = feederDevices
    .filter((device) => isDispatchableDevice(device))
    .map((device) => device.id)
    .filter((id) => !fresh.some((row) => row.device_id === id) && !stale.some((row) => row.device_id === id));

  for (const missingId of missingDeviceIds) {
    const deviceMeta = feederDevices.find((d) => d.id === missingId);
    incrementCounter('derms_missing_telemetry_total', {
      device_id: missingId,
      device_type: deviceMeta?.type ?? 'unknown',
    });
    logger.warn('[controlLoop] missing telemetry for device', {
      deviceId: missingId,
      feederId,
    });
  }

  if (offlineDevices.size > 0) {
    const offlineForFeeder = [...offlineDevices].filter((id) => deviceLookup.has(id));
    if (offlineForFeeder.length > 0) {
      console.warn(
        `[controlLoop:${feederId}] ${offlineForFeeder.length} device(s) offline, excluding from allocation`,
      );
    }
  }

  const policy = getSafetyPolicy();
  const fallbackCommands: { deviceId: string; newSetpoint: number; prevSetpoint: number }[] = [];
  const excludedIds = new Set<string>();

  const handleMissing = (
    deviceId: string,
    behavior: TelemetryMissingBehavior,
    deviceType: string,
  ) => {
    const last = getCurrentSetpoint(deviceId, {
      device_id: deviceId,
      ts: now,
      type: deviceType,
      p_actual_kw: 0,
      site_id: feederId,
      feeder_id: feederId,
    });
    let target = 0;
    if (behavior === 'HOLD_LAST') {
      const lastRecord = getLastCommand(deviceId);
      if (lastRecord && now.getTime() - lastRecord.atMs <= policy.holdLastMaxMs) {
        target = lastRecord.value;
      }
    }
    if (behavior === 'EXCLUDE_DEVICE') {
      excludedIds.add(deviceId);
      target = 0;
    }
    fallbackCommands.push({ deviceId, newSetpoint: target, prevSetpoint: last });
  };

  for (const row of stale) {
    handleMissing(row.device_id, policy.telemetryMissingBehavior, row.type);
  }
  for (const missing of missingDeviceIds) {
    const deviceMeta = feederDevices.find((d) => d.id === missing);
    handleMissing(missing, policy.telemetryMissingBehavior, deviceMeta?.type ?? 'unknown');
  }

  const onlineTelemetry = fresh.filter(
    (row) => !offlineDevices.has(row.device_id) && !excludedIds.has(row.device_id),
  );

  if (onlineTelemetry.length === 0) {
    const publishedFallback = await publishCommands(
      fallbackCommands,
      `feeder=${feederId} fallback_only`,
      now.getTime(),
    );
    console.log(`[controlLoop:${feederId}] no telemetry yet, publishing safe defaults`);
    return { commandsPublished: publishedFallback, staleTelemetryDropped: stale.length };
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
    const publishedFallback = await publishCommands(
      fallbackCommands,
      `feeder=${feederId} no_dispatchable`,
      now.getTime(),
    );
    return { commandsPublished: publishedFallback, staleTelemetryDropped: stale.length };
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
    return { commandsPublished: 0, staleTelemetryDropped: stale.length };
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

  let published = 0;
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
    published = await publishCommands(
      [...fallbackCommands, ...commands],
      `feeder=${feederId} total=${totalKw.toFixed(2)} limit=${limitKw.toFixed(2)} availableForEv=${availableForEv.toFixed(2)} effective=${effectiveAvailableForEv.toFixed(2)}`,
      now.getTime(),
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

  return { commandsPublished: published, staleTelemetryDropped: stale.length };
}

export async function runControlLoopCycle(
  now = new Date(),
): Promise<ControlLoopIterationResult> {
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
  let commandsPublished = 0;
  let staleTelemetryDropped = 0;
  let offlineDevices: Set<string> = new Set();

  try {
    offlineDevices = getOfflineDeviceIds(nowMs);
    if (offlineDevices.size > 0) {
      console.warn(`[controlLoop] ${offlineDevices.size} device(s) offline across feeders`);
    }
    const devices = await getAllDevices();
    const feederIds = await getFeederIds();
    const activeFeeders = feederIds.length ? feederIds : [config.defaultFeederId];

    for (const feederId of activeFeeders) {
      const result = await runFeederTick(feederId, now, offlineDevices, devices);
      commandsPublished += result.commandsPublished;
      staleTelemetryDropped += result.staleTelemetryDropped;
    }
    recordSuccess();
  } catch (err) {
    errored = true;
    recordFailure(getSafetyPolicy(), 'db', 'loop_error');
    markIterationError(err, Date.now());
    console.error('[controlLoop] error', err);
    incrementCounter('derms_db_error_total', { operation: 'read' });
  } finally {
    if (!errored) {
      markIterationSuccess(Date.now());
    }
  }

  const statusSnapshot = getControlStatus();
  setGauge(
    'derms_control_degraded',
    statusSnapshot.degradedReason ? 1 : 0,
    { reason: statusSnapshot.degradedReason ?? 'none' },
  );
  setGauge(
    'derms_control_stopped',
    statusSnapshot.stoppedReason ? 1 : 0,
    { reason: statusSnapshot.stoppedReason ?? 'none' },
  );

  return {
    offlineDevices: [...offlineDevices],
    commandsPublished,
    staleTelemetryDropped,
    timestampIso: new Date().toISOString(),
  };
}

export function startControlLoop(options?: {
  intervalMs?: number;
  onCycleComplete?: (result: ControlLoopIterationResult) => void;
}): { stop: () => void; intervalMs: number } {
  const intervalMs = options?.intervalMs ?? config.controlIntervalSeconds * 1000;
  const timer = setInterval(async () => {
    try {
      const result = await runControlLoopCycle();
      options?.onCycleComplete?.(result);
    } catch (err) {
      console.error('[controlLoop] scheduled iteration failed', err);
    }
  }, intervalMs);

  return {
    stop: () => clearInterval(timer),
    intervalMs,
  };
}
