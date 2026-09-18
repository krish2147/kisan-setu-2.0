const assert = require("node:assert/strict");
const test = require("node:test");
const { openDatabase } = require("../src/db");
const { createCallRepository } = require("../src/call-repository");
const { createMarketplaceRepository } = require("../src/marketplace-repository");
const { rankMatches } = require("../src/matching");

const {
  MESSAGES,
  STAGES,
  accumulateTurnTranscript,
  authorizeBuyerConnection,
  createLanguageSessionState,
  createTurnBuffer,
  cropName,
  extractFarmerData,
  findTopMarketplaceMatches,
  getMandiRates,
  lockSessionLanguage,
  matchVoiceAnnouncement,
  messagesFor,
  missingRequiredSlots,
  resolveBuyerConnection,
  resolveFinalMatchAction,
  spokenNumber
} = require("../server");

const LANGUAGE_CASES = [
  { code: "hi-IN", crop: "प्याज", sell: "मेरे पास पांच सौ किलो प्याज है", buy: "मुझे पांच सौ किलो प्याज चाहिए", location: "वडोदरा" },
  { code: "gu-IN", crop: "ડુંગળી", sell: "મારી પાસે પાંચસો કિલો ડુંગળી છે", buy: "મને પાંચસો કિલો ડુંગળી જોઈએ", location: "વડોદરા" },
  { code: "mr-IN", crop: "कांदा", sell: "माझ्याकडे पाचशे किलो कांदा आहे", buy: "मला पाचशे किलो कांदा हवा आहे", location: "वडोदरा" },
  { code: "bn-IN", crop: "পেঁয়াজ", sell: "আমার কাছে পাঁচশো কিলো পেঁয়াজ আছে", buy: "আমার পাঁচশো কিলো পেঁয়াজ দরকার", location: "ভাদোদরা" },
  { code: "ta-IN", crop: "வெங்காயம்", sell: "என்னிடம் ஐநூறு கிலோ வெங்காயம் உள்ளது", buy: "எனக்கு ஐநூறு கிலோ வெங்காயம் வேண்டும்", location: "வடோதரா" },
  { code: "te-IN", crop: "ఉల్లిపాయ", sell: "నా వద్ద ఐదు వందల కిలోల ఉల్లిపాయ ఉంది", buy: "నాకు ఐదు వందల కిలోల ఉల్లిపాయ కావాలి", location: "వడోదర" },
  { code: "kn-IN", crop: "ಈರುಳ್ಳಿ", sell: "ನನ್ನ ಬಳಿ ಐನೂರು ಕಿಲೋ ಈರುಳ್ಳಿ ಇದೆ", buy: "ನನಗೆ ಐನೂರು ಕಿಲೋ ಈರುಳ್ಳಿ ಬೇಕು", location: "ವಡೋದರಾ" },
  { code: "ml-IN", crop: "ഉള്ളി", sell: "എന്റെ പക്കൽ അഞ്ഞൂറ് കിലോ ഉള്ളി ഉണ്ട്", buy: "എനിക്ക് അഞ്ഞൂറ് കിലോ ഉള്ളി വേണം", location: "വഡോദര" },
  { code: "pa-IN", crop: "ਪਿਆਜ਼", sell: "ਮੇਰੇ ਕੋਲ ਪੰਜ ਸੌ ਕਿਲੋ ਪਿਆਜ਼ ਹੈ", buy: "ਮੈਨੂੰ ਪੰਜ ਸੌ ਕਿਲੋ ਪਿਆਜ਼ ਚਾਹੀਦਾ ਹੈ", location: "ਵਡੋਦਰਾ" },
  { code: "od-IN", crop: "ପିଆଜ", sell: "ମୋ ପାଖରେ ପାଞ୍ଚ ଶହ କିଲୋ ପିଆଜ ଅଛି", buy: "ମୋତେ ପାଞ୍ଚ ଶହ କିଲୋ ପିଆଜ ଦରକାର", location: "ଭଦୋଦରା" },
  { code: "en-IN", crop: "Onion", sell: "I want to sell five hundred kilos of onion", buy: "I need five hundred kilos of onion", location: "Vadodara" }
];

