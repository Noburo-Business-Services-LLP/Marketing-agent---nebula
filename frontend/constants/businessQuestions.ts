/**
 * The business-profile questions, shared by sign-up (English, Tamil, Hindi) and Settings (English).
 *
 * VALUES mirror `backend/config/businessQuestions.js` exactly; `tests/businessQuestions.test.mjs` loads that file and
 * fails if a list here differs. Values are saved on the profile and never translated; only the WORDS change with the
 * language. Every language must have every word (the test checks it). Product words stay in English.
 *
 * This file imports nothing at run time, so the tests can load it directly.
 * How to add a question: docs/superpowers/ops/questionnaire.md
 */
export type QLang = 'en' | 'ta' | 'hi';

/* ---------- Values (mirror of the backend definition) ---------- */

export const SELLS_TO = ['B2C', 'B2B', 'Both'] as const;
export const INDUSTRY_GROUPS: { id: string; values: string[] }[] = [
  { id: 'shops', values: ['E-commerce / Retail', 'Fashion & Apparel', 'Jewellery', 'Grocery & Supermarket', 'Electronics & Mobile', 'Home & Furniture', 'Automotive', 'Wholesale & Distribution'] },
  { id: 'food', values: ['Restaurants / Cafes / Bars', 'Food & Beverage', 'Travel & Hospitality', 'Events & Weddings'] },
  { id: 'health', values: ['Healthcare', 'Beauty & Wellness', 'Salon & Spa', 'Gym & Fitness'] },
  { id: 'services', values: ['Professional Services', 'Legal & Accounting', 'Home Services & Repairs', 'Logistics & Transport', 'Coaching & Training'] },
  { id: 'technology', values: ['Technology / SaaS', 'IT Services', 'Agency / Marketing', 'Finance / Fintech'] },
  { id: 'industry', values: ['Real Estate', 'Construction & Interiors', 'Manufacturing', 'Agriculture'] },
  { id: 'community', values: ['Education', 'Media & Entertainment', 'Creators & Influencers', 'Non-profit'] },
];
export const OTHER_INDUSTRY = 'Other';
export const INDUSTRIES: string[] = [...INDUSTRY_GROUPS.flatMap((g) => g.values), OTHER_INDUSTRY];
export const INDUSTRY_ALIASES: Record<string, string> = { 'Technology/SaaS': 'Technology / SaaS', 'Finance/Fintech': 'Finance / Fintech', 'E-commerce/Retail': 'E-commerce / Retail', 'Restaurants/Cafes/Bars': 'Restaurants / Cafes / Bars' };
export const REACH_AREAS = ['neighbourhood', 'city', 'state', 'india', 'international'] as const;
export const OLD_REACH: Record<string, string> = { hyperlocal: 'neighbourhood', local_city: 'city', regional: 'state', state: 'state', national: 'india', international: 'international' };
export const AGE_GROUPS = ['under_18', '18_24', '25_34', '35_44', '45_54', '55_plus'] as const;
export const GENDERS = ['mostly_men', 'mostly_women', 'families'] as const;
export const OLD_GENDERS: Record<string, string> = { both_equally: '' };
export const BUYER_INDUSTRIES: string[] = [...INDUSTRY_GROUPS.map((g) => g.id), 'government'];
export const COMPANY_SIZES = ['solo', 'small', 'medium', 'large'] as const;
export const DECISION_MAKERS = ['Owner or founder', 'Managing director', 'Operations head', 'Purchase team', 'Marketing head', 'Technology head', 'HR head', 'Finance head'] as const;
export const SALES_CYCLES = ['days', 'weeks', 'months'] as const;
export const VOICES = ['Professional', 'Friendly', 'Witty', 'Empathetic', 'Bold', 'Educational'] as const;
export const GOALS = ['Brand Awareness', 'Lead Generation', 'Direct Sales', 'Community Engagement', 'Website Traffic'] as const;
export const LANGUAGES = ['english', 'hindi', 'tamil', 'telugu', 'kannada', 'malayalam'] as const;
export const MIX_SUFFIX = '_english_mix';
export const OFFERED_CONTENT_LANGUAGES: string[] = [...LANGUAGES, ...LANGUAGES.filter((l) => l !== 'english').map((l) => `${l}${MIX_SUFFIX}`)];
export const BRANCHES = { people: ['B2C', 'Both'], business: ['B2B', 'Both'] } as const;
export const LIMITS = { industry: 80, decisionMaker: 120 } as const;

