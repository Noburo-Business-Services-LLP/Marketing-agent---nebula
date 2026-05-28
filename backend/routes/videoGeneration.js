const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = rateLimit;

const Product = require('../models/Product');
const { protect } = require('../middleware/auth');
const { checkTrial, deductCredits, refundCredits } = require('../middleware/trialGuard');
const { getPublicBaseUrl } = require('../utils/toneAudio');
const { videoGenerationQueue } = require('../services/videoGenerationQueue');
const {
  runCreateVideoPipeline,
  runGenerateScenes,
  runGenerateImages,
  runGenerateVideoClips,
  runGenerateAudio,
  runMergeAudio,
  runMergeVideo
} = require('../services/videoGenerationPipeline');
const {
  createDraft,
  listDraftsForUser,
  loadDraftForUser,
  deleteDraftForUser,
  updateDraft,
  buildMediaUrl,
  toUserId,
  saveDataUrlToJob
} = require('../services/videoDraftStore');
const { callGemini, parseGeminiJSON, generateCampaignImageNanoBanana } = require('../services/geminiAI');
const { buildAIContext } = require('../services/aiContextBuilder');
const { learnVideoStep } = require('../services/aiVideoLearning');

// -----------------------------------------------------------------------------
// Register persistent background handlers for queue tasks
// -----------------------------------------------------------------------------
videoGenerationQueue.registerHandler('create_video_pipeline', async (payload, { update, log }) => {
  return runCreateVideoPipeline({
    payload: payload.payload,
    user: payload.user,
    baseUrl: payload.baseUrl,
    providedJobId: null,
    onProgress: ({ progress, currentStep, metadata }) => update({ progress, currentStep, metadata }),
    onLog: (line) => log(line)
  });
});

videoGenerationQueue.registerHandler('generate_clips', async (payload, { update, log }) => {
  const { jobId, userId, sourceScenes, baseUrl } = payload;
  await update({ progress: 5, currentStep: 'generate_clips' });
  await log(`Generating clips for draft ${jobId}`);

  const generated = await runGenerateVideoClips({
    payload: { jobId, sceneData: sourceScenes },
    baseUrl,
    onLog: (line) => log(line),
    onProgress: ({ progress, currentStep, metadata } = {}) => update({ progress, currentStep, metadata })
  });

  await update({ progress: 70, currentStep: 'saving_clips' });
  const nextScenes = generated.sceneData || [];
  const updated = await updateDraft(jobId, userId, (current) => ({
    ...current,
    currentStep: Math.max(Number(current.currentStep || 1), 4),
    scenes: nextScenes,
    images: current?.images?.sceneData?.length
      ? {
        ...(current.images || {}),
        sceneData: mergeClipUrlsIntoScenes(current.images.sceneData, generated.sceneData || []),
        generatedAt: current.images.generatedAt || new Date().toISOString()
      }
      : (current.images || null),
    clips: {
      sceneData: generated.sceneData || [],
      clipUrls: generated.clipUrls || [],
      generatedAt: new Date().toISOString()
    }
  }));

  try {
    const VideoDraft = require('../models/VideoDraft');
    const draftDoc = await VideoDraft.findOne({ jobId });
    if (draftDoc) {
      draftDoc.scenes = nextScenes;
      await draftDoc.save();
    }
  } catch (saveErr) {
    console.error("⚠️ Failed to immediately save background draft scenes clipUrl in MongoDB:", saveErr.message);
  }

  await update({ progress: 90, currentStep: 'learning' });
  try {
    const draft = await loadDraftForUser(jobId, userId);
    await learnVideoStep({
      userId,
      jobId,
      action: 'clip_generation',
      prompt: draft?.prompt?.promptText || '',
      userInput: draft.input || {},
      sceneData: updated.clips.sceneData,
      generatedVideos: updated.clips.clipUrls || [],
      product: draft?.input?.product || null
    });
  } catch (learnError) {
    await log(`⚠️ AI learning step skipped: ${learnError.message}`);
  }

  return {
    success: true,
    jobId,
    sceneData: updated.clips.sceneData,
    clipUrls: updated.clips.clipUrls,
    draft: updated
  };
});

videoGenerationQueue.registerHandler('merge_video', async (payload, { update, log }) => {
  const { jobId, userId, effectiveClipUrls, finalAudioUrl, subtitles, baseUrl } = payload;
  await update({ progress: 5, currentStep: 'merge_video' });
  await log(`Merging video for draft ${jobId}`);

  const draft = await loadDraftForUser(jobId, userId);

  const translatedSceneData = Array.isArray(draft?.audio?.config?.localizedSceneData)
    ? draft.audio.config.localizedSceneData
    : null;
  const sceneDataForSubtitles =
    subtitles?.enabled === true && draft?.audio?.config?.languageCode && draft.audio.config.languageCode !== 'en' && translatedSceneData?.length
      ? translatedSceneData
      : (draft?.clips?.sceneData || draft?.images?.sceneData || draft?.scenes?.sceneData || []);

  const merged = await runMergeVideo({
    payload: {
      jobId,
      clipUrls: effectiveClipUrls,
      finalAudioUrl: finalAudioUrl || draft?.mix?.finalAudioUrl || null,
      subtitles: { enabled: subtitles?.enabled === true },
      sceneData: sceneDataForSubtitles
    },
    baseUrl,
    onProgress: ({ progress, currentStep, metadata }) => update({ progress, currentStep, metadata }),
    onLog: (line) => log(line)
  });

  await update({ progress: 80, currentStep: 'saving_merge' });
  const finalVideoUrl = merged?.finalOutputUrl || merged?.finalVideoUrl || null;
  const updated = await updateDraft(jobId, userId, (current) => ({
    ...current,
    currentStep: Math.max(Number(current.currentStep || 1), 7),
    finalVideoUrl,
    merge: {
      finalVideoUrl: merged?.finalVideoUrl || null,
      finalOutputUrl: merged?.finalOutputUrl || null,
      subtitlesUrl: merged?.subtitlesUrl || null,
      mergedAt: new Date().toISOString()
    }
  }));

  try {
    const VideoDraft = require('../models/VideoDraft');
    const draftDoc = await VideoDraft.findOne({ jobId });
    if (draftDoc) {
      draftDoc.finalVideoUrl = finalVideoUrl;
      await draftDoc.save();
    }
  } catch (saveErr) {
    console.error("⚠️ Failed to immediately save background draft finalVideoUrl in MongoDB:", saveErr.message);
  }

  await update({ progress: 90, currentStep: 'learning' });
  try {
    await learnVideoStep({
      userId,
      jobId,
      action: 'video_merge',
      prompt: draft?.prompt?.promptText || '',
      userInput: draft.input || {},
      sceneData: draft?.clips?.sceneData || draft?.images?.sceneData || draft?.scenes?.sceneData || [],
      generatedVideos: [updated.merge.finalOutputUrl || updated.merge.finalVideoUrl].filter(Boolean),
      audioSettings: draft?.audio?.config || {},
      duration: draft?.input?.durationSeconds || null,
      product: draft?.input?.product || null,
      sourceResponse: merged
    });
  } catch (learnError) {
    await log(`⚠️ AI learning step skipped: ${learnError.message}`);
  }

  return {
    success: true,
    jobId,
    merge: merged,
    draft: updated
  };
});

