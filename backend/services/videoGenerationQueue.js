const crypto = require('crypto');
const logger = require('../utils/logger');
const VideoJob = require('../models/VideoJob');
const { settleRefund, SWEEP_AFTER_MS } = require('./refundSettle');
const { QUARK_COSTS } = require('../config/apiCosts');

const DEFAULT_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.VIDEO_QUEUE_CONCURRENCY || '2', 10) || 2
);
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
class JobCancelledError extends Error {
  constructor(jobId) { super(`Job ${jobId} is no longer running.`); this.name = 'JobCancelledError'; this.jobId = jobId; }
}

class PersistentVideoGenerationQueue {
  constructor({ concurrency = DEFAULT_CONCURRENCY, jobTtlMs = DEFAULT_JOB_TTL_MS, model, draftModel, refund, chargeProof, alertOwner, runsJobsHere } = {}) {
    // A web-only task (RUN_BACKGROUND=0) only stores the job; the worker's drain loop claims it (atomic queued ->
    // processing). Everywhere else enqueue starts the drain at once, as before.
    this.runsJobsHere = typeof runsJobsHere === 'boolean' ? runsJobsHere : require('./backgroundRole').runsBackground();
    this.draftModel = draftModel || null;
    // Injectable for tests; the real ones load on first use.
    this.model = model || VideoJob;
    this.refund = refund || ((...a) => require('../middleware/trialGuard').refundCredits(...a));
    this.chargeProof = chargeProof || ((...a) => require('./quarkBuckets').chargeProof(...a));
    this.alertOwner = alertOwner || ((a) => require('./opsAlerts').notify(a));
    this.concurrency = concurrency;
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
    logger.info(`🚀 Persistent Queue: Background worker successfully started (concurrency = ${this.concurrency})`);

    // Run crash recovery on startup (non-blocking, safe for rolling updates)
    this.recoverInterruptedJobsOnStartup().catch((err) => {
      logger.error('Persistent Queue startup interrupted-job recovery error:', err.message);
    });
    this.recoverStaleJobs().catch((err) => {
      logger.error('⚠️ Persistent Queue startup recovery error:', err.message);
    });
  }

