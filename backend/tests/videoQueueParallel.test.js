'use strict';
// E9 stage A: per-worker claims, slots, leases, fairness, shutdown and metrics of the video generation queue. Fake model
// (tests/helpers/fakeVideoJobModel.js), fake clock, fake providers (handlers), no network, no database.
const test = require('node:test');
const assert = require('node:assert');
const { PersistentVideoGenerationQueue, poolFor } = require('../services/videoGenerationQueue');
const { makeVideoJobModel } = require('./helpers/fakeVideoJobModel');
const { readJobSlots } = require('../config/jobSlots');
const { createSemaphore } = require('../services/cpuSlots');
const { QUARK_COSTS } = require('../config/apiCosts');

const settle = async (n = 40) => { for (let i = 0; i < n; i += 1) await new Promise((r) => setImmediate(r)); };
const quiet = async (fn) => { const saved = ['log', 'error', 'warn', 'info'].map((k) => [k, console[k]]); saved.forEach(([k]) => { console[k] = () => {}; }); try { return await fn(); } finally { saved.forEach(([k, f]) => { console[k] = f; }); } };
const deferred = () => { let resolve; let reject; const p = new Promise((a, b) => { resolve = a; reject = b; }); return { p, resolve, reject }; };

const SETTINGS = { slots: { image: 2, video: 2 }, cpu: 1, ffmpegThreads: 2, globalCeiling: 200, perUserRunning: 2, leaseMs: 60000, heartbeatMs: 1e9, maxAttempts: 2, shutdownGraceMs: 0, warnings: [] };

/** One shared database, a fake clock, a fake wallet (ledger of charges and refunds), and N workers. */
function world({ workers = 1, settings = {}, now } = {}) {
  const model = makeVideoJobModel();
  const clock = { t: Date.UTC(2026, 9, 20, 12, 0, 0) };
  const ledger = { spends: new Map(), refunds: [] };
  const lease = { withLease: async (name, ttl, fn) => ({ ran: true, result: await fn({ isLost: () => false }) }) };
  const mk = (i) => new PersistentVideoGenerationQueue({
    model, draftModel: { updateMany: async () => ({}) }, runsJobsHere: false, workerId: `w${i}`,
    settings: { ...SETTINGS, ...settings, slots: { ...SETTINGS.slots, ...(settings.slots || {}) } },
    now: now || (() => clock.t), leaseLock: lease, sleep: async () => { clock.t += 50; await settle(2); },
    refund: async (user, action, count, desc, opts) => { ledger.refunds.push({ user, action, count, ref: opts && opts.ref, payerId: opts && opts.payerId }); return { success: true }; },
    chargeProof: async (ref) => ({ spend: ledger.spends.get(ref) || null, refunded: ledger.refunds.some((r) => r.ref === ref) }),
    alertOwner: async () => {}
  });
  const qs = Array.from({ length: workers }, (_, i) => mk(i + 1));
  /** What a route does: charge first (with refs), then enqueue with metadata.quarkCharge. */
  const charged = async (q, userId, jobType = 'create_video_pipeline', extra = {}) => {
    const ref = `video:${userId}:${model.docs.length}`;
    const charges = [{ action: 'video_base', count: 1, ref: `${ref}:base`, payerId: '' }, { action: 'video_generated', count: 2, ref: `${ref}:scenes`, payerId: '' }];
    charges.forEach((c) => ledger.spends.set(c.ref, { payer: userId, quarks: QUARK_COSTS[c.action] * c.count }));
    return q.enqueue({ userId, jobType, payload: { n: model.docs.length }, metadata: { quarkCharge: charges, ...extra } });
  };
  return { model, clock, ledger, qs, charged, stop: () => qs.forEach((q) => { q.stopping = true; }) };
}

