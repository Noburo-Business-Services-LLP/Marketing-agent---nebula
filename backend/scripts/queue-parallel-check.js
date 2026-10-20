/**
 * Real-database check of parallel generation jobs (E9 stage A, docs/superpowers/ops/generation-parallelism.md), against
 * the DEVELOPMENT database only: refuses any database except nebulaa_dev. FAKE providers (the handlers only wait), a
 * FAKE wallet (charges and refunds are counted in memory), no outgoing request to a non-local host.
 *
 * It runs the real queue code (services/videoGenerationQueue.js) as 3 in-process workers against MongoDB, on a
 * THROWAWAY collection `zz_queue_check_jobs` with exactly the VideoJob schema and indexes (decision D72: the real
 * `video_jobs` collection is read by any dev server that is running, and an older checkout's consumer would claim a
 * test row and run the REAL pipeline, a paid provider call). Throwaway accounts are new ids tagged `zz.queue-check`.
 *   1. no job runs twice and each completes once, with 1 and with 3 workers (12 jobs each);
 *   2. throughput scales with workers (3 workers at least 1.8x faster than 1);
 *   3. a killed worker's jobs are re-claimed after the lease runs out: retry-safe ones finish on another worker
 *      (run 2, no new charge), a job that may not be re-run is failed and refunded exactly once (two sweeps at once);
 *   4. a provider failure refunds every charge exactly once, and the refund sweep pays nothing more.
 * At most 40 jobs; the collection is dropped at the end; exits non-zero on any FAIL or leftover.
 *   node scripts/queue-parallel-check.js          run, print PASS/FAIL, clean up
 *   node scripts/queue-parallel-check.js cleanup  drop leftovers of an interrupted run
 */
require('dotenv').config();
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';
const https = require('https');
const isLocal = (h) => /^(127\.0\.0\.1|localhost|\[::1\]|::1)$/.test(String(h || ''));
for (const fn of ['request', 'get']) {
  const orig = https[fn];
  https[fn] = function guarded(a, ...rest) {
    const host = typeof a === 'string' || a instanceof URL ? new URL(String(a)).hostname : (a && (a.hostname || a.host));
    if (!isLocal(host)) throw new Error(`queue-parallel-check: outgoing request to ${host} refused`);
    return orig.call(this, a, ...rest);
  };
}

const mongoose = require('mongoose');
const assert = require('assert');

