/**
 * Real-database check of "What Nebulaa learned" (services/brandMemory, routes/aiMemoryLearned.js) against the
 * DEVELOPMENT database. Refuses any database except nebulaa_dev. NO AI call, NO outside call, nothing charged: the
 * memory is computed in code from stored rows; the route runs inside this process on a random 127.0.0.1 port (never
 * 3000, 3200 or 5000) with real tokens for throwaway users. The daily job is run only over the throwaway accounts (its
 * account list and lease are replaced), so no real account's memory is touched.
 *   node scripts/brand-memory-check.js          run every check, print PASS/FAIL, then delete everything it made
 *   node scripts/brand-memory-check.js cleanup  delete leftovers of an interrupted run and print what is left
 * Everything it creates belongs to throwaway users whose email starts with "zz.memchk-". Exit code is non-zero on any
 * FAIL, or if anything is left over. Expected counts are worked out here with plain loops.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const http = require('http');
const express = require('express');
const assert = require('assert');

const PREFIX = 'zz.memchk-';
const DEV_DB = 'nebulaa_dev';
const DAY = 864e5;
const RIVAL = 'Zzrival Sarees Check';
const RIVAL_CAPTION = 'zzrivalcaption festive offer';

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

const OWNED = {
  ai_brand_memory: 'userId', blueprints: 'userId', products: 'user', campaigns: 'userId', ai_content_performance: 'userId',
  competitors: 'userId', competitor_snapshots: 'userId'
};
async function throwawayIds(db) {
  const rows = await db.collection('users').find({ email: { $regex: `^${PREFIX.replace(/\./g, '\\.')}` } }, { projection: { _id: 1 } }).toArray();
  return rows.map((u) => u._id);
}
async function cleanup(db) {
  const ids = await throwawayIds(db);
  const removed = {};
  if (ids.length) {
    for (const [c, field] of Object.entries(OWNED)) {
      const n = (await db.collection(c).deleteMany({ [field]: { $in: ids } })).deletedCount;
      if (n) removed[c] = n;
    }
    const n = (await db.collection('users').deleteMany({ _id: { $in: ids } })).deletedCount;
    if (n) removed.users = n;
  }
  console.log('removed', JSON.stringify(removed));
  const left = {};
  for (const [c, field] of Object.entries(OWNED)) left[c] = ids.length ? await db.collection(c).countDocuments({ [field]: { $in: ids } }) : 0;
  left.users = await db.collection('users').countDocuments({ email: { $regex: `^${PREFIX.replace(/\./g, '\\.')}` } });
  console.log('left', JSON.stringify(left));
  return { removed, left, removedTotal: Object.values(removed).reduce((a, b) => a + b, 0) };
}

async function runChecks() {
  const db = mongoose.connection.db;
  const { ObjectId } = mongoose.Types;
  const User = require('../models/User');
  const legal = require('../config/legalVersions');
  const { generateToken } = require('../middleware/auth');
  const { createBrandMemory } = require('../services/brandMemory/runner');
  const P = require('../services/brandMemory/prompt');
  const { PROMPT } = require('../services/brandMemory/common');
  const { buildBrandMemoryBlock } = require('../services/brandMemory');
  const { ruleFor, filterFor } = require('../services/dataRegistry');

  section = '(0) safety:';
  await check('a database that is not nebulaa_dev is refused, and the live connection is the dev one', async () => {
    assert.throws(() => assertDevDatabase('nebulaa_prod'), /Refusing/);
    assert.throws(() => assertDevDatabase(''), /Refusing/);
    assert.strictEqual(mongoose.connection.name, DEV_DB);
  });

  const tag = `${PREFIX}${Date.now()}`;
  const mkUser = (suffix, extra = {}) => User.create({
    email: `${tag}-${suffix}@example.test`, password: 'Check-only-1', firstName: `Check ${suffix}`, isVerified: true, onboardingCompleted: true,
    plan: { tier: 'starter', addons: ['publish', 'competitors'] },
    consent: { termsVersion: legal.TERMS_VERSION, privacyVersion: legal.PRIVACY_VERSION, acceptedAt: new Date(), source: 'realdb-check' },
    businessProfile: { name: `Memory Check ${suffix}`, website: 'https://example.com', description: 'Handwoven sarees', targetAudience: 'Working women in Chennai', businessType: 'B2C', reachAreas: ['city'], pricePositioning: 'mid_range', keyDifferentiator: 'Woven by hand in the family workshop' },
    ...extra
  });
  const main = await mkUser('main');
  const empty = await mkUser('empty', { businessProfile: { name: 'Empty Check' } });
  const free = await mkUser('free', { plan: { tier: 'free' } });
  const staff = await mkUser('staff', { staffRole: 'csm' });
  const now = new Date();
  const ago = (d) => new Date(now.getTime() - d * DAY);

  // Seed the main account: a plan, a Blueprint, products, measured posts, competitors with snapshots.
  const planResult = {
    plan: {
      pillars: [{ name: 'Festive looks' }, { name: 'Behind the loom' }, { name: 'Care tips' }],
      positioning: { territory: { name: 'The weaver next door' }, line: { text: 'Handwoven, close to home', tag: 'proposed' } },
      channels: [{ channel: 'Instagram', priority: 1 }, { channel: 'WhatsApp', priority: 2 }],
      calendar: Array.from({ length: 14 }, (_, i) => ({ day: i + 1, format: i % 2 ? 'carousel' : 'reel' })),
      icp: { who: [{ text: 'Women who buy for festivals' }], pains: [{ text: 'Cannot tell real silk from fake' }], where: [], triggers: [{ text: 'A wedding in the family' }] }
    }
  };
  await db.collection('blueprints').insertMany([
    { blueprintId: `${tag}-plan`, userId: main._id, emailKey: `${tag}-plan`, tierAtStart: 'starter', kind: 'plan', status: 'completed', result: planResult, completedAt: ago(5), createdAt: ago(5), updatedAt: ago(5) },
    { blueprintId: `${tag}-bp`, userId: main._id, emailKey: `${tag}-bp`, tierAtStart: 'starter', kind: 'blueprint', status: 'completed', result: { plan: { pillars: [{ name: 'Care tips' }, { name: 'Wedding season' }, { name: 'Festive looks' }], positioning: { territory: { name: 'Heritage made easy' } }, channels: [{ channel: 'Instagram', priority: 1 }], competitors: [{ name: RIVAL, observations: [] }] } }, completedAt: ago(9), createdAt: ago(9), updatedAt: ago(9) },
    { blueprintId: `${tag}-failed`, userId: main._id, emailKey: `${tag}-failed`, tierAtStart: 'starter', kind: 'plan', status: 'failed', createdAt: ago(1), updatedAt: ago(1) }
  ]);
  const products = [
    { name: 'Silk saree', type: 'product', price: 4999, currency: 'INR', category: 'Sarees', imageUrl: 'https://res.cloudinary.com/x/a.jpg' },
    { name: 'Cotton saree', type: 'product', price: 1299, currency: 'INR', category: 'Sarees', images: ['https://res.cloudinary.com/x/b.jpg'] },
    { name: 'Blouse stitching', type: 'service', price: 600, currency: 'INR', category: 'Sarees' },
    { name: 'Dupatta', type: 'product', category: 'General' }
  ];
  await db.collection('products').insertMany(products.map((p) => ({ ...p, user: main._id, createdAt: ago(20), updatedAt: ago(20) })));
  const camps = [];
  const perf = [];
  for (let i = 0; i < 12; i += 1) {
    const id = new ObjectId();
    const video = i < 6;
    camps.push({ _id: id, userId: main._id, name: `Check post ${i}`, objective: 'awareness', status: 'posted', platforms: ['instagram'], creative: { type: video ? 'video' : 'image', imageUrls: ['https://res.cloudinary.com/x/p.jpg'] }, publishedAt: ago(3 + i), createdAt: ago(3 + i) });
    perf.push({ organizationId: String(main._id), userId: main._id, campaignId: id, platform: 'instagram', postId: `${tag}-p${i}`, contentType: 'post', caption: 'A caption', metrics: { likes: 0 }, rawAnalytics: { status: 'success', instagram: { analytics: { likeCount: video ? 120 : 30, commentsCount: 3 } } }, publishedAt: ago(3 + i), measuredAt: ago(2 + i), createdAt: ago(2 + i), updatedAt: ago(2 + i) });
  }
  // Two old rows with zeros and no platform answer: measured, but no numbers.
  for (let i = 0; i < 2; i += 1) perf.push({ organizationId: String(main._id), userId: main._id, campaignId: null, platform: 'instagram', postId: `${tag}-z${i}`, contentType: 'post', metrics: { likes: 0, comments: 0 }, rawAnalytics: null, publishedAt: ago(30 + i), measuredAt: ago(29 + i), createdAt: ago(29), updatedAt: ago(29) });
  await db.collection('campaigns').insertMany(camps);
  await db.collection('ai_content_performance').insertMany(perf);
  const compA = new ObjectId(); const compB = new ObjectId();
  await db.collection('competitors').insertMany([
    { _id: compA, userId: main._id, name: RIVAL, socialHandles: { instagram: 'zzrival_a' }, handleStatus: 'confirmed', isActive: true, isIgnored: false, createdAt: ago(40), updatedAt: ago(40) },
    { _id: compB, userId: main._id, name: `${RIVAL} Two`, socialHandles: { instagram: 'zzrival_b' }, handleStatus: 'confirmed', isActive: true, isIgnored: false, createdAt: ago(39), updatedAt: ago(39) }
  ]);
  const posts = (n, type, likes, start, key) => Array.from({ length: n }, (_, i) => ({ at: ago(start + i), type, likes, comments: 2, url: `https://www.instagram.com/p/${key}${type}${i}/` }));
  const week = (d) => ago(d).toISOString().slice(0, 10);
  await db.collection('competitor_snapshots').insertMany([
    { userId: main._id, competitorId: compA, weekStart: week(7), takenAt: ago(2), ok: true, postsInWindow: 4, posts: [...posts(4, 'video', 200, 2, 'za'), ...posts(3, 'image', 50, 8, 'za')], topPost: { url: 'https://www.instagram.com/p/za/', likes: 200, caption: RIVAL_CAPTION }, hashtags: ['#zzrivaltag'] },
    { userId: main._id, competitorId: compA, weekStart: week(14), takenAt: ago(9), ok: true, postsInWindow: 3, posts: posts(2, 'video', 210, 12, 'zb') },
    { userId: main._id, competitorId: compB, weekStart: week(7), takenAt: ago(2), ok: true, postsInWindow: 2, posts: [...posts(3, 'video', 150, 3, 'zc'), ...posts(3, 'image', 40, 9, 'zc')], topPost: { url: 'https://www.instagram.com/p/zc/', caption: RIVAL_CAPTION } },
    { userId: main._id, competitorId: compB, weekStart: week(14), takenAt: ago(9), ok: true, postsInWindow: 2, posts: [] }
  ]);

  const mem = createBrandMemory();
  const findDoc = (u) => db.collection('ai_brand_memory').findOne({ userId: u._id });

  const app = express();
  app.use(express.json());
  app.use('/api/ai-memory', require('../routes/aiMemoryLearned'));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const call = async (method, path, u, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(u ? { Authorization: `Bearer ${generateToken(u._id)}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    let json = null; try { json = await res.json(); } catch (_) { json = null; }
    return { status: res.status, body: json, retryAfter: res.headers.get('retry-after') };
  };

  try {
    section = '(1) empty account:';
    await check('every source says why in plain words, nothing is learned, and the prompt block has no memory section', async () => {
      const r = await call('GET', '/api/ai-memory/learned', empty);
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.deepStrictEqual(r.body.sources.map((s) => s.key), ['plan', 'blueprint', 'customers', 'products', 'results', 'competitors']);
      assert.strictEqual(r.body.itemCount, 0);
      for (const s of r.body.sources) assert.ok(s.reason && s.reason.length > 10, `${s.key} has a reason`);
      const block = await buildBrandMemoryBlock(empty._id);
      assert.ok(!block.includes('WHAT NEBULAA HAS LEARNED') && !block.includes("WHAT'S WORKED BEFORE"));
      return r.body.sources.map((s) => `${s.key}:${s.state}`).join(' ');
    });

    section = '(2) full account:';
    let first;
    await check('the first visit learns from all six sources with the right evidence counts', async () => {
      const r = await call('GET', '/api/ai-memory/learned', main);
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.strictEqual(r.body.refreshed, true);
      first = r.body;
      const by = Object.fromEntries(r.body.sources.map((s) => [s.key, s]));
      for (const k of Object.keys(by)) assert.strictEqual(by[k].state, 'learned', `${k}: ${by[k].reason}`);
      assert.strictEqual(by.products.evidenceCount, products.length);
      const withNumbers = perf.filter((p) => p.rawAnalytics).length;
      assert.strictEqual(by.results.evidenceCount, withNumbers);
      assert.ok(by.results.items.some((i) => i.kind === 'format' && /Videos got 4 times the likes of image posts/.test(i.text)), JSON.stringify(by.results.items.map((i) => i.text)));
      assert.ok(by.plan.items.some((i) => /3 themes: Festive looks, Behind the loom and Care tips/.test(i.text)));
      assert.ok(by.blueprint.items.some((i) => /2 themes are in both/.test(i.text)));
      assert.ok(by.customers.items.some((i) => /Working women in Chennai/.test(i.text)));
      assert.ok(by.competitors.items.some((i) => i.kind === 'format' && /Across the 2 competitors you track, reels got/.test(i.text)));
      assert.strictEqual(r.body.tracked, perf.length);
      return `${r.body.itemCount} items`;
    });

    await check('no competitor name, caption, handle or hashtag is stored anywhere in the memory', async () => {
      const doc = await findDoc(main);
      const all = JSON.stringify(doc).toLowerCase();
      for (const bad of [RIVAL.toLowerCase(), 'zzrivalcaption', 'zzrival_a', 'zzrivaltag']) assert.ok(!all.includes(bad), bad);
      assert.ok(doc.learnedItems.every((i) => ['strong', 'good', 'early'].includes(i.confidence) && i.learnedAt && i.source && Number.isInteger(i.evidenceCount)));
    });

    section = '(3) idempotent:';
    await check('a second refresh changes nothing and keeps the first-learned dates', async () => {
      const before = await findDoc(main);
      const r = await mem.refreshAccount(String(main._id));
      assert.deepStrictEqual(r, { ok: true, changed: false });
      const after = await findDoc(main);
      assert.strictEqual(after.learnedFingerprint, before.learnedFingerprint);
      assert.deepStrictEqual(after.learnedItems.map((i) => String(i.learnedAt)), before.learnedItems.map((i) => String(i.learnedAt)));
    });

    section = '(4) Refresh now:';
    await check('the first press works, the second inside ten minutes is refused with the minutes left', async () => {
      const a = await call('POST', '/api/ai-memory/learned/refresh', main);
      assert.strictEqual(a.status, 200, JSON.stringify(a.body));
      assert.strictEqual(a.body.message, 'Nothing new since the last look.');
      assert.ok(a.body.cooldown && a.body.cooldown.seconds > 500);
      const b = await call('POST', '/api/ai-memory/learned/refresh', main);
      assert.strictEqual(b.status, 429);
      assert.match(b.body.message, /refresh again in (10|9) minutes/);
      assert.ok(Number(b.retryAfter) > 500);
      return b.body.message;
    });

    section = '(5) one at a time:';
    await check('two refreshes at once: one runs, the other is told it is busy, and the lock is free afterwards', async () => {
      const [x, y] = await Promise.all([mem.refreshAccount(String(main._id)), mem.refreshAccount(String(main._id))]);
      const oks = [x, y].filter((r) => r.ok).length;
      assert.strictEqual(oks, 1, JSON.stringify([x, y]));
      assert.ok([x, y].some((r) => r.reason === 'busy'));
      assert.strictEqual((await findDoc(main)).learnedLockUntil, null);
    });

    section = '(6) edit and delete:';
    await check('an edit keeps the owner words and a delete never comes back after refreshes', async () => {
      const e = await call('PATCH', '/api/ai-memory/learned/plan-themes', main, { text: 'Mostly festive looks and loom stories' });
      assert.strictEqual(e.status, 200, JSON.stringify(e.body));
      const d = await call('DELETE', '/api/ai-memory/learned/plan-channels', main);
      assert.strictEqual(d.status, 200);
      assert.strictEqual((await call('DELETE', '/api/ai-memory/learned/plan-channels', main)).status, 404);
      await db.collection('ai_brand_memory').updateOne({ userId: main._id }, { $set: { learnedRefreshedAt: ago(30) } });
      const r = await mem.refreshAccount(String(main._id));
      assert.ok(r.ok);
      const doc = await findDoc(main);
      assert.strictEqual(doc.learnedItems.find((i) => i.key === 'plan-themes').text, 'Mostly festive looks and loom stories');
      assert.ok(!doc.learnedItems.some((i) => i.key === 'plan-channels'));
      assert.ok(doc.learnedHidden.includes('plan-channels'));
    });

    section = '(7) prompts:';
    await check('Create, calendar and drafts read one capped section with no digits in code lines and no competitor', async () => {
      const block = await buildBrandMemoryBlock(main._id);
      const start = block.indexOf(P.HEADER);
      assert.ok(start >= 0, 'section present');
      const sectionText = block.slice(start);
      const lines = sectionText.split('\n').slice(1).filter((l) => l.startsWith('- '));
      assert.ok(lines.length >= 3 && lines.length <= PROMPT.MAX_LINES, `${lines.length} lines`);
      assert.ok(sectionText.length <= PROMPT.MAX_CHARS + 20, `${sectionText.length} characters`);
      assert.ok(P.estimateTokens(sectionText) <= 235);
      assert.ok(!sectionText.toLowerCase().includes('zzrival'));
      assert.ok(lines.filter((l) => !l.includes('loom stories')).every((l) => !/\p{Nd}/u.test(l)), 'code lines have no digits');
      const planLines = await P.loadMemoryLines(main._id, { exclude: ['plan'] });
      assert.ok(planLines.length, `plan run lines: ${JSON.stringify(planLines)} state ${mongoose.connection.readyState}`);
      assert.ok(!planLines.some((l) => /Keep posts inside these themes|matters most for this brand|The plan leans on/.test(l)), JSON.stringify(planLines));
      return `${lines.length} lines, ${sectionText.length} characters`;
    });

    section = '(8) learns over time:';
    await check('a new product makes the next visit learn again, with the new count', async () => {
      await db.collection('products').insertOne({ user: main._id, name: 'Kanchi silk', type: 'product', price: 7999, currency: 'INR', category: 'Sarees', createdAt: new Date(), updatedAt: new Date(Date.now() + 1000) });
      const r = await call('GET', '/api/ai-memory/learned', main);
      assert.strictEqual(r.body.refreshed, true);
      const p = r.body.sources.find((s) => s.key === 'products');
      assert.strictEqual(p.evidenceCount, products.length + 1);
      assert.ok(p.items.some((i) => /Rs 600 to Rs 7,999/.test(i.text)));
    });

    await check('an ignored competitor is no longer learned from', async () => {
      await db.collection('competitors').updateOne({ _id: compB }, { $set: { isIgnored: true, updatedAt: new Date(Date.now() + 2000) } });
      await db.collection('ai_brand_memory').updateOne({ userId: main._id }, { $set: { learnedRefreshedAt: ago(30) } });
      await mem.refreshAccount(String(main._id));
      const doc = await findDoc(main);
      assert.ok(!doc.learnedItems.some((i) => i.source === 'competitors' && i.kind === 'format'), 'one competitor is not enough for a pattern');
      assert.strictEqual(doc.learnedSources.competitors.state === 'learned' || doc.learnedSources.competitors.state === 'not_enough', true);
      return doc.learnedSources.competitors.state;
    });

    section = '(9) accounts:';
    await check('another account never sees this memory; a free account is told about the add-on; staff get none', async () => {
      const other = await call('GET', '/api/ai-memory/learned', empty);
      assert.strictEqual(other.body.itemCount, 0);
      const f = await call('GET', '/api/ai-memory/learned', free);
      assert.strictEqual(f.body.sources.find((s) => s.key === 'competitors').state, 'not_on_plan');
      const s = await call('GET', '/api/ai-memory/learned', staff);
      assert.strictEqual(s.body.staff, true);
      assert.strictEqual((await call('POST', '/api/ai-memory/learned/refresh', staff)).status, 403);
      assert.strictEqual((await call('GET', '/api/ai-memory/learned', null)).status, 401);
    });

    section = '(10) daily job:';
    await check('runs only over the throwaway accounts, skips staff and unchanged ones', async () => {
      const ids = [main._id, empty._id, free._id, staff._id];
      await db.collection('ai_brand_memory').updateMany({ userId: { $in: ids } }, { $set: { learnedCheckedAt: null } });
      const job = createBrandMemory({
        dueAccounts: () => db.collection('ai_brand_memory').find({ userId: { $in: ids } }).project({ userId: 1, learnedRefreshedAt: 1 }).toArray(),
        lease: { claim: async () => ({ value: 'check' }), release: async () => {} }
      });
      const r = await job.runDailyOnce({ limit: 10 });
      assert.strictEqual(r.ran, true);
      assert.ok(r.looked >= 3 && r.failed === 0, JSON.stringify(r));
      assert.ok(r.unchanged >= 2, JSON.stringify(r));
      return JSON.stringify(r);
    });

    section = '(11) deletion:';
    await check('the account deletion rule for AIBrandMemory erases the whole learned memory', async () => {
      const rule = ruleFor('AIBrandMemory');
      assert.strictEqual(rule.action, 'delete');
      const n = (await db.collection('ai_brand_memory').deleteMany(filterFor(rule, main._id))).deletedCount;
      assert.ok(n >= 1);
      assert.strictEqual(await db.collection('ai_brand_memory').countDocuments({ userId: main._id }), 0);
    });
  } finally {
    await new Promise((r) => server.close(r));
  }
}

(async () => {
  const mode = process.argv[2] || 'run';
  if (mode !== 'run' && mode !== 'cleanup') throw new Error('Usage: node scripts/brand-memory-check.js [run|cleanup]');
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
    const left = Object.values(out.left).reduce((a, b) => a + b, 0);
    if (mode === 'run') {
      const fails = results.filter((r) => !r.ok);
      console.log(`\n${results.length - fails.length} PASS, ${fails.length} FAIL; removed by cleanup: ${out.removedTotal}; left after cleanup: ${left}`);
      if (fails.length || left || failed) process.exitCode = 1;
    } else if (left) process.exitCode = 1;
  }
  await mongoose.disconnect();
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
