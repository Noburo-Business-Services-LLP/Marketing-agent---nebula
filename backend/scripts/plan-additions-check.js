/**
 * Real-database check of the planner additions (products, place and business details in; offline, metrics and mix
 * out; the cut-answer repair and retry) against the DEVELOPMENT database. Refuses any database except nebulaa_dev.
 * NO real model call: the planner's model is a fake inside this process (the OpenAI and Gemini keys are blanked before
 * anything loads, and a guard counts any attempt to reach the network). The real plan service, Blueprint service,
 * Blueprint and Product collections, input check, typed facts, planner, QA and spend guard run.
 *   node scripts/plan-additions-check.js          run every check, print PASS/FAIL, then delete everything it made
 *   node scripts/plan-additions-check.js cleanup  delete leftovers of an interrupted run and print what is left
 * Everything belongs to throwaway users whose email starts with "zz.planaddchk-". The estimated spend the fake
 * planner calls add to today's AI spend record is taken off again at the end. Exit code is non-zero on any FAIL, or
 * if anything is left over.
 */
require('dotenv').config();
process.env.OPENAI_API_KEY = '';
process.env.GEMINI_API_KEY = '';
process.env.GOOGLE_API_KEY = '';
const mongoose = require('mongoose');
const assert = require('assert');

const PREFIX = 'zz.planaddchk-';
const DEV_DB = 'nebulaa_dev';

const results = [];
let section = '';
async function check(name, fn) {
  const label = `${section} ${name}`;
  try {
    const detail = await fn();
    results.push({ label, ok: true });
    console.log(`PASS  ${label}${detail ? ` (${detail})` : ''}`);
  } catch (e) {
    results.push({ label, ok: false, error: e && e.message });
    console.log(`FAIL  ${label}: ${e && e.message}`);
  }
}

function assertDevDatabase(name) {
  if (name !== DEV_DB) throw new Error(`Refusing: database is ${name}, not ${DEV_DB}`);
}
async function connect() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set (run from the backend folder so .env is found).');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  assertDevDatabase(mongoose.connection.name);
}

const spent = { usd: 0, day: new Date().toISOString().slice(0, 10) };

async function throwawayIds(db) {
  const rows = await db.collection('users').find({ email: { $regex: `^${PREFIX.replace(/\./g, '\\.')}` } }, { projection: { _id: 1 } }).toArray();
  return rows.map((u) => u._id);
}

async function cleanup(db) {
  const ids = await throwawayIds(db);
  const both = [...ids, ...ids.map(String)];
  const removed = {};
  if (ids.length) {
    const b = (await db.collection('blueprints').deleteMany({ userId: { $in: both } })).deletedCount;
    if (b) removed.blueprints = b;
    const p = (await db.collection('products').deleteMany({ user: { $in: ids } })).deletedCount;
    if (p) removed.products = p;
    const q = (await require('../models/QuarkLedger').deleteMany({ $or: [{ user: { $in: ids } }, { workspace: { $in: ids } }] })).deletedCount;
    if (q) removed.quark_ledger = q;
    const u = (await db.collection('users').deleteMany({ _id: { $in: ids } })).deletedCount;
    if (u) removed.users = u;
  }
  if (spent.usd > 0) {
    await db.collection('ai_spend_days').updateOne({ day: spent.day }, { $inc: { totalUsd: -spent.usd, 'byProvider.openai_text': -spent.usd } });
    removed.estimated_spend_usd = Math.round(spent.usd * 1e4) / 1e4;
    spent.usd = 0;
  }
  const leftIds = await throwawayIds(db);
  const leftBoth = [...leftIds, ...leftIds.map(String)];
  const left = {
    users: leftIds.length,
    blueprints: await db.collection('blueprints').countDocuments({ userId: { $in: leftBoth } }),
    products: await db.collection('products').countDocuments({ user: { $in: leftIds } })
  };
  const removedTotal = Object.entries(removed).filter(([k]) => k !== 'estimated_spend_usd').reduce((a, [, v]) => a + v, 0);
  console.log(`removed: ${JSON.stringify(removed)}`);
  console.log(`left: ${JSON.stringify(left)}`);
  return { removed, removedTotal, left };
}

