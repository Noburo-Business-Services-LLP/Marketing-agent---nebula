'use strict';
// Module G: the QA gate. The scanner is the reference implementation from the plan; runQa checks brand accuracy,
// strategy and document structure, and blocks anything that is not traceable to the sheet or the visitor's input.
const { TAGS, PAGES, PHASES, FORMATS, CHANNELS, NEBULAA, LIMITS } = require('../../config/blueprint');

const FORBIDDEN = [
  ['testimonial', /\btestimonials?\b|\bcustomers? (love|say|rave)\b|\bfive[- ]star\b|\b5[- ]star\b/i],
  ['award', /\bawards?\b|\baward[- ]winning\b|\bcertified\b|\baccredited\b|\bfeatured in\b/i],
  ['ranking', /\bnumber one\b|#\s?1\b|\bbest[- ]selling\b|\bmarket leader\b|\bleading (brand|provider|company)\b|\bmost trusted\b|\btrusted by\b/i],
  ['guarantee', /\bguarantee[sd]?\b|\bwill (increase|double|triple|boost|grow)\b|\bproven (results|to)\b/i],
  ['metric', /\b(roi|roas|ctr|cpm|cpc)\b/i],
  ['follower_claim', /\bfollowers?\b.*\b(have|has|with|of)\b\s*\d|\d[\d,.]*\s*(k|m)?\s+followers?\b/i],
  ['number_word', /\b(hundreds?|thousands?|lakhs?|crores?|millions?|dozens?)\b/i]
];
const DIGITS = /\p{Nd}[\p{Nd},.]*/gu; // any script's decimal digits, not just 0-9
// Number words are flagged only where they make a factual claim, so "one clear message" and "first step" stay legal:
//  - tens, teens above ten, and "hundred" anywhere (twenty, thirty, nineteen, one hundred);
//  - any number word directly followed by a unit (percent, years, customers, followers, times, days ...);
//  - "since / established / founded / est." followed by a number word;
//  - rank phrasing: "top ten", "No. one", "ranked first", "the first in/to", "first/second/third place".
const NUM_ONES = '(?:one|two|three|four|five|six|seven|eight|nine|ten)';
const NUM_BIG = '(?:eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)';
const NUM_ANY = `(?:${NUM_ONES}|${NUM_BIG})`;
const NUM_UNIT = '(?:%|per\\s?cent|percent|years?|months?|weeks?|days?|customers?|clients?|followers?|times|x)';
const NUMBER_WORD_CLAIM = [
  new RegExp(`\\b${NUM_BIG}\\b`, 'i'),
  new RegExp(`\\b${NUM_ANY}(?:[\\s-]+${NUM_ANY})*[\\s-]*${NUM_UNIT}(?![\\p{L}])`, 'iu'),
  new RegExp(`\\b(?:since|established|est\\.?|founded)\\s+(?:in\\s+)?${NUM_ANY}\\b`, 'i'),
  new RegExp(`\\btop[\\s-]+(?:${NUM_ANY}|\\d+)\\b`, 'i'),
  /\bno\.?\s*(?:one|1)\b/i,
  /\b(?:ranked|rated|placed|voted|came|comes|is|are|was|were)\s+(?:the\s+)?(?:first|second|third)\b/i,
  /\bthe\s+(?:first|second|third)\s+(?:in|to|ever|brand|bakery|choice)\b/i,
  /\b(?:first|second|third)[\s-]+(?:place|rank|in\s+(?:town|the|chennai|india))\b/i
];
// Superlatives and place rankings: one short list.
const SUPERLATIVES = [
  /\bbest[\s-]+in\b/i, /\bbest\s+(?:of|around)\s+(?:town|the city)\b/i, /\btop[\s-]rated\b/i, /\bleading\b(?!\s+(?:to|up|with|into)\b)/i,
  /\bvoted\b/i, /\bfavou?rite\s+(?:by|of|among)\b/i, /\bworld[\s-]class\b/i, /\bmost\s+(?:trusted|loved|popular|recommended)\b/i,
  /\bnumber[\s-]?one\b/i, /\bmarket\s+leader\b/i, /\baward[\s-]winning\b/i, /\bin\s+town\b/i
];
const HEALTH = /\bcures?[sd]?\b|\bguaranteed?\s+results?\b/i;
// A bare domain (example.com, mybrand.in/shop) and an obfuscated or spaced email.
const BARE_DOMAIN = /(?<![\w@.-])(?:[a-z0-9-]+\.)+(?:com|in|org|net|co|io|shop|store|app|biz|info|me|us|uk|ai|online|site|xyz|dev|ly)\b(?![\w-])/i;
const OBFUSCATED_EMAIL = [
  /[\w.+-]+\s*@\s*[\w-]+(?:\s*(?:\.|\[dot\]|\(dot\)|\bdot\b)\s*[\w-]+)+/i,
  /\S+\s+(?:\[at\]|\(at\)|at)\s+[\w-]+\s+(?:\[dot\]|\(dot\)|dot)\s+[a-z]{2,}/i
];
const CONTACT = /[\w.+-]+@[\w-]+\.[\w.-]+|https?:\/\/\S+|\bwww\.\S+|(?:\+?\p{Nd}[\p{Nd}\s-]{8,}\p{Nd})/iu;
const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}]/u;
// Any quotation mark pair counts as a quotation. An apostrophe inside a word (Co's) is not an opener or closer.
const Q = `"'‘’‚‛‹›«»“”„`;
const QUOTE = new RegExp(`(?<![\\p{L}\\p{Nd}])[${Q}][^${Q}]{12,}[${Q}](?![\\p{L}\\p{Nd}])`, 'u');

