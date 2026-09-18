const express = require('express');
const { normalizeIndiaLocation } = require('./location');
const { rankMatches, isValidCallablePhone } = require('./matching');
const { marketDataService } = require('./market-data');

function configured(value) {
  return Boolean(value && !/^(your_|replace|changeme)/i.test(value) && !/XXXX/i.test(value));
}

function validateListing(body) {
  const text = key => typeof body[key] === 'string' ? body[key].trim() : '';
  const side = text('side');
  const name = text('name');
  const phone = text('phone');
  const commodity = text('commodity');
  const location = text('location');
  const quantityKg = Number(body.quantityKg);
  const pricePerKg = body.pricePerKg === '' || body.pricePerKg == null ? null : Number(body.pricePerKg);
  if (!['BUY', 'SELL'].includes(side)) throw new Error('Choose buyer or seller.');
  if (!name || name.length > 100) throw new Error('Enter a name of up to 100 characters.');
  if (phone && !isValidCallablePhone(phone)) throw new Error('Use an international phone number, such as +91 followed by 10 digits.');
  if (!commodity || commodity.length > 80) throw new Error('Enter a commodity of up to 80 characters.');
  if (!location || location.length > 120) throw new Error('Enter a location of up to 120 characters.');
  if (!Number.isFinite(quantityKg) || quantityKg <= 0 || quantityKg > 100000000) throw new Error('Quantity must be greater than zero and at most 100,000,000 kg.');
  if (pricePerKg !== null && (!Number.isFinite(pricePerKg) || pricePerKg <= 0 || pricePerKg > 1000000)) throw new Error('Price must be greater than zero and at most ₹1,000,000/kg.');
  const normalized = normalizeIndiaLocation(location);
  return { side, name, phone: phone || null, commodity, location: normalized.city || normalized.district || location, quantityKg, pricePerKg,
    latitude: normalized.latitude ?? null, longitude: normalized.longitude ?? null };
}

