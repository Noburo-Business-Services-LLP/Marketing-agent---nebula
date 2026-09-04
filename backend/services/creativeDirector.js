const { callGemini, parseGeminiJSON } = require('./geminiAI');
const { buildPrompt } = require('./promptRegistry');
const {
  buildBrandMemoryBlock,
  buildAvailableAssetsCatalogue,
  resolveAssetNames,
  buildBrandGuidance
} = require('./brandMemory');
const Draft = require('../models/Draft');

/**
 * The two-stage decision pipeline shared by Single post, Carousel and
 * Campaign: a Creative Director decides what the creative should be and
 * which real assets it needs, then an Art Director turns that decision into
 * the actual image instruction — deliberately without the brand context the
 * Creative Director used to decide.
 *
 * The point of splitting it this way: the image model must not see the full
 * brand memory, the asset catalogue, or the Creative Director's own prompt.
 * It receives only the decision and the specific assets chosen for it.
 * Everything here is orchestration; the prompt text itself lives in
 * promptRegistry.js as 'creative.director' and 'image.artDirector'.
 */

/** How the last few concepts are shown back, so the next decision can avoid repeating them. */
function formatPreviousCreatives(list) {
  const items = (Array.isArray(list) ? list : []).filter((c) => c?.concept);
  if (items.length === 0) return 'None yet — this is the first in this set.';
  return items
    .map((c, i) => `${i + 1}. Concept: ${c.concept}${c.treatment ? ` | Treatment: ${c.treatment}` : ''}`)
    .join('\n');
}

/**
 * Runs the Creative Director for one creative and resolves whatever assets
 * it asked for back to real URLs.
 *
 * `previousCreatives` should be whatever this caller has already decided in
 * the same run (earlier slides of this carousel, earlier posts of this
 * campaign) — that is what lets each one consciously vary instead of
 * cloning the first. A single post has no siblings to compare against, so
 * callers pass recent unrelated posts there instead, or an empty list.
 */
async function runCreativeDirector(userId, {
  idea, contentType, contentPillar, objective, platform, campaignContext, previousCreatives
}) {
  const [brandContext, assets] = await Promise.all([
    buildBrandMemoryBlock(userId),
    buildAvailableAssetsCatalogue(userId)
  ]);

  const prompt = await buildPrompt(userId, 'creative.director', {
    idea: idea || '',
    contentType: contentType || 'post',
    contentPillar: contentPillar || '',
    objective: objective || '',
    platform: platform || '',
    campaignContext: campaignContext || '',
    brandContext,
    availableAssets: assets.text,
    previousCreatives: formatPreviousCreatives(previousCreatives)
  });

  const decision = await getDecisionJSON(prompt);

  const requiredAssets = resolveAssetNames(decision.requiredAssets, assets.catalogue);
  const optionalAssets = resolveAssetNames(decision.optionalAssets, assets.catalogue);

  return {
    creativeConcept: toText(decision.creativeConcept),
    visualTreatment: toText(decision.visualTreatment),
    imageText: toText(decision.imageText),
    cta: toText(decision.cta),
    // A fallback only — used if the Art Director pass below fails. The
    // Art Director's own output is what actually reaches the image model.
    draftImagePrompt: toText(decision.imagePrompt),
    requiredAssets,
    optionalAssets
  };
}

/**
 * Calls the Creative Director and gets back a usable decision object.
 *
 * Observed in testing: the model sometimes ignores "return ONLY JSON" and
 * narrates its reasoning first ("I need to create a social media post...
 * Here's a breakdown of the thinking process...") with no JSON ever
 * following, which the shared parseGeminiJSON reasonably reports as a parse
 * failure rather than papering over — it is used across many other callers
 * and should keep failing loudly for them. Scoped to this one call site: if
 * the first attempt comes back empty, try pulling the substring between the
 * first "{" and the last "}" (recovers a real object buried after prose),
 * and if that still fails, ask once more with a sharper reminder. Two
 * cheap attempts before giving up, rather than one and silently proceeding
 * with an empty decision.
 */
/**
 * Coerces one field of a model's JSON response into readable text.
 *
 * The schemas ask for a plain string, but observed in testing: the model
 * sometimes answers with a nested object instead (e.g. visualSystem as
 * {colorPalette, lighting, ...} rather than one descriptive sentence).
 * String(anObject) silently produces the literal text "[object Object]" —
 * which had been landing in the stored plan, and worse, being fed straight
 * into the next call as if it were real guidance. This flattens an object
 * into readable "key: value" lines instead of stringifying it uselessly.
 */
function toText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
      .join('; ');
  }
  return String(value).trim();
}

