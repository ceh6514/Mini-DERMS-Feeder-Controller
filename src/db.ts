import { Pool } from 'pg';
import config from './config';

export const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
});

export async function initSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      site_id TEXT NOT NULL,
      p_max_kw REAL NOT NULL,
      priority INTEGER,
      is_physical BOOLEAN NOT NULL DEFAULT FALSE
    );
  `);

  await pool.query(`
    ALTER TABLE devices
    ADD COLUMN IF NOT EXISTS priority INTEGER,
    ADD COLUMN IF NOT EXISTS is_physical BOOLEAN NOT NULL DEFAULT FALSE;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS telemetry (
      id BIGSERIAL PRIMARY KEY,
      device_id TEXT NOT NULL REFERENCES devices(id),
      ts TIMESTAMPTZ NOT NULL,
      type TEXT NOT NULL,
      p_actual_kw REAL NOT NULL,
      p_setpoint_kw REAL,
      soc REAL,
      site_id TEXT NOT NULL,
      cloud_cover_pct REAL NOT NULL DEFAULT 0,
      shortwave_radiation_wm2 REAL NOT NULL DEFAULT 0,
      estimated_power_w REAL NOT NULL DEFAULT 0
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS events (
      id BIGSERIAL PRIMARY KEY,
      ts_start TIMESTAMPTZ NOT NULL,
      ts_end TIMESTAMPTZ NOT NULL,
      limit_kw REAL NOT NULL,
      type TEXT NOT NULL
    );
  `);

  await pool.query(`
    ALTER TABLE telemetry
    ADD COLUMN IF NOT EXISTS cloud_cover_pct REAL NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS shortwave_radiation_wm2 REAL NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS estimated_power_w REAL NOT NULL DEFAULT 0;
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_telemetry_device_ts
      ON telemetry (device_id, ts DESC);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_telemetry_recent_setpoint
      ON telemetry (device_id, ts DESC, p_setpoint_kw, soc);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS dr_programs (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      mode TEXT NOT NULL,
      ts_start TIMESTAMPTZ NOT NULL,
      ts_end TIMESTAMPTZ NOT NULL,
      target_shed_kw REAL DEFAULT 0,
      incentive_per_kwh REAL DEFAULT 0,
      penalty_per_kwh REAL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT FALSE
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_dr_programs_active_window
      ON dr_programs (is_active, ts_start, ts_end);
  `);
}

export async function query<T = unknown>(
  text: string,
  params?: any[],
): Promise<{ rows: T[] }> {
  const result = await pool.query<T>(text, params);
  return { rows: result.rows };
}
