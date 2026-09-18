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
const { createSpeechLanguages } = require("../src/speech-languages");
const manifest = require("../src/sarvam-capabilities.json");

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
  assert.match(serverSource, /encodeURIComponent\(speechLanguages.sttModel\)/);
});

test("every configured STT language, including three-letter codes, can establish detection", () => {
  const capabilities = createSpeechLanguages({ env: {} });
  for (const language of capabilities.sttLanguages) {
    const session = createLanguageSessionState();
    const result = lockSessionLanguage(session, "I have 20 kilo tomato", language, 0.96, capabilities);
    assert.equal(result.locked, true, language);
    assert.equal(session.detectedLanguage, language);
    assert.equal(session.responseLanguage, MESSAGES[language] ? language : "hi-IN");
    assert.equal(capabilities.normalize(language.replace("-IN", "_in")), language);
    assert.equal(capabilities.normalize(language.split("-")[0]), language);
  }
  for (const code of ["zz-IN", "fr-IN", "gu-US", "unknown", "auto", "not_a_language_code"]) {
    assert.equal(capabilities.normalize(code), null, code);
  }
});

test("slot-only answers neither establish nor change a reliable language", () => {
  const capabilities = createSpeechLanguages({ env: {} });
  for (const language of capabilities.sttLanguages) {
    for (const fragment of ["Ahmedabad", "Vadodara", "Tomato", "Potato", "20 kilo", "20", "ટામેટા", "અમદાવાદ"]) {
      const fresh = createLanguageSessionState();
      assert.equal(lockSessionLanguage(fresh, fragment, language, 0.99).locked, false, fragment);
      const established = createLanguageSessionState();
      lockSessionLanguage(established, "I have 20 kilo tomato", language, 0.95);
      const before = { ...established };
      for (const conflicting of ["hi-IN", "en-IN", "kn-IN", "ml-IN"]) {
        lockSessionLanguage(established, fragment, conflicting, 0.99);
        assert.deepEqual(established, before);
      }
    }
  }
});

test("missing confidence works consistently and invalid confidence is not reliable metadata", () => {
  for (const language of ["hi-IN", "mr-IN", "kok-IN", "mai-IN", "en-IN"]) {
    assert.equal(lock("I have produce for market", language, null).result.locked, true, language);
    for (const confidence of [0.4, "bad", "", true, {}, -1, 1.1, NaN, Infinity]) {
      assert.equal(lock("I have produce for market", language, confidence).result.locked, false, String(confidence));
    }
  }
});

test("a deployment capability change needs no new language branches", () => {
  const updated = structuredClone(manifest);
  // Fixture only: this does not assert that Sarvam currently supports French.
  updated.stt["test-stt"] = { source: "test fixture", languages: ["hi-IN", "fr-FR"] };
  updated.tts["test-tts"] = { source: "test fixture", languages: ["hi-IN", "fr-FR"] };
  const capabilities = createSpeechLanguages({
    env: { SARVAM_STT_MODEL: "test-stt", SARVAM_TTS_MODEL: "test-tts" }, manifest: updated
  });
  assert.equal(capabilities.normalize("FR_fr"), "fr-FR");
  const session = createLanguageSessionState();
  assert.equal(lockSessionLanguage(session, "Je souhaite vendre des tomates", "fr-FR", 0.95, capabilities).locked, true);
  assert.equal(session.detectedLanguage, "fr-FR");
  assert.equal(session.responseLanguage, "hi-IN");
  assert.equal(session.languageFallbackReason, "response_bundle_unavailable");
  assert.deepEqual(capabilities.selectResponse("fr-FR", () => true), { language: "fr-FR", reason: null });
});

test("message availability cannot bypass configured TTS capability checks", () => {
  const updated = structuredClone(manifest);
  updated.tts["test-tts"] = { source: "test fixture", languages: ["hi-IN"] };
  const capabilities = createSpeechLanguages({ env: { SARVAM_TTS_MODEL: "test-tts" }, manifest: updated });
  const session = createLanguageSessionState();
  lockSessionLanguage(session, "મારે ટામેટા વેચવા છે", "gu-IN", 0.95, capabilities);
  assert.equal(session.detectedLanguage, "gu-IN");
  assert.equal(session.responseLanguage, "hi-IN");
  assert.equal(session.languageFallbackReason, "tts_language_unavailable");
  assert.throws(() => createSpeechLanguages({ env: { SARVAM_STT_MODEL: "unverified-model" } }), /capabilities/);
  updated.tts["test-tts"].languages = ["gu-IN"];
  assert.throws(() => createSpeechLanguages({ env: { SARVAM_TTS_MODEL: "test-tts" }, manifest: updated }), /Hindi/);
});
