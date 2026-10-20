const crypto = require('crypto');
const os = require('os');
const logger = require('../utils/logger');
const VideoJob = require('../models/VideoJob');
const { settleRefund, SWEEP_AFTER_MS } = require('./refundSettle');
const { QUARK_COSTS } = require('../config/apiCosts');
const { JobCancelledError } = require('./jobCancelled');

// Per-worker slots (E9 stage A, config/jobSlots.js, docs/superpowers/ops/generation-parallelism.md). Each worker claims
// jobs for ITS OWN slots (image and video pools), so total capacity = worker tasks x slots. VIDEO_QUEUE_CONCURRENCY
// still works as the video default.
const POOLS = ['image', 'video'];
const IMAGE_JOB_TYPES = new Set(['render_missing_scene_images', 'generate_content']);
const poolFor = (jobType) => (IMAGE_JOB_TYPES.has(String(jobType || '')) ? 'image' : 'video');
// Job types whose handler takes no charge (the route charged before the job existed): when the worker running one is
// lost (its lease ran out) the job may be run again, at most JOB_MAX_ATTEMPTS runs, with no new charge. Per-scene jobs
// charge inside the handler and are never re-run automatically.
const RETRY_SAFE_TYPES = new Set(['create_video_pipeline', 'generate_clips', 'merge_video', 'generate_content']);
const MAX_RELEASES = 3; // graceful hand-backs (SIGTERM) per job before it is failed instead
const CANDIDATES = 50; // waiting rows read per pool per drain (fair choice among them)
const SWEEP_BATCH = 25;
const newWorkerId = () => `${os.hostname()}:${process.pid}:${Date.now().toString(36)}:${crypto.randomBytes(3).toString('hex')}`;
const matchedCount = (r) => Number(r && (r.matchedCount !== undefined ? r.matchedCount : r.n)) || 0;

const DEFAULT_JOB_TTL_MS = Math.max(
  10 * 60 * 1000,
  Number.parseInt(process.env.VIDEO_JOB_TTL_MS || String(6 * 60 * 60 * 1000), 10) || (6 * 60 * 60 * 1000)
);

const PUBLIC_STEP_MESSAGES = {
  queued: 'Preparing your video...',
  retrying: 'Retrying video generation...',
  stale_recovery_retry: 'Retrying video generation...',
  stale_recovery_failed: 'Retrying video generation...',
  missing_handler: 'Retrying video generation...',
  failed: 'Retrying video generation...',
  generate_clips: 'Generating video clips...',
  render_missing_scene_images: 'Making the missing scene images...',
  render_missing_clips: 'Making the missing video clips...',
  generateVideoClips: 'Generating video clips...',
  downloading_clips: 'Generating video clips...',
  saving_clips: 'Finalizing your video...',
  merge_video: 'Synchronizing audio and video...',
  merging_clips: 'Optimizing video quality...',
  downloading_audio: 'Synchronizing audio and video...',
  generating_subtitles: 'Generating subtitles...',
  merging_final_output: 'Creating final video...',
  finalizing: 'Finalizing your video...',
  learning: 'Finalizing your video...',
  completed: 'Your video is ready.'
};

function publicStepMessage(step = '') {
  const raw = String(step || '').trim();
  if (PUBLIC_STEP_MESSAGES[raw]) return PUBLIC_STEP_MESSAGES[raw];
  const normalized = raw.toLowerCase();
  if (normalized.includes('retry') || normalized.includes('stale')) return 'Retrying video generation...';
  if (normalized.includes('clip') || normalized.includes('fal')) return 'Generating video clips...';
  if (normalized.includes('audio') && !normalized.includes('merge')) return 'Generating voice-over...';
  if (normalized.includes('merge') || normalized.includes('sync')) return 'Synchronizing audio and video...';
  if (normalized.includes('final') || normalized.includes('render')) return 'Creating final video...';
  if (normalized.includes('image')) return 'Generating scene images...';
  if (normalized.includes('scene')) return 'Generating video scenes...';
  return 'Optimizing video quality...';
}

