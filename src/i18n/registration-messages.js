// Separate from the established call-menu contract; no keypad meanings change.
const saved = {
  'hi-IN': 'आपकी आवश्यकता दर्ज कर ली गई है।',
  'gu-IN': 'તમારી જરૂરિયાત નોંધવામાં આવી છે.',
  'en-IN': 'Your requirement has been recorded.',
  'mr-IN': 'तुमची आवश्यकता नोंदवली आहे.',
  'pa-IN': 'ਤੁਹਾਡੀ ਲੋੜ ਦਰਜ ਕਰ ਲਈ ਗਈ ਹੈ।',
  'bn-IN': 'আপনার প্রয়োজন নথিভুক্ত করা হয়েছে।',
  'ta-IN': 'உங்கள் தேவை பதிவு செய்யப்பட்டுள்ளது.',
  'te-IN': 'మీ అవసరం నమోదు చేయబడింది.',
  'kn-IN': 'ನಿಮ್ಮ ಅಗತ್ಯವನ್ನು ದಾಖಲಿಸಲಾಗಿದೆ.',
  'ml-IN': 'നിങ്ങളുടെ ആവശ്യം രേഖപ്പെടുത്തിയിട്ടുണ്ട്.',
  'od-IN': 'ଆପଣଙ୍କ ଆବଶ୍ୟକତା ଲିପିବଦ୍ଧ କରାଯାଇଛି।'
};
function registrationMessage(result, language) {
  return ['CREATED', 'UPDATED', 'EXISTING'].includes(result?.status)
    ? saved[language === 'or-IN' ? 'od-IN' : language] || saved['hi-IN']
    : '';
}
module.exports = { registrationMessage };
