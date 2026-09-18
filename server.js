const express = require("express");
const fs = require("fs");
const http = require("http");
const path = require("path");
const WebSocket = require("ws");
require("dotenv").config();
const { getDatabase } = require("./src/db");
const { createCallRepository } = require("./src/call-repository");
const { createAdminEvents } = require("./src/admin-events");
const { mountAdminApi } = require("./src/admin-api");
const { createMarketplaceRepository } = require("./src/marketplace-repository");
const { isValidCallablePhone, rankMatches, selectCallableMatch } = require("./src/matching");
const { marketDataService } = require("./src/market-data");
const { getMandiMessages } = require("./src/i18n/mandi-messages");
const { sendMandiRatesSmsOnce } = require("./src/mandi-sms");
const { INDIA_LOCATION_ALIASES } = require("./src/location");
const {
  callerNumberFromStart,
  createExotelSmsProvider,
  createSmsDeliveryService,
  estimateSmsSegments,
  maskPhoneNumber
} = require("./src/sms");
const { LANGUAGE_NAMES, MESSAGES, getMessages, hasCompleteMessageBundle, spokenNumber } = require("./src/i18n/messages");
const { createFast2SmsProvider } = require("./src/fast2sms");
const { isDuplicateTurn, isStaleTurn, mergeTranscriptBuffer, transcriptRejectionReason } = require("./src/turn-taking");

const LISTENING_GUARD_MS = Number(process.env.LISTENING_GUARD_MS || 350);
const DUPLICATE_TURN_WINDOW_MS = 1500;
const TURN_END_GRACE_MS = Number(process.env.TURN_END_GRACE_MS || process.env.TURN_STABILIZATION_MS || 800);
const TTS_TIMEOUT_MS = 30000;
const LANGUAGE_CONFIDENCE_THRESHOLD = 0.7;
const MAX_REPROMPTS = 3;
const MAX_PENDING_AUDIO_BYTES = 32000; // About two seconds of 8 kHz linear16 audio.
const BUYER_CONNECT_TTL_MS = 5 * 60 * 1000;
const pendingBuyerConnections = new Map();

function warnIfExotelApiConfigurationIsIncomplete(env = process.env) {
  const required = [
    "EXOTEL_ACCOUNT_SID",
    "EXOTEL_API_KEY",
    "EXOTEL_API_TOKEN",
    "EXOTEL_SUBDOMAIN"
  ];
  const missing = required.filter(name => !env[name]);
  if (!missing.length) return;

  console.warn(
    `⚠️ EXOTEL API CONFIGURATION INCOMPLETE: ${missing.join(", ")}. ` +
      "Inbound /voicebot and the authorized /exotel/connect-buyer route remain available; " +
      "Exotel REST API features require these values."
  );
}

const STAGES = Object.freeze({
  WELCOME: "WELCOME",
  WAITING_FOR_CROP: "WAITING_FOR_CROP",
  PROCESSING_CROP: "PROCESSING_CROP",
  WAITING_FOR_LOCATION: "WAITING_FOR_LOCATION",
  PROCESSING_LOCATION: "PROCESSING_LOCATION",
  WAITING_FOR_BUYER_CONNECT: "WAITING_FOR_BUYER_CONNECT",
  WAITING_FOR_MATCH_ACTION: "WAITING_FOR_MATCH_ACTION",
  CONNECTING_BUYER: "CONNECTING_BUYER",
  END: "END"
});

function replaceNumericTextWithWords(text, languageCode) {
  return String(text).replace(/-?\d[\d,]*(?:\.\d+)?/g, value => spokenNumber(value, languageCode));
}

const CROP_TRANSLATIONS = {
  Potato: {
    "hi-IN": "आलू", "gu-IN": "બટાકા", "mr-IN": "बटाटा", "pa-IN": "ਆਲੂ",
    "bn-IN": "আলু", "ta-IN": "உருளைக்கிழங்கு", "te-IN": "బంగాళాదుంప",
    "kn-IN": "ಆಲೂಗಡ್ಡೆ", "ml-IN": "ഉരുളക്കിഴങ്ങ്", "or-IN": "ଆଳୁ"
  },
  Tomato: {
    "hi-IN": "टमाटर", "gu-IN": "ટામેટા", "mr-IN": "टोमॅटो", "pa-IN": "ਟਮਾਟਰ",
    "bn-IN": "টমেটো", "ta-IN": "தக்காளி", "te-IN": "టమాటా", "kn-IN": "ಟೊಮೆಟೊ",
    "ml-IN": "തക്കാളി", "or-IN": "ଟମାଟୋ"
  },
  Onion: {
    "hi-IN": "प्याज", "gu-IN": "ડુંગળી", "mr-IN": "कांदा", "pa-IN": "ਪਿਆਜ਼",
    "bn-IN": "পেঁয়াজ", "ta-IN": "வெங்காயம்", "te-IN": "ఉల్లిపాయ", "kn-IN": "ಈರುಳ್ಳಿ",
    "ml-IN": "ഉള്ളി", "or-IN": "ପିଆଜ"
  },
  Wheat: {
    "hi-IN": "गेहूं", "gu-IN": "ઘઉં", "mr-IN": "गहू", "pa-IN": "ਕਣਕ",
    "bn-IN": "গম", "ta-IN": "கோதுமை", "te-IN": "గోధుమ", "kn-IN": "ಗೋಧಿ",
    "ml-IN": "ഗോതമ്പ്", "or-IN": "ଗହମ"
  }
};

Object.assign(CROP_TRANSLATIONS, {
  Garlic: { "hi-IN": "लहसुन", "gu-IN": "લસણ" },
  Ginger: { "hi-IN": "अदरक", "gu-IN": "આદુ" },
  "Green Chilli": { "hi-IN": "हरी मिर्च", "gu-IN": "લીલા મરચાં" },
  Brinjal: { "hi-IN": "बैंगन", "gu-IN": "રીંગણ" },
  Cabbage: { "hi-IN": "पत्तागोभी", "gu-IN": "કોબી" },
  Cauliflower: { "hi-IN": "फूलगोभी", "gu-IN": "ફૂલકોબી" },
  Okra: { "hi-IN": "भिंडी", "gu-IN": "ભીંડા" },
  "Bottle Gourd": { "hi-IN": "लौकी", "gu-IN": "દૂધી" },
  "Bitter Gourd": { "hi-IN": "करेला", "gu-IN": "કારેલા" },
  "Ridge Gourd": { "hi-IN": "तुरई", "gu-IN": "તુરીયા" },
  Cucumber: { "hi-IN": "खीरा", "gu-IN": "કાકડી" },
  Carrot: { "hi-IN": "गाजर", "gu-IN": "ગાજર" },
  Radish: { "hi-IN": "मूली", "gu-IN": "મૂળા" },
  "Green Peas": { "hi-IN": "हरी मटर", "gu-IN": "લીલા વટાણા" },
  Spinach: { "hi-IN": "पालक", "gu-IN": "પાલક" },
  Coriander: { "hi-IN": "धनिया", "gu-IN": "ધાણા" },
  Rice: { "hi-IN": "चावल", "gu-IN": "ચોખા" },
  Maize: { "hi-IN": "मक्का", "gu-IN": "મકાઈ" },
  Bajra: { "hi-IN": "बाजरा", "gu-IN": "બાજરી" },
  Jowar: { "hi-IN": "ज्वार", "gu-IN": "જુવાર" },
  Barley: { "hi-IN": "जौ", "gu-IN": "જવ" },
  Chana: { "hi-IN": "चना", "gu-IN": "ચણા" },
  Tur: { "hi-IN": "अरहर", "gu-IN": "તુવેર" },
  Moong: { "hi-IN": "मूंग", "gu-IN": "મગ" },
  Urad: { "hi-IN": "उड़द", "gu-IN": "અડદ" },
  Masoor: { "hi-IN": "मसूर", "gu-IN": "મસૂર" },
  Groundnut: { "hi-IN": "मूंगफली", "gu-IN": "મગફળી" },
  Mustard: { "hi-IN": "सरसों", "gu-IN": "રાઈ" },
  Soybean: { "hi-IN": "सोयाबीन", "gu-IN": "સોયાબીન" },
  Sesame: { "hi-IN": "तिल", "gu-IN": "તલ" },
  Cotton: { "hi-IN": "कपास", "gu-IN": "કપાસ" },
  Castor: { "hi-IN": "अरंडी", "gu-IN": "દિવેલા" }
});

const CROP_INPUT_ALIASES = {
  Onion: ["प्याज", "प्याज़", "पियाज", "પીયાજ", "ડુંગળી", "ડુંગરી", "कांदा", "ਪਿਆਜ਼", "পেঁয়াজ", "வெங்காயம்", "ఉల్లిపాయ", "ಈರುಳ್ಳಿ", "ഉള്ളി", "സവാള", "ପିଆଜ", "pyaaz", "pyaz", "onion"],
  Wheat: ["गेहूं", "गेहूँ", "गेहुँ", "गेहू", "ઘઉં", "ઘઉ", "गहू", "ਕਣਕ", "গম", "கோதுமை", "గోధుమ", "ಗೋಧಿ", "ഗോതമ്പ്", "ଗହମ", "gehun", "gehu", "wheat"],
  Potato: ["आलू", "आलु", "બટાકા", "બટાટા", "બટેટા", "बटाटा", "ਆਲੂ", "আলু", "உருளைக்கிழங்கு", "బంగాళాదుంప", "ఆలుగడ్డ", "ಆಲೂಗಡ್ಡೆ", "ഉരുളക്കിഴങ്ങ്", "ଆଳୁ", "aloo", "potato"],
  Tomato: ["टमाटर", "ટામેટા", "ટામેટાં", "टोमॅटो", "ਟਮਾਟਰ", "টমেটো", "தக்காளி", "టమాటా", "ಟೊಮೆಟೊ", "തക്കാളി", "ଟମାଟୋ", "tamatar", "tomato"]
};

