'use strict';
/**
 * Videos (Gemini Omni) on worker consumers (tester task E9, stage B step 1).
 * Impact map: docs/superpowers/impact-maps/generation-parallelism.md "Stage B step 1"; ops: docs/superpowers/ops/generation-parallelism.md.
 *
 * Behind ENABLE_STUDIO_VIDEO_CONSUMER (default OFF: the Videos flow runs in the web task that took the request, as before).
 * When ON, `POST /api/videos/create` and `/:id/change` charge, then store the StudioVideo as 'queued'; a consumer claims it
 * with the stage A protocol and runs it (routes/studioVideos.js runClaimed):
 *   - claim: ONE atomic update queued -> processing writing this worker's id, a lease end and attempts + 1;
 *   - slots: PROVIDER_SLOTS_OMNI (default 2) videos making clips at once per worker; a video in its finishing step
 *     (join, subtitles, logo, upload) frees its provider slot and waits for a CPU_SLOTS slot (services/cpuSlots.js);
 *     at most omni + cpu videos are held per worker;
 *   - fair order: accounts at JOB_PER_USER_RUNNING are left out, fewest running first, oldest first; re-counted after
 *     the claim and handed back when above the cap;
 *   - heartbeat: every JOB_HEARTBEAT_MS the lease is renewed, only while the row is still this claim; a write that
 *     matches nothing marks the run lost and it stops at its next step (its late result is discarded);
 *   - every clip is stored as soon as it is made (clipUrls), so a re-run resumes after the last stored clip: nothing is
 *     made or charged twice for the customer;
 *   - lease sweep: a lease that ran out one heartbeat ago is re-queued (run 2 of JOB_MAX_ATTEMPTS, resumes) or, at the cap,
 *     failed and refunded once through the D19-B refund claim (routes/studioVideos.js fail with the claim's conditions);
 *   - SIGTERM: claim nothing more, wait JOB_SHUTDOWN_GRACE_MS, hand back what still runs (resumable; at most 3 per video).
 * Rows of the in-process path ('processing' with no worker id) are never claimed or swept here: they keep the old
 * stale rule of the studio sweep.
 */
const crypto = require('crypto');
const os = require('os');
const logger = require('../utils/logger');

const CANDIDATES = 50;
const SWEEP_BATCH = 25;
const MAX_RELEASES = 3;
const LOST_MESSAGE = 'The server making this video stopped. Your Quarks were returned. Please try again.';
const STOP_MESSAGE = 'The server making this video was restarted. Your Quarks were returned. Please try again.';

const newWorkerId = () => `${os.hostname()}:${process.pid}:${Date.now().toString(36)}:${crypto.randomBytes(3).toString('hex')}`;
const matchedCount = (r) => Number(r && (r.matchedCount !== undefined ? r.matchedCount : (r.n !== undefined ? r.n : r.modifiedCount))) || 0;

/** The switch. Default OFF. */
function enabled(env = process.env) {
  const v = String(env.ENABLE_STUDIO_VIDEO_CONSUMER == null ? '' : env.ENABLE_STUDIO_VIDEO_CONSUMER).trim().toLowerCase();
  return v === 'on' || v === '1' || v === 'true' || v === 'yes';
}

class RunLostError extends Error {
  constructor(id) { super(`this worker no longer holds video ${id}`); this.stopRun = true; }
}

