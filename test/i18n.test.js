const test = require("node:test");
const assert = require("node:assert/strict");
const { MESSAGES, MESSAGE_KEYS, getMessages, hasCompleteMessageBundle } = require("../src/i18n/messages");

const REQUIRED_MESSAGE_KEYS = [
  "WELCOME",
  "SELL_SELECTED",
  "BUY_SELECTED",
  "ASK_CROP_QUANTITY_SELL",
  "ASK_CROP_QUANTITY_BUY",
  "CONFIRM_CROP_QUANTITY_SELL",
  "CONFIRM_CROP_QUANTITY_BUY",
  "ASK_LOCATION",
  "LOCATION_NOT_UNDERSTOOD",
  "CHECKING_MANDI",
  "MANDI_RATE_INTRO",
  "MANDI_RATE",
  "BEST_MANDI_RATE",
  "BUYER_AVAILABLE",
  "PRESS_ONE_TO_CONNECT",
  "SELL_MATCH_SMS_MENU",
  "BUY_MATCH_SMS_MENU",
  "TOP5_BUYERS_SMS_CONFIRMATION",
  "TOP5_SELLERS_SMS_CONFIRMATION",
  "SMS_SEND_FAILED",
  "THANK_YOU",
  "RETRY_CROP",
  "RETRY_QUANTITY",
  "RETRY_CROP_QUANTITY_SELL",
  "RETRY_CROP_QUANTITY_BUY",
  "NO_MANDI_RATES",
  "CONNECTING_BUYER",
  "NO_SELLERS",
  "SELLERS_FOUND",
  "SELLER_MATCH",
  "BUYERS_FOUND_COUNT",
  "SELLERS_FOUND_COUNT",
  "RECOMMENDED_BUYER_MATCH",
  "RECOMMENDED_SELLER_MATCH",
  "NO_BUYERS_RECORDED",
  "NO_SELLERS_RECORDED",
  "BUYER_PHONE_UNAVAILABLE",
  "ASK_CROP",
  "ASK_QUANTITY",
  "ASK_CROP_QUANTITY",
  "RETRY",
  "RETRY_LOCATION",
  "RATES_UNAVAILABLE",
  "MANDI_RATES",
  "GOODBYE",
  "MAX_RETRIES_EXCEEDED"
];

test("Hindi remains the complete source-of-truth message contract", () => {
  assert.deepEqual([...MESSAGE_KEYS].sort(), [...REQUIRED_MESSAGE_KEYS].sort());
  assert.equal(
    MESSAGES["hi-IN"].WELCOME,
    "नमस्कार। किसानसेतु में आपका स्वागत है। फसल खरीदने के लिए एक दबाएँ। फसल बेचने के लिए दो दबाएँ।"
  );
});

const FULL_RESPONSE_LANGUAGES = [
  "hi-IN", "gu-IN", "kn-IN", "ml-IN", "mr-IN", "bn-IN",
  "ta-IN", "te-IN", "pa-IN", "od-IN", "en-IN"
];

test("all 11 complete translations retain the exact Hindi message-key contract", () => {
  for (const language of FULL_RESPONSE_LANGUAGES) {
    assert.deepEqual(Object.keys(MESSAGES[language]).sort(), [...REQUIRED_MESSAGE_KEYS].sort(), language);
    assert.strictEqual(getMessages(language), MESSAGES[language]);
    assert.equal(hasCompleteMessageBundle(language), true, language);
    for (const key of REQUIRED_MESSAGE_KEYS) assert.notEqual(MESSAGES[language][key], undefined, `${language}.${key}`);
  }
});

test("every dynamic message function executes for all full-response languages", () => {
  const args = {
    CONFIRM_CROP_QUANTITY_SELL: [500, "Onion"], CONFIRM_CROP_QUANTITY_BUY: [500, "Onion"],
    MANDI_RATE: ["Vadodara mandi", 2300], BEST_MANDI_RATE: ["Vadodara mandi", 2300],
    SELLERS_FOUND: ["Seller details"], SELLER_MATCH: ["Demo Seller", 500, "Onion"],
    BUYERS_FOUND_COUNT: [5], SELLERS_FOUND_COUNT: [5],
    RECOMMENDED_BUYER_MATCH: ["Vadodara", 12, 500, "Onion", 22],
    RECOMMENDED_SELLER_MATCH: ["Vadodara", 12, 500, "Onion", 22], MANDI_RATES: ["Rates"]
  };
  for (const language of FULL_RESPONSE_LANGUAGES) {
    for (const [key, value] of Object.entries(MESSAGES[language])) {
      if (typeof value !== "function") continue;
      const output = value(...args[key]);
      assert.equal(typeof output, "string", `${language}.${key}`);
      assert.ok(output.length > 0, `${language}.${key}`);
    }
  }
});

test("unsupported response languages still safely fall back to Hindi", () => {
  assert.strictEqual(getMessages("or-IN"), MESSAGES["hi-IN"]);
  assert.strictEqual(getMessages("fr-IN"), MESSAGES["hi-IN"]);
  assert.strictEqual(getMessages("unknown"), MESSAGES["hi-IN"]);
  assert.strictEqual(getMessages(), MESSAGES["hi-IN"]);
});
