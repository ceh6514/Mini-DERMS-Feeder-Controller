import { query } from '../db';
import { DeviceMetrics } from '../types/control';
import { getCurrentFeederLimit } from './eventsRepo';
import config from '../config';

export interface TelemetryRow {
  id?: number;
  message_id?: string;
  message_version?: number;
  message_type?: string;
  sent_at?: Date | null;
  source?: string | null;
  device_id: string;
  ts: Date;
  type: string;
  p_actual_kw: number;
  p_setpoint_kw?: number | null;
  soc?: number | null;
  site_id: string;
  feeder_id: string;
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

export type MetricsWindow = 'day' | 'week' | 'month';

export interface DeviceAggregate {
  deviceId: string;
  deviceType: string;
  avgKw: number;
  maxKw: number;
  percentCurtailment: number;
  minSoc: number | null;
}

export interface HeadroomPoint {
  ts: string;
  totalKw: number;
  limitKw: number;
  utilizationPct: number;
  curtailmentPct: number;
  fairnessScore: number;
}

export interface SocTrajectoryPoint {
  ts: string;
  deviceId: string;
  soc: number;
}

function normalizeFeederId(feederId?: string | null): string {
  return feederId?.trim() || config.defaultFeederId;
}

export interface AggregatedMetrics {
  window: MetricsWindow;
  rangeStart: string;
  rangeEnd: string;
  feederId: string;
  feeder: {
    avgKw: number;
    maxKw: number;
    percentCurtailment: number;
    slaViolations: number;
    fairnessScore: number;
  };
  headroom: HeadroomPoint[];
  devices: DeviceAggregate[];
  socTrajectories: SocTrajectoryPoint[];
}

export interface LiveDeviceRow {
  deviceId: string;
  type: string;
  siteId: string;
  feederId: string;
  pMaxKw: number;
  priority: number | null;
  isPhysical: boolean;
  lastSeen: Date;
  pActualKw: number;
  pSetpointKw: number | null;
  soc: number | null;
}

export async function insertTelemetry(row: TelemetryRow): Promise<'inserted' | 'duplicate'> {
  const feederId = normalizeFeederId(row.feeder_id);
  const text = `
    INSERT INTO telemetry (
      message_id,
      message_version,
      message_type,
      sent_at,
      source,
      device_id,
      ts,
      type,
      p_actual_kw,
      p_setpoint_kw,
      soc,
      site_id,
      feeder_id,
      cloud_cover_pct,
      shortwave_radiation_wm2,
      estimated_power_w
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    ON CONFLICT ON CONSTRAINT telemetry_device_ts_type_key DO UPDATE
    SET
      message_version = EXCLUDED.message_version,
      message_type = EXCLUDED.message_type,
      sent_at = EXCLUDED.sent_at,
      source = EXCLUDED.source,
      type = EXCLUDED.type,
      p_actual_kw = EXCLUDED.p_actual_kw,
      p_setpoint_kw = EXCLUDED.p_setpoint_kw,
      soc = EXCLUDED.soc,
      site_id = EXCLUDED.site_id,
      feeder_id = EXCLUDED.feeder_id,
      cloud_cover_pct = EXCLUDED.cloud_cover_pct,
      shortwave_radiation_wm2 = EXCLUDED.shortwave_radiation_wm2,
      estimated_power_w = EXCLUDED.estimated_power_w;
  `;
  try {
    await query(text, [
      row.message_id ?? null,
      row.message_version ?? 1,
      row.message_type ?? 'telemetry',
      row.sent_at ?? null,
      row.source ?? null,
      row.device_id,
      row.ts,
      row.type,
      row.p_actual_kw,
      row.p_setpoint_kw ?? null,
      row.soc ?? null,
      row.site_id,
      feederId,
      row.cloud_cover_pct ?? 0,
      row.shortwave_radiation_wm2 ?? 0,
      row.estimated_power_w ?? 0,
    ]);
    return 'inserted';
  } catch (err: any) {
    if (err?.code === '23505') {
      return 'duplicate';
    }
    throw err;
  }
}

export async function getLatestTelemetryPerDevice(feederId?: string): Promise<TelemetryRow[]> {
  const resolvedFeeder = normalizeFeederId(feederId);
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
      t.feeder_id,
      d.p_max_kw AS device_p_max_kw,
      t.cloud_cover_pct,
      t.shortwave_radiation_wm2,
      t.estimated_power_w
    FROM telemetry t
    JOIN devices d ON d.id = t.device_id
    WHERE t.feeder_id = $1
    ORDER BY t.device_id, t.ts DESC;
  `;
  const { rows } = await query<TelemetryRow>(text, [resolvedFeeder]);
  return rows;
}

export async function getLiveDevices(
  minutes = 2,
  feederId?: string,
): Promise<LiveDeviceRow[]> {
  const resolvedFeeder = normalizeFeederId(feederId);
  const text = `
    SELECT DISTINCT ON (t.device_id)
      t.device_id AS "deviceId",
      d.type,
      d.site_id AS "siteId",
      d.feeder_id AS "feederId",
      d.p_max_kw AS "pMaxKw",
      d.priority,
      d.is_physical AS "isPhysical",
      t.ts AS "lastSeen",
      t.p_actual_kw AS "pActualKw",
      t.p_setpoint_kw AS "pSetpointKw",
      t.soc
    FROM telemetry t
    JOIN devices d ON d.id = t.device_id
    WHERE t.ts >= NOW() - ($1 || ' minutes')::INTERVAL
      AND t.feeder_id = $2
    ORDER BY t.device_id, t.ts DESC;
  `;

  const { rows } = await query<LiveDeviceRow>(text, [minutes, resolvedFeeder]);
  return rows.map((row) => ({
    ...row,
    lastSeen: row.lastSeen instanceof Date ? row.lastSeen : new Date(row.lastSeen),
    isPhysical: Boolean(row.isPhysical),
  }));
}

export async function getTrackingErrorWindow(
  windowMinutes: number,
  feederId?: string,
): Promise<DeviceMetrics[]> {
  const resolvedFeeder = normalizeFeederId(feederId);
  const text = `
    SELECT
      t.device_id AS "deviceId",
      d.type,
      d.site_id AS "siteId",
      t.feeder_id AS "feederId",
      d.priority,
      d.is_physical AS "isPhysical",
      t.ts,
      t.p_actual_kw,
      t.p_setpoint_kw,
      t.soc
    FROM telemetry t
    JOIN devices d ON d.id = t.device_id
    WHERE t.ts >= NOW() - ($1 || ' minutes')::INTERVAL
      AND t.feeder_id = $2
    ORDER BY t.device_id, t.ts DESC;
  `;

  const { rows } = await query<{
    deviceId: string;
    type: string;
    siteId: string;
    feederId: string;
    priority: number | null;
    isPhysical: boolean;
    ts: Date;
    p_actual_kw: number | null;
    p_setpoint_kw: number | null;
    soc: number | null;
  }>(text, [windowMinutes, resolvedFeeder]);

  const aggregates = new Map<string, {
    totalError: number;
    count: number;
    lastSetpointKw: number | null;
    lastActualKw: number | null;
    soc: number | null;
    type: string;
    siteId: string;
    feederId: string;
    priority: number;
    isPhysical: boolean;
  }>();

  for (const row of rows) {
    const key = row.deviceId;
    const setpoint = row.p_setpoint_kw ?? 0;
    const actual = row.p_actual_kw ?? 0;
    const absError = Math.abs(actual - setpoint);
    const priority = Number.isFinite(row.priority) && (row.priority as number) > 0
      ? (row.priority as number)
      : 1;

    const existing = aggregates.get(key);
    if (!existing) {
      aggregates.set(key, {
        totalError: absError,
        count: 1,
        lastSetpointKw: row.p_setpoint_kw ?? null,
        lastActualKw: row.p_actual_kw ?? null,
        soc: row.soc ?? null,
        type: row.type,
        siteId: row.siteId,
        feederId: row.feederId,
        priority,
        isPhysical: Boolean(row.isPhysical),
      });
    } else {
      existing.totalError += absError;
      existing.count += 1;
    }
  }

  return [...aggregates.entries()].map(([deviceId, agg]) => ({
    deviceId,
    type: agg.type,
    siteId: agg.siteId,
    feederId: agg.feederId,
    priority: agg.priority,
    soc: agg.soc,
    isPhysical: agg.isPhysical,
    avgAbsError: agg.count > 0 ? agg.totalError / agg.count : 0,
    lastSetpointKw: agg.lastSetpointKw,
    lastActualKw: agg.lastActualKw,
  }));
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
      feeder_id,
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
  const resolvedFeeder = normalizeFeederId(feederId);
  const text = `
    SELECT
      device_id,
      ts,
      cloud_cover_pct,
      shortwave_radiation_wm2,
      estimated_power_w
    FROM telemetry
    WHERE feeder_id = $1 AND type = 'solar_weather'
    ORDER BY ts DESC
    LIMIT 1;
  `;

  const { rows } = await query<{
    device_id: string;
    ts: Date;
    cloud_cover_pct: number;
    shortwave_radiation_wm2: number;
    estimated_power_w: number;
  }>(text, [resolvedFeeder]);

  if (!rows[0]) {
    return null;
  }

  const row = rows[0];
  return {
    feederId: resolvedFeeder,
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
  const feederId = normalizeFeederId(sample.feederId);
  const siteIdQuery = `
    SELECT site_id
    FROM devices
    WHERE feeder_id = $1
    LIMIT 1;
  `;
  const { rows } = await query<{ site_id: string }>(siteIdQuery, [feederId]);
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
        feeder_id,
        cloud_cover_pct,
        shortwave_radiation_wm2,
        estimated_power_w
      )
      VALUES ($1, $2, $3, $4, NULL, NULL, $5, $6, $7, $8, $9);
    `,
    [
      feederId,
      new Date(sample.timestamp),
      'solar_weather',
      sample.estimatedPowerW / 1000,
      siteId,
      feederId,
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
  feederId?: string;
}): Promise<FeederHistoryPoint[]> {
  const minutes = options?.minutes ?? 30;
  const bucketSeconds = options?.bucketSeconds ?? 60;
  const feederId = normalizeFeederId(options?.feederId);

  // Calculate the start time once to avoid clock drift during the query.
  const windowStart = new Date(Date.now() - minutes * 60 * 1000);

  const text = `
    SELECT
      to_timestamp(floor(extract(epoch FROM ts) / $2) * $2) AS ts,
      SUM(p_actual_kw) AS total_kw
    FROM telemetry
    WHERE ts >= $1
      AND feeder_id = $3
    GROUP BY ts
    ORDER BY ts ASC;
  `;

  const { rows } = await query<FeederHistoryPoint>(text, [windowStart, bucketSeconds, feederId]);
  return rows.map((row) => ({ ts: new Date(row.ts), total_kw: Number(row.total_kw) }));
}

function getWindowStart(window: MetricsWindow): Date {
  const now = Date.now();
  const lookbackMs: Record<MetricsWindow, number> = {
    day: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000,
  };

  return new Date(now - lookbackMs[window]);
}

function calculateFairness(values: number[]): number {
  if (values.length === 0) {
    return 1;
  }

  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  if (mean === 0) {
    return 1;
  }

  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / Math.max(values.length - 1, 1);
  const stdDev = Math.sqrt(variance);

  // Normalize the spread and clamp to [0, 1]
  const normalized = stdDev / (mean || 1);
  return Math.min(1, Math.max(0, 1 - normalized));
}

export async function getAggregatedMetrics(
  window: MetricsWindow,
  bucketMinutes?: number,
  feederId?: string,
): Promise<AggregatedMetrics> {
  const bucketSeconds = (bucketMinutes ?? (window === 'day' ? 30 : window === 'week' ? 60 : 120)) * 60;
  const rangeStart = getWindowStart(window);
  const resolvedFeeder = normalizeFeederId(feederId);

  const bucketedQuery = `
    SELECT
      to_timestamp(floor(extract(epoch FROM t.ts) / $2) * $2) AS bucket_ts,
      t.device_id,
      d.type AS device_type,
      AVG(t.p_actual_kw) AS avg_actual_kw,
      MAX(t.p_actual_kw) AS max_actual_kw,
      MIN(t.soc) AS min_soc,
      AVG(t.p_setpoint_kw) AS avg_setpoint_kw,
      SUM(
        CASE
          WHEN t.p_setpoint_kw IS NOT NULL AND t.p_setpoint_kw > 0 THEN GREATEST(0, t.p_setpoint_kw - t.p_actual_kw)
          ELSE 0
        END
      ) AS curtailment_kw,
      SUM(
        CASE
          WHEN t.p_setpoint_kw IS NOT NULL AND t.p_setpoint_kw > 0 THEN t.p_setpoint_kw
          ELSE 0
        END
      ) AS requested_kw
    FROM telemetry t
    JOIN devices d ON d.id = t.device_id
    WHERE t.ts >= $1 AND t.type <> 'solar_weather' AND t.feeder_id = $3
    GROUP BY bucket_ts, t.device_id, d.type
    ORDER BY bucket_ts ASC;
  `;

  const { rows } = await query<{
    bucket_ts: Date;
    device_id: string;
    device_type: string;
    avg_actual_kw: number;
    max_actual_kw: number;
    min_soc: number | null;
    avg_setpoint_kw: number | null;
    curtailment_kw: number | null;
    requested_kw: number | null;
  }>(bucketedQuery, [rangeStart, bucketSeconds, resolvedFeeder]);

  const slaQuery = `
    SELECT COUNT(*) AS violations
    FROM telemetry
    WHERE ts >= $1
      AND type <> 'solar_weather'
      AND feeder_id = $2
      AND (
        (soc IS NOT NULL AND soc < 0.2)
        OR (p_setpoint_kw IS NOT NULL AND p_actual_kw - p_setpoint_kw > 0.01)
      );
  `;

  const slaResult = await query<{ violations: string }>(slaQuery, [rangeStart, resolvedFeeder]);
  const slaViolations = Number(slaResult.rows[0]?.violations ?? 0);

  const deviceMap = new Map<string, DeviceAggregate & { requested: number; curtailed: number }>();
  const bucketMap = new Map<string, typeof rows>();

  rows.forEach((row) => {
    const bucketKey = (row.bucket_ts instanceof Date ? row.bucket_ts : new Date(row.bucket_ts)).toISOString();
    const existingBucket = bucketMap.get(bucketKey) ?? [];
    existingBucket.push(row);
    bucketMap.set(bucketKey, existingBucket);

    const curtailment = Number(row.curtailment_kw ?? 0);
    const requested = Number(row.requested_kw ?? 0);
    const aggregate = deviceMap.get(row.device_id) ?? {
      deviceId: row.device_id,
      deviceType: row.device_type,
      avgKw: 0,
      maxKw: 0,
      percentCurtailment: 0,
      minSoc: row.min_soc ?? null,
      requested: 0,
      curtailed: 0,
    };

    aggregate.avgKw += Number(row.avg_actual_kw ?? 0);
    aggregate.maxKw = Math.max(aggregate.maxKw, Number(row.max_actual_kw ?? 0));
    aggregate.minSoc = aggregate.minSoc === null ? row.min_soc : Math.min(aggregate.minSoc, row.min_soc ?? aggregate.minSoc);
    aggregate.requested += requested;
    aggregate.curtailed += curtailment;

    deviceMap.set(row.device_id, aggregate);
  });

  const headroom: HeadroomPoint[] = [];
  const fairnessSeries: number[] = [];

  let totalCurtailmentKw = 0;
  let totalRequestedKw = 0;
  let totalKwAccumulator = 0;
  let bucketCount = 0;
  let maxKw = 0;

  const limitKw = await getCurrentFeederLimit(new Date(), resolvedFeeder);

  const socTrajectories: SocTrajectoryPoint[] = [];

  Array.from(bucketMap.entries())
    .sort(([a], [b]) => new Date(a).getTime() - new Date(b).getTime())
    .forEach(([bucketTs, bucketRows]) => {
      const totalKw = bucketRows.reduce((sum, r) => sum + Number(r.avg_actual_kw ?? 0), 0);
      const bucketCurtailment = bucketRows.reduce((sum, r) => sum + Number(r.curtailment_kw ?? 0), 0);
      const bucketRequested = bucketRows.reduce((sum, r) => sum + Number(r.requested_kw ?? 0), 0);
      const deviceCurtailments = bucketRows
        .map((r) => {
          const requested = Number(r.requested_kw ?? 0);
          if (requested <= 0) return 0;
          const curtailed = Number(r.curtailment_kw ?? 0);
          return curtailed / requested;
        })
        .filter((v) => Number.isFinite(v));

      const fairness = calculateFairness(deviceCurtailments);
      fairnessSeries.push(fairness);

      headroom.push({
        ts: bucketTs,
        totalKw,
        limitKw,
        utilizationPct: limitKw > 0 ? (totalKw / limitKw) * 100 : 0,
        curtailmentPct: bucketRequested > 0 ? (bucketCurtailment / bucketRequested) * 100 : 0,
        fairnessScore: fairness,
      });

      totalCurtailmentKw += bucketCurtailment;
      totalRequestedKw += bucketRequested;
      totalKwAccumulator += totalKw;
      bucketCount += 1;
      maxKw = Math.max(maxKw, totalKw);

      bucketRows.forEach((r) => {
        if (r.min_soc !== null && r.min_soc !== undefined) {
          socTrajectories.push({
            ts: bucketTs,
            deviceId: r.device_id,
            soc: Number(r.min_soc),
          });
        }
      });
    });

  const devices: DeviceAggregate[] = Array.from(deviceMap.values()).map((d) => ({
    deviceId: d.deviceId,
    deviceType: d.deviceType,
    avgKw: bucketCount > 0 ? d.avgKw / bucketCount : 0,
    maxKw: d.maxKw,
    percentCurtailment: d.requested > 0 ? (d.curtailed / d.requested) * 100 : 0,
    minSoc: d.minSoc,
  }));

  const avgKw = bucketCount > 0 ? totalKwAccumulator / bucketCount : 0;
  const percentCurtailment = totalRequestedKw > 0 ? (totalCurtailmentKw / totalRequestedKw) * 100 : 0;
  const fairnessScore = fairnessSeries.length
    ? fairnessSeries.reduce((sum, v) => sum + v, 0) / fairnessSeries.length
    : 1;

  return {
    window,
    rangeStart: rangeStart.toISOString(),
    rangeEnd: new Date().toISOString(),
    feederId: resolvedFeeder,
    feeder: {
      avgKw,
      maxKw,
      percentCurtailment,
      slaViolations,
      fairnessScore,
    },
    headroom,
    devices,
    socTrajectories,
  };
}
