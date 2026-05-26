const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { spawn, spawnSync } = require('child_process');
const { GoogleAuth } = require('google-auth-library');

const Product = require('../models/Product');
const { callGemini, parseGeminiJSON, generateCampaignImageNanoBanana } = require('./geminiAI');
const { getPublicBaseUrl, normalizeTone, audioFilePathForTone } = require('../utils/toneAudio');
const { generateVideoClip } = require('./videoService');

const STORAGE_ROOT = path.resolve(__dirname, '../storage/ai-videos');
const VIDEO_TARGET = { width: 1080, height: 1920, fps: 30 };
const VIDEO_ENCODE_PRESET = String(process.env.AI_VIDEO_ENCODE_PRESET || 'slow');
const VIDEO_ENCODE_CRF = String(process.env.AI_VIDEO_ENCODE_CRF || '16');
const GOOGLE_TTS_PROJECT_ID = process.env.VERTEX_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT_ID || '';
const GOOGLE_TTS_EN_MALE_VOICE = String(process.env.GOOGLE_TTS_EN_MALE_VOICE || 'en-US-Wavenet-D').trim();
const GOOGLE_TTS_EN_FEMALE_VOICE = String(process.env.GOOGLE_TTS_EN_FEMALE_VOICE || 'en-US-Wavenet-F').trim();
const EDGE_TTS_ENABLED = String(process.env.EDGE_TTS_ENABLED || 'true').toLowerCase() !== 'false';
const EDGE_TTS_MALE_VOICE = String(process.env.EDGE_TTS_MALE_VOICE || '').trim();
const EDGE_TTS_FEMALE_VOICE = String(process.env.EDGE_TTS_FEMALE_VOICE || '').trim();
const ELEVENLABS_API_KEY = String(process.env.ELEVENLABS_API_KEY || '').trim();
const ELEVENLABS_MALE_VOICE_ID = String(process.env.ELEVENLABS_MALE_VOICE_ID || '').trim();
const ELEVENLABS_MODEL_ID = String(process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2').trim();
const MAX_SCENES = 10;
const MIN_SCENES = 1;
const DEFAULT_DURATION_SECONDS = 60;
const SCENE_IMAGE_CONCURRENCY = Math.max(1, Number.parseInt(process.env.AI_VIDEO_SCENE_IMAGE_CONCURRENCY || '3', 10) || 3);
const SCENE_CLIP_CONCURRENCY = Math.max(1, Number.parseInt(process.env.AI_VIDEO_SCENE_CLIP_CONCURRENCY || '2', 10) || 2);
const MEDIA_IO_CONCURRENCY = Math.max(1, Number.parseInt(process.env.AI_VIDEO_MEDIA_IO_CONCURRENCY || '4', 10) || 4);

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
  } catch (_) { }
  return null;
}

const ffmpegPath = resolveFfmpegPath();

function resolveFfprobePath() {
  try {
    const fp = require('ffprobe-static');
    if (fp?.path) return fp.path;
  } catch (_) { }
  const whichCmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    const res = spawnSync(whichCmd, ['ffprobe'], { windowsHide: true });
    if (res.status === 0 && res.stdout) {
      const candidate = String(res.stdout).trim().split(/\r?\n/)[0];
      if (candidate) return candidate;
    }
  } catch (_) { }
  return null;
}

const ffprobePath = resolveFfprobePath();

let googleTtsAuth = null;
let googleTtsAccessToken = null;
let googleTtsTokenExpiry = 0;

function clamp(n, min, max) {
  const value = Number.isFinite(n) ? n : min;
  return Math.min(max, Math.max(min, value));
}

async function runWithConcurrency(items = [], limit = 2, task = async () => null) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return [];
  const safeLimit = Math.max(1, Number.parseInt(String(limit || 1), 10) || 1);
  const results = new Array(list.length);
  let cursor = 0;

  const worker = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= list.length) return;
      results[index] = await task(list[index], index);
    }
  };

  await Promise.all(Array.from({ length: Math.min(safeLimit, list.length) }, () => worker()));
  return results;
}

async function measureStep(label, fn, logger = null) {
  const startedAt = Date.now();
  try {
    return await fn();
  } finally {
    if (typeof logger === 'function') {
      logger(`${label} completed in ${Date.now() - startedAt}ms`);
    }
  }
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
  const retriableStatusCodes = new Set([403, 404, 408, 409, 425, 429, 500, 502, 503, 504]);
  const maxAttempts = 4;
  let lastError = null;
  const timeoutMs = Math.max(
    5000,
    Number.parseInt(String(process.env.AI_VIDEO_MEDIA_DOWNLOAD_TIMEOUT_MS || '180000'), 10) || 180000
  );
  const maxBytes = Math.max(
    5 * 1024 * 1024,
    Number.parseInt(String(process.env.AI_VIDEO_MEDIA_MAX_DOWNLOAD_BYTES || String(750 * 1024 * 1024)), 10) || (750 * 1024 * 1024)
  );

  function bodyToNodeStream(body) {
    if (!body) return null;
    // node-fetch v2: body is a Node.js readable stream
    if (typeof body.pipe === 'function') return body;
    // Node's WHATWG fetch: body is a web ReadableStream
    if (typeof Readable.fromWeb === 'function' && typeof body.getReader === 'function') {
      return Readable.fromWeb(body);
    }
    return null;
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetchImpl(url, {
        headers: {
          // Some media CDNs reject unknown/empty clients; keep this browser-like.
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          'Accept': '*/*'
        },
        signal: controller?.signal
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        const status = Number(response.status || 0);
        const err = new Error(`Download failed (${status}): ${text.slice(0, 240)}`);
        if (attempt < maxAttempts && retriableStatusCodes.has(status)) {
          const waitMs = 600 * attempt;
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          lastError = err;
          continue;
        }
        throw err;
      }

      const contentLengthHeader = response.headers?.get?.('content-length');
      if (contentLengthHeader) {
        const contentLength = Number.parseInt(String(contentLengthHeader), 10);
        if (Number.isFinite(contentLength) && contentLength > maxBytes) {
          throw new Error(`Download too large (${contentLength} bytes) for ${url}`);
        }
      }

      const bodyStream = bodyToNodeStream(response.body);
      if (bodyStream) {
        let total = 0;
        bodyStream.on('data', (chunk) => {
          total += chunk?.length || 0;
          if (total > maxBytes) {
            bodyStream.destroy(new Error(`Download exceeded ${maxBytes} bytes for ${url}`));
          }
        });
        await pipeline(bodyStream, fs.createWriteStream(outputPath));
      } else {
        // Fallback (should be rare): buffer in memory.
        const arrayBuffer = typeof response.arrayBuffer === 'function'
          ? await response.arrayBuffer()
          : await response.buffer();
        const data = Buffer.from(arrayBuffer);
        if (data.length > maxBytes) throw new Error(`Download exceeded ${maxBytes} bytes for ${url}`);
        await fs.promises.writeFile(outputPath, data);
      }

      const stat = await fs.promises.stat(outputPath);
      if (!stat.size) throw new Error('Downloaded file is empty');
      return {
        bytes: stat.size,
        mimeType: String(response.headers?.get?.('content-type') || '')
      };
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        const waitMs = 600 * attempt;
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  throw lastError || new Error('Download failed');
}

function runFfmpeg(args = [], options = {}) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      return reject(new Error('ffmpeg is not available (install ffmpeg-static or ffmpeg on PATH)'));
    }
    const timeoutMs = Math.max(
      10000,
      Number.parseInt(String(options.timeoutMs || process.env.AI_VIDEO_FFMPEG_TIMEOUT_MS || '900000'), 10) || 900000
    );
    const proc = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (error) => reject(error));

    const timer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch (_) {}
      reject(new Error(`ffmpeg timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-1200)}`));
    });
  });
}

