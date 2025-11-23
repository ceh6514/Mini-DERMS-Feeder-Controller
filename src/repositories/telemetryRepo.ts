import { query } from '../db.js';

export interface TelemetryRow {
  id?: number;
  device_id: string;
  ts: Date;
  type: string;
  p_actual_kw: number;
  p_setpoint_kw?: number | null;
  soc?: number | null;
  site_id: string;
  device_p_max_kw?: number;
}

export async function insertTelemetry(row: TelemetryRow): Promise<void> {
  const text = `
    INSERT INTO telemetry (device_id, ts, type, p_actual_kw, p_setpoint_kw, soc, site_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7);
  `;
  await query(text, [
    row.device_id,
    row.ts,
    row.type,
    row.p_actual_kw,
    row.p_setpoint_kw ?? null,
    row.soc ?? null,
    row.site_id,
  ]);
}

export async function getLatestTelemetryPerDevice(): Promise<TelemetryRow[]> {
  const text = `
    SELECT DISTINCT ON (t.device_id)
      t.id,
      t.device_id,
      t.ts,
      d.type,
      t.p_actual_kw,
      t.p_setpoint_kw,
      t.soc,
      t.site_id,
      d.p_max_kw AS device_p_max_kw
    FROM telemetry t
    JOIN devices d ON d.id = t.device_id
    ORDER BY t.device_id, t.ts DESC;
  `;
  const { rows } = await query<TelemetryRow>(text);
  return rows;
}

export async function getRecentTelemetry(deviceId: string, limit = 100): Promise<TelemetryRow[]> {
  const text = `
    SELECT id, device_id, ts, type, p_actual_kw, p_setpoint_kw, soc, site_id
    FROM telemetry
    WHERE device_id = $1
    ORDER BY ts DESC
    LIMIT $2;
  `;
  const { rows } = await query<TelemetryRow>(text, [deviceId, limit]);
  return rows;
}
