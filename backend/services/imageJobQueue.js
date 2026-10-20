'use strict';
/**
 * Campaign image jobs in MongoDB (decision D34). Replaces the in-process `campaignImageQueue` (jobs were lost on
 * every restart and a status poll that reached another server task answered "Job not found").
 *
 *   enqueue (any task, from the request)  -> stores the job as `queued`. Per account at most 5 waiting: the 6th is
 *                                            refused with 429 (QueueFullError). A payload over 4 MB is refused (413).
 *   runner  (worker or single task only)  -> claims the oldest waiting job whose account has fewer than 2 running
 *                                            (atomic queued -> processing with a lease), runs its handler, renews the
 *                                            lease while it runs, and writes the result only while it still holds
 *                                            the lease. IMAGE_JOB_CONCURRENCY jobs at once per runner (default 2).
 *   lost job (lease ran out: the task died) -> failed with "This did not finish. Please try again." and NEVER run
 *                                            again on its own: the provider may still be making (and billing) the
 *                                            first picture. The charge is taken only when a picture is delivered
 *                                            (executeRegeneratePostImage), so a lost job costs the customer nothing.
 *   getJob (any task)                     -> the stored job, only to its own account, with its place in the queue.
 */
const crypto = require('crypto');
const os = require('os');

const USER_ACTIVE_MAX = 2;
const USER_QUEUED_MAX = 5;
const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;
const LEASE_MS = 2 * 60 * 1000;
const HEARTBEAT_MS = 30 * 1000;
const POLL_MS = 2000;
const DONE_KEEP_MS = 6 * 60 * 60 * 1000;
const QUEUED_KEEP_MS = 24 * 60 * 60 * 1000;
const LOST_MESSAGE = 'This did not finish. Please try again.';

class QueueFullError extends Error {
  constructor() { super('You already have several pictures waiting. Please wait for them to finish, then try again.'); this.name = 'QueueFullError'; this.status = 429; }
}
class PayloadTooLargeError extends Error {
  constructor() { super('This request is too large to queue.'); this.name = 'PayloadTooLargeError'; this.status = 413; }
}

function concurrencySetting(env = process.env) {
  const n = Number.parseInt(String(env.IMAGE_JOB_CONCURRENCY || env.CAMPAIGN_IMAGE_QUEUE_CONCURRENCY || ''), 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 20) : 2;
}

/** The MongoDB side, through models/ImageJob.js. Every state change is one conditional write. */
function mongoRepo(model = () => require('../models/ImageJob')) {
  const M = () => model();
  return {
    insert: (doc) => M().create(doc),
    countFor: (userId, status) => M().countDocuments({ userId: String(userId), status }),
    countProcessing: () => M().countDocuments({ status: 'processing' }),
    oldestQueued: (limit) => M().find({ status: 'queued' }).sort({ createdAt: 1 }).limit(limit).lean(),
    claim: (jobId, owner, now, leaseUntil) => M().findOneAndUpdate(
      { jobId, status: 'queued' },
      { $set: { status: 'processing', leaseOwner: owner, leaseUntil, startedAt: now, currentStep: 'starting', expireAt: new Date(now.getTime() + QUEUED_KEEP_MS) }, $inc: { attempts: 1 } },
      { new: true }
    ).lean(),
    update: async (jobId, owner, set, now) => {
      const r = await M().updateOne({ jobId, status: 'processing', leaseOwner: owner }, { $set: { ...set, updatedAt: now } });
      return !!(r && (r.matchedCount || r.n));
    },
    pushLog: (jobId, line) => M().updateOne({ jobId }, { $push: { logs: { $each: [line], $slice: -200 } } }),
    expired: (now, limit) => M().find({ status: 'processing', leaseUntil: { $lt: now } }).sort({ leaseUntil: 1 }).limit(limit).lean(),
    failLost: async (job, now) => {
      const r = await M().updateOne(
        { jobId: job.jobId, status: 'processing', leaseOwner: job.leaseOwner, leaseUntil: { $lt: now } },
        { $set: { status: 'failed', progress: 100, currentStep: 'failed', completedAt: now, error: { message: LOST_MESSAGE }, expireAt: new Date(now.getTime() + DONE_KEEP_MS) } }
      );
      return !!(r && (r.modifiedCount || r.nModified));
    },
    get: (jobId, userId) => M().findOne({ jobId: String(jobId || ''), ...(userId ? { userId: String(userId) } : {}) }).lean(),
    position: (job) => M().countDocuments({ status: 'queued', createdAt: { $lt: job.createdAt } })
  };
}

