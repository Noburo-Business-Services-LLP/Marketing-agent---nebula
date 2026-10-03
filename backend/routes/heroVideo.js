// Gravity Hero video routes (/api/hero-video). The Kling pipeline in videoGeneration.js is untouched.
const express = require('express');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = rateLimit;
const { protect } = require('../middleware/auth');
const { checkTrial } = require('../middleware/trialGuard');
const { normalizeHeroBrief, selectReferences } = require('../services/heroVideoBrief');
const { DEFAULT_STYLE, isHeroStyle } = require('../services/heroVideoStyles');
const { HERO_CLIP_SECONDS } = require('../config/apiCosts');
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
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
// Planner inputs are clipped so the rendered prompt stays under 14,000 characters at the brief's caps.
const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const clip = (v, n) => cut(str(v).replace(/\s+/g, ' '), n); // one line
const clipBlock = (v, n) => cut(str(v).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n'), n); // keeps line breaks
const sentence = (s) => (s && !/[.!?…]$/.test(s) ? `${s}.` : s);

const MAX_SHOTS = 7;
const MAX_HERO_CUT = 12;
const MAX_CTA = 60;
const STYLE_BLOCK_MAX = 1200;
const CAST_BUDGET = 1000; // all cast lines together // an edited style prompt longer than this is clipped, keeping the planner under 14,000 characters
const AUDIO_MODES = ['native', 'sfx_only'];
const AUDIO_DIRECTIONS = {
  native: 'Music and effects both come from the video model. In 10 SFX write an actual music line: genre, two or three instruments, tempo, starting quiet under the setup, lifting at the discovery and resolving on the final held frame, always under the dialogue. Add a specific diegetic sound for every meaningful action.',
  sfx_only: 'Effects only: no music and no score (music is added later). Room tone plus a specific diegetic sound for every meaningful action.'
};

function normalizePlan(parsed, opts = {}) {
  if (!parsed || typeof parsed !== 'object') return null;
  const prompt = str(parsed.prompt);
  if (!prompt) return null;
  const objs = (v) => (Array.isArray(v) ? v.filter(isObj) : []);
  const s = isObj(parsed.story) ? parsed.story : {};
  const ids = Array.isArray(opts.sceneIds) ? opts.sceneIds : null;
  const known = ids ? new Set(ids) : null;
  // The planner sees scenes as S1..Sn (ids can be 80 chars); map labels back to the real ids.
  const realId = (id) => (!ids || known.has(id) ? id : (/^S(\d+)$/i.test(id) && ids[Number(id.slice(1)) - 1]) || id);
  return {
    story: { hook: str(s.hook), tension: str(s.tension), turn: str(s.turn), payoff: str(s.payoff), cta: str(s.cta) },
    heroCut: objs(parsed.heroCut)
      .map((h) => ({ sceneId: realId(str(h.sceneId)), keep: h.keep === true || h.keep === 'true', reason: str(h.reason), time: str(h.time) }))
      .filter((h) => h.sceneId && (!known || known.has(h.sceneId)))
      .slice(0, MAX_HERO_CUT),
    shotList: objs(parsed.shotList).slice(0, MAX_SHOTS)
      .map((x) => ({ time: str(x.time), shot: str(x.shot), lens: str(x.lens), purpose: str(x.purpose) })),
    prompt,
    beatSheet: objs(parsed.beatSheet).map((b) => ({ time: str(b.time), beat: str(b.beat), emotion: str(b.emotion) })),
    dialogue: str(parsed.dialogue),
    voice: str(parsed.voice),
    qaChecklist: strList(parsed.qaChecklist),
    assumptions: strList(parsed.assumptions)
  };
}

// ---- planner blocks (pure; exported for tests) ----
const REF_ROLES = {
  'cast-portrait': (l) => `CAST ${l}: appearance only (face, hair, build, wardrobe); ignore background.`,
  'cast-sheet': () => 'CAST SHEET: appearance only for every cast member; ignore its layout.',
  environment: (l) => `LOCATION ${l}: the place only (layout, surfaces, light); no people or text.`,
  'brand-product': (l) => `PRODUCT ${l}: appearance only; exact shape, colour and packaging; never re-lettered.`,
  'brand-logo': () => 'LOGO: appearance only; at most on a physical object in the scene; never an overlay.',
  'scene-keyframe': (l) => `FRAME ${l}: composition and light only; identity from the cast refs.`
};

function referencesBlockFrom(refs) {
  if (!refs.length) return 'No reference images: write no image tags; describe people, place and product physically.';
  return refs.map((r) => {
    const role = REF_ROLES[r.source] || (() => `${String(r.kind || 'reference').toUpperCase()}: appearance only.`);
    return `${r.tag} - ${role(clip(r.label, 14) || r.kind)}`;
  }).join('\n');
}

function castBlockFrom(cast, refs) {
  const tagOf = (url) => (url && (refs.find((r) => r.url === url && r.kind === 'cast') || {}).tag) || '';
  const k = cast.length > 2 ? 2 / cast.length : 1; // 4 people get half the detail each
  const cap = (n) => Math.round(n * k);
  const lines = cast.map((c) => {
    const tag = tagOf(c.portraitUrl);
    const who = [clip(c.age, 12), clip(c.gender, 16)].filter(Boolean).join(', ');
    const parts = [
      `- ${clip(c.name, 24) || 'Unnamed'}${tag ? ` ${tag}` : ''}${who ? `: ${who}` : ''}${c.role ? `; ${clip(c.role, cap(50))}` : ''}.`,
      c.appearance && `Looks: ${clip(c.appearance, cap(120))}.`,
      (c.hairStyle || c.hairColor) && `Hair: ${clip(`${c.hairColor} ${c.hairStyle}`, cap(40))}.`,
      c.clothing && `Wears: ${clip(c.clothing, cap(80))}.`,
      c.personality && `Manner: ${clip(c.personality, cap(60))}.`
    ];
    return cut(parts.filter(Boolean).join(' '), Math.floor(CAST_BUDGET / Math.max(1, cast.length)) - 1);
  });
  const sheet = refs.find((r) => r.source === 'cast-sheet');
  if (sheet) lines.push(`Cast sheet: ${sheet.tag} shows the cast together.`);
  return lines.join('\n');
}

function environmentBlockFrom(env, refs) {
  const tags = refs.filter((r) => r.kind === 'environment').map((r) => r.tag);
  if (!env || !env.enabled) return 'No location chosen: pick one believable real place that fits the story and the audience, described with concrete objects.';
  const lines = [];
  if (env.notes) lines.push(`Notes: ${clip(env.notes, 150)}`);
  lines.push(tags.length
    ? `Location photos ${tags.join(', ')}: stage every beat in this place; keep its layout, surfaces and light.`
    : 'No location photo: build the place concretely from the notes.');
  return lines.join('\n');
}

function brandBlockFrom(brand, refs) {
  const products = refs.filter((r) => r.source === 'brand-product').map((r) => r.tag);
  const logo = refs.find((r) => r.source === 'brand-logo');
  const lines = [];
  if (brand.heroProduct || products.length) {
    const name = brand.heroProduct ? 'Hero product (see BRAND CONTEXT)' : 'Product';
    lines.push(`${name}${products.length ? ` ${products.join(', ')}` : ''}: show it in real use inside the story, not posed.`);
  } else {
    lines.push('No hero product on file: show the brand through what it does in the story; never invent packaging.');
  }
  if (logo) lines.push(`Logo ${logo.tag}: only on a physical item that belongs in the scene, if at all.`);
  if (brand.colors && brand.colors.length) lines.push(`Brand colours ${brand.colors.slice(0, 4).map((c) => clip(c, 20)).join(', ')}: as wardrobe or prop accents, never as graphics.`);
  if (brand.website) lines.push('The website and CTA go on the end card added after generation; never render them as text in the clip.');
  return lines.join('\n');
}

const SCENES_BUDGET = 900;
// Every character of a scene line (label, mark, title, cast, script, visual) counts inside its share of the budget.
function scenesBlockFrom(scenes, cast, kept) {
  const nameOf = new Map(cast.map((c) => [c.id, c.name || c.id]));
  const n = Math.max(1, scenes.length);
  const per = Math.floor(SCENES_BUDGET / n) - 1; // minus the newline
  const roomy = n <= 6;
  const lines = scenes.map((s, i) => {
    const mark = kept ? (kept.includes(s.sceneId) ? ' KEEP' : ' (dropped)') : '';
    const req = s.charactersRequired || [];
    const names = req.slice(0, 2).map((id) => clip(nameOf.get(id) || id, roomy ? 20 : 12));
    const who = names.length ? `, cast: ${names.join(', ')}${req.length > 2 ? ` +${req.length - 2}` : ''}` : '';
    const head = `- [S${i + 1}]${mark} ${clip(s.title, roomy ? 40 : 16) || 'Untitled'}, ${s.durationSeconds || '?'}s${who}.`;
    const room = per - head.length - 1;
    let body = '';
    if (room >= 90) {
      const scriptLen = Math.round((room - 18) * 0.6);
      body = [s.script && `Script: ${sentence(clip(s.script, scriptLen))}`, s.visual && `Visual: ${sentence(clip(s.visual, room - 18 - scriptLen))}`].filter(Boolean).join(' ');
    } else if (room >= 20 && s.script) {
      body = `Script: ${sentence(clip(s.script, room - 9))}`;
    }
    return cut([head, body].filter(Boolean).join(' '), per);
  });
  return cut(lines.join('\n'), SCENES_BUDGET);
}

function brandContextFrom(brand) {
  const tone = Array.isArray(brand.tone) ? brand.tone.slice(0, 4).map((t) => clip(t, 20)).filter(Boolean).join(', ') : '';
  const lines = [
    ['Brand', clip(brand.name, 60)],
    ['Industry', clip(brand.industry, 60)],
    ['Hero product', clip(brand.heroProduct, 80)],
    ['Audience', clip(brand.audience, 80)],
    ['Ideal customer', clip(brand.icp, 120)],
    ['Tone', tone]
  ].filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
  return lines.length ? lines.join('\n') : 'No brand profile on file.';
}

function buildPlanVars({ brief, brand, refs, styleBlock, audioMode, ctaText, keptSceneIds }) {
  const b = isObj(brand) ? brand : {};
  const r = Array.isArray(refs) ? refs : [];
  const c = brief.concept || {};
  const cast = brief.cast || [];
  const kept = Array.isArray(keptSceneIds) && keptSceneIds.length ? keptSceneIds : null;
  const cta = clip(ctaText, MAX_CTA);
  return {
    brandContextBlock: brandContextFrom(b),
    conceptTitle: clip(c.title, 80),
    conceptStory: clip(c.storySummary, 320),
    conceptEmotion: clip(c.coreEmotion, 80),
    conceptVisualStyle: clip(c.visualStyle, 120),
    castBlock: castBlockFrom(cast, r),
    environmentBlock: environmentBlockFrom(brief.environment, r),
    brandBlock: brandBlockFrom(b, r),
    scenesBlock: scenesBlockFrom(brief.scenes || [], cast, kept),
    referencesBlock: referencesBlockFrom(r),
    styleBlock: clipBlock(styleBlock, STYLE_BLOCK_MAX),
    duration: String(HERO_CLIP_SECONDS),
    aspectRatio: brief.aspectRatio || '9:16',
    language: clip(brief.language, 40) || 'English',
    audioMode: AUDIO_DIRECTIONS[audioMode] || AUDIO_DIRECTIONS.native,
    ctaText: cta ? `"${cta}" (the last beat leads into it; the end card shows it)` : 'None given: propose one short, honest CTA in story.cta.',
    brandName: clip(b.name, 80) || 'the brand'
  };
}

const publicRef = (r) => ({ tag: r.tag, kind: r.kind, label: r.label, url: r.url, source: r.source });
const brandSummary = (b) => ({ name: b.name || '', website: b.website || '', logoUrl: b.logoUrl || '', colors: Array.isArray(b.colors) ? b.colors : [], heroProduct: b.heroProduct || '' });

// Validates the /plan options; returns { error } or the cleaned options.
function readPlanOptions(body) {
  const style = body.style == null || body.style === '' ? DEFAULT_STYLE : body.style;
  if (!isHeroStyle(style)) return { error: 'Choose one of the listed video styles.' };
  const audioMode = body.audioMode == null || body.audioMode === '' ? 'native' : body.audioMode;
  if (!AUDIO_MODES.includes(audioMode)) return { error: 'Sound must be "native" or "sfx_only".' };
  if (body.ctaText != null && typeof body.ctaText !== 'string') return { error: 'The call to action must be text.' };
  const ctaText = str(body.ctaText);
  if (ctaText.length > MAX_CTA) return { error: `Keep the call to action to ${MAX_CTA} characters or fewer.` };
  if (body.references != null && !Array.isArray(body.references)) return { error: 'references must be a list of image links.' };
  if (body.keptSceneIds != null && !Array.isArray(body.keptSceneIds)) return { error: 'keptSceneIds must be a list of scene ids.' };
  const references = body.references == null ? null : [...new Set(strList(body.references))].slice(0, 50);
  const keptSceneIds = body.keptSceneIds == null ? null : [...new Set(strList(body.keptSceneIds))].slice(0, 12);
  const rawAspect = isObj(body.brief) ? body.brief.aspectRatio : undefined;
  if (rawAspect != null && rawAspect !== '' && !ASPECTS.includes(rawAspect)) return { error: `aspectRatio must be one of ${ASPECTS.join(', ')}` };
  return { style, audioMode, ctaText, references, keptSceneIds: keptSceneIds && keptSceneIds.length ? keptSceneIds : null };
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
    loadBrand: (...a) => require('../services/heroVideoBrief').loadBrand(...a),
    stageReferences: (...a) => require('../services/heroVideoBrief').stageReferences(...a),
    getStyleBlock: (...a) => require('../services/heroVideoStyles').getStyleBlock(...a)
  };
}