test('slot config: defaults, overrides, legacy names, clamping and validation warnings', () => {
  const d = readJobSlots({}, { cpuCount: 8 });
  assert.deepStrictEqual(d.slots, { image: 2, video: 2, omni: 2 });
  assert.strictEqual(d.cpu, 2, 'min(2, vCPUs)');
  assert.strictEqual(readJobSlots({}, { cpuCount: 1 }).cpu, 1);
  assert.strictEqual(d.globalCeiling, 200);
  assert.strictEqual(d.perUserRunning, 2);
  assert.strictEqual(d.leaseMs, 60000);
  assert.strictEqual(d.heartbeatMs, 20000);
  assert.strictEqual(d.maxAttempts, 2);
  assert.strictEqual(d.shutdownGraceMs, 15000, 'drain 20 s minus 5 s');
  assert.deepStrictEqual(d.warnings, []);
  assert.deepStrictEqual(readJobSlots({ PROVIDER_SLOTS: '12' }).slots, { image: 12, video: 12, omni: 12 }, 'one value for all three');
  assert.deepStrictEqual(readJobSlots({ PROVIDER_SLOTS: '12', PROVIDER_SLOTS_VIDEO: '4' }).slots, { image: 12, video: 4, omni: 12 }, 'specific wins');
  assert.deepStrictEqual(readJobSlots({ VIDEO_QUEUE_CONCURRENCY: '3', IMAGE_JOB_CONCURRENCY: '5' }).slots, { image: 5, video: 3, omni: 2 }, 'older names still work');
  assert.strictEqual(readJobSlots({ PROVIDER_SLOTS_OMNI: '6', PROVIDER_SLOTS: '12' }).slots.omni, 6, 'the Videos (Omni) pool has its own setting');
  assert.strictEqual(readJobSlots({ PROVIDER_SLOTS_OMNI: '99' }).slots.omni, 32, 'omni clamped like the others');
  assert.strictEqual(readJobSlots({ PROVIDER_SLOTS_OMNI: 'x' }).slots.omni, 2, 'omni not a number: default');
  const bad = readJobSlots({ PROVIDER_SLOTS_VIDEO: 'lots', PROVIDER_SLOTS_IMAGE: '500', CPU_SLOTS: '0', JOB_MAX_ATTEMPTS: '9', JOB_GLOBAL_CEILING: '0' });
  assert.strictEqual(bad.slots.video, 2, 'not a number: default');
  assert.strictEqual(bad.slots.image, 32, 'above the maximum: clamped');
  assert.strictEqual(bad.cpu, 1, 'below the minimum: clamped');
  assert.strictEqual(bad.maxAttempts, 5);
  assert.strictEqual(bad.globalCeiling, 0, '0 turns the ceiling off');
  assert.strictEqual(bad.warnings.length, 4, bad.warnings.join(' | '));
  const hb = readJobSlots({ JOB_LEASE_MS: '30000', JOB_HEARTBEAT_MS: '25000' });
  assert.strictEqual(hb.heartbeatMs, 10000, 'heartbeat at most a third of the lease');
  assert.match(hb.warnings[0], /third of the lease/);
  assert.strictEqual(readJobSlots({ JOB_CAP_ACTIVE: '3' }).perUserRunning, 3, 'follows the entry cap');
  assert.strictEqual(readJobSlots({ SHUTDOWN_DRAIN_MS: '110000' }).shutdownGraceMs, 105000);
});

test('pools: scene pictures and thumbnails use the image pool, the rest the video pool', () => {
  assert.strictEqual(poolFor('render_missing_scene_images'), 'image');
  assert.strictEqual(poolFor('generate_content'), 'image');
  for (const t of ['create_video_pipeline', 'generate_clips', 'merge_video', 'render_missing_clips', 'whatever']) assert.strictEqual(poolFor(t), 'video');
});

test('concurrency = workers x slots: 3 workers with 2 video slots run 6 jobs at once; the old database-wide count no longer holds them back', async () => {
  const w = world({ workers: 3 });
  const gates = [];
  let inFlight = 0; let peak = 0;
  w.qs.forEach((q) => q.registerHandler('create_video_pipeline', async () => { inFlight += 1; peak = Math.max(peak, inFlight); const g = deferred(); gates.push(g); await g.p; inFlight -= 1; return { videoUrl: 'https://cdn/v.mp4' }; }));
  await quiet(async () => {
    for (let i = 0; i < 10; i += 1) await w.charged(w.qs[0], `u${i}`);
    await Promise.all(w.qs.map((q) => q._drainQueue()));
    await settle();
  });
  assert.strictEqual(inFlight, 6, '3 x 2');
  assert.deepStrictEqual(w.qs.map((q) => q.running.size), [2, 2, 2]);
  assert.strictEqual(await w.model.countDocuments({ status: 'queued' }), 4);
  // a fourth worker with free slots claims even though 6 are processing elsewhere (the old rule stopped at 2 in total)
  const extra = world({ workers: 1 });
  extra.model.docs.push(...w.model.docs); // same database
  extra.qs[0].registerHandler('create_video_pipeline', async () => { const g = deferred(); gates.push(g); await g.p; return {}; });
  await quiet(() => extra.qs[0]._drainQueue());
  assert.strictEqual(extra.qs[0].running.size, 2);
  gates.forEach((g) => g.resolve());
  await quiet(() => settle(80));
  w.stop(); extra.stop();
  assert.ok(peak <= 8);
});

test('the global safety ceiling still applies when set', async () => {
  const w = world({ settings: { globalCeiling: 3, slots: { video: 10 } } });
  for (let i = 0; i < 2; i += 1) w.model.docs.push({ jobId: `other${i}`, userId: `x${i}`, status: 'processing', workerId: 'elsewhere', attempts: 1, leaseUntil: new Date(w.clock.t + 60000), metadata: { jobType: 'create_video_pipeline' }, createdAt: new Date(), logs: [] });
  w.qs[0].registerHandler('create_video_pipeline', () => new Promise(() => {}));
  await quiet(async () => { for (let i = 0; i < 5; i += 1) await w.charged(w.qs[0], `u${i}`); await w.qs[0]._drainQueue(); });
  assert.strictEqual(w.qs[0].running.size, 1, 'ceiling 3, 2 already running elsewhere');
  w.stop();
});

