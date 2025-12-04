-- Add weather-derived telemetry fields for solar feeders
ALTER TABLE telemetry
  ADD COLUMN IF NOT EXISTS cloud_cover_pct REAL NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shortwave_radiation_wm2 REAL NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estimated_power_w REAL NOT NULL DEFAULT 0;
