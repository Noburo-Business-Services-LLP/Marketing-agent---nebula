'use strict';
/**
 * Photoshoot on worker consumers (tester task E9, stage B step 2).
 * Impact map: docs/superpowers/impact-maps/generation-parallelism.md "Stage B step 2"; ops: docs/superpowers/ops/generation-parallelism.md.
 *
 * Behind ENABLE_PHOTOSHOOT_CONSUMER (default OFF: a Photoshoot runs in the web task that took the request, as before).
 * When ON, POST /api/photoshoot/jobs (and a redo) charge, then leave the job waiting ('queued' with its charge recorded,
 * via 'consumer'); a consumer claims it with the stage A protocol and runs it (services/photoshoot/service.js runClaimed):
 *   - claim: ONE atomic update waiting -> running writing this worker's id into leaseOwner, a lease end and runs + 1;
 *   - slots: PROVIDER_SLOTS_PHOTOSHOOT (default 2) jobs at once per worker, each making 2 photos at once; no CPU slot (a
 *     Photoshoot does no local image work);
 *   - fair order: accounts at JOB_PER_USER_RUNNING are left out, fewest running first, oldest first; re-counted after the
 *     claim and handed back when above the cap (D76);
 *   - heartbeat: every JOB_HEARTBEAT_MS the lease is renewed, only while the row is still this claim; a write that matches
 *     nothing marks the run lost and it stops before its next paid call (its late results are deleted, never recorded);
 *   - photos are stored per index as they are made, so a re-run makes only the unfinished ones: nothing is made or charged
 *     twice for the customer;
 *   - lease sweep (here and in the resume loop): a lease that ran out one heartbeat ago is re-queued (run 2 of
 *     JOB_MAX_ATTEMPTS) or, at the cap, closed with the per-photo refund, proof first, once;
 *   - SIGTERM: claim nothing more, every run stops before its next batch, wait JOB_SHUTDOWN_GRACE_MS, hand back what is
 *     still held (resumable; at most 3 per job, then closed with the per-photo refund);
 *   - the daily AI ceiling holds claims (the row waits; the 30-minute close refunds it); a staff switch does not (the run
 *     closes the job at once with the refund).
 * In-process rows (no `via`) are never claimed or swept here.
 */
const crypto = require('crypto');
const os = require('os');
const logger = require('../utils/logger');

const CANDIDATES = 50;
const MAX_RELEASES = 3;

const newWorkerId = () => `${os.hostname()}:${process.pid}:${Date.now().toString(36)}:${crypto.randomBytes(3).toString('hex')}`;

/** The switch. Default OFF. */
function enabled(env = process.env) {
  return require('./photoshoot/service').consumerSwitch(env);
}

class PhotoshootConsumer {
  constructor({ service, settings, workerId, now, sleep, leaseLock, spend, alert, drainIntervalMs } = {}) {
    this._service = service || null;
    this._settings = settings || null;
    this.workerId = workerId || newWorkerId();
    this.now = now || (() => Date.now());
    this.sleep = sleep || ((ms) => new Promise((r) => { const t = setTimeout(r, ms); if (t.unref) t.unref(); }));
    this._leaseLock = leaseLock || null;
    this._spend = spend || null;
    this.alert = alert || ((text) => { try { require('./opsAlerts').recordFailure('photoshoot_consumer', text); } catch (_) { /* best effort */ } });
    this.drainIntervalMs = drainIntervalMs || Number(process.env.PHOTOSHOOT_DRAIN_INTERVAL_MS) || 5000;
    this.running = new Map(); // String(_id) -> { runs, lost, stop }
    this.started = false;
    this.stopping = false;
    this._draining = null;
    this._drainAgain = false;
    this.timers = [];
    this.stats = { claims: 0, finished: 0, lostRuns: 0, leaseRequeues: 0, leaseFailures: 0, ceilingCloses: 0, released: 0, shutdownFailed: 0, capHandBacks: 0, spendHolds: 0, orphansDeleted: 0 };
  }

