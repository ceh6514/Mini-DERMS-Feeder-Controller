-- Ensure telemetry rows are versioned and deduplicated
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

ALTER TABLE telemetry
  ADD COLUMN IF NOT EXISTS message_id UUID,
  ADD COLUMN IF NOT EXISTS message_version INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS message_type TEXT DEFAULT 'telemetry',
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source TEXT;

UPDATE telemetry
SET message_id = COALESCE(message_id, gen_random_uuid());

ALTER TABLE telemetry
  ALTER COLUMN message_id SET NOT NULL,
  ALTER COLUMN message_version SET NOT NULL,
  ALTER COLUMN message_type SET NOT NULL;

ALTER TABLE telemetry
  ADD CONSTRAINT IF NOT EXISTS telemetry_message_id_unique UNIQUE (message_id);

ALTER TABLE telemetry
  ADD CONSTRAINT IF NOT EXISTS telemetry_device_ts_type_key UNIQUE (device_id, ts, message_type);

CREATE INDEX IF NOT EXISTS idx_telemetry_message_type_ts ON telemetry (message_type, ts DESC);
