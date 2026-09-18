const assert = require("node:assert/strict");
const test = require("node:test");

const { createCallRepository } = require("../src/call-repository");
const { openDatabase } = require("../src/db");
const { createMarketplaceRepository } = require("../src/marketplace-repository");
const { rankMatches } = require("../src/matching");
const {
  callerNumberFromStart,
  createExotelSmsProvider,
  createSmsDeliveryService,
  estimateSmsSegments,
  formatTop5Sms,
  normalizeIndianPhoneNumber
} = require("../src/sms");
const { createFast2SmsProvider } = require("../src/fast2sms");

function fixture({ intent = "SELL", language = "gu-IN", callerNumber = "+919876543210", withMatches = true } = {}) {
  const db = openDatabase(":memory:");
  const calls = createCallRepository(db);
  const marketplace = createMarketplaceRepository(db, { includeDemo: true });
  marketplace.seedDemoMarketplace({ demoBuyerPhone: "+919111111111" });
  const call = calls.createCall({ callSid: `CA-sms-${intent}-${Math.random()}`, callerNumber });
  const commodity = intent === "SELL" ? "Tomato" : "Onion";
  calls.updateCall(call.call_sid, { intent, language, commodity, quantityKg: 500, location: "Vadodara" });
  if (withMatches) {
    const side = intent === "SELL" ? "BUY" : "SELL";
    const matches = rankMatches(
      { intent, commodity, quantityKg: 500, location: "Vadodara" },
      marketplace.getEligibleListings(side, commodity)
    );
    calls.replaceCallMatches(call.call_sid, matches);
  }
  return { db, calls, call: calls.getCallBySid(call.call_sid) };
}

function acceptedProvider(overrides = {}) {
  const sent = [];
  return {
    sent,
    async resolveCallerNumber() { return overrides.resolvedCaller || null; },
    async sendSMS(message) {
      sent.push(message);
      return overrides.result || {
        ok: true,
        status: "SENT",
        providerMessageId: "SM-test-1",
        providerResponse: { SMSMessage: { Sid: "SM-test-1", Status: "queued" } }
      };
    }
  };
}

test("caller numbers are taken only from supported Exotel caller fields and normalized to Indian E.164", () => {
  assert.equal(normalizeIndianPhoneNumber("09876543210"), "+919876543210");
  assert.equal(normalizeIndianPhoneNumber("91 98765 43210"), "+919876543210");
  assert.equal(callerNumberFromStart({ from: "9876543210" }), "+919876543210");
  assert.equal(callerNumberFromStart({ caller_number: "+919876543210" }), "+919876543210");
  assert.equal(callerNumberFromStart({ caller_id: "+919999999999" }), null);
  assert.equal(normalizeIndianPhoneNumber("not-a-number"), null);
});

test("SELL sends exact persisted Top-5 buyers to the caller, never the buyer phone", async t => {
  const { db, calls, call } = fixture();
  t.after(() => db.close());
  const frozenIds = calls.getCallMatches(call.id).map(match => match.id);
  const provider = acceptedProvider();
  const service = createSmsDeliveryService({ repository: calls, provider });
  const delivery = await service.deliverTop5({ callSid: call.call_sid, intent: "SELL", language: "gu-IN" });

  assert.equal(delivery.status, "SENT");
  assert.equal(provider.sent.length, 1);
  assert.equal(provider.sent[0].to, "+919876543210");
  assert.notEqual(provider.sent[0].to, "+919111111111");
  assert.match(provider.sent[0].text, /ટોચના ખરીદદારો/);
  assert.match(provider.sent[0].text, /★1\./);
  assert.doesNotMatch(provider.sent[0].text, /\+919111111111/);
  assert.deepEqual(calls.getSmsDeliveryContext(call.call_sid).request.matches.map(item => item.call_match_id), frozenIds);
});

test("BUY sends persisted sellers and preserves language", async t => {
  const { db, calls, call } = fixture({ intent: "BUY", language: "hi-IN" });
  t.after(() => db.close());
  const provider = acceptedProvider();
  const service = createSmsDeliveryService({ repository: calls, provider });
  const delivery = await service.deliverTop5({ callSid: call.call_sid, intent: "BUY", language: "hi-IN" });

  assert.equal(delivery.message_type, "TOP5_SELLERS");
  assert.equal(delivery.language, "hi-IN");
  assert.match(provider.sent[0].text, /शीर्ष विक्रेता/);
  assert.equal(calls.getSmsDeliveryContext(call.call_sid).matches.every(match => match.side === "SELL"), true);
});

