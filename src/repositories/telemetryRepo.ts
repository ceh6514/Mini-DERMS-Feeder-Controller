import { query } from '../db';

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
  cloud_cover_pct?: number;
  shortwave_radiation_wm2?: number;
  estimated_power_w?: number;
}

export interface SolarWeatherSample {
  feederId: string;
  timestamp: string;
  cloudCoverPct: number;
  shortwaveRadiationWm2: number;
  estimatedPowerW: number;
}

export interface FeederHistoryPoint {
  ts: Date;
  total_kw: number;
}

export async function insertTelemetry(row: TelemetryRow): Promise<void> {
  const text = `
    INSERT INTO telemetry (
      device_id,
      ts,
      type,
      p_actual_kw,
      p_setpoint_kw,
      soc,
      site_id,
      cloud_cover_pct,
      shortwave_radiation_wm2,
      estimated_power_w
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);
  `;
  await query(text, [
    row.device_id,
    row.ts,
    row.type,
    row.p_actual_kw,
    row.p_setpoint_kw ?? null,
    row.soc ?? null,
    row.site_id,
    row.cloud_cover_pct ?? 0,
    row.shortwave_radiation_wm2 ?? 0,
    row.estimated_power_w ?? 0,
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
      d.p_max_kw AS device_p_max_kw,
      t.cloud_cover_pct,
      t.shortwave_radiation_wm2,
      t.estimated_power_w
    FROM telemetry t
    JOIN devices d ON d.id = t.device_id
    ORDER BY t.device_id, t.ts DESC;
  `;
  const { rows } = await query<TelemetryRow>(text);
  return rows;
}

export async function getRecentTelemetry(deviceId: string, limit = 100): Promise<TelemetryRow[]> {
  const text = `
    SELECT
      id,
      device_id,
      ts,
      type,
      p_actual_kw,
      p_setpoint_kw,
      soc,
      site_id,
      cloud_cover_pct,
      shortwave_radiation_wm2,
      estimated_power_w
    FROM telemetry
    WHERE device_id = $1
    ORDER BY ts DESC
    LIMIT $2;
  `;
  const { rows } = await query<TelemetryRow>(text, [deviceId, limit]);
  return rows;
}

export async function getLatestSolarWeatherSample(
  feederId: string,
): Promise<SolarWeatherSample | null> {
  const text = `
    SELECT
      device_id,
      ts,
      cloud_cover_pct,
      shortwave_radiation_wm2,
      estimated_power_w
    FROM telemetry
    WHERE device_id = $1 AND type = 'solar_weather'
    ORDER BY ts DESC
    LIMIT 1;
  `;

  const { rows } = await query<{
    device_id: string;
    ts: Date;
    cloud_cover_pct: number;
    shortwave_radiation_wm2: number;
    estimated_power_w: number;
  }>(text, [feederId]);

  if (!rows[0]) {
    return null;
  }

  const row = rows[0];
  return {
    feederId: row.device_id,
    timestamp: row.ts instanceof Date ? row.ts.toISOString() : new Date(row.ts).toISOString(),
    cloudCoverPct: Number(row.cloud_cover_pct ?? 0),
    shortwaveRadiationWm2: Number(row.shortwave_radiation_wm2 ?? 0),
    estimatedPowerW: Number(row.estimated_power_w ?? 0),
  };
}

export async function saveSolarWeatherSample(sample: {
  feederId: string;
  timestamp: string;
  cloudCoverPct: number;
  shortwaveRadiationWm2: number;
  estimatedPowerW: number;
}): Promise<void> {
  const siteIdQuery = `
    SELECT site_id
    FROM devices
    WHERE id = $1
    LIMIT 1;
  `;
  const { rows } = await query<{ site_id: string }>(siteIdQuery, [sample.feederId]);
  const siteId = rows[0]?.site_id;

  if (!siteId) {
    throw new Error(`No device found for feederId ${sample.feederId}`);
  }

  await query(
    `
      INSERT INTO telemetry (
        device_id,
        ts,
        type,
        p_actual_kw,
        p_setpoint_kw,
        soc,
        site_id,
        cloud_cover_pct,
        shortwave_radiation_wm2,
        estimated_power_w
      )
      VALUES ($1, $2, $3, $4, NULL, NULL, $5, $6, $7, $8);
    `,
    [
      sample.feederId,
      new Date(sample.timestamp),
      'solar_weather',
      sample.estimatedPowerW / 1000,
      siteId,
      sample.cloudCoverPct,
      sample.shortwaveRadiationWm2,
      sample.estimatedPowerW,
    ],
  );
}

/**
 * Return a downsampled history of feeder power for a recent window.
 *
 * @param options.minutes How many minutes back to include. Defaults to 30.
 * @param options.bucketSeconds Size of each aggregation bucket in seconds. Defaults to 60.
 */
export async function getFeederHistory(options?: {
  minutes?: number;
  bucketSeconds?: number;
}): Promise<FeederHistoryPoint[]> {
  const minutes = options?.minutes ?? 30;
  const bucketSeconds = options?.bucketSeconds ?? 60;

  // Calculate the start time once to avoid clock drift during the query.
  const windowStart = new Date(Date.now() - minutes * 60 * 1000);

  const text = `
    SELECT
      to_timestamp(floor(extract(epoch FROM ts) / $2) * $2) AS ts,
      SUM(p_actual_kw) AS total_kw
    FROM telemetry
    WHERE ts >= $1
    GROUP BY ts
    ORDER BY ts ASC;
  `;

  const { rows } = await query<FeederHistoryPoint>(text, [windowStart, bucketSeconds]);
  return rows.map((row) => ({ ts: new Date(row.ts), total_kw: Number(row.total_kw) }));
}
