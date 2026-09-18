const assert = require("node:assert/strict");
const test = require("node:test");

const { createCallRepository } = require("../src/call-repository");
const { openDatabase } = require("../src/db");
const { createMarketplaceRepository } = require("../src/marketplace-repository");
const { rankMatches } = require("../src/matching");
const {
  STAGES,
  createPendingTop5SmsRequest,
  resolveBuyerConnection,
  resolveFinalMatchAction
} = require("../server");

function fixture() {
  const db = openDatabase(":memory:");
  const calls = createCallRepository(db);
  const marketplace = createMarketplaceRepository(db);
  marketplace.seedDemoMarketplace({ demoBuyerPhone: "+12025550123" });
  const call = calls.createCall({ callSid: "CA-sms-request" });
  const matches = rankMatches(
    { intent: "SELL", commodity: "Tomato", quantityKg: 500, location: "Vadodara" },
    marketplace.getEligibleListings("BUY", "Tomato")
  );
  calls.replaceCallMatches(call.call_sid, matches);
  return { db, calls, call, matches };
}

test("stored marketplace matches can still create a pending BUYERS SMS request", t => {
  const { db, calls, call } = fixture();
  t.after(() => db.close());
  const result = createPendingTop5SmsRequest(call.call_sid, "SELL", "gu-IN", calls);
  assert.equal(result.created, true);
  assert.equal(result.request.match_type, "BUYERS");
  assert.equal(result.request.status, "PENDING");
  assert.equal(resolveBuyerConnection(call.call_sid), null);
});

test("SMS request references the exact stored Top 5 and preserves detected language", t => {
  const { db, calls, call } = fixture();
  t.after(() => db.close());
  const storedMatchIds = calls.getCallMatches(call.id).map(match => match.id);
  const result = createPendingTop5SmsRequest(call.call_sid, "SELL", "gu-IN", calls);
  assert.equal(result.request.language, "gu-IN");
  assert.deepEqual(result.request.matches.map(match => match.call_match_id), storedMatchIds);
  assert.deepEqual(result.request.matches.map(match => match.match_rank), [1, 2, 3, 4, 5]);
});

test("repeated DTMF 3 is idempotent and does not create duplicate requests", t => {
  const { db, calls, call } = fixture();
  t.after(() => db.close());
  const first = createPendingTop5SmsRequest(call.call_sid, "SELL", "hi-IN", calls);
  const second = createPendingTop5SmsRequest(call.call_sid, "SELL", "hi-IN", calls);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.request.id, first.request.id);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sms_requests").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sms_request_matches").get().count, 5);
});

test("dashboard call list and detail reflect requested Yes and Pending status", t => {
  const { db, calls, call } = fixture();
  t.after(() => db.close());
  createPendingTop5SmsRequest(call.call_sid, "SELL", "ml-IN", calls);
  const listItem = calls.listCalls().find(item => item.id === call.id);
  const detail = calls.getCallDetail(call.id);
  assert.equal(listItem.sms_requested, 1);
  assert.equal(listItem.sms_status, "PENDING");
  assert.equal(detail.sms_requested, 1);
  assert.equal(detail.sms_status, "PENDING");
  assert.equal(detail.sms_request.matches.length, 5);
});

test("final keypad routing preserves transfer and maps SELL 2 to mandi SMS and 3 to end", () => {
  assert.equal(resolveFinalMatchAction(STAGES.WAITING_FOR_BUYER_CONNECT, "SELL", "1"), "CONNECT_BUYER");
  assert.equal(resolveFinalMatchAction(STAGES.WAITING_FOR_BUYER_CONNECT, "SELL", "2"), "REQUEST_TOP5_MANDI_SMS");
  assert.equal(resolveFinalMatchAction(STAGES.WAITING_FOR_BUYER_CONNECT, "SELL", "3"), "END_CALL");
  assert.equal(resolveFinalMatchAction(STAGES.WAITING_FOR_MATCH_ACTION, "BUY", "1"), null);
  assert.equal(resolveFinalMatchAction(STAGES.WAITING_FOR_MATCH_ACTION, "BUY", "2"), "END_CALL");
  assert.equal(resolveFinalMatchAction(STAGES.WAITING_FOR_MATCH_ACTION, "BUY", "3"), "REQUEST_TOP5_SMS");
});