export type ReachArea = (typeof REACH_AREAS)[number];

/* ---------- Words ---------- */

interface Q { title: string; hint?: string }
export interface QuestionWords {
  optional: string;
  pickAny: string;
  chooseOne: string;
  q: {
    industry: Q; industryOther: Q & { placeholder: string }; sellsTo: Q; reach: Q; ageGroups: Q; gender: Q;
    businessBranch: Q; buyerIndustries: Q; companySize: Q; decisionMaker: Q & { placeholder: string }; salesCycle: Q;
    goals: Q; voice: Q; language: Q; languageMix: Q;
  };
  groups: Record<string, string>;
  industries: Record<string, string>;
  sellsTo: Record<(typeof SELLS_TO)[number], { label: string; sub: string }>;
  reach: Record<ReachArea, { label: string; sub: string }>;
  ages: Record<(typeof AGE_GROUPS)[number], string>;
  everyone: string;
  genders: Record<(typeof GENDERS)[number], string>;
  buyers: Record<string, string>;
  sizes: Record<(typeof COMPANY_SIZES)[number], string>;
  deciders: Record<(typeof DECISION_MAKERS)[number], string>;
  someoneElse: string;
  cycles: Record<(typeof SALES_CYCLES)[number], string>;
  voices: Record<(typeof VOICES)[number], string>;
  goals: Record<(typeof GOALS)[number], string>;
  languages: Record<(typeof LANGUAGES)[number], string>;
}

const en: QuestionWords = {
  optional: '(optional)',
  pickAny: 'Choose all that apply.',
  chooseOne: 'Choose one',
  q: {
    industry: { title: 'Type of business', hint: 'Pick the closest one. Choose Other to write your own.' },
    industryOther: { title: 'Your type of business', placeholder: 'For example: pet grooming' },
    sellsTo: { title: 'Who do you sell to?', hint: 'This decides the next questions.' },
    reach: { title: 'Where are your customers?', hint: 'Choose all that apply.' },
    ageGroups: { title: 'How old are most of your customers?', hint: 'Choose all that apply.' },
    gender: { title: 'Mostly men, women or families?', hint: 'Leave it on Everyone unless it really describes your customers.' },
    businessBranch: { title: 'About your business customers' },
    buyerIndustries: { title: 'Which kinds of businesses buy from you?', hint: 'Choose all that apply.' },
    companySize: { title: 'How big are they?' },
    decisionMaker: { title: 'Who usually decides to buy?', placeholder: 'For example: the hospital purchase committee' },
    salesCycle: { title: 'How long does a sale usually take?' },
    goals: { title: 'What do you want most?', hint: 'Pick one or more.' },
    voice: { title: 'How should your posts sound?', hint: 'Choose all that apply.' },
    language: { title: 'Language for your posts' },
    languageMix: { title: 'Mix in everyday English words', hint: 'The way many people speak and text, for example Tanglish or Hinglish.' },
  },
  groups: {
    shops: 'Shops and products', food: 'Food, stays and events', health: 'Health and beauty', services: 'Services',
    technology: 'Business and technology', industry: 'Property and industry', community: 'Learning, media and community',
  },
  industries: {
    'E-commerce / Retail': 'Shop or online store', 'Fashion & Apparel': 'Fashion and clothing', 'Jewellery': 'Jewellery',
    'Grocery & Supermarket': 'Grocery and supermarket', 'Electronics & Mobile': 'Electronics and mobiles', 'Home & Furniture': 'Home and furniture',
    'Automotive': 'Vehicles and automotive', 'Wholesale & Distribution': 'Wholesale and distribution',
    'Restaurants / Cafes / Bars': 'Restaurant, café or bar', 'Food & Beverage': 'Food and drinks brand', 'Travel & Hospitality': 'Hotel, homestay or travel',
    'Events & Weddings': 'Events and weddings',
    'Healthcare': 'Clinic, hospital or pharmacy', 'Beauty & Wellness': 'Beauty and wellness', 'Salon & Spa': 'Salon and spa', 'Gym & Fitness': 'Gym and fitness',
    'Professional Services': 'Consulting and professional services', 'Legal & Accounting': 'Legal and accounting', 'Home Services & Repairs': 'Home services and repairs',
    'Logistics & Transport': 'Logistics and transport', 'Coaching & Training': 'Coaching and training',
    'Technology / SaaS': 'Software and apps', 'IT Services': 'IT services', 'Agency / Marketing': 'Marketing or design agency', 'Finance / Fintech': 'Finance, insurance and loans',
    'Real Estate': 'Real estate', 'Construction & Interiors': 'Construction and interiors', 'Manufacturing': 'Manufacturing and factories', 'Agriculture': 'Farming and agriculture',
    'Education': 'School, college or tuition', 'Media & Entertainment': 'Media and entertainment', 'Creators & Influencers': 'Creator or personal brand', 'Non-profit': 'Non-profit or trust',
    'Other': 'Other',
  },
  sellsTo: {
    B2C: { label: 'People', sub: 'Individual customers and families' },
    B2B: { label: 'Businesses', sub: 'Shops, offices, clinics, factories' },
    Both: { label: 'Both', sub: 'People and businesses' },
  },
  reach: {
    neighbourhood: { label: 'My area', sub: 'A few streets around me' },
    city: { label: 'My city', sub: 'The whole town or city' },
    state: { label: 'My state', sub: 'Across the state' },
    india: { label: 'All of India', sub: 'Every state' },
    international: { label: 'Other countries', sub: 'Outside India' },
  },
  ages: { under_18: 'Under 18', '18_24': '18 to 24', '25_34': '25 to 34', '35_44': '35 to 44', '45_54': '45 to 54', '55_plus': '55 and over' },
  everyone: 'Everyone',
  genders: { mostly_women: 'Mostly women', mostly_men: 'Mostly men', families: 'Families' },
  buyers: {
    shops: 'Shops and online stores', food: 'Restaurants, hotels and events', health: 'Clinics, salons and gyms', services: 'Service firms',
    technology: 'Technology and finance', industry: 'Builders, factories and farms', community: 'Schools, media and non-profits', government: 'Government offices',
  },
  sizes: { solo: 'Just the owner', small: 'Small, up to 50 people', medium: 'Mid-size, 50 to 500 people', large: 'Large, over 500 people' },
  deciders: {
    'Owner or founder': 'Owner or founder', 'Managing director': 'Managing director', 'Operations head': 'Operations head', 'Purchase team': 'Purchase team',
    'Marketing head': 'Marketing head', 'Technology head': 'Technology head', 'HR head': 'HR head', 'Finance head': 'Finance head',
  },
  someoneElse: 'Someone else',
  cycles: { days: 'A few days', weeks: 'A few weeks', months: 'Several months' },
  voices: { Professional: 'Professional', Friendly: 'Friendly', Witty: 'Witty', Empathetic: 'Caring', Bold: 'Bold', Educational: 'Helpful and informative' },
  goals: {
    'Brand Awareness': 'More people know about my business', 'Lead Generation': 'More enquiries and calls', 'Direct Sales': 'More sales',
    'Community Engagement': 'More followers, likes and comments', 'Website Traffic': 'More visits to my website',
  },
  languages: { english: 'English', hindi: 'Hindi', tamil: 'Tamil', telugu: 'Telugu', kannada: 'Kannada', malayalam: 'Malayalam' },
};