Object.assign(CROP_INPUT_ALIASES, {
  Garlic: ["लहसुन", "લસણ", "lahsun", "lehsun", "garlic"],
  Ginger: ["अदरक", "આદુ", "adrak", "ginger"],
  "Green Chilli": ["हरी मिर्च", "मिर्च", "લીલા મરચાં", "મરચાં", "mirchi", "green chilli", "green chili", "chilli", "chili"],
  Brinjal: ["बैंगन", "રીંગણ", "baingan", "brinjal", "eggplant"],
  Cabbage: ["पत्तागोभी", "बंदगोभी", "કોબી", "cabbage"],
  Cauliflower: ["फूलगोभी", "ફૂલકોબી", "cauliflower"],
  Okra: ["भिंडी", "ભીંડા", "bhindi", "okra", "ladyfinger", "lady finger"],
  "Bottle Gourd": ["लौकी", "घीया", "દૂધી", "lauki", "dudhi", "bottle gourd"],
  "Bitter Gourd": ["करेला", "કારેલા", "karela", "bitter gourd"],
  "Ridge Gourd": ["तुरई", "तोरी", "તુરીયા", "turai", "ridge gourd"],
  Cucumber: ["खीरा", "ककड़ी", "કાકડી", "kheera", "cucumber"],
  Carrot: ["गाजर", "ગાજર", "gajar", "carrot"],
  Radish: ["मूली", "મૂળા", "mooli", "radish"],
  "Green Peas": ["हरी मटर", "मटर", "લીલા વટાણા", "વટાણા", "matar", "green peas", "peas"],
  Spinach: ["पालक", "પાલક", "palak", "spinach"],
  Coriander: ["धनिया", "ધાણા", "dhania", "coriander"],
  Rice: ["चावल", "धान", "ચોખા", "ડાંગર", "chawal", "paddy", "rice"],
  Maize: ["मक्का", "मकई", "મકાઈ", "makka", "maize", "corn"],
  Bajra: ["बाजरा", "બાજરી", "bajra", "pearl millet"],
  Jowar: ["ज्वार", "जवार", "જુવાર", "jowar", "jawar", "sorghum"],
  Barley: ["जौ", "જવ", "jau", "barley"],
  Chana: ["चना", "चने", "ચણા", "chana", "gram", "chickpea", "chickpeas"],
  Tur: ["अरहर", "तूर", "तुअर", "તુવેર", "તુવર", "tur", "tuvar", "arhar", "pigeon pea"],
  Moong: ["मूंग", "मूँग", "મગ", "moong", "mung", "green gram"],
  Urad: ["उड़द", "उड़द", "અડદ", "urad", "black gram"],
  Masoor: ["मसूर", "મસૂર", "masoor", "lentil", "red lentil"],
  Groundnut: ["मूंगफली", "मूँगफली", "મગફળી", "mungfali", "groundnut", "peanut"],
  Mustard: ["सरसों", "राई", "રાઈ", "સરસવ", "sarson", "mustard"],
  Soybean: ["सोयाबीन", "સોયાબીન", "soyabean", "soybean"],
  Sesame: ["तिल", "તલ", "til", "sesame"],
  Cotton: ["कपास", "कापूस", "કપાસ", "kapas", "cotton"],
  Castor: ["अरंडी", "एरंड", "દિવેલા", "એરંડા", "arandi", "castor"]
});

const LOCATION_INPUT_ALIASES = {
  Vadodara: ["बड़ौड़ा", "बड़ोड़ा", "बरोड़ा", "बड़ौदा", "बड़ोदरा", "वडोदरा", "વડોદરા", "બરોડા", "वडोदरा", "ਵਡੋਦਰਾ", "ভাদোদরা", "வடோதரா", "వడోదర", "ವಡೋದರಾ", "വഡോദര", "ଭଦୋଦରା", "baroda", "vadodara"],
  Ahmedabad: ["अहमदाबाद", "અમદાવાદ", "अहमदाबाद", "ਅਹਿਮਦਾਬਾਦ", "আহমেদাবাদ", "அகமதாபாத்", "అహ్మదాబాద్", "ಅಹಮದಾಬಾದ್", "അഹമ്മദാബാദ്", "ଅହମଦାବାଦ", "ahmedabad"],
  Anand: ["आनंद", "આણંદ", "आनंद", "ਆਨੰਦ", "আনন্দ", "ஆனந்த்", "ఆనంద్", "ಆನಂದ್", "ആനന്ദ്", "ଆନନ୍ଦ", "anand"],
  Surat: ["सूरत", "સુરત", "सूरत", "ਸੂਰਤ", "সুরাট", "சூரத்", "సూరత్", "ಸೂರತ್", "സൂറത്ത്", "ସୁରତ", "surat"]
};

Object.assign(LOCATION_INPUT_ALIASES, {
  Rajkot: ["राजकोट", "રાજકોટ", "rajkot"],
  Gandhinagar: ["गांधीनगर", "ગાંધીનગર", "gandhinagar"],
  Kheda: ["खेड़ा", "खेडा", "ખેડા", "kheda"],
  Bharuch: ["भरूच", "ભરૂચ", "bharuch"],
  Mehsana: ["मेहसाणा", "मेहसाना", "મહેસાણા", "mehsana"],
  Banaskantha: ["बनासकांठा", "બનાસકાંઠા", "banaskantha"],
  Sabarkantha: ["साबरकांठा", "સાબરકાંઠા", "sabarkantha"],
  Panchmahal: ["पंचमहल", "પંચમહાલ", "panchmahal"],
  Junagadh: ["जूनागढ़", "जुनागढ़", "જૂનાગઢ", "junagadh"],
  Amreli: ["अमरेली", "અમરેલી", "amreli"],
  Bhavnagar: ["भावनगर", "ભાવનગર", "bhavnagar"]
});
for (const [canonicalLocation, aliases] of Object.entries(INDIA_LOCATION_ALIASES)) {
  LOCATION_INPUT_ALIASES[canonicalLocation] = [
    ...new Set([...(LOCATION_INPUT_ALIASES[canonicalLocation] || []), ...aliases])
  ];
}

const MANDI_TRANSLATIONS = {
  "Ahmedabad APMC": { "hi-IN": "अहमदाबाद मंडी", "gu-IN": "અમદાવાદ મંડી", "ml-IN": "അഹമ്മദാബാദ് മണ്ഡി", "kn-IN": "ಅಹಮದಾಬಾದ್ ಮಂಡಿ" },
  "Sanand APMC": { "hi-IN": "सानंद मंडी", "gu-IN": "સાણંદ મંડી", "ml-IN": "സാനന്ദ് മണ്ഡി", "kn-IN": "ಸಾಣಂದ್ ಮಂಡಿ" },
  "Gandhinagar APMC": { "hi-IN": "गांधीनगर मंडी", "gu-IN": "ગાંધીનગર મંડી", "ml-IN": "ഗാന്ധിനഗർ മണ്ഡി", "kn-IN": "ಗಾಂಧಿನಗರ ಮಂಡಿ" },
  "Vadodara APMC": { "hi-IN": "वडोदरा मंडी", "gu-IN": "વડોદરા મંડી", "ml-IN": "വഡോദര മണ്ഡി", "kn-IN": "ವಡೋದರಾ ಮಂಡಿ" },
  "Padra APMC": { "hi-IN": "पादरा मंडी", "gu-IN": "પાદરા મંડી", "ml-IN": "പാദ്ര മണ്ഡി", "kn-IN": "ಪಾದ್ರಾ ಮಂಡಿ" },
  "Anand APMC": { "hi-IN": "आनंद मंडी", "gu-IN": "આણંદ મંડી", "ml-IN": "ആനന്ദ് മണ്ഡി", "kn-IN": "ಆನಂದ್ ಮಂಡಿ" }
};

function responseLanguage(languageCode) {
  return getMessages(languageCode) === MESSAGES[languageCode] ? languageCode : "hi-IN";
}

function messagesFor(languageCode) {
  return getMessages(languageCode);
}

function cropName(commodity, languageCode) {
  const language = responseLanguage(languageCode);
  if (language === "en-IN") return commodity;
  const entityLanguage = language === "od-IN" ? "or-IN" : language;
  return CROP_TRANSLATIONS[commodity]?.[entityLanguage] || CROP_TRANSLATIONS[commodity]?.["hi-IN"] || commodity;
}

function mandiName(mandi, languageCode) {
  const language = responseLanguage(languageCode);
  return MANDI_TRANSLATIONS[mandi]?.[language] || MANDI_TRANSLATIONS[mandi]?.["hi-IN"] || mandi;
}

const LANGUAGE_CODE_ALIASES = Object.freeze({
  hi: "hi-IN", hindi: "hi-IN",
  gu: "gu-IN", gujarati: "gu-IN",
  kn: "kn-IN", kannada: "kn-IN",
  ml: "ml-IN", malayalam: "ml-IN",
  mr: "mr-IN", marathi: "mr-IN",
  bn: "bn-IN", bengali: "bn-IN",
  ta: "ta-IN", tamil: "ta-IN",
  te: "te-IN", telugu: "te-IN",
  pa: "pa-IN", punjabi: "pa-IN",
  od: "od-IN", or: "od-IN", odia: "od-IN", oriya: "od-IN",
  en: "en-IN", english: "en-IN"
});

function normalizeLanguageCode(languageCode) {
  if (typeof languageCode !== "string") return null;
  const normalized = languageCode.trim().toLowerCase().replace(/_/g, "-");
  if (!normalized || !/^[a-z]{2}(?:-[a-z]{2})?$|^[a-z]+$/.test(normalized)) return null;
  const base = normalized.split("-")[0];
  const known = LANGUAGE_CODE_ALIASES[normalized] || LANGUAGE_CODE_ALIASES[base];
  if (known) return known;
  if (/^[a-z]{2}-in$/.test(normalized)) return `${base}-IN`;
  return null;
}

function ttsLanguageCode(languageCode) {
  // The legacy STT identifies Odia as od-IN; keep this adapter for the
  // product-facing or-IN representation and Sarvam TTS compatibility.
  return languageCode === "or-IN" ? "od-IN" : languageCode;
}

function buildTtsConfig(languageCode) {
  return {
    language_code: ttsLanguageCode(languageCode),
    speaker: "priya",
    output_audio_codec: "linear16",
    speech_sample_rate: 8000
  };
}

