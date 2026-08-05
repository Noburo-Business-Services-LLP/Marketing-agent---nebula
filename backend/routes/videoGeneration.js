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
  runMergeVideo,
  generateStoryAndSkeleton,
  generateSingleScene,
  normalizeCreateInput,
  materializeSourceToFile,
  normalizeSceneVideoClip,
  createJobContext
} = require('../services/videoGenerationPipeline');
const { generateVideoClip } = require('../services/videoService');
const { uploadVideoFile } = require('../services/imageUploader');
const BrandAsset = require('../models/BrandAsset');
const sharp = require('sharp');

// Post-generation verification for scene images. Checks the returned
// image against the expected aspect ratio; if it's off by more than
// the tolerance, the caller can regenerate. Returns { ok, ratio,
// width, height, expected, deltaPct }.
async function verifySceneImageAspect(imageUrl, expectedAspect) {
  const aspectMap = { '9:16': 9 / 16, '16:9': 16 / 9, '1:1': 1, '4:5': 4 / 5 };
  const expectedNum = aspectMap[expectedAspect] || 9 / 16;
  try {
    let buf;
    if (imageUrl.startsWith('data:')) {
      const b64 = imageUrl.split(',')[1] || '';
      buf = Buffer.from(b64, 'base64');
    } else {
      const r = await fetch(imageUrl);
      if (!r.ok) return { ok: true, skipped: true, reason: `fetch HTTP ${r.status}` };
      buf = Buffer.from(await r.arrayBuffer());
    }
    const meta = await sharp(buf).metadata();
    const actualRatio = meta.width / meta.height;
    const deltaPct = Math.abs(actualRatio - expectedNum) / expectedNum;
    return {
      ok: deltaPct <= 0.10, // within 10% tolerance
      width: meta.width,
      height: meta.height,
      actualRatio: Number(actualRatio.toFixed(3)),
      expectedRatio: Number(expectedNum.toFixed(3)),
      deltaPct: Number((deltaPct * 100).toFixed(1)),
      expected: expectedAspect
    };
  } catch (e) {
    // If the check itself fails, don't block — treat as pass.
    return { ok: true, skipped: true, reason: e.message };
  }
}
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
const { callOpenAI } = require('../services/openAI');
const User = require('../models/User');
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
      : (draft?.clips?.sceneData || draft?.images?.sceneData || draft?.scenes?.sceneData || []);

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
  // Log the real exception + stack so we can see silent failures.
  console.error(`[responseError] ${statusCode} · ${fallbackMessage || ''} · ${error?.message || error}`);
  if (error?.stack) console.error(error.stack);
  return res.status(statusCode).json({
    success: false,
    message: friendlyVideoMessage(error?.message, fallbackMessage || 'Retrying video generation...')
  });
}

function reqBaseUrl(req) {
  return getPublicBaseUrl({ req });
}

// ============================================================
// ElevenLabs VOICE CATALOG
// GET /elevenlabs-voices?languageCode=en&gender=female
// Returns every voice on the user's ElevenLabs account, filtered
// by language + gender. Each returned entry includes a
// `isFavourite` flag so the frontend can render the star state
// correctly.
// ============================================================
router.get('/elevenlabs-voices', protect, videoJobReadLimiter, async (req, res) => {
  try {
    const apiKey = String(process.env.ELEVENLABS_API_KEY || '').trim();
    if (!apiKey) {
      return res.status(503).json({
        success: false,
        message: 'ELEVENLABS_API_KEY not configured on backend. Add it to backend/.env to unlock voice selection.'
      });
    }
    const requestedLang = String(req.query?.languageCode || 'en').toLowerCase().trim();
    const requestedGender = String(req.query?.gender || '').toLowerCase().trim();

    // ElevenLabs' /v1/shared-voices is quirky:
    //   - `?language=xx` returns 100 voices in a mix of locales
    //   - `?gender=xx` combined with search often returns 0
    //   - `?page=N` scrambles the result set (returns junk)
    //   - `?page_size>100` returns 0 (silent cap)
    // Workaround: fetch ONE page with just `?language=xx&page_size=100`,
    // then filter locally by locale (e.g. "ta-IN") + gender. That
    // reliably yields the real native voices ElevenLabs has.
    const [accountRes, sharedRes] = await Promise.all([
      fetch('https://api.elevenlabs.io/v2/voices?page_size=100', {
        headers: { 'xi-api-key': apiKey }
      }).catch(() => null),
      fetch(`https://api.elevenlabs.io/v1/shared-voices?language=${encodeURIComponent(requestedLang)}&page_size=100`, {
        headers: { 'xi-api-key': apiKey }
      }).catch(() => null)
    ]);

    if (!accountRes || !accountRes.ok) {
      const details = accountRes ? await accountRes.text().catch(() => '') : 'no response';
      return res.status(502).json({
        success: false,
        message: `ElevenLabs /v2/voices returned HTTP ${accountRes?.status || 'ERR'}: ${details.slice(0, 200)}`
      });
    }

    const accountPayload = await accountRes.json();
    const accountVoices = Array.isArray(accountPayload?.voices) ? accountPayload.voices : [];

    const rawShared = [];
    if (sharedRes && sharedRes.ok) {
      const p = await sharedRes.json();
      rawShared.push(...(p.voices || []));
    }
    console.log(`[elevenlabs-voices] lang=${requestedLang} gender=${requestedGender || 'any'} — raw shared voices: ${rawShared.length}`);

    // Shape shared voices (community library) into the same shape as
    // /v2/voices so downstream code can treat them uniformly. Also
    // stamp `sharedOwnerId` so TTS can auto-add on first use.
    const sharedVoices = rawShared.map((v) => ({
      voice_id: v.voice_id,
      name: v.name,
      category: 'shared',
      preview_url: v.preview_url,
      // Preserve the ORIGINAL locale from ElevenLabs (e.g. "ta-IN",
      // "hi-IN", "fi-FI") — the /shared-voices?language= filter is
      // unreliable, but locale is the ground-truth per-voice signal.
      _locale: v.locale || '',
      labels: {
        language: v.language,
        accent: v.accent,
        gender: v.gender,
        age: v.age,
        use_case: v.use_case,
        description: v.description
      },
      // Only claim verified_languages if the locale actually starts
      // with the language code. Prevents Turkish voices with
      // language:"ta" (echoed by the query) from being flagged native.
      verified_languages: (String(v.locale || '').toLowerCase().startsWith(String(v.language || '').toLowerCase()))
        ? [{ language: v.language, accent: v.accent, locale: v.locale }]
        : [],
      high_quality_base_model_ids: ['eleven_multilingual_v2'],
      _sharedOwnerId: v.public_owner_id
    }));

    // Dedup by voice_id — account voices take precedence over shared.
    const seenIds = new Set(accountVoices.map((v) => v.voice_id));
    const mergedShared = sharedVoices.filter((v) => !seenIds.has(v.voice_id));
    const rawVoices = [...accountVoices, ...mergedShared];

    // STRICT language filter. ElevenLabs stores language info in:
    //   - labels.language  (older voices, string like "english"/"hindi")
    //   - labels.accent    (like "american"/"british"/"indian"/"tamil")
    //   - verified_languages [{ language: "en" | "hi" | "ta" | ... }]
    // For English we accept multilingual voices (they sound native
    // enough in English). For non-English languages we require the
    // voice to be EXPLICITLY verified / labelled for that language —
    // multilingual English voices reading Tamil sound wrong and are
    // NOT what the user asked for.
    const langLabelMap = {
      en: { tokens: ['english', 'en'], allowMultilingualFallback: true },
      hi: { tokens: ['hindi', 'hi', 'indian'], allowMultilingualFallback: false },
      ta: { tokens: ['tamil', 'ta'], allowMultilingualFallback: false },
      te: { tokens: ['telugu', 'te'], allowMultilingualFallback: false },
      kn: { tokens: ['kannada', 'kn'], allowMultilingualFallback: false },
      ml: { tokens: ['malayalam', 'ml'], allowMultilingualFallback: false }
    };
    const langCfg = langLabelMap[requestedLang] || { tokens: [requestedLang], allowMultilingualFallback: false };
    const targetLangTokens = langCfg.tokens.map((s) => s.toLowerCase());

    // A voice is NATIVE for the language iff its LOCALE starts with
    // the language code (e.g. locale "ta-IN" for Tamil, "hi-IN" for
    // Hindi). ElevenLabs' `?language=` query filter is broken — it
    // returns voices of every locale. Locale is the ground-truth
    // per-voice field.
    // For account voices (no locale field), we still fall back to
    // verified_languages / labels — they're vetted premades anyway.
    const isNativeForLang = (voice) => {
      // Shared library voice — trust locale only
      const locale = String(voice?._locale || '').toLowerCase();
      if (locale) {
        return targetLangTokens.some((t) => locale.startsWith(`${t}-`) || locale === t);
      }
      // Account voice — no locale, use verified_languages + labels
      const verified = Array.isArray(voice?.verified_languages) ? voice.verified_languages : [];
      if (verified.some((v) => targetLangTokens.includes(String(v?.language || '').toLowerCase()))) return true;
      if (verified.some((v) => targetLangTokens.includes(String(v?.accent || '').toLowerCase()))) return true;
      const labelLang = String(voice?.labels?.language || '').toLowerCase();
      if (labelLang && targetLangTokens.some((t) => labelLang.includes(t))) return true;
      const labelAccent = String(voice?.labels?.accent || '').toLowerCase();
      if (labelAccent && targetLangTokens.some((t) => labelAccent.includes(t))) return true;
      return false;
    };

    const isMultilingualCapable = (voice) => {
      const models = Array.isArray(voice?.high_quality_base_model_ids) ? voice.high_quality_base_model_ids : [];
      return models.some((m) => /multilingual/i.test(String(m || '')));
    };

    const matchesGender = (voice) => {
      if (!requestedGender) return true;
      const g = String(voice?.labels?.gender || voice?.labels?.Gender || '').toLowerCase();
      return g.includes(requestedGender);
    };

    // Pull the user's saved favourites to mark stars.
    const userId = toUserId(req.user);
    const userDoc = userId ? await User.findById(userId).lean().catch(() => null) : null;
    const favVoices = Array.isArray(userDoc?.businessProfile?.brandAssets?.favouriteVoices)
      ? userDoc.businessProfile.brandAssets.favouriteVoices
      : [];
    const favSet = new Set(favVoices.map((v) => String(v?.voiceId || '')).filter(Boolean));

    const shapeVoice = (v, isNative) => ({
      voiceId: v.voice_id,
      name: v.name,
      gender: String(v?.labels?.gender || '').toLowerCase(),
      accent: String(v?.labels?.accent || ''),
      description: String(v?.labels?.description || ''),
      age: String(v?.labels?.age || ''),
      useCase: String(v?.labels?.use_case || v?.labels?.['use case'] || ''),
      previewUrl: String(v?.preview_url || ''),
      category: String(v?.category || 'premade'),
      isFavourite: favSet.has(String(v.voice_id)),
      isNative: !!isNative,
      // Non-null only for community-library voices — signals to the
      // TTS pipeline that the voice must be added to the user's
      // account before it can be used.
      sharedOwnerId: v._sharedOwnerId || null
    });

    // Native voices first. If none exist for a non-English language AND
    // the caller passed `?includeMultilingual=1`, also return
    // multilingual-capable voices flagged with isNative=false so the UI
    // can show them under a "non-native fallback" section. Default is
    // native-only, which is what the user asked for.
    const includeMultilingual = String(req.query?.includeMultilingual || '').trim() === '1';

    const genderFiltered = rawVoices.filter(matchesGender);
    const nativeVoices = genderFiltered.filter(isNativeForLang).map((v) => shapeVoice(v, true));

    let voices = nativeVoices;
    if (langCfg.allowMultilingualFallback) {
      // For English we always merge in the multilingual pool (they
      // ARE English voices — no accent mismatch to worry about).
      const multilingualExtras = genderFiltered
        .filter((v) => isMultilingualCapable(v) && !isNativeForLang(v))
        .map((v) => shapeVoice(v, false));
      voices = [...nativeVoices, ...multilingualExtras];
    } else if (includeMultilingual) {
      const multilingualExtras = genderFiltered
        .filter((v) => isMultilingualCapable(v) && !isNativeForLang(v))
        .map((v) => shapeVoice(v, false));
      voices = [...nativeVoices, ...multilingualExtras];
    }

    return res.json({
      success: true,
      languageCode: requestedLang,
      gender: requestedGender || null,
      count: voices.length,
      nativeCount: nativeVoices.length,
      hasNativeVoices: nativeVoices.length > 0,
      canFallback: !langCfg.allowMultilingualFallback && nativeVoices.length === 0,
      voices
    });
  } catch (error) {
    console.error('[elevenlabs-voices] error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Failed to list ElevenLabs voices' });
  }
});

