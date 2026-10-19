'use strict';
/**
 * The business-profile answers: cleaning on save and plain words for the prompts. PURE (no I/O).
 *
 * Every save of the profile (sign-up and Settings, also inside an agency client or by staff) goes through
 * `cleanBusinessProfile`, and every prompt that describes the customers reads them through the helpers below, so an
 * old stored value, a new one and an empty one all read the same way everywhere. The questions themselves are in
 * `config/businessQuestions.js`.
 */
const Q = require('../config/businessQuestions');
const { BASE_LANGUAGES } = require('./languageSupport');

const str = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const uniq = (list) => [...new Set(list)];
const pickList = (v, allowed) => uniq((Array.isArray(v) ? v : []).filter((x) => typeof x === 'string' && allowed.includes(x)));
const textList = (v, { max = 10, each = 60 } = {}) => {
  const raw = Array.isArray(v) ? v : (typeof v === 'string' ? v.split(',') : []);
  const out = [];
  for (const x of raw) {
    const t = str(typeof x === 'string' ? x : '').slice(0, each);
    if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
    if (out.length === max) break;
  }
  return out;
};

const ACCEPTED_LANGUAGES = ['', ...BASE_LANGUAGES, ...BASE_LANGUAGES.filter((b) => b !== 'english').map((b) => `${b}${Q.MIX_SUFFIX}`)];
const OLD_REACH_VALUES = ['', ...Object.keys(Q.OLD_REACH)];
const ENUMS = {
  customerType: ['', 'mostly_new', 'mix_new_repeat', 'mostly_loyal'],
  pricePositioning: ['', 'budget', 'affordable', 'mid_range', 'premium', 'luxury'],
  brandMaturity: ['', 'established', 'growing'],
};

/* ---------- Reading old and new values ---------- */

const sellsToBusinesses = (type) => Q.BRANCHES.business.includes(type);
const sellsToPeople = (type) => Q.BRANCHES.people.includes(type);

/** The industry as stored, with older spellings mapped. 'Other' alone (no words typed) counts as not set. */
function industryOf(bp = {}) {
  const raw = str(bp && bp.industry);
  const v = Q.INDUSTRY_ALIASES[raw] || raw;
  return v === Q.OTHER_INDUSTRY ? '' : v;
}

/** The reach areas; the old single answer counts when no area is chosen. */
function reachAreasOf(bp = {}) {
  const list = pickList(bp && bp.reachAreas, Q.REACH_AREAS);
  if (list.length) return list;
  const old = Q.OLD_REACH[bp && bp.geographicReach];
  return old ? [old] : [];
}

/** The audience gender, '' for everyone, never for a business that sells to businesses only. */
function genderOf(bp = {}) {
  if (!bp || bp.businessType === 'B2B') return '';
  const g = has(Q.OLD_GENDERS, bp.targetGender) ? Q.OLD_GENDERS[bp.targetGender] : bp.targetGender;
  return Q.GENDERS.includes(g) ? g : '';
}

/* ---------- Cleaning on save ---------- */

/**
 * The profile ready to save: unknown choice values are dropped instead of failing the save, old values mapped,
 * lists de-duplicated, free text trimmed and capped. Only fields that were sent are touched; nothing else changes.
 */
function cleanBusinessProfile(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return profile;
  const p = { ...profile };
  if (has(p, 'businessType')) p.businessType = Q.SELLS_TO.includes(p.businessType) ? p.businessType : '';
  if (has(p, 'industry')) {
    const raw = str(p.industry).slice(0, Q.LIMITS.industry);
    p.industry = Q.INDUSTRY_ALIASES[raw] || raw;
  }
  if (has(p, 'geographicReach') && !OLD_REACH_VALUES.includes(p.geographicReach)) p.geographicReach = '';
  if (has(p, 'reachAreas') || has(p, 'geographicReach')) {
    const list = pickList(p.reachAreas, Q.REACH_AREAS);
    p.reachAreas = list.length ? list : (Q.OLD_REACH[p.geographicReach] ? [Q.OLD_REACH[p.geographicReach]] : []);
  }
  if (has(p, 'ageGroups')) p.ageGroups = pickList(p.ageGroups, Q.AGE_GROUPS);
  if (has(p, 'targetGender')) {
    const g = has(Q.OLD_GENDERS, p.targetGender) ? Q.OLD_GENDERS[p.targetGender] : p.targetGender;
    p.targetGender = Q.GENDERS.includes(g) ? g : '';
  }
  if (has(p, 'b2b')) {
    const b = p.b2b && typeof p.b2b === 'object' && !Array.isArray(p.b2b) ? p.b2b : {};
    p.b2b = {
      customerIndustries: pickList(b.customerIndustries, Q.BUYER_INDUSTRIES),
      companySize: Q.COMPANY_SIZES.includes(b.companySize) ? b.companySize : '',
      decisionMaker: str(b.decisionMaker).slice(0, Q.LIMITS.decisionMaker),
      salesCycle: Q.SALES_CYCLES.includes(b.salesCycle) ? b.salesCycle : '',
    };
  }
  if (has(p, 'brandVoice')) p.brandVoice = textList(p.brandVoice, { max: 10, each: 40 });
  if (has(p, 'marketingGoals')) p.marketingGoals = textList(p.marketingGoals, { max: 10, each: 60 });
  if (has(p, 'contentLanguage')) {
    const l = str(p.contentLanguage).toLowerCase();
    p.contentLanguage = ACCEPTED_LANGUAGES.includes(l) ? l : '';
  }
  for (const [k, allowed] of Object.entries(ENUMS)) {
    if (has(p, k) && !allowed.includes(p[k])) p[k] = '';
  }
  return p;
}

