const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const Product = require('../models/Product');
const { callGemini, parseGeminiJSON, generateCampaignImageNanoBanana } = require('./geminiAI');
const { getPublicBaseUrl, normalizeTone, audioFilePathForTone } = require('../utils/toneAudio');
const { generateVideoClip } = require('./videoService');

const STORAGE_ROOT = path.resolve(__dirname, '../storage/ai-videos');
const VIDEO_TARGET = { width: 1080, height: 1920, fps: 30 };
const MAX_SCENES = 10;
const MIN_SCENES = 1;
const DEFAULT_DURATION_SECONDS = 60;

const fetchImpl = (() => {
  if (typeof global.fetch === 'function') return global.fetch.bind(global);
  try {
    return require('node-fetch');
  } catch (_) {
    return null;
  }
})();

function resolveFfmpegPath() {
  let resolved = null;
  try {
    resolved = require('ffmpeg-static');
  } catch (_) {
    resolved = null;
  }
  if (resolved) return resolved;
  const whichCmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    const res = spawnSync(whichCmd, ['ffmpeg'], { windowsHide: true });
    if (res.status === 0 && res.stdout) {
      const candidate = String(res.stdout).trim().split(/\r?\n/)[0];
      if (candidate) return candidate;
    }
  } catch (_) {}
  return null;
}

const ffmpegPath = resolveFfmpegPath();

function clamp(n, min, max) {
  const value = Number.isFinite(n) ? n : min;
  return Math.min(max, Math.max(min, value));
}

function sanitizeSegment(value, fallback = 'asset') {
  const raw = String(value || '').trim();
  const normalized = raw.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return normalized || fallback;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function isDataUrl(value) {
  return /^data:/i.test(String(value || '').trim());
}

function buildMediaUrl(baseUrl, jobId, parts = []) {
  const root = String(baseUrl || '').replace(/\/+$/, '') || 'http://localhost:5000';
  const clean = [sanitizeSegment(jobId)].concat(parts.map((part) => sanitizeSegment(part, 'file')));
  return `${root}/generated-media/${clean.join('/')}`;
}

function detectFileExtFromMime(mime = '', fallback = '.bin') {
  const normalized = String(mime || '').toLowerCase();
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return '.jpg';
  if (normalized.includes('png')) return '.png';
  if (normalized.includes('webp')) return '.webp';
  if (normalized.includes('gif')) return '.gif';
  if (normalized.includes('mp3') || normalized.includes('mpeg')) return '.mp3';
  if (normalized.includes('wav')) return '.wav';
  if (normalized.includes('ogg')) return '.ogg';
  return fallback;
}

function parseDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], 'base64')
  };
}

async function downloadToFile(url, outputPath) {
  if (!fetchImpl) {
    throw new Error('No fetch implementation available to download media');
  }
  const response = await fetchImpl(url);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Download failed (${response.status}): ${text.slice(0, 240)}`);
  }
  const arrayBuffer = typeof response.arrayBuffer === 'function'
    ? await response.arrayBuffer()
    : await response.buffer();
  const data = Buffer.from(arrayBuffer);
  await fs.promises.writeFile(outputPath, data);
  const stat = await fs.promises.stat(outputPath);
  if (!stat.size) throw new Error('Downloaded file is empty');
  return {
    bytes: stat.size,
    mimeType: String(response.headers?.get?.('content-type') || '')
  };
}

function runFfmpeg(args = []) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      return reject(new Error('ffmpeg is not available (install ffmpeg-static or ffmpeg on PATH)'));
    }
    const proc = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (error) => reject(error));
    proc.on('close', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-1200)}`));
    });
  });
}

async function runWithRetries(label, fn, maxRetries = 2, logger = null) {
  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      if (attempt > 0 && logger) logger(`Retrying ${label} (attempt ${attempt + 1}/${maxRetries + 1})`);
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (logger) logger(`${label} failed on attempt ${attempt + 1}: ${error.message || error}`);
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
      }
    }
  }
  throw lastError || new Error(`${label} failed`);
}

function toUserId(user) {
  if (!user) return null;
  if (user._id) return String(user._id);
  if (user.id) return String(user.id);
  return null;
}

function normalizeDuration(totalDurationSeconds) {
  const raw = Number.parseInt(String(totalDurationSeconds || ''), 10);
  return clamp(Number.isFinite(raw) ? raw : DEFAULT_DURATION_SECONDS, 6, 180);
}

function normalizeAudioOptions(raw = {}) {
  const enabled = raw?.enabled !== false;
  const requestedMode = String(raw?.mode || (enabled ? 'auto' : 'off')).toLowerCase();
  let mode = requestedMode;
  if (!['off', 'auto', 'upload'].includes(mode)) {
    mode = enabled ? 'auto' : 'off';
  }

  return {
    enabled: mode !== 'off',
    mode,
    languageCode: String(raw?.languageCode || 'en').toLowerCase(),
    tone: normalizeTone(raw?.tone) || 'professional',
    manualAudioData: typeof raw?.manualAudioData === 'string' ? raw.manualAudioData : '',
    manualAudioUrl: typeof raw?.manualAudioUrl === 'string' ? raw.manualAudioUrl.trim() : '',
    soundEffectUrls: Array.isArray(raw?.soundEffectUrls) ? raw.soundEffectUrls.filter(Boolean).map(String) : []
  };
}

function normalizeSubtitleOptions(raw = {}) {
  return {
    enabled: raw?.enabled === true
  };
}

function estimateSceneCount(totalDurationSeconds, requestedSceneCount) {
  const requested = Number.parseInt(String(requestedSceneCount || ''), 10);
  if (Number.isFinite(requested)) return clamp(requested, MIN_SCENES, MAX_SCENES);
  return clamp(Math.round(totalDurationSeconds / 6), MIN_SCENES, MAX_SCENES);
}

function splitDurations(totalDurationSeconds, sceneCount) {
  const total = clamp(Number.parseInt(String(totalDurationSeconds || 0), 10), 1, 3600);
  const count = clamp(Number.parseInt(String(sceneCount || 1), 10), MIN_SCENES, MAX_SCENES);
  const base = Math.floor(total / count);
  const remainder = total % count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

function sentenceChunks(text = '', chunkCount = 4) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const bits = clean.split(/[.!?]/g).map((item) => item.trim()).filter(Boolean);
  if (bits.length >= chunkCount) return bits.slice(0, chunkCount);
  const words = clean.split(' ').filter(Boolean);
  const size = Math.max(5, Math.ceil(words.length / chunkCount));
  const out = [];
  for (let i = 0; i < words.length; i += size) {
    out.push(words.slice(i, i + size).join(' '));
  }
  return out.filter(Boolean).slice(0, chunkCount);
}

