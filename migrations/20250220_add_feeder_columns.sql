-- Add feeder_id and parent_feeder_id columns with defaults and backfill existing data
ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS feeder_id TEXT,
  ADD COLUMN IF NOT EXISTS parent_feeder_id TEXT;

UPDATE devices
SET feeder_id = COALESCE(feeder_id, site_id, 'default-feeder')
WHERE feeder_id IS NULL;

ALTER TABLE devices
  ALTER COLUMN feeder_id SET NOT NULL,
  ALTER COLUMN feeder_id SET DEFAULT 'default-feeder';

ALTER TABLE devices
  ADD CONSTRAINT IF NOT EXISTS fk_devices_parent_feeder
  FOREIGN KEY (parent_feeder_id) REFERENCES devices(id);

CREATE INDEX IF NOT EXISTS idx_devices_feeder ON devices (feeder_id);

ALTER TABLE telemetry
  ADD COLUMN IF NOT EXISTS feeder_id TEXT;

UPDATE telemetry t
SET feeder_id = COALESCE(t.feeder_id, d.feeder_id, 'default-feeder')
FROM devices d
WHERE t.device_id = d.id;

UPDATE telemetry
SET feeder_id = COALESCE(feeder_id, 'default-feeder')
WHERE feeder_id IS NULL;

ALTER TABLE telemetry
  ALTER COLUMN feeder_id SET NOT NULL,
  ALTER COLUMN feeder_id SET DEFAULT 'default-feeder';

CREATE INDEX IF NOT EXISTS idx_telemetry_feeder_ts ON telemetry (feeder_id, ts DESC);

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS feeder_id TEXT;

UPDATE events
SET feeder_id = COALESCE(feeder_id, 'default-feeder')
WHERE feeder_id IS NULL;

ALTER TABLE events
  ALTER COLUMN feeder_id SET NOT NULL,
  ALTER COLUMN feeder_id SET DEFAULT 'default-feeder';

CREATE INDEX IF NOT EXISTS idx_events_feeder_window ON events (feeder_id, ts_start, ts_end);
