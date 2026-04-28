const express = require('express');
const router = express.Router();

const Product = require('../models/Product');
const { protect } = require('../middleware/auth');
const { checkTrial } = require('../middleware/trialGuard');
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
  updateDraft,
  buildMediaUrl,
  toUserId,
  saveDataUrlToJob
} = require('../services/videoDraftStore');
const { callGemini, parseGeminiJSON, generateCampaignImageNanoBanana } = require('../services/geminiAI');

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
    const firstSceneImage = draft?.images?.sceneData?.[0]?.imageUrl || draft?.scenes?.sceneData?.[0]?.imageUrl || null;
    return firstSceneImage;
  }
}

// -----------------------------------------------------------------------------
// Existing one-shot pipeline endpoints
// -----------------------------------------------------------------------------
router.post('/createVideo', protect, checkTrial, async (req, res) => {
  try {
    const userId = req.user?._id ? String(req.user._id) : (req.user?.id ? String(req.user.id) : null);
    const payload = req.body || {};
    const baseUrl = reqBaseUrl(req);

    const queued = videoGenerationQueue.enqueue({
      userId,
      payload,
      handler: async ({ update, log }) => {
        return runCreateVideoPipeline({
          payload,
          user: req.user,
          baseUrl,
          providedJobId: null,
          onProgress: ({ progress, currentStep, metadata }) => update({ progress, currentStep, metadata }),
          onLog: (line) => log(line)
        });
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
    return responseError(res, error, 'Failed to queue video generation');
  }
});

router.get('/jobs/:jobId', protect, async (req, res) => {
  try {
    const userId = req.user?._id ? String(req.user._id) : (req.user?.id ? String(req.user.id) : null);
    const job = videoGenerationQueue.getJob(req.params.jobId, userId);
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
router.get('/drafts', protect, async (req, res) => {
  try {
    const drafts = await listDraftsForUser(toUserId(req.user));
    return res.json({ success: true, drafts });
  } catch (error) {
    return responseError(res, error, 'Failed to load AI videos');
  }
});

router.get('/draft/:jobId', protect, async (req, res) => {
  try {
    const userId = toUserId(req.user);
    const draft = await loadDraftForUser(req.params.jobId, userId);
    return res.json({ success: true, draft });
  } catch (error) {
    return responseError(res, error, 'Failed to load draft');
  }
});

router.post('/createDraft', protect, checkTrial, async (req, res) => {
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

router.post('/generatePrompt', protect, checkTrial, async (req, res) => {
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

router.post('/generateScenes', protect, checkTrial, async (req, res) => {
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
        scenes: {
          ...(current.scenes || {}),
          sceneData: normalizedScenes,
          voiceScript: current?.scenes?.voiceScript || '',
          thumbnailPrompt: current?.scenes?.thumbnailPrompt || '',
          globalVisualStyle: current?.scenes?.globalVisualStyle || ''
        }
      }));
      return res.json({
        success: true,
        jobId,
        sceneData: saved.scenes?.sceneData || [],
        draft: saved
      });
    }

    const promptToUse = String(
      promptText || draft?.prompt?.promptText || promptFallbackFromDraft(draft)
    ).trim();
    const generated = await runGenerateScenes({
      payload: {
        description: promptToUse,
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
      scenes: {
        sceneData: normalizedScenes,
        voiceScript: generated.voiceScript || '',
        thumbnailPrompt: generated.thumbnailPrompt || '',
        globalVisualStyle: generated.globalVisualStyle || ''
      }
    }));

    return res.json({
      success: true,
      jobId,
      sceneData: updated.scenes.sceneData,
      voiceScript: updated.scenes.voiceScript,
      thumbnailPrompt: updated.scenes.thumbnailPrompt,
      globalVisualStyle: updated.scenes.globalVisualStyle,
      draft: updated
    });
  } catch (error) {
    return responseError(res, error, 'Failed to generate scenes');
  }
});

router.post('/generateImages', protect, checkTrial, async (req, res) => {
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
          globalVisualStyle: draft?.scenes?.globalVisualStyle || '',
          voiceScript: draft?.scenes?.voiceScript || '',
          thumbnailPrompt: draft?.scenes?.thumbnailPrompt || ''
        },
        user: req.user,
        baseUrl
      });
      nextScenes = sanitizeSceneData(generated.sceneData || [], durationSeconds);
    }

    const updated = await updateDraft(jobId, userId, (current) => ({
      ...current,
      currentStep: Math.max(Number(current.currentStep || 1), 3),
      images: {
        sceneData: nextScenes,
        generatedAt: new Date().toISOString()
      }
    }));

    return res.json({
      success: true,
      jobId,
      sceneData: updated.images.sceneData,
      draft: updated
    });
  } catch (error) {
    return responseError(res, error, 'Failed to generate images');
  }
});

