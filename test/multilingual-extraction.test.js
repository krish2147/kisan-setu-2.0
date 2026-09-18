const test = require("node:test");
const assert = require("node:assert/strict");
const { createMultilingualExtractor } = require("../src/multilingual-extraction");
const { createSpeechLanguages } = require("../src/speech-languages");
const { extractFarmerData, createLanguageSessionState, lockSessionLanguage, turnLanguageEvidence } = require("../server");

const capabilities = createSpeechLanguages({ env: {} });
const emptySlots = { intent: "SELL", commodity: null, quantityKg: null, location: null };

test("translation feeds the existing normalized parser for any configured source language", async () => {
  for (const language of capabilities.translationLanguages.filter(code => code !== "en-IN")) {
    let request;
    const extract = createMultilingualExtractor({
      capabilities, extract: extractFarmerData, env: { SARVAM_API_KEY: "test-key" },
      fetchImpl: async (url, options) => {
        assert.equal(url, "https://api.sarvam.ai/translate");
        request = JSON.parse(options.body);
        return { ok: true, json: async () => ({ translated_text: "I want to sell 20 kilograms of tomato in Ahmedabad" }) };
      }
    });
    const result = await extract({ transcript: "source utterance", language, slots: emptySlots });
    assert.equal(request.source_language_code, language);
    assert.equal(request.target_language_code, "en-IN");
    assert.equal(request.model, capabilities.translationModel);
    assert.deepEqual(result.slots, { intent: "SELL", commodity: "Tomato", quantityKg: 20, location: "Ahmedabad" });
    assert.deepEqual(emptySlots, { intent: "SELL", commodity: null, quantityKg: null, location: null });
  }
});

test("translation cannot overwrite parsed values or the locked conversation language", async () => {
  const session = createLanguageSessionState();
  lockSessionLanguage(session, "माझ्याकडे बटाटे विकण्यासाठी आहेत", "mr-IN", 0.96);
  const before = { ...session };
  const extract = createMultilingualExtractor({
    capabilities, extract: extractFarmerData, env: { SARVAM_API_KEY: "test-key" },
    fetchImpl: async () => ({ ok: true, json: async () => ({ translated_text: "buy 100 kilo tomato in Vadodara" }) })
  });
  const slots = { intent: "SELL", commodity: "Potato", quantityKg: 20, location: null };
  const result = await extract({ transcript: "वडोदरा", language: session.detectedLanguage, slots });
  assert.deepEqual(result.slots, { ...slots, location: "Vadodara" });
  assert.deepEqual(session, before);
});

test("provider errors and unrecognized translations leave missing fields unresolved", async () => {
  for (const fetchImpl of [
    async () => { throw new Error("timeout"); },
    async () => ({ ok: false }),
    async () => ({ ok: true, json: async () => { throw new Error("bad JSON"); } }),
    async () => ({ ok: true, json: async () => ({ translated_text: null }) }),
    async () => ({ ok: true, json: async () => ({ translated_text: "unrecognized crop and village" }) })
  ]) {
    const extract = createMultilingualExtractor({ capabilities, extract: extractFarmerData,
      env: { SARVAM_API_KEY: "test-key" }, fetchImpl });
    const result = await extract({ transcript: "किसान का पूरा वाक्य", language: "hi-IN", slots: emptySlots });
    assert.deepEqual(result.slots, emptySlots);
  }
});

test("unsupported sources, oversized input, and complete slots make no translation request", async () => {
  const extract = createMultilingualExtractor({ capabilities, extract: extractFarmerData,
    env: { SARVAM_API_KEY: "test-key" }, fetchImpl: async () => assert.fail("unexpected translation request") });
  for (const input of [
    { language: "zz-IN", transcript: "unknown", slots: emptySlots },
    { language: "en-IN", transcript: "tomato", slots: emptySlots },
    { language: "hi-IN", transcript: "x".repeat(2001), slots: emptySlots },
    { language: "hi-IN", transcript: "पूर्ण वाक्य", slots: { ...emptySlots, commodity: "Tomato", quantityKg: 20, location: "Ahmedabad" } }
  ]) assert.deepEqual((await extract(input)).slots, input.slots);
});

test("consistent fragments establish language using the completed sentence", () => {
  const turn = { transcriptBuffer: "मेरे पास टमाटर हैं", languageCandidates: [
    { transcript: "मेरे पास", languageCode: "hi_IN", confidence: 0.95 },
    { transcript: "टमाटर हैं", languageCode: "hi-IN", confidence: 0.91 }
  ] };
  const session = createLanguageSessionState();
  for (const candidate of turnLanguageEvidence(turn)) {
    lockSessionLanguage(session, candidate.transcript, candidate.languageCode, candidate.confidence);
  }
  assert.equal(session.languageLocked, true);
  assert.equal(session.responseLanguage, "hi-IN");
  assert.equal(session.languageConfidence, 0.91);
});

test("conflicting or low-confidence fragments cannot borrow an entire turn as evidence", () => {
  for (const second of [
    { transcript: "20 kilo", languageCode: "hi-IN", confidence: 0.99 },
    { transcript: "20 kilo", languageCode: "en-IN", confidence: 0.1 }
  ]) {
    const turn = { transcriptBuffer: "Tomato 20 kilo", languageCandidates: [
      { transcript: "Tomato", languageCode: "en-IN", confidence: 0.99 }, second
    ] };
    assert.strictEqual(turnLanguageEvidence(turn), turn.languageCandidates);
    const session = createLanguageSessionState();
    for (const candidate of turnLanguageEvidence(turn)) {
      lockSessionLanguage(session, candidate.transcript, candidate.languageCode, candidate.confidence);
    }
    assert.equal(session.languageLocked, false);
  }
});