test('two workers never run the same job: 20 jobs, 4 workers draining at the same moments, each job runs once and completes once', async () => {
  const w = world({ workers: 4, settings: { slots: { video: 3 }, perUserRunning: 20 } });
  const runs = new Map();
  w.qs.forEach((q) => q.registerHandler('create_video_pipeline', async (payload) => {
    runs.set(payload.n, (runs.get(payload.n) || 0) + 1);
    await settle(3);
    return { videoUrl: `https://cdn/${payload.n}.mp4` };
  }));
  await quiet(async () => {
    for (let i = 0; i < 20; i += 1) await w.charged(w.qs[i % 4], `u${i % 5}`);
    for (let round = 0; round < 12; round += 1) { await Promise.all(w.qs.map((q) => q._drainQueue())); await settle(10); }
    await settle(100);
  });
  assert.strictEqual(runs.size, 20);
  assert.ok([...runs.values()].every((n) => n === 1), 'no job ran twice');
  assert.strictEqual(w.model.docs.filter((d) => d.status === 'completed').length, 20);
  assert.ok(w.model.docs.every((d) => d.attempts === 1 && /^w[1-4]$/.test(d.workerId)), 'one claim each, by a known worker');
  assert.ok(new Set(w.model.docs.map((d) => d.workerId)).size >= 2, 'the work was shared');
  assert.strictEqual(w.ledger.refunds.length, 0);
  w.stop();
});

test('fairness: A submits 5 jobs, then B and C one each; B and C start before A\'s third job, and A never has more than 2 running', async () => {
  const w = world({ settings: { slots: { video: 2 } } });
  const started = [];
  const gates = new Map();
  let maxA = 0; let runningA = 0;
  w.qs[0].registerHandler('create_video_pipeline', async (payload, c) => {
    const who = payload.who;
    started.push(who);
    if (who.startsWith('A')) { runningA += 1; maxA = Math.max(maxA, runningA); }
    const g = deferred(); gates.set(who, g); await g.p;
    if (who.startsWith('A')) runningA -= 1;
    return {};
  });
  await quiet(async () => {
    for (const who of ['A1', 'A2', 'A3', 'A4', 'A5', 'B1', 'C1']) await w.qs[0].enqueue({ userId: who[0], jobType: 'create_video_pipeline', payload: { who } });
    await w.qs[0]._drainQueue();
    await settle();
    for (let i = 0; i < 6; i += 1) { const first = started.find((s) => gates.get(s) && !gates.get(s).done); gates.get(first).done = true; gates.get(first).resolve(); await settle(); }
  });
  assert.deepStrictEqual(started.slice(0, 4), ['A1', 'B1', 'A2', 'C1'], 'round-robin by account: fewest running first, oldest on a tie');
  assert.ok(started.indexOf('A3') > started.indexOf('C1'));
  assert.ok(maxA <= 2);
  [...gates.values()].forEach((g) => g.resolve());
  await quiet(() => settle(40));
  w.stop();
});

test('per-user running cap: one account with 5 jobs and 4 free slots runs only 2; other pools are not blocked by a full video pool', async () => {
  const w = world({ settings: { slots: { video: 4, image: 1 } } });
  w.qs[0].registerHandler('create_video_pipeline', () => new Promise(() => {}));
  w.qs[0].registerHandler('render_missing_scene_images', () => new Promise(() => {}));
  await quiet(async () => {
    for (let i = 0; i < 5; i += 1) await w.qs[0].enqueue({ userId: 'A', jobType: 'create_video_pipeline' });
    await w.qs[0].enqueue({ userId: 'B', jobType: 'render_missing_scene_images', metadata: { perSceneCharging: true } });
    await w.qs[0]._drainQueue();
  });
  assert.strictEqual(w.qs[0]._runningIn('video'), 2);
  assert.strictEqual(w.qs[0]._runningIn('image'), 1);
  assert.strictEqual(w.model.docs.find((d) => d.userId === 'B').pool, 'image');
  w.stop();
});

test('a lost worker: its lease runs out, two sweeps re-queue the job exactly once, another worker finishes it with no new charge; the lost run cannot complete', async () => {
  const w = world({ workers: 3 });
  const dead = deferred();
  w.qs[0].registerHandler('create_video_pipeline', async () => { await dead.p; return { videoUrl: 'https://cdn/zombie.mp4' }; });
  w.qs[1].registerHandler('create_video_pipeline', async () => ({ videoUrl: 'https://cdn/retry.mp4' }));
  w.qs[2].registerHandler('create_video_pipeline', async () => ({ videoUrl: 'https://cdn/retry.mp4' }));
  await quiet(async () => { await w.charged(w.qs[0], 'u1'); await w.qs[0]._drainQueue(); });
  const job = () => w.model.docs[0];
  assert.strictEqual(job().workerId, 'w1');
  // inside the lease nothing happens
  await quiet(() => w.qs[1].recoverStaleJobs());
  assert.strictEqual(job().status, 'processing');
  w.clock.t += 61000 + 20000; // lease end + one heartbeat (D75) // w1 stopped renewing (it died)
  await quiet(() => Promise.all([w.qs[1].recoverStaleJobs(), w.qs[2].recoverStaleJobs()]));
  assert.strictEqual(job().status, 'queued');
  assert.strictEqual(job().leaseRequeues, 1, 're-queued once');
  assert.strictEqual(job().workerId, null);
  assert.strictEqual(w.qs[1].stats.leaseRequeues + w.qs[2].stats.leaseRequeues, 1);
  await quiet(async () => { await w.qs[1]._drainQueue(); await settle(); });
  assert.strictEqual(job().status, 'completed');
  assert.strictEqual(job().attempts, 2);
  assert.strictEqual(job().workerId, 'w2');
  assert.strictEqual(job().result.videoUrl, 'https://cdn/retry.mp4');
  // the zombie run finally returns: its completion matches nothing (worker id and attempt changed)
  dead.resolve();
  await quiet(() => settle());
  assert.strictEqual(job().result.videoUrl, 'https://cdn/retry.mp4', 'the lost run did not overwrite the result');
  assert.strictEqual(w.ledger.refunds.length, 0, 'delivered: nothing refunded');
  assert.strictEqual(w.ledger.spends.size, 2, 'charged once (the route), never again on the retry');
  w.stop();
});