async function getJSONWithRetry(prompt, isUsable, label = 'CreativeDirector') {
  const attempt1 = await callGemini(prompt);
  let result = parseGeminiJSON(attempt1) || {};
  if (isUsable(result)) return result;

  const start = attempt1.indexOf('{');
  const end = attempt1.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      const recovered = JSON.parse(attempt1.slice(start, end + 1));
      if (isUsable(recovered)) return recovered;
    } catch (_) { /* still not valid JSON — fall through to the retry */ }
  }

  console.warn(`[${label}] First attempt returned no usable JSON, retrying once.`);
  const attempt2 = await callGemini(
    `${prompt}\n\nReturn ONLY the JSON object. No explanation, no reasoning, no markdown — the response must start with { and end with }.`,
    { skipCache: true }
  );
  result = parseGeminiJSON(attempt2) || {};
  if (!isUsable(result)) {
    console.error(`[${label}] Second attempt also returned no usable JSON. Proceeding with what came back.`);
  }
  return result;
}

async function getDecisionJSON(prompt) {
  return getJSONWithRetry(prompt, (d) => Boolean(d?.creativeConcept));
}

function describeAssets(list) {
  if (!list.length) return 'None.';
  return list.map((a) => `- ${a.label} (${a.kind})`).join('\n');
}

/**
 * Turns a Creative Director decision into the final image instruction.
 * Returns plain text — this prompt's own output contract is "return only the
 * final image-generation prompt", not JSON.
 */
async function runImageArtDirector(userId, decision, { aspectRatio, language }) {
  const relevantBrandGuidance = await buildBrandGuidance(userId);

  const prompt = await buildPrompt(userId, 'image.artDirector', {
    creativeConcept: decision.creativeConcept,
    visualTreatment: decision.visualTreatment,
    imageText: decision.imageText,
    requiredAssets: describeAssets(decision.requiredAssets),
    optionalAssets: describeAssets(decision.optionalAssets),
    relevantBrandGuidance,
    aspectRatio: aspectRatio || '1:1',
    language: language || 'English'
  });

  const raw = await callGemini(prompt);
  return extractFinalPrompt(raw);
}

/**
 * The prompt says "return only the final image-generation prompt", but the
 * model does not always obey that literally — observed in testing: a
 * conversational lead-in ("Here's the prompt for the image generation:")
 * followed by a fenced JSON object shaped like a Midjourney/SDXL parameter
 * set ({ prompt, negative_prompt, aspect_ratio, ... }), not plain text. This
 * pulls the actual instruction out of whatever shape came back, in order:
 * a JSON object with a recognizable prompt field, then a fenced code block,
 * then a leading "label:" line, then the raw text as a last resort.
 */
function extractFinalPrompt(raw) {
  let text = String(raw || '').trim();

  const fenced = text.match(/```[a-z]*\n([\s\S]*?)```/i);
  const jsonCandidate = fenced ? fenced[1].trim() : text;
  if (jsonCandidate.startsWith('{')) {
    try {
      const parsed = JSON.parse(jsonCandidate);
      const value = parsed.prompt || parsed.imagePrompt || parsed.image_prompt || parsed.description;
      if (typeof value === 'string' && value.trim()) return value.trim();
    } catch (_) { /* not valid JSON — fall through to the text handling below */ }
  }

  if (fenced) text = text.replace(fenced[0], fenced[1]).trim();
  text = text.replace(/^```[a-z]*\n?/i, '').replace(/```$/, '').trim();

  // A single short line ending in ':' before the real content — the
  // conversational lead-in this is guarding against.
  const lines = text.split('\n');
  if (lines.length > 1 && /:\s*$/.test(lines[0]) && lines[0].length < 80) {
    text = lines.slice(1).join('\n').trim();
  }

  return text;
}

/**
 * Runs both stages and returns exactly what the image call needs: the final
 * prompt text, and the specific asset URLs to attach — nothing else. This is
 * the boundary the rest of the app should call through, rather than each
 * route re-deriving it.
 */
/** A resolved asset list (kind + url pairs) -> the shape generateCampaignImageNanoBanana's options expect. Shared by the single-post and carousel flows so a "product" resolves to a reference image the same way in both. */
function assetsToImageOptions(assets) {
  const productImages = assets.filter((a) => a.kind === 'product' || a.kind === 'service').map((a) => a.url);
  const environmentImage = assets.find((a) => a.kind === 'environment')?.url || null;
  const logoUrl = assets.find((a) => a.kind === 'logo')?.url || null;
  return { productImages, environmentImage, logoUrl };
}

async function decideCreative(userId, ideaInput, imageInput) {
  const decision = await runCreativeDirector(userId, ideaInput);
  const finalPrompt = await runImageArtDirector(userId, decision, imageInput) || decision.draftImagePrompt;

  const { productImages, environmentImage, logoUrl } = assetsToImageOptions([
    ...decision.requiredAssets,
    ...decision.optionalAssets
  ]);

  return {
    finalPrompt,
    creativeConcept: decision.creativeConcept,
    visualTreatment: decision.visualTreatment,
    imageText: decision.imageText,
    cta: decision.cta,
    productImages,
    environmentImage,
    logoUrl
  };
}

