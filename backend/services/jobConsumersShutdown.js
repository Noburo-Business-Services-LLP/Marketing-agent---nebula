'use strict';
/**
 * SIGTERM for job consumers (E9 stage A): both generation queues stop claiming at once, running jobs get up to
 * JOB_SHUTDOWN_GRACE_MS (config/jobSlots.js) to finish, then the video queue hands back what is still running (retry-safe
 * jobs to 'queued', the others failed and refunded once). Campaign image jobs are only waited for: a picture still
 * running when the process ends is failed by another runner's lost-job sweep (nothing is charged before delivery).
 * A process that runs no consumers resolves at once.
 */
async function stopJobConsumers({ env = process.env, video, image, studio, photoshoot, graceMs } = {}) {
  if (!require('./backgroundRole').runsJobConsumers(env)) return { skipped: true };
  const grace = Number.isFinite(graceMs) ? graceMs : require('../config/jobSlots').jobSlots().shutdownGraceMs;
  const v = video || require('./videoGenerationQueue').videoGenerationQueue;
  const i = image || require('./imageJobQueue').imageJobQueue();
  // Videos (Omni) consumer (E9 B1): hands back what still runs (resumable); skipped when it was never started.
  const st = studio || require('./studioVideoConsumer').studioVideoConsumer;
  // Photoshoot consumer (E9 B2): every run stops before its next batch, then what is still held is handed back.
  const ps = photoshoot || require('./photoshootConsumer').photoshootConsumer;
  const [videoResult, imageResult, studioResult, photoshootResult] = await Promise.all([
    v.shutdown({ graceMs: grace }).catch((e) => ({ error: e && e.message })),
    i.shutdown({ graceMs: grace }).catch((e) => ({ error: e && e.message })),
    st.shutdown({ graceMs: grace }).catch((e) => ({ error: e && e.message })),
    ps.shutdown({ graceMs: grace }).catch((e) => ({ error: e && e.message }))
  ]);
  return { video: videoResult, image: imageResult, studio: studioResult, photoshoot: photoshootResult };
}

module.exports = { stopJobConsumers };