function runProcess(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      windowsHide: true,
      ...options
    });
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (d) => { stdout += d.toString(); });
    proc.stderr?.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (error) => reject(error));
    proc.on('close', (code) => {
      if (code === 0) return resolve({ stdout, stderr });
      reject(new Error(`${command} exited with code ${code}: ${stderr.slice(-1200) || stdout.slice(-1200)}`));
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
    voiceGender: ['male', 'female'].includes(String(raw?.voiceGender || '').toLowerCase())
      ? String(raw.voiceGender).toLowerCase()
      : 'female',
    voiceVolume: Number.isFinite(Number(raw?.voiceVolume)) ? Number(raw.voiceVolume) : 1,
    musicVolume: Number.isFinite(Number(raw?.musicVolume)) ? Number(raw.musicVolume) : 0.24,
    fitVoiceToDuration: raw?.fitVoiceToDuration !== false,
    manualAudioData: typeof raw?.manualAudioData === 'string' ? raw.manualAudioData : '',
    manualAudioUrl: typeof raw?.manualAudioUrl === 'string' ? raw.manualAudioUrl.trim() : '',
    soundEffectUrls: Array.isArray(raw?.soundEffectUrls) ? raw.soundEffectUrls.filter(Boolean).map(String) : []
  };
}

function fitVoiceScriptToDuration(text = '', durationSeconds = 60) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return clean;

  const safeDuration = clamp(Number(durationSeconds) || 60, 6, 1800);
  // Approx narration pacing ~130 wpm (2.17 wps). Keep slightly conservative.
  const targetWords = Math.max(8, Math.round(safeDuration * 2.2));
  const words = clean.split(' ').filter(Boolean);
  if (words.length <= Math.round(targetWords * 1.15)) return clean;

  const shortened = words.slice(0, targetWords).join(' ');
  const lastStop = Math.max(
    shortened.lastIndexOf('.'),
    shortened.lastIndexOf('!'),
    shortened.lastIndexOf('?')
  );
  const trimmed = lastStop > 40 ? shortened.slice(0, lastStop + 1) : shortened;
  return trimmed.trim() || shortened.trim();
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
      videoPrompt: `${chunk}. Add subtle stable camera motion (slow push-in, pan, reveal). Keep details sharp and avoid warped objects, flicker, pixelation, and noisy artifacts.`,
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