test("Hindi and Gujarati compact formatters include all five and the recommendation", t => {
  const hindiFixture = fixture({ language: "hi-IN" });
  const gujaratiFixture = fixture({ language: "gu-IN" });
  t.after(() => hindiFixture.db.close());
  t.after(() => gujaratiFixture.db.close());
  for (const [language, item, phrase] of [
    ["hi-IN", hindiFixture, "शीर्ष खरीदार"],
    ["gu-IN", gujaratiFixture, "ટોચના ખરીદદારો"]
  ]) {
    const formatted = formatTop5Sms({
      call: item.calls.getCallBySid(item.call.call_sid),
      matches: item.calls.getCallMatches(item.call.id),
      language
    });
    assert.match(formatted.text, new RegExp(phrase));
    assert.match(formatted.text, /★1\./);
    assert.match(formatted.text, /5\./);
    assert.equal(formatted.matchCount, 5);
    assert.equal(estimateSmsSegments(formatted.text).encoding, "unicode");
  }
});

test("repeated delivery is idempotent and never sends a duplicate", async t => {
  const { db, calls, call } = fixture();
  t.after(() => db.close());
  const provider = acceptedProvider();
  const service = createSmsDeliveryService({ repository: calls, provider });
  const first = await service.deliverTop5({ callSid: call.call_sid, intent: "SELL", language: "gu-IN" });
  const second = await service.deliverTop5({ callSid: call.call_sid, intent: "SELL", language: "gu-IN" });
  assert.equal(first.status, "SENT");
  assert.equal(second.status, "SENT");
  assert.equal(second.duplicate, true);
  assert.equal(provider.sent.length, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sms_deliveries").get().count, 1);
});

test("missing caller number uses CallSid lookup and persists the resolved caller", async t => {
  const { db, calls, call } = fixture({ callerNumber: null });
  t.after(() => db.close());
  const provider = acceptedProvider({ resolvedCaller: "+919123456789" });
  const service = createSmsDeliveryService({ repository: calls, provider });
  await service.deliverTop5({ callSid: call.call_sid, intent: "SELL", language: "gu-IN" });
  assert.equal(provider.sent[0].to, "+919123456789");
  assert.equal(calls.getCallBySid(call.call_sid).caller_number, "+919123456789");
});

test("unresolvable caller number blocks delivery without calling the SMS API", async t => {
  const { db, calls, call } = fixture({ callerNumber: null });
  t.after(() => db.close());
  const provider = acceptedProvider();
  const service = createSmsDeliveryService({ repository: calls, provider });
  const delivery = await service.deliverTop5({ callSid: call.call_sid, intent: "SELL", language: "gu-IN" });
  assert.equal(delivery.status, "BLOCKED_CONFIGURATION");
  assert.equal(delivery.error_code, "CALLER_NUMBER_UNAVAILABLE");
  assert.equal(provider.sent.length, 0);
});

test("missing Fast2SMS API key records BLOCKED_CONFIGURATION", async t => {
  const { db, calls, call } = fixture();
  t.after(() => db.close());
  const provider = createFast2SmsProvider({
    env: {},
    fetchImpl: async () => { throw new Error("must not fetch"); },
    logger: { log() {} }
  });
  const service = createSmsDeliveryService({ repository: calls, provider });
  const delivery = await service.deliverTop5({ callSid: call.call_sid, intent: "SELL", language: "gu-IN" });
  assert.equal(delivery.status, "BLOCKED_CONFIGURATION");
  assert.equal(delivery.error_code, "MISSING_FAST2SMS_CONFIGURATION");
  assert.equal(delivery.provider, "FAST2SMS");
});

test("Press 3 delivery persists Fast2SMS acceptance for Top-5 sellers", async t => {
  const { db, calls, call } = fixture({ intent: "BUY", language: "hi-IN" });
  t.after(() => db.close());
  const provider = createFast2SmsProvider({
    env: { FAST2SMS_API_KEY: "test-key" },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ return: true, request_id: "FAST-REQ-1" })
    }),
    logger: { log() {} }
  });
  const service = createSmsDeliveryService({ repository: calls, provider });
  const delivery = await service.deliverTop5({ callSid: call.call_sid, intent: "BUY", language: "hi-IN" });
  assert.equal(delivery.status, "SENT");
  assert.equal(delivery.provider, "FAST2SMS");
  assert.equal(delivery.provider_message_id, "FAST-REQ-1");
  assert.equal(delivery.message_type, "TOP5_SELLERS");
});

