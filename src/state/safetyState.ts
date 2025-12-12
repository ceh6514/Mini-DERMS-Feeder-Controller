import { SafetyPolicy } from '../safetyPolicy';

type Subsystem = 'mqtt' | 'db' | 'telemetry';

const lastCommandMap = new Map<string, { value: number; atMs: number }>();
let consecutiveFailures = 0;
let stoppedReason: string | null = null;
let degradedReason: string | null = null;

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
}

export function recordFailure(policy: SafetyPolicy, subsystem: Subsystem, reason: string): void {
  consecutiveFailures += 1;
  degradedReason = subsystem;
  if (consecutiveFailures >= policy.maxConsecutiveFailures) {
    stoppedReason = reason;
  }
}

export function recordSuccess(): void {
  consecutiveFailures = 0;
  degradedReason = null;
  stoppedReason = null;
}

export function getControlStatus() {
  return {
    consecutiveFailures,
    stoppedReason,
    degradedReason,
  };
}

export function canResumeControl(policy: SafetyPolicy): boolean {
  if (!stoppedReason) return true;
  return consecutiveFailures < policy.maxConsecutiveFailures;
}