// POST /favourite-audio — toggle a generated audio track (voice, music,
// or mix) on/off the user's favouriteAudioTracks list. Body:
//   { url, kind: 'voice'|'music'|'mix', label?, prompt?, durationSeconds?,
//     languageCode?, voiceId?, action?: 'add'|'remove' }
router.post('/favourite-audio', protect, videoJobReadLimiter, async (req, res) => {
  try {
    const { url, kind = 'music', label = '', prompt = '', durationSeconds = 0, languageCode = '', voiceId = '', action } = req.body || {};
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ success: false, message: 'url is required' });
    }
    const userId = toUserId(req.user);
    if (!userId) return res.status(401).json({ success: false, message: 'Auth required' });
    const doc = await User.findById(userId);
    if (!doc) return res.status(404).json({ success: false, message: 'User not found' });
    if (!doc.businessProfile) doc.businessProfile = {};
    if (!doc.businessProfile.brandAssets) doc.businessProfile.brandAssets = {};
    const list = Array.isArray(doc.businessProfile.brandAssets.favouriteAudioTracks)
      ? doc.businessProfile.brandAssets.favouriteAudioTracks
      : [];
    const idx = list.findIndex((t) => String(t?.url) === String(url));
    const wantRemove = action === 'remove' || (action !== 'add' && idx !== -1);
    if (wantRemove) {
      if (idx !== -1) list.splice(idx, 1);
    } else if (idx === -1) {
      list.push({
        url,
        kind: ['voice', 'music', 'mix'].includes(kind) ? kind : 'music',
        label,
        prompt,
        durationSeconds: Number(durationSeconds) || 0,
        languageCode,
        voiceId,
        addedAt: new Date()
      });
    }
    doc.businessProfile.brandAssets.favouriteAudioTracks = list;
    doc.markModified('businessProfile.brandAssets.favouriteAudioTracks');
    await doc.save();
    return res.json({
      success: true,
      action: wantRemove ? 'removed' : 'added',
      favouriteAudioTracks: list
    });
  } catch (error) {
    console.error('[favourite-audio] error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Failed to toggle favourite audio' });
  }
});

// GET /favourite-audio — list the user's saved audio tracks.
router.get('/favourite-audio', protect, videoJobReadLimiter, async (req, res) => {
  try {
    const userId = toUserId(req.user);
    if (!userId) return res.status(401).json({ success: false, message: 'Auth required' });
    const u = await User.findById(userId).lean().catch(() => null);
    const list = Array.isArray(u?.businessProfile?.brandAssets?.favouriteAudioTracks)
      ? u.businessProfile.brandAssets.favouriteAudioTracks
      : [];
    return res.json({ success: true, count: list.length, tracks: list });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to list favourite audio' });
  }
});

// POST /favourite-voice — toggle a voice on/off the user's favourites list.
router.post('/favourite-voice', protect, videoJobReadLimiter, async (req, res) => {
  try {
    const { voiceId, name = '', gender = '', language = '', accent = '', previewUrl = '', category = '', action } = req.body || {};
    if (!voiceId || typeof voiceId !== 'string') {
      return res.status(400).json({ success: false, message: 'voiceId is required' });
    }
    const userId = toUserId(req.user);
    if (!userId) return res.status(401).json({ success: false, message: 'Auth required' });
    const doc = await User.findById(userId);
    if (!doc) return res.status(404).json({ success: false, message: 'User not found' });
    if (!doc.businessProfile) doc.businessProfile = {};
    if (!doc.businessProfile.brandAssets) doc.businessProfile.brandAssets = {};
    const list = Array.isArray(doc.businessProfile.brandAssets.favouriteVoices)
      ? doc.businessProfile.brandAssets.favouriteVoices
      : [];
    const idx = list.findIndex((v) => String(v?.voiceId) === String(voiceId));
    const wantRemove = action === 'remove' || (action !== 'add' && idx !== -1);
    if (wantRemove) {
      if (idx !== -1) list.splice(idx, 1);
    } else if (idx === -1) {
      list.push({ voiceId, name, gender, language, accent, previewUrl, category, addedAt: new Date() });
    }
    doc.businessProfile.brandAssets.favouriteVoices = list;
    doc.markModified('businessProfile.brandAssets.favouriteVoices');
    await doc.save();
    return res.json({
      success: true,
      action: wantRemove ? 'removed' : 'added',
      favouriteVoices: list
    });
  } catch (error) {
    console.error('[favourite-voice] error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Failed to toggle favourite voice' });
  }
});

// POST /updateEnvironment — save the user's env lock config for a
// specific draft. Called by the Environment step's Next button.
router.post('/updateEnvironment', protect, videoJobReadLimiter, async (req, res) => {
  try {
    const { jobId, environment } = req.body || {};
    if (!jobId) return res.status(400).json({ success: false, message: 'jobId is required' });
    const userId = toUserId(req.user);
    const cleaned = {
      enabled: !!environment?.enabled,
      referenceImages: Array.isArray(environment?.referenceImages)
        ? environment.referenceImages
            .filter((r) => r && (r.url || r.dataUrl))
            .map((r) => ({
              url: String(r.url || '').trim(),
              dataUrl: String(r.dataUrl || '').trim(),
              source: r.source === 'brand-asset' ? 'brand-asset' : 'upload'
            }))
            .slice(0, 5)
        : [],
      notes: String(environment?.notes || '').trim().slice(0, 500)
    };
    const saved = await updateDraft(jobId, userId, (current) => ({
      ...current,
      environment: cleaned,
      input: { ...(current.input || {}), environment: cleaned }
    }));
    return res.json({ success: true, jobId, environment: cleaned, draft: saved });
  } catch (error) {
    return responseError(res, error, 'Failed to save environment');
  }
});

