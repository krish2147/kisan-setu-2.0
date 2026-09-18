const fs = require("fs");
const path = require("path");

const observedAt = "2026-08-22";
const districtMarkets = {
  Vadodara: ["Vadodara APMC", "Padra APMC", "Dabhoi APMC"],
  Ahmedabad: ["Ahmedabad APMC", "Sanand APMC", "Dholka APMC"],
  Anand: ["Anand APMC", "Petlad APMC", "Borsad APMC"],
  Surat: ["Surat APMC", "Bardoli APMC", "Olpad APMC"],
  Rajkot: ["Rajkot APMC", "Gondal APMC", "Jasdan APMC"],
  Gandhinagar: ["Gandhinagar APMC", "Kalol APMC", "Dehgam APMC"],
  Kheda: ["Nadiad APMC", "Kapadvanj APMC", "Mahemdavad APMC"],
  Bharuch: ["Bharuch APMC", "Ankleshwar APMC", "Jambusar APMC"],
  Mehsana: ["Mehsana APMC", "Unjha APMC", "Visnagar APMC"],
  Banaskantha: ["Palanpur APMC", "Deesa APMC", "Tharad APMC"],
  Sabarkantha: ["Himmatnagar APMC", "Idar APMC", "Talod APMC"],
  Panchmahal: ["Godhra APMC", "Halol APMC", "Kalol Panchmahal APMC"],
  Junagadh: ["Junagadh APMC", "Keshod APMC", "Vanthali APMC"],
  Amreli: ["Amreli APMC", "Savarkundla APMC", "Bagasara APMC"],
  Bhavnagar: ["Bhavnagar APMC", "Mahuva APMC", "Palitana APMC"],
  Navsari: ["Navsari APMC", "Gandevi APMC", "Chikhli APMC"]
};

const cropPlans = {
  Tomato: { base: 2450, districts: ["Vadodara", "Ahmedabad", "Anand", "Surat"] },
  Onion: { base: 2180, districts: ["Vadodara", "Ahmedabad", "Anand", "Surat"] },
  Potato: { base: 1650, districts: ["Vadodara", "Ahmedabad", "Anand", "Surat"] },
  Wheat: { base: 2480, districts: ["Vadodara", "Ahmedabad", "Anand", "Surat"] },
  Garlic: { base: 8200, districts: ["Rajkot", "Junagadh", "Mehsana"] },
  Ginger: { base: 6900, districts: ["Surat", "Bharuch", "Sabarkantha"] },
  "Green Chilli": { base: 4400, districts: ["Vadodara", "Rajkot", "Surat"] },
  Brinjal: { base: 1850, districts: ["Vadodara", "Anand", "Surat"] },
  Cabbage: { base: 1450, districts: ["Ahmedabad", "Kheda", "Mehsana"] },
  Cauliflower: { base: 1950, districts: ["Ahmedabad", "Kheda", "Mehsana"] },
  Okra: { base: 2700, districts: ["Vadodara", "Bharuch", "Surat"] },
  "Bottle Gourd": { base: 1650, districts: ["Ahmedabad", "Anand", "Surat"] },
  "Bitter Gourd": { base: 2850, districts: ["Vadodara", "Bharuch", "Surat"] },
  "Ridge Gourd": { base: 2500, districts: ["Vadodara", "Anand", "Surat"] },
  Cucumber: { base: 1750, districts: ["Ahmedabad", "Anand", "Surat"] },
  Carrot: { base: 2250, districts: ["Ahmedabad", "Kheda", "Mehsana"] },
  Radish: { base: 1450, districts: ["Ahmedabad", "Kheda", "Mehsana"] },
  "Green Peas": { base: 3600, districts: ["Ahmedabad", "Anand", "Mehsana"] },
  Spinach: { base: 1250, districts: ["Vadodara", "Ahmedabad", "Surat"] },
  Coriander: { base: 1900, districts: ["Vadodara", "Rajkot", "Surat"] },
  Rice: { base: 3250, districts: ["Kheda", "Surat", "Panchmahal"] },
  Maize: { base: 2220, districts: ["Rajkot", "Panchmahal", "Sabarkantha"] },
  Bajra: { base: 2380, districts: ["Banaskantha", "Mehsana", "Bhavnagar"] },
  Jowar: { base: 2420, districts: ["Rajkot", "Amreli", "Bhavnagar"] },
  Barley: { base: 2280, districts: ["Banaskantha", "Mehsana", "Sabarkantha"] },
  Chana: { base: 5550, districts: ["Rajkot", "Junagadh", "Banaskantha"] },
  Tur: { base: 7250, districts: ["Vadodara", "Bharuch", "Panchmahal"] },
  Moong: { base: 7850, districts: ["Banaskantha", "Kheda", "Mehsana"] },
  Urad: { base: 7650, districts: ["Rajkot", "Amreli", "Junagadh"] },
  Masoor: { base: 6550, districts: ["Ahmedabad", "Kheda", "Sabarkantha"] },
  Groundnut: { base: 6250, districts: ["Junagadh", "Rajkot", "Amreli"] },
  Mustard: { base: 5850, districts: ["Banaskantha", "Mehsana", "Sabarkantha"] },
  Soybean: { base: 4650, districts: ["Vadodara", "Panchmahal", "Sabarkantha"] },
  Sesame: { base: 9050, districts: ["Amreli", "Bhavnagar", "Junagadh"] },
  Cotton: { base: 7250, districts: ["Rajkot", "Amreli", "Bharuch"] },
  Castor: { base: 6150, districts: ["Banaskantha", "Mehsana", "Sabarkantha"] }
};

