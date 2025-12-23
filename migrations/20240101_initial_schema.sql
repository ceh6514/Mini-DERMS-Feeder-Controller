CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  site_id TEXT NOT NULL,
  p_max_kw REAL NOT NULL,
  feeder_id TEXT NOT NULL DEFAULT 'default-feeder',
  parent_feeder_id TEXT NULL,
  priority INTEGER,
  is_physical BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_devices_feeder ON devices (feeder_id);

CREATE TABLE IF NOT EXISTS telemetry (
  id BIGSERIAL PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id),
  ts TIMESTAMPTZ NOT NULL,
  type TEXT NOT NULL,
  p_actual_kw REAL NOT NULL,
  p_setpoint_kw REAL,
  soc REAL,
  site_id TEXT NOT NULL,
  feeder_id TEXT NOT NULL DEFAULT 'default-feeder',
  cloud_cover_pct REAL NOT NULL DEFAULT 0,
  shortwave_radiation_wm2 REAL NOT NULL DEFAULT 0,
  estimated_power_w REAL NOT NULL DEFAULT 0,
  message_id UUID DEFAULT gen_random_uuid(),
  message_version INTEGER DEFAULT 1,
  message_type TEXT DEFAULT 'telemetry',
  sent_at TIMESTAMPTZ,
  source TEXT
);

UPDATE telemetry SET message_id = COALESCE(message_id, gen_random_uuid());

ALTER TABLE telemetry
  ALTER COLUMN message_id SET NOT NULL,
  ALTER COLUMN message_version SET NOT NULL,
  ALTER COLUMN message_type SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_telemetry_message_type_ts ON telemetry (message_type, ts DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_device_ts ON telemetry (device_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_feeder_ts ON telemetry (feeder_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_recent_setpoint ON telemetry (device_id, ts DESC, p_setpoint_kw, soc);

CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY,
  ts_start TIMESTAMPTZ NOT NULL,
  ts_end TIMESTAMPTZ NOT NULL,
  limit_kw REAL NOT NULL,
  type TEXT NOT NULL,
  feeder_id TEXT NOT NULL DEFAULT 'default-feeder'
);

CREATE INDEX IF NOT EXISTS idx_events_feeder_window ON events (feeder_id, ts_start, ts_end);

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

CREATE INDEX IF NOT EXISTS idx_dr_programs_active_window
  ON dr_programs (is_active, ts_start, ts_end);