function detectLanguageCandidate(languageCode, confidence, transcript) {
  const language = normalizeLanguageCode(languageCode);
  const numericConfidence = confidence === null || confidence === undefined
    ? null
    : Number(confidence);
  const transcriptText = String(transcript || "");

  // Kannada script fallback protects the first turn when language metadata is
  // absent or conflicts at low confidence.
  if (/[\u0C80-\u0CFF]/u.test(transcriptText) &&
      (!language || language === "kn-IN" || numericConfidence < LANGUAGE_CONFIDENCE_THRESHOLD)) {
    return {
      language: "kn-IN",
      confidence: Number.isFinite(numericConfidence) ? numericConfidence : null,
      reliable: true,
      source: language ? "sarvam+script" : "script"
    };
  }

  // Malayalam script is reliable evidence when Sarvam omits language metadata
  // or returns a low-confidence conflicting language for the first utterance.
  if (/[\u0D00-\u0D7F]/u.test(transcriptText) &&
      (!language || language === "ml-IN" || numericConfidence < LANGUAGE_CONFIDENCE_THRESHOLD)) {
    return {
      language: "ml-IN",
      confidence: Number.isFinite(numericConfidence) ? numericConfidence : null,
      reliable: true,
      source: language ? "sarvam+script" : "script"
    };
  }

  // Gujarati script is stronger evidence than a low-confidence language ID.
  // This also protects the demo when legacy streaming omits language metadata.
  if (/[\u0A80-\u0AFF]/u.test(transcriptText) &&
      (!language || language === "gu-IN" || numericConfidence < LANGUAGE_CONFIDENCE_THRESHOLD)) {
    return {
      language: "gu-IN",
      confidence: Number.isFinite(numericConfidence) ? numericConfidence : null,
      reliable: true,
      source: language ? "sarvam+script" : "script"
    };
  }

  if (language) {
    return {
      language,
      confidence: Number.isFinite(numericConfidence) ? numericConfidence : null,
      reliable: !Number.isFinite(numericConfidence) || numericConfidence >= LANGUAGE_CONFIDENCE_THRESHOLD,
      source: "sarvam"
    };
  }

  return { language: null, confidence: null, reliable: false, source: null };
}

const app = express();
const server = http.createServer(app);
const callRepository = createCallRepository(getDatabase());
const marketplaceRepository = createMarketplaceRepository(getDatabase());
const marketplaceSeed = marketplaceRepository.seedDemoMarketplace({
  demoBuyerPhone: process.env.DEMO_BUYER_PHONE || null
});
if (process.env.DEMO_BUYER_PHONE && !marketplaceSeed.callableBuyerConfigured) {
  console.warn("⚠️ DEMO_BUYER_PHONE is invalid; buyer call transfer is disabled until it is valid E.164.");
}
const adminEvents = createAdminEvents();
const exotelCallerLookup = createExotelSmsProvider();
const smsProvider = createFast2SmsProvider({
  resolveCallerNumber: exotelCallerLookup.resolveCallerNumber
});
mountAdminApi(app, callRepository, adminEvents);

function normalizeDigits(text) {
  const devanagariDigits = "०१२३४५६७८९";
  const gujaratiDigits = "૦૧૨૩૪૫૬૭૮૯";
  return text
    .replace(/[०-९]/g, digit => String(devanagariDigits.indexOf(digit)))
    .replace(/[૦-૯]/g, digit => String(gujaratiDigits.indexOf(digit)));
}

const SPOKEN_NUMBER_REPLACEMENTS = [
  [/(?:पांच|पाँच)\s*सौ/g, "500"],
  [/ચાર\s*સો/g, "400"], [/પાંચ\s*સો/g, "500"], [/છ\s*સો/g, "600"],
  [/(?:पाच\s*शे|पाचशे)/g, "500"], [/(?:পাঁচ\s*শো|পাঁচশো)/g, "500"],
  [/ஐநூறு/g, "500"], [/(?:ఐదు\s*వందల|ఐదువందల)/g, "500"],
  [/ಐನೂರು/g, "500"], [/(?:അഞ്ഞൂറ്|അഞ്ഞൂറു)/g, "500"],
  [/ਪੰਜ\s*ਸੌ/g, "500"], [/ପାଞ୍ଚ\s*ଶହ/g, "500"], [/five\s+hundred/gi, "500"],
  [/एक\s*सौ/g, "100"], [/दो\s*सौ/g, "200"], [/तीन\s*सौ/g, "300"],
  [/चार\s*सौ/g, "400"], [/छह\s*सौ/g, "600"], [/सात\s*सौ/g, "700"],
  [/आठ\s*सौ/g, "800"], [/नौ\s*सौ/g, "900"],
  [/એક\s*સો/g, "100"], [/બે\s*સો/g, "200"], [/ત્રણ\s*સો/g, "300"],
  [/સાત\s*સો/g, "700"], [/આઠ\s*સો/g, "800"], [/નવ\s*સો/g, "900"],
  [/बीस/g, "20"], [/पचास/g, "50"], [/વીસ/g, "20"], [/પચાસ/g, "50"],
  [/एक(?=\s|$)/g, "1"], [/दो(?=\s|$)/g, "2"], [/तीन(?=\s|$)/g, "3"], [/चार(?=\s|$)/g, "4"],
  [/(?:पांच|पाँच)(?=\s|$)/g, "5"], [/छह(?=\s|$)/g, "6"], [/सात(?=\s|$)/g, "7"], [/आठ(?=\s|$)/g, "8"], [/नौ(?=\s|$)/g, "9"],
  [/એક(?=\s|$)/g, "1"], [/બે(?=\s|$)/g, "2"], [/ત્રણ(?=\s|$)/g, "3"], [/ચાર(?=\s|$)/g, "4"], [/પાંચ(?=\s|$)/g, "5"]
];

function normalizeSpokenNumbers(text) {
  return SPOKEN_NUMBER_REPLACEMENTS.reduce(
    (normalized, [pattern, replacement]) => normalized.replace(pattern, replacement),
    text
  );
}

function normalizeTranscript(text) {
  return normalizeSpokenNumbers(normalizeDigits(String(text || "")))
    .toLowerCase()
    .replace(/[.,!?।،]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesAlias(text, aliases) {
  return aliases.some(alias => {
    const normalizedAlias = alias.toLowerCase();
    if (!/^[a-z][a-z ]*$/i.test(normalizedAlias)) return text.includes(normalizedAlias);
    const escaped = normalizedAlias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    return new RegExp(`(?:^|\\b)${escaped}(?:\\b|$)`, "i").test(text);
  });
}

function isMeaningfulTranscript(text) {
  const compact = normalizeTranscript(text).replace(/\s/g, "");
  if (!compact) return false;
  if (/^\d+$/.test(compact)) return true;
  if (compact.length < 3) return false;
  return !/^(हां|हाँ|जी|हूँ|हम्म|अच्छा|ઓકે|હા|હં|જી|ઓહ|ओके|ok|hello|हेलो)$/.test(compact);
}

function isLanguageLockEligibleTranscript(text) {
  const normalized = normalizeTranscript(text);
  if (!isMeaningfulTranscript(normalized)) return false;
  const extracted = extractFarmerData(normalized);
  if (extracted.commodity || extracted.quantityKg || extracted.location || extracted.intent !== "UNKNOWN") {
    return true;
  }
  const words = normalized.split(/\s+/).filter(Boolean);
  return words.length >= 3 && normalized.replace(/\s/g, "").length >= 12;
}

function createLanguageSessionState() {
  return {
    detectedLanguage: null,
    responseLanguage: "hi-IN",
    languageLocked: false,
    languageConfidence: null,
    languageFallbackReason: null,
    unsupportedLanguageNoticePlayed: false
  };
}

function lockSessionLanguage(session, transcript, detectedLanguage, confidence) {
  if (!session || session.languageLocked) return { locked: false, reason: "already_locked" };
  if (!isLanguageLockEligibleTranscript(transcript)) {
    return { locked: false, reason: "insufficient_speech" };
  }

  const candidate = detectLanguageCandidate(detectedLanguage, confidence, transcript);
  session.languageConfidence = candidate.confidence;
  if (!candidate.reliable || !candidate.language) {
    return { locked: false, reason: "language_metadata_unavailable", candidate };
  }

  session.detectedLanguage = candidate.language;
  session.responseLanguage = hasCompleteMessageBundle(candidate.language) ? candidate.language : "hi-IN";
  session.languageFallbackReason = session.responseLanguage === candidate.language
    ? null
    : "response_bundle_unavailable";
  session.languageLocked = true;
  return { locked: true, candidate };
}

function extractFarmerData(text) {
  const t = normalizeTranscript(text);
  const result = { intent: "UNKNOWN", commodity: null, quantityKg: null, location: null };

  if (/(बेचना|बेच|मेरे पास|વેચવું|વેચવા|વેચ|મારી પાસે|मારે વેચ|विकणे|विकायचे|ਵੇਚ|বিক্রি|விற்க|అమ్మ|ಮಾರ|വിൽക്ക|ବିକ୍ରି|\bsell\b)/i.test(t)) result.intent = "SELL";
  if (/(खरीद|चाहिए|ખરીદવું|ખરીદવા|ખરીદ|જોઈએ|खरेदी|ਖਰੀਦ|কিন|வாங்க|కొన|ಖರೀದ|വാങ്ങ|କିଣ|\bbuy\b)/i.test(t)) result.intent = "BUY";

  let bestCropMatch = null;
  for (const [commodity, aliases] of Object.entries(CROP_INPUT_ALIASES)) {
    for (const alias of aliases) {
      if (commodity === "Chana" && alias === "चना" && !/(?:^|\s)चना(?:\s|$)/u.test(t)) continue;
      if (!includesAlias(t, [alias])) continue;
      if (!bestCropMatch || alias.length > bestCropMatch.alias.length) {
        bestCropMatch = { commodity, alias };
      }
    }
  }
  result.commodity = bestCropMatch?.commodity || null;

  const kg = t.match(/(\d+(?:\.\d+)?)\s*(?:किलो(?:ग्राम)?|કિલો(?:ગ્રામ)?|ਕਿਲੋ|কিলো|கிலோ|కిలో|ಕಿಲೋ|കിലോ|କିଲୋ|kgs?\b|kilos?\b|kilograms?\b)/i);
  const quintal = t.match(/(\d+(?:\.\d+)?)\s*(?:क्विंटल|ક્વિન્ટલ|ક્વિંટલ|ਕੁਇੰਟਲ|কুইন্টাল|குவிண்டால்|క్వింటాల్|ಕ್ವಿಂಟಾಲ್|ക്വിന്റൽ|କ୍ୱିଣ୍ଟାଲ|quintals?\b)/i);
  const tonne = t.match(/(\d+(?:\.\d+)?)\s*(?:टन|ટન|ਟਨ|টন|டன்|టన్ను|ಟನ್|ടൺ|ଟନ|tons?\b|tonnes?\b)/i);
  if (kg) result.quantityKg = Number(kg[1]);
  if (quintal) result.quantityKg = Number(quintal[1]) * 100;
  if (tonne) result.quantityKg = Number(tonne[1]) * 1000;
  if (!result.quantityKg && /^\d+(?:\.\d+)?$/.test(t)) result.quantityKg = Number(t);

  for (const [location, aliases] of Object.entries(LOCATION_INPUT_ALIASES)) {
    if (includesAlias(t, aliases)) {
      result.location = location;
      break;
    }
  }
  return result;
}

function mergeSlots(currentSlots, extracted) {
  return {
    intent: currentSlots.intent || (extracted.intent && extracted.intent !== "UNKNOWN" ? extracted.intent : null),
    commodity: extracted.commodity || currentSlots.commodity,
    quantityKg: extracted.quantityKg || currentSlots.quantityKg,
    location: extracted.location || currentSlots.location
  };
}

function missingRequiredSlots(slots) {
  return ["commodity", "quantityKg", "location"].filter(slot => !slots[slot]);
}

function createTurnBuffer(seedSlots = {}, identity = {}) {
  return {
    transcripts: [],
    transcriptBuffer: "",
    slots: {
      intent: seedSlots.intent || null,
      commodity: seedSlots.commodity || null,
      quantityKg: seedSlots.quantityKg || null,
      location: seedSlots.location || null
    },
    languageCandidates: [],
    speechStartAt: null,
    speechEndAt: null,
    firstTranscriptAt: null,
    lastTranscriptAt: null,
    inSpeech: false,
    turnId: identity.turnId || 0,
    stage: identity.stage ?? seedSlots.stage ?? null,
    stageId: identity.stageId ?? seedSlots.currentStageId ?? 0,
    finalized: false
  };
}

function accumulateTurnTranscript(turn, transcript, languageCode = null, confidence = null, receivedAt = Date.now()) {
  const normalized = normalizeTranscript(transcript);
  if (!isMeaningfulTranscript(normalized)) return false;
  const merged = mergeTranscriptBuffer(turn.transcriptBuffer, transcript);
  if (normalizeTranscript(merged) === normalizeTranscript(turn.transcriptBuffer)) return false;
  turn.transcripts.push(transcript.trim());
  turn.transcriptBuffer = merged;
  turn.slots = mergeSlots(turn.slots, extractFarmerData(merged));
  turn.firstTranscriptAt ||= receivedAt;
  turn.lastTranscriptAt = receivedAt;
  if (languageCode) turn.languageCandidates.push({ languageCode, confidence, transcript });
  return true;
}

function getMandiRates(commodity, location) {
  return marketDataService.getRates({ commodity, location, limit: 3 });
}

async function discoverMandiRates(commodity, location) {
  return marketDataService.getMandiRates({ commodity, location, limit: 5 });
}

function findCompatibleSellers(commodity, quantityKg, location) {
  try {
    const store = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "store.json"), "utf8"));
    return (store.farmers || []).filter(seller =>
      seller.status === "active" &&
      String(seller.commodity).toLowerCase() === String(commodity).toLowerCase() &&
      Number(seller.quantityKg) >= Number(quantityKg) &&
      String(seller.location).toLowerCase() === String(location).toLowerCase()
    );
  } catch (error) {
    console.error("❌ SELLER LISTING ERROR:", error.message);
    return [];
  }
}

