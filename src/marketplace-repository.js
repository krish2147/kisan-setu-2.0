const fs = require("fs");
const path = require("path");
const { LOCATION_COORDINATES, isValidCallablePhone } = require("./matching");

const { normalizeIndiaLocation } = require("./location");
const { normalizeIndianPhoneNumber } = require("./sms");

const DEFAULT_SEED_PATH = path.join(__dirname, "..", "data", "demo-marketplace.json");

function createMarketplaceRepository(db, { includeDemo = false } = {}) {
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

  function registerVoiceCall(callSid) {
    // Synchronous transaction: retries and overlapping calls cannot create duplicate requirements.
    db.exec("BEGIN IMMEDIATE");
    try {
      const call = db.prepare("SELECT * FROM calls WHERE call_sid = ?").get(callSid);
      const phone = normalizeIndianPhoneNumber(call?.caller_number);
      if (!call || !["BUY", "SELL"].includes(call.intent) || !call.commodity?.trim() ||
          !call.location?.trim() || !Number.isFinite(call.quantity_kg) || call.quantity_kg <= 0 || call.quantity_kg > 100000000) {
        db.exec("COMMIT");
        return { status: "SKIPPED", reason: "INCOMPLETE_REQUIREMENT" };
      }
      if (!phone) {
        db.exec("COMMIT");
        return { status: "SKIPPED", reason: "CALLER_NUMBER_UNAVAILABLE" };
      }
      const linked = db.prepare("SELECT listing_id FROM voice_call_listings WHERE call_id = ?").get(call.id);
      if (linked) {
        db.exec("COMMIT");
        return { status: "EXISTING", listingId: linked.listing_id };
      }
      const locationInfo = normalizeIndiaLocation(call.location);
      const location = locationInfo.city || locationInfo.district || call.location.trim();
      const commodity = call.commodity.trim();
      const type = call.intent === "BUY" ? "BUYER" : "SELLER";
      const now = new Date().toISOString();
      const participants = db.prepare("SELECT * FROM market_participants WHERE type = ? AND demo_seed_key IS NULL ORDER BY id").all(type)
        .filter(p => normalizeIndianPhoneNumber(p.phone) === phone);
      let existing;
      for (const participant of participants) {
        existing = db.prepare(`SELECT * FROM trade_listings WHERE participant_id = ? AND side = ?
          AND LOWER(commodity) = LOWER(?) AND demo_seed_key IS NULL ORDER BY id`).all(participant.id, call.intent, commodity)
          .find(l => {
            const normalized = normalizeIndiaLocation(l.location);
            return (normalized.city || normalized.district || l.location.trim()).toLowerCase() === location.toLowerCase();
          });
        if (existing) break;
      }
      let listingId;
      let status;
      if (existing) {
        listingId = existing.id;
        // An older delayed call must not overwrite a newer requirement.
        const latest = db.prepare("SELECT MAX(call_id) AS id FROM voice_call_listings WHERE listing_id = ?").get(listingId);
        if (!latest.id || call.id > latest.id) {
          db.prepare("UPDATE trade_listings SET quantity_kg = ?, updated_at = ? WHERE id = ?")
            .run(call.quantity_kg, now, listingId);
        }
        // Preserve price, participant verification and administrator deactivation.
        status = "UPDATED";
      } else {
        let participant = participants[0];
        if (!participant) {
          const created = db.prepare(`INSERT INTO market_participants
            (type, name, phone, location, latitude, longitude, verified, active, created_at, updated_at)
            VALUES (?, '', ?, ?, ?, ?, 0, 1, ?, ?)`).run(type, phone, location,
              locationInfo.latitude ?? null, locationInfo.longitude ?? null, now, now);
          participant = { id: Number(created.lastInsertRowid), active: 1 };
        }
        const created = db.prepare(`INSERT INTO trade_listings
          (participant_id, side, commodity, quantity_kg, price_per_kg, location, latitude, longitude, active, created_at, updated_at)
          VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`).run(participant.id, call.intent, commodity, call.quantity_kg,
            location, locationInfo.latitude ?? null, locationInfo.longitude ?? null, participant.active, now, now);
        listingId = Number(created.lastInsertRowid);
        status = "CREATED";
      }
      db.prepare("INSERT INTO voice_call_listings (call_id, listing_id, created_at) VALUES (?, ?, ?)").run(call.id, listingId, now);
      db.exec("COMMIT");
      return { status, listingId };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
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
        AND (? = 1 OR (l.demo_seed_key IS NULL AND p.demo_seed_key IS NULL))
        AND l.active = 1
        AND p.active = 1
        AND l.quantity_kg > 0
        AND (l.expires_at IS NULL OR l.expires_at > ?)
      ORDER BY l.id
    `).all(side, commodity, includeDemo ? 1 : 0, now).map(row => ({ ...row }));
  }

  return { getEligibleListings, seedDemoMarketplace, registerVoiceCall };
}

module.exports = { DEFAULT_SEED_PATH, createMarketplaceRepository };

