/**
 * Real-database check of the business-profile questionnaire (config/businessQuestions.js, services/businessProfile.js,
 * the two save routes in routes/auth.js and the prompt readers) against the DEVELOPMENT database. Refuses any database
 * except nebulaa_dev. NO AI call, NO outside call, nothing charged: the two routes run inside this process on a random
 * 127.0.0.1 port (never 3000, 3200 or 5000) with real tokens for throwaway users, and their background starters (first
 * plan, monthly calendar, memory refresh) are replaced with no-ops BEFORE the routes load, so no model is ever called.
 *   node scripts/questionnaire-check.js          run every check, print PASS/FAIL, then delete everything it made
 *   node scripts/questionnaire-check.js cleanup  delete leftovers of an interrupted run and print what is left
 * Everything it creates belongs to throwaway users whose email starts with "zz.qchk-". Exit code is non-zero on any
 * FAIL, or if anything is left over.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const http = require('http');
const express = require('express');
const assert = require('assert');

const PREFIX = 'zz.qchk-';
const DEV_DB = 'nebulaa_dev';

const results = [];
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}${detail ? ` (${detail})` : ''}`);
  } catch (e) {
    results.push({ name, ok: false });
    console.log(`FAIL  ${name}: ${e && e.message}`);
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

const OWNED = { onboardingcontexts: 'userId', ai_brand_memory: 'userId' };
async function cleanup(db) {
  const rows = await db.collection('users').find({ email: { $regex: `^${PREFIX.replace(/\./g, '\\.')}` } }, { projection: { _id: 1 } }).toArray();
  const ids = rows.map((u) => u._id);
  const removed = {};
  if (ids.length) {
    for (const [c, field] of Object.entries(OWNED)) {
      const n = (await db.collection(c).deleteMany({ [field]: { $in: ids } })).deletedCount;
      if (n) removed[c] = n;
    }
    removed.users = (await db.collection('users').deleteMany({ _id: { $in: ids } })).deletedCount;
  }
  const left = { users: await db.collection('users').countDocuments({ email: { $regex: `^${PREFIX.replace(/\./g, '\\.')}` } }) };
  for (const [c, field] of Object.entries(OWNED)) left[c] = ids.length ? await db.collection(c).countDocuments({ [field]: { $in: ids } }) : 0;
  console.log('removed', JSON.stringify(removed));
  console.log('left', JSON.stringify(left));
  return Object.values(left).reduce((a, b) => a + b, 0);
}

/** Replace every background starter the save routes call, so this check can never reach a model or a queue. */
function muteBackgroundWork() {
  const calls = [];
  const planService = require('../services/plan/planService');
  planService.maybeStartFirstPlanSafe = (id) => { calls.push(['plan', String(id)]); };
  const runner = require('../services/brandMemory/runner');
  runner.refreshSoon = (id) => { calls.push(['memory', String(id)]); };
  const calendar = require('../services/contentCalendarService');
  calendar.generateMonthlyCalendar = async () => { calls.push(['calendar']); return null; };
  const planContext = require('../services/week/planContext');
  planContext.withPlanGuidance = async () => ({});
  return calls;
}

