const PRICE_WEIGHT = 45;
const PROXIMITY_WEIGHT = 30;
const FRESHNESS_WEIGHT = 20;
const COMPLETENESS_WEIGHT = 5;

function radians(value) {
  return Number(value) * Math.PI / 180;
}

function hasCoordinates(latitude, longitude) {
  return latitude !== null && latitude !== undefined && longitude !== null && longitude !== undefined &&
    Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude));
}

function haversineKm(left, right) {
  if (!left || !right || ![...left, ...right].every(Number.isFinite)) return null;
  const earthRadiusKm = 6371;
  const dLat = radians(right[0] - left[0]);
  const dLon = radians(right[1] - left[1]);
  const value = Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(left[0])) * Math.cos(radians(right[0])) * Math.sin(dLon / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function freshnessScore(observedAt, now) {
  const observed = Date.parse(observedAt);
  if (!Number.isFinite(observed)) return { score: 0, days: null };
  const days = Math.max(0, Math.floor((now.getTime() - observed) / 86400000));
  if (days <= 1) return { score: FRESHNESS_WEIGHT, days };
  if (days <= 3) return { score: 16, days };
  if (days <= 7) return { score: 11, days };
  if (days <= 30) return { score: 5, days };
  return { score: 0, days };
}

function completenessScore(record) {
  const fields = ["mandi", "district", "state", "commodity", "minPrice", "maxPrice", "modalPrice", "observedAt"];
  const available = fields.filter(field => record[field] !== null && record[field] !== undefined && record[field] !== "").length;
  return COMPLETENESS_WEIGHT * available / fields.length;
}

function rankMandiRates({ records = [], location, districtCoordinates = {}, now = new Date(), limit = 5 }) {
  const eligible = records.filter(record => Number.isFinite(Number(record.modalPrice)) && Number(record.modalPrice) > 0);
  if (!eligible.length) return [];
  const prices = eligible.map(record => Number(record.modalPrice));
  const maxPrice = Math.max(...prices);
  const locationInfo = typeof location === "object"
    ? location
    : { city: location, district: location, state: null, latitude: null, longitude: null, districtAliases: [] };
  const origin = hasCoordinates(locationInfo.latitude, locationInfo.longitude)
    ? [Number(locationInfo.latitude), Number(locationInfo.longitude)]
    : districtCoordinates[locationInfo.district] || districtCoordinates[locationInfo.city] || null;
  const expectedDistricts = [locationInfo.district, locationInfo.city, ...(locationInfo.districtAliases || [])]
    .filter(Boolean).map(value => String(value).toLowerCase());

  return eligible.map((record, index) => {
    const modalPrice = Number(record.modalPrice);
    // Relative-to-best scoring keeps price important without giving a small
    // price spread the entire 50-point range.
    const priceScore = maxPrice > 0 ? PRICE_WEIGHT * modalPrice / maxPrice : PRICE_WEIGHT / 2;
    const exactDistrict = expectedDistricts.includes(String(record.district || "").toLowerCase());
    const sameState = locationInfo.state && String(record.state || "").toLowerCase() === String(locationInfo.state).toLowerCase();
    const directCoordinates = hasCoordinates(record.latitude, record.longitude);
    const directDistanceKm = directCoordinates && origin
      ? haversineKm(origin, [Number(record.latitude), Number(record.longitude)])
      : null;
    const districtDistanceKm = origin && districtCoordinates[record.district]
      ? haversineKm(origin, districtCoordinates[record.district])
      : null;
    const rankingDistanceKm = directDistanceKm ?? districtDistanceKm;
    const proximityScore = exactDistrict
      ? PROXIMITY_WEIGHT
      : rankingDistanceKm === null
        ? (sameState ? 15 : 2)
        : PROXIMITY_WEIGHT * Math.max(sameState ? 0.2 : 0.05, 1 - rankingDistanceKm / 1000);
    const freshness = freshnessScore(record.observedAt, now);
    const completeness = completenessScore(record);
    const score = priceScore + proximityScore + freshness.score + completeness;
    return {
      ...record,
      modal: modalPrice,
      distanceKm: directDistanceKm === null ? null : Math.round(directDistanceKm * 10) / 10,
      score: Math.round(score * 10) / 10,
      priceScore: Math.round(priceScore * 10) / 10,
      proximityScore: Math.round(proximityScore * 10) / 10,
      freshnessScore: freshness.score,
      completenessScore: Math.round(completeness * 10) / 10,
      freshnessDays: freshness.days,
      originalOrder: index
    };
  }).sort((a, b) =>
    b.score - a.score ||
    b.modalPrice - a.modalPrice ||
    (a.freshnessDays ?? Number.MAX_SAFE_INTEGER) - (b.freshnessDays ?? Number.MAX_SAFE_INTEGER) ||
    a.mandi.localeCompare(b.mandi) || a.originalOrder - b.originalOrder
  ).slice(0, Math.max(0, Math.min(5, Number(limit) || 5))).map((record, index) => ({
    ...record,
    rank: index + 1,
    isRecommended: index === 0,
    reason: index === 0
      ? "Best available balance of modal price, proximity, freshness, and record completeness."
      : null
  }));
}

module.exports = {
  COMPLETENESS_WEIGHT,
  FRESHNESS_WEIGHT,
  PRICE_WEIGHT,
  PROXIMITY_WEIGHT,
  freshnessScore,
  haversineKm,
  rankMandiRates
};
