'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const planner = require('../services/blueprint/planner');
const { buildBlueprint, proposeDirections } = require('../services/blueprint/pipeline');
const { claimsOf } = require('../services/blueprint/qa');
const { NEBULAA, PAGES, LIMITED_NOTE, WARNING_MESSAGES } = require('../config/blueprint');
const { normaliseInput } = require('../services/blueprint/input');
const sheet = require('./fixtures/blueprintSheet.json');
const good = require('./fixtures/blueprintPlanGood.json');
const bad = require('./fixtures/blueprintPlanBad.json');

const input = normaliseInput({
  businessName: 'Sweet Co', website: 'sweetco.in', whatYouSell: 'Custom cakes baked to order.', whoItsFor: 'Families in Chennai', goal: 'enquiries', city: 'Chennai',
  offers: [{ name: 'Birthday cake', price: '₹499' }], competitors: [{ name: 'Rival Cakes', url: 'https://rivalcakes.in' }, { name: 'Other Bakery' }]
}).input;
const NOW = new Date('2026-10-04T10:00:00Z');
const clone = (o) => JSON.parse(JSON.stringify(o));
const fakeLLM = (payload) => { const f = async (prompt, opts) => { f.calls.push({ prompt, opts }); return typeof payload === 'string' ? payload : JSON.stringify(payload); }; f.calls = []; return f; };
const deps = (payload) => ({ callLLM: fakeLLM(payload), parseJSON: JSON.parse });

test('buildPlanVars: typed and page facts with ids; competitor facts only in competitors; no visitor identity', () => {
  const v = planner.buildPlanVars(sheet, { ...input, email: 'owner@example.com', userId: 'u123' }, null);
  assert.match(v.facts, /F5 \[typed: offer\] Offer: Birthday cake, ₹499/);
  assert.match(v.facts, /F6 \[page: page title\]/);
  assert.ok(!v.facts.includes('F9') && !v.facts.includes('Rival'));
  assert.match(v.competitors, /F9/);
  assert.match(v.unverified, /Instagram page/);
  assert.ok(!JSON.stringify(v).includes('owner@example.com') && !JSON.stringify(v).includes('u123'));
  assert.match(v.formats, /image post/);
  assert.match(v.channels, /WhatsApp/);
  assert.match(v.territory, /Propose/);
  assert.match(planner.buildPlanVars(sheet, input, { name: 'Baked for your table' }).territory, /Baked for your table/);
});

test('runPlan sends the golden rule once with the exact options', async () => {
  const d = deps(good);
  const r = await planner.runPlan({ sheet, input, direction: null, ...d });
  assert.equal(d.callLLM.calls.length, 1);
  assert.deepEqual(d.callLLM.calls[0].opts, { jsonMode: true, temperature: 0.4, maxTokens: 6500, skipCache: true });
  assert.ok(d.callLLM.calls[0].prompt.includes('THE GOLDEN RULE'));
  assert.equal(r.plan.pillars.length, 4);
});

test('normalisePlan(good) keeps everything', () => {
  const r = planner.normalisePlan(clone(good), sheet);
  assert.equal(r.plan.pillars.length, 4);
  assert.equal(r.plan.calendar.length, 30);
  assert.deepEqual(r.dropped, []);
  assert.equal(r.plan.offers[0].factId, 'F5');
});

test('normalisePlan(bad) removes every injected item and can never produce Verified', () => {
  const r = planner.normalisePlan(clone(bad), sheet);
  const s = JSON.stringify(r.plan);
  for (const gone of ['299', 'love our cakes', 'award', 'hello@sweetco.in', 'best cake I ever tasted', '10,000', 'exciting launch', '—', 'Ghost', 'TikTok']) assert.ok(!s.includes(gone), gone);
  assert.ok(!s.includes('"verified"'));
  const downgraded = r.plan.whereToday.find((c) => c.text === 'Sweet Co sells custom cakes to order.');
  assert.ok(downgraded && downgraded.tag === 'inference' && downgraded.factIds.join() === 'F2');
  const ghost = r.plan.whereToday.find((c) => c.text === 'The business has a loyal base of buyers.');
  assert.ok(ghost && ghost.tag === 'proposed' && !ghost.factIds, 'an inference citing F99 becomes a proposal');
  assert.ok(r.dropped.length >= 8, String(r.dropped.length));
  assert.ok(r.plan.channels.every((c) => ['Instagram', 'WhatsApp', 'Google Business Profile'].includes(c.channel)));
});

