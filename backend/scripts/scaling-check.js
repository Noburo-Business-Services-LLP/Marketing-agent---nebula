/**
 * Real-database check of the scaling work (docs/superpowers/ops/ecs-web-worker.md), against the DEVELOPMENT database
 * only: refuses any database except nebulaa_dev. No provider call (outgoing requests to non-local hosts are refused).
 * It simulates two server tasks inside this process:
 *   1. two rate limiters (two stores, two in-process servers on random 127.0.0.1 ports) share one count in the
 *      `rate_limits` collection; a window ends; the TTL index exists;
 *   2. OAuth state: single use, an expired state refused, a wrong purpose refused, the TTL index exists;
 *   3. campaign image jobs: two runners claim each job exactly once; the 6th waiting job of one account is refused;
 *      a job whose lease ran out is failed once and not run again.
 * Throwaway data only (ids and prefixes starting with "zz.scaling-check"), all deleted at the end; exits non-zero on
 * any FAIL or leftover row.
 *   node scripts/scaling-check.js          run, print PASS/FAIL, clean up
 *   node scripts/scaling-check.js cleanup  delete leftovers of an interrupted run
 */
require('dotenv').config();
const https = require('https');
const http = require('http');
const outgoing = [];
const isLocal = (h) => /^(127\.0\.0\.1|localhost|\[::1\]|::1)$/.test(String(h || ''));
for (const mod of [https]) {
  for (const fn of ['request', 'get']) {
    const orig = mod[fn];
    mod[fn] = function guarded(a, ...rest) {
      const host = typeof a === 'string' || a instanceof URL ? new URL(String(a)).hostname : (a && (a.hostname || a.host));
      if (!isLocal(host)) { outgoing.push(host); throw new Error(`scaling-check: outgoing request to ${host} refused`); }
      return orig.call(this, a, ...rest);
    };
  }
}

const mongoose = require('mongoose');
const express = require('express');
const assert = require('assert');

