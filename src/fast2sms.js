const { normalizeIndianPhoneNumber } = require("./sms");

const FAST2SMS_ENDPOINT = "https://www.fast2sms.com/dev/bulkV2";
const DEFAULT_TIMEOUT_MS = 8000;

const SMS_COPY = Object.freeze({
  "hi-IN": {
    heading: crop => `${crop} के खरीदार:`,
    connect: "खरीदार से जुड़ने के लिए कॉल में 1 दबाएँ।"
  },
  "gu-IN": {
    heading: crop => `${crop} માટે ખરીદદારો:`,
    connect: "કૉલમાં 1 દબાવી ખરીદદાર સાથે જોડાઓ."
  },
  "kn-IN": {
    heading: crop => `${crop}ಗಾಗಿ ಖರೀದಿದಾರರು:`,
    connect: "ಖರೀದಿದಾರರೊಂದಿಗೆ ಸಂಪರ್ಕಿಸಲು ಕರೆಯಲ್ಲಿ 1 ಒತ್ತಿರಿ."
  },
  "ml-IN": {
    heading: crop => `${crop} വാങ്ങുന്നവർ:`,
    connect: "വാങ്ങുന്നയാളുമായി ബന്ധപ്പെടാൻ കോളിൽ 1 അമർത്തുക."
  },
  "en-IN": {
    heading: crop => `Top buyers for ${crop}:`,
    connect: "Press 1 in the call to connect."
  }
});

function fast2SmsLanguage(languageCode) {
  const normalized = String(languageCode || "").trim().toLowerCase().replace(/_/g, "-");
  if (normalized === "en" || normalized === "en-in" || normalized === "en-us") return "en-IN";
  const canonical = Object.keys(SMS_COPY).find(code => code.toLowerCase() === normalized);
  return canonical || "hi-IN";
}

function normalizeFast2SmsPhone(phone) {
  const e164 = normalizeIndianPhoneNumber(phone);
  return e164 ? e164.slice(3) : null;
}

function matchValue(match, camel, snake) {
  return match?.[camel] ?? match?.[snake] ?? null;
}

function compactNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Number.isInteger(number) ? String(number) : String(Math.round(number * 10) / 10);
}

function formatTop5BuyerSms({ matches = [], commodity, localizedCrop, language }) {
  const languageCode = fast2SmsLanguage(language);
  const copy = SMS_COPY[languageCode];
  const buyers = [...matches]
    .sort((a, b) => Number(matchValue(a, "rank", "rank")) - Number(matchValue(b, "rank", "rank")))
    .slice(0, 5);
  if (!buyers.length || !commodity) return null;

  const crop = localizedCrop || commodity;
  const lines = ["KisanSetu", copy.heading(crop)];
  buyers.forEach((buyer, index) => {
    const rank = compactNumber(matchValue(buyer, "rank", "rank")) || String(index + 1);
    const name = matchValue(buyer, "name", "name") || "Buyer";
    const location = matchValue(buyer, "location", "location") || "";
    const price = compactNumber(matchValue(buyer, "pricePerKg", "price_per_kg"));
    lines.push(`${rank}. ${name}${location ? `, ${location}` : ""}${price ? ` ₹${price}/kg` : ""}`);
  });
  lines.push(copy.connect);
  return { text: lines.join("\n"), language: languageCode, matchCount: buyers.length };
}

function safeFailure(errorCode) {
  return String(errorCode || "request_failed").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
}

async function sendFast2SMS(
  { phone, message },
  {
    apiKey = process.env.FAST2SMS_API_KEY,
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    onHttpStatus = () => {}
  } = {}
) {
  const number = normalizeFast2SmsPhone(phone);
  if (!apiKey) return { ok: false, errorCode: "MISSING_FAST2SMS_API_KEY" };
  if (!number) return { ok: false, errorCode: "INVALID_RECIPIENT" };
  if (!String(message || "").trim()) return { ok: false, errorCode: "EMPTY_MESSAGE" };
  if (typeof fetchImpl !== "function") return { ok: false, errorCode: "FETCH_UNAVAILABLE" };

  try {
    const response = await fetchImpl(FAST2SMS_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: apiKey,
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        route: "q",
        message,
        numbers: number,
        sms_details: "1"
      }),
      signal: AbortSignal.timeout(timeoutMs)
    });
    onHttpStatus(response.status);
    let payload = null;
    try {
      payload = await response.json();
    } catch (_error) {
      return { ok: false, errorCode: "INVALID_FAST2SMS_RESPONSE" };
    }
    if (!response.ok) return { ok: false, errorCode: `FAST2SMS_HTTP_${response.status}` };
    if (payload?.return !== true) return { ok: false, errorCode: "FAST2SMS_REJECTED" };
    return { ok: true, requestId: payload.request_id || null };
  } catch (error) {
    return {
      ok: false,
      errorCode: error?.name === "TimeoutError" ? "FAST2SMS_TIMEOUT" : "FAST2SMS_REQUEST_FAILED"
    };
  }
}