// GET /brand-assets/images — return the user's saved brand asset
// images (extracted from their website during onboarding). Used by
// the Environment step's picker so the user can select their own
// storefront / interior photos without re-uploading.
router.get('/brand-assets/images', protect, videoJobReadLimiter, async (req, res) => {
  try {
    const userId = toUserId(req.user);
    // Pull from BOTH sources and merge/dedupe:
    //   1) BrandAsset collection (logos, images the user uploaded via
    //      the Brand Assets page — canonical location)
    //   2) businessProfile.brandAssets (legacy — website scraper)
    const brandAssetDocs = userId
      ? await BrandAsset.find({ user: userId }).sort({ createdAt: -1 }).lean().catch(() => [])
      : [];
    const user = userId ? await User.findById(userId).lean().catch(() => null) : null;
    const legacy = user?.businessProfile?.brandAssets || {};
    const legacyImages = Array.isArray(legacy.images) ? legacy.images : [];

    const combined = [];
    for (const doc of brandAssetDocs) {
      if (!doc?.url) continue;
      combined.push({
        url: String(doc.url),
        alt: String(doc.name || doc.type || ''),
        isLogo: doc.type === 'logo'
      });
    }
    if (legacy.logoUrl) combined.push({ url: legacy.logoUrl, alt: 'Brand logo', isLogo: true });
    if (legacy.ogImage) combined.push({ url: legacy.ogImage, alt: 'OG image', isLogo: false });
    for (const img of legacyImages) {
      if (img?.src) combined.push({ url: img.src, alt: img.alt || '', isLogo: !!img.isLogo });
    }
    const deduped = combined.filter((img, idx, arr) => arr.findIndex((x) => x.url === img.url) === idx);
    return res.json({
      success: true,
      count: deduped.length,
      images: deduped
    });
  } catch (error) {
    return responseError(res, error, 'Failed to list brand assets');
  }
});

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