router.post('/generateClips', protect, checkTrial, async (req, res) => {
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

    const generated = await runGenerateVideoClips({
      payload: {
        jobId,
        sceneData: sourceScenes
      },
      baseUrl: reqBaseUrl(req)
    });

    const updated = await updateDraft(jobId, userId, (current) => ({
      ...current,
      currentStep: Math.max(Number(current.currentStep || 1), 4),
      clips: {
        sceneData: generated.sceneData || [],
        clipUrls: generated.clipUrls || [],
        generatedAt: new Date().toISOString()
      }
    }));

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

router.post('/generateAudio', protect, checkTrial, async (req, res) => {
  try {
    const { jobId, audio = {} } = req.body || {};
    if (!jobId) {
      return res.status(400).json({ success: false, message: 'jobId is required' });
    }

    const userId = toUserId(req.user);
    const draft = await loadDraftForUser(jobId, userId);
    const audioConfig = {
      enabled: audio?.enabled !== false,
      mode: String(audio?.mode || 'auto').toLowerCase(),
      languageCode: String(audio?.languageCode || 'en').toLowerCase(),
      tone: String(audio?.tone || 'professional').toLowerCase(),
      voiceGender: String(audio?.voiceGender || 'female').toLowerCase(),
      voiceVolume: Number.isFinite(Number(audio?.voiceVolume)) ? Number(audio.voiceVolume) : 1,
      musicVolume: Number.isFinite(Number(audio?.musicVolume)) ? Number(audio.musicVolume) : 0.24,
      manualAudioData: typeof audio?.manualAudioData === 'string' ? audio.manualAudioData : '',
      manualAudioUrl: typeof audio?.manualAudioUrl === 'string' ? audio.manualAudioUrl : '',
      soundEffectUrls: Array.isArray(audio?.soundEffectUrls) ? audio.soundEffectUrls : []
    };

    const generated = await runGenerateAudio({
      payload: {
        jobId,
        skipMix: true,
        description: String(draft?.scenes?.voiceScript || draft?.input?.description || ''),
        durationSeconds: draft?.input?.durationSeconds || 60,
        audio: audioConfig
      },
      baseUrl: reqBaseUrl(req)
    });

    const updated = await updateDraft(jobId, userId, (current) => ({
      ...current,
      currentStep: Math.max(Number(current.currentStep || 1), 5),
      audio: {
        config: audioConfig,
        tracks: generated?.tracks || {},
        generatedAt: new Date().toISOString()
      }
    }));

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

router.post('/mixAudio', protect, checkTrial, async (req, res) => {
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
        soundEffectUrls: Array.isArray(mergedTracks?.soundEffectUrls) ? mergedTracks.soundEffectUrls : []
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

router.post('/mergeVideo', protect, checkTrial, async (req, res) => {
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

    const merged = await runMergeVideo({
      payload: {
        jobId,
        clipUrls: effectiveClipUrls,
        finalAudioUrl: finalAudioUrl || draft?.mix?.finalAudioUrl || null,
        subtitles: { enabled: subtitles?.enabled === true },
        sceneData: draft?.clips?.sceneData || draft?.images?.sceneData || draft?.scenes?.sceneData || []
      },
      baseUrl: reqBaseUrl(req)
    });

    const updated = await updateDraft(jobId, userId, (current) => ({
      ...current,
      currentStep: Math.max(Number(current.currentStep || 1), 7),
      merge: {
        finalVideoUrl: merged?.finalVideoUrl || null,
        finalOutputUrl: merged?.finalOutputUrl || null,
        subtitlesUrl: merged?.subtitlesUrl || null,
        mergedAt: new Date().toISOString()
      }
    }));

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

router.post('/generateContent', protect, checkTrial, async (req, res) => {
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
      content: {
        thumbnailUrl,
        caption: socialContent.caption,
        hashtags: socialContent.hashtags,
        generatedAt: new Date().toISOString()
      }
    }));

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

router.post('/schedulePost', protect, checkTrial, async (req, res) => {
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
router.post('/generateVideoClips', protect, checkTrial, async (req, res) => {
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

router.post('/mergeAudio', protect, checkTrial, async (req, res) => {
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