function mountWorkspaceApi(app, { db, marketplaceRepository, extractFarmerData, adminEvents }) {
  // Registered after /api/admin authentication in mountAdminApi.
  app.use('/api/admin', express.json({ limit: '16kb' }));
  app.use('/api/admin', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('origin')) {
      try {
        if (new URL(req.get('origin')).host !== req.get('host')) return res.status(403).json({ error: 'Cross-origin writes are not allowed.' });
      } catch { return res.status(403).json({ error: 'Invalid origin.' }); }
    }
    next();
  });
  db.exec(`CREATE TABLE IF NOT EXISTS workspace_submissions (
    request_key TEXT PRIMARY KEY, listing_id INTEGER NOT NULL REFERENCES trade_listings(id)
  )`);
  const listings = () => db.prepare(`SELECT l.*, p.name, p.phone, p.verified,
    (SELECT count(*) FROM voice_call_listings v WHERE v.listing_id = l.id) AS voice_call_count
    FROM trade_listings l
    JOIN market_participants p ON p.id = l.participant_id
    WHERE l.demo_seed_key IS NULL AND p.demo_seed_key IS NULL ORDER BY l.created_at DESC, l.id DESC`).all();
  const matchesFor = listing => rankMatches({ intent: listing.side, commodity: listing.commodity,
    quantityKg: listing.quantity_kg, location: listing.location, callerNumber: listing.phone },
    marketplaceRepository.getEligibleListings(listing.side === 'SELL' ? 'BUY' : 'SELL', listing.commodity)
      .filter(candidate => !listing.phone || candidate.phone !== listing.phone));

  app.get('/api/admin/workspace', (_req, res) => {
    const env = process.env;
    res.json({ listings: listings(), serverTime: new Date().toISOString(), services: [
      { name: 'Call monitoring', state: 'ready', detail: 'Database and live event stream available' },
      { name: 'Sarvam voice', state: configured(env.SARVAM_API_KEY) ? 'configured' : 'missing', detail: 'Speech recognition and spoken responses · live call verification required' },
      { name: 'Exotel telephony', state: ['EXOTEL_ACCOUNT_SID', 'EXOTEL_API_KEY', 'EXOTEL_API_TOKEN', 'EXOTEL_SUBDOMAIN'].every(k => configured(env[k])) ? 'configured' : 'missing', detail: 'Inbound calls require an Exotel flow connected to /voicebot' },
      { name: 'SMS delivery', state: configured(env.FAST2SMS_API_KEY) ? 'configured' : 'missing', detail: 'Fast2SMS · provider acceptance is not handset delivery confirmation' },
      { name: 'Official mandi prices', state: configured(env.DATA_GOV_IN_API_KEY) ? 'configured' : 'missing', detail: 'AGMARKNET / data.gov.in · API key required for official prices' },
      { name: 'Dashboard access', state: configured(env.ADMIN_TOKEN) ? 'configured' : 'local', detail: env.ADMIN_TOKEN ? 'Protected with an access token' : 'Localhost only · set ADMIN_TOKEN before remote admin access' }
    ], sampleListingsExcluded: db.prepare('SELECT count(*) AS count FROM trade_listings WHERE demo_seed_key IS NOT NULL').get().count,
    historicalSampleMatches: db.prepare('SELECT count(*) AS count FROM call_matches cm JOIN trade_listings l ON l.id = cm.listing_id WHERE l.demo_seed_key IS NOT NULL').get().count,
    activity: db.prepare(`SELECT date(started_at, '+5 hours', '+30 minutes') AS day, count(*) AS count FROM calls
      WHERE started_at >= datetime('now', '-7 days') GROUP BY day ORDER BY day`).all(),
    languages: db.prepare('SELECT language, count(*) AS count FROM calls WHERE language IS NOT NULL GROUP BY language ORDER BY count DESC').all()
    });
  });
  app.post('/api/admin/parse', (req, res) => {
    if (typeof req.body?.text !== 'string' || !req.body.text.trim() || req.body.text.length > 4000) return res.status(400).json({ error: 'Enter up to 4,000 characters to extract.' });
    res.json({ ...extractFarmerData(req.body.text), method: 'Structured language parser' });
  });
  app.post('/api/admin/listings', (req, res) => {
    let listing;
    try { listing = validateListing(req.body || {}); } catch (error) { return res.status(400).json({ error: error.message }); }
    const key = req.get('idempotency-key');
    if (!key || !/^[a-zA-Z0-9-]{8,100}$/.test(key)) return res.status(400).json({ error: 'A valid submission key is required.' });
    const existing = db.prepare('SELECT listing_id FROM workspace_submissions WHERE request_key = ?').get(key);
    if (existing) return res.json({ listing: listings().find(l => l.id === existing.listing_id), duplicate: true });
    const now = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    let id;
    try {
      const participant = db.prepare(`INSERT INTO market_participants (type,name,phone,location,latitude,longitude,verified,active,created_at,updated_at)
        VALUES (?,?,?,?,?,?,0,1,?,?)`).run(listing.side === 'SELL' ? 'SELLER' : 'BUYER', listing.name, listing.phone, listing.location, listing.latitude, listing.longitude, now, now);
      const result = db.prepare(`INSERT INTO trade_listings (participant_id,side,commodity,quantity_kg,price_per_kg,location,latitude,longitude,active,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,1,?,?)`).run(participant.lastInsertRowid, listing.side, listing.commodity, listing.quantityKg, listing.pricePerKg, listing.location, listing.latitude, listing.longitude, now, now);
      id = Number(result.lastInsertRowid);
      db.prepare('INSERT INTO workspace_submissions VALUES (?,?)').run(key, id);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    adminEvents.publish({ type: 'marketplace-update' });
    res.status(201).json({ listing: listings().find(l => l.id === id) });
  });
  app.patch('/api/admin/listings/:id', (req, res) => {
    if (typeof req.body?.active !== 'boolean') return res.status(400).json({ error: 'Active must be true or false.' });
    const result = db.prepare('UPDATE trade_listings SET active = ?, updated_at = ? WHERE id = ? AND demo_seed_key IS NULL')
      .run(req.body.active ? 1 : 0, new Date().toISOString(), req.params.id);
    if (!result.changes) return res.status(404).json({ error: 'Listing not found.' });
    adminEvents.publish({ type: 'marketplace-update' });
    res.json({ ok: true });
  });
  app.get('/api/admin/listings/:id/matches', (req, res) => {
    const listing = listings().find(l => String(l.id) === req.params.id);
    if (!listing) return res.status(404).json({ error: 'Listing not found.' });
    res.json({ matches: listing.active ? matchesFor(listing) : [] });
  });
  app.get('/api/admin/mandi', async (req, res, next) => {
    if (typeof req.query.commodity !== 'string' || typeof req.query.location !== 'string' || !req.query.commodity.trim() || !req.query.location.trim() || req.query.commodity.length > 80 || req.query.location.length > 120) return res.status(400).json({ error: 'Enter a commodity and location.' });
    try { res.json(await marketDataService.getMandiRates({ commodity: req.query.commodity.trim(), location: req.query.location.trim(), limit: 5 })); } catch (error) { next(error); }
  });
  app.use('/api/admin', (error, _req, res, _next) => {
    res.status(error.status === 413 ? 413 : error instanceof SyntaxError ? 400 : 500)
      .json({ error: error.status === 413 ? 'Request is too large.' : error instanceof SyntaxError ? 'Invalid JSON.' : 'The request could not be completed. Please retry.' });
  });
}
module.exports = { mountWorkspaceApi, validateListing };