class StudioVideoConsumer {
  constructor({ model, settings, workerId, now, sleep, leaseLock, runner, closeLost, dropClips, cpu, drainIntervalMs, alert } = {}) {
    this._model = model || null;
    this._settings = settings || null;
    this.workerId = workerId || newWorkerId();
    this.now = now || (() => Date.now());
    this.sleep = sleep || ((ms) => new Promise((r) => { const t = setTimeout(r, ms); if (t.unref) t.unref(); }));
    this._leaseLock = leaseLock || null;
    this.runner = runner || ((doc, ctl) => require('../routes/studioVideos').runClaimed(doc, ctl));
    this.closeLost = closeLost || ((row, message, filter) => require('../routes/studioVideos')._money.fail(row, message, filter));
    this.dropClips = dropClips || ((urls) => require('../routes/studioVideos').dropClips(urls));
    this._cpu = cpu || null;
    this.alert = alert || ((text) => { try { require('./opsAlerts').recordFailure('studio_video', text); } catch (_) { /* best effort */ } });
    this.drainIntervalMs = drainIntervalMs || Number(process.env.STUDIO_VIDEO_DRAIN_INTERVAL_MS) || 5000;
    this.running = new Map(); // String(_id) -> { attempt, lost, stage: 'generating' | 'finishing' }
    this.started = false;
    this.stopping = false;
    this._draining = null;
    this._drainAgain = false;
    this.timers = [];
    this.stats = { claims: 0, finished: 0, lostRuns: 0, leaseRequeues: 0, leaseFailures: 0, released: 0, shutdownFailed: 0, capHandBacks: 0 };
  }

  get model() { return this._model || require('../models/StudioVideo'); }
  get settings() { return this._settings || require('../config/jobSlots').jobSlots(); }
  get leaseLock() { return this._leaseLock || require('./leaseLock'); }
  get cpu() { return this._cpu || require('./cpuSlots').cpuSlots(); }
  get omniSlots() { const s = this.settings.slots || {}; return Math.max(1, Number(s.omni) || 2); }

  /** Drain loop + lease sweep. Idempotent. */
  start() {
    if (this.started) return this;
    this.started = true;
    this.stopping = false;
    const drain = setInterval(() => { this._drain().catch((e) => logger.error('[videos consumer] drain failed:', e && e.message)); }, this.drainIntervalMs);
    const every = Math.max(10000, Math.min(60000, Math.floor(this.settings.leaseMs / 2)));
    const sweep = setInterval(() => { this._leasedSweep().catch((e) => logger.error('[videos consumer] lease sweep failed:', e && e.message)); }, every);
    for (const t of [drain, sweep]) { if (t.unref) t.unref(); this.timers.push(t); }
    const s = this.settings;
    logger.info(`[videos consumer] started (worker ${this.workerId}; omni slots ${this.omniSlots}, cpu ${s.cpu}; per account ${s.perUserRunning}; lease ${Math.round(s.leaseMs / 1000)} s; up to ${s.maxAttempts} run(s) per video)`);
    this._leasedSweep().catch(() => null);
    this._drain().catch(() => null);
    return this;
  }

  /** A create in this process: claim at once (only when this process runs the consumer). */
  kick() {
    if (!this.started || this.stopping) return;
    this._drain().catch(() => null);
  }

  _generating() {
    let n = 0;
    for (const r of this.running.values()) if (r.stage !== 'finishing') n += 1;
    return n;
  }

  async _drain() {
    if (this.stopping) return 0;
    if (this._draining) { this._drainAgain = true; return this._draining; }
    this._draining = (async () => {
      let started = 0;
      try {
        do {
          this._drainAgain = false;
          started += await this._drainOnce();
        } while (this._drainAgain && !this.stopping);
      } catch (e) {
        logger.error('[videos consumer] drain loop failed:', e && e.message);
      } finally { this._draining = null; }
      return started;
    })();
    return this._draining;
  }

  async _drainOnce() {
    const s = this.settings;
    let ceilingLeft = Infinity;
    if (s.globalCeiling > 0) {
      const total = await this.model.countDocuments({ status: 'processing' });
      ceilingLeft = s.globalCeiling - total;
      if (ceilingLeft <= 0) return 0;
    }
    const free = Math.min(this.omniSlots - this._generating(), (this.omniSlots + Math.max(1, Number(s.cpu) || 1)) - this.running.size, ceilingLeft);
    if (free <= 0) return 0;
    return this._claimFair(free);
  }

  /** Running Videos per account (all workers and the in-process path): one aggregate over the running rows. */
  async _runningByUser() {
    const counts = new Map();
    const ids = new Map();
    const rows = (await this.model.aggregate([
      { $match: { status: 'processing' } },
      { $group: { _id: '$user', n: { $sum: 1 } } }
    ])) || [];
    for (const r of rows) { if (r._id == null) continue; counts.set(String(r._id), Number(r.n) || 0); ids.set(String(r._id), r._id); }
    return { counts, ids };
  }

