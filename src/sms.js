const SMS_LANGUAGE = Object.freeze({
  "hi-IN": {
    buyers: "शीर्ष खरीदार",
    sellers: "शीर्ष विक्रेता",
    forRequirement: (quantity, crop) => `${quantity} किग्रा ${crop} के लिए:`,
    verified: "सत्यापित",
    contact: "संपर्क किसानसेतु के माध्यम से करें।",
    crops: { Tomato: "टमाटर", Onion: "प्याज" }
  },
  "gu-IN": {
    buyers: "ટોચના ખરીદદારો",
    sellers: "ટોચના વિક્રેતાઓ",
    forRequirement: (quantity, crop) => `${quantity} કિગ્રા ${crop} માટે:`,
    verified: "ચકાસેલ",
    contact: "સંપર્ક કિસાનસેતુ દ્વારા કરો.",
    crops: { Tomato: "ટામેટા", Onion: "ડુંગળી" }
  },
  "ml-IN": {
    buyers: "മികച്ച വാങ്ങുന്നവർ",
    sellers: "മികച്ച വിൽപ്പനക്കാർ",
    forRequirement: (quantity, crop) => `${quantity} കിലോ ${crop} ആവശ്യത്തിന്:`,
    verified: "പരിശോധിച്ചത്",
    contact: "കിസാൻസേതു വഴി ബന്ധപ്പെടുക.",
    crops: { Tomato: "തക്കാളി", Onion: "സവാള" }
  },
  "kn-IN": {
    buyers: "ಅಗ್ರ ಖರೀದಿದಾರರು",
    sellers: "ಅಗ್ರ ಮಾರಾಟಗಾರರು",
    forRequirement: (quantity, crop) => `${quantity} ಕೆಜಿ ${crop} ಅಗತ್ಯಕ್ಕೆ:`,
    verified: "ಪರಿಶೀಲಿಸಲಾಗಿದೆ",
    contact: "ಕಿಸಾನ್‌ಸೇತು ಮೂಲಕ ಸಂಪರ್ಕಿಸಿ.",
    crops: { Tomato: "ಟೊಮೆಟೊ", Onion: "ಈರುಳ್ಳಿ" }
  }
});

const TEMPLATE_SUFFIX = Object.freeze({
  "hi-IN": "HI",
  "gu-IN": "GU",
  "ml-IN": "ML",
  "kn-IN": "KN"
});

function smsLanguage(language) {
  return SMS_LANGUAGE[language] ? language : "hi-IN";
}

function normalizeIndianPhoneNumber(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const raw = String(value).trim();
  if (!raw || /[A-Za-z*]/.test(raw)) return null;
  const digits = raw.replace(/\D/g, "");
  if (/^[6-9]\d{9}$/.test(digits)) return `+91${digits}`;
  if (/^0[6-9]\d{9}$/.test(digits)) return `+91${digits.slice(1)}`;
  if (/^91[6-9]\d{9}$/.test(digits)) return `+${digits}`;
  return null;
}

function maskPhoneNumber(value) {
  const normalized = normalizeIndianPhoneNumber(value);
  return normalized ? `+91********${normalized.slice(-2)}` : null;
}

function callerNumberFromStart(start = {}) {
  return normalizeIndianPhoneNumber(start.from || start.caller_number || start.callerNumber || null);
}

function compactNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return Number.isInteger(number) ? String(number) : String(Math.round(number * 10) / 10);
}

function formatTop5Sms({ call, matches, language }) {
  const languageCode = smsLanguage(language || call?.language);
  const copy = SMS_LANGUAGE[languageCode];
  const exactMatches = [...(matches || [])].sort((a, b) => a.rank - b.rank).slice(0, 5);
  if (!call || !exactMatches.length) return null;
  const typeLabel = call.intent === "SELL" ? copy.buyers : copy.sellers;
  const crop = copy.crops[call.commodity] || call.commodity || "—";
  const lines = ["KisanSetu", `${typeLabel} — ${copy.forRequirement(compactNumber(call.quantity_kg), crop)}`];

  for (const match of exactMatches) {
    const marker = match.is_recommended ? "★" : "";
    const price = match.price_per_kg === null ? "₹—/kg" : `₹${compactNumber(match.price_per_kg)}/kg`;
    const quantity = `${compactNumber(match.matched_quantity_kg)}kg`;
    const verified = match.verified ? ` | ✓ ${copy.verified}` : "";
    lines.push(`${marker}${match.rank}. ${match.name} | ${match.location} | ${price} | ${quantity}${verified}`);
  }
  lines.push(copy.contact, "KisanSetu");
  return { text: lines.join("\n"), language: languageCode, matchCount: exactMatches.length };
}

