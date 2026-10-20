'use strict';
/**
 * SIGTERM for job consumers (E9 stage A): both generation queues stop claiming at once, running jobs get up to
 * JOB_SHUTDOWN_GRACE_MS (config/jobSlots.js) to finish, then the video queue hands back what is still running (retry-safe
 * jobs to 'queued', the others failed and refunded once). Campaign image jobs are only waited for: a picture still
 * running when the process ends is failed by another runner's lost-job sweep (nothing is charged before delivery).
 * A process that runs no consumers resolves at once.
 */
async function stopJobConsumers({ env = process.env, video, image, graceMs } = {}) {
  if (!require('./backgroundRole').runsJobConsumers(env)) return { skipped: true };
  const grace = Number.isFinite(graceMs) ? graceMs : require('../config/jobSlots').jobSlots().shutdownGraceMs;
  const v = video || require('./videoGenerationQueue').videoGenerationQueue;
  const i = image || require('./imageJobQueue').imageJobQueue();
  const [videoResult, imageResult] = await Promise.all([
    v.shutdown({ graceMs: grace }).catch((e) => ({ error: e && e.message })),
    i.shutdown({ graceMs: grace }).catch((e) => ({ error: e && e.message }))
  ]);
  return { video: videoResult, image: imageResult };
}

module.exports = { stopJobConsumers };