async function localizeAudioScript({ text, languageCode }) {
  const source = String(text || '').replace(/\s+/g, ' ').trim();
  const normalizedLanguage = normalizeAudioLanguageCode(languageCode);
  if (!source || normalizedLanguage.startsWith('en')) return source;

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


// ============================================================
// POST /generateConcepts — "Creative Director" video concept generation
// Sources the prompt from Video Concept Prompt.docx: creates 3 completely
// different premium brand-film concepts (emotional / inspirational /
// unexpected) with a recommendation for the strongest one. User can
// accept one to proceed, or regenerate to get a fresh set of 3.
// ============================================================
router.post('/generateConcepts', protect, checkTrial, videoAiWriteLimiter, async (req, res) => {
  try {
    const userId = toUserId(req.user);
    const description = String(req.body?.description || '').trim();
    const durationSeconds = Number(req.body?.durationSeconds || 30);
    if (!description) {
      return res.status(400).json({ success: false, message: 'description is required' });
    }

    const user = await User.findById(userId).lean().catch(() => null);
    const bp = user?.businessProfile || {};
    const brandName = String(bp.name || bp.companyName || 'Your Brand').trim();
    const industry = String(bp.industry || 'General').trim();
    const brandSummary = String(bp.description || bp.bio || bp.about || 'A premium brand').trim();
    const targetAudience = String(bp.targetAudience || 'General audience').trim();
    const brandTone = Array.isArray(bp.brandVoice)
      ? bp.brandVoice.join(', ')
      : String(bp.brandVoice || bp.tone || 'Premium').trim();
    const competitors = Array.isArray(bp.competitors)
      ? bp.competitors.slice(0, 5).map((c) => (typeof c === 'string' ? c : c?.name || '')).filter(Boolean).join(', ')
      : String(bp.competitors || '').trim();
    const conceptRegionHint = String(
      bp.location || bp.city || bp.state || bp.address || bp.country || bp.region ||
      bp.targetLocation || bp.audienceLocation || ''
    ).trim() || 'India (South Indian / Tamil Nadu default when unspecified)';

    // Prompt sourced from Video Concept Prompt.docx, with brand slots
    // filled dynamically and a STRICT JSON output wrapper added so the
    // frontend can render each concept in a card without parsing prose.
    const systemPrompt = `You are an award-winning Creative Director from Ogilvy, Wieden+Kennedy and Apple.
Your job is NOT to create an advertisement.
Your job is to create a commercial that people remember.

You are creating a premium social media reel (${durationSeconds} seconds) for the following brand.

BRAND DETAILS
Business Name: ${brandName}
Industry: ${industry}
Brand Summary: ${brandSummary}
Target Audience: ${targetAudience}
Target Location / Region: ${conceptRegionHint}
Brand Tone: ${brandTone}
Competitors: ${competitors || 'N/A'}

REGIONAL AUTHENTICITY (mandatory)
Every concept must be culturally authentic to "${conceptRegionHint}".
- People described in the story must be of that region's ethnicity (e.g. South Indian for Tamil Nadu brands — NOT Western characters).
- Names, settings, wardrobe, festivals, and cultural touchpoints must match.
- Do NOT default to Western/generic scenarios. Draw from regional life, cuisine, family structure, celebrations.

USER'S CREATIVE BRIEF
${description}

Your task is to come up with THREE completely different commercial concepts.
Each concept should be emotionally powerful, memorable and capable of becoming a viral premium brand film.
Avoid clichés.
Avoid direct selling.
Avoid explaining the product.
Do not start with the product.
Think like Apple, Nike, Tanishq or Google commercials.

The three concepts MUST be completely different from one another:
- Concept 1 → Emotional
- Concept 2 → Inspirational
- Concept 3 → Unexpected or highly creative

OUTPUT FORMAT — STRICT JSON ONLY, no markdown, no code fences, no prose outside the JSON:
{
  "concepts": [
    {
      "id": "concept_1",
      "type": "emotional",
      "title": "Memorable campaign title",
      "coreEmotion": "What the audience should feel — one short phrase",
      "bigIdea": "One paragraph explaining the central idea",
      "storySummary": "Beginning → Emotion → Brand → Ending, one paragraph",
      "whyItWorks": "Why this works psychologically, one paragraph",
      "visualStyle": "Cinematography, palette, mood direction",
      "musicStyle": "Suggested background music style",
      "endingMessage": "The final line or brand payoff"
    },
    { "id": "concept_2", "type": "inspirational", ... same schema ... },
    { "id": "concept_3", "type": "unexpected", ... same schema ... }
  ],
  "recommended": "concept_1 | concept_2 | concept_3",
  "recommendationReason": "One paragraph explaining why the recommended concept is strongest."
}
Return exactly 3 concepts in the array.`;

    let raw;
    try {
      raw = await callOpenAI(systemPrompt, {
        temperature: 0.85,
        maxTokens: 3500,
        timeout: 120000,
        jsonMode: true,
      });
    } catch (openAiErr) {
      console.warn('[generateConcepts] OpenAI failed, falling back to Gemini:', openAiErr.message);
      raw = await callGemini(systemPrompt, {
        skipCache: true,
        temperature: 0.85,
        maxTokens: 3500,
        timeout: 120000,
      });
    }

    const parsed = parseGeminiJSON(raw);
    if (!parsed?.concepts || !Array.isArray(parsed.concepts) || parsed.concepts.length === 0) {
      return res.status(502).json({ success: false, message: 'Model returned no concepts. Please regenerate.' });
    }

    return res.json({
      success: true,
      concepts: parsed.concepts.slice(0, 3),
      recommended: parsed.recommended || parsed.concepts?.[0]?.id || 'concept_1',
      recommendationReason: parsed.recommendationReason || '',
    });
  } catch (error) {
    return responseError(res, error, 'Failed to generate concepts');
  }
});

// ============================================================
// POST /generateCharacters — "Character Bible" generation
// Takes the accepted concept from Step 1 and returns 1-3 characters
// with all bible fields (name, age, gender, appearance, clothing,
// hair, personality, role) + a Master Character Reference prompt
// for downstream image generation.
// User can accept one → auto-populates Step 2 character fields.
// ============================================================
router.post('/generateCharacters', protect, checkTrial, videoAiWriteLimiter, async (req, res) => {
  try {
    const userId = toUserId(req.user);
    const description = String(req.body?.description || '').trim();
    const conceptTitle = String(req.body?.conceptTitle || '').trim();
    const conceptStory = String(req.body?.conceptStory || '').trim();
    const conceptEmotion = String(req.body?.conceptEmotion || '').trim();
    const conceptVisualStyle = String(req.body?.conceptVisualStyle || '').trim();

    const user = await User.findById(userId).lean().catch(() => null);
    const bp = user?.businessProfile || {};
    const brandName = String(bp.name || bp.companyName || 'Your Brand').trim();
    const industry = String(bp.industry || 'General').trim();
    const targetAudience = String(bp.targetAudience || 'General audience').trim();
    const brandTone = Array.isArray(bp.brandVoice)
      ? bp.brandVoice.join(', ')
      : String(bp.brandVoice || bp.tone || 'Premium').trim();
    // Pull all location/region signals we can find on the profile so
    // the character designer produces people who actually match this
    // brand's real customers (not defaulting to Western faces).
    const businessLocation = String(
      bp.location || bp.city || bp.state || bp.address || bp.country || bp.region || ''
    ).trim();
    const targetLocation = String(bp.targetLocation || bp.audienceLocation || '').trim();
    const businessLanguage = Array.isArray(bp.languages)
      ? bp.languages.join(', ')
      : String(bp.language || bp.primaryLanguage || '').trim();

    // If we can't infer a region from the profile, default to Indian
    // context since this app is India-focused. Never fall back to
    // Western/generic — that's what caused the "John Miller" bug.
    const regionHint = businessLocation || targetLocation || 'India (South Indian / Tamil Nadu default when unspecified)';

    // Prompt sourced verbatim from Character Prompt.docx, generalized
    // with brand + approved-concept slots and wrapped in a strict JSON
    // schema so the frontend can render cards + numbered chips.
    const systemPrompt = `Based on the approved story, determine whether recurring characters are required.
If characters appear in multiple scenes, create a MASTER CHARACTER REFERENCE prompt.
Generate one production-ready prompt that creates a single cast reference image containing all recurring characters with unique IDs.
The reference should maintain family resemblance, identical facial identity and realistic age progression.
Return only the character reference prompt.

--- CONTEXT ---
APPROVED STORY / CONCEPT
Title: ${conceptTitle || '(from user description)'}
Core Emotion: ${conceptEmotion || 'n/a'}
Story Summary: ${conceptStory || description}
Visual Style: ${conceptVisualStyle || 'Premium cinematic'}

BRAND
Business: ${brandName}
Industry: ${industry}
Target Audience: ${targetAudience}
Target Location / Region: ${regionHint}
${businessLanguage ? 'Business Language(s): ' + businessLanguage : ''}
Brand Tone: ${brandTone}

--- REGIONAL AUTHENTICITY (MANDATORY) ---
Every character MUST look like a real member of the brand's actual target market.
- Ethnicity, skin tone, facial features, body type, and age markers must match "${regionHint}".
- Names MUST be authentic to that region (e.g. Tamil / Hindi / Kannada / regional Indian names for an Indian brand — NOT Western names like John, Emma, David, Sarah).
- Clothing must match the region and business context (e.g. saree, kurta, veshti, sherwani, dupatta for South Indian brands — NOT generic Western casualwear unless the concept explicitly demands it).
- Do NOT default to White/European appearance. Do NOT produce generic "Western-looking" characters unless the target region is explicitly Western.
- Cultural touches (jewellery, bindi, mangalsutra, henna, footwear) should reflect the region where relevant.
The single most important rule: viewers from the target region must recognize these as their people.

--- OUTPUT ---
Return STRICT JSON ONLY (no markdown, no code fences, no prose outside the JSON) matching this schema:
{
  "characters": [
    {
      "id": "01",
      "name": "Full realistic name",
      "age": "e.g. 34",
      "gender": "Male | Female | Non-binary",
      "role": "Their role in the story",
      "personality": "One short sentence",
      "appearance": "Facial features, build, ethnicity",
      "clothing": "Specific outfit matching the story",
      "hairStyle": "Specific haircut/style",
      "hairColor": "Natural hair color"
    }
  ],
  "castReferencePrompt": "The single MASTER CHARACTER REFERENCE prompt — one clean horizontal photograph, plain off-white / neutral studio backdrop, all characters standing side-by-side in a single row, evenly spaced, full-body visible, facing camera, natural warm cinematic lighting, photorealistic commercial studio quality. EVERY character must authentically look like a real person from ${regionHint} — correct ethnicity, skin tone, facial features, and regional wardrobe (saree/kurta/veshti/salwar for Indian brands). Do NOT render Western/European-looking people unless the concept explicitly demands it. Directly UNDER each character render a small clean text label in this exact format on TWO lines: line 1 = '01', '02', '03' ... (the zero-padded 2-digit number in a small warm-gold color), line 2 = 'FULLNAME · AGE XX' (in black or dark grey, all uppercase). Match the characters array order left to right. STRICT PROHIBITIONS: do NOT render any headline text, tagline, brand name banner, marketing copy, decorative typography, or slogans anywhere in the image — only the numbered character labels described above are allowed. Do NOT add background props, furniture, or a floor plate. Do NOT put the brand name anywhere in the frame. Keep the background as clean empty studio wall. Maintain family resemblance if applicable, identical facial identity, realistic age progression."
}
Character IDs MUST be zero-padded 2-digit strings: "01", "02", "03" ... matching the order they appear in the master image.
Return only what the story genuinely needs (up to 8 characters).`;

    let raw;
    try {
      raw = await callOpenAI(systemPrompt, {
        temperature: 0.75,
        maxTokens: 2500,
        timeout: 90000,
        jsonMode: true,
      });
    } catch (openAiErr) {
      console.warn('[generateCharacters] OpenAI failed, falling back to Gemini:', openAiErr.message);
      raw = await callGemini(systemPrompt, {
        skipCache: true,
        temperature: 0.75,
        maxTokens: 2500,
        timeout: 90000,
      });
    }

    const parsed = parseGeminiJSON(raw);
    if (!parsed?.characters || !Array.isArray(parsed.characters) || parsed.characters.length === 0) {
      return res.status(502).json({ success: false, message: 'Model returned no characters. Please regenerate.' });
    }
    return res.json({
      success: true,
      characters: parsed.characters.slice(0, 8),
      castReferencePrompt: String(parsed.castReferencePrompt || '').trim(),
    });
  } catch (error) {
    return responseError(res, error, 'Failed to generate characters');
  }
});

// ============================================================
// POST /generateCharacterPortrait — render a single reference portrait
// for a Character Bible entry. Uses Nano Banana Pro via the same helper
// the campaign flow uses. Accepts an optional overridePrompt so users
// can regenerate a specific character with a custom tweak.
// ============================================================
router.post('/generateCharacterPortrait', protect, checkTrial, videoAiWriteLimiter, async (req, res) => {
  try {
    const { referencePrompt, overridePrompt, characterName, aspectRatio, characters, castMode, extraDirection } = req.body || {};

    const userId = toUserId(req.user);
    const user = await User.findById(userId).lean().catch(() => null);
    const bp = user?.businessProfile || {};

    // CAST MODE — build the prompt deterministically from the character
    // bible so we control (a) exact character count, (b) no baked-in
    // brand text / tagline, (c) numbered label format. LLM-generated
    // cast prompts are unreliable — they invent extra people and add
    // marketing copy the user didn't ask for.
    let prompt = '';
    let suppressBrandBake = false;
    if (castMode && Array.isArray(characters) && characters.length > 0) {
      const N = characters.length;
      const labelLines = characters.map((c) => {
        const id = String(c?.id || '').trim() || '00';
        const name = String(c?.name || 'Unnamed').trim();
        const age = String(c?.age || '?').trim();
        const role = String(c?.role || '').trim();
        const gender = String(c?.gender || '').trim();
        const appearance = String(c?.appearance || '').trim();
        const clothing = String(c?.clothing || '').trim();
        return `  Character ${id} — ${name}, ${age} years, ${gender}, role: ${role}. Appearance: ${appearance}. Wearing: ${clothing}.`;
      }).join('\n');

      const location = String(bp?.location || bp?.city || bp?.country || 'India').trim();
      const regionHint = location ? `region: ${location}` : 'region: India (Tamil Nadu)';

      prompt = [
        `MASTER CHARACTER REFERENCE SHEET — cast lineup for a commercial. ONE clean horizontal photograph.`,
        `Show EXACTLY ${N} character${N > 1 ? 's' : ''} — no more, no fewer. Do NOT add extra people, children, elders, or background figures. Count = ${N}.`,
        '',
        `CHARACTERS (${regionHint}, render as authentic real people from this region — correct ethnicity, skin tone, facial features, hair, and regional wardrobe):`,
        labelLines,
        '',
        `LAYOUT: All ${N} characters standing side-by-side in a single row, evenly spaced, full-body visible from head to toe, facing camera. Neutral off-white / warm-grey studio backdrop. Even soft cinematic studio lighting. Photorealistic commercial studio quality. Match the order left-to-right to the character list above (Character 01 on the far left, then 02, then 03, ...).`,
        '',
        `NUMBERED LABELS (RENDER THIS TEXT IN THE IMAGE — this is the ONLY text allowed):`,
        `Directly UNDER each character render a small clean two-line label:`,
        `  Line 1 — the zero-padded 2-digit ID ("01", "02", "03", ...) in warm-gold color, bold, ~28pt`,
        `  Line 2 — 'FULLNAME · AGE XX' in dark grey / black, all uppercase, ~14pt`,
        `Do NOT skip any label. Do NOT swap the order.`,
        '',
        `STRICT PROHIBITIONS (violating any of these = failure):`,
        `- NO tagline text ("Crafting Homes, Building Memories" style headers are FORBIDDEN)`,
        `- NO brand name anywhere in the image — not on signage, not on the wall, not on props, not on the floor, not on furniture edges. The brand name must NOT appear as visible text.`,
        `- NO marketing copy, decorative typography, slogans, or product callouts`,
        `- NO furniture, props, food, dishware, tables, chairs, wall art, or scene set-dressing — this is a clean lineup on an empty studio backdrop`,
        `- NO extra characters beyond the ${N} listed above`,
        `- NO logos (unless a subtle small brand badge in bottom-corner metadata strip — see below)`,
        '',
        `OPTIONAL small metadata strip along the very bottom edge: brand logo (small, ~40px tall, one corner only) + the words "CAST REFERENCE — ${N} CHARACTERS" in tiny grey text. This strip is optional; if you can't add it cleanly, omit it entirely rather than fake it.`,
        '',
        `Maintain family resemblance where the roles imply it (grandmother / mother / daughter → shared features). Realistic age progression.`,
        `Output aspect: horizontal 16:9. High detail on faces so downstream scene generation can lock identity.`,
        String(extraDirection || '').trim() ? `\nADDITIONAL DIRECTION FROM USER: ${String(extraDirection).trim()}` : ''
      ].filter(Boolean).join('\n');

      suppressBrandBake = true;
    } else {
      prompt = String(overridePrompt || referencePrompt || '').trim();
      if (!prompt) {
        return res.status(400).json({ success: false, message: 'referencePrompt / overridePrompt / characters+castMode required' });
      }
    }

    const result = await generateCampaignImageNanoBanana(prompt, {
      aspectRatio: aspectRatio || '1:1',
      // For cast reference: suppress brandName so Nano Banana does NOT
      // bake "TRM SANTHI FURNITURE" onto tables / walls / signage.
      brandName: suppressBrandBake ? undefined : (bp.name || bp.companyName || 'Brand'),
      industry: suppressBrandBake ? undefined : (bp.industry || ''),
      tone: (Array.isArray(bp.brandVoice) ? bp.brandVoice[0] : bp.brandVoice) || 'cinematic'
    });

    if (!result?.success || !result?.imageUrl) {
      return res.status(502).json({
        success: false,
        message: result?.error || 'Image generation returned no URL'
      });
    }
    return res.json({
      success: true,
      imageUrl: result.imageUrl,
      characterName: characterName || null
    });
  } catch (error) {
    return responseError(res, error, 'Failed to generate character portrait');
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
        aspectRatio: payload.aspectRatio,
        languageCode: payload.languageCode,
        environment: payload.environment,
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

    // Load the FULL User document so businessProfile (name, industry,
    // targetAudience, tone, description, location) actually reaches the
    // Script + Scenes prompt. req.user is just the JWT decoded payload
    // {userId, id, email} — it has no businessProfile.
    const fullUser = (await User.findById(userId).lean().catch(() => null)) || req.user;

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
          preserveIdentity: draft?.preserveIdentity,
          characterUsage: draft?.characterUsage,
          characterConsistencyStrength: draft?.characterConsistencyStrength
        },
        user: fullUser
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
        preserveIdentity: draft?.preserveIdentity,
        characterUsage: draft?.characterUsage,
        characterConsistencyStrength: draft?.characterConsistencyStrength
      },
      user: fullUser
    });

    const normalizedScenes = sanitizeSceneData(generated.sceneData || [], durationSeconds);
    const storyBlock = generated.story || null;
    const updated = await updateDraft(jobId, userId, (current) => ({
      ...current,
      currentStep: Math.max(Number(current.currentStep || 1), 2),
      scenes: normalizedScenes,
      scenesMetadata: {
        voiceScript: generated.voiceScript || '',
        thumbnailPrompt: generated.thumbnailPrompt || '',
        globalVisualStyle: generated.globalVisualStyle || '',
        story: storyBlock || (current?.scenesMetadata?.story || null)
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
      story: storyBlock,
      draft: updated
    });
  } catch (error) {
    return responseError(res, error, 'Failed to generate scenes');
  }
});