test('an inference with no real fact behind it becomes a proposal', () => {
  const g = clone(good);
  g.whereToday = [{ text: 'The business has a loyal base of buyers.', tag: 'inference', factIds: ['F99'] }, { text: 'The business serves one city.', tag: 'inference' }];
  const r = planner.normalisePlan(g, sheet);
  assert.ok(r.plan.whereToday.every((c) => c.tag === 'proposed' && !c.factIds));
});

test('fewer than three pillars or too few calendar days gives null', () => {
  const a = clone(good); a.pillars = a.pillars.slice(0, 2);
  assert.equal(planner.normalisePlan(a, sheet), null);
  const b = clone(good); b.calendar = b.calendar.slice(0, 10);
  assert.equal(planner.normalisePlan(b, sheet), null);
  assert.equal(planner.normalisePlan(null, sheet), null);
  assert.equal(planner.normalisePlan({}, sheet), null);
});

test('offers map only to typed offer facts; labels are scanned', () => {
  const g = clone(good);
  g.offers.push({ factId: 'F6', hook: { text: 'Mention the page.', tag: 'proposed' }, cta: { text: 'Ask.', tag: 'proposed' } });
  g.pillars[3].name = 'Top 10 cakes';
  const r = planner.normalisePlan(g, sheet);
  assert.deepEqual(r.plan.offers.map((o) => o.factId), ['F5']);
  assert.equal(r.plan.pillars.length, 3);
  assert.ok(r.plan.calendar.every((c) => c.pillar !== 'Top 10 cakes'));
});

test('buildBlueprint(good): passes, nine pages in order, cover and closing exact, typed prices exact', async () => {
  const { result, qa } = await buildBlueprint({ input, sheet, mode: 'auto', now: NOW }, deps(good));
  assert.equal(qa.passed, true);
  assert.deepEqual(result.pages.map((p) => p.id), PAGES.map((p) => p.id));
  assert.equal(result.cover.limitedNote, null);
  assert.deepEqual(result.closing.contact, NEBULAA);
  assert.equal(result.closing.heading, 'Turn this plan into posts in Nebulaa');
  const offers = result.pages[5].sections[0].items;
  assert.deepEqual(offers.map((o) => [o.name, o.price]), [['Birthday cake', '₹499']]);
  assert.equal(offers[0].fact.tag, 'verified');
  assert.equal(result.cover.logo.url, 'https://sweetco.in/icon.png');
  assert.equal(result.generatedAt, NOW.toISOString());
  // page 3: researched competitor with verified facts, the other one as unverified
  const p3 = result.pages[2].sections;
  assert.equal(p3[0].items[0].name, 'Rival Cakes');
  assert.ok(p3[0].items[0].observations.some((o) => o.tag === 'verified' && o.factId === 'F9'));
  assert.ok(p3[1].items.some((o) => o.tag === 'unverified'));
});

test('limited basis adds the cover note; warnings are carried visibly', async () => {
  const s = { ...clone(sheet), basis: 'limited', warnings: [{ reason: 'identity_mismatch', message: WARNING_MESSAGES.identity_mismatch }] };
  const { result } = await buildBlueprint({ input, sheet: s, mode: 'auto', now: NOW }, deps(good));
  assert.equal(result.cover.limitedNote, LIMITED_NOTE);
  assert.equal(result.cover.warnings[0].message, WARNING_MESSAGES.identity_mismatch);
});

test('no offers and no competitors typed: static proposed sentences, nothing invented', async () => {
  const bare = { ...input, offers: [], competitors: [] };
  const s = clone(sheet); s.facts = s.facts.filter((f) => f.kind !== 'competitor_page' && f.field !== 'Offer'); s.unverified = [];
  const g = clone(good); g.offers = []; g.competitors = [];
  const { result, qa } = await buildBlueprint({ input: bare, sheet: s, mode: 'auto', now: NOW }, deps(g));
  assert.equal(qa.passed, true);
  const p3 = result.pages[2].sections[0].items[0];
  assert.equal(p3.text, 'Add the names and addresses of up to three competitors to see this page.');
  assert.equal(p3.tag, 'proposed');
  assert.equal(result.pages[5].sections[0].items[0].text, 'Add up to three of your real offers, with their prices, to see hooks written for them.');
});

