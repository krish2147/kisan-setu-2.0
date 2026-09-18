const assert = require("node:assert/strict");
const test = require("node:test");

const {
  MESSAGES,
  accumulateTurnTranscript,
  app,
  authorizeBuyerConnection,
  buildTtsConfig,
  createTurnBuffer,
  cropName,
  detectLanguageCandidate,
  extractFarmerData,
  mergeSlots,
  messagesFor,
  missingRequiredSlots,
  resolveBuyerConnection,
  spokenNumber
} = require("../server");

test("Hindi natural fast speech fills every SELL slot at once", () => {
  const slots = mergeSlots(
    { intent: "SELL", commodity: null, quantityKg: null, location: null },
    extractFarmerData("मुझे पांच सौ किलो टमाटर अहमदाबाद में बेचना है")
  );
  assert.deepEqual(slots, {
    intent: "SELL",
    commodity: "Tomato",
    quantityKg: 500,
    location: "Ahmedabad"
  });
  assert.deepEqual(missingRequiredSlots(slots), []);
});

test("Gujarati natural fast speech fills every SELL slot at once", () => {
  const turn = createTurnBuffer({ intent: "SELL" });
  assert.equal(accumulateTurnTranscript(
    turn,
    "મારે પાંચસો કિલો ટામેટા વડોદરામાં વેચવા છે",
    "gu-IN",
    0.96,
    1000
  ), true);
  assert.deepEqual(turn.slots, {
    intent: "SELL",
    commodity: "Tomato",
    quantityKg: 500,
    location: "Vadodara"
  });
  assert.deepEqual(missingRequiredSlots(turn.slots), []);
});

test("separate transcript chunks accumulate into one logical answer", () => {
  const turn = createTurnBuffer({ intent: "SELL" });
  accumulateTurnTranscript(turn, "मेरे पास 500 किलो", "hi-IN", 0.91, 1000);
  accumulateTurnTranscript(turn, "प्याज है वडोदरा में", "hi-IN", 0.93, 1500);
  assert.deepEqual(turn.transcripts, ["मेरे पास 500 किलो", "प्याज है वडोदरा में"]);
  assert.deepEqual(turn.slots, {
    intent: "SELL",
    commodity: "Onion",
    quantityKg: 500,
    location: "Vadodara"
  });
});

test("known crop and quantity leave only location missing", () => {
  const slots = mergeSlots(
    { intent: "SELL", commodity: null, quantityKg: null, location: null },
    extractFarmerData("500 किलो प्याज")
  );
  assert.deepEqual(missingRequiredSlots(slots), ["location"]);
  const completed = mergeSlots(slots, extractFarmerData("वडोदरा"));
  assert.deepEqual(missingRequiredSlots(completed), []);
  assert.equal(completed.commodity, "Onion");
  assert.equal(completed.quantityKg, 500);
});

test("duplicate and meaningless transcript chunks are not accumulated", () => {
  const turn = createTurnBuffer({ intent: "SELL" });
  assert.equal(accumulateTurnTranscript(turn, "जी"), false);
  assert.equal(accumulateTurnTranscript(turn, "500 किलो प्याज"), true);
  assert.equal(accumulateTurnTranscript(turn, "500 किलो प्याज"), false);
  assert.equal(turn.transcripts.length, 1);
});

test("Gujarati script wins over an unreliable conflicting language result", () => {
  assert.deepEqual(detectLanguageCandidate("hi-IN", 0.4, "મારે ટામેટા વેચવા છે"), {
    language: "gu-IN",
    confidence: 0.4,
    reliable: true,
    source: "sarvam+script"
  });
});

test("complete response bundles route locally", () => {
  assert.equal(messagesFor("hi-IN"), MESSAGES["hi-IN"]);
  assert.equal(messagesFor("gu-IN"), MESSAGES["gu-IN"]);
  assert.equal(messagesFor("ml-IN"), MESSAGES["ml-IN"]);
  assert.equal(messagesFor("kn-IN"), MESSAGES["kn-IN"]);
  for (const language of ["mr-IN", "bn-IN", "ta-IN", "te-IN", "pa-IN", "od-IN", "en-IN"]) {
    assert.equal(messagesFor(language), MESSAGES[language]);
  }
  assert.equal(cropName("Tomato", "gu-IN"), "ટામેટા");
  assert.equal(cropName("Tomato", "ml-IN"), "തക്കാളി");
  assert.equal(cropName("Tomato", "kn-IN"), "ಟೊಮೆಟೊ");
});