/**
 * The last few creatives this account made (standalone posts, and other
 * carousels' own top-level concept), so a fresh run does not land on the
 * same visual idea as something generated recently. A carousel's own slides
 * compare against each other through the master plan itself; this is for
 * variety against the account's OTHER work.
 */
async function getRecentCreativeHistory(userId, limit = 4) {
  const recent = await Draft.find({ userId, creativeConcept: { $ne: '' } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .select('creativeConcept visualTreatment')
    .lean();
  return recent.map((d) => ({ concept: d.creativeConcept, treatment: d.visualTreatment }));
}

/**
 * Step 1 of two for a carousel: one call that plans the whole experience —
 * core idea, narrative, ONE visual world, a swipe mechanism, and a
 * first-draft image prompt for every slide. Deliberately not one decision
 * per slide: a carousel is one creative told in parts, not N independent
 * posts that happen to share a topic, and the parts have to be decided
 * together for the story and the visual world to actually cohere.
 *
 * Returns the plan with each slide's requiredAssets/optionalAssets already
 * resolved to real URLs, so the render step never has to touch the asset
 * catalogue itself.
 */
async function planCarousel(userId, {
  idea, contentType, contentPillar, objective, platform, campaignContext
}) {
  const [brandContext, assets, previousCreatives] = await Promise.all([
    buildBrandMemoryBlock(userId),
    buildAvailableAssetsCatalogue(userId),
    getRecentCreativeHistory(userId)
  ]);

  const prompt = await buildPrompt(userId, 'carousel.masterPlan', {
    idea: idea || '',
    contentType: contentType || 'carousel',
    contentPillar: contentPillar || '',
    objective: objective || '',
    platform: platform || '',
    campaignContext: campaignContext || '',
    brandContext,
    availableAssets: assets.text,
    previousCreatives: formatPreviousCreatives(previousCreatives)
  });

  const plan = await getJSONWithRetry(prompt, (p) => Array.isArray(p?.slides) && p.slides.length > 0, 'CarouselPlan');

  const slides = (Array.isArray(plan.slides) ? plan.slides : []).map((s) => ({
    order: Number(s.order) || 0,
    role: toText(s.role),
    storyPurpose: toText(s.storyPurpose),
    creativeConcept: toText(s.creativeConcept),
    imageText: toText(s.imageText),
    imagePrompt: toText(s.imagePrompt),
    requiredAssets: resolveAssetNames(s.requiredAssets, assets.catalogue),
    optionalAssets: resolveAssetNames(s.optionalAssets, assets.catalogue)
  }));

  return {
    creativeConcept: toText(plan.creativeConcept),
    narrativeApproach: toText(plan.narrativeApproach),
    visualSystem: toText(plan.visualSystem),
    swipeMechanism: toText(plan.swipeMechanism),
    caption: toText(plan.caption),
    hashtags: Array.isArray(plan.hashtags) ? plan.hashtags : [],
    slides
  };
}

/** A compact view of the master plan for the Art Director — every slide's
 * role and purpose, so it knows what surrounds this one, without repeating
 * each slide's full draft prompt back into every other slide's call. */
function summarizePlanForArtDirector(plan) {
  return JSON.stringify({
    creativeConcept: plan.creativeConcept,
    narrativeApproach: plan.narrativeApproach,
    visualSystem: plan.visualSystem,
    swipeMechanism: plan.swipeMechanism,
    slides: plan.slides.map((s) => ({ order: s.order, role: s.role, storyPurpose: s.storyPurpose, imageText: s.imageText }))
  }, null, 2);
}

/**
 * Step 2 of two: turn one slide's already-decided plan into the final image
 * instruction, respecting the whole carousel's visual system rather than
 * redesigning the slide from scratch. Returns plain text, same contract as
 * the single-post Art Director — "return only the final prompt" — and the
 * same recovery is needed when that is not followed literally.
 */
async function renderCarouselSlideImage(userId, plan, slideIndex) {
  const slide = plan.slides[slideIndex];
  const brandAssets = await buildBrandGuidance(userId);

  const prompt = await buildPrompt(userId, 'carousel.artDirector', {
    carouselPlan: summarizePlanForArtDirector(plan),
    slide: JSON.stringify({
      order: slide.order,
      role: slide.role,
      storyPurpose: slide.storyPurpose,
      creativeConcept: slide.creativeConcept,
      imageText: slide.imageText,
      imagePrompt: slide.imagePrompt
    }, null, 2),
    slideAssets: describeAssets([...slide.requiredAssets, ...slide.optionalAssets]),
    brandAssets
  });

  const raw = await callGemini(prompt);
  return extractFinalPrompt(raw) || slide.imagePrompt;
}

module.exports = {
  runCreativeDirector,
  runImageArtDirector,
  decideCreative,
  formatPreviousCreatives,
  getRecentCreativeHistory,
  planCarousel,
  renderCarouselSlideImage,
  assetsToImageOptions
};