function resolveLocalGeneratedMediaPath(sourceUrl = '') {
  try {
    const parsed = new URL(String(sourceUrl || '').trim());
    const pathname = decodeURIComponent(String(parsed.pathname || ''));
    const prefix = '/generated-media/';
    if (!pathname.startsWith(prefix)) return null;

    const relativeParts = pathname
      .slice(prefix.length)
      .split('/')
      .map((part) => sanitizeSegment(part, ''))
      .filter(Boolean);

    if (!relativeParts.length) return null;

    const root = path.resolve(STORAGE_ROOT);
    const candidate = path.resolve(path.join(root, ...relativeParts));
    if (candidate === root || !candidate.startsWith(`${root}${path.sep}`)) return null;

    const stat = fs.statSync(candidate);
    if (!stat.isFile()) return null;
    return candidate;
  } catch (_) {
    return null;
  }
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
    const localGeneratedMediaPath = resolveLocalGeneratedMediaPath(raw);
    if (localGeneratedMediaPath) {
      await fs.promises.copyFile(localGeneratedMediaPath, destinationPath);
      const stat = await fs.promises.stat(destinationPath);
      if (!stat.size) throw new Error('Copied generated media file is empty');
      return { mimeType: '' };
    }
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
      || 'Cinematic product-focused vertical ad, crisp details, stable motion, cohesive color palette, consistent lighting.';

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
      globalVisualStyle: 'Premium vertical ad style with crisp details, clean product edges, stable motion, consistent framing and lighting.',
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

  const outputScenes = await runWithConcurrency(
    sceneData,
    SCENE_IMAGE_CONCURRENCY,
    async (scene, index) => {
    const fileName = `scene_${scene.index}.jpg`;
    const localPath = path.join(context.dirs.images, fileName);
    const mediaUrl = buildMediaUrl(context.baseUrl, context.jobId, ['images', fileName]);

    // First scene can use uploaded image or product image directly.
    const canUseReferenceDirectly = index === 0 && referenceImage?.localPath;

      if (canUseReferenceDirectly) {
      await fs.promises.copyFile(referenceImage.localPath, localPath);
        return {
        ...scene,
        imageUrl: mediaUrl,
        imagePath: localPath,
        imageSource: referenceImage.type
        };
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

      return {
        ...scene,
        imageUrl: mediaUrl,
        imagePath: localPath,
        imageSource: 'ai_generated'
      };
    }
  );

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
    '-preset', VIDEO_ENCODE_PRESET,
    '-crf', VIDEO_ENCODE_CRF,
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
    '-preset', VIDEO_ENCODE_PRESET,
    '-crf', VIDEO_ENCODE_CRF,
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
  return runWithConcurrency(scenes, SCENE_CLIP_CONCURRENCY, async (scene, index) => {
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
    '-preset', VIDEO_ENCODE_PRESET,
    '-crf', VIDEO_ENCODE_CRF,
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
  const normalized = String(code || '').toLowerCase().trim().split(/[-_]/)[0];
  const allowed = new Set(['en', 'hi', 'ta', 'te', 'kn', 'ml']);
  return allowed.has(normalized) ? normalized : 'en';
}

function ttsLanguageLabel(code = 'en') {
  const labels = {
    en: 'English',
    hi: 'Hindi',
    ta: 'Tamil',
    te: 'Telugu',
    kn: 'Kannada',
    ml: 'Malayalam'
  };
  return labels[toTtsLanguageCode(code)] || labels.en;
}

function targetScriptName(code = 'en') {
  const scripts = {
    en: 'Latin',
    hi: 'Devanagari',
    ta: 'Tamil',
    te: 'Telugu',
    kn: 'Kannada',
    ml: 'Malayalam'
  };
  return scripts[toTtsLanguageCode(code)] || scripts.en;
}

function wordCount(text = '') {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return 0;
  return clean.split(' ').filter(Boolean).length;
}

function speechWpmForLanguage(languageCode = 'en', voiceGender = 'female') {
  const lang = toTtsLanguageCode(languageCode);
  const gender = String(voiceGender || 'female').toLowerCase() === 'male' ? 'male' : 'female';

  // Cinematic reel pacing (conservative). These are *targets* for script shaping,
  // not absolute truth across voices.
  const base = {
    en: 135,
    hi: 125,
    ta: 120,
    te: 120,
    kn: 118,
    ml: 118
  };

  const wpm = base[lang] || base.en;
  // Slightly slower for deep male voices (more "cinematic")
  return gender === 'male' ? Math.round(wpm * 0.95) : wpm;
}

function estimateSpeechSeconds(text, languageCode = 'en', voiceGender = 'female') {
  const wc = wordCount(text);
  if (!wc) return 0;
  const wpm = speechWpmForLanguage(languageCode, voiceGender);
  return (wc / Math.max(60, wpm)) * 60;
}

function targetWordRange(durationSeconds, languageCode = 'en', voiceGender = 'female') {
  const safe = clamp(Number(durationSeconds) || DEFAULT_DURATION_SECONDS, 6, 1800);
  const wpm = speechWpmForLanguage(languageCode, voiceGender);
  const target = Math.max(10, Math.round((safe / 60) * wpm));
  // Allow some natural variation, but prevent "aggressive compression"
  return {
    min: Math.max(8, Math.round(target * 0.92)),
    max: Math.max(12, Math.round(target * 1.12)),
    target
  };
}

function normalizeSceneTimingForTranslation(sceneData = [], totalDurationSeconds = 60) {
  // We want stable start/end seconds so translation can match timing.
  // Input scenes may or may not include timing; build if missing.
  const scenes = Array.isArray(sceneData) ? sceneData : [];
  if (!scenes.length) return [];

  const withTiming = scenes.every((s) => Number.isFinite(Number(s?.startSec)) && Number.isFinite(Number(s?.endSec)));
  if (withTiming) {
    return scenes.map((s, idx) => ({
      index: Number.parseInt(String(s?.index || idx + 1), 10) || (idx + 1),
      sceneId: String(s?.sceneId || `scene_${idx + 1}`),
      startSec: Number(s.startSec),
      endSec: Number(s.endSec),
      durationSeconds: Math.max(1, Number(s.durationSeconds) || (Number(s.endSec) - Number(s.startSec)) || 1),
      voiceLine: String(s?.voiceLine || '').trim()
    }));
  }

  const safeTotal = clamp(Number(totalDurationSeconds) || DEFAULT_DURATION_SECONDS, 6, 1800);
  const durations = splitDurations(safeTotal, scenes.length);
  let cursor = 0;
  return scenes.map((s, idx) => {
    const durationSeconds = durations[idx];
    const startSec = cursor;
    const endSec = cursor + durationSeconds;
    cursor = endSec;
    return {
      index: Number.parseInt(String(s?.index || idx + 1), 10) || (idx + 1),
      sceneId: String(s?.sceneId || `scene_${idx + 1}`),
      startSec,
      endSec,
      durationSeconds,
      voiceLine: String(s?.voiceLine || '').trim()
    };
  });
}

async function getAudioDurationSecondsFromFile(filePath) {
  if (!ffprobePath) return null;
  const target = String(filePath || '').trim();
  if (!target) return null;
  try {
    const { stdout } = await runProcess(ffprobePath, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      target
    ]);
    const n = Number.parseFloat(String(stdout || '').trim());
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch (_) {
    return null;
  }
}

async function translateScriptDurationAware({
  sourceText,
  sceneData = [],
  targetDurationSeconds,
  languageCode,
  voiceGender = 'female',
  logger = null
}) {
  const source = String(sourceText || '').replace(/\s+/g, ' ').trim();
  const lang = toTtsLanguageCode(languageCode);
  if (!source || lang === 'en') {
    return { fullScript: source, scenes: normalizeSceneTimingForTranslation(sceneData, targetDurationSeconds) };
  }

  const language = ttsLanguageLabel(lang);
  const script = targetScriptName(lang);
  const safeDuration = clamp(Number(targetDurationSeconds) || DEFAULT_DURATION_SECONDS, 6, 1800);
  const range = targetWordRange(safeDuration, lang, voiceGender);
  const scenes = normalizeSceneTimingForTranslation(sceneData, safeDuration);

  const sceneBrief = scenes.length
    ? scenes.map((s) => {
        const line = s.voiceLine ? `EN: ${s.voiceLine}` : '';
        return [
          `Scene ${s.index} (${s.startSec}s-${s.endSec}s, ${s.durationSeconds}s)`,
          line
        ].filter(Boolean).join('\n');
      }).join('\n\n')
    : '';

  const prompt = `You translate cinematic short-video voiceovers WITHOUT summarizing.

Target language: ${language}
Target script: ${script}
Target total duration: ${safeDuration} seconds
Target word count (approx): ${range.target} words (acceptable ${range.min}-${range.max})
Voice style: ${String(voiceGender || 'female').toLowerCase() === 'male' ? 'deep, confident, cinematic' : 'warm, expressive, cinematic'}

Hard rules:
- DO NOT summarize or shorten. Preserve ALL details, emotion, pacing, and CTA impact.
- Keep the same storytelling structure and sentence richness.
- Keep brand names, product names, prices, URLs, and technical terms unchanged when needed.
- Return ONLY strict JSON. No markdown.
- Output must be mostly in ${language} (avoid English filler).
- Preserve natural pauses: use short sentences where appropriate (do not make it robotic).
- Match scene timing: each scene narration must comfortably fill its scene duration.

Return JSON exactly in this schema:
{
  "fullScript": "string",
  "scenes": [
    { "sceneId": "scene_1", "voiceLine": "string" }
  ]
}

English full voiceover:
${source}

Scene timing (English per scene when available):
${sceneBrief || '(no per-scene lines provided; still keep full-length pacing)'}\n`;

  const localized = await callGemini(prompt, {
    skipCache: true,
    temperature: 0.4,
    maxTokens: 2000,
    timeout: 90000
  });

  let parsed;
  try {
    parsed = parseGeminiJSON(localized);
  } catch (error) {
    if (logger) logger(`Translation JSON parse failed for ${language}: ${error.message || error}`);
    return { fullScript: source, scenes };
  }

  const fullScript = String(parsed?.fullScript || '').replace(/\s+/g, ' ').trim();
  const outScenesRaw = Array.isArray(parsed?.scenes) ? parsed.scenes : [];
  const byId = new Map(outScenesRaw
    .map((s) => ({ sceneId: String(s?.sceneId || '').trim(), voiceLine: String(s?.voiceLine || '').trim() }))
    .filter((s) => s.sceneId && s.voiceLine));

  const mergedScenes = scenes.length
    ? scenes.map((s) => ({
        ...s,
        voiceLine: byId.get(s.sceneId)?.voiceLine || s.voiceLine
      }))
    : scenes;

  return {
    fullScript: fullScript || source,
    scenes: mergedScenes
  };
}

async function expandIfTooShort({
  localizedText,
  sourceText,
  languageCode,
  targetDurationSeconds,
  voiceGender = 'female',
  logger = null
}) {
  const lang = toTtsLanguageCode(languageCode);
  const safeDuration = clamp(Number(targetDurationSeconds) || DEFAULT_DURATION_SECONDS, 6, 1800);
  if (!localizedText || lang === 'en') return localizedText;

  const estimated = estimateSpeechSeconds(localizedText, lang, voiceGender);
  if (estimated >= safeDuration * 0.92) return localizedText;

  const language = ttsLanguageLabel(lang);
  const script = targetScriptName(lang);
  const range = targetWordRange(safeDuration, lang, voiceGender);

  const prompt = `You are improving a translated cinematic voiceover to match the ORIGINAL duration and richness.

Target language: ${language}
Target script: ${script}
Target duration: ${safeDuration} seconds
Target word count: ${range.target} words (acceptable ${range.min}-${range.max})
Voice style: ${String(voiceGender || 'female').toLowerCase() === 'male' ? 'deep, confident, cinematic' : 'warm, expressive, cinematic'}

Rules:
- DO NOT summarize or delete meaning.
- Add natural connective phrasing, emotion, and descriptive beats to restore pacing.
- Do not invent new facts not present in the English source.
- Return only the improved translated text. No markdown, labels, or quotes.

English source (ground truth):
${String(sourceText || '').replace(/\\s+/g, ' ').trim()}

Current translation (too short):
${String(localizedText || '').replace(/\\s+/g, ' ').trim()}\n`;

  try {
    const improved = await callGemini(prompt, {
      skipCache: true,
      temperature: 0.45,
      maxTokens: 1800,
      timeout: 90000
    });
    const clean = String(improved || '')
      .replace(/^```(?:\\w+)?/i, '')
      .replace(/```$/i, '')
      .replace(/^\\s*(?:voiceover|translation|translated text)\\s*:\\s*/i, '')
      .replace(/\\s+/g, ' ')
      .trim();

    if (!clean) return localizedText;
    return clean;
  } catch (error) {
    if (logger) logger(`Translation expansion failed for ${language}: ${error.message || error}`);
    return localizedText;
  }
}

function googleCloudTtsVoice(languageCode = 'en', voiceGender = 'female') {
  const lang = toTtsLanguageCode(languageCode);
  const gender = String(voiceGender || 'female').toLowerCase() === 'male' ? 'male' : 'female';
  const voices = {
    en: {
      languageCode: 'en-US',
      male: GOOGLE_TTS_EN_MALE_VOICE,
      female: GOOGLE_TTS_EN_FEMALE_VOICE
    },
    hi: {
      languageCode: 'hi-IN',
      male: 'hi-IN-Wavenet-B',
      female: 'hi-IN-Wavenet-A'
    },
    ta: {
      languageCode: 'ta-IN',
      male: 'ta-IN-Wavenet-B',
      female: 'ta-IN-Wavenet-A'
    },
    te: {
      languageCode: 'te-IN',
      male: 'te-IN-Wavenet-B',
      female: 'te-IN-Wavenet-A'
    },
    kn: {
      languageCode: 'kn-IN',
      male: 'kn-IN-Wavenet-B',
      female: 'kn-IN-Wavenet-A'
    },
    ml: {
      languageCode: 'ml-IN',
      male: 'ml-IN-Wavenet-B',
      female: 'ml-IN-Wavenet-A'
    }
  };
  const voice = voices[lang] || voices.en;
  return {
    languageCode: voice.languageCode,
    name: voice[gender],
    ssmlGender: gender === 'male' ? 'MALE' : 'FEMALE'
  };
}

function googleCloudTtsAudioConfig(voiceGender = 'female', opts = {}) {
  const gender = String(voiceGender || 'female').toLowerCase() === 'male' ? 'male' : 'female';
  const speakingRate = Number(opts?.speakingRate);
  return {
    audioEncoding: 'MP3',
    speakingRate: Number.isFinite(speakingRate) ? clamp(speakingRate, 0.82, 1.06) : (gender === 'male' ? 0.9 : 1),
    pitch: gender === 'male' ? -6 : 0
  };
}

function speakingRateForTts({
  languageCode = 'en',
  voiceGender = 'female',
  targetDurationSeconds = null,
  estimatedScriptSeconds = null
}) {
  const lang = toTtsLanguageCode(languageCode);
  const gender = String(voiceGender || 'female').toLowerCase() === 'male' ? 'male' : 'female';

  // Baseline "cinematic" pace: slightly slower for non-English + male.
  const base = {
    en: gender === 'male' ? 0.93 : 1.0,
    hi: gender === 'male' ? 0.90 : 0.97,
    ta: gender === 'male' ? 0.90 : 0.97,
    te: gender === 'male' ? 0.90 : 0.97,
    kn: gender === 'male' ? 0.89 : 0.96,
    ml: gender === 'male' ? 0.89 : 0.96
  };

  let rate = base[lang] || base.en;

  // If our *estimated* narration is still short vs target, slow down a bit.
  const target = Number(targetDurationSeconds);
  const estimated = Number(estimatedScriptSeconds);
  if (Number.isFinite(target) && target > 0 && Number.isFinite(estimated) && estimated > 0) {
    const ratio = estimated / target;
    if (ratio < 0.9) rate *= 0.92;
    else if (ratio < 0.95) rate *= 0.96;
    else if (ratio > 1.15) rate *= 1.04;
  }

  return clamp(rate, 0.82, 1.06);
}

function edgeTtsRateString(rate = 1) {
  // edge-tts expects "+10%" / "-10%"
  const pct = Math.round((Number(rate) - 1) * 100);
  if (!Number.isFinite(pct) || pct === 0) return '+0%';
  return `${pct > 0 ? '+' : ''}${pct}%`;
}

function getEdgeVoice(languageCode = 'en', voiceGender = 'female') {
  const language = toTtsLanguageCode(languageCode);
  const gender = String(voiceGender || 'female').toLowerCase() === 'male' ? 'male' : 'female';
  const voices = {
    en: { male: 'en-US-GuyNeural', female: 'en-US-JennyNeural' },
    hi: { male: 'hi-IN-MadhurNeural', female: 'hi-IN-SwaraNeural' },
    ta: { male: 'ta-IN-ValluvarNeural', female: 'ta-IN-PallaviNeural' },
    te: { male: 'te-IN-MohanNeural', female: 'te-IN-ShrutiNeural' },
    kn: { male: 'kn-IN-GaganNeural', female: 'kn-IN-SapnaNeural' },
    ml: { male: 'ml-IN-MidhunNeural', female: 'ml-IN-SobhanaNeural' }
  };
  const configuredOverride = language === 'en'
    ? (gender === 'male' ? EDGE_TTS_MALE_VOICE : EDGE_TTS_FEMALE_VOICE)
    : '';
  return configuredOverride || voices[language]?.[gender] || voices.en[gender];
}

function maleVoiceEnhancementFilter() {
  return [
    'aresample=44100',
    'asetrate=44100*0.90',
    'atempo=1.11',
    'highpass=f=70',
    'equalizer=f=140:t=q:w=1:g=1.5',
    'equalizer=f=3000:t=q:w=1:g=1.2',
    'loudnorm=I=-16:TP=-1.5:LRA=11',
    'aresample=44100'
  ].join(',');
}

async function deepenMaleVoice(sourcePath, outputPath) {
  await runFfmpeg([
    '-y',
    '-i', sourcePath,
    '-af', maleVoiceEnhancementFilter(),
    '-c:a', 'libmp3lame',
    '-q:a', '2',
    outputPath
  ]);
}

async function getGoogleTtsAccessToken() {
  const now = Date.now();
  if (googleTtsAccessToken && googleTtsTokenExpiry > now + 300000) {
    return googleTtsAccessToken;
  }

  const clientEmail = String(process.env.VERTEX_CLIENT_EMAIL || '').trim();
  const privateKey = process.env.VERTEX_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!GOOGLE_TTS_PROJECT_ID || !clientEmail || !privateKey) {
    return null;
  }

  if (!googleTtsAuth) {
    googleTtsAuth = new GoogleAuth({
      credentials: {
        type: 'service_account',
        project_id: GOOGLE_TTS_PROJECT_ID,
        client_email: clientEmail,
        private_key: privateKey
      },
      scopes: ['https://www.googleapis.com/auth/cloud-platform']
    });
  }

  const client = await googleTtsAuth.getClient();
  const tokenResponse = await client.getAccessToken();
  googleTtsAccessToken = tokenResponse.token;
  googleTtsTokenExpiry = now + 3600000;
  return googleTtsAccessToken;
}

async function synthesizeGoogleCloudTts({
  text,
  languageCode,
  voiceGender,
  outputPath,
  speakingRate = null
}) {
  if (!fetchImpl) return false;
  const token = await getGoogleTtsAccessToken();
  if (!token) return false;

  const voice = googleCloudTtsVoice(languageCode, voiceGender);
  const response = await fetchImpl('https://texttospeech.googleapis.com/v1/text:synthesize', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      input: { text },
      voice,
      audioConfig: googleCloudTtsAudioConfig(voiceGender, { speakingRate })
    })
  });

  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new Error(`Google Cloud TTS HTTP ${response.status}: ${details.slice(0, 240)}`);
  }

  const data = await response.json();
  const audioContent = String(data?.audioContent || '');
  if (!audioContent) throw new Error('Google Cloud TTS returned no audioContent');
  await fs.promises.writeFile(outputPath, Buffer.from(audioContent, 'base64'));
  const stat = await fs.promises.stat(outputPath);
  return stat.size > 1200;
}

