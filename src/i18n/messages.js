const { ToWords } = require("to-words");
const { buildAdditionalMessageBundles } = require("./additional-messages");

const LANGUAGE_NAMES = {
  "hi-IN": "Hindi",
  "gu-IN": "Gujarati",
  "mr-IN": "Marathi",
  "pa-IN": "Punjabi",
  "bn-IN": "Bengali",
  "ta-IN": "Tamil",
  "te-IN": "Telugu",
  "kn-IN": "Kannada",
  "ml-IN": "Malayalam",
  "or-IN": "Odia",
  "en-IN": "English"
};

const NUMBER_WORD_CONVERTERS = Object.fromEntries(
  Object.keys(LANGUAGE_NAMES).map(languageCode => [
    languageCode,
    new ToWords({ localeCode: languageCode })
  ])
);

function normalizeLanguageCode(languageCode) {
  if (!languageCode) return null;
  const match = Object.keys(LANGUAGE_NAMES).find(
    code => code.toLowerCase() === String(languageCode).toLowerCase()
  );
  if (match) return match;
  if (String(languageCode).toLowerCase() === "od-in") return "or-IN";
  return null;
}

function spokenNumber(value, languageCode) {
  const language = normalizeLanguageCode(languageCode) || "hi-IN";
  const normalizedValue = typeof value === "string" ? value.replace(/,/g, "").trim() : value;
  try {
    let words = NUMBER_WORD_CONVERTERS[language].convert(normalizedValue);
    // Prefer the natural demo pronunciations requested for Hindi and Gujarati.
    if (language === "hi-IN") words = words.replace(/पांच/g, "पाँच");
    if (language === "gu-IN") words = words.replace(/([\u0A80-\u0AFF]+) સો/gu, "$1સો");
    return words;
  } catch (error) {
    console.error("❌ NUMBER LOCALIZATION ERROR:", { value, language, error: error.message });
    return String(value);
  }
}