function simulateLogicalCall({ code, utterance, location, intent }) {
  const session = { ...createLanguageSessionState(), intent, commodity: null, quantityKg: null, location: null };
  const locked = lockSessionLanguage(session, utterance, code, 0.95);
  const firstTurn = createTurnBuffer(session);
  accumulateTurnTranscript(firstTurn, utterance, code, 0.95);
  Object.assign(session, firstTurn.slots);

  if (!session.location) {
    const locationTurn = createTurnBuffer(session);
    accumulateTurnTranscript(locationTurn, location, code, 0.95);
    Object.assign(session, locationTurn.slots);
  }

  const messages = messagesFor(session.responseLanguage);
  const mandi = getMandiRates(session.commodity, session.location);
  const fixtureDb = openDatabase(":memory:");
  const fixtureMarket = createMarketplaceRepository(fixtureDb, { includeDemo: true });
  fixtureMarket.seedDemoMarketplace();
  const matches = findTopMarketplaceMatches(intent, session.commodity, session.quantityKg, session.location, fixtureMarket);
  fixtureDb.close();
  const confirmation = intent === "SELL"
    ? messages.CONFIRM_CROP_QUANTITY_SELL(session.quantityKg, cropName(session.commodity, code))
    : messages.CONFIRM_CROP_QUANTITY_BUY(session.quantityKg, cropName(session.commodity, code));
  const mandiSpeech = mandi.map(rate => messages.MANDI_RATE(rate.mandi, rate.modal)).join(" ");
  const matchSpeech = matchVoiceAnnouncement(intent, matches, session.responseLanguage);
  const menu = intent === "SELL" ? messages.PRESS_ONE_TO_CONNECT : messages.BUY_MATCH_SMS_MENU;
  return { confirmation, locked, mandi, mandiSpeech, matchSpeech, matches, menu, session };
}

function assertCompleteFlow(result, code, intent, expectedCrop) {
  assert.equal(result.locked.locked, true, code);
  assert.equal(result.session.detectedLanguage, code, code);
  assert.equal(result.session.responseLanguage, code, code);
  assert.equal(result.session.languageLocked, true, code);
  assert.deepEqual(missingRequiredSlots(result.session), [], code);
  assert.equal(result.session.commodity, "Onion", code);
  assert.equal(result.session.quantityKg, 500, code);
  assert.equal(result.session.location, "Vadodara", code);
  assert.equal(Object.keys(messagesFor(code)).length, 46, code);
  assert.equal(cropName("Onion", code), expectedCrop, code);
  assert.doesNotMatch(spokenNumber(500, code), /\d/, code);
  assert.ok(result.mandi.length > 0 && result.mandi.length <= 3, code);
  assert.ok(result.mandiSpeech.length > 0, code);
  assert.ok(result.matches.length > 0 && result.matches.length <= 5, code);
  assert.equal(result.matches[0].rank, 1, code);
  assert.equal(result.matches[0].isRecommended, true, code);
  assert.ok(result.matchSpeech.length > 0, code);
  assert.ok(result.menu.length > 0, code);
  assert.doesNotMatch(`${result.confirmation} ${result.mandiSpeech} ${result.matchSpeech}`, /\b500\b/, code);
  assert.equal(intent === "SELL" ? result.matches[0].side : result.matches[0].side, intent === "SELL" ? "BUY" : "SELL");
}

test("all 11 languages complete the logical SELL flow through final DTMF menu", () => {
  assert.equal(MESSAGES["hi-IN"].WELCOME, "नमस्कार। किसानसेतु में आपका स्वागत है। फसल खरीदने के लिए एक दबाएँ। फसल बेचने के लिए दो दबाएँ।");
  for (const item of LANGUAGE_CASES) assertCompleteFlow(simulateLogicalCall({ ...item, utterance: item.sell, intent: "SELL" }), item.code, "SELL", item.crop);
});

test("all 11 languages complete the logical BUY flow through final DTMF menu", () => {
  for (const item of LANGUAGE_CASES) assertCompleteFlow(simulateLogicalCall({ ...item, utterance: item.buy, intent: "BUY" }), item.code, "BUY", item.crop);
});

test("code-mixed speech preserves useful slots and the Sarvam-selected response language", () => {
  const cases = [
    ["મારે 500 kilo tomato sell કરવું છે", "gu-IN", "Tomato", "SELL"],
    ["मुझे 500 kilo onion बेचना है", "hi-IN", "Onion", "SELL"],
    ["I want 500 kilo प्याज", "en-IN", "Onion", null],
    ["500 kg tomato चाहिए", "hi-IN", "Tomato", "BUY"]
  ];
  for (const [text, language, commodity, extractedIntent] of cases) {
    const session = { ...createLanguageSessionState(), intent: "SELL" };
    lockSessionLanguage(session, text, language, 0.95);
    const extracted = extractFarmerData(text);
    assert.equal(session.responseLanguage, language);
    assert.equal(extracted.commodity, commodity);
    assert.equal(extracted.quantityKg, 500);
    if (extractedIntent) assert.equal(extracted.intent, extractedIntent);
  }
});

