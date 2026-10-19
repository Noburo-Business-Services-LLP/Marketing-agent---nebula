'use strict';
// Planner additions (Home and plan Task 4): products, place and business details as input; the fixed offline list;
// the metrics block; the code-made marketing mix; wording checks; the cut-answer repair and retry; old plans.
// Every model call here is a fake.
const test = require('node:test');
const assert = require('node:assert');
const { inputFromProfile, profileComplete } = require('../services/plan/profileInput');
const { normaliseInput } = require('../services/blueprint/input');
const { typedFacts, verifyFacts, evaluateStop } = require('../services/blueprint/discovery');
const planner = require('../services/blueprint/planner');
const { buildBlueprint, scanPlanExtras } = require('../services/blueprint/pipeline');
const { repairTruncated, readPlanAnswer } = require('../services/blueprint/planJson');
const { scanPlanWording } = require('../services/blueprint/qa');
const { getPrompt, renderTemplate } = require('../services/promptRegistry');
const { createBlueprintService } = require('../services/blueprint/service');
const { makeDeps } = require('./blueprintFakes');
const { OFFLINE_CHANNELS, PLAN_METRICS, PLAN_LIMITS, PLAN_MAX_TOKENS } = require('../config/blueprint');
const { ACTION_USD, QUARK_COSTS, TOKENS } = require('../config/apiCosts');
const sheetFixture = require('./fixtures/blueprintSheet.json');
const good = require('./fixtures/blueprintPlanGood.json');
const fresh = require('./fixtures/blueprintPlanNew.json');

const clone = (o) => JSON.parse(JSON.stringify(o));
const quiet = async (fn) => { const w = console.warn; const e = console.error; console.warn = () => {}; console.error = () => {}; try { return await fn(); } finally { console.warn = w; console.error = e; } };
const NOW = new Date('2026-10-19T10:00:00Z');

const user = (over = {}) => ({
  _id: 'u1', companyName: 'Sweet Co', connectedSocials: [],
  businessProfile: {
    name: 'Sweet Co', website: 'sweetco.in', description: 'Custom cakes baked to order for birthdays', targetAudience: 'Families in Chennai',
    marketingGoals: ['Get more enquiries'], businessLocation: 'Anna Nagar, Chennai 600040', businessType: 'B2C', reachAreas: ['neighbourhood', 'city'],
    pricePositioning: 'premium', keyDifferentiator: 'Every cake is drawn with the family before it is baked.', industry: 'Bakery', contentLanguage: 'tamil_english_mix',
    ...over
  }
});
const products = (n) => Array.from({ length: n }, (_, i) => ({ name: `Cake ${i + 1}`, type: i % 2 ? 'service' : 'product', price: 499 + i, description: 'A soft sponge with fresh cream. '.repeat(10), keyFeatures: ['Eggless'] }));

// A sheet with the account's own facts, as discovery makes it.
function sheetWith(input) {
  const base = clone(sheetFixture);
  const extra = typedFacts(input).filter((f) => !['Business name', 'What you sell', 'Who it is for', 'Main goal', 'Offer', 'City', 'Website'].includes(f.field));
  const start = base.facts.length;
  base.facts.push(...extra.map((f, i) => ({ id: `F${start + i + 1}`, tag: 'verified', subject: null, ...f })));
  return base;
}

// ---- 1. Input ----
test('the plan input carries products, the place and the typed business details, capped', () => {
  const input = inputFromProfile(user(), { products: products(9) });
  assert.strictEqual(input.products.length, PLAN_LIMITS.MAX_PRODUCTS);
  assert.deepStrictEqual(input.products[0], { name: 'Cake 1', kind: 'product', price: 'Rs 499', about: 'A soft sponge with fresh cream. '.repeat(10).trim() });
  assert.strictEqual(input.products[1].kind, 'service');
  assert.strictEqual(input.city, 'Anna Nagar, Chennai', 'the postcode is cut');
  assert.strictEqual(input.businessType, 'B2C');
  assert.deepStrictEqual(input.reachAreas, ['neighbourhood', 'city']);
  assert.strictEqual(input.contentLanguage, 'tamil_english_mix');
  const n = normaliseInput(input, { allowGuided: true });
  assert.strictEqual(n.ok, true, JSON.stringify(n.errors));
  assert.strictEqual(n.input.products.length, PLAN_LIMITS.MAX_PRODUCTS);
  assert.ok(n.input.products.every((p) => p.about.length <= PLAN_LIMITS.PRODUCT_TEXT && p.name.length <= PLAN_LIMITS.PRODUCT_NAME));
  assert.strictEqual(n.input.city, 'Anna Nagar, Chennai');
  assert.strictEqual(n.input.pricePositioning, 'premium');
});

