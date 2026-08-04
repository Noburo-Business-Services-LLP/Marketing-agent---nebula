const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = rateLimit;
const fs = require('fs');
const path = require('path');

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
    },
    jobs: {
      ...(current.jobs || {}),
      clips: current.jobs?.clips
        ? { ...current.jobs.clips, status: 'completed', completedAt: new Date().toISOString() }
        : null
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


videoGenerationQueue.registerHandler('generate_content', async (payload, { update, log }) => {
  const { jobId, userId, selectedPlatforms, baseUrl } = payload;
  await update({ progress: 10, currentStep: 'generate_content' });
  await log(`Generating content (thumbnail, caption, hashtags) for draft ${jobId}`);

  const draft = await loadDraftForUser(jobId, userId);
  const platforms = normalizePlatforms(selectedPlatforms?.length ? selectedPlatforms : (draft?.platform?.selectedPlatforms || []));
  
  const thumbnailUrl = await generateThumbnailFromDraft({ draft, baseUrl });
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
    },
    thumbnails: thumbnailUrl ? { url: thumbnailUrl, generatedAt: new Date().toISOString() } : current.thumbnails,
    jobs: {
      ...(current.jobs || {}),
      content: current.jobs?.content
        ? { ...current.jobs.content, status: 'completed', completedAt: new Date().toISOString() }
        : null
    }
  }));

  try {
    const VideoDraft = require('../models/VideoDraft');
    const draftDoc = await VideoDraft.findOne({ jobId });
    if (draftDoc) {
      draftDoc.thumbnailUrl = thumbnailUrl;
      await draftDoc.save();
    }
  } catch (saveErr) {}

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

  await update({ progress: 100, currentStep: 'completed' });
  return { success: true, jobId, content: updated.content, draft: updated };
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
      : (draft?.clips?.sceneData || draft?.images?.sceneData || (Array.isArray(draft?.scenes) ? draft.scenes : null) || draft?.scenes?.sceneData || []);

  const merged = await runMergeVideo({
    payload: {
      jobId,
      clipUrls: effectiveClipUrls,
      finalAudioUrl: finalAudioUrl || draft?.mix?.finalAudioUrl || null,
      subtitles: { enabled: subtitles?.enabled === true },
      sceneData: sceneDataForSubtitles,
      durationSeconds: draft?.input?.durationSeconds || null
    },
    baseUrl,
    onProgress: async ({ progress, currentStep, metadata }) => {
      await update({ progress, currentStep, metadata });
      try {
        await updateDraft(jobId, userId, (current) => ({
          ...current,
          mergeProgress: {
            progress: Number(progress) || 0,
            stage: friendlyVideoMessage(currentStep, 'Synchronizing audio and video...'),
            metadata: metadata || null,
            updatedAt: new Date().toISOString()
          }
        }));
      } catch (_) {}
    },
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
    },
    subtitles: merged?.subtitlesUrl
      ? { url: merged.subtitlesUrl, generatedAt: new Date().toISOString() }
      : current.subtitles,
    mergeProgress: { progress: 100, stage: 'Finalizing your video...', updatedAt: new Date().toISOString() },
    jobs: {
      ...(current.jobs || {}),
      merge: current.jobs?.merge
        ? { ...current.jobs.merge, status: 'completed', completedAt: new Date().toISOString() }
        : null
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
      sceneData: draft?.clips?.sceneData || draft?.images?.sceneData || (Array.isArray(draft?.scenes) ? draft.scenes : null) || draft?.scenes?.sceneData || [],
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

function friendlyVideoMessage(message = '', fallbackMessage = 'Retrying video generation...') {
  const raw = String(message || '').trim();
  const technicalPatterns = [
    /job not found/i,
    /draft not found/i,
    /ffmpeg/i,
    /fal\.?ai/i,
    /queue/i,
    /http\s*\d{3}/i,
    /\b502\b/i,
    /internal server error/i,
    /timeout/i,
    /timed out/i,
    /failed/i,
    /error/i
  ];
  if (!raw || technicalPatterns.some((pattern) => pattern.test(raw))) {
    const fallback = String(fallbackMessage || '').trim();
    return fallback && !technicalPatterns.some((pattern) => pattern.test(fallback))
      ? fallback
      : 'Retrying video generation...';
  }
  return raw;
}

function responseError(res, error, fallbackMessage) {
  const statusCode = Number(error?.statusCode) || 500;
  return res.status(statusCode).json({
    success: false,
    message: friendlyVideoMessage(error?.message, fallbackMessage || 'Retrying video generation...')
  });
}

function reqBaseUrl(req) {
  return getPublicBaseUrl({ req });
}

router.get('/music-tracks', protect, videoJobReadLimiter, async (req, res) => {
  try {
    const durationSeconds = normalizedDurationSeconds(req.query?.durationSeconds || req.query?.duration || 60, 60);
    const { bucket, tracks } = listMusicTracksForDuration(durationSeconds);
    return res.json({
      success: true,
      durationSeconds,
      durationBucketSeconds: bucket,
      tracks
    });
  } catch (error) {
    console.error('List music tracks error:', error);
    return res.status(500).json({
      success: false,
      message: 'Unable to load music tracks'
    });
  }
});

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

function musicDurationBucket(seconds = 60) {
  const value = normalizedDurationSeconds(seconds, 60);
  const buckets = [15, 30, 45, 60];
  return buckets.reduce((best, current) => (
    Math.abs(value - current) < Math.abs(value - best) ? current : best
  ), buckets[0]);
}

function isMusicFile(fileName = '') {
  return ['.mp3', '.wav', '.m4a', '.aac', '.ogg'].includes(path.extname(String(fileName || '')).toLowerCase());
}

function cleanMusicTrackTitle(fileName = '') {
  return String(fileName || '')
    .replace(/\.[^.]+$/, '')
    .replace(/\(\s*\d+\s*\)/g, '')
    .replace(/\b\d+\s*(sec|secs|second|seconds|s)\b/gi, '')
    .replace(/\b\d{4,}\b/g, '')
    .replace(/\bamp\b/gi, 'and')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function musicTrackCategory(fileName = '') {
  const text = String(fileName || '').toLowerCase();
  if (/technology|documentary|podcast|corporate|gloss|motion|stylish/.test(text)) return 'Professional';
  if (/fun|ukulele|reggae|tropical|feelgood|reels|trending|rock|energetic/.test(text)) return 'Fun';
  if (/study|lofi|rainy|window|acoustic/.test(text)) return 'Work';
  if (/hopeful|optimistic|harmony|golden|waves|unforgettable|moments/.test(text)) return 'Inspiring';
  return 'Balanced';
}

function listMusicTracksForDuration(durationSeconds = 60) {
  const bucket = musicDurationBucket(durationSeconds);
  const dirPath = path.resolve(__dirname, '..', 'music', `${bucket}s`);
  if (!fs.existsSync(dirPath)) return { bucket, tracks: [] };

  const tracks = fs.readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isMusicFile(entry.name))
    .map((entry) => {
      const title = cleanMusicTrackTitle(entry.name);
      const category = musicTrackCategory(entry.name);
      return {
        fileName: entry.name,
        label: `${category} - ${title}`,
        durationBucketSeconds: bucket
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));

  return { bucket, tracks };
}

function normalizeAudioLanguageCode(code = 'en') {
  const normalized = String(code || '').toLowerCase().trim().replace(/_/g, '-');
  const aliases = {
    'en-us': 'en-in',
    'en-gb': 'en-in',
    hi: 'hi-in',
    ta: 'ta-in',
    te: 'te-in',
    kn: 'kn-in',
    ml: 'ml-in'
  };
  const allowed = new Set(['en', 'en-in', 'hi-in', 'ta-in', 'te-in', 'kn-in', 'ml-in']);
  if (aliases[normalized]) return aliases[normalized];
  if (allowed.has(normalized)) return normalized;
  const base = normalized.split('-')[0];
  return aliases[base] || (allowed.has(base) ? base : 'en-in');
}

function audioLanguageLabel(code = 'en') {
  const labels = {
    en: 'English (India)',
    'en-in': 'English (India)',
    'en-us': 'English (US)',
    'en-gb': 'English (UK)',
    hi: 'Hindi',
    'hi-in': 'Hindi',
    ta: 'Tamil',
    'ta-in': 'Tamil',
    te: 'Telugu',
    'te-in': 'Telugu',
    kn: 'Kannada',
    'kn-in': 'Kannada',
    ml: 'Malayalam',
    'ml-in': 'Malayalam'
  };
  return labels[normalizeAudioLanguageCode(code)] || labels.en;
}

function audioScriptLabel(code = 'en') {
  const labels = {
    en: 'Latin',
    'en-in': 'Latin',
    'en-us': 'Latin',
    'en-gb': 'Latin',
    hi: 'Devanagari',
    'hi-in': 'Devanagari',
    ta: 'Tamil',
    'ta-in': 'Tamil',
    te: 'Telugu',
    'te-in': 'Telugu',
    kn: 'Kannada',
    'kn-in': 'Kannada',
    ml: 'Malayalam',
    'ml-in': 'Malayalam'
  };
  return labels[normalizeAudioLanguageCode(code)] || labels.en;
}

async function localizeAudioScript({ text, languageCode, voiceGender = 'female', durationSeconds = 60, brandTone = 'Professional' }) {
  const source = String(text || '').replace(/\s+/g, ' ').trim();
  const normalizedLanguage = normalizeAudioLanguageCode(languageCode);
  if (!source) return source;

  const language = audioLanguageLabel(normalizedLanguage);
  const script = audioScriptLabel(normalizedLanguage);
  const selectedGender = String(voiceGender || '').toLowerCase() === 'male' ? 'Male' : 'Female';
  const safeDuration = Number.isFinite(Number(durationSeconds)) ? Number(durationSeconds) : 60;
  const systemInstruction = `You are an expert multilingual AI voice script generator for cinematic marketing videos.

Generate the narration ONLY in the language selected by the user (English, Tamil, Telugu, Malayalam, Kannada, or Hindi). Never mix languages unless explicitly requested.

Rules:
- Use ONLY the selected language.
- Select a native voice and pronunciation for the chosen language.
- Match the selected voice gender.
- Generate the script to fit the requested video duration exactly using an average speaking speed appropriate for the selected language.
- Never generate a script that is shorter or longer than the target duration.
- Preserve the brand tone, emotion, and marketing intent.
- Do not translate into another language or insert English words unless they are brand names or explicitly provided.
- Return only the narration script.`;

  const prompt = `Input:
Language: ${language}
Voice Gender: ${selectedGender}
Video Duration: ${safeDuration} seconds
Brand Tone: ${String(brandTone || 'Professional').trim() || 'Professional'}
Target Script: ${script}

Source marketing intent and draft narration:
${source}

Generate the final narration only in ${language}.`;

  try {
    const localized = await callGemini(prompt, {
      systemInstruction,
      skipCache: true,
      temperature: 0.25,
      maxTokens: 900,
      timeout: 45000
    });
    const clean = String(localized || '')
      .replace(/^```(?:\w+)?/i, '')
      .replace(/```$/i, '')
      .replace(/^\s*(?:voiceover|narration|script|translation|translated text)\s*:\s*/i, '')
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
    const videoUrl = scene?.generatedVideoUrl || scene?.video_url || scene?.videoUrl || scene?.falVideoUrl || clipUrl;

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
      generatedVideoUrl: videoUrl ? String(videoUrl) : undefined,
      clipUrl: (clipUrl || videoUrl) ? String(clipUrl || videoUrl) : undefined
    };
  });
}

function sceneClipUrl(scene = {}) {
  return String(scene?.clipUrl || scene?.generatedVideoUrl || scene?.videoUrl || scene?.video_url || scene?.falVideoUrl || '').trim();
}

function collectDraftClipUrls(draft = {}) {
  const sources = [
    ...(Array.isArray(draft?.clips?.clipUrls) ? draft.clips.clipUrls : []),
    ...(Array.isArray(draft?.clips?.sceneData) ? draft.clips.sceneData.map(sceneClipUrl) : []),
    ...(Array.isArray(draft?.scenes) ? draft.scenes.map(sceneClipUrl) : []),
    ...(Array.isArray(draft?.scenes?.sceneData) ? draft.scenes.sceneData.map(sceneClipUrl) : []),
    ...(Array.isArray(draft?.images?.sceneData) ? draft.images.sceneData.map(sceneClipUrl) : [])
  ];
  return [...new Set(sources.map((url) => String(url || '').trim()).filter(Boolean))];
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
  const sceneSummary = Array.isArray(draft?.scenes)
    ? draft.scenes
      .map((scene) => String(scene?.voiceLine || scene?.onScreenText || scene?.title || '').trim())
      .filter(Boolean)
      .slice(0, 5)
      .join(' | ')
    : Array.isArray(draft?.scenes?.sceneData)
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
  const sceneSummary = Array.isArray(draft?.scenes)
    ? draft.scenes
      .map((scene) => String(scene?.voiceLine || scene?.onScreenText || scene?.title || '').trim())
      .filter(Boolean)
      .slice(0, 5)
      .join(' | ')
    : Array.isArray(draft?.scenes?.sceneData)
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

  const { jobId, sceneId, prompt, imageUrl, duration } = req.body || {};

  if (sceneId) {
    try {
      const { generateVideoClip } = require('../services/videoService');
      const { updateDraft, loadDraftForUser } = require('../services/videoDraftStore');

      const draft = await loadDraftForUser(jobId, userId);
      if (!draft) {
        return res.status(404).json({ success: false, message: 'Draft not found' });
      }

      console.log(`🎬 Generating video clip for scene ${sceneId} with configured Fal AI video model...`);
      const sceneData = {
        sceneId,
        videoPrompt: prompt,
        imageUrl: imageUrl,
        durationSeconds: duration || 5
      };
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

    try {
      const Draft = require('../models/Draft');
      await Draft.findOneAndUpdate(
        { 'generationProgress.jobId': queued.jobId, userId: String(userId) },
        {
          $set: {
            title: String(payload.description || 'AI Video Draft').substring(0, 50),
            status: 'processing',
            sourceType: 'reel',
            contentType: 'reel',
            'generationProgress.step': 'Queued in background',
            'generationProgress.progress': 0
          }
        },
        { upsert: true, new: true }
      );
    } catch (e) {
      console.error('Failed to create Draft on enqueue:', e);
    }

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
        message: 'Retrying video generation...'
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

router.post('/jobs/:jobId/cancel', protect, videoAiWriteLimiter, async (req, res) => {
  try {
    const userId = toUserId(req.user);
    const job = await videoGenerationQueue.cancelJob(req.params.jobId, userId);
    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found or you do not have permission to cancel it.'
      });
    }
    return res.json({
      success: true,
      message: 'Job cancelled successfully.',
      job
    });
  } catch (error) {
    return responseError(res, error, 'Failed to cancel job');
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

router.put('/draft/:jobId', protect, videoAiWriteLimiter, async (req, res) => {
  try {
    const userId = toUserId(req.user);
    const updated = await updateDraft(req.params.jobId, userId, (current) => ({
      ...current,
      ...req.body
    }));
    return res.json({
      success: true,
      draft: updated
    });
  } catch (error) {
    return responseError(res, error, 'Failed to update draft');
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

router.post('/generateCharacterPreview', protect, checkTrial, videoAiWriteLimiter, async (req, res) => {
  try {
    const { name, age, gender, hairStyle, beard, race, role, personality, videoStyle, brandName, artStyle, appearance, characterImageBase64 } = req.body;
    
    let description = ``;
    if (gender) description += `Gender: ${gender}. `;
    if (age) description += `Age: ${age}. `;
    if (race) description += `Ethnicity/Race: ${race}. `;
    if (hairStyle) description += `Hair: ${hairStyle}. `;
    if (appearance) description += `Clothing/Appearance: ${appearance}. `;
    if (beard && beard !== 'Clean Shaven (No Beard)') {
      description += `Facial Hair: ${beard}. `;
    } else {
      description += `Facial Hair: Completely clean shaven, absolutely no beard or mustache or stubble. `;
    }
    
    const resolvedArtStyle = artStyle || 'Realistic / Photography';
    
    let prompt = `Create a professional Master Character Reference Sheet.
The sheet must show the exact same person in all views and preserve the identical face, hairstyle, beard, skin tone, body proportions, and age.

Include the following sections:
1. Face Views: Front view, Left profile, Right profile, 45-degree angle.
2. Body Views: Full body front, Full body side, Full body back.
3. Expression Sheet: Neutral, Happy, Serious, Thinking.
4. Pose Sheet: Standing, Walking, Sitting, Pointing.

Requirements:
- Use the exact same person in every image.
- Maintain identical facial geometry.
- Maintain identical beard style.
- Maintain identical hairstyle and hairline.
- Maintain identical skin tone and ethnicity.
- Maintain identical body proportions.
- Use a clean studio background.
- Arrange everything in a professional character reference sheet layout.
- Art Style / Format: ${resolvedArtStyle}.
- Video Theme Style: ${videoStyle || 'Cinematic, extremely high quality.'}
- CRITICAL: Do not add glasses, hats, or other face-obscuring accessories unless explicitly specified.
`;

    if (description) {
        prompt += `\nSubject details to enforce: ${description}`;
    }
    
    if (characterImageBase64) {
        prompt += `\n\nCRITICAL: You MUST base this character sheet on the exact person in the provided reference image. Keep their face and identity perfectly identical!`;
    }

    let cleanBase64 = null;
    if (characterImageBase64) {
      cleanBase64 = characterImageBase64;
      if (cleanBase64.includes('data:image')) {
        cleanBase64 = cleanBase64.split(',')[1];
      }
    }

    const imageUrl = await generateCampaignImageNanoBanana(prompt, {
      aspectRatio: '16:9',
      brandName: brandName || '',
      tone: 'professional',
      characterReferenceImage: cleanBase64 ? `data:image/jpeg;base64,${cleanBase64}` : null,
      isCinematic: !!cleanBase64
    });

    if (!imageUrl || (typeof imageUrl === 'object' && !imageUrl.imageUrl)) {
      throw new Error('Failed to generate character preview');
    }

    res.json({ success: true, imageUrl: typeof imageUrl === 'string' ? imageUrl : imageUrl.imageUrl });
  } catch (error) {
    console.error('Error in /generateCharacterPreview:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to generate character preview' });
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
    const { jobId, sceneData, saveOnly = false, promptText, regenerateSceneId } = req.body || {};
    if (!jobId) {
      return res.status(400).json({ success: false, message: 'jobId is required' });
    }

    const userId = toUserId(req.user);
    const draft = await loadDraftForUser(jobId, userId);
    const durationSeconds = normalizedDurationSeconds(draft?.input?.durationSeconds || 60, 60);

    // Per-scene regenerate: run AI for a fresh plan, splice in just the matching scene
    if (regenerateSceneId && Array.isArray(sceneData) && sceneData.length) {
      const targetIdx = sceneData.findIndex((s) => String(s.sceneId) === String(regenerateSceneId));
      if (targetIdx === -1) {
        return res.status(404).json({ success: false, message: 'Scene not found' });
      }
      const promptForRegen = String(
        promptText || draft?.prompt?.promptText || promptFallbackFromDraft(draft)
      ).trim();
      const memCtx = await buildAIContext({
        userId,
        product: draft?.input?.product || null,
        category: draft?.input?.product?.category || ''
      });
      const fresh = await runGenerateScenes({
        payload: {
          description: [promptForRegen, memCtx.reusablePromptText].filter(Boolean).join('\n\n'),
          durationSeconds,
          sceneCount: draft?.input?.sceneCount || sceneData.length,
          productId: draft?.input?.productId || undefined,
          product: draft?.input?.product || undefined,
          characterEnabled: draft?.characterEnabled,
          characterImage: draft?.characterImage,
          characterName: draft?.characterName,
          characterAge: draft?.characterAge,
          characterGender: draft?.characterGender,
          characterRole: draft?.characterRole,
          characterPersonality: draft?.characterPersonality,
          characterAppearance: draft?.characterAppearance,
          characterHairStyle: draft?.characterHairStyle,
          characterHairColor: draft?.characterHairColor,
          characterClothing: draft?.characterClothing,
          videoStyle: draft?.videoStyle,
          location: draft?.location || req.body.location || '',
          preserveIdentity: draft?.preserveIdentity,
          characterUsage: draft?.characterUsage,
          characterConsistencyStrength: draft?.characterConsistencyStrength
        },
        user: req.user
      });
      const freshScene = fresh?.sceneData?.[targetIdx];
      if (!freshScene) {
        return res.status(500).json({ success: false, message: 'AI did not return a scene at this index' });
      }
      const merged = sceneData.map((s, i) => (
        i === targetIdx ? { ...freshScene, sceneId: s.sceneId } : s
      ));
      const normalized = sanitizeSceneData(merged, durationSeconds);
      const saved = await updateDraft(jobId, userId, (current) => ({
        ...current,
        currentStep: Math.max(Number(current.currentStep || 1), 2),
        scenes: normalized
      }));
      return res.json({ success: true, jobId, sceneData: saved.scenes || [], draft: saved });
    }

    if (saveOnly && Array.isArray(sceneData)) {
      const normalizedScenes = sanitizeSceneData(sceneData, durationSeconds);
      const saved = await updateDraft(jobId, userId, (current) => ({
        ...current,
        currentStep: Math.max(Number(current.currentStep || 1), 2),
        scenes: normalizedScenes,
        productionBible: current?.productionBible || null,
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
        product: draft?.input?.product || undefined,
        characterEnabled: draft?.characterEnabled,
        characterImage: draft?.characterImage,
        characterName: draft?.characterName,
        characterAge: draft?.characterAge,
        characterGender: draft?.characterGender,
        characterRole: draft?.characterRole,
        characterPersonality: draft?.characterPersonality,
        characterAppearance: draft?.characterAppearance,
        characterHairStyle: draft?.characterHairStyle,
        characterHairColor: draft?.characterHairColor,
        characterClothing: draft?.characterClothing,
        videoStyle: draft?.videoStyle,
        location: draft?.location || req.body.location || '',
        preserveIdentity: draft?.preserveIdentity,
        characterUsage: draft?.characterUsage,
        characterConsistencyStrength: draft?.characterConsistencyStrength
      },
      user: req.user
    });

    const normalizedScenes = sanitizeSceneData(generated.sceneData || [], durationSeconds);
    const updated = await updateDraft(jobId, userId, (current) => ({
      ...current,
      currentStep: Math.max(Number(current.currentStep || 1), 2),
      scenes: normalizedScenes,
      productionBible: generated?.productionBible || current?.productionBible || null,
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

router.post('/improvePrompt', protect, checkTrial, videoAiWriteLimiter, async (req, res) => {
  try {
    const {
      jobId,
      sceneId,
      sceneIndex,
      promptType,
      userDescription,
      sceneData
    } = req.body || {};

    if (!jobId) {
      return res.status(400).json({ success: false, message: 'jobId is required' });
    }

    const normalizedPromptType = String(promptType || '').toLowerCase();
    if (!['image', 'video'].includes(normalizedPromptType)) {
      return res.status(400).json({ success: false, message: 'promptType must be image or video' });
    }

    const improvementRequest = String(userDescription || '').trim();
    if (!improvementRequest) {
      return res.status(400).json({ success: false, message: 'Describe what you want to improve.' });
    }

    const userId = toUserId(req.user);
    const draft = await loadDraftForUser(jobId, userId);
    const sourceScenes = Array.isArray(sceneData) && sceneData.length
      ? sceneData
      : Array.isArray(draft?.scenes)
        ? draft.scenes
        : Array.isArray(draft?.images?.sceneData) && draft.images.sceneData.length
          ? draft.images.sceneData
          : Array.isArray(draft?.clips?.sceneData) && draft.clips.sceneData.length
            ? draft.clips.sceneData
            : [];

    if (!sourceScenes.length) {
      return res.status(400).json({ success: false, message: 'No scene data available. Generate scenes first.' });
    }

    const explicitIndex = Number.isFinite(Number(sceneIndex)) ? Number.parseInt(String(sceneIndex), 10) : -1;
    const targetIdx = sceneId
      ? sourceScenes.findIndex((scene) => String(scene?.sceneId || scene?.id) === String(sceneId))
      : explicitIndex;

    if (targetIdx < 0 || targetIdx >= sourceScenes.length) {
      return res.status(404).json({ success: false, message: 'Scene not found' });
    }

    const promptField = normalizedPromptType === 'image' ? 'imagePrompt' : 'videoPrompt';
    const targetScene = sourceScenes[targetIdx] || {};
    const existingPrompt = String(targetScene?.[promptField] || '').trim();
    if (!existingPrompt) {
      return res.status(400).json({ success: false, message: `Selected scene has no ${promptField}.` });
    }

    const systemInstruction = `You are an expert AI Prompt Refinement Assistant for cinematic image and video generation.

Your task is to improve an existing prompt based ONLY on the user's requested modifications.

Rules:

1. Update ONLY the selected prompt.
2. Do NOT modify prompts from other scenes.
3. Preserve the existing story continuity.
4. Preserve the same character identity, face, clothing, age, hairstyle, body proportions, and background unless explicitly requested.
5. Preserve the same scene purpose and narrative.
6. Preserve camera framing and composition unless the user requests a different camera angle.
7. Preserve lighting, mood, and environment unless explicitly requested.
8. Apply ONLY the requested improvements.
9. If the user asks to add something, integrate it naturally into the existing prompt.
10. If the user asks to remove something, remove only that element.
11. Do not rewrite the prompt from scratch unless required.
12. Return ONLY the updated prompt.
13. Do not explain your changes.
14. Do not return markdown.
15. Keep the prompt optimized for high-quality AI image/video generation.`;

    const userPrompt = `Scene:
Scene ${targetIdx + 1}

Prompt Type:
${normalizedPromptType === 'image' ? 'Image Prompt' : 'Video Prompt'}

Existing Prompt:
${existingPrompt}

User Improvement Request:
${improvementRequest}

Update only this prompt.`;

    const rawUpdatedPrompt = await callGemini(userPrompt, {
      systemInstruction,
      skipCache: true,
      temperature: 0.35,
      maxTokens: 1600,
      timeout: 45000,
      taskType: 'video_prompt_improvement'
    });

    const updatedPrompt = String(rawUpdatedPrompt || '')
      .replace(/^```(?:\w+)?/i, '')
      .replace(/```$/i, '')
      .replace(/^\s*(?:updated prompt|image prompt|video prompt)\s*:\s*/i, '')
      .trim();

    if (!updatedPrompt) {
      return res.status(500).json({ success: false, message: 'AI did not return an updated prompt.' });
    }

    const updatedScenes = sourceScenes.map((scene, index) => (
      index === targetIdx ? { ...scene, [promptField]: updatedPrompt } : scene
    ));

    const saved = await updateDraft(jobId, userId, (current) => ({
      ...current,
      currentStep: Math.max(Number(current.currentStep || 1), 2),
      scenes: updatedScenes,
      images: current?.images?.sceneData?.length
        ? {
          ...(current.images || {}),
          sceneData: updatedScenes.map((scene, index) => ({
            ...(current.images.sceneData[index] || {}),
            ...scene
          }))
        }
        : current.images,
      clips: current?.clips?.sceneData?.length
        ? {
          ...(current.clips || {}),
          sceneData: updatedScenes.map((scene, index) => ({
            ...(current.clips.sceneData[index] || {}),
            ...scene
          }))
        }
        : current.clips
    }));

    await learnVideoStep({
      userId,
      jobId,
      action: 'video_prompt',
      prompt: updatedPrompt,
      userInput: draft.input || {},
      sceneData: saved.scenes,
      scenePrompts: saved.scenes?.map((scene) => scene.imagePrompt || scene.videoPrompt || scene.title) || [],
      product: draft?.input?.product || null,
      aiSettings: {
        promptImprovement: true,
        promptType: normalizedPromptType,
        sceneIndex: targetIdx + 1
      }
    });

    return res.json({
      success: true,
      jobId,
      sceneData: saved.scenes || [],
      updatedPrompt,
      promptType: normalizedPromptType,
      sceneIndex: targetIdx,
      draft: saved
    });
  } catch (error) {
    return responseError(res, error, 'Failed to improve prompt');
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
      (Array.isArray(draft?.scenes) ? draft.scenes : null) ||
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
      const originalSceneImageUrl = String(imageUrl || targetScene.imageUrl || targetScene.generatedImageUrl || '').trim();
      const rawScenePrompt = String(imagePrompt || targetScene.imagePrompt || draft?.prompt?.promptText || '').trim();
      const refinementGuardrails = [
        'You are performing a targeted image refinement of an existing scene.',
        'Keep the same subject identity, same face, same character, same pose, same camera framing, same overall composition, and same background unless the user explicitly asks to change one of those elements.',
        'If the user requests only a small attribute change such as changing clothing color, accessory, or prop, only modify that requested attribute and preserve everything else as closely as possible.',
        'Do NOT redesign the scene, change the camera angle, change the subject, or create a new composition.',
        'Do NOT switch the model or make the scene look like a different shot. Preserve the original scene layout and continuity.'
      ].join(' ');
      let regenPrompt = `${refinementGuardrails}\n\nUSER REFINEMENT REQUEST:\n${rawScenePrompt}`;
      let finalRegenImageUrl = null;
      const characterEnabled = draft?.characterEnabled || (Array.isArray(draft?.characters) && draft.characters.length > 0);
      const mainCharacterUrl = Array.isArray(draft?.characters) && draft.characters.length > 0
        ? (draft.characters.find(c => String(c.role || '').toLowerCase() === 'bride' || String(c.name || '').toLowerCase() === 'priya')?.imageUrl || draft.characters[0]?.imageUrl)
        : null;

      const characterImage = req.body.characterImageBase64 || draft?.characterImage || mainCharacterUrl;

      if (characterEnabled && characterImage) {
          const characterName = req.body.characterName || (Array.isArray(draft?.characters) && draft.characters[0]?.name) || '';
          const videoStyle = req.body.videoStyle || draft?.videoStyle || 'Cinematic';

          // Inject strict demographics from draft
          const demographics = [
            draft?.characterRace ? `${draft.characterRace} ethnicity` : '',
            draft?.characterAge ? `${draft.characterAge} years old` : '',
            draft?.characterGender ? draft.characterGender : '',
            draft?.characterBeard && draft?.characterBeard !== 'Clean Shaven (No Beard)' ? `with ${draft.characterBeard}` : (draft?.characterBeard === 'Clean Shaven (No Beard)' ? 'completely clean shaven, absolutely no facial hair' : '')
          ].filter(Boolean).join(', ');

          const demographicString = demographics ? `The character is a ${demographics}.` : '';
          const strictContext = `CRITICAL INSTRUCTION: You MUST exactly recreate the face and identity of the person in the reference image. ${demographicString} DO NOT change their facial structure, skin tone, or demographic. Match the reference image 100%.`;
          
          regenPrompt = `${strictContext}\n\nSCENE TO GENERATE:\n${regenPrompt}`;

          try {
            const nanoResult = await generateCampaignImageNanoBanana(regenPrompt, {
              isCinematic: true,
              aspectRatio: '9:16', // default for video
              characterReferenceImage: characterImage,
              originalCharacterImage: characterImage,
              previousSceneImage: originalSceneImageUrl || null,
              preserveCharacterIdentity: true,
              consistencyStrength: 'strict'
            });
            
            if (nanoResult && (nanoResult.imageUrl || typeof nanoResult === 'string')) {
                finalRegenImageUrl = typeof nanoResult === 'string' ? nanoResult : nanoResult.imageUrl;
            } else {
                throw new Error('Nano Banana returned no image');
            }
          } catch (error) {
            console.error('Nano Banana API Error:', error);
            return res.status(500).json({ success: false, message: 'Nano Banana API Error: ' + error.message });
          }
      } else {
        const regen = await generateCampaignImageNanoBanana(regenPrompt, {
          isCinematic: true,
          aspectRatio: '9:16',
          linkedProduct: draft?.input?.product || null,
          previousSceneImage: originalSceneImageUrl || null,
          productReferenceImage: draft?.input?.sourceImage?.url || draft?.input?.product?.imageUrl || null,
          tone: 'professional'
        });
        if (!regen?.success || !regen?.imageUrl) {
          throw new Error(regen?.error || 'Image regeneration failed');
        }
        finalRegenImageUrl = regen.imageUrl;
      }
      nextScenes = sourceScenes.map((scene, index) => (
        index === idx
          ? {
            ...scene,
            imageUrl: finalRegenImageUrl,
            generatedImageUrl: finalRegenImageUrl,
            imagePrompt: targetScene.imagePrompt || rawScenePrompt
          }
          : scene
      ));
    } else {
      const characterEnabled = draft?.characterEnabled || (Array.isArray(draft?.characters) && draft.characters.length > 0);
      const mainCharacterUrl = Array.isArray(draft?.characters) && draft.characters.length > 0
        ? (draft.characters.find(c => String(c.role || '').toLowerCase() === 'bride' || String(c.name || '').toLowerCase() === 'priya')?.imageUrl || draft.characters[0]?.imageUrl)
        : null;

      const characterImage = req.body.characterImageBase64 || draft?.characterImage || mainCharacterUrl || undefined;

      const generated = await runGenerateImages({
        payload: {
          jobId,
          bypassCache: req.body.bypassCache === true || action === 'generateAll',
          description: String(draft?.prompt?.promptText || draft?.input?.description || ''),
          durationSeconds,
          sceneCount: draft?.input?.sceneCount || sourceScenes.length,
          imageUrl: draft?.input?.sourceImage?.url || undefined,
          productId: draft?.input?.productId || undefined,
          product: draft?.input?.product || undefined,
          sceneData: sourceScenes,
          globalVisualStyle: draft?.scenesMetadata?.globalVisualStyle || draft?.scenes?.globalVisualStyle || '',
          voiceScript: draft?.scenesMetadata?.voiceScript || draft?.scenes?.voiceScript || '',
          thumbnailPrompt: draft?.scenesMetadata?.thumbnailPrompt || draft?.scenes?.thumbnailPrompt || '',
          characterImageBase64: req.body.characterImageBase64 || draft?.characterImageBase64 || undefined,
          characterName: req.body.characterName || draft?.characterName || undefined,
          videoStyle: req.body.videoStyle || draft?.videoStyle || undefined,
          characters: draft?.characters || [],
          characterEnabled: characterEnabled,
          characterImage: characterImage,
          originalCharacterImage: characterImage,
          preserveIdentity: draft?.preserveIdentity,
          characterConsistencyStrength: draft?.characterConsistencyStrength,
          characterRace: draft?.characterRace,
          characterBeard: draft?.characterBeard,
          characterAge: draft?.characterAge,
          characterGender: draft?.characterGender,
          characterHairStyle: draft?.characterHairStyle,
          characterAppearance: draft?.characterAppearance,
          useLogo: req.body.useLogo !== undefined ? req.body.useLogo : (draft?.useLogo !== undefined ? draft.useLogo : (draft?.input?.useLogo !== undefined ? draft.input.useLogo : false))
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
      (Array.isArray(draft?.scenes) ? draft.scenes : null) ||
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
      },
      jobs: {
        ...(current.jobs || {}),
        clips: current.jobs?.clips
          ? { ...current.jobs.clips, status: 'completed', completedAt: new Date().toISOString() }
          : null
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
      (Array.isArray(draft?.scenes) && draft.scenes.length ? draft.scenes : null) ||
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
      audioPriority: ['voice', 'balanced', 'music'].includes(String(audio?.audioPriority || audio?.priorityMode || '').toLowerCase())
        ? String(audio?.audioPriority || audio?.priorityMode).toLowerCase()
        : 'balanced',
      tone: String(audio?.tone || 'professional').toLowerCase(),
      brandTone: String(audio?.brandTone || draft?.input?.brandTone || draft?.brandTone || 'Professional').trim() || 'Professional',
      musicSource: String(audio?.musicSource || process.env.AI_VIDEO_MUSIC_SOURCE || 'library').toLowerCase(),
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
    audioConfig.voiceGender = audioConfig.voiceGender === 'male' ? 'male' : 'female';

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
      finalVideoUrl: null,
      audio: {
        config: {
          ...audioConfig,
          localizedVoiceScript: generated?.localizedVoiceScript || null,
          localizedSceneData: generated?.localizedSceneData || null
        },
        tracks: generated?.tracks || {},
        generatedAt: new Date().toISOString()
      },
      mix: null,
      merge: null,
      jobs: {
        ...(current.jobs || {}),
        merge: null
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
    const bodyAudio = req.body?.audio || {};
    const requestedPriority = String(bodyAudio?.audioPriority || req.body?.audioPriority || req.body?.priorityMode || '').toLowerCase();
    const mixAudioConfig = {
      ...(draft?.audio?.config || {}),
      ...(bodyAudio || {}),
      audioPriority: ['voice', 'balanced', 'music'].includes(requestedPriority)
        ? requestedPriority
        : (draft?.audio?.config?.audioPriority || 'balanced'),
      voiceVolume: Number.isFinite(Number(req.body?.voiceVolume))
        ? Number(req.body.voiceVolume)
        : (Number.isFinite(Number(bodyAudio?.voiceVolume)) ? Number(bodyAudio.voiceVolume) : draft?.audio?.config?.voiceVolume),
      musicVolume: Number.isFinite(Number(req.body?.musicVolume))
        ? Number(req.body.musicVolume)
        : (Number.isFinite(Number(bodyAudio?.musicVolume)) ? Number(bodyAudio.musicVolume) : draft?.audio?.config?.musicVolume)
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
        audio: mixAudioConfig
      },
      baseUrl: reqBaseUrl(req)
    });

    const updated = await updateDraft(jobId, userId, (current) => ({
      ...current,
      currentStep: Math.max(Number(current.currentStep || 1), 6),
      mix: {
        finalAudioUrl: mixed?.finalAudioUrl || null,
        mixedAt: new Date().toISOString()
      },
      audio: current.audio
        ? {
          ...current.audio,
          config: {
            ...(current.audio.config || {}),
            ...mixAudioConfig
          }
        }
        : current.audio
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
      ? clipUrls.map((url) => String(url || '').trim()).filter(Boolean)
      : collectDraftClipUrls(draft);
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
        durationSeconds: draft?.input?.durationSeconds || null,
        sceneData: (
          subtitles?.enabled === true &&
          draft?.audio?.config?.languageCode &&
          draft.audio.config.languageCode !== 'en' &&
          Array.isArray(draft?.audio?.config?.localizedSceneData) &&
          draft.audio.config.localizedSceneData.length
        )
          ? draft.audio.config.localizedSceneData
          : (draft?.clips?.sceneData || draft?.images?.sceneData || (Array.isArray(draft?.scenes) ? draft.scenes : null) || draft?.scenes?.sceneData || [])
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
      },
      subtitles: merged?.subtitlesUrl
        ? { url: merged.subtitlesUrl, generatedAt: new Date().toISOString() }
        : current.subtitles,
      mergeProgress: { progress: 100, stage: 'Finalizing your video...', updatedAt: new Date().toISOString() },
      jobs: {
        ...(current.jobs || {}),
        merge: current.jobs?.merge
          ? { ...current.jobs.merge, status: 'completed', completedAt: new Date().toISOString() }
          : null
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
      sceneData: draft?.clips?.sceneData || draft?.images?.sceneData || (Array.isArray(draft?.scenes) ? draft.scenes : null) || draft?.scenes?.sceneData || [],
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
      },
      thumbnails: thumbnailUrl ? { url: thumbnailUrl, generatedAt: new Date().toISOString() } : current.thumbnails
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
