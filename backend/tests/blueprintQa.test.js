'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { scanClaimText, numbersIn, allowedNumbersOf, claimsOf, runQa } = require('../services/blueprint/qa');
const { assembleBlueprint } = require('../services/blueprint/assemble');
const { normalisePlan } = require('../services/blueprint/planner');
const { TAGS, NEBULAA, PAGES } = require('../config/blueprint');
const { normaliseInput } = require('../services/blueprint/input');
const sheet = require('./fixtures/blueprintSheet.json');
const good = require('./fixtures/blueprintPlanGood.json');

const input = normaliseInput({
  businessName: 'Sweet Co', website: 'sweetco.in', whatYouSell: 'Custom cakes baked to order.', whoItsFor: 'Families in Chennai', goal: 'enquiries', city: 'Chennai',
  offers: [{ name: 'Birthday cake', price: '₹499' }], competitors: [{ name: 'Rival Cakes', url: 'https://rivalcakes.in' }, { name: 'Other Bakery' }]
}).input;
const NOW = new Date('2026-10-04T10:00:00Z');
const build = () => {
  const { plan } = normalisePlan(JSON.parse(JSON.stringify(good)), sheet);
  return assembleBlueprint({ input, sheet, plan, direction: null, mode: 'auto', now: NOW });
};
const clone = (o) => JSON.parse(JSON.stringify(o));
const rulesOf = (r) => r.flags.filter((f) => f.level === 'block').map((f) => f.rule);

const SCAN = [
  ['A steady month of clear posts for families.', {}, []],
  ['Customers love our cakes and we are award-winning!', {}, ['testimonial', 'award', 'exclamation']],
  ['Your 499 rupee plan', { allowedNumbers: ['499'] }, []],
  ['Your 499 rupee plan', {}, ['invented_number']],
  ['Reach us at hello@cakes.in or +91 98765 43210', {}, ['invented_contact', 'invented_number']],
  ['Visit www.cakes.in', {}, ['invented_contact']],
  ['They said "the best cake I ever had in my life"', {}, ['invented_quote']],
  ['Over 10,000 followers and growing', {}, ['follower_claim', 'invented_number']],
  ['Publish daily — even on slow days', {}, ['em_dash']],
  ['Thousands of families trust us', {}, ['number_word']],
  ['A leading brand in Chennai', {}, ['ranking']],
  ['A warm cake \u{1F382} for you', {}, ['emoji']],
  ['This plan will double your sales', {}, ['guarantee']],
  ['Track the ROI of each post', {}, ['metric']]
];
for (const [text, ctx, want] of SCAN) {
  test(`scanClaimText: ${text}`, () => {
    const got = new Set(scanClaimText(text, ctx).map((v) => v.rule));
    for (const w of want) assert.ok(got.has(w), `${w} in ${[...got]}`);
    if (!want.length) assert.equal(got.size, 0);
  });
}

test('numbersIn and allowedNumbersOf', () => {
  assert.deepEqual(numbersIn('Rs 1,499. and 20'), ['1499', '20']);
  assert.deepEqual(allowedNumbersOf(sheet), ['499']);
});

test('the assembled good document passes the QA gate', () => {
  const doc = build();
  const r = runQa({ blueprint: doc, sheet, input, dropped: [] });
  assert.deepEqual(r.flags.filter((f) => f.level === 'block'), []);
  assert.equal(r.passed, true);
  assert.deepEqual(doc.pages.map((p) => p.id), PAGES.map((p) => p.id));
});

test('property: every claim is tagged and every Verified claim equals a sheet fact', () => {
  const doc = build();
  const facts = new Map(sheet.facts.map((f) => [f.id, f.text]));
  let verified = 0;
  let total = 0;
  for (const p of doc.pages) for (const s of p.sections) for (const c of claimsOf(s)) {
    total += 1;
    assert.ok(TAGS.includes(c.tag), JSON.stringify(c));
    if (c.tag === 'verified') { verified += 1; assert.equal(facts.get(c.factId), c.text); }
    if (c.tag === 'inference') assert.ok(c.factIds.every((id) => facts.has(id)));
  }
  assert.ok(total > 40 && verified >= 8);
});