test('a price note wins, a missing price is left out, and the profile check is unchanged by products', () => {
  const input = inputFromProfile(user(), { products: [{ name: 'Tasting box', priceNote: 'From Rs 299 a box' }, { name: 'Consultation', type: 'service' }, { name: '' }, null] });
  assert.deepStrictEqual(input.products.map((p) => p.price), ['From Rs 299 a box', '']);
  assert.deepStrictEqual(profileComplete(user()), { complete: true, missing: [] });
  assert.ok(!('products' in inputFromProfile(user())), 'no products, no field');
});

test('odd values are dropped by the input check, and an older reach answer is read', () => {
  const n = normaliseInput({ businessName: 'Sweet Co', website: 'sweetco.in', whatYouSell: 'Custom cakes baked to order.', whoItsFor: 'Families', goal: 'enquiries', businessType: 'B2Z', reachAreas: ['mars', 'city', 'city'], pricePositioning: 'cheap', contentLanguage: 'english', products: [{ name: 'x'.repeat(300), price: '9'.repeat(50) }, { name: 'X'.repeat(300) }] });
  assert.strictEqual(n.ok, true);
  assert.ok(!('businessType' in n.input) && !('pricePositioning' in n.input) && !('contentLanguage' in n.input));
  assert.deepStrictEqual(n.input.reachAreas, ['city']);
  assert.strictEqual(n.input.products.length, 1, 'the same name twice is one product');
  assert.strictEqual(n.input.products[0].price.length, PLAN_LIMITS.PRODUCT_PRICE);
  assert.deepStrictEqual(inputFromProfile(user({ reachAreas: [], geographicReach: 'national' })).reachAreas, ['india']);
});

test('the business details become typed facts that pass verification, and products count as offers for the stop rule', () => {
  const input = normaliseInput(inputFromProfile(user(), { products: products(2) }), { allowGuided: true }).input;
  const facts = typedFacts(input);
  const fields = facts.map((f) => f.field);
  for (const f of ['Product', 'Industry', 'Sells to', 'Where customers are', 'Price level', 'What makes it different', 'Content language', 'City']) assert.ok(fields.includes(f), f);
  assert.ok(facts.find((f) => f.field === 'Product').text.startsWith('Product: Cake 1 (a product), Rs 499. A soft sponge'));
  assert.strictEqual(facts.find((f) => f.field === 'Content language').text, 'Content language: Tamil mixed with English');
  assert.strictEqual(facts.find((f) => f.field === 'Sells to').text, 'Sells to: individual customers');
  const v = verifyFacts(facts.map((f, i) => ({ id: `F${i + 1}`, ...f })), new Map(), input);
  assert.strictEqual(v.removed, 0);
  const thin = { ...input, websiteUrl: '', instagramUrl: '' };
  assert.ok(evaluateStop({ facts: [] }, { ...thin, products: [] }).stop, 'no evidence, a stop');
  assert.strictEqual(evaluateStop({ facts: [] }, thin).stop, null, 'two products are evidence enough');
});