test("complete first utterance keeps location and skips the missing-location condition", () => {
  const extracted = extractFarmerData("मेरे पास पांच सौ किलो प्याज है वडोदरा में");
  assert.deepEqual(extracted, { intent: "SELL", commodity: "Onion", quantityKg: 500, location: "Vadodara" });
  assert.deepEqual(missingRequiredSlots(extracted), []);
});

test("partial answers retain known slots and request only the missing field", () => {
  const cropOnly = extractFarmerData("मुझे प्याज बेचना है");
  assert.deepEqual(missingRequiredSlots(cropOnly), ["quantityKg", "location"]);
  const withQuantity = { ...cropOnly, ...extractFarmerData("पांच सौ किलो"), commodity: cropOnly.commodity, intent: cropOnly.intent };
  assert.equal(withQuantity.commodity, "Onion");
  assert.equal(withQuantity.quantityKg, 500);
  const quantityOnly = extractFarmerData("पांच सौ किलो बेचना है");
  assert.equal(quantityOnly.quantityKg, 500);
  assert.equal(quantityOnly.commodity, null);
  assert.equal(messagesFor("hi-IN").ASK_QUANTITY, "कृपया मात्रा किलो में बताइए।");
  assert.equal(messagesFor("hi-IN").ASK_CROP, "कृपया फसल का नाम बताइए।");
});

test("Vadodara and Baroda transcription variants share one canonical location", () => {
  for (const value of ["Vadodara", "Baroda", "बड़ौदा", "बरोड़ा", "वडोदरा", "વડોદરા"]) {
    assert.equal(extractFarmerData(value).location, "Vadodara", value);
  }
});

test("final DTMF contract preserves SELL transfer and both SMS/end menus", () => {
  assert.equal(resolveFinalMatchAction(STAGES.WAITING_FOR_BUYER_CONNECT, "SELL", "1"), "CONNECT_BUYER");
  assert.equal(resolveFinalMatchAction(STAGES.WAITING_FOR_BUYER_CONNECT, "SELL", "2"), "REQUEST_TOP5_MANDI_SMS");
  assert.equal(resolveFinalMatchAction(STAGES.WAITING_FOR_BUYER_CONNECT, "SELL", "3"), "END_CALL");
  assert.equal(resolveFinalMatchAction(STAGES.WAITING_FOR_MATCH_ACTION, "BUY", "1"), null);
  assert.equal(resolveFinalMatchAction(STAGES.WAITING_FOR_MATCH_ACTION, "BUY", "2"), "END_CALL");
  assert.equal(resolveFinalMatchAction(STAGES.WAITING_FOR_MATCH_ACTION, "BUY", "3"), "REQUEST_TOP5_SMS");
});

test("handoff authorization rejects missing, wrong, and expired CallSid access", () => {
  const sid = "CA-e2e-authorized";
  assert.equal(authorizeBuyerConnection(null, "+918401829027", 1000), false);
  assert.equal(authorizeBuyerConnection(sid, "+918401829027", 1000), true);
  assert.equal(resolveBuyerConnection("CA-wrong", 1100), null);
  assert.equal(resolveBuyerConnection(sid, 1100), "+918401829027");
  assert.equal(resolveBuyerConnection(sid, 1200), "+918401829027");
  assert.equal(resolveBuyerConnection(sid, 301001), null);
});

test("unsupported but valid STT language codes lock detection and use Hindi responses", () => {
  for (const language of ["ur-IN", "as-IN", "ne-IN"]) {
    const session = { ...createLanguageSessionState() };
    const result = lockSessionLanguage(session, "मेरे पास 500 किलो प्याज है", language, 0.95);
    assert.equal(result.locked, true, language);
    assert.equal(session.detectedLanguage, language, language);
    assert.equal(session.responseLanguage, "hi-IN", language);
    assert.equal(session.languageFallbackReason, "response_bundle_unavailable", language);
    assert.strictEqual(messagesFor(session.responseLanguage), MESSAGES["hi-IN"]);
  }
});

