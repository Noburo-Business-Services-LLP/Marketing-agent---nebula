// Gravity Hero video routes (/api/hero-video). The Kling pipeline in videoGeneration.js is untouched.
const express = require('express');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = rateLimit;
const { protect } = require('../middleware/auth');
const { checkTrial } = require('../middleware/trialGuard');
// Same semantics as videoDraftStore.toUserId; kept local because that module drags in timers.
const toUserId = (user) => (!user ? null : user._id ? String(user._id) : user.id ? String(user.id) : null);

const ASPECTS = ['9:16', '16:9', '1:1'];

const heroWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many AI generation requests, please try again later.' },
  keyGenerator: (req) => String(req.user?._id || req.user?.id || ipKeyGenerator(req.ip))
});

const heroReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
  keyGenerator: (req) => String(req.user?._id || req.user?.id || ipKeyGenerator(req.ip))
});

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const strList = (v) => (Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean) : []);

function normalizePlan(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  const prompt = str(parsed.prompt);
  if (!prompt) return null;
  const beatSheet = Array.isArray(parsed.beatSheet)
    ? parsed.beatSheet
        .filter((b) => b && typeof b === 'object')
        .map((b) => ({ time: str(b.time), beat: str(b.beat) }))
    : [];
  return {
    prompt,
    beatSheet,
    dialogue: str(parsed.dialogue),
    qaChecklist: strList(parsed.qaChecklist),
    assumptions: strList(parsed.assumptions)
  };
}

function describeReferences(urls) {
  if (!urls.length) return 'No reference images';
  const tags = urls.map((_, i) => `@image${i + 1}`).join(', ');
  return `Yes - ${urls.length} reference image${urls.length === 1 ? '' : 's'}, tagged ${tags}`;
}

function brandContextFrom(bp = {}) {
  const pick = (...vals) => vals.map(str).find(Boolean) || '';
  const tone = Array.isArray(bp.brandVoice) ? bp.brandVoice.map(str).filter(Boolean).join(', ') : pick(bp.brandVoice, bp.tone);
  const lines = [
    ['Brand', pick(bp.name, bp.companyName)],
    ['Industry', pick(bp.industry)],
    ['About', pick(bp.description, bp.bio, bp.about)],
    ['Target audience', pick(bp.targetAudience)],
    ['Brand tone', tone]
  ].filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
  return lines.length ? lines.join('\n') : 'No brand profile on file.';
}

const isCastError = (e) => e && (e.name === 'CastError' || e.name === 'BSONError' || e.name === 'BSONTypeError');
const GENERIC_ERROR = 'Something went wrong. Please try again.';
// Never echo internal error text (Mongo, fal, stack) to the client; log it server-side.
// `context` names the failing operation; the request body (the user's prompt) is never logged.
function fail(res, err, context) {
  if (isCastError(err)) return res.status(404).json({ success: false, message: 'Not found' });
  console.error(`[heroVideo] ${context}:`, err && err.message, err && err.stack);
  return res.status(500).json({ success: false, message: GENERIC_ERROR });
}

const ACTIVE = ['queued', 'processing'];
const MAX_RECONCILE = 3;

function lazyPlanDeps() {
  return {
    buildPrompt: (...a) => require('../services/promptRegistry').buildPrompt(...a),
    callTextLLM: (...a) => require('../services/openAI').callTextLLM(...a),
    parseGeminiJSON: (...a) => require('../services/geminiAI').parseGeminiJSON(...a),
    findUser: (id) => require('../models/User').findById(id).lean()
  };
}

