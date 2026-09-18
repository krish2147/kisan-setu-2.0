const { normalizeIndianPhoneNumber } = require("./sms");
const LOCATION_COORDINATES = Object.freeze({
  Vadodara: Object.freeze({ latitude: 22.3072, longitude: 73.1812 }),
  Ahmedabad: Object.freeze({ latitude: 23.0225, longitude: 72.5714 }),
  Anand: Object.freeze({ latitude: 22.5645, longitude: 72.9289 }),
  Surat: Object.freeze({ latitude: 21.1702, longitude: 72.8311 })
});

const SCORE_WEIGHTS = Object.freeze({
  price: 40,
  distance: 30,
  quantity: 20,
  verification: 10
});

const UNKNOWN_COMPONENT_SCORE = 50;
const DISTANCE_ZERO_SCORE_KM = 250;

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function coordinatesForLocation(location) {
  const key = Object.keys(LOCATION_COORDINATES)
    .find(name => name.toLowerCase() === String(location || "").toLowerCase());
  return key ? LOCATION_COORDINATES[key] : null;
}

function haversineDistanceKm(from, to) {
  if (!from || !to) return null;
  const lat1 = finiteNumber(from.latitude);
  const lon1 = finiteNumber(from.longitude);
  const lat2 = finiteNumber(to.latitude);
  const lon2 = finiteNumber(to.longitude);
  if ([lat1, lon1, lat2, lon2].some(value => value === null)) return null;
  const radians = degrees => degrees * Math.PI / 180;
  const latitudeDelta = radians(lat2 - lat1);
  const longitudeDelta = radians(lon2 - lon1);
  const a = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function listingValue(listing, camel, snake) {
  return listing[camel] ?? listing[snake] ?? null;
}

function normalizeListing(listing) {
  return {
    listingId: listingValue(listing, "listingId", "listing_id") ?? listing.id,
    participantId: listingValue(listing, "participantId", "participant_id"),
    participantType: listingValue(listing, "participantType", "participant_type") ?? listing.type,
    name: listing.name,
    phone: listing.phone,
    verified: Boolean(listing.verified),
    participantActive: listingValue(listing, "participantActive", "participant_active") ?? listing.active,
    side: listing.side,
    commodity: listing.commodity,
    quantityKg: finiteNumber(listingValue(listing, "quantityKg", "quantity_kg")),
    pricePerKg: finiteNumber(listingValue(listing, "pricePerKg", "price_per_kg")),
    location: listingValue(listing, "listingLocation", "listing_location") ?? listing.location,
    latitude: finiteNumber(listingValue(listing, "listingLatitude", "listing_latitude") ?? listing.latitude),
    longitude: finiteNumber(listingValue(listing, "listingLongitude", "listing_longitude") ?? listing.longitude),
    listingActive: listingValue(listing, "listingActive", "listing_active") ?? listing.active,
    expiresAt: listingValue(listing, "expiresAt", "expires_at")
  };
}

function rawPriceScore(price, knownPrices, intent) {
  if (price === null) return UNKNOWN_COMPONENT_SCORE;
  if (knownPrices.length <= 1) return 100;
  const minimum = Math.min(...knownPrices);
  const maximum = Math.max(...knownPrices);
  if (maximum === minimum) return 100;
  return intent === "SELL"
    ? ((price - minimum) / (maximum - minimum)) * 100
    : ((maximum - price) / (maximum - minimum)) * 100;
}

function rawDistanceScore(distanceKm) {
  if (distanceKm === null) return UNKNOWN_COMPONENT_SCORE;
  return Math.max(0, 100 * (1 - distanceKm / DISTANCE_ZERO_SCORE_KM));
}

function rawQuantityScore(listingQuantity, requestedQuantity) {
  if (!listingQuantity || !requestedQuantity) return 0;
  return Math.min(100, Math.min(listingQuantity, requestedQuantity) / requestedQuantity * 100);
}

function formatValue(value) {
  if (Number.isInteger(value)) return String(value);
  return Number(value).toFixed(1).replace(/\.0$/, "");
}

function recommendationReason(match, intent) {
  const role = intent === "SELL" ? "buyer" : "seller";
  const quantityPhrase = match.matchedQuantityKg >= match.requestedQuantityKg
    ? `${role === "buyer" ? "can purchase" : "has"} the full ${formatValue(match.requestedQuantityKg)} kg`
    : `${role === "buyer" ? "can purchase" : "has"} ${formatValue(match.matchedQuantityKg)} kg of the requested ${formatValue(match.requestedQuantityKg)} kg`;
  const parts = [match.verified ? `verified ${role}` : `unverified ${role}`];
  parts.push(match.distanceKm === null ? "distance unavailable" : `${formatValue(match.distanceKm)} km away`);
  parts.push(quantityPhrase);
  if (match.pricePerKg !== null) {
    parts.push(`${intent === "SELL" ? "offers" : "asks"} ₹${formatValue(match.pricePerKg)}/kg`);
  } else {
    parts.push("price not provided");
  }
  return `${match.isRecommended ? "Best overall match" : "Overall match"}: ${parts.join(", ")}.`;
}

function rankMatches(request, candidates, options = {}) {
  const intent = String(request.intent || "").toUpperCase();
  const targetSide = intent === "SELL" ? "BUY" : intent === "BUY" ? "SELL" : null;
  const requestedQuantityKg = finiteNumber(request.quantityKg);
  const commodity = String(request.commodity || "").toLowerCase();
  const now = options.now ? new Date(options.now) : new Date();
  if (!targetSide || !commodity || !requestedQuantityKg || requestedQuantityKg <= 0) return [];

  const callerPhone = normalizeIndianPhoneNumber(request.callerNumber);
  const eligible = candidates.map(normalizeListing).filter(listing => {
    const expiresAt = listing.expiresAt ? new Date(listing.expiresAt) : null;
    return (!callerPhone || normalizeIndianPhoneNumber(listing.phone) !== callerPhone) &&
      listing.side === targetSide &&
      String(listing.commodity || "").toLowerCase() === commodity &&
      Boolean(listing.listingActive) && Boolean(listing.participantActive) &&
      listing.quantityKg !== null && listing.quantityKg > 0 &&
      (!expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt > now);
  });
  if (!eligible.length) return [];

  const knownPrices = eligible.map(listing => listing.pricePerKg).filter(price => price !== null);
  const requestCoordinates = coordinatesForLocation(request.location);
  const scored = eligible.map(listing => {
    const listingCoordinates = listing.latitude !== null && listing.longitude !== null
      ? { latitude: listing.latitude, longitude: listing.longitude }
      : coordinatesForLocation(listing.location);
    const rawDistance = haversineDistanceKm(requestCoordinates, listingCoordinates);
    const distanceKm = rawDistance === null ? null : Math.round(rawDistance * 10) / 10;
    const matchedQuantityKg = Math.min(requestedQuantityKg, listing.quantityKg);
    const priceScore = rawPriceScore(listing.pricePerKg, knownPrices, intent) / 100 * SCORE_WEIGHTS.price;
    const distanceScore = rawDistanceScore(distanceKm) / 100 * SCORE_WEIGHTS.distance;
    const quantityScore = rawQuantityScore(listing.quantityKg, requestedQuantityKg) / 100 * SCORE_WEIGHTS.quantity;
    const verificationScore = listing.verified ? SCORE_WEIGHTS.verification : 0;
    const score = priceScore + distanceScore + quantityScore + verificationScore;
    return {
      ...listing,
      requestedQuantityKg,
      matchedQuantityKg,
      distanceKm,
      priceScore: Math.round(priceScore * 100) / 100,
      distanceScore: Math.round(distanceScore * 100) / 100,
      quantityScore: Math.round(quantityScore * 100) / 100,
      verificationScore,
      score: Math.round(score * 100) / 100
    };
  });

  scored.sort((a, b) =>
    b.score - a.score ||
    (a.distanceKm ?? Number.POSITIVE_INFINITY) - (b.distanceKm ?? Number.POSITIVE_INFINITY) ||
    String(a.listingId).localeCompare(String(b.listingId)) ||
    String(a.name).localeCompare(String(b.name))
  );

  return scored.slice(0, Math.min(5, Math.max(1, Number(options.limit) || 5))).map((match, index) => {
    const ranked = { ...match, rank: index + 1, isRecommended: index === 0 };
    return { ...ranked, reason: recommendationReason(ranked, intent) };
  });
}

function isValidCallablePhone(phone) {
  return /^\+[1-9]\d{7,14}$/.test(String(phone || ""));
}

function selectCallableMatch(matches = []) {
  return matches.find(match => isValidCallablePhone(match.phone)) || null;
}

module.exports = {
  LOCATION_COORDINATES,
  SCORE_WEIGHTS,
  coordinatesForLocation,
  haversineDistanceKm,
  isValidCallablePhone,
  rankMatches,
  selectCallableMatch
};
