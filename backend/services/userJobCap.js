'use strict';
/**
 * Per-account caps on generation work in flight (docs/superpowers/ops/security-hardening.md, decision D41): at most
 * JOB_CAP_ACTIVE running (default 2) plus JOB_CAP_QUEUED waiting (default 5) per account and flow; one more is refused
 * with a plain 429 before anything is charged. Counted in MongoDB from each flow's own job collection (no new
 * collection), one indexed count on the user field, bounded to rows created in the last JOB_CAP_STALE_HOURS (default 6),
 * so a job a crash left "processing" can never block an account for good. A database error lets the request through
 * (like the limiters) and logs a warning.
 *
 *   flow       collection        what counts as in flight
 *   video      video_jobs        queued, processing (the step-by-step video pipeline: createVideo, generateClips, ...)
 *   hero       hero_video_jobs   queued, processing (Hero video clips)
 *   blueprint  blueprints        queued, processing (not the plan runs stored in the same collection)
 *   carousel   drafts            processing carousels (the carousel is made while its stream is open: no queue, 2 at once)
 *
 * Flows that already had their own cap keep it: Videos (Omni, `StudioVideo`: 2 processing per account, in the route),
 * Photoshoot (one shoot in flight per account, a unique index), campaign image jobs (2 running and 5 waiting,
 * services/imageJobQueue.js).
 */

const positiveInt = (v, min = 0) => {
  const n = Number.parseInt(String(v == null ? '' : v), 10);
  return Number.isFinite(n) && n >= min ? n : null;
};

function capSettings(env = process.env) {
  return {
    active: positiveInt(env.JOB_CAP_ACTIVE, 1) || 2,
    queued: positiveInt(env.JOB_CAP_QUEUED, 0) == null ? 5 : positiveInt(env.JOB_CAP_QUEUED, 0),
    staleMs: (positiveInt(env.JOB_CAP_STALE_HOURS, 1) || 6) * 3600 * 1000
  };
}

const FLOWS = Object.freeze({
  video: { model: () => require('../models/VideoJob'), statuses: ['queued', 'processing'], what: 'videos' },
  hero: { model: () => require('../models/HeroVideoJob'), statuses: ['queued', 'processing'], what: 'videos' },
  blueprint: { model: () => require('../models/Blueprint'), statuses: ['queued', 'processing'], extra: { kind: { $ne: 'plan' } }, what: 'Blueprints' },
  carousel: { model: () => require('../models/Draft'), statuses: ['processing'], extra: { contentType: 'carousel' }, queued: 0, what: 'carousels' }
});

const COUNT_TIMEOUT_MS = 2000;

function createJobCaps({ env = process.env, models = {}, now = Date.now, log = console } = {}) {
  const s = capSettings(env);

  async function check(flow, userId) {
    const f = FLOWS[flow];
    if (!f) throw new Error(`unknown job flow ${flow}`);
    const max = s.active + (f.queued == null ? s.queued : f.queued);
    try {
      const Model = models[flow] || f.model();
      // Not connected (tests, demo mode, a reconnect): never wait for mongoose's command buffer.
      if (Model.db && Model.db.readyState !== 1) return { ok: true, inFlight: null };
      const filter = { userId: String(userId), status: { $in: f.statuses }, createdAt: { $gt: new Date(now() - s.staleMs) }, ...(f.extra || {}) };
      const n = await Model.countDocuments(filter).maxTimeMS(COUNT_TIMEOUT_MS);
      if (n >= max) {
        return {
          ok: false,
          status: 429,
          inFlight: n,
          message: `You already have ${n} ${f.what} being made. Please wait for one to finish before starting another.`
        };
      }
      return { ok: true, inFlight: n };
    } catch (e) {
      log.warn(`[job cap] could not count ${flow} for an account (${e && e.message}): letting the request through`);
      return { ok: true, inFlight: null };
    }
  }

  /** Route middleware (after `protect`): 429 when the account already has the most in flight for this flow. */
  function middleware(flow) {
    if (!FLOWS[flow]) throw new Error(`unknown job flow ${flow}`);
    return async (req, res, next) => {
      const id = req.user && (req.user._id || req.user.id);
      if (!id) return res.status(401).json({ success: false, message: 'Please sign in.' });
      const r = await check(flow, id);
      if (!r.ok) return res.status(429).json({ success: false, tooManyJobs: true, message: r.message });
      return next();
    };
  }

  return { check, middleware, settings: s };
}

const shared = createJobCaps();

module.exports = { createJobCaps, capSettings, FLOWS, jobCap: shared.middleware, checkJobCap: shared.check };
