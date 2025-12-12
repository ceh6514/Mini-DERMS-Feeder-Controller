import dotenv from 'dotenv';

dotenv.config();

export type TelemetryMissingBehavior = 'SAFE_ZERO' | 'HOLD_LAST' | 'EXCLUDE_DEVICE';
export type DbErrorBehavior = 'SAFE_ZERO_ALL' | 'HOLD_LAST' | 'STOP_LOOP';

export interface SafetyPolicy {
  telemetryStaleMs: number;
  telemetryMissingBehavior: TelemetryMissingBehavior;
  holdLastMaxMs: number;
  mqttPublishTimeoutMs: number;
  mqttMaxRetries: number;
  mqttRetryBackoffMs: number;
  dbQueryTimeoutMs: number;
  dbErrorBehavior: DbErrorBehavior;
  maxConsecutiveFailures: number;
  restartSafeZero: boolean;
}

function parseTelemetryMissingBehavior(raw?: string): TelemetryMissingBehavior {
  const normalized = (raw ?? '').toUpperCase();
  if (normalized === 'HOLD_LAST' || normalized === 'EXCLUDE_DEVICE') {
    return normalized;
  }
  return 'SAFE_ZERO';
}

function parseDbErrorBehavior(raw?: string): DbErrorBehavior {
  const normalized = (raw ?? '').toUpperCase();
  if (normalized === 'HOLD_LAST' || normalized === 'STOP_LOOP') return normalized;
  return 'SAFE_ZERO_ALL';
}

let cachedPolicy: SafetyPolicy | null = null;

export function getSafetyPolicy(): SafetyPolicy {
  if (cachedPolicy) return cachedPolicy;

  cachedPolicy = {
    telemetryStaleMs: Number(process.env.TELEMETRY_STALE_MS ?? 30_000),
    telemetryMissingBehavior: parseTelemetryMissingBehavior(
      process.env.TELEMETRY_MISSING_BEHAVIOR,
    ),
    holdLastMaxMs: Number(process.env.HOLD_LAST_MAX_MS ?? 120_000),
    mqttPublishTimeoutMs: Number(process.env.MQTT_PUBLISH_TIMEOUT_MS ?? 2_000),
    mqttMaxRetries: Number(process.env.MQTT_MAX_RETRIES ?? 3),
    mqttRetryBackoffMs: Number(process.env.MQTT_RETRY_BACKOFF_MS ?? 200),
    dbQueryTimeoutMs: Number(process.env.DB_QUERY_TIMEOUT_MS ?? 2_000),
    dbErrorBehavior: parseDbErrorBehavior(process.env.DB_ERROR_BEHAVIOR),
    maxConsecutiveFailures: Number(process.env.MAX_CONSECUTIVE_FAILURES ?? 5),
    restartSafeZero:
      (process.env.RESTART_BEHAVIOR ?? 'SAFE_ZERO').toUpperCase() !== 'HOLD_LAST',
  };

  return cachedPolicy;
}

export function resetSafetyPolicyCache() {
  cachedPolicy = null;
}