// ============================================================
// Sequential generation (v3):
// 1) POST /generateStoryAndSkeleton — returns story + voice + skeleton
//    scene list (title + duration + purpose only). ~5-10s.
// 2) POST /generateSingleScene — takes sceneIndex + full context and
//    returns ONE fully-elaborated scene. Called N times sequentially
//    by the frontend so each scene renders as it finishes rather than
//    waiting for all 10 in one massive response.
// ============================================================
router.post('/generateStoryAndSkeleton', protect, checkTrial, videoAiWriteLimiter, async (req, res) => {
  try {
    const { jobId, promptText, characters, castImageUrl } = req.body || {};
    if (!jobId) return res.status(400).json({ success: false, message: 'jobId is required' });
    const userId = toUserId(req.user);
    const draft = await loadDraftForUser(jobId, userId);
    const fullUser = (await User.findById(userId).lean().catch(() => null)) || req.user;
    const durationSeconds = normalizedDurationSeconds(draft?.input?.durationSeconds || 60, 60);
    const memCtx = await buildAIContext({ userId, product: draft?.input?.product || null });
    const description = String(
      promptText || draft?.prompt?.promptText || promptFallbackFromDraft(draft)
    ).trim();
    const input = normalizeCreateInput({
      description: [description, memCtx.reusablePromptText].filter(Boolean).join('\n\n'),
      durationSeconds,
      sceneCount: draft?.input?.sceneCount || undefined,
      product: draft?.input?.product || undefined,
      // Carry env lock through so the story planner + scene enricher
      // stay inside the user's chosen space.
      environment: draft?.environment || draft?.input?.environment || undefined
    });
    const product = draft?.input?.product || null;
    // Prefer characters + cast image URL passed from the client (Step 2
    // accepted cast). Fall back to whatever the draft has saved from an
    // earlier session so refresh doesn't lose character routing.
    const charactersForPrompt = Array.isArray(characters) && characters.length > 0
      ? characters
      : (Array.isArray(draft?.characterBible) ? draft.characterBible : []);
    const castImageForPrompt = castImageUrl || draft?.castImageUrl || draft?.characterImage || '';
    const skeleton = await generateStoryAndSkeleton({
      input, product, user: fullUser,
      characters: charactersForPrompt,
      castImageUrl: castImageForPrompt,
      logger: (m) => console.log('[storyAndSkeleton]', m)
    });
    // Persist skeleton + story + character bible + cast image so a
    // refresh mid-generation preserves everything.
    const saved = await updateDraft(jobId, userId, (current) => ({
      ...current,
      currentStep: Math.max(Number(current.currentStep || 1), 2),
      scenes: skeleton.scenes,
      characterBible: charactersForPrompt,
      castImageUrl: castImageForPrompt,
      scenesMetadata: {
        voiceScript: skeleton.voiceScript,
        thumbnailPrompt: skeleton.thumbnailPrompt,
        globalVisualStyle: skeleton.globalVisualStyle,
        story: skeleton.story
      }
    }));
    return res.json({
      success: true,
      jobId,
      story: skeleton.story,
      voiceScript: skeleton.voiceScript,
      globalVisualStyle: skeleton.globalVisualStyle,
      thumbnailPrompt: skeleton.thumbnailPrompt,
      sceneData: skeleton.scenes,
      totalDurationSeconds: skeleton.totalDurationSeconds,
      draft: saved
    });
  } catch (error) {
    return responseError(res, error, 'Failed to generate story + skeleton');
  }
});

router.post('/generateSingleScene', protect, checkTrial, videoAiWriteLimiter, async (req, res) => {
  try {
    const { jobId, sceneIndex, scenesSoFar } = req.body || {};
    if (!jobId) return res.status(400).json({ success: false, message: 'jobId is required' });
    if (!Number.isInteger(sceneIndex) || sceneIndex < 0) {
      return res.status(400).json({ success: false, message: 'sceneIndex (0-based integer) is required' });
    }
    const userId = toUserId(req.user);
    const draft = await loadDraftForUser(jobId, userId);
    const fullUser = (await User.findById(userId).lean().catch(() => null)) || req.user;

    const scenesArr = Array.isArray(draft?.scenes) ? draft.scenes : [];
    const skeleton = scenesArr[sceneIndex];
    if (!skeleton) {
      return res.status(404).json({ success: false, message: `Scene at index ${sceneIndex} not found on draft` });
    }
    const story = draft?.scenesMetadata?.story || {};
    const voiceScript = draft?.scenesMetadata?.voiceScript || '';
    const globalVisualStyle = draft?.scenesMetadata?.globalVisualStyle || '';
    const durationSeconds = normalizedDurationSeconds(draft?.input?.durationSeconds || 60, 60);
    const input = normalizeCreateInput({
      description: String(draft?.prompt?.promptText || '').trim(),
      durationSeconds,
      environment: draft?.environment || draft?.input?.environment || undefined
    });

    const enriched = await generateSingleScene({
      input,
      product: draft?.input?.product || null,
      user: fullUser,
      story,
      voiceScript,
      globalVisualStyle,
      scenesSoFar: Array.isArray(scenesSoFar) ? scenesSoFar : scenesArr.slice(0, sceneIndex),
      currentSceneSkeleton: skeleton,
      // Pull the character bible + cast image URL from the draft
      // (persisted by /generateStoryAndSkeleton) so scene enrichment
      // knows which specific people to render.
      characters: Array.isArray(draft?.characterBible) ? draft.characterBible : [],
      castImageUrl: draft?.castImageUrl || draft?.characterImage || '',
      logger: (m) => console.log('[singleScene]', m)
    });

    // Splice enriched scene back into the draft
    const nextScenes = scenesArr.map((s, i) => (i === sceneIndex ? enriched : s));
    const saved = await updateDraft(jobId, userId, (current) => ({
      ...current,
      scenes: nextScenes
    }));
    return res.json({ success: true, jobId, sceneIndex, scene: enriched, draft: saved });
  } catch (error) {
    return responseError(res, error, 'Failed to generate scene');
  }
});