function buildFallbackSceneSkeleton({
  description,
  sceneCount,
  totalDurationSeconds,
  product = null
}) {
  const durations = splitDurations(totalDurationSeconds, sceneCount);
  const chunks = sentenceChunks(description, sceneCount);
  const productName = String(product?.name || '').trim();

  let cursor = 0;
  return durations.map((duration, idx) => {
    const startSec = cursor;
    const endSec = cursor + duration;
    cursor = endSec;

    const chunk = chunks[idx] || chunks[chunks.length - 1] || description;
    const productLine = productName ? `Feature ${productName} naturally in the frame.` : 'Focus on a clear visual story.';

    return {
      index: idx + 1,
      sceneId: `scene_${idx + 1}`,
      title: `Scene ${idx + 1}`,
      durationSeconds: duration,
      startSec,
      endSec,
      imagePrompt: `${chunk}. ${productLine} Keep composition vertical 9:16 and premium.`,
      videoPrompt: `${chunk}. Add subtle camera motion (slow push-in, pan, reveal).`,
      voiceLine: chunk,
      onScreenText: chunk.slice(0, 90)
    };
  });
}

async function resolveProductContext({ user, payload }) {
  const payloadProduct = payload?.product && typeof payload.product === 'object'
    ? payload.product
    : null;

  if (payloadProduct && !payload.productId) {
    return {
      productId: payloadProduct._id ? String(payloadProduct._id) : null,
      name: String(payloadProduct.name || '').trim(),
      description: String(payloadProduct.description || '').trim(),
      imageUrl: String(payloadProduct.imageUrl || '').trim(),
      category: String(payloadProduct.category || '').trim(),
      tags: Array.isArray(payloadProduct.tags) ? payloadProduct.tags.map(String) : []
    };
  }

  const userId = toUserId(user);
  const productId = String(payload?.productId || '').trim();
  if (!userId || !productId) return null;

  try {
    const product = await Product.findOne({ _id: productId, user: userId }).lean();
    if (!product) return payloadProduct || null;
    return {
      productId: String(product._id),
      name: String(product.name || '').trim(),
      description: String(product.description || '').trim(),
      imageUrl: String(product.imageUrl || '').trim(),
      category: String(product.category || '').trim(),
      tags: Array.isArray(product.tags) ? product.tags.map(String) : []
    };
  } catch (_) {
    return payloadProduct || null;
  }
}

function normalizeCreateInput(payload = {}, options = {}) {
  const requireDescription = options.requireDescription !== false;
  const description = String(payload.description || '').trim();
  if (requireDescription && !description) throw new Error('Description is required');
  const safeDescription = description || 'AI generated marketing video';

  const durationSeconds = normalizeDuration(payload.durationSeconds);
  const sceneCount = estimateSceneCount(durationSeconds, payload.sceneCount);
  const audio = normalizeAudioOptions(payload.audio || {});
  const subtitles = normalizeSubtitleOptions(payload.subtitles || {});

  return {
    description: safeDescription,
    durationSeconds,
    sceneCount,
    imageData: typeof payload.imageData === 'string' ? payload.imageData.trim() : '',
    imageUrl: typeof payload.imageUrl === 'string' ? payload.imageUrl.trim() : '',
    productId: typeof payload.productId === 'string' ? payload.productId.trim() : '',
    product: payload.product && typeof payload.product === 'object' ? payload.product : null,
    styleHint: String(payload.styleHint || '').trim(),
    voiceHint: String(payload.voiceHint || '').trim(),
    audio,
    subtitles
  };
}

function createJobContext({ baseUrl, providedJobId = null }) {
  const jobId = sanitizeSegment(providedJobId || crypto.randomUUID());
  const jobDir = ensureDir(path.join(STORAGE_ROOT, jobId));
  const dirs = {
    root: jobDir,
    images: ensureDir(path.join(jobDir, 'images')),
    clips: ensureDir(path.join(jobDir, 'clips')),
    audio: ensureDir(path.join(jobDir, 'audio')),
    final: ensureDir(path.join(jobDir, 'final')),
    temp: ensureDir(path.join(jobDir, 'temp'))
  };
  return {
    jobId,
    baseUrl: String(baseUrl || '').replace(/\/+$/, ''),
    dirs
  };
}

function sceneProgress(currentIndex, total) {
  if (total <= 0) return 100;
  return Math.round(((currentIndex + 1) / total) * 100);
}

async function materializeSourceToFile({ source, destinationPath }) {
  const raw = String(source || '').trim();
  if (!raw) throw new Error('Missing source media');

  if (isDataUrl(raw)) {
    const parsed = parseDataUrl(raw);
    if (!parsed || !parsed.buffer?.length) throw new Error('Invalid data URL');
    await fs.promises.writeFile(destinationPath, parsed.buffer);
    return { mimeType: parsed.mimeType || '' };
  }

  if (isHttpUrl(raw)) {
    return downloadToFile(raw, destinationPath);
  }

  const absolute = path.resolve(raw);
  await fs.promises.copyFile(absolute, destinationPath);
  const stat = await fs.promises.stat(destinationPath);
  if (!stat.size) throw new Error('Copied file is empty');
  return { mimeType: '' };
}

function fileExtFromSource(source, fallback = '.jpg') {
  const raw = String(source || '');
  if (isDataUrl(raw)) {
    const parsed = parseDataUrl(raw);
    return detectFileExtFromMime(parsed?.mimeType || '', fallback);
  }
  const fromUrl = raw.split('?')[0].match(/\.([a-zA-Z0-9]{2,5})$/);
  if (fromUrl?.[1]) return `.${fromUrl[1].toLowerCase()}`;
  return fallback;
}

