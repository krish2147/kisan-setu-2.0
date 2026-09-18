CREATE TABLE IF NOT EXISTS market_participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  demo_seed_key TEXT UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('BUYER', 'SELLER')),
  name TEXT NOT NULL,
  phone TEXT,
  location TEXT NOT NULL,
  latitude REAL,
  longitude REAL,
  verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trade_listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  demo_seed_key TEXT UNIQUE,
  participant_id INTEGER NOT NULL REFERENCES market_participants(id) ON DELETE CASCADE,
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  commodity TEXT NOT NULL,
  quantity_kg REAL NOT NULL CHECK (quantity_kg > 0),
  price_per_kg REAL,
  location TEXT NOT NULL,
  latitude REAL,
  longitude REAL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS call_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id INTEGER NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  listing_id INTEGER NOT NULL REFERENCES trade_listings(id),
  participant_id INTEGER NOT NULL REFERENCES market_participants(id),
  rank INTEGER NOT NULL CHECK (rank BETWEEN 1 AND 5),
  score REAL NOT NULL,
  price_score REAL NOT NULL,
  distance_score REAL NOT NULL,
  quantity_score REAL NOT NULL,
  verification_score REAL NOT NULL,
  distance_km REAL,
  matched_quantity_kg REAL NOT NULL,
  is_recommended INTEGER NOT NULL DEFAULT 0 CHECK (is_recommended IN (0, 1)),
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(call_id, rank),
  UNIQUE(call_id, listing_id)
);

CREATE INDEX IF NOT EXISTS idx_market_participants_type_active
  ON market_participants(type, active);
CREATE INDEX IF NOT EXISTS idx_trade_listings_lookup
  ON trade_listings(side, commodity, active);
CREATE INDEX IF NOT EXISTS idx_trade_listings_participant
  ON trade_listings(participant_id);
CREATE INDEX IF NOT EXISTS idx_call_matches_call_rank
  ON call_matches(call_id, rank);
CREATE INDEX IF NOT EXISTS idx_call_matches_participant
  ON call_matches(participant_id);