function toTtsVoiceLocale(code = 'en', voiceGender = 'female') {
  const normalized = toTtsLanguageCode(code);
  const gender = String(voiceGender || 'female').toLowerCase() === 'male' ? 'male' : 'female';
  if (normalized === 'en') return gender === 'male' ? 'en-GB' : 'en-US';
  return normalized;
}

function publicAudioUrl(context, fileName) {
  return `${buildMediaUrl(context.baseUrl, context.jobId, ['audio', fileName])}?v=${Date.now()}`;
}

async function synthesizeEdgeTts({
  text,
  languageCode,
  voiceGender,
  outputPath,
  speakingRate = 1,
  logger = null
}) {
  if (!EDGE_TTS_ENABLED) return false;
  const voice = getEdgeVoice(languageCode, voiceGender);
  const rate = edgeTtsRateString(speakingRate);
  const attempts = [
    {
      command: 'python',
      args: ['-m', 'edge_tts', '--voice', voice, '--rate', rate, '--text', text, '--write-media', outputPath]
    },
    {
      command: 'py',
      args: ['-m', 'edge_tts', '--voice', voice, '--rate', rate, '--text', text, '--write-media', outputPath]
    },
    {
      command: 'edge-tts',
      args: ['--voice', voice, '--rate', rate, '--text', text, '--write-media', outputPath]
    }
  ];

  for (const attempt of attempts) {
    try {
      await runProcess(attempt.command, attempt.args);
      const stat = await fs.promises.stat(outputPath);
      if (stat.size > 1200) return true;
    } catch (error) {
      if (logger) logger(`Edge TTS ${voice} via ${attempt.command} failed: ${error.message || error}`);
    }
  }

  return false;
}