function findTopMarketplaceMatches(intent, commodity, quantityKg, location) {
  const targetSide = intent === "SELL" ? "BUY" : "SELL";
  const candidates = marketplaceRepository.getEligibleListings(targetSide, commodity);
  return rankMatches({ intent, commodity, quantityKg, location }, candidates);
}

function matchVoiceAnnouncement(intent, matches, languageCode) {
  if (!matches.length) return "";
  const messages = messagesFor(languageCode);
  const recommended = matches[0];
  const localizedCrop = cropName(recommended.commodity, languageCode);
  const countSpeech = intent === "SELL"
    ? messages.BUYERS_FOUND_COUNT(matches.length)
    : messages.SELLERS_FOUND_COUNT(matches.length);
  const recommendationSpeech = intent === "SELL"
    ? messages.RECOMMENDED_BUYER_MATCH(
      recommended.location,
      recommended.distanceKm,
      recommended.matchedQuantityKg,
      localizedCrop,
      recommended.pricePerKg
    )
    : messages.RECOMMENDED_SELLER_MATCH(
      recommended.location,
      recommended.distanceKm,
      recommended.matchedQuantityKg,
      localizedCrop,
      recommended.pricePerKg
    );
  return `${countSpeech} ${recommendationSpeech}`;
}

function mandiVoiceAnnouncement(discovery, commodity, location, languageCode) {
  const rates = discovery?.rates || [];
  if (!rates.length) return messagesFor(languageCode).NO_MANDI_RATES;
  const copy = getMandiMessages(languageCode);
  const crop = cropName(commodity, languageCode);
  const rateSpeech = rates.slice(0, 5).map(rate =>
    messagesFor(languageCode).MANDI_RATE(rate.mandi, rate.modalPrice ?? rate.modal)
  ).join(" ");
  const recommended = rates.find(rate => rate.isRecommended) || rates[0];
  const dates = rates.map(rate => rate.observedAt).filter(Boolean).sort();
  const latest = dates.at(-1);
  const today = new Date().toISOString().slice(0, 10);
  const freshness = latest && latest !== today ? ` ${copy.latest(latest)}` : "";
  const selection = discovery.totalAvailable > rates.length ? ` ${copy.selected}` : "";
  return `${copy.found(discovery.totalAvailable, crop, location)}${selection} ${rateSpeech} ` +
    `${messagesFor(languageCode).BEST_MANDI_RATE(recommended.mandi, recommended.modalPrice ?? recommended.modal)}${freshness}`;
}

function authorizeBuyerConnection(callSid, phone = null, now = Date.now()) {
  if (!callSid || !isValidCallablePhone(phone)) return false;
  pendingBuyerConnections.set(String(callSid), {
    phone,
    expiresAt: now + BUYER_CONNECT_TTL_MS
  });
  return true;
}

function resolveBuyerConnection(callSid, now = Date.now()) {
  for (const [sid, connection] of pendingBuyerConnections) {
    if (connection.expiresAt <= now) pendingBuyerConnections.delete(sid);
  }
  if (!callSid) return null;
  return pendingBuyerConnections.get(String(callSid))?.phone || null;
}

function authorizeCallableBuyerConnection(callSid, matches, now = Date.now()) {
  const callable = selectCallableMatch(matches);
  if (!callSid || !callable || !isValidCallablePhone(callable.phone)) return null;
  authorizeBuyerConnection(callSid, callable.phone, now);
  return callable;
}

function resolveFinalMatchAction(stage, intent, digit) {
  const isSellFinal = stage === STAGES.WAITING_FOR_BUYER_CONNECT && intent === "SELL";
  const isSellMatchFinal = stage === STAGES.WAITING_FOR_MATCH_ACTION && intent === "SELL";
  const isBuyFinal = stage === STAGES.WAITING_FOR_MATCH_ACTION && intent === "BUY";
  if (isSellFinal && digit === "1") return "CONNECT_BUYER";
  if ((isSellFinal || isSellMatchFinal) && digit === "2") return "REQUEST_TOP5_MANDI_SMS";
  if ((isSellFinal || isSellMatchFinal) && digit === "3") return "END_CALL";
  if (isBuyFinal && digit === "2") return "END_CALL";
  if (isBuyFinal && digit === "3") return "REQUEST_TOP5_SMS";
  return null;
}

function createPendingTop5SmsRequest(callSid, intent, language, repository = callRepository) {
  const matchType = intent === "SELL" ? "BUYERS" : intent === "BUY" ? "SELLERS" : null;
  if (!matchType) return null;
  return repository.createSmsRequest(callSid, matchType, language);
}

function requestCallSid(query = {}) {
  const key = Object.keys(query).find(name => name.toLowerCase() === "callsid");
  return key ? String(query[key]) : null;
}

// Preserves the existing Sarvam TTS -> Exotel media integration. Resolving is
// delayed until estimated audio playback plus the listening safety gap ends.
function streamTts(exotelSocket, streamSid, text, languageCode, metrics = null) {
  // Last-mile safety: no ASCII numeric value is allowed to reach Sarvam TTS.
  // Templates already use spokenNumber(), and this also protects future messages.
  const spokenText = replaceNumericTextWithWords(text, languageCode);
  console.log("\n🤖 BOT:", spokenText);
  console.log(`🌐 TTS LANGUAGE: ${LANGUAGE_NAMES[languageCode] || "Fallback"} (${ttsLanguageCode(languageCode)})`);
  console.log("⏱ TTS REQUEST");
  if (metrics) metrics.ttsRequestAt = Date.now();
  return new Promise((resolve, reject) => {
    let settled = false;
    let firstAudioAt = 0;
    let audioBytes = 0;
    const tts = new WebSocket(
      "wss://api.sarvam.ai/text-to-speech/ws?model=bulbul:v3&send_completion_event=true",
      { headers: { "Api-Subscription-Key": process.env.SARVAM_API_KEY } }
    );
    const timeout = setTimeout(() => finish(new Error("Sarvam TTS timed out")), TTS_TIMEOUT_MS);

    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (tts.readyState === WebSocket.OPEN || tts.readyState === WebSocket.CONNECTING) tts.close();
      if (error) return reject(error);

      if (metrics) metrics.ttsCompleteAt = Date.now();
      console.log("🔊 TTS COMPLETE");
      // linear16, 8 kHz, mono = 16 bytes per millisecond.
      const playbackEnd = (firstAudioAt || Date.now()) + audioBytes / 16;
      const playbackWaitMs = Math.max(0, playbackEnd - Date.now());
      setTimeout(() => {
        if (metrics) metrics.playbackCompleteAt = Date.now();
        console.log("🔊 BOT PLAYBACK COMPLETE");
        setTimeout(resolve, LISTENING_GUARD_MS);
      }, playbackWaitMs);
    }

    tts.on("open", () => {
      console.log("🔊 TTS CONNECTED");
      tts.send(JSON.stringify({
        type: "config",
        data: buildTtsConfig(languageCode)
      }));
      tts.send(JSON.stringify({ type: "text", data: { text: spokenText } }));
      tts.send(JSON.stringify({ type: "flush" }));
    });

    tts.on("message", data => {
      try {
        const response = JSON.parse(data.toString());
        console.log("TTS EVENT:", response.type);
        if (response.type === "error") {
          const message = response.data?.message || response.message || JSON.stringify(response.data || response);
          console.error("❌ SARVAM TTS ERROR:", message);
          finish(new Error(message));
          return;
        }
        if (response.type === "audio" && response.data?.audio) {
          if (!firstAudioAt) {
            firstAudioAt = Date.now();
            if (metrics) metrics.ttsFirstAudioAt = firstAudioAt;
            console.log("⏱ TTS FIRST AUDIO");
            console.log("🔊 BOT PLAYBACK START");
          }
          audioBytes += Buffer.from(response.data.audio, "base64").length;
          if (exotelSocket.readyState === WebSocket.OPEN) {
            exotelSocket.send(JSON.stringify({
              event: "media",
              stream_sid: streamSid,
              media: { payload: response.data.audio }
            }));
          }
        }
        if (response.type === "event" && response.data?.event_type === "final") finish();
      } catch (error) {
        console.error("TTS parsing error:", error.message);
      }
    });
    tts.on("error", error => finish(error));
  });
}



