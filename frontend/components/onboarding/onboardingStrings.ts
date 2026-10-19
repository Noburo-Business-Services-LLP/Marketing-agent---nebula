/**
 * Every word a person reads in the sign-up questions, in English, Tamil and Hindi.
 * Same pattern as guideData.ts: one language switcher drives both.
 *
 * Rules for editing:
 *  - Only the words on screen change with language. The VALUES saved on the
 *    profile and sent to the server stay in English (see the *_VALUES lists
 *    below). A label can be re-worded freely; a value must never be.
 *  - {name} marks a place filled in by the page, for example {step} or {platform}.
 *    Every language must use the same {names} as English.
 *  - Product words (Nebulaa, Instagram, Quarks, WhatsApp, Hero video) and
 *    numbers stay as they are written in English.
 *
 * This file imports nothing at run time, so the tests can load it directly.
 */
export type OnboardingLang = 'en' | 'ta' | 'hi';

export const ONBOARDING_LANGS: OnboardingLang[] = ['en', 'ta', 'hi'];

/* ---------- Values saved on the profile. English, always. ---------- */

// The questionnaire's own values and words (industry, who you sell to, where, voice, goals, language) live in
// constants/businessQuestions.ts, shared with Settings. Only the sign-up page's own words are here.

export const ACCOUNT_KIND_VALUES = ['one', 'several'] as const;

/** Must match frontend/constants/languages.ts (a test checks it). */
export const CONTENT_LANGUAGE_BASES = [
  'english', 'tamil', 'telugu', 'hindi', 'kannada', 'malayalam', 'marathi', 'bengali',
  'gujarati', 'punjabi', 'odia', 'urdu',
] as const;

/* ---------- Shape of one language ---------- */

export interface OnboardingStrings {
  // Page
  back: string;
  title: string;
  subtitle: string;
  progressLabel: string;          // {step} {total}
  stepNames: [string, string, string, string];
  // Shared
  optional: string;
  languageSwitcher: string;
  continue: string;
  skipForNow: string;
  finishSetup: string;
  finalizing: string;
  connect: string;
  connecting: string;
  disconnect: string;
  add: string;
  cancel: string;
  // Step 1
  step1Heading: string;
  businessName: string;
  businessNamePlaceholder: string;
  mobile: string;
  mobilePlaceholder: string;
  website: string;
  websitePlaceholder: string;
  analyze: string;
  websiteAnalyzedInline: string;
  websiteHint: string;
  city: string;
  cityPlaceholder: string;
  cityHint: string;
  // Step 2
  step2Heading: string;
  heroProduct: string;
  heroProductPlaceholder: string;
  heroProductHint: string;
  whoBuys: string;
  whoBuysPlaceholder: string;
  accountKindQuestion: string;
  // Step 3
  step3Heading: string;
  competitors: string;
  competitorsHint: string;
  discoveryTitle: string;
  discoveryBody: string;          // {location}
  discoveryLocationFallback: string;
  competitorsPlaceholder: string;
  differentiator: string;
  differentiatorPlaceholder: string;
  differentiatorHint: string;
  additionalLanguages: string;
  additionalLanguagesHint: string;
  additionalLanguagesFull: string;
  restrictions: string;
  restrictionsPlaceholder: string;
  upcoming: string;
  upcomingPlaceholder: string;
  upcomingHint: string;
  // Step 4
  step4Heading: string;
  freeConnectNote: string;
  connectIntro: string;
  connectOptional: string;
  connectedCount: string;         // {n}
  // Duplicate account window
  dupTitle: string;
  dupBody: string;                // {fields} {email}
  dupBodyNoEmail: string;         // {fields}
  dupQuestion: string;
  dupSwitch: string;
  // Messages
  errName: string;
  errMobile: string;
  errIndustry: string;
  errCity: string;
  errHero: string;
  errWhoBuys: string;
  errSellsTo: string;
  errGoal: string;
  errPostLanguage: string;
  errVerify: string;
  errSave: string;
  websiteAnalyzedToast: string;
  websiteInvalid: string;
  websiteCouldNotAnalyze: string;
  websiteNoServer: string;
  connectedToast: string;         // {platform}
  connectedToastAccount: string;  // {platform} {account}
  disconnectedToast: string;      // {platform}
  disconnectFailed: string;       // {platform}
  connectStartFailed: string;     // {platform}
  connectFailedPlatform: string;  // {platform}
  oauthFailed: string;
  oauthDenied: string;
  oauthNoChannel: string;
  oauthTokenFailed: string;
  oauthSessionExpired: string;
  // Beside the form: the pictures of finished posts
  showcaseMadeWith: string;
  showcaseHeadlineA: string;
  showcaseHeadlineB: string;
  showcaseAria: string;
  showcaseChoose: string;
  showcaseShowPost: string;       // {n}
  showcasePostAlt: string;        // {label}
  showcaseBannerPrefix: string;
  showcaseLabels: Record<string, string>;
  // Choices (keys are the English values above)
  accountKindLabels: Record<(typeof ACCOUNT_KIND_VALUES)[number], string>;
  languageNames: Record<(typeof CONTENT_LANGUAGE_BASES)[number], string>;
  languageMix: string;            // {lang}
}

