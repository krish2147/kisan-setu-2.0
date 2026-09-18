const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DEFAULT_AGMARKNET_RESOURCE_ID,
  OFFICIAL_SOURCE,
  createDataGovInProvider,
  createMarketDataService,
  normalizeMarketLocation,
  normalizeIndiaLocation,
  normalizeOfficialRecord
} = require("../src/market-data");
const { rankMandiRates } = require("../src/mandi-ranking");
const { extractFarmerData, mandiVoiceAnnouncement } = require("../server");

function officialRow(market, district, commodity, modal, date = "06/09/2026", state = "Gujarat") {
  return {
    state, district, market, commodity, variety: "Other",
    min_price: String(modal - 100), max_price: String(modal + 100),
    modal_price: String(modal), arrival_date: date
  };
}

function providerFor(records) {
  return { async fetchRates({ commodity }) {
    return { ok: true, records: records.filter(record => record.commodity === commodity).map(normalizeOfficialRecord), total: records.length };
  } };
}

test("official data.gov.in provider uses the verified AGMARKNET resource contract", async () => {
  let requestedUrl;
  const provider = createDataGovInProvider({
    apiKey: "test-key",
    fetchImpl: async url => {
      requestedUrl = new URL(url);
      return { ok: true, async json() { return { records: [officialRow("Ahmedabad APMC", "Ahmedabad", "Onion", 2400)] }; } };
    }
  });
  const result = await provider.fetchRates({ commodity: "Onion", location: normalizeIndiaLocation("Ahmedabad") });
  assert.equal(provider.resourceId, DEFAULT_AGMARKNET_RESOURCE_ID);
  assert.equal(requestedUrl.origin + requestedUrl.pathname, `https://api.data.gov.in/resource/${DEFAULT_AGMARKNET_RESOURCE_ID}`);
  assert.equal(requestedUrl.searchParams.get("filters[state]"), "Gujarat");
  assert.equal(requestedUrl.searchParams.get("filters[commodity]"), "Onion");
  assert.equal(result.records[0].source, OFFICIAL_SOURCE);
  assert.equal(result.records[0].observedAt, "2026-09-06");
  assert.equal(result.records[0].isFallback, false);
});

test("structured location model separates geography from language and preserves pincode", () => {
  assert.deepEqual(normalizeIndiaLocation("Nashik 422001"), {
    rawLocation: "Nashik 422001", village: null, city: "Nashik", district: "Nashik",
    state: "Maharashtra", pincode: "422001", latitude: 19.9975, longitude: 73.7898, districtAliases: []
  });
  assert.equal(normalizeIndiaLocation("Bombay").city, "Mumbai");
  assert.equal(normalizeIndiaLocation("Madras").city, "Chennai");
  assert.equal(normalizeIndiaLocation("Calcutta").city, "Kolkata");
  assert.equal(normalizeIndiaLocation("Bangalore").city, "Bengaluru");
});

test("location normalization handles Ahmedabad and Vadodara aliases", () => {
  assert.equal(normalizeMarketLocation("Ahmedabad, Gujarat"), "Ahmedabad");
  assert.equal(normalizeMarketLocation("અમદાવાદ"), "Ahmedabad");
  assert.equal(normalizeMarketLocation("Baroda"), "Vadodara");
  assert.equal(normalizeMarketLocation("वडोदरा"), "Vadodara");
});

test("ten official Ahmedabad Onion results are ranked into a deterministic Top 5", async () => {
  const districts = ["Ahmedabad", "Ahmedabad", "Ahmedabad", "Gandhinagar", "Kheda", "Anand", "Vadodara", "Surat", "Rajkot", "Mehsana"];
  const rows = districts.map((district, index) => officialRow(`${district} Market ${index + 1}`, district, "Onion", 2100 + index * 65));
  const service = createMarketDataService({ officialProvider: providerFor(rows), allowDemoFallback: false, now: () => new Date("2026-09-07T00:00:00Z") });
  const result = await service.getMandiRates({ commodity: "Onion", location: "Ahmedabad", limit: 5 });
  assert.equal(result.mode, "OFFICIAL");
  assert.equal(result.totalAvailable, 10);
  assert.equal(result.rates.length, 5);
  assert.deepEqual(result.rates.map(rate => rate.rank), [1, 2, 3, 4, 5]);
  assert.equal(result.rates[0].isRecommended, true);
  assert.equal(result.rates.slice(1).every(rate => !rate.isRecommended), true);
  assert.equal(result.rates.every(rate => rate.source === OFFICIAL_SOURCE && !rate.isFallback), true);
});

