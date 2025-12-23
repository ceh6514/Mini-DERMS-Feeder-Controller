import config from '../config';
import { getCurrentFeederLimit } from '../repositories/eventsRepo';
import {
  getLatestTelemetryPerDevice,
  TelemetryRow,
} from '../repositories/telemetryRepo';
import { getAllDevices, Device, isPhysicalDeviceId, getFeederIds } from '../repositories/devicesRepo';
import { mqttClient } from '../mqttClient';
import { DrProgramRow, getActiveDrProgram } from '../repositories/drProgramsRepo';
import { buildSetpointMessage } from '../messaging/setpointBuilder';
import {
  getOfflineDeviceIds,
  markIterationError,
  markIterationDegraded,
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
  getMqttBreakerState,
  noteMqttFailure,
  recordCommand,
  recordFailure,
  recordSuccess,
} from '../state/safetyState';
import {
  incrementCounter,
  observeHistogram,
  setGauge,
  setGaugeValue,
} from '../observability/metrics';
import { DecisionRecordBuilder, DeviceDecisionRecord } from '../observability/decisionRecord';
import logger from '../logger';
import { getReadiness } from '../state/readiness';

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

type PublishResult = {
  attempted: number;
  success: number;
  failed: number;
  failures: { deviceId: string; deviceType: string; reason: string }[];
};

type FeederCycleResult = {
  feederId: string;
  commandsPublished: number;
  staleTelemetryDropped: number;
  deviceDecisions: DeviceDecisionRecord[];
  inputs: { deviceCountSeen: number; deviceCountFresh: number; deviceCountStale: number; staleThresholdMs: number };
  headroom: {
    headroomKwAvailable: number;
    headroomKwAllocated: number;
    headroomKwUnused: number;
    limitingConstraint?: string;
  };
  publish: PublishResult;
};

