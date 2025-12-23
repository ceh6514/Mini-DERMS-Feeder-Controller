DROP INDEX IF EXISTS idx_telemetry_message_type_ts;

ALTER TABLE telemetry
  DROP CONSTRAINT IF EXISTS telemetry_device_ts_type_key,
  DROP CONSTRAINT IF EXISTS telemetry_message_id_unique,
  DROP COLUMN IF EXISTS message_id,
  DROP COLUMN IF EXISTS message_version,
  DROP COLUMN IF EXISTS message_type,
  DROP COLUMN IF EXISTS sent_at,
  DROP COLUMN IF EXISTS source;