test("ranking balances price, proximity, freshness and completeness without inventing distance", () => {
  const records = [
    normalizeOfficialRecord(officialRow("Ahmedabad APMC", "Ahmedabad", "Tomato", 2400, "07/09/2026")),
    normalizeOfficialRecord(officialRow("Far High Price", "Surat", "Tomato", 2500, "07/09/2026")),
    normalizeOfficialRecord(officialRow("Stale Market", "Ahmedabad", "Tomato", 2450, "01/01/2026"))
  ];
  const ranked = rankMandiRates({
    records, location: "Ahmedabad", now: new Date("2026-09-07T00:00:00Z"),
    districtCoordinates: { Ahmedabad: [23.0225, 72.5714], Surat: [21.1702, 72.8311] }
  });
  assert.equal(ranked[0].mandi, "Ahmedabad APMC");
  assert.equal(ranked[0].distanceKm, null);
  assert.equal(ranked[0].priceScore <= 45, true);
  assert.equal(ranked[0].proximityScore <= 30, true);
  assert.equal(ranked[0].freshnessScore <= 20, true);
  assert.equal(ranked[0].completenessScore <= 5, true);
});

test("Ahmedabad Tomato and Vadodara Onion official discovery remain commodity-specific", async () => {
  const rows = [
    officialRow("Ahmedabad APMC", "Ahmedabad", "Tomato", 2300),
    officialRow("Sanand APMC", "Ahmedabad", "Tomato", 2350),
    officialRow("Vadodara APMC", "Vadodara", "Onion", 2200),
    officialRow("Padra APMC", "Vadodara", "Onion", 2250)
  ];
  const service = createMarketDataService({ officialProvider: providerFor(rows), allowDemoFallback: false, now: () => new Date("2026-09-07T00:00:00Z") });
  const tomato = await service.getMandiRates({ commodity: "Tomato", location: "Ahmedabad" });
  const onion = await service.getMandiRates({ commodity: "Onion", location: "Vadodara" });
  assert.equal(tomato.rates.every(rate => rate.commodity === "Tomato"), true);
  assert.equal(onion.rates.every(rate => rate.commodity === "Onion"), true);
});

test("official failure uses cached official data, while demo fallback requires explicit opt-in", async () => {
  let succeeds = true;
  const provider = { async fetchRates() {
    if (!succeeds) return { ok: false, errorCode: "DATA_GOV_IN_REQUEST_FAILED", records: [] };
    return { ok: true, records: [normalizeOfficialRecord(officialRow("Ahmedabad APMC", "Ahmedabad", "Onion", 2300))] };
  } };
  const service = createMarketDataService({ officialProvider: provider, allowDemoFallback: false, now: () => new Date("2026-09-07T00:00:00Z") });
  assert.equal((await service.getMandiRates({ commodity: "Onion", location: "Ahmedabad" })).mode, "OFFICIAL");
  succeeds = false;
  assert.equal((await service.getMandiRates({ commodity: "Onion", location: "Ahmedabad" })).mode, "CACHE");

  const unavailable = createMarketDataService({ officialProvider: { async fetchRates() { return { ok: false, records: [], errorCode: "DOWN" }; } }, allowDemoFallback: false });
  assert.equal((await unavailable.getMandiRates({ commodity: "Onion", location: "Ahmedabad" })).rates.length, 0);
  const demo = createMarketDataService({ officialProvider: { async fetchRates() { return { ok: false, records: [], errorCode: "DOWN" }; } }, allowDemoFallback: true });
  const fallback = await demo.getMandiRates({ commodity: "Onion", location: "Ahmedabad" });
  assert.equal(fallback.mode, "FALLBACK");
  assert.equal(fallback.rates.every(rate => rate.source === "Demo fallback" && rate.isFallback), true);
});