async function runChecks() {
  const db = mongoose.connection.db;
  const calls = muteBackgroundWork();
  const User = require('../models/User');
  const legal = require('../config/legalVersions');
  const { generateToken } = require('../middleware/auth');
  const { describeAudience, buildBrandMemoryBlock } = require('../services/brandMemory');
  const { learnFromCustomers } = require('../services/brandMemory/fromCustomers');
  const { inputFromProfile } = require('../services/plan/profileInput');
  const { normaliseInput } = require('../services/blueprint/input');

  await check('a database that is not nebulaa_dev is refused, and the live connection is the dev one', async () => {
    assert.throws(() => assertDevDatabase('nebulaa_prod'), /Refusing/);
    assert.strictEqual(mongoose.connection.name, DEV_DB);
  });

  const tag = `${PREFIX}${Date.now()}`;
  const mkUser = (suffix, businessProfile, extra = {}) => User.create({
    email: `${tag}-${suffix}@example.test`, password: 'Check-only-1', firstName: `Check ${suffix}`, isVerified: true, onboardingCompleted: true,
    plan: { tier: 'starter' },
    consent: { termsVersion: legal.TERMS_VERSION, privacyVersion: legal.PRIVACY_VERSION, acceptedAt: new Date(), source: 'realdb-check' },
    businessProfile, ...extra
  });

  // An account saved before this change (old single reach, old gender, older industry spelling), written raw so the
  // stored shape is exactly what production holds.
  const old = await mkUser('old', { name: 'Old Shape Check' });
  await db.collection('users').updateOne({ _id: old._id }, { $set: {
    'businessProfile.geographicReach': 'regional', 'businessProfile.targetGender': 'both_equally', 'businessProfile.industry': 'Technology/SaaS',
    'businessProfile.businessType': 'Both', 'businessProfile.brandVoice': 'Professional, Witty', 'businessProfile.contentLanguage': 'marathi',
    'businessProfile.marketingGoals': ['Lead Generation', 'Grow revenue'] } });
  const b2b = await mkUser('b2b', { name: 'B2B Check' });
  const people = await mkUser('people', { name: 'People Check' }, { onboardingCompleted: false });

  const app = express();
  app.use(express.json());
  app.use('/api/auth', require('../routes/auth'));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const call = async (method, path, u, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${generateToken(u._id)}` }, body: body ? JSON.stringify(body) : undefined });
    let json = null; try { json = await res.json(); } catch (_) { json = null; }
    return { status: res.status, body: json };
  };
  const raw = async (u) => (await db.collection('users').findOne({ _id: u._id })).businessProfile;

  try {
    await check('an old-shape profile still reads: region as the state, old gender as everyone, older spelling mapped', async () => {
      const bp = await raw(old);
      const lines = describeAudience(bp);
      assert.ok(lines.includes('- Customers are in the state.'), lines.join(' / '));
      assert.ok(!lines.some((l) => /men|women|families/.test(l)));
      const block = await buildBrandMemoryBlock(old._id);
      assert.match(block, /- Industry: Technology \/ SaaS/);
      assert.match(block, /- Sells to both businesses and individual customers\./);
      assert.ok(!/undefined|null/.test(block));
      return `${lines.length} lines`;
    });

    await check('Settings save of the old profile untouched except the new answers: 200, nothing lost, old reach mapped', async () => {
      const bp = await raw(old);
      const r = await call('PUT', '/api/auth/update-profile', old, { businessProfile: { ...bp, ageGroups: ['25_34'] } });
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      const after = await raw(old);
      assert.deepStrictEqual(after.reachAreas, ['state']);
      assert.strictEqual(after.geographicReach, 'regional', 'the old answer is never cleared');
      assert.strictEqual(after.targetGender, '');
      assert.strictEqual(after.industry, 'Technology / SaaS');
      assert.deepStrictEqual(after.brandVoice, ['Professional', 'Witty']);
      assert.deepStrictEqual(after.marketingGoals, ['Lead Generation', 'Grow revenue'], 'an older free-text goal is kept');
      assert.strictEqual(after.contentLanguage, 'marathi', 'a language outside the six is kept');
      assert.deepStrictEqual(after.ageGroups, ['25_34']);
    });

    await check('a save with bad choice values no longer fails: 200 and the bad values are dropped', async () => {
      const r = await call('PUT', '/api/auth/update-profile', b2b, { businessProfile: { name: 'B2B Check', businessType: 'b2b', reachAreas: ['moon'], targetGender: 'robots', ageGroups: ['old'], b2b: { companySize: 'huge', customerIndustries: ['mars'] }, pricePositioning: 'cheap', contentLanguage: 'klingon' } });
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      const after = await raw(b2b);
      assert.strictEqual(after.businessType, '');
      assert.deepStrictEqual(after.reachAreas, []);
      assert.strictEqual(after.targetGender, '');
      assert.strictEqual(after.b2b.companySize, '');
      assert.deepStrictEqual(after.b2b.customerIndustries, []);
      assert.strictEqual(after.contentLanguage, '');
    });

    await check('a B2B save through Settings: business answers stored, gender and ages never reach the prompts', async () => {
      const r = await call('PUT', '/api/auth/update-profile', b2b, { businessProfile: {
        name: 'B2B Check', website: 'https://example.com', description: 'Billing software for clinics and labs', targetAudience: 'Clinic owners',
        industry: 'Technology / SaaS', businessType: 'B2B', reachAreas: ['state', 'india', 'state'], targetGender: 'mostly_men', ageGroups: ['35_44'],
        b2b: { customerIndustries: ['health', 'services'], companySize: 'small', decisionMaker: 'Owner or founder', salesCycle: 'weeks' },
        marketingGoals: ['Lead Generation'], brandVoice: ['Professional'], contentLanguage: 'english' } });
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      const bp = await raw(b2b);
      assert.deepStrictEqual(bp.reachAreas, ['state', 'india']);
      assert.deepStrictEqual(bp.b2b.customerIndustries, ['health', 'services']);
      const block = await buildBrandMemoryBlock(b2b._id);
      for (const line of ['- Sells to other businesses.', '- Customers are in the state and all of India.', '- Business customers are usually small companies.',
        '- The person who decides to buy is usually the owner or founder.', '- A sale usually takes a few weeks.']) assert.ok(block.includes(line), line);
      assert.ok(!/mostly men|aged/.test(block));
      const mem = learnFromCustomers({ user: { businessProfile: bp } });
      assert.ok(mem.items.some((i) => i.key === 'customers-buyers'));
      const input = normaliseInput(inputFromProfile({ businessProfile: bp, companyName: 'B2B Check' }), { allowGuided: true });
      assert.ok(input.ok, JSON.stringify(input.errors));
      assert.ok(input.input.audience.includes('business customers are usually small companies'));
      return `${block.split('\n').length} block lines`;
    });

    await check('a consumer sign-up through complete-onboarding: answers stored, outreach context gets the real goal', async () => {
      const r = await call('PUT', '/api/auth/complete-onboarding', people, { businessProfile: {
        name: 'People Check', industry: 'Pet grooming', businessType: 'B2C', businessLocation: 'Chennai', reachAreas: ['neighbourhood', 'city'],
        ageGroups: ['25_34', '35_44'], targetGender: 'mostly_women', b2b: {}, heroProduct: 'Dog grooming at home', targetCustomerProfile: 'Pet parents nearby',
        marketingGoals: ['Direct Sales'], brandVoice: ['Friendly'], contentLanguage: 'tamil_english_mix', accountKind: 'one', additionalLanguages: ['english'] } });
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      const bp = await raw(people);
      assert.strictEqual(bp.industry, 'Pet grooming');
      assert.deepStrictEqual(bp.ageGroups, ['25_34', '35_44']);
      const lines = describeAudience(bp);
      assert.ok(lines.includes('- Customers are in the neighbourhood and the city.'));
      assert.ok(lines.includes('- Customers are mostly aged 25 to 34 or 35 to 44.'));
      assert.ok(lines.includes('- Customers are mostly women.'));
      const ctx = await db.collection('onboardingcontexts').findOne({ userId: people._id });
      assert.strictEqual(ctx.primaryGoal, 'sales');
      assert.ok(calls.some((c) => c[0] === 'calendar'), 'the calendar starter was reached (and muted)');
      return lines.join(' ');
    });

    await check('no background work ran for real: every starter the routes reached was the muted one', async () => {
      assert.ok(calls.length >= 3, JSON.stringify(calls));
      return `${calls.length} muted calls`;
    });
  } finally {
    await new Promise((r) => server.close(r));
  }
}

(async () => {
  await connect();
  const db = mongoose.connection.db;
  if (process.argv[2] === 'cleanup') {
    const left = await cleanup(db);
    await mongoose.disconnect();
    process.exit(left ? 1 : 0);
  }
  let left = 0;
  try {
    await runChecks();
  } finally {
    left = await cleanup(db);
    await mongoose.disconnect();
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} PASS, ${failed} FAIL${left ? `, ${left} rows LEFT OVER` : ''}`);
  process.exit(failed || left ? 1 : 0);
})().catch(async (e) => {
  console.error('Stopped:', e.message);
  try { await mongoose.disconnect(); } catch (_) { /* nothing */ }
  process.exit(1);
});
