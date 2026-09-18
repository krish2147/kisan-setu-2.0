const test = require("node:test");
const assert = require("node:assert/strict");

const {
  FAST2SMS_ENDPOINT,
  createFast2SmsProvider,
  formatTop5BuyerSms,
  normalizeFast2SmsPhone,
  sendBuyerMatchesSmsOnce,
  sendFast2SMS
} = require("../src/fast2sms");

function buyers(count = 6) {
  return Array.from({ length: count }, (_, index) => ({
    rank: index + 1,
    name: `Buyer ${index + 1}`,
    location: index % 2 ? "Anand" : "Vadodara",
    pricePerKg: 24 - index
  }));
}

function readySession() {
  return { languageLocked: true, smsSent: false, smsSending: false };
}

function silentLogger() {
  const entries = [];
  return {
    entries,
    log(message) { entries.push(String(message)); },
    error(message) { entries.push(String(message)); }
  };
}

test("Gujarati call generates a Gujarati Top-5 buyer SMS", () => {
  const sms = formatTop5BuyerSms({
    matches: buyers(), commodity: "Onion", localizedCrop: "ડુંગળી", language: "gu-IN"
  });
  assert.equal(sms.language, "gu-IN");
  assert.match(sms.text, /ડુંગળી માટે ખરીદદારો/);
  assert.match(sms.text, /કૉલમાં 1 દબાવી/);
  assert.doesNotMatch(sms.text, /Buyer 6/);
  assert.equal(sms.matchCount, 5);
});

test("Hindi call generates a Hindi buyer SMS", () => {
  const sms = formatTop5BuyerSms({
    matches: buyers(2), commodity: "Onion", localizedCrop: "प्याज", language: "hi-IN"
  });
  assert.equal(sms.language, "hi-IN");
  assert.match(sms.text, /प्याज के खरीदार/);
  assert.match(sms.text, /कॉल में 1 दबाएँ/);
});

test("English en-IN and en-US calls generate English SMS", () => {
  for (const language of ["en-IN", "en-US"]) {
    const sms = formatTop5BuyerSms({ matches: buyers(1), commodity: "Onion", language });
    assert.equal(sms.language, "en-IN");
    assert.match(sms.text, /Top buyers for Onion/);
    assert.match(sms.text, /Press 1 in the call/);
  }
});

test("unknown SMS language falls back to Hindi while Kannada and Malayalam remain native", () => {
  assert.equal(formatTop5BuyerSms({ matches: buyers(1), commodity: "Onion", language: "mr-IN" }).language, "hi-IN");
  assert.match(formatTop5BuyerSms({ matches: buyers(1), commodity: "Onion", language: "kn-IN" }).text, /ಖರೀದಿದಾರರು/);
  assert.match(formatTop5BuyerSms({ matches: buyers(1), commodity: "Onion", language: "ml-IN" }).text, /വാങ്ങുന്നവർ/);
});

test("Indian caller formats normalize to the Fast2SMS 10-digit number", () => {
  for (const input of ["+919876543210", "919876543210", "9876543210"]) {
    assert.equal(normalizeFast2SmsPhone(input), "9876543210");
  }
  assert.equal(normalizeFast2SmsPhone("+12025550123"), null);
  assert.equal(normalizeFast2SmsPhone("123"), null);
});

test("Fast2SMS uses POST Quick SMS route q and validates success", async () => {
  let request;
  const result = await sendFast2SMS(
    { phone: "+919876543210", message: "KisanSetu test" },
    {
      apiKey: "test-api-key",
      fetchImpl: async (url, options) => {
        request = { url, options };
        return { ok: true, status: 200, json: async () => ({ return: true, request_id: "REQ1" }) };
      }
    }
  );
  assert.deepEqual(result, { ok: true, requestId: "REQ1" });
  assert.equal(request.url, FAST2SMS_ENDPOINT);
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers.Authorization, "test-api-key");
  assert.deepEqual(JSON.parse(request.options.body), {
    route: "q", message: "KisanSetu test", numbers: "9876543210", sms_details: "1"
  });
});