const numbersIn = (text) => (String(text).match(DIGITS) || []).map((n) => n.replace(/[,.]+$/, '').replace(/,/g, ''));

function scanClaimText(text, ctx = {}) {
  const t = String(text || '');
  const allowed = new Set((ctx.allowedNumbers || []).map(String));
  const v = [];
  for (const [rule, re] of FORBIDDEN) if (re.test(t)) v.push({ rule });
  for (const n of numbersIn(t)) if (!allowed.has(n)) v.push({ rule: 'invented_number', match: n });
  if (NUMBER_WORD_CLAIM.some((re) => re.test(t))) v.push({ rule: 'number_word' });
  if (SUPERLATIVES.some((re) => re.test(t))) v.push({ rule: 'ranking' });
  if (HEALTH.test(t)) v.push({ rule: 'health_claim' });
  if (CONTACT.test(t) || BARE_DOMAIN.test(t) || OBFUSCATED_EMAIL.some((re) => re.test(t))) v.push({ rule: 'invented_contact' });
  if (/!/.test(t)) v.push({ rule: 'exclamation' });
  if (EMOJI.test(t)) v.push({ rule: 'emoji' });
  if (/—/.test(t)) v.push({ rule: 'em_dash' });
  if (QUOTE.test(t)) v.push({ rule: 'invented_quote' });
  return v;
}

