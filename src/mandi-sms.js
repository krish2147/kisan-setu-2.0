const { maskPhoneNumber, normalizeIndianPhoneNumber } = require("./sms");

const SMS_LABELS = Object.freeze({
  "hi-IN": { heading: "शीर्ष मंडियां", recommended: "सुझाई गई मंडी", date: "भाव की तारीख", source: "स्रोत" },
  "gu-IN": { heading: "ટોચની મંડીઓ", recommended: "ભલામણ કરેલી મંડી", date: "ભાવની તારીખ", source: "સ્રોત" },
  "mr-IN": { heading: "सर्वोत्तम बाजार", recommended: "सुचवलेला बाजार", date: "भावाची तारीख", source: "स्रोत" },
  "bn-IN": { heading: "সেরা বাজার", recommended: "প্রস্তাবিত বাজার", date: "দামের তারিখ", source: "উৎস" },
  "ta-IN": { heading: "சிறந்த சந்தைகள்", recommended: "பரிந்துரைக்கப்பட்ட சந்தை", date: "விலை தேதி", source: "மூலம்" },
  "te-IN": { heading: "ఉత్తమ మార్కెట్లు", recommended: "సిఫారసు మార్కెట్", date: "ధర తేదీ", source: "మూలం" },
  "kn-IN": { heading: "ಉತ್ತಮ ಮಾರುಕಟ್ಟೆಗಳು", recommended: "ಶಿಫಾರಸು ಮಾರುಕಟ್ಟೆ", date: "ದರದ ದಿನಾಂಕ", source: "ಮೂಲ" },
  "ml-IN": { heading: "മികച്ച ചന്തകൾ", recommended: "ശുപാർശ ചെയ്ത ചന്ത", date: "വില തീയതി", source: "ഉറവിടം" },
  "pa-IN": { heading: "ਸਭ ਤੋਂ ਵਧੀਆ ਮੰਡੀਆਂ", recommended: "ਸੁਝਾਈ ਮੰਡੀ", date: "ਭਾਅ ਦੀ ਤਾਰੀਖ", source: "ਸਰੋਤ" },
  "od-IN": { heading: "ଶ୍ରେଷ୍ଠ ମଣ୍ଡି", recommended: "ସୁପାରିଶ ମଣ୍ଡି", date: "ଦର ତାରିଖ", source: "ଉତ୍ସ" },
  "en-IN": { heading: "Top mandi options", recommended: "Recommended", date: "Price date", source: "Source" }
});

function labelsFor(language) {
  return SMS_LABELS[language] || SMS_LABELS["hi-IN"];
}

function compactNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 }).format(number) : null;
}

function formatTop5MandiSms({ commodity, location, rates = [], language = "hi-IN" }) {
  const selected = [...rates].sort((a, b) => Number(a.rank || 99) - Number(b.rank || 99)).slice(0, 5);
  if (!commodity || !location || !selected.length) return null;
  const labels = labelsFor(language);
  const lines = ["KisanSetu", `${commodity} — ${location}`, labels.heading];
  selected.forEach((rate, index) => {
    const price = compactNumber(rate.modalPrice ?? rate.modal);
    if (!price) return;
    const district = rate.district && rate.district !== location ? `, ${rate.district}` : "";
    const hasDistance = rate.distanceKm !== null && rate.distanceKm !== undefined &&
      Number.isFinite(Number(rate.distanceKm));
    const distance = hasDistance ? ` — ${compactNumber(rate.distanceKm)} km` : "";
    lines.push(`${index + 1}. ${rate.mandi}${district} — ₹${price}/qtl${distance}`);
  });
  const recommended = selected.find(rate => rate.isRecommended) || selected[0];
  const latestDate = selected.map(rate => rate.observedAt).filter(Boolean).sort().at(-1);
  lines.push(`${labels.recommended}: ${recommended.mandi}`);
  if (latestDate) lines.push(`${labels.date}: ${latestDate}`);
  lines.push(`${labels.source}: ${recommended.source}`);
  return { text: lines.join("\n"), matchCount: selected.length };
}

async function sendMandiRatesSmsOnce({ session, provider, callerNumber, commodity, location, rates, language, logger = console }) {
  if (!session || session.mandiSmsSent || session.mandiSmsSending) return { status: "SKIPPED", errorCode: "DUPLICATE_MANDI_SMS" };
  const recipient = normalizeIndianPhoneNumber(callerNumber);
  if (!recipient) return { status: "BLOCKED_CONFIGURATION", errorCode: "CALLER_NUMBER_UNAVAILABLE" };
  const formatted = formatTop5MandiSms({ commodity, location, rates, language });
  if (!formatted) return { status: "FAILED", errorCode: "NO_MANDI_RESULTS" };
  session.mandiSmsSending = true;
  logger.log("MANDI SMS REQUESTED", { recipient: maskPhoneNumber(recipient), count: formatted.matchCount });
  try {
    const result = await provider.sendSMS({
      to: recipient,
      text: formatted.text,
      language,
      idempotencyKey: `TOP5_MANDIS:${session.callId || "current"}`
    });
    if (result.status === "SENT") session.mandiSmsSent = true;
    return { ...result, messageText: formatted.text, recipient: maskPhoneNumber(recipient) };
  } catch (_error) {
    return { status: "FAILED", errorCode: "FAST2SMS_REQUEST_FAILED" };
  } finally {
    session.mandiSmsSending = false;
  }
}

module.exports = { SMS_LABELS, formatTop5MandiSms, sendMandiRatesSmsOnce };
