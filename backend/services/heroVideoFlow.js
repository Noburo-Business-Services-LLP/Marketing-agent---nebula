/**
 * Hero video start/poll flow: monthly quota, Quark charge, fal submit, refund-once.
 * All I/O comes in through `deps` so tests inject fakes; defaultDeps() lazy-requires the
 * real model/services so this module imports without Mongo or FAL_KEY.
 *
 * Money rules: a Quark is deducted before the job exists, and refunded at most once per
 * job (atomic guard on metadata.refunded) on every failure path. The user's prompt is
 * never logged.
 */
const crypto = require('crypto');

const MAX_PROMPT_CHARS = 6000;
const ASPECTS = ['9:16', '16:9', '1:1'];
const ACTION = 'hero_video_clip';
const TERMINAL = ['completed', 'failed', 'cancelled'];

function defaultDeps() {
  const VideoJob = require('../models/VideoJob');
  const hero = require('./heroVideoService');
  const { deductCredits, refundCredits } = require('../middleware/trialGuard');
  return {
    JobModel: VideoJob,
    quotaFn: (userId, now) => hero.getHeroQuota(userId, now, VideoJob),
    deduct: deductCredits,
    refund: refundCredits,
    submit: hero.submitHeroClip,
    getStatus: hero.getHeroClipStatus,
    copyToStorage: hero.copyClipToStorage,
    now: () => new Date()
  };
}

const bad = (message) => ({ status: 400, json: { success: false, message } });

// Refund at most once per job. The flag is claimed atomically BEFORE refunding; if the
// refund itself fails the claim is released so a later poll can retry.
async function refundOnce(deps, jobId, userId, desc) {
  const claimed = await deps.JobModel.findOneAndUpdate(
    { jobId, 'metadata.refunded': { $ne: true } },
    { $set: { 'metadata.refunded': true } }
  );
  if (!claimed) return false;
  try {
    const res = await deps.refund(userId, ACTION, 1, desc);
    if (res && res.success === false) throw new Error(res.error || 'refund returned success:false');
    return true;
  } catch (err) {
    console.error(`Hero refund failed for job ${jobId}:`, err && err.message);
    try { await deps.JobModel.findOneAndUpdate({ jobId }, { $set: { 'metadata.refunded': false } }); } catch (_) { /* best effort */ }
    return false;
  }
}

async function failJob(deps, jobId, message, status = 'failed') {
  await deps.JobModel.updateOne(
    { jobId },
    { $set: { status, currentStep: status, error: { message }, completedAt: deps.now() } }
  );
}

async function startHeroGeneration(deps, { userId, body }) {
  const b = body || {};
  const prompt = typeof b.prompt === 'string' ? b.prompt.trim() : '';
  if (!prompt) return bad('Prompt is required');
  if (prompt.length > MAX_PROMPT_CHARS) return bad(`Prompt must be at most ${MAX_PROMPT_CHARS} characters`);
  const hasAspect = b.aspectRatio !== undefined && b.aspectRatio !== null && b.aspectRatio !== '';
  if (hasAspect && !ASPECTS.includes(b.aspectRatio)) return bad('aspectRatio must be one of 9:16, 16:9, 1:1');
  const aspectRatio = hasAspect ? b.aspectRatio : '9:16';

  const { buildHeroInput } = require('./heroVideoService');
  let built;
  try {
    built = buildHeroInput({ prompt, refImageUrls: b.refImageUrls, aspectRatio, duration: b.duration });
  } catch (err) {
    return bad((err && err.message) || 'Invalid request');
  }
  const refImageUrls = built.input.image_urls || [];

  const now = deps.now();
  const q = await deps.quotaFn(userId, now);
  if (q.used >= q.limit) {
    return { status: 403, json: { success: false, quotaExhausted: true, used: q.used, limit: q.limit, resetsOn: q.resetsOn } };
  }

  let dres;
  try {
    dres = await deps.deduct(userId, ACTION, 1, 'Hero video clip');
  } catch (err) {
    console.error('Hero credit deduction threw:', err && err.message);
    return { status: 500, json: { success: false, message: 'Could not charge credits' } };
  }
  if (!dres || !dres.success) {
    return { status: 403, json: { success: false, creditsExhausted: true, message: (dres && dres.error) || 'Insufficient credits' } };
  }

  const jobId = crypto.randomUUID();
  try {
    await deps.JobModel.create({
      jobId,
      userId,
      status: 'queued',
      progress: 0,
      currentStep: 'queued',
      startedAt: now,
      payload: { prompt, refImageUrls, aspectRatio, model: built.model },
      metadata: { kind: 'hero', refunded: false }
    });
  } catch (err) {
    console.error('Hero job create failed:', err && err.message);
    // No job exists to hold the guard; this is the only refund on this path.
    try { await deps.refund(userId, ACTION, 1, 'Refund: hero job not created'); } catch (e) { console.error('Hero refund failed:', e && e.message); }
    return { status: 500, json: { success: false, message: 'Could not start video generation' } };
  }

  // Concurrent requests can both pass the pre-check; the loser (job counted, over limit) backs out.
  try {
    const q2 = await deps.quotaFn(userId, now);
    if (q2.used > q2.limit) {
      await failJob(deps, jobId, 'Monthly hero video limit reached', 'cancelled');
      await refundOnce(deps, jobId, userId, 'Refund: hero quota exceeded');
      return { status: 403, json: { success: false, quotaExhausted: true, used: q2.used, limit: q2.limit, resetsOn: q2.resetsOn } };
    }
  } catch (err) {
    console.error('Hero quota recheck failed:', err && err.message);
    await failJob(deps, jobId, 'Quota check failed', 'failed').catch(() => {});
    await refundOnce(deps, jobId, userId, 'Refund: hero quota check failed');
    return { status: 500, json: { success: false, message: 'Could not start video generation' } };
  }

  let requestId;
  try {
    requestId = await deps.submit({ model: built.model, input: built.input });
    await deps.JobModel.updateOne(
      { jobId },
      { $set: { status: 'processing', currentStep: 'processing', 'metadata.falRequestId': requestId } }
    );
  } catch (err) {
    console.error('Hero submit failed:', err && err.message);
    await failJob(deps, jobId, 'Video generation could not be started', 'failed').catch(() => {});
    await refundOnce(deps, jobId, userId, 'Refund: hero submit failed');
    return { status: 500, json: { success: false, message: 'Could not start video generation. Your credit was refunded.' } };
  }

  return { status: 200, json: { success: true, jobId } };
}