const MESSAGES = {
  "hi-IN": {
    WELCOME: "नमस्कार। किसानसेतु में आपका स्वागत है। फसल खरीदने के लिए एक दबाएँ। फसल बेचने के लिए दो दबाएँ।",
    SELL_SELECTED: "आपने बेचने का विकल्प चुना है।",
    BUY_SELECTED: "आपने खरीदने का विकल्प चुना है।",
    ASK_CROP_QUANTITY_SELL: "कृपया बताइए आप कौन सी फसल और कितनी मात्रा बेचना चाहते हैं।",
    ASK_CROP_QUANTITY_BUY: "कृपया बताइए आपको कौन सी फसल और कितनी मात्रा चाहिए।",
    CONFIRM_CROP_QUANTITY_SELL: (quantity, crop) => `आप ${spokenNumber(quantity, "hi-IN")} किलो ${crop} बेचना चाहते हैं।`,
    CONFIRM_CROP_QUANTITY_BUY: (quantity, crop) => `आप ${spokenNumber(quantity, "hi-IN")} किलो ${crop} खरीदना चाहते हैं।`,
    ASK_LOCATION: "कृपया अपना शहर या जिला बताइए।",
    LOCATION_NOT_UNDERSTOOD: "मुझे स्थान समझ नहीं आया। कृपया अपने शहर या जिले का नाम दोबारा बताइए।",
    CHECKING_MANDI: "कृपया प्रतीक्षा करें। मंडी संदर्भ भाव देखे जा रहे हैं।",
    MANDI_RATE_INTRO: "उपलब्ध मंडी संदर्भ भाव इस प्रकार हैं।",
    MANDI_RATE: (mandi, price) => `${mandi} में लगभग ${spokenNumber(price, "hi-IN")} रुपये प्रति क्विंटल है।`,
    BEST_MANDI_RATE: (mandi, price) => `सबसे अच्छा उपलब्ध संदर्भ भाव ${mandi} में लगभग ${spokenNumber(price, "hi-IN")} रुपये प्रति क्विंटल है।`,
    BUYER_AVAILABLE: "इस क्षेत्र में एक खरीदार उपलब्ध है।",
    PRESS_ONE_TO_CONNECT: "खरीदार से बात करने के लिए एक दबाएँ। कॉल समाप्त करने के लिए दो दबाएँ। शीर्ष पाँच खरीदारों की जानकारी एस एम एस पर पाने के लिए तीन दबाएँ।",
    SELL_MATCH_SMS_MENU: "कॉल समाप्त करने के लिए दो दबाएँ। शीर्ष पाँच खरीदारों की जानकारी एस एम एस पर पाने के लिए तीन दबाएँ।",
    BUY_MATCH_SMS_MENU: "कॉल समाप्त करने के लिए दो दबाएँ। शीर्ष पाँच विक्रेताओं की जानकारी एस एम एस पर पाने के लिए तीन दबाएँ।",
    TOP5_BUYERS_SMS_CONFIRMATION: "शीर्ष पाँच खरीदारों की जानकारी आपके मोबाइल पर भेजी जाएगी।",
    TOP5_SELLERS_SMS_CONFIRMATION: "शीर्ष पाँच विक्रेताओं की जानकारी आपके मोबाइल पर भेजी जाएगी।",
    SMS_SEND_FAILED: "माफ कीजिए। अभी एस एम एस भेजा नहीं जा सका। आपकी मांग दर्ज है।",
    THANK_YOU: "किसानसेतु का उपयोग करने के लिए धन्यवाद।",
    RETRY_CROP: "कृपया केवल फसल का नाम बताइए।",
    RETRY_QUANTITY: "कृपया मात्रा किलो में बताइए।",
    RETRY_CROP_QUANTITY_SELL: "कृपया फसल का नाम और उसकी मात्रा बताइए।",
    RETRY_CROP_QUANTITY_BUY: "कृपया बताइए आपको कौन सी फसल और कितनी मात्रा चाहिए।",
    NO_MANDI_RATES: "माफ कीजिए। इस फसल के लिए इस क्षेत्र का मंडी संदर्भ भाव अभी उपलब्ध नहीं है।",
    CONNECTING_BUYER: "कृपया प्रतीक्षा करें। आपकी कॉल खरीदार से जोड़ी जा रही है।",
    NO_SELLERS: "माफ कीजिए। अभी आपकी आवश्यकता से मेल खाने वाला विक्रेता उपलब्ध नहीं है।",
    SELLERS_FOUND: matches => `आपकी आवश्यकता से मेल खाने वाले विक्रेता मिले हैं। ${matches}। संपर्क जानकारी किसानसेतु सूची में उपलब्ध है।`,
    SELLER_MATCH: (name, quantity, crop) => `${name} के पास ${spokenNumber(quantity, "hi-IN")} किलो ${crop} उपलब्ध है।`,
    BUYERS_FOUND_COUNT: count => `आपकी उपज के लिए ${spokenNumber(count, "hi-IN")} खरीदार मिले हैं।`,
    SELLERS_FOUND_COUNT: count => `आपकी आवश्यकता के लिए ${spokenNumber(count, "hi-IN")} विक्रेता मिले हैं।`,
    RECOMMENDED_BUYER_MATCH: (location, distance, quantity, crop, price) => `अनुशंसित खरीदार ${location} में${distance === null ? "" : ` लगभग ${spokenNumber(distance, "hi-IN")} किलोमीटर दूर`} है और ${spokenNumber(quantity, "hi-IN")} किलो ${crop} खरीदना चाहता है${price === null ? "" : `। वह ${spokenNumber(price, "hi-IN")} रुपये प्रति किलो दे रहा है`}।`,
    RECOMMENDED_SELLER_MATCH: (location, distance, quantity, crop, price) => `अनुशंसित विक्रेता ${location} में${distance === null ? "" : ` लगभग ${spokenNumber(distance, "hi-IN")} किलोमीटर दूर`} है और उसके पास ${spokenNumber(quantity, "hi-IN")} किलो ${crop} उपलब्ध है${price === null ? "" : `। भाव ${spokenNumber(price, "hi-IN")} रुपये प्रति किलो है`}।`,
    NO_BUYERS_RECORDED: "अभी कोई उपयुक्त खरीदार उपलब्ध नहीं है। आपकी आवश्यकता दर्ज कर ली गई है।",
    NO_SELLERS_RECORDED: "अभी कोई उपयुक्त विक्रेता उपलब्ध नहीं है। आपकी आवश्यकता दर्ज कर ली गई है।",
    BUYER_PHONE_UNAVAILABLE: "मिलान दर्ज कर लिए गए हैं। अभी फोन पर जोड़ने की सुविधा उपलब्ध नहीं है।",
    ASK_CROP: "कृपया फसल का नाम बताइए।",
    ASK_QUANTITY: "कृपया मात्रा किलो में बताइए।",
    ASK_CROP_QUANTITY: "कृपया फसल का नाम और मात्रा बताइए।",
    RETRY: "कृपया एक बार फिर साफ शब्दों में बताइए।",
    RETRY_LOCATION: "कृपया केवल शहर या जिले का नाम बताइए।",
    RATES_UNAVAILABLE: "इस समय मंडी संदर्भ भाव उपलब्ध नहीं है।",
    MANDI_RATES: rates => rates,
    GOODBYE: "धन्यवाद। आपका दिन शुभ हो।",
    MAX_RETRIES_EXCEEDED: "माफ कीजिए, मैं जानकारी ठीक से समझ नहीं पाया। कृपया बाद में फिर प्रयास करें।"
  },
  "gu-IN": {
    WELCOME: "નમસ્કાર. કિસાનસેતુમાં આપનું સ્વાગત છે. પાક ખરીદવા માટે એક દબાવો. પાક વેચવા માટે બે દબાવો.",
    SELL_SELECTED: "તમે વેચવાનો વિકલ્પ પસંદ કર્યો છે.",
    BUY_SELECTED: "તમે ખરીદવાનો વિકલ્પ પસંદ કર્યો છે.",
    ASK_CROP_QUANTITY_SELL: "કૃપા કરીને જણાવો કે તમે કયો પાક અને કેટલો જથ્થો વેચવા માંગો છો.",
    ASK_CROP_QUANTITY_BUY: "કૃપા કરીને જણાવો કે તમને કયો પાક અને કેટલો જથ્થો જોઈએ છે.",
    CONFIRM_CROP_QUANTITY_SELL: (quantity, crop) => `તમે ${spokenNumber(quantity, "gu-IN")} કિલો ${crop} વેચવા માંગો છો.`,
    CONFIRM_CROP_QUANTITY_BUY: (quantity, crop) => `તમે ${spokenNumber(quantity, "gu-IN")} કિલો ${crop} ખરીદવા માંગો છો.`,
    ASK_LOCATION: "કૃપા કરીને તમારું શહેર અથવા જિલ્લો જણાવો.",
    LOCATION_NOT_UNDERSTOOD: "મને સ્થળ સમજાયું નથી. કૃપા કરીને તમારા શહેર અથવા જિલ્લાનું નામ ફરીથી જણાવો.",
    CHECKING_MANDI: "કૃપા કરીને રાહ જુઓ. મંડીના સંદર્ભ ભાવ તપાસવામાં આવી રહ્યા છે.",
    MANDI_RATE_INTRO: "ઉપલબ્ધ મંડીના સંદર્ભ ભાવ આ પ્રમાણે છે.",
    MANDI_RATE: (mandi, price) => `${mandi}માં અંદાજે ${spokenNumber(price, "gu-IN")} રૂપિયા પ્રતિ ક્વિન્ટલ છે.`,
    BEST_MANDI_RATE: (mandi, price) => `સૌથી સારો ઉપલબ્ધ સંદર્ભ ભાવ ${mandi}માં અંદાજે ${spokenNumber(price, "gu-IN")} રૂપિયા પ્રતિ ક્વિન્ટલ છે.`,
    BUYER_AVAILABLE: "આ વિસ્તારમાં એક ખરીદદાર ઉપલબ્ધ છે.",
    PRESS_ONE_TO_CONNECT: "ખરીદદાર સાથે વાત કરવા માટે એક દબાવો. કૉલ સમાપ્ત કરવા માટે બે દબાવો. ટોચના પાંચ ખરીદદારોની માહિતી એસ એમ એસ પર મેળવવા માટે ત્રણ દબાવો.",
    SELL_MATCH_SMS_MENU: "કૉલ સમાપ્ત કરવા માટે બે દબાવો. ટોચના પાંચ ખરીદદારોની માહિતી એસ એમ એસ પર મેળવવા માટે ત્રણ દબાવો.",
    BUY_MATCH_SMS_MENU: "કૉલ સમાપ્ત કરવા માટે બે દબાવો. ટોચના પાંચ વિક્રેતાઓની માહિતી એસ એમ એસ પર મેળવવા માટે ત્રણ દબાવો.",
    TOP5_BUYERS_SMS_CONFIRMATION: "ટોચના પાંચ ખરીદદારોની માહિતી તમારા મોબાઇલ પર મોકલવામાં આવશે.",
    TOP5_SELLERS_SMS_CONFIRMATION: "ટોચના પાંચ વિક્રેતાઓની માહિતી તમારા મોબાઇલ પર મોકલવામાં આવશે.",
    SMS_SEND_FAILED: "માફ કરશો. અત્યારે એસ એમ એસ મોકલી શકાયો નથી. તમારી વિનંતી નોંધાઈ ગઈ છે.",
    THANK_YOU: "કિસાનસેતુનો ઉપયોગ કરવા બદલ આભાર.",
    RETRY_CROP: "કૃપા કરીને માત્ર પાકનું નામ જણાવો.",
    RETRY_QUANTITY: "કૃપા કરીને જથ્થો કિલોમાં જણાવો.",
    RETRY_CROP_QUANTITY_SELL: "કૃપા કરીને પાકનું નામ અને તેનો જથ્થો જણાવો.",
    RETRY_CROP_QUANTITY_BUY: "કૃપા કરીને જણાવો કે તમને કયો પાક અને કેટલો જથ્થો જોઈએ છે.",
    NO_MANDI_RATES: "માફ કરશો. આ પાક માટે આ વિસ્તારનો મંડી સંદર્ભ ભાવ હાલમાં ઉપલબ્ધ નથી.",
    CONNECTING_BUYER: "કૃપા કરીને રાહ જુઓ. તમારો કૉલ ખરીદદાર સાથે જોડવામાં આવી રહ્યો છે.",
    NO_SELLERS: "માફ કરશો. હાલમાં તમારી જરૂરિયાતને અનુરૂપ કોઈ વિક્રેતા ઉપલબ્ધ નથી.",
    SELLERS_FOUND: matches => `તમારી જરૂરિયાતને અનુરૂપ વિક્રેતાઓ મળ્યા છે. ${matches} સંપર્ક માહિતી કિસાનસેતુની યાદીમાં ઉપલબ્ધ છે.`,
    SELLER_MATCH: (name, quantity, crop) => `${name} પાસે ${spokenNumber(quantity, "gu-IN")} કિલો ${crop} ઉપલબ્ધ છે.`,
    BUYERS_FOUND_COUNT: count => `તમારી ઉપજ માટે ${spokenNumber(count, "gu-IN")} ખરીદદારો મળ્યા છે.`,
    SELLERS_FOUND_COUNT: count => `તમારી જરૂરિયાત માટે ${spokenNumber(count, "gu-IN")} વિક્રેતાઓ મળ્યા છે.`,
    RECOMMENDED_BUYER_MATCH: (location, distance, quantity, crop, price) => `ભલામણ કરેલ ખરીદદાર ${location}માં${distance === null ? "" : ` અંદાજે ${spokenNumber(distance, "gu-IN")} કિલોમીટર દૂર`} છે અને ${spokenNumber(quantity, "gu-IN")} કિલો ${crop} ખરીદવા માંગે છે${price === null ? "" : `. તે પ્રતિ કિલો ${spokenNumber(price, "gu-IN")} રૂપિયા આપે છે`}.`,
    RECOMMENDED_SELLER_MATCH: (location, distance, quantity, crop, price) => `ભલામણ કરેલ વિક્રેતા ${location}માં${distance === null ? "" : ` અંદાજે ${spokenNumber(distance, "gu-IN")} કિલોમીટર દૂર`} છે અને તેની પાસે ${spokenNumber(quantity, "gu-IN")} કિલો ${crop} ઉપલબ્ધ છે${price === null ? "" : `. ભાવ પ્રતિ કિલો ${spokenNumber(price, "gu-IN")} રૂપિયા છે`}.`,
    NO_BUYERS_RECORDED: "હાલમાં કોઈ યોગ્ય ખરીદદાર ઉપલબ્ધ નથી. તમારી જરૂરિયાત નોંધવામાં આવી છે.",
    NO_SELLERS_RECORDED: "હાલમાં કોઈ યોગ્ય વિક્રેતા ઉપલબ્ધ નથી. તમારી જરૂરિયાત નોંધવામાં આવી છે.",
    BUYER_PHONE_UNAVAILABLE: "મેળ નોંધવામાં આવ્યા છે. હાલમાં ફોન પર જોડવાની સુવિધા ઉપલબ્ધ નથી.",
    ASK_CROP: "કૃપા કરીને પાકનું નામ જણાવો.",
    ASK_QUANTITY: "કૃપા કરીને જથ્થો કિલોમાં જણાવો.",
    ASK_CROP_QUANTITY: "કૃપા કરીને પાકનું નામ અને જથ્થો જણાવો.",
    RETRY: "કૃપા કરીને ફરી એક વાર સ્પષ્ટ શબ્દોમાં જણાવો.",
    RETRY_LOCATION: "કૃપા કરીને માત્ર શહેર અથવા જિલ્લાનું નામ જણાવો.",
    RATES_UNAVAILABLE: "હાલમાં મંડીના સંદર્ભ ભાવ ઉપલબ્ધ નથી.",
    MANDI_RATES: rates => rates,
    GOODBYE: "આભાર. તમારો દિવસ શુભ રહે.",
    MAX_RETRIES_EXCEEDED: "માફ કરશો, હું માહિતી યોગ્ય રીતે સમજી શક્યો નથી. કૃપા કરીને પછી ફરી પ્રયાસ કરો."
  },
  "ml-IN": {
    WELCOME: "നമസ്കാരം. കിസാൻസേതുവിലേക്ക് സ്വാഗതം. വിള വാങ്ങാൻ ഒന്ന് അമർത്തുക. വിള വിൽക്കാൻ രണ്ട് അമർത്തുക.",
    SELL_SELECTED: "നിങ്ങൾ വിൽക്കാനുള്ള ഓപ്ഷൻ തിരഞ്ഞെടുത്തു.",
    BUY_SELECTED: "നിങ്ങൾ വാങ്ങാനുള്ള ഓപ്ഷൻ തിരഞ്ഞെടുത്തു.",
    ASK_CROP_QUANTITY_SELL: "നിങ്ങൾ ഏത് വിളയാണ് എത്ര അളവിൽ വിൽക്കാൻ ആഗ്രഹിക്കുന്നതെന്ന് ദയവായി പറയുക.",
    ASK_CROP_QUANTITY_BUY: "നിങ്ങൾക്ക് ഏത് വിള എത്ര അളവിൽ വേണമെന്ന് ദയവായി പറയുക.",
    CONFIRM_CROP_QUANTITY_SELL: (quantity, crop) => `നിങ്ങൾ ${spokenNumber(quantity, "ml-IN")} കിലോ ${crop} വിൽക്കാൻ ആഗ്രഹിക്കുന്നു.`,
    CONFIRM_CROP_QUANTITY_BUY: (quantity, crop) => `നിങ്ങൾ ${spokenNumber(quantity, "ml-IN")} കിലോ ${crop} വാങ്ങാൻ ആഗ്രഹിക്കുന്നു.`,
    ASK_LOCATION: "ദയവായി നിങ്ങളുടെ നഗരമോ ജില്ലയോ പറയുക.",
    LOCATION_NOT_UNDERSTOOD: "സ്ഥലം മനസ്സിലായില്ല. ദയവായി നിങ്ങളുടെ നഗരത്തിന്റെയോ ജില്ലയുടെയോ പേര് വീണ്ടും പറയുക.",
    CHECKING_MANDI: "ദയവായി കാത്തിരിക്കുക. മണ്ഡിയിലെ റഫറൻസ് നിരക്കുകൾ പരിശോധിക്കുകയാണ്.",
    MANDI_RATE_INTRO: "ലഭ്യമായ മണ്ഡി റഫറൻസ് നിരക്കുകൾ ഇവയാണ്.",
    MANDI_RATE: (mandi, price) => `${mandi}യിൽ ഒരു ക്വിന്റലിന് ഏകദേശം ${spokenNumber(price, "ml-IN")} രൂപയാണ്.`,
    BEST_MANDI_RATE: (mandi, price) => `ലഭ്യമായ ഏറ്റവും മികച്ച റഫറൻസ് നിരക്ക് ${mandi}യിൽ ഒരു ക്വിന്റലിന് ഏകദേശം ${spokenNumber(price, "ml-IN")} രൂപയാണ്.`,
    BUYER_AVAILABLE: "ഈ പ്രദേശത്ത് ഒരു വാങ്ങുന്നയാൾ ലഭ്യമാണ്.",
    PRESS_ONE_TO_CONNECT: "വാങ്ങുന്നയാളുമായി സംസാരിക്കാൻ ഒന്ന് അമർത്തുക. കോൾ അവസാനിപ്പിക്കാൻ രണ്ട് അമർത്തുക. മികച്ച അഞ്ച് വാങ്ങുന്നവരുടെ വിവരങ്ങൾ എസ് എം എസ് ആയി ലഭിക്കാൻ മൂന്ന് അമർത്തുക.",
    SELL_MATCH_SMS_MENU: "കോൾ അവസാനിപ്പിക്കാൻ രണ്ട് അമർത്തുക. മികച്ച അഞ്ച് വാങ്ങുന്നവരുടെ വിവരങ്ങൾ എസ് എം എസ് ആയി ലഭിക്കാൻ മൂന്ന് അമർത്തുക.",
    BUY_MATCH_SMS_MENU: "കോൾ അവസാനിപ്പിക്കാൻ രണ്ട് അമർത്തുക. മികച്ച അഞ്ച് വിൽപ്പനക്കാരുടെ വിവരങ്ങൾ എസ് എം എസ് ആയി ലഭിക്കാൻ മൂന്ന് അമർത്തുക.",
    TOP5_BUYERS_SMS_CONFIRMATION: "മികച്ച അഞ്ച് വാങ്ങുന്നവരുടെ വിവരങ്ങൾ നിങ്ങളുടെ മൊബൈലിലേക്ക് അയയ്ക്കും.",
    TOP5_SELLERS_SMS_CONFIRMATION: "മികച്ച അഞ്ച് വിൽപ്പനക്കാരുടെ വിവരങ്ങൾ നിങ്ങളുടെ മൊബൈലിലേക്ക് അയയ്ക്കും.",
    SMS_SEND_FAILED: "ക്ഷമിക്കണം. ഇപ്പോൾ എസ് എം എസ് അയയ്ക്കാനായില്ല. നിങ്ങളുടെ അഭ്യർത്ഥന രേഖപ്പെടുത്തിയിട്ടുണ്ട്.",
    THANK_YOU: "കിസാൻസേതു ഉപയോഗിച്ചതിന് നന്ദി.",
    RETRY_CROP: "ദയവായി വിളയുടെ പേര് മാത്രം പറയുക.",
    RETRY_QUANTITY: "ദയവായി അളവ് കിലോയിൽ പറയുക.",
    RETRY_CROP_QUANTITY_SELL: "ദയവായി വിളയുടെ പേരും അളവും പറയുക.",
    RETRY_CROP_QUANTITY_BUY: "നിങ്ങൾക്ക് ഏത് വിള എത്ര അളവിൽ വേണമെന്ന് ദയവായി പറയുക.",
    NO_MANDI_RATES: "ക്ഷമിക്കണം. ഈ പ്രദേശത്ത് ഈ വിളയുടെ മണ്ഡി റഫറൻസ് നിരക്ക് ഇപ്പോൾ ലഭ്യമല്ല.",
    CONNECTING_BUYER: "ദയവായി കാത്തിരിക്കുക. നിങ്ങളുടെ കോൾ വാങ്ങുന്നയാളുമായി ബന്ധിപ്പിക്കുകയാണ്.",
    NO_SELLERS: "ക്ഷമിക്കണം. നിങ്ങളുടെ ആവശ്യത്തിന് അനുയോജ്യമായ വിൽപ്പനക്കാരൻ ഇപ്പോൾ ലഭ്യമല്ല.",
    SELLERS_FOUND: matches => `നിങ്ങളുടെ ആവശ്യത്തിന് അനുയോജ്യമായ വിൽപ്പനക്കാരെ കണ്ടെത്തി. ${matches} ബന്ധപ്പെടാനുള്ള വിവരങ്ങൾ കിസാൻസേതു പട്ടികയിൽ ലഭ്യമാണ്.`,
    SELLER_MATCH: (name, quantity, crop) => `${name}യുടെ പക്കൽ ${spokenNumber(quantity, "ml-IN")} കിലോ ${crop} ലഭ്യമാണ്.`,
    BUYERS_FOUND_COUNT: count => `നിങ്ങളുടെ ഉൽപ്പന്നത്തിന് ${spokenNumber(count, "ml-IN")} വാങ്ങുന്നവരെ കണ്ടെത്തി.`,
    SELLERS_FOUND_COUNT: count => `നിങ്ങളുടെ ആവശ്യത്തിന് ${spokenNumber(count, "ml-IN")} വിൽപ്പനക്കാരെ കണ്ടെത്തി.`,
    RECOMMENDED_BUYER_MATCH: (location, distance, quantity, crop, price) => `ശുപാർശ ചെയ്യുന്ന വാങ്ങുന്നയാൾ ${location}ൽ${distance === null ? "" : ` ഏകദേശം ${spokenNumber(distance, "ml-IN")} കിലോമീറ്റർ അകലെ`} ആണ്, കൂടാതെ ${spokenNumber(quantity, "ml-IN")} കിലോ ${crop} വാങ്ങാൻ ആഗ്രഹിക്കുന്നു${price === null ? "" : `. കിലോയ്ക്ക് ${spokenNumber(price, "ml-IN")} രൂപ നൽകുന്നു`}.`,
    RECOMMENDED_SELLER_MATCH: (location, distance, quantity, crop, price) => `ശുപാർശ ചെയ്യുന്ന വിൽപ്പനക്കാരൻ ${location}ൽ${distance === null ? "" : ` ഏകദേശം ${spokenNumber(distance, "ml-IN")} കിലോമീറ്റർ അകലെ`} ആണ്, കൂടാതെ ${spokenNumber(quantity, "ml-IN")} കിലോ ${crop} ലഭ്യമാണ്${price === null ? "" : `. കിലോയ്ക്ക് ${spokenNumber(price, "ml-IN")} രൂപയാണ്`}.`,
    NO_BUYERS_RECORDED: "അനുയോജ്യമായ വാങ്ങുന്നയാൾ ഇപ്പോൾ ലഭ്യമല്ല. നിങ്ങളുടെ ആവശ്യം രേഖപ്പെടുത്തി.",
    NO_SELLERS_RECORDED: "അനുയോജ്യമായ വിൽപ്പനക്കാരൻ ഇപ്പോൾ ലഭ്യമല്ല. നിങ്ങളുടെ ആവശ്യം രേഖപ്പെടുത്തി.",
    BUYER_PHONE_UNAVAILABLE: "പൊരുത്തങ്ങൾ രേഖപ്പെടുത്തി. ഇപ്പോൾ ഫോൺ വഴി ബന്ധിപ്പിക്കൽ ലഭ്യമല്ല.",
    ASK_CROP: "ദയവായി വിളയുടെ പേര് പറയുക.",
    ASK_QUANTITY: "ദയവായി അളവ് കിലോയിൽ പറയുക.",
    ASK_CROP_QUANTITY: "ദയവായി വിളയുടെ പേരും അളവും പറയുക.",
    RETRY: "ദയവായി ഒരിക്കൽ കൂടി വ്യക്തമായി പറയുക.",
    RETRY_LOCATION: "ദയവായി നഗരത്തിന്റെയോ ജില്ലയുടെയോ പേര് മാത്രം പറയുക.",
    RATES_UNAVAILABLE: "മണ്ഡി റഫറൻസ് നിരക്കുകൾ ഇപ്പോൾ ലഭ്യമല്ല.",
    MANDI_RATES: rates => rates,
    GOODBYE: "നന്ദി. നിങ്ങൾക്ക് നല്ലൊരു ദിവസം ആശംസിക്കുന്നു.",
    MAX_RETRIES_EXCEEDED: "ക്ഷമിക്കണം, വിവരങ്ങൾ വ്യക്തമായി മനസ്സിലാക്കാനായില്ല. ദയവായി പിന്നീട് വീണ്ടും ശ്രമിക്കുക."
  },
  "kn-IN": {
    WELCOME: "ನಮಸ್ಕಾರ. ಕಿಸಾನ್‌ಸೇತುಗೆ ಸ್ವಾಗತ. ಬೆಳೆ ಖರೀದಿಸಲು ಒಂದು ಒತ್ತಿರಿ. ಬೆಳೆ ಮಾರಲು ಎರಡು ಒತ್ತಿರಿ.",
    SELL_SELECTED: "ನೀವು ಮಾರಾಟದ ಆಯ್ಕೆಯನ್ನು ಆರಿಸಿದ್ದೀರಿ.",
    BUY_SELECTED: "ನೀವು ಖರೀದಿಯ ಆಯ್ಕೆಯನ್ನು ಆರಿಸಿದ್ದೀರಿ.",
    ASK_CROP_QUANTITY_SELL: "ನೀವು ಯಾವ ಬೆಳೆ ಮತ್ತು ಎಷ್ಟು ಪ್ರಮಾಣವನ್ನು ಮಾರಲು ಬಯಸುತ್ತೀರಿ ಎಂದು ದಯವಿಟ್ಟು ತಿಳಿಸಿ.",
    ASK_CROP_QUANTITY_BUY: "ನಿಮಗೆ ಯಾವ ಬೆಳೆ ಮತ್ತು ಎಷ್ಟು ಪ್ರಮಾಣ ಬೇಕು ಎಂದು ದಯವಿಟ್ಟು ತಿಳಿಸಿ.",
    CONFIRM_CROP_QUANTITY_SELL: (quantity, crop) => `ನೀವು ${spokenNumber(quantity, "kn-IN")} ಕಿಲೋ ${crop} ಮಾರಲು ಬಯಸುತ್ತೀರಿ.`,
    CONFIRM_CROP_QUANTITY_BUY: (quantity, crop) => `ನೀವು ${spokenNumber(quantity, "kn-IN")} ಕಿಲೋ ${crop} ಖರೀದಿಸಲು ಬಯಸುತ್ತೀರಿ.`,
    ASK_LOCATION: "ದಯವಿಟ್ಟು ನಿಮ್ಮ ನಗರ ಅಥವಾ ಜಿಲ್ಲೆಯ ಹೆಸರನ್ನು ತಿಳಿಸಿ.",
    LOCATION_NOT_UNDERSTOOD: "ಸ್ಥಳ ಅರ್ಥವಾಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ನಿಮ್ಮ ನಗರ ಅಥವಾ ಜಿಲ್ಲೆಯ ಹೆಸರನ್ನು ಮತ್ತೆ ತಿಳಿಸಿ.",
    CHECKING_MANDI: "ದಯವಿಟ್ಟು ಕಾಯಿರಿ. ಮಂಡಿಯ ಉಲ್ಲೇಖ ದರಗಳನ್ನು ಪರಿಶೀಲಿಸಲಾಗುತ್ತಿದೆ.",
    MANDI_RATE_INTRO: "ಲಭ್ಯವಿರುವ ಮಂಡಿ ಉಲ್ಲೇಖ ದರಗಳು ಹೀಗಿವೆ.",
    MANDI_RATE: (mandi, price) => `${mandi}ಯಲ್ಲಿ ಪ್ರತಿ ಕ್ವಿಂಟಲ್‌ಗೆ ಸುಮಾರು ${spokenNumber(price, "kn-IN")} ರೂಪಾಯಿ ಇದೆ.`,
    BEST_MANDI_RATE: (mandi, price) => `ಲಭ್ಯವಿರುವ ಅತ್ಯುತ್ತಮ ಉಲ್ಲೇಖ ದರ ${mandi}ಯಲ್ಲಿ ಪ್ರತಿ ಕ್ವಿಂಟಲ್‌ಗೆ ಸುಮಾರು ${spokenNumber(price, "kn-IN")} ರೂಪಾಯಿ ಇದೆ.`,
    BUYER_AVAILABLE: "ಈ ಪ್ರದೇಶದಲ್ಲಿ ಒಬ್ಬ ಖರೀದಿದಾರ ಲಭ್ಯವಿದ್ದಾರೆ.",
    PRESS_ONE_TO_CONNECT: "ಖರೀದಿದಾರರೊಂದಿಗೆ ಮಾತನಾಡಲು ಒಂದು ಒತ್ತಿರಿ. ಕರೆ ಮುಗಿಸಲು ಎರಡು ಒತ್ತಿರಿ. ಅಗ್ರ ಐದು ಖರೀದಿದಾರರ ಮಾಹಿತಿಯನ್ನು ಎಸ್ ಎಂ ಎಸ್ ಮೂಲಕ ಪಡೆಯಲು ಮೂರು ಒತ್ತಿರಿ.",
    SELL_MATCH_SMS_MENU: "ಕರೆ ಮುಗಿಸಲು ಎರಡು ಒತ್ತಿರಿ. ಅಗ್ರ ಐದು ಖರೀದಿದಾರರ ಮಾಹಿತಿಯನ್ನು ಎಸ್ ಎಂ ಎಸ್ ಮೂಲಕ ಪಡೆಯಲು ಮೂರು ಒತ್ತಿರಿ.",
    BUY_MATCH_SMS_MENU: "ಕರೆ ಮುಗಿಸಲು ಎರಡು ಒತ್ತಿರಿ. ಅಗ್ರ ಐದು ಮಾರಾಟಗಾರರ ಮಾಹಿತಿಯನ್ನು ಎಸ್ ಎಂ ಎಸ್ ಮೂಲಕ ಪಡೆಯಲು ಮೂರು ಒತ್ತಿರಿ.",
    TOP5_BUYERS_SMS_CONFIRMATION: "ಅಗ್ರ ಐದು ಖರೀದಿದಾರರ ಮಾಹಿತಿಯನ್ನು ನಿಮ್ಮ ಮೊಬೈಲ್‌ಗೆ ಕಳುಹಿಸಲಾಗುತ್ತದೆ.",
    TOP5_SELLERS_SMS_CONFIRMATION: "ಅಗ್ರ ಐದು ಮಾರಾಟಗಾರರ ಮಾಹಿತಿಯನ್ನು ನಿಮ್ಮ ಮೊಬೈಲ್‌ಗೆ ಕಳುಹಿಸಲಾಗುತ್ತದೆ.",
    SMS_SEND_FAILED: "ಕ್ಷಮಿಸಿ. ಈಗ ಎಸ್ ಎಂ ಎಸ್ ಕಳುಹಿಸಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ. ನಿಮ್ಮ ವಿನಂತಿಯನ್ನು ದಾಖಲಿಸಲಾಗಿದೆ.",
    THANK_YOU: "ಕಿಸಾನ್‌ಸೇತು ಬಳಸಿದ್ದಕ್ಕಾಗಿ ಧನ್ಯವಾದಗಳು.",
    RETRY_CROP: "ದಯವಿಟ್ಟು ಬೆಳೆಯ ಹೆಸರನ್ನು ಮಾತ್ರ ತಿಳಿಸಿ.",
    RETRY_QUANTITY: "ದಯವಿಟ್ಟು ಪ್ರಮಾಣವನ್ನು ಕಿಲೋಗಳಲ್ಲಿ ತಿಳಿಸಿ.",
    RETRY_CROP_QUANTITY_SELL: "ದಯವಿಟ್ಟು ಬೆಳೆಯ ಹೆಸರು ಮತ್ತು ಪ್ರಮಾಣವನ್ನು ತಿಳಿಸಿ.",
    RETRY_CROP_QUANTITY_BUY: "ನಿಮಗೆ ಯಾವ ಬೆಳೆ ಮತ್ತು ಎಷ್ಟು ಪ್ರಮಾಣ ಬೇಕು ಎಂದು ದಯವಿಟ್ಟು ತಿಳಿಸಿ.",
    NO_MANDI_RATES: "ಕ್ಷಮಿಸಿ. ಈ ಪ್ರದೇಶದಲ್ಲಿ ಈ ಬೆಳೆಯ ಮಂಡಿ ಉಲ್ಲೇಖ ದರ ಈಗ ಲಭ್ಯವಿಲ್ಲ.",
    CONNECTING_BUYER: "ದಯವಿಟ್ಟು ಕಾಯಿರಿ. ನಿಮ್ಮ ಕರೆಯನ್ನು ಖರೀದಿದಾರರೊಂದಿಗೆ ಸಂಪರ್ಕಿಸಲಾಗುತ್ತಿದೆ.",
    NO_SELLERS: "ಕ್ಷಮಿಸಿ. ನಿಮ್ಮ ಅಗತ್ಯಕ್ಕೆ ಹೊಂದುವ ಮಾರಾಟಗಾರರು ಈಗ ಲಭ್ಯವಿಲ್ಲ.",
    SELLERS_FOUND: matches => `ನಿಮ್ಮ ಅಗತ್ಯಕ್ಕೆ ಹೊಂದುವ ಮಾರಾಟಗಾರರು ದೊರೆತಿದ್ದಾರೆ. ${matches} ಸಂಪರ್ಕ ಮಾಹಿತಿ ಕಿಸಾನ್‌ಸೇತು ಪಟ್ಟಿಯಲ್ಲಿ ಲಭ್ಯವಿದೆ.`,
    SELLER_MATCH: (name, quantity, crop) => `${name} ಅವರ ಬಳಿ ${spokenNumber(quantity, "kn-IN")} ಕಿಲೋ ${crop} ಲಭ್ಯವಿದೆ.`,
    BUYERS_FOUND_COUNT: count => `ನಿಮ್ಮ ಉತ್ಪನ್ನಕ್ಕೆ ${spokenNumber(count, "kn-IN")} ಖರೀದಿದಾರರು ದೊರೆತಿದ್ದಾರೆ.`,
    SELLERS_FOUND_COUNT: count => `ನಿಮ್ಮ ಅಗತ್ಯಕ್ಕೆ ${spokenNumber(count, "kn-IN")} ಮಾರಾಟಗಾರರು ದೊರೆತಿದ್ದಾರೆ.`,
    RECOMMENDED_BUYER_MATCH: (location, distance, quantity, crop, price) => `ಶಿಫಾರಸು ಮಾಡಿದ ಖರೀದಿದಾರರು ${location}ನಲ್ಲಿ${distance === null ? "" : ` ಸುಮಾರು ${spokenNumber(distance, "kn-IN")} ಕಿಲೋಮೀಟರ್ ದೂರದಲ್ಲಿ`} ಇದ್ದಾರೆ ಮತ್ತು ${spokenNumber(quantity, "kn-IN")} ಕಿಲೋ ${crop} ಖರೀದಿಸಲು ಬಯಸುತ್ತಾರೆ${price === null ? "" : `. ಪ್ರತಿ ಕಿಲೋಗೆ ${spokenNumber(price, "kn-IN")} ರೂಪಾಯಿ ನೀಡುತ್ತಾರೆ`}.`,
    RECOMMENDED_SELLER_MATCH: (location, distance, quantity, crop, price) => `ಶಿಫಾರಸು ಮಾಡಿದ ಮಾರಾಟಗಾರರು ${location}ನಲ್ಲಿ${distance === null ? "" : ` ಸುಮಾರು ${spokenNumber(distance, "kn-IN")} ಕಿಲೋಮೀಟರ್ ದೂರದಲ್ಲಿ`} ಇದ್ದಾರೆ ಮತ್ತು ಅವರ ಬಳಿ ${spokenNumber(quantity, "kn-IN")} ಕಿಲೋ ${crop} ಲಭ್ಯವಿದೆ${price === null ? "" : `. ಪ್ರತಿ ಕಿಲೋ ದರ ${spokenNumber(price, "kn-IN")} ರೂಪಾಯಿ`}.`,
    NO_BUYERS_RECORDED: "ಈಗ ಸೂಕ್ತ ಖರೀದಿದಾರರು ಲಭ್ಯವಿಲ್ಲ. ನಿಮ್ಮ ಅಗತ್ಯವನ್ನು ದಾಖಲಿಸಲಾಗಿದೆ.",
    NO_SELLERS_RECORDED: "ಈಗ ಸೂಕ್ತ ಮಾರಾಟಗಾರರು ಲಭ್ಯವಿಲ್ಲ. ನಿಮ್ಮ ಅಗತ್ಯವನ್ನು ದಾಖಲಿಸಲಾಗಿದೆ.",
    BUYER_PHONE_UNAVAILABLE: "ಹೊಂದಾಣಿಕೆಗಳನ್ನು ದಾಖಲಿಸಲಾಗಿದೆ. ಈಗ ಫೋನ್ ಸಂಪರ್ಕ ಲಭ್ಯವಿಲ್ಲ.",
    ASK_CROP: "ದಯವಿಟ್ಟು ಬೆಳೆಯ ಹೆಸರನ್ನು ತಿಳಿಸಿ.",
    ASK_QUANTITY: "ದಯವಿಟ್ಟು ಪ್ರಮಾಣವನ್ನು ಕಿಲೋಗಳಲ್ಲಿ ತಿಳಿಸಿ.",
    ASK_CROP_QUANTITY: "ದಯವಿಟ್ಟು ಬೆಳೆಯ ಹೆಸರು ಮತ್ತು ಪ್ರಮಾಣವನ್ನು ತಿಳಿಸಿ.",
    RETRY: "ದಯವಿಟ್ಟು ಮತ್ತೊಮ್ಮೆ ಸ್ಪಷ್ಟವಾಗಿ ತಿಳಿಸಿ.",
    RETRY_LOCATION: "ದಯವಿಟ್ಟು ನಗರ ಅಥವಾ ಜಿಲ್ಲೆಯ ಹೆಸರನ್ನು ಮಾತ್ರ ತಿಳಿಸಿ.",
    RATES_UNAVAILABLE: "ಮಂಡಿ ಉಲ್ಲೇಖ ದರಗಳು ಈಗ ಲಭ್ಯವಿಲ್ಲ.",
    MANDI_RATES: rates => rates,
    GOODBYE: "ಧನ್ಯವಾದಗಳು. ನಿಮ್ಮ ದಿನ ಶುಭವಾಗಲಿ.",
    MAX_RETRIES_EXCEEDED: "ಕ್ಷಮಿಸಿ, ಮಾಹಿತಿಯನ್ನು ಸರಿಯಾಗಿ ಅರ್ಥಮಾಡಿಕೊಳ್ಳಲಾಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ನಂತರ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ."
  },
  ...buildAdditionalMessageBundles(spokenNumber)
};

const MESSAGE_KEYS = Object.freeze(Object.keys(MESSAGES["hi-IN"]));

function hasCompleteMessageBundle(languageCode) {
  const candidate = MESSAGES[languageCode];
  return Boolean(candidate) && MESSAGE_KEYS.every(
    key => Object.prototype.hasOwnProperty.call(candidate, key)
  );
}

function getMessages(languageCode) {
  return hasCompleteMessageBundle(languageCode) ? MESSAGES[languageCode] : MESSAGES["hi-IN"];
}

module.exports = {
  LANGUAGE_NAMES,
  MESSAGES,
  MESSAGE_KEYS,
  getMessages,
  hasCompleteMessageBundle,
  spokenNumber
};