// Keep heavy AI generation protected, but allow frequent job polling.
const videoAiWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many AI generation requests, please try again later.' },
  keyGenerator: (req) => String(req.user?._id || req.user?.id || ipKeyGenerator(req.ip))
});

const videoJobReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many job status requests, please try again later.' },
  keyGenerator: (req) => String(req.user?._id || req.user?.id || ipKeyGenerator(req.ip))
});

function responseError(res, error, fallbackMessage) {
  const statusCode = Number(error?.statusCode) || 500;
  return res.status(statusCode).json({
    success: false,
    message: error?.message || fallbackMessage || 'Request failed',
    error: process.env.NODE_ENV === 'development' ? (error?.stack || String(error)) : undefined
  });
}

function reqBaseUrl(req) {
  return getPublicBaseUrl({ req });
}

function normalizePlatforms(rawPlatforms) {
  const allowed = new Set(['instagram', 'facebook', 'linkedin', 'youtube']);
  const input = Array.isArray(rawPlatforms) ? rawPlatforms : [];
  return Array.from(
    new Set(
      input
        .map((item) => String(item || '').trim().toLowerCase())
        .filter((item) => allowed.has(item))
    )
  );
}

function normalizedDurationSeconds(raw, fallback = 60) {
  const n = Number.parseInt(String(raw || ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(6, Math.min(180, n));
}

function normalizeAudioLanguageCode(code = 'en') {
  const normalized = String(code || '').toLowerCase().trim().split(/[-_]/)[0];
  const allowed = new Set(['en', 'hi', 'ta', 'te', 'kn', 'ml']);
  return allowed.has(normalized) ? normalized : 'en';
}

function audioLanguageLabel(code = 'en') {
  const labels = {
    en: 'English',
    hi: 'Hindi',
    ta: 'Tamil',
    te: 'Telugu',
    kn: 'Kannada',
    ml: 'Malayalam'
  };
  return labels[normalizeAudioLanguageCode(code)] || labels.en;
}

function audioScriptLabel(code = 'en') {
  const labels = {
    en: 'Latin',
    hi: 'Devanagari',
    ta: 'Tamil',
    te: 'Telugu',
    kn: 'Kannada',
    ml: 'Malayalam'
  };
  return labels[normalizeAudioLanguageCode(code)] || labels.en;
}

async function localizeAudioScript({ text, languageCode }) {
  const source = String(text || '').replace(/\s+/g, ' ').trim();
  const normalizedLanguage = normalizeAudioLanguageCode(languageCode);
  if (!source || normalizedLanguage === 'en') return source;

  const language = audioLanguageLabel(normalizedLanguage);
  const script = audioScriptLabel(normalizedLanguage);
  const prompt = `Translate and adapt this short reel voiceover for text-to-speech.

Target language: ${language}
Target script: ${script}

Rules:
- Return only the final voiceover text. No markdown, labels, or quotes.
- Translate the narration into ${language}; do not return English for this target language.
- Keep brand names, product names, prices, URLs, and technical model names unchanged when needed.
- Keep it natural for a short social media reel.

Voiceover:
${source}`;

  try {
    const localized = await callGemini(prompt, {
      skipCache: true,
      temperature: 0.25,
      maxTokens: 900,
      timeout: 45000
    });
    const clean = String(localized || '')
      .replace(/^```(?:\w+)?/i, '')
      .replace(/```$/i, '')
      .replace(/^\s*(?:voiceover|translation|translated text)\s*:\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    return clean || source;
  } catch (_) {
    return source;
  }
}

function sanitizeSceneData(sceneData = [], totalDurationSeconds = 60) {
  const input = Array.isArray(sceneData) ? sceneData : [];
  if (!input.length) return [];
  const safeTotal = normalizedDurationSeconds(totalDurationSeconds, 60);

  const durations = input.map((scene) => {
    const n = Number(scene?.durationSeconds || scene?.duration);
    return Number.isFinite(n) && n > 0 ? n : null;
  });
  const hasAllDurations = durations.every((value) => Number.isFinite(value));
  const defaultDur = Math.max(1, Math.floor(safeTotal / input.length));
  const effective = hasAllDurations ? durations : input.map(() => defaultDur);

  let sum = effective.reduce((acc, value) => acc + Number(value || 0), 0);
  if (sum <= 0) sum = safeTotal;
  let scaled = effective.map((value) => Math.max(1, Math.round((value / sum) * safeTotal)));
  let scaledSum = scaled.reduce((acc, value) => acc + value, 0);
  if (scaledSum !== safeTotal) {
    const last = scaled.length - 1;
    scaled[last] = Math.max(1, scaled[last] + (safeTotal - scaledSum));
    scaledSum = scaled.reduce((acc, value) => acc + value, 0);
    if (scaledSum !== safeTotal && scaled.length > 0) {
      scaled[0] = Math.max(1, scaled[0] + (safeTotal - scaledSum));
    }
  }

  let cursor = 0;
  return input.map((scene, index) => {
    const durationSeconds = scaled[index];
    const startSec = cursor;
    const endSec = cursor + durationSeconds;
    cursor = endSec;
    const sceneId = String(scene?.sceneId || scene?.id || `scene_${index + 1}`);
    const imageUrl = scene?.imageUrl || scene?.image_url;
    const clipUrl = scene?.clipUrl || scene?.clip_url;
    const videoUrl = scene?.video_url || scene?.videoUrl || scene?.falVideoUrl;

    return {
      index: Number.parseInt(String(scene?.index || index + 1), 10) || (index + 1),
      sceneId,
      title: String(scene?.title || `Scene ${index + 1}`),
      durationSeconds,
      startSec,
      endSec,
      imagePrompt: String(scene?.imagePrompt || scene?.image_prompt || '').trim(),
      videoPrompt: String(scene?.videoPrompt || scene?.video_prompt || '').trim(),
      voiceLine: String(scene?.voiceLine || '').trim(),
      onScreenText: String(scene?.onScreenText || '').trim(),
      imageUrl: imageUrl ? String(imageUrl) : undefined,
      video_url: videoUrl ? String(videoUrl) : undefined,
      videoUrl: videoUrl ? String(videoUrl) : undefined,
      clipUrl: clipUrl ? String(clipUrl) : undefined
    };
  });
}

function deriveWizardStepFromDraft(draft = {}) {
  const derived = [];
  if (draft?.prompt?.promptText) derived.push(2);
  if (Array.isArray(draft?.scenes) && draft.scenes.length) derived.push(2);
  if (Array.isArray(draft?.scenes?.sceneData) && draft.scenes.sceneData.length) derived.push(2);
  if (Array.isArray(draft?.scenes) && draft.scenes.some((s) => s?.imageUrl)) derived.push(3);
  if (Array.isArray(draft?.images?.sceneData) && draft.images.sceneData.some((s) => s?.imageUrl)) derived.push(3);
  if (Array.isArray(draft?.scenes) && draft.scenes.some((s) => s?.clipUrl)) derived.push(4);
  if (Array.isArray(draft?.clips?.clipUrls) && draft.clips.clipUrls.length) derived.push(4);
  if (draft?.audio?.tracks && (draft.audio.tracks.voiceUrl || draft.audio.tracks.manualUrl)) derived.push(5);
  if (draft?.mix?.finalAudioUrl) derived.push(6);
  if (draft?.finalVideoUrl || draft?.merge?.finalOutputUrl || draft?.merge?.finalVideoUrl) derived.push(7);
  if (draft?.thumbnailUrl || draft?.content?.thumbnailUrl || draft?.content?.caption) derived.push(8);
  if (Array.isArray(draft?.platform?.selectedPlatforms) && draft.platform.selectedPlatforms.length) derived.push(9);
  if (draft?.schedule?.scheduledAt || draft?.schedule?.status) derived.push(10);

  const current = Number(draft?.currentStep || 1) || 1;
  return Math.max(current, derived.length ? Math.max(...derived) : 1);
}

function deriveVoiceScriptFromDraft(draft = {}) {
  const explicit = String(draft?.scenesMetadata?.voiceScript || draft?.scenes?.voiceScript || '').trim();
  if (explicit) return explicit;

  const scenesArray = Array.isArray(draft?.scenes) ? draft.scenes : (draft?.scenes?.sceneData || []);
  const sceneLines = scenesArray.map((scene) => String(scene?.voiceLine || '').trim()).filter(Boolean);
  if (sceneLines.length) return sceneLines.join(' ');

  const promptText = String(draft?.prompt?.promptText || '').trim();
  if (promptText) return promptText;

  return String(draft?.input?.description || '').trim();
}

function mergeClipUrlsIntoScenes(existingScenes = [], clipScenes = []) {
  const base = Array.isArray(existingScenes) ? existingScenes : [];
  const clips = Array.isArray(clipScenes) ? clipScenes : [];
  if (!base.length || !clips.length) return base;

  const bySceneId = new Map(
    clips
      .map((scene) => [String(scene?.sceneId || ''), scene])
      .filter(([key]) => Boolean(key))
  );

  return base.map((scene, idx) => {
    const sceneId = String(scene?.sceneId || '');
    const clipMatch =
      (sceneId && bySceneId.get(sceneId)) ||
      clips[idx] ||
      null;
    if (!clipMatch?.clipUrl) return scene;
    return {
      ...scene,
      clipUrl: clipMatch.clipUrl
    };
  });
}

async function resolveProductFromPayload({ payload, user }) {
  if (payload?.product && typeof payload.product === 'object') {
    return payload.product;
  }
  const productId = String(payload?.productId || '').trim();
  if (!productId) return null;

  try {
    const userId = toUserId(user);
    if (!userId) return null;
    const product = await Product.findOne({ _id: productId, user: userId }).lean();
    if (!product) return null;
    return {
      _id: String(product._id),
      name: product.name,
      description: product.description,
      imageUrl: product.imageUrl,
      category: product.category,
      tags: product.tags
    };
  } catch (_) {
    return null;
  }
}

function promptFallbackFromDraft(draft) {
  const description = String(draft?.input?.description || '').trim();
  const productName = String(draft?.input?.product?.name || '').trim();
  const productDesc = String(draft?.input?.product?.description || '').trim();
  return [description, productName ? `Product: ${productName}` : '', productDesc ? `Details: ${productDesc}` : '']
    .filter(Boolean)
    .join('\n');
}

async function generateStructuredPrompt(draft) {
  const description = String(draft?.input?.description || '').trim();
  const productName = String(draft?.input?.product?.name || '').trim();
  const productDescription = String(draft?.input?.product?.description || '').trim();
  const sourceHint = draft?.input?.sourceImage?.url
    ? 'User provided reference image'
    : (productName ? 'Use product metadata as visual anchor' : 'No reference image');
  const aiMemoryContext = await buildAIContext({
    userId: draft?.userId,
    product: draft?.input?.product || null,
    category: draft?.input?.product?.category || ''
  });

  const prompt = `You are an AI video strategist.
Return STRICT JSON:
{
  "structuredPrompt": "string",
  "creativeDirection": {
    "targetAudience": "string",
    "tone": "string",
    "visualStyle": "string",
    "cta": "string"
  }
}

Context:
- Description: ${description}
- Product Name: ${productName || 'N/A'}
- Product Description: ${productDescription || 'N/A'}
- Reference: ${sourceHint}
${aiMemoryContext.reusablePromptText}

Rules:
- structuredPrompt must be concise but actionable for scene generation.
- Keep ad-ready language with clear call-to-action.`;

  try {
    const raw = await callGemini(prompt, {
      skipCache: true,
      temperature: 0.55,
      maxTokens: 900,
      timeout: 90000
    });
    const parsed = parseGeminiJSON(raw);
    const structuredPrompt = String(parsed?.structuredPrompt || '').trim();
    if (!structuredPrompt) {
      throw new Error('No structured prompt returned by model');
    }
    return {
      structuredPrompt,
      creativeDirection: parsed?.creativeDirection || null
    };
  } catch (_) {
    return {
      structuredPrompt: promptFallbackFromDraft(draft),
      creativeDirection: {
        targetAudience: 'general audience',
        tone: 'professional',
        visualStyle: 'clean cinematic vertical ad style',
        cta: 'Learn more'
      }
    };
  }
}

async function generateCaptionAndHashtags({ draft, selectedPlatforms = [] }) {
  const sceneSummary = Array.isArray(draft?.scenes?.sceneData)
    ? draft.scenes.sceneData
      .map((scene) => String(scene?.voiceLine || scene?.onScreenText || scene?.title || '').trim())
      .filter(Boolean)
      .slice(0, 5)
      .join(' | ')
    : '';

  const aiMemoryContext = await buildAIContext({
    userId: draft?.userId,
    platform: selectedPlatforms[0] || 'instagram',
    product: draft?.input?.product || null,
    category: draft?.input?.product?.category || ''
  });

  const prompt = `Create social caption and hashtags.
Return STRICT JSON:
{
  "caption": "string",
  "hashtags": ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5", "#tag6"]
}

Context:
- Description: ${draft?.input?.description || ''}
- Prompt: ${draft?.prompt?.promptText || ''}
- Scene summary: ${sceneSummary || 'N/A'}
- Platforms: ${selectedPlatforms.join(', ') || 'instagram'}
${aiMemoryContext.reusablePromptText}

Rules:
- caption: 1-3 lines, conversion-aware, no markdown.
- hashtags: 5 to 12 relevant tags, each starting with #.`;

  try {
    const raw = await callGemini(prompt, {
      skipCache: true,
      temperature: 0.7,
      maxTokens: 900,
      timeout: 90000
    });
    const parsed = parseGeminiJSON(raw);
    const caption = String(parsed?.caption || '').trim();
    const hashtagsRaw = Array.isArray(parsed?.hashtags) ? parsed.hashtags : [];
    const hashtags = Array.from(
      new Set(
        hashtagsRaw
          .map((tag) => String(tag || '').trim())
          .filter(Boolean)
          .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`))
      )
    ).slice(0, 12);
    if (!caption) throw new Error('Caption missing');
    return { caption, hashtags };
  } catch (_) {
    const fallbackCaption = String(draft?.input?.description || '').trim() || 'Discover our latest update.';
    const fallbackTags = ['#Marketing', '#AIVideo', '#BrandGrowth', '#DigitalCampaign', '#ContentCreation'];
    return { caption: fallbackCaption, hashtags: fallbackTags };
  }
}

async function generateThumbnailFromDraft({ draft, baseUrl }) {
  const prompt = String(
    draft?.scenesMetadata?.thumbnailPrompt ||
    draft?.scenes?.thumbnailPrompt ||
    draft?.prompt?.promptText ||
    draft?.input?.description ||
    'Marketing video thumbnail'
  ).trim();

  try {
    const result = await generateCampaignImageNanoBanana(prompt, {
      aspectRatio: '16:9',
      linkedProduct: draft?.input?.product || null,
      productReferenceImage: draft?.input?.sourceImage?.url || draft?.input?.product?.imageUrl || null,
      tone: 'professional'
    });
    if (!result?.success || !result?.imageUrl) {
      throw new Error(result?.error || 'Thumbnail generation failed');
    }

    if (String(result.imageUrl).startsWith('data:')) {
      const saved = await saveDataUrlToJob({
        jobId: draft.jobId,
        dataUrl: result.imageUrl,
        folder: 'final',
        fileName: 'thumbnail'
      });
      return buildMediaUrl(baseUrl, draft.jobId, saved.relativePath);
    }
    return result.imageUrl;
  } catch (_) {
    const firstSceneImage = (Array.isArray(draft?.scenes) && draft.scenes[0]?.imageUrl) ||
      draft?.images?.sceneData?.[0]?.imageUrl ||
      draft?.scenes?.sceneData?.[0]?.imageUrl ||
      null;
    return firstSceneImage;
  }
}

// -----------------------------------------------------------------------------
// Existing one-shot pipeline endpoints
// -----------------------------------------------------------------------------
router.post('/createVideo', protect, checkTrial, videoAiWriteLimiter, async (req, res) => {
  const userId = req.user?._id ? String(req.user._id) : (req.user?.id ? String(req.user.id) : null);
  
  if (!userId) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  // Deduct 7 credits synchronously before enqueuing
  const creditResult = await deductCredits(userId, 'campaign_full', 1, 'AI video generation pipeline');
  if (!creditResult.success) {
    return res.status(403).json({
      success: false,
      creditsExhausted: true,
      message: creditResult.error || 'Insufficient credits. Need 7 credits for full campaign.'
    });
  }

  try {
    const payload = req.body || {};
    const baseUrl = reqBaseUrl(req);

    const queued = await videoGenerationQueue.enqueue({
      userId,
      jobType: 'create_video_pipeline',
      payload: {
        payload,
        user: {
          _id: req.user?._id,
          id: req.user?.id,
          businessProfile: req.user?.businessProfile
        },
        baseUrl
      }
    });

    return res.status(202).json({
      success: true,
      message: 'Video generation queued',
      jobId: queued.jobId,
      status: queued.status,
      progress: queued.progress,
      currentStep: queued.currentStep
    });
  } catch (error) {
    // Refund credits immediately if enqueuing fails
    try {
      await refundCredits(userId, 'campaign_full', 1, 'Refund: AI video enqueuing failed');
    } catch (refundErr) {
      console.error('⚠️ Failed to refund credits after enqueuing error:', refundErr.message);
    }
    return responseError(res, error, 'Failed to queue video generation');
  }
});

router.get('/jobs/:jobId', protect, videoJobReadLimiter, async (req, res) => {
  try {
    const userId = req.user?._id ? String(req.user._id) : (req.user?.id ? String(req.user.id) : null);
    const job = await videoGenerationQueue.getJob(req.params.jobId, userId);
    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }
    return res.json({
      success: true,
      ...job
    });
  } catch (error) {
    return responseError(res, error, 'Failed to fetch job status');
  }
});

// -----------------------------------------------------------------------------
// Wizard endpoints (step-by-step with draft state)
// -----------------------------------------------------------------------------
router.get('/drafts', protect, videoJobReadLimiter, async (req, res) => {
  try {
    const drafts = await listDraftsForUser(toUserId(req.user));
    return res.json({ success: true, drafts });
  } catch (error) {
    return responseError(res, error, 'Failed to load AI videos');
  }
});

router.get('/draft/:jobId', protect, videoJobReadLimiter, async (req, res) => {
  try {
    const userId = toUserId(req.user);
    const draft = await loadDraftForUser(req.params.jobId, userId);
    const effectiveStep = deriveWizardStepFromDraft(draft);

    const draftJobs = (draft && typeof draft === 'object' ? draft.jobs : null) || {};
    const queueJobIds = Array.from(
      new Set(
        Object.values(draftJobs)
          .map((entry) => entry?.queueJobId)
          .filter(Boolean)
          .map((id) => String(id))
      )
    );
    const queueJobsPromises = queueJobIds.map((queueJobId) => videoGenerationQueue.getJob(queueJobId, userId));
    const queueJobs = (await Promise.all(queueJobsPromises)).filter(Boolean);

    return res.json({ success: true, draft, effectiveStep, queueJobs });
  } catch (error) {
    return responseError(res, error, 'Failed to load draft');
  }
});

router.delete('/draft/:jobId', protect, videoAiWriteLimiter, async (req, res) => {
  try {
    const userId = toUserId(req.user);
    const draft = await deleteDraftForUser(req.params.jobId, userId);
    return res.json({
      success: true,
      message: 'AI video draft deleted',
      jobId: draft.jobId
    });
  } catch (error) {
    return responseError(res, error, 'Failed to delete draft');
  }
});

router.post('/createDraft', protect, checkTrial, videoAiWriteLimiter, async (req, res) => {
  try {
    const payload = req.body || {};
    const description = String(payload.description || '').trim();
    if (!description) {
      return res.status(400).json({ success: false, message: 'Description is required' });
    }

    const resolvedProduct = await resolveProductFromPayload({ payload, user: req.user });
    const baseUrl = reqBaseUrl(req);
    const draft = await createDraft({
      user: req.user,
      baseUrl,
      input: {
        description,
        durationSeconds: payload.durationSeconds,
        sceneCount: payload.sceneCount,
        imageData: payload.imageData,
        imageUrl: payload.imageUrl,
        productId: payload.productId || resolvedProduct?._id || null,
        product: resolvedProduct
      }
    });

    return res.json({
      success: true,
      message: 'Draft created',
      jobId: draft.jobId,
      draft
    });
  } catch (error) {
    return responseError(res, error, 'Failed to create draft');
  }
});

router.post('/generatePrompt', protect, checkTrial, videoAiWriteLimiter, async (req, res) => {
  try {
    const { jobId, promptText, saveOnly = false } = req.body || {};
    if (!jobId) {
      return res.status(400).json({ success: false, message: 'jobId is required' });
    }

    const userId = toUserId(req.user);
    const existingDraft = await loadDraftForUser(jobId, userId);

    let promptPayload = existingDraft.prompt || null;
    if (saveOnly && String(promptText || '').trim()) {
      promptPayload = {
        ...promptPayload,
        promptText: String(promptText).trim(),
        edited: true,
        editedAt: new Date().toISOString()
      };
    } else {
      const generated = await generateStructuredPrompt(existingDraft);
      const effectivePrompt = String(promptText || generated.structuredPrompt || '').trim();
      promptPayload = {
        promptText: effectivePrompt,
        structuredPrompt: generated.structuredPrompt,
        creativeDirection: generated.creativeDirection,
        generatedAt: new Date().toISOString(),
        edited: Boolean(promptText)
      };
    }

    const draft = await updateDraft(jobId, userId, (current) => ({
      ...current,
      currentStep: Math.max(Number(current.currentStep || 1), 2),
      prompt: promptPayload
    }));

    await learnVideoStep({
      userId,
      jobId,
      action: 'video_prompt',
      prompt: promptPayload?.promptText || '',
      userInput: existingDraft.input || {},
      aiSettings: { saveOnly: Boolean(saveOnly), edited: Boolean(promptPayload?.edited) },
      product: existingDraft?.input?.product || null
    });

    return res.json({
      success: true,
      jobId,
      prompt: draft.prompt,
      draft
    });
  } catch (error) {
    return responseError(res, error, 'Failed to generate prompt');
  }
});

router.post('/generateScenes', protect, checkTrial, videoAiWriteLimiter, async (req, res) => {
  try {
    const { jobId, sceneData, saveOnly = false, promptText } = req.body || {};
    if (!jobId) {
      return res.status(400).json({ success: false, message: 'jobId is required' });
    }

    const userId = toUserId(req.user);
    const draft = await loadDraftForUser(jobId, userId);
    const durationSeconds = normalizedDurationSeconds(draft?.input?.durationSeconds || 60, 60);

    if (saveOnly && Array.isArray(sceneData)) {
      const normalizedScenes = sanitizeSceneData(sceneData, durationSeconds);
      const saved = await updateDraft(jobId, userId, (current) => ({
        ...current,
        currentStep: Math.max(Number(current.currentStep || 1), 2),
        scenes: normalizedScenes,
        scenesMetadata: {
          voiceScript: current?.scenesMetadata?.voiceScript || current?.scenes?.voiceScript || '',
          thumbnailPrompt: current?.scenesMetadata?.thumbnailPrompt || current?.scenes?.thumbnailPrompt || '',
          globalVisualStyle: current?.scenesMetadata?.globalVisualStyle || current?.scenes?.globalVisualStyle || ''
        }
      }));
      return res.json({
        success: true,
        jobId,
        sceneData: saved.scenes || [],
        draft: saved
      });
    }

    const promptToUse = String(
      promptText || draft?.prompt?.promptText || promptFallbackFromDraft(draft)
    ).trim();
    const aiMemoryContext = await buildAIContext({
      userId,
      product: draft?.input?.product || null,
      category: draft?.input?.product?.category || ''
    });
    const generated = await runGenerateScenes({
      payload: {
        description: [promptToUse, aiMemoryContext.reusablePromptText].filter(Boolean).join('\n\n'),
        durationSeconds,
        sceneCount: draft?.input?.sceneCount || undefined,
        productId: draft?.input?.productId || undefined,
        product: draft?.input?.product || undefined
      },
      user: req.user
    });

    const normalizedScenes = sanitizeSceneData(generated.sceneData || [], durationSeconds);
    const updated = await updateDraft(jobId, userId, (current) => ({
      ...current,
      currentStep: Math.max(Number(current.currentStep || 1), 2),
      scenes: normalizedScenes,
      scenesMetadata: {
        voiceScript: generated.voiceScript || '',
        thumbnailPrompt: generated.thumbnailPrompt || '',
        globalVisualStyle: generated.globalVisualStyle || ''
      }
    }));

    await learnVideoStep({
      userId,
      jobId,
      action: 'scene_generation',
      prompt: promptToUse,
      userInput: draft.input || {},
      sceneData: updated.scenes,
      scenePrompts: updated.scenes?.map((scene) => scene.imagePrompt || scene.videoPrompt || scene.title) || [],
      script: updated.scenesMetadata.voiceScript || '',
      duration: durationSeconds,
      product: draft?.input?.product || null,
      aiSettings: { memoryInjected: Boolean(aiMemoryContext.reusablePromptText) }
    });
    return res.json({
      success: true,
      jobId,
      sceneData: updated.scenes,
      voiceScript: updated.scenesMetadata.voiceScript,
      thumbnailPrompt: updated.scenesMetadata.thumbnailPrompt,
      globalVisualStyle: updated.scenesMetadata.globalVisualStyle,
      draft: updated
    });
  } catch (error) {
    return responseError(res, error, 'Failed to generate scenes');
  }
});

router.post('/generateImages', protect, checkTrial, videoAiWriteLimiter, async (req, res) => {
  try {
    const { jobId, action = 'generateAll', sceneId, sceneData, imagePrompt, imageData, imageUrl } = req.body || {};
    if (!jobId) {
      return res.status(400).json({ success: false, message: 'jobId is required' });
    }

    const userId = toUserId(req.user);
    const draft = await loadDraftForUser(jobId, userId);
    const baseUrl = reqBaseUrl(req);
    const durationSeconds = normalizedDurationSeconds(draft?.input?.durationSeconds || 60, 60);
    const sourceScenes = sanitizeSceneData(
      sceneData ||
      draft?.images?.sceneData ||
      draft?.scenes?.sceneData ||
      [],
      durationSeconds
    );

    if (!sourceScenes.length) {
      return res.status(400).json({ success: false, message: 'No scene data available. Generate scenes first.' });
    }

    let nextScenes = sourceScenes;
    if (action === 'replace' && sceneId) {
      const idx = sourceScenes.findIndex((item) => String(item.sceneId) === String(sceneId));
      if (idx === -1) {
        return res.status(404).json({ success: false, message: 'Scene not found' });
      }

      let replacementUrl = String(imageUrl || '').trim();
      if (imageData && String(imageData).startsWith('data:')) {
        const saved = await saveDataUrlToJob({
          jobId,
          dataUrl: imageData,
          folder: 'images',
          fileName: `${sceneId}_manual`
        });
        replacementUrl = buildMediaUrl(baseUrl, jobId, saved.relativePath);
      }
      if (!replacementUrl) {
        return res.status(400).json({ success: false, message: 'No replacement image found' });
      }

      nextScenes = sourceScenes.map((scene, index) => (
        index === idx
          ? { ...scene, imageUrl: replacementUrl, imageSource: 'manual' }
          : scene
      ));
    } else if (action === 'regenerate' && sceneId) {
      const idx = sourceScenes.findIndex((item) => String(item.sceneId) === String(sceneId));
      if (idx === -1) {
        return res.status(404).json({ success: false, message: 'Scene not found' });
      }
      const targetScene = sourceScenes[idx];
      const regenPrompt = String(imagePrompt || targetScene.imagePrompt || draft?.prompt?.promptText || '').trim();
      const regen = await generateCampaignImageNanoBanana(regenPrompt, {
        aspectRatio: '9:16',
        linkedProduct: draft?.input?.product || null,
        productReferenceImage: draft?.input?.sourceImage?.url || draft?.input?.product?.imageUrl || null,
        tone: 'professional'
      });
      if (!regen?.success || !regen?.imageUrl) {
        throw new Error(regen?.error || 'Image regeneration failed');
      }
      nextScenes = sourceScenes.map((scene, index) => (
        index === idx
          ? {
            ...scene,
            imageUrl: regen.imageUrl,
            imagePrompt: regenPrompt
          }
          : scene
      ));
    } else {
      const generated = await runGenerateImages({
        payload: {
          jobId,
          description: String(draft?.prompt?.promptText || draft?.input?.description || ''),
          durationSeconds,
          sceneCount: draft?.input?.sceneCount || sourceScenes.length,
          imageUrl: draft?.input?.sourceImage?.url || undefined,
          productId: draft?.input?.productId || undefined,
          product: draft?.input?.product || undefined,
          sceneData: sourceScenes,
          globalVisualStyle: draft?.scenesMetadata?.globalVisualStyle || draft?.scenes?.globalVisualStyle || '',
          voiceScript: draft?.scenesMetadata?.voiceScript || draft?.scenes?.voiceScript || '',
          thumbnailPrompt: draft?.scenesMetadata?.thumbnailPrompt || draft?.scenes?.thumbnailPrompt || ''
        },
        user: req.user,
        baseUrl
      });
      nextScenes = sanitizeSceneData(generated.sceneData || [], durationSeconds);
    }

    const updated = await updateDraft(jobId, userId, (current) => ({
      ...current,
      currentStep: Math.max(Number(current.currentStep || 1), 3),
      scenes: nextScenes,
      images: {
        sceneData: nextScenes,
        generatedAt: new Date().toISOString()
      }
    }));

    try {
      const VideoDraft = require('../models/VideoDraft');
      const draftDoc = await VideoDraft.findOne({ jobId });
      if (draftDoc) {
        draftDoc.scenes = nextScenes;
        await draftDoc.save();
      }
    } catch (saveErr) {
      console.error("⚠️ Failed to immediately save draft scenes imageUrl in MongoDB:", saveErr.message);
    }

    await learnVideoStep({
      userId,
      jobId,
      action: 'image_generation',
      prompt: String(imagePrompt || draft?.prompt?.promptText || draft?.input?.description || ''),
      userInput: draft.input || {},
      sceneData: nextScenes,
      generatedImages: nextScenes.map((scene) => scene.imageUrl).filter(Boolean),
      duration: durationSeconds,
      product: draft?.input?.product || null,
      aiSettings: { action }
    });

    return res.json({
      success: true,
      jobId,
      sceneData: updated.scenes,
      draft: updated
    });
  } catch (error) {
    return responseError(res, error, 'Failed to generate images');
  }
});

router.post('/generateClips', protect, checkTrial, videoAiWriteLimiter, async (req, res) => {
  try {
    const { jobId, sceneData } = req.body || {};
    if (!jobId) {
      return res.status(400).json({ success: false, message: 'jobId is required' });
    }

    const userId = toUserId(req.user);
    const draft = await loadDraftForUser(jobId, userId);
    const sourceScenes = sanitizeSceneData(
      sceneData ||
      draft?.images?.sceneData ||
      draft?.scenes?.sceneData ||
      [],
      draft?.input?.durationSeconds || 60
    );

    if (!sourceScenes.length || !sourceScenes.some((scene) => scene.imageUrl)) {
      return res.status(400).json({ success: false, message: 'Scene images are required before clip generation' });
    }

    const shouldQueue =
      req.body?.async === true ||
      String(req.query?.async || '').toLowerCase() === 'true' ||
      String(process.env.VIDEO_STEP_ASYNC || '').toLowerCase() === 'true';

    if (shouldQueue) {
      const baseUrl = reqBaseUrl(req);
      
      // Cache guard: Check if an active queue job already exists for this draft step
      const existingJobId = draft?.jobs?.clips?.queueJobId;
      let queued;
      if (existingJobId) {
        const existingJob = await videoGenerationQueue.getJob(existingJobId, userId);
        if (existingJob && ['queued', 'processing'].includes(existingJob.status)) {
          queued = existingJob;
        }
      }

      if (!queued) {
        queued = await videoGenerationQueue.enqueue({
          userId,
          jobType: 'generate_clips',
          payload: {
            jobId,
            userId,
            sourceScenes,
            baseUrl
          }
        });

        await updateDraft(jobId, userId, (current) => ({
          ...current,
          jobs: {
            ...(current.jobs || {}),
            clips: {
              queueJobId: queued.jobId,
              status: queued.status,
              queuedAt: new Date().toISOString()
            }
          }
        }));
      }

      return res.status(202).json({
        success: true,
        message: 'Clip generation queued',
        draftJobId: jobId,
        queueJobId: queued.jobId,
        status: queued.status,
        progress: queued.progress,
        currentStep: queued.currentStep
      });
    }

    const generated = await runGenerateVideoClips({
      payload: {
        jobId,
        sceneData: sourceScenes
      },
      baseUrl: reqBaseUrl(req)
    });

    const nextScenes = generated.sceneData || [];
    const updated = await updateDraft(jobId, userId, (current) => ({
      ...current,
      currentStep: Math.max(Number(current.currentStep || 1), 4),
      scenes: nextScenes,
      images: current?.images?.sceneData?.length
        ? {
          ...(current.images || {}),
          sceneData: mergeClipUrlsIntoScenes(current.images.sceneData, generated.sceneData || []),
          generatedAt: current.images.generatedAt || new Date().toISOString()
        }
        : (current.images || null),
      clips: {
        sceneData: generated.sceneData || [],
        clipUrls: generated.clipUrls || [],
        generatedAt: new Date().toISOString()
      }
    }));

    try {
      const VideoDraft = require('../models/VideoDraft');
      const draftDoc = await VideoDraft.findOne({ jobId });
      if (draftDoc) {
        draftDoc.scenes = nextScenes;
        await draftDoc.save();
      }
    } catch (saveErr) {
      console.error("⚠️ Failed to immediately save draft scenes clipUrl in MongoDB:", saveErr.message);
    }

    await learnVideoStep({
      userId,
      jobId,
      action: 'clip_generation',
      prompt: draft?.prompt?.promptText || '',
      userInput: draft.input || {},
      sceneData: updated.clips.sceneData,
      generatedVideos: updated.clips.clipUrls || [],
      product: draft?.input?.product || null
    });

    return res.json({
      success: true,
      jobId,
      sceneData: updated.clips.sceneData,
      clipUrls: updated.clips.clipUrls,
      draft: updated
    });
  } catch (error) {
    return responseError(res, error, 'Failed to generate clips');
  }
});

router.post('/generateAudio', protect, checkTrial, videoAiWriteLimiter, async (req, res) => {
  try {
    const { jobId, audio = {} } = req.body || {};
    if (!jobId) {
      return res.status(400).json({ success: false, message: 'jobId is required' });
    }

    const userId = toUserId(req.user);
    const draft = await loadDraftForUser(jobId, userId);
    const requestedLanguageCode = normalizeAudioLanguageCode(audio?.languageCode || 'en');
    const sourceVoiceScript = String(audio?.voiceScript || deriveVoiceScriptFromDraft(draft) || '').trim();

    const sceneDataForTiming =
      (Array.isArray(draft?.scenes?.sceneData) && draft.scenes.sceneData.length ? draft.scenes.sceneData : null) ||
      (Array.isArray(draft?.clips?.sceneData) && draft.clips.sceneData.length ? draft.clips.sceneData : null) ||
      (Array.isArray(draft?.images?.sceneData) && draft.images.sceneData.length ? draft.images.sceneData : null) ||
      (Array.isArray(draft?.scenes?.scenes) && draft.scenes.scenes.length ? draft.scenes.scenes : null) ||
      [];

    if (!String(draft?.scenes?.voiceScript || '').trim() && sourceVoiceScript) {
      await updateDraft(jobId, userId, (current) => ({
        ...current,
        scenes: {
          ...(current.scenes || {}),
          voiceScript: sourceVoiceScript
        }
      }));
    }

    const audioConfig = {
      enabled: audio?.enabled !== false,
      mode: String(audio?.mode || 'auto').toLowerCase(),
      languageCode: requestedLanguageCode,
      tone: String(audio?.tone || 'professional').toLowerCase(),
      musicSource: String(audio?.musicSource || process.env.AI_VIDEO_MUSIC_SOURCE || 'tone').toLowerCase(),
      musicTrack: typeof audio?.musicTrack === 'string' ? audio.musicTrack : '',
      voiceGender: String(audio?.voiceGender || 'female').toLowerCase(),
      voiceVolume: Number.isFinite(Number(audio?.voiceVolume)) ? Number(audio.voiceVolume) : 1,
      musicVolume: Number.isFinite(Number(audio?.musicVolume)) ? Number(audio.musicVolume) : 0.24,
      sourceVoiceScript,
      voiceScript: sourceVoiceScript,
      localizedVoiceScript: null,
      localizedSceneData: null,
      manualAudioData: typeof audio?.manualAudioData === 'string' ? audio.manualAudioData : '',
      manualAudioUrl: typeof audio?.manualAudioUrl === 'string' ? audio.manualAudioUrl : '',
      soundEffectUrls: Array.isArray(audio?.soundEffectUrls) ? audio.soundEffectUrls : []
    };

    const generated = await runGenerateAudio({
      payload: {
        jobId,
        skipMix: true,
        description: String(sourceVoiceScript || draft?.input?.description || ''),
        // Always pass the *source* (English) script; the pipeline will translate
        // in a duration-aware, scene-timed way when languageCode != 'en'.
        voiceScript: String(sourceVoiceScript || ''),
        sourceVoiceScript: String(sourceVoiceScript || ''),
        sceneData: sceneDataForTiming,
        durationSeconds: draft?.input?.durationSeconds || 60,
        audio: audioConfig
      },
      baseUrl: reqBaseUrl(req)
    });

    const updated = await updateDraft(jobId, userId, (current) => ({
      ...current,
      currentStep: Math.max(Number(current.currentStep || 1), 5),
      audio: {
        config: {
          ...audioConfig,
          localizedVoiceScript: generated?.localizedVoiceScript || null,
          localizedSceneData: generated?.localizedSceneData || null
        },
        tracks: generated?.tracks || {},
        generatedAt: new Date().toISOString()
      }
    }));

    await learnVideoStep({
      userId,
      jobId,
      action: 'audio_generation',
      prompt: String(generated?.localizedVoiceScript || sourceVoiceScript || ''),
      userInput: draft.input || {},
      script: String(generated?.localizedVoiceScript || sourceVoiceScript || ''),
      audioSettings: audioConfig,
      voiceSettings: {
        voiceGender: audioConfig.voiceGender,
        voiceVolume: audioConfig.voiceVolume,
        musicVolume: audioConfig.musicVolume
      },
      language: requestedLanguageCode,
      duration: draft?.input?.durationSeconds || 60,
      product: draft?.input?.product || null,
      sourceResponse: generated
    });

    return res.json({
      success: true,
      jobId,
      audio: updated.audio,
      draft: updated
    });
  } catch (error) {
    return responseError(res, error, 'Failed to generate audio');
  }
});

router.post('/mixAudio', protect, checkTrial, videoAiWriteLimiter, async (req, res) => {
  try {
    const { jobId, tracks = {}, durationSeconds } = req.body || {};
    if (!jobId) {
      return res.status(400).json({ success: false, message: 'jobId is required' });
    }

    const userId = toUserId(req.user);
    const draft = await loadDraftForUser(jobId, userId);
    const mergedTracks = {
      ...(draft?.audio?.tracks || {}),
      ...(tracks || {})
    };

    const mixed = await runMergeAudio({
      payload: {
        jobId,
        durationSeconds: durationSeconds || draft?.input?.durationSeconds || 60,
        tracks: {
          manualUrl: mergedTracks?.manualUrl || '',
          voiceUrl: mergedTracks?.voiceUrl || '',
          backgroundUrl: mergedTracks?.backgroundUrl || ''
        },
        soundEffectUrls: Array.isArray(mergedTracks?.soundEffectUrls) ? mergedTracks.soundEffectUrls : [],
        audio: draft?.audio?.config || {}
      },
      baseUrl: reqBaseUrl(req)
    });

    const updated = await updateDraft(jobId, userId, (current) => ({
      ...current,
      currentStep: Math.max(Number(current.currentStep || 1), 6),
      mix: {
        finalAudioUrl: mixed?.finalAudioUrl || null,
        mixedAt: new Date().toISOString()
      }
    }));

    return res.json({
      success: true,
      jobId,
      finalAudioUrl: updated?.mix?.finalAudioUrl || null,
      draft: updated
    });
  } catch (error) {
    return responseError(res, error, 'Failed to mix audio');
  }
});

router.post('/mergeVideo', protect, checkTrial, videoAiWriteLimiter, async (req, res) => {
  try {
    const { jobId, clipUrls, finalAudioUrl, subtitles = { enabled: false } } = req.body || {};
    if (!jobId) {
      return res.status(400).json({ success: false, message: 'jobId is required' });
    }

    const userId = toUserId(req.user);
    const draft = await loadDraftForUser(jobId, userId);
    const effectiveClipUrls = Array.isArray(clipUrls) && clipUrls.length
      ? clipUrls
      : (draft?.clips?.sceneData || []).map((scene) => scene.clipUrl).filter(Boolean);
    if (!effectiveClipUrls.length) {
      return res.status(400).json({ success: false, message: 'No clip URLs available' });
    }

    const shouldQueue =
      req.body?.async === true ||
      String(req.query?.async || '').toLowerCase() === 'true' ||
      String(process.env.VIDEO_STEP_ASYNC || '').toLowerCase() === 'true';

    if (shouldQueue) {
      const baseUrl = reqBaseUrl(req);

      // Cache guard: Check if an active queue job already exists for this draft step
      const existingJobId = draft?.jobs?.merge?.queueJobId;
      let queued;
      if (existingJobId) {
        const existingJob = await videoGenerationQueue.getJob(existingJobId, userId);
        if (existingJob && ['queued', 'processing'].includes(existingJob.status)) {
          queued = existingJob;
        }
      }

      if (!queued) {
        queued = await videoGenerationQueue.enqueue({
          userId,
          jobType: 'merge_video',
          payload: {
            jobId,
            userId,
            effectiveClipUrls,
            finalAudioUrl: finalAudioUrl || draft?.mix?.finalAudioUrl || null,
            subtitles,
            baseUrl
          }
        });

        await updateDraft(jobId, userId, (current) => ({
          ...current,
          jobs: {
            ...(current.jobs || {}),
            merge: {
              queueJobId: queued.jobId,
              status: queued.status,
              queuedAt: new Date().toISOString()
            }
          }
        }));
      }

      return res.status(202).json({
        success: true,
        message: 'Video merge queued',
        draftJobId: jobId,
        queueJobId: queued.jobId,
        status: queued.status,
        progress: queued.progress,
        currentStep: queued.currentStep
      });
    }

    const merged = await runMergeVideo({
      payload: {
        jobId,
        clipUrls: effectiveClipUrls,
        finalAudioUrl: finalAudioUrl || draft?.mix?.finalAudioUrl || null,
        subtitles: { enabled: subtitles?.enabled === true },
        sceneData: (
          subtitles?.enabled === true &&
          draft?.audio?.config?.languageCode &&
          draft.audio.config.languageCode !== 'en' &&
          Array.isArray(draft?.audio?.config?.localizedSceneData) &&
          draft.audio.config.localizedSceneData.length
        )
          ? draft.audio.config.localizedSceneData
          : (draft?.clips?.sceneData || draft?.images?.sceneData || draft?.scenes?.sceneData || [])
      },
      baseUrl: reqBaseUrl(req)
    });

    const finalVideoUrl = merged?.finalOutputUrl || merged?.finalVideoUrl || null;
    const updated = await updateDraft(jobId, userId, (current) => ({
      ...current,
      currentStep: Math.max(Number(current.currentStep || 1), 7),
      finalVideoUrl,
      merge: {
        finalVideoUrl: merged?.finalVideoUrl || null,
        finalOutputUrl: merged?.finalOutputUrl || null,
        subtitlesUrl: merged?.subtitlesUrl || null,
        mergedAt: new Date().toISOString()
      }
    }));

    try {
      const VideoDraft = require('../models/VideoDraft');
      const draftDoc = await VideoDraft.findOne({ jobId });
      if (draftDoc) {
        draftDoc.finalVideoUrl = finalVideoUrl;
        await draftDoc.save();
      }
    } catch (saveErr) {
      console.error("⚠️ Failed to immediately save draft finalVideoUrl in MongoDB:", saveErr.message);
    }

    await learnVideoStep({
      userId,
      jobId,
      action: 'video_merge',
      prompt: draft?.prompt?.promptText || '',
      userInput: draft.input || {},
      sceneData: draft?.clips?.sceneData || draft?.images?.sceneData || draft?.scenes?.sceneData || [],
      generatedVideos: [updated.merge.finalOutputUrl || updated.merge.finalVideoUrl].filter(Boolean),
      audioSettings: draft?.audio?.config || {},
      duration: draft?.input?.durationSeconds || null,
      product: draft?.input?.product || null,
      sourceResponse: merged
    });

    return res.json({
      success: true,
      jobId,
      merge: updated.merge,
      draft: updated
    });
  } catch (error) {
    return responseError(res, error, 'Failed to merge video');
  }
});

router.post('/generateContent', protect, checkTrial, videoAiWriteLimiter, async (req, res) => {
  try {
    const { jobId, selectedPlatforms = [] } = req.body || {};
    if (!jobId) {
      return res.status(400).json({ success: false, message: 'jobId is required' });
    }

    const userId = toUserId(req.user);
    const draft = await loadDraftForUser(jobId, userId);
    const platforms = normalizePlatforms(selectedPlatforms.length ? selectedPlatforms : (draft?.platform?.selectedPlatforms || []));
    const thumbnailUrl = await generateThumbnailFromDraft({ draft, baseUrl: reqBaseUrl(req) });
    const socialContent = await generateCaptionAndHashtags({ draft, selectedPlatforms: platforms });

    const updated = await updateDraft(jobId, userId, (current) => ({
      ...current,
      currentStep: Math.max(Number(current.currentStep || 1), 8),
      thumbnailUrl,
      content: {
        thumbnailUrl,
        caption: socialContent.caption,
        hashtags: socialContent.hashtags,
        generatedAt: new Date().toISOString()
      }
    }));

    try {
      const VideoDraft = require('../models/VideoDraft');
      const draftDoc = await VideoDraft.findOne({ jobId });
      if (draftDoc) {
        draftDoc.thumbnailUrl = thumbnailUrl;
        await draftDoc.save();
      }
    } catch (saveErr) {
      console.error("⚠️ Failed to immediately save draft thumbnailUrl in MongoDB:", saveErr.message);
    }

    await learnVideoStep({
      userId,
      jobId,
      action: 'video_content',
      prompt: draft?.prompt?.promptText || '',
      userInput: draft.input || {},
      captions: [socialContent.caption],
      hashtags: socialContent.hashtags,
      thumbnails: [thumbnailUrl].filter(Boolean),
      generatedVideos: [draft?.merge?.finalOutputUrl || draft?.merge?.finalVideoUrl].filter(Boolean),
      product: draft?.input?.product || null,
      aiSettings: { selectedPlatforms: platforms }
    });

    return res.json({
      success: true,
      jobId,
      content: updated.content,
      draft: updated
    });
  } catch (error) {
    return responseError(res, error, 'Failed to generate content');
  }
});

router.post('/schedulePost', protect, checkTrial, videoAiWriteLimiter, async (req, res) => {
  try {
    const { jobId, selectedPlatforms = [], scheduledAt, publishNow = false } = req.body || {};
    if (!jobId) {
      return res.status(400).json({ success: false, message: 'jobId is required' });
    }

    const platforms = normalizePlatforms(selectedPlatforms);
    if (!platforms.length) {
      return res.status(400).json({ success: false, message: 'Select at least one platform' });
    }

    const when = publishNow
      ? new Date().toISOString()
      : (scheduledAt ? new Date(scheduledAt).toISOString() : null);
    if (!when || Number.isNaN(new Date(when).getTime())) {
      return res.status(400).json({ success: false, message: 'Valid schedule date/time is required' });
    }

    const userId = toUserId(req.user);
    const updated = await updateDraft(jobId, userId, (current) => ({
      ...current,
      currentStep: Math.max(Number(current.currentStep || 1), 10),
      platform: {
        selectedPlatforms: platforms
      },
      schedule: {
        publishNow: Boolean(publishNow),
        scheduledAt: when,
        status: publishNow ? 'published_pending_provider' : 'scheduled',
        updatedAt: new Date().toISOString()
      }
    }));

    await learnVideoStep({
      userId,
      jobId,
      action: 'video_schedule',
      prompt: updated?.prompt?.promptText || '',
      userInput: updated.input || {},
      captions: [updated?.content?.caption].filter(Boolean),
      hashtags: updated?.content?.hashtags || [],
      thumbnails: [updated?.content?.thumbnailUrl].filter(Boolean),
      generatedVideos: [updated?.merge?.finalOutputUrl || updated?.merge?.finalVideoUrl].filter(Boolean),
      scheduling: updated.schedule,
      status: publishNow ? 'published' : 'scheduled',
      product: updated?.input?.product || null,
      aiSettings: { selectedPlatforms: platforms }
    });

    return res.json({
      success: true,
      message: publishNow ? 'Post queued for immediate publish' : 'Post scheduled',
      jobId,
      draft: updated
    });
  } catch (error) {
    return responseError(res, error, 'Failed to schedule post');
  }
});

// -----------------------------------------------------------------------------
// Backward compatibility aliases for existing clients
// -----------------------------------------------------------------------------
router.post('/generateVideoClips', protect, checkTrial, videoAiWriteLimiter, async (req, res) => {
  try {
    const result = await runGenerateVideoClips({
      payload: req.body || {},
      baseUrl: reqBaseUrl(req)
    });
    return res.json(result);
  } catch (error) {
    return responseError(res, error, 'Failed to generate video clips');
  }
});

router.post('/mergeAudio', protect, checkTrial, videoAiWriteLimiter, async (req, res) => {
  try {
    const result = await runMergeAudio({
      payload: req.body || {},
      baseUrl: reqBaseUrl(req)
    });
    return res.json(result);
  } catch (error) {
    return responseError(res, error, 'Failed to merge audio');
  }
});

module.exports = router;