function createHeroVideoRouter(planDepsIn, impl = {}) {
  const planDeps = { ...lazyPlanDeps(), ...(planDepsIn || {}) };
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

  // Validates the wizard's hero brief, loads the client's brand server-side and stages the references.
  // No LLM call and no charge. Environment data URLs come back replaced by their staged https URL,
  // so the client sends a brief to /plan whose references can be matched against the staged set.
  router.post('/brief', protect, checkTrial, heroReadLimiter, async (req, res) => {
    try {
      const body = req.body || {};
      const n = normalizeHeroBrief(body.brief);
      if (!n.ok) return res.status(400).json({ success: false, message: n.message });
      const brief = n.brief;
      const brand = await planDeps.loadBrand(toUserId(req.user));
      const candidates = selectReferences(brief, brand).map((r) => (r.dataUrl && !r.url ? { ...r, _src: r.dataUrl } : r));
      const staged = await planDeps.stageReferences(candidates);
      const uploaded = new Map(staged.refs.filter((r) => r._src).map((r) => [r._src, r.url]));
      brief.environment.images = brief.environment.images
        .map((im) => (im.url ? { url: im.url, alt: im.alt } : uploaded.has(im.dataUrl) ? { url: uploaded.get(im.dataUrl), alt: im.alt } : null))
        .filter(Boolean);
      return res.json({
        success: true,
        brief,
        brand: brandSummary(brand || {}),
        references: staged.refs.map(publicRef),
        dropped: staged.dropped || []
      });
    } catch (err) {
      return fail(res, err, 'Failed to prepare brief');
    }
  });

  router.post('/plan', protect, checkTrial, heroWriteLimiter, async (req, res) => {
    try {
      const body = req.body || {};
      const opts = readPlanOptions(body);
      if (opts.error) return res.status(400).json({ success: false, message: opts.error });
      const n = normalizeHeroBrief(body.brief);
      if (!n.ok) return res.status(400).json({ success: false, message: n.message });
      const brief = n.brief;
      const sceneIds = brief.scenes.map((s) => s.sceneId);
      // Unknown ids are ignored; nothing left means "no preference".
      const kept = (opts.keptSceneIds || []).filter((id) => sceneIds.includes(id));
      opts.keptSceneIds = kept.length ? kept : null;
      const userId = toUserId(req.user);
      // Brand and references are recomputed here; the client's list can only select from them.
      const brand = (await planDeps.loadBrand(userId)) || {};
      let candidates = selectReferences(brief, brand, { keptSceneIds: opts.keptSceneIds || undefined });
      if (opts.references) {
        const order = opts.references;
        candidates = candidates
          .filter((r) => r.url && order.includes(r.url))
          .sort((a, b) => order.indexOf(a.url) - order.indexOf(b.url));
      }
      const staged = await planDeps.stageReferences(candidates);
      const refs = staged.refs.map(publicRef);
      const styleBlock = await planDeps.getStyleBlock(opts.style, userId);
      const vars = buildPlanVars({ brief, brand, refs, styleBlock, audioMode: opts.audioMode, ctaText: opts.ctaText, keptSceneIds: opts.keptSceneIds });
      const prompt = await planDeps.buildPrompt(userId, 'hero_video.plan', vars);
      const raw = await planDeps.callTextLLM(prompt, { jsonMode: true, maxTokens: 6000 });
      let parsed = null;
      try { parsed = planDeps.parseGeminiJSON(raw); } catch (_) { parsed = null; }
      const plan = normalizePlan(parsed, { sceneIds });
      if (!plan) return res.status(502).json({ success: false, message: 'Model returned no prompt. Please try again.' });
      return res.json({ success: true, plan, references: refs });
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
        if (j.status === 'completed' && j.result && j.result.videoUrl) {
          o.videoUrl = j.result.videoUrl;
          if (j.result.rawVideoUrl) o.rawVideoUrl = j.result.rawVideoUrl;
          if (j.result.finishError) o.finishError = j.result.finishError;
        }
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
router.buildPlanVars = buildPlanVars;
module.exports = router;
