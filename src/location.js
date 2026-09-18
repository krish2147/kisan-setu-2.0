const INDIA_LOCATIONS = Object.freeze([
  { city: "Ahmedabad", district: "Ahmedabad", state: "Gujarat", latitude: 23.0225, longitude: 72.5714, aliases: ["अहमदाबाद", "અમદાવાદ"] },
  { city: "Vadodara", district: "Vadodara", state: "Gujarat", latitude: 22.3072, longitude: 73.1812, aliases: ["Baroda", "बड़ौदा", "बरोड़ा", "वडोदरा", "વડોદરા", "બરોડા"] },
  { city: "Anand", district: "Anand", state: "Gujarat", latitude: 22.5645, longitude: 72.9289, aliases: ["आनंद", "આણંદ"] },
  { city: "Surat", district: "Surat", state: "Gujarat", latitude: 21.1702, longitude: 72.8311, aliases: ["सूरत", "સુરત"] },
  { city: "Rajkot", district: "Rajkot", state: "Gujarat", latitude: 22.3039, longitude: 70.8022, aliases: ["राजकोट", "રાજકોટ"] },
  { city: "Mumbai", district: "Mumbai", state: "Maharashtra", latitude: 19.076, longitude: 72.8777, aliases: ["Bombay", "मुंबई", "मुंबइ", "મુંબઈ"] },
  { city: "Nashik", district: "Nashik", state: "Maharashtra", latitude: 19.9975, longitude: 73.7898, aliases: ["Nasik", "नासिक", "नाशिक", "નાસિક"] },
  { city: "Indore", district: "Indore", state: "Madhya Pradesh", latitude: 22.7196, longitude: 75.8577, aliases: ["इंदौर", "ઇન્દોર"] },
  { city: "Bhopal", district: "Bhopal", state: "Madhya Pradesh", latitude: 23.2599, longitude: 77.4126, aliases: ["भोपाल", "ભોપાલ"] },
  { city: "Jaipur", district: "Jaipur", state: "Rajasthan", latitude: 26.9124, longitude: 75.7873, aliases: ["जयपुर", "જયપુર"] },
  { city: "Delhi", district: "Delhi", state: "Delhi", latitude: 28.6139, longitude: 77.209, aliases: ["New Delhi", "नई दिल्ली", "दिल्ली", "દિલ્હી"] },
  { city: "Lucknow", district: "Lucknow", state: "Uttar Pradesh", latitude: 26.8467, longitude: 80.9462, aliases: ["लखनऊ", "લખનઉ"] },
  { city: "Patna", district: "Patna", state: "Bihar", latitude: 25.5941, longitude: 85.1376, aliases: ["पटना", "પટના"] },
  { city: "Kolkata", district: "Kolkata", state: "West Bengal", latitude: 22.5726, longitude: 88.3639, aliases: ["Calcutta", "कलकत्ता", "कोलकाता", "কলকাতা"] },
  { city: "Bhubaneswar", district: "Khordha", state: "Odisha", latitude: 20.2961, longitude: 85.8245, aliases: ["Bhubaneshwar", "भुवनेश्वर", "ଭୁବନେଶ୍ୱର"], districtAliases: ["Khurda"] },
  { city: "Hyderabad", district: "Hyderabad", state: "Telangana", latitude: 17.385, longitude: 78.4867, aliases: ["हैदराबाद", "హైదరాబాద్"] },
  { city: "Guntur", district: "Guntur", state: "Andhra Pradesh", latitude: 16.3067, longitude: 80.4365, aliases: ["गुंटूर", "గుంటూరు"] },
  { city: "Bengaluru", district: "Bengaluru Urban", state: "Karnataka", latitude: 12.9716, longitude: 77.5946, aliases: ["Bangalore", "बैंगलोर", "बेंगलुरु", "ಬೆಂಗಳೂರು"], districtAliases: ["Bangalore", "Bangalore Urban"] },
  { city: "Chennai", district: "Chennai", state: "Tamil Nadu", latitude: 13.0827, longitude: 80.2707, aliases: ["Madras", "मद्रास", "चेन्नई", "சென்னை"] },
  { city: "Coimbatore", district: "Coimbatore", state: "Tamil Nadu", latitude: 11.0168, longitude: 76.9558, aliases: ["कोयंबटूर", "கோயம்புத்தூர்"] },
  { city: "Kochi", district: "Ernakulam", state: "Kerala", latitude: 9.9312, longitude: 76.2673, aliases: ["Cochin", "कोच्चि", "കൊച്ചി"], districtAliases: ["Ernakulam"] },
  { city: "Chandigarh", district: "Chandigarh", state: "Chandigarh", latitude: 30.7333, longitude: 76.7794, aliases: ["चंडीगढ़", "ਚੰਡੀਗੜ੍ਹ"] },
  { city: "Ludhiana", district: "Ludhiana", state: "Punjab", latitude: 30.901, longitude: 75.8573, aliases: ["लुधियाना", "ਲੁਧਿਆਣਾ"] },
  { city: "Guwahati", district: "Kamrup Metropolitan", state: "Assam", latitude: 26.1445, longitude: 91.7362, aliases: ["Gauhati", "गुवाहाटी", "গুৱাহাটী"], districtAliases: ["Kamrup Metro", "Kamrup"] }
]);

