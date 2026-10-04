/**
 * Short, plain instructions for each sign-up step, in the owner's language.
 * Button names in each language are the same words the buttons show on screen
 * (onboardingStrings.ts); a test keeps them in step.
 *
 * To add a video guide for a step, put the file in public/assets/guides/ and add
 * it to GUIDE_VIDEOS below. When a video exists for the step and language, it
 * shows instead of these lines.
 */
export type GuideLang = 'en' | 'ta' | 'hi';

export const GUIDE_LANGS: { id: GuideLang; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'ta', label: 'தமிழ்' },
  { id: 'hi', label: 'हिन्दी' },
];

export interface GuideStep {
  title: Record<GuideLang, string>;
  lines: Record<GuideLang, string[]>;
}

export const GUIDE_STEPS: Record<number, GuideStep> = {
  1: {
    title: { en: 'Step 1: About your business', ta: 'படி 1: உங்கள் வணிகம்', hi: 'स्टेप 1: आपका बिज़नेस' },
    lines: {
      en: [
        'Type your business name and mobile number.',
        'Have a website? Add it and press Analyze. We fill in the rest for you.',
        'Choose your type of business and your city.',
      ],
      ta: [
        'உங்கள் வணிகத்தின் பெயரையும் மொபைல் எண்ணையும் எழுதுங்கள்.',
        'இணையதளம் இருந்தால் சேர்த்து ‘ஆய்வு செய்யுங்கள்’ பொத்தானை அழுத்துங்கள். மீதியை நாங்கள் நிரப்புவோம்.',
        'உங்கள் வணிக வகையையும் ஊரையும் தேர்ந்தெடுங்கள்.',
      ],
      hi: [
        'अपने बिज़नेस का नाम और मोबाइल नंबर लिखें।',
        'वेबसाइट है? उसे जोड़कर ‘जाँचें’ दबाएँ। बाकी हम भर देंगे।',
        'बिज़नेस का प्रकार और अपना शहर चुनें।',
      ],
    },
  },
  2: {
    title: { en: 'Step 2: Your customers', ta: 'படி 2: உங்கள் வாடிக்கையாளர்கள்', hi: 'स्टेप 2: आपके ग्राहक' },
    lines: {
      en: [
        'Write what you sell the most.',
        'Say who buys from you, for example families, women 25 to 45, or shop owners.',
        'Pick the style of your posts. Friendly is a good start.',
      ],
      ta: [
        'நீங்கள் அதிகம் விற்பதை எழுதுங்கள்.',
        'உங்களிடம் யார் வாங்குகிறார்கள் என்று எழுதுங்கள். எடுத்துக்காட்டு: குடும்பங்கள், 25 முதல் 45 வயது பெண்கள், கடைக்காரர்கள்.',
        'உங்கள் பதிவுகளின் பாணியைத் தேர்ந்தெடுங்கள். ‘நட்பான’ நல்ல தொடக்கம்.',
      ],
      hi: [
        'जो सबसे ज़्यादा बिकता है वह लिखें।',
        'बताएँ कि आपसे कौन खरीदता है, जैसे परिवार, 25 से 45 साल की महिलाएँ, या दुकानदार।',
        'अपनी पोस्ट का अंदाज़ चुनें। ‘दोस्ताना’ एक अच्छी शुरुआत है।',
      ],
    },
  },
  3: {
    title: { en: 'Step 3: Your goals', ta: 'படி 3: உங்கள் இலக்குகள்', hi: 'स्टेप 3: आपके लक्ष्य' },
    lines: {
      en: [
        'Pick what you want most, like more customers or more enquiries.',
        'Choose the language for your posts.',
        'The other boxes are optional. You can skip them.',
      ],
      ta: [
        'உங்களுக்கு மிகவும் வேண்டியதைத் தேர்ந்தெடுங்கள், உதாரணம்: அதிக வாடிக்கையாளர்கள் அல்லது அதிக விசாரணைகள்.',
        'பதிவுகளுக்கான மொழியைத் தேர்ந்தெடுங்கள்.',
        'மற்ற பெட்டிகள் விருப்பமானவை. விட்டுவிடலாம்.',
      ],
      hi: [
        'जो सबसे ज़्यादा चाहिए वह चुनें, जैसे ज़्यादा ग्राहक या ज़्यादा पूछताछ।',
        'पोस्ट की भाषा चुनें।',
        'बाकी बॉक्स वैकल्पिक हैं। चाहें तो छोड़ दें।',
      ],
    },
  },
  4: {
    title: { en: 'Step 4: Connect your pages', ta: 'படி 4: உங்கள் பக்கங்களை இணையுங்கள்', hi: 'स्टेप 4: अपने पेज जोड़ें' },
    lines: {
      en: [
        'Press Connect next to Instagram or Facebook and allow access.',
        'Not ready? Press Skip for now. You can do this later.',
        'At the end, press Finish Setup.',
      ],
      ta: [
        'Instagram அல்லது Facebook அருகில் உள்ள ‘இணையுங்கள்’ பொத்தானை அழுத்தி அனுமதி கொடுங்கள்.',
        'இப்போது வேண்டாமா? ‘இப்போது வேண்டாம்’ பொத்தானை அழுத்துங்கள். பிறகு இணைக்கலாம்.',
        'கடைசியில் ‘அமைப்பை முடியுங்கள்’ பொத்தானை அழுத்துங்கள்.',
      ],
      hi: [
        'Instagram या Facebook के आगे ‘जोड़ें’ दबाएँ और अनुमति दें।',
        'अभी नहीं करना? ‘अभी छोड़ें’ दबाएँ। बाद में जोड़ सकते हैं।',
        'आख़िर में ‘सेटअप पूरा करें’ दबाएँ।',
      ],
    },
  },
};

/** Video guides, by step and language. Empty until the videos are made. */
export const GUIDE_VIDEOS: Partial<Record<number, Partial<Record<GuideLang, string>>>> = {
  // 1: { en: '/assets/guides/step1-en.mp4', ta: '/assets/guides/step1-ta.mp4', hi: '/assets/guides/step1-hi.mp4' },
};