async function generateScenesPlan({
  input,
  product,
  user,
  logger = null
}) {
  const profile = user?.businessProfile || {};
  const sceneCount = estimateSceneCount(input.durationSeconds, input.sceneCount);
  const fallbackScenes = buildFallbackSceneSkeleton({
    description: input.description,
    sceneCount,
    totalDurationSeconds: input.durationSeconds,
    product
  });

  const systemPrompt = `You are a storyboard planner for short vertical AI videos.
Return strict JSON with this schema:
{
  "globalVisualStyle": "string",
  "thumbnailPrompt": "string",
  "voiceScript": "string",
  "scenes": [
    {
      "title": "string",
      "imagePrompt": "string",
      "videoPrompt": "string",
      "voiceLine": "string",
      "onScreenText": "string"
    }
  ]
}

Rules:
- Output between ${MIN_SCENES} and ${MAX_SCENES} scenes.
- You MUST return exactly ${sceneCount} scenes.
- Keep all scene prompts visually consistent.
- Every scene must be suitable for 9:16 vertical video.
- "voiceScript" must be a coherent narration for the full video.
- Keep on-screen text short and clear.
- Do not include markdown.`;

  const userPrompt = [
    `Description: ${input.description}`,
    `Duration: ${input.durationSeconds} seconds`,
    `Preferred scene count: ${sceneCount}`,
    input.styleHint ? `Style hint: ${input.styleHint}` : '',
    input.voiceHint ? `Voice hint: ${input.voiceHint}` : '',
    product?.name ? `Product name: ${product.name}` : '',
    product?.description ? `Product description: ${product.description}` : '',
    profile?.name ? `Brand: ${profile.name}` : '',
    profile?.industry ? `Industry: ${profile.industry}` : '',
    profile?.targetAudience ? `Audience: ${profile.targetAudience}` : '',
    profile?.brandVoice
      ? `Brand voice: ${Array.isArray(profile.brandVoice) ? profile.brandVoice.join(', ') : profile.brandVoice}`
      : ''
  ].filter(Boolean).join('\n');

  try {
    const raw = await runWithRetries(
      'scene generation',
      async () => callGemini(`${systemPrompt}\n\n${userPrompt}`, {
        skipCache: true,
        temperature: 0.65,
        maxTokens: 2500,
        timeout: 120000
      }),
      2,
      logger
    );

    const parsed = parseGeminiJSON(raw);
    const modelScenesRaw = Array.isArray(parsed?.scenes) ? parsed.scenes : [];
    const modelScenes = modelScenesRaw.slice(0, clamp(sceneCount, MIN_SCENES, MAX_SCENES));
    const effectiveSceneCount = clamp(sceneCount, MIN_SCENES, MAX_SCENES);
    const durations = splitDurations(input.durationSeconds, effectiveSceneCount);

    const sourceScenes = modelScenes.length ? modelScenes : fallbackScenes;
    let cursor = 0;
    const normalizedScenes = durations.map((duration, index) => {
      const source = sourceScenes[index] || fallbackScenes[index] || sourceScenes[sourceScenes.length - 1];
      const startSec = cursor;
      const endSec = cursor + duration;
      cursor = endSec;

      return {
        index: index + 1,
        sceneId: `scene_${index + 1}`,
        title: String(source?.title || `Scene ${index + 1}`).trim(),
        durationSeconds: duration,
        startSec,
        endSec,
        imagePrompt: String(source?.imagePrompt || fallbackScenes[index]?.imagePrompt || input.description).trim(),
        videoPrompt: String(source?.videoPrompt || fallbackScenes[index]?.videoPrompt || input.description).trim(),
        voiceLine: String(source?.voiceLine || source?.onScreenText || fallbackScenes[index]?.voiceLine || '').trim(),
        onScreenText: String(source?.onScreenText || source?.voiceLine || '').trim()
      };
    });

    const voiceScript = String(parsed?.voiceScript || '').trim()
      || normalizedScenes.map((scene) => scene.voiceLine).filter(Boolean).join(' ');
    const thumbnailPrompt = String(parsed?.thumbnailPrompt || '').trim()
      || `${input.description}. Create an attention-grabbing vertical-video thumbnail.`;
    const globalVisualStyle = String(parsed?.globalVisualStyle || '').trim()
      || 'Cinematic product-focused vertical ad, cohesive color palette, consistent lighting.';

    return {
      sceneCount: effectiveSceneCount,
      totalDurationSeconds: input.durationSeconds,
      globalVisualStyle,
      thumbnailPrompt,
      voiceScript,
      scenes: normalizedScenes
    };
  } catch (error) {
    if (logger) logger(`Scene generation fallback used: ${error.message || error}`);
    return {
      sceneCount,
      totalDurationSeconds: input.durationSeconds,
      globalVisualStyle: 'Premium vertical ad style with consistent framing and lighting.',
      thumbnailPrompt: `${input.description}. Design a compelling thumbnail for social video.`,
      voiceScript: input.description,
      scenes: fallbackScenes
    };
  }
}

async function prepareReferenceImage({
  input,
  product,
  context,
  logger = null
}) {
  const candidates = [
    { type: 'uploaded', source: input.imageData || input.imageUrl },
    { type: 'product', source: product?.imageUrl || '' }
  ];

  for (const candidate of candidates) {
    if (!candidate.source) continue;
    const ext = fileExtFromSource(candidate.source, '.jpg');
    const outputName = candidate.type === 'uploaded' ? `source_uploaded${ext}` : `source_product${ext}`;
    const localPath = path.join(context.dirs.images, outputName);
    try {
      await materializeSourceToFile({ source: candidate.source, destinationPath: localPath });
      const mediaUrl = buildMediaUrl(context.baseUrl, context.jobId, ['images', outputName]);
      return {
        type: candidate.type,
        source: candidate.source,
        localPath,
        mediaUrl
      };
    } catch (error) {
      if (logger) logger(`Reference image '${candidate.type}' unavailable: ${error.message || error}`);
    }
  }

  return null;
}

async function generateSceneImages({
  input,
  product,
  plan,
  user,
  context,
  logger = null
}) {
  const sceneData = Array.isArray(plan?.scenes) ? plan.scenes : [];
  const referenceImage = await prepareReferenceImage({ input, product, context, logger });
  const profile = user?.businessProfile || {};
  const consistencyReference = String(
    input.imageData || input.imageUrl || product?.imageUrl || referenceImage?.source || ''
  ).trim();

  const outputScenes = [];

  for (let index = 0; index < sceneData.length; index += 1) {
    const scene = sceneData[index];
    const fileName = `scene_${scene.index}.jpg`;
    const localPath = path.join(context.dirs.images, fileName);
    const mediaUrl = buildMediaUrl(context.baseUrl, context.jobId, ['images', fileName]);

    // First scene can use uploaded image or product image directly.
    const canUseReferenceDirectly = index === 0 && referenceImage?.localPath;

    if (canUseReferenceDirectly) {
      await fs.promises.copyFile(referenceImage.localPath, localPath);
      outputScenes.push({
        ...scene,
        imageUrl: mediaUrl,
        imagePath: localPath,
        imageSource: referenceImage.type
      });
      continue;
    }

    const promptWithConsistency = [
      scene.imagePrompt,
      `Consistency style: ${plan.globalVisualStyle}`,
      'Keep same lead subject identity, lighting logic, and palette continuity with earlier scenes.'
    ].join(' ');

    const imageResult = await runWithRetries(
      `image generation for ${scene.sceneId}`,
      async () => {
        const result = await generateCampaignImageNanoBanana(promptWithConsistency, {
          aspectRatio: '9:16',
          brandName: String(profile.name || ''),
          industry: String(profile.industry || ''),
          tone: String(profile.brandVoice || 'professional'),
          productReferenceImage: consistencyReference || undefined,
          linkedProduct: product ? {
            name: product.name,
            description: product.description,
            imageUrl: product.imageUrl
          } : null
        });
        if (!result?.success || !result?.imageUrl) {
          throw new Error(result?.error || 'AI image generation failed');
        }
        return result.imageUrl;
      },
      2,
      logger
    );

    await materializeSourceToFile({
      source: imageResult,
      destinationPath: localPath
    });

    outputScenes.push({
      ...scene,
      imageUrl: mediaUrl,
      imagePath: localPath,
      imageSource: 'ai_generated'
    });
  }

  return outputScenes;
}