/* ---------- English ---------- */

const en: OnboardingStrings = {
  back: 'Back',
  title: "Let's set up your business",
  subtitle: 'A few simple questions. It takes about 2 minutes.',
  progressLabel: 'Step {step} of {total}',
  stepNames: ['Identity', 'Audience', 'Strategy', 'Connect'],
  optional: '(optional)',
  languageSwitcher: 'Language',
  continue: 'Continue',
  skipForNow: 'Skip for now',
  finishSetup: 'Finish Setup',
  finalizing: 'Finalizing...',
  connect: 'Connect',
  connecting: 'Connecting...',
  disconnect: 'Disconnect',
  add: 'Add',
  cancel: 'Cancel',

  step1Heading: 'About your business',
  businessName: 'Business name',
  businessNamePlaceholder: 'e.g. Nebulaa Corp',
  mobile: 'Mobile Number',
  mobilePlaceholder: 'e.g. +91 98765 43210',
  website: 'Website',
  websitePlaceholder: 'e.g. nike.com or https://nike.com',
  analyze: 'Analyze',
  websiteAnalyzedInline: 'Website analyzed. The form is filled in with what we found.',
  websiteHint: 'Enter your website URL and click Analyze to auto-fill your business details',
  city: 'City or town',
  cityPlaceholder: 'e.g. Cuddalore, Tamil Nadu',
  cityHint: 'Enter the city/region where your business primarily operates',

  step2Heading: 'Your customers',
  heroProduct: 'What do you sell most?',
  heroProductPlaceholder: 'e.g. Masala powders, bridal gold sets, family meals',
  heroProductHint: 'Your best-known product or service. Keep it short.',
  whoBuys: 'Who buys from you?',
  whoBuysPlaceholder: 'e.g. Families in Cuddalore, women 25 to 45, small shop owners',
  accountKindQuestion: 'Do you run one business or manage several brands for clients?',

  step3Heading: 'Your goals and your voice',
  competitors: 'Your Competitors',
  competitorsHint: "Add specific competitors you'd like to track, or skip this. Nebulaa will automatically discover competitors based on your business and location.",
  discoveryTitle: 'AI-Powered Discovery:',
  discoveryBody: "We'll automatically find and track your top competitors in {location} based on your industry and target audience.",
  discoveryLocationFallback: 'your location',
  competitorsPlaceholder: 'e.g. Nike, Adidas, Puma',
  differentiator: 'What makes you different?',
  differentiatorPlaceholder: 'e.g. 25 years of family craftsmanship',
  differentiatorHint: 'One line. Why should someone choose you?',
  additionalLanguages: 'Also post in',
  additionalLanguagesHint: 'Optional. Choose up to three more languages. You can turn any post into these languages later.',
  additionalLanguagesFull: 'Three languages are chosen. Remove one to choose another.',
  restrictions: 'Anything we should not post?',
  restrictionsPlaceholder: 'e.g. No political posts. No photos of staff.',
  upcoming: 'Anything coming up in the next 30 days?',
  upcomingPlaceholder: 'e.g. Diwali sale, new collection, grand opening',
  upcomingHint: 'A festival, an offer or a new product. We will plan posts around it.',

  step4Heading: 'Connect Your Accounts',
  freeConnectNote: 'Connecting your social media accounts comes with the Publish and schedule add-on, which you can add to a Starter or Growth plan at any time. You can continue without connecting an account.',
  connectIntro: 'Link your social media accounts to enable seamless publishing and analytics.',
  connectOptional: 'This step is optional.',
  connectedCount: '{n} account(s) connected',

  dupTitle: 'Account Already Exists',
  dupBody: 'A business with the same {fields} is already registered under {email}.',
  dupBodyNoEmail: 'A business with the same {fields} is already registered.',
  dupQuestion: 'Would you like to switch to that account?',
  dupSwitch: 'Switch Account',

  errName: 'Please enter your business name.',
  errMobile: 'Please enter your mobile number.',
  errIndustry: 'Please choose your type of business.',
  errCity: 'Please enter your city or town.',
  errHero: 'Please tell us what you sell most.',
  errWhoBuys: 'Please tell us who buys from you.',
  errSellsTo: 'Please choose who you sell to.',
  errGoal: 'Please pick at least one thing you want most.',
  errPostLanguage: 'Please choose the language for your posts.',
  errVerify: 'Could not verify business details. Please try again.',
  errSave: 'Failed to save data. Please try again.',
  websiteAnalyzedToast: 'Website analyzed. Fields have been filled in.',
  websiteInvalid: 'Invalid URL',
  websiteCouldNotAnalyze: 'Could not analyze website',
  websiteNoServer: 'Could not connect to server',
  connectedToast: '{platform} connected successfully.',
  connectedToastAccount: '{platform} ({account}) connected successfully.',
  disconnectedToast: '{platform} disconnected successfully.',
  disconnectFailed: 'Failed to disconnect {platform}.',
  connectStartFailed: 'Failed to initiate {platform} connection.',
  connectFailedPlatform: 'Failed to connect to {platform}.',
  oauthFailed: 'Failed to connect account.',
  oauthDenied: 'You denied access to your account.',
  oauthNoChannel: 'No channel found for this account.',
  oauthTokenFailed: 'Failed to authenticate. Please try again.',
  oauthSessionExpired: 'Authentication session expired. Please try again.',

  showcaseMadeWith: 'Made with Nebulaa',
  showcaseHeadlineA: 'Posts like these,',
  showcaseHeadlineB: 'for your business.',
  showcaseAria: 'Posts made with Nebulaa',
  showcaseChoose: 'Choose a post',
  showcaseShowPost: 'Show post {n}',
  showcasePostAlt: 'A {label} post made with Nebulaa',
  showcaseBannerPrefix: 'Made with Nebulaa',
  showcaseLabels: {
    'Hotels & stays': 'Hotels & stays',
    'Jewellery & retail': 'Jewellery & retail',
    'Textiles & apparel': 'Textiles & apparel',
    'Food & FMCG': 'Food & FMCG',
    'Real estate': 'Real estate',
    'Automobiles': 'Automobiles',
    'Financial services': 'Financial services',
    'Furniture & appliances': 'Furniture & appliances',
    'Industrial & B2B': 'Industrial & B2B',
  },

  accountKindLabels: { one: 'One business', several: 'Several brands for clients' },
  languageNames: {
    english: 'English', tamil: 'Tamil', telugu: 'Telugu', hindi: 'Hindi', kannada: 'Kannada',
    malayalam: 'Malayalam', marathi: 'Marathi', bengali: 'Bengali', gujarati: 'Gujarati',
    punjabi: 'Punjabi', odia: 'Odia', urdu: 'Urdu',
  },
  languageMix: '{lang} + English mix',
};

