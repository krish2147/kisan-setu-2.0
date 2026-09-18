const fs = require("node:fs");
const defaults = require("./sarvam-capabilities.json");

// Capabilities are deployment data, independent of the application's translations.
// A new provider model/language needs a verified manifest, not detection branches.
function createSpeechLanguages({ env = process.env, manifest = defaults } = {}) {
  const sttModel = env.SARVAM_STT_MODEL || "saaras:v3";
  const ttsModel = env.SARVAM_TTS_MODEL || "bulbul:v3";
  const translationModel = env.SARVAM_TRANSLATION_MODEL || "sarvam-translate:v1";
  function languagesFor(service, model) {
    const entry = manifest[service]?.[model];
    if (!entry?.source || !Array.isArray(entry.languages) || !entry.languages.length ||
        entry.languages.some(code => typeof code !== "string" || !/^[a-z]{2,3}-[A-Z]{2}$/.test(code))) {
      throw new Error(`Missing or invalid verified Sarvam ${service} capabilities for ${model}`);
    }
    return Object.freeze([...new Set(entry.languages)]);
  }
  const sttLanguages = languagesFor("stt", sttModel);
  const ttsLanguages = languagesFor("tts", ttsModel);
  const translationLanguages = languagesFor("translation", translationModel);
  // The welcome and existing safe fallback are Hindi. Reject an incompatible
  // deployment at startup instead of failing during a farmer's call.
  if (!ttsLanguages.includes("hi-IN")) throw new Error("Sarvam TTS must support the Hindi welcome/fallback");
  const names = new Intl.DisplayNames(["en"], { type: "language" });
  const codes = [...new Set([...sttLanguages, ...ttsLanguages])];
  const aliases = new Map();
  const scripts = new Map();
  for (const code of codes) {
    const base = code.split("-")[0];
    const localeBase = manifest.localeCodes?.[base] || base;
    aliases.set(code.toLowerCase(), code);
    // Only accept a bare language when its region is unambiguous.
    const sameBase = codes.filter(value => value.split("-")[0] === base);
    if (sameBase.length === 1) {
      aliases.set(base, code);
      aliases.set(names.of(localeBase).toLowerCase(), code);
    }
    if (sttLanguages.includes(code)) {
      const script = new Intl.Locale(localeBase).maximize().script;
      if (script) scripts.set(script, [...(scripts.get(script) || []), code]);
    }
  }
  for (const [alias, base] of Object.entries(manifest.aliases || {})) {
    const code = aliases.get(base);
    if (code) {
      aliases.set(alias, code);
      aliases.set(`${alias}-${code.split("-")[1]}`.toLowerCase(), code);
    }
  }
  function normalize(languageCode, service = "stt") {
    if (typeof languageCode !== "string") return null;
    const code = aliases.get(languageCode.trim().replace(/_/g, "-").toLowerCase());
    return (service === "tts" ? ttsLanguages : sttLanguages).includes(code) ? code : null;
  }
  // Preserve the existing script recovery, generalized to every unambiguous
  // script in the configured STT model. Shared scripts never choose a language.
  // Latin text can be transliteration of any language, not proof of English.
  const uniqueScripts = [...scripts].filter(([script, languages]) => script !== "Latn" && languages.length === 1)
    .flatMap(([script, [language]]) => {
      try { return [{ language, pattern: new RegExp(`\\p{Script=${script}}`, "u") }]; }
      catch { return []; } // ICU may know a newer script than this JS engine.
    });
  function scriptLanguage(transcript) {
    const matches = uniqueScripts.filter(({ pattern }) => pattern.test(transcript));
    return matches.length === 1 ? matches[0].language : null;
  }
  function selectResponse(languageCode, hasMessages) {
    const language = normalize(languageCode);
    const reason = !hasMessages(language) ? "response_bundle_unavailable"
      : !normalize(language, "tts") ? "tts_language_unavailable" : null;
    return { language: reason ? "hi-IN" : language, reason };
  }
  return Object.freeze({ sttModel, ttsModel, translationModel, sttLanguages, ttsLanguages,
    translationLanguages, normalize, scriptLanguage, selectResponse });
}

function loadSpeechLanguages(env = process.env) {
  const manifest = env.SARVAM_CAPABILITIES_FILE
    ? JSON.parse(fs.readFileSync(env.SARVAM_CAPABILITIES_FILE, "utf8")) : defaults;
  return createSpeechLanguages({ env, manifest });
}

module.exports = { createSpeechLanguages, loadSpeechLanguages };