  get service() { return this._service || require('./photoshoot').shared(); }
  get repo() { return this.service.consumerRepo; }
  get settings() { return this._settings || require('../config/jobSlots').jobSlots(); }
  get leaseLock() { return this._leaseLock || require('./leaseLock'); }
  get spend() { return this._spend || require('./spendGuard'); }
  get slots() { const s = this.settings.slots || {}; return Math.max(1, Number(s.photoshoot) || 2); }

  /** Drain loop + lease sweep. Idempotent. */
  start() {
    if (this.started) return this;
    this.started = true;
    this.stopping = false;
    const drain = setInterval(() => { this._drain().catch((e) => logger.error('[photoshoot consumer] drain failed:', e && e.message)); }, this.drainIntervalMs);
    const every = Math.max(10000, Math.min(60000, Math.floor(this.settings.leaseMs / 2)));
    const sweep = setInterval(() => { this._leasedSweep().catch((e) => logger.error('[photoshoot consumer] lease sweep failed:', e && e.message)); }, every);
    for (const t of [drain, sweep]) { if (t.unref) t.unref(); this.timers.push(t); }
    const s = this.settings;
    logger.info(`[photoshoot consumer] started (worker ${this.workerId}; ${this.slots} job slot(s), 2 photos each; per account ${s.perUserRunning}; lease ${Math.round(s.leaseMs / 1000)} s; up to ${s.maxAttempts} run(s) per job)`);
    this._leasedSweep().catch(() => null);
    this._drain().catch(() => null);
    return this;
  }

