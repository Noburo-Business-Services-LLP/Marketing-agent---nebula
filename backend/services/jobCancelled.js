'use strict';
// Thrown inside a job's handler when the job was cancelled, ended by another path, or its worker lost the claim. The queue
// treats it as "stop quietly" (nothing to refund here: whoever ended the job owns the refund). Own file so the pipeline
// can use it without requiring the queue.
class JobCancelledError extends Error {
  constructor(jobId) { super(`Job ${jobId} is no longer running.`); this.name = 'JobCancelledError'; this.jobId = jobId; }
}

module.exports = { JobCancelledError };