test('a retried job that fails again is refunded exactly once; later sweeps and the lost run refund nothing more', async () => {
  const w = world({ workers: 2 });
  const dead = deferred();
  w.qs[0].registerHandler('create_video_pipeline', async () => { await dead.p; throw new Error('late failure of the lost run'); });
  w.qs[1].registerHandler('create_video_pipeline', async () => { throw new Error('provider said no'); });
  await quiet(async () => { await w.charged(w.qs[0], 'u1'); await w.qs[0]._drainQueue(); });
  w.clock.t += 61000 + 20000; // lease end + one heartbeat (D75)
  await quiet(async () => { await w.qs[1].recoverStaleJobs(); await w.qs[1]._drainQueue(); await settle(); });
  const job = w.model.docs[0];
  assert.strictEqual(job.status, 'failed');
  assert.strictEqual(job.refundState, 'refunded');
  assert.deepStrictEqual(w.ledger.refunds.map((r) => [r.action, r.count]), [['video_base', 1], ['video_generated', 2]]);
  dead.resolve();
  w.clock.t += 10 * 60000;
  await quiet(async () => { await settle(); await w.qs[0].recoverStaleJobs(); await w.qs[1].recoverStaleJobs(); await w.qs[1].sweepRefunds(); });
  assert.strictEqual(w.ledger.refunds.length, 2, 'once per charge, nothing more');
  w.stop();
});

test('at the attempt cap (and for jobs that charge inside the handler) a lost lease fails the job: refunded once by one of two sweeps, per-scene jobs refund nothing here', async () => {
  const w = world({ workers: 3, settings: { maxAttempts: 1 } });
  w.qs[0].registerHandler('create_video_pipeline', () => new Promise(() => {}));
  w.qs[0].registerHandler('render_missing_clips', () => new Promise(() => {}));
  await quiet(async () => {
    await w.charged(w.qs[0], 'u1');
    await w.qs[0].enqueue({ userId: 'u2', jobType: 'render_missing_clips', metadata: { perSceneCharging: true } });
    await w.qs[0]._drainQueue();
  });
  assert.strictEqual(w.qs[0].running.size, 2);
  w.clock.t += 61000 + 20000; // lease end + one heartbeat (D75)
  await quiet(() => Promise.all([w.qs[1].recoverStaleJobs(), w.qs[2].recoverStaleJobs()]));
  const [video, perScene] = w.model.docs;
  assert.strictEqual(video.status, 'failed');
  assert.strictEqual(video.refundState, 'refunded');
  assert.strictEqual(w.ledger.refunds.length, 2, 'two charges, refunded once each');
  assert.strictEqual(perScene.status, 'failed');
  assert.strictEqual(perScene.refundState == null, true, 'charged scene by scene: nothing to refund here');
  assert.strictEqual(w.qs[1].stats.leaseFailures + w.qs[2].stats.leaseFailures, 2);
  w.stop();
});

test('a per-scene job is never re-run automatically even under the attempt cap', async () => {
  const w = world({ workers: 2 });
  w.qs[0].registerHandler('render_missing_clips', () => new Promise(() => {}));
  await quiet(async () => { await w.qs[0].enqueue({ userId: 'u2', jobType: 'render_missing_clips', metadata: { perSceneCharging: true } }); await w.qs[0]._drainQueue(); });
  w.clock.t += 61000 + 20000; // lease end + one heartbeat (D75)
  await quiet(() => w.qs[1].recoverStaleJobs());
  assert.strictEqual(w.model.docs[0].status, 'failed');
  w.stop();
});

test('a worker that only lost its lease (database stall) stops at its next step once the job was re-queued', async () => {
  const w = world({ workers: 2 });
  const gate = deferred();
  const steps = [];
  w.qs[0].registerHandler('create_video_pipeline', async (p, c) => { await c.update({ progress: 10, currentStep: 'a' }); steps.push('a'); await gate.p; await c.update({ progress: 50, currentStep: 'b' }); steps.push('b'); return {}; });
  w.qs[1].registerHandler('create_video_pipeline', () => new Promise(() => {}));
  await quiet(async () => { await w.charged(w.qs[0], 'u1'); await w.qs[0]._drainQueue(); await settle(); });
  w.clock.t += 61000 + 20000; // lease end + one heartbeat (D75)
  w.qs[0].running.get(w.model.docs[0].jobId).lost = false; // still believes it holds the job
  await quiet(async () => { await w.qs[1].recoverStaleJobs(); await w.qs[1]._drainQueue(); });
  gate.resolve();
  await quiet(() => settle());
  assert.deepStrictEqual(steps, ['a'], 'step b never ran on the stale worker');
  assert.strictEqual(w.model.docs[0].workerId, 'w2');
  assert.strictEqual(w.qs[0].stats.lostRuns, 1);
  w.stop();
});