const wss = new WebSocket.Server({ server, path: "/voicebot" });
app.get("/", (req, res) => res.send("KisanSetu AI Voice Server Running"));
app.get("/exotel/connect-buyer", (req, res) => {
  const configuredToken = process.env.EXOTEL_CONNECT_TOKEN;
  if (configuredToken && req.query.token !== configuredToken) {
    console.warn("☎️ BUYER CONNECT REJECTED: invalid endpoint token");
    return res.status(403).type("text/plain").send("");
  }

  const callSid = requestCallSid(req.query);
  const phone = resolveBuyerConnection(callSid);
  if (!phone) {
    console.log("☎️ BUYER CONNECT SKIPPED:", { callSid: callSid || "missing", authorized: false });
    return res.status(200).type("text/plain").send("");
  }

  console.log("☎️ BUYER CONNECT APPROVED:", { callSid, phone });
  return res.status(200).type("text/plain").send(phone);
});

app.get("/connect-buyer", (req, res) => {
  console.log("\n📞 CONNECT BUYER ENDPOINT HIT");
  console.log("Query:", req.query);

  const callSid = requestCallSid(req.query);
  const buyerNumber = resolveBuyerConnection(callSid);
  console.log("Authorization:", {
    callSid: callSid || "missing",
    authorized: Boolean(buyerNumber)
  });

  res.setHeader("Content-Type", "application/json");

  return res.status(200).json({
    fetch_after_attempt: false,
    destination: {
      numbers: buyerNumber ? [buyerNumber] : []
    },
    record: false,
    max_ringing_duration: 30,
    max_conversation_duration: 900,
    music_on_hold: {
      type: "operator_tone"
    }
  });
});