const cycleState = {
  lastCycleStartMs: 0,
};

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
    // Weighting favors under-served, higher-priority devices while guarding reserve SOC.
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
    // Deficit accumulator smooths swings between ticks and rewards devices left behind last cycle.
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
  commands: { deviceId: string; deviceType: string; newSetpoint: number; prevSetpoint: number }[],
  logContext: string,
  nowMs: number,

): Promise<PublishResult> {
  if (commands.length === 0)
    return { attempted: 0, success: 0, failed: 0, failures: [] };

  const breakerState = getMqttBreakerState(nowMs);
  if (breakerState.reopened) {
    logger.info('[controlLoop] MQTT publish breaker recovered; resuming publishes');
  }

  if (breakerState.blocked) {
    console.warn(
      `[controlLoop] MQTT publish breaker open; skipping publishes until ${new Date(
        breakerState.retryAt ?? nowMs,
      ).toISOString()} (${logContext})`,
    );
    const policy = getSafetyPolicy();
    recordFailure(policy, 'mqtt', 'mqtt_breaker_open');
    return {
      attempted: 0,
      success: 0,
      failed: commands.length,
      failures: commands.map((cmd) => ({
        deviceId: cmd.deviceId,
        deviceType: cmd.deviceType,
        reason: 'breaker_open',
      })),
    };
  }

  if (!mqttClient || !mqttClient.connected) {
    console.warn(
      `[controlLoop] MQTT not connected, skipping publish this tick (${logContext})`
    );
    incrementCounter('derms_mqtt_disconnect_total');
    for (const cmd of commands) {
      incrementCounter('derms_setpoint_publish_total', {
        result: 'fail',
        deviceType: cmd.deviceType,
      });
    }
    return { attempted: commands.length, success: 0, failed: commands.length, failures: [] };
  }

  const prefix = config.mqtt.topicPrefix.replace(/\/+$/, '');
  let published = 0;
  let failed = 0;
  const failures: PublishResult['failures'] = [];
  setGaugeValue('derms_setpoint_inflight', 1);

  for (const cmd of commands) {
    try {
      const topic = `${prefix}/setpoints/${cmd.deviceType}/${cmd.deviceId}`;
      const validUntilMs = nowMs + getSafetyPolicy().holdLastMaxMs;
      const payload = JSON.stringify(
        buildSetpointMessage({
          deviceId: cmd.deviceId,
          deviceType: cmd.deviceType as 'pv' | 'battery' | 'ev',
          targetPowerKw: cmd.newSetpoint,
          mode: cmd.newSetpoint >= 0 ? 'charge' : 'discharge',
          validUntilMs,
          allocator: 'feeder-controller',
        }),
      );
      const start = Date.now();
      const policy = getSafetyPolicy();
      let attempts = 0;
      let success = false;
      let lastError: unknown = null;
      while (attempts <= policy.mqttMaxRetries && !success) {
        attempts += 1;
        try {
          const publishPromise = new Promise<void>((resolve, reject) => {
            mqttClient.publish(topic, payload, { qos: 1, retain: true }, (err: Error | null | undefined) => {
              if (err) reject(err);
              else resolve();
            });
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
        noteMqttFailure(policy, 'mqtt_publish_failure', nowMs);
        logger.error(
          { deviceId: cmd.deviceId, err: lastError as Record<string, unknown> },
          '[controlLoop] failed to publish command',
        );
        failed += 1;
        failures.push({ deviceId: cmd.deviceId, deviceType: cmd.deviceType, reason: 'broker_error' });
        incrementCounter('derms_setpoint_publish_total', {
          result: 'fail',
          deviceType: cmd.deviceType,
        });
        continue;
      }

      deviceSetpoints.set(cmd.deviceId, cmd.newSetpoint);
      recordCommand(cmd.deviceId, cmd.newSetpoint, nowMs);
      published += 1;
      incrementCounter('derms_setpoint_publish_total', {
        result: 'success',
        deviceType: cmd.deviceType,
      });
      observeHistogram('derms_setpoint_publish_latency_seconds', latency / 1000, {
        deviceType: cmd.deviceType,
      });
    } catch (err) {
      console.error('[controlLoop] failed to publish command', err);
      failed += 1;
      failures.push({ deviceId: cmd.deviceId, deviceType: cmd.deviceType, reason: 'publish_error' });
      incrementCounter('derms_mqtt_publish_fail_total', { device_id: cmd.deviceId });
      incrementCounter('derms_setpoint_publish_total', {
        result: 'fail',
        deviceType: cmd.deviceType,
      });
    }
  }

  setGaugeValue('derms_setpoint_inflight', 0);
  return { attempted: commands.length, success: published, failed, failures };
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
): Promise<FeederCycleResult> {
  const limitKw = await getCurrentFeederLimit(now, feederId);
  const latest = await getLatestTelemetryPerDevice(feederId);
  const { fresh, stale } = partitionTelemetry(latest, now.getTime());
  for (const row of latest) {
    const ts = row.ts instanceof Date ? row.ts.getTime() : new Date(row.ts).getTime();
    observeHistogram('derms_telemetry_age_seconds', (now.getTime() - ts) / 1000, {
      deviceType: row.type,
    });
  }
  const policy = getSafetyPolicy();
  const staleThresholdMs = policy.telemetryStaleMs;
  const deviceDecisions: DeviceDecisionRecord[] = [];
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

  const fallbackCommands: {
    deviceId: string;
    deviceType: string;
    newSetpoint: number;
    prevSetpoint: number;
  }[] = [];
  const excludedIds = new Set<string>();
  let publishResult: PublishResult = { attempted: 0, success: 0, failed: 0, failures: [] };
  let headroomSummary = {
    headroomKwAvailable: limitKw,
    headroomKwAllocated: 0,
    headroomKwUnused: limitKw,
    limitingConstraint: 'NONE' as string | undefined,
  };

  const handleMissing = (
    deviceId: string,
    behavior: TelemetryMissingBehavior,
    deviceType: string,
    telemetryAgeMs: number | null,
    reasonCode: 'STALE_TELEMETRY' | 'MISSING_TELEMETRY',
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
    fallbackCommands.push({
      deviceId,
      deviceType,
      newSetpoint: target,
      prevSetpoint: last,
    });
    deviceDecisions.push({
      deviceId,
      deviceType,
      telemetryAgeMs: telemetryAgeMs ?? staleThresholdMs,
      soc: null,
      priority: priorityLookup.get(deviceId) ?? 1,
      caps: { maxChargeKw: null, maxDischargeKw: null },
      requestedKw: last,
      eligibleKw: 0,
      allocatedKw: target,
      reasonCodes: [reasonCode],
      setpoint: {
        targetPowerKw: target,
        validUntilMs: now.getTime() + policy.holdLastMaxMs,
      },
    });
  };

  for (const row of stale) {
    handleMissing(
      row.device_id,
      policy.telemetryMissingBehavior,
      row.type,
      now.getTime() - row.ts.getTime(),
      'STALE_TELEMETRY',
    );
  }
  for (const missing of missingDeviceIds) {
    const deviceMeta = feederDevices.find((d) => d.id === missing);
    handleMissing(
      missing,
      policy.telemetryMissingBehavior,
      deviceMeta?.type ?? 'unknown',
      null,
      'MISSING_TELEMETRY',
    );
  }

  const onlineTelemetry = fresh.filter(
    (row) => !offlineDevices.has(row.device_id) && !excludedIds.has(row.device_id),
  );

  if (onlineTelemetry.length === 0) {
    publishResult = await publishCommands(
      fallbackCommands,
      `feeder=${feederId} fallback_only`,
      now.getTime(),
    );
    console.log(`[controlLoop:${feederId}] no telemetry yet, publishing safe defaults`);
    return {
      feederId,
      commandsPublished: publishResult.success,
      staleTelemetryDropped: stale.length,
      deviceDecisions,
      inputs: {
        deviceCountSeen: latest.length,
        deviceCountFresh: fresh.length,
        deviceCountStale: stale.length,
        staleThresholdMs,
      },
      headroom: headroomSummary,
      publish: publishResult,
    };
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
    publishResult = await publishCommands(
      fallbackCommands,
      `feeder=${feederId} no_dispatchable`,
      now.getTime(),
    );
    return {
      feederId,
      commandsPublished: publishResult.success,
      staleTelemetryDropped: stale.length,
      deviceDecisions,
      inputs: {
        deviceCountSeen: latest.length,
        deviceCountFresh: fresh.length,
        deviceCountStale: stale.length,
        staleThresholdMs,
      },
      headroom: headroomSummary,
      publish: publishResult,
    };
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
  const totalAllowedKw = [...allowedShares.values()].reduce((sum, val) => sum + val, 0);
  headroomSummary = {
    headroomKwAvailable: effectiveAvailableForEv,
    headroomKwAllocated: totalAllowedKw,
    headroomKwUnused: Math.max(0, effectiveAvailableForEv - totalAllowedKw),
    limitingConstraint:
      shedApplied > 0
        ? 'DR_SHED'
        : overloaded
        ? 'HEADROOM_LIMIT'
        : hasHeadroom
        ? 'DEVICE_CAP'
        : 'BALANCED',
  };
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

  const withinMargin = !overloaded && !hasHeadroom;

  const commands: {
    deviceId: string;
    deviceType: string;
    newSetpoint: number;
    prevSetpoint: number;
  }[] = [];
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

    if (withinMargin) {
      target = previous;
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

    deviceDecisions.push({
      deviceId: ev.id,
      deviceType: ev.type,
      telemetryAgeMs: now.getTime() - ev.telemetry.ts.getTime(),
      soc: ev.soc,
      priority: ev.priority,
      caps: { maxChargeKw: ev.pMaxKw, maxDischargeKw: ev.pMaxKw },
      requestedKw: ev.currentSetpointKw,
      eligibleKw: ev.pMaxKw,
      allocatedKw: newSetpoint,
      reasonCodes: [
        ...(overloaded ? ['HEADROOM_LIMIT'] : []),
        ...(hasHeadroom ? ['HEADROOM_AVAILABLE'] : []),
        ...(withinMargin ? ['STEADY_STATE'] : []),
      ],
      setpoint: {
        targetPowerKw: newSetpoint,
        validUntilMs: now.getTime() + policy.holdLastMaxMs,
      },
    });
    observeHistogram('derms_device_allocated_kw', newSetpoint, { deviceType: ev.type });

    if (!withinMargin && Math.abs(newSetpoint - previous) > epsilon) {
      commands.push({
        deviceId: ev.id,
        deviceType: ev.type,
        newSetpoint,
        prevSetpoint: previous,
      });
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
    publishResult = await publishCommands(
      [...fallbackCommands, ...commands],
      `feeder=${feederId} total=${totalKw.toFixed(2)} limit=${limitKw.toFixed(2)} availableForEv=${availableForEv.toFixed(2)} effective=${effectiveAvailableForEv.toFixed(2)}`,
      now.getTime(),
    );
    published = publishResult.success;
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

  return {
    feederId,
    commandsPublished: published,
    staleTelemetryDropped: stale.length,
    deviceDecisions,
    inputs: {
      deviceCountSeen: latest.length,
      deviceCountFresh: fresh.length,
      deviceCountStale: stale.length,
      staleThresholdMs,
    },
    headroom: headroomSummary,
    publish: publishResult,
  };
}

export async function runControlLoopCycle(
  now = new Date(),
): Promise<ControlLoopIterationResult> {
  const nowMs = now.getTime();
  const expectedStartMs =
    cycleState.lastCycleStartMs > 0
      ? cycleState.lastCycleStartMs + config.controlIntervalSeconds * 1000
      : nowMs;
  const lagSeconds = Math.max(0, (nowMs - expectedStartMs) / 1000);
  setGaugeValue('derms_control_cycle_interval_lag_seconds', lagSeconds);
  setGaugeValue('derms_control_cycle_inflight', 1);
  cycleState.lastCycleStartMs = nowMs;
  const decisionBuilder = new DecisionRecordBuilder(nowMs);
  const stalledState = shouldAlertStall(nowMs);
  if (stalledState) {
    notifyStalledLoop(stalledState);
  }

  const offlineToAlert = shouldAlertOffline(nowMs);
  if (offlineToAlert.length) {
    notifyOfflineDevices(offlineToAlert);
  }

  markIterationStart(nowMs);

  const readiness = getReadiness();
  if (!readiness.dbReady || !readiness.mqttReady) {
    const reason = !readiness.dbReady
      ? readiness.dbReason ?? 'db_not_ready'
      : readiness.mqttReason ?? 'mqtt_not_ready';
    recordFailure(getSafetyPolicy(), readiness.dbReady ? 'mqtt' : 'db', reason);
    markIterationDegraded(reason, nowMs);
    setGaugeValue('derms_control_cycle_inflight', 0);
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
    const offlineSnapshot = getOfflineDeviceIds(nowMs);
    return {
      offlineDevices: [...offlineSnapshot],
      commandsPublished: 0,
      staleTelemetryDropped: 0,
      timestampIso: new Date(nowMs).toISOString(),
    };
  }

  let errored = false;
  let commandsPublished = 0;
  let staleTelemetryDropped = 0;
  let offlineDevices: Set<string> = new Set();
  let devicesSeen = 0;
  let devicesFresh = 0;
  let devicesStale = 0;
  let headroomAvailableSum = 0;
  let headroomAllocatedSum = 0;
  let headroomUnusedSum = 0;
  let publishAttempted = 0;
  let publishFailed = 0;
  let publishSucceeded = 0;

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
      devicesSeen += result.inputs.deviceCountSeen;
      devicesFresh += result.inputs.deviceCountFresh;
      devicesStale += result.inputs.deviceCountStale;
      headroomAvailableSum += result.headroom.headroomKwAvailable;
      headroomAllocatedSum += result.headroom.headroomKwAllocated;
      headroomUnusedSum += result.headroom.headroomKwUnused;
      publishAttempted += result.publish.attempted;
      publishFailed += result.publish.failed;
      publishSucceeded += result.publish.success;
      decisionBuilder.addFeeder({
        feederId,
        headroomKwAvailable: result.headroom.headroomKwAvailable,
        headroomKwAllocated: result.headroom.headroomKwAllocated,
        headroomKwUnused: result.headroom.headroomKwUnused,
        limitingConstraint: result.headroom.limitingConstraint,
        inputs: result.inputs,
        devices: result.deviceDecisions,
        publish: {
          attemptedCount: result.publish.attempted,
          successCount: result.publish.success,
          failCount: result.publish.failed,
          failures: result.publish.failures.map((f) => ({
            deviceType: f.deviceType,
            reason: f.reason,
            deviceId:
              config.observability.decisionLogLevel === 'debug' ? f.deviceId : undefined,
          })),
        },
      });
    }
  } catch (err) {
    errored = true;
    recordFailure(getSafetyPolicy(), 'db', 'loop_error');
    markIterationError(err, Date.now());
    console.error('[controlLoop] error', err);
    incrementCounter('derms_control_cycle_errors_total', { stage: 'compute' });
    incrementCounter('derms_db_error_total', { operation: 'read' });
  } finally {
    if (!errored && publishFailed === 0) {
      recordSuccess();
    }
    if (!errored && publishFailed === 0) {
      markIterationSuccess(Date.now());
    } else if (!errored && publishFailed > 0) {
      markIterationDegraded('mqtt_publish_failure', Date.now());
    }
    const finishedAtMs = Date.now();
    setGaugeValue('derms_devices_seen', devicesSeen);
    setGaugeValue('derms_devices_fresh', devicesFresh);
    setGaugeValue('derms_devices_stale', devicesStale);
    setGaugeValue('derms_feeder_headroom_kw', headroomAvailableSum);
    setGaugeValue('derms_feeder_allocated_kw', headroomAllocatedSum);
    setGaugeValue('derms_feeder_unused_kw', headroomUnusedSum);
    observeHistogram('derms_control_cycle_duration_seconds', (finishedAtMs - nowMs) / 1000);
    setGaugeValue('derms_control_cycle_inflight', 0);

    const record = decisionBuilder.finalize(finishedAtMs);
    decisionBuilder.log(record);
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