test('the heartbeat renews the lease only while the job is still this worker\'s', async () => {
  const w = world({ settings: { heartbeatMs: 5 } });
  const gate = deferred();
  w.qs[0].registerHandler('create_video_pipeline', async () => { await gate.p; return {}; });
  await quiet(async () => { await w.charged(w.qs[0], 'u1'); await w.qs[0]._drainQueue(); });
  const before = new Date(w.model.docs[0].leaseUntil).getTime();
  w.clock.t += 30000;
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(new Date(w.model.docs[0].leaseUntil).getTime() > before, 'renewed');
  w.model.docs[0].workerId = 'someone-else';
  await new Promise((r) => setTimeout(r, 30));
  assert.strictEqual(w.qs[0].running.get(w.model.docs[0].jobId).lost, true, 'a heartbeat that matches nothing marks the run lost');
  gate.resolve();
  await quiet(() => settle());
  w.stop();
});

test('shutdown: stops claiming, hands retry-safe running jobs back to the queue (attempt not counted), fails and refunds the others once; late results are discarded', async () => {
  const w = world({ workers: 2, settings: { slots: { video: 3 } } });
  const gates = [];
  w.qs[0].registerHandler('create_video_pipeline', async () => { const g = deferred(); gates.push(g); await g.p; return { videoUrl: 'late' }; });
  w.qs[0].registerHandler('render_missing_clips', async () => { const g = deferred(); gates.push(g); await g.p; return {}; });
  w.qs[1].registerHandler('create_video_pipeline', async () => ({ videoUrl: 'https://cdn/after-restart.mp4' }));
  await quiet(async () => {
    await w.charged(w.qs[0], 'u1');
    await w.qs[0].enqueue({ userId: 'u2', jobType: 'render_missing_clips', metadata: { perSceneCharging: true } });
    await w.qs[0]._drainQueue();
  });
  const r = await quiet(() => w.qs[0].shutdown({ graceMs: 0 }));
  assert.deepStrictEqual(r, { finished: false, released: 1, failed: 1 });
  const [video, perScene] = w.model.docs;
  assert.strictEqual(video.status, 'queued');
  assert.strictEqual(video.attempts, 0, 'the handed-back run is not counted');
  assert.strictEqual(video.releases, 1);
  assert.strictEqual(video.workerId, null);
  assert.strictEqual(perScene.status, 'failed');
  // the stopping worker claims nothing more, even when asked
  assert.strictEqual(await w.qs[0]._drainQueue(), 0);
  gates.forEach((g) => g.resolve());
  await quiet(() => settle());
  assert.strictEqual(video.status, 'queued', 'the late result of the stopped run is discarded');
  await quiet(async () => { await w.qs[1]._drainQueue(); await settle(); });
  assert.strictEqual(video.status, 'completed');
  assert.strictEqual(video.result.videoUrl, 'https://cdn/after-restart.mp4');
  assert.strictEqual(w.ledger.refunds.length, 0, 'delivered after the restart; the per-scene job has no job-level charge');
  w.stop();
});

test('shutdown waits for running jobs within the grace time', async () => {
  const w = world();
  let finish;
  w.qs[0].registerHandler('create_video_pipeline', () => new Promise((r) => { finish = r; }));
  await quiet(async () => { await w.charged(w.qs[0], 'u1'); await w.qs[0]._drainQueue(); });
  setTimeout(() => finish({ videoUrl: 'https://cdn/ok.mp4' }), 5);
  w.qs[0].sleep = (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5)));
  w.qs[0].now = () => Date.now();
  const r = await quiet(() => w.qs[0].shutdown({ graceMs: 2000 }));
  assert.strictEqual(r.finished, true);
  assert.strictEqual(w.model.docs[0].status, 'completed');
});

test('rows stored by older code (no worker id) keep the old stale rule: failed and refunded, never re-queued', async () => {
  const w = world({ workers: 1 });
  w.ledger.spends.set('old:base', { payer: 'u1', quarks: QUARK_COSTS.video_base });
  w.model.docs.push({ jobId: 'old1', userId: 'u1', status: 'processing', attempts: 1, updatedAt: new Date(w.clock.t - 10 * 60000), createdAt: new Date(w.clock.t - 11 * 60000), logs: [], metadata: { jobType: 'create_video_pipeline', quarkCharge: [{ action: 'video_base', count: 1, ref: 'old:base', payerId: '' }] } });
  const realNow = Date.now; Date.now = () => w.clock.t;
  try { await quiet(() => w.qs[0].recoverStaleJobs()); } finally { Date.now = realNow; }
  assert.strictEqual(w.model.docs[0].status, 'failed');
  assert.strictEqual(w.ledger.refunds.length, 1);
  w.stop();
});