  async recoverInterruptedJobsOnStartup() {
    if (String(process.env.VIDEO_JOB_RECOVER_PROCESSING_ON_STARTUP || 'true').toLowerCase() === 'false') return;

    const processingJobs = await this.model.find({ status: 'processing' });
    if (!processingJobs.length) return;

    // NEVER re-queue on startup. Every restart and every redeploy used to
    // re-run whatever was mid-flight, silently spending fal.ai credits with
    // nobody asking for it. Mark them failed instead — the user decides.
    logger.info(`Persistent Queue: Marking ${processingJobs.length} interrupted job(s) failed after startup (no auto-retry).`);
    for (const job of processingJobs) {
      const won = await this._failIfProcessing(job, {
        currentStep: 'stale_recovery_failed',
        error: { message: 'The server restarted while this job was running. Press Retry to try again.', stack: null },
        log: 'App restarted while job was processing. Marked failed — retries are manual only.'
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
   * charged each scene itself (and refunds that scene itself), so it has nothing to refund here. A job with no charge
   * record at all gets the old flat guess (legacy), under its own ref.
   */
  _refundPlan(job = {}) {
    if (!job || !job.userId) return [];
    const charges = job.metadata?.quarkCharge;
    if (Array.isArray(charges) && charges.length) {
      return charges.map((c, i) => ({ action: c.action, count: c.count, ref: String(c.ref || `${job.jobId}:${i}`), payerId: c.payerId ? String(c.payerId) : '' }));
    }
    if (job.metadata?.perSceneCharging) return [];
    return [{ action: 'campaign_full', count: 1, ref: `${job.jobId}:legacy`, payerId: '' }];
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

  _startRecoveryTimer() {
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
    this.recoveryTimer = setInterval(async () => {
      try {
        await this.recoverStaleJobs();
        await this.sweepRefunds();
      } catch (err) {
        logger.error('⚠️ Persistent Queue stale job recovery loop failed:', err.message);
      }
    }, 60000); // Scan every 1 minute
    this.recoveryTimer.unref?.();
  }

  /**
   * Periodically scans for processing jobs that have hung or crashed (no updates for 5 minutes)
   */
  async recoverStaleJobs() {
    const STALE_TIMEOUT_MS = Number(process.env.VIDEO_JOB_STALE_TIMEOUT_MS) || (5 * 60 * 1000); // Default 5 minutes
    const threshold = new Date(Date.now() - STALE_TIMEOUT_MS);

    try {
      // Find all processing jobs that haven't been updated since threshold
      const staleJobs = await this.model.find({
        status: 'processing',
        updatedAt: { $lt: threshold }
      });

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
          extraFilter: { updatedAt: { $lt: threshold } }
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
    if (this.runsJobsHere) {
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

  /** Writes `patch` only while the job is still 'processing'. Returns the job, null when it is not, and throws on a database error. */
  async _updateIfProcessing(jobId, patch = {}) {
    return this.model.findOneAndUpdate({ jobId, status: 'processing' }, { $set: { ...patch, updatedAt: new Date() } }, { new: true }).lean();
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

  async _runJob(jobDoc) {
    const { jobId, metadata } = jobDoc;
    const jobType = metadata?.jobType;
    const handler = this.handlers.get(jobType);

    if (!handler) {
      logger.error(`❌ No handler registered for job type [${jobType}]. Job ${jobId} failed.`);
      const won = await this._failIfProcessing(jobDoc, {
        currentStep: 'missing_handler',
        error: { message: `No handler registered for job type [${jobType}]` },
        log: `No handler registered for job type [${jobType}]`
      });
      if (won) await this._refundJob(won, 'could not start');
      return;
    }

    try {
      await this._pushLog(jobId, `Starting job execution [${jobType}]`);
      const heartbeatTimer = setInterval(() => {
        // Only while processing, and only the heartbeat key: never over step metadata or a cancelled job.
        this._updateIfProcessing(jobId, { 'metadata.heartbeatAt': new Date().toISOString() }).catch(() => {});
      }, 30000);
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
          // Between steps: a job that was cancelled (or ended by another path) stops here instead of going on.
          const current = await this.model.findOne({ jobId }).lean();
          if (current && current.status !== 'processing') throw new JobCancelledError(jobId);
          if (stepMetadata && typeof stepMetadata === 'object') {
            // Merge nested metadata objects
            patch.metadata = { ...(current?.metadata || {}), ...stepMetadata };
          }
          let wrote = null;
          try { wrote = await this._updateIfProcessing(jobId, patch); } catch (err) { logger.error(`⚠️ Failed to update job ${jobId}:`, err.message); return; }
          if (!wrote) throw new JobCancelledError(jobId);
        },
        isCancelled: async () => {
          const current = await this.model.findOne({ jobId }).lean();
          return Boolean(current && current.status !== 'processing');
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
        completed = await this._updateIfProcessing(jobId, {
          status: 'completed',
          progress: 100,
          currentStep: 'completed',
          completedAt: new Date(),
          result,
          error: null
        });
      } catch (err) {
        logger.error(`⚠️ Failed to complete job ${jobId}:`, err.message);
      }
      if (!completed) {
        await this._pushLog(jobId, `Finished after the job was cancelled or stopped: the result was discarded.`);
        return;
      }
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
        // Cancelled (and refunded) by the user, or ended by another path: nothing more to do and nothing to refund here.
        await this._pushLog(jobId, 'Stopped: the job was cancelled.');
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
        log: `FAILED: ${error?.message || error}`
      });
      if (!won) return;

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

  async _drainQueue() {
    try {
      // Find count of currently processing jobs in database
      const activeCount = await this.model.countDocuments({ status: 'processing' });
      if (activeCount >= this.concurrency) return;

      const capacity = this.concurrency - activeCount;
      
      // Fetch and lock jobs using findOneAndUpdate to ensure thread safety
      for (let i = 0; i < capacity; i++) {
        const nextJob = await this.model.findOneAndUpdate(
          { status: 'queued' },
          { 
            $set: { 
              status: 'processing',
              startedAt: new Date(),
              updatedAt: new Date()
            },
            $inc: { attempts: 1 }
          },
          { sort: { createdAt: 1 }, new: true }
        );

        if (!nextJob) break; // No more queued jobs

        // Run the job in the background (non-blocking)
        this._runJob(nextJob.toObject()).catch((err) => {
          logger.error(`⚠️ Error launching job ${nextJob.jobId}:`, err.message);
        });
      }
    } catch (err) {
      logger.error('⚠️ Persistent Queue drain loop failed:', err.message);
    }
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
  videoGenerationQueue
};
