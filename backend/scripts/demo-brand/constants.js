'use strict';
/**
 * Every fact about the demo brand in ONE place (decisions D110 and D111: the owner can rename the brand or change a product here).
 * Zaya Naturals is fictional: a Chennai direct-to-consumer, ayurveda-inspired skincare and haircare brand.
 * The competitors are fictional too. Nothing here names a real person, brand or account.
 */

const BRAND = Object.freeze({
  name: 'Zaya Naturals',
  slug: 'zaya',
  tagline: 'Skin care that remembers where it came from.',
  promise: 'Clean, not clinical.',
  city: 'Chennai, Tamil Nadu',
  founded: 2022,
  // A reserved example domain: never a real website.
  website: 'https://zayanaturals.example',
  founder: { firstName: 'Aanya', lastName: 'Raghavan', role: 'Founder' },
  description: 'Zaya Naturals makes ayurveda-inspired skincare and haircare in small batches in Chennai: kumkumadi, saffron, neem, rose and hibiscus, '
    + 'blended the way grandmothers did, tested the way dermatologists want. Sold on our own website and on the big marketplaces.',
  problemSolved: 'Women who want the rituals they grew up with, without heavy fragrance, harsh chemicals or guesswork about what is inside.',
  niche: 'Ayurveda-inspired skincare and haircare',
  heroProduct: 'Kumkumadi Glow Serum',
  targetAudience: 'Women 22 to 38 in metro India who care about ingredients, plus a small unisex line for men',
  targetCustomerProfile: 'Working women in Chennai, Bengaluru, Mumbai and Delhi who read labels, follow skin creators, and buy online two or three times a month.',
  keyDifferentiator: 'Traditional ayurvedic recipes in clean, fragrance-light formulas, with every ingredient and its source on the label.',
  brandStory: 'Aanya grew up watching her paati make kumkumadi oil in a brass pot. In 2022 she turned those recipes into a small Chennai studio, '
    + 'with a chemist friend checking every batch. Today Zaya ships across India, still poured and labelled by hand.',
  voice: 'Warm, knowledgeable and honest, a little poetic. English with light Tamil touches (paati, azhagu, vanakkam).',
  contentRestrictions: 'No medical claims (no "cures", no "treats acne"). No before and after photos. No comparisons that name other brands.',
  firstMonthContentAngles: 'Ritual and ingredients; skin education; founder story; customer glow stories; offers.',
});

// Hex colours, used by the logo, the pictures, Brand assets and the business profile.
const PALETTE = Object.freeze({ plum: '#3B1F3A', roseGold: '#C98B7B', cream: '#FBF3EA', sage: '#8AA17D' });

// Fonts in backend/assets/fonts (open licences): a serif display face with a clean sans.
const FONTS = Object.freeze({
  display: { family: 'Playfair Display', file: 'PlayfairDisplay.ttf' },
  sans: { family: 'Inter', file: 'Inter-Bold.ttf' },
  label: 'Playfair Display (headings) with Inter (text)',
});

// Questionnaire answers in the NEW shape (config/businessQuestions.js values only).
const PROFILE_ANSWERS = Object.freeze({
  industry: 'Beauty & Wellness',
  businessType: 'B2C',
  reachAreas: ['state', 'india'],
  ageGroups: ['18_24', '25_34', '35_44'],
  targetGender: 'mostly_women',
  marketingGoals: ['Brand Awareness', 'Direct Sales', 'Community Engagement'],
  brandVoice: ['Friendly', 'Empathetic', 'Educational'],
  // English posts; each post can also be made in Tamil (the "light Tamil touches" are in the voice).
  contentLanguage: 'english',
  additionalLanguages: ['tamil'],
  accountKind: 'one',
  yearsInBusiness: 4,
  brandMaturity: 'growing',
  customerType: 'mix_new_repeat',
  pricePositioning: 'premium',
  contentCadence: { postsPerDay: 1, reelsPerWeek: 2 },
});

