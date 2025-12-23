import config from '../config';

type ControlLoopStatus = 'idle' | 'ok' | 'error' | 'stalled' | 'degraded';

export interface OfflineDeviceInfo {
  deviceId: string;
  lastHeartbeat: string | null;
}

export interface ControlLoopStateSnapshot {
  status: ControlLoopStatus;
  lastIterationIso: string | null;
  lastDurationMs: number | null;
  lastError: string | null;
  offlineDevices: OfflineDeviceInfo[];
  degradedReason: string | null;
  heartbeatTimeoutSeconds: number;
  stallThresholdSeconds: number;
}

const heartbeatMap = new Map<string, number>();
const heartbeatTimeoutMs =
  Number(process.env.DEVICE_HEARTBEAT_TIMEOUT_SECONDS ?? 180) * 1000;
const stallThresholdMs =
  Number(
    process.env.CONTROL_LOOP_STALL_THRESHOLD_SECONDS ??
      config.controlIntervalSeconds * 3,
  ) * 1000;
const alertCooldownMs = Number(process.env.ALERT_COOLDOWN_SECONDS ?? 300) * 1000;

let lastIterationStartedAt: number | null = null;
let lastIterationCompletedAt: number | null = null;
let lastIterationDurationMs: number | null = null;
let lastIterationStatus: ControlLoopStatus = 'idle';
let lastIterationError: string | null = null;
let lastOfflineAlertAt: number | null = null;
let lastStallAlertAt: number | null = null;

export function recordHeartbeat(deviceId: string, atMs = Date.now()): void {
  heartbeatMap.set(deviceId, atMs);
}

export function markIterationStart(atMs = Date.now()): void {
  lastIterationStartedAt = atMs;
}

export function markIterationSuccess(atMs = Date.now()): void {
  lastIterationCompletedAt = atMs;
  lastIterationDurationMs =
    lastIterationStartedAt !== null ? atMs - lastIterationStartedAt : null;
  lastIterationStatus = 'ok';
  lastIterationError = null;
}

export function markIterationError(err: unknown, atMs = Date.now()): void {
  lastIterationCompletedAt = atMs;
  lastIterationDurationMs =
    lastIterationStartedAt !== null ? atMs - lastIterationStartedAt : null;
  lastIterationStatus = 'error';
  lastIterationError = err instanceof Error ? err.message : String(err);
}

export function markIterationDegraded(reason: string, atMs = Date.now()): void {
  lastIterationCompletedAt = atMs;
  lastIterationDurationMs =
    lastIterationStartedAt !== null ? atMs - lastIterationStartedAt : null;
  lastIterationStatus = 'degraded';
  lastIterationError = reason;
}

function getOfflineDevicesInternal(nowMs: number): OfflineDeviceInfo[] {
  const offline: OfflineDeviceInfo[] = [];

  for (const [deviceId, seenAt] of heartbeatMap.entries()) {
    if (nowMs - seenAt > heartbeatTimeoutMs) {
      offline.push({
        deviceId,
        lastHeartbeat: new Date(seenAt).toISOString(),
      });
    }
  }

  return offline;
}

export function getOfflineDeviceIds(nowMs = Date.now()): Set<string> {
  return new Set(getOfflineDevicesInternal(nowMs).map((d) => d.deviceId));
}

export function getControlLoopState(nowMs = Date.now()): ControlLoopStateSnapshot {
  const offlineDevices = getOfflineDevicesInternal(nowMs);
  const stalled =
    lastIterationCompletedAt !== null && nowMs - lastIterationCompletedAt > stallThresholdMs;

  let status: ControlLoopStatus = lastIterationStatus;
  if (status === 'idle' && lastIterationCompletedAt !== null) {
    status = 'ok';
  }
  if (stalled) {
    status = 'stalled';
  }

  return {
    status,
    lastIterationIso: lastIterationCompletedAt
      ? new Date(lastIterationCompletedAt).toISOString()
      : null,
    lastDurationMs: lastIterationDurationMs,
    lastError: lastIterationError,
    offlineDevices,
    degradedReason: status === 'degraded' ? lastIterationError : null,
    heartbeatTimeoutSeconds: heartbeatTimeoutMs / 1000,
    stallThresholdSeconds: stallThresholdMs / 1000,
  };
}

export function shouldAlertOffline(nowMs = Date.now()): OfflineDeviceInfo[] {
  const offlineDevices = getOfflineDevicesInternal(nowMs);
  if (offlineDevices.length === 0) return [];

  if (lastOfflineAlertAt && nowMs - lastOfflineAlertAt < alertCooldownMs) {
    return [];
  }

  lastOfflineAlertAt = nowMs;
  return offlineDevices;
}

export function shouldAlertStall(nowMs = Date.now()): ControlLoopStateSnapshot | null {
  const state = getControlLoopState(nowMs);
  if (state.status !== 'stalled') return null;

  if (lastStallAlertAt && nowMs - lastStallAlertAt < alertCooldownMs) {
    return null;
  }

  lastStallAlertAt = nowMs;
  return state;
}
