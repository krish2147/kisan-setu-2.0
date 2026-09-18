const assert = require("node:assert/strict");
const test = require("node:test");

const {
  haversineDistanceKm,
  rankMatches,
  selectCallableMatch
} = require("../src/matching");

function listing(overrides = {}) {
  return {
    listingId: overrides.listingId ?? 1,
    participantId: overrides.participantId ?? overrides.listingId ?? 1,
    participantType: overrides.participantType ?? "BUYER",
    name: overrides.name ?? `Demo Candidate ${overrides.listingId ?? 1}`,
    phone: overrides.phone ?? null,
    verified: overrides.verified ?? true,
    participantActive: overrides.participantActive ?? true,
    listingActive: overrides.listingActive ?? true,
    side: overrides.side ?? "BUY",
    commodity: overrides.commodity ?? "Tomato",
    quantityKg: overrides.quantityKg ?? 500,
    pricePerKg: Object.hasOwn(overrides, "pricePerKg") ? overrides.pricePerKg : 24,
    location: overrides.location ?? "Vadodara",
    latitude: Object.hasOwn(overrides, "latitude") ? overrides.latitude : null,
    longitude: Object.hasOwn(overrides, "longitude") ? overrides.longitude : null,
    expiresAt: overrides.expiresAt ?? null
  };
}

test("SELL requests match buyers only while BUY requests match sellers only", () => {
  const candidates = [
    listing({ listingId: 1, side: "BUY", participantType: "BUYER" }),
    listing({ listingId: 2, side: "SELL", participantType: "SELLER" })
  ];
  assert.deepEqual(rankMatches({ intent: "SELL", commodity: "Tomato", quantityKg: 500, location: "Vadodara" }, candidates).map(x => x.side), ["BUY"]);
  assert.deepEqual(rankMatches({ intent: "BUY", commodity: "Tomato", quantityKg: 500, location: "Vadodara" }, candidates).map(x => x.side), ["SELL"]);
});

test("wrong crop and inactive listings or participants are excluded", () => {
  const candidates = [
    listing({ listingId: 1 }),
    listing({ listingId: 2, commodity: "Onion" }),
    listing({ listingId: 3, listingActive: false }),
    listing({ listingId: 4, participantActive: false })
  ];
  const matches = rankMatches({ intent: "SELL", commodity: "Tomato", quantityKg: 500, location: "Vadodara" }, candidates);
  assert.deepEqual(matches.map(match => match.listingId), [1]);
});

test("cross-city matching is allowed and Haversine distance is deterministic", () => {
  const matches = rankMatches(
    { intent: "SELL", commodity: "Tomato", quantityKg: 500, location: "Vadodara" },
    [listing({ listingId: 1, location: "Ahmedabad" }), listing({ listingId: 2, location: "Anand" })]
  );
  assert.equal(matches.length, 2);
  assert.ok(matches.every(match => match.location !== "Vadodara"));
  const distance = haversineDistanceKm(
    { latitude: 22.3072, longitude: 73.1812 },
    { latitude: 23.0225, longitude: 72.5714 }
  );
  assert.ok(distance > 95 && distance < 120);
});

test("SELL price scoring prefers a higher buyer bid", () => {
  const matches = rankMatches(
    { intent: "SELL", commodity: "Tomato", quantityKg: 500, location: "Vadodara" },
    [listing({ listingId: 1, pricePerKg: 22 }), listing({ listingId: 2, pricePerKg: 25 })]
  );
  assert.equal(matches[0].listingId, 2);
  assert.equal(matches[0].priceScore, 40);
  assert.equal(matches[1].priceScore, 0);
});

test("BUY price scoring prefers a lower seller ask", () => {
  const candidates = [
    listing({ listingId: 1, side: "SELL", participantType: "SELLER", pricePerKg: 22 }),
    listing({ listingId: 2, side: "SELL", participantType: "SELLER", pricePerKg: 19 })
  ];
  const matches = rankMatches({ intent: "BUY", commodity: "Tomato", quantityKg: 500, location: "Vadodara" }, candidates);
  assert.equal(matches[0].listingId, 2);
  assert.equal(matches[0].priceScore, 40);
});

test("quantity compatibility allows partial matches but rewards full supply", () => {
  const matches = rankMatches(
    { intent: "SELL", commodity: "Tomato", quantityKg: 500, location: "Vadodara" },
    [listing({ listingId: 1, quantityKg: 500 }), listing({ listingId: 2, quantityKg: 50 })]
  );
  assert.equal(matches[0].matchedQuantityKg, 500);
  assert.equal(matches[0].quantityScore, 20);
  assert.equal(matches[1].matchedQuantityKg, 50);
  assert.equal(matches[1].quantityScore, 2);
});

test("verification contributes ten points without dominating ranking", () => {
  const matches = rankMatches(
    { intent: "SELL", commodity: "Tomato", quantityKg: 500, location: "Vadodara" },
    [listing({ listingId: 1, verified: false }), listing({ listingId: 2, verified: true })]
  );
  assert.equal(matches[0].listingId, 2);
  assert.equal(matches[0].verificationScore, 10);
  assert.equal(matches[1].verificationScore, 0);
});

test("ranking is deterministic, limited to Top 5, and rank 1 is recommended", () => {
  const candidates = Array.from({ length: 8 }, (_, index) => listing({ listingId: index + 1, name: `Demo ${index + 1}` }));
  const first = rankMatches({ intent: "SELL", commodity: "Tomato", quantityKg: 500, location: "Vadodara" }, candidates);
  const second = rankMatches({ intent: "SELL", commodity: "Tomato", quantityKg: 500, location: "Vadodara" }, [...candidates].reverse());
  assert.equal(first.length, 5);
  assert.deepEqual(first.map(match => match.listingId), second.map(match => match.listingId));
  assert.equal(first[0].rank, 1);
  assert.equal(first[0].isRecommended, true);
  assert.equal(first.filter(match => match.isRecommended).length, 1);
});

test("zero and one candidate cases are handled sensibly", () => {
  const request = { intent: "SELL", commodity: "Tomato", quantityKg: 500, location: "Vadodara" };
  assert.deepEqual(rankMatches(request, []), []);
  const only = rankMatches(request, [listing({ listingId: 7 })]);
  assert.equal(only.length, 1);
  assert.equal(only[0].priceScore, 40);
  assert.equal(only[0].isRecommended, true);
});

test("missing price and coordinates receive neutral reduced-confidence scores", () => {
  const matches = rankMatches(
    { intent: "SELL", commodity: "Tomato", quantityKg: 500, location: "Unknown Place" },
    [
      listing({ listingId: 1, pricePerKg: 24, location: "Unknown A", latitude: null, longitude: null }),
      listing({ listingId: 2, pricePerKg: null, location: "Unknown B", latitude: null, longitude: null })
    ]
  );
  const missing = matches.find(match => match.listingId === 2);
  assert.equal(missing.priceScore, 20);
  assert.equal(missing.distanceScore, 15);
  assert.equal(missing.distanceKm, null);
  assert.notEqual(matches[0].listingId, 2);
});

test("callable selection preserves true rank order and skips missing phones", () => {
  const callable = selectCallableMatch([
    { rank: 1, phone: null },
    { rank: 2, phone: "+12025550123" },
    { rank: 3, phone: "+12025550124" }
  ]);
  assert.equal(callable.rank, 2);
});