const MUTATIONS = [
  ['remove a page', 'pages', (d) => { d.pages.splice(2, 1); }],
  ['reorder two pages', 'pages', (d) => { [d.pages[0], d.pages[1]] = [d.pages[1], d.pages[0]]; }],
  ['drop the closing page', 'closing', (d) => { delete d.closing; }],
  ['unknown tag', 'untagged', (d) => { d.pages[0].sections[0].items[0].tag = 'maybe'; }],
  ['verified with altered text', 'verified_not_in_sheet', (d) => { d.pages[0].sections[0].items[0].text += ' and more'; }],
  ['inference citing F99', 'inference_without_basis', (d) => { d.pages[0].sections[1].items[0].factIds = ['F99']; }],
  ['inference with no ids', 'inference_without_basis', (d) => { d.pages[0].sections[1].items[0].factIds = []; }],
  ['unverified without reason', 'unverified_reason', (d) => { delete d.pages[0].sections[2].items[0].reason; }],
  ['business name altered', 'brand_name', (d) => { d.cover.businessName = 'Sweet Company'; }],
  ['logo changed', 'logo_changed', (d) => { d.cover.logo.url = 'https://elsewhere.com/logo.png'; }],
  ['closing email altered', 'closing_contact', (d) => { d.closing.contact.email = 'hello@nebulaa.ai'; }],
  ['offer price not typed', 'offer_price', (d) => { d.pages[5].sections[0].items[0].price = '₹299'; }],
  ['only five calendar days', 'calendar_thin', (d) => { d.pages[4].sections[0].items = d.pages[4].sections[0].items.slice(0, 5); }],
  ['calendar pillar not in pillars', 'calendar_pillar', (d) => { d.pages[4].sections[0].items[0].pillar = 'Ghost'; }],
  ['two pillars', 'pillar_count', (d) => { d.pages[3].sections[0].items = d.pages[3].sections[0].items.slice(0, 2); }],
  ['channel outside the list', 'channel_not_allowed', (d) => { d.pages[6].sections[0].items[0].channel = 'TikTok'; }],
  ['invented price in a proposal', 'invented_number', (d) => { d.pages[8].sections[0].items[0].text = 'Sell cakes at 299.'; }],
  ['empty page', 'page_empty', (d) => { d.pages[8].sections = []; }]
];
for (const [name, rule, mutate] of MUTATIONS) {
  test(`QA flags: ${name}`, () => {
    const doc = clone(build());
    mutate(doc);
    const r = runQa({ blueprint: doc, sheet, input, dropped: [] });
    assert.ok(rulesOf(r).includes(rule), `${rule} in ${rulesOf(r)}`);
    assert.equal(r.passed, false);
  });
}

test('QA flags too many removed items, and notes a few', () => {
  assert.ok(rulesOf(runQa({ blueprint: build(), sheet, input, dropped: 7 })).includes('too_many_removed'));
  const few = runQa({ blueprint: build(), sheet, input, dropped: [{}, {}] });
  assert.equal(few.passed, true);
  assert.ok(few.flags.some((f) => f.level === 'note' && f.rule === 'removed_items'));
});

test('QA blocks a missing territory and a roadmap phase without a focus', () => {
  const a = clone(build());
  a.pages[1].sections = a.pages[1].sections.filter((s) => s.heading !== 'The territory');
  assert.ok(rulesOf(runQa({ blueprint: a, sheet, input, dropped: [] })).includes('territory'));
  const b = clone(build());
  b.pages[7].sections[0].items[1].focus = null;
  assert.ok(rulesOf(runQa({ blueprint: b, sheet, input, dropped: [] })).includes('roadmap'));
});

test('closing contact is exactly the Nebulaa constant', () => {
  assert.deepEqual(build().closing.contact, NEBULAA);
});

const HOSTILE = [
  'A twenty percent lift in a month', 'Twenty five years of craft', 'Established in nineteen ninety eight', 'One hundred happy bakes', 'Thirty cakes a week',
  'We were the first in Chennai', 'Ranked first in town', 'Ranked second in the city', 'Rated third by locals', 'No. one for cakes', 'The number one bakery', 'A top ten bakery',
  'Since 1998', 'Founded in ١٩٩٨', 'Since ௨௦௦௦', 'Over ２０ years', 'Visit example.com', 'See mybrand.in/shop', 'Mail hello @ example . com',
  'Mail hello [at] example dot com', 'Mail name at example dot com', 'The best in Chennai', 'Best in town', 'A top-rated bakery', 'A top rated bakery',
  'Voted favourite by locals', 'The leading bakery', 'The most trusted name', 'An award-winning team', 'The market leader', 'A world-class finish',
  'Our cakes cure stress', 'Guaranteed results for you', 'We guarantee joy', 'She said ‘the best cake I ever had in my life’', 'He said “the best cake I ever had”',
  'He said «the best cake I ever had»', "He said 'the best cake I ever had in life'", 'He said „the best cake I ever had“'
];
for (const text of HOSTILE) {
  test(`scanClaimText flags hostile claim: ${text}`, () => {
    assert.ok(scanClaimText(text, {}).length > 0);
  });
}
for (const text of ['One clear message for each post.', 'The first step is a steady plan.', "Sweet Co’s cakes and Rival’s bakes differ in style.", 'Three posts a week, then review at the end of the month.', 'Share a short story about the bake.']) {
  test(`scanClaimText leaves ordinary wording alone: ${text}`, () => {
    assert.deepEqual(scanClaimText(text, { allowedNumbers: [] }), []);
  });
}