// ============================================================
// Sequential per-scene image generation (v3)
// POST /generateSingleSceneImage — generates ONE scene's image using
// the approved master cast image as a reference so scene faces match
// the characters approved in Step 2. Frontend Step 4 loops through
// scenes calling this one-by-one so each image appears as soon as
// it's rendered rather than waiting for all N to finish.
// ============================================================
router.post('/generateSingleSceneImage', protect, checkTrial, videoAiWriteLimiter, async (req, res) => {
  const _t0 = Date.now();
  try {
    const { jobId, sceneIndex, castImageUrl: castUrlFromReq } = req.body || {};
    console.log(`[singleSceneImage] IN jobId=${jobId} sceneIndex=${sceneIndex} castUrl=${castUrlFromReq ? 'present' : 'missing'}`);
    if (!jobId) return res.status(400).json({ success: false, message: 'jobId is required' });
    if (!Number.isInteger(sceneIndex) || sceneIndex < 0) {
      return res.status(400).json({ success: false, message: 'sceneIndex (0-based integer) is required' });
    }
    const userId = toUserId(req.user);
    const draft = await loadDraftForUser(jobId, userId);
    const scenesArr = Array.isArray(draft?.scenes) ? draft.scenes : [];
    const scene = scenesArr[sceneIndex];
    if (!scene) {
      console.warn(`[singleSceneImage] scene not found, draft has ${scenesArr.length} scenes`);
      return res.status(404).json({ success: false, message: `Scene at index ${sceneIndex} not found` });
    }
    console.log(`[singleSceneImage] scene ok · draft has ${scenesArr.length} scenes · scene.imageUrl already? ${!!scene.imageUrl}`);

    const castUrl = String(castUrlFromReq || draft?.castImageUrl || draft?.characterImage || '').trim();
    const characterBible = Array.isArray(draft?.characterBible) ? draft.characterBible : [];
    const assignedIds = Array.isArray(scene.charactersRequired) ? scene.charactersRequired.map(String) : [];
    const sceneCharacters = assignedIds.length
      ? characterBible.filter((c) => assignedIds.includes(String(c.id)))
      : [];

    // LOGO POLICY (Option D — pixel-exact overlay after gen):
    // Gemini is NOT given the logo image or any logo instructions.
    // Fewer references (2 instead of 3) means much higher fidelity on
    // environment + character. Once the clean scene is rendered, the
    // frontend can call POST /applySceneLogo which uses `sharp` to
    // paste the user's actual logo PNG onto the returned image
    // pixel-for-pixel. Guaranteed accurate logo, no more Gemini
    // redraws or fabricated brand text.
    const fullUserForLogo = (await User.findById(userId).lean().catch(() => null)) || req.user || {};
    const brandName = String(fullUserForLogo?.businessProfile?.name || '').trim();

    // Environment lock (Step 3 of wizard). If enabled, we send the
    // user's env reference images to Nano Banana as additional
    // anchors so every scene is rendered inside/around THIS space.
    const envConfig = draft?.environment || draft?.input?.environment || {};
    const envEnabled = !!envConfig.enabled && Array.isArray(envConfig.referenceImages) && envConfig.referenceImages.length > 0;
    const envNotes = String(envConfig.notes || '').trim();
    // First env ref = the canonical space (used as the actual image
    // reference). If more than one, we still send only ONE image to
    // Nano Banana (it accepts a single environment reference) — the
    // rest are for the video pipeline to sample.
    const envPrimaryRef = envEnabled ? envConfig.referenceImages[0] : null;

    // Build a rich, character-aware prompt for Nano Banana.
    const characterAnchorLines = sceneCharacters.length
      ? sceneCharacters.map((c) =>
          `${c.id} · ${c.name} (${c.age}, ${c.gender}, ${c.role}) — ${c.appearance || ''}. Wearing: ${c.clothing || 'n/a'}. Hair: ${c.hairStyle || 'n/a'} ${c.hairColor || ''}.`
        ).join('\n')
      : '';
    const validAspect = new Set(['9:16', '16:9', '1:1', '4:5']);
    const rawAspect = String(req.body?.aspectRatio || draft?.input?.aspectRatio || '9:16').trim();
    const aspectRatio = validAspect.has(rawAspect) ? rawAspect : '9:16';
    const aspectLabelMap = {
      '9:16': 'vertical 9:16 reels/shorts frame',
      '16:9': 'horizontal 16:9 widescreen cinematic frame',
      '1:1': 'square 1:1 social-feed frame',
      '4:5': 'portrait 4:5 social-feed frame'
    };

    // Global framing recipe pulled off the draft (created lazily on the
    // first scene image so every subsequent scene shares the SAME lens /
    // lighting / palette / horizon rules — no rogue tilted shots).
    const framingRecipe = String(draft?.framingRecipe || '').trim() ||
      `LENS: 50mm equivalent. HORIZON: level, camera parallel to ground (never Dutch/tilted unless scene explicitly calls for it). LIGHTING: soft key + subtle rim, consistent color temperature across all scenes. PALETTE: match the master cast image tones. FRAMING: rule of thirds, subject centered vertically, natural head-room. All scenes must LOOK LIKE THEY WERE SHOT ON THE SAME CAMERA IN ONE SESSION — no variation in lens, lighting, or grade.`;

    const scenePrompt = [
      castUrl ? 'Use the uploaded reference image as the PRIMARY reference for character faces — every face in this scene MUST match the reference exactly.' : '',
      scene.visualDescription || scene.imagePrompt || `Scene ${sceneIndex + 1}`,
      characterAnchorLines ? '\n\nCHARACTERS IN THIS FRAME (render each exactly as described, same faces / build / clothing as the reference):\n' + characterAnchorLines : '',
      scene.cameraAngle ? `\nCamera angle: ${scene.cameraAngle}` : '',
      scene.cameraMovement ? `Frame movement note (still frame only): ${scene.cameraMovement}` : '',
      scene.emotion ? `Dominant emotion: ${scene.emotion}` : '',
      scene.location ? `Location: ${scene.location}` : '',
      draft?.scenesMetadata?.globalVisualStyle ? `\nGlobal cinematography: ${draft.scenesMetadata.globalVisualStyle}` : '',
      `\nCROSS-SCENE FRAMING RULES (identical for every scene in this video):\n${framingRecipe}`,
      envEnabled
        ? `\nENVIRONMENT LOCK — MANDATORY VISIBILITY:
The attached environment reference image shows the EXACT physical space this scene takes place in (the user's actual shop / showroom / workshop / storefront).
The environment MUST BE VISIBLY PRESENT in this frame — not just implied by lighting. Show the space's signature elements: its walls, its flooring, its shelves / displays / windows / doorways / signage / furniture — whichever fits the scene composition. A viewer familiar with this place should immediately recognize it.
Match the reference's wall colors, floor materials, ceiling, lighting fixtures, windows, furniture style, decor, and overall material vocabulary EXACTLY. You may show a different angle / corner / crop of this same space, but do NOT substitute a generic backdrop or invent a different building.${envNotes ? ' User notes about the space: ' + envNotes + '.' : ''}`
        : '',
      `\nOutput: single photoreal ${aspectLabelMap[aspectRatio]}, cinematic commercial quality, sharp facial detail, natural lighting, realistic materials and textures, believable real-world backgrounds and products. NO text overlays, NO brand logos, NO signage text — this is a clean scene; branding will be applied in a separate post-processing step.`
    ].filter(Boolean).join('\n');

    // If we have a cast image URL, fetch + base64 encode it so Nano
    // Banana can use it as an identity anchor. Cloudinary URLs work fine.
    const fetchAsDataUrl = async (url) => {
      if (!url) return '';
      try {
        const r = await fetch(url);
        if (!r.ok) return '';
        const buf = Buffer.from(await r.arrayBuffer());
        const ct = r.headers.get('content-type') || 'image/png';
        return `data:${ct};base64,${buf.toString('base64')}`;
      } catch (e) {
        console.warn('[singleSceneImage] Failed to fetch reference URL:', url, e.message);
        return '';
      }
    };

    const castImageDataUrl = await fetchAsDataUrl(castUrl);
    // Env ref: prefer dataUrl (base64 uploads store this), else fetch
    // the URL (Cloudinary / brand-asset URLs).
    let envDataUrl = '';
    if (envEnabled && envPrimaryRef) {
      envDataUrl = envPrimaryRef.dataUrl && envPrimaryRef.dataUrl.startsWith('data:')
        ? envPrimaryRef.dataUrl
        : await fetchAsDataUrl(envPrimaryRef.url);
    }

    console.log(`[singleSceneImage] scene=${sceneIndex} envEnabled=${envEnabled} envRefs=${envConfig.referenceImages?.length || 0} envDataUrlBytes=${envDataUrl?.length || 0} castImagePresent=${!!castImageDataUrl?.length} — logo will be applied post-gen via /applySceneLogo`);

    // VERIFICATION LOOP — try up to 3 times. Rejects if the returned
    // image's aspect ratio drifts more than 10% from the requested
    // one (common failure mode: env reference photo is landscape →
    // Nano Banana copies its shape into output).
    const MAX_ATTEMPTS = 3;
    let imageUrl = '';
    let verification = null;
    let lastResult = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const result = await generateCampaignImageNanoBanana(scenePrompt, {
        aspectRatio,
        characterReferenceImage: castImageDataUrl || undefined,
        // Env slot — Nano Banana treats this as a PLACE (walls /
        // floor / lighting anchor) not a person. Logo intentionally
        // NOT passed — applied post-gen via sharp composite for
        // pixel-exact fidelity.
        environmentReferenceImage: envDataUrl || undefined,
        brandName: brandName || undefined,
        isCinematic: true,
        tone: 'cinematic'
      });
      lastResult = result;
      const candidateUrl = typeof result === 'string' ? result : result?.imageUrl;
      if (!candidateUrl) {
        console.warn(`[singleSceneImage] attempt ${attempt}/${MAX_ATTEMPTS} scene=${sceneIndex} — no URL returned, retrying`);
        continue;
      }
      verification = await verifySceneImageAspect(candidateUrl, aspectRatio);
      console.log(`[singleSceneImage] attempt ${attempt}/${MAX_ATTEMPTS} scene=${sceneIndex} verify:`, JSON.stringify(verification));
      if (verification.ok) {
        imageUrl = candidateUrl;
        break;
      }
      // Aspect drifted — retry (unless this was the last attempt, in
      // which case we accept the best-effort image rather than fail).
      if (attempt === MAX_ATTEMPTS) {
        console.warn(`[singleSceneImage] scene=${sceneIndex} accepting off-aspect image after ${MAX_ATTEMPTS} attempts`);
        imageUrl = candidateUrl;
      }
    }
    if (!imageUrl) {
      return res.status(502).json({ success: false, message: lastResult?.error || 'Nano Banana returned no imageUrl after retries' });
    }

    // Splice the image URL back into the scene on the draft.
    // Persist the framingRecipe on first use so every later scene reuses
    // the exact same lens / lighting / horizon rules.
    // Store both `imageUrl` (currently displayed) and `imageUrlNoLogo`
    // (clean base image, restored when user toggles logo OFF). On first
    // gen they are the same clean image.
    const nextScenes = scenesArr.map((s, i) => i === sceneIndex ? {
      ...s,
      imageUrl,
      imageUrlNoLogo: imageUrl,
      logoApplied: false,
      imageSource: 'nano-banana-with-cast',
      aspectRatio
    } : s);
    const saved = await updateDraft(jobId, userId, (current) => ({
      ...current,
      framingRecipe: current.framingRecipe || framingRecipe,
      input: { ...(current.input || {}), aspectRatio },
      scenes: nextScenes,
      images: { ...(current.images || {}), sceneData: nextScenes }
    }));
    return res.json({ success: true, jobId, sceneIndex, imageUrl, scene: nextScenes[sceneIndex], draft: saved });
  } catch (error) {
    return responseError(res, error, 'Failed to generate scene image');
  }
});

