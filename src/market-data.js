const fallbackRecords = require("../data/mandi-fallback.json");
const { rankMandiRates } = require("./mandi-ranking");
const { districtCoordinates, normalizeIndiaLocation } = require("./location");

const DATA_GOV_IN_ENDPOINT = "https://api.data.gov.in/resource";
const DEFAULT_AGMARKNET_RESOURCE_ID = "9ef84268-d588-465a-a308-a864a43d0070";
const OFFICIAL_SOURCE = "AGMARKNET / data.gov.in";
const OFFICIAL_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const DEMO_DISTRICT_COORDINATES = Object.freeze({
  Vadodara: [22.3072, 73.1812], Ahmedabad: [23.0225, 72.5714], Anand: [22.5645, 72.9289],
  Surat: [21.1702, 72.8311], Rajkot: [22.3039, 70.8022], Gandhinagar: [23.2156, 72.6369],
  Kheda: [22.7507, 72.6847], Bharuch: [21.7051, 72.9959], Mehsana: [23.5880, 72.3693],
  Banaskantha: [24.1724, 72.4346], Sabarkantha: [23.6863, 73.0000], Panchmahal: [22.7772, 73.6200],
  Junagadh: [21.5222, 70.4579], Amreli: [21.6032, 71.2221], Bhavnagar: [21.7645, 72.1519],
  Navsari: [20.9467, 72.9520]
});
const DISTRICT_COORDINATES = Object.freeze({ ...DEMO_DISTRICT_COORDINATES, ...districtCoordinates() });

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeMarketLocation(value) {
  const normalized = normalizeIndiaLocation(value);
  return normalized.city || normalized.district || String(value || "").trim();
}

