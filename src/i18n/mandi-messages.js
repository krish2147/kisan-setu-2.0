const { spokenNumber } = require("./messages");

const MANDI_MESSAGES = Object.freeze({
  "hi-IN": {
    found: (count, crop, location) => `${location} के आसपास ${crop} के लिए ${spokenNumber(count, "hi-IN")} मंडियां उपलब्ध हैं।`,
    selected: "मैंने आपके लिए पांच सबसे उपयुक्त मंडियां चुनी हैं।",
    latest: date => `ये नवीनतम उपलब्ध भाव ${date} के हैं।`,
    menu: callable => `${callable ? "खरीदार से बात करने के लिए एक दबाएं। " : "अभी सीधे खरीदार से जोड़ना उपलब्ध नहीं है। "}पांच मंडियों के भाव एस एम एस पर पाने के लिए दो दबाएं। कॉल समाप्त करने के लिए तीन दबाएं।`,
    smsSent: "पांच मंडियों के भाव आपके मोबाइल पर भेज दिए गए हैं।",
    smsFailed: "माफ कीजिए। मंडी भाव का एस एम एस अभी नहीं भेजा जा सका।"
  },
  "gu-IN": {
    found: (count, crop, location) => `${location} આસપાસ ${crop} માટે ${spokenNumber(count, "gu-IN")} મંડીઓ ઉપલબ્ધ છે.`,
    selected: "મેં તમારા માટે પાંચ સૌથી યોગ્ય મંડીઓ પસંદ કરી છે.",
    latest: date => `આ નવીનતમ ઉપલબ્ધ ભાવ ${date} તારીખના છે.`,
    menu: callable => `${callable ? "ખરીદદાર સાથે વાત કરવા એક દબાવો. " : "હાલ સીધા ખરીદદાર સાથે જોડાણ ઉપલબ્ધ નથી. "}પાંચ મંડીઓના ભાવ એસ એમ એસ પર મેળવવા બે દબાવો. કૉલ સમાપ્ત કરવા ત્રણ દબાવો.`,
    smsSent: "પાંચ મંડીઓના ભાવ તમારા મોબાઇલ પર મોકલાયા છે.",
    smsFailed: "માફ કરશો. મંડીનાં ભાવનો એસ એમ એસ હમણાં મોકલી શકાયો નથી."
  },
  "mr-IN": {
    found: (count, crop, location) => `${location} परिसरात ${crop} साठी ${spokenNumber(count, "mr-IN")} बाजार उपलब्ध आहेत.`,
    selected: "मी तुमच्यासाठी पाच योग्य बाजार निवडले आहेत.", latest: date => `हे नवीनतम उपलब्ध भाव ${date} या तारखेचे आहेत.`,
    menu: callable => `${callable ? "खरेदीदाराशी बोलण्यासाठी एक दाबा. " : "सध्या खरेदीदाराशी थेट जोडता येणार नाही. "}पाच बाजारांचे भाव एस एम एसवर मिळवण्यासाठी दोन दाबा. कॉल संपवण्यासाठी तीन दाबा.`,
    smsSent: "पाच बाजारांचे भाव तुमच्या मोबाईलवर पाठवले आहेत.", smsFailed: "माफ करा. बाजारभावाचा एस एम एस आत्ता पाठवता आला नाही."
  },
  "bn-IN": {
    found: (count, crop, location) => `${location} এলাকার কাছে ${crop} জন্য ${spokenNumber(count, "bn-IN")}টি বাজার পাওয়া গেছে।`,
    selected: "আপনার জন্য সবচেয়ে উপযুক্ত পাঁচটি বাজার বেছে নিয়েছি।", latest: date => `এগুলি ${date} তারিখের সর্বশেষ পাওয়া দাম।`,
    menu: callable => `${callable ? "ক্রেতার সঙ্গে কথা বলতে এক চাপুন। " : "এখন সরাসরি ক্রেতার সঙ্গে সংযোগ পাওয়া যাচ্ছে না। "}পাঁচটি বাজারের দাম এস এম এস পেতে দুই চাপুন। কল শেষ করতে তিন চাপুন।`,
    smsSent: "পাঁচটি বাজারের দাম আপনার মোবাইলে পাঠানো হয়েছে।", smsFailed: "দুঃখিত। বাজারদামের এস এম এস এখন পাঠানো যায়নি।"
  },
  "ta-IN": {
    found: (count, crop, location) => `${location} அருகில் ${crop}க்கு ${spokenNumber(count, "ta-IN")} சந்தைகள் உள்ளன.`,
    selected: "உங்களுக்காக சிறந்த ஐந்து சந்தைகளைத் தேர்ந்தெடுத்துள்ளேன்.", latest: date => `இவை ${date} தேதியின் சமீபத்திய விலைகள்.`,
    menu: callable => `${callable ? "வாங்குபவருடன் பேச ஒன்று அழுத்தவும். " : "இப்போது வாங்குபவருடன் நேரடி இணைப்பு இல்லை. "}ஐந்து சந்தை விலைகளை எஸ் எம் எஸ் மூலம் பெற இரண்டு அழுத்தவும். அழைப்பை முடிக்க மூன்று அழுத்தவும்.`,
    smsSent: "ஐந்து சந்தை விலைகள் உங்கள் மொபைலுக்கு அனுப்பப்பட்டன.", smsFailed: "மன்னிக்கவும். சந்தை விலை எஸ் எம் எஸ் இப்போது அனுப்ப முடியவில்லை."
  },
  "te-IN": {
    found: (count, crop, location) => `${location} దగ్గర ${crop} కోసం ${spokenNumber(count, "te-IN")} మార్కెట్లు ఉన్నాయి.`,
    selected: "మీ కోసం ఉత్తమమైన ఐదు మార్కెట్లను ఎంచుకున్నాను.", latest: date => `ఇవి ${date} తేదీకి అందుబాటులో ఉన్న తాజా ధరలు.`,
    menu: callable => `${callable ? "కొనుగోలుదారుతో మాట్లాడటానికి ఒకటి నొక్కండి. " : "ప్రస్తుతం కొనుగోలుదారుతో నేరుగా కలపడం అందుబాటులో లేదు. "}ఐదు మార్కెట్ ధరలను ఎస్ ఎం ఎస్‌లో పొందడానికి రెండు నొక్కండి. కాల్ ముగించడానికి మూడు నొక్కండి.`,
    smsSent: "ఐదు మార్కెట్ ధరలు మీ మొబైల్‌కు పంపబడ్డాయి.", smsFailed: "క్షమించండి. మార్కెట్ ధరల ఎస్ ఎం ఎస్ ఇప్పుడు పంపలేకపోయాము."
  },
  "kn-IN": {
    found: (count, crop, location) => `${location} ಹತ್ತಿರ ${crop}ಗಾಗಿ ${spokenNumber(count, "kn-IN")} ಮಾರುಕಟ್ಟೆಗಳು ಲಭ್ಯವಿವೆ.`,
    selected: "ನಿಮಗಾಗಿ ಸೂಕ್ತವಾದ ಐದು ಮಾರುಕಟ್ಟೆಗಳನ್ನು ಆಯ್ಕೆ ಮಾಡಿದ್ದೇನೆ.", latest: date => `ಇವು ${date} ದಿನಾಂಕದ ಇತ್ತೀಚಿನ ಲಭ್ಯ ದರಗಳು.`,
    menu: callable => `${callable ? "ಖರೀದಿದಾರರೊಂದಿಗೆ ಮಾತನಾಡಲು ಒಂದು ಒತ್ತಿರಿ. " : "ಈಗ ಖರೀದಿದಾರರೊಂದಿಗೆ ನೇರ ಸಂಪರ್ಕ ಲಭ್ಯವಿಲ್ಲ. "}ಐದು ಮಾರುಕಟ್ಟೆ ದರಗಳನ್ನು ಎಸ್ ಎಂ ಎಸ್‌ನಲ್ಲಿ ಪಡೆಯಲು ಎರಡು ಒತ್ತಿರಿ. ಕರೆ ಮುಗಿಸಲು ಮೂರು ಒತ್ತಿರಿ.`,
    smsSent: "ಐದು ಮಾರುಕಟ್ಟೆ ದರಗಳನ್ನು ನಿಮ್ಮ ಮೊಬೈಲ್‌ಗೆ ಕಳುಹಿಸಲಾಗಿದೆ.", smsFailed: "ಕ್ಷಮಿಸಿ. ಮಾರುಕಟ್ಟೆ ದರಗಳ ಎಸ್ ಎಂ ಎಸ್ ಈಗ ಕಳುಹಿಸಲಾಗಲಿಲ್ಲ."
  },
  "ml-IN": {
    found: (count, crop, location) => `${location} സമീപം ${crop}യ്ക്ക് ${spokenNumber(count, "ml-IN")} ചന്തകൾ ലഭ്യമാണ്.`,
    selected: "നിങ്ങൾക്കായി ഏറ്റവും അനുയോജ്യമായ അഞ്ച് ചന്തകൾ തിരഞ്ഞെടുത്തു.", latest: date => `ഇവ ${date} തീയതിയിലെ ഏറ്റവും പുതിയ ലഭ്യമായ വിലകളാണ്.`,
    menu: callable => `${callable ? "വാങ്ങുന്നയാളുമായി സംസാരിക്കാൻ ഒന്ന് അമർത്തുക. " : "ഇപ്പോൾ വാങ്ങുന്നയാളുമായി നേരിട്ട് ബന്ധിപ്പിക്കൽ ലഭ്യമല്ല. "}അഞ്ച് ചന്തവിലകൾ എസ് എം എസ് ആയി ലഭിക്കാൻ രണ്ട് അമർത്തുക. കോൾ അവസാനിപ്പിക്കാൻ മൂന്ന് അമർത്തുക.`,
    smsSent: "അഞ്ച് ചന്തവിലകൾ നിങ്ങളുടെ മൊബൈലിലേക്ക് അയച്ചു.", smsFailed: "ക്ഷമിക്കണം. ചന്തവിലകളുടെ എസ് എം എസ് ഇപ്പോൾ അയയ്ക്കാനായില്ല."
  },
  "pa-IN": {
    found: (count, crop, location) => `${location} ਦੇ ਨੇੜੇ ${crop} ਲਈ ${spokenNumber(count, "pa-IN")} ਮੰਡੀਆਂ ਮਿਲੀਆਂ ਹਨ।`,
    selected: "ਮੈਂ ਤੁਹਾਡੇ ਲਈ ਪੰਜ ਸਭ ਤੋਂ ਢੁੱਕਵੀਆਂ ਮੰਡੀਆਂ ਚੁਣੀਆਂ ਹਨ।", latest: date => `ਇਹ ${date} ਦੇ ਸਭ ਤੋਂ ਨਵੇਂ ਉਪਲਬਧ ਭਾਅ ਹਨ।`,
    menu: callable => `${callable ? "ਖਰੀਦਦਾਰ ਨਾਲ ਗੱਲ ਕਰਨ ਲਈ ਇੱਕ ਦਬਾਓ। " : "ਹੁਣ ਸਿੱਧਾ ਖਰੀਦਦਾਰ ਨਾਲ ਜੋੜਨਾ ਉਪਲਬਧ ਨਹੀਂ। "}ਪੰਜ ਮੰਡੀ ਭਾਅ ਐਸ ਐਮ ਐਸ ਵਿੱਚ ਲੈਣ ਲਈ ਦੋ ਦਬਾਓ। ਕਾਲ ਖਤਮ ਕਰਨ ਲਈ ਤਿੰਨ ਦਬਾਓ।`,
    smsSent: "ਪੰਜ ਮੰਡੀ ਭਾਅ ਤੁਹਾਡੇ ਮੋਬਾਈਲ ਉੱਤੇ ਭੇਜੇ ਗਏ ਹਨ।", smsFailed: "ਮਾਫ ਕਰਨਾ। ਮੰਡੀ ਭਾਅ ਦਾ ਐਸ ਐਮ ਐਸ ਹੁਣ ਨਹੀਂ ਭੇਜਿਆ ਜਾ ਸਕਿਆ।"
  },
  "od-IN": {
    found: (count, crop, location) => `${location} ନିକଟରେ ${crop} ପାଇଁ ${spokenNumber(count, "od-IN")}ଟି ମଣ୍ଡି ମିଳିଛି।`,
    selected: "ଆପଣଙ୍କ ପାଇଁ ପାଞ୍ଚଟି ଉପଯୁକ୍ତ ମଣ୍ଡି ବାଛିଛି।", latest: date => `ଏଗୁଡ଼ିକ ${date} ତାରିଖର ସର୍ବଶେଷ ଉପଲବ୍ଧ ଦର।`,
    menu: callable => `${callable ? "କ୍ରେତାଙ୍କ ସହ କଥା ହେବାକୁ ଏକ ଦବାନ୍ତୁ। " : "ଏବେ କ୍ରେତାଙ୍କ ସହ ସିଧା ସଂଯୋଗ ଉପଲବ୍ଧ ନାହିଁ। "}ପାଞ୍ଚଟି ମଣ୍ଡି ଦର ଏସ ଏମ ଏସରେ ପାଇବାକୁ ଦୁଇ ଦବାନ୍ତୁ। କଲ୍ ଶେଷ କରିବାକୁ ତିନି ଦବାନ୍ତୁ।`,
    smsSent: "ପାଞ୍ଚଟି ମଣ୍ଡି ଦର ଆପଣଙ୍କ ମୋବାଇଲକୁ ପଠାଯାଇଛି।", smsFailed: "ଦୁଃଖିତ। ମଣ୍ଡି ଦରର ଏସ ଏମ ଏସ ଏବେ ପଠାଇ ହେଲା ନାହିଁ।"
  },
  "en-IN": {
    found: (count, crop, location) => `${spokenNumber(count, "en-IN")} markets are available for ${crop} around ${location}.`,
    selected: "I selected the five most suitable markets for you.", latest: date => `These are the latest available prices from ${date}.`,
    menu: callable => `${callable ? "Press one to speak with the matched buyer. " : "Direct buyer connection is currently unavailable. "}Press two to receive five mandi prices by S M S. Press three to end the call.`,
    smsSent: "The five mandi prices were sent to your mobile.", smsFailed: "Sorry. The mandi price S M S could not be sent right now."
  }
});

function getMandiMessages(languageCode) {
  return MANDI_MESSAGES[languageCode] || MANDI_MESSAGES["hi-IN"];
}

module.exports = { MANDI_MESSAGES, getMandiMessages };
