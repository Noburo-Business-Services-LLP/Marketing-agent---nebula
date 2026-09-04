const { callGemini, parseGeminiJSON } = require('./geminiAI');
const { buildPrompt } = require('./promptRegistry');
const {
  buildBrandMemoryBlock,
  buildAvailableAssetsCatalogue,
  resolveAssetNames,
  buildBrandGuidance
} = require('./brandMemory');

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
    creativeConcept: String(decision.creativeConcept || '').trim(),
    visualTreatment: String(decision.visualTreatment || '').trim(),
    imageText: String(decision.imageText || '').trim(),
    cta: String(decision.cta || '').trim(),
    // A fallback only — used if the Art Director pass below fails. The
    // Art Director's own output is what actually reaches the image model.
    draftImagePrompt: String(decision.imagePrompt || '').trim(),
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
async function getDecisionJSON(prompt) {
  const attempt1 = await callGemini(prompt);
  let decision = parseGeminiJSON(attempt1) || {};
  if (decision.creativeConcept) return decision;

  const start = attempt1.indexOf('{');
  const end = attempt1.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      const recovered = JSON.parse(attempt1.slice(start, end + 1));
      if (recovered?.creativeConcept) return recovered;
    } catch (_) { /* still not valid JSON — fall through to the retry */ }
  }

  console.warn('[CreativeDirector] First attempt returned no usable JSON, retrying once.');
  const attempt2 = await callGemini(
    `${prompt}\n\nReturn ONLY the JSON object. No explanation, no reasoning, no markdown — the response must start with { and end with }.`,
    { skipCache: true }
  );
  decision = parseGeminiJSON(attempt2) || {};
  if (!decision.creativeConcept) {
    console.error('[CreativeDirector] Second attempt also returned no usable JSON. Proceeding with an empty decision.');
  }
  return decision;
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
async function decideCreative(userId, ideaInput, imageInput) {
  const decision = await runCreativeDirector(userId, ideaInput);
  const finalPrompt = await runImageArtDirector(userId, decision, imageInput) || decision.draftImagePrompt;

  const allAssets = [...decision.requiredAssets, ...decision.optionalAssets];
  const productImages = allAssets.filter((a) => a.kind === 'product' || a.kind === 'service').map((a) => a.url);
  const environmentImage = allAssets.find((a) => a.kind === 'environment')?.url || null;
  const logoUrl = allAssets.find((a) => a.kind === 'logo')?.url || null;

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

module.exports = { runCreativeDirector, runImageArtDirector, decideCreative, formatPreviousCreatives };
