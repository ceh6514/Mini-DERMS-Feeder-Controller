-- Ensure telemetry table is optimized for time-series lookups
CREATE INDEX IF NOT EXISTS idx_telemetry_device_ts ON telemetry (device_id, ts DESC);