function createImageJobQueue({
  repo = mongoRepo(),
  now = () => new Date(),
  concurrency = concurrencySetting(),
  owner = `${os.hostname()}:${process.pid}:${crypto.randomBytes(4).toString('hex')}`,
  runsJobsHere = require('./backgroundRole').runsBackground(),
  timers = { setInterval, clearInterval, setTimeout },
  log = console
} = {}) {
  const handlers = new Map();
  const active = new Set();
  let draining = null;
  let pollTimer = null;

  function registerHandler(type, fn) {
    if (typeof fn !== 'function') throw new Error(`Handler for ${type} must be a function`);
    handlers.set(type, fn);
  }

  function publicView(job, position = null) {
    if (!job) return null;
    return {
      jobId: job.jobId, userId: job.userId, status: job.status, progress: job.progress, currentStep: job.currentStep,
      createdAt: job.createdAt, updatedAt: job.updatedAt, startedAt: job.startedAt, completedAt: job.completedAt,
      result: job.result, error: job.error, logs: job.logs || [], metadata: job.metadata && Object.keys(job.metadata).length ? job.metadata : null,
      ...(position != null ? { queuePosition: position } : {})
    };
  }

  async function enqueue({ userId, type, payload = {} }) {
    if (!userId) throw new Error('userId is required');
    if (!type) throw new Error('type is required');
    let size = 0;
    try { size = Buffer.byteLength(JSON.stringify(payload || {})); } catch (_) { throw new PayloadTooLargeError(); }
    if (size > MAX_PAYLOAD_BYTES) throw new PayloadTooLargeError();
    if ((await repo.countFor(userId, 'queued')) >= USER_QUEUED_MAX) throw new QueueFullError();
    const at = now();
    const doc = {
      jobId: crypto.randomUUID(), userId: String(userId), type, status: 'queued', progress: 0, currentStep: 'queued',
      payload: payload || {}, result: null, error: null, metadata: {}, logs: [], attempts: 0, leaseOwner: '', leaseUntil: null,
      startedAt: null, completedAt: null, expireAt: new Date(at.getTime() + QUEUED_KEEP_MS), createdAt: at, updatedAt: at
    };
    await repo.insert(doc);
    if (runsJobsHere) drain().catch(() => null); // a single task starts at once; a web-only task leaves it to the worker
    return publicView(doc);
  }

  async function getJob(jobId, userId) {
    if (!userId) return null;
    const job = await repo.get(jobId, userId);
    if (!job) return null;
    const position = job.status === 'queued' ? (await repo.position(job)) + 1 : null;
    return publicView(job, position);
  }

  /** Fail the jobs whose runner was lost (lease ran out). Never runs them again. */
  async function sweepLost(limit = 50) {
    const at = now();
    const rows = (await repo.expired(at, limit)) || [];
    let failed = 0;
    for (const job of rows) {
      if (active.has(job.jobId)) continue;
      if (await repo.failLost(job, at)) { failed += 1; repo.pushLog(job.jobId, `[${at.toISOString()}] FAILED: the runner was lost (lease ran out)`).catch(() => null); }
    }
    if (failed) log.warn(`[image jobs] ${failed} job(s) whose runner was lost marked failed`);
    return failed;
  }

  async function claimNext() {
    const candidates = (await repo.oldestQueued(25)) || [];
    const busy = new Map();
    for (const job of candidates) {
      const uid = String(job.userId);
      if (!busy.has(uid)) busy.set(uid, await repo.countFor(uid, 'processing'));
      if (busy.get(uid) >= USER_ACTIVE_MAX) continue; // fairness: this account already has 2 running
      const at = now();
      const claimed = await repo.claim(job.jobId, owner, at, new Date(at.getTime() + LEASE_MS));
      if (claimed) return claimed;
    }
    return null;
  }

  async function run(job) {
    active.add(job.jobId);
    const handler = handlers.get(job.type);
    const heartbeat = timers.setInterval(() => {
      const at = now();
      repo.update(job.jobId, owner, { leaseUntil: new Date(at.getTime() + LEASE_MS) }, at).catch(() => null);
    }, HEARTBEAT_MS);
    if (heartbeat && heartbeat.unref) heartbeat.unref();
    const done = (set) => { const at = now(); return repo.update(job.jobId, owner, { ...set, progress: 100, completedAt: at, leaseUntil: null, expireAt: new Date(at.getTime() + DONE_KEEP_MS) }, at); };
    try {
      if (!handler) throw new Error(`No handler for image job type ${job.type}`);
      const controls = {
        update: ({ progress, currentStep, metadata } = {}) => {
          const set = {};
          if (Number.isFinite(progress)) set.progress = Math.max(0, Math.min(100, Number(progress)));
          if (typeof currentStep === 'string' && currentStep.trim()) set.currentStep = currentStep.trim();
          if (metadata && typeof metadata === 'object') for (const [k, v] of Object.entries(metadata)) set[`metadata.${k}`] = v;
          if (Object.keys(set).length) repo.update(job.jobId, owner, set, now()).catch(() => null);
        },
        log: (message) => { repo.pushLog(job.jobId, `[${now().toISOString()}] ${String(message || '').trim()}`).catch(() => null); }
      };
      const result = await handler({ userId: job.userId, payload: job.payload || {}, jobId: job.jobId }, controls);
      const wrote = await done({ status: 'completed', currentStep: 'completed', result: result === undefined ? null : result, error: null });
      if (!wrote) log.warn(`[image jobs] ${job.jobId} finished after its lease was lost: result not written`);
    } catch (error) {
      await done({ status: 'failed', currentStep: 'failed', error: { message: (error && error.message) || 'Campaign image generation failed' } }).catch(() => null);
      repo.pushLog(job.jobId, `[${now().toISOString()}] FAILED: ${(error && error.message) || error}`).catch(() => null);
    } finally {
      timers.clearInterval(heartbeat);
      active.delete(job.jobId);
      drain().catch(() => null);
    }
  }

  /** Claim and start jobs until this runner is full or nothing can be taken. One drain at a time per process. */
  function drain() {
    if (draining) return draining;
    draining = (async () => {
      try {
        while (active.size < concurrency) {
          const job = await claimNext();
          if (!job) break;
          run(job).catch((e) => log.error('[image jobs] run failed:', e && e.message));
        }
      } catch (e) {
        log.error('[image jobs] drain failed:', e && e.message);
      } finally { draining = null; }
    })();
    return draining;
  }

  function start({ pollMs = POLL_MS } = {}) {
    if (pollTimer) return pollTimer;
    let ticks = 0;
    pollTimer = timers.setInterval(() => {
      ticks += 1;
      if (ticks % 15 === 1) sweepLost().catch((e) => log.warn('[image jobs] lost-job sweep failed:', e && e.message));
      drain().catch(() => null);
    }, pollMs);
    if (pollTimer && pollTimer.unref) pollTimer.unref();
    log.log(`[image jobs] runner started (concurrency ${concurrency}, per account ${USER_ACTIVE_MAX} running and ${USER_QUEUED_MAX} waiting)`);
    return pollTimer;
  }

  function stop() { if (pollTimer) timers.clearInterval(pollTimer); pollTimer = null; }

  return { registerHandler, enqueue, getJob, drain, sweepLost, claimNext, start, stop, activeCount: () => active.size, owner };
}

let shared = null;
const imageJobQueue = () => (shared = shared || createImageJobQueue());

/** For server-main's startBackgroundJobs(). Off with ENABLE_IMAGE_JOB_RUNNER=off. */
function startImageJobRunner({ env = process.env } = {}) {
  if (String(env.ENABLE_IMAGE_JOB_RUNNER || '').trim().toLowerCase() === 'off') return null;
  return imageJobQueue().start();
}

module.exports = {
  createImageJobQueue, mongoRepo, imageJobQueue, startImageJobRunner, concurrencySetting,
  QueueFullError, PayloadTooLargeError, USER_ACTIVE_MAX, USER_QUEUED_MAX, MAX_PAYLOAD_BYTES, LEASE_MS, LOST_MESSAGE
};
