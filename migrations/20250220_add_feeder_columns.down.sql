DROP INDEX IF EXISTS idx_events_feeder_window;

ALTER TABLE events
  DROP COLUMN IF EXISTS feeder_id;

DROP INDEX IF EXISTS idx_telemetry_feeder_ts;

ALTER TABLE telemetry
  DROP COLUMN IF EXISTS feeder_id;

DROP INDEX IF EXISTS idx_devices_feeder;

ALTER TABLE devices
  DROP CONSTRAINT IF EXISTS fk_devices_parent_feeder;

ALTER TABLE devices
  DROP COLUMN IF EXISTS feeder_id,
  DROP COLUMN IF EXISTS parent_feeder_id;
