CREATE TABLE IF NOT EXISTS sms_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id INTEGER NOT NULL UNIQUE REFERENCES calls(id) ON DELETE CASCADE,
  match_type TEXT NOT NULL CHECK (match_type IN ('BUYERS', 'SELLERS')),
  language TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'FAILED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sms_request_matches (
  sms_request_id INTEGER NOT NULL REFERENCES sms_requests(id) ON DELETE CASCADE,
  call_match_id INTEGER NOT NULL REFERENCES call_matches(id) ON DELETE RESTRICT,
  match_rank INTEGER NOT NULL CHECK (match_rank BETWEEN 1 AND 5),
  PRIMARY KEY (sms_request_id, call_match_id),
  UNIQUE (sms_request_id, match_rank)
);

CREATE INDEX IF NOT EXISTS idx_sms_requests_status ON sms_requests(status, created_at);
CREATE INDEX IF NOT EXISTS idx_sms_request_matches_request
  ON sms_request_matches(sms_request_id, match_rank);

