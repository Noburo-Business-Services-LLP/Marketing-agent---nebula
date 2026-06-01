const crypto = require('crypto');
const VideoJob = require('../models/VideoJob');

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

class PersistentVideoGenerationQueue {
  constructor({ concurrency = DEFAULT_CONCURRENCY, jobTtlMs = DEFAULT_JOB_TTL_MS } = {}) {
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
    console.log(`🤖 Persistent Queue: Registered handler for job type [${jobType}]`);
  }

  /**
   * Starts the background queue worker and GC/recovery loops
   */
  startWorker() {
    this._startGcTimer();
    this._startRecoveryTimer();
    
    if (this.workerTimer) clearInterval(this.workerTimer);
    
    // Poll the database for queued jobs every 2 seconds
    this.workerTimer = setInterval(() => {
      this._drainQueue().catch((err) => {
        console.error('⚠️ Persistent Queue drain error:', err.message);
      });
    }, 2000);
    
    this.workerTimer.unref?.();
    console.log(`🚀 Persistent Queue: Background worker successfully started (concurrency = ${this.concurrency})`);

    // Run crash recovery on startup (non-blocking, safe for rolling updates)
    this.recoverInterruptedJobsOnStartup().catch((err) => {
      console.error('Persistent Queue startup interrupted-job recovery error:', err.message);
    });
    this.recoverStaleJobs().catch((err) => {
      console.error('⚠️ Persistent Queue startup recovery error:', err.message);
    });
  }

  async recoverInterruptedJobsOnStartup() {
    if (String(process.env.VIDEO_JOB_RECOVER_PROCESSING_ON_STARTUP || 'true').toLowerCase() === 'false') return;

    const processingJobs = await VideoJob.find({ status: 'processing' });
    if (!processingJobs.length) return;

    console.log(`Persistent Queue: Re-queueing ${processingJobs.length} interrupted processing job(s) after startup.`);
    for (const job of processingJobs) {
      const maxAttempts = Number(process.env.VIDEO_JOB_MAX_ATTEMPTS || '3');
      if ((Number(job.attempts) || 0) >= maxAttempts) {
        await VideoJob.updateOne(
          { jobId: job.jobId },
          {
            $set: {
              status: 'failed',
              currentStep: 'stale_recovery_failed',
              completedAt: new Date(),
              updatedAt: new Date(),
              error: { message: `Job interrupted and exceeded maximum attempts (${maxAttempts}).`, stack: null }
            }
          }
        );
        continue;
      }

      await VideoJob.updateOne(
        { jobId: job.jobId },
        {
          $set: {
            status: 'queued',
            currentStep: 'stale_recovery_retry',
            updatedAt: new Date()
          },
          $push: {
            logs: `[${new Date().toISOString()}] App restarted while job was processing. Re-queued automatically.`
          }
        }
      );
    }
  }

