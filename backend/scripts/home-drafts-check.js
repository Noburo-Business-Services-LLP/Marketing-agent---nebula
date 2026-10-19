/**
 * Real-database check of the Home drafts (POST /api/home/response-post and /witty-comment, GET /api/home/drafts/options)
 * against the DEVELOPMENT database. Refuses any database except nebulaa_dev. NO real model call: the writing call and the
 * check call are fakes inside this process (the OpenAI key is blanked before anything loads, and a guard counts any
 * attempt to reach the network). The real route, middleware, tokens, wallet (quarkBuckets), Quark ledger, spend guard and
 * HomeDraft ledger run, inside this process on a random 127.0.0.1 port (never 3000 or 5000).
 *   node scripts/home-drafts-check.js          run every check, print PASS/FAIL, then delete everything it made
 *   node scripts/home-drafts-check.js cleanup  delete leftovers of an interrupted run and print what is left
 * Everything belongs to throwaway users whose email starts with "zz.homedraftschk-" (and the client workspace of the
 * throwaway agency, found by its owner). The estimated spend the charges add to today's AI spend record is taken off
 * again at the end. Exit code is non-zero on any FAIL, or if anything is left over.
 */
require('dotenv').config();
// No real model call can happen: the key the app would use is removed before any service loads.
process.env.OPENAI_API_KEY = '';
process.env.ENABLE_COMPETITOR_DRAFTS = 'on';
const mongoose = require('mongoose');
const http = require('http');
const express = require('express');
const assert = require('assert');

const PREFIX = 'zz.homedraftschk-';
// The background sweep is checked with its real OpsState lease under a key of its own (removed in cleanup).
const CHECK_LEASE = 'zz_home_drafts_sweep_check_lease';
const DEV_DB = 'nebulaa_dev';
const DAY = 864e5;
const HOUR = 36e5;

const results = [];
let section = '';
const note = (s) => console.log(`      ${s}`);
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

// The estimated spend this run adds to today's AI spend record (taken off again in cleanup).
const spent = { usd: 0, day: new Date().toISOString().slice(0, 10) };

async function throwawayIds(db) {
  const base = await db.collection('users').find({ email: { $regex: `^${PREFIX.replace(/\./g, '\\.')}` } }, { projection: { _id: 1 } }).toArray();
  const owners = base.map((u) => u._id);
  const clients = owners.length ? await db.collection('users').find({ 'agency.ownerId': { $in: owners } }, { projection: { _id: 1 } }).toArray() : [];
  return [...owners, ...clients.map((u) => u._id)];
}

async function cleanup(db) {
  const ids = await throwawayIds(db);
  const removed = {};
  const OWNED = { competitors: 'userId', competitor_snapshots: 'userId', home_drafts: 'userId' };
  if (ids.length) {
    for (const [name, field] of Object.entries(OWNED)) {
      const c = (await db.collection(name).deleteMany({ [field]: { $in: ids } })).deletedCount;
      if (c) removed[name] = c;
    }
    const QuarkLedger = require('../models/QuarkLedger');
    const q = (await QuarkLedger.deleteMany({ $or: [{ user: { $in: ids } }, { workspace: { $in: ids } }] })).deletedCount;
    if (q) removed.quark_ledger = q;
    const c = (await db.collection('users').deleteMany({ _id: { $in: ids } })).deletedCount;
    if (c) removed.users = c;
  }
  const lease = (await db.collection('ops_state').deleteMany({ key: CHECK_LEASE })).deletedCount;
  if (lease) removed.ops_state = lease;
  if (spent.usd > 0) {
    await db.collection('ai_spend_days').updateOne({ day: spent.day }, { $inc: { totalUsd: -spent.usd, 'byProvider.home_drafts': -spent.usd } });
    removed.estimated_spend_usd = Math.round(spent.usd * 1e4) / 1e4;
    spent.usd = 0;
  }
  console.log('removed', JSON.stringify(removed));
  const left = {};
  for (const [name, field] of Object.entries(OWNED)) left[name] = ids.length ? await db.collection(name).countDocuments({ [field]: { $in: ids } }) : 0;
  left.quark_ledger = ids.length ? await require('../models/QuarkLedger').countDocuments({ $or: [{ user: { $in: ids } }, { workspace: { $in: ids } }] }) : 0;
  left.ops_state = await db.collection('ops_state').countDocuments({ key: CHECK_LEASE });
  left.users = await db.collection('users').countDocuments({ email: { $regex: `^${PREFIX.replace(/\./g, '\\.')}` } }) + (ids.length ? await db.collection('users').countDocuments({ _id: { $in: ids } }) : 0);
  console.log('left', JSON.stringify(left));
  const { estimated_spend_usd: _, ...rows } = removed;
  return { removed, left, removedTotal: Object.values(rows).reduce((a, b) => a + b, 0) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function eventually(fn, ms = 3000) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await sleep(100); }
}

