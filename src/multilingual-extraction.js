// Translation is only an input-normalization bridge. It never selects response
// language, generates farmer-facing messages, or bypasses the existing parser.
function createMultilingualExtractor({ capabilities, extract, env = process.env, fetchImpl = globalThis.fetch }) {
  return async function extractMissingSlots({ transcript, language, slots }) {
    const missing = ["commodity", "quantityKg", "location"].filter(key => !slots[key]);
    const source = capabilities.normalize(language);
    if (!missing.length || !source || source === "en-IN") return { slots, status: "not_needed" };
    if (!capabilities.translationLanguages.includes(source) || !env.SARVAM_API_KEY || typeof fetchImpl !== "function") {
      return { slots, status: "unavailable" };
    }
    if (!transcript || transcript.length > 2000) return { slots, status: "invalid_input" };
    try {
      const response = await fetchImpl("https://api.sarvam.ai/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json", "api-subscription-key": env.SARVAM_API_KEY },
        body: JSON.stringify({
          input: transcript,
          source_language_code: source,
          target_language_code: "en-IN",
          model: capabilities.translationModel,
          numerals_format: "international"
        }),
        signal: AbortSignal.timeout(5000)
      });
      if (!response.ok) return { slots, status: "provider_error" };
      const data = await response.json();
      if (typeof data.translated_text !== "string" || !data.translated_text.trim()) {
        return { slots, status: "invalid_response" };
      }
      const normalized = extract(data.translated_text);
      const filled = { ...slots };
      for (const key of missing) {
        if (normalized[key]) filled[key] = normalized[key];
      }
      return { slots: filled, status: "translated" };
    } catch {
      // Do not log provider exceptions: these can contain request credentials.
      return { slots, status: "provider_error" };
    }
  };
}

module.exports = { createMultilingualExtractor };