function key(value) {
  return String(value || "").trim().toLocaleLowerCase("en-IN").replace(/[.,]/g, "").replace(/\s+/g, " ");
}

function coordinate(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value))
    ? Number(value)
    : null;
}

const LOCATION_INDEX = new Map();
for (const location of INDIA_LOCATIONS) {
  for (const name of [location.city, location.district, ...(location.aliases || []), ...(location.districtAliases || [])]) {
    LOCATION_INDEX.set(key(name), location);
  }
}

const INDIA_LOCATION_ALIASES = Object.freeze(Object.fromEntries(INDIA_LOCATIONS.map(location => [
  location.city,
  [...new Set([location.city.toLowerCase(), ...(location.aliases || [])])]
])));

function normalizeIndiaLocation(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const rawLocation = value.rawLocation || value.city || value.district || "";
    const known = LOCATION_INDEX.get(key(value.city || value.district || rawLocation));
    return {
      rawLocation,
      village: value.village || null,
      city: value.city || known?.city || null,
      district: value.district || known?.district || value.city || null,
      state: value.state || known?.state || null,
      pincode: value.pincode ? String(value.pincode) : null,
      latitude: coordinate(value.latitude) ?? known?.latitude ?? null,
      longitude: coordinate(value.longitude) ?? known?.longitude ?? null,
      districtAliases: known?.districtAliases || []
    };
  }

  const rawLocation = String(value || "").trim();
  const pincode = rawLocation.match(/\b[1-9]\d{5}\b/)?.[0] || null;
  const withoutPincode = rawLocation.replace(/\b[1-9]\d{5}\b/, "").trim().replace(/^,|,$/g, "").trim();
  const parts = withoutPincode.split(",").map(part => part.trim()).filter(Boolean);
  const known = parts.map(part => LOCATION_INDEX.get(key(part))).find(Boolean) || LOCATION_INDEX.get(key(withoutPincode));
  return {
    rawLocation,
    village: null,
    city: known?.city || parts[0] || null,
    district: known?.district || parts[0] || null,
    state: known?.state || parts[1] || null,
    pincode,
    latitude: known?.latitude ?? null,
    longitude: known?.longitude ?? null,
    districtAliases: known?.districtAliases || []
  };
}

function districtCoordinates() {
  const output = {};
  for (const location of INDIA_LOCATIONS) {
    const coordinates = [location.latitude, location.longitude];
    output[location.district] = coordinates;
    output[location.city] = coordinates;
    for (const alias of location.districtAliases || []) output[alias] = coordinates;
  }
  return output;
}

module.exports = { INDIA_LOCATIONS, INDIA_LOCATION_ALIASES, districtCoordinates, normalizeIndiaLocation };
