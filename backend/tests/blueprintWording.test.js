'use strict';
// Wording rules for every customer-facing Blueprint string, plus the claim scanner run over fixtures so neither the
// scanner nor the wording rule can silently weaken. No network, no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config/blueprint');
const { scanClaimText, allowedNumbersOf, claimsOf } = require('../services/blueprint/qa');
const { assembleBlueprint } = require('../services/blueprint/assemble');
const { normalisePlan } = require('../services/blueprint/planner');
const { normaliseInput } = require('../services/blueprint/input');
const sheet = require('./fixtures/blueprintSheet.json');
const good = require('./fixtures/blueprintPlanGood.json');
const bad = require('./fixtures/blueprintPlanBad.json');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const COPY_DOC = path.join(ROOT, '..', 'docs', 'superpowers', 'specs', 'assets', 'brand-growth-blueprint-copy-options.md');

const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}]/u;
const BANNED = ['unlock', 'seamless', 'amazing', 'magic', 'game-changer', 'supercharge', 'vibe', 'hey', 'oops', 'yay', 'awesome'];
const RULES = [
  ['exclamation mark', /!/],
  ['emoji', EMOJI],
  ['em dash', /—/],
  ['credit(s)', /\bcredits?\b/i],
  ['trial', /\btrial\b/i],
  ['7 days', /\b7 days?\b/i],
  ...BANNED.map((w) => [`banned word "${w}"`, new RegExp(`\\b${w}\\b`, 'i')])
];
const violationsOf = (s) => RULES.filter(([, re]) => re.test(s)).map(([name]) => name);

// String literals in source: `message: '...'`, the MSG table, GENERIC_ERROR, and limiter messages.
const literals = (src) => {
  const out = [];
  const grab = (re) => { let m; while ((m = re.exec(src))) out.push(m[1].replace(/\\'/g, "'")); };
  grab(/\bmessage:\s*'((?:[^'\\]|\\.)+)'/g);
  grab(/^\s+\w+:\s*'((?:[^'\\]|\\.)+)',?\s*$/gm); // object-table entries such as MSG
  grab(/\bGENERIC_ERROR\s*=\s*'((?:[^'\\]|\\.)+)'/g);
  grab(/makeLimiter\(\s*\d+\s*,\s*'((?:[^'\\]|\\.)+)'/g);
  return out;
};