function createHeroVideoRouter(planDeps = lazyPlanDeps(), impl = {}) {
  const router = express.Router();
  const flow = () => ({
    startHeroGeneration: impl.startHeroGeneration || require('../services/heroVideoFlow').startHeroGeneration,
    pollHeroJob: impl.pollHeroJob || require('../services/heroVideoFlow').pollHeroJob
  });
  let deps = impl.deps || null;
  const getDeps = () => (deps = deps || require('../services/heroVideoFlow').defaultDeps());
  const jobModel = () => impl.JobModel || require('../models/HeroVideoJob');

  router.get('/quota', protect, heroReadLimiter, async (req, res) => {
    try {
      const userId = toUserId(req.user);
      const quota = await require('../services/heroVideoService').getHeroQuota(userId);
      return res.json({ success: true, ...quota });
    } catch (err) {
      return fail(res, err, 'Failed to load quota');
    }
  });

  router.post('/plan', protect, checkTrial, heroWriteLimiter, async (req, res) => {
    try {
      const body = req.body || {};
      const c = body.concept;
      const title = str(c && c.title);
      const story = str(c && c.storySummary);
      if (!c || typeof c !== 'object' || (!title && !story)) {
        return res.status(400).json({ success: false, message: 'concept is required' });
      }
      const aspectRatio = body.aspectRatio == null || body.aspectRatio === '' ? '9:16' : body.aspectRatio;
      if (!ASPECTS.includes(aspectRatio)) {
        return res.status(400).json({ success: false, message: `aspectRatio must be one of ${ASPECTS.join(', ')}` });
      }
      const refs = strList(body.refImageUrls);
      const user = await planDeps.findUser(toUserId(req.user));
      const prompt = await planDeps.buildPrompt(req.user.id, 'hero_video.plan', {
        brandContextBlock: brandContextFrom(user && user.businessProfile),
        conceptTitle: title,
        conceptStory: story,
        conceptEmotion: str(c.coreEmotion),
        conceptVisualStyle: str(c.visualStyle),
        duration: 15,
        aspectRatio,
        language: str(body.language) || 'English',
        hasReferences: describeReferences(refs)
      });
      const raw = await planDeps.callTextLLM(prompt, { jsonMode: true, maxTokens: 3000 });
      let parsed = null;
      try { parsed = planDeps.parseGeminiJSON(raw); } catch (_) { parsed = null; }
      const plan = normalizePlan(parsed);
      if (!plan) return res.status(502).json({ success: false, message: 'Model returned no prompt. Please try again.' });
      return res.json({ success: true, plan });
    } catch (err) {
      return fail(res, err, 'Failed to build plan');
    }
  });

  router.post('/generate', protect, checkTrial, heroWriteLimiter, async (req, res) => {
    try {
      const out = await flow().startHeroGeneration(getDeps(), { userId: toUserId(req.user), body: req.body || {} });
      return res.status(out.status).json(out.json);
    } catch (err) {
      return fail(res, err, 'Failed to start generation');
    }
  });

  router.get('/jobs', protect, heroReadLimiter, async (req, res) => {
    try {
      const userId = toUserId(req.user);
      const load = () => jobModel()
        .find({ userId, 'metadata.kind': 'hero' })
        .sort({ createdAt: -1 })
        .limit(20)
        .lean();
      let rows = await load();
      // Jobs only move forward when polled; reconcile a few in-flight rows here so a job whose
      // page was closed still completes / fails / refunds when the user next opens the list.
      const pending = rows.filter((j) => ACTIVE.includes(j.status)).slice(0, MAX_RECONCILE);
      if (pending.length) {
        const poll = flow().pollHeroJob;
        await Promise.all(pending.map((j) =>
          Promise.resolve()
            .then(() => poll(getDeps(), { userId, jobId: String(j.jobId) }))
            .catch((err) => console.error(`[heroVideo] reconcile failed for job ${j.jobId}:`, err && err.message))
        ));
        rows = await load();
      }
      const jobs = rows.map((j) => {
        const o = { jobId: j.jobId, status: j.status, createdAt: j.createdAt };
        if (j.status === 'completed' && j.result && j.result.videoUrl) o.videoUrl = j.result.videoUrl;
        if (j.payload && j.payload.prompt) o.prompt = j.payload.prompt;
        return o;
      });
      return res.json({ success: true, jobs });
    } catch (err) {
      return fail(res, err, 'Failed to list jobs');
    }
  });

  router.get('/jobs/:jobId', protect, heroReadLimiter, async (req, res) => {
    try {
      const out = await flow().pollHeroJob(getDeps(), { userId: toUserId(req.user), jobId: String(req.params.jobId) });
      return res.status(out.status).json(out.json);
    } catch (err) {
      return fail(res, err, 'Failed to load job');
    }
  });

  return router;
}

const router = createHeroVideoRouter();
router.createHeroVideoRouter = createHeroVideoRouter;
router.normalizePlan = normalizePlan;
module.exports = router;