async function createSceneVideoClip({ scene, outputPath }) {
  const safeDuration = clamp(Number.parseInt(String(scene.durationSeconds || 4), 10), 1, 120);
  const motionStrength = 0.0006 + ((scene.index % 4) * 0.0001);
  const filterChain = `scale=${VIDEO_TARGET.width}:${VIDEO_TARGET.height}:force_original_aspect_ratio=decrease,pad=${VIDEO_TARGET.width}:${VIDEO_TARGET.height}:(ow-iw)/2:(oh-ih)/2,zoompan=z='min(zoom+${motionStrength.toFixed(4)},1.08)':d=1:s=${VIDEO_TARGET.width}x${VIDEO_TARGET.height}:fps=${VIDEO_TARGET.fps},format=yuv420p`;

  const args = [
    '-y',
    '-loop', '1',
    '-i', scene.imagePath,
    '-vf', filterChain,
    '-t', String(safeDuration),
    '-r', String(VIDEO_TARGET.fps),
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-preset', 'veryfast',
    '-crf', '23',
    '-an',
    outputPath
  ];

  await runFfmpeg(args);
}

async function normalizeSceneVideoClip({ inputPath, outputPath, durationSeconds }) {
  const safeDuration = clamp(Number.parseInt(String(durationSeconds || 4), 10), 1, 120);
  const filterChain = [
    `scale=${VIDEO_TARGET.width}:${VIDEO_TARGET.height}:force_original_aspect_ratio=increase`,
    `crop=${VIDEO_TARGET.width}:${VIDEO_TARGET.height}`,
    `fps=${VIDEO_TARGET.fps}`,
    'format=yuv420p'
  ].join(',');

  const args = [
    '-y',
    '-stream_loop', '-1',
    '-i', inputPath,
    '-t', String(safeDuration),
    '-vf', filterChain,
    '-r', String(VIDEO_TARGET.fps),
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-preset', 'veryfast',
    '-crf', '20',
    '-an',
    outputPath
  ];

  await runFfmpeg(args);
}

async function generateSceneClips({
  scenes,
  context,
  logger = null,
  onSceneDone = null
}) {
  const tasks = scenes.map(async (scene, index) => {
    const clipName = `scene_${scene.index}.mp4`;
    const clipPath = path.join(context.dirs.clips, clipName);
    const rawClipPath = path.join(context.dirs.temp, `fal_${sanitizeSegment(scene.sceneId || scene.index, 'scene')}.mp4`);
    const clipUrl = buildMediaUrl(context.baseUrl, context.jobId, ['clips', clipName]);

    if (logger) logger(`Generating Fal.ai clip for ${scene.sceneId}`);
    const falScene = await generateVideoClip(scene);
    await materializeSourceToFile({ source: falScene.video_url, destinationPath: rawClipPath });
    await normalizeSceneVideoClip({
      inputPath: rawClipPath,
      outputPath: clipPath,
      durationSeconds: scene.durationSeconds
    });

    const stat = await fs.promises.stat(clipPath);
    if (!stat.size) throw new Error(`Generated clip is empty for ${scene.sceneId}`);

    const enriched = {
      ...falScene,
      clipPath,
      clipUrl,
      falVideoUrl: falScene.video_url
    };

    if (typeof onSceneDone === 'function') {
      onSceneDone(index, scenes.length, enriched);
    }

    return enriched;
  });

  return Promise.all(tasks);
}

function buildConcatListContent(paths = []) {
  return paths
    .map((clipPath) => `file '${String(path.resolve(clipPath)).replace(/\\/g, '/').replace(/'/g, "'\\''")}'`)
    .join('\n');
}

async function mergeSceneVideos({
  scenes,
  context
}) {
  if (!Array.isArray(scenes) || scenes.length === 0) {
    throw new Error('No scene clips available for merge');
  }
  const concatPath = path.join(context.dirs.temp, 'scene_clips_concat.txt');
  const outputPath = path.join(context.dirs.final, 'final_video.mp4');
  const outputUrl = buildMediaUrl(context.baseUrl, context.jobId, ['final', 'final_video.mp4']);

  await fs.promises.writeFile(
    concatPath,
    buildConcatListContent(scenes.map((scene) => scene.clipPath)),
    'utf8'
  );

  const args = [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', concatPath,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-r', String(VIDEO_TARGET.fps),
    '-preset', 'veryfast',
    '-crf', '22',
    '-an',
    outputPath
  ];
  await runFfmpeg(args);

  return {
    path: outputPath,
    url: outputUrl
  };
}

function chunkTextForTts(text, maxLen = 170) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= maxLen) return [clean];

  const segments = clean.split(/[.!?]/g).map((segment) => segment.trim()).filter(Boolean);
  const chunks = [];
  let cursor = '';

  for (const segment of segments) {
    const candidate = cursor ? `${cursor}. ${segment}` : segment;
    if (candidate.length <= maxLen) {
      cursor = candidate;
    } else {
      if (cursor) chunks.push(cursor);
      if (segment.length <= maxLen) {
        cursor = segment;
      } else {
        const words = segment.split(' ');
        let group = '';
        for (const word of words) {
          const next = group ? `${group} ${word}` : word;
          if (next.length > maxLen) {
            if (group) chunks.push(group);
            group = word;
          } else {
            group = next;
          }
        }
        cursor = group;
      }
    }
  }
  if (cursor) chunks.push(cursor);
  return chunks.slice(0, 12);
}

function toTtsLanguageCode(code = 'en') {
  const normalized = String(code || '').toLowerCase().trim();
  const allowed = new Set(['en', 'hi', 'ta', 'te', 'kn', 'ml']);
  return allowed.has(normalized) ? normalized : 'en';
}

