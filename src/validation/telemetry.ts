const ALLOWED_TYPES = new Set(['pv', 'battery', 'ev', 'solar_weather', 'unknown']);

export interface ValidatedTelemetry {
  deviceId: string;
  type: string;
  ts: Date;
  pActualKw: number;
  pSetpointKw: number | null;
  soc: number | null;
  siteId: string;
  pMaxKw: number;
  priority: number | null;
}

export class TelemetryValidationError extends Error {}

function asNumber(value: unknown, field: string, allowNull = false): number | null {
  if (value === null && allowNull) return null;
  if (value === undefined) return allowNull ? null : NaN;
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new TelemetryValidationError(`${field} must be a finite number`);
  }
  return num;
}

export function validateTelemetryPayload(
  payload: Record<string, unknown>,
  fallbackDeviceId?: string,
): ValidatedTelemetry {
  const deviceIdCandidate =
    (typeof payload.deviceId === 'string' && payload.deviceId.trim()) ||
    (typeof (payload as Record<string, unknown>).device_id === 'string'
      ? (payload as Record<string, string>).device_id
      : undefined);

  const deviceId = deviceIdCandidate?.trim()
    ? deviceIdCandidate.trim()
    : typeof fallbackDeviceId === 'string' && fallbackDeviceId.trim()
      ? fallbackDeviceId.trim()
      : '';

  if (!deviceId) {
    throw new TelemetryValidationError('deviceId is required');
  }

  const typeRaw = typeof payload.type === 'string' ? payload.type.trim() : 'unknown';
  const type = ALLOWED_TYPES.has(typeRaw) ? typeRaw : (() => {
    throw new TelemetryValidationError('type must be one of pv, battery, ev, solar_weather');
  })();

  const tsString =
    typeof payload.timestamp === 'string'
      ? payload.timestamp
      : typeof (payload as Record<string, unknown>).ts === 'string'
        ? (payload as Record<string, string>).ts
        : undefined;
  const ts = tsString ? new Date(tsString) : new Date();
  if (!(ts instanceof Date) || Number.isNaN(ts.getTime())) {
    throw new TelemetryValidationError('timestamp must be an ISO string');
  }

  const pActualKw = asNumber(payload.p_actual_kw, 'p_actual_kw');
  const pSetpointKw = asNumber(payload.p_setpoint_kw, 'p_setpoint_kw', true);
  const soc = asNumber(payload.soc, 'soc', true);
  const siteId = typeof payload.site_id === 'string' && payload.site_id.trim()
    ? payload.site_id.trim()
    : '';
  if (!siteId) {
    throw new TelemetryValidationError('site_id is required');
  }

  const pMaxKw = asNumber(payload.p_max_kw, 'p_max_kw', true) ?? 0;
  const priority = asNumber(payload.priority, 'priority', true);

  return {
    deviceId,
    type,
    ts,
    pActualKw,
    pSetpointKw,
    soc,
    siteId,
    pMaxKw,
    priority,
  };
}