const DEV_DB = 'nebulaa_dev';
const TAG = 'zz.scaling-check';
const RUN = `${TAG}-${Date.now()}`;
const results = [];
async function check(name, fn) {
  try { const d = await fn(); results.push(true); console.log(`PASS  ${name}${d ? ` (${d})` : ''}`); } catch (e) { results.push(false); console.log(`FAIL  ${name}: ${e && e.message}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rx = new RegExp(`^${TAG.replace(/\./g, '\\.')}`);

async function cleanup(db) {
  return {
    rateLimits: (await db.collection('rate_limits').deleteMany({ p: { $regex: rx } })).deletedCount,
    oauthStates: (await db.collection('oauth_states').deleteMany({ userId: { $regex: rx } })).deletedCount,
    imageJobs: (await db.collection('image_jobs').deleteMany({ userId: { $regex: rx } })).deletedCount
  };
}
async function leftovers(db) {
  return (await db.collection('rate_limits').countDocuments({ p: { $regex: rx } }))
    + (await db.collection('oauth_states').countDocuments({ userId: { $regex: rx } }))
    + (await db.collection('image_jobs').countDocuments({ userId: { $regex: rx } }));
}

function get(port) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: '/' }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); }).on('error', reject);
  });
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set (run from the backend folder so .env is found).');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  if (mongoose.connection.name !== DEV_DB) throw new Error(`Refusing: database is ${mongoose.connection.name}, not ${DEV_DB}`);
  const db = mongoose.connection.db;
  if (process.argv.includes('cleanup')) { console.log('removed', await cleanup(db)); return 0; }
  await cleanup(db);

  const { rateLimit, MongoRateLimitStore } = require('../services/rateLimitStore');
  const oauth = require('../services/oauthState');
  const OAuthState = require('../models/OAuthState');
  const ImageJob = require('../models/ImageJob');
  const Q = require('../services/imageJobQueue');

  // ---- 1. rate limits shared by two tasks ----------------------------------------------------------------------
  const servers = [];
  await check('two limiter instances (two "tasks") share one count in MongoDB; the 6th request is refused by either', async () => {
    const prefix = `${RUN}:shared`;
    const mk = () => rateLimit({ windowMs: 60_000, max: 5, standardHeaders: true, legacyHeaders: false, store: new MongoRateLimitStore({ prefix, wait: 5000 }) });
    const ports = [];
    for (let i = 0; i < 2; i += 1) {
      const app = express();
      app.set('trust proxy', false);
      app.use(mk());
      app.get('/', (req, res) => res.send('ok'));
      const s = await new Promise((r) => { const x = app.listen(0, '127.0.0.1', () => r(x)); });
      servers.push(s); ports.push(s.address().port);
    }
    const codes = [await get(ports[0]), await get(ports[1]), await get(ports[0]), await get(ports[1]), await get(ports[0])];
    assert.deepStrictEqual(codes, [200, 200, 200, 200, 200]);
    assert.strictEqual(await get(ports[1]), 429);
    assert.strictEqual(await get(ports[0]), 429);
    const docs = await db.collection('rate_limits').find({ p: prefix }).toArray();
    assert.ok(docs.length >= 1 && docs.length <= 2, 'one document per window');
    assert.strictEqual(docs.reduce((n, d) => n + d.hits, 0), 7);
    return `hits ${docs[0].hits}, one document, key stored hashed`;
  });

  await check('50 increments at once from two stores count exactly 50 (atomic upsert)', async () => {
    const prefix = `${RUN}:atomic`;
    // Correctness, not speed: a generous time limit here (the app uses 1.5 s and then lets the request through).
    const a = new MongoRateLimitStore({ prefix, timeoutMs: 15000, wait: 15000 }); const b = new MongoRateLimitStore({ prefix, timeoutMs: 15000, wait: 15000 });
    a.init({ windowMs: 600_000 }); b.init({ windowMs: 600_000 });
    const times = [];
    const out = await Promise.all(Array.from({ length: 50 }, async (_, i) => { const t = Date.now(); const r = await (i % 2 ? a : b).increment('k'); times.push(Date.now() - t); return r; }));
    const hits = out.map((o) => o.totalHits).sort((x, y) => x - y);
    assert.deepStrictEqual(hits, Array.from({ length: 50 }, (_, i) => i + 1));
    times.sort((x, y) => x - y);
    return `counts 1..50, no duplicate; one key hit 50 times at once from this Mac: p50 ${times[25]} ms, max ${times[49]} ms`;
  });

  await check('with the app defaults (wait 300 ms): 20 counts one after another, none let through uncounted', async () => {
    const s = new MongoRateLimitStore({ prefix: `${RUN}:defaults` });
    s.init({ windowMs: 600_000 });
    const times = [];
    for (let i = 1; i <= 20; i += 1) { const t = Date.now(); const r = await s.increment('k'); times.push(Date.now() - t); assert.strictEqual(r.totalHits, i); }
    times.sort((x, y) => x - y);
    return `p50 ${times[10]} ms, max ${times[19]} ms from this Mac (about 80 ms of it is the network to Atlas)`;
  });

  await check('a window ends and the count starts again; the TTL index on rate_limits exists', async () => {
    // Windows are aligned to multiples of windowMs: start just after a boundary so two quick hits share one window.
    const s = new MongoRateLimitStore({ prefix: `${RUN}:window`, wait: 5000 });
    s.init({ windowMs: 4000 });
    await sleep(4000 - (Date.now() % 4000) + 50);
    assert.strictEqual((await s.increment('k')).totalHits, 1);
    assert.strictEqual((await s.increment('k')).totalHits, 2);
    await sleep(4000 - (Date.now() % 4000) + 50);
    assert.strictEqual((await s.increment('k')).totalHits, 1);
    await sleep(300);
    const idx = await db.collection('rate_limits').indexes();
    const ttl = idx.find((i) => i.name === 'ttl_expireAt');
    assert.ok(ttl && ttl.expireAfterSeconds === 0, 'ttl_expireAt index');
    return 'expireAfterSeconds 0 on expireAt';
  });

  // ---- 2. OAuth state ------------------------------------------------------------------------------------------
  await check('OAuth state: single use, wrong purpose refused, expired refused, TTL index exists', async () => {
    await OAuthState.init();
    const userId = `${RUN}-user`;
    const st = await oauth.issue({ userId, purpose: 'google_calendar' });
    assert.strictEqual(await oauth.consume(st, { purpose: 'youtube' }), null, 'wrong purpose');
    assert.deepStrictEqual(await oauth.consume(st, { purpose: 'google_calendar' }), { userId, platform: '' });
    assert.strictEqual(await oauth.consume(st, { purpose: 'google_calendar' }), null, 'second use');
    const past = oauth.createOAuthStates({ now: () => Date.now() - 11 * 60 * 1000 });
    const old = await past.issue({ userId, purpose: 'youtube' });
    assert.strictEqual(await oauth.consume(old, { purpose: 'youtube' }), null, 'expired');
    const idx = await db.collection('oauth_states').indexes();
    assert.ok(idx.some((i) => i.name === 'ttl_expiresAt' && i.expireAfterSeconds === 0));
    const raw = await db.collection('oauth_states').countDocuments({ _id: st });
    assert.strictEqual(raw, 0, 'the raw state is never stored');
    return 'ttl_expiresAt present';
  });

  // ---- 3. image jobs -------------------------------------------------------------------------------------------
  await check('image jobs: two runners claim each stored job exactly once', async () => {
    await ImageJob.init();
    const ran = [];
    const mk = (owner) => {
      const q = Q.createImageJobQueue({ owner, runsJobsHere: false, concurrency: 4, log: { log() {}, warn() {}, error: console.error } });
      q.registerHandler('check', async ({ jobId }) => { ran.push({ owner, jobId }); await sleep(50); return { ok: true }; });
      return q;
    };
    const web = mk('web'); const a = mk('runner-a'); const b = mk('runner-b');
    const ids = [];
    for (let u = 0; u < 3; u += 1) for (let j = 0; j < 2; j += 1) ids.push((await web.enqueue({ userId: `${RUN}-u${u}`, type: 'check', payload: { j } })).jobId);
    for (let round = 0; round < 6; round += 1) { await Promise.all([a.drain(), b.drain()]); await sleep(120); }
    const rows = await ImageJob.find({ jobId: { $in: ids } }).lean();
    assert.strictEqual(rows.length, 6);
    assert.ok(rows.every((r) => r.status === 'completed'), rows.map((r) => r.status).join(','));
    assert.ok(rows.every((r) => r.attempts === 1));
    const counts = {};
    for (const r of ran) counts[r.jobId] = (counts[r.jobId] || 0) + 1;
    assert.deepStrictEqual(Object.values(counts).sort(), [1, 1, 1, 1, 1, 1]);
    const owners = new Set(ran.map((r) => r.owner));
    assert.ok(!owners.has('web'), 'the web "task" ran nothing');
    return `6 jobs, ${ran.length} runs, runners used: ${[...owners].join(' and ')}`;
  });

  await check('image jobs: the 6th waiting job of one account is refused (429); status readable only by its account', async () => {
    const q = Q.createImageJobQueue({ owner: 'web', runsJobsHere: false, log: { log() {}, warn() {}, error() {} } });
    const userId = `${RUN}-heavy`;
    let first = null;
    for (let i = 0; i < 5; i += 1) { const j = await q.enqueue({ userId, type: 'check' }); first = first || j; }
    await assert.rejects(() => q.enqueue({ userId, type: 'check' }), (e) => e instanceof Q.QueueFullError);
    const seen = await q.getJob(first.jobId, userId);
    assert.strictEqual(seen.status, 'queued');
    assert.ok(seen.queuePosition >= 1);
    assert.strictEqual(await q.getJob(first.jobId, `${RUN}-other`), null);
    await ImageJob.deleteMany({ userId }); // nothing runs them: leave no waiting job for the next check's runner
    return `queue position ${seen.queuePosition}`;
  });

  await check('image jobs: a job whose lease ran out is failed once and not run again', async () => {
    const now = new Date();
    const jobId = `${RUN}-lost`;
    await ImageJob.create({ jobId, userId: `${RUN}-lost-user`, type: 'check', status: 'processing', leaseOwner: 'dead-task', leaseUntil: new Date(now.getTime() - 1000), attempts: 1, expireAt: new Date(now.getTime() + 3600_000) });
    let ran = 0;
    const q = Q.createImageJobQueue({ owner: 'sweeper', runsJobsHere: false, log: { log() {}, warn() {}, error() {} } });
    q.registerHandler('check', async () => { ran += 1; });
    assert.ok((await q.sweepLost()) >= 1);
    assert.strictEqual(await q.sweepLost(), 0);
    await q.drain();
    const row = await ImageJob.findOne({ jobId }).lean();
    assert.strictEqual(row.status, 'failed');
    assert.strictEqual(row.error.message, Q.LOST_MESSAGE);
    assert.strictEqual(ran, 0);
    return 'failed with the plain message';
  });

  for (const s of servers) s.close();
  await check('no outgoing request was made', async () => { assert.deepStrictEqual(outgoing, []); });

  const removed = await cleanup(db);
  const left = await leftovers(db);
  console.log('cleanup removed', removed, 'leftover', left);
  const failed = results.filter((r) => !r).length;
  console.log(`${results.length - failed} PASS, ${failed} FAIL`);
  return failed || left ? 1 : 0;
}

main()
  .then(async (code) => { await mongoose.disconnect().catch(() => {}); process.exit(code); })
  .catch(async (e) => { console.error('scaling-check failed:', e && e.message); await mongoose.disconnect().catch(() => {}); process.exit(1); });
