-- Add physical device marker and optimize telemetry lookups for setpoint/SOC-aware metrics
ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS is_physical BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_telemetry_recent_setpoint
  ON telemetry (device_id, ts DESC, p_setpoint_kw, soc);
