CREATE TABLE IF NOT EXISTS call_language_metadata (
  call_id INTEGER PRIMARY KEY REFERENCES calls(id) ON DELETE CASCADE,
  detected_language TEXT,
  response_language TEXT NOT NULL DEFAULT 'hi-IN',
  language_fallback_reason TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_call_language_metadata_detected
  ON call_language_metadata(detected_language);