async function runChecks() {
  const User = require('../models/User');
  const Product = require('../models/Product');
  const QuarkLedger = require('../models/QuarkLedger');
  const legal = require('../config/legalVersions');
  const { ACTION_USD } = require('../config/apiCosts');
  const { PLAN_LIMITS } = require('../config/blueprint');
  const { createPlanService, defaultDeps: planDeps } = require('../services/plan/planService');
  const { createBlueprintService, defaultDeps: bpDeps } = require('../services/blueprint/service');
  const { buildBlueprint } = require('../services/blueprint/pipeline');
  const { typedFacts, verifyFacts, evaluateStop } = require('../services/blueprint/discovery');
  const fresh = require('../tests/fixtures/blueprintPlanNew.json');

  // No network at all: any outside call is counted and refused.
  let outside = 0;
  const realFetch = global.fetch;
  global.fetch = async () => { outside += 1; throw new Error('network is off in this check'); };

  // Discovery without fetching anything: the typed facts only, verified and judged by the real code.
  const discover = async ({ input }) => {
    const raw = typedFacts(input).map((f, i) => ({ id: `F${i + 1}`, tag: 'verified', subject: null, ...f }));
    const { facts, removed } = verifyFacts(raw, new Map(), input);
    const sheet = { version: 1, client: { name: input.businessName, website: input.websiteUrl || '', instagram: '', city: input.city || '' }, facts, unverified: [], removed, assets: { logo: null, colours: [] }, missing: ['logo'], evidence: 0, basis: 'limited', stop: null, warnings: [] };
    const v = evaluateStop(sheet, input, { websiteRead: false, instagramRead: false });
    Object.assign(sheet, { evidence: v.evidence, basis: v.basis, stop: v.stop, warnings: v.warnings });
    return { sheet, sources: [] };
  };

  // The fake model: answers in order from a script, and keeps the prompts it was given.
  const model = { script: [], prompts: [], calls: 0 };
  const callLLM = async (prompt, opts) => { model.calls += 1; model.prompts.push({ prompt, opts }); const next = model.script.shift(); return typeof next === 'function' ? next() : next; };
  const queue = [];
  const bp = createBlueprintService({
    ...bpDeps(),
    discover,
    plan: { build: (a) => buildBlueprint(a, { callLLM, parseJSON: (t) => JSON.parse(t) }), directions: async () => [] },
    enqueue: (t) => { queue.push(t); },
    alertOwner: async () => {}
  });
  const plans = createPlanService({ ...planDeps(), startSystem: (a) => bp.startSystem(a) });
  const drain = async () => { while (queue.length) await queue.shift()(); };
  const quiet = async (fn) => { const w = console.warn; const e = console.error; console.warn = () => {}; console.error = () => {}; try { return await fn(); } finally { console.warn = w; console.error = e; } };

  const AiSpendDay = require('../models/AiSpendDay');
  const spendNow = async () => { const d = await AiSpendDay.findOne({ day: spent.day }).lean(); return Number(d && d.totalUsd) || 0; };

  const stamp = Date.now();
  const mkUser = (suffix, extra = {}) => User.create({
    email: `${PREFIX}${stamp}-${suffix}@example.test`, password: 'Check-only-1', firstName: `Check ${suffix}`, isVerified: true, onboardingCompleted: true,
    plan: { tier: 'starter', addons: [] },
    consent: { termsVersion: legal.TERMS_VERSION, privacyVersion: legal.PRIVACY_VERSION, acceptedAt: new Date(), source: 'realdb-check' },
    businessProfile: {
      name: `ZZ Bakes ${suffix}`, website: 'zzbakes-check.example', description: 'Custom cakes baked to order for birthdays', targetAudience: 'Families in Chennai',
      marketingGoals: ['Get more enquiries'], businessLocation: 'Anna Nagar, Chennai 600040', businessType: 'B2C', reachAreas: ['neighbourhood', 'city'],
      pricePositioning: 'premium', keyDifferentiator: 'Every cake is drawn with the family before it is baked.', industry: 'Bakery', contentLanguage: 'tamil_english_mix'
    },
    credits: { balance: 100 },
    ...extra
  });
  const mkProducts = (user) => Product.insertMany(Array.from({ length: PLAN_LIMITS.MAX_PRODUCTS + 1 }, (_, i) => ({
    user: user._id, name: `ZZ Cake ${i + 1}`, type: i === 1 ? 'service' : 'product', price: 499 + i * 100, ...(i === 2 ? { priceNote: 'From Rs 299 a box' } : {}),
    description: `A soft sponge number ${i + 1} with fresh cream.`, createdAt: new Date(Date.now() + i * 1000)
  })));
  const runsOf = (user) => mongoose.connection.db.collection('blueprints').find({ userId: { $in: [user._id, String(user._id)] } }).sort({ createdAt: 1 }).toArray();
  const ledgerOf = (user) => QuarkLedger.countDocuments({ $or: [{ user: user._id }, { workspace: user._id }] });
  const cut = (obj, at) => { const s = JSON.stringify(obj, null, 2); return s.slice(0, s.indexOf(at)); };
  const unit = ACTION_USD.blueprint;

  async function planRun(user, script) {
    model.script = script.slice();
    const before = { calls: model.calls, spend: await spendNow() };
    const r = await plans.startPlan({ userId: String(user._id) });
    await quiet(drain);
    const calls = model.calls - before.calls;
    spent.usd += calls * unit;
    const runs = await runsOf(user);
    return { r, calls, spendDelta: (await spendNow()) - before.spend, run: runs[runs.length - 1], runs };
  }

  // The other account: an old plan, stored before this change. It must not be touched.
  const other = await mkUser('other');
  await mongoose.connection.db.collection('blueprints').insertOne({
    blueprintId: `zz-old-${stamp}`, kind: 'plan', userId: other._id, status: 'completed', step: 'done', progress: 100, mode: 'auto', charge: { state: 'none', quarks: 0 },
    result: { version: 1, plan: { promise: { text: 'An older plan.', tag: 'proposed' }, channels: [{ channel: 'Instagram', priority: 1, role: { text: 'Show the cakes.', tag: 'proposed' } }], pillars: [], calendar: [], offers: [], roadmap: [], firstSteps: [] }, pages: [] },
    createdAt: new Date(Date.now() - 3 * 864e5), completedAt: new Date(Date.now() - 3 * 864e5)
  });
  const otherBefore = await User.findById(other._id).lean();

  try {
    section = '(1) new-shape answer:';
    const a = await mkUser('fresh');
    await mkProducts(a);
    const one = await planRun(a, [JSON.stringify(fresh)]);
    await check('the plan run completes with one model call and stays free', async () => {
      assert.ok(one.r.ok, JSON.stringify(one.r));
      assert.strictEqual(one.run.status, 'completed', String(one.run.status));
      assert.strictEqual(one.calls, 1);
      assert.deepStrictEqual(one.run.charge, { state: 'none', quarks: 0 });
      const u = await User.findById(a._id).lean();
      assert.strictEqual(u.credits.balance, 100);
      assert.strictEqual(await ledgerOf(a), 0);
      return `credits ${u.credits.balance}, ledger rows 0`;
    });
    await check('the model saw at most six products, the place and the business details', async () => {
      const { prompt, opts } = model.prompts[model.prompts.length - 1];
      assert.strictEqual((prompt.match(/\[typed: product\] Product: ZZ Cake /g) || []).length, PLAN_LIMITS.MAX_PRODUCTS);
      assert.ok(!prompt.includes(`ZZ Cake ${PLAN_LIMITS.MAX_PRODUCTS + 1}`));
      for (const s of ['ZZ Cake 1 (a product), Rs 499', 'ZZ Cake 2 (a service)', 'From Rs 299 a box', 'City: Anna Nagar, Chennai', 'Sells to: individual customers', 'Content language: Tamil mixed with English', 'Price level: premium']) assert.ok(prompt.includes(s), s);
      assert.ok(!prompt.includes('600040'), 'the postcode never reaches the model');
      assert.strictEqual(opts.maxTokens, require('../config/blueprint').PLAN_MAX_TOKENS);
      assert.strictEqual(one.run.input.products.length, PLAN_LIMITS.MAX_PRODUCTS);
      return `${prompt.length} prompt characters`;
    });
    await check('the stored plan holds offline rows, metrics and the mix; current plan returns it', async () => {
      const p = one.run.result.plan;
      assert.deepStrictEqual(p.offline.map((o) => o.id), ['referrals', 'counter', 'partnerships']);
      assert.ok(p.offline.every((o) => o.nebulaaDoes.length === 0 && o.reason.tag === 'proposed'));
      assert.strictEqual(p.metrics.length, 5);
      assert.deepStrictEqual(p.metrics.map((m) => m.count), ['you', 'nebulaa', 'nebulaa', 'you', 'you']);
      assert.strictEqual(p.mix.offline, 3);
      const cur = await plans.currentPlan(String(a._id));
      assert.strictEqual(cur.result.plan.offline.length, 3);
      return `${JSON.stringify(one.run.result).length} bytes stored`;
    });
    await check('spend was recorded once, before the call, at the derived price', async () => {
      assert.ok(Math.abs(one.spendDelta - unit) < 1e-6, `${one.spendDelta} vs ${unit}`);
      return `USD ${unit}`;
    });

    section = '(2) answer cut after the first steps:';
    const b = await mkUser('cut');
    await mkProducts(b);
    const two = await planRun(b, [cut(fresh, '"offline"')]);
    await check('used at once with a note; the optional blocks are empty, nothing charged', async () => {
      assert.strictEqual(two.run.status, 'completed');
      assert.strictEqual(two.calls, 1);
      assert.ok((two.run.qaFlags || []).some((f) => f.rule === 'plan_answer_cut'));
      assert.deepStrictEqual(two.run.result.plan.offline, []);
      assert.deepStrictEqual(two.run.result.plan.metrics, []);
      assert.strictEqual(two.run.result.plan.roadmap.length, 3);
      assert.strictEqual((await User.findById(b._id).lean()).credits.balance, 100);
      return 'one call';
    });

    section = '(3) answer cut inside the roadmap, then a whole one:';
    const c = await mkUser('retry');
    await mkProducts(c);
    const three = await planRun(c, [cut(fresh, '"roadmap"'), JSON.stringify(fresh)]);
    await check('asked once more, the whole answer is stored, both calls on the ledger', async () => {
      assert.strictEqual(three.run.status, 'completed');
      assert.strictEqual(three.calls, 2);
      assert.ok(Math.abs(three.spendDelta - 2 * unit) < 1e-6, `${three.spendDelta}`);
      assert.strictEqual(three.run.result.plan.offline.length, 3);
      assert.ok(!(three.run.qaFlags || []).some((f) => f.rule === 'plan_answer_cut'));
      assert.strictEqual(await ledgerOf(c), 0);
      return `USD ${Math.round(three.spendDelta * 1000) / 1000}`;
    });

    section = '(4) two unusable answers:';
    const d = await mkUser('junk');
    await mkProducts(d);
    const four = await planRun(d, ['{"not": "a plan"}', cut(fresh, '"day": 6')]);
    await check('the run fails after two calls; nothing charged, nothing refunded', async () => {
      assert.strictEqual(four.run.status, 'failed', String(four.run.status));
      assert.strictEqual(four.calls, 2);
      assert.deepStrictEqual(four.run.charge, { state: 'none', quarks: 0 });
      const u = await User.findById(d._id).lean();
      assert.strictEqual(u.credits.balance, 100);
      assert.ok(!(u.credits.history || []).length, 'no charge or refund history');
      assert.strictEqual(await ledgerOf(d), 0);
      return 'failed, uncharged';
    });

    section = '(5) the other account:';
    await check('its old plan reads as before and nothing of it changed', async () => {
      const cur = await plans.currentPlan(String(other._id));
      assert.ok(cur && cur.result.plan.promise.text === 'An older plan.');
      assert.ok(!('offline' in cur.result.plan) && !('metrics' in cur.result.plan));
      const after = await User.findById(other._id).lean();
      assert.strictEqual(after.credits.balance, otherBefore.credits.balance);
      assert.strictEqual(String(after.updatedAt), String(otherBefore.updatedAt));
      assert.strictEqual((await runsOf(other)).length, 1);
      assert.strictEqual(await ledgerOf(other), 0);
      return 'untouched';
    });

    section = '(6) safety:';
    await check('no outside call was made and no real model was reached', async () => {
      assert.strictEqual(outside, 0);
      assert.strictEqual(model.calls, 6);
      return `${model.calls} fake model calls`;
    });
  } finally {
    global.fetch = realFetch;
  }
}

(async () => {
  const mode = process.argv[2] || 'run';
  if (mode !== 'run' && mode !== 'cleanup') throw new Error('Usage: node scripts/plan-additions-check.js [run|cleanup]');
  await connect();
  console.log(`Database: ${DEV_DB}`);
  let failed = false;
  try {
    if (mode === 'run') await runChecks();
  } catch (e) {
    failed = true;
    console.log(`FAIL  (script) ${e && e.stack ? e.stack : e}`);
  } finally {
    console.log('--- cleanup ---');
    const out = await cleanup(mongoose.connection.db);
    const left = Object.values(out.left).reduce((x, y) => x + y, 0);
    if (mode === 'run') {
      const fails = results.filter((r) => !r.ok);
      console.log(`\n${results.length - fails.length} PASS, ${fails.length} FAIL; removed by cleanup: ${out.removedTotal}; left after cleanup: ${left}`);
      if (fails.length || left || failed) process.exitCode = 1;
    } else if (left) process.exitCode = 1;
  }
  await mongoose.disconnect();
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
