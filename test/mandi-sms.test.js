const assert = require("node:assert/strict");
const test = require("node:test");

const { formatTop5MandiSms, sendMandiRatesSmsOnce } = require("../src/mandi-sms");

function rates() {
  return Array.from({ length: 6 }, (_, index) => ({
    rank: index + 1,
    isRecommended: index === 0,
    mandi: `Official Mandi ${index + 1}`,
    district: index < 2 ? "Ahmedabad" : "Anand",
    modalPrice: 2200 + index * 25,
    unit: "₹/quintal",
    observedAt: "2026-09-06",
    source: "AGMARKNET / data.gov.in",
    isFallback: false,
    distanceKm: null
  }));
}

test("Top-5 mandi SMS contains official records, provenance and no invented zero distance", () => {
  const formatted = formatTop5MandiSms({ commodity: "Onion", location: "Ahmedabad", rates: rates(), language: "en-IN" });
  assert.equal(formatted.matchCount, 5);
  assert.match(formatted.text, /Official Mandi 1/);
  assert.doesNotMatch(formatted.text, /Official Mandi 6/);
  assert.match(formatted.text, /AGMARKNET \/ data.gov.in/);
  assert.doesNotMatch(formatted.text, /0 km/);
});

test("mandi SMS headings are native for all supported response languages", () => {
  for (const language of ["hi-IN", "gu-IN", "mr-IN", "bn-IN", "ta-IN", "te-IN", "kn-IN", "ml-IN", "pa-IN", "od-IN", "en-IN"]) {
    const formatted = formatTop5MandiSms({ commodity: "Onion", location: "Ahmedabad", rates: rates(), language });
    assert.ok(formatted?.text.length > 50, language);
  }
});

test("Press 2 delivery uses caller number, Fast2SMS provider and is idempotent after success", async () => {
  const sent = [];
  const provider = { async sendSMS(payload) { sent.push(payload); return { status: "SENT", providerMessageId: "request-1" }; } };
  const session = { callId: 7, mandiSmsSent: false, mandiSmsSending: false };
  const first = await sendMandiRatesSmsOnce({
    session, provider, callerNumber: "+919876543210", commodity: "Onion", location: "Ahmedabad", rates: rates(), language: "gu-IN",
    logger: { log() {} }
  });
  const second = await sendMandiRatesSmsOnce({
    session, provider, callerNumber: "+919876543210", commodity: "Onion", location: "Ahmedabad", rates: rates(), language: "gu-IN",
    logger: { log() {} }
  });
  assert.equal(first.status, "SENT");
  assert.equal(second.status, "SKIPPED");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "+919876543210");
  assert.equal(sent[0].idempotencyKey, "TOP5_MANDIS:7");
});

test("Fast2SMS failure remains isolated from the call helper", async () => {
  const session = { mandiSmsSent: false, mandiSmsSending: false };
  const result = await sendMandiRatesSmsOnce({
    session,
    provider: { async sendSMS() { throw new Error("secret provider failure"); } },
    callerNumber: "9876543210", commodity: "Onion", location: "Ahmedabad", rates: rates(), language: "hi-IN",
    logger: { log() {} }
  });
  assert.equal(result.status, "FAILED");
  assert.equal(session.mandiSmsSent, false);
  assert.equal(session.mandiSmsSending, false);
});

test("mandi SMS refuses missing caller and zero market results", async () => {
  const provider = { async sendSMS() { throw new Error("must not send"); } };
  assert.equal((await sendMandiRatesSmsOnce({ session: {}, provider, callerNumber: null, commodity: "Onion", location: "Ahmedabad", rates: rates() })).errorCode, "CALLER_NUMBER_UNAVAILABLE");
  assert.equal((await sendMandiRatesSmsOnce({ session: {}, provider, callerNumber: "9876543210", commodity: "Onion", location: "Ahmedabad", rates: [] })).errorCode, "NO_MANDI_RESULTS");
});
