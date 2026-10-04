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
const fs = require('fs');
const os = require('os');
const path = require('path');
const { normalizeFinishOptions, finishHeroClip: realFinishHeroClip } = require('./heroVideoFinish');

const MAX_PROMPT_CHARS = 6000;
const ASPECTS = ['9:16', '16:9', '1:1'];
const ACTION = 'hero_video_clip';
const TERMINAL = ['completed', 'failed', 'cancelled'];
const ACTIVE = ['queued', 'processing'];
const COUNTED_STATUSES = ['queued', 'processing', 'completed']; // must match getHeroQuota
// A job with no falRequestId this old never reached fal (process died mid-start).
const STALE_UNSUBMITTED_MS = 10 * 60 * 1000;
// Any non-terminal job older than this is failed and refunded, even if fal has it. Bounds
// every "stays processing, retry later" path (transient fal/storage errors, lost polls).
const HERO_MAX_AGE_MS = 60 * 60 * 1000;
// A submitted job past HERO_MAX_AGE_MS is still checked with fal first (a finished clip must
// be delivered however old). If fal cannot be reached at all, give up only past this cap.
const HERO_HARD_MAX_AGE_MS = 24 * 60 * 60 * 1000;
// One poll at a time may download+upload a finished clip; a lease older than this is
// treated as abandoned (process died mid-copy) and can be re-claimed.
const COPY_LEASE_MS = 5 * 60 * 1000;
// Finishing (grade, brand mark, end card) is capped at 120 s inside the default finalizeClip; the poll
// itself also stops waiting after FINISH_POLL_CAP_MS (finishing + two uploads) so it can never outlive
// the copy lease. Either way the job completes with the raw clip.
const FINISH_CAP_MS = 120 * 1000;
const FINISH_POLL_CAP_MS = 4 * 60 * 1000;
const HERO_FOLDER = 'nebula-hero-videos';
const FINISH_FAILED_MESSAGE = 'We could not add the finishing touches, so this is the original clip.';
const MAX_BEATS = 12;
const MAX_DIALOGUE_CHARS = 2000;
const MAX_AGE_MESSAGE = 'This video took too long to finish, so we stopped it.';
// KNOWN GAP: a crash between deduct() and JobModel.create() leaves a charge with no job
// record, so there is nothing here to find or refund; that case needs manual reconciliation.

function defaultDeps() {
  const HeroVideoJob = require('../models/HeroVideoJob');
  const hero = require('./heroVideoService');
  const { deductCredits, refundCredits } = require('../middleware/trialGuard');
  return {
    JobModel: HeroVideoJob,
    quotaFn: (userId, now) => hero.getHeroQuota(userId, now, HeroVideoJob, require('../models/User')),
    deduct: deductCredits,
    refund: refundCredits,
    submit: hero.submitHeroClip,
    getStatus: hero.getHeroClipStatus,
    copyToStorage: hero.copyClipToStorage,
    finalizeClip: (args) => finalizeClipDefault(args),
    hasFalKey: () => Boolean(String(process.env.FAL_KEY || '').trim()),
    now: () => new Date()
  };
}