async function synthesizeVoiceTrack({
  voiceScript,
  languageCode,
  context,
  logger = null
}) {
  const chunks = chunkTextForTts(voiceScript, 170);
  if (!chunks.length) return null;
  if (!fetchImpl) return null;

  const chunkPaths = [];
  const lang = toTtsLanguageCode(languageCode);

  for (let i = 0; i < chunks.length; i += 1) {
    const text = chunks[i];
    const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(lang)}&q=${encodeURIComponent(text)}`;
    const outPath = path.join(context.dirs.audio, `voice_chunk_${i + 1}.mp3`);
    try {
      const response = await fetchImpl(ttsUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0',
          Referer: 'https://translate.google.com/'
        }
      });
      if (!response.ok) {
        throw new Error(`TTS HTTP ${response.status}`);
      }
      const arrayBuffer = typeof response.arrayBuffer === 'function'
        ? await response.arrayBuffer()
        : await response.buffer();
      await fs.promises.writeFile(outPath, Buffer.from(arrayBuffer));
      const stat = await fs.promises.stat(outPath);
      if (stat.size < 1200) throw new Error('TTS chunk too small');
      chunkPaths.push(outPath);
    } catch (error) {
      if (logger) logger(`Voice chunk ${i + 1} failed: ${error.message || error}`);
    }
  }

  if (!chunkPaths.length) return null;
  if (chunkPaths.length === 1) {
    const voiceOutputPath = path.join(context.dirs.audio, 'voice_track.mp3');
    await fs.promises.copyFile(chunkPaths[0], voiceOutputPath);
    return {
      path: voiceOutputPath,
      url: buildMediaUrl(context.baseUrl, context.jobId, ['audio', 'voice_track.mp3'])
    };
  }

  const concatListPath = path.join(context.dirs.temp, 'voice_chunks_concat.txt');
  const concatOutput = path.join(context.dirs.audio, 'voice_track.mp3');
  await fs.promises.writeFile(concatListPath, buildConcatListContent(chunkPaths), 'utf8');

  try {
    await runFfmpeg([
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', concatListPath,
      '-c', 'copy',
      concatOutput
    ]);
  } catch (_) {
    // Fallback: re-encode if copy concat fails.
    await runFfmpeg([
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', concatListPath,
      '-c:a', 'libmp3lame',
      '-q:a', '2',
      concatOutput
    ]);
  }

  return {
    path: concatOutput,
    url: buildMediaUrl(context.baseUrl, context.jobId, ['audio', 'voice_track.mp3'])
  };
}

async function prepareManualAudioTrack({ audioOptions, context, logger = null }) {
  if (audioOptions.mode !== 'upload') return null;
  if (audioOptions.manualAudioData) {
    const parsed = parseDataUrl(audioOptions.manualAudioData);
    const ext = detectFileExtFromMime(parsed?.mimeType || '', '.mp3');
    const outputName = `manual_audio${ext}`;
    const outputPath = path.join(context.dirs.audio, outputName);
    if (parsed?.buffer?.length) {
      await fs.promises.writeFile(outputPath, parsed.buffer);
      return {
        path: outputPath,
        url: buildMediaUrl(context.baseUrl, context.jobId, ['audio', outputName])
      };
    }
  }

  if (audioOptions.manualAudioUrl) {
    const ext = fileExtFromSource(audioOptions.manualAudioUrl, '.mp3');
    const outputName = `manual_audio${ext}`;
    const outputPath = path.join(context.dirs.audio, outputName);
    await materializeSourceToFile({
      source: audioOptions.manualAudioUrl,
      destinationPath: outputPath
    });
    return {
      path: outputPath,
      url: buildMediaUrl(context.baseUrl, context.jobId, ['audio', outputName])
    };
  }

  if (logger) logger('Audio mode is upload but no manual audio payload found');
  return null;
}

async function prepareBackgroundTrack({ audioOptions, context }) {
  const tone = normalizeTone(audioOptions.tone) || 'professional';
  const tonePath = audioFilePathForTone(tone) || audioFilePathForTone('professional');
  if (!tonePath) return null;
  const outputName = 'background_track.mp3';
  const outputPath = path.join(context.dirs.audio, outputName);
  await fs.promises.copyFile(tonePath, outputPath);
  return {
    path: outputPath,
    url: buildMediaUrl(context.baseUrl, context.jobId, ['audio', outputName]),
    tone
  };
}

async function prepareSoundEffects({ audioOptions, context, logger = null }) {
  const result = [];
  const list = Array.isArray(audioOptions.soundEffectUrls) ? audioOptions.soundEffectUrls : [];
  for (let idx = 0; idx < list.length; idx += 1) {
    const source = String(list[idx] || '').trim();
    if (!source) continue;
    try {
      const ext = fileExtFromSource(source, '.mp3');
      const outputName = `sfx_${idx + 1}${ext}`;
      const outputPath = path.join(context.dirs.audio, outputName);
      await materializeSourceToFile({ source, destinationPath: outputPath });
      result.push({
        path: outputPath,
        url: buildMediaUrl(context.baseUrl, context.jobId, ['audio', outputName])
      });
    } catch (error) {
      if (logger) logger(`Skipping sound effect #${idx + 1}: ${error.message || error}`);
    }
  }
  return result;
}

async function generateAudioTracks({
  input,
  plan,
  context,
  logger = null
}) {
  const audioOptions = normalizeAudioOptions(input.audio || {});
  if (!audioOptions.enabled) {
    return {
      enabled: false,
      mode: 'off',
      durationSeconds: input.durationSeconds,
      tracks: {}
    };
  }

  const manual = await prepareManualAudioTrack({ audioOptions, context, logger });
  const background = await prepareBackgroundTrack({ audioOptions, context });
  const sfx = await prepareSoundEffects({ audioOptions, context, logger });

  let voice = null;
  if (audioOptions.mode === 'auto') {
    voice = await synthesizeVoiceTrack({
      voiceScript: plan.voiceScript || input.description,
      languageCode: audioOptions.languageCode,
      context,
      logger
    });
  }

  return {
    enabled: true,
    mode: audioOptions.mode,
    durationSeconds: input.durationSeconds,
    tracks: {
      manual,
      voice,
      background,
      soundEffects: sfx
    }
  };
}

function ffmpegInputsForTracks(audioTracks) {
  const ordered = [];
  if (audioTracks?.manual?.path) ordered.push({ label: 'manual', path: audioTracks.manual.path, volume: 1.0 });
  if (audioTracks?.voice?.path) ordered.push({ label: 'voice', path: audioTracks.voice.path, volume: 1.0 });
  if (audioTracks?.background?.path) ordered.push({ label: 'background', path: audioTracks.background.path, volume: 0.24 });
  const sfx = Array.isArray(audioTracks?.soundEffects) ? audioTracks.soundEffects : [];
  for (const item of sfx) {
    if (item?.path) ordered.push({ label: 'sfx', path: item.path, volume: 0.45 });
  }
  return ordered;
}