test("complete core dialogue templates exist for Hindi, Gujarati, Malayalam, and Kannada", () => {
  const required = [
    "WELCOME", "BUY_SELECTED", "SELL_SELECTED", "ASK_CROP", "ASK_QUANTITY",
    "ASK_CROP_QUANTITY", "ASK_LOCATION", "CONFIRM_CROP_QUANTITY_SELL",
    "CHECKING_MANDI", "RATES_UNAVAILABLE", "MANDI_RATES", "BUYER_AVAILABLE",
    "PRESS_ONE_TO_CONNECT", "GOODBYE", "RETRY", "RETRY_CROP",
    "RETRY_QUANTITY", "RETRY_LOCATION", "SELL_MATCH_SMS_MENU",
    "BUY_MATCH_SMS_MENU", "TOP5_BUYERS_SMS_CONFIRMATION",
    "TOP5_SELLERS_SMS_CONFIRMATION"
  ];
  for (const language of ["hi-IN", "gu-IN", "ml-IN", "kn-IN"]) {
    for (const key of required) assert.ok(MESSAGES[language][key], `${language}.${key}`);
  }
});

test("Malayalam natural speech is detected and fills the SELL slots", () => {
  assert.deepEqual(detectLanguageCandidate("hi-IN", 0.3, "എനിക്ക് തക്കാളി വിൽക്കണം"), {
    language: "ml-IN",
    confidence: 0.3,
    reliable: true,
    source: "sarvam+script"
  });

  const slots = mergeSlots(
    { intent: "SELL", commodity: null, quantityKg: null, location: null },
    extractFarmerData("എനിക്ക് 500 കിലോ തക്കാളി വഡോദരയിൽ വിൽക്കണം")
  );
  assert.deepEqual(slots, {
    intent: "SELL",
    commodity: "Tomato",
    quantityKg: 500,
    location: "Vadodara"
  });
});

test("Malayalam confirmation and mandi response stay Malayalam with spoken numbers", () => {
  const confirmation = MESSAGES["ml-IN"].CONFIRM_CROP_QUANTITY_SELL(500, "തക്കാളി");
  const rate = MESSAGES["ml-IN"].MANDI_RATE("വഡോദര മണ്ഡി", 2400);

  assert.equal(confirmation, "നിങ്ങൾ അഞ്ച് നൂറ് കിലോ തക്കാളി വിൽക്കാൻ ആഗ്രഹിക്കുന്നു.");
  assert.equal(rate, "വഡോദര മണ്ഡിയിൽ ഒരു ക്വിന്റലിന് ഏകദേശം രണ്ട് ആയിരം നാല് നൂറ് രൂപയാണ്.");
  assert.doesNotMatch(`${confirmation} ${rate}`, /\d/);
});

test("Malayalam TTS config uses Sarvam language_code ml-IN", () => {
  const config = buildTtsConfig("ml-IN");
  assert.equal(config.language_code, "ml-IN");
  assert.equal(config.speaker, "priya");
  assert.equal("target_language_code" in config, false);
});

test("Kannada natural speech is detected and fills the SELL slots", () => {
  assert.deepEqual(detectLanguageCandidate("hi-IN", 0.3, "ನನ್ನ ಬಳಿ ಟೊಮೆಟೊ ಇದೆ"), {
    language: "kn-IN",
    confidence: 0.3,
    reliable: true,
    source: "sarvam+script"
  });

  const slots = mergeSlots(
    { intent: "SELL", commodity: null, quantityKg: null, location: null },
    extractFarmerData("ನನ್ನ ಬಳಿ 500 ಕಿಲೋ ಟೊಮೆಟೊ ಇದೆ, ವಡೋದರಾದಲ್ಲಿ ಮಾರಬೇಕು")
  );
  assert.deepEqual(slots, {
    intent: "SELL",
    commodity: "Tomato",
    quantityKg: 500,
    location: "Vadodara"
  });
});

test("Kannada response and TTS configuration stay Kannada", () => {
  const confirmation = MESSAGES["kn-IN"].CONFIRM_CROP_QUANTITY_SELL(500, "ಟೊಮೆಟೊ");
  const rate = MESSAGES["kn-IN"].MANDI_RATE("ವಡೋದರಾ ಮಂಡಿ", 2400);
  const config = buildTtsConfig("kn-IN");

  assert.equal(confirmation, "ನೀವು ಐದು ನೂರು ಕಿಲೋ ಟೊಮೆಟೊ ಮಾರಲು ಬಯಸುತ್ತೀರಿ.");
  assert.equal(rate, "ವಡೋದರಾ ಮಂಡಿಯಲ್ಲಿ ಪ್ರತಿ ಕ್ವಿಂಟಲ್‌ಗೆ ಸುಮಾರು ಎರಡು ಸಾವಿರ ನಾಲ್ಕು ನೂರು ರೂಪಾಯಿ ಇದೆ.");
  assert.equal(config.language_code, "kn-IN");
  assert.doesNotMatch(`${confirmation} ${rate}`, /\d/);
});