function fast2SmsErrorMessage(errorCode) {
  if (errorCode === "MISSING_FAST2SMS_API_KEY") return "FAST2SMS_API_KEY is not configured";
  if (errorCode === "INVALID_RECIPIENT") return "The caller number is not a valid Indian mobile number";
  if (errorCode === "EMPTY_MESSAGE") return "The SMS message is empty";
  if (errorCode === "FAST2SMS_TIMEOUT") return "Fast2SMS request timed out";
  if (errorCode === "FAST2SMS_REJECTED") return "Fast2SMS rejected the SMS request";
  if (String(errorCode || "").startsWith("FAST2SMS_HTTP_")) {
    return `Fast2SMS rejected the SMS request (${String(errorCode).slice("FAST2SMS_HTTP_".length)})`;
  }
  return "Fast2SMS request failed";
}

function createFast2SmsProvider({
  env = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  resolveCallerNumber = async () => null,
  logger = console
} = {}) {
  return {
    name: "FAST2SMS",
    resolveCallerNumber,
    async sendSMS({ to, text }) {
      logger.log("SMS PROVIDER: FAST2SMS");
      if (!env.FAST2SMS_API_KEY) {
        return {
          ok: false,
          status: "BLOCKED_CONFIGURATION",
          errorCode: "MISSING_FAST2SMS_CONFIGURATION",
          errorMessage: "FAST2SMS_API_KEY is not configured"
        };
      }

      logger.log("SMS API REQUEST");
      const result = await sendFast2SMS(
        { phone: to, message: text },
        {
          apiKey: env.FAST2SMS_API_KEY,
          fetchImpl,
          timeoutMs,
          onHttpStatus(status) {
            logger.log(`SMS API HTTP STATUS: ${status}`);
          }
        }
      );
      if (result.ok) {
        return {
          ok: true,
          status: "SENT",
          providerMessageId: result.requestId,
          providerResponse: { request_id: result.requestId }
        };
      }
      return {
        ok: false,
        status: "FAILED",
        errorCode: result.errorCode,
        errorMessage: fast2SmsErrorMessage(result.errorCode)
      };
    }
  };
}

async function sendBuyerMatchesSmsOnce({
  session,
  callerNumber,
  matches,
  commodity,
  location,
  detectedLanguage,
  localizedCrop,
  sendSms = sendFast2SMS,
  logger = console
}) {
  if (!session) return { ok: false, skipped: "missing_session" };
  if (session.smsSent || session.smsSending) return { ok: false, skipped: "duplicate" };
  if (!commodity || !location) return { ok: false, skipped: "incomplete_slots" };
  if (!session.languageLocked || !detectedLanguage) return { ok: false, skipped: "language_unresolved" };
  if (!Array.isArray(matches) || !matches.length) return { ok: false, skipped: "no_buyers" };
  if (!normalizeFast2SmsPhone(callerNumber)) return { ok: false, skipped: "invalid_caller_number" };

  const formatted = formatTop5BuyerSms({ matches, commodity, localizedCrop, language: detectedLanguage });
  if (!formatted) return { ok: false, skipped: "message_unavailable" };

  session.smsSending = true;
  logger.log("[SMS] Sending...");
  try {
    const result = await sendSms({ phone: callerNumber, message: formatted.text });
    if (result?.ok) {
      session.smsSent = true;
      logger.log("[SMS] Sent successfully");
      return { ...result, language: formatted.language, matchCount: formatted.matchCount };
    }
    logger.error(`[SMS] Failed: ${safeFailure(result?.errorCode)}`);
    return result || { ok: false, errorCode: "FAST2SMS_REQUEST_FAILED" };
  } catch (_error) {
    logger.error("[SMS] Failed: FAST2SMS_REQUEST_FAILED");
    return { ok: false, errorCode: "FAST2SMS_REQUEST_FAILED" };
  } finally {
    session.smsSending = false;
  }
}

module.exports = {
  FAST2SMS_ENDPOINT,
  createFast2SmsProvider,
  fast2SmsLanguage,
  formatTop5BuyerSms,
  normalizeFast2SmsPhone,
  sendBuyerMatchesSmsOnce,
  sendFast2SMS
};