async function synthesizeElevenLabsTts({
  text,
  languageCode,
  voiceGender,
  outputPath
}) {
  if (!fetchImpl || String(voiceGender || '').toLowerCase() !== 'male') return false;
  if (!ELEVENLABS_API_KEY || !ELEVENLABS_MALE_VOICE_ID) return false;

  const response = await fetchImpl(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(ELEVENLABS_MALE_VOICE_ID)}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text,
        model_id: ELEVENLABS_MODEL_ID,
        language_code: toTtsLanguageCode(languageCode),
        voice_settings: {
          stability: 0.35,
          similarity_boost: 1,
          style: 0.75,
          use_speaker_boost: true
        }
      })
    }
  );

  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new Error(`ElevenLabs TTS HTTP ${response.status}: ${details.slice(0, 240)}`);
  }

  const arrayBuffer = typeof response.arrayBuffer === 'function'
    ? await response.arrayBuffer()
    : await response.buffer();
  await fs.promises.writeFile(outputPath, Buffer.from(arrayBuffer));
  const stat = await fs.promises.stat(outputPath);
  return stat.size > 1200;
}

async function synthesizeVoiceTrack({
  voiceScript,
  sourceVoiceScript = '',
  sceneData = [],
  languageCode,
  voiceGender = 'female',
  targetDurationSeconds = null,
  fitToDuration = true,
  context,
  logger = null
}) {
  const normalizedLang = toTtsLanguageCode(languageCode);
  const safeTarget = Number.isFinite(Number(targetDurationSeconds)) ? Number(targetDurationSeconds) : null;

  // Step 1: Translate with duration awareness (scene-timed) and avoid summarization.
  let scriptForTts = String(voiceScript || '').replace(/\s+/g, ' ').trim();
  let localizedScenes = normalizeSceneTimingForTranslation(sceneData, safeTarget || DEFAULT_DURATION_SECONDS);

  if (normalizedLang !== 'en' && sourceVoiceScript) {
    try {
      const translated = await translateScriptDurationAware({
        sourceText: sourceVoiceScript,
        sceneData,
        targetDurationSeconds: safeTarget || DEFAULT_DURATION_SECONDS,
        languageCode,
        voiceGender,
        logger
      });
      scriptForTts = translated.fullScript || scriptForTts;
      localizedScenes = translated.scenes || localizedScenes;
    } catch (error) {
      if (logger) logger(`Duration-aware translation failed: ${error.message || error}`);
    }
  }

  // Step 2: If still too short, expand slightly while keeping meaning.
  if (fitToDuration && safeTarget && normalizedLang !== 'en' && sourceVoiceScript) {
    scriptForTts = await expandIfTooShort({
      localizedText: scriptForTts,
      sourceText: sourceVoiceScript,
      languageCode,
      targetDurationSeconds: safeTarget,
      voiceGender,
      logger
    });
  }

  // Step 3: If too long, trim carefully (this is the only shortening step).
  if (fitToDuration && safeTarget) {
    const estimated = estimateSpeechSeconds(scriptForTts, languageCode, voiceGender);
    if (estimated > safeTarget * 1.18) {
      scriptForTts = fitVoiceScriptToDuration(scriptForTts, safeTarget);
    }
  }

  const estimatedForRate = safeTarget ? estimateSpeechSeconds(scriptForTts, languageCode, voiceGender) : null;
  const speakingRate = speakingRateForTts({
    languageCode,
    voiceGender,
    targetDurationSeconds: safeTarget,
    estimatedScriptSeconds: estimatedForRate
  });

  const chunks = chunkTextForTts(scriptForTts, 170);
  if (!chunks.length) return null;

  const chunkPaths = [];
  const normalizedGender = String(voiceGender || 'female').toLowerCase() === 'male' ? 'male' : 'female';
  const ttsLocale = toTtsVoiceLocale(languageCode, normalizedGender);
  const finalVoiceFileName = `voice_track_${normalizedGender}.mp3`;
  const finalVoicePath = path.join(context.dirs.audio, finalVoiceFileName);

  const maybeStretchToTarget = async () => {
    if (!fitToDuration || !safeTarget) return;
    const actual = await getAudioDurationSecondsFromFile(finalVoicePath);
    if (!Number.isFinite(actual) || actual <= 0) return;
    if (actual >= safeTarget * 0.92) return;

    const ratio = actual / safeTarget;
    // Only stretch up to 2x (atempo >= 0.5).
    if (ratio < 0.5) return;

    const atempo = clamp(ratio, 0.5, 1.0); // output duration = input/atempo
    const stretchedPath = path.join(context.dirs.audio, `voice_track_${normalizedGender}_stretched.mp3`);
    if (logger) logger(`Voice track short (${actual.toFixed(2)}s vs ${safeTarget}s). Stretching with atempo=${atempo.toFixed(3)}`);

    await runFfmpeg([
      '-y',
      '-i', finalVoicePath,
      '-vn',
      '-af', `atempo=${atempo.toFixed(3)}`,
      '-c:a', 'libmp3lame',
      '-q:a', '2',
      stretchedPath
    ]);

    await fs.promises.copyFile(stretchedPath, finalVoicePath);
  };

  const chunkResults = await runWithConcurrency(chunks, 2, async (text, index) => {
    const outPath = path.join(context.dirs.audio, `voice_chunk_${index + 1}.mp3`);

    try {
      const edgeOk = await synthesizeEdgeTts({
        text,
        languageCode,
        voiceGender: normalizedGender,
        outputPath: outPath,
        speakingRate,
        logger
      });
      if (edgeOk) return outPath;
    } catch (error) {
      if (logger) logger(`Edge TTS chunk ${index + 1} failed: ${error.message || error}`);
    }

    try {
      const elevenLabsOk = await synthesizeElevenLabsTts({
        text,
        languageCode,
        voiceGender: normalizedGender,
        outputPath: outPath
      });
      if (elevenLabsOk) return outPath;
    } catch (error) {
      if (logger) logger(`ElevenLabs male voice chunk ${index + 1} failed: ${error.message || error}`);
    }

    try {
      const cloudOk = await synthesizeGoogleCloudTts({
        text,
        languageCode,
        voiceGender: normalizedGender,
        outputPath: outPath,
        speakingRate
      });
      if (cloudOk) return outPath;
    } catch (error) {
      if (logger) logger(`Google Cloud TTS chunk ${index + 1} failed: ${error.message || error}`);
    }

    try {
      const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(ttsLocale)}&q=${encodeURIComponent(text)}`;
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
      return outPath;
    } catch (error) {
      if (logger) logger(`Voice chunk ${index + 1} failed: ${error.message || error}`);
    }

    return null;
  });

  chunkResults.filter(Boolean).forEach((p) => chunkPaths.push(p));

  if (!chunkPaths.length) return null;
  if (chunkPaths.length === 1) {
    const voiceOutputPath = path.join(context.dirs.audio, normalizedGender === 'male' ? 'voice_track_male_source.mp3' : finalVoiceFileName);
    await fs.promises.copyFile(chunkPaths[0], voiceOutputPath);
    if (normalizedGender === 'male') {
      await deepenMaleVoice(voiceOutputPath, finalVoicePath);
    }

    await maybeStretchToTarget();
    return {
      path: finalVoicePath,
      url: publicAudioUrl(context, finalVoiceFileName),
      script: scriptForTts,
      sceneData: localizedScenes
    };
  }

  const concatListPath = path.join(context.dirs.temp, 'voice_chunks_concat.txt');
  const concatOutput = path.join(context.dirs.audio, normalizedGender === 'male' ? 'voice_track_male_source.mp3' : finalVoiceFileName);
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

  if (normalizedGender === 'male') {
    await deepenMaleVoice(concatOutput, finalVoicePath);
  }

  await maybeStretchToTarget();
  return {
    path: finalVoicePath,
    url: publicAudioUrl(context, finalVoiceFileName),
    script: scriptForTts,
    sceneData: localizedScenes
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
      sourceVoiceScript: plan.sourceVoiceScript || plan.voiceScript || input.description,
      sceneData: plan.sceneData || [],
      languageCode: audioOptions.languageCode,
      voiceGender: audioOptions.voiceGender,
      targetDurationSeconds: input.durationSeconds,
      fitToDuration: audioOptions.fitVoiceToDuration,
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

function ffmpegInputsForTracks(audioTracks, audioOptions = {}) {
  const ordered = [];
  const voiceVolume = clamp(Number(audioOptions.voiceVolume), 0, 2);
  const musicVolume = clamp(Number(audioOptions.musicVolume), 0, 2);
  if (audioTracks?.manual?.path) ordered.push({ label: 'manual', path: audioTracks.manual.path, volume: voiceVolume });
  if (audioTracks?.voice?.path) ordered.push({ label: 'voice', path: audioTracks.voice.path, volume: voiceVolume });
  if (audioTracks?.background?.path) ordered.push({ label: 'background', path: audioTracks.background.path, volume: musicVolume, loop: true });
  const sfx = Array.isArray(audioTracks?.soundEffects) ? audioTracks.soundEffects : [];
  for (const item of sfx) {
    if (item?.path) ordered.push({ label: 'sfx', path: item.path, volume: 0.45 });
  }
  return ordered;
}

async function mergeAudioTracks({
  audioTracks,
  durationSeconds,
  context,
  audioOptions = {}
}) {
  const normalizedAudioOptions = normalizeAudioOptions(audioOptions || {});
  const inputTracks = ffmpegInputsForTracks(audioTracks, normalizedAudioOptions);
  if (!inputTracks.length) return null;

  const outputPath = path.join(context.dirs.final, 'final_audio.mp3');
  const outputUrl = buildMediaUrl(context.baseUrl, context.jobId, ['final', 'final_audio.mp3']);
  const safeDuration = clamp(Number.parseInt(String(durationSeconds || 0), 10), 3, 1800);

  if (inputTracks.length === 1) {
    const args = ['-y'];
    if (inputTracks[0].loop) args.push('-stream_loop', '-1');
    args.push('-i', inputTracks[0].path);
    const filter = inputTracks[0].loop
      ? `volume=${inputTracks[0].volume.toFixed(2)}`
      : `volume=${inputTracks[0].volume.toFixed(2)},apad`;
    args.push(
      '-vn',
      '-af', filter,
      '-c:a', 'libmp3lame',
      '-q:a', '2',
      '-t', String(safeDuration),
      outputPath
    );
    await runFfmpeg(args);
    return { path: outputPath, url: outputUrl };
  }

  const args = ['-y'];
  inputTracks.forEach((track) => {
    if (track.loop) args.push('-stream_loop', '-1');
    args.push('-i', track.path);
  });

  const volumeStages = inputTracks
    .map((track, idx) => `[${idx}:a]volume=${track.volume.toFixed(2)}[a${idx}]`)
    .join(';');
  const mixedInputs = inputTracks.map((_, idx) => `[a${idx}]`).join('');
  const filterComplex = `${volumeStages};${mixedInputs}amix=inputs=${inputTracks.length}:duration=longest:dropout_transition=2,apad[mix]`;

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
      '-preset', VIDEO_ENCODE_PRESET,
      '-crf', VIDEO_ENCODE_CRF
    );
  } else {
    args.push('-c:v', 'copy');
  }

  if (mergedAudio?.path) {
    args.push('-af', 'apad', '-c:a', 'aac', '-b:a', '192k', '-shortest');
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
  const plan = await measureStep('generateScenes', () => generateScenesPlan({ input, product, user, logger: log }), log);

  update(20, 'generateImages', { scenes: plan.scenes.length });
  log('Generating scene images with consistency');
  const audioTracksPromise = measureStep(
    'generateAudio',
    () => generateAudioTracks({ input, plan, context, logger: log }),
    log
  );
  const scenesWithImages = await measureStep('generateImages', () => generateSceneImages({
    input,
    product,
    plan,
    user,
    context,
    logger: log
  }), log);

  update(45, 'generateVideoClips');
  log('Rendering scene video clips');
  const scenesWithClips = await measureStep('generateVideoClips', () => generateSceneClips({
    scenes: scenesWithImages,
    context,
    logger: log,
    onSceneDone: (sceneIndex, totalScenes) => {
      const stepProgress = 45 + Math.round((sceneProgress(sceneIndex, totalScenes) / 100) * 20);
      update(stepProgress, 'generateVideoClips', { completed: sceneIndex + 1, total: totalScenes });
    }
  }), log);

  update(66, 'mergeVideo');
  log('Merging scene clips into final_video.mp4');
  const mergedVideo = await measureStep('mergeVideo', () => mergeSceneVideos({ scenes: scenesWithClips, context }), log);

  update(74, 'generateAudio');
  log('Preparing audio tracks');
  const audioTracks = await audioTracksPromise;

  update(82, 'mergeAudio');
  let mergedAudio = null;
  if (audioTracks.enabled) {
    log('Mixing final_audio.mp3');
    mergedAudio = await measureStep('mergeAudio', () => mergeAudioTracks({
      audioTracks: audioTracks.tracks,
      durationSeconds: input.durationSeconds,
      context,
      audioOptions: input.audio
    }), log);
  }

  update(88, 'subtitles');
  let subtitles = null;
  if (input.subtitles.enabled) {
    log('Generating subtitles.srt');
    subtitles = await measureStep('subtitles', () => generateSrtFile({ sceneData: scenesWithClips, context }), log);
  }

  update(92, 'finalMerge');
  log('Merging final video and audio into final_output.mp4');
  const finalOutput = await measureStep('finalMerge', () => mergeFinalOutput({
    mergedVideo,
    mergedAudio,
    subtitles,
    context
  }), log);

  update(96, 'thumbnail');
  log('Generating thumbnail');
  const thumbnail = await measureStep('thumbnail', () => generateThumbnail({
    input,
    product,
    plan,
    sceneData: scenesWithClips,
    context,
    logger: log
  }), log);

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
  baseUrl,
  onProgress = null,
  onLog = null
}) {
  const context = createJobContext({ baseUrl: baseUrl || getPublicBaseUrl(), providedJobId: payload?.jobId });
  const rawScenes = Array.isArray(payload?.sceneData) ? payload.sceneData : [];
  if (!rawScenes.length) throw new Error('sceneData is required for generateVideoClips');

  const scenes = await runWithConcurrency(rawScenes, MEDIA_IO_CONCURRENCY, async (rawScene, i) => {
    const normalized = ensureSceneInputForClipStage(rawScene, i);
    const source = normalized.imagePath || normalized.imageUrl;
    if (!source) throw new Error(`Scene ${normalized.sceneId} is missing image input`);
    const ext = fileExtFromSource(source, '.jpg');
    const imageName = `scene_${normalized.index}${ext}`;
    const imagePath = path.join(context.dirs.images, imageName);
    await materializeSourceToFile({ source, destinationPath: imagePath });
    return {
      ...normalized,
      imagePath,
      imageUrl: buildMediaUrl(context.baseUrl, context.jobId, ['images', imageName])
    };
  });

  const scenesWithClips = await generateSceneClips({
    scenes,
    context,
    logger: typeof onLog === 'function' ? onLog : null,
    onSceneDone: typeof onProgress === 'function'
      ? (sceneIndex, totalScenes, enriched) => {
          const base = 5;
          const span = 60;
          const pct = base + Math.round(((sceneIndex + 1) / Math.max(1, totalScenes)) * span);
          onProgress({
            progress: pct,
            currentStep: 'generate_clips',
            metadata: {
              completed: sceneIndex + 1,
              total: totalScenes,
              sceneId: enriched?.sceneId || null
            }
          });
        }
      : null
  });
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
    voiceScript: String(payload?.voiceScript || payload?.description || '').trim(),
    sourceVoiceScript: String(payload?.sourceVoiceScript || payload?.voiceScript || payload?.description || '').trim(),
    sceneData: Array.isArray(payload?.sceneData) ? payload.sceneData : []
  };

  const audioTracks = await generateAudioTracks({ input, plan, context });
  const mergedAudio = (!skipMix && audioTracks.enabled)
    ? await mergeAudioTracks({
      audioTracks: audioTracks.tracks,
      durationSeconds: input.durationSeconds,
      context,
      audioOptions: input.audio
    })
    : null;

  return {
    success: true,
    jobId: context.jobId,
    audioEnabled: audioTracks.enabled,
    audioMode: audioTracks.mode,
    mixed: Boolean(mergedAudio?.url),
    finalAudioUrl: mergedAudio?.url || null,
    localizedVoiceScript: audioTracks.tracks?.voice?.script || null,
    localizedSceneData: audioTracks.tracks?.voice?.sceneData || null,
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

  await Promise.all(sources.map(async ([key, source]) => {
    if (!source) return;
    const ext = fileExtFromSource(source, '.mp3');
    const outputName = `${key}${ext}`;
    const outputPath = path.join(context.dirs.audio, outputName);
    await materializeSourceToFile({ source, destinationPath: outputPath });
    trackConfig[key] = {
      path: outputPath,
      url: buildMediaUrl(context.baseUrl, context.jobId, ['audio', outputName])
    };
  }));

  const sfxSources = Array.isArray(payload?.soundEffectUrls) ? payload.soundEffectUrls : [];
  const sfxResolved = await runWithConcurrency(sfxSources, MEDIA_IO_CONCURRENCY, async (source, i) => {
    if (!source) return null;
    const ext = fileExtFromSource(source, '.mp3');
    const outputName = `sfx_${i + 1}${ext}`;
    const outputPath = path.join(context.dirs.audio, outputName);
    await materializeSourceToFile({ source, destinationPath: outputPath });
    return {
      path: outputPath,
      url: buildMediaUrl(context.baseUrl, context.jobId, ['audio', outputName]),
      index: i
    };
  });
  trackConfig.soundEffects = sfxResolved.filter(Boolean).sort((a, b) => a.index - b.index).map(({ path: p, url }) => ({ path: p, url }));

  const mergedAudio = await mergeAudioTracks({
    audioTracks: trackConfig,
    durationSeconds: safeDuration,
    context,
    audioOptions: payload?.audio || payload?.audioConfig || {}
  });

  return {
    success: true,
    jobId: context.jobId,
    finalAudioUrl: mergedAudio?.url || null
  };
}

async function runMergeVideo({
  payload,
  baseUrl,
  onProgress = null,
  onLog = null
}) {
  const context = createJobContext({ baseUrl: baseUrl || getPublicBaseUrl(), providedJobId: payload?.jobId });
  const sceneClips = Array.isArray(payload?.clipUrls) ? payload.clipUrls : [];

  if (!sceneClips.length) {
    throw new Error('clipUrls is required for mergeVideo');
  }

  const reportProgress = (progress, currentStep, metadata = null) => {
    if (typeof onProgress === 'function') {
      onProgress({ progress, currentStep, metadata });
    }
  };

  const logLine = (line) => {
    if (typeof onLog === 'function') onLog(String(line || '').trim());
  };

  const localClipPaths = [];
  for (let i = 0; i < sceneClips.length; i += 1) {
    const source = String(sceneClips[i] || '').trim();
    if (!source) continue;
    const outputName = `scene_${i + 1}.mp4`;
    const outputPath = path.join(context.dirs.clips, outputName);
    reportProgress(10 + Math.round((i / Math.max(1, sceneClips.length)) * 35), 'downloading_clips', {
      index: i + 1,
      total: sceneClips.length
    });
    logLine(`Downloading clip ${i + 1}/${sceneClips.length}`);
    await materializeSourceToFile({ source, destinationPath: outputPath });
    localClipPaths.push(outputPath);
  }

  reportProgress(50, 'merging_clips');
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
    reportProgress(65, 'downloading_audio');
    logLine('Downloading final audio track');
    await materializeSourceToFile({ source: audioSource, destinationPath: audioPath });
    mergedAudio = {
      path: audioPath,
      url: buildMediaUrl(context.baseUrl, context.jobId, ['audio', 'input_audio.mp3'])
    };
  }

  let subtitles = null;
  if (payload?.subtitles?.enabled && Array.isArray(payload?.sceneData)) {
    reportProgress(75, 'generating_subtitles');
    subtitles = await generateSrtFile({
      sceneData: payload.sceneData.map((scene, idx) => ensureSceneInputForClipStage(scene, idx)),
      context
    });
  }

  reportProgress(88, 'merging_final_output');
  const finalOutput = await mergeFinalOutput({
    mergedVideo,
    mergedAudio,
    subtitles,
    context
  });

  reportProgress(98, 'finalizing');
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