// Tamil and Hindi: needs a native-speaker read (same note as the other sign-up words).
const ta: QuestionWords = {
  optional: '(விருப்பம்)',
  pickAny: 'பொருந்தும் அனைத்தையும் தேர்ந்தெடுங்கள்.',
  chooseOne: 'ஒன்றைத் தேர்ந்தெடுங்கள்',
  q: {
    industry: { title: 'வணிக வகை', hint: 'மிக நெருக்கமானதைத் தேர்ந்தெடுங்கள். உங்கள் சொந்த வார்த்தைகளில் எழுத ‘மற்றவை’ என்பதைத் தேர்ந்தெடுங்கள்.' },
    industryOther: { title: 'உங்கள் வணிக வகை', placeholder: 'எ.கா. செல்லப்பிராணி பராமரிப்பு' },
    sellsTo: { title: 'நீங்கள் யாருக்கு விற்கிறீர்கள்?', hint: 'இதைப் பொறுத்து அடுத்த கேள்விகள் மாறும்.' },
    reach: { title: 'உங்கள் வாடிக்கையாளர்கள் எங்கே இருக்கிறார்கள்?', hint: 'பொருந்தும் அனைத்தையும் தேர்ந்தெடுங்கள்.' },
    ageGroups: { title: 'உங்கள் வாடிக்கையாளர்களில் பெரும்பாலோர் எந்த வயதினர்?', hint: 'பொருந்தும் அனைத்தையும் தேர்ந்தெடுங்கள்.' },
    gender: { title: 'பெரும்பாலும் ஆண்களா, பெண்களா, குடும்பங்களா?', hint: 'உண்மையில் பொருந்தினால் மட்டும் மாற்றுங்கள். இல்லையெனில் ‘அனைவரும்’ என்றே விடுங்கள்.' },
    businessBranch: { title: 'உங்கள் வணிக வாடிக்கையாளர்கள் பற்றி' },
    buyerIndustries: { title: 'எந்த வகை வணிகங்கள் உங்களிடம் வாங்குகின்றன?', hint: 'பொருந்தும் அனைத்தையும் தேர்ந்தெடுங்கள்.' },
    companySize: { title: 'அவை எவ்வளவு பெரியவை?' },
    decisionMaker: { title: 'வாங்கும் முடிவை பொதுவாக யார் எடுக்கிறார்கள்?', placeholder: 'எ.கா. மருத்துவமனையின் கொள்முதல் குழு' },
    salesCycle: { title: 'ஒரு விற்பனை முடிய பொதுவாக எவ்வளவு காலம் ஆகும்?' },
    goals: { title: 'உங்களுக்கு மிகவும் வேண்டியது என்ன?', hint: 'ஒன்று அல்லது அதற்கு மேல் தேர்ந்தெடுங்கள்.' },
    voice: { title: 'உங்கள் பதிவுகள் எப்படிப் பேச வேண்டும்?', hint: 'பொருந்தும் அனைத்தையும் தேர்ந்தெடுங்கள்.' },
    language: { title: 'பதிவுகளுக்கான மொழி' },
    languageMix: { title: 'அன்றாட ஆங்கிலச் சொற்களைக் கலக்கவும்', hint: 'பலர் பேசுவது, மெசேஜ் செய்வது போல. எ.கா. தமிழும் ஆங்கிலமும் கலந்து.' },
  },
  groups: {
    shops: 'கடைகள் மற்றும் பொருட்கள்', food: 'உணவு, தங்குமிடம், நிகழ்ச்சிகள்', health: 'ஆரோக்கியம் மற்றும் அழகு', services: 'சேவைகள்',
    technology: 'வணிகம் மற்றும் தொழில்நுட்பம்', industry: 'சொத்து மற்றும் தொழில்துறை', community: 'கல்வி, ஊடகம், சமூகம்',
  },
  industries: {
    'E-commerce / Retail': 'கடை அல்லது ஆன்லைன் கடை', 'Fashion & Apparel': 'ஃபேஷன் மற்றும் ஆடைகள்', 'Jewellery': 'நகைகள்',
    'Grocery & Supermarket': 'மளிகை மற்றும் சூப்பர் மார்க்கெட்', 'Electronics & Mobile': 'மின்னணு சாதனங்கள் மற்றும் மொபைல்', 'Home & Furniture': 'வீடு மற்றும் மரச்சாமான்கள்',
    'Automotive': 'வாகனங்கள்', 'Wholesale & Distribution': 'மொத்த விற்பனை மற்றும் விநியோகம்',
    'Restaurants / Cafes / Bars': 'உணவகம், கஃபே அல்லது பார்', 'Food & Beverage': 'உணவு மற்றும் பானங்கள் பிராண்ட்', 'Travel & Hospitality': 'ஹோட்டல், தங்குமிடம் அல்லது பயணம்',
    'Events & Weddings': 'நிகழ்ச்சிகள் மற்றும் திருமணங்கள்',
    'Healthcare': 'கிளினிக், மருத்துவமனை அல்லது மருந்தகம்', 'Beauty & Wellness': 'அழகு மற்றும் நலவாழ்வு', 'Salon & Spa': 'சலூன் மற்றும் ஸ்பா', 'Gym & Fitness': 'ஜிம் மற்றும் உடற்பயிற்சி',
    'Professional Services': 'ஆலோசனை மற்றும் தொழில்முறை சேவைகள்', 'Legal & Accounting': 'சட்டம் மற்றும் கணக்கியல்', 'Home Services & Repairs': 'வீட்டுச் சேவைகள் மற்றும் பழுதுபார்ப்பு',
    'Logistics & Transport': 'சரக்கு மற்றும் போக்குவரத்து', 'Coaching & Training': 'பயிற்சி மற்றும் வகுப்புகள்',
    'Technology / SaaS': 'மென்பொருள் மற்றும் ஆப்கள்', 'IT Services': 'ஐடி சேவைகள்', 'Agency / Marketing': 'மார்க்கெட்டிங் அல்லது டிசைன் நிறுவனம்', 'Finance / Fintech': 'நிதி, காப்பீடு மற்றும் கடன்',
    'Real Estate': 'ரியல் எஸ்டேட்', 'Construction & Interiors': 'கட்டுமானம் மற்றும் உள் அலங்காரம்', 'Manufacturing': 'உற்பத்தி மற்றும் தொழிற்சாலைகள்', 'Agriculture': 'விவசாயம்',
    'Education': 'பள்ளி, கல்லூரி அல்லது டியூஷன்', 'Media & Entertainment': 'ஊடகம் மற்றும் பொழுதுபோக்கு', 'Creators & Influencers': 'கிரியேட்டர் அல்லது தனிநபர் பிராண்ட்', 'Non-profit': 'இலாப நோக்கற்ற அமைப்பு அல்லது அறக்கட்டளை',
    'Other': 'மற்றவை',
  },
  sellsTo: {
    B2C: { label: 'மக்கள்', sub: 'தனிநபர் வாடிக்கையாளர்கள், குடும்பங்கள்' },
    B2B: { label: 'வணிகங்கள்', sub: 'கடைகள், அலுவலகங்கள், கிளினிக்குகள், தொழிற்சாலைகள்' },
    Both: { label: 'இரண்டும்', sub: 'மக்களும் வணிகங்களும்' },
  },
  reach: {
    neighbourhood: { label: 'என் பகுதி', sub: 'என்னைச் சுற்றியுள்ள சில தெருக்கள்' },
    city: { label: 'என் ஊர்', sub: 'முழு ஊர் அல்லது நகரம்' },
    state: { label: 'என் மாநிலம்', sub: 'மாநிலம் முழுவதும்' },
    india: { label: 'இந்தியா முழுவதும்', sub: 'எல்லா மாநிலங்களும்' },
    international: { label: 'பிற நாடுகள்', sub: 'இந்தியாவுக்கு வெளியே' },
  },
  ages: { under_18: '18 வயதுக்குக் கீழ்', '18_24': '18 முதல் 24', '25_34': '25 முதல் 34', '35_44': '35 முதல் 44', '45_54': '45 முதல் 54', '55_plus': '55 மற்றும் அதற்கு மேல்' },
  everyone: 'அனைவரும்',
  genders: { mostly_women: 'பெரும்பாலும் பெண்கள்', mostly_men: 'பெரும்பாலும் ஆண்கள்', families: 'குடும்பங்கள்' },
  buyers: {
    shops: 'கடைகள் மற்றும் ஆன்லைன் கடைகள்', food: 'உணவகங்கள், ஹோட்டல்கள், நிகழ்ச்சிகள்', health: 'கிளினிக்குகள், சலூன்கள், ஜிம்கள்', services: 'சேவை நிறுவனங்கள்',
    technology: 'தொழில்நுட்பம் மற்றும் நிதி', industry: 'கட்டுமானம், தொழிற்சாலைகள், பண்ணைகள்', community: 'பள்ளிகள், ஊடகம், இலாப நோக்கற்ற அமைப்புகள்', government: 'அரசு அலுவலகங்கள்',
  },
  sizes: { solo: 'உரிமையாளர் மட்டும்', small: 'சிறியவை, 50 பேர் வரை', medium: 'நடுத்தரம், 50 முதல் 500 பேர்', large: 'பெரியவை, 500 பேருக்கு மேல்' },
  deciders: {
    'Owner or founder': 'உரிமையாளர் அல்லது நிறுவனர்', 'Managing director': 'நிர்வாக இயக்குநர்', 'Operations head': 'செயல்பாட்டுத் தலைவர்', 'Purchase team': 'கொள்முதல் குழு',
    'Marketing head': 'மார்க்கெட்டிங் தலைவர்', 'Technology head': 'தொழில்நுட்பத் தலைவர்', 'HR head': 'மனிதவளத் தலைவர்', 'Finance head': 'நிதித் தலைவர்',
  },
  someoneElse: 'வேறு ஒருவர்',
  cycles: { days: 'சில நாட்கள்', weeks: 'சில வாரங்கள்', months: 'பல மாதங்கள்' },
  voices: { Professional: 'தொழில்முறை', Friendly: 'நட்பான', Witty: 'நகைச்சுவை', Empathetic: 'அக்கறையான', Bold: 'துணிச்சலான', Educational: 'பயனுள்ள தகவல் தரும்' },
  goals: {
    'Brand Awareness': 'என் வணிகம் அதிகம் பேருக்குத் தெரிய வேண்டும்', 'Lead Generation': 'அதிக விசாரணைகளும் அழைப்புகளும்', 'Direct Sales': 'அதிக விற்பனை',
    'Community Engagement': 'அதிக பின்தொடர்பவர்கள், லைக்குகள், கருத்துகள்', 'Website Traffic': 'என் இணையதளத்துக்கு அதிக வருகைகள்',
  },
  languages: { english: 'ஆங்கிலம்', hindi: 'இந்தி', tamil: 'தமிழ்', telugu: 'தெலுங்கு', kannada: 'கன்னடம்', malayalam: 'மலையாளம்' },
};