wss.on("connection", exotelSocket => {
  let streamSid = null;
  let callSid = null;
  let isBotSpeaking = false;
  let isProcessingUser = false;
  let isListeningOpen = false;
  let lastTranscript = "";
  let lastTranscriptTime = 0;
  let lastTranscriptStageId = null;
  let turnFinalizeTimer = null;
  let welcomeTimer = null;
  let requiresFreshSpeechStart = false;
  let forwardedAudioBytes = 0;
  let pendingAudioFrames = [];
  let pendingAudioBytes = 0;
  let speechQueue = Promise.resolve();
  let queuedSpeechCount = 0;
  let activeResponseMetrics = null;
  let terminalCallPersisted = false;
  const session = {
    stage: STAGES.WELCOME,
    intent: null,
    ...createLanguageSessionState(),
    commodity: null,
    quantityKg: null,
    location: null,
    matchedBuyer: null,
    callableBuyer: null,
    matches: [],
    matchedSellers: [],
    recommendedSeller: null,
    retryCount: 0,
    emptyTurnCount: 0,
    callerNumber: null,
    smsSent: false,
    smsSending: false,
    mandiRates: [],
    mandiDiscovery: null,
    mandiSmsSent: false,
    mandiSmsSending: false,
    callId: null,
    botSpeaking: false,
    farmerSpeaking: false,
    isProcessingTurn: false,
    currentTurnId: 0,
    currentStageId: 0,
    transcriptBuffer: "",
    pendingTurnTimer: null,
    lastProcessedTranscript: null,
    lastProcessedAt: 0
  };
  let currentTurn = createTurnBuffer(session, {
    turnId: session.currentTurnId,
    stage: session.stage,
    stageId: session.currentStageId
  });

  console.log("\n📞 CALL CONNECTED");

  function publishCallUpdate(eventType) {
    if (!callSid) return;
    const call = callRepository.getCallBySid(callSid);
    if (!call) return;
    adminEvents.publish({ eventType, callId: call.id, callSid: call.call_sid, timestamp: new Date().toISOString() });
  }

  function persistCallUpdate(fields, updateType = "CALL_UPDATED") {
    if (!callSid) return null;
    try {
      const call = callRepository.updateCall(callSid, fields);
      if (call) publishCallUpdate(updateType);
      return call;
    } catch (error) {
      console.error("❌ CALL PERSISTENCE ERROR:", error.message);
      return null;
    }
  }

  function persistCallEvent(eventType, payload = null) {
    if (!callSid) return null;
    try {
      const event = callRepository.addEvent(callSid, eventType, payload);
      if (event) publishCallUpdate(eventType);
      return event;
    } catch (error) {
      console.error("❌ CALL EVENT PERSISTENCE ERROR:", error.message);
      return null;
    }
  }

  function persistTerminalCall(status, eventType, reason = null) {
    if (!callSid || terminalCallPersisted) return;
    terminalCallPersisted = true;
    try {
      callRepository.finishCall(callSid, status, new Date().toISOString(), {
        currentStage: session.stage,
        buyerConnectionStatus: session.stage === STAGES.CONNECTING_BUYER ? "REQUESTED" : undefined
      });
      callRepository.addEvent(callSid, eventType, reason ? { reason } : null);
      publishCallUpdate(eventType);
    } catch (error) {
      console.error("❌ TERMINAL CALL PERSISTENCE ERROR:", error.message);
    }
  }

  const smsDeliveryService = createSmsDeliveryService({
    repository: callRepository,
    provider: smsProvider,
    onStatus(eventType, delivery) {
      const metrics = estimateSmsSegments(delivery.message_text);
      const payload = {
        smsDeliveryId: delivery.id,
        status: delivery.status,
        recipient: maskPhoneNumber(delivery.recipient),
        language: delivery.language,
        messageType: delivery.message_type,
        characters: metrics.characters,
        segments: metrics.segments,
        errorCode: delivery.error_code || null
      };
      if (eventType === "SMS_SENDING") {
        console.log("SMS REQUESTED");
        console.log("SMS PROVIDER: FAST2SMS");
        console.log(`SMS TYPE: ${payload.messageType}`);
        console.log(`SMS RECIPIENT: ${payload.recipient || "unavailable"}`);
        console.log("📤 SMS SENDING", payload);
      } else if (eventType === "SMS_SENT") {
        console.log("SMS FINAL STATUS: SENT");
        console.log("✅ SMS SENT", payload);
      } else {
        console.log(`SMS FINAL STATUS: ${payload.status}`);
        console.log("❌ SMS FAILED", payload);
      }
      persistCallEvent(eventType, payload);
    }
  });

  function setStage(next) {
    if (session.stage === next) return;
    console.log(`🔄 STATE: ${session.stage} -> ${next}`);
    session.stage = next;
    session.currentStageId += 1;
    persistCallUpdate({ currentStage: next }, "STAGE_UPDATED");
  }

  function resetTurnBuffer() {
    clearTimeout(turnFinalizeTimer);
    turnFinalizeTimer = null;
    session.pendingTurnTimer = null;
    session.currentTurnId += 1;
    session.transcriptBuffer = "";
    session.farmerSpeaking = false;
    currentTurn = createTurnBuffer(session, {
      turnId: session.currentTurnId,
      stage: session.stage,
      stageId: session.currentStageId
    });
  }

  function clearTurnTimer() {
    clearTimeout(turnFinalizeTimer);
    clearTimeout(welcomeTimer);
    turnFinalizeTimer = null;
    welcomeTimer = null;
    session.pendingTurnTimer = null;
    session.farmerSpeaking = false;
  }

  function logTurnLatency(metrics) {
    if (!metrics?.processingStartAt) return;
    const duration = (end, start) => end && start ? Math.max(0, end - start) : null;
    const speechReference = metrics.speechEndAt || metrics.speechStartAt || metrics.sttStartAt;
    console.log("⏱ TURN LATENCY", {
      speechToTranscriptMs: duration(metrics.transcriptAt, speechReference),
      transcriptToDecisionMs: duration(metrics.decisionAt, metrics.transcriptAt),
      ttsFirstAudioMs: duration(metrics.ttsFirstAudioAt, metrics.ttsRequestAt),
      totalResponseLatencyMs: duration(metrics.listeningOpenAt, speechReference)
    });
  }

  function speak(text, languageCode = responseLanguage(session.responseLanguage), metrics = activeResponseMetrics) {
    queuedSpeechCount += 1;
    isBotSpeaking = true;
    session.botSpeaking = true;
    session.farmerSpeaking = false;
    isListeningOpen = false;
    clearTimeout(turnFinalizeTimer);
    turnFinalizeTimer = null;
    pendingAudioFrames = [];
    pendingAudioBytes = 0;
    currentTurn.transcriptBuffer = "";
    currentTurn.transcripts = [];
    session.transcriptBuffer = "";
    console.log("🤖 BOT SPEAKING START");
    const speech = speechQueue.catch(() => undefined)
      .then(() => streamTts(exotelSocket, streamSid, text, languageCode, metrics));
    speechQueue = speech.finally(() => {
      queuedSpeechCount -= 1;
      if (queuedSpeechCount === 0) {
        isBotSpeaking = false;
        session.botSpeaking = false;
        console.log("🤖 BOT SPEAKING END");
        isListeningOpen = session.stage === STAGES.WAITING_FOR_CROP ||
          session.stage === STAGES.WAITING_FOR_LOCATION;
        if (isListeningOpen) {
          resetTurnBuffer();
          requiresFreshSpeechStart = true;
          if (metrics) metrics.listeningOpenAt = Date.now();
          console.log("🎤 LISTENING OPEN");
        } else if (
          session.stage === STAGES.WELCOME ||
          session.stage === STAGES.WAITING_FOR_BUYER_CONNECT ||
          session.stage === STAGES.WAITING_FOR_MATCH_ACTION
        ) {
          console.log("☎️ WAITING FOR DTMF");
        }
        logTurnLatency(metrics);
        if (activeResponseMetrics === metrics) activeResponseMetrics = null;
      }
    });
    return speechQueue;
  }

  async function safeSpeak(text, languageCode = responseLanguage(session.responseLanguage), metrics = activeResponseMetrics) {
    try {
      await speak(text, languageCode, metrics);
    } catch (error) {
      console.error("❌ TTS ERROR:", error.message);
      persistCallEvent("ERROR", { source: "tts", message: error.message });
    }
  }

  async function endConversation(text) {
    setStage(STAGES.END);
    await safeSpeak(text);
    if (exotelSocket.readyState === WebSocket.OPEN) {
      exotelSocket.close(1000, "Conversation complete");
    }
  }

  function generateAndPersistMatches() {
    try {
      const matches = findTopMarketplaceMatches(
        session.intent,
        session.commodity,
        session.quantityKg,
        session.location
      );
      callRepository.replaceCallMatches(callSid, matches);
      persistCallEvent("MATCHES_GENERATED", {
        count: matches.length,
        recommendedParticipantId: matches[0]?.participantId || null
      });
      return matches;
    } catch (error) {
      console.error("❌ MARKETPLACE MATCHING ERROR:", error.message);
      persistCallEvent("ERROR", { source: "marketplace_matching", message: error.message });
      return [];
    }
  }

  async function processSellLocation() {
    setStage(STAGES.PROCESSING_LOCATION);
    console.log("📍 LOCATION:", session.location);
    const discovery = await discoverMandiRates(session.commodity, session.location);
    const rates = discovery.rates;
    session.mandiRates = rates;
    session.mandiDiscovery = discovery;
    console.log("💰 MANDI DATA:", rates);
    const messages = messagesFor(session.responseLanguage);
    try {
      callRepository.replaceMandiResults(callSid, session.commodity, session.location, rates);
      persistCallEvent("MANDI_RESULTS_READY", {
        count: rates.length,
        marketsFound: discovery.totalAvailable,
        source: discovery.source,
        mode: discovery.mode,
        fromCache: Boolean(discovery.fromCache)
      });
    } catch (error) {
      console.error("❌ MANDI RESULT PERSISTENCE ERROR:", error.message);
      persistCallEvent("ERROR", { source: "mandi_persistence", message: error.message });
    }

    let mandiSpeech = mandiVoiceAnnouncement(discovery, session.commodity, session.location, session.responseLanguage);
    if (rates.length) {
      const best = rates.find(rate => rate.isRecommended) || rates[0];
      persistCallUpdate({ selectedMandi: best.mandi });
    }

    session.matches = generateAndPersistMatches();
    session.matchedBuyer = session.matches[0] || null;
    session.callableBuyer = selectCallableMatch(session.matches);
    console.log("⭐ RECOMMENDED MATCH:", session.matchedBuyer ? {
      rank: session.matchedBuyer.rank,
      name: session.matchedBuyer.name,
      score: session.matchedBuyer.score
    } : "none");
    console.log("📞 CALLABLE MATCH:", session.callableBuyer ? {
      rank: session.callableBuyer.rank,
      name: session.callableBuyer.name
    } : "none");

    if (!session.matchedBuyer) {
      if (!rates.length) return endConversation(`${mandiSpeech} ${messages.NO_BUYERS_RECORDED} ${messages.THANK_YOU}`);
      setStage(STAGES.WAITING_FOR_MATCH_ACTION);
      return safeSpeak(`${mandiSpeech} ${messages.NO_BUYERS_RECORDED} ${getMandiMessages(session.responseLanguage).menu(false)}`);
    }

    persistCallUpdate({ matchedBuyerId: session.matchedBuyer.participantId });
    const matchSpeech = matchVoiceAnnouncement("SELL", session.matches, session.responseLanguage);
    if (!session.callableBuyer) {
      setStage(STAGES.WAITING_FOR_MATCH_ACTION);
      return safeSpeak(
        `${mandiSpeech} ${matchSpeech} ${messages.BUYER_PHONE_UNAVAILABLE} ${getMandiMessages(session.responseLanguage).menu(false)}`
      );
    }

    setStage(STAGES.WAITING_FOR_BUYER_CONNECT);
    return safeSpeak(`${mandiSpeech} ${matchSpeech} ${getMandiMessages(session.responseLanguage).menu(true)}`);
  }

  async function processBuyLocation() {
    setStage(STAGES.PROCESSING_LOCATION);
    console.log("📍 LOCATION:", session.location);
    session.matches = generateAndPersistMatches();
    session.matchedSellers = session.matches;
    session.recommendedSeller = session.matches[0] || null;
    const messages = messagesFor(session.responseLanguage);

    if (!session.matchedSellers.length) {
      return endConversation(`${messages.NO_SELLERS_RECORDED} ${messages.THANK_YOU}`);
    }

    console.log("⭐ RECOMMENDED MATCH:", {
      rank: session.recommendedSeller.rank,
      name: session.recommendedSeller.name,
      score: session.recommendedSeller.score
    });
    setStage(STAGES.WAITING_FOR_MATCH_ACTION);
    return safeSpeak(
      `${matchVoiceAnnouncement("BUY", session.matches, session.responseLanguage)} ${messages.BUY_MATCH_SMS_MENU}`
    );
  }

  function lockLanguageFromFirstSpeech(transcript, detectedLanguage, confidence) {
    if (session.languageLocked) return;
    const result = lockSessionLanguage(session, transcript, detectedLanguage, confidence);
    if (!result.locked) {
      if (result.reason !== "insufficient_speech") {
        console.log("🌐 LANGUAGE DETECTION UNCERTAIN: keeping Hindi until the next meaningful utterance");
      }
      return;
    }

    const candidate = result.candidate;
    console.log("🌐 LANGUAGE DETECTED:", {
      detected: session.detectedLanguage,
      response: session.responseLanguage,
      locked: session.languageLocked,
      ...(session.languageFallbackReason ? { fallback: session.languageFallbackReason } : {})
    });
    persistCallUpdate({
      language: session.detectedLanguage,
      detectedLanguage: session.detectedLanguage,
      responseLanguage: session.responseLanguage,
      languageConfidence: session.languageConfidence,
      languageFallbackReason: session.languageFallbackReason
    });
    persistCallEvent("LANGUAGE_DETECTED", {
      language: session.detectedLanguage,
      detectedLanguage: session.detectedLanguage,
      responseLanguage: session.responseLanguage,
      confidence: session.languageConfidence,
      fallbackReason: session.languageFallbackReason,
      source: candidate.source
    });
  }

  function promptForMissingSlots() {
    const missing = missingRequiredSlots(session);
    const messages = messagesFor(session.responseLanguage);
    let prompt;
    if (missing.includes("commodity") && missing.includes("quantityKg")) {
      const explicitCropQuantity = session.intent === "BUY"
        ? messages.RETRY_CROP_QUANTITY_BUY
        : messages.RETRY_CROP_QUANTITY_SELL;
      prompt = session.retryCount > 1 ? explicitCropQuantity : messages.ASK_CROP_QUANTITY;
    } else if (missing.includes("commodity")) {
      prompt = session.retryCount > 1 ? messages.RETRY_CROP : messages.ASK_CROP;
    } else if (missing.includes("quantityKg")) {
      prompt = session.retryCount > 1 ? messages.RETRY_QUANTITY : messages.ASK_QUANTITY;
    } else {
      prompt = session.retryCount > 1 ? messages.RETRY_LOCATION : messages.ASK_LOCATION;
    }
    return session.retryCount === 1 ? `${messages.RETRY} ${prompt}` : prompt;
  }

  function reopenListeningWithoutPrompt() {
    isProcessingUser = false;
    isListeningOpen = true;
    resetTurnBuffer();
    console.log("🎤 LISTENING OPEN — continuing current question");
  }

  async function finalizeCurrentTurn() {
    if (!isListeningOpen || isBotSpeaking || isProcessingUser || currentTurn.inSpeech) return;
    const turn = currentTurn;
    if (turn.finalized) return;
    if (isStaleTurn(turn, session)) {
      console.log(`🗣 STALE TURN IGNORED ${turn.turnId}`);
      resetTurnBuffer();
      return;
    }
    const finalTranscript = turn.transcriptBuffer.trim();
    if (!finalTranscript) return;

    const normalized = normalizeTranscript(finalTranscript);
    const now = Date.now();
    if (isDuplicateTurn({
      transcript: normalized,
      stageId: turn.stageId,
      lastTranscript,
      lastStageId: lastTranscriptStageId,
      lastProcessedAt: lastTranscriptTime,
      now,
      windowMs: DUPLICATE_TURN_WINDOW_MS
    })) {
      console.log(`🗣 TURN DUPLICATE IGNORED ${turn.turnId}`);
      reopenListeningWithoutPrompt();
      return;
    }

    turn.finalized = true;
    lastTranscript = normalized;
    lastTranscriptTime = now;
    lastTranscriptStageId = turn.stageId;
    session.lastProcessedTranscript = normalized;
    session.lastProcessedAt = now;
    session.transcriptBuffer = "";
    isListeningOpen = false;
    isProcessingUser = true;
    session.isProcessingTurn = true;
    clearTimeout(turnFinalizeTimer);
    turnFinalizeTimer = null;

    console.log(`🗣 TURN FINALIZED ${turn.turnId}`);
    try {
    const before = {
      commodity: session.commodity,
      quantityKg: session.quantityKg,
      location: session.location
    };
    const metrics = {
      speechStartAt: turn.speechStartAt,
      speechEndAt: turn.speechEndAt,
      sttStartAt: turn.sttStartAt,
      transcriptAt: turn.lastTranscriptAt,
      processingStartAt: Date.now()
    };
    activeResponseMetrics = metrics;

    console.log("⏱ PROCESSING START");
    console.log("📝 FINAL TURN:", finalTranscript);
    for (const candidate of turn.languageCandidates) {
      lockLanguageFromFirstSpeech(candidate.transcript, candidate.languageCode, candidate.confidence);
      if (session.languageLocked) break;
    }
    if (!session.languageLocked) lockLanguageFromFirstSpeech(finalTranscript, null, null);

    try {
      callRepository.addTranscript(callSid, finalTranscript, session.detectedLanguage || session.responseLanguage, new Date().toISOString());
      publishCallUpdate("TRANSCRIPT_ADDED");
    } catch (error) {
      console.error("❌ TRANSCRIPT PERSISTENCE ERROR:", error.message);
      persistCallEvent("ERROR", { source: "transcript_persistence", message: error.message });
    }

    session.intent = turn.slots.intent || session.intent;
    session.commodity = turn.slots.commodity || session.commodity;
    session.quantityKg = turn.slots.quantityKg || session.quantityKg;
    session.location = turn.slots.location || session.location;
    console.log("🌾 EXTRACTED SLOTS:", {
      intent: session.intent,
      commodity: session.commodity,
      quantityKg: session.quantityKg,
      location: session.location
    });

    const madeProgress = before.commodity !== session.commodity ||
      before.quantityKg !== session.quantityKg || before.location !== session.location;

    persistCallUpdate({
      intent: session.intent,
      commodity: session.commodity,
      quantityKg: session.quantityKg,
      location: session.location
    });
    if (madeProgress) {
      persistCallEvent("SLOTS_UPDATED", {
        commodity: session.commodity,
        quantityKg: session.quantityKg,
        location: session.location
      });
    }

    if (!madeProgress) {
      session.emptyTurnCount += 1;
      activeResponseMetrics = null;
      if (session.emptyTurnCount === 1) {
        console.log("📝 Low-information turn ignored; waiting for continuation");
        reopenListeningWithoutPrompt();
        return;
      }
      session.retryCount += 1;
    } else {
      session.emptyTurnCount = 0;
      session.retryCount = 0;
    }

    if (session.retryCount >= MAX_REPROMPTS) {
      metrics.decisionAt = Date.now();
      await endConversation(`${messagesFor(session.responseLanguage).MAX_RETRIES_EXCEEDED} ${messagesFor(session.responseLanguage).THANK_YOU}`);
      isProcessingUser = false;
      return;
    }

    metrics.decisionAt = Date.now();
    const missing = missingRequiredSlots(session);
    if (!missing.length) {
      if (session.intent === "SELL") await processSellLocation();
      else if (session.intent === "BUY") await processBuyLocation();
    } else if (missing.includes("commodity") || missing.includes("quantityKg")) {
      setStage(STAGES.PROCESSING_CROP);
      setStage(STAGES.WAITING_FOR_CROP);
      await safeSpeak(promptForMissingSlots());
    } else {
      setStage(STAGES.WAITING_FOR_LOCATION);
      await safeSpeak(promptForMissingSlots());
    }
    } finally {
      isProcessingUser = false;
      session.isProcessingTurn = false;
    }
  }

  function scheduleTurnFinalization() {
    clearTimeout(turnFinalizeTimer);
    console.log(`🗣 TURN GRACE STARTED ${currentTurn.turnId}`);
    turnFinalizeTimer = setTimeout(() => {
      turnFinalizeTimer = null;
      session.pendingTurnTimer = null;
      finalizeCurrentTurn().catch(error => {
        isProcessingUser = false;
        session.isProcessingTurn = false;
        isListeningOpen = true;
        console.error("❌ CONVERSATION ERROR:", error);
        persistCallEvent("ERROR", { source: "conversation", message: error.message });
      });
    }, TURN_END_GRACE_MS);
    session.pendingTurnTimer = turnFinalizeTimer;
  }

  function handleSpeechSignal(signalType) {
    if (!isListeningOpen || isBotSpeaking || isProcessingUser) return;
    const normalizedSignal = signalType === "SPEECH_START" ? "START_SPEECH"
      : signalType === "SPEECH_END" ? "END_SPEECH"
        : signalType;
    if (normalizedSignal === "START_SPEECH") {
      if (turnFinalizeTimer) console.log(`🗣 TURN GRACE CANCELLED ${currentTurn.turnId}`);
      clearTimeout(turnFinalizeTimer);
      turnFinalizeTimer = null;
      session.pendingTurnTimer = null;
      requiresFreshSpeechStart = false;
      currentTurn.inSpeech = true;
      session.farmerSpeaking = true;
      currentTurn.speechStartAt ||= Date.now();
      console.log(`🗣 TURN START ${currentTurn.turnId}`);
    } else if (normalizedSignal === "END_SPEECH") {
      currentTurn.inSpeech = false;
      session.farmerSpeaking = false;
      currentTurn.speechEndAt = Date.now();
      console.log(`🗣 TURN END DETECTED ${currentTurn.turnId}`);
      scheduleTurnFinalization();
    }
  }

  function handleTranscript(transcript, detectedLanguage, confidence) {
    const rejectionReason = transcriptRejectionReason({
      listeningOpen: isListeningOpen,
      botSpeaking: isBotSpeaking,
      processingTurn: isProcessingUser,
      requiresFreshSpeechStart
    });
    if (rejectionReason) {
      console.log(`🗣 TRANSCRIPT IGNORED ${rejectionReason}`);
      return;
    }
    const receivedAt = Date.now();
    if (!accumulateTurnTranscript(currentTurn, transcript, detectedLanguage, confidence, receivedAt)) {
      console.log("🗣 Duplicate/low-information transcript buffered out:", transcript);
      return;
    }
    session.transcriptBuffer = currentTurn.transcriptBuffer;
    console.log(`🗣 TURN BUFFER UPDATE ${currentTurn.turnId}`);
    if (!currentTurn.inSpeech) scheduleTurnFinalization();
  }

  function prepareBuyerHandoff() {
    if (!callSid || !session.callableBuyer?.phone) {
      console.error("❌ BUYER CONNECT FAILED: missing CallSid or buyer number");
      return false;
    }

    const callableBuyer = authorizeCallableBuyerConnection(callSid, session.matches);
    if (!callableBuyer) {
      console.error("❌ BUYER CONNECT FAILED: no valid callable marketplace match");
      return false;
    }
    session.callableBuyer = callableBuyer;
    persistCallUpdate({
      buyerConnectionRequested: true,
      buyerConnectionStatus: "REQUESTED"
    });
    persistCallEvent("BUYER_CONNECT_REQUESTED", {
      buyerName: callableBuyer.name,
      participantId: callableBuyer.participantId,
      matchRank: callableBuyer.rank
    });
    console.log("☎️ BUYER TRANSFER REQUESTED:", { callSid, buyer: callableBuyer.name });
    return true;
  }

  async function handleDtmf(digit) {
    console.log("\n☎️ DTMF:", digit);
    if (session.stage === STAGES.WELCOME) {
      if (digit !== "1" && digit !== "2") return;
      session.intent = digit === "1" ? "BUY" : "SELL";
      persistCallUpdate({ intent: session.intent });
      persistCallEvent(session.intent === "BUY" ? "BUY_SELECTED" : "SELL_SELECTED");
      setStage(STAGES.PROCESSING_CROP);
      setStage(STAGES.WAITING_FOR_CROP);
      const messages = messagesFor(session.responseLanguage);
      return safeSpeak(session.intent === "SELL"
        ? messages.ASK_CROP_QUANTITY_SELL
        : messages.ASK_CROP_QUANTITY_BUY);
    }

    const finalAction = resolveFinalMatchAction(session.stage, session.intent, digit);

    if (finalAction === "CONNECT_BUYER") {
      console.log("\n☎️ FARMER PRESSED 1");
      console.log("🤝 PREPARING BUYER HANDOFF");

      setStage(STAGES.CONNECTING_BUYER);
      if (!prepareBuyerHandoff()) return;

      await safeSpeak(
        messagesFor(session.responseLanguage).CONNECTING_BUYER,
        session.responseLanguage
      );

      console.log("🔌 TTS COMPLETE — CLOSING VOICEBOT SOCKET");

      setTimeout(() => {
        if (exotelSocket.readyState === WebSocket.OPEN) {
          console.log("🔌 CLOSING EXOTEL WEBSOCKET NOW");
          exotelSocket.close(1000, "handoff-to-connect");
        } else {
          console.log("⚠️ WebSocket already not OPEN:", exotelSocket.readyState);
        }
      }, 500);

      return;
    }

    if (finalAction === "REQUEST_TOP5_MANDI_SMS") {
      const copy = getMandiMessages(session.responseLanguage);
      try {
        if (!session.callerNumber && callSid) {
          const resolvedCaller = await smsProvider.resolveCallerNumber(callSid);
          if (resolvedCaller) {
            session.callerNumber = resolvedCaller;
            persistCallUpdate({ callerNumber: resolvedCaller });
          }
        }
        const delivery = await sendMandiRatesSmsOnce({
          session,
          provider: smsProvider,
          callerNumber: session.callerNumber,
          commodity: session.commodity,
          location: session.location,
          rates: session.mandiRates,
          language: session.responseLanguage
        });
        persistCallEvent(delivery.status === "SENT" ? "MANDI_SMS_SENT" : "MANDI_SMS_FAILED", {
          status: delivery.status,
          errorCode: delivery.errorCode || null,
          recipient: delivery.recipient || null,
          count: session.mandiRates.length
        });
        return endConversation(`${delivery.status === "SENT" ? copy.smsSent : copy.smsFailed} ${messagesFor(session.responseLanguage).THANK_YOU}`);
      } catch (error) {
        console.error("❌ MANDI SMS ERROR:", error.message);
        persistCallEvent("MANDI_SMS_FAILED", { status: "FAILED", errorCode: "MANDI_SMS_REQUEST_FAILED" });
        return endConversation(`${copy.smsFailed} ${messagesFor(session.responseLanguage).THANK_YOU}`);
      }
    }

    if (finalAction === "REQUEST_TOP5_SMS") {
      try {
        const result = createPendingTop5SmsRequest(callSid, session.intent, session.detectedLanguage || session.responseLanguage);
        if (!result) {
          persistCallEvent("ERROR", { source: "sms_request", message: "No stored matches available" });
          return endConversation(messagesFor(session.responseLanguage).THANK_YOU);
        }
        const matchIds = result.request.matches.map(match => match.call_match_id);
        console.log("📩 TOP-5 SMS REQUESTED", {
          callSid,
          matchType: result.request.match_type,
          status: result.request.status,
          matchIds
        });
        if (result.created) {
          persistCallEvent("TOP5_SMS_REQUESTED", {
            smsRequestId: result.request.id,
            matchType: result.request.match_type,
            status: result.request.status,
            matchIds
          });
        } else {
          publishCallUpdate("TOP5_SMS_REQUESTED");
        }
        const delivery = await smsDeliveryService.deliverTop5({
          callSid,
          intent: session.intent,
          language: session.detectedLanguage || session.responseLanguage
        });
        const messages = messagesFor(session.responseLanguage);
        const confirmation = delivery.status === "SENT"
          ? (session.intent === "SELL"
            ? messages.TOP5_BUYERS_SMS_CONFIRMATION
            : messages.TOP5_SELLERS_SMS_CONFIRMATION)
          : messages.SMS_SEND_FAILED;
        return endConversation(`${confirmation} ${messages.THANK_YOU}`);
      } catch (error) {
        console.error("❌ SMS REQUEST PERSISTENCE ERROR:", error.message);
        persistCallEvent("ERROR", { source: "sms_request", message: error.message });
        return endConversation(messagesFor(session.responseLanguage).THANK_YOU);
      }
    }

    if (finalAction === "END_CALL") {
      return endConversation(messagesFor(session.responseLanguage).THANK_YOU);
    }
  }

  const sarvamUrl =
    "wss://api.sarvam.ai/speech-to-text/ws" +
    "?language-code=unknown" +
    "&model=saaras:v3" +
    "&mode=transcribe" +
    "&sample_rate=8000" +
    "&input_audio_codec=pcm_s16le" +
    "&high_vad_sensitivity=false" +
    "&positive_speech_threshold=0.6" +
    "&negative_speech_threshold=0.4" +
    "&min_speech_frames=2" +
    "&first_turn_min_speech_frames=3" +
    "&negative_frames_count=8" +
    "&negative_frames_window=12" +
    "&pre_speech_pad_frames=9" +
    "&vad_signals=true" +
    "&flush_signal=true";
  const sarvamSocket = new WebSocket(sarvamUrl, {
    headers: { "Api-Subscription-Key": process.env.SARVAM_API_KEY }
  });

  function sendAudioToSarvam(audioBase64) {
    if (!currentTurn.sttStartAt) {
      currentTurn.sttStartAt = Date.now();
      console.log("⏱ STT START");
    }
    forwardedAudioBytes += Buffer.byteLength(audioBase64, "base64");
    sarvamSocket.send(JSON.stringify({
      audio: { data: audioBase64, sample_rate: 8000, encoding: "audio/wav" }
    }));
  }

  function queuePendingAudio(audioBase64) {
    const bytes = Buffer.byteLength(audioBase64, "base64");
    pendingAudioFrames.push({ audioBase64, bytes });
    pendingAudioBytes += bytes;
    while (pendingAudioBytes > MAX_PENDING_AUDIO_BYTES && pendingAudioFrames.length) {
      pendingAudioBytes -= pendingAudioFrames.shift().bytes;
    }
  }

  function flushPendingAudio() {
    if (!isListeningOpen || sarvamSocket.readyState !== WebSocket.OPEN) return;
    if (pendingAudioFrames.length) {
      console.log(`🎤 Flushing ${pendingAudioFrames.length} queued audio frames to STT`);
    }
    for (const frame of pendingAudioFrames) sendAudioToSarvam(frame.audioBase64);
    pendingAudioFrames = [];
    pendingAudioBytes = 0;
  }

  sarvamSocket.on("open", () => {
    console.log("🧠 SARVAM STT CONNECTED");
    flushPendingAudio();
  });
  sarvamSocket.on("message", data => {
    try {
      const response = JSON.parse(data.toString());
      const signalType = response.data?.signal_type || response.signal_type;
      if ((response.type === "events" || response.type === "event") && signalType) {
        handleSpeechSignal(String(signalType).toUpperCase());
      }

      let transcript = "";
      if (response.type === "data" && response.data?.transcript) transcript = response.data.transcript;
      else if (response.type === "transcript" && response.transcript) transcript = response.transcript;
      const detectedLanguage = response.data?.language_code ?? response.language_code ?? null;
      const confidence = response.data?.language_probability ?? response.language_probability ?? null;
      if (transcript) {
        console.log("🧠 STT RESULT:", {
          transcript,
          detectedLanguage,
          confidence,
          forwardedAudioMs: Math.round(forwardedAudioBytes / 16)
        });
        forwardedAudioBytes = 0;
        handleTranscript(transcript, detectedLanguage, confidence);
      }
    } catch (error) {
      console.log("Raw Sarvam message:", data.toString());
    }
  });
  sarvamSocket.on("error", error => {
    console.error("❌ Sarvam error:", error.message);
    persistCallEvent("ERROR", { source: "sarvam_stt", message: error.message });
  });
  sarvamSocket.on("close", (code, reason) => {
    console.log("🧠 SARVAM STT CLOSED:", code, reason.toString() || "no reason");
  });

  exotelSocket.on("message", message => {
    try {
      const event = JSON.parse(message.toString());
      if (event.event === "connected") console.log("✅ Voicebot websocket connected");

      if (event.event === "start") {
        streamSid = event.stream_sid || event.start?.stream_sid;
        callSid = event.start?.call_sid || null;
        const callerNumber = callerNumberFromStart(event.start);
        session.callerNumber = callerNumber;
        console.log("▶️ CALL STARTED");
        console.log("Stream SID:", streamSid);
        console.log("Call SID:", callSid);
        console.log("Caller:", maskPhoneNumber(callerNumber) || "not supplied in start metadata");
        console.log("Audio format:", event.start?.media_format);
        try {
          const call = callRepository.createCall({
            callSid,
            streamSid,
            callerNumber,
            currentStage: session.stage
          });
          if (call) {
            session.callId = call.id;
            callRepository.addEvent(callSid, "CALL_STARTED", { streamSid });
            publishCallUpdate("CALL_STARTED");
          }
        } catch (error) {
          console.error("❌ CALL START PERSISTENCE ERROR:", error.message);
        }
        welcomeTimer = setTimeout(() => {
          welcomeTimer = null;
          safeSpeak(MESSAGES["hi-IN"].WELCOME, "hi-IN");
        }, 300);
      }

      if (event.event === "media") {
        const audioBase64 = event.media?.payload;
        // Hard echo gate: inbound audio never reaches STT during bot speech.
        if (audioBase64 && isListeningOpen && !isBotSpeaking && !isProcessingUser) {
          if (sarvamSocket.readyState === WebSocket.OPEN) sendAudioToSarvam(audioBase64);
          else if (sarvamSocket.readyState === WebSocket.CONNECTING) queuePendingAudio(audioBase64);
        }
      }

      if (event.event === "dtmf") {
        const digit = String(event.dtmf?.digit ?? "");
        handleDtmf(digit).catch(error => console.error("❌ DTMF ERROR:", error));
      }

      if (event.event === "stop") {
        console.log("🛑 CALL ENDED");
        clearTurnTimer();
        persistTerminalCall("COMPLETED", "CALL_COMPLETED", event.stop?.reason || null);
        if (sarvamSocket.readyState === WebSocket.OPEN) {
          sarvamSocket.send(JSON.stringify({ type: "flush" }));
          setTimeout(() => sarvamSocket.close(), 1000);
        }
      }
    } catch (error) {
      console.error("Exotel parsing error:", error.message);
      persistCallEvent("ERROR", { source: "exotel_event", message: error.message });
    }
  });

 exotelSocket.on("close", (code, reason) => {
  clearTurnTimer();
  session.isProcessingTurn = false;
  session.botSpeaking = false;
  const closeReason = reason?.toString() || "";
  const completed = session.stage === STAGES.END || session.stage === STAGES.CONNECTING_BUYER;
  persistTerminalCall(
    completed ? "COMPLETED" : "DISCONNECTED",
    completed ? "CALL_COMPLETED" : "CALL_DISCONNECTED",
    closeReason || `WebSocket closed with code ${code}`
  );
  console.log(
    "📴 EXOTEL WEBSOCKET CLOSED",
    "code =", code,
    "reason =", closeReason
  );
});
});

