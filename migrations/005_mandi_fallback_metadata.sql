CREATE TABLE IF NOT EXISTS mandi_result_metadata (
  mandi_result_id INTEGER PRIMARY KEY REFERENCES mandi_results(id) ON DELETE CASCADE,
  state TEXT,
  district TEXT,
  min_price REAL,
  max_price REAL,
  unit TEXT,
  observed_at TEXT,
  source TEXT,
  is_fallback INTEGER NOT NULL DEFAULT 0 CHECK (is_fallback IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_mandi_result_metadata_source
  ON mandi_result_metadata(source, is_fallback);