function estimateSmsSegments(text) {
  const value = String(text || "");
  const isUnicode = /[^\x00-\x7F]/.test(value);
  const singleLimit = isUnicode ? 70 : 160;
  const multipartLimit = isUnicode ? 67 : 153;
  return {
    characters: value.length,
    encoding: isUnicode ? "unicode" : "plain",
    segments: value.length <= singleLimit ? 1 : Math.ceil(value.length / multipartLimit)
  };
}

function safeProviderBody(body) {
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch (_error) {
    return { raw: String(body).slice(0, 1000) };
  }
}

function exotelConfiguration(env, language) {
  const languageCode = smsLanguage(language);
  const suffix = TEMPLATE_SUFFIX[languageCode];
  const templateId = env[`EXOTEL_DLT_TEMPLATE_ID_${suffix}`] ||
    (languageCode === "hi-IN" ? env.EXOTEL_DLT_TEMPLATE_ID : null);
  const values = {
    apiKey: env.EXOTEL_API_KEY,
    apiToken: env.EXOTEL_API_TOKEN,
    accountSid: env.EXOTEL_ACCOUNT_SID,
    subdomain: env.EXOTEL_SUBDOMAIN,
    from: env.EXOTEL_SMS_FROM,
    dltEntityId: env.EXOTEL_DLT_ENTITY_ID,
    dltTemplateId: templateId,
    smsType: env.EXOTEL_SMS_TYPE || "transactional_opt_in"
  };
  const missing = Object.entries(values)
    .filter(([key, value]) => key !== "smsType" && !value)
    .map(([key]) => key);
  return { ...values, missing };
}

function createExotelSmsProvider({ env = process.env, fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  function basicConfiguration() {
    const config = exotelConfiguration(env, "hi-IN");
    return config.apiKey && config.apiToken && config.accountSid ? config : null;
  }

  async function resolveCallerNumber(callSid) {
    const config = basicConfiguration();
    if (!config || !callSid || typeof fetchImpl !== "function") return null;
    const url = `https://${config.subdomain}/v1/Accounts/${encodeURIComponent(config.accountSid)}/Calls/${encodeURIComponent(callSid)}?details=true`;
    try {
      const response = await fetchImpl(url, {
        headers: {
          Authorization: `Basic ${Buffer.from(`${config.apiKey}:${config.apiToken}`).toString("base64")}`,
          Accept: "application/json"
        },
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (!response.ok) return null;
      const data = await response.json();
      return normalizeIndianPhoneNumber(data?.Call?.From || data?.call?.from || null);
    } catch (_error) {
      return null;
    }
  }

  async function sendSMS({ to, text, language, callId, idempotencyKey }) {
    const config = exotelConfiguration(env, language);
    if (config.missing.length || typeof fetchImpl !== "function") {
      return {
        ok: false,
        status: "BLOCKED_CONFIGURATION",
        errorCode: "MISSING_EXOTEL_SMS_CONFIGURATION",
        errorMessage: `Missing SMS configuration: ${config.missing.join(", ") || "fetch"}`
      };
    }

    const url = `https://${config.subdomain}/v1/Accounts/${encodeURIComponent(config.accountSid)}/Sms/send`;
    const metrics = estimateSmsSegments(text);
    const body = new URLSearchParams({
      From: config.from,
      To: to,
      Body: text,
      EncodingType: metrics.encoding,
      DltEntityId: config.dltEntityId,
      DltTemplateId: config.dltTemplateId,
      SmsType: config.smsType,
      CustomField: idempotencyKey || `TOP5_MATCHES:${callId}`
    });

    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${config.apiKey}:${config.apiToken}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json"
        },
        body,
        signal: AbortSignal.timeout(timeoutMs)
      });
      const rawBody = await response.text();
      const providerResponse = safeProviderBody(rawBody);
      if (!response.ok) {
        return {
          ok: false,
          status: "FAILED",
          errorCode: `EXOTEL_HTTP_${response.status}`,
          errorMessage: providerResponse?.RestException?.Message || `Exotel rejected the SMS request (${response.status})`,
          providerResponse
        };
      }
      const message = providerResponse?.SMSMessage || providerResponse?.sms_message || {};
      return {
        ok: true,
        status: "SENT",
        providerMessageId: message.Sid || message.sid || null,
        providerResponse
      };
    } catch (error) {
      return {
        ok: false,
        status: "FAILED",
        errorCode: error?.name === "TimeoutError" ? "EXOTEL_TIMEOUT" : "EXOTEL_REQUEST_FAILED",
        errorMessage: error?.name === "TimeoutError" ? "Exotel SMS request timed out" : "Exotel SMS request failed"
      };
    }
  }

  return { name: "EXOTEL", resolveCallerNumber, sendSMS };
}