// ---- 2. Prompt ----
test('the prompt names the products, the place, the facts and the two fixed lists', () => {
  const input = normaliseInput(inputFromProfile(user(), { products: products(8) }), { allowGuided: true }).input;
  const sheet = sheetWith(input);
  const text = renderTemplate(getPrompt('blueprint.plan').template, planner.buildPlanVars(sheet, input, null));
  assert.ok(!text.includes('{{'));
  assert.strictEqual((text.match(/\[typed: product\] Product: /g) || []).length, PLAN_LIMITS.MAX_PRODUCTS);
  for (const s of ['Content language: Tamil mixed with English', 'Sells to: individual customers', 'Where customers are: the neighbourhood and the city', 'Price level: premium', 'What makes it different:']) assert.ok(text.includes(s), s);
  for (const o of OFFLINE_CHANNELS) assert.ok(text.includes(`${o.id} (${o.name})`), o.id);
  for (const m of PLAN_METRICS) assert.ok(text.includes(`${m.id} (${m.name}`), m.id);
  assert.ok(text.includes('website_visits (Website visits, only with Website)'));
  assert.ok(text.includes('never write that Nebulaa makes, prints, runs, organises or attends anything offline'));
  assert.ok(text.includes('Write every sentence in English'));
  assert.ok(text.length < 16000, String(text.length));
});

// ---- 3. Offline, metrics and mix ----
test('a new-shape answer keeps the offline rows, the metrics and a mix worked out in code', () => {
  const out = planner.normalisePlan(clone(fresh), sheetFixture);
  const p = out.plan;
  assert.deepStrictEqual(p.offline.map((o) => o.id), ['referrals', 'counter', 'partnerships']);
  for (const o of p.offline) {
    assert.strictEqual(o.channel, OFFLINE_CHANNELS.find((x) => x.id === o.id).name);
    assert.deepStrictEqual(o.nebulaaDoes, []);
    assert.strictEqual(o.mode, 'offline');
    assert.strictEqual(o.reason.tag, 'proposed');
    assert.ok(o.youDo.length <= PLAN_LIMITS.MAX_YOU_DO && o.youDo.every((y) => y.tag === 'proposed'));
  }
  assert.deepStrictEqual(p.metrics.map((m) => m.id), ['enquiries', 'reach', 'posts_published', 'reviews', 'referral_customers']);
  const enq = p.metrics[0];
  assert.deepStrictEqual([enq.name, enq.where, enq.count], ['Enquiries', 'You count this', 'you']);
  assert.strictEqual(p.metrics[1].where, 'Performance');
  assert.strictEqual(enq.start.tag, 'proposed');
  assert.deepStrictEqual(p.mix.channels.map((r) => [r.channel, r.mode, r.organicPct, r.paidPct]), [
    ['Instagram', 'online', 80, 20], ['WhatsApp', 'online', 100, 0], ['Google Business Profile', 'online', 100, 0],
    ['Referrals and word of mouth', 'offline', 100, 0], ['In-store and at-counter prompts', 'offline', 100, 0], ['Partnerships with nearby businesses', 'offline', 100, 0]
  ]);
  assert.deepStrictEqual([p.mix.online, p.mix.offline, p.mix.paidTag, p.mix.paidBy], [3, 3, 'proposed', 'you']);
  assert.ok(p.effort.every((e) => e.mode === 'online'));
  assert.strictEqual(out.dropped.length, 0, JSON.stringify(out.dropped));
});

test('unknown, repeated or extra offline rows are removed, and no row may say Nebulaa does offline work', () => {
  const a = clone(fresh);
  const r = (id, text = 'It fits a shop that customers visit.') => ({ id, reason: { text, tag: 'inference', factIds: ['F2'] }, youDo: [{ text: 'Do it each week.', tag: 'proposed' }, { text: 'Two.', tag: 'proposed' }, { text: 'Three.', tag: 'proposed' }] });
  a.offline = [r('billboards_on_mars'), r('referrals'), r('referrals'), r('print', 'Nebulaa prints the flyers for you.'), r('LOCAL_EVENTS'), r('counter'), r('partnerships')];
  const out = planner.normalisePlan(a, sheetFixture);
  assert.deepStrictEqual(out.plan.offline.map((o) => o.id), ['referrals', 'local_events', 'counter']);
  assert.strictEqual(out.plan.offline[0].reason.tag, 'proposed', 'an offline line is always a suggestion');
  assert.strictEqual(out.plan.offline[0].youDo.length, 2);
  assert.strictEqual(out.plan.offline[1].spend, 'paid');
  assert.deepStrictEqual(out.plan.mix.channels.find((x) => x.channel === 'Local events and stalls').paidPct, 100);
  assert.ok(out.droppedExtra.some((d) => d.rules.includes('offline_nebulaa')));
  assert.strictEqual(out.dropped.length, 0, 'drops from the new blocks never count against a paid Blueprint');
});