  /** A create in this process: claim at once (only when this process runs the consumer). */
  kick() {
    if (!this.started || this.stopping) return;
    this._drain().catch(() => null);
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
        logger.error('[photoshoot consumer] drain loop failed:', e && e.message);
      } finally { this._draining = null; }
      return started;
    })();
    return this._draining;
  }

  /** The daily AI ceiling says stop: claim nothing (the row waits; the 30-minute close refunds it). A staff switch does not hold. */
  async _spendOk() {
    for (const action of ['photoshoot_image', 'image_generated']) {
      try {
        const g = await this.spend.check(action);
        if (g && g.ok === false && g.reason !== 'switched_off') { this.stats.spendHolds += 1; return false; }
      } catch (_) { /* the guard never blocks on its own failure */ }
    }
    return true;
  }

  async _drainOnce() {
    if (this.stopping) return 0;
    const s = this.settings;
    if (!(await this._spendOk())) return 0;
    let ceilingLeft = Infinity;
    if (s.globalCeiling > 0) {
      ceilingLeft = s.globalCeiling - (await this.repo.countRunningAll());
      if (ceilingLeft <= 0) return 0;
    }
    const free = Math.min(this.slots - this.running.size, ceilingLeft);
    if (free <= 0) return 0;
    return this._claimFair(free);
  }

  async _claimFair(free) {
    const cap = this.settings.perUserRunning;
    const counts = new Map(); const ids = new Map();
    for (const r of (await this.repo.runningByUser()) || []) { if (r._id == null) continue; counts.set(String(r._id), Number(r.n) || 0); ids.set(String(r._id), r._id); }
    const capped = cap > 0 ? [...counts].filter(([, n]) => n >= cap).map(([k]) => ids.get(k)) : [];
    const candidates = (await this.repo.consumerCandidates({ excludeUsers: capped, limit: CANDIDATES })) || [];
    if (!candidates.length) return 0;
    const active = new Map(counts);
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
      try { claimed = await this._claim(c._id); } catch (e) { logger.error('[photoshoot consumer] claim failed:', e && e.message); }
      if (!claimed) continue;
      // The claim resolved after SIGTERM began: shutdown() did not see this job (it was not running yet), so give it back.
      if (this.stopping) { await this._handBack(claimed); break; }
      if (await this._overCap(claimed)) { active.set(String(c.user), cap); continue; }
      active.set(String(c.user), (active.get(String(c.user)) || 0) + 1);
      started += 1;
      this._start(claimed);
    }
    return started;
  }

  async _claim(id) {
    const at = this.now();
    return this.repo.claimConsumer(id, this.workerId, new Date(at), new Date(at + this.settings.leaseMs));
  }

  /** Above JOB_PER_USER_RUNNING after this claim (all workers and the in-process path)? Hand it back and do not run it. */
  async _overCap(claimed) {
    const cap = this.settings.perUserRunning;
    if (!(cap > 0)) return false;
    try {
      const n = await this.repo.countRunning(claimed.user);
      if (n <= cap) return false;
      if (await this._handBack(claimed)) this.stats.capHandBacks += 1;
      return true;
    } catch (e) {
      logger.error('[photoshoot consumer] per-account re-count failed:', e && e.message);
      return false;
    }
  }

  _cond(runs) { return { leaseOwner: this.workerId, runs }; }

  /** Back to waiting with the run not counted, only while the row is still this claim. True when it was handed back. */
  async _handBack(claimed, { release = false } = {}) {
    try {
      return !!(await this.repo.handBack(claimed._id, this._cond(claimed.runs), { release, now: new Date(this.now()) }));
    } catch (e) {
      logger.error('[photoshoot consumer] could not hand a claim back:', e && e.message); // its lease runs out and the sweep re-queues it
      return false;
    }
  }

  _start(doc) {
    const id = String(doc._id);
    const run = { runs: doc.runs, lost: false, stop: false, doc };
    this.running.set(id, run);
    this.stats.claims += 1;
    this._run(doc, run)
      .catch((e) => logger.error(`[photoshoot consumer] run of ${id} threw:`, e && e.message))
      .finally(() => {
        if (this.running.get(id) === run) this.running.delete(id);
        if (!this.stopping) this._drain().catch(() => null);
      });
  }

  _controls(run) {
    return {
      owner: this._cond(run.runs),
      leaseEnd: () => new Date(this.now() + this.settings.leaseMs),
      lose: () => { run.lost = true; },
      isLost: () => run.lost,
      stopping: () => run.stop || this.stopping,
      orphan: () => { this.stats.orphansDeleted += 1; }
    };
  }

  async _run(doc, run) {
    const cond = { status: 'running', ...this._cond(run.runs) };
    const hb = setInterval(() => {
      if (run.lost) return;
      Promise.resolve()
        .then(() => this.repo.heartbeat(doc._id, cond, new Date(this.now() + this.settings.leaseMs)))
        .then((ok) => { if (!ok) run.lost = true; })
        .catch(() => { /* unknown: the lease decides */ });
    }, this.settings.heartbeatMs);
    if (hb.unref) hb.unref();
    let result = null;
    try {
      result = await this.service.runClaimed(doc, this._controls(run));
    } finally { clearInterval(hb); }
    if (result === 'stopped' && !run.lost) { await this._release(doc, run); return; }
    if (run.lost || result === 'lost') this.stats.lostRuns += 1; else this.stats.finished += 1;
  }

  /** SIGTERM hand-back of one job this worker holds: resumable, at most MAX_RELEASES times, then closed with the per-photo refund. */
  async _release(doc, run) {
    run.lost = true; // its late writes (if any call is still out) must lose
    let row = null;
    try { row = await this.repo.findById(doc._id); } catch (_) { row = null; }
    if (!row || row.status !== 'running' || row.leaseOwner !== this.workerId || Number(row.runs) !== Number(run.runs)) return 'gone';
    try {
      if ((Number(row.releases) || 0) < MAX_RELEASES) {
        if (await this._handBack({ _id: doc._id, runs: run.runs }, { release: true })) { this.stats.released += 1; return 'released'; }
      } else if (await this.service.consumerClose(doc._id, { status: 'running', ...this._cond(run.runs) }, 'stopped')) {
        this.stats.shutdownFailed += 1;
        return 'failed';
      }
    } catch (e) { logger.error(`[photoshoot consumer] could not hand back ${String(doc._id)}:`, e && e.message); }
    return 'kept';
  }

  _leasedSweep() {
    return this.leaseLock.withLease('scheduler:photoshoot:lease-sweep', 60000, () => this.sweepLeases());
  }

  /** Expired leases (re-queue or close) and stuck runs (hard ceiling), skipping runs this worker still holds and runs. */
  async sweepLeases() {
    const skip = (row) => {
      const mine = this.running.get(String(row._id));
      return Boolean(mine && !mine.lost && row.leaseOwner === this.workerId);
    };
    const out = await this.service.sweepConsumerLeases({ skip });
    this.stats.leaseRequeues += out.requeued;
    this.stats.leaseFailures += out.failed;
    this.stats.ceilingCloses += out.ceiling;
    if (out.failed) this.alert(`${out.failed} photoshoot(s) closed after their worker was lost at the run cap`);
    return out;
  }

  /**
   * SIGTERM: claim nothing more, every run stops before its next batch (calls in flight finish and are recorded), wait up
   * to graceMs, then hand back each job still held here. Conditional on this claim.
   */
  async shutdown({ graceMs = this.settings.shutdownGraceMs } = {}) {
    if (!this.started) return { skipped: true };
    this.stopping = true;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    const before = this.stats.released;
    const failedBefore = this.stats.shutdownFailed;
    for (const run of this.running.values()) run.stop = true;
    const deadline = this.now() + Math.max(0, graceMs);
    while (this.running.size && this.now() < deadline) await this.sleep(Math.min(250, Math.max(1, deadline - this.now())));
    const finished = this.running.size === 0;
    for (const [, run] of [...this.running]) await this._release(run.doc, run);
    const released = this.stats.released - before;
    const failed = this.stats.shutdownFailed - failedBefore;
    if (released || failed) logger.info(`[photoshoot consumer] shutdown handed back ${released} photoshoot(s), closed and refunded ${failed}.`);
    return { finished, released, failed };
  }

  /** Staff queue numbers: counts and worker ids only (bounded: two aggregates over the open rows). */
  async metrics() {
    const now = this.now();
    let queued = 0; let running = 0; let oldest = null;
    for (const r of (await this.repo.consumerStatusCounts()) || []) {
      if (r._id === 'queued') { queued += Number(r.n) || 0; if (r.oldest) oldest = new Date(r.oldest); } else running += Number(r.n) || 0;
    }
    const runningByWorker = {};
    let inProcessRunning = 0;
    for (const w of (await this.repo.runningByWorker()) || []) {
      if (w.via === 'consumer') runningByWorker[String(w._id || 'unknown')] = Number(w.n) || 0;
      else inProcessRunning += Number(w.n) || 0;
    }
    return {
      queueDepth: queued,
      running,
      oldestQueuedAgeSeconds: oldest ? Math.max(0, Math.round((now - oldest.getTime()) / 1000)) : 0,
      runningByWorker,
      inProcessRunning,
      thisWorker: {
        workerId: this.workerId,
        enabled: enabled(),
        consumer: this.started,
        stopping: this.stopping,
        slots: { photoshoot: this.slots },
        slotsInUse: { photoshoot: this.running.size },
        ...this.stats
      }
    };
  }
}

const photoshootConsumer = new PhotoshootConsumer();

/** Started from startBackgroundJobs() with the other consumers: only with RUN_JOB_CONSUMERS and the switch on. */
function startPhotoshootConsumer({ env = process.env } = {}) {
  if (!enabled(env)) return null;
  if (!require('./backgroundRole').runsJobConsumers(env)) return null;
  return photoshootConsumer.start();
}

module.exports = { PhotoshootConsumer, photoshootConsumer, startPhotoshootConsumer, enabled, MAX_RELEASES };
