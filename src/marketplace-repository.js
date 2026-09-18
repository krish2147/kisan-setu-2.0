const fs = require("fs");
const path = require("path");
const { LOCATION_COORDINATES, isValidCallablePhone } = require("./matching");

const DEFAULT_SEED_PATH = path.join(__dirname, "..", "data", "demo-marketplace.json");

function createMarketplaceRepository(db) {
  function seedDemoMarketplace({ seedPath = DEFAULT_SEED_PATH, demoBuyerPhone = null } = {}) {
    const seed = JSON.parse(fs.readFileSync(seedPath, "utf8"));
    const callablePhone = isValidCallablePhone(demoBuyerPhone) ? demoBuyerPhone : null;
    const timestamp = new Date().toISOString();
    const upsertParticipant = db.prepare(`
      INSERT INTO market_participants (
        demo_seed_key, type, name, phone, location, latitude, longitude,
        verified, active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(demo_seed_key) DO UPDATE SET
        type = excluded.type, name = excluded.name, phone = excluded.phone,
        location = excluded.location, latitude = excluded.latitude, longitude = excluded.longitude,
        verified = excluded.verified, active = excluded.active, updated_at = excluded.updated_at
    `);
    const upsertListing = db.prepare(`
      INSERT INTO trade_listings (
        demo_seed_key, participant_id, side, commodity, quantity_kg, price_per_kg,
        location, latitude, longitude, active, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
      ON CONFLICT(demo_seed_key) DO UPDATE SET
        participant_id = excluded.participant_id, side = excluded.side,
        commodity = excluded.commodity, quantity_kg = excluded.quantity_kg,
        price_per_kg = excluded.price_per_kg, location = excluded.location,
        latitude = excluded.latitude, longitude = excluded.longitude,
        active = excluded.active, updated_at = excluded.updated_at
    `);

    db.exec("BEGIN IMMEDIATE");
    try {
      for (const item of seed.listings) {
        const coordinates = LOCATION_COORDINATES[item.location] || {};
        const participantKey = `${item.key}-participant`;
        const phone = item.callableDemoBuyer ? callablePhone : null;
        upsertParticipant.run(
          participantKey, item.type, item.name, phone, item.location,
          coordinates.latitude ?? null, coordinates.longitude ?? null,
          item.verified ? 1 : 0, item.active ? 1 : 0, timestamp, timestamp
        );
        const participant = db.prepare("SELECT id FROM market_participants WHERE demo_seed_key = ?").get(participantKey);
        upsertListing.run(
          item.key, participant.id, item.side, item.commodity, item.quantityKg,
          item.pricePerKg, item.location, coordinates.latitude ?? null,
          coordinates.longitude ?? null, item.active ? 1 : 0, timestamp, timestamp
        );
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return { seededListings: seed.listings.length, callableBuyerConfigured: Boolean(callablePhone) };
  }

  function getEligibleListings(side, commodity, now = new Date().toISOString()) {
    return db.prepare(`
      SELECT
        l.id AS listing_id,
        l.side,
        l.commodity,
        l.quantity_kg,
        l.price_per_kg,
        l.location AS listing_location,
        l.latitude AS listing_latitude,
        l.longitude AS listing_longitude,
        l.active AS listing_active,
        l.expires_at,
        p.id AS participant_id,
        p.type AS participant_type,
        p.name,
        p.phone,
        p.verified,
        p.active AS participant_active
      FROM trade_listings l
      JOIN market_participants p ON p.id = l.participant_id
      WHERE l.side = ?
        AND LOWER(l.commodity) = LOWER(?)
        AND l.active = 1
        AND p.active = 1
        AND l.quantity_kg > 0
        AND (l.expires_at IS NULL OR l.expires_at > ?)
      ORDER BY l.id
    `).all(side, commodity, now).map(row => ({ ...row }));
  }

  return { getEligibleListings, seedDemoMarketplace };
}

module.exports = { DEFAULT_SEED_PATH, createMarketplaceRepository };