async function mergeAudioTracks({
  audioTracks,
  durationSeconds,
  context
}) {
  const inputTracks = ffmpegInputsForTracks(audioTracks);
  if (!inputTracks.length) return null;

  const outputPath = path.join(context.dirs.final, 'final_audio.mp3');
  const outputUrl = buildMediaUrl(context.baseUrl, context.jobId, ['final', 'final_audio.mp3']);
  const safeDuration = clamp(Number.parseInt(String(durationSeconds || 0), 10), 3, 1800);

  if (inputTracks.length === 1) {
    await runFfmpeg([
      '-y',
      '-i', inputTracks[0].path,
      '-vn',
      '-c:a', 'libmp3lame',
      '-q:a', '2',
      '-t', String(safeDuration),
      outputPath
    ]);
    return { path: outputPath, url: outputUrl };
  }

  const args = ['-y'];
  inputTracks.forEach((track) => {
    args.push('-i', track.path);
  });

  const volumeStages = inputTracks
    .map((track, idx) => `[${idx}:a]volume=${track.volume.toFixed(2)}[a${idx}]`)
    .join(';');
  const mixedInputs = inputTracks.map((_, idx) => `[a${idx}]`).join('');
  const filterComplex = `${volumeStages};${mixedInputs}amix=inputs=${inputTracks.length}:duration=longest:dropout_transition=2[mix]`;

  args.push(
    '-filter_complex', filterComplex,
    '-map', '[mix]',
    '-t', String(safeDuration),
    '-c:a', 'libmp3lame',
    '-q:a', '2',
    outputPath
  );

  await runFfmpeg(args);
  return { path: outputPath, url: outputUrl };
}

function toSrtTimestamp(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  const hrs = Math.floor(value / 3600);
  const mins = Math.floor((value % 3600) / 60);
  const secs = Math.floor(value % 60);
  const ms = Math.round((value - Math.floor(value)) * 1000);
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return `${pad(hrs)}:${pad(mins)}:${pad(secs)},${pad(ms, 3)}`;
}

async function generateSrtFile({
  sceneData,
  context
}) {
  const lines = [];
  const scenes = Array.isArray(sceneData) ? sceneData : [];
  scenes.forEach((scene, idx) => {
    const text = String(scene.voiceLine || scene.onScreenText || scene.title || '').trim();
    if (!text) return;
    lines.push(String(idx + 1));
    lines.push(`${toSrtTimestamp(scene.startSec)} --> ${toSrtTimestamp(scene.endSec)}`);
    lines.push(text);
    lines.push('');
  });

  if (!lines.length) return null;
  const srtPath = path.join(context.dirs.final, 'subtitles.srt');
  await fs.promises.writeFile(srtPath, lines.join('\n'), 'utf8');

  return {
    path: srtPath,
    url: buildMediaUrl(context.baseUrl, context.jobId, ['final', 'subtitles.srt'])
  };
}