test("a Gujarati call remains Gujarati after later English and Hindi acknowledgements", () => {
  const session = { ...createLanguageSessionState() };
  assert.equal(lockSessionLanguage(session, "મારી પાસે પાંચસો કિલો ડુંગળી છે", "gu-IN", 0.95).locked, true);
  assert.equal(lockSessionLanguage(session, "okay", "en-IN", 0.99).reason, "already_locked");
  assert.equal(lockSessionLanguage(session, "हाँ", "hi-IN", 0.99).reason, "already_locked");
  assert.equal(session.detectedLanguage, "gu-IN");
  assert.equal(session.responseLanguage, "gu-IN");
});

test("a completed call is reconstructable by the dashboard repository from persisted facts", () => {
  const db = openDatabase(":memory:");
  try {
    const repository = createCallRepository(db);
    const market = createMarketplaceRepository(db, { includeDemo: true });
    market.seedDemoMarketplace();
    const callSid = "CA-e2e-persistence";
    const startedAt = "2026-09-07T10:00:00.000Z";
    repository.createCall({ callSid, streamSid: "stream-e2e", callerNumber: "+919876543210", startedAt });
    const candidates = market.getEligibleListings("BUY", "Onion");
    const matches = rankMatches({ intent: "SELL", commodity: "Onion", quantityKg: 500, location: "Vadodara" }, candidates);
    const rates = getMandiRates("Onion", "Vadodara");
    repository.updateCall(callSid, {
      intent: "SELL", language: "gu-IN", detectedLanguage: "gu-IN", responseLanguage: "gu-IN",
      languageConfidence: 0.96, commodity: "Onion", quantityKg: 500, location: "Vadodara",
      selectedMandi: rates[0].mandi, matchedBuyerId: matches[0].participantId,
      buyerConnectionRequested: true, buyerConnectionStatus: "REQUESTED", currentStage: "END"
    });
    repository.addTranscript(callSid, "મારી પાસે પાંચસો કિલો ડુંગળી છે", "gu-IN", "2026-09-07T10:00:05.000Z");
    repository.replaceMandiResults(callSid, "Onion", "Vadodara", rates);
    repository.replaceCallMatches(callSid, matches);
    repository.createSmsRequest(callSid, "BUYERS", "gu-IN");
    repository.addEvent(callSid, "CALL_COMPLETED");
    const finished = repository.finishCall(callSid, "COMPLETED", "2026-09-07T10:01:00.000Z");
    const detail = repository.getCallDetail(finished.id);
    assert.equal(detail.call_sid, callSid);
    assert.equal(detail.status, "COMPLETED");
    assert.equal(detail.duration_seconds, 60);
    assert.equal(detail.detected_language, "gu-IN");
    assert.equal(detail.response_language, "gu-IN");
    assert.equal(detail.commodity, "Onion");
    assert.equal(detail.quantity_kg, 500);
    assert.equal(detail.location, "Vadodara");
    assert.equal(detail.buyer_connection_requested, 1);
    assert.equal(detail.sms_status, "PENDING");
    assert.equal(detail.transcripts.length, 1);
    assert.ok(detail.mandi_results.length > 0);
    assert.ok(detail.matches.length > 0);
    assert.equal(detail.matches[0].is_recommended, 1);
    assert.ok(detail.events.some(event => event.event_type === "CALL_COMPLETED"));
    assert.equal(repository.listCalls().some(call => call.call_sid === callSid), true);
    assert.equal(repository.getSummary().total_calls, 1);
  } finally {
    db.close();
  }
});

test("failure inputs remain finite and produce safe empty results", () => {
  assert.deepEqual(extractFarmerData(""), { intent: "UNKNOWN", commodity: null, quantityKg: null, location: null });
  assert.deepEqual(missingRequiredSlots(extractFarmerData("कुछ अस्पष्ट शब्द")), ["commodity", "quantityKg", "location"]);
  assert.deepEqual(getMandiRates("Unsupported Crop", "Vadodara"), []);
  assert.deepEqual(findTopMarketplaceMatches("SELL", "Unsupported Crop", 500, "Vadodara"), []);
  assert.deepEqual(findTopMarketplaceMatches("BUY", "Unsupported Crop", 500, "Vadodara"), []);
  assert.ok(messagesFor("hi-IN").NO_MANDI_RATES);
  assert.ok(messagesFor("hi-IN").NO_BUYERS_RECORDED);
  assert.ok(messagesFor("hi-IN").NO_SELLERS_RECORDED);
});

module.exports = { LANGUAGE_CASES, simulateLogicalCall };