test("Fast2SMS provider maps rejection and network errors to FAILED", async () => {
  const rejected = createFast2SmsProvider({
    env: { FAST2SMS_API_KEY: "test-key" },
    fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ return: false }) }),
    logger: { log() {} }
  });
  const rejectedResult = await rejected.sendSMS({ to: "+919876543210", text: "KisanSetu" });
  assert.equal(rejectedResult.status, "FAILED");
  assert.equal(rejectedResult.errorCode, "FAST2SMS_HTTP_401");

  const networkFailure = createFast2SmsProvider({
    env: { FAST2SMS_API_KEY: "test-key" },
    fetchImpl: async () => { throw new Error("offline"); },
    logger: { log() {} }
  });
  const networkResult = await networkFailure.sendSMS({ to: "+919876543210", text: "KisanSetu" });
  assert.equal(networkResult.status, "FAILED");
  assert.equal(networkResult.errorCode, "FAST2SMS_REQUEST_FAILED");
});

test("Fast2SMS provider logs safe request status without exposing its API key", async () => {
  const apiKey = "never-log-this-fast2sms-key";
  const entries = [];
  const provider = createFast2SmsProvider({
    env: { FAST2SMS_API_KEY: apiKey },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ return: true, request_id: "REQ2" })
    }),
    logger: { log(value) { entries.push(String(value)); } }
  });
  const result = await provider.sendSMS({ to: "+919876543210", text: "KisanSetu" });
  assert.equal(result.status, "SENT");
  assert.deepEqual(entries, ["SMS PROVIDER: FAST2SMS", "SMS API REQUEST", "SMS API HTTP STATUS: 200"]);
  assert.equal(entries.some(entry => entry.includes(apiKey)), false);
});

test("same match handler cannot send a duplicate paid SMS", async () => {
  const session = readySession();
  let resolveSend;
  let sendCount = 0;
  const sendSms = () => {
    sendCount += 1;
    return new Promise(resolve => { resolveSend = resolve; });
  };
  const input = {
    session, callerNumber: "+919876543210", matches: buyers(), commodity: "Onion",
    location: "Vadodara", detectedLanguage: "gu-IN", localizedCrop: "ડુંગળી",
    sendSms, logger: silentLogger()
  };
  const first = sendBuyerMatchesSmsOnce(input);
  assert.equal(session.smsSending, true);
  assert.equal((await sendBuyerMatchesSmsOnce(input)).skipped, "duplicate");
  resolveSend({ ok: true, requestId: "REQ1" });
  assert.equal((await first).ok, true);
  assert.equal(session.smsSent, true);
  assert.equal(session.smsSending, false);
  assert.equal((await sendBuyerMatchesSmsOnce(input)).skipped, "duplicate");
  assert.equal(sendCount, 1);
});

test("no SMS is attempted without buyers, complete slots, caller, or resolved language", async () => {
  let sendCount = 0;
  const sendSms = async () => { sendCount += 1; return { ok: true }; };
  const base = {
    session: readySession(), callerNumber: "+919876543210", matches: buyers(1),
    commodity: "Onion", location: "Vadodara", detectedLanguage: "hi-IN",
    sendSms, logger: silentLogger()
  };
  assert.equal((await sendBuyerMatchesSmsOnce({ ...base, matches: [] })).skipped, "no_buyers");
  assert.equal((await sendBuyerMatchesSmsOnce({ ...base, commodity: null })).skipped, "incomplete_slots");
  assert.equal((await sendBuyerMatchesSmsOnce({ ...base, callerNumber: null })).skipped, "invalid_caller_number");
  assert.equal((await sendBuyerMatchesSmsOnce({ ...base, detectedLanguage: null })).skipped, "language_unresolved");
  assert.equal(sendCount, 0);
});

test("Fast2SMS failures remain isolated from call state", async () => {
  const session = readySession();
  const logger = silentLogger();
  const result = await sendBuyerMatchesSmsOnce({
    session, callerNumber: "+919876543210", matches: buyers(1), commodity: "Onion",
    location: "Vadodara", detectedLanguage: "hi-IN", logger,
    sendSms: async () => ({ ok: false, errorCode: "FAST2SMS_HTTP_401" })
  });
  assert.equal(result.ok, false);
  assert.equal(session.smsSent, false);
  assert.equal(session.smsSending, false);
  assert.deepEqual(logger.entries, ["[SMS] Sending...", "[SMS] Failed: FAST2SMS_HTTP_401"]);
});

test("API key is never written to SMS logs, including thrown-provider failures", async () => {
  const apiKey = "super-secret-fast2sms-key";
  const logger = silentLogger();
  await sendBuyerMatchesSmsOnce({
    session: readySession(), callerNumber: "+919876543210", matches: buyers(1), commodity: "Onion",
    location: "Vadodara", detectedLanguage: "hi-IN", logger,
    sendSms: async () => { throw new Error(apiKey); }
  });
  assert.equal(logger.entries.some(entry => entry.includes(apiKey)), false);
});