const hi: QuestionWords = {
  optional: '(वैकल्पिक)',
  pickAny: 'जो भी लागू हों, सब चुनें।',
  chooseOne: 'एक चुनें',
  q: {
    industry: { title: 'बिज़नेस का प्रकार', hint: 'सबसे नज़दीकी चुनें। अपने शब्दों में लिखने के लिए ‘अन्य’ चुनें।' },
    industryOther: { title: 'आपके बिज़नेस का प्रकार', placeholder: 'जैसे: पालतू जानवरों की ग्रूमिंग' },
    sellsTo: { title: 'आप किसे बेचते हैं?', hint: 'इसी से अगले सवाल तय होंगे।' },
    reach: { title: 'आपके ग्राहक कहाँ हैं?', hint: 'जो भी लागू हों, सब चुनें।' },
    ageGroups: { title: 'आपके ज़्यादातर ग्राहकों की उम्र क्या है?', hint: 'जो भी लागू हों, सब चुनें।' },
    gender: { title: 'ज़्यादातर पुरुष, महिलाएँ या परिवार?', hint: 'जब तक यह सच में आपके ग्राहकों पर लागू न हो, ‘सभी’ ही रहने दें।' },
    businessBranch: { title: 'आपके बिज़नेस ग्राहकों के बारे में' },
    buyerIndustries: { title: 'किस तरह के बिज़नेस आपसे खरीदते हैं?', hint: 'जो भी लागू हों, सब चुनें।' },
    companySize: { title: 'वे कितने बड़े हैं?' },
    decisionMaker: { title: 'खरीदने का फ़ैसला आमतौर पर कौन करता है?', placeholder: 'जैसे: अस्पताल की ख़रीद समिति' },
    salesCycle: { title: 'एक बिक्री में आमतौर पर कितना समय लगता है?' },
    goals: { title: 'आपको सबसे ज़्यादा क्या चाहिए?', hint: 'एक या ज़्यादा चुनें।' },
    voice: { title: 'आपकी पोस्ट का अंदाज़ कैसा हो?', hint: 'जो भी लागू हों, सब चुनें।' },
    language: { title: 'पोस्ट की भाषा' },
    languageMix: { title: 'रोज़मर्रा के अंग्रेज़ी शब्द मिलाएँ', hint: 'जैसे बहुत से लोग बोलते और मैसेज करते हैं, जैसे हिंग्लिश।' },
  },
  groups: {
    shops: 'दुकानें और प्रोडक्ट', food: 'खाना, ठहरना और इवेंट', health: 'स्वास्थ्य और ब्यूटी', services: 'सेवाएँ',
    technology: 'बिज़नेस और टेक्नोलॉजी', industry: 'प्रॉपर्टी और उद्योग', community: 'शिक्षा, मीडिया और समुदाय',
  },
  industries: {
    'E-commerce / Retail': 'दुकान या ऑनलाइन स्टोर', 'Fashion & Apparel': 'फ़ैशन और कपड़े', 'Jewellery': 'ज्वैलरी',
    'Grocery & Supermarket': 'किराना और सुपरमार्केट', 'Electronics & Mobile': 'इलेक्ट्रॉनिक्स और मोबाइल', 'Home & Furniture': 'घर और फ़र्नीचर',
    'Automotive': 'गाड़ियाँ और ऑटोमोबाइल', 'Wholesale & Distribution': 'होलसेल और डिस्ट्रीब्यूशन',
    'Restaurants / Cafes / Bars': 'रेस्टोरेंट, कैफ़े या बार', 'Food & Beverage': 'खाने-पीने का ब्रांड', 'Travel & Hospitality': 'होटल, होमस्टे या यात्रा',
    'Events & Weddings': 'इवेंट और शादियाँ',
    'Healthcare': 'क्लिनिक, अस्पताल या फ़ार्मेसी', 'Beauty & Wellness': 'ब्यूटी और वेलनेस', 'Salon & Spa': 'सैलून और स्पा', 'Gym & Fitness': 'जिम और फ़िटनेस',
    'Professional Services': 'कंसल्टिंग और प्रोफ़ेशनल सेवाएँ', 'Legal & Accounting': 'क़ानूनी और अकाउंटिंग', 'Home Services & Repairs': 'घरेलू सेवाएँ और मरम्मत',
    'Logistics & Transport': 'लॉजिस्टिक्स और ट्रांसपोर्ट', 'Coaching & Training': 'कोचिंग और ट्रेनिंग',
    'Technology / SaaS': 'सॉफ़्टवेयर और ऐप', 'IT Services': 'आईटी सेवाएँ', 'Agency / Marketing': 'मार्केटिंग या डिज़ाइन एजेंसी', 'Finance / Fintech': 'वित्त, बीमा और लोन',
    'Real Estate': 'रियल एस्टेट', 'Construction & Interiors': 'निर्माण और इंटीरियर', 'Manufacturing': 'मैन्युफ़ैक्चरिंग और फ़ैक्टरी', 'Agriculture': 'खेती और कृषि',
    'Education': 'स्कूल, कॉलेज या ट्यूशन', 'Media & Entertainment': 'मीडिया और मनोरंजन', 'Creators & Influencers': 'क्रिएटर या पर्सनल ब्रांड', 'Non-profit': 'गैर-लाभकारी संस्था या ट्रस्ट',
    'Other': 'अन्य',
  },
  sellsTo: {
    B2C: { label: 'लोग', sub: 'व्यक्तिगत ग्राहक और परिवार' },
    B2B: { label: 'बिज़नेस', sub: 'दुकानें, ऑफ़िस, क्लिनिक, फ़ैक्टरी' },
    Both: { label: 'दोनों', sub: 'लोग और बिज़नेस' },
  },
  reach: {
    neighbourhood: { label: 'मेरा इलाक़ा', sub: 'मेरे आसपास की कुछ गलियाँ' },
    city: { label: 'मेरा शहर', sub: 'पूरा कस्बा या शहर' },
    state: { label: 'मेरा राज्य', sub: 'पूरे राज्य में' },
    india: { label: 'पूरा भारत', sub: 'हर राज्य' },
    international: { label: 'दूसरे देश', sub: 'भारत के बाहर' },
  },
  ages: { under_18: '18 से कम', '18_24': '18 से 24', '25_34': '25 से 34', '35_44': '35 से 44', '45_54': '45 से 54', '55_plus': '55 और उससे ज़्यादा' },
  everyone: 'सभी',
  genders: { mostly_women: 'ज़्यादातर महिलाएँ', mostly_men: 'ज़्यादातर पुरुष', families: 'परिवार' },
  buyers: {
    shops: 'दुकानें और ऑनलाइन स्टोर', food: 'रेस्टोरेंट, होटल और इवेंट', health: 'क्लिनिक, सैलून और जिम', services: 'सेवा देने वाली फ़र्म',
    technology: 'टेक्नोलॉजी और वित्त', industry: 'बिल्डर, फ़ैक्टरी और फ़ार्म', community: 'स्कूल, मीडिया और गैर-लाभकारी संस्थाएँ', government: 'सरकारी दफ़्तर',
  },
  sizes: { solo: 'सिर्फ़ मालिक', small: 'छोटे, 50 लोगों तक', medium: 'मध्यम, 50 से 500 लोग', large: 'बड़े, 500 से ज़्यादा लोग' },
  deciders: {
    'Owner or founder': 'मालिक या संस्थापक', 'Managing director': 'मैनेजिंग डायरेक्टर', 'Operations head': 'ऑपरेशंस हेड', 'Purchase team': 'ख़रीद टीम',
    'Marketing head': 'मार्केटिंग हेड', 'Technology head': 'टेक्नोलॉजी हेड', 'HR head': 'एचआर हेड', 'Finance head': 'फ़ाइनेंस हेड',
  },
  someoneElse: 'कोई और',
  cycles: { days: 'कुछ दिन', weeks: 'कुछ हफ़्ते', months: 'कई महीने' },
  voices: { Professional: 'प्रोफ़ेशनल', Friendly: 'दोस्ताना', Witty: 'मज़ेदार', Empathetic: 'परवाह करने वाला', Bold: 'बेबाक', Educational: 'काम की जानकारी देने वाला' },
  goals: {
    'Brand Awareness': 'ज़्यादा लोग मेरे बिज़नेस को जानें', 'Lead Generation': 'ज़्यादा पूछताछ और कॉल', 'Direct Sales': 'ज़्यादा बिक्री',
    'Community Engagement': 'ज़्यादा फ़ॉलोअर, लाइक और कमेंट', 'Website Traffic': 'मेरी वेबसाइट पर ज़्यादा विज़िट',
  },
  languages: { english: 'अंग्रेज़ी', hindi: 'हिन्दी', tamil: 'तमिल', telugu: 'तेलुगु', kannada: 'कन्नड़', malayalam: 'मलयालम' },
};

