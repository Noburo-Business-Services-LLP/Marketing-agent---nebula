const crypto = require('crypto');

const DEFAULT_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.VIDEO_QUEUE_CONCURRENCY || '2', 10) || 2
);
const DEFAULT_JOB_TTL_MS = Math.max(
  10 * 60 * 1000,
  Number.parseInt(process.env.VIDEO_JOB_TTL_MS || String(6 * 60 * 60 * 1000), 10) || (6 * 60 * 60 * 1000)
);

class InMemoryVideoGenerationQueue {
  constructor({ concurrency = DEFAULT_CONCURRENCY, jobTtlMs = DEFAULT_JOB_TTL_MS } = {}) {
    this.concurrency = concurrency;
    this.jobTtlMs = jobTtlMs;
    this.jobs = new Map();
    this.pending = [];
    this.activeCount = 0;
    this.gcTimer = null;
    this._startGcTimer();
  }

  _startGcTimer() {
    if (this.gcTimer) clearInterval(this.gcTimer);
    this.gcTimer = setInterval(() => {
      const now = Date.now();
      for (const [jobId, job] of this.jobs.entries()) {
        const updatedAt = new Date(job.updatedAt).getTime();
        if (Number.isFinite(updatedAt) && (now - updatedAt) > this.jobTtlMs) {
          this.jobs.delete(jobId);
        }
      }
    }, 5 * 60 * 1000);
    this.gcTimer.unref?.();
  }

  enqueue({ userId = null, payload = {}, handler }) {
    if (typeof handler !== 'function') {
      throw new Error('Queue handler is required');
    }

    const jobId = crypto.randomUUID();
    const nowIso = new Date().toISOString();

    const job = {
      jobId,
      userId: userId ? String(userId) : null,
      status: 'queued',
      progress: 0,
      currentStep: 'queued',
      createdAt: nowIso,
      updatedAt: nowIso,
      startedAt: null,
      completedAt: null,
      payload,
      result: null,
      error: null,
      logs: [],
      attempts: 0
    };

    this.jobs.set(jobId, job);
    this.pending.push({ jobId, handler });
    this._drainQueue();

    return this._publicView(job);
  }

  getJob(jobId, userId = null) {
    const job = this.jobs.get(String(jobId || ''));
    if (!job) return null;
    if (userId && job.userId && String(userId) !== job.userId) return null;
    return this._publicView(job);
  }

  _updateJob(jobId, patch = {}) {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
    return job;
  }

  _pushLog(jobId, message) {
    const job = this.jobs.get(jobId);
    if (!job) return;
    const line = `[${new Date().toISOString()}] ${String(message || '').trim()}`;
    job.logs = Array.isArray(job.logs) ? job.logs : [];
    job.logs.push(line);
    if (job.logs.length > 200) {
      job.logs = job.logs.slice(job.logs.length - 200);
    }
    job.updatedAt = new Date().toISOString();
  }

  async _runJob(task) {
    const { jobId, handler } = task;
    const current = this.jobs.get(jobId);
    if (!current) return;

    this.activeCount += 1;
    this._updateJob(jobId, {
      status: 'processing',
      startedAt: new Date().toISOString(),
      attempts: (current.attempts || 0) + 1
    });

    const controls = {
      update: ({ progress, currentStep, metadata } = {}) => {
        const patch = {};
        if (Number.isFinite(progress)) {
          patch.progress = Math.max(0, Math.min(100, Number(progress)));
        }
        if (typeof currentStep === 'string' && currentStep.trim()) {
          patch.currentStep = currentStep.trim();
        }
        if (metadata && typeof metadata === 'object') {
          patch.metadata = { ...(current.metadata || {}), ...metadata };
        }
        this._updateJob(jobId, patch);
      },
      log: (message) => this._pushLog(jobId, message)
    };

    try {
      const result = await handler(controls);
      this._updateJob(jobId, {
        status: 'completed',
        progress: 100,
        currentStep: 'completed',
        completedAt: new Date().toISOString(),
        result,
        error: null
      });
    } catch (error) {
      this._updateJob(jobId, {
        status: 'failed',
        currentStep: 'failed',
        completedAt: new Date().toISOString(),
        error: {
          message: error?.message || 'Video generation job failed',
          stack: process.env.NODE_ENV === 'development' ? (error?.stack || null) : null
        }
      });
      this._pushLog(jobId, `FAILED: ${error?.message || error}`);
    } finally {
      this.activeCount = Math.max(0, this.activeCount - 1);
      this._drainQueue();
    }
  }

  _drainQueue() {
    while (this.activeCount < this.concurrency && this.pending.length > 0) {
      const nextTask = this.pending.shift();
      this._runJob(nextTask);
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

const videoGenerationQueue = new InMemoryVideoGenerationQueue();

module.exports = {
  InMemoryVideoGenerationQueue,
  videoGenerationQueue
};