test('metrics: depth per type and pool, running per worker, oldest waiting age, this worker\'s counters', async () => {
  const w = world({ workers: 2 });
  w.qs[0].registerHandler('create_video_pipeline', () => new Promise(() => {}));
  await quiet(async () => {
    for (let i = 0; i < 4; i += 1) await w.charged(w.qs[0], `u${i}`);
    await w.qs[0].enqueue({ userId: 'u9', jobType: 'render_missing_scene_images', metadata: { perSceneCharging: true } });
    w.model.docs.forEach((d) => { d.createdAt = new Date(w.clock.t - 90000); });
    await w.qs[0]._claimFair('video', 2);
  });
  const m = await w.qs[0].metrics();
  assert.strictEqual(m.queueDepth, 3);
  assert.strictEqual(m.running, 2);
  assert.strictEqual(m.oldestQueuedAgeSeconds, 90);
  assert.deepStrictEqual(m.byType.create_video_pipeline, { queued: 2, running: 2 });
  assert.deepStrictEqual(m.byType.render_missing_scene_images, { queued: 1, running: 0 });
  assert.deepStrictEqual(m.byPool, { image: { queued: 1, running: 0 }, video: { queued: 2, running: 2 } });
  assert.deepStrictEqual(m.runningByWorker, { w1: 2 });
  for (const k of ['workerId', 'consumers', 'stopping', 'slots', 'slotsInUse', 'claims', 'completed', 'failed', 'leaseRequeues', 'leaseFailures', 'released', 'lostRuns']) assert.ok(k in m.thisWorker, k);
  assert.strictEqual(m.thisWorker.claims, 2);
  assert.deepStrictEqual(m.thisWorker.slotsInUse, { image: 0, video: 2 });
  const s = JSON.stringify(m);
  assert.ok(!/u0|u1|u9/.test(s), 'no account ids in the numbers');
  w.stop();
});

test('CPU slots: at most N ffmpeg steps at once, first come first served, the slot is freed when a step throws', async () => {
  const sem = createSemaphore(2);
  let inFlight = 0; let peak = 0;
  const order = [];
  const step = (i) => sem.run(async () => { inFlight += 1; peak = Math.max(peak, inFlight); order.push(i); await settle(2); inFlight -= 1; if (i === 1) throw new Error('ffmpeg failed'); return i; });
  const results = await Promise.allSettled([0, 1, 2, 3, 4].map(step));
  assert.strictEqual(peak, 2);
  assert.deepStrictEqual(order, [0, 1, 2, 3, 4]);
  assert.strictEqual(results[1].status, 'rejected');
  assert.strictEqual(results[4].value, 4);
  assert.strictEqual(sem.inUse(), 0);
  assert.strictEqual(sem.waiting(), 0);
});

test('the pipeline ffmpeg goes through the CPU slots with FFMPEG_THREADS', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../services/videoGenerationPipeline.js'), 'utf8');
  assert.match(src, /function runFfmpeg\(args = \[\], options = \{\}\) \{\n\s*return require\('\.\/cpuSlots'\)\.cpuSlots\(\)\.run\(\(\) => runFfmpegNow\(args, options\)\);/);
  assert.match(src, /'-threads', String\(require\('\.\.\/config\/jobSlots'\)\.jobSlots\(\)\.ffmpegThreads\)/);
});

test('CloudWatch emitter: off by default (no AWS call), on with an injected sender it sends depth, age and slots', async () => {
  const { startQueueMetricsEmitter, toMetricData } = require('../services/queueMetricsEmitter');
  assert.strictEqual(startQueueMetricsEmitter({ env: {} }), null);
  const sent = [];
  const timers = { setInterval: () => ({ unref() {} }), clearInterval: () => {} };
  const e = startQueueMetricsEmitter({
    env: { QUEUE_METRICS_CLOUDWATCH: 'on' }, timers, log: { log() {}, warn() {} },
    collect: async () => ({ video: { queueDepth: 7, oldestQueuedAgeSeconds: 42, running: 4, thisWorker: { slots: { image: 2, video: 2 }, slotsInUse: { image: 1, video: 2 } } }, image: { queueDepth: 1, oldestQueuedAgeSeconds: 3, running: 0, thisWorker: { slots: 2, slotsInUse: 0 } } }),
    send: async (x) => { sent.push(x); return true; }
  });
  assert.ok(e);
  assert.strictEqual(await e.tick(), true);
  assert.strictEqual(sent[0].namespace, 'Nebulaa/Queue');
  const v = Object.fromEntries(sent[0].data.filter((d) => d.Dimensions[0].Value === 'video').map((d) => [d.MetricName, d.Value]));
  assert.deepStrictEqual(v, { QueueDepth: 7, OldestQueuedAge: 42, Running: 4, SlotsInUse: 3, SlotsTotal: 4 });
  assert.strictEqual(toMetricData({}).length, 0);
  e.stop();
});