  _startRecoveryTimer() {
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
    this.recoveryTimer = setInterval(async () => {
      try {
        await this.recoverStaleJobs();
      } catch (err) {
        console.error('⚠️ Persistent Queue stale job recovery loop failed:', err.message);
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
      const staleJobs = await VideoJob.find({
        status: 'processing',
        updatedAt: { $lt: threshold }
      });

      if (staleJobs.length === 0) return;

      console.log(`⚠️ Persistent Queue: Found ${staleJobs.length} stale/hung jobs in 'processing' state.`);
      
      for (const job of staleJobs) {
        const maxAttempts = Number(process.env.VIDEO_JOB_MAX_ATTEMPTS || '3');
        if (job.attempts < maxAttempts) {
          console.log(`🔄 Resetting stale job ${job.jobId} to 'queued' (Attempts: ${job.attempts}/${maxAttempts})`);
          await VideoJob.updateOne(
            { jobId: job.jobId },
            {
              $set: {
                status: 'queued',
                currentStep: 'stale_recovery_retry',
                updatedAt: new Date()
              },
              $push: {
                logs: `[${new Date().toISOString()}] Job detected as stale/hung (no updates for ${Math.round(STALE_TIMEOUT_MS / 60000)}m). Automatically resetting to queued for retry.`
              }
            }
          );
        } else {
          console.log(`❌ Stale job ${job.jobId} exceeded max attempts (${job.attempts}/${maxAttempts}). Marking as failed.`);
          await VideoJob.updateOne(
            { jobId: job.jobId },
            {
              $set: {
                status: 'failed',
                currentStep: 'stale_recovery_failed',
                completedAt: new Date(),
                updatedAt: new Date(),
                error: {
                  message: `Job timed out and exceeded maximum recovery attempts (${maxAttempts}).`,
                  stack: null
                }
              },
              $push: {
                logs: `[${new Date().toISOString()}] Job detected as stale/hung (no updates for ${Math.round(STALE_TIMEOUT_MS / 60000)}m). Exceeded max attempts (${maxAttempts}). Marking as failed.`
              }
            }
          );

          // Refund credits to user on stale failure
          if (job.userId) {
            try {
              const { refundCredits } = require('../middleware/trialGuard');
              await refundCredits(
                job.userId,
                'campaign_full',
                1,
                `Refund: Stale AI video generation job ${job.jobId} failed`
              );
            } catch (refundError) {
              console.error(`⚠️ Failed to refund credits for stale job ${job.jobId}:`, refundError.message);
            }
          }
        }
      }
    } catch (err) {
      console.error('⚠️ Failed to recover stale jobs:', err.message);
    }
  }

  _startGcTimer() {
    if (this.gcTimer) clearInterval(this.gcTimer);
    this.gcTimer = setInterval(async () => {
      try {
        const threshold = new Date(Date.now() - this.jobTtlMs);
        const res = await VideoJob.deleteMany({ updatedAt: { $lt: threshold } });
        if (res.deletedCount > 0) {
          console.log(`🧹 Persistent Queue GC: Deleted ${res.deletedCount} stale jobs updated before ${threshold.toISOString()}`);
        }
      } catch (err) {
        console.error('⚠️ Persistent Queue GC failed:', err.message);
      }
    }, 10 * 60 * 1000); // GC every 10 minutes
    this.gcTimer.unref?.();
  }

  /**
   * Enqueues a new background job into MongoDB
   */
  async enqueue({ userId = null, jobType, payload = {} }) {
    if (!jobType) {
      throw new Error('jobType is required to enqueue');
    }
    if (!this.handlers.has(jobType)) {
      console.warn(`⚠️ Enqueuing job type [${jobType}] before its handler is registered.`);
    }

    const jobId = crypto.randomUUID();

    const job = await VideoJob.create({
      jobId,
      userId: userId ? userId : null,
      status: 'queued',
      progress: 0,
      currentStep: 'queued',
      payload,
      attempts: 0,
      metadata: { jobType }
    });

    // Proactively trigger the drain loop
    this._drainQueue().catch((err) => {
      console.error('⚠️ Persistent Queue drain trigger error:', err.message);
    });

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
      const job = await VideoJob.findOne(query).lean();
      if (!job) return null;
      return this._publicView(job);
    } catch (err) {
      console.error(`⚠️ Failed to get job ${jobId}:`, err.message);
      return null;
    }
  }

  async _updateJob(jobId, patch = {}) {
    try {
      const job = await VideoJob.findOneAndUpdate(
        { jobId },
        { $set: { ...patch, updatedAt: new Date() } },
        { new: true }
      ).lean();
      return job;
    } catch (err) {
      console.error(`⚠️ Failed to update job ${jobId}:`, err.message);
      return null;
    }
  }

  async _pushLog(jobId, message) {
    try {
      const line = `[${new Date().toISOString()}] ${String(message || '').trim()}`;
      
      // Update with an atomic array push, while limiting log length to 200 items in Mongoose
      await VideoJob.updateOne(
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
      console.error(`⚠️ Failed to push log to job ${jobId}:`, err.message);
    }
  }

  async _runJob(jobDoc) {
    const { jobId, metadata } = jobDoc;
    const jobType = metadata?.jobType;
    const handler = this.handlers.get(jobType);

    if (!handler) {
      console.error(`❌ No handler registered for job type [${jobType}]. Job ${jobId} failed.`);
      await this._updateJob(jobId, {
        status: 'failed',
        currentStep: 'missing_handler',
        completedAt: new Date(),
        error: { message: `No handler registered for job type [${jobType}]` }
      });
      return;
    }

    try {
      await this._pushLog(jobId, `Starting job execution [${jobType}]`);
      const heartbeatTimer = setInterval(() => {
        this._updateJob(jobId, {
          metadata: {
            ...(jobDoc.metadata || {}),
            heartbeatAt: new Date().toISOString()
          }
        }).catch(() => {});
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
          if (stepMetadata && typeof stepMetadata === 'object') {
            // Read current job to merge metadata nested objects
            const current = await VideoJob.findOne({ jobId }).lean();
            patch.metadata = { ...(current?.metadata || {}), ...stepMetadata };
          }
          await this._updateJob(jobId, patch);
        },
        log: async (message) => await this._pushLog(jobId, message)
      };

      let result;
      try {
        result = await handler(jobDoc.payload, controls);
      } finally {
        clearInterval(heartbeatTimer);
      }

      await this._updateJob(jobId, {
        status: 'completed',
        progress: 100,
        currentStep: 'completed',
        completedAt: new Date(),
        result,
        error: null
      });
      await this._pushLog(jobId, `Successfully completed job execution [${jobType}]`);
    } catch (error) {
      console.error(`❌ Video job ${jobId} failed:`, error);
      const maxAttempts = Number(process.env.VIDEO_JOB_MAX_ATTEMPTS || '3');
      if ((Number(jobDoc.attempts) || 0) < maxAttempts) {
        await this._updateJob(jobId, {
          status: 'queued',
          currentStep: 'retrying',
          error: {
            message: error?.message || 'Video generation job failed',
            stack: null
          }
        });
        await this._pushLog(jobId, `Retrying failed job automatically (${jobDoc.attempts}/${maxAttempts})`);
        return;
      }

      await this._updateJob(jobId, {
        status: 'failed',
        currentStep: 'failed',
        completedAt: new Date(),
        error: {
          message: error?.message || 'Video generation job failed',
          stack: process.env.NODE_ENV === 'development' ? (error?.stack || null) : null
        }
      });
      await this._pushLog(jobId, `FAILED: ${error?.message || error}`);

      // Refund credits to user on job failure
      if (jobDoc.userId) {
        try {
          const { refundCredits } = require('../middleware/trialGuard');
          const refundResult = await refundCredits(
            jobDoc.userId,
            'campaign_full',
            1,
            `Refund: AI video generation job ${jobId} failed`
          );
          if (refundResult.success) {
            await this._pushLog(jobId, `Credits automatically refunded (Balance: ${refundResult.creditsRemaining})`);
          }
        } catch (refundError) {
          console.error(`⚠️ Failed to refund credits for job ${jobId}:`, refundError.message);
        }
      }
    }
  }

  async _drainQueue() {
    try {
      // Find count of currently processing jobs in database
      const activeCount = await VideoJob.countDocuments({ status: 'processing' });
      if (activeCount >= this.concurrency) return;

      const capacity = this.concurrency - activeCount;
      
      // Fetch and lock jobs using findOneAndUpdate to ensure thread safety
      for (let i = 0; i < capacity; i++) {
        const nextJob = await VideoJob.findOneAndUpdate(
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
          console.error(`⚠️ Error launching job ${nextJob.jobId}:`, err.message);
        });
      }
    } catch (err) {
      console.error('⚠️ Persistent Queue drain loop failed:', err.message);
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
        ? { message: publicStepMessage(job.currentStep), stack: null }
        : null,
      logs: [],
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
  videoGenerationQueue
};
