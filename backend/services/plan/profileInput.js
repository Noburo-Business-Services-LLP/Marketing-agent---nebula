'use strict';
// Turns a user's saved business profile into the input the Blueprint engine expects.
// Pure and total: never throws on missing or odd fields.

const { normaliseInput } = require('../blueprint/input');
const { PLAN_LIMITS } = require('../../config/blueprint');
const { reachAreasOf, audienceFacts, industryOf } = require('../businessProfile');

const str = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const profileOf = (user) => (user && user.businessProfile && typeof user.businessProfile === 'object' ? user.businessProfile : {});
const firstLong = (vals, min) => vals.map(str).find((s) => s.length >= min) || '';

function nameOf(user) {
  return str(profileOf(user).name) || str((user || {}).companyName);
}

function instagramOf(user) {
  const socials = Array.isArray((user || {}).connectedSocials) ? user.connectedSocials : [];
  const ig = socials.find((s) => s && s.platform === 'instagram' && str(s.username));
  return ig ? str(ig.username) : '';
}

function whatYouSellOf(user) {
  const p = profileOf(user);
  return firstLong([p.description, p.heroProduct, p.problemSolved], 10);
}

function whoItsForOf(user) {
  const p = profileOf(user);
  return firstLong([p.targetCustomerProfile, p.targetAudience], 5);
}

function goalOf(user) {
  const goals = profileOf(user).marketingGoals;
  const first = (Array.isArray(goals) ? goals : []).map((g) => str(typeof g === 'string' ? g : g && g.text).toLowerCase()).find(Boolean) || '';
  if (/enquir|lead/.test(first)) return 'enquiries';
  if (/sale|sell/.test(first)) return 'sales';
  if (/follow|awareness|brand/.test(first)) return 'followers';
  if (/launch/.test(first)) return 'launch';
  return 'enquiries';
}

function competitorsOf(user) {
  const list = profileOf(user).competitors;
  return (Array.isArray(list) ? list : [])
    .map((c) => str(typeof c === 'string' ? c : c && c.name))
    .filter(Boolean)
    .slice(0, 3)
    .map((name) => ({ name }));
}

// A stored price in words, exactly as stored: the price note wins, then a whole number in rupees. Never rounded or guessed.
function priceOf(p) {
  const note = str(p.priceNote);
  if (note) return note;
  const n = Number(p.price);
  if (!Number.isFinite(n) || n <= 0) return '';
  const cur = str(p.currency).toUpperCase();
  return !cur || cur === 'INR' ? `Rs ${n.toLocaleString('en-IN')}` : `${cur} ${n}`;
}

// The account's own catalogue, first ones first, capped (the input check caps again).
function productsOf(list) {
  return (Array.isArray(list) ? list : []).filter((p) => p && str(p.name)).slice(0, PLAN_LIMITS.MAX_PRODUCTS).map((p) => ({
    name: str(p.name),
    kind: p.type === 'service' ? 'service' : 'product',
    price: priceOf(p),
    about: str(p.description) || (Array.isArray(p.keyFeatures) ? p.keyFeatures.map(str).filter(Boolean).join(', ') : '')
  }));
}

// The typed business details the planner may cite. Unset answers are left out, never sent empty.
function detailsOf(user) {
  const p = profileOf(user);
  const out = {};
  // The place only: a postcode or phone-like number is cut, so it can never be repeated as an address.
  const city = str(str(p.businessLocation).replace(/\d{5,}/g, ' ')).replace(/^[,\s-]+|[,\s-]+$/g, '');
  if (city.length >= 2) out.city = city;
  if (['B2B', 'B2C', 'Both'].includes(p.businessType)) out.businessType = p.businessType;
  const reach = reachAreasOf(p);
  if (reach.length) out.reachAreas = reach;
  // Ages and business buyers (the facts above already cover sells-to, reach and price level).
  const audience = audienceFacts(p).filter((f) => !['sellsTo', 'reach', 'price'].includes(f.key)).map((f) => f.text);
  if (audience.length) out.audience = audience;
  if (str(p.pricePositioning)) out.pricePositioning = str(p.pricePositioning);
  if (str(p.keyDifferentiator)) out.keyDifferentiator = str(p.keyDifferentiator);
  if (industryOf(p)) out.industry = industryOf(p);
  if (str(p.contentLanguage)) out.contentLanguage = str(p.contentLanguage);
  return out;
}

// What Nebulaa learned (lines from services/brandMemory/prompt.js): plain strings, capped (the input check caps again).
const learnedOf = (list) => (Array.isArray(list) ? list : []).map(str).filter(Boolean).slice(0, PLAN_LIMITS.MAX_LEARNED);

function inputFromProfile(user, { products, learned } = {}) {
  const items = productsOf(products);
  const lines = learnedOf(learned);
  return {
    businessName: nameOf(user),
    website: str(profileOf(user).website),
    instagram: instagramOf(user),
    whatYouSell: whatYouSellOf(user),
    whoItsFor: whoItsForOf(user),
    goal: goalOf(user),
    competitors: competitorsOf(user),
    offers: [],
    ...(items.length ? { products: items } : {}),
    ...(lines.length ? { learned: lines } : {}),
    ...detailsOf(user)
  };
}

// Complete means the Blueprint engine can actually use it: the same input check the engine runs, so "none" or "-"
// in the website field is not a website.
function profileComplete(user) {
  const missing = [];
  if (nameOf(user).length < 2) missing.push('business name');
  if (!str(profileOf(user).website) && !instagramOf(user)) missing.push('website or Instagram page');
  if (!whatYouSellOf(user)) missing.push('what you sell');
  if (!whoItsForOf(user)) missing.push('who it is for');
  if (!missing.length) {
    const n = normaliseInput(inputFromProfile(user), { allowGuided: true });
    if (!n.ok) {
      const e = n.errors || {};
      if (e.website || e.instagram) missing.push('website or Instagram page');
      else missing.push('business details we can read');
    }
  }
  return { complete: missing.length === 0, missing };
}

module.exports = { profileComplete, inputFromProfile };