test('metrics: unknown ids, ids whose channel is missing and extras are removed; a short block is topped up to three', () => {
  const a = clone(fresh);
  a.metrics = [{ id: 'roas' }, { id: 'website_visits', why: { text: 'Visits.', tag: 'proposed' } }, { id: 'event_contacts' }, { id: 'reach', why: { text: 'Reach grows by 50 percent.', tag: 'proposed' } }];
  const out = planner.normalisePlan(a, sheetFixture);
  assert.deepStrictEqual(out.plan.metrics.map((m) => m.id), ['reach', 'enquiries', 'posts_published']);
  assert.strictEqual(out.plan.metrics[0].why, null, 'an invented figure is removed, the fixed name stays');
  assert.ok(out.plan.metrics.slice(1).every((m) => m.auto === true && m.why === null));
  const many = clone(fresh);
  many.metrics = PLAN_METRICS.map((m) => ({ id: m.id }));
  assert.strictEqual(planner.normalisePlan(many, sheetFixture).plan.metrics.length, PLAN_LIMITS.MAX_METRICS);
  const none = clone(fresh); delete none.metrics;
  assert.deepStrictEqual(planner.normalisePlan(none, sheetFixture).plan.metrics, []);
});

test('an answer in the old shape (no offline, no metrics) is still a full plan', () => {
  const out = planner.normalisePlan(clone(good), sheetFixture);
  assert.ok(out);
  assert.deepStrictEqual(out.plan.offline, []);
  assert.deepStrictEqual(out.plan.metrics, []);
  assert.strictEqual(out.plan.mix.offline, 0);
  assert.ok(out.plan.mix.channels.every((r) => r.mode === 'online' && r.organicPct === null), 'no effort rows, no split invented');
});

test('offers may cite a product fact, never an invented one', () => {
  const input = normaliseInput(inputFromProfile(user(), { products: products(2) }), { allowGuided: true }).input;
  const sheet = sheetWith(input);
  const productId = sheet.facts.find((f) => f.field === 'Product').id;
  const a = clone(fresh);
  a.offers = [{ factId: productId, hook: { text: 'A cake drawn with the family first.', tag: 'proposed' }, cta: { text: 'Send a message to order.', tag: 'proposed' } }, { factId: 'F99', hook: { text: 'x', tag: 'proposed' } }];
  assert.deepStrictEqual(planner.normalisePlan(a, sheet).plan.offers.map((o) => o.factId), [productId]);
});

// ---- 4. Wording and language ----
test('vendor names and sentences not in English are removed, unless the business facts hold the word', () => {
  assert.deepStrictEqual(scanPlanWording('Use ChatGPT to plan.').map((x) => x.rule), ['vendor_name']);
  assert.deepStrictEqual(scanPlanWording('Orbit Cakes bakes daily.', 'Business name: Orbit Cakes'), []);
  assert.deepStrictEqual(scanPlanWording('உங்கள் கடைக்கு இன்று வாருங்கள்').map((x) => x.rule), ['not_english']);
  assert.deepStrictEqual(scanPlanWording('Show the முறுக்கு box at the counter.', 'Product: முறுக்கு box'), []);
  const a = clone(fresh);
  a.firstSteps = [{ text: 'Ask Gemini for captions.', tag: 'proposed' }, { text: 'உங்கள் கடைக்கு இன்று வாருங்கள் என்று சொல்லுங்கள்', tag: 'proposed' }, { text: 'Approve this week of posts.', tag: 'proposed' }];
  a.metrics[0].why = { text: 'Kling videos lift this.', tag: 'proposed' };
  const out = planner.normalisePlan(a, sheetFixture);
  assert.deepStrictEqual(out.plan.firstSteps.map((c) => c.text), ['Approve this week of posts.']);
  assert.strictEqual(out.plan.metrics[0].why, null);
  assert.ok(out.dropped.some((d) => d.rules.includes('vendor_name')) && out.dropped.some((d) => d.rules.includes('not_english')));
});

