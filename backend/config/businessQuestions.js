'use strict';
/**
 * The business-profile questions: ONE definition for sign-up, Settings, the server's cleaning and the prompt readers.
 *
 * Values only (English, never translated). The words people read live in the frontend mirror
 * `frontend/constants/businessQuestions.ts` (English, Tamil, Hindi); `frontend/tests/businessQuestions.test.mjs`
 * loads this file and fails if any list there differs from the lists here.
 *
 * To add a question or an option: add it here, add the same value and its words in all three languages in the
 * frontend mirror, add a schema field in `models/User.js` if it is new, then let `services/businessProfile.js`
 * clean and read it. How-to: `docs/superpowers/ops/questionnaire.md`.
 */

/** Who the business sells to. Decides which follow-up questions show (see BRANCHES). */
const SELLS_TO = ['B2C', 'B2B', 'Both'];

/** Kinds of business, in groups. Every value ever saved by sign-up or Settings is still here (or in INDUSTRY_ALIASES). */
const INDUSTRY_GROUPS = [
  { id: 'shops', values: ['E-commerce / Retail', 'Fashion & Apparel', 'Jewellery', 'Grocery & Supermarket', 'Electronics & Mobile', 'Home & Furniture', 'Automotive', 'Wholesale & Distribution'] },
  { id: 'food', values: ['Restaurants / Cafes / Bars', 'Food & Beverage', 'Travel & Hospitality', 'Events & Weddings'] },
  { id: 'health', values: ['Healthcare', 'Beauty & Wellness', 'Salon & Spa', 'Gym & Fitness'] },
  { id: 'services', values: ['Professional Services', 'Legal & Accounting', 'Home Services & Repairs', 'Logistics & Transport', 'Coaching & Training'] },
  { id: 'technology', values: ['Technology / SaaS', 'IT Services', 'Agency / Marketing', 'Finance / Fintech'] },
  { id: 'industry', values: ['Real Estate', 'Construction & Interiors', 'Manufacturing', 'Agriculture'] },
  { id: 'community', values: ['Education', 'Media & Entertainment', 'Creators & Influencers', 'Non-profit'] },
];
const OTHER_INDUSTRY = 'Other';
const INDUSTRIES = [...INDUSTRY_GROUPS.flatMap((g) => g.values), OTHER_INDUSTRY];
/** Older spellings, read as the current value. */
const INDUSTRY_ALIASES = { 'Technology/SaaS': 'Technology / SaaS', 'Finance/Fintech': 'Finance / Fintech', 'E-commerce/Retail': 'E-commerce / Retail', 'Restaurants/Cafes/Bars': 'Restaurants / Cafes / Bars' };

/** Where the customers are. Several allowed. */
const REACH_AREAS = ['neighbourhood', 'city', 'state', 'india', 'international'];
/** The old single answer (`geographicReach`), read as the nearest area. */
const OLD_REACH = { hyperlocal: 'neighbourhood', local_city: 'city', regional: 'state', state: 'state', national: 'india', international: 'international' };

/** People branch (B2C or Both). Both optional. */
const AGE_GROUPS = ['under_18', '18_24', '25_34', '35_44', '45_54', '55_plus'];
const GENDERS = ['mostly_men', 'mostly_women', 'families'];
/** Old gender values, read as the new value ('' means everyone, not specific). */
const OLD_GENDERS = { both_equally: '' };

/** Business branch (B2B or Both). All optional. The buyer kinds reuse the industry group ids, plus government. */
const BUYER_INDUSTRIES = [...INDUSTRY_GROUPS.map((g) => g.id), 'government'];
const COMPANY_SIZES = ['solo', 'small', 'medium', 'large'];
/** Saved as the words themselves in `b2b.decisionMaker` (free text before; any other text still works). */
const DECISION_MAKERS = ['Owner or founder', 'Managing director', 'Operations head', 'Purchase team', 'Marketing head', 'Technology head', 'HR head', 'Finance head'];
const SALES_CYCLES = ['days', 'weeks', 'months'];

const VOICES = ['Professional', 'Friendly', 'Witty', 'Empathetic', 'Bold', 'Educational'];
const GOALS = ['Brand Awareness', 'Lead Generation', 'Direct Sales', 'Community Engagement', 'Website Traffic'];

/** The languages the writers support (posts, Home drafts, videos, image text). Each regional one may be mixed with English. */
const LANGUAGES = ['english', 'hindi', 'tamil', 'telugu', 'kannada', 'malayalam'];
const MIX_SUFFIX = '_english_mix';
const OFFERED_CONTENT_LANGUAGES = [...LANGUAGES, ...LANGUAGES.filter((l) => l !== 'english').map((l) => `${l}${MIX_SUFFIX}`)];

/** Which follow-up questions each answer to "Who do you sell to" shows. Empty (not answered) shows neither. */
const BRANCHES = {
  people: ['B2C', 'Both'],
  business: ['B2B', 'Both'],
};

/** Caps the server applies to free text in these questions. */
const LIMITS = { industry: 80, decisionMaker: 120 };

/** The questions, in the order sign-up asks them. `field` is the path on businessProfile; `branch` limits who sees it. */
const QUESTIONS = [
  { id: 'industry', field: 'industry', kind: 'grouped', step: 1, required: true },
  { id: 'sellsTo', field: 'businessType', kind: 'single', step: 2, required: true },
  { id: 'reach', field: 'reachAreas', kind: 'multi', step: 2 },
  { id: 'ageGroups', field: 'ageGroups', kind: 'multi', step: 2, branch: 'people' },
  { id: 'gender', field: 'targetGender', kind: 'single', step: 2, branch: 'people' },
  { id: 'buyerIndustries', field: 'b2b.customerIndustries', kind: 'multi', step: 2, branch: 'business' },
  { id: 'companySize', field: 'b2b.companySize', kind: 'single', step: 2, branch: 'business' },
  { id: 'decisionMaker', field: 'b2b.decisionMaker', kind: 'single', step: 2, branch: 'business' },
  { id: 'salesCycle', field: 'b2b.salesCycle', kind: 'single', step: 2, branch: 'business' },
  { id: 'goals', field: 'marketingGoals', kind: 'multi', step: 3, required: true },
  { id: 'voice', field: 'brandVoice', kind: 'multi', step: 3 },
  { id: 'language', field: 'contentLanguage', kind: 'single', step: 3, required: true },
];

module.exports = Object.freeze({
  SELLS_TO, INDUSTRY_GROUPS, OTHER_INDUSTRY, INDUSTRIES, INDUSTRY_ALIASES,
  REACH_AREAS, OLD_REACH, AGE_GROUPS, GENDERS, OLD_GENDERS,
  BUYER_INDUSTRIES, COMPANY_SIZES, DECISION_MAKERS, SALES_CYCLES,
  VOICES, GOALS, LANGUAGES, MIX_SUFFIX, OFFERED_CONTENT_LANGUAGES,
  BRANCHES, LIMITS, QUESTIONS,
});
