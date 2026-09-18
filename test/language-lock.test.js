const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  MESSAGES,
  app,
  createLanguageSessionState,
  extractFarmerData,
  lockSessionLanguage,
  normalizeLanguageCode
} = require("../server");

function lock(transcript, language, confidence = 0.95) {
  const session = createLanguageSessionState();
  const result = lockSessionLanguage(session, transcript, language, confidence);
  return { session, result };
}

test("language session starts in Hindi without a detected or locked language", () => {
  assert.deepEqual(createLanguageSessionState(), {
    detectedLanguage: null,
    responseLanguage: "hi-IN",
    languageLocked: false,
    languageConfidence: null,
    languageFallbackReason: null,
    unsupportedLanguageNoticePlayed: false
  });
  assert.equal(
    MESSAGES["hi-IN"].WELCOME,
    "नमस्कार। किसानसेतु में आपका स्वागत है। फसल खरीदने के लिए एक दबाएँ। फसल बेचने के लिए दो दबाएँ।"
  );
});

test("meaningful Gujarati, Kannada, and Malayalam speech locks native responses", () => {
  const cases = [
    ["મારે 500 કિલો ટામેટા વેચવા છે", "gu-IN"],
    ["ನನ್ನ ಬಳಿ 500 ಕಿಲೋ ಟೊಮೆಟೊ ಇದೆ", "kn-IN"],
    ["എനിക്ക് 500 കിലോ തക്കാളി വേണം", "ml-IN"]
  ];
  for (const [transcript, language] of cases) {
    const { session, result } = lock(transcript, language);
    assert.equal(result.locked, true, language);
    assert.equal(session.detectedLanguage, language);
    assert.equal(session.responseLanguage, language);
    assert.equal(session.languageLocked, true);
    assert.equal(session.languageFallbackReason, null);
  }
});

test("newly completed response languages lock to their native bundles", () => {
  for (const [transcript, language] of [
    ["माझ्याकडे 500 किलो कांदा आहे", "mr-IN"],
    ["আমার কাছে 500 কিলো পেঁয়াজ আছে", "bn-IN"],
    ["என்னிடம் 500 கிலோ வெங்காயம் உள்ளது", "ta-IN"],
    ["నా వద్ద 500 కిలోల ఉల్లిపాయ ఉంది", "te-IN"],
    ["ਮੇਰੇ ਕੋਲ 500 ਕਿਲੋ ਪਿਆਜ਼ ਹੈ", "pa-IN"],
    ["ମୋ ପାଖରେ 500 କିଲୋ ପିଆଜ ଅଛି", "od-IN"],
    ["I want 500 kilo onion", "en-IN"]
  ]) {
    const { session, result } = lock(transcript, language);
    assert.equal(result.locked, true, language);
    assert.equal(session.detectedLanguage, language);
    assert.equal(session.responseLanguage, language);
    assert.equal(session.languageFallbackReason, null);
  }
});

test("a locked Gujarati call is not changed by a later English fragment", () => {
  const session = createLanguageSessionState();
  assert.equal(lockSessionLanguage(session, "મારે 500 કિલો ટામેટા વેચવા છે", "gu-IN", 0.96).locked, true);
  const snapshot = { ...session };
  assert.deepEqual(lockSessionLanguage(session, "okay", "en-IN", 0.99), {
    locked: false,
    reason: "already_locked"
  });
  assert.deepEqual(session, snapshot);
});

test("missing or malformed Sarvam language metadata never crashes or locks weak speech", () => {
  for (const metadata of [null, undefined, "not_a_language_code", {}, 42]) {
    const session = createLanguageSessionState();
    assert.doesNotThrow(() => lockSessionLanguage(session, "I have produce for market", metadata, null));
    assert.equal(session.languageLocked, false);
    assert.equal(session.responseLanguage, "hi-IN");
  }
  for (const transcript of ["हां", "yes", "okay", "હા", "..."]) {
    const session = createLanguageSessionState();
    assert.equal(lockSessionLanguage(session, transcript, "en-IN", 0.99).locked, false, transcript);
  }
});

test("code-mixed speech follows Sarvam metadata instead of an English crop word", () => {
  const { session } = lock("મારે 500 kilo tomato sell કરવું છે", "gu_IN");
  assert.equal(session.detectedLanguage, "gu-IN");
  assert.equal(session.responseLanguage, "gu-IN");
});

test("reasonable Sarvam language variants normalize to supported canonical codes", () => {
  const cases = {
    "HI_in": "hi-IN", Gujarati: "gu-IN", "kn": "kn-IN", Malayalam: "ml-IN",
    "mr-IN": "mr-IN", Bengali: "bn-IN", Tamil: "ta-IN", Telugu: "te-IN",
    Punjabi: "pa-IN", "or-IN": "od-IN", odia: "od-IN", English: "en-IN"
  };
  for (const [input, expected] of Object.entries(cases)) assert.equal(normalizeLanguageCode(input), expected, input);
  assert.equal(normalizeLanguageCode("bad/value"), null);
  assert.equal(normalizeLanguageCode(null), null);
});

test("BUY and SELL parsing plus Exotel route contracts remain intact", () => {
  assert.equal(extractFarmerData("मुझे 500 किलो प्याज चाहिए").intent, "BUY");
  assert.equal(extractFarmerData("मेरे पास 500 किलो प्याज बेचना है").intent, "SELL");
  assert.ok(app._router.stack.some(layer => layer.route?.path === "/exotel/connect-buyer"));
  const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(serverSource, /new WebSocket\.Server\(\{ server, path: "\/voicebot" \}\)/);
  assert.match(serverSource, /language-code=unknown/);
  assert.match(serverSource, /model=saaras:v3/);
});
