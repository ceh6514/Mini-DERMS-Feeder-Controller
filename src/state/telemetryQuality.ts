import { TelemetryRow } from '../repositories/telemetryRepo';

let staleTelemetryDropped = 0;
let lastStaleSamples: { deviceId: string; ts: string }[] = [];

export function recordStaleTelemetry(row: TelemetryRow): void {
  staleTelemetryDropped += 1;
  const tsIso = row.ts instanceof Date ? row.ts.toISOString() : new Date(row.ts).toISOString();
  lastStaleSamples = [...lastStaleSamples.slice(-8), { deviceId: row.device_id, ts: tsIso }];
}

export function resetTelemetryQuality(): void {
  staleTelemetryDropped = 0;
  lastStaleSamples = [];
}

export function getTelemetryQualitySnapshot() {
  return {
    staleTelemetryDropped,
    lastStaleSamples,
  };
}