test('campaign image queue: metrics shape, shutdown stops claiming, PROVIDER_SLOTS_IMAGE sets its slots', async () => {
  const Q = require('../services/imageJobQueue');
  assert.strictEqual(Q.concurrencySetting({ PROVIDER_SLOTS_IMAGE: '7' }), 7);
  assert.strictEqual(Q.concurrencySetting({ PROVIDER_SLOTS: '5', IMAGE_JOB_CONCURRENCY: '3' }), 5, 'the new name wins');
  let claims = 0;
  const repo = {
    openCounts: async () => [{ _id: 'queued', n: 3, oldest: new Date(Date.now() - 20000) }, { _id: 'processing', n: 1 }],
    oldestQueued: async () => { claims += 1; return []; }
  };
  const q = Q.createImageJobQueue({ repo, runsJobsHere: false, concurrency: 4, log: { log() {}, warn() {}, error() {} } });
  const m = await q.metrics();
  assert.strictEqual(m.queueDepth, 3);
  assert.strictEqual(m.running, 1);
  assert.ok(m.oldestQueuedAgeSeconds >= 19 && m.oldestQueuedAgeSeconds <= 21);
  assert.strictEqual(m.thisWorker.slots, 4);
  const r = await q.shutdown({ graceMs: 0 });
  assert.strictEqual(r.finished, true);
  await q.drain();
  assert.strictEqual(claims, 0, 'a stopping runner claims nothing');
});

test('SIGTERM helper: a process without consumers does nothing; a consumer stops both queues with the grace time', async () => {
  const { stopJobConsumers } = require('../services/jobConsumersShutdown');
  assert.deepStrictEqual(await stopJobConsumers({ env: { RUN_BACKGROUND: '0' } }), { skipped: true });
  const seen = [];
  const fake = (name) => ({ shutdown: async ({ graceMs }) => { seen.push([name, graceMs]); return { finished: true }; } });
  const r = await stopJobConsumers({ env: { RUN_BACKGROUND: '1' }, video: fake('video'), image: fake('image'), studio: fake('studio'), graceMs: 1234 });
  assert.deepStrictEqual(seen.sort(), [['image', 1234], ['studio', 1234], ['video', 1234]]);
  assert.deepStrictEqual(r, { video: { finished: true }, image: { finished: true }, studio: { finished: true } });
});

// ---- D74 review fixes (items 4 to 7) ----

test('D74 item 4: 3 workers draining at the same moment never START more than the per-account cap for one account (the claim is re-counted and handed back)', async () => {
  const w = world({ workers: 3, settings: { slots: { video: 2 }, perUserRunning: 2 } });
  let inFlight = 0; let peak = 0; const done = [];
  w.qs.forEach((q) => q.registerHandler('create_video_pipeline', async (payload) => {
    inFlight += 1; peak = Math.max(peak, inFlight);
    await settle(8);
    inFlight -= 1; done.push(payload.n);
    return { videoUrl: 'https://cdn/v.mp4' };
  }));
  await quiet(async () => {
    for (let i = 0; i < 6; i += 1) await w.charged(w.qs[0], 'solo');
    // all three drain at once, over and over, until the account's 6 jobs are done
    for (let round = 0; round < 60 && done.length < 6; round += 1) { await Promise.all(w.qs.map((q) => q._drainQueue())); await settle(12); }
    await settle(80);
  });
  assert.strictEqual(done.length, 6, 'every job still runs');
  assert.ok(peak <= 2, `at most 2 of one account at once, peak was ${peak}`);
  const sample = w.model.docs.filter((d) => d.status === 'processing').length;
  assert.strictEqual(sample, 0);
  assert.ok(w.model.docs.every((d) => d.attempts === 1), 'a hand-back does not count as an attempt');
  w.stop();
});

test('D74 item 4: a claim above the cap is handed back conditionally (only if still ours): back to queued, attempt not counted', async () => {
  const w = world({ workers: 2, settings: { slots: { video: 2 }, perUserRunning: 1 } });
  const started = [];
  w.qs.forEach((q) => q.registerHandler('create_video_pipeline', async (payload) => { started.push(payload.n); await new Promise(() => {}); }));
  await quiet(async () => {
    for (let i = 0; i < 3; i += 1) await w.charged(w.qs[0], 'solo');
    // worker 2 already holds one running job of the account: worker 1's claim finds count 2 > cap 1
    w.model.docs[0].status = 'processing'; w.model.docs[0].workerId = 'w2'; w.model.docs[0].attempts = 1; w.model.docs[0].leaseUntil = new Date(w.clock.t + 60000);
    const claimed = await w.qs[0]._claim(w.model.docs[1].jobId, 'video');
    assert.ok(claimed);
    assert.strictEqual(await w.qs[0]._overCap(claimed), true);
    assert.strictEqual(w.model.docs[1].status, 'queued');
    assert.strictEqual(w.model.docs[1].workerId, null);
    assert.strictEqual(w.model.docs[1].attempts, 0);
    // a job that is no longer ours is not touched by the hand-back
    const c2 = await w.qs[0]._claim(w.model.docs[2].jobId, 'video');
    w.model.docs[2].workerId = 'w2'; // lease sweep gave it away
    await w.qs[0]._overCap(c2);
    assert.strictEqual(w.model.docs[2].status, 'processing');
    assert.strictEqual(w.model.docs[2].workerId, 'w2');
  });
  assert.deepStrictEqual(started, []);
  w.stop();
});