function createSmsDeliveryService({ repository, provider, onStatus = () => {} }) {
  async function deliverTop5({ callSid, intent, language }) {
    const matchType = intent === "SELL" ? "BUYERS" : intent === "BUY" ? "SELLERS" : null;
    if (!matchType) return { status: "FAILED", errorCode: "INVALID_INTENT" };
    const requestResult = repository.createSmsRequest(callSid, matchType, language);
    if (!requestResult) return { status: "FAILED", errorCode: "NO_STORED_MATCHES" };

    let context = repository.getSmsDeliveryContext(callSid);
    if (!context) return { status: "FAILED", errorCode: "SMS_CONTEXT_MISSING" };
    const existing = context.delivery;
    if (existing && ["SENDING", "SENT", "FAILED", "BLOCKED_CONFIGURATION"].includes(existing.status)) {
      return { ...existing, duplicate: true };
    }

    let recipient = normalizeIndianPhoneNumber(context.call.caller_number);
    if (!recipient) {
      recipient = await provider.resolveCallerNumber(callSid);
      if (recipient) {
        repository.updateCall(callSid, { callerNumber: recipient });
        context.call.caller_number = recipient;
      }
    }

    const formatted = formatTop5Sms({ call: context.call, matches: context.matches, language });
    if (!formatted) return { status: "FAILED", errorCode: "NO_STORED_MATCHES" };
    const idempotencyKey = `TOP5_MATCHES:${context.call.id}`;
    let delivery = repository.createSmsDelivery({
      smsRequestId: context.request.id,
      callId: context.call.id,
      recipient,
      language: formatted.language,
      messageType: matchType === "BUYERS" ? "TOP5_BUYERS" : "TOP5_SELLERS",
      messageText: formatted.text,
      provider: provider.name || "UNKNOWN",
      idempotencyKey
    });

    if (!recipient) {
      delivery = repository.finishSmsDelivery(delivery.id, {
        status: "BLOCKED_CONFIGURATION",
        errorCode: "CALLER_NUMBER_UNAVAILABLE",
        errorMessage: "Caller number was not present in Exotel start metadata or Call Details"
      });
      onStatus("SMS_FAILED", delivery);
      return delivery;
    }

    delivery = repository.claimSmsDelivery(delivery.id);
    if (!delivery || delivery.status !== "SENDING") return { ...(delivery || {}), duplicate: true };
    onStatus("SMS_SENDING", delivery);

    const providerResult = await provider.sendSMS({
      to: recipient,
      text: formatted.text,
      language: formatted.language,
      callId: context.call.id,
      idempotencyKey
    });
    delivery = repository.finishSmsDelivery(delivery.id, {
      status: providerResult.status,
      providerMessageId: providerResult.providerMessageId,
      providerResponse: providerResult.providerResponse,
      errorCode: providerResult.errorCode,
      errorMessage: providerResult.errorMessage
    });
    onStatus(delivery.status === "SENT" ? "SMS_SENT" : "SMS_FAILED", delivery);
    return delivery;
  }

  return { deliverTop5 };
}

module.exports = {
  callerNumberFromStart,
  createExotelSmsProvider,
  createSmsDeliveryService,
  estimateSmsSegments,
  exotelConfiguration,
  formatTop5Sms,
  maskPhoneNumber,
  normalizeIndianPhoneNumber,
  smsLanguage
};