// ============================================================
// POST /applySceneLogo — pixel-exact logo overlay via sharp.
// Body: { jobId, sceneIndex, mode: 'watermark' | 'prominent' | 'off' }
// - 'off': restores the clean image (imageUrl := imageUrlNoLogo)
// - 'watermark': logo composited top-right, small, semi-transparent
// - 'prominent': logo composited larger, top-center (like a wall sign)
// Reads the user's actual logo from BrandAsset collection.
// Uploads the composited image to Cloudinary and updates the draft.
// ============================================================
router.post('/applySceneLogo', protect, videoJobReadLimiter, async (req, res) => {
  try {
    const { jobId, sceneIndex, mode = 'watermark' } = req.body || {};
    if (!jobId) return res.status(400).json({ success: false, message: 'jobId is required' });
    if (!Number.isInteger(sceneIndex) || sceneIndex < 0) {
      return res.status(400).json({ success: false, message: 'sceneIndex (0-based integer) is required' });
    }
    if (!['watermark', 'prominent', 'off'].includes(mode)) {
      return res.status(400).json({ success: false, message: `Invalid mode "${mode}". Use 'watermark' | 'prominent' | 'off'.` });
    }

    const userId = toUserId(req.user);
    const draft = await loadDraftForUser(jobId, userId);
    const scenesArr = Array.isArray(draft?.scenes) ? draft.scenes : [];
    const scene = scenesArr[sceneIndex];
    if (!scene) return res.status(404).json({ success: false, message: `Scene at index ${sceneIndex} not found` });

    const baseImageUrl = String(scene.imageUrlNoLogo || scene.imageUrl || '').trim();
    if (!baseImageUrl) return res.status(400).json({ success: false, message: 'Scene has no base image to apply logo to' });

    // Toggle OFF: just restore the clean base image
    if (mode === 'off') {
      const nextScenes = scenesArr.map((s, i) => i === sceneIndex ? {
        ...s,
        imageUrl: baseImageUrl,
        logoApplied: false,
        logoMode: null
      } : s);
      const saved = await updateDraft(jobId, userId, (current) => ({
        ...current,
        scenes: nextScenes,
        images: { ...(current.images || {}), sceneData: nextScenes }
      }));
      return res.json({ success: true, jobId, sceneIndex, imageUrl: baseImageUrl, scene: nextScenes[sceneIndex], draft: saved });
    }

    // Resolve the user's logo URL
    let brandLogoUrl = '';
    try {
      const primaryLogo = await BrandAsset.findOne({ user: userId, type: 'logo', isPrimary: true }).sort({ createdAt: -1 }).lean();
      const anyLogo = primaryLogo || await BrandAsset.findOne({ user: userId, type: 'logo' }).sort({ createdAt: -1 }).lean();
      brandLogoUrl = String(anyLogo?.url || '').trim();
    } catch (_) { /* fall through */ }
    if (!brandLogoUrl) {
      const u = await User.findById(userId).lean().catch(() => null);
      brandLogoUrl = String(u?.businessProfile?.brandAssets?.logoUrl || u?.businessProfile?.assets?.primaryLogoUrl || '').trim();
    }
    if (!brandLogoUrl) {
      return res.status(400).json({ success: false, message: 'No brand logo saved on this account. Upload a logo on the Brand Assets page first.' });
    }

    // Fetch both images as buffers
    const fetchBuf = async (url) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`Fetch failed HTTP ${r.status} for ${url.slice(0, 80)}`);
      return Buffer.from(await r.arrayBuffer());
    };
    const [baseBuf, logoBuf] = await Promise.all([fetchBuf(baseImageUrl), fetchBuf(brandLogoUrl)]);

    // Base image dimensions
    const baseMeta = await sharp(baseBuf).metadata();
    const baseW = baseMeta.width;
    const baseH = baseMeta.height;

    // Logo sizing + positioning per mode
    const logoWidthPct = mode === 'prominent' ? 0.18 : 0.06; // 18% or 6% of frame width
    const logoTargetW = Math.round(baseW * logoWidthPct);
    const insetPct = 0.025; // 2.5% edge inset

    // Resize logo, keeping alpha
    const logoResizedBuf = await sharp(logoBuf)
      .resize({ width: logoTargetW, withoutEnlargement: false })
      .png({ compressionLevel: 9 })
      .toBuffer();
    const logoMeta = await sharp(logoResizedBuf).metadata();
    const logoW = logoMeta.width;
    const logoH = logoMeta.height;

    // Placement coordinates
    let left, top;
    if (mode === 'prominent') {
      // Top-center, sits like a wall sign — inset 8% from top
      left = Math.round((baseW - logoW) / 2);
      top = Math.round(baseH * 0.08);
    } else {
      // Watermark: top-right corner with inset
      left = Math.round(baseW - logoW - baseW * insetPct);
      top = Math.round(baseH * insetPct);
    }

    // For watermark mode, reduce opacity to ~40% by applying alpha
    // multiplication via a raw pixel channel op (sharp doesn't have a
    // direct "opacity" so we composite via ensureAlpha + linear).
    let finalLogoBuf = logoResizedBuf;
    if (mode === 'watermark') {
      finalLogoBuf = await sharp(logoResizedBuf)
        .ensureAlpha()
        .composite([{
          input: Buffer.from([255, 255, 255, Math.round(255 * 0.4)]),
          raw: { width: 1, height: 1, channels: 4 },
          tile: true,
          blend: 'dest-in'
        }])
        .png()
        .toBuffer();
    }

    // Composite logo onto base
    const compositedBuf = await sharp(baseBuf)
      .composite([{ input: finalLogoBuf, top, left }])
      .jpeg({ quality: 92 })
      .toBuffer();

    // Upload composited image to Cloudinary as base64
    const { uploadBase64Image } = require('../services/imageUploader');
    const dataUrl = `data:image/jpeg;base64,${compositedBuf.toString('base64')}`;
    let uploadedUrl = '';
    try {
      const up = await uploadBase64Image(dataUrl, 'nebula-scene-images-with-logo');
      if (up?.success && up?.url) uploadedUrl = up.url;
    } catch (uploadErr) {
      console.warn('[applySceneLogo] Cloudinary upload failed:', uploadErr.message);
    }
    if (!uploadedUrl) uploadedUrl = dataUrl; // fallback: inline base64

    const nextScenes = scenesArr.map((s, i) => i === sceneIndex ? {
      ...s,
      imageUrl: uploadedUrl,
      imageUrlNoLogo: baseImageUrl, // preserve clean base for future toggles
      logoApplied: true,
      logoMode: mode
    } : s);
    const saved = await updateDraft(jobId, userId, (current) => ({
      ...current,
      scenes: nextScenes,
      images: { ...(current.images || {}), sceneData: nextScenes }
    }));

    console.log(`[applySceneLogo] scene=${sceneIndex} mode=${mode} baseW=${baseW} baseH=${baseH} logoW=${logoW} logoH=${logoH} pos=(${left},${top})`);
    return res.json({ success: true, jobId, sceneIndex, mode, imageUrl: uploadedUrl, scene: nextScenes[sceneIndex], draft: saved });
  } catch (error) {
    return responseError(res, error, 'Failed to apply logo');
  }
});