// Sentences that must read as messages (end with a full stop).
const messages = [
  ...Object.values(config.STOP_MESSAGES),
  ...Object.values(config.WARNING_MESSAGES),
  ...literals(read('routes/blueprint.js')),
  ...literals(read('services/blueprint/service.js')).filter((s) => /\s/.test(s) && /^[A-Z]/.test(s))
];
const assembleSrc = read('services/blueprint/assemble.js');
// Every quoted phrase in assemble.js (headings, static sentences, notes); comment lines are skipped.
const quoted = [];
for (const line of assembleSrc.split('\n')) {
  if (/^\s*\/\//.test(line)) continue;
  let m; const re = /'((?:[^'\\]|\\.)+)'/g;
  while ((m = re.exec(line))) quoted.push(m[1].replace(/\\'/g, "'"));
}
const staticSentences = quoted.filter((s) => /\s/.test(s) && !/^[a-z-]+$/.test(s) && !/[=<>{}]/.test(s));
const labels = [
  config.LIMITED_NOTE,
  ...config.PAGES.flatMap((p) => [p.title, p.purpose]),
  ...config.PHASES.flatMap((p) => [p.title, p.label])
];
const all = [...new Set([...messages, ...staticSentences, ...labels])];

test('the string collection is not empty (the scan cannot pass by finding nothing)', () => {
  assert.ok(messages.length >= 15, `only ${messages.length} messages found`);
  assert.ok(staticSentences.length >= 5, `only ${staticSentences.length} static sentences found`);
  assert.ok(labels.length >= 20);
});

test('no customer-facing backend string breaks the wording rules', () => {
  const found = all.map((s) => ({ s, v: violationsOf(s) })).filter((x) => x.v.length);
  assert.deepEqual(found, []);
});

test('every message ends with a full stop', () => {
  const missing = [...new Set(messages)].filter((s) => !s.endsWith('.'));
  assert.deepEqual(missing, []);
});

test('the wording rule itself catches each forbidden thing', () => {
  for (const s of ['Great!', 'Nice \u{1F600}', 'A — B', 'Your credits', 'Free trial', 'For 7 days', 'Unlock it', 'Hey you', 'Seamless flow']) {
    assert.ok(violationsOf(s).length > 0, s);
  }
  assert.deepEqual(violationsOf('Your Blueprint is ready.'), []);
});

test('the copy options document holds the three options and no exclamation mark', () => {
  assert.ok(fs.existsSync(COPY_DOC), 'the copy options document is missing');
  const doc = fs.readFileSync(COPY_DOC, 'utf8');
  assert.ok(!doc.includes('!'), 'exclamation mark in the copy document');
  assert.ok(!EMOJI.test(doc) && !doc.includes('—'));
  assert.ok(!/\bcredits?\b|\btrial\b|\b7 days?\b/i.test(doc));
  const options = {
    'Option A': ['Get your Brand Growth Blueprint, free', 'Answer a few questions about your business. Nebulaa reads the pages you point to and writes a printable 90-day growth plan. Every statement in it is marked as verified or as a suggestion, so you can see what is fact and what is advice.', 'A written growth plan for your business, free.', 'Tell Nebulaa about your business. You receive a printable Brand Growth Blueprint with what Nebulaa confirmed about your brand, who to speak to, what to post and what to do first.', 'Get my free Blueprint', 'It uses a small number of your 100 free Quarks.'],
    'Option B': ['Your brand, planned for 90 days', 'Share your website and a few details. Nebulaa prepares a Brand Growth Blueprint: your audience, your content themes, a month of post ideas and the first steps to take. It is free to create.', 'See your next 90 days of marketing on paper.', 'The Blueprint shows what Nebulaa could confirm about your business, then proposes a plan you can print, share with your team or turn into posts.', 'Create my Blueprint', 'It uses a small number of your 100 free Quarks.'],
    'Option C': ['A growth plan that shows its sources', 'Most marketing plans mix facts with guesses. The Nebulaa Brand Growth Blueprint labels each statement as verified, inferred, proposed or unverified. Create yours free.', 'A marketing plan that separates facts from suggestions.', 'Every statement in your Blueprint is labelled, so you always know what Nebulaa confirmed from your own pages and what it is recommending.', 'Get my free Blueprint', 'It uses a small number of your 100 free Quarks.']
  };
  for (const [name, lines] of Object.entries(options)) {
    assert.ok(doc.includes(name), name);
    assert.ok(lines[0].length <= 40, `${name} ad headline is over 40 characters`);
    for (const l of lines) assert.ok(doc.includes(l), `${name} is missing: ${l}`);
  }
  assert.match(doc, /Recommendation/);
});

const input = normaliseInput({
  businessName: 'Sweet Co', website: 'sweetco.in', whatYouSell: 'Custom cakes baked to order.', whoItsFor: 'Families in Chennai', goal: 'enquiries', city: 'Chennai',
  offers: [{ name: 'Birthday cake', price: '₹499' }], competitors: [{ name: 'Rival Cakes', url: 'https://rivalcakes.in' }, { name: 'Other Bakery' }]
}).input;

test('every Inference and Proposed text in the assembled good fixture passes the scanner', () => {
  const { plan } = normalisePlan(JSON.parse(JSON.stringify(good)), sheet);
  const doc = assembleBlueprint({ input, sheet, plan, direction: null, mode: 'auto', now: new Date('2026-10-04T10:00:00Z') });
  const allowedNumbers = allowedNumbersOf(sheet);
  let checked = 0;
  const bad2 = [];
  const check = (c, where) => {
    if (!c || (c.tag !== 'inference' && c.tag !== 'proposed')) return;
    checked += 1;
    const v = scanClaimText(c.text, { allowedNumbers });
    if (v.length) bad2.push({ where, text: c.text, v });
  };
  doc.pages.forEach((p, pi) => p.sections.forEach((s, si) => claimsOf(s).forEach((c, ci) => check(c, `${pi}.${si}.${ci}`))));
  check(doc.cover && doc.cover.promise, 'cover.promise');
  assert.ok(checked >= 15, `only ${checked} claims checked`);
  assert.deepEqual(bad2, []);
});

// Each injected case in blueprintPlanBad.json (whereToday entries) with the rule it must trip.
const INJECTED = [
  ['Sell cakes at 299', 'invented_number'],
  ['Customers love our cakes', 'testimonial'],
  ['Our award-winning team', 'award'],
  ['Email hello@sweetco.in', 'invented_contact'],
  ['"The best cake I ever tasted in Chennai"', 'invented_quote'],
  ['Over 10,000 followers', 'follower_claim']
];
for (const [text, rule] of INJECTED) {
  test(`the scanner flags the injected case: ${text}`, () => {
    const item = bad.whereToday.find((c) => c.text === text);
    assert.ok(item, 'the case is missing from blueprintPlanBad.json');
    const rules = scanClaimText(item.text, { allowedNumbers: [] }).map((v) => v.rule);
    assert.ok(rules.length >= 1);
    assert.ok(rules.includes(rule), `${rule} not in ${rules}`);
  });
}