test('D74 item 5: a worker re-claiming its own lost job keeps run 2 in its running map when run 1 finally ends', async () => {
  const w = world({ workers: 2 });
  const gates = [];
  w.qs[0].registerHandler('create_video_pipeline', async () => { const g = deferred(); gates.push(g); await g.p; return { videoUrl: 'https://cdn/v.mp4' }; });
  w.qs[1].registerHandler('create_video_pipeline', async () => { await new Promise(() => {}); });
  await quiet(async () => {
    await w.charged(w.qs[0], 'u1');
    await w.qs[0]._drainQueue();
    await settle();
    assert.strictEqual(w.qs[0].running.size, 1);
    const id = w.model.docs[0].jobId;
    // its lease runs out (database stall); ANOTHER worker's sweep re-queues it, then worker 1 claims it again (run 2)
    w.clock.t += 120000;
    await w.qs[1].recoverStaleJobs();
    assert.strictEqual(w.model.docs[0].status, 'queued');
    await w.qs[0]._drainQueue();
    await settle();
    assert.strictEqual(gates.length, 2, 'run 2 started');
    assert.strictEqual(w.model.docs[0].attempts, 2);
    const run2 = w.qs[0].running.get(id);
    assert.ok(run2);
    // run 1 finally ends: its finally must not delete run 2's entry
    gates[0].resolve();
    await settle(60);
    assert.strictEqual(w.qs[0].running.get(id), run2, 'run 2 is still tracked (slot, shutdown and heartbeat see it)');
    assert.strictEqual(w.model.docs[0].status, 'processing', 'run 1\'s late result was discarded');
    gates[1].resolve();
    await settle(60);
    assert.strictEqual(w.model.docs[0].status, 'completed');
    assert.strictEqual(w.qs[0].running.size, 0);
  });
  w.stop();
});

test('D74 item 7: 60 waiting jobs of a capped account do not hide another account from the 50-row window', async () => {
  const w = world({ settings: { slots: { video: 2 }, perUserRunning: 2 } });
  const started = [];
  w.qs[0].registerHandler('create_video_pipeline', async (payload) => { started.push(payload.who); await new Promise(() => {}); });
  for (let i = 0; i < 2; i += 1) w.model.docs.push({ jobId: `run${i}`, userId: 'A', status: 'processing', workerId: 'elsewhere', attempts: 1, leaseUntil: new Date(w.clock.t + 60000), metadata: { jobType: 'create_video_pipeline' }, createdAt: new Date(w.clock.t - 1e6), logs: [] });
  await quiet(async () => {
    for (let i = 0; i < 60; i += 1) await w.qs[0].enqueue({ userId: 'A', jobType: 'create_video_pipeline', payload: { who: 'A' }, metadata: { quarkCharge: [{ action: 'video_base', count: 1, ref: `a${i}`, payerId: '' }] } });
    await w.qs[0].enqueue({ userId: 'B', jobType: 'create_video_pipeline', payload: { who: 'B' }, metadata: { quarkCharge: [{ action: 'video_base', count: 1, ref: 'b0', payerId: '' }] } });
    await w.qs[0]._drainQueue();
    await settle();
  });
  assert.deepStrictEqual(started, ['B'], 'B starts although 60 older rows of capped A come first; A starts nothing (already at its cap)');
  w.stop();
});

test('D74 item 6 / D75: the lease sweep waits one heartbeat past the lease end, so a server clock running ahead does not steal a live job', async () => {
  const hb = 20000;
  const mkWorld = (skewMs) => {
    const w = world({ workers: 1, settings: { heartbeatMs: hb } });
    // a second worker whose clock is `skewMs` ahead of the one that holds the job (same database)
    const sweeper = new PersistentVideoGenerationQueue({
      model: w.model, draftModel: { updateMany: async () => ({}) }, runsJobsHere: false, workerId: 'w9',
      settings: { ...SETTINGS, heartbeatMs: hb }, now: () => w.clock.t + skewMs, leaseLock: { withLease: async (n, t, fn) => ({ ran: true, result: await fn({ isLost: () => false }) }) },
      refund: async () => ({ success: true }), chargeProof: async () => ({ spend: null, refunded: false }), alertOwner: async () => {}
    });
    return { w, sweeper };
  };
  const heldJob = async (w) => {
    w.qs[0].registerHandler('create_video_pipeline', () => new Promise(() => {}));
    await quiet(async () => { await w.charged(w.qs[0], 'u1'); await w.qs[0]._drainQueue(); await settle(); });
    assert.strictEqual(w.model.docs[0].status, 'processing');
  };
  // 1) the sweeper's clock is 70 s ahead (lease is 60 s): without the margin it would see the lease as expired
  const a = mkWorld(70000);
  await heldJob(a.w);
  await quiet(() => a.sweeper.recoverStaleJobs());
  assert.strictEqual(a.w.model.docs[0].status, 'processing', 'a live job is not taken over by a fast clock');
  // 2) a genuinely dead worker (no heartbeat, same clocks): not swept at lease end, swept once one heartbeat has passed
  const b = mkWorld(0);
  await heldJob(b.w);
  b.w.clock.t += 60000 + 1000;
  await quiet(() => b.sweeper.recoverStaleJobs());
  assert.strictEqual(b.w.model.docs[0].status, 'processing', 'inside lease + one heartbeat');
  b.w.clock.t += hb;
  await quiet(() => b.sweeper.recoverStaleJobs());
  assert.strictEqual(b.w.model.docs[0].status, 'queued', 'after lease + heartbeat it is re-queued (run 2 of 2)');
  assert.strictEqual(b.w.model.docs[0].workerId, null);
  a.w.stop(); b.w.stop();
});
