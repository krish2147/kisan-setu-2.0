CREATE TABLE IF NOT EXISTS calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_sid TEXT NOT NULL UNIQUE,
  stream_sid TEXT,
  caller_number TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_seconds INTEGER,
  intent TEXT,
  language TEXT,
  language_confidence REAL,
  commodity TEXT,
  quantity_kg REAL,
  location TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  current_stage TEXT NOT NULL DEFAULT 'WELCOME',
  selected_mandi TEXT,
  matched_buyer_id INTEGER,
  buyer_connection_requested INTEGER NOT NULL DEFAULT 0 CHECK (buyer_connection_requested IN (0, 1)),
  buyer_connection_status TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS call_transcripts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id INTEGER NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  language TEXT,
  timestamp TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mandi_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id INTEGER NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  commodity TEXT,
  location TEXT,
  mandi TEXT NOT NULL,
  spoken_name TEXT,
  modal_price REAL NOT NULL,
  result_order INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS call_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id INTEGER NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_calls_started_at ON calls(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_status ON calls(status);
CREATE INDEX IF NOT EXISTS idx_call_transcripts_call_id ON call_transcripts(call_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_mandi_results_call_id ON mandi_results(call_id, result_order);
CREATE INDEX IF NOT EXISTS idx_call_events_call_id ON call_events(call_id, created_at);