test('the extras scan in the pipeline also walks the offline and metrics lines', () => {
  const plan = planner.normalisePlan(clone(fresh), sheetFixture).plan;
  plan.offline[0].reason = { text: 'Sales will double!', tag: 'proposed' };
  plan.metrics[0].why = { text: 'Count 12000 calls.', tag: 'proposed' };
  const { plan: kept, dropped } = scanPlanExtras(plan, sheetFixture);
  assert.deepStrictEqual(kept.offline.map((o) => o.id), ['counter', 'partnerships']);
  assert.strictEqual(kept.mix.offline, 2);
  assert.ok(!kept.mix.channels.some((r) => r.channel === 'Referrals and word of mouth'));
  assert.strictEqual(kept.metrics[0].why, null);
  assert.ok(dropped.length >= 2);
  // an old stored plan without the new blocks passes through untouched
  const old = planner.normalisePlan(clone(good), sheetFixture).plan;
  delete old.offline; delete old.metrics; delete old.mix;
  const res = scanPlanExtras(old, sheetFixture).plan;
  assert.ok(!('offline' in res) && !('metrics' in res) && !('mix' in res));
});

// ---- 5. Cut answers ----
const cut = (obj, at) => { const s = JSON.stringify(obj, null, 2); return s.slice(0, typeof at === 'number' ? at : s.indexOf(at)); };

test('repairTruncated closes a cut answer at its last complete value, and leaves good or broken JSON alone', () => {
  assert.deepStrictEqual(repairTruncated('{"a": [1, 2, {"b": "x"}, {"c": "unfini'), { a: [1, 2, { b: 'x' }] });
  assert.deepStrictEqual(repairTruncated('```json\n{"a": {"b": [1, 2]}, "c": "tex'), { a: { b: [1, 2] } });
  assert.deepStrictEqual(repairTruncated('{"a": "with \\"quote\\" and , comma", "b'), { a: 'with "quote" and , comma' });
  assert.strictEqual(repairTruncated('{"a": 1}'), null, 'a whole answer needs no repair');
  assert.strictEqual(repairTruncated('{"a": [1}'), null, 'mismatched brackets are broken, not cut');
  assert.strictEqual(repairTruncated('not json'), null);
  assert.deepStrictEqual(readPlanAnswer('{"a":1}').repaired, false);
  assert.deepStrictEqual(readPlanAnswer('{"a":1,"b":[2').parsed, { a: 1 });
});

test('a cut that lost only the optional offline and metrics blocks is used at once, with one model call', async () => {
  const calls = [];
  const spend = [];
  const text = cut(fresh, '"offline"');
  const plan = await planner.runPlan({ sheet: sheetFixture, input: {}, direction: null, callLLM: async (p, o) => { calls.push(o); return text; }, parseJSON: JSON.parse, beforeCall: async (n) => spend.push(n) });
  assert.ok(plan && plan.repaired);
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(spend, [1], 'the ledger is written before the call');
  assert.strictEqual(calls[0].maxTokens, PLAN_MAX_TOKENS);
  assert.ok(plan.plan.firstSteps.length && plan.plan.roadmap.length === 3);
  assert.deepStrictEqual(plan.plan.offline, []);
});

test('a cut that lost the roadmap is asked for once more; the second, whole answer is used', async () => {
  let n = 0;
  const spend = [];
  const answers = [cut(fresh, '"roadmap"'), JSON.stringify(fresh)];
  const plan = await quiet(() => planner.runPlan({ sheet: sheetFixture, input: {}, direction: null, callLLM: async () => answers[n++], parseJSON: JSON.parse, beforeCall: async (k) => spend.push(k) }));
  assert.strictEqual(n, 2);
  assert.deepStrictEqual(spend, [1, 2], 'each call is counted before it is made');
  assert.ok(plan && !plan.repaired && plan.plan.offline.length === 3);
});