  async _claimFair(free) {
    const cap = this.settings.perUserRunning;
    const running = await this._runningByUser();
    const capped = cap > 0 ? [...running.counts].filter(([, n]) => n >= cap).map(([k]) => running.ids.get(k)) : [];
    const candidates = (await this.model.find({ status: 'queued', ...(capped.length ? { user: { $nin: capped } } : {}) })
      .sort({ createdAt: 1 }).limit(CANDIDATES).select({ _id: 1, user: 1, createdAt: 1 }).lean()) || [];
    if (!candidates.length) return 0;
    const active = new Map(running.counts);
    const remaining = candidates.slice();
    let started = 0;
    while (started < free && remaining.length && !this.stopping) {
      let best = -1;
      let bestN = Infinity;
      for (let i = 0; i < remaining.length; i += 1) {
        const n = active.get(String(remaining[i].user)) || 0;
        if (cap > 0 && n >= cap) continue;
        if (n < bestN) { best = i; bestN = n; } // strict: the oldest wins a tie
      }
      if (best < 0) break;
      const [c] = remaining.splice(best, 1);
      let claimed = null;
      try { claimed = await this._claim(c._id); } catch (e) { logger.error('[videos consumer] claim failed:', e && e.message); }
      if (!claimed) continue;
      // The claim resolved after SIGTERM began: shutdown() did not see this video (it was not running yet), so give it back.
      if (this.stopping) { await this._handBack(claimed); break; }
      if (await this._overCap(claimed)) { active.set(String(c.user), cap); continue; }
      active.set(String(c.user), (active.get(String(c.user)) || 0) + 1);
      started += 1;
      this._start(claimed);
    }
    return started;
  }

  /** queued -> processing for THIS worker with a lease; null when another worker took it (or it was closed). */
  async _claim(id) {
    const at = this.now();
    return this.model.findOneAndUpdate(
      { _id: id, status: 'queued' },
      { $set: { status: 'processing', workerId: this.workerId, leaseUntil: new Date(at + this.settings.leaseMs), startedAt: new Date(at) }, $inc: { attempts: 1 } },
      { new: true }
    ).lean();
  }

  /** Above JOB_PER_USER_RUNNING after this claim? Hand it back (attempt not counted) and do not run it. */
  async _overCap(claimed) {
    const cap = this.settings.perUserRunning;
    if (!(cap > 0)) return false;
    try {
      const n = await this.model.countDocuments({ status: 'processing', user: claimed.user });
      if (n <= cap) return false;
      if (await this._handBack(claimed)) this.stats.capHandBacks += 1;
      return true;
    } catch (e) {
      logger.error('[videos consumer] per-account re-count failed:', e && e.message);
      return false;
    }
  }

  /** Back to 'queued' with the attempt not counted, only while the row is still this claim. True when it was handed back. */
  async _handBack(claimed) {
    try {
      const back = await this.model.findOneAndUpdate(
        { _id: claimed._id, status: 'processing', workerId: this.workerId, attempts: claimed.attempts },
        { $set: { status: 'queued', workerId: null, leaseUntil: null }, $inc: { attempts: -1 } },
        { new: true }
      ).lean();
      return !!back;
    } catch (e) {
      logger.error('[videos consumer] could not hand a claim back:', e && e.message); // its lease runs out and the sweep re-queues it
      return false;
    }
  }

  _start(doc) {
    const id = String(doc._id);
    const run = { attempt: doc.attempts, lost: false, stage: 'generating' };
    this.running.set(id, run);
    this.stats.claims += 1;
    this._run(doc, run)
      .catch((e) => logger.error(`[videos consumer] run of ${id} threw:`, e && e.message))
      .finally(() => {
        if (this.running.get(id) === run) this.running.delete(id);
        if (!this.stopping) this._drain().catch(() => null);
      });
  }