/* ---------- Tamil ---------- */

const ta: OnboardingStrings = {
  back: 'பின்செல்',
  title: 'உங்கள் வணிகத்தை அமைப்போம்',
  subtitle: 'சில எளிய கேள்விகள். சுமார் 2 நிமிடங்கள் ஆகும்.',
  progressLabel: 'படி {step} / {total}',
  stepNames: ['அடையாளம்', 'வாடிக்கையாளர்', 'இலக்கு', 'இணைப்பு'],
  optional: '(விருப்பம்)',
  languageSwitcher: 'மொழி',
  continue: 'தொடருங்கள்',
  skipForNow: 'இப்போது வேண்டாம்',
  finishSetup: 'அமைப்பை முடியுங்கள்',
  finalizing: 'முடிக்கிறோம்...',
  connect: 'இணையுங்கள்',
  connecting: 'இணைக்கிறோம்...',
  disconnect: 'இணைப்பை நீக்கு',
  add: 'சேர்',
  cancel: 'ரத்து செய்',

  step1Heading: 'உங்கள் வணிகம்',
  businessName: 'வணிகத்தின் பெயர்',
  businessNamePlaceholder: 'எ.கா. Nebulaa Corp',
  mobile: 'மொபைல் எண்',
  mobilePlaceholder: 'எ.கா. +91 98765 43210',
  website: 'இணையதளம்',
  websitePlaceholder: 'எ.கா. nike.com அல்லது https://nike.com',
  analyze: 'ஆய்வு செய்யுங்கள்',
  websiteAnalyzedInline: 'இணையதளத்தை ஆய்வு செய்தோம். கிடைத்த தகவல்களால் படிவம் நிரப்பப்பட்டது.',
  websiteHint: 'உங்கள் இணையதள முகவரியை எழுதி, ஆய்வு செய்யுங்கள் என்பதை அழுத்தினால் வணிக விவரங்கள் தானாக நிரம்பும்',
  city: 'ஊர் அல்லது நகரம்',
  cityPlaceholder: 'எ.கா. கடலூர், தமிழ்நாடு',
  cityHint: 'உங்கள் வணிகம் முக்கியமாக இயங்கும் ஊரை அல்லது பகுதியை எழுதுங்கள்',

  step2Heading: 'உங்கள் வாடிக்கையாளர்கள்',
  heroProduct: 'நீங்கள் அதிகம் விற்பது என்ன?',
  heroProductPlaceholder: 'எ.கா. மசாலாப் பொடிகள், திருமணத் தங்க நகைத் தொகுப்புகள், குடும்ப உணவுகள்',
  heroProductHint: 'உங்களுக்கு மிகவும் பெயர் பெற்ற பொருள் அல்லது சேவை. சுருக்கமாக எழுதுங்கள்.',
  whoBuys: 'உங்களிடம் யார் வாங்குகிறார்கள்?',
  whoBuysPlaceholder: 'எ.கா. கடலூரில் உள்ள குடும்பங்கள், 25 முதல் 45 வயது பெண்கள், சிறு கடைக்காரர்கள்',
  accountKindQuestion: 'நீங்கள் ஒரு தொழிலை நடத்துகிறீர்களா, அல்லது வாடிக்கையாளர்களுக்காக பல பிராண்டுகளை நிர்வகிக்கிறீர்களா?',

  step3Heading: 'உங்கள் இலக்குகளும் பதிவுகளின் பாணியும்',
  competitors: 'உங்கள் போட்டியாளர்கள்',
  competitorsHint: 'கண்காணிக்க விரும்பும் போட்டியாளர்களைச் சேர்க்கலாம், அல்லது விட்டுவிடலாம். உங்கள் வணிகம் மற்றும் இடத்தின் அடிப்படையில் Nebulaa போட்டியாளர்களைத் தானாகவே கண்டறியும்.',
  discoveryTitle: 'AI மூலம் கண்டறிதல்:',
  discoveryBody: 'உங்கள் துறை மற்றும் வாடிக்கையாளர்களின் அடிப்படையில், {location} பகுதியில் உள்ள முக்கிய போட்டியாளர்களை நாங்கள் தானாகவே கண்டறிந்து கண்காணிப்போம்.',
  discoveryLocationFallback: 'உங்கள் பகுதி',
  competitorsPlaceholder: 'எ.கா. Nike, Adidas, Puma',
  differentiator: 'உங்களை வேறுபடுத்துவது எது?',
  differentiatorPlaceholder: 'எ.கா. 25 ஆண்டுகால குடும்பக் கைவினைத் திறன்',
  differentiatorHint: 'ஒரு வரி போதும். ஒருவர் ஏன் உங்களைத் தேர்ந்தெடுக்க வேண்டும்?',
  // needs a native-speaker read
  additionalLanguages: 'இந்த மொழிகளிலும் பதிவிடுங்கள்',
  additionalLanguagesHint: 'விருப்பத்திற்குரியது. மேலும் மூன்று மொழிகள் வரை தேர்ந்தெடுக்கலாம். எந்தப் பதிவையும் பின்னர் இந்த மொழிகளுக்கு மாற்றலாம்.',
  additionalLanguagesFull: 'மூன்று மொழிகள் தேர்ந்தெடுக்கப்பட்டுள்ளன. வேறொன்றைத் தேர்ந்தெடுக்க ஒன்றை நீக்கவும்.',
  restrictions: 'எதையாவது பதிவிடக் கூடாதா?',
  restrictionsPlaceholder: 'எ.கா. அரசியல் பதிவுகள் வேண்டாம். ஊழியர்களின் புகைப்படங்கள் வேண்டாம்.',
  upcoming: 'அடுத்த 30 நாட்களில் ஏதாவது நிகழ்ச்சி உண்டா?',
  upcomingPlaceholder: 'எ.கா. தீபாவளி விற்பனை, புதிய தொகுப்பு, திறப்பு விழா',
  upcomingHint: 'ஒரு பண்டிகை, ஒரு சலுகை அல்லது புதிய பொருள். அதைச் சுற்றி பதிவுகளைத் திட்டமிடுவோம்.',

  step4Heading: 'உங்கள் கணக்குகளை இணையுங்கள்',
  freeConnectNote: 'சமூக ஊடகக் கணக்குகளை இணைக்கும் வசதி, Publish and schedule கூடுதல் வசதியுடன் வருகிறது. இதை Starter அல்லது Professional திட்டத்தில் எப்போது வேண்டுமானாலும் சேர்க்கலாம். கணக்கை இணைக்காமலும் தொடரலாம்.',
  connectIntro: 'பதிவுகளை வெளியிடவும் புள்ளிவிவரங்களைப் பார்க்கவும் உங்கள் சமூக ஊடகக் கணக்குகளை இணையுங்கள்.',
  connectOptional: 'இந்தப் படி விருப்பமானது.',
  connectedCount: '{n} கணக்கு(கள்) இணைக்கப்பட்டன',

  dupTitle: 'கணக்கு ஏற்கனவே உள்ளது',
  dupBody: 'இதே {fields} கொண்ட வணிகம் {email} என்ற மின்னஞ்சலில் ஏற்கனவே பதிவு செய்யப்பட்டுள்ளது.',
  dupBodyNoEmail: 'இதே {fields} கொண்ட வணிகம் ஏற்கனவே பதிவு செய்யப்பட்டுள்ளது.',
  dupQuestion: 'அந்தக் கணக்குக்கு மாற விரும்புகிறீர்களா?',
  dupSwitch: 'கணக்கை மாற்று',

  errName: 'உங்கள் வணிகத்தின் பெயரை எழுதுங்கள்.',
  errMobile: 'உங்கள் மொபைல் எண்ணை எழுதுங்கள்.',
  errIndustry: 'உங்கள் வணிக வகையைத் தேர்ந்தெடுங்கள்.',
  errCity: 'உங்கள் ஊர் அல்லது நகரத்தை எழுதுங்கள்.',
  errHero: 'நீங்கள் அதிகம் விற்பதை எழுதுங்கள்.',
  errWhoBuys: 'உங்களிடம் யார் வாங்குகிறார்கள் என்பதை எழுதுங்கள்.',
  errSellsTo: 'நீங்கள் யாருக்கு விற்கிறீர்கள் என்பதைத் தேர்ந்தெடுங்கள்.',
  errGoal: 'உங்களுக்கு மிகவும் வேண்டியதில் குறைந்தது ஒன்றைத் தேர்ந்தெடுங்கள்.',
  errPostLanguage: 'பதிவுகளுக்கான மொழியைத் தேர்ந்தெடுங்கள்.',
  errVerify: 'வணிக விவரங்களைச் சரிபார்க்க முடியவில்லை. மீண்டும் முயலுங்கள்.',
  errSave: 'தகவலைச் சேமிக்க முடியவில்லை. மீண்டும் முயலுங்கள்.',
  websiteAnalyzedToast: 'இணையதளத்தை ஆய்வு செய்தோம். விவரங்கள் நிரப்பப்பட்டுள்ளன.',
  websiteInvalid: 'முகவரி சரியில்லை',
  websiteCouldNotAnalyze: 'இணையதளத்தை ஆய்வு செய்ய முடியவில்லை',
  websiteNoServer: 'சேவையகத்துடன் இணைக்க முடியவில்லை',
  connectedToast: '{platform} வெற்றிகரமாக இணைக்கப்பட்டது.',
  connectedToastAccount: '{platform} ({account}) வெற்றிகரமாக இணைக்கப்பட்டது.',
  disconnectedToast: '{platform} இணைப்பு நீக்கப்பட்டது.',
  disconnectFailed: '{platform} இணைப்பை நீக்க முடியவில்லை.',
  connectStartFailed: '{platform} இணைப்பைத் தொடங்க முடியவில்லை.',
  connectFailedPlatform: '{platform} உடன் இணைக்க முடியவில்லை.',
  oauthFailed: 'கணக்கை இணைக்க முடியவில்லை.',
  oauthDenied: 'உங்கள் கணக்குக்கான அனுமதியை மறுத்துவிட்டீர்கள்.',
  oauthNoChannel: 'இந்தக் கணக்கில் சேனல் எதுவும் இல்லை.',
  oauthTokenFailed: 'சரிபார்க்க முடியவில்லை. மீண்டும் முயலுங்கள்.',
  oauthSessionExpired: 'சரிபார்ப்பு நேரம் முடிந்துவிட்டது. மீண்டும் முயலுங்கள்.',

  showcaseMadeWith: 'Nebulaa மூலம் உருவானவை',
  showcaseHeadlineA: 'இது போன்ற பதிவுகள்,',
  showcaseHeadlineB: 'உங்கள் வணிகத்துக்காக.',
  showcaseAria: 'Nebulaa மூலம் உருவான பதிவுகள்',
  showcaseChoose: 'ஒரு பதிவைத் தேர்ந்தெடுங்கள்',
  showcaseShowPost: 'பதிவு {n} ஐக் காட்டு',
  showcasePostAlt: 'Nebulaa மூலம் உருவான {label} பதிவு',
  showcaseBannerPrefix: 'Nebulaa மூலம் உருவானவை',
  showcaseLabels: {
    'Hotels & stays': 'ஹோட்டல்கள் & தங்குமிடங்கள்',
    'Jewellery & retail': 'நகைகள் & சில்லறை விற்பனை',
    'Textiles & apparel': 'ஜவுளி & ஆடைகள்',
    'Food & FMCG': 'உணவு & FMCG',
    'Real estate': 'ரியல் எஸ்டேட்',
    'Automobiles': 'வாகனங்கள்',
    'Financial services': 'நிதிச் சேவைகள்',
    'Furniture & appliances': 'மரச்சாமான்கள் & சாதனங்கள்',
    'Industrial & B2B': 'தொழிற்சாலை & B2B',
  },

  accountKindLabels: { one: 'ஒரு தொழில்', several: 'வாடிக்கையாளர்களுக்கான பல பிராண்டுகள்' },
  languageNames: {
    english: 'ஆங்கிலம்', tamil: 'தமிழ்', telugu: 'தெலுங்கு', hindi: 'இந்தி', kannada: 'கன்னடம்',
    malayalam: 'மலையாளம்', marathi: 'மராத்தி', bengali: 'வங்காளம்', gujarati: 'குஜராத்தி',
    punjabi: 'பஞ்சாபி', odia: 'ஒடியா', urdu: 'உருது',
  },
  languageMix: '{lang} + ஆங்கிலம் கலந்தது',
};