const DEV_DB = 'nebulaa_dev';
const COLLECTION = 'zz_queue_check_jobs';
const TAG = 'zz.queue-check';
const MAX_JOBS = 40;
const results = [];
async function check(name, fn) {
  try { const d = await fn(); results.push(true); console.log(`PASS  ${name}${d ? ` (${d})` : ''}`); } catch (e) { results.push(false); console.log(`FAIL  ${name}: ${e && e.message}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function dropCheckCollection(db) {
  const exists = (await db.listCollections({ name: COLLECTION }).toArray()).length > 0;
  if (exists) await db.dropCollection(COLLECTION);
  return exists;
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set (run from the backend folder so .env is found).');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000, maxPoolSize: 15 });
  if (mongoose.connection.name !== DEV_DB) throw new Error(`Refusing: database is ${mongoose.connection.name}, not ${DEV_DB}`);
  const db = mongoose.connection.db;
  if (process.argv.includes('cleanup')) { console.log('dropped', await dropCheckCollection(db)); return 0; }
  await dropCheckCollection(db);

  // Alerts never leave this process (no email about the failures this check makes on purpose).
  const alerts = require('../services/opsAlerts');
  alerts.recordFailure = async () => false;

  const VideoJob = require('../models/VideoJob');
  const Model = mongoose.model('ZzQueueCheckJob', VideoJob.schema.clone(), COLLECTION);
  await Model.createIndexes();
  const { PersistentVideoGenerationQueue } = require('../services/videoGenerationQueue');
  const { QUARK_COSTS } = require('../config/apiCosts');

  let jobsMade = 0;
  const ledger = { spends: new Map(), refunds: [] };
  const runs = new Map(); // jobId -> [workerId, ...]
  const directLease = { withLease: async (name, ttl, fn) => ({ ran: true, result: await fn({ isLost: () => false }) }) };
  const BASE = { slots: { image: 2, video: 2 }, cpu: 1, ffmpegThreads: 2, globalCeiling: 200, perUserRunning: 2, leaseMs: 60000, heartbeatMs: 20000, maxAttempts: 2, shutdownGraceMs: 0, warnings: [] };

  /** A model that stops answering when its worker is "killed" (a dead process cannot write: no heartbeat, no result). */
  const killable = () => {
    const state = { dead: false };
    const proxy = new Proxy(Model, {
      get(target, prop) {
        const v = target[prop];
        if (typeof v !== 'function') return v;
        return (...args) => {
          if (state.dead) {
            const err = Promise.reject(new Error('worker is dead'));
            err.catch(() => {});
            const q = { lean: () => q, sort: () => q, limit: () => q, select: () => q, then: (a, b) => err.then(a, b), catch: (b) => err.catch(b) };
            return q;
          }
          return v.apply(target, args);
        };
      }
    });
    return { model: proxy, kill: () => { state.dead = true; } };
  };

  const workers = [];
  function worker(name, { settings = {}, handler, model, start = true } = {}) {
    const m = model || Model;
    const q = new PersistentVideoGenerationQueue({
      model: m, draftModel: { updateMany: async () => ({}) }, runsJobsHere: false, workerId: `${TAG}:${name}`,
      settings: { ...BASE, ...settings, slots: { ...BASE.slots, ...(settings.slots || {}) } }, leaseLock: directLease,
      refund: async (user, action, count, desc, opts) => { ledger.refunds.push({ user, action, count, ref: opts && opts.ref }); return { success: true }; },
      chargeProof: async (ref) => ({ spend: ledger.spends.get(ref) || null, refunded: ledger.refunds.some((r) => r.ref === ref) }),
      alertOwner: async () => {}
    });
    q.registerHandler('create_video_pipeline', async (payload, controls) => {
      const list = runs.get(payload.jobKey) || [];
      list.push(q.workerId);
      runs.set(payload.jobKey, list);
      return handler ? handler(payload, controls, q) : (async () => { await sleep(300); await controls.update({ progress: 50, currentStep: 'generate_clips' }); return { videoUrl: `https://cdn.example.test/${payload.jobKey}.mp4`, runBy: q.workerId }; })();
    });
    // The drain loop of a worker, faster than production's 5 s so the check takes seconds.
    const entry = { q, timer: null };
    const go = () => { if (!entry.timer) entry.timer = setInterval(() => { q._drainQueue().catch(() => null); }, 50); };
    if (start) go();
    workers.push(entry);
    return { q, go, stop: () => { if (entry.timer) clearInterval(entry.timer); q.stopping = true; } };
  }

  /** What a route does: charge with refs, then enqueue with metadata.quarkCharge. */
  async function submit(q, i, extra = {}) {
    if (jobsMade >= MAX_JOBS) throw new Error('job budget exceeded');
    jobsMade += 1;
    const userId = new mongoose.Types.ObjectId();
    const ref = `video:${TAG}:${jobsMade}`;
    const charges = [{ action: 'video_base', count: 1, ref: `${ref}:base`, payerId: '' }, { action: 'video_generated', count: 2, ref: `${ref}:scenes`, payerId: '' }];
    charges.forEach((c) => ledger.spends.set(c.ref, { payer: String(userId), quarks: QUARK_COSTS[c.action] * c.count }));
    const jobKey = `${TAG}:${jobsMade}`;
    const job = await q.enqueue({ userId, jobType: 'create_video_pipeline', payload: { jobKey, i }, metadata: { quarkCharge: charges, check: TAG, ...extra } });
    return { ...job, jobKey, charges };
  }
  const waitUntil = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(50); } return false; };
  const stopAll = () => { workers.forEach(({ q, timer }) => { if (timer) clearInterval(timer); q.stopping = true; }); workers.length = 0; };

  // ---- 1 and 2: no double run, throughput with 1 and with 3 workers ------------------------------------------------
  let oneWorkerMs = 0;
  await check('1 worker, 12 jobs from 12 throwaway accounts: each runs once and completes once; 2 at a time (its 2 video slots)', async () => {
    const solo = worker('solo', { start: false });
    const jobs = [];
    for (let i = 0; i < 12; i += 1) jobs.push(await submit(solo.q, i));
    const started = Date.now(); // the backlog is stored: time how fast the workers clear it
    solo.go();
    assert.ok(await waitUntil(async () => (await Model.countDocuments({ status: 'completed' })) === 12), 'all 12 completed');
    oneWorkerMs = Date.now() - started;
    solo.stop();
    for (const j of jobs) assert.deepStrictEqual(runs.get(j.jobKey), [solo.q.workerId], `${j.jobKey} ran once`);
    const docs = await Model.find({}).lean();
    assert.ok(docs.every((d) => d.attempts === 1 && d.workerId === solo.q.workerId && d.result && d.result.runBy === d.workerId));
    return `${oneWorkerMs} ms`;
  });
  await Model.deleteMany({});

  await check('3 workers, 12 jobs: no job runs twice, each completes once with one worker id, the work is shared, throughput at least 1.8x', async () => {
    const ws = ['a', 'b', 'c'].map((n) => worker(n, { start: false }));
    const jobs = [];
    for (let i = 0; i < 12; i += 1) jobs.push(await submit(ws[i % 3].q, i));
    const started = Date.now();
    ws.forEach((w) => w.go());
    assert.ok(await waitUntil(async () => (await Model.countDocuments({ status: 'completed' })) === 12), 'all 12 completed');
    const ms = Date.now() - started;
    ws.forEach((w) => w.stop());
    for (const j of jobs) assert.strictEqual((runs.get(j.jobKey) || []).length, 1, `${j.jobKey} ran ${(runs.get(j.jobKey) || []).length} times`);
    const docs = await Model.find({}).lean();
    assert.ok(docs.every((d) => d.attempts === 1 && d.result && d.result.runBy === d.workerId), 'completed by the worker that claimed it');
    const per = {};
    docs.forEach((d) => { per[d.workerId] = (per[d.workerId] || 0) + 1; });
    assert.ok(Object.keys(per).length === 3, `all three workers ran jobs: ${JSON.stringify(Object.values(per))}`);
    const speedup = oneWorkerMs / ms;
    assert.ok(speedup >= 1.8, `speed-up ${speedup.toFixed(2)}x`);
    return `${ms} ms, ${speedup.toFixed(2)}x, per worker ${Object.values(per).join('/')}`;
  });
  await Model.deleteMany({});

  // ---- 3: a killed worker -------------------------------------------------------------------------------------------
  await check('a killed worker: its 3 jobs are re-claimed after the lease; 2 retry-safe ones finish on another worker (run 2, no new charge), the one that may not be re-run is failed and refunded exactly once by two sweeps at once', async () => {
    const k = killable();
    const doomed = worker('doomed', { model: k.model, settings: { slots: { video: 3 }, perUserRunning: 5, leaseMs: 2000, heartbeatMs: 500 }, handler: () => new Promise(() => {}) });
    const a = await submit(doomed.q, 0);
    const b = await submit(doomed.q, 1);
    const c = await submit(doomed.q, 2, { noRetry: true });
    assert.ok(await waitUntil(async () => (await Model.countDocuments({ status: 'processing', workerId: doomed.q.workerId })) === 3), 'the doomed worker claimed all 3');
    await sleep(1200); // its heartbeat renews the lease meanwhile
    assert.strictEqual(await Model.countDocuments({ status: 'processing', leaseUntil: { $lt: new Date() } }), 0, 'leases are renewed while it lives');
    k.kill(); doomed.stop();
    const killedAt = Date.now();
    const s1 = worker('rescue1', { settings: { leaseMs: 2000, heartbeatMs: 500 } });
    const s2 = worker('rescue2', { settings: { leaseMs: 2000, heartbeatMs: 500 } });
    assert.ok(await waitUntil(async () => (await Model.countDocuments({ status: 'processing', leaseUntil: { $lt: new Date() } })) === 3, 5000), 'the 3 leases ran out');
    await Promise.all([s1.q.recoverStaleJobs(), s2.q.recoverStaleJobs()]);
    assert.ok(await waitUntil(async () => (await Model.countDocuments({ status: 'completed' })) === 2), 'the 2 retry-safe jobs completed');
    const recoveredMs = Date.now() - killedAt;
    s1.stop(); s2.stop();
    const docs = Object.fromEntries((await Model.find({}).lean()).map((d) => [d.payload.jobKey, d]));
    for (const j of [a, b]) {
      const d = docs[j.jobKey];
      assert.strictEqual(d.status, 'completed');
      assert.strictEqual(d.attempts, 2);
      assert.strictEqual(d.leaseRequeues, 1, 're-queued once');
      assert.notStrictEqual(d.workerId, doomed.q.workerId);
      assert.strictEqual(d.result.runBy, d.workerId);
      assert.strictEqual((runs.get(j.jobKey) || []).length, 2, 'the dead run and the one retry');
    }
    const dc = docs[c.jobKey];
    assert.strictEqual(dc.status, 'failed');
    assert.strictEqual(dc.refundState, 'refunded');
    const refundsC = ledger.refunds.filter((r) => r.ref.startsWith(c.charges[0].ref.replace(/:base$/, '')));
    assert.deepStrictEqual(refundsC.map((r) => [r.action, r.count]).sort(), [['video_base', 1], ['video_generated', 2]], 'each charge refunded once');
    const refundsAB = ledger.refunds.filter((r) => [a, b].some((j) => r.ref.startsWith(j.charges[0].ref.replace(/:base$/, ''))));
    assert.strictEqual(refundsAB.length, 0, 'delivered jobs are not refunded');
    return `recovered in ${recoveredMs} ms after the kill (lease 2 s)`;
  });
  await Model.deleteMany({});

  // ---- 4: provider failure refunds once ------------------------------------------------------------------------------
  await check('a provider failure refunds each charge exactly once; a later refund sweep and a second expired-lease sweep pay nothing more', async () => {
    const before = ledger.refunds.length;
    const w = worker('failing', { handler: async () => { await sleep(100); throw new Error('fake provider: 503'); } });
    const jobs = [await submit(w.q, 0), await submit(w.q, 1)];
    assert.ok(await waitUntil(async () => (await Model.countDocuments({ status: 'failed', refundState: 'refunded' })) === 2), 'both failed and refunded');
    w.stop();
    const sweeper = worker('sweeper');
    sweeper.stop();
    await Model.updateMany({}, { $set: { refundAt: new Date(Date.now() - 10 * 60000) } });
    await sweeper.q.sweepRefunds();
    await sweeper.q.recoverStaleJobs();
    const paid = ledger.refunds.slice(before);
    assert.strictEqual(paid.length, 4, `2 jobs x 2 charges, got ${paid.length}`);
    for (const j of jobs) for (const c of j.charges) assert.strictEqual(paid.filter((r) => r.ref === c.ref).length, 1, `${c.ref} once`);
    return `${paid.length} refunds for 4 charges`;
  });

  stopAll();
  await sleep(100);
  console.log(`jobs made: ${jobsMade} (budget ${MAX_JOBS})`);
  const dropped = await dropCheckCollection(db);
  const left = (await db.listCollections({ name: COLLECTION }).toArray()).length;
  console.log('cleanup dropped', dropped ? COLLECTION : 'nothing', 'leftover', left);
  const pass = results.filter(Boolean).length;
  const fail = results.length - pass;
  console.log(`\n${pass} PASS, ${fail} FAIL`);
  return fail || left ? 1 : 0;
}

main()
  .then(async (code) => { await mongoose.disconnect().catch(() => {}); process.exit(code); })
  .catch(async (e) => {
    console.error('queue-parallel-check failed:', e && e.message);
    try { if (mongoose.connection.readyState === 1 && mongoose.connection.name === DEV_DB) await dropCheckCollection(mongoose.connection.db); } catch (_) { /* best effort */ }
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
