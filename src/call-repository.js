const LANGUAGE_METADATA_COLUMNS = Object.freeze({
  detectedLanguage: "detected_language",
  responseLanguage: "response_language",
  languageFallbackReason: "language_fallback_reason"
});

const CALL_FIELD_COLUMNS = Object.freeze({
  streamSid: "stream_sid",
  callerNumber: "caller_number",
  intent: "intent",
  language: "language",
  languageConfidence: "language_confidence",
  commodity: "commodity",
  quantityKg: "quantity_kg",
  location: "location",
  status: "status",
  currentStage: "current_stage",
  selectedMandi: "selected_mandi",
  matchedBuyerId: "matched_buyer_id",
  buyerConnectionRequested: "buyer_connection_requested",
  buyerConnectionStatus: "buyer_connection_status",
  endedAt: "ended_at",
  durationSeconds: "duration_seconds"
});

function nowIso() {
  return new Date().toISOString();
}

function parseJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

function maskedRecipient(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 2 ? `+91********${digits.slice(-2)}` : null;
}

function createCallRepository(db) {
  const callWithLanguageSql = `
    SELECT c.*, metadata.detected_language,
      COALESCE(metadata.response_language, 'hi-IN') AS response_language,
      metadata.language_fallback_reason
    FROM calls c
    LEFT JOIN call_language_metadata metadata ON metadata.call_id = c.id
  `;
  const findBySidStatement = db.prepare(`${callWithLanguageSql} WHERE c.call_sid = ?`);
  const findByIdStatement = db.prepare(`${callWithLanguageSql} WHERE c.id = ?`);

  function getCallBySid(callSid) {
    return callSid ? findBySidStatement.get(String(callSid)) || null : null;
  }

  function createCall({ callSid, streamSid = null, callerNumber = null, startedAt = nowIso(), status = "ACTIVE", currentStage = "WELCOME" }) {
    if (!callSid) return null;
    const timestamp = nowIso();
    db.prepare(`
      INSERT INTO calls (
        call_sid, stream_sid, caller_number, started_at, status, current_stage, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(call_sid) DO UPDATE SET
        stream_sid = COALESCE(excluded.stream_sid, calls.stream_sid),
        caller_number = COALESCE(excluded.caller_number, calls.caller_number),
        updated_at = excluded.updated_at
    `).run(String(callSid), streamSid, callerNumber, startedAt, status, currentStage, timestamp, timestamp);
    const call = getCallBySid(callSid);
    db.prepare(`
      INSERT OR IGNORE INTO call_language_metadata (call_id, response_language, updated_at)
      VALUES (?, 'hi-IN', ?)
    `).run(call.id, timestamp);
    return getCallBySid(callSid);
  }

  function updateCall(callSid, fields = {}) {
    if (!callSid) return null;
    const updates = [];
    const values = [];
    for (const [field, value] of Object.entries(fields)) {
      const column = CALL_FIELD_COLUMNS[field];
      if (!column || value === undefined) continue;
      updates.push(`${column} = ?`);
      values.push(field === "buyerConnectionRequested" ? (value ? 1 : 0) : value);
    }
    const metadataUpdates = [];
    const metadataValues = [];
    for (const [field, value] of Object.entries(fields)) {
      const column = LANGUAGE_METADATA_COLUMNS[field];
      if (!column || value === undefined) continue;
      metadataUpdates.push(`${column} = ?`);
      metadataValues.push(value);
    }
    if (!updates.length && !metadataUpdates.length) return getCallBySid(callSid);
    const timestamp = nowIso();
    if (updates.length) {
      updates.push("updated_at = ?");
      values.push(timestamp, String(callSid));
      db.prepare(`UPDATE calls SET ${updates.join(", ")} WHERE call_sid = ?`).run(...values);
    }
    const call = getCallBySid(callSid);
    if (call && metadataUpdates.length) {
      db.prepare(`
        INSERT OR IGNORE INTO call_language_metadata (call_id, response_language, updated_at)
        VALUES (?, 'hi-IN', ?)
      `).run(call.id, timestamp);
      metadataUpdates.push("updated_at = ?");
      metadataValues.push(timestamp, call.id);
      db.prepare(`UPDATE call_language_metadata SET ${metadataUpdates.join(", ")} WHERE call_id = ?`)
        .run(...metadataValues);
    }
    return getCallBySid(callSid);
  }

  function addTranscript(callSid, text, language = null, timestamp = nowIso()) {
    const call = getCallBySid(callSid);
    if (!call || !String(text || "").trim()) return null;
    const result = db.prepare(`
      INSERT INTO call_transcripts (call_id, text, language, timestamp)
      VALUES (?, ?, ?, ?)
    `).run(call.id, String(text).trim(), language, timestamp);
    return db.prepare("SELECT * FROM call_transcripts WHERE id = ?").get(result.lastInsertRowid);
  }

  function replaceMandiTransaction(callId, commodity, location, rates, timestamp) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("DELETE FROM mandi_results WHERE call_id = ?").run(callId);
      const insert = db.prepare(`
        INSERT INTO mandi_results (
          call_id, commodity, location, mandi, spoken_name, modal_price, result_order, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertMetadata = db.prepare(`
        INSERT INTO mandi_result_metadata (
          mandi_result_id, state, district, min_price, max_price, unit,
          observed_at, source, is_fallback
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      rates.forEach((rate, index) => {
        const result = insert.run(
          callId, commodity, location, rate.mandi, rate.spokenName || null,
          rate.modal ?? rate.modalPrice, index + 1, timestamp
        );
        insertMetadata.run(
          result.lastInsertRowid,
          rate.state || null,
          rate.district || location || null,
          rate.minPrice ?? null,
          rate.maxPrice ?? null,
          rate.unit || null,
          rate.observedAt || null,
          rate.source || null,
          rate.isFallback ? 1 : 0
        );
      });
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function replaceMandiResults(callSid, commodity, location, rates = []) {
    const call = getCallBySid(callSid);
    if (!call) return [];
    replaceMandiTransaction(call.id, commodity, location, rates, nowIso());
    return getStoredMandiResults(call.id);
  }

  function getStoredMandiResults(callId) {
    return db.prepare(`
      SELECT mr.*, metadata.state, metadata.district, metadata.min_price,
        metadata.max_price, metadata.unit, metadata.observed_at,
        metadata.source, metadata.is_fallback
      FROM mandi_results mr
      LEFT JOIN mandi_result_metadata metadata ON metadata.mandi_result_id = mr.id
      WHERE mr.call_id = ?
      ORDER BY mr.result_order, mr.id
    `).all(callId);
  }

  function replaceCallMatches(callSid, matches = []) {
    const call = getCallBySid(callSid);
    if (!call) return [];
    const timestamp = nowIso();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("DELETE FROM call_matches WHERE call_id = ?").run(call.id);
      const insert = db.prepare(`
        INSERT INTO call_matches (
          call_id, listing_id, participant_id, rank, score, price_score,
          distance_score, quantity_score, verification_score, distance_km,
          matched_quantity_kg, is_recommended, reason, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const match of matches) {
        insert.run(
          call.id, match.listingId, match.participantId, match.rank, match.score,
          match.priceScore, match.distanceScore, match.quantityScore,
          match.verificationScore, match.distanceKm, match.matchedQuantityKg,
          match.isRecommended ? 1 : 0, match.reason, timestamp
        );
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return getCallMatches(call.id);
  }

  function getCallMatches(callId) {
    return db.prepare(`
      SELECT
        cm.id, cm.call_id, cm.listing_id, cm.participant_id, cm.rank, cm.score,
        cm.price_score, cm.distance_score, cm.quantity_score,
        cm.verification_score, cm.distance_km, cm.matched_quantity_kg,
        cm.is_recommended, cm.reason, cm.created_at,
        p.type AS participant_type, p.name, p.phone, p.verified,
        l.side, l.commodity, l.quantity_kg, l.price_per_kg, l.location
      FROM call_matches cm
      JOIN market_participants p ON p.id = cm.participant_id
      JOIN trade_listings l ON l.id = cm.listing_id
      WHERE cm.call_id = ?
      ORDER BY cm.rank
    `).all(callId).map(match => ({ ...match }));
  }

  function getSmsRequest(callId) {
    const request = db.prepare(`
      SELECT id, call_id, match_type, language, status, created_at, updated_at
      FROM sms_requests
      WHERE call_id = ?
    `).get(callId);
    if (!request) return null;
    const referencedMatches = db.prepare(`
      SELECT call_match_id, match_rank
      FROM sms_request_matches
      WHERE sms_request_id = ?
      ORDER BY match_rank
    `).all(request.id).map(row => ({ ...row }));
    return { ...request, matches: referencedMatches };
  }

  function getSmsDelivery(callId) {
    const delivery = db.prepare(`
      SELECT * FROM sms_deliveries WHERE call_id = ?
    `).get(callId);
    if (!delivery) return null;
    return {
      ...delivery,
      provider_response: parseJson(delivery.provider_response_json)
    };
  }

  function getSmsDeliveryContext(callSid) {
    const call = getCallBySid(callSid);
    if (!call) return null;
    const request = getSmsRequest(call.id);
    if (!request) return null;
    const matches = db.prepare(`
      SELECT
        cm.id, cm.call_id, cm.listing_id, cm.participant_id, cm.rank, cm.score,
        cm.price_score, cm.distance_score, cm.quantity_score,
        cm.verification_score, cm.distance_km, cm.matched_quantity_kg,
        cm.is_recommended, cm.reason, cm.created_at,
        p.type AS participant_type, p.name, p.verified,
        l.side, l.commodity, l.quantity_kg, l.price_per_kg, l.location
      FROM sms_request_matches srm
      JOIN call_matches cm ON cm.id = srm.call_match_id
      JOIN market_participants p ON p.id = cm.participant_id
      JOIN trade_listings l ON l.id = cm.listing_id
      WHERE srm.sms_request_id = ?
      ORDER BY srm.match_rank
    `).all(request.id).map(match => ({ ...match }));
    return { call: { ...call }, request, matches, delivery: getSmsDelivery(call.id) };
  }

  function createSmsRequest(callSid, matchType, language = null) {
    const call = getCallBySid(callSid);
    if (!call || !["BUYERS", "SELLERS"].includes(matchType)) return null;
    const matches = getCallMatches(call.id);
    if (!matches.length) return null;
    const timestamp = nowIso();
    let created = false;
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = db.prepare(`
        INSERT INTO sms_requests (
          call_id, match_type, language, status, created_at, updated_at
        ) VALUES (?, ?, ?, 'PENDING', ?, ?)
        ON CONFLICT(call_id) DO NOTHING
      `).run(call.id, matchType, language, timestamp, timestamp);
      created = result.changes === 1;
      const request = db.prepare("SELECT id FROM sms_requests WHERE call_id = ?").get(call.id);
      const attachMatch = db.prepare(`
        INSERT OR IGNORE INTO sms_request_matches (sms_request_id, call_match_id, match_rank)
        VALUES (?, ?, ?)
      `);
      for (const match of matches) attachMatch.run(request.id, match.id, match.rank);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return { created, request: getSmsRequest(call.id) };
  }

  function createSmsDelivery({
    smsRequestId,
    callId,
    recipient = null,
    language = null,
    messageType,
    messageText,
    provider = "EXOTEL",
    idempotencyKey
  }) {
    const timestamp = nowIso();
    db.prepare(`
      INSERT INTO sms_deliveries (
        sms_request_id, call_id, recipient, language, message_type, message_text,
        provider, status, requested_at, updated_at, idempotency_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)
      ON CONFLICT(idempotency_key) DO NOTHING
    `).run(
      smsRequestId, callId, recipient, language, messageType, messageText,
      provider, timestamp, timestamp, idempotencyKey
    );
    return getSmsDelivery(callId);
  }

  function claimSmsDelivery(deliveryId) {
    const timestamp = nowIso();
    db.prepare(`
      UPDATE sms_deliveries
      SET status = 'SENDING', updated_at = ?
      WHERE id = ? AND status = 'PENDING'
    `).run(timestamp, deliveryId);
    return db.prepare("SELECT * FROM sms_deliveries WHERE id = ?").get(deliveryId) || null;
  }

  function finishSmsDelivery(deliveryId, {
    status,
    providerMessageId = null,
    providerResponse = null,
    errorCode = null,
    errorMessage = null
  }) {
    const allowed = ["SENT", "FAILED", "BLOCKED_CONFIGURATION"];
    if (!allowed.includes(status)) throw new Error(`Invalid terminal SMS status: ${status}`);
    const timestamp = nowIso();
    db.prepare(`
      UPDATE sms_deliveries
      SET status = ?, provider_message_id = ?, provider_response_json = ?,
          error_code = ?, error_message = ?, sent_at = ?, updated_at = ?
      WHERE id = ? AND status IN ('PENDING', 'SENDING')
    `).run(
      status,
      providerMessageId,
      providerResponse === null || providerResponse === undefined ? null : JSON.stringify(providerResponse),
      errorCode,
      errorMessage,
      status === "SENT" ? timestamp : null,
      timestamp,
      deliveryId
    );
    const delivery = db.prepare("SELECT * FROM sms_deliveries WHERE id = ?").get(deliveryId) || null;
    if (delivery && status === "SENT") {
      db.prepare("UPDATE sms_requests SET status = 'SENT', updated_at = ? WHERE id = ?")
        .run(timestamp, delivery.sms_request_id);
    } else if (delivery && status === "FAILED") {
      db.prepare("UPDATE sms_requests SET status = 'FAILED', updated_at = ? WHERE id = ?")
        .run(timestamp, delivery.sms_request_id);
    }
    return delivery ? { ...delivery, provider_response: parseJson(delivery.provider_response_json) } : null;
  }

  function addEvent(callSid, eventType, payload = null, createdAt = nowIso()) {
    const call = getCallBySid(callSid);
    if (!call || !eventType) return null;
    const result = db.prepare(`
      INSERT INTO call_events (call_id, event_type, payload_json, created_at)
      VALUES (?, ?, ?, ?)
    `).run(call.id, eventType, payload === null ? null : JSON.stringify(payload), createdAt);
    const event = db.prepare("SELECT * FROM call_events WHERE id = ?").get(result.lastInsertRowid);
    return { ...event, payload: parseJson(event.payload_json) };
  }

  function finishCall(callSid, status, endedAt = nowIso(), fields = {}) {
    const call = getCallBySid(callSid);
    if (!call) return null;
    const started = Date.parse(call.started_at);
    const ended = Date.parse(endedAt);
    const durationSeconds = Number.isFinite(started) && Number.isFinite(ended)
      ? Math.max(0, Math.round((ended - started) / 1000))
      : null;
    return updateCall(callSid, { ...fields, status, endedAt, durationSeconds });
  }

  function getSummary() {
    const summary = db.prepare(`
      SELECT
        COUNT(*) AS total_calls,
        COALESCE(SUM(CASE WHEN intent = 'SELL' THEN 1 ELSE 0 END), 0) AS sell_requests,
        COALESCE(SUM(CASE WHEN intent = 'BUY' THEN 1 ELSE 0 END), 0) AS buy_requests,
        COALESCE(SUM(CASE WHEN buyer_connection_requested = 1 THEN 1 ELSE 0 END), 0) AS buyer_connections,
        COALESCE(SUM(CASE WHEN ended_at IS NULL THEN 1 ELSE 0 END), 0) AS active_calls,
        (SELECT COUNT(*) FROM call_matches) AS matches_generated,
        COALESCE(ROUND(
          CAST((SELECT COUNT(*) FROM call_matches) AS REAL) /
          NULLIF((SELECT COUNT(DISTINCT call_id) FROM call_events WHERE event_type = 'MATCHES_GENERATED'), 0),
          2
        ), 0) AS average_matches_per_request,
        (
          SELECT COUNT(*)
          FROM (
            SELECT DISTINCT event_calls.call_id
            FROM call_events event_calls
            WHERE event_calls.event_type = 'MATCHES_GENERATED'
              AND NOT EXISTS (
                SELECT 1 FROM call_matches cm WHERE cm.call_id = event_calls.call_id
              )
          )
        ) AS requests_with_no_match
      FROM calls
    `).get();
    return { ...summary };
  }

  function listCalls({ limit = 100 } = {}) {
    const safeLimit = Math.min(500, Math.max(1, Number(limit) || 100));
    return db.prepare(`
      SELECT
        c.*,
        metadata.detected_language,
        COALESCE(metadata.response_language, 'hi-IN') AS response_language,
        metadata.language_fallback_reason,
        CASE WHEN sr.id IS NULL THEN 0 ELSE 1 END AS sms_requested,
        COALESCE(sd.status, sr.status) AS sms_status,
        sr.match_type AS sms_match_type,
        sr.created_at AS sms_requested_at,
        sd.sent_at AS sms_sent_at
      FROM calls c
      LEFT JOIN call_language_metadata metadata ON metadata.call_id = c.id
      LEFT JOIN sms_requests sr ON sr.call_id = c.id
      LEFT JOIN sms_deliveries sd ON sd.call_id = c.id
      ORDER BY c.started_at DESC, c.id DESC
      LIMIT ?
    `).all(safeLimit)
      .map(call => ({ ...call }));
  }

  function getCallDetail(id) {
    const call = findByIdStatement.get(Number(id));
    if (!call) return null;
    const transcripts = db.prepare("SELECT * FROM call_transcripts WHERE call_id = ? ORDER BY timestamp, id").all(call.id);
    const mandiResults = getStoredMandiResults(call.id);
    const matches = getCallMatches(call.id);
    const smsRequest = getSmsRequest(call.id);
    const smsDelivery = getSmsDelivery(call.id);
    const adminSmsDelivery = smsDelivery ? {
      ...smsDelivery,
      recipient: undefined,
      recipient_masked: maskedRecipient(smsDelivery.recipient),
      provider_response: undefined,
      provider_response_json: undefined
    } : null;
    const events = db.prepare("SELECT * FROM call_events WHERE call_id = ? ORDER BY created_at, id").all(call.id)
      .map(event => ({ ...event, payload: parseJson(event.payload_json) }));
    return {
      ...call,
      marketplace_listing: db.prepare(`SELECT l.id, l.active, l.side FROM voice_call_listings v
        JOIN trade_listings l ON l.id = v.listing_id WHERE v.call_id = ?`).get(call.id) || null,
      sms_requested: smsRequest ? 1 : 0,
      sms_status: smsDelivery?.status || smsRequest?.status || null,
      sms_requested_at: smsRequest?.created_at || null,
      sms_sent_at: smsDelivery?.sent_at || null,
      sms_request: smsRequest,
      sms_delivery: adminSmsDelivery,
      transcripts,
      mandi_results: mandiResults,
      matches,
      events
    };
  }

  return {
    addEvent,
    addTranscript,
    createSmsRequest,
    createSmsDelivery,
    createCall,
    claimSmsDelivery,
    finishSmsDelivery,
    finishCall,
    getCallBySid,
    getCallDetail,
    getCallMatches,
    getSummary,
    getSmsRequest,
    getSmsDelivery,
    getSmsDeliveryContext,
    listCalls,
    replaceMandiResults,
    replaceCallMatches,
    updateCall
  };
}

module.exports = { createCallRepository };