  /** The control object the run uses (routes/studioVideos.js runClaimed): the claim, checks, the CPU pool. */
  _controls(doc, run) {
    const id = String(doc._id);
    const owner = { workerId: this.workerId, attempts: doc.attempts };
    return {
      owner,
      leaseEnd: () => new Date(this.now() + this.settings.leaseMs),
      lose: () => { run.lost = true; },
      isLost: () => run.lost,
      check: async () => {
        if (run.lost) throw new RunLostError(id);
        let cur = null;
        try { cur = await this.model.findOne({ _id: doc._id }).select({ status: 1, workerId: 1, attempts: 1 }).lean(); } catch (_) { return; } // unknown: the lease decides
        if (!cur || cur.status !== 'processing' || cur.workerId !== owner.workerId || Number(cur.attempts) !== Number(owner.attempts)) {
          run.lost = true;
          throw new RunLostError(id);
        }
      },
      cpu: (fn) => this.cpu.run(fn),
      finishing: () => {
        if (run.stage === 'finishing') return;
        run.stage = 'finishing'; // its provider slot is free for the next video
        this.kick();
      }
    };
  }

  async _run(doc, run) {
    const owner = { workerId: this.workerId, attempts: doc.attempts };
    const hb = setInterval(() => {
      if (run.lost) return;
      const at = this.now();
      Promise.resolve()
        .then(() => this.model.updateOne({ _id: doc._id, status: 'processing', ...owner }, { $set: { leaseUntil: new Date(at + this.settings.leaseMs) } }))
        .then((r) => { if (!matchedCount(r)) run.lost = true; })
        .catch(() => { /* unknown: the lease decides */ });
    }, this.settings.heartbeatMs);
    if (hb.unref) hb.unref();
    try {
      await this.runner(doc, this._controls(doc, run));
    } finally { clearInterval(hb); }
    if (run.lost) this.stats.lostRuns += 1; else this.stats.finished += 1;
  }

  _leasedSweep() {
    return this.leaseLock.withLease('scheduler:studio-video:lease-sweep', 60000, () => this.sweepLeases());
  }

  /**
   * Videos whose lease ran out one heartbeat ago (their worker died or lost the database): re-queued to resume (under
   * JOB_MAX_ATTEMPTS) or failed and refunded once. Every write is conditional on the worker id, attempt and lease end
   * read here, so two sweeps (or a sweep and a late completion) never both act. Bounded; never throws.
   */
  async sweepLeases({ limit = SWEEP_BATCH } = {}) {
    const s = this.settings;
    const margin = Math.max(0, Math.min(Number(s.heartbeatMs) || 0, Math.floor((Number(s.leaseMs) || 0) / 3)));
    let rows = [];
    try {
      rows = (await this.model.find({ status: 'processing', workerId: { $ne: null }, leaseUntil: { $lt: new Date(this.now() - margin) } }).limit(limit).lean()) || [];
    } catch (e) {
      logger.error('[videos consumer] could not read expired leases:', e && e.message);
      return { requeued: 0, failed: 0 };
    }
    let requeued = 0;
    let failed = 0;
    for (const row of rows) {
      const mine = this.running.get(String(row._id));
      if (mine && !mine.lost && row.workerId === this.workerId) continue; // still running here; the heartbeat renews it
      const cond = { workerId: row.workerId, attempts: row.attempts, leaseUntil: row.leaseUntil };
      try {
        if ((Number(row.attempts) || 0) < s.maxAttempts) {
          const back = await this.model.findOneAndUpdate(
            { _id: row._id, status: 'processing', ...cond },
            { $set: { status: 'queued', workerId: null, leaseUntil: null, queuedAt: new Date(this.now()) }, $inc: { leaseRequeues: 1 } },
            { new: true }
          ).lean();
          if (back) { requeued += 1; this.stats.leaseRequeues += 1; logger.info(`[videos consumer] video ${row._id} re-queued after its worker was lost (it resumes after clip ${(back.clipUrls || []).length}).`); }
        } else {
          const closed = await this.closeLost(row, LOST_MESSAGE, cond);
          if (closed) {
            failed += 1;
            this.stats.leaseFailures += 1;
            this.alert(`video ${row._id}: its worker was lost on run ${row.attempts} and it was failed and refunded`);
            await this.dropClips(closed.clipUrls || row.clipUrls || []);
          }
        }
      } catch (e) { logger.error(`[videos consumer] lease sweep failed for ${row._id}:`, e && e.message); }
    }
    return { requeued, failed };
  }

