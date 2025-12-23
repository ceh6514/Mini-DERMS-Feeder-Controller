import { SafetyPolicy } from '../safetyPolicy';

type Subsystem = 'mqtt' | 'db' | 'telemetry';

const lastCommandMap = new Map<string, { value: number; atMs: number }>();
let consecutiveFailures = 0;
let stoppedReason: string | null = null;
let degradedReason: string | null = null;
let mqttBreakerOpenUntil: number | null = null;
let lastBreakerReason: string | null = null;

export function recordCommand(deviceId: string, value: number, atMs = Date.now()): void {
  lastCommandMap.set(deviceId, { value, atMs });
}

export function getLastCommand(deviceId: string): { value: number; atMs: number } | null {
  return lastCommandMap.get(deviceId) ?? null;
}

export function resetSafetyState(): void {
  lastCommandMap.clear();
  consecutiveFailures = 0;
  stoppedReason = null;
  degradedReason = null;
  mqttBreakerOpenUntil = null;
  lastBreakerReason = null;
}

export function recordFailure(policy: SafetyPolicy, subsystem: Subsystem, reason: string): void {
  consecutiveFailures += 1;
  degradedReason = reason ? `${subsystem}:${reason}` : subsystem;
  if (consecutiveFailures >= policy.maxConsecutiveFailures) {
    stoppedReason = reason;
  }
}

export function recordSuccess(): void {
  consecutiveFailures = 0;
  degradedReason = null;
  stoppedReason = null;
  mqttBreakerOpenUntil = null;
  lastBreakerReason = null;
}

export function getControlStatus() {
  return {
    consecutiveFailures,
    stoppedReason,
    degradedReason,
    mqttBreakerOpenUntil,
    lastBreakerReason,
  };
}

export function canResumeControl(policy: SafetyPolicy): boolean {
  if (!stoppedReason) return true;
  return consecutiveFailures < policy.maxConsecutiveFailures;
}

export function getMqttBreakerState(nowMs = Date.now()) {
  if (mqttBreakerOpenUntil && nowMs < mqttBreakerOpenUntil) {
    return { blocked: true, retryAt: mqttBreakerOpenUntil, reason: lastBreakerReason, reopened: false };
  }

  if (mqttBreakerOpenUntil && nowMs >= mqttBreakerOpenUntil) {
    mqttBreakerOpenUntil = null;
    lastBreakerReason = null;
    return { blocked: false, retryAt: null, reason: null, reopened: true };
  }

  return { blocked: false, retryAt: null, reason: null, reopened: false };
}

export function noteMqttFailure(policy: SafetyPolicy, reason: string, nowMs = Date.now()): void {
  recordFailure(policy, 'mqtt', reason);
  if (consecutiveFailures >= policy.mqttBreakerThreshold && !mqttBreakerOpenUntil) {
    mqttBreakerOpenUntil = nowMs + policy.mqttBreakerCooldownMs;
    lastBreakerReason = reason;
    degradedReason = `mqtt:${reason}`;
  }
}