export const QUESTION_WORDS: Record<QLang, QuestionWords> = { en, ta, hi };

/** Each language in its own script, shown small under the name on the language tiles. */
export const LANGUAGE_SCRIPT: Record<(typeof LANGUAGES)[number], string> = {
  english: 'English', hindi: 'हिन्दी', tamil: 'தமிழ்', telugu: 'తెలుగు', kannada: 'ಕನ್ನಡ', malayalam: 'മലയാളം',
};
/** English names of the older languages an account may still use (shown as an extra tile, never offered). */
export const OLDER_LANGUAGE_NAMES: Record<string, string> = { marathi: 'Marathi', bengali: 'Bengali', gujarati: 'Gujarati', punjabi: 'Punjabi', odia: 'Odia', urdu: 'Urdu' };

/* ---------- Rules (pure) ---------- */

type Profile = { [k: string]: any } | null | undefined;

export const sellsToBusinesses = (type?: string) => (BRANCHES.business as readonly string[]).includes(String(type || ''));
export const sellsToPeople = (type?: string) => (BRANCHES.people as readonly string[]).includes(String(type || ''));

export function reachFromOld(old?: string): ReachArea[] {
  const v = OLD_REACH[String(old || '')];
  return v ? [v as ReachArea] : [];
}
/** The chosen areas; the old single answer counts when no area is chosen. */
export function reachAreasOf(profile: Profile): ReachArea[] {
  const list = (Array.isArray(profile?.reachAreas) ? profile!.reachAreas : []).filter((a: string) => (REACH_AREAS as readonly string[]).includes(a));
  return list.length ? Array.from(new Set(list)) as ReachArea[] : reachFromOld(profile?.geographicReach);
}
/** '' is Everyone (also the old 'both_equally'). */
export function genderValueOf(profile: Profile): string {
  const g = String(profile?.targetGender || '');
  const v = g in OLD_GENDERS ? OLD_GENDERS[g] : g;
  return (GENDERS as readonly string[]).includes(v) ? v : '';
}

