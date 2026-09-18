const assert = require("node:assert/strict");
const test = require("node:test");

const { createCallRepository } = require("../src/call-repository");
const { openDatabase } = require("../src/db");
const {
  MANDI_FALLBACK_DATA,
  createMarketDataService,
  marketDataService
} = require("../src/market-data");
const {
  CROP_INPUT_ALIASES,
  detectLanguageCandidate,
  extractFarmerData,
  getMandiRates
} = require("../server");

test("fallback dataset covers 36 commodities and is uniformly labelled and price-valid", () => {
  assert.equal(new Set(MANDI_FALLBACK_DATA.map(record => record.commodity)).size, 36);
  assert.equal(MANDI_FALLBACK_DATA.length, 372);
  assert.ok(new Set(MANDI_FALLBACK_DATA.map(record => record.district)).size >= 15);
  for (const record of MANDI_FALLBACK_DATA) {
    assert.equal(record.state, "Gujarat");
    assert.equal(record.source, "Demo fallback");
    assert.equal(record.isFallback, true);
    assert.equal(record.unit, "₹/quintal");
    assert.equal(record.observedAt, "2026-08-22");
    assert.ok(record.minPrice < record.modalPrice, `${record.commodity} ${record.mandi} min/modal`);
    assert.ok(record.modalPrice < record.maxPrice, `${record.commodity} ${record.mandi} modal/max`);
  }
});

test("expanded crop aliases do not confuse gram in kilogram or moong with groundnut", () => {
  const aliasCount = Object.values(CROP_INPUT_ALIASES).reduce((total, aliases) => total + aliases.length, 0);
  assert.ok(aliasCount >= 180);
  assert.equal(extractFarmerData("500 kilogram potato").commodity, "Potato");
  assert.equal(extractFarmerData("મારી પાસે 2 ક્વિન્ટલ મગફળી છે").commodity, "Groundnut");
  assert.equal(extractFarmerData("મારી પાસે 2 ક્વિન્ટલ મગ છે").commodity, "Moong");
});

test("important Hindi and Gujarati demo phrases extract crop, quantity, and language", () => {
  const cases = [
    ["मेरे पास 500 किलो आलू है", "Potato", 500, "hi-IN"],
    ["500 किलो प्याज बेचना है", "Onion", 500, "hi-IN"],
    ["मेरे पास 3 क्विंटल गेहूं है", "Wheat", 300, "hi-IN"],
    ["दो क्विंटल मक्का है", "Maize", 200, "hi-IN"],
    ["મારી પાસે 500 કિલો બટાકા છે", "Potato", 500, "gu-IN"],
    ["મારી પાસે 300 કિલો ડુંગળી છે", "Onion", 300, "gu-IN"],
    ["મારે 5 ક્વિન્ટલ ઘઉં વેચવા છે", "Wheat", 500, "gu-IN"],
    ["મારી પાસે 2 ક્વિન્ટલ મગફળી છે", "Groundnut", 200, "gu-IN"]
  ];
  for (const [phrase, commodity, quantityKg, language] of cases) {
    const extracted = extractFarmerData(phrase);
    const detected = detectLanguageCandidate(language === "hi-IN" ? "hi-IN" : null, 0.95, phrase);
    assert.equal(extracted.commodity, commodity, phrase);
    assert.equal(extracted.quantityKg, quantityKg, phrase);
    assert.equal(detected.language, language, phrase);
  }
});

test("important demo lookups return three usable fallback rates", () => {
  const lookups = [
    ["Potato", "Vadodara"], ["Onion", "Vadodara"], ["Tomato", "Ahmedabad"],
    ["Wheat", "Anand"], ["Maize", "Rajkot"], ["Groundnut", "Junagadh"],
    ["Cotton", "Rajkot"], ["Bajra", "Banaskantha"]
  ];
  for (const [commodity, location] of lookups) {
    const rates = getMandiRates(commodity, location);
    assert.equal(rates.length, 3, `${commodity} + ${location}`);
    assert.equal(rates.every(rate => rate.source === "Demo fallback" && rate.isFallback), true);
    assert.equal(rates.every(rate => rate.modal === rate.modalPrice), true);
  }
});

test("nearby fallback preserves each market's actual district and never exceeds three", () => {
  const service = createMarketDataService({
    fallback: [
      { commodity: "Test Crop", district: "Vadodara", mandi: "Vadodara APMC", modalPrice: 100 },
      { commodity: "Test Crop", district: "Anand", mandi: "Anand APMC", modalPrice: 110 },
      { commodity: "Test Crop", district: "Anand", mandi: "Petlad APMC", modalPrice: 120 },
      { commodity: "Test Crop", district: "Surat", mandi: "Surat APMC", modalPrice: 130 }
    ]
  });
  const rates = service.getRates({ commodity: "Test Crop", location: "Vadodara" });
  assert.equal(rates.length, 3);
  assert.equal(rates[0].district, "Vadodara");
  assert.equal(rates.slice(1).every(rate => rate.district === "Anand"), true);
  assert.equal(marketDataService.getRates({ commodity: "Garlic", location: "Vadodara" }).length, 3);
});

test("fallback min, modal, max, source, date, and status metadata persist for dashboard detail", t => {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  const repository = createCallRepository(db);
  const call = repository.createCall({ callSid: "CA-fallback-metadata" });
  repository.replaceMandiResults(call.call_sid, "Potato", "Vadodara", getMandiRates("Potato", "Vadodara"));
  const stored = repository.getCallDetail(call.id).mandi_results;
  assert.equal(stored.length, 3);
  assert.deepEqual(
    [stored[0].commodity, stored[0].district, stored[0].min_price, stored[0].modal_price,
      stored[0].max_price, stored[0].observed_at, stored[0].source, stored[0].is_fallback],
    ["Potato", "Vadodara", 1200, 1550, 1850, "2026-08-22", "Demo fallback", 1]
  );
});