test("native-language mandi voice uses only returned records and recommends rank one", () => {
  const rates = rankMandiRates({
    records: [normalizeOfficialRecord(officialRow("Ahmedabad APMC", "Ahmedabad", "Onion", 2400))],
    location: "Ahmedabad", now: new Date("2026-09-07T00:00:00Z"), districtCoordinates: { Ahmedabad: [23, 72] }
  });
  const speech = mandiVoiceAnnouncement({ rates, totalAvailable: 1 }, "Onion", "Ahmedabad", "gu-IN");
  assert.match(speech, /Ahmedabad APMC/);
  assert.doesNotMatch(speech, /2400/);
  assert.match(speech, /મંડ/);
});

test("India-wide official discovery uses one generic state-scoped flow", async () => {
  const cases = [
    ["Ahmedabad", "Ahmedabad", "Gujarat"], ["Nashik", "Nashik", "Maharashtra"],
    ["Indore", "Indore", "Madhya Pradesh"], ["Jaipur", "Jaipur", "Rajasthan"],
    ["Lucknow", "Lucknow", "Uttar Pradesh"], ["Ludhiana", "Ludhiana", "Punjab"],
    ["Kolkata", "Kolkata", "West Bengal"], ["Bhubaneswar", "Khordha", "Odisha"],
    ["Hyderabad", "Hyderabad", "Telangana"], ["Guntur", "Guntur", "Andhra Pradesh"],
    ["Bengaluru", "Bengaluru Urban", "Karnataka"], ["Chennai", "Chennai", "Tamil Nadu"],
    ["Kochi", "Ernakulam", "Kerala"], ["Guwahati", "Kamrup Metropolitan", "Assam"]
  ];
  for (const [city, district, state] of cases) {
    let requestedLocation;
    const provider = { async fetchRates({ commodity, location }) {
      requestedLocation = location;
      return {
        ok: true,
        records: [
          normalizeOfficialRecord(officialRow(`${city} Official Market`, district, commodity, 2300, "07/09/2026", state)),
          normalizeOfficialRecord(officialRow("Other State Market", "Remote", commodity, 2500, "07/09/2026", "Other State"))
        ]
      };
    } };
    const service = createMarketDataService({ officialProvider: provider, allowDemoFallback: false, now: () => new Date("2026-09-08T00:00:00Z") });
    const result = await service.getMandiRates({ commodity: "Onion", location: city });
    assert.equal(requestedLocation.state, state, city);
    assert.equal(result.location.state, state, city);
    assert.equal(result.rates[0].mandi, `${city} Official Market`, city);
    assert.equal(result.rates[0].source, OFFICIAL_SOURCE, city);
    assert.equal(extractFarmerData(city).location, city, city);
  }
});

test("an unfamiliar district is resolved from official records before same-state expansion", async () => {
  const requested = [];
  const provider = { async fetchRates({ commodity, location }) {
    requested.push({ district: location.district, state: location.state });
    if (!location.state) {
      return { ok: true, records: [normalizeOfficialRecord(officialRow("Pune Exact Market", "Pune", commodity, 2200, "07/09/2026", "Maharashtra"))] };
    }
    return { ok: true, records: [
      normalizeOfficialRecord(officialRow("Pune Exact Market", "Pune", commodity, 2200, "07/09/2026", "Maharashtra")),
      normalizeOfficialRecord(officialRow("Nearby Maharashtra Market", "Satara", commodity, 2250, "07/09/2026", "Maharashtra"))
    ] };
  } };
  const service = createMarketDataService({ officialProvider: provider, allowDemoFallback: false, now: () => new Date("2026-09-08T00:00:00Z") });
  const result = await service.getMandiRates({ commodity: "Onion", location: "Pune" });
  assert.deepEqual(requested, [{ district: "Pune", state: null }, { district: "Pune", state: "Maharashtra" }]);
  assert.equal(result.location.state, "Maharashtra");
  assert.equal(result.rates.length, 2);
  assert.equal(result.rates[0].mandi, "Pune Exact Market");
});