const squash = (s: string) => s.replace(/\s*\/\s*/g, '/').trim();
/** The list value for a saved industry (old spellings mapped), or '' when it is the owner's own words. */
export function industryValueFor(current?: string): string {
  const c = String(current || '').trim();
  if (!c) return '';
  const aliased = INDUSTRY_ALIASES[c] || c;
  return INDUSTRIES.find((x) => squash(x) === squash(aliased)) || '';
}
/** True when the saved industry is "Other" or the owner's own words. */
export function isOtherIndustry(current?: string): boolean {
  const c = String(current || '').trim();
  return Boolean(c) && (c === OTHER_INDUSTRY || !industryValueFor(c));
}

/** 'tamil_english_mix' to { base: 'tamil', mix: true }. */
export function languageParts(value?: string): { base: string; mix: boolean } {
  const v = String(value || '').trim().toLowerCase();
  return v.endsWith(MIX_SUFFIX) ? { base: v.slice(0, -MIX_SUFFIX.length), mix: true } : { base: v, mix: false };
}
export function languageValue(base: string, mix: boolean): string {
  return mix && base && base !== 'english' ? `${base}${MIX_SUFFIX}` : base;
}

export function toggleIn<T>(list: T[] | undefined, value: T): T[] {
  const cur = Array.isArray(list) ? list : [];
  return cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value];
}
/** Brand voice is saved as text or a list; the tiles work on a list. */
export function voiceList(v: string | string[] | undefined): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  return String(v || '').split(',').map((x) => x.trim()).filter(Boolean);
}
/** A suggestion (for example from the website reading) as the matching choice, or '' when it matches none. */
export function matchChoice(value: unknown, choices: readonly string[]): string {
  const k = String(value || '').toLowerCase().replace(/[^a-z]/g, '');
  return choices.find((c) => c.toLowerCase().replace(/[^a-z]/g, '') === k) || '';
}
