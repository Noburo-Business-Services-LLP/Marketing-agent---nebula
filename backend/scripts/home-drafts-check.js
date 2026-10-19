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
  if (spent.usd > 0) {
    await db.collection('ai_spend_days').updateOne({ day: spent.day }, { $inc: { totalUsd: -spent.usd, 'byProvider.home_drafts': -spent.usd } });
    removed.estimated_spend_usd = Math.round(spent.usd * 1e4) / 1e4;
    spent.usd = 0;
  }
  console.log('removed', JSON.stringify(removed));
  const left = {};
  for (const [name, field] of Object.entries(OWNED)) left[name] = ids.length ? await db.collection(name).countDocuments({ [field]: { $in: ids } }) : 0;
  left.quark_ledger = ids.length ? await require('../models/QuarkLedger').countDocuments({ $or: [{ user: { $in: ids } }, { workspace: { $in: ids } }] }) : 0;
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
    await check('a row left running is closed on the next request and its Quarks go back once', async () => {
      reset();
      await User.updateOne({ _id: stale._id }, { $inc: { 'credits.balance': -COMMENT } }); // as if it had been charged
      const lostAt = new Date(Date.now() - caps.STALE_MS - 60000);
      const lost = await HomeDraft.create({ userId: stale._id, key: `lost-${stamp}`, kind: 'witty_comment', day: istDay(lostAt), status: 'charged', inFlight: true, attempts: 1, quarks: COMMENT, payerId: String(stale._id), startedAt: lostAt, createdAt: lostAt });
      const before = await balanceOf(stale._id);
      const r = await draft(T(stale), 'witty-comment', { ref: staleRef });
      assert.strictEqual(r.status, 200, r.text.slice(0, 200));
      charged(1);
      const row = await HomeDraft.findById(lost._id).lean();
      assert.strictEqual(row.outcome, 'stale'); assert.strictEqual(row.refunded, true); assert.strictEqual(row.inFlight, undefined);
      assert.strictEqual(await balanceOf(stale._id), before + COMMENT - COMMENT, 'the lost charge came back, the new one was taken');
    });

    section = '(8) bounded queries:';
    await check('the cap and ledger queries use indexes and read only this account\'s rows', async () => {
      const explain = async (q) => { const e = await q.explain('executionStats'); const s = JSON.stringify(e.queryPlanner.winningPlan); return { collscan: /COLLSCAN/.test(s), examined: e.executionStats.totalDocsExamined }; };
      const day = istDay(new Date());
      const qs = [
        await explain(HomeDraft.find({ userId: daily._id, day, attempts: { $gt: 0 } })),
        await explain(HomeDraft.find({ userId: owner._id, key: 'x' })),
        await explain(HomeDraft.find({ userId: owner._id, inFlight: true })),
        await explain(HomeDraft.find({ userId: owner._id, createdAt: { $gte: new Date(Date.now() - 60000) } }))
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
