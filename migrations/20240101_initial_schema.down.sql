DROP INDEX IF EXISTS idx_dr_programs_active_window;
DROP TABLE IF EXISTS dr_programs;

DROP INDEX IF EXISTS idx_events_feeder_window;
DROP TABLE IF EXISTS events;

DROP INDEX IF EXISTS idx_telemetry_recent_setpoint;
DROP INDEX IF EXISTS idx_telemetry_feeder_ts;
DROP INDEX IF EXISTS idx_telemetry_message_type_ts;
DROP INDEX IF EXISTS telemetry_device_ts_type_key;
DROP INDEX IF EXISTS idx_telemetry_device_ts;
DROP INDEX IF EXISTS idx_telemetry_message_id_unique;
DROP TABLE IF EXISTS telemetry;

DROP INDEX IF EXISTS idx_devices_feeder;
DROP TABLE IF EXISTS devices;