const exactPrices = new Map([
  ["Tomato|Vadodara|Vadodara APMC", [1800, 2300, 2600]],
  ["Tomato|Vadodara|Padra APMC", [1900, 2450, 2700]],
  ["Tomato|Anand|Anand APMC", [2000, 2500, 2800]],
  ["Tomato|Kheda|Nadiad APMC", [1950, 2420, 2750]],
  ["Tomato|Anand|Petlad APMC", [2050, 2550, 2850]],
  ["Tomato|Ahmedabad|Ahmedabad APMC", [2100, 2550, 2900]],
  ["Tomato|Ahmedabad|Sanand APMC", [2000, 2480, 2750]],
  ["Tomato|Gandhinagar|Gandhinagar APMC", [2150, 2600, 3000]],
  ["Tomato|Surat|Surat APMC", [2200, 2650, 3000]],
  ["Tomato|Surat|Bardoli APMC", [2100, 2550, 2900]],
  ["Tomato|Navsari|Navsari APMC", [2150, 2600, 2950]],
  ["Onion|Vadodara|Vadodara APMC", [1700, 2050, 2350]],
  ["Onion|Anand|Anand APMC", [1800, 2180, 2450]],
  ["Onion|Kheda|Nadiad APMC", [1750, 2120, 2400]],
  ["Onion|Anand|Petlad APMC", [1780, 2150, 2420]],
  ["Onion|Ahmedabad|Ahmedabad APMC", [1900, 2250, 2550]],
  ["Onion|Ahmedabad|Sanand APMC", [1850, 2200, 2500]],
  ["Onion|Gandhinagar|Gandhinagar APMC", [1950, 2300, 2600]],
  ["Onion|Surat|Surat APMC", [1950, 2350, 2650]],
  ["Onion|Surat|Bardoli APMC", [1900, 2280, 2580]],
  ["Onion|Navsari|Navsari APMC", [1850, 2250, 2550]],
  ["Potato|Vadodara|Vadodara APMC", [1200, 1550, 1850]],
  ["Potato|Vadodara|Padra APMC", [1250, 1620, 1900]],
  ["Potato|Anand|Anand APMC", [1300, 1680, 1950]],
  ["Potato|Kheda|Nadiad APMC", [1280, 1650, 1920]],
  ["Potato|Anand|Petlad APMC", [1320, 1700, 1980]],
  ["Potato|Ahmedabad|Ahmedabad APMC", [1350, 1700, 2000]],
  ["Potato|Ahmedabad|Sanand APMC", [1300, 1650, 1950]],
  ["Potato|Gandhinagar|Gandhinagar APMC", [1400, 1750, 2050]],
  ["Potato|Surat|Surat APMC", [1400, 1750, 2050]],
  ["Potato|Surat|Bardoli APMC", [1350, 1700, 2000]],
  ["Potato|Navsari|Navsari APMC", [1380, 1720, 2020]],
  ["Wheat|Vadodara|Vadodara APMC", [2350, 2450, 2550]],
  ["Wheat|Anand|Anand APMC", [2380, 2480, 2580]],
  ["Wheat|Kheda|Nadiad APMC", [2360, 2460, 2560]],
  ["Wheat|Anand|Petlad APMC", [2390, 2490, 2590]],
  ["Wheat|Ahmedabad|Ahmedabad APMC", [2400, 2500, 2600]],
  ["Wheat|Ahmedabad|Sanand APMC", [2380, 2480, 2580]],
  ["Wheat|Gandhinagar|Gandhinagar APMC", [2420, 2520, 2620]],
  ["Wheat|Surat|Surat APMC", [2420, 2520, 2620]],
  ["Wheat|Surat|Bardoli APMC", [2400, 2500, 2600]],
  ["Wheat|Navsari|Navsari APMC", [2410, 2510, 2610]]
]);

// Add nearby districts needed by the original four-crop demo without falsely
// assigning those mandis to the caller's district.
for (const commodity of ["Tomato", "Onion", "Potato", "Wheat"]) {
  cropPlans[commodity].districts.push("Gandhinagar", "Kheda", "Navsari");
}

function roundTen(value) {
  return Math.round(value / 10) * 10;
}

const districtOffsets = Object.fromEntries(Object.keys(districtMarkets).map((district, index) => [district, (index % 7 - 3) * 25]));
const marketOffsets = [-70, 20, 85];
const records = [];
for (const [commodity, plan] of Object.entries(cropPlans)) {
  for (const district of plan.districts) {
    districtMarkets[district].forEach((mandi, marketIndex) => {
      const exact = exactPrices.get(`${commodity}|${district}|${mandi}`);
      const modalPrice = exact?.[1] || roundTen(plan.base + districtOffsets[district] + marketOffsets[marketIndex]);
      const minPrice = exact?.[0] || roundTen(modalPrice * (0.86 - marketIndex * 0.01));
      const maxPrice = exact?.[2] || roundTen(modalPrice * (1.13 + marketIndex * 0.01));
      records.push({
        commodity,
        state: "Gujarat",
        district,
        mandi,
        minPrice,
        maxPrice,
        modalPrice,
        unit: "₹/quintal",
        observedAt,
        source: "Demo fallback",
        isFallback: true
      });
    });
  }
}

const output = path.join(__dirname, "..", "data", "mandi-fallback.json");
fs.writeFileSync(output, `${JSON.stringify(records, null, 2)}\n`);
console.log(`Wrote ${records.length} demo fallback mandi records to ${output}`);