function sanitizeLogLine(line = '') {
  return String(line || '')
    .replace(/(FAL_KEY=|fal[_-]?key["'\s:=]+)[^\s"',]+/gi, '$1[redacted]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+/gi, '$1[redacted]')
    .trim();
}

function publicErrorMessage(job = {}) {
  const message = String(job?.error?.message || '').trim();
  if (message && message !== 'Retrying video generation...') return message;

  const logs = Array.isArray(job?.logs) ? job.logs : [];
  const failedLog = [...logs].reverse().find((line) => /failed|error|denied|unauthorized|forbidden/i.test(String(line || '')));
  if (failedLog) return sanitizeLogLine(failedLog).replace(/^\[[^\]]+\]\s*/, '');

  return publicStepMessage(job.currentStep);
}

function estimateRemainingSeconds(job = {}) {
  const progress = Math.max(0, Math.min(99, Number(job.progress) || 0));
  const startedAt = job.startedAt ? new Date(job.startedAt).getTime() : 0;
  if (startedAt && Number.isFinite(startedAt) && progress > 2) {
    const elapsed = Math.max(1, (Date.now() - startedAt) / 1000);
    return Math.max(1, Math.round((elapsed / progress) * (100 - progress)));
  }
  const type = String(job?.metadata?.jobType || '').toLowerCase();
  if (type.includes('clip')) return 120;
  if (type.includes('merge')) return 50;
  return 30;
}

// Thrown to a handler (through controls.update) when its job was cancelled, stopped or failed by someone else: the
// worker stops at the next step instead of finishing a video nobody is going to be charged for.

class PersistentVideoGenerationQueue {
  constructor({ concurrency, settings, jobTtlMs = DEFAULT_JOB_TTL_MS, model, draftModel, refund, chargeProof, alertOwner, runsJobsHere, workerId, now, leaseLock, sleep } = {}) {
    // A process that does not run job consumers (a web task, RUN_JOB_CONSUMERS=0) only stores the job; a consumer's
    // drain claims it (atomic queued -> processing with this worker's id and a lease). Elsewhere enqueue drains at once.
    this.runsJobsHere = typeof runsJobsHere === 'boolean' ? runsJobsHere : require('./backgroundRole').runsJobConsumers();
    const base = settings || require('../config/jobSlots').jobSlots();
    // `concurrency` (older callers and tests) sets the video slots.
    this.settings = { ...base, slots: { ...base.slots, ...(Number.isFinite(concurrency) ? { video: Math.max(1, concurrency) } : {}) } };
    this.workerId = workerId || newWorkerId();
    this.now = now || (() => Date.now());
    this.leaseLock = leaseLock || require('./leaseLock');
    this.sleep = sleep || ((ms) => new Promise((r) => { const t = setTimeout(r, ms); if (t.unref) t.unref(); }));
    this.running = new Map(); // jobId -> { pool, attempt, lost } for the jobs THIS worker runs
    this.stopping = false;
    this._draining = null;
    this._drainAgain = false;
    this.stats = { claims: 0, completed: 0, failed: 0, leaseRequeues: 0, leaseFailures: 0, released: 0, lostRuns: 0, capHandBacks: 0 };
    this.draftModel = draftModel || null;
    // Injectable for tests; the real ones load on first use.
    this.model = model || VideoJob;
    this.refund = refund || ((...a) => require('../middleware/trialGuard').refundCredits(...a));
    this.chargeProof = chargeProof || ((...a) => require('./quarkBuckets').chargeProof(...a));
    this.alertOwner = alertOwner || ((a) => require('./opsAlerts').notify(a));
    this.concurrency = this.settings.slots.video;
    this.jobTtlMs = jobTtlMs;
    this.handlers = new Map();
    this.workerTimer = null;
    this.gcTimer = null;
    this.recoveryTimer = null;
  }

  /**
   * Registers a job processor function for a specific jobType
   * @param {string} jobType 
   * @param {function} handlerFn 
   */
  registerHandler(jobType, handlerFn) {
    if (typeof handlerFn !== 'function') {
      throw new Error(`Handler for ${jobType} must be a function`);
    }
    this.handlers.set(jobType, handlerFn);
    logger.info(`🤖 Persistent Queue: Registered handler for job type [${jobType}]`);
  }

  /**
   * Starts the background queue worker and GC/recovery loops
   */
  startWorker() {
    this.stopping = false;
    this._startGcTimer();
    this._startRecoveryTimer();
    
    if (this.workerTimer) clearInterval(this.workerTimer);
    
    // Poll the database for queued jobs — 2s polling was leaking ~6 MB/min via
    // constant Mongoose query allocations. enqueue() triggers immediate drain
    // anyway, so this interval is only a safety net for missed triggers.
    // 15s = 8x fewer queries, no user-visible latency impact.
    // On the worker of a web/worker split nothing triggers a drain at enqueue (the job was stored by a web task), so
    // the safety net is the only way in: 5 s there, so a video starts within about 5 s.
    const drainIntervalMs = Number(process.env.VIDEO_QUEUE_DRAIN_INTERVAL_MS) || (require('./backgroundRole').isSplit() ? 5000 : 15000);
    this.workerTimer = setInterval(() => {
      this._drainQueue().catch((err) => {
        logger.error('⚠️ Persistent Queue drain error:', err.message);
      });
    }, drainIntervalMs);
    
    this.workerTimer.unref?.();
    const st = this.settings;
    logger.info(`🚀 Persistent Queue: Background worker successfully started (worker ${this.workerId}; slots image ${st.slots.image}, video ${st.slots.video}, cpu ${st.cpu}; per account ${st.perUserRunning} running; lease ${Math.round(st.leaseMs / 1000)} s; up to ${st.maxAttempts} run(s) per job; global ceiling ${st.globalCeiling || 'off'})`);

    // Run crash recovery on startup (non-blocking, safe for rolling updates and for several workers)
    this.recoverInterruptedJobsOnStartup().catch((err) => {
      logger.error('Persistent Queue startup interrupted-job recovery error:', err.message);
    });
    this._leasedSweep().catch((err) => {
      logger.error('⚠️ Persistent Queue startup recovery error:', err.message);
    });
  }

  /**
   * Rows that older code left 'processing' (no worker id, so no lease). In a single process (RUN_BACKGROUND not set)
   * nothing else can be running them: failed and refunded at once, as before. In a split, only the stale rule
   * (recoverStaleJobs) touches them. Jobs claimed by this code (with a worker id) are NEVER ended here: their lease
   * decides (another worker may be running them).
   */

  async recoverInterruptedJobsOnStartup() {
    if (String(process.env.VIDEO_JOB_RECOVER_PROCESSING_ON_STARTUP || 'true').toLowerCase() === 'false') return;

    if (require('./backgroundRole').isSplit()) return;
    const processingJobs = await this.model.find({ status: 'processing', workerId: null });
    if (!processingJobs.length) return;

    // NEVER re-queue on startup. Every restart and every redeploy used to
    // re-run whatever was mid-flight, silently spending fal.ai credits with
    // nobody asking for it. Mark them failed instead — the user decides.
    logger.info(`Persistent Queue: Marking ${processingJobs.length} interrupted job(s) failed after startup (no auto-retry).`);
    for (const job of processingJobs) {
      const won = await this._failIfProcessing(job, {
        currentStep: 'stale_recovery_failed',
        error: { message: 'The server restarted while this job was running. Press Retry to try again.', stack: null },
        log: 'App restarted while job was processing. Marked failed — retries are manual only.',
        extraFilter: { workerId: null }
      });
      if (won) await this._refundJob(won, 'was interrupted by a server restart');
    }
  }

  /**
   * Ends a job that is still 'processing' as failed and, in the SAME conditional update, claims its refund
   * (refundState 'refunding'). Returns the updated job when this call won, null when the job had already left
   * 'processing' (cancelled, finished, failed by another path): the caller that wins is the only one that refunds.
   * `extraFilter` adds conditions (the stale scan: not updated since the threshold).
   */
  async _failIfProcessing(job, { currentStep, error, log, extraFilter = {} }) {
    const now = new Date();
    const owed = this._refundPlan(job).length > 0;
    try {
      return await this.model.findOneAndUpdate(
        { jobId: job.jobId, status: 'processing', ...extraFilter },
        {
          $set: { status: 'failed', currentStep, completedAt: now, updatedAt: now, error, ...(owed ? { refundState: 'refunding', refundAt: now } : {}) },
          $push: { logs: `[${now.toISOString()}] ${log}` }
        },
        { new: true }
      ).lean();
    } catch (err) {
      logger.error(`⚠️ Failed to mark job ${job.jobId} failed:`, err.message);
      return null;
    }
  }

  /**
   * What a job was charged, as the refunds to pay: one entry per charge with the ref that charge carried (so the Quark
   * ledger and chargeProof see both), the wallet that paid when it was recorded, and the amount. A per-scene job
   * charged each scene itself (and refunds that scene itself), so it has nothing to refund here. A job with NO charge
   * record refunds nothing (D74): the old flat "campaign_full x1" guess let a free job (/mergeVideo) mint Quarks when it
   * failed. Every route that charges for a job records the charge in metadata.quarkCharge at enqueue time.
   */
  _refundPlan(job = {}) {
    if (!job || !job.userId) return [];
    const charges = job.metadata?.quarkCharge;
    if (Array.isArray(charges) && charges.length) {
      return charges.map((c, i) => ({ action: c.action, count: c.count, ref: String(c.ref || `${job.jobId}:${i}`), payerId: c.payerId ? String(c.payerId) : '' }));
    }
    return [];
  }

  async _payEntry(job, e, why, payerId = e.payerId) {
    const r = await this.refund(String(job.userId), e.action, e.count, `Refund: AI video generation job ${job.jobId} ${why}`, { ref: e.ref, ...(payerId ? { payerId } : {}) });
    return !(r && r.success === false);
  }

  /**
   * Pays the refund this job's winner claimed (refundState 'refunding'): every charge, with its ref, to the wallet that
   * paid; then marks 'refunded'. A payment that fails or a crash leaves the claim: sweepRefunds pays what is still owed
   * once, only when chargeProof says nobody has.
   */
  async _refundJob(job, why) {
    const plan = this._refundPlan(job);
    if (!plan.length) return false;
    let all = true;
    for (const e of plan) {
      let ok = false;
      try { ok = await this._payEntry(job, e, why); } catch (err) { logger.error(`⚠️ Failed to refund credits for job ${job.jobId}:`, err.message); }
      if (!ok) all = false;
    }
    if (!all) return false;
    try { await this.model.updateOne({ jobId: job.jobId, refundState: 'refunding' }, { $set: { refundState: 'refunded' } }); } catch (_) { /* the sweep marks it */ }
    await this._pushLog(job.jobId, 'Credits automatically refunded.');
    return true;
  }

  /** A bounded pass over refunds a crash or an outage left claimed but unpaid. Each job is held first (one conditional update). */
  async sweepRefunds(limit = 10) {
    const now = new Date();
    const older = new Date(now.getTime() - SWEEP_AFTER_MS);
    let rows = [];
    try { rows = (await this.model.find({ refundState: 'refunding', refundAt: { $lt: older } }).limit(limit).lean()) || []; } catch (_) { return 0; }
    let settled = 0;
    for (const r of rows) {
      try {
        const job = await this.model.findOneAndUpdate({ jobId: r.jobId, refundState: 'refunding', refundAt: { $lt: older } }, { $set: { refundAt: new Date() } }, { new: false }).lean();
        if (!job) continue;
        const outs = [];
        for (const e of this._refundPlan(job)) {
          outs.push(await settleRefund({
            ref: e.ref, userId: String(job.userId), quarks: (Number(QUARK_COSTS[e.action]) || 0) * (Number(e.count) || 0), payerId: e.payerId,
            chargeProof: this.chargeProof, alert: this.alertOwner, label: 'video',
            pay: ({ payerId }) => this._payEntry(job, e, 'was settled', payerId)
          }));
        }
        if (outs.every((o) => o === 'paid' || o === 'already')) { await this.model.updateOne({ jobId: job.jobId, refundState: 'refunding' }, { $set: { refundState: 'refunded' } }); settled += 1; }
        else if (outs.some((o) => o === 'failed' || o === 'unknown')) { /* held for another two minutes */ }
        else { await this.model.updateOne({ jobId: job.jobId, refundState: 'refunding' }, { $set: { refundState: 'unproven' } }); }
      } catch (e) { logger.error('⚠️ Video refund sweep failed:', e.message); }
    }
    return settled;
  }

  /** The expired-lease sweep and the refund sweep, through one lease so two consumers do not run the same pass at once. */
  _leasedSweep() {
    return this.leaseLock.withLease('scheduler:video-jobs:lease-sweep', 60000, async () => {
      await this.recoverStaleJobs();
      await this.sweepRefunds();
    });
  }

  _startRecoveryTimer() {
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
    // Half a lease (30 s by default, 10 s to 60 s): a lost worker's job is re-queued or refunded within about
    // lease + half a lease.
    const every = Math.max(10000, Math.min(60000, Math.floor(this.settings.leaseMs / 2)));
    this.recoveryTimer = setInterval(async () => {
      try {
        await this._leasedSweep();
      } catch (err) {
        logger.error('⚠️ Persistent Queue stale job recovery loop failed:', err.message);
      }
    }, every);
    this.recoveryTimer.unref?.();
  }

  _retrySafe(job = {}) {
    const type = job?.metadata?.jobType;
    return RETRY_SAFE_TYPES.has(String(type || '')) && !job?.metadata?.perSceneCharging && !job?.metadata?.noRetry;
  }

  async _markDraftFailed(jobId, message) {
    try {
      const Draft = this.draftModel || require('../models/Draft');
      await Draft.updateMany({ 'generationProgress.jobId': jobId, status: 'processing' }, { $set: { status: 'failed', errorMessage: message } });
    } catch (err) {
      logger.error(`⚠️ Failed to update Draft status for job ${jobId}:`, err.message);
    }
  }

  /**
   * One job whose lease ran out (its worker died, or lost the database for longer than the lease). Every write is
   * conditional on the worker id, the attempt and the lease end this pass READ, so two sweeps (or a sweep and a late
   * completion) never both act. Retry-safe and under JOB_MAX_ATTEMPTS: back to 'queued' (no charge: the route charged
   * once, before the job existed). Otherwise: failed, with the refund claimed in the same write, then paid once.
   */
  async _expireLease(job) {
    const now = new Date(this.now());
    const cond = { workerId: job.workerId, attempts: job.attempts, leaseUntil: job.leaseUntil };
    const attempts = Number(job.attempts) || 0;
    if (this._retrySafe(job) && attempts < this.settings.maxAttempts) {
      let back = null;
      try {
        back = await this.model.findOneAndUpdate(
          { jobId: job.jobId, status: 'processing', ...cond },
          {
            $set: { status: 'queued', workerId: null, leaseUntil: null, currentStep: 'retrying', updatedAt: now },
            $inc: { leaseRequeues: 1 },
            $push: { logs: { $each: [`[${now.toISOString()}] The server running this job stopped (lease ran out). Queued again (run ${attempts + 1} of ${this.settings.maxAttempts}); nothing is charged again.`], $slice: -200 } }
          },
          { new: true }
        ).lean();
      } catch (err) {
        logger.error(`⚠️ Failed to re-queue job ${job.jobId}:`, err.message);
        return 0;
      }
      if (!back) return 0;
      this.stats.leaseRequeues += 1;
      logger.info(`🔁 Persistent Queue: job ${job.jobId} re-queued after its worker was lost (run ${attempts + 1} of ${this.settings.maxAttempts}).`);
      return 1;
    }
    const won = await this._failIfProcessing(job, {
      currentStep: 'stale_recovery_failed',
      error: { message: 'The server running this job stopped. Press Retry to try again.', stack: null },
      log: `The server running this job stopped (lease ran out after ${attempts} run(s)). Marked failed — retries are manual only.`,
      extraFilter: cond
    });
    if (!won) return 0;
    this.stats.leaseFailures += 1;
    require('./opsAlerts').recordFailure('video', `job ${job.jobId}: its worker was lost and it was marked failed`);
    await this._markDraftFailed(job.jobId, 'This video stopped. Please try again.');
    await this._refundJob(won, 'stopped when its server was lost');
    return 1;
  }

  /**
   * The expired-lease sweep (bounded, idempotent): jobs whose lease ran out are re-queued or failed and refunded
   * (_expireLease). Rows that older code left 'processing' (no worker id) keep the old rule: no update for
   * VIDEO_JOB_STALE_TIMEOUT_MS (5 minutes) = failed and refunded, never re-queued.
   */
  async recoverStaleJobs({ limit = SWEEP_BATCH } = {}) {
    let expired = [];
    try {
      // A lease counts as expired one heartbeat AFTER its end (D75): workers write lease ends with their own clocks, so a
      // sweeper whose clock runs ahead by less than a lease does not take over a live job. A dead worker is found one
      // heartbeat (20 s by default) later than the bare lease end.
      const margin = Math.max(0, Math.min(Number(this.settings.heartbeatMs) || 0, Math.floor((Number(this.settings.leaseMs) || 0) / 3)));
      expired = (await this.model.find({ status: 'processing', leaseUntil: { $lt: new Date(this.now() - margin) } }).limit(limit).lean()) || [];
    } catch (err) {
      logger.error('⚠️ Failed to read expired job leases:', err.message);
    }
    for (const job of expired) {
      const mine = this.running.get(job.jobId);
      // Still running here and not lost (the heartbeat will renew it when the database answers again): leave it.
      if (mine && !mine.lost && job.workerId === this.workerId) continue;
      try { await this._expireLease(job); } catch (err) { logger.error(`⚠️ Lease sweep failed for job ${job.jobId}:`, err.message); }
    }

    const STALE_TIMEOUT_MS = Number(process.env.VIDEO_JOB_STALE_TIMEOUT_MS) || (5 * 60 * 1000); // Default 5 minutes
    const threshold = new Date(this.now() - STALE_TIMEOUT_MS);

    try {
      // Rows of older code only (no worker id) that haven't been updated since threshold
      const staleJobs = await this.model.find({
        status: 'processing',
        workerId: null,
        updatedAt: { $lt: threshold }
      }).limit(limit);

      if (staleJobs.length === 0) return;

      logger.info(`⚠️ Persistent Queue: Found ${staleJobs.length} stale/hung jobs in 'processing' state.`);
      
      for (const job of staleJobs) {
        // NEVER re-queue a stale job. fal.subscribe has no timeout, so a
        // "hung" job is often still running and still being billed —
        // re-queueing started a second paid generation alongside the first.
        // Mark it failed, refund, and let the user press Retry if they want
        // to spend again. Conditional on still being 'processing' and still stale: a job that moved on meanwhile
        // (finished, cancelled, updated) is left alone, and only the winner refunds.
        const won = await this._failIfProcessing(job, {
          currentStep: 'stale_recovery_failed',
          error: {
            message: `Job stopped responding for ${Math.round(STALE_TIMEOUT_MS / 60000)} minutes and was stopped. Press Retry to try again.`,
            stack: null
          },
          log: `Job detected as stale/hung (no updates for ${Math.round(STALE_TIMEOUT_MS / 60000)}m). Marked failed — retries are manual only.`,
          extraFilter: { updatedAt: { $lt: threshold }, workerId: null }
        });
        if (!won) continue;
        logger.info(`❌ Stale job ${job.jobId} marked failed (no auto-retry; user can retry manually).`);
        require('./opsAlerts').recordFailure('video', `job ${job.jobId} stalled and was marked failed`);
        // Per-scene jobs charge each scene as it renders and refund that scene themselves (see _refundPlan).
        await this._refundJob(won, 'stalled and failed');
      }
    } catch (err) {
      logger.error('⚠️ Failed to recover stale jobs:', err.message);
    }
  }

  _startGcTimer() {
    if (this.gcTimer) clearInterval(this.gcTimer);
    this.gcTimer = setInterval(async () => {
      try {
        const threshold = new Date(Date.now() - this.jobTtlMs);
        const res = await this.model.deleteMany({ updatedAt: { $lt: threshold } });
        if (res.deletedCount > 0) {
          logger.info(`🧹 Persistent Queue GC: Deleted ${res.deletedCount} stale jobs updated before ${threshold.toISOString()}`);
        }
      } catch (err) {
        logger.error('⚠️ Persistent Queue GC failed:', err.message);
      }
    }, 10 * 60 * 1000); // GC every 10 minutes
    this.gcTimer.unref?.();
  }

  /**
   * Enqueues a new background job into MongoDB
   */
  async enqueue({ userId = null, jobType, payload = {}, metadata = {} }) {
    if (!jobType) {
      throw new Error('jobType is required to enqueue');
    }
    if (!this.handlers.has(jobType)) {
      logger.warn(`⚠️ Enqueuing job type [${jobType}] before its handler is registered.`);
    }

    const jobId = crypto.randomUUID();

    const job = await this.model.create({
      jobId,
      userId: userId ? userId : null,
      status: 'queued',
      pool: poolFor(jobType),
      workerId: null,
      leaseUntil: null,
      progress: 0,
      currentStep: 'queued',
      payload,
      attempts: 0,
      // `metadata.quarkCharge` (when the caller supplies it) is how the
      // failure handler below refunds what was ACTUALLY deducted, rather
      // than a hardcoded guess that drifts from whatever the route charges.
      metadata: { jobType, ...metadata }
    });

    // Proactively trigger the drain loop (only in a process that runs jobs: a web-only task leaves it to the worker)
    if (this.runsJobsHere && !this.stopping) {
      this._drainQueue().catch((err) => {
        logger.error('⚠️ Persistent Queue drain trigger error:', err.message);
      });
    }

    return this._publicView(job.toObject());
  }

  /**
   * Retrieves status of a job
   */
  async getJob(jobId, userId = null) {
    try {
      const query = { jobId: String(jobId || '') };
      if (userId) {
        query.userId = userId;
      }
      const job = await this.model.findOne(query).lean();
      if (!job) return null;
      return this._publicView(job);
    } catch (err) {
      logger.error(`⚠️ Failed to get job ${jobId}:`, err.message);
      return null;
    }
  }

  /**
   * Cancels a job. ONE conditional update decides it (status queued or processing -> cancelled) and claims the refund in
   * the same write; only the call that won it refunds. A job that already finished, failed or was cancelled is returned
   * as it is, with no refund. The worker stops at its next step (controls.update throws JobCancelledError), and what it
   * finishes after that is discarded: completion and failure are conditional on the job still being 'processing'.
   */
  async cancelJob(jobId, userId = null) {
    try {
      const query = { jobId: String(jobId || '') };
      if (userId) {
        query.userId = userId;
      }
      const job = await this.model.findOne(query).lean();

      if (!job) {
        throw new Error('Job not found');
      }

      if (['completed', 'failed', 'cancelled'].includes(job.status)) {
        return this._publicView(job);
      }

      const now = new Date();
      const owed = this._refundPlan(job).length > 0;
      const won = await this.model.findOneAndUpdate(
        { ...query, status: { $in: ['queued', 'processing'] } },
        { $set: { status: 'cancelled', completedAt: now, updatedAt: now, error: { message: 'Job cancelled by user.' }, ...(owed ? { refundState: 'refunding', refundAt: now } : {}) } },
        { new: false }
      ).lean();
      const current = (await this.model.findOne(query).lean()) || job;
      if (!won) return this._publicView(current); // finished or cancelled meanwhile: nothing to refund here

      await this._pushLog(jobId, `Job cancelled by user.`);
      try {
        const Draft = this.draftModel || require('../models/Draft');
        await Draft.updateMany({ 'generationProgress.jobId': jobId, status: 'processing' }, { $set: { status: 'failed', errorMessage: 'Cancelled.' } });
      } catch (draftErr) {
        logger.error(`⚠️ Failed to update Draft status for cancelled job ${jobId}:`, draftErr.message);
      }
      if (owed) await this._refundJob(won, 'was cancelled');
      if (won.status === 'processing') {
        await this._pushLog(jobId, `Cancellation requested while job was processing. The worker stops at its next step and its result is discarded.`);
      }
      return this._publicView((await this.model.findOne(query).lean()) || current);
    } catch (err) {
      logger.error(`⚠️ Failed to cancel job ${jobId}:`, err.message);
      throw err;
    }
  }

  /**
   * Writes `patch` only while the job is still 'processing' and (with `owner`) still run by this worker on this attempt.
   * Returns the job, null when it is not, and throws on a database error.
   */
  async _updateIfProcessing(jobId, patch = {}, owner = null) {
    return this.model.findOneAndUpdate({ jobId, status: 'processing', ...(owner || {}) }, { $set: { ...patch, updatedAt: new Date(this.now()) } }, { new: true }).lean();
  }

  /** The conditions every write of a running job carries: this worker, this attempt (a re-claimed job has another). */
  _owner(jobDoc = {}) {
    return { workerId: jobDoc.workerId || null, ...(Number.isFinite(jobDoc.attempts) ? { attempts: jobDoc.attempts } : {}) };
  }

  async _updateJob(jobId, patch = {}) {
    try {
      const job = await this.model.findOneAndUpdate(
        { jobId },
        { $set: { ...patch, updatedAt: new Date() } },
        { new: true }
      ).lean();
      return job;
    } catch (err) {
      logger.error(`⚠️ Failed to update job ${jobId}:`, err.message);
      return null;
    }
  }

  async _pushLog(jobId, message) {
    try {
      const line = `[${new Date().toISOString()}] ${String(message || '').trim()}`;
      
      // Update with an atomic array push, while limiting log length to 200 items in Mongoose
      await this.model.updateOne(
        { jobId },
        { 
          $push: { 
            logs: { 
              $each: [line],
              $slice: -200 // Keep last 200 logs to prevent MongoDB document size issues
            } 
          },
          $set: { updatedAt: new Date() }
        }
      );
    } catch (err) {
      logger.error(`⚠️ Failed to push log to job ${jobId}:`, err.message);
    }
  }

  async _runJob(jobDoc, runArg = null) {
    const { jobId, metadata } = jobDoc;
    const jobType = metadata?.jobType;
    const handler = this.handlers.get(jobType);
    const owner = this._owner(jobDoc);
    // Shared with the drain (this.running) so the shutdown and the heartbeat can mark the run lost.
    const run = runArg || this.running.get(jobId) || { pool: jobDoc.pool || poolFor(jobType), attempt: jobDoc.attempts, lost: false };

    if (!handler) {
      logger.error(`❌ No handler registered for job type [${jobType}]. Job ${jobId} failed.`);
      const won = await this._failIfProcessing(jobDoc, {
        currentStep: 'missing_handler',
        error: { message: `No handler registered for job type [${jobType}]` },
        log: `No handler registered for job type [${jobType}]`,
        extraFilter: owner
      });
      if (won) await this._refundJob(won, 'could not start');
      return;
    }

    try {
      await this._pushLog(jobId, `Starting job execution [${jobType}]`);
      const heartbeatTimer = setInterval(() => {
        // Only while processing and still ours (this worker, this attempt), and only the heartbeat keys: never over step
        // metadata or a cancelled job. It renews the lease; a write that matches nothing means the job was cancelled,
        // re-queued or failed by someone else: the run is lost and stops at its next step.
        const at = this.now();
        this.model.updateOne(
          { jobId, status: 'processing', ...owner },
          { $set: { leaseUntil: new Date(at + this.settings.leaseMs), updatedAt: new Date(at), 'metadata.heartbeatAt': new Date(at).toISOString() } }
        ).then((r) => { if (!matchedCount(r)) run.lost = true; }).catch(() => { /* unknown: the lease decides */ });
      }, this.settings.heartbeatMs);
      heartbeatTimer.unref?.();
      
      const controls = {
        update: async ({ progress, currentStep, metadata: stepMetadata } = {}) => {
          const patch = {};
          if (Number.isFinite(progress)) {
            patch.progress = Math.max(0, Math.min(100, Number(progress)));
          }
          if (typeof currentStep === 'string' && currentStep.trim()) {
            patch.currentStep = currentStep.trim();
          }
          // Between steps: a job that was cancelled (or ended by another path), or whose lease this worker lost (re-queued
          // to another worker, or handed back at shutdown), stops here instead of going on.
          if (run.lost) throw new JobCancelledError(jobId);
          const current = await this.model.findOne({ jobId }).lean();
          if (current && current.status !== 'processing') throw new JobCancelledError(jobId);
          if (current && ((current.workerId || null) !== owner.workerId || (owner.attempts !== undefined && current.attempts !== owner.attempts))) { run.lost = true; throw new JobCancelledError(jobId); }
          patch.leaseUntil = new Date(this.now() + this.settings.leaseMs);
          if (stepMetadata && typeof stepMetadata === 'object') {
            // Merge nested metadata objects
            patch.metadata = { ...(current?.metadata || {}), ...stepMetadata };
          }
          let wrote = null;
          try { wrote = await this._updateIfProcessing(jobId, patch, owner); } catch (err) { logger.error(`⚠️ Failed to update job ${jobId}:`, err.message); return; }
          if (!wrote) { run.lost = true; throw new JobCancelledError(jobId); }
        },
        isCancelled: async () => {
          if (run.lost) return true;
          const current = await this.model.findOne({ jobId }).lean();
          return Boolean(current && (current.status !== 'processing' || (current.workerId || null) !== owner.workerId));
        },
        log: async (message) => await this._pushLog(jobId, message)
      };

      let result;
      try {
        result = await handler(jobDoc.payload, controls);
      } finally {
        clearInterval(heartbeatTimer);
      }

      // Completion is conditional on the job still being 'processing': a cancelled (refunded) or stopped job never turns
      // into a delivered video.
      let completed = null;
      try {
        completed = run.lost ? null : await this._updateIfProcessing(jobId, {
          status: 'completed',
          progress: 100,
          currentStep: 'completed',
          completedAt: new Date(this.now()),
          leaseUntil: null,
          result,
          error: null
        }, owner);
      } catch (err) {
        logger.error(`⚠️ Failed to complete job ${jobId}:`, err.message);
      }
      if (!completed) {
        if (run.lost) this.stats.lostRuns += 1;
        await this._pushLog(jobId, `Finished after the job was cancelled, stopped or handed to another worker: the result was discarded.`);
        return;
      }
      this.stats.completed += 1;
      await this._pushLog(jobId, `Successfully completed job execution [${jobType}]`);

      if (jobType === 'create_video_pipeline' || jobType === 'merge_video') {
        try {
          const Draft = this.draftModel || require('../models/Draft');
          const finalUrl = result?.videoUrl || result?.url || result?.finalVideoUrl || result?.merge?.finalVideoUrl;
          await Draft.updateMany(
            { 'generationProgress.jobId': jobId },
            { 
              $set: { 
                status: 'completed', 
                imageUrl: finalUrl,
                'creative.videoUrl': finalUrl
              } 
            }
          );

          // Remember this generation in the AI Memory system (Layer 1
          // evidence). Fire-and-forget — must never fail the video job.
          //
          // merge_video's payload is flat ({ jobId, userId, effectiveClipUrls,
          // finalAudioUrl, subtitles, baseUrl } — see its enqueue call in
          // routes/videoGeneration.js) with no recoverable textual content:
          // it just combines already-generated clips, so there's nothing new
          // to learn from. Only create_video_pipeline (whose real payload
          // field is `description`, not `script`/`prompt`, and whose result
          // carries per-scene imagePrompt text in `sceneData`) has content
          // worth remembering.
          if (jobDoc.userId && finalUrl && jobType === 'create_video_pipeline') {
            try {
              const { rememberVideoGeneration } = require('./aiMemoryService');
              const rawPayload = jobDoc.payload?.payload || {};
              const sceneData = Array.isArray(result?.sceneData) ? result.sceneData : [];
              rememberVideoGeneration({
                userId: jobDoc.userId,
                jobId,
                action: 'reel_generation',
                prompt: rawPayload.description || '',
                script: rawPayload.description || '',
                hashtags: rawPayload.hashtags || [],
                cta: rawPayload.cta || '',
                sceneData,
                language: rawPayload.languageCode || 'English',
                duration: rawPayload.durationSeconds || null,
                generatedVideos: [finalUrl]
              }).catch((err) => logger.warn('[VideoQueue] AI memory write failed (non-fatal):', err.message));
            } catch (memErr) {
              logger.warn('[VideoQueue] AI memory write failed (non-fatal):', memErr.message);
            }
          }
        } catch (err) {
          logger.error(`⚠️ Failed to update Draft status to completed for job ${jobId}:`, err.message);
        }
      }
    } catch (error) {
      if (error instanceof JobCancelledError) {
        // Cancelled (and refunded) by the user, ended by another path, or this worker lost the job: nothing more to do and
        // nothing to refund here (whoever ended or re-queued the job owns it now).
        if (run.lost) this.stats.lostRuns += 1;
        await this._pushLog(jobId, run.lost ? 'Stopped: this worker no longer holds the job (re-queued, handed back or ended elsewhere).' : 'Stopped: the job was cancelled.');
        return;
      }
      logger.error(`❌ Video job ${jobId} failed:`, error);
      require('./opsAlerts').recordFailure('video', `job ${jobId}: ${error?.message || error}`);
      // NO AUTOMATIC RETRY. Every retry re-runs paid fal.ai generation, so a
      // failure must cost exactly one run. The job is left failed (credits are
      // refunded below) and only the user can retry it, via retryJob().
      // Conditional on still being 'processing', with the refund claimed in the same write: a job the user cancelled
      // (and was refunded) meanwhile is not failed or refunded a second time.
      const won = await this._failIfProcessing(jobDoc, {
        currentStep: 'failed',
        error: {
          message: error?.message || 'Video generation job failed',
          stack: process.env.NODE_ENV === 'development' ? (error?.stack || null) : null
        },
        log: `FAILED: ${error?.message || error}`,
        extraFilter: owner
      });
      if (!won) return;
      this.stats.failed += 1;

      try {
        const Draft = this.draftModel || require('../models/Draft');
        await Draft.updateMany(
          { 'generationProgress.jobId': jobId },
          { $set: { status: 'failed', errorMessage: error?.message || 'Video generation failed' } }
        );
      } catch (err) {
        logger.error(`⚠️ Failed to update Draft status to failed for job ${jobId}:`, err.message);
      }

      // Refund exactly what was charged for this job (metadata.quarkCharge, set by the caller at enqueue time as
      // [{ action, count, ref, payerId }, ...]), each charge with its own ref and to the wallet that paid. See _refundPlan.
      if (jobDoc.userId) await this._refundJob(won, 'failed');
    }
  }

  /**
   * Claims jobs for THIS worker's free slots (E9 stage A): per pool (image, video) at most the pool's slots run here at
   * once, whatever other workers run, so capacity grows with worker tasks. A global ceiling (JOB_GLOBAL_CEILING, one
   * count) stays as a safety net. One drain at a time per process; a trigger during a drain runs one more pass.
   */
  async _drainQueue() {
    if (this.stopping) return 0;
    if (this._draining) { this._drainAgain = true; return this._draining; }
    this._draining = (async () => {
      let started = 0;
      try {
        do {
          this._drainAgain = false;
          started += await this._drainOnce();
        } while (this._drainAgain && !this.stopping);
      } catch (err) {
        logger.error('⚠️ Persistent Queue drain loop failed:', err.message);
      } finally {
        this._draining = null;
      }
      return started;
    })();
    return this._draining;
  }

  _runningIn(pool) {
    let n = 0;
    for (const r of this.running.values()) if (r.pool === pool) n += 1;
    return n;
  }

  async _drainOnce() {
    const s = this.settings;
    let ceilingLeft = Infinity;
    if (s.globalCeiling > 0) {
      const total = await this.model.countDocuments({ status: 'processing' });
      ceilingLeft = s.globalCeiling - total;
      if (ceilingLeft <= 0) return 0;
    }
    let started = 0;
    for (const pool of POOLS) {
      if (this.stopping) break;
      const free = Math.min(s.slots[pool] - this._runningIn(pool), ceilingLeft);
      if (free <= 0) continue;
      const n = await this._claimFair(pool, free);
      started += n;
      ceilingLeft -= n;
      if (ceilingLeft <= 0) break;
    }
    return started;
  }

  /**
   * Running jobs per account (all workers): ONE aggregate over the running rows (at most the global ceiling). Gives both the
   * per-account counts for the fair order and the accounts already at the cap, which are left out of the candidate query.
   */
  async _runningByUser() {
    const counts = new Map(); // String(userId) -> n
    const ids = new Map(); // String(userId) -> userId as stored (an ObjectId in MongoDB)
    const rows = (await this.model.aggregate([
      { $match: { status: 'processing', userId: { $ne: null } } },
      { $group: { _id: '$userId', n: { $sum: 1 } } }
    ])) || [];
    for (const r of rows) { if (r._id == null) continue; counts.set(String(r._id), Number(r.n) || 0); ids.set(String(r._id), r._id); }
    return { counts, ids };
  }

  /**
   * Fair claim for one pool: among the oldest waiting jobs, the account with the fewest running jobs goes first (oldest
   * first on a tie), and an account at JOB_PER_USER_RUNNING is skipped: a simple round-robin by account, so one account
   * with many jobs cannot take every slot. Each claim is one atomic conditional update; a row another worker took (or a
   * job cancelled meanwhile) is simply skipped.
   */
  async _claimFair(pool, free) {
    const poolFilter = pool === 'video' ? { pool: { $in: ['video', null] } } : { pool };
    // Accounts already at the cap are left out of the QUERY (D74 item 7): otherwise 50 older waiting rows of capped
    // accounts fill the whole candidate window and every other account waits behind them.
    const cap = this.settings.perUserRunning;
    const running = await this._runningByUser();
    const capped = cap > 0 ? [...running.counts].filter(([, n]) => n >= cap).map(([k]) => running.ids.get(k)) : [];
    const notCapped = capped.length ? { userId: { $nin: capped } } : {};
    const candidates = (await this.model.find({ status: 'queued', ...poolFilter, ...notCapped })
      .sort({ createdAt: 1 }).limit(CANDIDATES).select({ jobId: 1, userId: 1, createdAt: 1 }).lean()) || [];
    if (!candidates.length) return 0;
    const active = new Map(running.counts); // the counts read above; the post-claim re-count (_overCap) catches races
    const remaining = candidates.slice();
    let started = 0;
    while (started < free && remaining.length && !this.stopping) {
      let best = -1;
      let bestN = Infinity;
      for (let i = 0; i < remaining.length; i += 1) {
        const c = remaining[i];
        const n = c.userId ? (active.get(String(c.userId)) || 0) : 0;
        if (c.userId && n >= cap) continue;
        if (n < bestN) { best = i; bestN = n; } // strict: the oldest wins a tie (candidates are oldest first)
      }
      if (best < 0) break;
      const [c] = remaining.splice(best, 1);
      const claimed = await this._claim(c.jobId, pool);
      if (!claimed) continue;
      // The count above was read before the claim: workers draining at the same moment each saw room. Re-count now
      // that this claim is in; above the cap the job goes back to the queue (D74 item 4) and the account is skipped here.
      if (c.userId && await this._overCap(claimed)) { active.set(String(c.userId), cap); continue; }
      if (c.userId) active.set(String(c.userId), (active.get(String(c.userId)) || 0) + 1);
      started += 1;
      this._start(claimed);
    }
    return started;
  }

  /**
   * After a successful claim: is this account now above JOB_PER_USER_RUNNING (this claim included)? Then hand the job back
   * (queued, no worker, the attempt not counted), only while it is still this worker's claim, and answer true (do not
   * start it). Any database error answers false: the cap is soft, a job is never stranded by a failed hand-back.
   */
  async _overCap(claimed) {
    const cap = this.settings.perUserRunning;
    if (!claimed || !claimed.userId || !(cap > 0)) return false;
    try {
      const n = await this.model.countDocuments({ status: 'processing', userId: claimed.userId });
      if (n <= cap) return false;
      const at = new Date(this.now());
      const back = await this.model.findOneAndUpdate(
        { jobId: claimed.jobId, status: 'processing', workerId: this.workerId, attempts: claimed.attempts },
        { $set: { status: 'queued', workerId: null, leaseUntil: null, updatedAt: at }, $inc: { attempts: -1 } },
        { new: true }
      ).lean();
      if (back) this.stats.capHandBacks += 1;
      return true; // handed back, or no longer ours: either way this worker does not run it
    } catch (err) {
      logger.error(`⚠️ Per-account cap re-count failed for job ${claimed.jobId}:`, err.message);
      return false;
    }
  }

  /** queued -> processing for THIS worker, with a lease; null when another worker took it or it was cancelled meanwhile. */
  async _claim(jobId, pool) {
    const at = this.now();
    return this.model.findOneAndUpdate(
      { jobId, status: 'queued' },
      {
        $set: { status: 'processing', workerId: this.workerId, leaseUntil: new Date(at + this.settings.leaseMs), pool, startedAt: new Date(at), updatedAt: new Date(at) },
        $inc: { attempts: 1 }
      },
      { new: true }
    ).lean();
  }

  _start(job) {
    const doc = typeof job.toObject === 'function' ? job.toObject() : job;
    const runObj = { pool: doc.pool || poolFor(doc.metadata?.jobType), attempt: doc.attempts, lost: false };
    this.running.set(doc.jobId, runObj);
    this.stats.claims += 1;
    // Run the job in the background (non-blocking); when it ends, its slot is free for the next claim.
    this._runJob(doc, runObj)
      .catch((err) => { logger.error(`⚠️ Error launching job ${doc.jobId}:`, err.message); })
      .finally(() => {
        // Only this run's own entry: a worker that re-claimed its own lost job (run 2) replaced the entry, and run 1's
        // late end must not delete run 2's (D74 item 5).
        if (this.running.get(doc.jobId) === runObj) this.running.delete(doc.jobId);
        if (!this.stopping) this._drainQueue().catch(() => null);
      });
  }

  /**
   * Graceful stop (SIGTERM): claim nothing more, wait up to `graceMs` for running jobs, then hand back each job still
   * running here: retry-safe ones go back to 'queued' (the attempt is not counted; at most MAX_RELEASES hand-backs per
   * job), the others are failed and refunded once (the old restart rule, now at once). Each write is conditional on this
   * worker and attempt; the handler of a handed-back job stops at its next step and its result is discarded.
   */
  async shutdown({ graceMs = this.settings.shutdownGraceMs } = {}) {
    this.stopping = true;
    for (const t of [this.workerTimer, this.recoveryTimer, this.gcTimer]) if (t) clearInterval(t);
    this.workerTimer = null; this.recoveryTimer = null; this.gcTimer = null;
    const deadline = this.now() + Math.max(0, graceMs);
    while (this.running.size && this.now() < deadline) await this.sleep(Math.min(250, Math.max(1, deadline - this.now())));
    const finished = this.running.size === 0;
    let released = 0;
    let failed = 0;
    for (const [jobId, run] of [...this.running]) {
      run.lost = true;
      const mine = { jobId, status: 'processing', workerId: this.workerId, ...(Number.isFinite(run.attempt) ? { attempts: run.attempt } : {}) };
      let job = null;
      try { job = await this.model.findOne(mine).lean(); } catch (_) { job = null; }
      if (!job) continue;
      const at = new Date(this.now());
      if (this._retrySafe(job) && (Number(job.releases) || 0) < MAX_RELEASES) {
        let back = null;
        try {
          back = await this.model.findOneAndUpdate(mine, {
            $set: { status: 'queued', workerId: null, leaseUntil: null, currentStep: 'retrying', updatedAt: at },
            $inc: { attempts: -1, releases: 1 },
            $push: { logs: { $each: [`[${at.toISOString()}] The server running this job is stopping: handed back to the queue (nothing is charged again).`], $slice: -200 } }
          }, { new: true }).lean();
        } catch (err) { logger.error(`⚠️ Failed to hand back job ${jobId}:`, err.message); }
        if (back) { released += 1; this.stats.released += 1; }
      } else {
        const won = await this._failIfProcessing(job, {
          currentStep: 'stale_recovery_failed',
          error: { message: 'The server restarted while this job was running. Press Retry to try again.', stack: null },
          log: 'The server stopped while this job was running. Marked failed — retries are manual only.',
          extraFilter: { workerId: this.workerId, ...(Number.isFinite(run.attempt) ? { attempts: run.attempt } : {}) }
        });
        if (won) {
          failed += 1;
          await this._markDraftFailed(jobId, 'This video stopped. Please try again.');
          await this._refundJob(won, 'was interrupted by a server restart');
        }
      }
    }
    if (released || failed) logger.info(`Persistent Queue: shutdown handed back ${released} job(s), failed and refunded ${failed}.`);
    return { finished, released, failed };
  }

  /** Numbers for the staff queue metrics (bounded: two aggregates over the open rows, one small find). */
  async metrics() {
    const now = this.now();
    const byType = {};
    const byPool = { image: { queued: 0, running: 0 }, video: { queued: 0, running: 0 } };
    const rows = (await this.model.aggregate([
      { $match: { status: { $in: ['queued', 'processing'] } } },
      { $group: { _id: { type: '$metadata.jobType', pool: '$pool', status: '$status' }, n: { $sum: 1 }, oldest: { $min: '$createdAt' } } }
    ])) || [];
    let oldestQueued = null;
    for (const r of rows) {
      const type = String(r._id?.type || 'unknown');
      const pool = r._id?.pool === 'image' ? 'image' : 'video';
      const key = r._id?.status === 'queued' ? 'queued' : 'running';
      byType[type] = byType[type] || { queued: 0, running: 0 };
      byType[type][key] += Number(r.n) || 0;
      byPool[pool][key] += Number(r.n) || 0;
      if (key === 'queued' && r.oldest && (!oldestQueued || new Date(r.oldest) < oldestQueued)) oldestQueued = new Date(r.oldest);
    }
    const workers = (await this.model.aggregate([
      { $match: { status: 'processing' } },
      { $group: { _id: '$workerId', n: { $sum: 1 } } }
    ])) || [];
    const runningByWorker = {};
    for (const w of workers) runningByWorker[String(w._id || 'older code')] = Number(w.n) || 0;
    const local = { image: this._runningIn('image'), video: this._runningIn('video') };
    return {
      queueDepth: byPool.image.queued + byPool.video.queued,
      running: byPool.image.running + byPool.video.running,
      oldestQueuedAgeSeconds: oldestQueued ? Math.max(0, Math.round((now - oldestQueued.getTime()) / 1000)) : 0,
      byType,
      byPool,
      runningByWorker,
      thisWorker: {
        workerId: this.workerId,
        consumers: this.runsJobsHere,
        stopping: this.stopping,
        slots: { ...this.settings.slots, cpu: this.settings.cpu },
        slotsInUse: local,
        ...this.stats
      }
    };
  }

  _publicView(job) {
    if (!job) return null;
    return {
      jobId: job.jobId,
      userId: job.userId,
      status: job.status,
      progress: job.progress,
      currentStep: job.currentStep,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      result: job.result,
      error: job.status === 'failed'
        ? { message: publicErrorMessage(job), stack: null }
        : null,
      logs: Array.isArray(job.logs) ? job.logs.slice(-80).map(sanitizeLogLine).filter(Boolean) : [],
      metadata: {
        ...(job.metadata || {}),
        publicStep: publicStepMessage(job.currentStep),
        estimatedCompletionSeconds: estimateRemainingSeconds(job)
      }
    };
  }
}

const videoGenerationQueue = new PersistentVideoGenerationQueue();

module.exports = {
  PersistentVideoGenerationQueue,
  JobCancelledError,
  videoGenerationQueue,
  poolFor,
  RETRY_SAFE_TYPES,
  MAX_RELEASES
};