/* ---------- Hindi ---------- */

const hi: OnboardingStrings = {
  back: 'वापस',
  title: 'आइए आपका बिज़नेस सेट करें',
  subtitle: 'कुछ आसान सवाल। लगभग 2 मिनट लगेंगे।',
  progressLabel: 'स्टेप {step} / {total}',
  stepNames: ['पहचान', 'ग्राहक', 'लक्ष्य', 'कनेक्ट'],
  optional: '(वैकल्पिक)',
  languageSwitcher: 'भाषा',
  continue: 'आगे बढ़ें',
  skipForNow: 'अभी छोड़ें',
  finishSetup: 'सेटअप पूरा करें',
  finalizing: 'पूरा कर रहे हैं...',
  connect: 'जोड़ें',
  connecting: 'जोड़ रहे हैं...',
  disconnect: 'हटाएँ',
  add: 'जोड़ें',
  cancel: 'रद्द करें',

  step1Heading: 'आपका बिज़नेस',
  businessName: 'बिज़नेस का नाम',
  businessNamePlaceholder: 'जैसे: Nebulaa Corp',
  mobile: 'मोबाइल नंबर',
  mobilePlaceholder: 'जैसे: +91 98765 43210',
  website: 'वेबसाइट',
  websitePlaceholder: 'जैसे: nike.com या https://nike.com',
  analyze: 'जाँचें',
  websiteAnalyzedInline: 'वेबसाइट जाँच ली गई। जो जानकारी मिली, उससे फ़ॉर्म भर दिया गया है।',
  websiteHint: 'अपनी वेबसाइट का पता लिखें और जाँचें दबाएँ। बिज़नेस की जानकारी अपने आप भर जाएगी',
  city: 'शहर या कस्बा',
  cityPlaceholder: 'जैसे: कुड्डालोर, तमिलनाडु',
  cityHint: 'वह शहर या इलाक़ा लिखें जहाँ आपका बिज़नेस मुख्य रूप से चलता है',

  step2Heading: 'आपके ग्राहक',
  heroProduct: 'आप सबसे ज़्यादा क्या बेचते हैं?',
  heroProductPlaceholder: 'जैसे: मसाला पाउडर, दुल्हन के सोने के सेट, फ़ैमिली मील',
  heroProductHint: 'आपका सबसे जाना-पहचाना प्रोडक्ट या सेवा। छोटा लिखें।',
  whoBuys: 'आपसे कौन खरीदता है?',
  whoBuysPlaceholder: 'जैसे: कुड्डालोर के परिवार, 25 से 45 साल की महिलाएँ, छोटे दुकानदार',
  accountKindQuestion: 'क्या आप एक व्यवसाय चलाते हैं या ग्राहकों के लिए कई ब्रांड संभालते हैं?',

  step3Heading: 'आपके लक्ष्य और पोस्ट का अंदाज़',
  competitors: 'आपके प्रतिस्पर्धी',
  competitorsHint: 'जिन प्रतिस्पर्धियों पर नज़र रखनी है, उन्हें जोड़ें, या इसे छोड़ दें। आपके बिज़नेस और जगह के आधार पर Nebulaa प्रतिस्पर्धियों को अपने आप ढूँढ लेगा।',
  discoveryTitle: 'AI से खोज:',
  discoveryBody: 'आपके क्षेत्र और ग्राहकों के आधार पर, हम {location} में आपके मुख्य प्रतिस्पर्धियों को अपने आप ढूँढेंगे और उन पर नज़र रखेंगे।',
  discoveryLocationFallback: 'आपके इलाक़े',
  competitorsPlaceholder: 'जैसे: Nike, Adidas, Puma',
  differentiator: 'आपको अलग क्या बनाता है?',
  differentiatorPlaceholder: 'जैसे: 25 साल की पारिवारिक कारीगरी',
  differentiatorHint: 'एक पंक्ति काफ़ी है। कोई आपको क्यों चुने?',
  // needs a native-speaker read
  additionalLanguages: 'इन भाषाओं में भी पोस्ट करें',
  additionalLanguagesHint: 'वैकल्पिक। तीन तक और भाषाएँ चुन सकते हैं। आप किसी भी पोस्ट को बाद में इन भाषाओं में बदल सकते हैं।',
  additionalLanguagesFull: 'तीन भाषाएँ चुनी जा चुकी हैं। दूसरी चुनने के लिए एक हटाएँ।',
  restrictions: 'क्या कुछ ऐसा है जो हमें पोस्ट नहीं करना है?',
  restrictionsPlaceholder: 'जैसे: राजनीतिक पोस्ट नहीं। स्टाफ़ की फ़ोटो नहीं।',
  upcoming: 'अगले 30 दिनों में कुछ ख़ास है?',
  upcomingPlaceholder: 'जैसे: दिवाली सेल, नया कलेक्शन, भव्य उद्घाटन',
  upcomingHint: 'कोई त्योहार, ऑफ़र या नया प्रोडक्ट। हम उसके आसपास पोस्ट की योजना बनाएँगे।',

  step4Heading: 'अपने अकाउंट जोड़ें',
  freeConnectNote: 'सोशल मीडिया अकाउंट जोड़ने की सुविधा Publish and schedule ऐड-ऑन के साथ आती है। इसे आप Starter या Professional प्लान में कभी भी जोड़ सकते हैं। अकाउंट जोड़े बिना भी आप आगे बढ़ सकते हैं।',
  connectIntro: 'पोस्ट प्रकाशित करने और आँकड़े देखने के लिए अपने सोशल मीडिया अकाउंट जोड़ें।',
  connectOptional: 'यह स्टेप वैकल्पिक है।',
  connectedCount: '{n} अकाउंट जुड़े',

  dupTitle: 'अकाउंट पहले से मौजूद है',
  dupBody: 'यही {fields} वाला बिज़नेस {email} के नाम से पहले ही रजिस्टर है।',
  dupBodyNoEmail: 'यही {fields} वाला बिज़नेस पहले ही रजिस्टर है।',
  dupQuestion: 'क्या आप उस अकाउंट पर जाना चाहेंगे?',
  dupSwitch: 'अकाउंट बदलें',

  errName: 'कृपया अपने बिज़नेस का नाम लिखें।',
  errMobile: 'कृपया अपना मोबाइल नंबर लिखें।',
  errIndustry: 'कृपया बिज़नेस का प्रकार चुनें।',
  errCity: 'कृपया अपना शहर या कस्बा लिखें।',
  errHero: 'कृपया बताएँ कि आप सबसे ज़्यादा क्या बेचते हैं।',
  errWhoBuys: 'कृपया बताएँ कि आपसे कौन खरीदता है।',
  errSellsTo: 'कृपया चुनें कि आप किसे बेचते हैं।',
  errGoal: 'कृपया जो सबसे ज़्यादा चाहिए, उसमें से कम से कम एक चुनें।',
  errPostLanguage: 'कृपया पोस्ट की भाषा चुनें।',
  errVerify: 'बिज़नेस की जानकारी जाँची नहीं जा सकी। कृपया फिर से कोशिश करें।',
  errSave: 'जानकारी सेव नहीं हो सकी। कृपया फिर से कोशिश करें।',
  websiteAnalyzedToast: 'वेबसाइट जाँच ली गई। जानकारी भर दी गई है।',
  websiteInvalid: 'पता सही नहीं है',
  websiteCouldNotAnalyze: 'वेबसाइट जाँची नहीं जा सकी',
  websiteNoServer: 'सर्वर से जुड़ नहीं सके',
  connectedToast: '{platform} सफलतापूर्वक जुड़ गया।',
  connectedToastAccount: '{platform} ({account}) सफलतापूर्वक जुड़ गया।',
  disconnectedToast: '{platform} हटा दिया गया।',
  disconnectFailed: '{platform} हटाया नहीं जा सका।',
  connectStartFailed: '{platform} से जुड़ना शुरू नहीं हो सका।',
  connectFailedPlatform: '{platform} से जुड़ नहीं सके।',
  oauthFailed: 'अकाउंट जुड़ नहीं सका।',
  oauthDenied: 'आपने अकाउंट की अनुमति नहीं दी।',
  oauthNoChannel: 'इस अकाउंट में कोई चैनल नहीं मिला।',
  oauthTokenFailed: 'पहचान की पुष्टि नहीं हो सकी। कृपया फिर से कोशिश करें।',
  oauthSessionExpired: 'पुष्टि का समय समाप्त हो गया। कृपया फिर से कोशिश करें।',

  showcaseMadeWith: 'Nebulaa से बनी पोस्ट',
  showcaseHeadlineA: 'ऐसी पोस्ट,',
  showcaseHeadlineB: 'आपके बिज़नेस के लिए।',
  showcaseAria: 'Nebulaa से बनी पोस्ट',
  showcaseChoose: 'एक पोस्ट चुनें',
  showcaseShowPost: 'पोस्ट {n} दिखाएँ',
  showcasePostAlt: 'Nebulaa से बनी {label} की पोस्ट',
  showcaseBannerPrefix: 'Nebulaa से बनी',
  showcaseLabels: {
    'Hotels & stays': 'होटल और ठहरने की जगहें',
    'Jewellery & retail': 'ज्वैलरी और रिटेल',
    'Textiles & apparel': 'कपड़ा और परिधान',
    'Food & FMCG': 'फ़ूड और FMCG',
    'Real estate': 'रियल एस्टेट',
    'Automobiles': 'ऑटोमोबाइल',
    'Financial services': 'वित्तीय सेवाएँ',
    'Furniture & appliances': 'फ़र्नीचर और उपकरण',
    'Industrial & B2B': 'इंडस्ट्रियल और B2B',
  },

  accountKindLabels: { one: 'एक व्यवसाय', several: 'ग्राहकों के कई ब्रांड' },
  languageNames: {
    english: 'अंग्रेज़ी', tamil: 'तमिल', telugu: 'तेलुगु', hindi: 'हिन्दी', kannada: 'कन्नड़',
    malayalam: 'मलयालम', marathi: 'मराठी', bengali: 'बंगाली', gujarati: 'गुजराती',
    punjabi: 'पंजाबी', odia: 'ओड़िया', urdu: 'उर्दू',
  },
  languageMix: '{lang} और अंग्रेज़ी मिक्स',
};

export const ONBOARDING_STRINGS: Record<OnboardingLang, OnboardingStrings> = { en, ta, hi };

/* ---------- Helpers ---------- */

/** Fills {name} places. A place with no value is left as it is. */
export function fillTemplate(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/** Splits a template into plain pieces and filled places, so a page can make some of them bold. */
export function splitTemplate(template: string, vars: Record<string, string | number>): { text: string; filled: boolean }[] {
  return template
    .split(/(\{\w+\})/g)
    .filter(Boolean)
    .map((part) => {
      const m = /^\{(\w+)\}$/.exec(part);
      return m && m[1] in vars ? { text: String(vars[m[1]]), filled: true } : { text: part, filled: false };
    });
}

export interface Choice { value: string; label: string }

/** The choices shown for a language. The `value` is the same in every language. */
export function getChoices(lang: OnboardingLang) {
  const s = ONBOARDING_STRINGS[lang];
  return {
    accountKinds: ACCOUNT_KIND_VALUES.map((value): Choice => ({ value, label: s.accountKindLabels[value] })),
    baseLanguageNames: s.languageNames as Record<string, string>,
  };
}