  /**
   * SIGTERM: claim nothing more, wait up to graceMs, then hand back each video still running here ('queued', the attempt
   * not counted, resumable; at most MAX_RELEASES per video, then failed and refunded once). Conditional on this claim.
   */
  async shutdown({ graceMs = this.settings.shutdownGraceMs } = {}) {
    if (!this.started) return { skipped: true };
    this.stopping = true;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    const deadline = this.now() + Math.max(0, graceMs);
    while (this.running.size && this.now() < deadline) await this.sleep(Math.min(250, Math.max(1, deadline - this.now())));
    const finished = this.running.size === 0;
    let released = 0;
    let failed = 0;
    for (const [id, run] of [...this.running]) {
      run.lost = true;
      const mine = { _id: id, status: 'processing', workerId: this.workerId, attempts: run.attempt };
      let row = null;
      try { row = await this.model.findOne(mine).lean(); } catch (_) { row = null; }
      if (!row) continue;
      try {
        if ((Number(row.releases) || 0) < MAX_RELEASES) {
          const back = await this.model.findOneAndUpdate(mine, { $set: { status: 'queued', workerId: null, leaseUntil: null, queuedAt: new Date(this.now()) }, $inc: { attempts: -1, releases: 1 } }, { new: true }).lean();
          if (back) { released += 1; this.stats.released += 1; }
        } else {
          const closed = await this.closeLost(row, STOP_MESSAGE, { workerId: this.workerId, attempts: run.attempt });
          if (closed) { failed += 1; this.stats.shutdownFailed += 1; await this.dropClips(closed.clipUrls || []); }
        }
      } catch (e) { logger.error(`[videos consumer] could not hand back ${id}:`, e && e.message); }
    }
    if (released || failed) logger.info(`[videos consumer] shutdown handed back ${released} video(s), failed and refunded ${failed}.`);
    return { finished, released, failed };
  }

  /** Staff queue numbers: counts and worker ids only (bounded: two aggregates over the open rows). */
  async metrics() {
    const now = this.now();
    const rows = (await this.model.aggregate([
      { $match: { status: { $in: ['queued', 'processing'] } } },
      { $group: { _id: '$status', n: { $sum: 1 }, oldest: { $min: '$queuedAt' } } }
    ])) || [];
    let queued = 0;
    let running = 0;
    let oldest = null;
    for (const r of rows) {
      if (r._id === 'queued') { queued += Number(r.n) || 0; if (r.oldest) oldest = new Date(r.oldest); } else running += Number(r.n) || 0;
    }
    const workers = (await this.model.aggregate([
      { $match: { status: 'processing' } },
      { $group: { _id: '$workerId', n: { $sum: 1 } } }
    ])) || [];
    const runningByWorker = {};
    for (const w of workers) runningByWorker[String(w._id || 'in-process')] = Number(w.n) || 0;
    const generating = this._generating();
    return {
      queueDepth: queued,
      running,
      oldestQueuedAgeSeconds: oldest ? Math.max(0, Math.round((now - oldest.getTime()) / 1000)) : 0,
      runningByWorker,
      thisWorker: {
        workerId: this.workerId,
        enabled: enabled(),
        consumer: this.started,
        stopping: this.stopping,
        slots: { omni: this.omniSlots, cpu: this.settings.cpu },
        slotsInUse: { omni: generating, finishing: this.running.size - generating },
        ...this.stats
      }
    };
  }
}

const studioVideoConsumer = new StudioVideoConsumer();

/** Started from startBackgroundJobs() with the other consumers: only with RUN_JOB_CONSUMERS and the switch on. */
function startStudioVideoConsumer({ env = process.env } = {}) {
  if (!enabled(env)) return null;
  if (!require('./backgroundRole').runsJobConsumers(env)) return null;
  return studioVideoConsumer.start();
}

module.exports = { StudioVideoConsumer, studioVideoConsumer, startStudioVideoConsumer, enabled, RunLostError, MAX_RELEASES, LOST_MESSAGE };