test("core crop aliases are recognized across supported scripts", () => {
  const cases = [
    ["कांदा", "Onion"], ["ਪਿਆਜ਼", "Onion"], ["পেঁয়াজ", "Onion"],
    ["தக்காளி", "Tomato"], ["టమాటా", "Tomato"], ["ಟೊಮೆಟೊ", "Tomato"],
    ["തക്കാളി", "Tomato"], ["ଆଳୁ", "Potato"], ["ઘઉં", "Wheat"]
  ];
  for (const [text, expected] of cases) {
    assert.equal(extractFarmerData(text).commodity, expected, text);
  }
});

test("buyer connection is returned only for an authorized live CallSid", () => {
  const callSid = "CA-demo-authorized";
  assert.equal(resolveBuyerConnection(callSid, 1000), null);
  assert.equal(authorizeBuyerConnection(callSid, "+12025550123", 1000), true);
  assert.equal(resolveBuyerConnection(callSid, 2000), "+12025550123");
  assert.equal(resolveBuyerConnection("CA-other", 2000), null);
});

test("buyer connection authorization expires", () => {
  const callSid = "CA-demo-expired";
  authorizeBuyerConnection(callSid, "+12025550123", 1000);
  assert.equal(resolveBuyerConnection(callSid, 301001), null);
});

test("legacy Connect routes never return a buyer without Press 1 authorization", () => {
  const routeHandlers = app._router.stack
    .filter(layer => layer.route?.path === "/connect-buyer")
    .map(layer => layer.route.stack[0].handle);

  assert.ok(routeHandlers.length >= 1);

  function invoke(handler, callSid) {
    let payload = null;
    const response = {
      setHeader() {},
      statusCode: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        payload = body;
        return this;
      }
    };
    handler({ query: { CallSid: callSid } }, response);
    return { payload, statusCode: response.statusCode };
  }

  for (const [index, handler] of routeHandlers.entries()) {
    const unauthorized = invoke(handler, `CA-no-press-one-${index}`);
    assert.equal(unauthorized.statusCode, 200);
    assert.deepEqual(unauthorized.payload.destination.numbers, []);

    const authorizedCallSid = `CA-pressed-one-${index}`;
    authorizeBuyerConnection(authorizedCallSid, "+12025550123");
    const authorized = invoke(handler, authorizedCallSid);
    assert.deepEqual(authorized.payload.destination.numbers, ["+12025550123"]);
  }
});

test("spokenNumber returns natural words for every required value and language", () => {
  const languages = [
    "hi-IN", "gu-IN", "mr-IN", "pa-IN", "bn-IN",
    "ta-IN", "te-IN", "kn-IN", "ml-IN", "or-IN"
  ];
  const values = [22, 50, 100, 500, 1250, 2400, 10000];

  for (const language of languages) {
    for (const value of values) {
      const spoken = spokenNumber(value, language);
      assert.ok(spoken.length > 0, `${language}: ${value}`);
      assert.doesNotMatch(spoken, /\d/, `${language}: ${value} returned digits`);
    }
  }
});

test("Hindi and Gujarati use the requested natural number wording", () => {
  assert.equal(spokenNumber(22, "hi-IN"), "बाईस");
  assert.equal(spokenNumber(500, "hi-IN"), "पाँच सौ");
  assert.equal(spokenNumber(2400, "hi-IN"), "दो हज़ार चार सौ");
  assert.equal(spokenNumber(22, "gu-IN"), "બાવીસ");
  assert.equal(spokenNumber(500, "gu-IN"), "પાંચસો");
  assert.equal(spokenNumber(2400, "gu-IN"), "બે હજાર ચારસો");
});

test("complete Hindi and Gujarati mandi responses contain words and no digits", () => {
  const hindi = MESSAGES["hi-IN"].MANDI_RATE("वडोदरा मंडी", 2400);
  const gujarati = MESSAGES["gu-IN"].MANDI_RATE("વડોદરા માર્કેટ", 2400);

  assert.equal(hindi, "वडोदरा मंडी में लगभग दो हज़ार चार सौ रुपये प्रति क्विंटल है।");
  assert.equal(gujarati, "વડોદરા માર્કેટમાં અંદાજે બે હજાર ચારસો રૂપિયા પ્રતિ ક્વિન્ટલ છે.");
  assert.doesNotMatch(hindi, /\d/);
  assert.doesNotMatch(gujarati, /\d/);
});
