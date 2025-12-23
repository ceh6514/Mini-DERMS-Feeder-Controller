ALTER TABLE telemetry
  DROP COLUMN IF EXISTS cloud_cover_pct,
  DROP COLUMN IF EXISTS shortwave_radiation_wm2,
  DROP COLUMN IF EXISTS estimated_power_w;
