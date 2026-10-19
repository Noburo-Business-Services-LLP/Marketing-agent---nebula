/**
 * Real-database check of post approval, origin, the Bin and the Library counts against the DEVELOPMENT database.
 * Refuses any database except nebulaa_dev. NO AI call, NO outside call: the throwaway accounts have no connected social
 * profile, so "post now" stops at "No social accounts connected" before any provider is reached; scheduled times are days
 * ahead and are removed before any scheduler could pick them up; file deletion in the Bin purge is faked.
 * The routes run inside this process on a random 127.0.0.1 port (never 3000 or 5000), with real tokens.
 *   node scripts/approval-check.js          run every check, print a PASS/FAIL table, then delete everything it made
 *   node scripts/approval-check.js cleanup  delete leftovers of an interrupted run and print what is left
 * Everything it creates belongs to throwaway users whose email starts with "zz.apprchk-" (and the client workspace of the
 * throwaway agency, found by its owner). Exit code is non-zero on any FAIL, or if anything is left over.
 * Expected counts are computed here from the raw collection with plain JS, not with the service's own filters.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const http = require('http');
const express = require('express');
const assert = require('assert');

const PREFIX = 'zz.apprchk-';
const DEV_DB = 'nebulaa_dev';
const DAY = 864e5;
const LEASE_KEY = 'bin_purge_lease_apprchk';

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

const rx = () => ({ $regex: `^${PREFIX.replace(/\./g, '\\.')}` });
async function throwawayIds(db) {
  const base = await db.collection('users').find({ email: rx() }, { projection: { _id: 1 } }).toArray();
  const owners = base.map((u) => u._id);
  const clients = owners.length ? await db.collection('users').find({ 'agency.ownerId': { $in: owners } }, { projection: { _id: 1 } }).toArray() : [];
  return [...owners, ...clients.map((u) => u._id)];
}
async function cleanup(db) {
  const ids = await throwawayIds(db);
  const removed = {};
  for (const coll of ['drafts', 'campaigns']) {
    if (!ids.length) break;
    const c = (await db.collection(coll).deleteMany({ userId: { $in: ids } })).deletedCount;
    if (c) removed[coll] = c;
  }
  if (ids.length) {
    const c = (await db.collection('users').deleteMany({ _id: { $in: ids } })).deletedCount;
    if (c) removed.users = c;
  }
  const lease = (await db.collection('ops_state').deleteMany({ key: LEASE_KEY })).deletedCount;
  if (lease) removed.ops_state = lease;
  const left = {
    drafts: ids.length ? await db.collection('drafts').countDocuments({ userId: { $in: ids } }) : 0,
    campaigns: ids.length ? await db.collection('campaigns').countDocuments({ userId: { $in: ids } }) : 0,
    users: await db.collection('users').countDocuments({ email: rx() }) + (ids.length ? await db.collection('users').countDocuments({ _id: { $in: ids } }) : 0),
    ops_state: await db.collection('ops_state').countDocuments({ key: LEASE_KEY })
  };
  console.log('removed', JSON.stringify(removed));
  console.log('left', JSON.stringify(left));
  return { removed, left, leftTotal: Object.values(left).reduce((a, b) => a + b, 0) };
}

// Independent definitions (plain JS over raw rows), written separately from services/draftStatus.js.
const isVideo = (d) => ['reel', 'video'].includes(String(d.sourceType || d.contentType || 'post'));
const isAuto = (d) => (d.origin === 'automation') || (!d.origin && (d.contentCalendarId instanceof mongoose.Types.ObjectId || typeof d.calendarDay === 'number'));
const WAIT = new Set(['pending', 'draft', 'ready', 'processing', 'completed', 'failed']);
function expectedCounts(rows) {
  const c = { needsApproval: 0, drafts: 0, approved: 0, scheduled: 0, posted: 0, archived: 0, binned: 0 };
  for (const d of rows) {
    const s = d.status || 'draft';
    if (!isVideo(d) && WAIT.has(s)) { if (isAuto(d)) c.needsApproval += 1; else c.drafts += 1; }
    if (s === 'approved') c.approved += 1;
    if (s === 'scheduled') c.scheduled += 1;
    if (s === 'published') c.posted += 1;
    if (s === 'archived') c.archived += 1;
    if (s === 'binned') c.binned += 1;
  }
  return c;
}

async function runChecks() {
  const db = mongoose.connection.db;
  const User = require('../models/User');
  const Draft = require('../models/Draft');
  const Campaign = require('../models/Campaign');
  const legal = require('../config/legalVersions');
  const { generateToken } = require('../middleware/auth');
  const { createWorkspace, issueAgencyPass } = require('../services/agencyWorkspaces');
  const home = require('../routes/home');
  const draftRoutes = require('../routes/drafts');
  const { runBinPurgeOnce } = require('../services/binPurge');
  const { createLease } = require('../services/competitors/lease');

  section = '(0) safety:';
  await check('a database that is not nebulaa_dev is refused, and the live connection is the dev one', async () => {
    assert.throws(() => assertDevDatabase('nebulaa_prod'), /Refusing/);
    assert.throws(() => assertDevDatabase(''), /Refusing/);
    assert.strictEqual(mongoose.connection.name, DEV_DB);
  });

  const tag = `${PREFIX}${Date.now()}`;
  const mkUser = (suffix, extra = {}) => User.create({
    email: `${tag}-${suffix}@example.test`, password: 'Check-only-1', firstName: `Check ${suffix}`, isVerified: true, onboardingCompleted: true,
    plan: { tier: 'starter', addons: ['publish'] },
    consent: { termsVersion: legal.TERMS_VERSION, privacyVersion: legal.PRIVACY_VERSION, acceptedAt: new Date(), source: 'realdb-check' },
    businessProfile: { name: `Approval Check ${suffix}`, website: 'https://example.com', description: 'Hand poured soy candles', targetAudience: 'Homeowners' },
    credits: { balance: 0 },
    ...extra
  });
  const tokenOf = (u) => generateToken(u._id);

  const app = express();
  app.use(express.json());
  app.use('/api', home.watch);
  app.use('/api/home', home);
  app.use('/api/drafts', draftRoutes);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  assert.ok(port !== 3000 && port !== 5000);
  const call = async (method, path, token, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    let json = null; try { json = await res.json(); } catch (_) { /* not json */ }
    return { status: res.status, body: json };
  };
  const post = (path, token, body) => call('POST', path, token, body);
  const raw = async (id) => db.collection('drafts').findOne({ _id: new mongoose.Types.ObjectId(String(id)) });

  try {
    const owner = await mkUser('owner');
    const freeUser = await mkUser('free', { plan: { tier: 'free' } });
    const other = await mkUser('other');
    const T = tokenOf(owner);
    const mk = (u, status, extra = {}) => Draft.create({ userId: u._id, title: `Check ${status}`, caption: 'caption', status, sourceType: 'post', contentType: 'post', platforms: ['instagram'], imageUrl: '', ...extra });
    const in3 = new Date(Date.now() + 3 * DAY);

    // Automation posts (new rows with origin, and old rows without it), manual posts, and another account's post.
    const autoPlanned = await mk(owner, 'completed', { origin: 'automation', plannedDate: in3 });
    const autoNoDate = await mk(owner, 'completed', { origin: 'automation' });
    const autoUnapproved = await mk(owner, 'completed', { origin: 'automation' });
    const legacyWeekly = await db.collection('drafts').insertOne({ userId: owner._id, title: 'Old weekly post', status: 'completed', sourceType: 'post', contentType: 'post', calendarDay: 5, calendarWeek: 1, contentCalendarId: null, createdAt: new Date(), updatedAt: new Date() });
    const legacyManual = await db.collection('drafts').insertOne({ userId: owner._id, title: 'Old manual post', status: 'completed', sourceType: 'post', contentType: 'post', createdAt: new Date(), updatedAt: new Date() });
    const manual = await mk(owner, 'completed', { origin: 'manual' });
    const manual2 = await mk(owner, 'draft', { origin: 'manual' });
    const othersDraft = await mk(other, 'completed', { origin: 'automation', plannedDate: in3 });
    const othersBefore = JSON.stringify(await raw(othersDraft._id));

    section = '(1) approve:';
    await check('with a planned date ahead and the Publish add-on it is scheduled for that date (not posted)', async () => {
      const r = await post(`/api/drafts/${autoPlanned._id}/approve`, T);
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.strictEqual(r.body.outcome, 'scheduled');
      const d = await raw(autoPlanned._id);
      assert.strictEqual(d.status, 'scheduled');
      assert.strictEqual(new Date(d.scheduledDate).getTime(), in3.getTime());
      const c = await db.collection('campaigns').findOne({ _id: d.campaignId });
      assert.ok(c && c.status === 'scheduled', 'the scheduler campaign is scheduled');
      assert.ok(!c.publishedAt, 'nothing was posted');
    });
    await check('without a planned date it waits as approved', async () => {
      const r = await post(`/api/drafts/${autoNoDate._id}/approve`, T);
      assert.strictEqual(r.body.outcome, 'approved');
      assert.strictEqual((await raw(autoNoDate._id)).status, 'approved');
    });
    await check('without publish rights (free plan) a planned post waits as approved', async () => {
      const f = await mk(freeUser, 'completed', { origin: 'automation', plannedDate: in3 });
      const r = await post(`/api/drafts/${f._id}/approve`, tokenOf(freeUser));
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.body.outcome, 'approved');
      assert.strictEqual(await db.collection('campaigns').countDocuments({ userId: freeUser._id }), 0);
    });
    await check('an old weekly post without origin is treated as automation and can be approved', async () => {
      const r = await post(`/api/drafts/${legacyWeekly.insertedId}/approve`, T);
      assert.strictEqual(r.status, 200);
      assert.strictEqual((await raw(legacyWeekly.insertedId)).origin, undefined, 'no backfill was written');
    });

    section = '(2) the publish gate:';
    await check('an unapproved automation post is refused for publish and schedule with 409', async () => {
      const p = await post(`/api/drafts/${autoUnapproved._id}/publish`, T, {});
      assert.strictEqual(p.status, 409);
      assert.strictEqual(p.body.message, 'Approve this post first.');
      const s = await post(`/api/drafts/${autoUnapproved._id}/schedule`, T, { scheduledDate: in3.toISOString() });
      assert.strictEqual(s.status, 409);
      assert.strictEqual((await raw(autoUnapproved._id)).status, 'completed');
    });
    await check('a manual post goes straight to publish (stops at "no connected accounts", no provider call)', async () => {
      const p = await post(`/api/drafts/${manual._id}/publish`, T, {});
      assert.strictEqual(p.status, 400, JSON.stringify(p.body));
      assert.match(p.body.message, /No social accounts connected/);
    });
    await check('a manual post can be scheduled directly, and an old manual post too', async () => {
      const s = await post(`/api/drafts/${manual2._id}/schedule`, T, { scheduledDate: in3.toISOString() });
      assert.strictEqual(s.status, 200, JSON.stringify(s.body));
      assert.strictEqual((await raw(manual2._id)).status, 'scheduled');
      const p = await post(`/api/drafts/${legacyManual.insertedId}/publish`, T, {});
      assert.strictEqual(p.status, 400);
    });
    await check('an approved automation post can be scheduled', async () => {
      const s = await post(`/api/drafts/${autoNoDate._id}/schedule`, T, { scheduledDate: in3.toISOString() });
      assert.strictEqual(s.status, 200);
      assert.strictEqual((await raw(autoNoDate._id)).status, 'scheduled');
    });

    section = '(3) unschedule:';
    await check('scheduled goes back to approved and its campaign stops', async () => {
      const r = await post(`/api/drafts/${autoPlanned._id}/unschedule`, T);
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      const d = await raw(autoPlanned._id);
      assert.strictEqual(d.status, 'approved');
      assert.strictEqual((await db.collection('campaigns').findOne({ _id: d.campaignId })).status, 'draft');
      for (const id of [autoNoDate._id, manual2._id]) assert.strictEqual((await post(`/api/drafts/${id}/unschedule`, T)).status, 200);
    });

    section = '(4) Bin and restore:';
    const toBin = await mk(owner, 'completed', { origin: 'manual', imageUrl: 'https://res.cloudinary.com/demo/image/upload/v1/nebula-campaign-posts/zz-apprchk-own.png', imageUrlNoLogo: 'https://res.cloudinary.com/demo/image/upload/v1/nebula-posters/zz-apprchk-clean.png' });
    const shared = 'https://res.cloudinary.com/demo/image/upload/v1/nebula-campaign-posts/zz-apprchk-shared.png';
    const toBinShared = await mk(owner, 'completed', { origin: 'manual', imageUrl: shared });
    await mk(owner, 'published', { origin: 'manual', imageUrl: shared });
    const posted = await mk(owner, 'published', { origin: 'manual' });
    const restorable = await mk(owner, 'approved', { origin: 'automation' });
    await check('delete moves to the Bin with the time and the previous status', async () => {
      for (const id of [toBin._id, toBinShared._id, restorable._id]) assert.strictEqual((await call('DELETE', `/api/drafts/${id}`, T)).status, 200);
      const d = await raw(restorable._id);
      assert.strictEqual(d.status, 'binned');
      assert.strictEqual(d.binnedFrom, 'approved');
      assert.ok(d.binnedAt);
    });
    await check('posted items cannot be binned, scheduled ones must be unscheduled first', async () => {
      const p = await call('DELETE', `/api/drafts/${posted._id}`, T);
      assert.strictEqual(p.status, 409);
      const s = await mk(owner, 'scheduled', { origin: 'manual' });
      assert.strictEqual((await call('DELETE', `/api/drafts/${s._id}`, T)).status, 409);
      assert.strictEqual((await post(`/api/drafts/${posted._id}/archive`, T)).status, 200);
    });
    await check('the Bin is hidden from the normal list and shown when asked', async () => {
      const all = await call('GET', '/api/drafts', T);
      assert.ok(!all.body.drafts.some((d) => d.status === 'binned'));
      const bin = await call('GET', '/api/drafts?status=binned', T);
      assert.strictEqual(bin.body.drafts.length, 3);
    });
    await check('restore within 14 days brings it back as it was; after 14 days it is refused', async () => {
      assert.strictEqual((await post(`/api/drafts/${restorable._id}/restore`, T)).status, 200);
      assert.strictEqual((await raw(restorable._id)).status, 'approved');
      await call('DELETE', `/api/drafts/${restorable._id}`, T);
      await db.collection('drafts').updateOne({ _id: restorable._id }, { $set: { binnedAt: new Date(Date.now() - 15 * DAY) } });
      assert.strictEqual((await post(`/api/drafts/${restorable._id}/restore`, T)).status, 410);
      assert.strictEqual((await post(`/api/drafts/${posted._id}/restore`, T)).status, 200);
      assert.strictEqual((await raw(posted._id)).status, 'published', 'an archived posted item comes back as posted');
    });
    await check('the purge with a simulated clock removes only old Bin items, with their files, keeping shared files', async () => {
      const ids = await throwawayIds(db);
      const deleted = [];
      const deps = { lease: createLease({ key: LEASE_KEY, ttlMs: 60000 }), deleteAssets: async (a) => { deleted.push(...a); return { requested: a.length, failedBatches: 0 }; }, only: { userId: { $in: ids } }, log: { log() {} } };
      const today = await runBinPurgeOnce({ ...deps, now: () => new Date() });
      assert.strictEqual(today.purged, 1, `only the item binned 15 days ago (${JSON.stringify(today)})`);
      assert.strictEqual(await raw(restorable._id), null);
      assert.ok(await raw(toBin._id), 'a young Bin item stays');
      const later = await runBinPurgeOnce({ ...deps, now: () => new Date(Date.now() + 15 * DAY) });
      assert.strictEqual(later.purged, 2);
      assert.strictEqual(await raw(toBin._id), null);
      assert.strictEqual(await raw(toBinShared._id), null);
      assert.deepStrictEqual(deleted.map((a) => a.publicId).sort(), ['nebula-campaign-posts/zz-apprchk-own', 'nebula-posters/zz-apprchk-clean']);
      const again = await runBinPurgeOnce({ ...deps, now: () => new Date(Date.now() + 15 * DAY) });
      assert.strictEqual(again.purged, 0, 'idempotent');
      assert.ok(await raw(posted._id), 'posted items are never touched');
      return `files asked to delete ${deleted.length}`;
    });

    section = '(5) other accounts:';
    await check('another account\'s post is never approved, binned, restored or unscheduled', async () => {
      for (const p of ['approve', 'unapprove', 'unschedule', 'archive', 'restore', 'publish']) {
        const r = await post(`/api/drafts/${othersDraft._id}/${p}`, T, {});
        assert.strictEqual(r.status, 404, `${p} ${r.status}`);
      }
      assert.strictEqual((await call('DELETE', `/api/drafts/${othersDraft._id}`, T)).status, 404);
      assert.strictEqual(JSON.stringify(await raw(othersDraft._id)), othersBefore);
    });

    section = '(6) agency client workspace:';
    await check('inside a client, the pass approves the client\'s post; the agency\'s own token cannot', async () => {
      const agency = await mkUser('agency', { plan: { tier: 'agency', addons: [] } });
      const created = await createWorkspace({ owner: agency, name: 'Approval Check Client', models: { User } });
      assert.ok(created.ok, JSON.stringify(created));
      const ws = created.workspace;
      const clientPost = await mk(ws, 'completed', { origin: 'automation' });
      const pass = issueAgencyPass({ workspaceId: ws._id, ownerId: agency._id });
      assert.strictEqual((await post(`/api/drafts/${clientPost._id}/approve`, tokenOf(agency))).status, 404);
      const r = await post(`/api/drafts/${clientPost._id}/approve`, pass);
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.strictEqual((await raw(clientPost._id)).status, 'approved');
      const c = await call('GET', '/api/drafts/counts', pass);
      assert.strictEqual(c.body.counts.approved, 1);
      assert.strictEqual(c.body.counts.needsApproval, 0);
    });

    section = '(7) counts:';
    await check('counts equal independent counts of the raw rows', async () => {
      await mk(owner, 'completed', { origin: 'automation' });
      await mk(owner, 'failed', { origin: 'automation' });
      await mk(owner, 'draft', { origin: 'automation', sourceType: 'reel', contentType: 'reel' });
      const rows = await db.collection('drafts').find({ userId: owner._id }).toArray();
      const exp = expectedCounts(rows);
      const r = await call('GET', '/api/drafts/counts', T);
      assert.strictEqual(r.status, 200);
      assert.deepStrictEqual(r.body.counts, exp);
      assert.ok(exp.needsApproval >= 3 && exp.drafts >= 0);
      return JSON.stringify(exp);
    });
    await check('Home "drafts waiting" equals the Library needs-approval count, and a write clears the Home cache', async () => {
      const h1 = await call('GET', '/api/home/summary', T);
      const c1 = await call('GET', '/api/drafts/counts', T);
      assert.strictEqual(h1.body.numbers.draftsWaiting.value, c1.body.counts.needsApproval);
      const extra = await mk(owner, 'completed', { origin: 'automation' });
      await post(`/api/drafts/${extra._id}/approve`, T);
      const h2 = await call('GET', '/api/home/summary', T);
      assert.strictEqual(h2.body.cached, false, 'the approve write cleared the cached summary');
      const c2 = await call('GET', '/api/drafts/counts', T);
      assert.strictEqual(h2.body.numbers.draftsWaiting.value, c2.body.counts.needsApproval);
      return `needs approval ${c2.body.counts.needsApproval}`;
    });
  } finally {
    await new Promise((r) => server.close(r));
  }
}

async function main() {
  await connect();
  const db = mongoose.connection.db;
  if (process.argv[2] === 'cleanup') {
    const out = await cleanup(db);
    await mongoose.disconnect();
    process.exit(out.leftTotal ? 1 : 0);
  }
  let crashed = null;
  try { await runChecks(); } catch (e) { crashed = e; console.log(`FAIL  run stopped: ${e && e.message}`); }
  const out = await cleanup(db);
  await mongoose.disconnect();
  const failed = results.filter((r) => !r.ok);
  console.log('\nRESULT');
  console.log('| # | check | result |');
  console.log('|---|---|---|');
  results.forEach((r, i) => console.log(`| ${i + 1} | ${r.label.trim()} | ${r.ok ? 'PASS' : 'FAIL'} |`));
  console.log(`\n${results.length - failed.length} PASS, ${failed.length} FAIL; leftovers ${out.leftTotal}`);
  process.exit(failed.length || crashed || out.leftTotal ? 1 : 0);
}

main().catch(async (e) => {
  console.error('approval-check error:', e && e.message);
  try { await mongoose.disconnect(); } catch (_) { /* closing */ }
  process.exit(1);
});