function withTimeout(promise, ms) {
  let timer;
  const guard = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timed out')), ms); });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const firstHex = (colors) => (Array.isArray(colors) ? colors.find((c) => typeof c === 'string' && HEX_COLOR.test(c.trim())) : undefined);

/**
 * Default finalizeClip: downloads the fal clip once into a private temp dir, uploads it as the raw clip,
 * then finishes it (brand loaded for job.userId) within a 120 s cap and uploads the result. Any finishing
 * or finished-upload problem returns the raw clip with a plain `finishError`; only a failed download or
 * raw upload rejects (the caller then falls back / retries). The temp dir is removed on every path.
 * `io` injects the I/O for tests.
 */
async function finalizeClipDefault({ remoteUrl, job }, io = {}) {
  const mkdtemp = io.mkdtemp || (() => fs.promises.mkdtemp(path.join(os.tmpdir(), 'hero-finish-')));
  const download = io.download || ((u, o) => require('./videoDownload').downloadVideoFromUrl(u, o));
  const upload = io.upload || ((p, f) => require('./imageUploader').uploadVideoFile(p, f));
  const loadBrand = io.loadBrand || ((id) => require('./heroVideoBrief').loadBrand(id));
  const finish = io.finishHeroClip || realFinishHeroClip;
  const capMs = io.capMs || FINISH_CAP_MS;
  const userId = job && job.userId;
  const payload = (job && job.payload) || {};

  const dir = await mkdtemp();
  try {
    const dl = await download(remoteUrl, { downloadsDir: dir });
    const rawPath = dl && dl.filePath;
    if (!rawPath) throw new Error('Download returned no file path');
    const rawUp = await upload(rawPath, HERO_FOLDER);
    if (!rawUp || !rawUp.url) throw new Error('Upload returned no URL');
    const rawVideoUrl = rawUp.url;
    try {
      const outputPath = path.join(dir, 'finished.mp4');
      await withTimeout((async () => {
        let b = {};
        try { b = (await loadBrand(userId)) || {}; } catch (_) { b = {}; }
        const brand = { name: b.name || '', logoUrl: b.logoUrl || '', website: b.website || '' };
        const color = firstHex(b.colors);
        if (color) brand.color = color.trim();
        await finish({
          inputPath: rawPath,
          outputPath,
          options: payload.finish,
          brand,
          beatSheet: payload.beatSheet,
          dialogue: payload.dialogue,
          timeoutMs: capMs
        });
      })(), capMs);
      const up = await upload(outputPath, HERO_FOLDER);
      if (!up || !up.url) throw new Error('Upload returned no URL');
      return { videoUrl: up.url, rawVideoUrl };
    } catch (err) {
      console.error('Hero finishing failed, delivering the raw clip:', err && err.message);
      return { videoUrl: rawVideoUrl, rawVideoUrl, finishError: FINISH_FAILED_MESSAGE };
    }
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

const strCap = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
function sanitizeBeatSheet(v) {
  if (!Array.isArray(v)) return [];
  return v
    .filter((b) => b && typeof b === 'object' && !Array.isArray(b))
    .slice(0, MAX_BEATS)
    .map((b) => ({ time: strCap(b.time, 20), beat: strCap(b.beat, 200), emotion: strCap(b.emotion, 60) }))
    .filter((b) => b.time || b.beat);
}

// fal's rejection reason for the server log: HTTP status and fal's detail text only (never the prompt).
function describeSubmitError(err, prompt) {
  const status = err && typeof err.status === 'number' ? err.status : 'n/a';
  const d = err && err.body && err.body.detail;
  let detail = '';
  if (typeof d === 'string') detail = d;
  else if (Array.isArray(d)) detail = d.map((x) => (x && (x.msg || x.message)) || (typeof x === 'string' ? x : '')).filter(Boolean).join('; ');
  if (!detail) detail = (err && err.message) || '';
  detail = String(detail);
  if (prompt) detail = detail.split(prompt).join('[prompt]');
  return { status, detail: detail.slice(0, 500) };
}

const REF_CAPS = { tag: 12, kind: 16, label: 80, url: 2048 };

// Display metadata for the confirmed references. Only entries whose url is in the validated
// set survive (first entry per url wins); strings are capped. Malformed input is dropped, not an error.
function sanitizeReferences(references, validUrls) {
  if (!Array.isArray(references)) return [];
  const allowed = new Set(validUrls);
  const seen = new Set();
  const out = [];
  for (const r of references) {
    if (out.length >= validUrls.length) break;
    if (!r || typeof r !== 'object' || typeof r.url !== 'string') continue;
    const url = r.url.trim();
    if (!allowed.has(url) || seen.has(url)) continue;
    seen.add(url);
    const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
    out.push({ tag: str(r.tag, REF_CAPS.tag), kind: str(r.kind, REF_CAPS.kind), label: str(r.label, REF_CAPS.label), url: url.slice(0, REF_CAPS.url) });
  }
  return out;
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
  // Before any charge: without a fal key the clip can never be generated.
  if (typeof deps.hasFalKey === 'function' && !deps.hasFalKey()) {
    return { status: 500, json: { success: false, message: 'Hero video is not available right now.' } };
  }
  const b = body || {};
  const prompt = typeof b.prompt === 'string' ? b.prompt.trim() : '';
  if (!prompt) return bad('Prompt is required');
  if (prompt.length > MAX_PROMPT_CHARS) return bad(`Prompt must be at most ${MAX_PROMPT_CHARS} characters`);
  const hasAspect = b.aspectRatio !== undefined && b.aspectRatio !== null && b.aspectRatio !== '';
  if (hasAspect && !ASPECTS.includes(b.aspectRatio)) return bad('aspectRatio must be one of 9:16, 16:9, 1:1');
  const aspectRatio = hasAspect ? b.aspectRatio : '9:16';

  const { buildHeroInput, monthStartUTC, HERO_MAX_REFS } = require('./heroVideoService');
  let built;
  try {
    // The cap applies to what the client sent; duplicate links then collapse into one.
    let rawRefs = b.refImageUrls;
    if (Array.isArray(rawRefs)) {
      if (rawRefs.length > HERO_MAX_REFS) return bad(`At most ${HERO_MAX_REFS} reference images allowed`);
      rawRefs = [...new Set(rawRefs.map((u) => (typeof u === 'string' ? u.trim() : u)))];
    }
    built = buildHeroInput({ prompt, refImageUrls: rawRefs, aspectRatio, duration: b.duration });
  } catch (err) {
    return bad((err && err.message) || 'Invalid request');
  }
  const refImageUrls = built.input.image_urls || [];
  const references = sanitizeReferences(b.references, refImageUrls);

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
    return { status: 500, json: { success: false, message: 'Could not charge Quarks' } };
  }
  if (!dres || !dres.success) {
    return { status: 403, json: { success: false, creditsExhausted: true, message: (dres && dres.error) || 'Insufficient Quarks' } };
  }

  const payload = { prompt, refImageUrls, references, aspectRatio, model: built.model, finish: normalizeFinishOptions(b.finish) };
  const beatSheet = sanitizeBeatSheet(b.beatSheet);
  if (beatSheet.length) payload.beatSheet = beatSheet;
  const dialogue = strCap(b.dialogue, MAX_DIALOGUE_CHARS);
  if (dialogue) payload.dialogue = dialogue;

  const jobId = crypto.randomUUID();
  try {
    await deps.JobModel.create({
      jobId,
      userId,
      status: 'queued',
      progress: 0,
      currentStep: 'queued',
      createdAt: now,
      startedAt: now,
      payload,
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
      // Oldest-wins (createdAt, then jobId): only a job outside the first `limit` backs out,
      // so two racing requests can never both cancel.
      const winners = await deps.JobModel
        .find({
          userId,
          'metadata.kind': 'hero',
          status: { $in: COUNTED_STATUSES },
          createdAt: { $gte: monthStartUTC(now) }
        })
        .sort({ createdAt: 1, jobId: 1 })
        .limit(q2.limit)
        .lean();
      if (!winners.some((w) => w.jobId === jobId)) {
        await failJob(deps, jobId, 'Monthly hero video limit reached', 'cancelled');
        await refundOnce(deps, jobId, userId, 'Refund: hero quota exceeded');
        return { status: 403, json: { success: false, quotaExhausted: true, used: q2.used, limit: q2.limit, resetsOn: q2.resetsOn } };
      }
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
    const { status: falStatus, detail } = describeSubmitError(err, prompt);
    console.error(`Hero submit failed: status=${falStatus} detail=${detail}`);
    await failJob(deps, jobId, 'Video generation could not be started', 'failed').catch(() => {});
    await refundOnce(deps, jobId, userId, 'Refund: hero submit failed');
    return { status: 500, json: { success: false, message: 'Could not start video generation. Your Quarks were refunded.' } };
  }

  return { status: 200, json: { success: true, jobId } };
}

function terminalResponse(job) {
  const json = { success: true, status: job.status };
  if (job.status === 'completed' && job.result && job.result.videoUrl) {
    json.videoUrl = job.result.videoUrl;
    if (job.result.rawVideoUrl) json.rawVideoUrl = job.result.rawVideoUrl;
    if (job.result.finishError) json.finishError = job.result.finishError;
  }
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
  const nowMs = deps.now().getTime();
  const created = new Date((job.createdAt || job.startedAt || 0)).getTime();
  const copyingAt = job.metadata && job.metadata.copyingAt ? new Date(job.metadata.copyingAt).getTime() : null;
  const copyInFlight = copyingAt !== null && nowMs - copyingAt < COPY_LEASE_MS;
  const overAge = nowMs - created > HERO_MAX_AGE_MS && !copyInFlight;
  const hasRequestId = Boolean(job.metadata && job.metadata.falRequestId);

  // Conditional on still being active so a job completed by a concurrent poll is never failed/refunded.
  const ageFail = async () => {
    const upd = await deps.JobModel.updateOne(
      { jobId, status: { $in: ACTIVE } },
      { $set: { status: 'failed', currentStep: 'failed', error: { message: MAX_AGE_MESSAGE }, completedAt: deps.now() } }
    );
    if (!upd || !upd.matchedCount) {
      const fresh = await deps.JobModel.findOne({ jobId, userId, 'metadata.kind': 'hero' });
      return fresh ? terminalResponse(fresh) : processing;
    }
    await refundOnce(deps, jobId, userId, 'Refund: hero clip timed out');
    return { status: 200, json: { success: true, status: 'failed', error: MAX_AGE_MESSAGE } };
  };

  // Never reached fal: nothing to ask, age-fail. Submitted jobs fall through and ask fal first.
  if (overAge && !hasRequestId) return ageFail();

  const model = job.payload && job.payload.model;
  const requestId = job.metadata && job.metadata.falRequestId;
  if (!requestId) {
    if (nowMs - created > STALE_UNSUBMITTED_MS) {
      const message = 'Video generation never started';
      await failJob(deps, jobId, message, 'failed');
      await refundOnce(deps, jobId, userId, 'Refund: hero job never submitted');
      return { status: 200, json: { success: true, status: 'failed', error: message } };
    }
    return processing; // submit still in flight
  }

  let st;
  try {
    st = await deps.getStatus(model, requestId);
  } catch (err) {
    console.error(`Hero status check failed for job ${jobId} (will retry):`, err && err.message);
    if (overAge && nowMs - created > HERO_HARD_MAX_AGE_MS) return ageFail(); // fal unreachable for a day: stop retrying
    return processing; // transient: never refund or fail on a thrown error
  }

  if (st.state === 'failed' || (st.state === 'completed' && !st.videoUrl)) {
    const message = st.error || 'fal completed without a video URL';
    await failJob(deps, jobId, message, 'failed');
    await refundOnce(deps, jobId, userId, 'Refund: hero clip failed');
    return { status: 200, json: { success: true, status: 'failed', error: message } };
  }

  if (st.state === 'completed') {
    // Copying takes 10-60 s and the page keeps polling: claim an atomic lease so only one
    // request downloads/uploads the clip. Losers report processing and pick up the result later.
    const leaseAt = deps.now();
    const claimed = await deps.JobModel.findOneAndUpdate(
      {
        jobId,
        status: { $in: ACTIVE },
        $or: [
          { 'metadata.copyingAt': { $exists: false } },
          { 'metadata.copyingAt': { $lt: new Date(leaseAt.getTime() - COPY_LEASE_MS) } }
        ]
      },
      { $set: { 'metadata.copyingAt': leaseAt } }
    );
    if (!claimed) return processing;
    let result;
    try {
      const finishing = job.payload && job.payload.finish && typeof deps.finalizeClip === 'function';
      if (finishing) {
        let fin = null;
        try {
          const capMs = Number.isFinite(deps.finishCapMs) && deps.finishCapMs > 0 ? deps.finishCapMs : FINISH_POLL_CAP_MS;
          const p = Promise.resolve().then(() => deps.finalizeClip({ remoteUrl: st.videoUrl, job }));
          p.catch(() => {}); // an abandoned run must not become an unhandled rejection
          fin = await withTimeout(p, capMs);
          if (!fin || typeof fin.videoUrl !== 'string' || !fin.videoUrl) throw new Error('finalizeClip returned no video URL');
        } catch (err) {
          console.error(`Hero finishing failed for job ${jobId}, using the raw clip:`, err && err.message);
          fin = null;
        }
        if (fin) {
          result = { videoUrl: fin.videoUrl };
          if (fin.rawVideoUrl) result.rawVideoUrl = fin.rawVideoUrl;
          if (fin.finishError) result.finishError = String(fin.finishError);
        } else {
          const raw = await deps.copyToStorage(st.videoUrl);
          result = { videoUrl: raw, rawVideoUrl: raw, finishError: FINISH_FAILED_MESSAGE };
        }
      } else {
        result = { videoUrl: await deps.copyToStorage(st.videoUrl) };
      }
    } catch (err) {
      console.error(`Hero storage copy failed for job ${jobId} (will retry):`, err && err.message);
      try {
        await deps.JobModel.updateOne({ jobId }, { $unset: { 'metadata.copyingAt': '' } });
      } catch (_) { /* lease expires on its own */ }
      return processing;
    }
    const done = await deps.JobModel.updateOne(
      { jobId, status: { $in: ACTIVE } },
      { $set: { status: 'completed', progress: 100, currentStep: 'completed', result, completedAt: deps.now() } }
    );
    if (done && done.matchedCount === 0) {
      // Job left the active states while we copied (e.g. timed out after the lease expired).
      const fresh = await deps.JobModel.findOne({ jobId, userId, 'metadata.kind': 'hero' });
      if (fresh) return terminalResponse(fresh);
    }
    return { status: 200, json: { success: true, status: 'completed', ...result } };
  }

  // fal has still not delivered after HERO_MAX_AGE_MS.
  if (overAge) return ageFail();

  await deps.JobModel.updateOne(
    { jobId },
    { $set: { status: 'processing', currentStep: st.state === 'queued' ? 'queued' : 'processing' } }
  );
  return processing;
}

module.exports = { startHeroGeneration, pollHeroJob, defaultDeps, finalizeClipDefault, FINISH_CAP_MS, HERO_MAX_AGE_MS, HERO_HARD_MAX_AGE_MS, COPY_LEASE_MS };