const PORT = process.env.PORT || 5000;
if (require.main === module) {
  server.listen(PORT, () => {
    warnIfExotelApiConfigurationIsIncomplete();
    console.log(`\n🌾 KisanSetu running on http://localhost:${PORT}`);
    console.log(`🎙 Voicebot websocket: ws://localhost:${PORT}/voicebot`);
  });
}

module.exports = {
  CROP_INPUT_ALIASES,
  CROP_TRANSLATIONS,
  DUPLICATE_TURN_WINDOW_MS,
  LANGUAGE_CONFIDENCE_THRESHOLD,
  MESSAGES,
  STAGES,
  TURN_END_GRACE_MS,
  accumulateTurnTranscript,
  adminEvents,
  app,
  authorizeCallableBuyerConnection,
  authorizeBuyerConnection,
  buildTtsConfig,
  createTurnBuffer,
  cropName,
  createPendingTop5SmsRequest,
  detectLanguageCandidate,
  extractFarmerData,
  findCompatibleSellers,
  findTopMarketplaceMatches,
  discoverMandiRates,
  getMandiRates,
  isMeaningfulTranscript,
  isLanguageLockEligibleTranscript,
  createLanguageSessionState,
  lockSessionLanguage,
  mergeSlots,
  marketplaceRepository,
  matchVoiceAnnouncement,
  mandiVoiceAnnouncement,
  messagesFor,
  missingRequiredSlots,
  normalizeLanguageCode,
  normalizeTranscript,
  resolveBuyerConnection,
  resolveFinalMatchAction,
  callRepository,
  server,
  spokenNumber
};
app.get("/connect-buyer", (req, res) => {
  const callSid = requestCallSid(req.query);

  console.log("\n📞 CONNECT APPLET REQUEST");
  console.log("CallSid:", callSid);

  const buyerNumber = resolveBuyerConnection(callSid);
  console.log("Authorization:", {
    callSid: callSid || "missing",
    authorized: Boolean(buyerNumber)
  });

  res.setHeader("Content-Type", "application/json");

  res.status(200).json({
    fetch_after_attempt: false,

    destination: {
      numbers: buyerNumber ? [buyerNumber] : []
    },

    record: false,

    max_ringing_duration: 30,

    max_conversation_duration: 900,

    music_on_hold: {
      type: "operator_tone"
    },

    start_call_playback: {
      playback_to: "callee",
      type: "text",
      value:
        "KisanSetu se ek kisan aapse baat karna chahta hai."
    }
  });
});