/** The 8 products. Prices in rupees. `slug` names the picture files; `look` drives the locally drawn packshot. */
const PRODUCTS = Object.freeze([
  {
    slug: 'kumkumadi-glow-serum', name: 'Kumkumadi Glow Serum', size: '30 ml', price: 1299, category: 'Skincare',
    look: { shape: 'dropper', body: '#B8742F', label: PALETTE.cream },
    ingredients: ['Saffron', 'Manjistha', 'Sandalwood', 'Vetiver'],
    benefits: ['Brighter, even-looking skin in four weeks', 'Light oil serum that sinks in, no grease', 'Fragrance-light, for daily night use'],
    description: 'Our bestseller: a kumkumadi oil serum with real saffron and manjistha, made to the old recipe but light enough to wear every night.',
  },
  {
    slug: 'saffron-sandal-face-mask', name: 'Saffron and Sandal Face Mask', size: '100 g', price: 749, category: 'Skincare',
    look: { shape: 'jar', body: '#E2B04A', label: PALETTE.plum },
    ingredients: ['Saffron', 'Sandalwood', 'Multani mitti', 'Rose water'],
    benefits: ['Calms and brightens in ten minutes', 'Gentle clay that does not over-dry', 'A weekend ritual, twice a week'],
    description: 'A creamy clay mask with saffron and sandalwood for a Sunday glow. Mix, apply, rest ten minutes, rinse with cool water.',
  },
  {
    slug: 'rose-petal-toner', name: 'Rose Petal Toner', size: '150 ml', price: 549, category: 'Skincare',
    look: { shape: 'mist', body: '#E7A6A1', label: PALETTE.cream },
    ingredients: ['Steam-distilled rose water', 'Aloe vera', 'Glycerin'],
    benefits: ['Refreshes and preps skin for serum', 'Alcohol-free, for sensitive skin', 'Fine mist for midday refresh'],
    description: 'Steam-distilled rose water from Kannauj with aloe, in a fine mist. Alcohol-free and gentle enough for every skin type.',
  },
  {
    slug: 'neem-turmeric-cleanser', name: 'Neem and Turmeric Cleanser', size: '120 ml', price: 449, category: 'Skincare',
    look: { shape: 'tube', body: PALETTE.sage, label: PALETTE.cream },
    ingredients: ['Neem', 'Turmeric', 'Tulsi', 'Coconut-based cleansers'],
    benefits: ['Clears the day without stripping', 'Soap-free gel, pH balanced', 'Good for oily and combination skin'],
    description: 'A soap-free gel cleanser with neem, turmeric and tulsi that washes away sweat and sunscreen and leaves skin soft, never tight.',
  },
  {
    slug: 'bakuchi-night-repair-cream', name: 'Bakuchi Night Repair Cream', size: '50 g', price: 1099, category: 'Skincare',
    look: { shape: 'jar', body: PALETTE.plum, label: PALETTE.roseGold },
    ingredients: ['Bakuchi (plant retinol alternative)', 'Shea butter', 'Ashwagandha'],
    benefits: ['Smoother-looking skin while you sleep', 'Gentle alternative to retinol', 'Rich but non-sticky night cream'],
    description: 'A night cream with bakuchi, the plant alternative to retinol, with shea butter and ashwagandha. Kind to skin that finds retinol too much.',
  },
  {
    slug: 'tinted-mineral-spf-40', name: 'Tinted Mineral SPF 40', size: '50 ml', price: 699, category: 'Skincare',
    look: { shape: 'tube', body: '#D9A88A', label: PALETTE.plum },
    ingredients: ['Zinc oxide', 'Iron oxides (tint)', 'Carrot seed oil'],
    benefits: ['Broad-spectrum mineral SPF 40', 'Sheer tint, no white cast on Indian skin', 'Works under makeup'],
    description: 'A mineral sunscreen with a sheer tint made for Indian skin tones: no white cast, no sting, and comfortable in Chennai humidity.',
  },
  {
    slug: 'coconut-hibiscus-hair-oil', name: 'Coconut and Hibiscus Hair Oil', size: '200 ml', price: 599, category: 'Haircare',
    look: { shape: 'bottle', body: '#9E2F45', label: PALETTE.cream },
    ingredients: ['Cold-pressed coconut oil', 'Hibiscus', 'Curry leaf', 'Fenugreek'],
    benefits: ['Softer, shinier hair after the first wash', 'Traditional Sunday oil bath, made easy', 'Unisex, for every hair type'],
    description: 'Cold-pressed coconut oil slow-infused with hibiscus, curry leaf and fenugreek, the oil bath recipe from home. Unisex.',
  },
  {
    slug: 'lip-balm-trio', name: 'Lip Balm Trio', size: '3 x 5 g', price: 399, category: 'Lip care',
    look: { shape: 'trio', body: PALETTE.roseGold, label: PALETTE.cream },
    ingredients: ['Beeswax', 'Kokum butter', 'Beetroot (tint)', 'Rose'],
    benefits: ['Three shades: bare, rose and beet', 'Kokum butter for dry lips', 'Pocket-sized gift set'],
    description: 'Three tinted balms with kokum butter and beeswax: Bare, Rose and Beet. A small gift that people actually use.',
  },
]);

