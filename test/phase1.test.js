const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");

const { createAdminEvents } = require("../src/admin-events");
const { mountAdminApi } = require("../src/admin-api");
const { createCallRepository } = require("../src/call-repository");
const { openDatabase } = require("../src/db");

function fixture() {
  const db = openDatabase(":memory:");
  return { db, repository: createCallRepository(db) };
}

test("call persistence creates a genuine active call record", t => {
  const { db, repository } = fixture();
  t.after(() => db.close());
  const call = repository.createCall({
    callSid: "CA-persist-1",
    streamSid: "SM-persist-1",
    startedAt: "2026-08-21T10:00:00.000Z"
  });
  assert.equal(call.call_sid, "CA-persist-1");
  assert.equal(call.stream_sid, "SM-persist-1");
  assert.equal(call.status, "ACTIVE");
  assert.equal(call.ended_at, null);
});

test("call updates persist language, intent, slots, handoff, and terminal timing", t => {
  const { db, repository } = fixture();
  t.after(() => db.close());
  repository.createCall({ callSid: "CA-update-1", startedAt: "2026-08-21T10:00:00.000Z" });
  repository.updateCall("CA-update-1", {
    intent: "SELL", language: "gu-IN", languageConfidence: 0.97,
    commodity: "Tomato", quantityKg: 500, location: "Vadodara",
    currentStage: "WAITING_FOR_BUYER_CONNECT", buyerConnectionRequested: true,
    buyerConnectionStatus: "REQUESTED"
  });
  const call = repository.finishCall("CA-update-1", "COMPLETED", "2026-08-21T10:01:05.000Z");
  assert.equal(call.intent, "SELL");
  assert.equal(call.language, "gu-IN");
  assert.equal(call.quantity_kg, 500);
  assert.equal(call.buyer_connection_requested, 1);
  assert.equal(call.duration_seconds, 65);
  assert.equal(call.status, "COMPLETED");
});

test("detected and response language metadata persist without changing legacy language", t => {
  const { db, repository } = fixture();
  t.after(() => db.close());
  repository.createCall({ callSid: "CA-language-metadata" });
  repository.updateCall("CA-language-metadata", {
    language: "mr-IN",
    detectedLanguage: "mr-IN",
    responseLanguage: "hi-IN",
    languageConfidence: 0.91,
    languageFallbackReason: "response_bundle_unavailable"
  });

  const call = repository.getCallBySid("CA-language-metadata");
  assert.equal(call.language, "mr-IN");
  assert.equal(call.detected_language, "mr-IN");
  assert.equal(call.response_language, "hi-IN");
  assert.equal(call.language_confidence, 0.91);
  assert.equal(call.language_fallback_reason, "response_bundle_unavailable");
  assert.equal(repository.listCalls().at(0).response_language, "hi-IN");
  assert.equal(repository.getCallDetail(call.id).detected_language, "mr-IN");
});

test("mandi result persistence stores the exact calculated rows and order", t => {
  const { db, repository } = fixture();
  t.after(() => db.close());
  repository.createCall({ callSid: "CA-mandi-1" });
  const rates = [
    { mandi: "Vadodara APMC", spokenName: "वडोदरा मंडी", modal: 2300 },
    { mandi: "Padra APMC", spokenName: "पादरा मंडी", modal: 2450 }
  ];
  const stored = repository.replaceMandiResults("CA-mandi-1", "Tomato", "Vadodara", rates);
  assert.deepEqual(stored.map(row => [row.mandi, row.modal_price, row.result_order]), [
    ["Vadodara APMC", 2300, 1], ["Padra APMC", 2450, 2]
  ]);
});

test("admin summary endpoint reports only SQLite call statistics", t => {
  const { db, repository } = fixture();
  t.after(() => db.close());
  repository.createCall({ callSid: "CA-summary-sell" });
  repository.updateCall("CA-summary-sell", { intent: "SELL", buyerConnectionRequested: true });
  repository.createCall({ callSid: "CA-summary-buy" });
  repository.updateCall("CA-summary-buy", { intent: "BUY" });
  repository.finishCall("CA-summary-buy", "COMPLETED");

  const app = express();
  mountAdminApi(app, repository, createAdminEvents());
  const summaryRoute = app._router.stack.find(layer => layer.route?.path === "/api/admin/summary");
  let responseBody;
  summaryRoute.route.stack[0].handle({}, { json(value) { responseBody = value; } });
  assert.deepEqual(responseBody, {
    total_calls: 2, sell_requests: 1, buy_requests: 1,
    buyer_connections: 1, active_calls: 1, matches_generated: 0,
    average_matches_per_request: 0, requests_with_no_match: 0
  });
});

test("call detail retrieval includes transcripts, mandi results, and lifecycle events", t => {
  const { db, repository } = fixture();
  t.after(() => db.close());
  const call = repository.createCall({ callSid: "CA-detail-1" });
  repository.addTranscript("CA-detail-1", "મારે પાંચસો કિલો ટામેટા વેચવા છે", "gu-IN");
  repository.replaceMandiResults("CA-detail-1", "Tomato", "Vadodara", [
    { mandi: "Vadodara APMC", modal: 2300 }
  ]);
  repository.addEvent("CA-detail-1", "CALL_STARTED", { streamSid: "SM-detail-1" });
  const detail = repository.getCallDetail(call.id);
  assert.equal(detail.transcripts.length, 1);
  assert.equal(detail.transcripts[0].language, "gu-IN");
  assert.equal(detail.mandi_results[0].modal_price, 2300);
  assert.equal(detail.events[0].event_type, "CALL_STARTED");
  assert.deepEqual(detail.events[0].payload, { streamSid: "SM-detail-1" });
});