test('buildBlueprint(bad): invented-heavy output fails the gate with too_many_removed; a milder one passes with the removals recorded', async () => {
  const heavy = await buildBlueprint({ input, sheet, mode: 'auto', now: NOW }, deps(bad));
  assert.equal(heavy.qa.passed, false);
  assert.ok(heavy.qa.flags.some((f) => f.rule === 'too_many_removed'));
  const mild = clone(good);
  mild.whereToday.push({ text: 'Sell cakes at 299', tag: 'inference', factIds: ['F1'] }, { text: 'Customers love our cakes', tag: 'inference', factIds: ['F1'] });
  const r = await buildBlueprint({ input, sheet, mode: 'auto', now: NOW }, deps(mild));
  assert.equal(r.qa.passed, true);
  assert.equal(r.qa.flags.find((f) => f.rule === 'removed_items').level, 'note');
  assert.ok(!JSON.stringify(r.result).includes('299'));
});

test('a model that returns {} throws', async () => {
  await assert.rejects(() => buildBlueprint({ input, sheet, mode: 'auto', now: NOW }, deps({})), /planner returned no usable plan/);
});

test('guided mode uses the chosen direction as the territory', async () => {
  const direction = { name: 'Baked for your table', rationale: { text: 'It works for every product.', tag: 'proposed' }, risk: { text: 'It may sound general.', tag: 'proposed' } };
  const g = clone(good); g.positioning.territory.name = 'Something else';
  const { result, qa } = await buildBlueprint({ input, sheet, direction, mode: 'guided', now: NOW }, deps(g));
  assert.equal(qa.passed, true);
  const t = result.pages[1].sections.find((s) => s.heading === 'The territory').items;
  assert.equal(t[0].text, 'Baked for your table');
});

test('proposeDirections returns two to four, or [] when fewer than two survive', async () => {
  const d = (n, extra = []) => ({ directions: [...Array(n).fill(0).map((_, i) => ({ name: ['Baked for your table', 'Made for the occasion', 'Honest ingredients', 'The craft behind the cake'][i], rationale: { text: 'It fits what the business sells.', tag: 'proposed' }, risk: { text: 'It needs real photographs.', tag: 'proposed' } })), ...extra] });
  assert.equal((await proposeDirections({ input, sheet }, deps(d(3)))).length, 3);
  assert.equal((await proposeDirections({ input, sheet }, deps(d(6)))).length, 4);
  assert.deepEqual(await proposeDirections({ input, sheet }, deps(d(1))), []);
  const poisoned = d(2); poisoned.directions[1].name = 'Number one in 5 cities';
  assert.deepEqual(await proposeDirections({ input, sheet }, deps(poisoned)), []);
  assert.deepEqual(await proposeDirections({ input, sheet }, deps({})), []);
});

test('blueprint services use no outside-service module', () => {
  const dir = path.join(__dirname, '../services/blueprint');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const banned of ["require('../scraper')", 'socialMediaAPI', 'campaignPublisher', 'ayrshare', 'serperLookup', 'zoho', 'emailService']) assert.ok(!src.includes(banned), `${f} ${banned}`);
  }
});

test('claimsOf covers every section kind', () => {
  assert.deepEqual(claimsOf({ kind: 'claims', items: [{ text: 'a', tag: 'proposed' }] }).length, 1);
  assert.equal(claimsOf({ kind: 'pillars', items: [{ name: 'x', why: { text: 'a', tag: 'proposed' }, example: null }] }).length, 1);
  assert.equal(claimsOf({ kind: 'phases', items: [{ focus: { text: 'f', tag: 'proposed' }, actions: [{ text: 'a', tag: 'proposed' }], measure: [] }] }).length, 2);
});

test('tag laundering: an inference whose figures or names are not in the cited fact is removed; a supported one stays', () => {
  const g = clone(good);
  g.whereToday = [
    { text: 'Twenty five years of craft behind every cake.', tag: 'inference', factIds: ['F2'] },
    { text: 'Founded by Meera Rao, the bakery serves families.', tag: 'inference', factIds: ['F2'] },
    { text: 'Custom cakes baked to order suit families in Chennai.', tag: 'inference', factIds: ['F2', 'F3'] }
  ];
  const r = planner.normalisePlan(g, sheet);
  const texts = r.plan.whereToday.map((c) => c.text);
  assert.ok(!texts.some((t) => t.includes('Twenty five') || t.includes('Meera')));
  assert.ok(texts.includes('Custom cakes baked to order suit families in Chennai.'));
});