/* ---------- Plain words for the prompts ---------- */

const SELLS_TO_WORDS = { B2C: 'individual customers', B2B: 'other businesses', Both: 'both businesses and individual customers' };
const REACH_WORDS = { neighbourhood: 'the neighbourhood', city: 'the city', state: 'the state', india: 'all of India', international: 'other countries' };
const AGE_WORDS = { under_18: 'under 18', '18_24': '18 to 24', '25_34': '25 to 34', '35_44': '35 to 44', '45_54': '45 to 54', '55_plus': '55 and over' };
const GENDER_WORDS = { mostly_men: 'mostly men', mostly_women: 'mostly women', families: 'mostly families' };
const BUYER_WORDS = {
  shops: 'shops and online stores', food: 'restaurants, hotels and event firms', health: 'clinics, salons and gyms',
  services: 'service firms', technology: 'technology, finance and marketing companies', industry: 'builders, factories and farms',
  community: 'schools, media and non-profits', government: 'government offices',
};
const SIZE_WORDS = { solo: 'one-person businesses', small: 'small companies', medium: 'mid-size companies', large: 'large companies' };
const CYCLE_WORDS = { days: 'a few days', weeks: 'a few weeks', months: 'several months' };
const PRICE_WORDS = { budget: 'budget', affordable: 'affordable', mid_range: 'mid-range', premium: 'premium', luxury: 'luxury' };

/** 'a', 'a and b', 'a, b and c'. */
function listWords(list, joiner = 'and') {
  const l = (list || []).filter(Boolean);
  if (l.length <= 1) return l.join('');
  return `${l.slice(0, -1).join(', ')} ${joiner} ${l[l.length - 1]}`;
}

const reachWordsOf = (bp) => reachAreasOf(bp).map((a) => REACH_WORDS[a]).filter(Boolean);
const ageWordsOf = (bp) => (bp && bp.businessType === 'B2B' ? [] : pickList(bp && bp.ageGroups, Q.AGE_GROUPS).map((a) => AGE_WORDS[a]));
const buyerWordsOf = (bp) => (sellsToBusinesses(bp && bp.businessType) ? pickList(bp && bp.b2b && bp.b2b.customerIndustries, Q.BUYER_INDUSTRIES).map((a) => BUYER_WORDS[a]) : []);

/**
 * Plain sentences about who buys and where, from the owner's answers only. Each fact is one short clause the
 * readers can put in a list or a sentence. Nothing is written for an empty answer; a gender or an age is never
 * guessed, and business-buyer facts only appear when the owner said they sell to businesses.
 */
function audienceFacts(bp = {}) {
  const b = bp || {};
  const facts = [];
  const type = String(b.businessType || '');
  if (SELLS_TO_WORDS[type]) facts.push({ key: 'sellsTo', text: `sells to ${SELLS_TO_WORDS[type]}` });
  const reach = reachWordsOf(b);
  if (reach.length) facts.push({ key: 'reach', text: `customers are in ${listWords(reach)}` });
  const ages = ageWordsOf(b);
  if (ages.length) facts.push({ key: 'ages', text: `customers are mostly aged ${listWords(ages, 'or')}` });
  const g = genderOf(b);
  if (g) facts.push({ key: 'gender', text: `customers are ${GENDER_WORDS[g]}` });
  if (sellsToBusinesses(type)) {
    const x = b.b2b || {};
    const buyers = buyerWordsOf(b);
    if (buyers.length) facts.push({ key: 'buyers', text: `business customers are ${listWords(buyers, 'or')}` });
    if (SIZE_WORDS[x.companySize]) facts.push({ key: 'size', text: `business customers are usually ${SIZE_WORDS[x.companySize]}` });
    const dm = str(x.decisionMaker).slice(0, Q.LIMITS.decisionMaker);
    if (dm) {
      // A role from the list reads as a phrase ("the purchase team"); the owner's own words are quoted as typed.
      const role = Q.DECISION_MAKERS.includes(dm) ? `the ${/^[A-Z][a-z]/.test(dm) ? dm.charAt(0).toLowerCase() + dm.slice(1) : dm}` : `: ${dm}`;
      facts.push({ key: 'decider', text: `the person who decides to buy is usually${role.startsWith(':') ? role : ` ${role}`}` });
    }
    if (CYCLE_WORDS[x.salesCycle]) facts.push({ key: 'cycle', text: `a sale usually takes ${CYCLE_WORDS[x.salesCycle]}` });
  }
  if (PRICE_WORDS[b.pricePositioning]) facts.push({ key: 'price', text: `prices are ${PRICE_WORDS[b.pricePositioning]}` });
  return facts;
}

const sentence = (t) => `${t.charAt(0).toUpperCase()}${t.slice(1)}.`;

module.exports = {
  cleanBusinessProfile, industryOf, reachAreasOf, genderOf, sellsToBusinesses, sellsToPeople,
  audienceFacts, reachWordsOf, listWords, sentence,
  SELLS_TO_WORDS, REACH_WORDS, PRICE_WORDS,
};