// Every number that appears in a verified fact: those, and only those, may be repeated in model text.
function allowedNumbersOf(sheet) {
  const out = new Set();
  for (const f of (sheet && sheet.facts) || []) for (const n of numbersIn(f.text)) out.add(n);
  return [...out];
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const only = (list) => list.filter((c) => isObj(c));

// All claims inside one section, whatever its kind. Nulls are skipped.
function claimsOf(section) {
  const items = (section && section.items) || [];
  switch (section && section.kind) {
    case 'claims': return only(items);
    case 'pillars': return only(items.flatMap((i) => [i.why, i.example]));
    case 'calendar': return only(items.map((i) => i.hook));
    case 'competitors': return only(items.flatMap((i) => i.observations || []));
    case 'offers': return only(items.flatMap((i) => [i.fact, i.hook, i.cta]));
    case 'channels': return only(items.map((i) => i.role));
    case 'phases': return only(items.flatMap((i) => [i.focus, ...(i.actions || []), ...(i.measure || [])]));
    default: return [];
  }
}

function runQa({ blueprint, sheet, input, dropped }) {
  const flags = [];
  const block = (rule, where, detail) => flags.push({ level: 'block', rule, where, detail });
  const note = (rule, where, detail) => flags.push({ level: 'note', rule, where, detail });
  const doc = blueprint || {};
  const facts = new Map(((sheet && sheet.facts) || []).map((f) => [f.id, f]));
  const allowedNumbers = allowedNumbersOf(sheet);
  const pages = Array.isArray(doc.pages) ? doc.pages : [];

  // Document structure.
  if (pages.length !== PAGES.length || pages.some((p, i) => !p || p.id !== PAGES[i].id)) block('pages', 'pages', 'The nine pages are not present in the required order.');
  if (!doc.cover) block('cover', 'cover', 'The cover is missing.');
  if (!doc.closing) block('closing', 'closing', 'The closing page is missing.');
  pages.forEach((p, pi) => {
    const sections = (p && p.sections) || [];
    if (!sections.length || sections.some((s) => !s || !Array.isArray(s.items) || !s.items.length)) block('page_empty', `pages[${pi}]`, 'A page or one of its sections is empty.');
  });

  // Claims: tags, traceability, and the text scanner.
  const scanText = (text, where) => {
    for (const v of scanClaimText(text, { allowedNumbers })) block(v.rule, where, v.match || String(text).slice(0, 80));
  };
  const checkClaim = (c, where) => {
    if (!TAGS.includes(c.tag) || typeof c.text !== 'string' || !c.text.trim()) { block('untagged', where, 'The claim has no valid tag or no text.'); return; }
    if (c.tag === 'verified') {
      const f = c.factId && facts.get(c.factId);
      if (!f || f.text !== c.text) block('verified_not_in_sheet', where, 'A Verified claim does not equal its source fact.');
    } else if (c.tag === 'inference') {
      if (!Array.isArray(c.factIds) || !c.factIds.length || c.factIds.some((id) => !facts.has(id))) block('inference_without_basis', where, 'An Inference does not rest on facts in the sheet.');
      scanText(c.text, where);
    } else if (c.tag === 'unverified') {
      if (!c.reason) block('unverified_reason', where, 'An Unverified item has no reason.');
    } else scanText(c.text, where);
  };
  pages.forEach((p, pi) => ((p && p.sections) || []).forEach((s, si) => claimsOf(s).forEach((c, ci) => checkClaim(c, `pages[${pi}].sections[${si}].claim[${ci}]`))));
  if (doc.cover && doc.cover.promise) checkClaim(doc.cover.promise, 'cover.promise');

  // Strategy.
  const sec = (id, kind) => {
    const p = pages.find((x) => x && x.id === id);
    return ((p && p.sections) || []).filter((s) => s && s.kind === kind);
  };
  const pillars = sec('content-pillars', 'pillars').flatMap((s) => s.items);
  if (pillars.length < 3 || pillars.length > 5) block('pillar_count', 'pages.content-pillars', 'Between three and five pillars are required.');
  pillars.forEach((p, i) => scanText(p.name, `pillars[${i}].name`));
  const names = new Set(pillars.map((p) => p.name));
  const calendar = sec('calendar-preview', 'calendar').flatMap((s) => s.items);
  const days = new Set(calendar.filter((c) => Number.isInteger(c.day) && c.day >= 1 && c.day <= 30).map((c) => c.day));
  if (days.size < LIMITS.MIN_CALENDAR_DAYS) block('calendar_thin', 'pages.calendar-preview', `Only ${days.size} calendar days.`);
  calendar.forEach((c, i) => {
    if (!names.has(c.pillar)) block('calendar_pillar', `calendar[${i}]`, 'A calendar item names a pillar that does not exist.');
    if (!FORMATS.includes(c.format)) block('format_not_allowed', `calendar[${i}]`, String(c.format));
  });
  sec('channel-plan', 'channels').flatMap((s) => s.items).forEach((c, i) => { if (!CHANNELS.includes(c.channel)) block('channel_not_allowed', `channels[${i}]`, String(c.channel)); });
  const territory = sec('audience-positioning', 'claims').flatMap((s) => s.items).filter((c) => c && c.label === 'Territory');
  if (territory.length !== 1) block('territory', 'pages.audience-positioning', 'Exactly one territory is required.');
  const phases = sec('roadmap-90', 'phases').flatMap((s) => s.items);
  if (phases.length !== PHASES.length || phases.some((p, i) => p.id !== PHASES[i].id || !p.focus)) block('roadmap', 'pages.roadmap-90', 'The three phases are not complete and in order.');

  // Brand accuracy.
  if (doc.cover) {
    if (!input || doc.cover.businessName !== input.businessName) block('brand_name', 'cover.businessName', 'The business name was changed.');
    const url = doc.cover.logo && doc.cover.logo.url;
    const okLogos = [input && input.logoUrl, sheet && sheet.assets && sheet.assets.logo && sheet.assets.logo.url].filter(Boolean);
    if (doc.cover.logo && !okLogos.includes(url)) block('logo_changed', 'cover.logo', 'The logo address is not the one provided or found.');
  }
  if (doc.closing && JSON.stringify(doc.closing.contact) !== JSON.stringify(NEBULAA)) block('closing_contact', 'closing.contact', 'The closing contact is not the Nebulaa contact.');
  const typedOffers = (input && input.offers) || [];
  sec('offers-hooks', 'offers').flatMap((s) => s.items).forEach((o, i) => {
    if (!typedOffers.some((t) => t.name === o.name && t.price === o.price)) block('offer_price', `offers[${i}]`, 'An offer is not exactly as the visitor typed it.');
  });

  // Removed items.
  const removed = Array.isArray(dropped) ? dropped.length : Number(dropped) || 0;
  if (removed > LIMITS.MAX_DROPPED) block('too_many_removed', 'plan', `${removed} items were removed.`);
  else if (removed > 0) note('removed_items', 'plan', `${removed} items were removed.`);
  for (const w of (sheet && sheet.warnings) || []) note(w.reason, 'sheet', w.message);

  return { passed: !flags.some((f) => f.level === 'block'), flags };
}

module.exports = { scanClaimText, numbersIn, allowedNumbersOf, claimsOf, runQa };
