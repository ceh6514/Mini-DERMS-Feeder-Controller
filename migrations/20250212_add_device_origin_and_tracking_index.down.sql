DROP INDEX IF EXISTS idx_telemetry_recent_setpoint;

ALTER TABLE devices
  DROP COLUMN IF EXISTS is_physical;