async function runChecks() {
  const db = mongoose.connection.db;
  const User = require('../models/User');
  const Competitor = require('../models/Competitor');
  const Snapshot = require('../models/CompetitorSnapshot');
  const HomeDraft = require('../models/HomeDraft');
  const QuarkLedger = require('../models/QuarkLedger');
  const legal = require('../config/legalVersions');
  const caps = require('../config/homeDrafts');
  const { QUARK_COSTS, ACTION_USD } = require('../config/apiCosts');
  const { generateToken } = require('../middleware/auth');
  const { createWorkspace, issueAgencyPass } = require('../services/agencyWorkspaces');
  const { createHomeDraftsRouter } = require('../routes/homeDrafts');
  const { istDay } = require('../services/homeDrafts/service');
  const COMMENT = QUARK_COSTS.home_witty_comment;
  const POST = QUARK_COSTS.home_response_post;

  section = '(0) safety:';
  await check('a database that is not nebulaa_dev is refused, and the live connection is the dev one', async () => {
    assert.throws(() => assertDevDatabase('nebulaa_prod'), /Refusing/);
    assert.throws(() => assertDevDatabase(''), /Refusing/);
    assert.strictEqual(mongoose.connection.name, DEV_DB);
  });
  // Any network call other than this process's own port is refused and counted.
  const realFetch = global.fetch;
  let outside = 0;
  global.fetch = (url, opts) => {
    if (/^http:\/\/127\.0\.0\.1:\d+\//.test(String(url))) return realFetch(url, opts);
    outside += 1;
    return Promise.reject(new Error('outside call blocked by the check'));
  };
  await HomeDraft.init(); // the unique indexes (one row per key, one request in flight per account)

  // ---- fake model: a queue per test, counted --------------------------------------------------------------------------
  const model = { writes: [], checks: [], wrote: 0, checked: 0, prompts: [] };
  const OK_COMMENT = JSON.stringify({ comment: 'Lovely reel, the slow pour made us hungry. Greetings from one bakery family to another.' });
  const OK_POST = JSON.stringify({ caption: 'Warm brownies from our oven this evening, baked slowly and shared with the people we love. #brownies #homebaker', imageIdea: 'A close photo of a warm brownie tray on a wooden table by a window.' });
  const fakes = {
    write: async (p) => {
      model.wrote += 1; model.prompts.push(p);
      const next = model.writes.length ? model.writes.shift() : null;
      if (typeof next === 'function') return next();
      if (next === 'slow') { await sleep(400); return OK_COMMENT; }
      return next || (p.system.includes('"caption"') ? OK_POST : OK_COMMENT);
    },
    check: async () => {
      model.checked += 1;
      const next = model.checks.length ? model.checks.shift() : null;
      if (typeof next === 'function') return next();
      return next || '{"decent":true,"reasons":[]}';
    }
  };
  const reset = () => { model.writes = []; model.checks = []; };

  // ---- in-process server: the real routes and middleware, real tokens, random port ------------------------------------
  const app = express();
  app.use(express.json({ limit: '50kb' }));
  app.use('/api/home', createHomeDraftsRouter({ deps: { ...fakes, env: { ENABLE_COMPETITOR_DRAFTS: 'on' } } }));
  // A second "server process": its own service instance (no shared memory), the same database.
  app.use('/second/api/home', createHomeDraftsRouter({ deps: { ...fakes, env: { ENABLE_COMPETITOR_DRAFTS: 'on' } } }));
  app.use('/off/api/home', createHomeDraftsRouter({ deps: { ...fakes, env: {} } }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  assert.ok(port !== 3000 && port !== 5000);
  note(`in-process server on 127.0.0.1:${port}; comment ${COMMENT} Quarks, post ${POST} Quarks`);
  const call = async (method, path, token, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch (_) { /* not json */ }
    return { status: res.status, body: json, text };
  };
  let keyN = 0;
  const key = () => `chk-${Date.now().toString(36)}-${++keyN}`;
  const draft = (token, kind = 'witty-comment', body = {}, prefix = '') => call('POST', `${prefix}/api/home/${kind}`, token, { key: key(), ...body });
  const balanceOf = async (id) => Number(((await User.findById(id).select('credits.balance').lean()) || {}).credits?.balance || 0);
  const ledgerOf = (id) => QuarkLedger.find({ user: id }).sort({ createdAt: 1 }).lean();
  const charged = (n, kind = 'comment') => { spent.usd += n * (kind === 'post' ? ACTION_USD.home_response_post : ACTION_USD.home_witty_comment); };

  // ---- seed --------------------------------------------------------------------------------------------------------------
  const stamp = Date.now();
  const tag = `${PREFIX}${stamp}`;
  const mkUser = (suffix, extra = {}) => User.create({
    email: `${tag}-${suffix}@example.test`, password: 'Check-only-1', firstName: `Check ${suffix}`, isVerified: true, onboardingCompleted: true,
    plan: { tier: 'starter', addons: ['competitors'] },
    consent: { termsVersion: legal.TERMS_VERSION, privacyVersion: legal.PRIVACY_VERSION, acceptedAt: new Date(), source: 'realdb-check' },
    businessProfile: { name: `ZZ Bakes ${suffix}`, industry: 'Home bakery', description: 'Eggless brownie and cakes from a home kitchen', contentLanguage: 'tamil' },
    credits: { balance: 100 },
    ...extra
  });
  const now = Date.now();
  let seq = 0;
  const mkComp = (user, name, handle, extra = {}) => Competitor.create({ userId: user._id, name, website: 'https://example.com', isActive: true, socialHandles: { instagram: handle }, handleStatus: 'confirmed', ...extra });
  const mkSnap = async (user, comp) => {
    const code = `ZZhd${stamp}${++seq}`;
    await Snapshot.create({
      userId: user._id, competitorId: comp._id, weekStart: istDay(new Date(now)).slice(0, 10), takenAt: new Date(now - HOUR), handle: comp.socialHandles.instagram, ok: true, followers: 1200, postsInWindow: 2,
      posts: [{ at: new Date(now - 3 * HOUR), type: 'video', likes: 300, comments: 12, pinned: false, url: `https://www.instagram.com/p/${code}/` }, { at: new Date(now - 30 * HOUR), type: 'image', likes: 40, comments: 1, pinned: false, url: `https://www.instagram.com/p/${code}b/` }],
      topPost: { url: `https://www.instagram.com/p/${code}/`, likes: 300, comments: 12, type: 'Video', caption: `${comp.name} secret competitor caption about the hazelnut brownie launch` }, topPostAt: new Date(now - 3 * HOUR), hashtags: ['secrettag']
    });
    return `${comp._id}.p-${code}`;
  };

  try {
    const owner = await mkUser('owner');
    const other = await mkUser('other');
    const free = await mkUser('free', { plan: { tier: 'free' } });
    const noAddon = await mkUser('noaddon', { plan: { tier: 'starter', addons: [] } });
    const poor = await mkUser('poor', { credits: { balance: COMMENT - 1 } });
    const minute = await mkUser('minute');
    const daily = await mkUser('daily');
    const blockedDay = await mkUser('blockedday');
    const twin = await mkUser('twin');
    const stale = await mkUser('stale');
    const staleUnconfirmed = await mkUser('stale-unconfirmed');
    const staleNoSpend = await mkUser('stale-nospend');

    const ownerComp = await mkComp(owner, 'ZZ Sweet Rival', 'zz_sweetrival');
    const REF = await mkSnap(owner, ownerComp);
    const otherComp = await mkComp(other, 'ZZ Other Rival', 'zz_otherrival');
    const OTHER_REF = await mkSnap(other, otherComp);
    // Five newer competitors push an older one past the cap of five tracked.
    const oldComp = await mkComp(owner, 'ZZ Untracked', 'zz_untracked', { createdAt: new Date(now - 900 * HOUR) });
    const OLD_REF = await mkSnap(owner, oldComp);
    for (let i = 0; i < 5; i++) await mkComp(owner, `ZZ Newer ${i}`, `zz_newer${i}`, { createdAt: new Date(now - (10 + i) * HOUR) });
    const refsFor = async (u) => mkSnap(u, await mkComp(u, `ZZ Rival ${u.firstName}`, `zz_r_${String(u._id).slice(-6)}`));
    const poorRef = await refsFor(poor); const minuteRef = await refsFor(minute); const dailyRef = await refsFor(daily);
    const blockedRef = await refsFor(blockedDay); const twinRef = await refsFor(twin); const staleRef = await refsFor(stale);
    const staleUnconfirmedRef = await refsFor(staleUnconfirmed); const staleNoSpendRef = await refsFor(staleNoSpend);
    const T = (u) => generateToken(u._id);

    // =================================================================================================================
    section = '(1) charge and ledger:';
    let firstRow = null;
    await check('a decent comment is charged once from the wallet, recorded on the Quark ledger and on its draft row', async () => {
      reset();
      const before = await balanceOf(owner._id);
      const r = await draft(T(owner), 'witty-comment', { ref: REF, tone: 'witty' });
      assert.strictEqual(r.status, 200, r.text.slice(0, 200));
      charged(1);
      assert.ok(r.body.draft.comment.length > 10);
      assert.strictEqual(await balanceOf(owner._id), before - COMMENT);
      const rows = await HomeDraft.find({ userId: owner._id }).lean();
      assert.strictEqual(rows.length, 1);
      firstRow = rows[0];
      assert.strictEqual(firstRow.status, 'done'); assert.strictEqual(firstRow.attempts, 1); assert.strictEqual(firstRow.checks, 1);
      assert.strictEqual(firstRow.quarks, COMMENT); assert.strictEqual(firstRow.payerId, String(owner._id)); assert.strictEqual(firstRow.inFlight, undefined);
      const led = await eventually(async () => { const l = await ledgerOf(owner._id); return l.length >= 1 ? l : null; });
      assert.ok(led, 'ledger row written');
      assert.deepStrictEqual(led.map((l) => [l.type, l.action, l.quarks, l.ref]), [['spend', 'home_witty_comment', -COMMENT, String(firstRow._id)]]);
      return `balance ${before} -> ${before - COMMENT}`;
    });
    await check('the writer never saw the competitor name, handle or caption, and the result does not hold them', async () => {
      const all = model.prompts.map((p) => `${p.system}\n${p.user}`).join('\n').toLowerCase();
      for (const bad of ['zz sweet rival', 'zz_sweetrival', 'secret competitor caption', 'secrettag', 'hazelnut']) assert.ok(!all.includes(bad), bad);
      assert.ok(all.includes('brownie'), 'a topic word the post shares with the customer\'s own words is used');
    });
    await check('a response post is charged at its own price', async () => {
      reset();
      const before = await balanceOf(owner._id);
      await sleep(1100); // keep under the per-minute cap of this account
      const r = await draft(T(owner), 'response-post', { ref: REF });
      assert.strictEqual(r.status, 200, r.text.slice(0, 200));
      charged(1, 'post');
      assert.ok(r.body.draft.caption && r.body.draft.imageIdea);
      assert.strictEqual(await balanceOf(owner._id), before - POST);
    });

    section = '(2) idempotency and concurrency:';
    await check('the same key again (a double click after the answer) replays the same draft and charges nothing', async () => {
      reset();
      const k = key();
      const a = await call('POST', '/api/home/witty-comment', T(twin), { key: k, ref: twinRef });
      charged(1);
      const before = await balanceOf(twin._id);
      const b = await call('POST', '/api/home/witty-comment', T(twin), { key: k, ref: twinRef });
      assert.strictEqual(a.status, 200); assert.strictEqual(b.status, 200); assert.strictEqual(b.body.replay, true);
      assert.deepStrictEqual(b.body.draft, a.body.draft);
      assert.strictEqual(await balanceOf(twin._id), before);
      assert.strictEqual((await HomeDraft.countDocuments({ userId: twin._id })), 1);
    });
    await check('a double click at the same moment (same key) is one request and one charge', async () => {
      reset(); model.writes = ['slow'];
      const before = await balanceOf(twin._id);
      const k = key();
      const [a, b] = await Promise.all([call('POST', '/api/home/witty-comment', T(twin), { key: k, ref: twinRef }), call('POST', '/api/home/witty-comment', T(twin), { key: k, ref: twinRef })]);
      charged(1);
      assert.deepStrictEqual([a.status, b.status].sort(), [200, 409]);
      assert.strictEqual(await balanceOf(twin._id), before - COMMENT);
    });
    await check('two server processes at once (different keys, no shared memory): the database lock lets one through', async () => {
      reset(); model.writes = ['slow', 'slow'];
      await HomeDraft.deleteMany({ userId: twin._id }); // a clean per-minute window for this account
      const before = await balanceOf(twin._id);
      const [a, b] = await Promise.all([draft(T(twin), 'witty-comment', { ref: twinRef }), draft(T(twin), 'witty-comment', { ref: twinRef }, '/second')]);
      charged(1);
      assert.deepStrictEqual([a.status, b.status].sort(), [200, 409], `${a.status} ${b.status} ${b.text.slice(0, 120)}`);
      assert.strictEqual(await balanceOf(twin._id), before - COMMENT);
      assert.strictEqual(await HomeDraft.countDocuments({ userId: twin._id }), 1, 'the second insert was refused by the one-in-flight index');
    });

    section = '(3) refunds:';
    const refundCase = async (label, setup, expectStatus, expectOutcome) => {
      await check(label, async () => {
        reset(); setup();
        await HomeDraft.deleteMany({ userId: other._id });
        const before = await balanceOf(other._id);
        const ledBefore = (await ledgerOf(other._id)).length;
        const r = await draft(T(other), 'witty-comment', { ref: OTHER_REF });
        charged(1);
        assert.strictEqual(r.status, expectStatus, r.text.slice(0, 200));
        assert.strictEqual(r.body.draft, undefined, 'nothing is shown');
        assert.strictEqual(r.body.refunded, true);
        assert.strictEqual(await balanceOf(other._id), before, 'balance back where it was');
        const led = await eventually(async () => { const l = await ledgerOf(other._id); return l.length >= ledBefore + 2 ? l : null; });
        assert.ok(led, 'a spend and a refund row');
        const last = led.slice(-2).map((l) => [l.type, l.action, l.quarks]);
        assert.deepStrictEqual(last, [['spend', 'home_witty_comment', -COMMENT], ['refund', 'home_witty_comment_refund', COMMENT]]);
        const row = await HomeDraft.findOne({ userId: other._id }).lean();
        assert.strictEqual(row.outcome, expectOutcome); assert.strictEqual(row.refunded, true); assert.strictEqual(row.inFlight, undefined);
        assert.strictEqual(row.result, undefined, 'a refused draft is never stored');
        return `${expectOutcome}, ${row.attempts} writing and ${row.checks} check calls`;
      });
    };
    await refundCase('the model check says no twice: the plain refusal, refunded', () => { model.checks = ['{"decent":false,"reasons":["mocks a shop"]}', '{"decent":false,"reasons":["mocks a shop"]}']; }, 422, 'blocked_model');
    await refundCase('the local filter refuses both drafts: refunded, the model check is never called', () => { model.writes = [JSON.stringify({ comment: 'Unlike them we bake fresh.' }), JSON.stringify({ comment: 'What a joke of a reel.' })]; }, 422, 'blocked_local');
    await refundCase('the check answers in the wrong shape: fail closed, refunded', () => { model.checks = ['{"safe":true}']; }, 502, 'check_unavailable');
    await refundCase('the writing call fails: refunded at once, no second call', () => { model.writes = [() => { throw new Error('provider down'); }]; }, 502, 'write_failed');

    section = '(4) caps:';
    await check(`more than ${caps.MAX_PER_MINUTE} requests in a minute are refused, and the refused one is not charged`, async () => {
      reset();
      for (let i = 0; i < caps.MAX_PER_MINUTE; i++) { const r = await draft(T(minute), 'witty-comment', { ref: minuteRef }); assert.strictEqual(r.status, 200, r.text.slice(0, 120)); charged(1); }
      const before = await balanceOf(minute._id);
      const r = await draft(T(minute), 'witty-comment', { ref: minuteRef });
      assert.strictEqual(r.status, 429); assert.strictEqual(r.body.limit, 'minute');
      assert.strictEqual(await balanceOf(minute._id), before);
    });
    await check(`${caps.MAX_DRAFTS_PER_DAY} drafts today: the next one is refused until tomorrow, nothing charged`, async () => {
      const day = istDay(new Date());
      await HomeDraft.insertMany(Array.from({ length: caps.MAX_DRAFTS_PER_DAY }, (_, i) => ({ userId: daily._id, key: `old-day-${i}-${stamp}`, kind: 'witty_comment', day, status: 'done', outcome: 'ok', attempts: 1, checks: 1, createdAt: new Date(Date.now() - 2 * HOUR), startedAt: new Date(Date.now() - 2 * HOUR) })));
      const before = await balanceOf(daily._id);
      const r = await draft(T(daily), 'witty-comment', { ref: dailyRef });
      assert.strictEqual(r.status, 429); assert.strictEqual(r.body.limit, 'day');
      assert.strictEqual(await balanceOf(daily._id), before);
      const o = await call('GET', '/api/home/drafts/options', T(daily));
      assert.strictEqual(o.body.left, 0);
    });
    await check(`${caps.MAX_BLOCKED_PER_DAY} refused drafts today: the next request is refused, nothing charged`, async () => {
      const day = istDay(new Date());
      await HomeDraft.insertMany(Array.from({ length: caps.MAX_BLOCKED_PER_DAY }, (_, i) => ({ userId: blockedDay._id, key: `old-blk-${i}-${stamp}`, kind: 'witty_comment', day, status: 'blocked', outcome: 'blocked_model', attempts: 0, createdAt: new Date(Date.now() - 2 * HOUR), startedAt: new Date(Date.now() - 2 * HOUR) })));
      const before = await balanceOf(blockedDay._id);
      const r = await draft(T(blockedDay), 'witty-comment', { ref: blockedRef });
      assert.strictEqual(r.status, 429); assert.strictEqual(r.body.limit, 'blocked');
      assert.strictEqual(await balanceOf(blockedDay._id), before);
    });

    section = '(5) ownership and entitlement:';
    await check('another account\'s post and an untracked competitor are refused before any charge or row', async () => {
      const before = await balanceOf(owner._id);
      const rows = await HomeDraft.countDocuments({ userId: owner._id });
      for (const ref of [OTHER_REF, OLD_REF, `${ownerComp._id}.p-NotAStoredPost`]) {
        const r = await draft(T(owner), 'witty-comment', { ref });
        assert.strictEqual(r.status, 404, `${ref}: ${r.status}`);
      }
      assert.strictEqual(await balanceOf(owner._id), before);
      assert.strictEqual(await HomeDraft.countDocuments({ userId: owner._id }), rows);
    });
    await check('free and paid without the add-on get a plain 403, nothing charged; without a token 401', async () => {
      const f = await draft(T(free), 'witty-comment', { ref: REF });
      assert.strictEqual(f.status, 403); assert.strictEqual(f.body.locked, 'upgrade');
      const n = await draft(T(noAddon), 'witty-comment', { ref: REF });
      assert.strictEqual(n.status, 403); assert.strictEqual(n.body.locked, 'addon');
      assert.strictEqual((await draft(null, 'witty-comment', { ref: REF })).status, 401);
      assert.strictEqual(await HomeDraft.countDocuments({ userId: { $in: [free._id, noAddon._id] } }), 0);
    });
    await check('not enough Quarks: refused with the price, the row closed as refused, no model call', async () => {
      reset();
      const wrote = model.wrote;
      const r = await draft(T(poor), 'witty-comment', { ref: poorRef });
      assert.strictEqual(r.status, 403); assert.match(r.body.message, /^This draft needs \d+ Quarks/);
      assert.strictEqual(model.wrote, wrote);
      const row = await HomeDraft.findOne({ userId: poor._id }).lean();
      assert.strictEqual(row.status, 'refused'); assert.strictEqual(row.inFlight, undefined);
      assert.strictEqual(await balanceOf(poor._id), COMMENT - 1);
    });
    await check('the switch off answers 503 and does nothing', async () => {
      const r = await draft(T(owner), 'witty-comment', { ref: REF }, '/off');
      assert.strictEqual(r.status, 503); assert.strictEqual(r.body.disabled, true);
    });

    section = '(6) agency client pool:';
    const agency = await mkUser('agency', { plan: { tier: 'agency', addons: [] }, credits: { balance: 1000 } });
    const made = await createWorkspace({ owner: agency, name: 'Drafts Check Client', models: { User } });
    assert.ok(made.ok, made.message);
    const ws = made.workspace;
    const wsRef = await refsFor(await User.findById(ws._id));
    const pass = issueAgencyPass({ workspaceId: ws._id, ownerId: agency._id });
    await check('inside the client a draft is paid from the agency pool, the ledger row names the client', async () => {
      reset();
      const before = await balanceOf(agency._id);
      const r = await draft(pass, 'witty-comment', { ref: wsRef });
      assert.strictEqual(r.status, 200, r.text.slice(0, 200));
      charged(1);
      assert.strictEqual(await balanceOf(agency._id), before - COMMENT);
      const row = await HomeDraft.findOne({ userId: ws._id }).lean();
      assert.strictEqual(row.payerId, String(agency._id));
      const led = await eventually(async () => { const l = await QuarkLedger.find({ user: agency._id, workspace: ws._id }).lean(); return l.length ? l : null; });
      assert.ok(led && led[0].action === 'home_witty_comment');
      const o = await call('GET', '/api/home/drafts/options', pass);
      assert.strictEqual(o.body.postsOnly, true, 'the client sees posts, not Quarks');
    });
    await check('a refused draft inside the client goes back to the agency pool', async () => {
      reset(); model.checks = ['{"decent":false,"reasons":["x"]}', '{"decent":false,"reasons":["x"]}'];
      await sleep(1100);
      const before = await balanceOf(agency._id);
      const r = await draft(pass, 'witty-comment', { ref: wsRef });
      charged(1);
      assert.strictEqual(r.status, 422);
      assert.strictEqual(await balanceOf(agency._id), before);
    });
    await check('the agency\'s own account cannot use the client\'s post', async () => {
      const r = await draft(T(agency), 'witty-comment', { ref: wsRef });
      assert.strictEqual(r.status, 404);
    });

    section = '(7) a request lost in a restart:';
    await check(`a row whose lease ran out (older than ${Math.round(caps.STALE_MS / 1000)} s) and whose charge was confirmed is closed on the next request and its Quarks go back once`, async () => {
      reset();
      await User.updateOne({ _id: stale._id }, { $inc: { 'credits.balance': -COMMENT } }); // as if it had been charged
      const lostAt = new Date(Date.now() - caps.STALE_MS - 60000);
      const lost = await HomeDraft.create({ userId: stale._id, key: `lost-${stamp}`, kind: 'witty_comment', day: istDay(lostAt), status: 'charged', inFlight: true, chargedConfirmed: true, attempts: 1, quarks: COMMENT, payerId: String(stale._id), startedAt: lostAt, leaseAt: lostAt, createdAt: lostAt });
      const before = await balanceOf(stale._id);
      const r = await draft(T(stale), 'witty-comment', { ref: staleRef });
      assert.strictEqual(r.status, 200, r.text.slice(0, 200));
      charged(1);
      const row = await HomeDraft.findById(lost._id).lean();
      assert.strictEqual(row.outcome, 'stale'); assert.strictEqual(row.refunded, true); assert.strictEqual(row.inFlight, undefined);
      assert.strictEqual(await balanceOf(stale._id), before + COMMENT - COMMENT, 'the lost charge came back, the new one was taken');
    });

    await check('a lost row younger than the stale limit (lease renewed recently) is left running and nothing is refunded', async () => {
      reset();
      const u = await mkUser('stale-young');
      const ref = await refsFor(u);
      const young = new Date(Date.now() - Math.floor(caps.STALE_MS / 2));
      const row = await HomeDraft.create({ userId: u._id, key: `young-${stamp}`, kind: 'witty_comment', day: istDay(young), status: 'charged', inFlight: true, chargedConfirmed: true, attempts: 1, quarks: COMMENT, payerId: String(u._id), startedAt: new Date(Date.now() - caps.STALE_MS - 60000), leaseAt: young, createdAt: young });
      const r = await draft(T(u), 'witty-comment', { ref });
      assert.notStrictEqual(r.status, 200, 'one request at a time per account: the live row blocks the new one');
      const after = await HomeDraft.findById(row._id).lean();
      assert.strictEqual(after.inFlight, true); assert.ok(!after.refunded); assert.strictEqual((await ledgerOf(u._id)).filter((l) => l.type === 'refund').length, 0);
    });

    await check('an unconfirmed-charge lost row with a real ledger spend row is refunded exactly once, to the spend row user', async () => {
      reset();
      const lostAt = new Date(Date.now() - caps.STALE_MS - 60000);
      const lost = await HomeDraft.create({ userId: staleUnconfirmed._id, key: `lost-unc-${stamp}`, kind: 'witty_comment', day: istDay(lostAt), status: 'started', inFlight: true, chargedConfirmed: false, attempts: 0, quarks: COMMENT, payerId: String(staleUnconfirmed._id), startedAt: lostAt, leaseAt: lostAt, createdAt: lostAt });
      // The charge landed (balance down, spend row written with ref = row id) but the process died before the mark.
      await User.updateOne({ _id: staleUnconfirmed._id }, { $inc: { 'credits.balance': -COMMENT, 'credits.totalUsed': COMMENT } });
      await QuarkLedger.create({ user: staleUnconfirmed._id, type: 'spend', quarks: -COMMENT, action: 'home_witty_comment', ref: String(lost._id) });
      const before = await balanceOf(staleUnconfirmed._id);
      const r = await draft(T(staleUnconfirmed), 'witty-comment', { ref: staleUnconfirmedRef });
      assert.strictEqual(r.status, 200, r.text.slice(0, 200));
      charged(1);
      const row = await HomeDraft.findById(lost._id).lean();
      assert.strictEqual(row.outcome, 'stale'); assert.strictEqual(row.refunded, true); assert.strictEqual(row.inFlight, undefined);
      const refunds = await eventually(async () => { const l = await QuarkLedger.find({ type: 'refund', ref: String(lost._id) }).lean(); return l.length ? l : null; });
      assert.ok(refunds && refunds.length === 1, `expected one refund row, got ${refunds && refunds.length}`);
      assert.strictEqual(String(refunds[0].user), String(staleUnconfirmed._id)); assert.strictEqual(refunds[0].quarks, COMMENT);
      assert.strictEqual(await balanceOf(staleUnconfirmed._id), before, 'refund came back once, the new draft charge was taken');
      await sleep(300);
      assert.strictEqual(await QuarkLedger.countDocuments({ type: 'refund', ref: String(lost._id) }), 1, 'still exactly one refund');
    });

    await check('an unconfirmed-charge lost row with NO ledger spend row closes with no refund', async () => {
      reset();
      const lostAt = new Date(Date.now() - caps.STALE_MS - 60000);
      const lost = await HomeDraft.create({ userId: staleNoSpend._id, key: `lost-nospend-${stamp}`, kind: 'witty_comment', day: istDay(lostAt), status: 'started', inFlight: true, chargedConfirmed: false, attempts: 0, quarks: COMMENT, payerId: String(staleNoSpend._id), startedAt: lostAt, leaseAt: lostAt, createdAt: lostAt });
      const before = await balanceOf(staleNoSpend._id);
      const r = await draft(T(staleNoSpend), 'witty-comment', { ref: staleNoSpendRef });
      assert.strictEqual(r.status, 200, r.text.slice(0, 200));
      charged(1);
      const row = await HomeDraft.findById(lost._id).lean();
      assert.strictEqual(row.outcome, 'stale'); assert.ok(!row.refunded); assert.strictEqual(row.inFlight, undefined);
      await sleep(300);
      assert.strictEqual(await QuarkLedger.countDocuments({ type: 'refund', ref: String(lost._id) }), 0);
      assert.strictEqual(await balanceOf(staleNoSpend._id), before - COMMENT, 'only the new draft was charged; nothing came back for the lost row');
    });

    section = '(10) review 2026-10-19 fixes:';
    const qb = require('../services/quarkBuckets');
    const { createHomeDrafts } = require('../services/homeDrafts/service');
    const { createLease } = require('../services/competitors/lease');
    // The sweep reads every account in the database; here it only sees this run's throwaway accounts.
    const scopedDraft = () => {
      const ours = async () => throwawayIds(db);
      return {
        find: (f) => { let n = 20; const c = { limit: (x) => { n = x; return c; }, lean: () => ours().then((ids) => HomeDraft.find({ ...f, userId: { $in: ids } }).limit(n).lean()) }; return c; },
        findOne: (...a) => HomeDraft.findOne(...a), findOneAndUpdate: (...a) => HomeDraft.findOneAndUpdate(...a), updateOne: (...a) => HomeDraft.updateOne(...a), create: (...a) => HomeDraft.create(...a), countDocuments: (...a) => HomeDraft.countDocuments(...a)
      };
    };
    const sweeper = () => createHomeDrafts({ ...fakes, env: { ENABLE_COMPETITOR_DRAFTS: 'on' }, Draft: scopedDraft, lease: createLease({ key: CHECK_LEASE, ttlMs: 60000 }), alertNow: () => {} });
    const historyOf = async (id) => (((await User.findById(id).select('credits.history').lean()) || {}).credits || {}).history || [];
    const failLedgerWrites = async (fn) => {
      const orig = QuarkLedger.create;
      QuarkLedger.create = () => Promise.reject(new Error('simulated ledger write failure'));
      const warn = console.warn; console.warn = () => {};
      try { return await fn(); } finally { await sleep(200); QuarkLedger.create = orig; console.warn = warn; }
    };
    const lostAt = () => new Date(Date.now() - caps.STALE_MS - 60000);

    await check('S2: a ledger write that fails after the debit leaves the ref in the history entry of the same update', async () => {
      const u = await mkUser('proof');
      const r = await failLedgerWrites(() => qb.spend(u._id, COMMENT, { action: 'home_witty_comment', ref: `proof-${stamp}` }));
      charged(1);
      assert.strictEqual(r.success, true);
      assert.strictEqual(await QuarkLedger.countDocuments({ ref: `proof-${stamp}` }), 0, 'no ledger row');
      const h = (await historyOf(u._id)).find((x) => x.ref === `proof-${stamp}`);
      assert.ok(h && h.amount === -COMMENT, 'history entry with the ref');
      const proof = await qb.chargeProof(`proof-${stamp}`, { userId: String(u._id) });
      assert.deepStrictEqual(proof.spend, { payer: String(u._id), workspace: '', quarks: COMMENT, source: 'history' });
    });

    await check('S2+S3: the background sweep refunds, once, a lost request of an account that never asks again, proven only by the history', async () => {
      const u = await mkUser('sweep-lost');
      const at = lostAt();
      const lost = await HomeDraft.create({ userId: u._id, key: `sweep-lost-${stamp}`, kind: 'witty_comment', day: istDay(at), status: 'started', inFlight: true, chargedConfirmed: false, attempts: 0, quarks: COMMENT, payerId: String(u._id), startedAt: at, leaseAt: at, createdAt: at });
      await failLedgerWrites(() => qb.spend(u._id, COMMENT, { action: 'home_witty_comment', ref: String(lost._id) }));
      charged(1);
      const before = await balanceOf(u._id);
      const out = await sweeper().sweep();
      assert.ok(out.closed >= 1, JSON.stringify(out));
      const row = await HomeDraft.findById(lost._id).lean();
      assert.strictEqual(row.outcome, 'stale'); assert.strictEqual(row.refunded, true); assert.strictEqual(row.inFlight, undefined);
      assert.strictEqual(await balanceOf(u._id), before + COMMENT);
      await sweeper().sweep();
      assert.strictEqual(await balanceOf(u._id), before + COMMENT, 'a second sweep pays nothing');
      assert.strictEqual(await eventually(() => QuarkLedger.countDocuments({ type: 'refund', ref: String(lost._id) })), 1);
      return `balance ${before} -> ${before + COMMENT}`;
    });

    await check('S3: while another server holds the real lease the sweep does nothing; after the release it runs', async () => {
      const other = createLease({ key: CHECK_LEASE, ttlMs: 60000 });
      const token = await other.claim(new Date());
      assert.ok(token, 'the other server got the lease');
      assert.deepStrictEqual(await sweeper().sweep(), { skipped: true });
      await other.release(token);
      assert.ok(!(await sweeper().sweep()).skipped);
    });

    await check('S4: a refund that did not land is retried by the sweep, lands once and the flag is cleared', async () => {
      const u = await mkUser('retry');
      await User.updateOne({ _id: u._id }, { $inc: { 'credits.balance': -COMMENT } }); // charged, refund failed
      const at = new Date(Date.now() - 60000);
      const row = await HomeDraft.create({ userId: u._id, key: `retry-${stamp}`, kind: 'witty_comment', day: istDay(at), status: 'blocked', outcome: 'blocked_model', chargedConfirmed: true, attempts: 2, quarks: COMMENT, payerId: String(u._id), refunded: false, refundFailed: true, startedAt: at, leaseAt: at, createdAt: at });
      const before = await balanceOf(u._id);
      const out = await sweeper().sweep();
      assert.strictEqual(out.retried, 1, JSON.stringify(out));
      const after = await HomeDraft.findById(row._id).lean();
      assert.strictEqual(after.refunded, true); assert.strictEqual(after.refundFailed, undefined); assert.strictEqual(after.refundAttempts, 1);
      assert.strictEqual(await balanceOf(u._id), before + COMMENT);
      await sweeper().sweep();
      assert.strictEqual(await balanceOf(u._id), before + COMMENT, 'paid once');
    });

    await check('S4: a refund that landed but was reported as failed is found by its history proof and never paid twice', async () => {
      const u = await mkUser('landed');
      const at = new Date(Date.now() - 60000);
      const row = await HomeDraft.create({ userId: u._id, key: `landed-${stamp}`, kind: 'witty_comment', day: istDay(at), status: 'failed', outcome: 'write_failed', chargedConfirmed: true, attempts: 1, quarks: COMMENT, payerId: String(u._id), refunded: false, refundFailed: true, startedAt: at, leaseAt: at, createdAt: at });
      await failLedgerWrites(() => qb.refundTo(String(u._id), COMMENT, { action: 'home_witty_comment_refund', ref: String(row._id), payerId: String(u._id) }));
      const before = await balanceOf(u._id);
      await sweeper().sweep();
      const after = await HomeDraft.findById(row._id).lean();
      assert.strictEqual(after.refunded, true); assert.strictEqual(after.refundFailed, undefined);
      assert.strictEqual(await balanceOf(u._id), before, 'nothing paid again');
    });

    await check('M7: a key used for a comment is not replayed for a response post, and nothing is charged', async () => {
      reset();
      await sleep(1100);
      const k = key();
      const a = await call('POST', '/api/home/witty-comment', T(other), { key: k, ref: OTHER_REF });
      assert.strictEqual(a.status, 200, a.text.slice(0, 160)); charged(1);
      const before = await balanceOf(other._id);
      const b = await call('POST', '/api/home/response-post', T(other), { key: k, ref: OTHER_REF });
      assert.strictEqual(b.status, 409); assert.strictEqual(b.body.keyReused, true); assert.strictEqual(b.body.draft, undefined);
      assert.strictEqual(await balanceOf(other._id), before);
    });

    section = '(8) bounded queries:';
    await check('the cap and ledger queries use indexes and read only this account\'s rows', async () => {
      const explain = async (q) => { const e = await q.explain('executionStats'); const s = JSON.stringify(e.queryPlanner.winningPlan); return { collscan: /COLLSCAN/.test(s), examined: e.executionStats.totalDocsExamined }; };
      const day = istDay(new Date());
      const qs = [
        await explain(HomeDraft.find({ userId: daily._id, day, attempts: { $gt: 0 } })),
        await explain(HomeDraft.find({ userId: owner._id, key: 'x' })),
        await explain(HomeDraft.find({ userId: owner._id, inFlight: true })),
        await explain(HomeDraft.find({ userId: owner._id, createdAt: { $gte: new Date(Date.now() - 60000) } })),
        // the background sweep across all accounts
        await explain(HomeDraft.find({ inFlight: true, leaseAt: { $lt: new Date(Date.now() - caps.STALE_MS) } })),
        await explain(HomeDraft.find({ refundFailed: true, refunded: false, inFlight: { $ne: true }, refundGaveUp: { $ne: true }, $or: [{ refundRetryAt: { $exists: false } }, { refundRetryAt: { $lte: new Date() } }] }))
      ];
      assert.ok(qs.every((q) => !q.collscan), JSON.stringify(qs));
      assert.ok(qs[0].examined <= caps.MAX_DRAFTS_PER_DAY + 1, `examined ${qs[0].examined}`);
      return qs.map((q) => q.examined).join(', ');
    });

    section = '(9) safety at the end:';
    await check('no outside call was made and no real model was reached', async () => {
      assert.strictEqual(outside, 0);
      assert.ok(model.wrote > 0 && model.checked > 0);
      return `${model.wrote} fake writing calls, ${model.checked} fake checks`;
    });
  } finally {
    global.fetch = realFetch;
    await new Promise((r) => server.close(r));
  }
}

(async () => {
  const mode = process.argv[2] || 'run';
  if (mode !== 'run' && mode !== 'cleanup') throw new Error('Usage: node scripts/home-drafts-check.js [run|cleanup]');
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
