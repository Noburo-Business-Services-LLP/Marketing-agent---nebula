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

class PersistentVideoGenerationQueue {
  constructor({ concurrency = DEFAULT_CONCURRENCY, jobTtlMs = DEFAULT_JOB_TTL_MS } = {}) {
    this.concurrency = concurrency;
    this.jobTtlMs = jobTtlMs;
    this.handlers = new Map();
    this.workerTimer = null;
    this.gcTimer = null;
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
   * Starts the background queue worker and GC loops
   */
  startWorker() {
    this._startGcTimer();
    
    if (this.workerTimer) clearInterval(this.workerTimer);
    
    // Poll the database for queued jobs every 2 seconds
    this.workerTimer = setInterval(() => {
      this._drainQueue().catch((err) => {
        console.error('⚠️ Persistent Queue drain error:', err.message);
      });
    }, 2000);
    
    this.workerTimer.unref?.();
    console.log(`🚀 Persistent Queue: Background worker successfully started (concurrency = ${this.concurrency})`);

    // Run crash recovery on startup (non-blocking)
    this.recoverInterruptedJobs().catch((err) => {
      console.error('⚠️ Persistent Queue recovery error:', err.message);
    });
  }

  /**
   * Resumes jobs that were interrupted by a server restart/crash
   */
  async recoverInterruptedJobs() {
    try {
      const interrupted = await VideoJob.find({ status: 'processing' });
      if (interrupted.length === 0) return;

      console.log(`🔄 Persistent Queue: Found ${interrupted.length} interrupted jobs in 'processing' state.`);
      
      // Reset all 'processing' jobs to 'queued' so they are picked up again
      const result = await VideoJob.updateMany(
        { status: 'processing' },
        { 
          $set: { 
            status: 'queued', 
            currentStep: 'interrupted_restart'
          },
          $push: { 
            logs: `[${new Date().toISOString()}] Server restarted. Interrupted job automatically queued for recovery.` 
          }
        }
      );
      
      console.log(`✅ Persistent Queue: Successfully recovered and re-queued ${result.modifiedCount} jobs.`);
    } catch (err) {
      console.error('⚠️ Failed to recover interrupted jobs:', err.message);
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

      const result = await handler(jobDoc.payload, controls);

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
      error: job.error,
      logs: job.logs,
      metadata: job.metadata || null
    };
  }
}

const videoGenerationQueue = new PersistentVideoGenerationQueue();

module.exports = {
  PersistentVideoGenerationQueue,
  videoGenerationQueue
};
