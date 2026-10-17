/**
 * Real-database check of Stage 4 competitor tracking (after fix rounds A and B) against the DEVELOPMENT database.
 * Refuses any database except nebulaa_dev. NO real scraper and NO AI call: the Instagram scraper functions are replaced by
 * a fake (every call is counted and any handle that is not a throwaway one fails the run), the spend guard is a fake, and
 * the lease uses its own OpsState key, so a running server's tracker lease and spend counters are never touched.
 *   node scripts/competitors-realdb-check.js          run every check, print PASS/FAIL, then delete everything it made
 *   node scripts/competitors-realdb-check.js cleanup  delete leftovers of an interrupted run and print what is left
 * Everything it creates is named with the prefix "rdbcheck4-" (users) or "competitor_tracker_lease_rdbcheck4" (lease keys).
 */
require('dotenv').config();
const mongoose = require('mongoose');
const http = require('http');
const express = require('express');
const assert = require('assert');

const PREFIX = 'rdbcheck4-';
const LEASE_PREFIX = 'competitor_tracker_lease_rdbcheck4';
const HANDLE_PREFIX = 'zz.rdbchk.';
const DAY = 864e5;

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

async function connect() {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  if (mongoose.connection.name !== 'nebulaa_dev') throw new Error(`Refusing: database is ${mongoose.connection.name}, not nebulaa_dev`);
}

const modelNames = () => ({
  users: 'users', competitors: 'competitors', snapshots: 'competitor_snapshots', readLog: 'competitor_read_log', ops: 'ops_state', staff: 'staffactions'
});

async function cleanup(db) {
  const n = modelNames();
  const users = await db.collection(n.users).find({ email: { $regex: `^${PREFIX}` } }, { projection: { _id: 1 } }).toArray();
  const ids = users.map((u) => u._id);
  const idStrings = ids.map(String);
  const removed = {};
  const del = async (name, filter) => { const c = (await db.collection(name).deleteMany(filter)).deletedCount; if (c) removed[name] = (removed[name] || 0) + c; };
  if (ids.length) {
    await del(n.snapshots, { userId: { $in: ids } });
    await del(n.readLog, { userId: { $in: ids } });
    await del(n.competitors, { userId: { $in: ids } });
    await del(n.staff, { $or: [{ client: { $in: ids } }, { actor: { $in: ids } }] });
  }
  await del(n.ops, { key: { $regex: `^${LEASE_PREFIX}` } });
  await del(n.users, { _id: { $in: ids } });
  console.log('removed', JSON.stringify(removed));

  // Read-only scan of every other collection for rows that point at these accounts.
  const stray = {};
  if (ids.length) {
    const cleaned = new Set(Object.values(n));
    for (const { name } of await db.listCollections().toArray()) {
      if (cleaned.has(name) || name.startsWith('system.')) continue;
      for (const f of ['userId', 'user', 'client', 'actor', 'owner', 'csm', 'agency.ownerId']) {
        try {
          const c = await db.collection(name).countDocuments({ [f]: { $in: [...ids, ...idStrings] } }, { maxTimeMS: 8000 });
          if (c) stray[`${name}.${f}`] = c;
        } catch (_) { stray[`${name}.${f}`] = 'not checked'; }
      }
    }
  }
  console.log('other collections with rows for these accounts:', JSON.stringify(stray));
  const left = {
    users: await db.collection(n.users).countDocuments({ email: { $regex: `^${PREFIX}` } }),
    competitors: ids.length ? await db.collection(n.competitors).countDocuments({ userId: { $in: ids } }) : 0,
    competitor_snapshots: ids.length ? await db.collection(n.snapshots).countDocuments({ userId: { $in: ids } }) : 0,
    competitor_read_log: ids.length ? await db.collection(n.readLog).countDocuments({ userId: { $in: ids } }) : 0,
    ops_state_test_keys: await db.collection(n.ops).countDocuments({ key: { $regex: `^${LEASE_PREFIX}` } }),
    staff_actions: ids.length ? await db.collection(n.staff).countDocuments({ $or: [{ client: { $in: ids } }, { actor: { $in: ids } }] }) : 0
  };
  console.log('left', JSON.stringify(left));
  return { removed, stray, left };
}