function distanceBetweenDistricts(left, right) {
  const leftLocation = normalizeIndiaLocation(left);
  const rightLocation = normalizeIndiaLocation(right);
  const a = Number.isFinite(leftLocation.latitude) && Number.isFinite(leftLocation.longitude)
    ? [leftLocation.latitude, leftLocation.longitude]
    : DISTRICT_COORDINATES[leftLocation.district];
  const b = Number.isFinite(rightLocation.latitude) && Number.isFinite(rightLocation.longitude)
    ? [rightLocation.latitude, rightLocation.longitude]
    : DISTRICT_COORDINATES[rightLocation.district];
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const radians = value => value * Math.PI / 180;
  const earthRadiusKm = 6371;
  const dLat = radians(b[0] - a[0]);
  const dLon = radians(b[1] - a[1]);
  const value = Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(a[0])) * Math.cos(radians(b[0])) * Math.sin(dLon / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function normalizeDate(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (match) return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
}

function finitePrice(value) {
  const parsed = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function finiteCoordinate(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeOfficialRecord(record) {
  const mandi = String(record.market || record.mandi || "").trim();
  const commodity = String(record.commodity || "").trim();
  const modalPrice = finitePrice(record.modal_price ?? record.modalPrice);
  if (!mandi || !commodity || !modalPrice) return null;
  return {
    mandi,
    district: String(record.district || "").trim() || null,
    state: String(record.state || "").trim() || null,
    commodity,
    variety: String(record.variety || "").trim() || null,
    minPrice: finitePrice(record.min_price ?? record.minPrice),
    maxPrice: finitePrice(record.max_price ?? record.maxPrice),
    modalPrice,
    modal: modalPrice,
    unit: "₹/quintal",
    observedAt: normalizeDate(record.arrival_date ?? record.observedAt),
    source: OFFICIAL_SOURCE,
    isFallback: false,
    latitude: finiteCoordinate(record.latitude),
    longitude: finiteCoordinate(record.longitude),
    distanceKm: null,
    spokenName: null
  };
}

function normalizeFallbackRecord(record) {
  return {
    ...record,
    variety: record.variety || null,
    modal: record.modalPrice,
    latitude: finiteCoordinate(record.latitude),
    longitude: finiteCoordinate(record.longitude),
    distanceKm: null,
    spokenName: null
  };
}

function createDataGovInProvider({
  apiKey = process.env.DATA_GOV_IN_API_KEY,
  resourceId = process.env.AGMARKNET_RESOURCE_ID || DEFAULT_AGMARKNET_RESOURCE_ID,
  fetchImpl = globalThis.fetch,
  timeoutMs = 10000
} = {}) {
  async function fetchRates({ commodity, location }) {
    if (!apiKey || !resourceId) return { ok: false, errorCode: "MISSING_DATA_GOV_IN_CONFIGURATION", records: [] };
    if (typeof fetchImpl !== "function") return { ok: false, errorCode: "FETCH_UNAVAILABLE", records: [] };
    const url = new URL(`${DATA_GOV_IN_ENDPOINT}/${encodeURIComponent(resourceId)}`);
    url.searchParams.set("api-key", apiKey);
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", "100");
    url.searchParams.set("offset", "0");
    const normalizedLocation = normalizeIndiaLocation(location);
    if (normalizedLocation.state) url.searchParams.set("filters[state]", normalizedLocation.state);
    else if (normalizedLocation.district) url.searchParams.set("filters[district]", normalizedLocation.district);
    url.searchParams.set("filters[commodity]", commodity);
    try {
      const response = await fetchImpl(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) return { ok: false, errorCode: `DATA_GOV_IN_HTTP_${response.status}`, records: [] };
      const payload = await response.json();
      const records = (Array.isArray(payload.records) ? payload.records : [])
        .map(normalizeOfficialRecord)
        .filter(Boolean)
        .filter(record => normalizeKey(record.commodity) === normalizeKey(commodity));
      return { ok: true, records, total: Number(payload.total) || records.length };
    } catch (error) {
      return {
        ok: false,
        errorCode: error?.name === "TimeoutError" ? "DATA_GOV_IN_TIMEOUT" : "DATA_GOV_IN_REQUEST_FAILED",
        records: []
      };
    }
  }
  return { fetchRates, resourceId };
}

function selectFallbackRates(fallback, commodity, location, limit) {
  const commodityKey = normalizeKey(commodity);
  const locationInfo = normalizeIndiaLocation(location);
  if (locationInfo.state && locationInfo.state !== "Gujarat") return [];
  const canonicalLocation = locationInfo.district || locationInfo.city;
  const candidates = fallback.filter(record => normalizeKey(record.commodity) === commodityKey);
  const exact = candidates.filter(record => normalizeKey(record.district) === normalizeKey(canonicalLocation));
  const selected = exact.slice(0, limit);
  if (selected.length < limit) {
    const nearby = candidates
      .filter(record => normalizeKey(record.district) !== normalizeKey(canonicalLocation))
      .sort((a, b) =>
        distanceBetweenDistricts(canonicalLocation, a.district) - distanceBetweenDistricts(canonicalLocation, b.district) ||
        a.district.localeCompare(b.district) || a.mandi.localeCompare(b.mandi)
      );
    for (const record of nearby) {
      if (selected.length >= limit) break;
      if (!selected.some(item => item.mandi === record.mandi && item.district === record.district)) selected.push(record);
    }
  }
  return selected.map(normalizeFallbackRecord);
}

function createMarketDataService({
  fallback = fallbackRecords,
  officialProvider = createDataGovInProvider(),
  allowDemoFallback = process.env.MANDI_ALLOW_DEMO_FALLBACK === "true",
  cacheTtlMs = OFFICIAL_CACHE_TTL_MS,
  now = () => new Date()
} = {}) {
  const officialCache = new Map();

  function getRates({ commodity, location, limit = 3 }) {
    const safeLimit = Math.max(0, Math.min(3, Number(limit) || 3));
    if (!commodity || !location || !safeLimit) return [];
    return selectFallbackRates(fallback, commodity, location, safeLimit);
  }

  async function getMandiRates({ commodity, location, limit = 5 }) {
    let normalizedLocation = normalizeIndiaLocation(location);
    const canonicalLocation = normalizedLocation.city || normalizedLocation.district;
    const safeLimit = Math.max(0, Math.min(5, Number(limit) || 5));
    if (!commodity || !canonicalLocation || !safeLimit) {
      return { rates: [], totalAvailable: 0, source: null, mode: "UNAVAILABLE", errorCode: "INVALID_MARKET_QUERY" };
    }
    const searchScope = normalizedLocation.state || normalizedLocation.district || "india";
    const cacheKey = `${normalizeKey(commodity)}|${normalizeKey(searchScope)}`;
    let fetched = await officialProvider.fetchRates({ commodity, location: normalizedLocation });
    // For an unfamiliar Indian district, discover its state from the exact
    // official district response, then expand within that state. This avoids
    // city-specific call-flow code and never guesses a state.
    if (!normalizedLocation.state && fetched.ok && fetched.records.length) {
      const stateCounts = new Map();
      for (const record of fetched.records) {
        if (record.state) stateCounts.set(record.state, (stateCounts.get(record.state) || 0) + 1);
      }
      const inferredState = [...stateCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
      if (inferredState) {
        normalizedLocation = { ...normalizedLocation, state: inferredState };
        const expanded = await officialProvider.fetchRates({ commodity, location: normalizedLocation });
        if (expanded.ok) {
          const unique = new Map();
          for (const record of [...fetched.records, ...expanded.records]) {
            unique.set([record.state, record.district, record.mandi, record.variety, record.observedAt].join("|"), record);
          }
          fetched = { ...expanded, records: [...unique.values()], total: unique.size };
        }
      }
    }
    if (fetched.ok && fetched.records.length) {
      officialCache.set(cacheKey, { records: fetched.records, fetchedAt: now().getTime(), total: fetched.total });
      const rates = rankMandiRates({ records: fetched.records, location: normalizedLocation, districtCoordinates: DISTRICT_COORDINATES, now: now(), limit: safeLimit });
      return { rates, totalAvailable: fetched.records.length, source: OFFICIAL_SOURCE, mode: "OFFICIAL", fromCache: false, location: normalizedLocation };
    }

    const cached = officialCache.get(cacheKey);
    if (cached && now().getTime() - cached.fetchedAt <= cacheTtlMs) {
      const rates = rankMandiRates({ records: cached.records, location: normalizedLocation, districtCoordinates: DISTRICT_COORDINATES, now: now(), limit: safeLimit });
      return { rates, totalAvailable: cached.records.length, source: OFFICIAL_SOURCE, mode: "CACHE", fromCache: true, errorCode: fetched.errorCode || null, location: normalizedLocation };
    }

    if (allowDemoFallback) {
      const records = selectFallbackRates(fallback, commodity, normalizedLocation, 5);
      const rates = rankMandiRates({ records, location: normalizedLocation, districtCoordinates: DISTRICT_COORDINATES, now: now(), limit: safeLimit });
      return { rates, totalAvailable: records.length, source: "Demo fallback", mode: "FALLBACK", fromCache: false, errorCode: fetched.errorCode || null, location: normalizedLocation };
    }
    return { rates: [], totalAvailable: 0, source: OFFICIAL_SOURCE, mode: "UNAVAILABLE", fromCache: false, errorCode: fetched.errorCode || "NO_OFFICIAL_MARKET_DATA" };
  }

  return { getMandiRates, getRates };
}

const marketDataService = createMarketDataService();

module.exports = {
  DATA_GOV_IN_ENDPOINT,
  DEFAULT_AGMARKNET_RESOURCE_ID,
  DISTRICT_COORDINATES,
  MANDI_FALLBACK_DATA: fallbackRecords,
  OFFICIAL_SOURCE,
  createDataGovInProvider,
  createMarketDataService,
  distanceBetweenDistricts,
  marketDataService,
  normalizeMarketLocation,
  normalizeIndiaLocation,
  normalizeOfficialRecord
};
