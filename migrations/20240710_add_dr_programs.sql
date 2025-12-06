CREATE TABLE IF NOT EXISTS dr_programs (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  mode TEXT NOT NULL,
  ts_start TIMESTAMPTZ NOT NULL,
  ts_end TIMESTAMPTZ NOT NULL,
  target_shed_kw REAL DEFAULT 0,
  incentive_per_kwh REAL DEFAULT 0,
  penalty_per_kwh REAL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_dr_programs_active_window
  ON dr_programs (is_active, ts_start, ts_end);