test('when both answers are cut, the best repaired plan is used rather than failing; a cut inside the calendar fails as before', async () => {
  let n = 0;
  const plan = await quiet(() => planner.runPlan({ sheet: sheetFixture, input: {}, direction: null, callLLM: async () => { n += 1; return cut(fresh, '"roadmap"'); }, parseJSON: JSON.parse }));
  assert.strictEqual(n, 2);
  assert.ok(plan && plan.repaired && plan.plan.calendar.length >= 20);
  assert.deepStrictEqual(plan.plan.roadmap, []);
  let m = 0;
  const early = await quiet(() => planner.runPlan({ sheet: sheetFixture, input: {}, direction: null, callLLM: async () => { m += 1; return cut(fresh, '"day": 6'); }, parseJSON: () => { throw new Error('no'); } }));
  assert.strictEqual(m, 2);
  assert.strictEqual(early, null);
});

test('the pipeline stores a repaired plan with a note, and a whole new-shape answer passes QA', async () => {
  const input = normaliseInput({ businessName: 'Sweet Co', website: 'sweetco.in', whatYouSell: 'Custom cakes baked to order.', whoItsFor: 'Families in Chennai', goal: 'enquiries', city: 'Chennai', offers: [{ name: 'Birthday cake', price: '₹499' }] }).input;
  const whole = await buildBlueprint({ input, sheet: sheetFixture, mode: 'auto', now: NOW }, { callLLM: async () => JSON.stringify(fresh), parseJSON: JSON.parse });
  assert.strictEqual(whole.qa.passed, true, JSON.stringify(whole.qa.flags));
  assert.strictEqual(whole.result.plan.offline.length, 3);
  assert.ok(!whole.qa.flags.some((f) => f.rule === 'plan_answer_cut'));
  const part = await buildBlueprint({ input, sheet: sheetFixture, mode: 'auto', now: NOW }, { callLLM: async () => cut(fresh, '"metrics"'), parseJSON: JSON.parse });
  assert.strictEqual(part.qa.passed, true);
  assert.strictEqual(part.result.plan.offline.length, 3);
  assert.deepStrictEqual(part.result.plan.metrics, []);
  assert.ok(part.qa.flags.some((f) => f.rule === 'plan_answer_cut'));
});

// ---- 6. Money: plan runs stay free, each model call is on the ledger first ----
test('a plan run records spend before each model call and charges nobody', async () => {
  const spent = [];
  let calls = 0;
  const answers = [cut(fresh, '"roadmap"'), JSON.stringify(fresh)];
  const deps = makeDeps({
    recordSpend: async (a, k) => spent.push([a, k, calls]),
    plan: { build: (a) => buildBlueprint(a, { callLLM: async () => answers[calls++], parseJSON: JSON.parse }), directions: async () => [] }
  });
  const svc = createBlueprintService(deps);
  const r = await svc.startSystem({ user: { _id: 'u1', email: 'owner@example.com' }, input: { businessName: 'Sweet Co', website: 'sweetco.in', whatYouSell: 'Custom cakes baked to order.', whoItsFor: 'Families in Chennai', goal: 'enquiries' }, kind: 'plan' });
  assert.ok(r.ok);
  await quiet(() => deps.drain());
  const doc = deps.Blueprint.docs[0];
  assert.strictEqual(doc.status, 'completed');
  assert.deepStrictEqual(spent, [['blueprint', 1, 0], ['blueprint', 1, 1]], 'one ledger line before each of the two calls');
  assert.deepStrictEqual(doc.charge, { state: 'none', quarks: 0 });
  assert.strictEqual(deps.calls.deduct.length + deps.calls.refund.length, 0);
  assert.strictEqual(doc.result.plan.metrics.length, 5);
});

test('the cost of a planner call is derived from the token estimate, and the price follows it', () => {
  assert.deepStrictEqual(TOKENS.blueprint_plan, { in: 5600, out: 5300 });
  assert.ok(Math.abs(ACTION_USD.blueprint - 0.187) < 0.0005, String(ACTION_USD.blueprint));
  assert.ok(QUARK_COSTS.blueprint >= 1);
  assert.ok(PLAN_MAX_TOKENS >= 2 * 4900 * 0.9, 'about twice the measured answer');
});