/** Fictional competitors (names only here; their data comes in a later stage). */
const COMPETITORS = Object.freeze([
  { name: 'Kaya Veda', handle: 'kayaveda.demo' },
  { name: 'Pure Petal Co', handle: 'purepetal.demo' },
  { name: 'Ritu Organics', handle: 'rituorganics.demo' },
  { name: 'Glow Ghar', handle: 'glowghar.demo' },
  { name: 'Amla and Ash', handle: 'amlaandash.demo' },
]);

/** People and places in Brand assets (drawn locally as simple illustrations). */
const CHARACTERS = Object.freeze([
  { slug: 'founder-nila', name: 'Aanya Raghavan (founder)', tone: '#8C5A3C', outfit: PALETTE.plum },
  { slug: 'model-aarthi', name: 'Aarthi (model)', tone: '#A86B4C', outfit: PALETTE.roseGold },
  { slug: 'model-karthik', name: 'Karthik (model)', tone: '#7A4E35', outfit: PALETTE.sage },
]);
const PLACES = Object.freeze([
  { slug: 'studio-chennai', name: 'Our studio in Chennai', kind: 'studio' },
  { slug: 'product-shelf', name: 'The product shelf', kind: 'shelf' },
]);

/**
 * Connected social accounts (fake: the profile key starts with `demo-`, so nothing is ever sent to the provider, D112).
 * `analytics` uses the provider's own field names, so the app's existing readers show the numbers.
 */
const SOCIALS = Object.freeze([
  { platform: 'instagram', username: 'zaya.naturals', displayName: 'Zaya Naturals', analytics: { followersCount: 34280, followsCount: 412, mediaCount: 486, reachCount: 61200, likeCount: 1840, commentsCount: 212 } },
  { platform: 'facebook', username: 'Zaya Naturals', displayName: 'Zaya Naturals', analytics: { followersCount: 12940, fanCount: 12610, pageFollows: 0, mediaCount: 318, pagePostsImpressionsUnique: 22800, pagePostsImpressions: 30400, pagePostEngagements: 980 } },
  { platform: 'youtube', username: 'Zaya Naturals', displayName: 'Zaya Naturals', analytics: { followersCount: 3870, followingCount: 0, postsCount: 64 } },
  { platform: 'linkedin', username: 'Zaya Naturals', displayName: 'Zaya Naturals', analytics: { followers: { totalFollowerCount: 1460 }, engagement: 0.052, uniqueImpressionsCount: 5200, impressionCount: 7400 } },
]);

/**
 * The account's life, counted back from the day `create` runs (so the demo never goes stale):
 * the Growth plan was first bought `planCharges - 1` months before the latest charge, which was `daysSinceLastCharge`
 * days ago; the Publish, Competitors and Inbox bundle joined at the second charge; one top-up `topupDaysAgo` days ago.
 * Quarks spent per plan month, oldest first (the last one is the month in progress).
 */
const TIMELINE = Object.freeze({
  planCharges: 6,            // the first purchase and 5 renewals
  daysSinceLastCharge: 15,
  bundleFromCharge: 2,       // the add-on bundle was bought with the 2nd plan charge
  topupDaysAgo: 26,
  topupPackInr: 1000,
  monthSpends: [1590, 1820, 1960, 2000, 2300, 820],
});

module.exports = { BRAND, PALETTE, FONTS, PROFILE_ANSWERS, PRODUCTS, COMPETITORS, CHARACTERS, PLACES, SOCIALS, TIMELINE };