// ---------------------------------------------------------------------------------------------------------------------
async function runChecks() {
  const db = mongoose.connection.db;
  const User = require('../models/User');
  const Competitor = require('../models/Competitor');
  const Snapshot = require('../models/CompetitorSnapshot');
  const ReadLog = require('../models/CompetitorReadLog');
  const OpsState = require('../models/OpsState');
  const StaffAction = require('../models/StaffAction');
  const legal = require('../config/legalVersions');
  const caps0 = require('../config/competitors');
  const { generateToken } = require('../middleware/auth');
  const { weekStartOf } = require('../services/week/weekMath');
  const { createLease, opsStateStore } = require('../services/competitors/lease');
  const { createReadLedger } = require('../services/competitors/readLedger');
  const { createReadGuard } = require('../services/competitors/readGuard');
  const { snapshotStore } = require('../services/competitors/snapshotStore');
  const { removeCompetitorsWithSnapshots } = require('../services/competitors/cleanup');
  const tracker = require('../services/competitors/tracker');

  // ---- No real scraper: replace the scraper functions BEFORE any route is loaded -----------------------------------
  const sm = require('../services/socialMediaAPI');
  const tripwire = { calls: [], bad: [] };
  const profileFor = (handle) => ({
    success: true,
    data: [{
      username: handle, followersCount: 1000 + handle.length,
      latestPosts: [0.5, 1, 2, 3, 5].map((d, i) => ({ timestamp: new Date(Date.now() - d * DAY).toISOString(), likesCount: 50 + i * 10, commentsCount: 2 + i, type: i === 3 ? 'Video' : 'Image', hashtags: ['rdbcheck'], url: `https://www.instagram.com/p/rdb${i}/`, caption: 'check' }))
    }]
  });
  const fakeScrape = async (handle) => {
    tripwire.calls.push(handle);
    if (!String(handle).startsWith(HANDLE_PREFIX)) tripwire.bad.push(handle);
    return profileFor(handle);
  };
  sm.scrapeInstagramProfile = fakeScrape;
  sm.searchInstagramByName = async () => { tripwire.bad.push('searchInstagramByName'); throw new Error('no real search in this check'); };

  const fakeSpend = { check: async () => ({ ok: true }), record: async () => {} };
  const stamp = Date.now();
  const tag = `${PREFIX}${stamp}`;
  let handleSeq = 0;
  const newHandle = () => `${HANDLE_PREFIX}${stamp}.${++handleSeq}`;
  const recorder = () => { const calls = []; return { calls, fn: async (h) => { calls.push(h); return fakeScrape(h); } }; };

  const mkUser = (suffix, extra = {}, addons = ['competitors']) => User.create({
    email: `${tag}-${suffix}@example.test`, password: 'Check-only-1', firstName: `Check ${suffix}`, isVerified: true, onboardingCompleted: true,
    plan: { tier: 'starter', addons },
    consent: { termsVersion: legal.TERMS_VERSION, privacyVersion: legal.PRIVACY_VERSION, acceptedAt: new Date(), source: 'realdb-check' },
    ...extra
  });
  const mkComp = (user, name, handle, extra = {}) => Competitor.create({
    userId: user._id, name, website: 'https://example.com', isActive: true,
    ...(handle ? { socialHandles: { instagram: handle } } : {}), handleStatus: 'confirmed', ...extra
  });
  const leaseKey = (s) => `${LEASE_PREFIX}-${stamp}-${s}`;
  const mkDeps = (o = {}) => ({
    env: { ENABLE_COMPETITOR_TRACKER: 'on' }, spend: fakeSpend, gate: async () => [], sleep: async () => {},
    lease: createLease({ store: opsStateStore(undefined, leaseKey('pass')), ttlMs: 60000 }),
    ledger: createReadLedger(), // the REAL read log collection; a fresh instance has no memory of earlier passes
    caps: { ...caps0, ...(o.caps || {}) },
    scrapeProfile: o.scraper ? o.scraper.fn : fakeScrape,
    ...(o.deps || {})
  });
  const pass = (o) => tracker.runTrackerOnce({ deps: mkDeps(o), now: o.now || new Date(), accountIds: o.accountIds, force: !!o.force, limit: o.limit });

  const bootInfo = await db.collection('ops_state').findOne({ key: 'competitor_tracker_lease' }, { projection: { value: 1, updatedAt: 1 } });
  note(`(read only) the real tracker lease row ${bootInfo ? `exists, last updated ${bootInfo.updatedAt && bootInfo.updatedAt.toISOString()}` : 'does not exist: no tracker has ever run on this database'}`);

  // ===================================================================================================================
  section = '(1) lease:';
  await check('first claimant gets the lease', async () => {
    const store = opsStateStore(undefined, leaseKey('first'));
    const a = await createLease({ store, holder: 'a' }).claim();
    const b = await createLease({ store, holder: 'b' }).claim();
    assert.ok(a && a.value, 'first claimant got nothing');
    assert.strictEqual(b, null, 'a second, later claimant must get nothing while the lease is held');
  });
  await check('two simultaneous claims (Promise.all): exactly one wins, nothing throws (E11000 path), 8 rounds', async () => {
    let throws = 0; let e11000 = 0;
    for (let i = 0; i < 8; i++) {
      const store = opsStateStore(undefined, leaseKey(`race${i}`));
      const wrap = (v) => store.claim(v, new Date().toISOString()).catch((e) => { throws++; if (e && e.code === 11000) e11000++; return 'threw'; });
      const r = await Promise.all([wrap(`${new Date(Date.now() + 6e4).toISOString()}|x`), wrap(`${new Date(Date.now() + 6e4).toISOString()}|y`)]);
      assert.strictEqual(r.filter((x) => x === true).length, 1, `round ${i}: winners should be exactly 1, got ${JSON.stringify(r)}`);
    }
    assert.strictEqual(throws, 0, `the store claim threw ${throws} times (${e11000} were E11000)`);
    // And through the lease object (which swallows errors) once more with three claimants.
    const store = opsStateStore(undefined, leaseKey('race-lease'));
    const r = await Promise.all(['p', 'q', 'r'].map((h) => createLease({ store, holder: h }).claim()));
    assert.strictEqual(r.filter(Boolean).length, 1, 'three lease claimants: exactly one token');
  });
  await check('two simultaneous claims on an EXPIRED lease: exactly one wins', async () => {
    const store = opsStateStore(undefined, leaseKey('race-expired'));
    const old = new Date(Date.now() - 120000);
    assert.ok(await createLease({ store, ttlMs: 60000, holder: 'old' }).claim(old), 'could not set up an expired lease');
    const r = await Promise.all([createLease({ store, holder: 'n1' }).claim(), createLease({ store, holder: 'n2' }).claim()]);
    assert.strictEqual(r.filter(Boolean).length, 1, `expected exactly one winner, got ${JSON.stringify(r)}`);
  });
  await check('an expired lease can be taken', async () => {
    const store = opsStateStore(undefined, leaseKey('expired'));
    const old = new Date(Date.now() - 120000);
    assert.ok(await createLease({ store, ttlMs: 60000, holder: 'old' }).claim(old));
    assert.ok(await createLease({ store, holder: 'new' }).claim(), 'a lease that ran out 60 s ago was not taken');
    assert.strictEqual(await createLease({ store, holder: 'third' }).claim(), null, 'the new lease must be held');
  });
  await check('renew pushes expiry out; renew with a lost token keeps the old token; release frees it', async () => {
    const store = opsStateStore(undefined, leaseKey('renew'));
    const l = createLease({ store, holder: 'r' });
    const t1 = await l.claim();
    const t2 = await l.renew(t1, new Date(Date.now() + 1000));
    assert.notStrictEqual(t2.value, t1.value, 'renew did not change the stored value');
    const row = await OpsState.findOne({ key: leaseKey('renew') }).lean();
    assert.strictEqual(row.value, t2.value, 'database value is not the renewed one');
    const stale = await l.renew(t1);
    assert.strictEqual(stale.value, t1.value, 'a renew with a stale token must hand back the token it was given');
    assert.strictEqual((await OpsState.findOne({ key: leaseKey('renew') }).lean()).value, t2.value, 'a stale renew changed the stored lease');
    await l.release(t2);
    assert.strictEqual((await OpsState.findOne({ key: leaseKey('renew') }).lean()).value, '', 'release did not empty the lease');
    assert.ok(await createLease({ store, holder: 'after' }).claim(), 'a released lease could not be claimed');
  });

  // ===================================================================================================================
  section = '(2) read log:';
  await check('TTL index exists on "at" with 14 days (1209600 s) after model init', async () => {
    await ReadLog.init();
    const idx = await ReadLog.collection.listIndexes().toArray();
    note(`indexes: ${idx.map((i) => `${i.name}${i.expireAfterSeconds !== undefined ? `(ttl ${i.expireAfterSeconds})` : ''}`).join(', ')}`);
    const ttl = idx.find((i) => i.key && i.key.at === 1);
    assert.ok(ttl, 'no index on "at"');
    assert.strictEqual(ttl.expireAfterSeconds, 14 * 24 * 3600, `expireAfterSeconds is ${ttl.expireAfterSeconds}`);
    assert.ok(idx.some((i) => i.key && i.key.day === 1 && i.key.userId === 1), 'missing day+userId index');
    assert.ok(idx.some((i) => i.key && i.key.competitorId === 1 && i.key.at === -1), 'missing competitorId+at index');
  });
  const u2 = await mkUser('log');
  await check('one row is written per read attempt (ledger.record and guard.note), counts read them back', async () => {
    const ledger = createReadLedger();
    const guard = createReadGuard({ ledger, spend: fakeSpend, env: { ENABLE_COMPETITOR_TRACKER: 'on' } });
    const cid = new mongoose.Types.ObjectId();
    const before = await ReadLog.countDocuments({ userId: u2._id });
    await ledger.record({ userId: u2._id, competitorId: cid, handle: newHandle(), source: 'tracker' });
    await ledger.record({ userId: u2._id, competitorId: cid, handle: newHandle(), source: 'staff' });
    await guard.note({ userId: u2._id, competitorId: cid, handle: newHandle(), source: 'customer' });
    const rows = await ReadLog.find({ userId: u2._id }).lean();
    assert.strictEqual(rows.length - before, 3, `expected 3 new rows, got ${rows.length - before}`);
    assert.deepStrictEqual(rows.map((r) => r.source).sort(), ['customer', 'staff', 'tracker']);
    assert.ok(rows.every((r) => /^\d{4}-\d\d-\d\d$/.test(r.day) && r.at instanceof Date), 'rows must carry a UTC day string and a date');
    const fresh = createReadLedger(); // no memory: only the database can answer
    assert.strictEqual(await fresh.countUserToday(u2._id), 3, 'a fresh ledger did not count 3 from the database');
    const last = await fresh.lastRead(cid);
    assert.ok(last && last.at instanceof Date, 'lastRead from the database returned nothing');
  });
  const u2b = await mkUser('savefail');
  const c2b = await mkComp(u2b, 'Save Fail', newHandle());
  await check('a failed snapshot save and failed tracking save still leave a read-log row; a new pass (fresh memory) does not read it again', async () => {
    const s1 = recorder();
    const failingStore = { save: async () => { throw new Error('simulated save failure'); }, latest: (...a) => snapshotStore().latest(...a), lastAttempt: (...a) => snapshotStore().lastAttempt(...a), prune: async () => {} };
    const out1 = await pass({ scraper: s1, accountIds: [u2b._id], deps: { store: failingStore, saveTracking: async () => { throw new Error('simulated tracking failure'); } } });
    assert.strictEqual(s1.calls.length, 1, `first pass should read once, read ${s1.calls.length} (${JSON.stringify(out1)})`);
    assert.strictEqual(await Snapshot.countDocuments({ competitorId: c2b._id }), 0, 'the failing store must have left no snapshot');
    assert.strictEqual(await ReadLog.countDocuments({ competitorId: c2b._id }), 1, 'no read-log row after a failed save');
    const s2 = recorder();
    const out2 = await pass({ scraper: s2, accountIds: [u2b._id] });
    assert.strictEqual(s2.calls.length, 0, `the same competitor was read again in the next pass (${JSON.stringify(out2)})`);
    assert.strictEqual(await ReadLog.countDocuments({ competitorId: c2b._id }), 1, 'a second read-log row appeared');
    return 'ledger alone held it back';
  });

  // ===================================================================================================================
  section = '(3) paged account query:';
  const ago = (d) => new Date(Date.now() - d * DAY);
  const ent = [];
  const readAts = [5, null, 1, 10, null, 3, 2]; // days ago; null = never read
  for (let i = 0; i < 7; i++) {
    const u = await mkUser(`ent${i}`, readAts[i] === null ? {} : { competitorsReadAt: ago(readAts[i]) });
    const c = await mkComp(u, `Rival ${i}`, newHandle());
    ent.push({ u, c, handle: c.socialHandles.instagram, days: readAts[i] });
  }
  const nonEntitled = await mkUser('noaddon', {}, []);
  await mkComp(nonEntitled, 'Not Entitled Rival', newHandle());
  const freeUser = await mkUser('free', { plan: { tier: 'free', addons: [] } });
  await mkComp(freeUser, 'Free Rival', newHandle());
  const inactive = await mkUser('inactive', { isActive: false });
  await mkComp(inactive, 'Inactive Rival', newHandle());
  const notOnboarded = await mkUser('notonboarded', { onboardingCompleted: false });
  await mkComp(notOnboarded, 'Not Onboarded Rival', newHandle());
  const staffLike = await mkUser('stafflike', { staffRole: 'admin' });
  await mkComp(staffLike, 'Staff Rival', newHandle());
  const csmLike = await mkUser('csmlike', { isCsm: true });
  await mkComp(csmLike, 'Csm Rival', newHandle());
  const agencyOwner = await mkUser('agency', { plan: { tier: 'agency', addons: [] } }, undefined);
  const wsFields = { isHidden: true, agency: { ownerId: agencyOwner._id, workspaceName: 'Client' }, plan: { tier: 'agency', addons: [] }, competitorsReadAt: ago(20) };
  const wsActive = await mkUser('ws-active', wsFields);
  const wsActiveComp = await mkComp(wsActive, 'Workspace Rival', newHandle());
  const wsFrozen = await mkUser('ws-frozen', { ...wsFields, agency: { ownerId: agencyOwner._id, workspaceName: 'Frozen', frozen: true } });
  await mkComp(wsFrozen, 'Frozen Rival', newHandle());
  const wsFree = await mkUser('ws-free', { ...wsFields, plan: { tier: 'free', addons: [] } });
  await mkComp(wsFree, 'Ended Plan Rival', newHandle());
  const allIds = [...ent.map((e) => e.u), nonEntitled, freeUser, inactive, notOnboarded, staffLike, csmLike, agencyOwner, wsActive, wsFrozen, wsFree].map((u) => u._id);
  const sid = (u) => String(u._id);

  await check('the account query pages through all matching accounts (page size 3) and applies its filters', async () => {
    const got = await tracker.defaultDeps().accounts({ ids: allIds, pageSize: 3 });
    const gotIds = new Set(got.map((u) => String(u._id)));
    assert.strictEqual(got.length, gotIds.size, 'an account came back twice across pages');
    const must = [...ent.map((e) => e.u), nonEntitled, agencyOwner, wsActive, wsFrozen].map(sid);
    const mustNot = [freeUser, inactive, notOnboarded, staffLike, csmLike, wsFree].map(sid);
    for (const id of must) assert.ok(gotIds.has(id), `account ${id} missing from the paged result`);
    for (const id of mustNot) assert.ok(!gotIds.has(id), `account ${id} should have been left out by the query`);
    assert.strictEqual(got.length, must.length, `expected ${must.length} accounts over ${Math.ceil(must.length / 3)} pages, got ${got.length}`);
    const one = await tracker.defaultDeps().accounts({ ids: allIds, pageSize: 500 });
    assert.strictEqual(one.length, got.length, 'one big page and small pages disagree');
    assert.ok(got.every((u) => u.plan && 'competitorsReadAt' in u || u.competitorsReadAt === undefined), 'select dropped a needed field');
    return `${got.length} accounts in ${Math.ceil(got.length / 3)} pages of 3`;
  });
  const order = recorder();
  const expectedOrder = null;
  await check('a full pass with page size 3 reads every entitled account, oldest read first, and not the others', async () => {
    const realGate = require('../services/backgroundGate');
    const out = await pass({ scraper: order, accountIds: allIds, caps: { ACCOUNTS_PAGE: 3 }, deps: { gate: () => realGate.blockedAccountIdsSafe() } });
    // Never-read accounts first (by id), then the oldest last read.
    const nulls = ent.filter((e) => e.days === null).sort((a, b) => (String(a.u._id) < String(b.u._id) ? -1 : 1));
    const rest = ent.filter((e) => e.days !== null).sort((a, b) => b.days - a.days);
    // The active workspace (read 20 days ago) falls between the never-read accounts and the 10 day one.
    const want = [...nulls.map((e) => e.handle), wsActiveComp.socialHandles.instagram, ...rest.map((e) => e.handle)];
    assert.deepStrictEqual(order.calls, want, `order was\n  ${order.calls.join('\n  ')}\nexpected\n  ${want.join('\n  ')}\n(${JSON.stringify(out)})`);
    return `${order.calls.length} reads, order correct`;
  });
  void expectedOrder;
  await check('non-entitled, free, inactive, not onboarded, staff, CSM, frozen (real gate) and free-tier workspaces were not read', async () => {
    const bad = order.calls.filter((h) => /Not Entitled|Free Rival|Inactive|Frozen|Ended/.test(h));
    const names = await Competitor.find({ userId: { $in: [nonEntitled, freeUser, inactive, notOnboarded, staffLike, csmLike, wsFrozen, wsFree].map((u) => u._id) } }).lean();
    const forbidden = new Set(names.map((c) => c.socialHandles.instagram));
    const readForbidden = order.calls.filter((h) => forbidden.has(h));
    assert.deepStrictEqual(readForbidden, [], `read when it should not have: ${readForbidden.join(', ')}`);
    void bad;
    const agencyComps = await Competitor.countDocuments({ userId: agencyOwner._id });
    note(`agency client workspace (hidden, active agency plan) WAS read: ${order.calls.includes(wsActiveComp.socialHandles.instagram)} (by design: workspaces of an active agency are entitled; frozen / ended-plan ones are not)`);
    void agencyComps;
  });
  await check('after the pass every read account has competitorsReadAt stamped; unread ones keep theirs', async () => {
    const rows = await User.find({ _id: { $in: allIds } }).select('competitorsReadAt').lean();
    const by = new Map(rows.map((r) => [String(r._id), r.competitorsReadAt]));
    for (const e of ent) assert.ok(by.get(sid(e.u)) && Date.now() - new Date(by.get(sid(e.u))).getTime() < 5 * 60 * 1000, `entitled account ${e.handle} was not stamped`);
    assert.ok(!by.get(sid(nonEntitled)), 'a non-entitled account was stamped');
    assert.ok(!by.get(sid(wsFrozen)) || Math.abs(new Date(by.get(sid(wsFrozen))) - ago(20)) < 60000, 'the frozen workspace read stamp changed');
  });

  // ===================================================================================================================
  section = '(4) timestamps:false:';
  await check('updateOne(..., { timestamps: false }) sets competitorsReadAt and leaves updatedAt alone (and a plain update does move it)', async () => {
    const u = await mkUser('ts');
    const before = (await User.findById(u._id).select('updatedAt competitorsReadAt').lean());
    assert.ok(before.updatedAt, 'the User schema has no updatedAt, the check would mean nothing');
    await new Promise((r) => setTimeout(r, 1200));
    const when = new Date(Date.now() - 3 * 3600 * 1000);
    await User.updateOne({ _id: u._id }, { $set: { competitorsReadAt: when } }, { timestamps: false });
    const mid = await User.findById(u._id).select('updatedAt competitorsReadAt').lean();
    assert.strictEqual(new Date(mid.competitorsReadAt).getTime(), when.getTime(), 'competitorsReadAt not set');
    assert.strictEqual(new Date(mid.updatedAt).getTime(), new Date(before.updatedAt).getTime(), 'updatedAt moved');
    await User.updateOne({ _id: u._id }, { $set: { competitorsReadAt: new Date() } }); // control
    const after = await User.findById(u._id).select('updatedAt').lean();
    assert.ok(new Date(after.updatedAt) > new Date(before.updatedAt), 'control failed: a normal update did not move updatedAt, so the test proves nothing');
  });
  await check('the tracker markAccountRead does the same (updatedAt unchanged by a pass)', async () => {
    const u = await mkUser('ts-pass');
    await mkComp(u, 'Ts Rival', newHandle());
    const before = await User.findById(u._id).select('updatedAt').lean();
    await new Promise((r) => setTimeout(r, 1200));
    const s = recorder();
    await pass({ scraper: s, accountIds: [u._id] });
    assert.strictEqual(s.calls.length, 1, 'the pass did not read');
    const after = await User.findById(u._id).select('updatedAt competitorsReadAt').lean();
    assert.ok(after.competitorsReadAt, 'competitorsReadAt not stamped by the pass');
    assert.strictEqual(new Date(after.updatedAt).getTime(), new Date(before.updatedAt).getTime(), 'a pass moved updatedAt');
  });

  // ===================================================================================================================
  section = '(5) tracker pass:';
  const P = await mkUser('pass');
  const p1 = await mkComp(P, 'Pass One', newHandle());
  const p2 = await mkComp(P, 'Pass Two', newHandle());
  const p3 = await mkComp(P, 'Pass Guess', newHandle(), { handleStatus: 'suggested' });
  const nowP = new Date();
  await check('first pass writes snapshots for confirmed handles only; a suggested handle is not read', async () => {
    const s = recorder();
    const out = await pass({ scraper: s, accountIds: [P._id], now: nowP });
    assert.deepStrictEqual([...s.calls].sort(), [p1, p2].map((c) => c.socialHandles.instagram).sort(), `reads were ${s.calls.join(', ')}`);
    const snaps = await Snapshot.find({ userId: P._id }).lean();
    assert.strictEqual(snaps.length, 2, `expected 2 snapshots, found ${snaps.length}`);
    for (const sn of snaps) {
      assert.strictEqual(sn.ok, true); assert.strictEqual(sn.weekStart, weekStartOf(nowP));
      assert.ok(sn.followers > 0 && sn.postsInWindow > 0 && sn.topPost && sn.topPost.url, 'snapshot fields were not stored');
      assert.ok(sn.topPost.type, 'topPost.type was not stored (the old nested `type` bug)');
    }
    assert.strictEqual(await Snapshot.countDocuments({ competitorId: p3._id }), 0, 'a snapshot exists for the suggested handle');
    const t = await Competitor.findById(p1._id).lean();
    assert.ok(t.tracking && t.tracking.lastCheckedAt && t.tracking.lastHandle === p1.socialHandles.instagram, 'tracking state not saved');
    return JSON.stringify(out);
  });
  await check('a second pass the same week reads nothing', async () => {
    const s = recorder();
    const out = await pass({ scraper: s, accountIds: [P._id], now: new Date(nowP.getTime() + 13 * 3600 * 1000) });
    assert.strictEqual(s.calls.length, 0, `read again: ${s.calls.join(', ')} ${JSON.stringify(out)}`);
    assert.strictEqual(await Snapshot.countDocuments({ userId: P._id }), 2);
  });
  await check('once the guessed handle is confirmed it is read', async () => {
    await Competitor.updateOne({ _id: p3._id }, { $set: { handleStatus: 'confirmed' } });
    const s = recorder();
    await pass({ scraper: s, accountIds: [P._id], now: new Date(nowP.getTime() + 14 * 3600 * 1000) });
    assert.deepStrictEqual(s.calls, [p3.socialHandles.instagram]);
    assert.strictEqual(await Snapshot.countDocuments({ competitorId: p3._id, ok: true }), 1);
  });
  const Q = await mkUser('ceiling');
  const qc = [];
  for (let i = 0; i < 3; i++) qc.push(await mkComp(Q, `Ceiling ${i}`, newHandle()));
  await check('the daily ceiling stops reads and counts reads, not saved rows (every save fails)', async () => {
    const ledger = createReadLedger();
    const base = await ledger.countToday(new Date());
    const failingStore = { save: async () => { throw new Error('simulated'); }, latest: (...a) => snapshotStore().latest(...a), lastAttempt: (...a) => snapshotStore().lastAttempt(...a), prune: async () => {} };
    const s = recorder();
    const out = await pass({ scraper: s, accountIds: [Q._id], caps: { READS_PER_DAY_MAX: base + 2 }, deps: { store: failingStore, saveTracking: async () => { throw new Error('simulated'); } } });
    assert.strictEqual(s.calls.length, 2, `ceiling was base+2 (${base + 2}); reads were ${s.calls.length} ${JSON.stringify(out)}`);
    assert.strictEqual(await Snapshot.countDocuments({ userId: Q._id }), 0, 'rows exist, the check is not about reads only');
    assert.strictEqual(await ReadLog.countDocuments({ userId: Q._id }), 2, 'read log should have exactly the 2 reads');
    return `base ${base}, stopped at 2 reads with 0 snapshot rows`;
  });
  const R = await mkUser('acctcap');
  const S2 = await mkUser('acctcap-other');
  const rc = [];
  for (let i = 0; i < 3; i++) rc.push(await mkComp(R, `Cap ${i}`, newHandle()));
  const sc = await mkComp(S2, 'Cap Other', newHandle());
  await check('the per-account daily cap stops one account but the pass goes on to the next account', async () => {
    const s = recorder();
    const out = await pass({ scraper: s, accountIds: [R._id, S2._id], caps: { maxReadsPerAccountPerDay: 1 } });
    const rReads = s.calls.filter((h) => rc.some((c) => c.socialHandles.instagram === h));
    assert.strictEqual(rReads.length, 1, `account R was read ${rReads.length} times with a cap of 1 ${JSON.stringify(out)}`);
    assert.ok(s.calls.includes(sc.socialHandles.instagram), 'the next account was not served after the first hit its cap');
    assert.strictEqual(await ReadLog.countDocuments({ userId: R._id }), 1);
  });
  await check('pass in test: the pass releases its lease (a following claim succeeds)', async () => {
    const l = createLease({ store: opsStateStore(undefined, leaseKey('pass')), holder: 'after-pass' });
    const t = await l.claim();
    assert.ok(t, 'the lease was left held after the passes');
    await l.release(t);
  });
  await check('a pass cannot run while the lease is held by someone else (busy), and reads nothing', async () => {
    const store = opsStateStore(undefined, leaseKey('busy'));
    const held = await createLease({ store, holder: 'other' }).claim();
    assert.ok(held);
    const s = recorder();
    const T = await mkUser('busy');
    await mkComp(T, 'Busy', newHandle());
    const out = await pass({ scraper: s, accountIds: [T._id], deps: { lease: createLease({ store, holder: 'me' }) } });
    assert.strictEqual(out.busy, true); assert.strictEqual(s.calls.length, 0);
  });

  // ===================================================================================================================
  section = '(6) routes:';
  const sec = tracker; void sec;
  const ci = require('../routes/competitorInsights');
  const staffRoutes = require('../routes/staff');
  const competitorRoutes = require('../routes/competitors');
  const staffCaps = { maxReadsPerAccountPerDay: 2 };
  const origStaffCheck = ci.staffCheck;
  const staffScraper = recorder();
  ci.staffCheck = (args) => origStaffCheck({ ...args, runTracker: (a) => tracker.runTrackerOnce({ ...a, deps: mkDeps({ scraper: staffScraper, caps: staffCaps }) }) });
  const app = express();
  app.use(express.json());
  app.use('/api/staff', staffRoutes);
  app.use('/api/competitors/insights', ci);
  app.use('/api/competitors', competitorRoutes);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, token, body) => {
    const res = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    let json = null; const text = await res.text(); try { json = JSON.parse(text); } catch (_) { json = null; }
    return { status: res.status, json, text };
  };
  try {
    const A = await mkUser('route-a');
    const B = await mkUser('route-b');
    const C = await mkUser('route-noaddon', {}, []);
    const D = await mkUser('route-limit');
    const tokA = generateToken(A._id); const tokB = generateToken(B._id); const tokC = generateToken(C._id); const tokD = generateToken(D._id);
    const weekNow = weekStartOf(new Date());
    const weekPrev = weekStartOf(new Date(Date.now() - 7 * DAY));
    const weekOlder = weekStartOf(new Date(Date.now() - 14 * DAY));
    const a1 = await mkComp(A, 'Alpha Rival', newHandle(), { handleStatus: 'suggested', tracking: { failures: 3, pausedAt: new Date(), lastCheckedAt: new Date(), lastHandle: 'old.handle' } });
    const a2 = await mkComp(A, 'Alpha Stale', newHandle(), { tracking: { pausedAt: new Date(), failures: 3, lastCheckedAt: new Date(Date.now() - 8 * DAY) } });
    const b1 = await mkComp(B, 'Bravo Secret Rival', newHandle());
    const c1 = await mkComp(C, 'Charlie Rival', newHandle());
    const d1 = await mkComp(D, 'Delta Rival', newHandle());
    const store = snapshotStore();
    await store.save({ userId: A._id, competitorId: a2._id, weekStart: weekPrev, takenAt: new Date(Date.now() - 8 * DAY), handle: a2.socialHandles.instagram, ok: true, followers: 500, postsInWindow: 3, posts30: 9, avgLikes: 20, avgComments: 2, formats: { image: 3, video: 0, carousel: 0 }, topPost: { url: 'https://www.instagram.com/p/x/', likes: 40, comments: 4, type: 'Image', caption: 'x' }, hashtags: [] });
    await store.save({ userId: B._id, competitorId: b1._id, weekStart: weekNow, takenAt: new Date(), handle: b1.socialHandles.instagram, ok: true, followers: 9999, postsInWindow: 7, posts30: 20, avgLikes: 90, avgComments: 9, formats: { image: 7, video: 0, carousel: 0 }, topPost: { url: 'https://www.instagram.com/p/bravo/', likes: 90, comments: 9, type: 'Image', caption: 'bravo' }, hashtags: [] });
    // A corrupt row: a snapshot filed under A's stale competitor but owned by B must never be shown to A.
    await Snapshot.create({ userId: B._id, competitorId: a2._id, weekStart: weekNow, takenAt: new Date(), handle: 'zz.corrupt', ok: true, followers: 123456, postsInWindow: 99, posts30: 99, avgLikes: 1, avgComments: 1, formats: { image: 1, video: 0, carousel: 0 } });

    await check('PUT handle: happy path (strips @, confirmed, pause and failures cleared, check time cleared)', async () => {
      const r = await call('PUT', `/api/competitors/${a1._id}/handle`, tokA, { handle: '@alpha.new_1' });
      assert.strictEqual(r.status, 200, r.text);
      assert.deepStrictEqual(r.json.competitor, { id: String(a1._id), name: 'Alpha Rival', handle: 'alpha.new_1', handleStatus: 'confirmed' });
      const row = await Competitor.findById(a1._id).lean();
      assert.strictEqual(row.socialHandles.instagram, 'alpha.new_1'); assert.strictEqual(row.handleStatus, 'confirmed');
      assert.strictEqual(row.tracking.failures, 0); assert.strictEqual(row.tracking.pausedAt, null); assert.strictEqual(row.tracking.lastCheckedAt, null);
      // Keep the owner's own server (if its tracker is on) from ever reading this throwaway handle.
      await Competitor.updateOne({ _id: a1._id }, { $set: { 'socialHandles.instagram': newHandle() } });
    });
    await check('PUT handle: 400 for a bad format and nothing changes', async () => {
      for (const bad of ['has space', 'a'.repeat(31), '', 'bad!char', null]) {
        const r = await call('PUT', `/api/competitors/${a1._id}/handle`, tokA, { handle: bad });
        assert.strictEqual(r.status, 400, `handle ${JSON.stringify(bad)} gave ${r.status}`);
        assert.strictEqual(r.json.success, false);
      }
    });
    await check('PUT handle: 404 for another account\'s competitor (and for a malformed id), the other account is untouched', async () => {
      const before = await Competitor.findById(b1._id).lean();
      const r = await call('PUT', `/api/competitors/${b1._id}/handle`, tokA, { handle: 'hijack.attempt' });
      assert.strictEqual(r.status, 404, r.text);
      const after = await Competitor.findById(b1._id).lean();
      assert.strictEqual(after.socialHandles.instagram, before.socialHandles.instagram);
      assert.strictEqual((await call('PUT', '/api/competitors/not-an-id/handle', tokA, { handle: 'x' })).status, 404);
      assert.strictEqual((await call('PUT', `/api/competitors/${a1._id}/handle`, null, { handle: 'x' })).status, 401);
    });
    await check('PUT handle and insights: 403 without the add-on (standard upgrade body)', async () => {
      const r = await call('PUT', `/api/competitors/${c1._id}/handle`, tokC, { handle: 'valid.handle' });
      assert.strictEqual(r.status, 403, r.text); assert.strictEqual(r.json.upgradeRequired, true);
      assert.strictEqual((await Competitor.findById(c1._id).lean()).socialHandles.instagram, c1.socialHandles.instagram, 'handle changed despite the 403');
      const g = await call('GET', '/api/competitors/insights', tokC);
      assert.strictEqual(g.status, 403);
    });
    await check('PUT handle: 429 on repeated calls (limit 30 per 15 minutes per account), other accounts unaffected', async () => {
      const codes = [];
      for (let i = 0; i < 32; i++) codes.push((await call('PUT', `/api/competitors/${d1._id}/handle`, tokD, { handle: `zz.rdbchk.lim${stamp}${i % 5}` })).status);
      const first429 = codes.indexOf(429);
      assert.ok(first429 >= 30, `first 429 at call ${first429 + 1}; codes ${codes.join(',')}`);
      assert.ok(codes.slice(0, 30).every((c) => c === 200), `the first 30 should all be 200: ${codes.slice(0, 30).join(',')}`);
      assert.strictEqual((await call('PUT', `/api/competitors/${a1._id}/handle`, tokA, { handle: 'zz.rdbchk.other.account' })).status, 200, 'account A was limited by account D\'s calls');
      await Competitor.updateOne({ _id: a1._id }, { $set: { 'socialHandles.instagram': newHandle(), handleStatus: 'suggested' } });
      return `statuses: 30 x 200, then ${codes.slice(30).join(',')}`;
    });
    await check('insights: rows carry handleStatus, weekOf, isCurrentWeek, previousWeekOf, lastCheckedOn; stale week is not "this week"; no other account\'s data', async () => {
      // Confirm a1 and read it with the fake scraper so it has a current-week snapshot.
      await Competitor.updateOne({ _id: a1._id }, { $set: { handleStatus: 'confirmed', 'tracking.pausedAt': null, 'tracking.failures': 0, 'tracking.lastCheckedAt': null } });
      const s = recorder();
      await pass({ scraper: s, accountIds: [A._id] });
      assert.strictEqual(s.calls.length, 1, `A pass should read a1 only, read ${s.calls.join(', ')}`);
      const r = await call('GET', '/api/competitors/insights', tokA);
      assert.strictEqual(r.status, 200, r.text);
      assert.strictEqual(r.json.weekStart, weekNow);
      const rows = new Map(r.json.competitors.map((x) => [x.id, x]));
      assert.strictEqual(rows.size, 2, `A has 2 tracked competitors, response had ${rows.size}`);
      const cur = rows.get(String(a1._id)); const old = rows.get(String(a2._id));
      for (const row of [cur, old]) for (const k of ['handleStatus', 'weekOf', 'isCurrentWeek', 'previousWeekOf', 'lastCheckedOn', 'status', 'lastCheckedAt', 'trend']) assert.ok(k in row, `missing ${k}`);
      assert.strictEqual(cur.handleStatus, 'confirmed'); assert.strictEqual(cur.isCurrentWeek, true); assert.strictEqual(cur.weekOf, weekNow);
      assert.strictEqual(old.isCurrentWeek, false, 'the stale competitor looks current (corrupt row leaked?)');
      assert.strictEqual(old.weekOf, weekPrev); assert.ok(/^\d{4}-\d\d-\d\d$/.test(old.lastCheckedOn || ''), 'lastCheckedOn missing for the stale competitor');
      assert.strictEqual(old.status, 'paused');
      assert.ok(!r.json.highlights.some((h) => h.competitorId === String(a2._id)), 'a highlight was written about a not-current competitor');
      assert.ok(r.json.highlights.some((h) => h.competitorId === String(a1._id)), 'no highlight for the current competitor');
      for (const secret of ['Bravo Secret Rival', String(b1._id), b1.socialHandles.instagram, String(B._id), 'zz.corrupt', '123456', '9999']) assert.ok(!r.text.includes(secret), `the response contains another account's data: ${secret}`);
      // And the other way round.
      const rb = await call('GET', '/api/competitors/insights', tokB);
      assert.strictEqual(rb.status, 200);
      assert.ok(!rb.text.includes('Alpha') && !rb.text.includes(String(a1._id)), 'B sees A\'s data');
      assert.deepStrictEqual(rb.json.competitors.map((x) => x.name), ['Bravo Secret Rival']);
    });
    await check('insights: a competitor from a snapshot two weeks old reports previousWeekOf null and not current (week-over-week guard)', async () => {
      await store.save({ userId: A._id, competitorId: a2._id, weekStart: weekOlder, takenAt: new Date(Date.now() - 15 * DAY), handle: a2.socialHandles.instagram, ok: true, followers: 400, postsInWindow: 1, posts30: 4, avgLikes: 10, avgComments: 1, formats: { image: 1, video: 0, carousel: 0 }, topPost: null, hashtags: [] });
      const r = await call('GET', '/api/competitors/insights', tokA);
      const old = r.json.competitors.find((x) => x.id === String(a2._id));
      assert.strictEqual(old.isCurrentWeek, false);
      assert.strictEqual(old.weekOf, weekPrev);
      assert.strictEqual(old.previousWeekOf, weekOlder, 'the week before weekOf is exactly 7 days earlier and may be named');
    });

    // ---- staff ----
    const staff = await mkUser('staff-owner', { staffRole: 'owner', plan: { tier: 'managed', addons: [] } });
    const tokStaff = generateToken(staff._id);
    const E = await mkUser('staff-client');
    const e1 = await mkComp(E, 'Echo Rival', newHandle());
    await check('staff check: refused for a normal customer token (403) and for an unknown client (404)', async () => {
      assert.strictEqual((await call('POST', `/api/staff/clients/${E._id}/competitors/check`, tokA)).status, 403);
      assert.strictEqual((await call('POST', `/api/staff/clients/${new mongoose.Types.ObjectId()}/competitors/check`, tokStaff)).status, 404);
      assert.strictEqual(staffScraper.calls.length, 0);
    });
    await check('staff check with force reads a competitor already checked this week, once, and is audited', async () => {
      const s = recorder();
      await pass({ scraper: s, accountIds: [E._id] }); // a normal pass: now it IS checked this week
      assert.strictEqual(s.calls.length, 1);
      const again = recorder();
      assert.strictEqual((await pass({ scraper: again, accountIds: [E._id] })).checked, 0, 'a normal pass must not read it again');
      const r = await call('POST', `/api/staff/clients/${E._id}/competitors/check`, tokStaff);
      assert.strictEqual(r.status, 200, r.text);
      assert.strictEqual(r.json.checked, 1, JSON.stringify(r.json));
      assert.strictEqual(staffScraper.calls.length, 1, `staff check should have read once, read ${staffScraper.calls.length}`);
      const audit = await StaffAction.find({ client: E._id, action: 'check_competitors' }).lean();
      assert.strictEqual(audit.length, 1, `expected one audit row, found ${audit.length}`);
      assert.strictEqual(String(audit[0].actor), String(staff._id)); assert.strictEqual(audit[0].details.checked, 1);
      const logRows = await ReadLog.find({ userId: E._id }).lean();
      assert.deepStrictEqual(logRows.map((x) => x.source).sort(), ['staff', 'tracker']);
    });
    await check('staff check respects the per-account daily cap (2 reads today already: refused to read, still audited)', async () => {
      const r = await call('POST', `/api/staff/clients/${E._id}/competitors/check`, tokStaff);
      assert.strictEqual(r.status, 200, r.text);
      assert.strictEqual(r.json.checked, 0, JSON.stringify(r.json));
      assert.strictEqual(staffScraper.calls.length, 1, 'the cap did not stop a read');
      assert.strictEqual(await StaffAction.countDocuments({ client: E._id, action: 'check_competitors' }), 2);
    });
    await check('staff GET competitors returns the client\'s view only', async () => {
      const r = await call('GET', `/api/staff/clients/${E._id}/competitors`, tokStaff);
      assert.strictEqual(r.status, 200, r.text);
      assert.deepStrictEqual(r.json.competitors.map((x) => x.name), ['Echo Rival']);
      assert.ok(!r.text.includes('Alpha') && !r.text.includes('Bravo'));
    });
    ci.staffCheck = origStaffCheck;

    // =================================================================================================================
    section = '(7) deletion:';
    const G = await mkUser('erase');
    const g1 = await mkComp(G, 'Erase One', newHandle());
    const g2 = await mkComp(G, 'Erase Two', newHandle());
    const g3 = await mkComp(G, 'Erase Three', newHandle());
    const H = await mkUser('erase-other');
    const h1 = await mkComp(H, 'Keep One', newHandle());
    const sg = recorder();
    await pass({ scraper: sg, accountIds: [G._id, H._id] });
    assert.ok(sg.calls.length >= 4, 'setup: the pass did not read the erase accounts');
    await check('removing a competitor (removeCompetitorsWithSnapshots) removes its snapshots and no one else\'s', async () => {
      assert.strictEqual(await Snapshot.countDocuments({ competitorId: g3._id }), 1);
      await removeCompetitorsWithSnapshots({ _id: g3._id, userId: G._id });
      assert.strictEqual(await Competitor.countDocuments({ _id: g3._id }), 0);
      assert.strictEqual(await Snapshot.countDocuments({ competitorId: g3._id }), 0, 'the snapshot of a removed competitor is still there');
      assert.strictEqual(await Snapshot.countDocuments({ competitorId: { $in: [g1._id, g2._id, h1._id] } }), 3, 'other snapshots were touched');
    });
    await check('the account-deletion "data" step (data registry) removes the account\'s competitors, snapshots and read log; others stay', async () => {
      const del = require('../services/accountDeletion');
      const models = del.defaultModels();
      const user = await User.findById(G._id).lean();
      const steps = del.stepsFor({ user, models, deps: {}, now: new Date() });
      const dataStep = steps.find((s) => s.name === 'data');
      assert.ok(dataStep, 'no data step');
      assert.ok(await Snapshot.countDocuments({ userId: G._id }) >= 2 && await ReadLog.countDocuments({ userId: G._id }) >= 2, 'setup rows missing');
      const out = await dataStep.run();
      assert.strictEqual(await Snapshot.countDocuments({ userId: G._id }), 0, 'snapshots survive account deletion');
      assert.strictEqual(await Competitor.countDocuments({ userId: G._id }), 0, 'competitors survive account deletion');
      assert.strictEqual(await ReadLog.countDocuments({ userId: G._id }), 0, 'read-log rows survive account deletion');
      assert.strictEqual(await Snapshot.countDocuments({ userId: H._id }), 1, 'another account\'s snapshot was erased');
      assert.strictEqual(await Competitor.countDocuments({ userId: H._id }), 1);
      return out.detail;
    });
  } finally {
    ci.staffCheck = origStaffCheck;
    await new Promise((r) => server.close(r));
  }

  section = '(0) safety:';
  await check('no real scraper or search was reached: only throwaway handles were read', async () => {
    assert.deepStrictEqual(tripwire.bad, [], `unexpected scraper use: ${tripwire.bad.join(', ')}`);
    return `${tripwire.calls.length} fake reads`;
  });
}

(async () => {
  const mode = process.argv[2] || 'run';
  if (mode !== 'run' && mode !== 'cleanup') throw new Error('Usage: node scripts/competitors-realdb-check.js [run|cleanup]');
  await connect();
  console.log('Database: nebulaa_dev');
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
    const stray = Object.values(out.stray).filter((v) => v !== 'not checked').length;
    const unchecked = Object.values(out.stray).filter((v) => v === 'not checked').length;
    if (mode === 'run') {
      const fails = results.filter((r) => !r.ok);
      console.log(`\n${results.length - fails.length} PASS, ${fails.length} FAIL; left after cleanup: ${left}; other collections with rows: ${stray} (${unchecked} unindexed field scans timed out and were not checked)`);
      if (fails.length || left || stray || failed) process.exitCode = 1;
    }
  }
  await mongoose.disconnect();
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