// ============================================================
// POST /generateSingleVideoClip — sequential per-scene Fal.ai
// render. The frontend Step 5 loops over scenes calling this
// one-by-one so each clip appears the moment it lands. Also
// used for one-click / prompt-tweak regeneration of a single
// scene. Rebuilds the Fal prompt with the scene's characters,
// script line, emotion, camera movement, and (optional)
// user-supplied `regenTweak` so characters actually perform
// rather than just posing.
// ============================================================
router.post('/generateSingleVideoClip', protect, checkTrial, videoAiWriteLimiter, async (req, res) => {
  try {
    const { jobId, sceneIndex, regenTweak = '', aspectRatio: aspectFromReq } = req.body || {};
    if (!jobId) return res.status(400).json({ success: false, message: 'jobId is required' });
    if (!Number.isInteger(sceneIndex) || sceneIndex < 0) {
      return res.status(400).json({ success: false, message: 'sceneIndex (0-based integer) is required' });
    }
    const userId = toUserId(req.user);
    const draft = await loadDraftForUser(jobId, userId);
    // Scenes can live in any of: draft.scenes | draft.images.sceneData
    // | draft.clips.sceneData. Prefer the collection that has an
    // imageUrl at the requested index (image gen writes to
    // images.sceneData; clip gen writes to clips.sceneData). This makes
    // the endpoint tolerant to whichever order the wizard ran in.
    const candidates = [
      Array.isArray(draft?.images?.sceneData) ? draft.images.sceneData : null,
      Array.isArray(draft?.clips?.sceneData) ? draft.clips.sceneData : null,
      Array.isArray(draft?.scenes) ? draft.scenes : null
    ].filter(Boolean);
    let scenesArr = candidates.find((arr) => arr[sceneIndex]?.imageUrl) || candidates[0] || [];
    const scene = scenesArr[sceneIndex];
    if (!scene) return res.status(404).json({
      success: false,
      message: `Scene at index ${sceneIndex} not found (draft has ${scenesArr.length} scene${scenesArr.length === 1 ? '' : 's'})`
    });
    if (!scene.imageUrl) return res.status(400).json({ success: false, message: 'Scene image must be generated first' });

    const validAspect = new Set(['9:16', '16:9', '1:1', '4:5']);
    const rawAspect = String(aspectFromReq || draft?.input?.aspectRatio || '9:16').trim();
    const aspectRatio = validAspect.has(rawAspect) ? rawAspect : '9:16';

    // Hydrate the character bible entries assigned to this scene so
    // getScenePrompt() in videoService.js can weave names / wardrobe /
    // roles into the Kling prompt.
    const characterBible = Array.isArray(draft?.characterBible) ? draft.characterBible : [];
    const assignedIds = Array.isArray(scene.charactersRequired) ? scene.charactersRequired.map(String) : [];
    const sceneCharacters = assignedIds.length
      ? characterBible.filter((c) => assignedIds.includes(String(c.id)))
      : [];

    // Env lock clause for the Kling prompt. Scene image already
    // baked in the correct backdrop (Nano Banana matched the env
    // ref), so Kling just needs to be told "don't drift the
    // backdrop during motion".
    const envConfig = draft?.environment || draft?.input?.environment || {};
    const envEnabled = !!envConfig.enabled && Array.isArray(envConfig.referenceImages) && envConfig.referenceImages.length > 0;
    const envNotes = String(envConfig.notes || '').trim();
    const envClause = envEnabled
      ? `ENVIRONMENT LOCK: This shot takes place in the user's fixed physical space. Walls, flooring, lighting fixtures, windows, furniture, and material vocabulary must stay EXACTLY as shown in the frame — no morphing walls, no drifting decor, no substituting a generic backdrop. ${envNotes ? 'Space notes: ' + envNotes + '.' : ''}`
      : '';

    const enrichedScene = {
      ...scene,
      aspectRatio,
      sceneCharacters,
      regenTweak: String(regenTweak || '').trim(),
      envClause,
      image_url: scene.imageUrl,
      imageUrl: scene.imageUrl,
      // Kling image-to-video wants a public HTTPS URL; scene.imageUrl is
      // already Cloudinary-hosted from /generateSingleSceneImage.
    };

    // Prepare a scoped context dir so materialize/normalize can drop
    // temp + final clip files. createJobContext is idempotent — reusing
    // the same jobId returns the same on-disk folders.
    const baseUrl = String(process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
    const context = createJobContext({ baseUrl, providedJobId: jobId });

    const clipName = `scene_${scene.index || (sceneIndex + 1)}.mp4`;
    const clipPath = path.join(context.dirs.clips, clipName);
    const rawClipPath = path.join(context.dirs.temp, `fal_scene_${sceneIndex + 1}_${Date.now()}.mp4`);

    console.log(`[generateSingleVideoClip] jobId=${jobId} sceneIndex=${sceneIndex} aspect=${aspectRatio} tweak=${enrichedScene.regenTweak ? 'YES' : 'no'} chars=${sceneCharacters.length}`);

    const falScene = await generateVideoClip(enrichedScene);
    await materializeSourceToFile({ source: falScene.video_url, destinationPath: rawClipPath });
    await normalizeSceneVideoClip({
      inputPath: rawClipPath,
      outputPath: clipPath,
      durationSeconds: scene.durationSeconds || 6
    });

    let clipCloudUrl = null;
    try {
      const upload = await uploadVideoFile(clipPath, 'nebula-scene-clips');
      if (upload?.success && upload?.url) clipCloudUrl = upload.url;
    } catch (uploadErr) {
      console.warn(`[generateSingleVideoClip] Cloudinary upload failed for scene ${sceneIndex + 1}:`, uploadErr.message);
    }

    const finalUrl = clipCloudUrl || falScene.video_url;
    const nextScenes = scenesArr.map((s, i) => i === sceneIndex ? {
      ...s,
      clipUrl: finalUrl,
      clipCloudUrl,
      falVideoUrl: falScene.video_url,
      aspectRatio,
      videoRegenTweak: enrichedScene.regenTweak || undefined
    } : s);

    // Merge clipUrl into every collection where the scene lives so a
    // hard-refresh (which reads whichever is populated first) always
    // sees the latest clip URL. Missing collections are skipped.
    const mergeClipIntoCollection = (currentArr) => {
      if (!Array.isArray(currentArr) || !currentArr.length) return currentArr;
      return currentArr.map((s, i) => i === sceneIndex ? {
        ...s,
        clipUrl: finalUrl,
        clipCloudUrl,
        falVideoUrl: falScene.video_url,
        aspectRatio,
        videoRegenTweak: enrichedScene.regenTweak || undefined
      } : s);
    };

    const saved = await updateDraft(jobId, userId, (current) => {
      const mergedScenes = mergeClipIntoCollection(Array.isArray(current.scenes) ? current.scenes : nextScenes);
      const mergedImages = mergeClipIntoCollection(current?.images?.sceneData);
      const mergedClips = mergeClipIntoCollection(current?.clips?.sceneData) || nextScenes;
      return {
        ...current,
        input: { ...(current.input || {}), aspectRatio },
        scenes: mergedScenes,
        images: current?.images ? {
          ...current.images,
          sceneData: mergedImages || current.images.sceneData
        } : current.images,
        clips: {
          ...(current.clips || {}),
          sceneData: mergedClips,
          clipUrls: (mergedClips || []).map((s) => s.clipUrl).filter(Boolean),
          generatedAt: current?.clips?.generatedAt || new Date().toISOString()
        }
      };
    });

    // Return the merged clip-carrying scene from clips.sceneData
    // (guaranteed present) so the frontend always gets the fresh copy.
    const returnedScene = (saved?.clips?.sceneData || nextScenes)[sceneIndex] || nextScenes[sceneIndex];
    return res.json({
      success: true,
      jobId,
      sceneIndex,
      clipUrl: finalUrl,
      scene: returnedScene,
      draft: saved
    });
  } catch (error) {
    return responseError(res, error, 'Failed to generate scene clip');
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
      let regenPrompt = String(imagePrompt || targetScene.imagePrompt || draft?.prompt?.promptText || '').trim();
      let finalRegenImageUrl = null;
      if (req.body.characterImageBase64) {
          const characterImageBase64 = req.body.characterImageBase64;
          const characterName = req.body.characterName || '';
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

          let cleanBase64 = characterImageBase64;
          if (cleanBase64.includes('data:image')) {
            cleanBase64 = cleanBase64.split(',')[1];
          }

          console.log('\n🎭 ==================== CHARACTER CONSISTENCY (NANO BANANA) ====================');
          console.log(`📸 Character: ${characterName || 'Unknown'}`);
          console.log(`🎬 Scene: ${regenPrompt}`);
          console.log(`🎨 Style: ${videoStyle}`);
          console.log(`🔧 API: Gemini Nano Banana`);
          console.log('=========================================================================\n');

          const imageData = `data:image/jpeg;base64,${cleanBase64}`;
          
          try {
            const nanoResult = await generateCampaignImageNanoBanana(regenPrompt, {
              aspectRatio: '16:9', // default for video
              characterReferenceImage: imageData,
              isCinematic: true
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
          aspectRatio: '9:16',
          linkedProduct: draft?.input?.product || null,
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
          thumbnailPrompt: draft?.scenesMetadata?.thumbnailPrompt || draft?.scenes?.thumbnailPrompt || '',
          characterImageBase64: req.body.characterImageBase64 || draft?.characterImageBase64 || undefined,
          characterName: req.body.characterName || draft?.characterName || undefined,
          videoStyle: req.body.videoStyle || draft?.videoStyle || undefined,
          characterEnabled: draft?.characterEnabled,
          characterImage: draft?.characterImage,
          originalCharacterImage: draft?.originalCharacterImage,
          preserveIdentity: draft?.preserveIdentity,
          characterConsistencyStrength: draft?.characterConsistencyStrength,
          characterRace: draft?.characterRace,
          characterBeard: draft?.characterBeard,
          characterAge: draft?.characterAge,
          characterGender: draft?.characterGender,
          useLogo: req.body.useLogo !== undefined ? req.body.useLogo : (draft?.useLogo !== undefined ? draft.useLogo : true)
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
      musicSource: String(audio?.musicSource || process.env.AI_VIDEO_MUSIC_SOURCE || 'library').toLowerCase(),
      musicTrack: typeof audio?.musicTrack === 'string' ? audio.musicTrack : '',
      musicPrompt: typeof audio?.musicPrompt === 'string' ? audio.musicPrompt : '',
      voiceGender: String(audio?.voiceGender || 'female').toLowerCase(),
      voiceId: typeof audio?.voiceId === 'string' ? audio.voiceId.trim() : '',
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
        durationSeconds: draft?.input?.durationSeconds || null,
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
