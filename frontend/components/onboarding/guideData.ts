/**
 * Short, plain instructions for each sign-up step, in the owner's language.
 * Words in English (Connect, Skip for now, Finish Setup) are the buttons on screen.
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
        'Type your business name, mobile number and website.',
        'Choose your business type and where you are.',
        'Not sure about something? Write a short answer. You can change it later.',
      ],
      ta: [
        'உங்கள் வணிகத்தின் பெயர், மொபைல் எண், இணையதளம் ஆகியவற்றை எழுதுங்கள்.',
        'உங்கள் வணிக வகையையும் நீங்கள் இருக்கும் இடத்தையும் தேர்ந்தெடுங்கள்.',
        'தெரியாததைச் சுருக்கமாக எழுதுங்கள். பிறகு மாற்றிக்கொள்ளலாம்.',
      ],
      hi: [
        'अपने बिज़नेस का नाम, मोबाइल नंबर और वेबसाइट लिखें।',
        'बिज़नेस का प्रकार और अपनी जगह चुनें।',
        'कुछ पता न हो तो छोटा सा जवाब लिखें। बाद में बदल सकते हैं।',
      ],
    },
  },
  2: {
    title: { en: 'Step 2: Your customers', ta: 'படி 2: உங்கள் வாடிக்கையாளர்கள்', hi: 'स्टेप 2: आपके ग्राहक' },
    lines: {
      en: [
        'Write the product or service you sell the most.',
        'Say who buys from you: age, place, what they like.',
        'Choose men or women, how far you sell, and the type of customer.',
      ],
      ta: [
        'நீங்கள் அதிகம் விற்கும் பொருள் அல்லது சேவையை எழுதுங்கள்.',
        'உங்களிடம் யார் வாங்குகிறார்கள் என்று எழுதுங்கள்: வயது, ஊர், விருப்பம்.',
        'ஆண் அல்லது பெண், எவ்வளவு தூரம் விற்கிறீர்கள், வாடிக்கையாளர் வகை ஆகியவற்றைத் தேர்ந்தெடுங்கள்.',
      ],
      hi: [
        'जो चीज़ या सेवा सबसे ज़्यादा बिकती है, उसे लिखें।',
        'बताएँ कि आपसे कौन खरीदता है: उम्र, जगह, पसंद।',
        'पुरुष या महिला, कितनी दूर तक बेचते हैं और ग्राहक का प्रकार चुनें।',
      ],
    },
  },
  3: {
    title: { en: 'Step 3: Your goals', ta: 'படி 3: உங்கள் இலக்குகள்', hi: 'स्टेप 3: आपके लक्ष्य' },
    lines: {
      en: [
        'Pick what you want most: more customers, more followers, more enquiries.',
        'Choose your price type and write what makes you different.',
        'Choose the language for your posts, and list a few ideas for the first month.',
      ],
      ta: [
        'உங்களுக்கு மிகவும் வேண்டியதைத் தேர்ந்தெடுங்கள்: அதிக வாடிக்கையாளர்கள், அதிகப் பின்தொடர்பவர்கள், அதிக விசாரணைகள்.',
        'உங்கள் விலை வகையைத் தேர்ந்தெடுத்து, உங்களை வேறுபடுத்துவது எது என்று எழுதுங்கள்.',
        'பதிவுகளுக்கான மொழியைத் தேர்ந்தெடுத்து, முதல் மாதத்துக்கான சில யோசனைகளை எழுதுங்கள்.',
      ],
      hi: [
        'जो सबसे ज़्यादा चाहिए वह चुनें: ज़्यादा ग्राहक, ज़्यादा फ़ॉलोअर, ज़्यादा पूछताछ।',
        'अपनी कीमत का स्तर चुनें और लिखें कि आप दूसरों से अलग कैसे हैं।',
        'पोस्ट की भाषा चुनें और पहले महीने के लिए कुछ आइडिया लिखें।',
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
        'Instagram அல்லது Facebook அருகில் உள்ள Connect பொத்தானை அழுத்தி அனுமதி கொடுங்கள்.',
        'இப்போது வேண்டாமா? Skip for now அழுத்துங்கள். பிறகு இணைக்கலாம்.',
        'கடைசியில் Finish Setup அழுத்துங்கள்.',
      ],
      hi: [
        'Instagram या Facebook के आगे Connect दबाएँ और अनुमति दें।',
        'अभी नहीं करना? Skip for now दबाएँ। बाद में जोड़ सकते हैं।',
        'आख़िर में Finish Setup दबाएँ।',
      ],
    },
  },
};

/** Video guides, by step and language. Empty until the videos are made. */
export const GUIDE_VIDEOS: Partial<Record<number, Partial<Record<GuideLang, string>>>> = {
  // 1: { en: '/assets/guides/step1-en.mp4', ta: '/assets/guides/step1-ta.mp4', hi: '/assets/guides/step1-hi.mp4' },
};
