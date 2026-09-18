CREATE TABLE IF NOT EXISTS sms_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sms_request_id INTEGER NOT NULL UNIQUE REFERENCES sms_requests(id) ON DELETE CASCADE,
  call_id INTEGER NOT NULL UNIQUE REFERENCES calls(id) ON DELETE CASCADE,
  recipient TEXT,
  language TEXT,
  message_type TEXT NOT NULL CHECK (message_type IN ('TOP5_BUYERS', 'TOP5_SELLERS')),
  message_text TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'EXOTEL',
  provider_message_id TEXT,
  provider_response_json TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'SENDING', 'SENT', 'FAILED', 'BLOCKED_CONFIGURATION')),
  error_code TEXT,
  error_message TEXT,
  requested_at TEXT NOT NULL,
  sent_at TEXT,
  updated_at TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_sms_deliveries_status
  ON sms_deliveries(status, requested_at);