function ffmpegSubtitlePath(filePath) {
  let resolved = path.resolve(filePath).replace(/\\/g, '/');
  if (/^[A-Za-z]:/.test(resolved)) {
    resolved = `${resolved[0]}\\:${resolved.slice(2)}`;
  }
  return resolved.replace(/'/g, "\\'");
}

async function mergeFinalOutput({
  mergedVideo,
  mergedAudio,
  subtitles,
  context
}) {
  const outputPath = path.join(context.dirs.final, 'final_output.mp4');
  const outputUrl = buildMediaUrl(context.baseUrl, context.jobId, ['final', 'final_output.mp4']);

  if (!mergedAudio?.path && !subtitles?.path) {
    await fs.promises.copyFile(mergedVideo.path, outputPath);
    return { path: outputPath, url: outputUrl };
  }

  const args = ['-y', '-i', mergedVideo.path];
  if (mergedAudio?.path) {
    args.push('-i', mergedAudio.path);
  }

  if (subtitles?.path) {
    args.push(
      '-vf', `subtitles='${ffmpegSubtitlePath(subtitles.path)}'`,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23'
    );
  } else {
    args.push('-c:v', 'copy');
  }

  if (mergedAudio?.path) {
    args.push('-c:a', 'aac', '-b:a', '192k', '-shortest');
  } else {
    args.push('-an');
  }

  args.push(outputPath);
  await runFfmpeg(args);
  return { path: outputPath, url: outputUrl };
}

async function generateThumbnail({
  input,
  product,
  plan,
  sceneData,
  context,
  logger = null
}) {
  const outputName = 'thumbnail.jpg';
  const outputPath = path.join(context.dirs.final, outputName);
  const outputUrl = buildMediaUrl(context.baseUrl, context.jobId, ['final', outputName]);

  // Try AI thumbnail first.
  try {
    const result = await generateCampaignImageNanoBanana(plan.thumbnailPrompt || input.description, {
      aspectRatio: '16:9',
      linkedProduct: product ? {
        name: product.name,
        description: product.description,
        imageUrl: product.imageUrl
      } : null,
      productReferenceImage: input.imageData || input.imageUrl || product?.imageUrl || null,
      tone: 'professional'
    });
    if (result?.success && result?.imageUrl) {
      await materializeSourceToFile({ source: result.imageUrl, destinationPath: outputPath });
      return { path: outputPath, url: outputUrl };
    }
  } catch (error) {
    if (logger) logger(`AI thumbnail generation failed: ${error.message || error}`);
  }

  // Fallback to first scene image.
  const firstScene = Array.isArray(sceneData) && sceneData.length > 0 ? sceneData[0] : null;
  if (firstScene?.imagePath) {
    await fs.promises.copyFile(firstScene.imagePath, outputPath);
    return { path: outputPath, url: outputUrl };
  }

  return null;
}

async function saveManifest({ context, data }) {
  const manifestPath = path.join(context.dirs.root, 'manifest.json');
  await fs.promises.writeFile(manifestPath, JSON.stringify(data, null, 2), 'utf8');
  return manifestPath;
}

function ensureSceneInputForClipStage(scene = {}, index = 0) {
  const idx = Number.parseInt(String(scene.index || index + 1), 10) || (index + 1);
  const startSec = Number.isFinite(Number(scene.startSec)) ? Number(scene.startSec) : 0;
  const duration = clamp(Number.parseInt(String(scene.durationSeconds || scene.duration || 4), 10), 1, 120);
  const endSec = Number.isFinite(Number(scene.endSec)) ? Number(scene.endSec) : (startSec + duration);
  const imageUrl = String(scene.imageUrl || scene.image_url || '').trim();
  const videoUrl = String(scene.video_url || scene.videoUrl || scene.falVideoUrl || '').trim();
  return {
    index: idx,
    sceneId: String(scene.sceneId || scene.id || `scene_${idx}`),
    title: String(scene.title || `Scene ${idx}`),
    durationSeconds: duration,
    startSec,
    endSec,
    imageUrl,
    image_url: imageUrl,
    video_url: videoUrl,
    videoUrl,
    imagePath: String(scene.imagePath || '').trim(),
    voiceLine: String(scene.voiceLine || ''),
    onScreenText: String(scene.onScreenText || ''),
    imagePrompt: String(scene.imagePrompt || scene.image_prompt || ''),
    videoPrompt: String(scene.videoPrompt || scene.video_prompt || '')
  };
}

async function runCreateVideoPipeline({
  payload,
  user,
  baseUrl,
  providedJobId = null,
  onProgress = null,
  onLog = null
}) {
  const input = normalizeCreateInput(payload);
  const context = createJobContext({ baseUrl: baseUrl || getPublicBaseUrl(), providedJobId });
  const product = await resolveProductContext({ user, payload: input });

  const update = (progress, currentStep, metadata = null) => {
    if (typeof onProgress === 'function') onProgress({ progress, currentStep, metadata });
  };
  const log = (message) => {
    if (typeof onLog === 'function') onLog(message);
  };

  update(5, 'generateScenes');
  log('Generating structured scene plan');
  const plan = await generateScenesPlan({ input, product, user, logger: log });

  update(20, 'generateImages', { scenes: plan.scenes.length });
  log('Generating scene images with consistency');
  const scenesWithImages = await generateSceneImages({
    input,
    product,
    plan,
    user,
    context,
    logger: log
  });

  update(45, 'generateVideoClips');
  log('Rendering scene video clips');
  const scenesWithClips = await generateSceneClips({
    scenes: scenesWithImages,
    context,
    logger: log,
    onSceneDone: (sceneIndex, totalScenes) => {
      const stepProgress = 45 + Math.round((sceneProgress(sceneIndex, totalScenes) / 100) * 20);
      update(stepProgress, 'generateVideoClips', { completed: sceneIndex + 1, total: totalScenes });
    }
  });

  update(66, 'mergeVideo');
  log('Merging scene clips into final_video.mp4');
  const mergedVideo = await mergeSceneVideos({ scenes: scenesWithClips, context });

  update(74, 'generateAudio');
  log('Preparing audio tracks');
  const audioTracks = await generateAudioTracks({ input, plan, context, logger: log });

  update(82, 'mergeAudio');
  let mergedAudio = null;
  if (audioTracks.enabled) {
    log('Mixing final_audio.mp3');
    mergedAudio = await mergeAudioTracks({
      audioTracks: audioTracks.tracks,
      durationSeconds: input.durationSeconds,
      context
    });
  }

  update(88, 'subtitles');
  let subtitles = null;
  if (input.subtitles.enabled) {
    log('Generating subtitles.srt');
    subtitles = await generateSrtFile({ sceneData: scenesWithClips, context });
  }

  update(92, 'finalMerge');
  log('Merging final video and audio into final_output.mp4');
  const finalOutput = await mergeFinalOutput({
    mergedVideo,
    mergedAudio,
    subtitles,
    context
  });

  update(96, 'thumbnail');
  log('Generating thumbnail');
  const thumbnail = await generateThumbnail({
    input,
    product,
    plan,
    sceneData: scenesWithClips,
    context,
    logger: log
  });

  const responsePayload = {
    success: true,
    jobId: context.jobId,
    inputMode: input.imageData || input.imageUrl
      ? 'description+image'
      : (product ? 'description+product' : 'description'),
    finalVideoUrl: finalOutput.url,
    thumbnailUrl: thumbnail?.url || null,
    finalAudioUrl: mergedAudio?.url || null,
    sceneData: scenesWithClips.map((scene) => ({
      sceneId: scene.sceneId,
      index: scene.index,
      title: scene.title,
      durationSeconds: scene.durationSeconds,
      startSec: scene.startSec,
      endSec: scene.endSec,
      imagePrompt: scene.imagePrompt,
      videoPrompt: scene.videoPrompt,
      voiceLine: scene.voiceLine,
      onScreenText: scene.onScreenText,
      imageUrl: scene.imageUrl,
      video_url: scene.video_url || scene.falVideoUrl || scene.videoUrl || '',
      videoUrl: scene.videoUrl || scene.video_url || scene.falVideoUrl || '',
      falVideoUrl: scene.falVideoUrl || scene.video_url || scene.videoUrl || '',
      clipUrl: scene.clipUrl
    })),
    plan: {
      globalVisualStyle: plan.globalVisualStyle,
      thumbnailPrompt: plan.thumbnailPrompt,
      voiceScript: plan.voiceScript,
      durationSeconds: input.durationSeconds
    },
    files: {
      finalVideo: mergedVideo.url,
      finalAudio: mergedAudio?.url || null,
      finalOutput: finalOutput.url,
      subtitle: subtitles?.url || null,
      thumbnail: thumbnail?.url || null
    }
  };

  await saveManifest({ context, data: responsePayload });
  update(100, 'completed');

  return responsePayload;
}

async function runGenerateScenes({
  payload,
  user
}) {
  const input = normalizeCreateInput(payload);
  const product = await resolveProductContext({ user, payload: input });
  const plan = await generateScenesPlan({ input, product, user });
  return {
    success: true,
    sceneData: plan.scenes,
    totalDurationSeconds: plan.totalDurationSeconds,
    sceneCount: plan.sceneCount,
    globalVisualStyle: plan.globalVisualStyle,
    voiceScript: plan.voiceScript,
    thumbnailPrompt: plan.thumbnailPrompt
  };
}

async function runGenerateImages({
  payload,
  user,
  baseUrl
}) {
  const input = normalizeCreateInput(payload, { requireDescription: false });
  const context = createJobContext({ baseUrl: baseUrl || getPublicBaseUrl(), providedJobId: payload?.jobId });
  const product = await resolveProductContext({ user, payload: input });
  const plan = payload?.sceneData && Array.isArray(payload.sceneData)
    ? {
        scenes: payload.sceneData.map((scene, idx) => ensureSceneInputForClipStage(scene, idx)),
        globalVisualStyle: String(payload.globalVisualStyle || 'Consistent cinematic ad style.').trim(),
        voiceScript: String(payload.voiceScript || input.description).trim(),
        thumbnailPrompt: String(payload.thumbnailPrompt || input.description).trim()
      }
    : await generateScenesPlan({ input, product, user });

  const scenesWithImages = await generateSceneImages({
    input,
    product,
    plan,
    user,
    context
  });

  return {
    success: true,
    jobId: context.jobId,
    sceneData: scenesWithImages.map((scene) => ({
      ...scene,
      imagePath: undefined
    })),
    imageUrls: scenesWithImages.map((scene) => scene.imageUrl)
  };
}

async function runGenerateVideoClips({
  payload,
  baseUrl
}) {
  const context = createJobContext({ baseUrl: baseUrl || getPublicBaseUrl(), providedJobId: payload?.jobId });
  const rawScenes = Array.isArray(payload?.sceneData) ? payload.sceneData : [];
  if (!rawScenes.length) throw new Error('sceneData is required for generateVideoClips');

  const scenes = [];
  for (let i = 0; i < rawScenes.length; i += 1) {
    const normalized = ensureSceneInputForClipStage(rawScenes[i], i);
    const source = normalized.imagePath || normalized.imageUrl;
    if (!source) throw new Error(`Scene ${normalized.sceneId} is missing image input`);
    const ext = fileExtFromSource(source, '.jpg');
    const imageName = `scene_${normalized.index}${ext}`;
    const imagePath = path.join(context.dirs.images, imageName);
    await materializeSourceToFile({ source, destinationPath: imagePath });
    scenes.push({
      ...normalized,
      imagePath,
      imageUrl: buildMediaUrl(context.baseUrl, context.jobId, ['images', imageName])
    });
  }

  const scenesWithClips = await generateSceneClips({ scenes, context });
  return {
    success: true,
    jobId: context.jobId,
    sceneData: scenesWithClips.map((scene) => ({
      ...scene,
      imagePath: undefined,
      clipPath: undefined
    })),
    clipUrls: scenesWithClips.map((scene) => scene.clipUrl)
  };
}

async function runGenerateAudio({
  payload,
  baseUrl
}) {
  const context = createJobContext({ baseUrl: baseUrl || getPublicBaseUrl(), providedJobId: payload?.jobId });
  const skipMix = payload?.skipMix === true;
  const input = normalizeCreateInput({
    description: String(payload?.description || payload?.voiceScript || 'AI video voiceover').trim(),
    durationSeconds: payload?.durationSeconds || DEFAULT_DURATION_SECONDS,
    sceneCount: payload?.sceneCount || 3,
    audio: payload?.audio || {},
    subtitles: payload?.subtitles || {}
  }, { requireDescription: false });

  const plan = {
    voiceScript: String(payload?.voiceScript || payload?.description || '').trim()
  };

  const audioTracks = await generateAudioTracks({ input, plan, context });
  const mergedAudio = (!skipMix && audioTracks.enabled)
    ? await mergeAudioTracks({
      audioTracks: audioTracks.tracks,
      durationSeconds: input.durationSeconds,
      context
    })
    : null;

  return {
    success: true,
    jobId: context.jobId,
    audioEnabled: audioTracks.enabled,
    audioMode: audioTracks.mode,
    mixed: Boolean(mergedAudio?.url),
    finalAudioUrl: mergedAudio?.url || null,
    tracks: {
      manualUrl: audioTracks.tracks?.manual?.url || null,
      voiceUrl: audioTracks.tracks?.voice?.url || null,
      backgroundUrl: audioTracks.tracks?.background?.url || null,
      soundEffectUrls: (audioTracks.tracks?.soundEffects || []).map((item) => item.url)
    }
  };
}

async function runMergeAudio({
  payload,
  baseUrl
}) {
  const context = createJobContext({ baseUrl: baseUrl || getPublicBaseUrl(), providedJobId: payload?.jobId });
  const safeDuration = normalizeDuration(payload?.durationSeconds || DEFAULT_DURATION_SECONDS);

  const trackConfig = {
    manual: null,
    voice: null,
    background: null,
    soundEffects: []
  };

  const sources = [
    ['manual', payload?.manualAudioUrl || payload?.tracks?.manualUrl || ''],
    ['voice', payload?.voiceAudioUrl || payload?.tracks?.voiceUrl || ''],
    ['background', payload?.backgroundAudioUrl || payload?.tracks?.backgroundUrl || '']
  ];

  for (const [key, source] of sources) {
    if (!source) continue;
    const ext = fileExtFromSource(source, '.mp3');
    const outputName = `${key}${ext}`;
    const outputPath = path.join(context.dirs.audio, outputName);
    await materializeSourceToFile({ source, destinationPath: outputPath });
    trackConfig[key] = {
      path: outputPath,
      url: buildMediaUrl(context.baseUrl, context.jobId, ['audio', outputName])
    };
  }

  const sfxSources = Array.isArray(payload?.soundEffectUrls) ? payload.soundEffectUrls : [];
  for (let i = 0; i < sfxSources.length; i += 1) {
    const source = sfxSources[i];
    if (!source) continue;
    const ext = fileExtFromSource(source, '.mp3');
    const outputName = `sfx_${i + 1}${ext}`;
    const outputPath = path.join(context.dirs.audio, outputName);
    await materializeSourceToFile({ source, destinationPath: outputPath });
    trackConfig.soundEffects.push({
      path: outputPath,
      url: buildMediaUrl(context.baseUrl, context.jobId, ['audio', outputName])
    });
  }

  const mergedAudio = await mergeAudioTracks({
    audioTracks: trackConfig,
    durationSeconds: safeDuration,
    context
  });

  return {
    success: true,
    jobId: context.jobId,
    finalAudioUrl: mergedAudio?.url || null
  };
}

async function runMergeVideo({
  payload,
  baseUrl
}) {
  const context = createJobContext({ baseUrl: baseUrl || getPublicBaseUrl(), providedJobId: payload?.jobId });
  const sceneClips = Array.isArray(payload?.clipUrls) ? payload.clipUrls : [];

  if (!sceneClips.length) {
    throw new Error('clipUrls is required for mergeVideo');
  }

  const localClipPaths = [];
  for (let i = 0; i < sceneClips.length; i += 1) {
    const source = String(sceneClips[i] || '').trim();
    if (!source) continue;
    const outputName = `scene_${i + 1}.mp4`;
    const outputPath = path.join(context.dirs.clips, outputName);
    await materializeSourceToFile({ source, destinationPath: outputPath });
    localClipPaths.push(outputPath);
  }

  const scenes = localClipPaths.map((clipPath, index) => ({
    index: index + 1,
    sceneId: `scene_${index + 1}`,
    clipPath
  }));

  const mergedVideo = await mergeSceneVideos({ scenes, context });

  let mergedAudio = null;
  const audioSource = String(payload?.finalAudioUrl || '').trim();
  if (audioSource) {
    const audioPath = path.join(context.dirs.audio, 'input_audio.mp3');
    await materializeSourceToFile({ source: audioSource, destinationPath: audioPath });
    mergedAudio = {
      path: audioPath,
      url: buildMediaUrl(context.baseUrl, context.jobId, ['audio', 'input_audio.mp3'])
    };
  }

  let subtitles = null;
  if (payload?.subtitles?.enabled && Array.isArray(payload?.sceneData)) {
    subtitles = await generateSrtFile({
      sceneData: payload.sceneData.map((scene, idx) => ensureSceneInputForClipStage(scene, idx)),
      context
    });
  }

  const finalOutput = await mergeFinalOutput({
    mergedVideo,
    mergedAudio,
    subtitles,
    context
  });

  return {
    success: true,
    jobId: context.jobId,
    finalVideoUrl: mergedVideo.url,
    finalOutputUrl: finalOutput.url,
    subtitlesUrl: subtitles?.url || null
  };
}

module.exports = {
  STORAGE_ROOT,
  runCreateVideoPipeline,
  runGenerateScenes,
  runGenerateImages,
  runGenerateVideoClips,
  runGenerateAudio,
  runMergeAudio,
  runMergeVideo
};
