-- One marketplace registration per call. Keeps the original call as provenance.
CREATE TABLE IF NOT EXISTS voice_call_listings (
  call_id INTEGER PRIMARY KEY REFERENCES calls(id),
  listing_id INTEGER NOT NULL REFERENCES trade_listings(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_voice_call_listings_listing ON voice_call_listings(listing_id);
CREATE INDEX IF NOT EXISTS idx_market_participants_phone_type ON market_participants(phone, type);