function terminalResponse(job) {
  const json = { success: true, status: job.status };
  if (job.status === 'completed' && job.result && job.result.videoUrl) json.videoUrl = job.result.videoUrl;
  if (job.status !== 'completed') json.error = (job.error && job.error.message) || (job.status === 'cancelled' ? 'Cancelled' : 'Generation failed');
  return { status: 200, json };
}

async function pollHeroJob(deps, { userId, jobId }) {
  const job = await deps.JobModel.findOne({ jobId, userId, 'metadata.kind': 'hero' });
  if (!job) return { status: 404, json: { success: false, message: 'Job not found' } };

  if (TERMINAL.includes(job.status)) {
    // Self-heal a refund that failed earlier; guarded, so never a double refund.
    if (job.status !== 'completed' && !(job.metadata && job.metadata.refunded === true)) {
      await refundOnce(deps, jobId, userId, 'Refund: hero clip did not complete');
    }
    return terminalResponse(job);
  }

  const processing = { status: 200, json: { success: true, status: 'processing' } };
  const model = job.payload && job.payload.model;
  const requestId = job.metadata && job.metadata.falRequestId;
  if (!requestId) return processing; // submit still in flight

  let st;
  try {
    st = await deps.getStatus(model, requestId);
  } catch (err) {
    console.error(`Hero status check failed for job ${jobId} (will retry):`, err && err.message);
    return processing; // transient: never refund or fail on a thrown error
  }

  if (st.state === 'failed' || (st.state === 'completed' && !st.videoUrl)) {
    const message = st.error || 'fal completed without a video URL';
    await failJob(deps, jobId, message, 'failed');
    await refundOnce(deps, jobId, userId, 'Refund: hero clip failed');
    return { status: 200, json: { success: true, status: 'failed', error: message } };
  }

  if (st.state === 'completed') {
    let url;
    try {
      url = await deps.copyToStorage(st.videoUrl);
    } catch (err) {
      console.error(`Hero storage copy failed for job ${jobId} (will retry):`, err && err.message);
      return processing;
    }
    await deps.JobModel.updateOne(
      { jobId },
      { $set: { status: 'completed', progress: 100, currentStep: 'completed', result: { videoUrl: url }, completedAt: deps.now() } }
    );
    return { status: 200, json: { success: true, status: 'completed', videoUrl: url } };
  }

  await deps.JobModel.updateOne(
    { jobId },
    { $set: { status: 'processing', currentStep: st.state === 'queued' ? 'queued' : 'processing' } }
  );
  return processing;
}

module.exports = { startHeroGeneration, pollHeroJob, defaultDeps };