test("provider failure is stored and does not alter the voice call state", async t => {
  const { db, calls, call } = fixture();
  t.after(() => db.close());
  const provider = acceptedProvider({
    result: { ok: false, status: "FAILED", errorCode: "EXOTEL_HTTP_400", errorMessage: "Template mismatch" }
  });
  const service = createSmsDeliveryService({ repository: calls, provider });
  const delivery = await service.deliverTop5({ callSid: call.call_sid, intent: "SELL", language: "gu-IN" });
  assert.equal(delivery.status, "FAILED");
  assert.equal(delivery.error_message, "Template mismatch");
  assert.equal(calls.getCallBySid(call.call_sid).status, "ACTIVE");
});

test("zero stored matches never invokes the SMS provider", async t => {
  const { db, calls, call } = fixture({ withMatches: false });
  t.after(() => db.close());
  const provider = acceptedProvider();
  const service = createSmsDeliveryService({ repository: calls, provider });
  const result = await service.deliverTop5({ callSid: call.call_sid, intent: "SELL", language: "hi-IN" });
  assert.equal(result.errorCode, "NO_STORED_MATCHES");
  assert.equal(provider.sent.length, 0);
});

test("Exotel provider uses the official SMS endpoint and DLT form fields", async () => {
  let request;
  const provider = createExotelSmsProvider({
    env: {
      EXOTEL_API_KEY: "key",
      EXOTEL_API_TOKEN: "token",
      EXOTEL_ACCOUNT_SID: "sid",
      EXOTEL_SUBDOMAIN: "api.exotel.com",
      EXOTEL_SMS_FROM: "KISAN",
      EXOTEL_DLT_ENTITY_ID: "entity",
      EXOTEL_DLT_TEMPLATE_ID_GU: "template-gu"
    },
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200, text: async () => JSON.stringify({ SMSMessage: { Sid: "SM1", Status: "queued" } }) };
    }
  });
  const result = await provider.sendSMS({
    to: "+919876543210", text: "કિસાનસેતુ", language: "gu-IN", callId: 7, idempotencyKey: "TOP5_MATCHES:7"
  });
  assert.equal(result.status, "SENT");
  assert.equal(request.url, "https://api.exotel.com/v1/Accounts/sid/Sms/send");
  assert.equal(request.options.body.get("DltEntityId"), "entity");
  assert.equal(request.options.body.get("DltTemplateId"), "template-gu");
  assert.equal(request.options.body.get("To"), "+919876543210");
  assert.equal(request.options.body.get("EncodingType"), "unicode");
});

test("Exotel Call Details fallback resolves Call.From by CallSid", async () => {
  let requestedUrl;
  const provider = createExotelSmsProvider({
    env: {
      EXOTEL_API_KEY: "key",
      EXOTEL_API_TOKEN: "token",
      EXOTEL_ACCOUNT_SID: "sid",
      EXOTEL_SUBDOMAIN: "api.exotel.com"
    },
    fetchImpl: async url => {
      requestedUrl = url;
      return { ok: true, json: async () => ({ Call: { From: "09876543210" } }) };
    }
  });
  assert.equal(await provider.resolveCallerNumber("CA-123"), "+919876543210");
  assert.equal(requestedUrl, "https://api.exotel.com/v1/Accounts/sid/Calls/CA-123?details=true");
});

test("Malayalam and Kannada have native SMS formatters while unsupported languages fall back to Hindi", t => {
  const item = fixture();
  t.after(() => item.db.close());
  const call = item.calls.getCallBySid(item.call.call_sid);
  const matches = item.calls.getCallMatches(item.call.id);
  assert.match(formatTop5Sms({ call, matches, language: "ml-IN" }).text, /മികച്ച വാങ്ങുന്നവർ/);
  assert.match(formatTop5Sms({ call, matches, language: "kn-IN" }).text, /ಅಗ್ರ ಖರೀದಿದಾರರು/);
  assert.match(formatTop5Sms({ call, matches, language: "mr-IN" }).text, /शीर्ष खरीदार/);
});

test("dashboard detail exposes masked recipient and terminal SMS status", async t => {
  const { db, calls, call } = fixture();
  t.after(() => db.close());
  const service = createSmsDeliveryService({ repository: calls, provider: acceptedProvider() });
  await service.deliverTop5({ callSid: call.call_sid, intent: "SELL", language: "gu-IN" });
  const detail = calls.getCallDetail(call.id);
  assert.equal(detail.sms_status, "SENT");
  assert.equal(detail.sms_delivery.recipient_masked, "+91********10");
  assert.equal("recipient" in detail.sms_delivery, true);
  assert.equal(detail.sms_delivery.recipient, undefined);
  assert.ok(detail.sms_delivery.sent_at);
});
