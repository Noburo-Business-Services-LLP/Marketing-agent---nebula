const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { spawn, spawnSync } = require('child_process');
const { GoogleAuth } = require('google-auth-library');

const Product = require('../models/Product');
const VideoDraft = require('../models/VideoDraft');
const User = require('../models/User');
const { callGemini, parseGeminiJSON, generateCampaignImageNanoBanana, extractCharacterVisualTraits } = require('./geminiAI');
const { callOpenAI } = require('./openAI');
const { getPublicBaseUrl, normalizeTone, audioFilePathForTone } = require('../utils/toneAudio');
const { generateVideoClip, getKlingDuration, generateCharacterImageFal, generateCharacterSheetFal, applyFaceSwapFal, extractFaceEmbedding } = require('./videoService');
const { uploadVideoFile } = require('./imageUploader');

const STORAGE_ROOT = path.resolve(__dirname, '../storage/ai-videos');
const VIDEO_TARGET = { width: 1080, height: 1920, fps: 30 };
const VIDEO_ENCODE_PRESET = String(process.env.AI_VIDEO_ENCODE_PRESET || 'ultrafast');
const VIDEO_ENCODE_CRF = String(process.env.AI_VIDEO_ENCODE_CRF || '23');
const AUDIO_SYNC_THRESHOLD_SECONDS = Math.max(0, Number(process.env.AI_VIDEO_AUDIO_SYNC_THRESHOLD_SECONDS || 1.25) || 1.25);
// ffmpeg's atempo accepts 0.5–2.0, but anything past ~1.06 is audibly
// rushed — that was the "voice sounds like 1.25x" bug. Time-stretching is
// only ever a last-millimetre nudge; a script that doesn't fit gets fixed
// at generation time (see targetWordRange / fitVoiceScriptToDuration),
// not papered over by speeding up the narrator.
const AUDIO_MAX_SPEEDUP = clampEnvTempo(process.env.AI_VIDEO_AUDIO_MAX_SPEEDUP, 1.06, 1.0, 1.25);
const AUDIO_MAX_SLOWDOWN = clampEnvTempo(process.env.AI_VIDEO_AUDIO_MAX_SLOWDOWN, 0.94, 0.8, 1.0);

function clampEnvTempo(raw, fallback, min, max) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}
const GOOGLE_TTS_PROJECT_ID = process.env.VERTEX_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT_ID || '';
const GOOGLE_TTS_EN_MALE_VOICE = String(process.env.GOOGLE_TTS_EN_MALE_VOICE || 'en-US-Neural2-J').trim();
const GOOGLE_TTS_EN_FEMALE_VOICE = String(process.env.GOOGLE_TTS_EN_FEMALE_VOICE || 'en-US-Neural2-F').trim();
const GOOGLE_TTS_EN_IN_MALE_VOICE = String(process.env.GOOGLE_TTS_EN_IN_MALE_VOICE || 'en-IN-Wavenet-B').trim();
const GOOGLE_TTS_EN_IN_FEMALE_VOICE = String(process.env.GOOGLE_TTS_EN_IN_FEMALE_VOICE || 'en-IN-Wavenet-A').trim();
const GOOGLE_TTS_EN_GB_MALE_VOICE = String(process.env.GOOGLE_TTS_EN_GB_MALE_VOICE || 'en-GB-Neural2-B').trim();
const GOOGLE_TTS_EN_GB_FEMALE_VOICE = String(process.env.GOOGLE_TTS_EN_GB_FEMALE_VOICE || 'en-GB-Neural2-A').trim();
const GOOGLE_TTS_HI_IN_MALE_VOICE = String(process.env.GOOGLE_TTS_HI_IN_MALE_VOICE || 'hi-IN-Wavenet-B').trim();
const GOOGLE_TTS_HI_IN_FEMALE_VOICE = String(process.env.GOOGLE_TTS_HI_IN_FEMALE_VOICE || 'hi-IN-Wavenet-A').trim();
const EDGE_TTS_ENABLED = String(process.env.EDGE_TTS_ENABLED || 'true').toLowerCase() !== 'false';
const EDGE_TTS_MALE_VOICE = String(process.env.EDGE_TTS_MALE_VOICE || '').trim();
const EDGE_TTS_FEMALE_VOICE = String(process.env.EDGE_TTS_FEMALE_VOICE || '').trim();
const ELEVENLABS_API_KEY = String(process.env.ELEVENLABS_API_KEY || '').trim();
const ELEVENLABS_MALE_VOICE_ID = String(process.env.ELEVENLABS_MALE_VOICE_ID || '').trim();
// Latest expressive model. eleven_v3 supports 70+ languages
// (incl. Tamil / Telugu / Kannada / Malayalam) with emotional
// prosody. If a specific voice isn't v3-compatible we fall back
// to eleven_multilingual_v2 automatically (see synthesize below).
const ELEVENLABS_MODEL_ID = String(process.env.ELEVENLABS_MODEL_ID || 'eleven_v3').trim();
const ELEVENLABS_MODEL_FALLBACK = 'eleven_multilingual_v2';
const MAX_SCENES = 10;
const MIN_SCENES = 1;
const DEFAULT_DURATION_SECONDS = 60;
const SCENE_IMAGE_CONCURRENCY = Math.max(1, Number.parseInt(process.env.AI_VIDEO_SCENE_IMAGE_CONCURRENCY || '3', 10) || 3);
const SCENE_CLIP_CONCURRENCY = Math.max(1, Number.parseInt(process.env.AI_VIDEO_SCENE_CLIP_CONCURRENCY || '1', 10) || 1);
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

    // Global cap on CPU thread allocation to prevent server freezes/CPU starvation
    const finalArgs = [...args];
    if (!finalArgs.includes('-threads')) {
      finalArgs.unshift('-threads', '2');
    }

    const proc = spawn(ffmpegPath, finalArgs, { windowsHide: true });
    let stderr = '';
    
    proc.stderr.on('data', (d) => {
      const chunk = d.toString();
      stderr += chunk;

      // Real-time progress monitoring: Parse progress time (e.g. time=00:00:15.30)
      if (typeof options.onProgress === 'function' && options.totalDuration > 0) {
        const timeMatch = chunk.match(/time=(\d+):(\d+):(\d+)\.(\d+)/);
        if (timeMatch) {
          const hours = parseInt(timeMatch[1], 10);
          const minutes = parseInt(timeMatch[2], 10);
          const seconds = parseInt(timeMatch[3], 10);
          const ms = parseInt(timeMatch[4], 10);
          const currentTime = hours * 3600 + minutes * 60 + seconds + ms / 100;
          const pct = Math.min(99, Math.round((currentTime / options.totalDuration) * 100));
          options.onProgress(pct);
        }
      }
    });

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
    musicSource: ['tone', 'library', 'elevenlabs_ai'].includes(String(raw?.musicSource || '').toLowerCase())
      ? String(raw.musicSource).toLowerCase()
      : String(process.env.AI_VIDEO_MUSIC_SOURCE || 'library').toLowerCase(),
    musicTrack: typeof raw?.musicTrack === 'string' ? raw.musicTrack.trim() : '',
    // Optional user-supplied prompt for AI-composed music. Empty →
    // auto-derived from voice script + emotions.
    musicPrompt: typeof raw?.musicPrompt === 'string' ? raw.musicPrompt.trim().slice(0, 500) : '',
    voiceGender: ['male', 'female'].includes(String(raw?.voiceGender || '').toLowerCase())
      ? String(raw.voiceGender).toLowerCase()
      : 'female',
    // ElevenLabs voice ID chosen in the Audio Config UI. When present,
    // the TTS pipeline routes to ElevenLabs first (Google / Edge stay
    // as fallbacks if the ElevenLabs call fails).
    voiceId: typeof raw?.voiceId === 'string' ? raw.voiceId.trim() : '',
    voiceVolume: Number.isFinite(Number(raw?.voiceVolume)) ? Number(raw.voiceVolume) : 1,
    musicVolume: Number.isFinite(Number(raw?.musicVolume)) ? Number(raw.musicVolume) : 0.24,
    fitVoiceToDuration: raw?.fitVoiceToDuration !== false,
    manualAudioData: typeof raw?.manualAudioData === 'string' ? raw.manualAudioData : '',
    manualAudioUrl: typeof raw?.manualAudioUrl === 'string' ? raw.manualAudioUrl.trim() : '',
    soundEffectUrls: Array.isArray(raw?.soundEffectUrls) ? raw.soundEffectUrls.filter(Boolean).map(String) : []
  };
}

function musicLibraryRoot() {
  return path.resolve(__dirname, '../music');
}

function isAudioFileName(fileName = '') {
  const ext = path.extname(String(fileName || '')).toLowerCase();
  return ['.mp3', '.wav', '.m4a', '.aac', '.ogg'].includes(ext);
}

function listMusicCandidates(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) return [];
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && isAudioFileName(e.name))
      .map((e) => path.join(dirPath, e.name));
  } catch (_) {
    return [];
  }
}

function bucketDurationSeconds(seconds = 60) {
  const value = clamp(Number.parseInt(String(seconds || 0), 10) || 60, 6, 180);
  const buckets = [15, 30, 45, 60];
  let best = buckets[0];
  let bestDiff = Math.abs(value - best);
  for (const b of buckets.slice(1)) {
    const diff = Math.abs(value - b);
    if (diff < bestDiff) {
      best = b;
      bestDiff = diff;
    }
  }
  return best;
}

function stablePick(items = [], seed = '') {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return null;
  const str = String(seed || '');
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return list[hash % list.length];
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

// Split text into exactly `chunkCount` slots, in order. Slots may be empty
// when there isn't enough source text — callers must treat an empty slot as
// "no line here" and must NOT reuse a neighbouring chunk to fill it. Doing
// that is what made short descriptions narrate the same sentence 3-4 times.
function sentenceChunks(text = '', chunkCount = 4) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  const count = Math.max(1, Number.parseInt(String(chunkCount), 10) || 1);
  if (!clean) return Array.from({ length: count }, () => '');

  // Spread every unit across the slots proportionally so nothing is dropped
  // off the end and nothing is duplicated into the leftovers.
  const spread = (units, join) => Array.from({ length: count }, (_, i) => {
    const start = Math.floor((i * units.length) / count);
    const end = Math.floor(((i + 1) * units.length) / count);
    return units.slice(start, end).join(join).trim();
  });

  const sentences = clean.split(/[.!?]/g).map((item) => item.trim()).filter(Boolean);
  if (sentences.length >= count) return spread(sentences, '. ');

  const words = clean.split(' ').filter(Boolean);
  return spread(words, ' ');
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

    // Narration must never be duplicated across scenes — an empty slot means
    // this scene simply carries no spoken line. Visual prompts are allowed to
    // fall back to the overall description, since repeated framing guidance
    // is harmless whereas repeated narration is exactly the bug.
    const chunk = String(chunks[idx] || '').trim();
    const visualBrief = chunk || description;
    const productLine = productName ? `Feature ${productName} naturally in the frame.` : 'Focus on a clear visual story.';

    return {
      index: idx + 1,
      sceneId: `scene_${idx + 1}`,
      title: `Scene ${idx + 1}`,
      durationSeconds: duration,
      startSec,
      endSec,
      imagePrompt: `${visualBrief}. ${productLine} Keep composition vertical 9:16 and premium.`,
      videoPrompt: `${visualBrief}. Add subtle stable camera motion (slow push-in, pan, reveal). Keep details sharp and avoid warped objects, flicker, pixelation, and noisy artifacts.`,
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
  const validAspect = new Set(['9:16', '16:9', '1:1', '4:5']);
  const aspectRatio = validAspect.has(String(payload.aspectRatio || '').trim())
    ? String(payload.aspectRatio).trim()
    : '9:16';
  const validLangs = new Set(['en', 'hi', 'ta', 'te', 'kn', 'ml']);
  const languageCode = validLangs.has(String(payload.languageCode || '').toLowerCase())
    ? String(payload.languageCode).toLowerCase()
    : 'en';

  // Environment definition (Step 3 of the wizard). Kept as a plain
  // pass-through so downstream prompt builders can read enabled +
  // referenceImages + notes. When enabled=false, prompts should
  // behave as if the env block doesn't exist.
  const environment = {
    enabled: !!payload.environment?.enabled,
    referenceImages: Array.isArray(payload.environment?.referenceImages)
      ? payload.environment.referenceImages
          .filter((r) => r && (r.url || r.dataUrl))
          .map((r) => ({
            url: String(r.url || '').trim(),
            dataUrl: String(r.dataUrl || '').trim(),
            source: r.source === 'brand-asset' ? 'brand-asset' : 'upload'
          }))
          .slice(0, 5)
      : [],
    notes: String(payload.environment?.notes || '').trim().slice(0, 500)
  };

  return {
    description: safeDescription,
    durationSeconds,
    sceneCount,
    aspectRatio,
    languageCode,
    environment,
    imageData: typeof payload.imageData === 'string' ? payload.imageData.trim() : '',
    imageUrl: typeof payload.imageUrl === 'string' ? payload.imageUrl.trim() : '',
    productId: typeof payload.productId === 'string' ? payload.productId.trim() : '',
    product: payload.product && typeof payload.product === 'object' ? payload.product : null,
    styleHint: String(payload.styleHint || '').trim(),
    voiceHint: String(payload.voiceHint || '').trim(),
    audio,
    subtitles,
    characterEnabled: !!payload.characterEnabled,
    characterImage: String(payload.characterImage || '').trim(),
    characterName: String(payload.characterName || '').trim(),
    characterAge: String(payload.characterAge || '').trim(),
    characterGender: String(payload.characterGender || '').trim(),
    characterRole: String(payload.characterRole || '').trim(),
    characterPersonality: String(payload.characterPersonality || '').trim(),
    characterAppearance: String(payload.characterAppearance || '').trim(),
    characterHairStyle: String(payload.characterHairStyle || '').trim(),
    characterHairColor: String(payload.characterHairColor || '').trim(),
    characterClothing: String(payload.characterClothing || '').trim(),
    videoStyle: String(payload.videoStyle || '').trim(),
    preserveIdentity: payload.preserveIdentity !== false,
    characterUsage: String(payload.characterUsage || 'Main Character in all scenes').trim(),
    characterConsistencyStrength: String(payload.characterConsistencyStrength || 'Strict').trim()
  };
}

function createJobContext({ baseUrl, providedJobId = null, input = {} }) {
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
      if (path.resolve(localGeneratedMediaPath) === path.resolve(destinationPath)) {
        const stat = await fs.promises.stat(destinationPath);
        if (!stat.size) throw new Error('Generated media file is empty');
        return { mimeType: '' };
      }
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

  let characterContext = '';
  let extractedTraitsStr = '';
  if (input.characterEnabled && input.characterImage) {
    if (logger) logger("Extracting visual traits from character image...");
    try {
      const traits = await extractCharacterVisualTraits(input.characterImage);
      if (traits) {
        extractedTraitsStr = `\nEXTRACTED VISUAL TRAITS (MUST BE PRESERVED IN EVERY SCENE):\n- Hair Style: ${traits.hairStyle || 'N/A'}\n- Facial Hair: ${traits.facialHair || 'N/A'}\n- Clothing: ${traits.clothing || 'N/A'}\n- Ethnicity: ${traits.ethnicity || 'N/A'}\n- Age Appearance: ${traits.ageAppearance || 'N/A'}\n- Accessories: ${traits.accessories || 'none'}\n`;
        if (logger) logger("Traits successfully extracted and injected.");
      }
    } catch (err) {
      if (logger) logger(`Warning: Failed to extract character traits: ${err.message}`);
    }
  }
  if (input.characterEnabled) {
    const isStrict = input.characterConsistencyStrength === 'Strict';
    const mainInAll = input.characterUsage === 'Main Character In All Scenes';

    let strictRules = '';
    if (isStrict) {
      strictRules = `
STRICT CHARACTER RULES:
- Never change face.
- Never change hairstyle.
- Never change beard.
- Never change age.
- Never change body type.
- Never generate another person.
- Never remove the character from the scene.
- Maintain identical identity in every scene.
- Maintain identical identity in every generated image.
- Maintain identical identity in every generated video clip.`;
    }

    let usageRules = `\n- Character Usage Strategy: ${input.characterUsage}`;
    if (mainInAll) {
      usageRules += `
- The main character MUST appear visibly in every scene.
- Do not create: product-only shots, abstract graphics, UI screens, empty environments.
- The story must revolve around this character.`;
    } else {
      usageRules += '\n- IMPORTANT: Do not include the character in every scene. Mix character scenes with b-roll, establishing shots, and product closeups without people.';
    }

    characterContext = `
MAIN CHARACTER DETAILS:
- Name: ${input.characterName || 'N/A'}
- Age: ${input.characterAge || 'N/A'}
- Gender: ${input.characterGender || 'N/A'}
- Role: ${input.characterRole || 'N/A'}
- Personality: ${input.characterPersonality || 'N/A'}
- Appearance: ${input.characterAppearance || 'N/A'}
- Hair Style: ${input.characterHairStyle || 'N/A'}
- Hair Color: ${input.characterHairColor || 'N/A'}
- Clothing: ${input.characterClothing || 'N/A'}
- Reference Image Provided: ${input.characterImage ? 'Yes' : 'No'}
${extractedTraitsStr}
CRITICAL CHARACTER RULES:
- Use the exact same character identity across all scenes.
- Preserve exact identity.
- Maintain identical face structure, eyes, nose, hairstyle, skin tone, and body type.
- Do not generate different people in different scenes.
- If a reference image is provided, preserve facial identity exactly.
- Clothing and environment may change but the character identity must remain unchanged.
${strictRules}
${usageRules}`;
  }
  
  let videoStyleContext = '';
  if (input.videoStyle) {
    videoStyleContext = `\nVideo Style: ${input.videoStyle}`;
    if (input.videoStyle === 'Storytelling') {
      videoStyleContext += `
- The storyboard must follow a story progression: Beginning, Challenge, Learning, Growth, Achievement, Success.
- The same character must appear throughout the story.`;
    } else if (input.videoStyle === 'Cinematic Commercial') {
      videoStyleContext += `
- Use: cinematic camera movement, premium lighting, shallow depth of field, commercial composition, smooth transitions.`;
    } else if (input.videoStyle === 'Product Advertisement') {
      videoStyleContext += `
- Character becomes optional unless explicitly enabled.`;
    }
  }

  // "Award-winning Creative Director" storyboard prompt sourced from
  // Script & Scenes.docx, tweaked for dynamic tone/scene-count/duration
  // and forced to STRICT JSON so downstream image/video/TTS steps work.
  const brandToneFromProfile = Array.isArray(profile?.brandVoice)
    ? profile.brandVoice.join(', ')
    : String(profile?.brandVoice || profile?.tone || 'Emotional');
  const brandSummary = String(profile?.description || profile?.bio || profile?.about || '').trim();

  // Script & Scenes generation — mirrors Script & Scenes.docx block-for-block:
  // STORY (6 beats) + VOICEOVER (75-word narration, ElevenLabs-ready) + SCENE
  // BREAKDOWN (12 fields per scene). Generalized so it fits ANY brand tier
  // (food stall, gym, jewellery, corporate SaaS) — the docx's discipline is
  // preserved but the tone adapts to whatever brandTone is set on the profile.
  // Downstream Steps 4-8 still read the old fields (scriptLine, voiceLine,
  // imagePrompt, videoPrompt) which we backfill from the richer new ones.
  const systemPrompt = `You are an award-winning Creative Director and Film Director.
You have written commercials across every tier — cinematic luxury films for jewellery and premium brands, warm family stories for traditional shops, kinetic D2C reels, corporate confidence pieces, playful food & lifestyle content.

The creative concept has already been approved.
Your job is to convert it into a production-ready commercial SCRIPT + STORYBOARD that matches THIS brand's tone — not a one-size-fits-all luxury film.

═══════════════════════════════════════
BRAND DETAILS
Business Name: ${profile?.name || 'N/A'}
Industry: ${profile?.industry || 'N/A'}
Target Audience: ${profile?.targetAudience || 'General audience'}
Brand Tone: ${brandToneFromProfile}
Brand Summary: ${brandSummary || 'N/A'}
═══════════════════════════════════════
APPROVED CONCEPT
${input.description}
═══════════════════════════════════════
OBJECTIVE
Expand this concept into a commercial that emotionally connects with the audience BEFORE introducing the brand.
The audience should remember the feeling first, and the brand second.
Avoid direct selling. Avoid explaining the product. Show emotions instead of information.

TIER-ADAPTIVE VOICE (match the brand — do NOT force luxury polish on a casual brand):
- Premium / Luxury → cinematic restraint, poetic narration, slow reveal
- Traditional / Family → warm authenticity, everyday moments, honest voice
- Playful / D2C / Reel-first → kinetic energy, punchy lines, humor when fitting
- Corporate / SaaS / Professional → calm confidence, clarity, credibility
- Food / Lifestyle / Local → sensory, casual, close to the customer

═══════════════════════════════════════
Create the following in order — every text field MUST be elaborated (multi-sentence, production-ready), NEVER single-line placeholders.

## 1. STORY ARC (six beats)
Write each beat as 2-4 rich sentences. This is the shooting bible.
• hook — the first 3-5 seconds that earn attention (curiosity or emotional pull)
• beginning — how we enter the world of the story
• emotionalProgression — how feeling builds through the middle
• climax — the peak emotional moment
• brandReveal — how the brand appears naturally (never leading, never salesy)
• ending — the final image + line the viewer will remember

Constraints: Maximum duration ${input.durationSeconds} seconds. Maximum scenes ${sceneCount}. Every scene must flow naturally to the next.

## 2. VOICEOVER SCRIPT
Write the full narration as ONE continuous string, ready to paste into ElevenLabs.
This is SPOKEN language — not scene descriptions, not stage directions, not visual summaries.
The voiceover must add something the visuals cannot:
• A feeling the picture alone cannot deliver
• A thought that reframes what the viewer is seeing
• A memory or emotion the viewer connects to

STYLE
- Sounds like a real human speaking, not a narrator reading a script
- Rhythmic — sentences of varying length, natural pauses
- Concrete words, not marketing abstractions ("evening light" not "premium ambience")
- If Brand Tone is Luxury → poetic restraint; Traditional → warm honesty; Playful → punchy wit; Corporate → calm confidence

RULES
• Target ${Math.round(input.durationSeconds * 2)} words (±10%) for ${input.durationSeconds} seconds at natural pace
• Use \\n between sentences for natural spoken pauses — do NOT run everything into one paragraph
• DO NOT describe what the camera sees — the visual scene already shows it
• DO NOT paraphrase the visualDescription of each scene — that's a different job
• DO NOT mention the product unnecessarily
• End with a memorable brand line

CRITICAL: The voiceover MUST be distinct from the scene visualDescriptions. If your voiceover reads like a list of what's on screen ("A chair sways… tables join in… the room fills…"), you have failed. Rewrite it as something a real person would SAY that adds emotional meaning ON TOP of what the viewer already sees.

## 3. SCENE BREAKDOWN (per scene — every field required, all elaborated)
For every scene fill ALL 12 fields:
1. sceneNumber — 1, 2, 3…
2. title — a specific, story-driven title (NOT "Opening Hook" or "Scene 1")
3. purpose — 2-3 sentences on why this scene exists in the arc and what it must land emotionally
4. charactersRequired — array of character IDs from the approved cast (e.g. ["01", "02"]) or a plain-language list of who is on camera
5. location — specific location or set description (2-3 sentences)
6. visualDescription — 3-5 sentences of what the camera SEES: subjects, environment, lighting, mood, color palette, hero moment
7. emotion — the ONE dominant emotion of this scene (single phrase, e.g. "quiet nostalgia", "electric joy", "reverent stillness")
8. cameraAngle — specific angle (e.g. "low-angle hero shot", "over-the-shoulder", "eye-level close-up")
9. cameraMovement — specific movement (e.g. "slow dolly in", "handheld sway", "static hold with rack focus")
10. durationSeconds — integer seconds
11. scriptLine — the exact spoken narration line for THIS scene (from part 2's voiceover, split naturally)
12. transitionToNext — how this scene resolves into the next (e.g. "hard cut on the sound of…", "slow crossfade to…")

═══════════════════════════════════════
CREATIVE RULES (must all be true before you return)
✓ First 5 seconds create curiosity or emotional pull
✓ Every scene moves the story forward — cut any filler
✓ Every scene has ONE dominant emotion
✓ The product is never the hero — the story is
✓ Brand appears naturally near the end
✓ Ending feels memorable — the viewer replays it in their head
✓ Audience feels something BEFORE seeing the logo
✓ Tone matches this brand's actual tier — not a generic luxury film
Rewrite any scene that feels generic or filler before returning.
${videoStyleContext}${characterContext}
═══════════════════════════════════════
OUTPUT FORMAT — STRICT JSON ONLY (no markdown, no code fences, no prose outside JSON)
{
  "story": {
    "hook": "2-4 sentence hook description",
    "beginning": "2-4 sentence beginning",
    "emotionalProgression": "2-4 sentence middle build",
    "climax": "2-3 sentence climax",
    "brandReveal": "2-3 sentence brand reveal moment",
    "ending": "2-3 sentence ending"
  },
  "voiceScript": "The full narration as ONE string, using \\n for natural pauses between lines. Directly ElevenLabs-ready.",
  "globalVisualStyle": "One paragraph describing the cinematography direction that applies to every scene",
  "thumbnailPrompt": "One paragraph describing the strongest single frame for the thumbnail",
  "scenes": [
    {
      "sceneNumber": 1,
      "title": "specific story-driven title",
      "purpose": "2-3 sentence purpose",
      "charactersRequired": ["01", "02"],
      "location": "2-3 sentence location description",
      "visualDescription": "3-5 sentence detailed visual description",
      "emotion": "one dominant emotion phrase",
      "cameraAngle": "specific angle",
      "cameraMovement": "specific movement",
      "durationSeconds": 4,
      "scriptLine": "the exact line spoken in this scene",
      "onScreenText": "optional short caption or empty string",
      "transitionToNext": "how this scene ends and flows into the next",
      "voiceLine": "same as scriptLine — kept for backwards compat with downstream steps",
      "imagePrompt": "photoreal single-frame image prompt combining visualDescription + cameraAngle + character continuity + mood — used by the image generator",
      "videoPrompt": "motion-only spec (camera movement + character movement + environmental motion) — used by the video generator, do NOT repeat visualDescription"
    }
  ]
}

Priority Order (Highest → Lowest): Character Identity Rules, Character Reference Image, Character Usage Rules, Video Style Rules, Approved Concept, Brand Details, AI Creativity. Never violate a higher-priority rule to satisfy a lower one.
You MUST return exactly ${sceneCount} scenes.
Every scene must be suitable for 9:16 vertical video.

═══════════════════════════════════════
FIELD REQUIREMENTS — NON-NEGOTIABLE
Every scene object MUST contain ALL of these fields, elaborated to production quality. Omitting ANY of these will cause the response to be REJECTED and you will be asked to regenerate.

For each scene:
1. sceneNumber — integer
2. title — a specific, story-driven title (NOT "Opening Hook")
3. purpose — 2-3 sentences on why this scene exists in the arc
4. charactersRequired — array of character IDs (["01"], ["01","02"], or [] if none)
5. location — 1-2 sentences describing the specific place
6. visualDescription — 3-5 sentences describing what the camera sees (subjects, lighting, color, mood)
7. emotion — a 2-4 word phrase naming the ONE dominant feeling (e.g. "quiet reverence", "electric joy")
8. cameraAngle — e.g. "low-angle hero shot", "over-the-shoulder", "eye-level close-up"
9. cameraMovement — e.g. "slow dolly in", "handheld sway", "static hold with rack focus"
10. durationSeconds — integer
11. scriptLine — the exact spoken line for this scene (from the voiceover, split naturally)
12. onScreenText — a caption if any, or empty string ""
13. transitionToNext — 1 sentence on how this scene resolves into the next
14. imagePrompt — auto-derivable, still required as a rich sentence
15. videoPrompt — auto-derivable, still required as a motion-only sentence

CONCRETE EXAMPLE of a fully-filled scene (for reference only — do NOT copy the content, only the level of detail):
{
  "sceneNumber": 1,
  "title": "The Quiet Before Dawn",
  "purpose": "This scene opens the film with stillness so the viewer leans in. It plants the emotional key of memory that the rest of the arc will build on. Without curiosity here, no one stays for scene 2.",
  "charactersRequired": ["01"],
  "location": "An old wooden home interior at 5 AM, one lamp still on from the night before, a saree draped over the back of a chair.",
  "visualDescription": "A single warm lamp glows in a dim living room. Dust motes drift in its beam. A woman in her sixties sits half-facing the window, her hands folded in her lap. The palette is warm ochre, brown wood, and one thin sliver of pre-dawn blue from the window. Everything is very still.",
  "emotion": "quiet reverence",
  "cameraAngle": "low eye-level, framing her from the side",
  "cameraMovement": "slow 4-second dolly in from 3m to 1.5m",
  "durationSeconds": 4,
  "scriptLine": "There are moments before the world wakes up.",
  "onScreenText": "",
  "transitionToNext": "The lamp flickers off as morning light rises — a soft crossfade into scene 2.",
  "imagePrompt": "Cinematic still: 60-year-old South Indian woman in warm ochre living room, single lamp glow, dust motes in beam, low eye-level side framing, ochre and brown palette, sliver of pre-dawn blue from window, hyperreal skin detail, shallow depth of field, 35mm anamorphic look.",
  "videoPrompt": "Slow 4-second dolly-in from 3m to 1.5m. Subject remains still — only her breath and one blink. Lamp glow flickers once at the end signalling transition."
}

Every scene in your output must match THIS level of detail — no exceptions.
Do not include any text outside the JSON object.`;

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
    let validationError = '';
    let elaborationAttempts = 0;
    const raw = await runWithRetries(
      'scene generation',
      async () => {
        const callPrompt = `${systemPrompt}\n\n${userPrompt}${validationError ? '\n\nIMPORTANT CORRECTION REQUIRED: ' + validationError : ''}`;
        // Primary: OpenAI (gpt-4o) for the creative brain of the video.
        // Fallback: Gemini, so the pipeline still works if OpenAI errors out.
        // maxTokens 4500 (up from 2500) — the v2 Script + Scenes response
        // includes a 6-beat story arc, 75-word voiceover, and 12 fields
        // per scene with elaborated multi-sentence content. 2500 truncates.
        let result;
        try {
          result = await callOpenAI(callPrompt, {
            temperature: 0.7,
            maxTokens: 8000,
            timeout: 240000,
            jsonMode: true
          });
        } catch (openAiErr) {
          if (logger) logger(`OpenAI scene generation failed, falling back to Gemini: ${openAiErr.message || openAiErr}`);
          result = await callGemini(callPrompt, {
            skipCache: true,
            temperature: 0.65,
            maxTokens: 8000,
            timeout: 240000
          });
        }

        // Elaboration guard — reject responses where ANY required scene
        // field is empty or too short. Common failure: OpenAI returns
        // only title + scriptLine + duration and skips emotion / camera
        // angle / location / etc. We force a retry until every field is
        // filled and elaborated to production quality.
        try {
          const previewParsed = parseGeminiJSON(result);
          const previewScenes = Array.isArray(previewParsed?.scenes) ? previewParsed.scenes : [];

          // Enumerate every scene field that MUST be non-trivially populated.
          // Numbers = minimum char length (single word = weak, sentence = ok).
          const required = {
            purpose: 40,
            location: 15,
            visualDescription: 60,
            emotion: 5,
            cameraAngle: 5,
            cameraMovement: 5,
            transitionToNext: 8,
            scriptLine: 5,
          };
          const thinScenes = previewScenes
            .map((s, i) => {
              const missing = Object.entries(required)
                .filter(([k, min]) => String(s?.[k] || '').trim().length < min)
                .map(([k]) => k);
              return missing.length ? { i: i + 1, missing } : null;
            })
            .filter(Boolean);

          const rawStory = previewParsed?.story || {};
          const storyBeats = ['hook', 'beginning', 'emotionalProgression', 'climax', 'brandReveal', 'ending'];
          const thinStoryBeats = storyBeats.filter((b) => String(rawStory[b] || '').trim().length < 40);

          const voiceScript = String(previewParsed?.voiceScript || '').trim();
          const voiceWordCount = voiceScript.split(/\s+/).filter(Boolean).length;
          const voiceTooShort = voiceWordCount < 20;

          // Diagnostic — print what fields the model actually returned for
          // each scene so we can tell if OpenAI is skipping fields or if
          // downstream normalization is dropping them.
          const rawFieldReport = previewScenes.map((s, i) => {
            const keys = ['emotion', 'cameraAngle', 'cameraMovement', 'purpose', 'location', 'visualDescription', 'transitionToNext', 'scriptLine', 'onScreenText'];
            const fill = keys.map((k) => `${k}=${String(s?.[k] || '').length}`).join(' ');
            return `  scene ${i + 1}: ${fill}`;
          }).join('\n');
          console.log('[scene-gen] Raw AI response — field lengths per scene:\n' + rawFieldReport);
          console.log('[scene-gen] voiceScript wc=' + voiceWordCount + ' story present=' + Boolean(previewParsed?.story));

          // Detect the "voiceover just re-lists visualDescriptions" bug —
          // if MORE than half of the voiceover's meaningful words are
          // literally copied from scene visualDescriptions, it's not a
          // proper voice-over, it's a scene summary. Force a rewrite.
          const stripStopWords = (s) => String(s || '')
            .toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/)
            .filter((w) => w.length > 3);
          const visualWords = new Set(previewScenes.flatMap((s) => stripStopWords(s?.visualDescription)));
          const vOverlapWords = stripStopWords(voiceScript).filter((w) => visualWords.has(w));
          const overlapRatio = voiceWordCount > 0 ? (vOverlapWords.length / voiceWordCount) : 0;
          const voiceIsRehash = voiceWordCount > 15 && overlapRatio > 0.55;

          // Allow up to 2 elaboration retries (in addition to the outer
          // runWithRetries) — this specific failure mode (thin scenes)
          // needs an explicit rejection loop, not a single one-shot.
          const needsRetry = (thinScenes.length > 0 || thinStoryBeats.length > 0 || voiceTooShort || voiceIsRehash)
            && elaborationAttempts < 2;

          if (needsRetry) {
            elaborationAttempts += 1;
            const msg = `Elaboration retry #${elaborationAttempts} — thinScenes=${thinScenes.length}, thinStory=${thinStoryBeats.length}, voiceShort=${voiceTooShort}, voiceRehash=${voiceIsRehash}`;
            console.log('[scene-gen]', msg);
            if (logger) logger(msg);
            const parts = [];
            if (thinScenes.length) {
              parts.push('These scenes are missing / too-thin fields: ' +
                thinScenes.map((t) => `Scene ${t.i} → [${t.missing.join(', ')}]`).join('; '));
            }
            if (thinStoryBeats.length) {
              parts.push('Story beats too thin: ' + thinStoryBeats.join(', '));
            }
            if (voiceTooShort) {
              parts.push('voiceScript is empty or too short — write the full narration in ONE continuous string of ~' + Math.round(input.durationSeconds * 2) + ' words.');
            }
            if (voiceIsRehash) {
              parts.push('voiceScript is just paraphrasing the scene visualDescriptions — REWRITE it as spoken emotional language that ADDS meaning ON TOP of what viewers already see (a feeling, a memory, a reframing). Use fresh words, not the same words as the visual descriptions.');
            }
            validationError = 'ELABORATE MORE — you MUST fill EVERY field with production-ready detail. ' +
              parts.join(' | ') +
              '. Regenerate the ENTIRE JSON with EVERY field populated per the schema. Do NOT leave any field empty or as a single word placeholder.';
            throw new Error(validationError);
          }
        } catch (elabErr) {
          if (String(elabErr?.message || '').includes('ELABORATE')) throw elabErr;
          // parse errors fall through to the outer validation
        }
        
        // Validation Layer
        if (input.characterEnabled && input.characterUsage === 'Main Character In All Scenes') {
          const parsed = parseGeminiJSON(result);
          const scenes = Array.isArray(parsed?.scenes) ? parsed.scenes : [];
          const charRef = (input.characterName || '').toLowerCase();
          for (let i = 0; i < scenes.length; i++) {
            const content = `${scenes[i].title || ''} ${scenes[i].imagePrompt || ''} ${scenes[i].videoPrompt || ''}`.toLowerCase();
            const hasChar = (charRef && content.includes(charRef)) || content.includes('character') || content.includes('person') || content.includes('man') || content.includes('woman') || content.includes('boy') || content.includes('girl');
            
            const isAbstract = content.includes('abstract') || content.includes('floating ui') || content.includes('tablet closeup') || content.includes('close-up of tablet') || content.includes('close-up of phone') || content.includes('product-only');

            if (!hasChar || isAbstract) {
              validationError = `Validation failed: Scene ${i + 1} does not clearly contain the main character, or is an abstract/product-only shot. If "Main Character In All Scenes" is true, EVERY scene must explicitly mention the character (e.g. use the character's name) and cannot be a floating UI or abstract shot. Regenerate the storyboard.`;
              throw new Error(validationError);
            }
          }
        }
        return result;
      },
      5,
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

      // scriptLine is the primary user-facing field for this step; fall
      // back to voiceLine (older format) so nothing breaks mid-migration.
      const scriptLine = String(source?.scriptLine || source?.voiceLine || source?.onScreenText || fallbackScenes[index]?.voiceLine || '').trim();
      // Elaborated visualDescription — new v2 field. If the model doesn't
      // return it, backfill from imagePrompt so downstream image gen still
      // has substance to work with.
      const visualDescription = String(source?.visualDescription || source?.imagePrompt || fallbackScenes[index]?.imagePrompt || input.description).trim();
      // If the model returned only visualDescription (rich) but no
      // imagePrompt, synthesize an imagePrompt from the rich fields so
      // downstream Nano Banana still receives a proper prompt.
      const synthesizedImagePrompt = String(
        source?.imagePrompt ||
        [visualDescription, source?.cameraAngle, source?.cameraMovement, source?.emotion, plan?.globalVisualStyle]
          .filter(Boolean).join(' | ')
      ).trim();
      return {
        index: index + 1,
        sceneId: `scene_${index + 1}`,
        // Legacy fields (needed by downstream Steps 4-8):
        title: String(source?.title || `Scene ${index + 1}`).trim(),
        durationSeconds: Number(source?.durationSeconds) || duration,
        startSec,
        endSec,
        imagePrompt: synthesizedImagePrompt || input.description,
        videoPrompt: String(source?.videoPrompt || fallbackScenes[index]?.videoPrompt || input.description).trim(),
        scriptLine,
        voiceLine: scriptLine,
        onScreenText: String(source?.onScreenText || '').trim(),
        // New v2 fields (Script & Scenes.docx SCENE BREAKDOWN):
        sceneNumber: Number(source?.sceneNumber) || (index + 1),
        purpose: String(source?.purpose || '').trim(),
        charactersRequired: Array.isArray(source?.charactersRequired)
          ? source.charactersRequired.map((c) => String(c || '').trim()).filter(Boolean)
          : (typeof source?.charactersRequired === 'string' ? [source.charactersRequired] : []),
        location: String(source?.location || '').trim(),
        visualDescription,
        emotion: String(source?.emotion || '').trim(),
        cameraAngle: String(source?.cameraAngle || '').trim(),
        cameraMovement: String(source?.cameraMovement || '').trim(),
        transitionToNext: String(source?.transitionToNext || '').trim()
      };
    });

    const voiceScript = String(parsed?.voiceScript || '').trim()
      || normalizedScenes.map((scene) => scene.voiceLine).filter(Boolean).join(' ');
    const thumbnailPrompt = String(parsed?.thumbnailPrompt || '').trim()
      || `${input.description}. Create an attention-grabbing vertical-video thumbnail.`;
    const globalVisualStyle = String(parsed?.globalVisualStyle || '').trim()
      || 'Cinematic product-focused vertical ad, crisp details, stable motion, cohesive color palette, consistent lighting.';

    // Normalize the STORY arc block from the docx v2 schema. Every beat
    // gets a safe empty-string default so the frontend can render 6 cards
    // without null checks. Fall back to an empty story object if the
    // model omits it entirely (fallback path uses the raw description).
    const rawStory = parsed?.story && typeof parsed.story === 'object' ? parsed.story : {};
    const story = {
      hook: String(rawStory.hook || '').trim(),
      beginning: String(rawStory.beginning || '').trim(),
      emotionalProgression: String(rawStory.emotionalProgression || rawStory.progression || '').trim(),
      climax: String(rawStory.climax || '').trim(),
      brandReveal: String(rawStory.brandReveal || rawStory.reveal || '').trim(),
      ending: String(rawStory.ending || '').trim()
    };

    return {
      sceneCount: effectiveSceneCount,
      totalDurationSeconds: input.durationSeconds,
      globalVisualStyle,
      thumbnailPrompt,
      voiceScript,
      story,
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
      story: {
        hook: '', beginning: '', emotionalProgression: '',
        climax: '', brandReveal: '', ending: ''
      },
      scenes: fallbackScenes
    };
  }
}

// ============================================================
// Sequential scene generation (v3) — split the big Script + Scenes
// request into (a) skeleton and (b) per-scene enrichment so the model
// never has to fit 10 rich scenes into one response. This lets us:
//   1. Return story + voiceover + scene titles fast (~5-10s)
//   2. Stream individual richly-detailed scenes back as they finish
//   3. Never lose fields to token truncation — each scene gets its
//      own ~2000-token budget instead of sharing 4500 with 9 others.
// ============================================================

async function generateStoryAndSkeleton({ input, product, user, characters = [], castImageUrl = '', logger = null }) {
  const profile = user?.businessProfile || {};
  const sceneCount = estimateSceneCount(input.durationSeconds, input.sceneCount);
  const brandToneFromProfile = Array.isArray(profile?.brandVoice)
    ? profile.brandVoice.join(', ')
    : String(profile?.brandVoice || profile?.tone || 'Emotional');
  const brandSummary = String(profile?.description || profile?.bio || profile?.about || '').trim();
  const durations = splitDurations(input.durationSeconds, sceneCount);
  // Target language for the voiceover script. Written directly in the
  // target language (not translated after the fact) so idioms, syntax,
  // and cadence feel native. Story arc + globalVisualStyle stay in
  // English for downstream image-prompt engineering.
  const targetLangCode = String(input.languageCode || 'en').toLowerCase();
  const targetLangLabel = ttsLanguageLabel(targetLangCode);
  const targetScript = targetScriptName(targetLangCode);
  const voiceLanguageDirective = targetLangCode === 'en'
    ? 'Write voiceScript in natural conversational English.'
    : `Write voiceScript DIRECTLY in ${targetLangLabel} using ${targetScript} script — do NOT write in English then translate. Use natural spoken ${targetLangLabel} idioms and rhythm as a native speaker would. Story arc + globalVisualStyle stay in English (they are production notes, not spoken).`;

  // Environment definition (Step 3 of the wizard). When enabled, the
  // user has told us EXACTLY which physical space this whole video
  // takes place in — their shop, showroom, storefront, workshop, etc.
  // Every scene must happen inside/around that space; the storyboard
  // planner should NOT invent a fresh location for each scene.
  const envEnabled = input.environment?.enabled && Array.isArray(input.environment?.referenceImages) && input.environment.referenceImages.length > 0;
  const envNotes = String(input.environment?.notes || '').trim();
  const environmentDirective = envEnabled
    ? `\n\nENVIRONMENT LOCK (MANDATORY):
The user has locked this entire video to ONE physical space. Reference images of this space are attached to the image-gen call (you don't need to describe them from imagination — the artist will see them). Your job is only to write scenes that HAPPEN IN this space.
${envNotes ? `User notes about the space: ${envNotes}` : ''}
Rules:
- Every scene's \`location\` field must describe a SPECIFIC angle / part of this same space (front counter, back workshop area, storefront window, aisle 3, delivery bay, workshop bench, dining floor near the window, etc.) — NOT a different building or fictional venue.
- Do NOT invent locations that don't belong to this space (no "on a beach", "in a park", "in a lab", unless the user's notes explicitly say so).
- Different scenes can show different corners / angles / times of day WITHIN the same space, but the walls, flooring, lighting fixtures, brand palette, and overall material vocabulary must stay consistent scene-to-scene.
- Wardrobe of characters can be adjusted to fit the space's dress code.`
    : '';

  // ---- CHARACTER BIBLE (from Step 2 accepted cast) ----
  // Injected into the prompt so the storyboard planner MUST route scenes
  // through these specific characters, referencing them by their 01/02/03
  // IDs. Prevents the "no characters in scene" problem.
  const characterBibleBlock = Array.isArray(characters) && characters.length > 0
    ? `\n\nAPPROVED CHARACTER CAST (${characters.length} character${characters.length > 1 ? 's' : ''} — reference by ID in every scene):\n${characters.map((c) => `  ${c.id || '01'} · ${c.name || 'Unnamed'} (${c.age || '?'}, ${c.gender || '?'}) — Role: ${c.role || 'n/a'}. ${c.appearance || ''} Wearing: ${c.clothing || 'n/a'}.`).join('\n')}

CAST USAGE RULES (be intentional — characters must EARN their place in each scene):
- charactersRequired is an ARRAY. Choose based on what the SCENE genuinely needs, not by any default rule.
- USE characters when the scene needs a human presence to carry the emotion, gesture, or story beat. Cast the right people:
    * A solo intimate moment → 1 character
    * A conversation, exchange, gift-giving → 2 characters
    * A family / group / celebration moment → the full relevant subset (3+ if it fits)
- DO NOT add a character just because they exist in the cast. Only include IDs the scene actually shows.
- USE an EMPTY array [] when the scene is legitimately character-less:
    * Product close-ups (hero product shot, texture reveal)
    * Atmospheric / environmental shots (an empty room, a sunlit doorway, a still-life setup)
    * Abstract cutaways (macro texture, light play, symbolic imagery)
    * Brand logo reveal (unless the character is present in-frame with the logo)
- Do NOT invent new people — use ONLY IDs from the cast above.
- Cast the visualDescription honestly: if you write "she walks through the room", her ID must be in charactersRequired. If you write "sunlight falls across the table", charactersRequired can be empty.`
    : '\n\n(No approved character cast — write character-agnostic scenes.)';

  const prompt = `You are an award-winning Creative Director and Film Director.
Build the STORY ARC + VOICEOVER + SCENE SKELETON for this brand's commercial.
Individual scenes will be elaborated in follow-up calls — for now you only need to plan the shape.

BRAND DETAILS
Business Name: ${profile?.name || 'N/A'}
Industry: ${profile?.industry || 'N/A'}
Target Audience: ${profile?.targetAudience || 'General audience'}
Brand Tone: ${brandToneFromProfile}
Brand Summary: ${brandSummary || 'N/A'}

APPROVED CONCEPT
${input.description}
${characterBibleBlock}

VIDEO SPEC
Total duration: ${input.durationSeconds} seconds
Scene count: ${sceneCount}
Suggested per-scene durations (seconds): [${durations.join(', ')}]

VOICEOVER LANGUAGE — MANDATORY
${voiceLanguageDirective}
${environmentDirective}

OUTPUT FORMAT — STRICT JSON ONLY:
{
  "story": {
    "hook": "2-4 sentence hook — first 3-5 seconds",
    "beginning": "2-4 sentences",
    "emotionalProgression": "2-4 sentences",
    "climax": "2-3 sentences",
    "brandReveal": "2-3 sentences",
    "ending": "2-3 sentences"
  },
  "voiceScript": "Full narration as ONE string, ~${Math.round(input.durationSeconds * 2)} words, \\n between spoken sentences. Written DIRECTLY in ${targetLangLabel} (${targetScript} script) — not English. This is SPOKEN language — feelings and thoughts, not scene descriptions.",
  "globalVisualStyle": "One paragraph on the cinematography direction that applies to every scene",
  "thumbnailPrompt": "One paragraph on the strongest single frame for the thumbnail",
  "scenes": [
    {
      "sceneNumber": 1,
      "title": "Specific, story-driven scene title (NOT 'Opening Hook')",
      "durationSeconds": ${durations[0] || 3},
      "purpose": "2-3 sentences on why this scene exists in the arc",
      "charactersRequired": ["01"]              // solo intimate moment
    },
    {
      "sceneNumber": 2,
      "title": "...",
      "durationSeconds": ${durations[1] || 3},
      "purpose": "...",
      "charactersRequired": []                  // atmospheric / product shot, no humans
    },
    {
      "sceneNumber": 3,
      "title": "...",
      "durationSeconds": ${durations[2] || 3},
      "purpose": "...",
      "charactersRequired": ${characters && characters.length >= 2 ? JSON.stringify(characters.slice(0, 2).map((c) => c.id)) : '["01"]'}   // conversation between two
    }
    // ... continue for all ${sceneCount} scenes. Vary casting BY WHAT THE SCENE NEEDS.
    // Empty array [] is fine and often right for product / environment / atmospheric shots.
    // Multi-character arrays are right when the story beat is inherently social.
  ]
}

Rules:
- Match the brand tone (${brandToneFromProfile}) — do NOT default to poetic luxury unless the tone is Luxury.
- Voiceover must NOT paraphrase the visual descriptions — it should add emotional meaning ON TOP of what the viewer will see.
- Scene titles must be specific and story-driven, not generic.
- Return exactly ${sceneCount} scenes.
- charactersRequired in each scene must reference character IDs from the APPROVED CHARACTER CAST above (or empty [] if the scene has no people).`;

  let raw;
  try {
    raw = await callOpenAI(prompt, {
      temperature: 0.7,
      maxTokens: 3500,
      timeout: 120000,
      jsonMode: true
    });
  } catch (err) {
    if (logger) logger(`OpenAI story+skeleton failed, falling back to Gemini: ${err.message || err}`);
    raw = await callGemini(prompt, { skipCache: true, temperature: 0.65, maxTokens: 3500, timeout: 120000 });
  }

  const parsed = parseGeminiJSON(raw) || {};
  const rawStory = parsed?.story && typeof parsed.story === 'object' ? parsed.story : {};
  const story = {
    hook: String(rawStory.hook || '').trim(),
    beginning: String(rawStory.beginning || '').trim(),
    emotionalProgression: String(rawStory.emotionalProgression || rawStory.progression || '').trim(),
    climax: String(rawStory.climax || '').trim(),
    brandReveal: String(rawStory.brandReveal || rawStory.reveal || '').trim(),
    ending: String(rawStory.ending || '').trim()
  };
  const rawScenes = Array.isArray(parsed?.scenes) ? parsed.scenes : [];
  const skeleton = Array.from({ length: sceneCount }, (_, i) => {
    const src = rawScenes[i] || {};
    return {
      sceneNumber: Number(src.sceneNumber) || (i + 1),
      sceneId: `scene_${i + 1}`,
      index: i + 1,
      title: String(src.title || `Scene ${i + 1}`).trim(),
      durationSeconds: Number(src.durationSeconds) || durations[i] || 3,
      purpose: String(src.purpose || '').trim(),
      // Preserve character routing decided at skeleton time so the
      // per-scene call knows which cast members appear.
      charactersRequired: Array.isArray(src.charactersRequired)
        ? src.charactersRequired.map((c) => String(c).trim()).filter(Boolean)
        : [],
      location: '', visualDescription: '',
      emotion: '', cameraAngle: '', cameraMovement: '',
      scriptLine: '', voiceLine: '', onScreenText: '', transitionToNext: '',
      imagePrompt: '', videoPrompt: ''
    };
  });
  return {
    story,
    voiceScript: String(parsed?.voiceScript || '').trim(),
    globalVisualStyle: String(parsed?.globalVisualStyle || '').trim()
      || 'Cinematic product-focused vertical ad, crisp details, stable motion, cohesive color palette.',
    thumbnailPrompt: String(parsed?.thumbnailPrompt || '').trim()
      || `${input.description}. Create an attention-grabbing vertical-video thumbnail.`,
    scenes: skeleton,
    sceneCount,
    totalDurationSeconds: input.durationSeconds
  };
}

async function generateSingleScene({ input, product, user, story, voiceScript, globalVisualStyle, scenesSoFar, currentSceneSkeleton, characters = [], castImageUrl = '', logger = null }) {
  // Env lock — same as generateStoryAndSkeleton. When enabled, every
  // scene must happen IN the user's locked physical space.
  const _envEnabled = input.environment?.enabled && Array.isArray(input.environment?.referenceImages) && input.environment.referenceImages.length > 0;
  const _envNotes = String(input.environment?.notes || '').trim();
  const environmentDirective = _envEnabled
    ? `\n\nENVIRONMENT LOCK: This scene MUST happen inside/around the user's locked space (reference images are attached to the image-gen call). ${_envNotes ? 'User notes: ' + _envNotes : ''} location field must describe a SPECIFIC angle / part of that space, not a different building. Walls, flooring, lighting fixtures, and material vocabulary must stay consistent with earlier scenes.`
    : '';
  const profile = user?.businessProfile || {};
  const brandToneFromProfile = Array.isArray(profile?.brandVoice)
    ? profile.brandVoice.join(', ')
    : String(profile?.brandVoice || profile?.tone || 'Emotional');

  const previousScenesSummary = (scenesSoFar || [])
    .map((s, i) => `Scene ${i + 1} "${s.title}" [${s.emotion || '—'}] chars=${JSON.stringify(s.charactersRequired || [])}: ${String(s.visualDescription || '').slice(0, 200)}`)
    .join('\n');

  // Character bible for this specific scene. If skeleton pre-assigned
  // charactersRequired, filter to just those; otherwise show all.
  const assignedIds = Array.isArray(currentSceneSkeleton.charactersRequired) && currentSceneSkeleton.charactersRequired.length
    ? currentSceneSkeleton.charactersRequired.map(String)
    : [];
  const relevantChars = assignedIds.length
    ? (characters || []).filter((c) => assignedIds.includes(String(c.id)))
    : (characters || []);
  const characterBibleBlock = relevantChars.length > 0
    ? `\n\nCHARACTERS APPEARING IN THIS SCENE (render them EXACTLY as described — same faces / builds / clothing across the whole video):\n${relevantChars.map((c) => `  ${c.id} · ${c.name} · ${c.age}, ${c.gender} · Role: ${c.role}. Appearance: ${c.appearance || 'n/a'}. Hair: ${c.hairStyle || 'n/a'} ${c.hairColor || ''}. Clothing: ${c.clothing || 'n/a'}.`).join('\n')}${castImageUrl ? '\n\nMaster cast reference image (all characters together, use for identity anchor): ' + castImageUrl : ''}`
    : (characters && characters.length > 0
      ? '\n\n(No specific characters assigned to this scene by the storyboard planner — you may leave charactersRequired empty if this scene shows no human subjects.)'
      : '\n\n(No approved cast — write a character-agnostic scene.)');

  const prompt = `You are elaborating ONE scene of an already-planned commercial into full production detail.

BRAND
Business: ${profile?.name || 'N/A'} · ${profile?.industry || 'N/A'} · Tone: ${brandToneFromProfile}

APPROVED STORY ARC
Hook: ${story?.hook || ''}
Beginning: ${story?.beginning || ''}
Emotional Progression: ${story?.emotionalProgression || ''}
Climax: ${story?.climax || ''}
Brand Reveal: ${story?.brandReveal || ''}
Ending: ${story?.ending || ''}

FULL VOICEOVER (already written)
${voiceScript || '(none)'}

GLOBAL VISUAL STYLE
${globalVisualStyle || 'Cinematic vertical commercial'}
${characterBibleBlock}

${previousScenesSummary ? 'PREVIOUS SCENES (already elaborated — keep continuity):\n' + previousScenesSummary : 'This is the first scene.'}

THIS SCENE TO ELABORATE
Scene ${currentSceneSkeleton.sceneNumber}: "${currentSceneSkeleton.title}"
Duration: ${currentSceneSkeleton.durationSeconds}s
Purpose: ${currentSceneSkeleton.purpose}
Skeleton charactersRequired: ${JSON.stringify(currentSceneSkeleton.charactersRequired || [])}
${environmentDirective}

FILL EVERY FIELD BELOW. Do NOT skip any. Return STRICT JSON only:
{
  "sceneNumber": ${currentSceneSkeleton.sceneNumber},
  "title": "${currentSceneSkeleton.title}",
  "durationSeconds": ${currentSceneSkeleton.durationSeconds},
  "purpose": "2-3 elaborated sentences on why this scene exists",
  "charactersRequired": ["01"],
  "location": "1-2 sentence specific location / set description",
  "visualDescription": "3-5 sentences on what the camera SEES — MUST name the specific character(s) present by name and role (from the CHARACTERS APPEARING block above), what they are doing, how they look, the lighting, palette, mood.",
  "emotion": "2-4 word phrase for the ONE dominant feeling (e.g. 'quiet reverence')",
  "cameraAngle": "specific angle (e.g. 'low-angle hero shot', 'eye-level close-up')",
  "cameraMovement": "specific movement (e.g. 'slow dolly in', 'handheld sway', 'static hold')",
  "scriptLine": "the exact spoken narration line for THIS scene (drawn from the full voiceover above, split naturally)",
  "onScreenText": "optional short caption or empty string",
  "transitionToNext": "1 sentence on how this scene resolves into the next",
  "imagePrompt": "Photoreal single-frame image prompt for Nano Banana. START with 'Use uploaded reference image as primary reference for character faces.' then describe the scene combining visualDescription + cameraAngle + specific character names/ages/wardrobe from the bible above + mood. The characters MUST look identical to the master cast reference.",
  "videoPrompt": "Motion-only spec (camera movement + character movement + environmental motion). Do NOT repeat imagePrompt visuals."
}

Every field required. No empty strings except onScreenText.
charactersRequired MUST match the skeleton exactly (${JSON.stringify(currentSceneSkeleton.charactersRequired || [])}) — do NOT drop any, do NOT invent new IDs, do NOT add characters the skeleton didn't include.
${(currentSceneSkeleton.charactersRequired || []).length > 1
  ? 'The skeleton assigned MULTIPLE characters — visualDescription MUST show ALL of them in-frame interacting, not just one.'
  : (currentSceneSkeleton.charactersRequired || []).length === 1
    ? 'The skeleton assigned ONE character — write a solo/intimate scene for them.'
    : 'The skeleton assigned NO characters — this is a legitimate character-less scene (product, environment, atmospheric). Do NOT force any human into visualDescription. Focus on objects, light, texture, mood.'}`;

  let raw;
  try {
    raw = await callOpenAI(prompt, {
      temperature: 0.7,
      maxTokens: 2000,
      timeout: 90000,
      jsonMode: true
    });
  } catch (err) {
    if (logger) logger(`OpenAI single-scene failed, falling back to Gemini: ${err.message || err}`);
    raw = await callGemini(prompt, { skipCache: true, temperature: 0.7, maxTokens: 2000, timeout: 90000 });
  }
  const parsed = parseGeminiJSON(raw) || {};
  const scriptLine = String(parsed.scriptLine || parsed.voiceLine || currentSceneSkeleton.scriptLine || '').trim();
  const visualDescription = String(parsed.visualDescription || parsed.imagePrompt || '').trim();
  const enriched = {
    ...currentSceneSkeleton,
    sceneNumber: Number(parsed.sceneNumber) || currentSceneSkeleton.sceneNumber,
    title: String(parsed.title || currentSceneSkeleton.title).trim(),
    durationSeconds: Number(parsed.durationSeconds) || currentSceneSkeleton.durationSeconds,
    purpose: String(parsed.purpose || currentSceneSkeleton.purpose || '').trim(),
    charactersRequired: Array.isArray(parsed.charactersRequired)
      ? parsed.charactersRequired.map((c) => String(c || '').trim()).filter(Boolean)
      : [],
    location: String(parsed.location || '').trim(),
    visualDescription,
    emotion: String(parsed.emotion || '').trim(),
    cameraAngle: String(parsed.cameraAngle || '').trim(),
    cameraMovement: String(parsed.cameraMovement || '').trim(),
    scriptLine,
    voiceLine: scriptLine,
    onScreenText: String(parsed.onScreenText || '').trim(),
    transitionToNext: String(parsed.transitionToNext || '').trim(),
    imagePrompt: String(parsed.imagePrompt || [visualDescription, parsed.cameraAngle, parsed.emotion, globalVisualStyle].filter(Boolean).join(' | ')).trim(),
    videoPrompt: String(parsed.videoPrompt || parsed.cameraMovement || 'natural motion').trim()
  };
  return enriched;
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

// Enrich each scene's imagePrompt using the "Image Prompts.docx" spec.
// Runs before the Nano Banana image gen loop so every scene gets a
// production-ready cinematic prompt (character IDs, camera, lens,
// lighting, composition, environment, product placement, mood).
async function enrichImagePromptsWithLLM({ scenes, plan, input, product, profile, referenceImageSource, logger }) {
  if (!Array.isArray(scenes) || scenes.length === 0) return scenes;

  const referenceClause = referenceImageSource
    ? 'A reference image is provided. EVERY scene prompt MUST begin with the line: "Use uploaded reference image as primary reference." on its own line, then continue with the rest of the prompt.'
    : 'No reference image is provided.';

  const characterBlock = input.characterEnabled
    ? `CHARACTERS (use these identities consistently across every scene):
- Name: ${input.characterName || 'Lead Character'}
- Age: ${input.characterAge || 'N/A'}
- Gender: ${input.characterGender || 'N/A'}
- Appearance: ${input.characterAppearance || 'N/A'}
- Hair: ${input.characterHairStyle || 'N/A'} / ${input.characterHairColor || 'N/A'}
- Clothing: ${input.characterClothing || 'N/A'}
- Consistency Strength: ${input.characterConsistencyStrength || 'Loose'}`
    : 'No fixed character — write character-agnostic prompts unless the storyboard names someone.';

  const brandToneFromProfile = Array.isArray(profile?.brandVoice)
    ? profile.brandVoice.join(', ')
    : String(profile?.brandVoice || profile?.tone || 'Cinematic');

  const systemPrompt = `You are an Expert AI Image Prompt Engineer for premium commercial ad production.
Using the approved storyboard below, create one premium AI image prompt for every scene.

Each prompt MUST include, in a natural single-paragraph form:
• Character reference IDs (use the same character name across all scenes)
• Character actions
• Facial expressions
• Camera angle (e.g. low angle, over-the-shoulder, close-up, wide establishing shot)
• Lens suggestion (e.g. 35mm, 50mm, 85mm, macro)
• Lighting (e.g. golden hour, softbox, rim light, chiaroscuro)
• Composition (rule of thirds, symmetry, negative space, leading lines)
• Environment
• Product placement (if applicable)
• Cinematic style
• Mood / dominant emotion

Rules:
- Photorealistic, cinematic, commercial quality, production-ready.
- Optimized for GPT Images / Nano Banana / Flux.
- Maintain the same characters, color palette, location logic, and visual style consistency across every scene.
- Do NOT describe motion — this is a still image prompt.
- Do NOT generate images. Only generate production-ready prompts.
- ${referenceClause}

BRAND CONTEXT
- Business: ${profile?.name || 'N/A'}
- Industry: ${profile?.industry || 'N/A'}
- Target Audience: ${profile?.targetAudience || 'General audience'}
- Brand Tone: ${brandToneFromProfile}

${characterBlock}

GLOBAL VISUAL STYLE (must be consistent across all scenes):
${plan?.globalVisualStyle || 'Premium cinematic vertical ad style with consistent lighting and color palette.'}

STORYBOARD SCENES (source material):
${scenes.map((s, i) => `Scene ${i + 1} — id: ${s.sceneId}
  Title: ${s.title || ''}
  Existing imagePrompt: ${s.imagePrompt || ''}
  Voice line: ${s.voiceLine || ''}`).join('\n\n')}

OUTPUT FORMAT — STRICT JSON ONLY
Return ONLY a valid JSON object with this exact schema:
{
  "scenes": [
    { "sceneId": "scene_1", "imagePrompt": "single paragraph string covering all 11 required elements" }
  ]
}
- Return exactly ${scenes.length} scenes in the same sceneId order as above.
- No markdown, no code fences, no text outside the JSON.`;

  try {
    let raw;
    try {
      raw = await callOpenAI(systemPrompt, {
        temperature: 0.6,
        maxTokens: 3000,
        timeout: 120000,
        jsonMode: true
      });
    } catch (openAiErr) {
      if (logger) logger(`OpenAI image-prompt enrichment failed, falling back to Gemini: ${openAiErr.message || openAiErr}`);
      raw = await callGemini(systemPrompt, {
        skipCache: true,
        temperature: 0.6,
        maxTokens: 3000,
        timeout: 120000
      });
    }
    const parsed = parseGeminiJSON(raw);
    const enriched = Array.isArray(parsed?.scenes) ? parsed.scenes : [];
    if (!enriched.length) return scenes;
    const byId = new Map(enriched.map((s) => [String(s?.sceneId || '').trim(), String(s?.imagePrompt || '').trim()]));
    return scenes.map((s) => {
      const better = byId.get(String(s.sceneId).trim());
      return better ? { ...s, imagePrompt: better } : s;
    });
  } catch (err) {
    if (logger) logger(`Image-prompt enrichment failed, using storyboard prompts as-is: ${err.message || err}`);
    return scenes;
  }
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

  // Enrich imagePrompts with the "Image Prompts.docx" specification before
  // sending to Nano Banana. This adds camera angle, lens, lighting,
  // composition, mood etc. that the storyboard-planner prompt didn't
  // enforce, and keeps the character identity consistent across scenes.
  const enrichedScenes = await enrichImagePromptsWithLLM({
    scenes: sceneData,
    plan,
    input,
    product,
    profile,
    referenceImageSource: consistencyReference,
    logger
  });
  // Mutate plan.scenes in place so downstream code (which references
  // plan.scenes) also sees the enriched prompts.
  if (Array.isArray(plan?.scenes) && Array.isArray(enrichedScenes) && enrichedScenes.length === plan.scenes.length) {
    for (let i = 0; i < enrichedScenes.length; i++) {
      plan.scenes[i] = enrichedScenes[i];
    }
  }

  let characterSheet = input.characterSheet || null;
  
  if (input.characterEnabled && input.characterImage && input.characterConsistencyStrength === 'Strict') {
    if (!characterSheet && context.jobId) {
       const draft = await VideoDraft.findOne({ jobId: context.jobId });
       if (draft && draft.characterSheet && (draft.characterSheet.frontPortrait || draft.characterSheet.sidePortrait)) {
           characterSheet = draft.characterSheet;
       } else {
           if (logger) logger("Extracting canonical face angles (Master Character Sheet)...");
           characterSheet = await generateCharacterSheetFal(input.characterImage);
           if (draft) {
               draft.characterSheet = characterSheet;
               // Wait for save below
           }
       }
       
       if (draft && !draft.characterFaceEmbedding) {
           if (logger) logger("Extracting formal Face Embedding vector for identity lock...");
           draft.characterFaceEmbedding = await extractFaceEmbedding(input.characterImage);
       }
       
       if (draft) {
           await draft.save();
           input.characterFaceEmbedding = draft.characterFaceEmbedding;
       }
    }
  }

  const outputScenes = [];
  let previousSceneImageUrl = null;
  for (let index = 0; index < sceneData.length; index++) {
    const scene = sceneData[index];
      const fileName = `scene_${scene.index}.jpg`;
      const localPath = path.join(context.dirs.images, fileName);
      const mediaUrl = buildMediaUrl(context.baseUrl, context.jobId, ['images', fileName]);

      // Cache guard: Check if the scene image is ALREADY generated in a prior attempt and exists!
      if (scene.imageUrl && scene.imageUrl.startsWith('http') && fs.existsSync(localPath)) {
        if (logger) logger(`Reusing existing generated image for scene ${scene.sceneId}`);
        const reusedScene = {
          ...scene,
          imageUrl: scene.imageUrl,
          imagePath: localPath,
          imageSource: scene.imageSource || 'reused'
        };
        outputScenes.push(reusedScene);
        previousSceneImageUrl = scene.imageUrl;
        continue;
      }

      // First scene can use uploaded image or product image directly.
      const canUseReferenceDirectly = index === 0 && referenceImage?.localPath;

      if (canUseReferenceDirectly) {
      await fs.promises.copyFile(referenceImage.localPath, localPath);
        const resolvedScene = {
        ...scene,
        imageUrl: mediaUrl,
        imagePath: localPath,
        imageSource: referenceImage.type
        };
        outputScenes.push(resolvedScene);
        continue;
      }

    let characterImageContext = '';
    if (input.characterEnabled && input.preserveIdentity !== false) {
      const isStrict = input.characterConsistencyStrength === 'Strict';
      
      const demographics = [
        input.characterRace ? `${input.characterRace} ethnicity` : '',
        input.characterAge ? `${input.characterAge} years old` : '',
        input.characterGender ? input.characterGender : '',
        input.characterBeard && input.characterBeard !== 'Clean Shaven (No Beard)' ? `with ${input.characterBeard}` : (input.characterBeard === 'Clean Shaven (No Beard)' ? 'completely clean shaven, absolutely no facial hair' : '')
      ].filter(Boolean).join(', ');

      const demographicString = demographics ? `The character is a ${demographics}.` : '';

      if (isStrict) {
        characterImageContext = `CRITICAL INSTRUCTION: You MUST exactly recreate the face and identity of the person in the reference image. ${demographicString} DO NOT change their facial structure, skin tone, or demographic. DO NOT hallucinate a different person. Match the reference image 100%. Keep same hairstyle. Maintain same age.`;
      } else {
        characterImageContext = `Maintain general character identity across scenes based on the reference image. ${demographicString}`;
      }
    }

    const promptWithConsistency = [
      characterImageContext,
      scene.imagePrompt,
      `Consistency style: ${plan.globalVisualStyle}`,
      input.preserveIdentity !== false ? 'Keep same lead subject identity, lighting logic, and palette continuity with earlier scenes.' : ''
    ].filter(Boolean).join('\n\n');

      const imageResult = await runWithRetries(
        `image generation for ${scene.sceneId}`,
        async () => {
          if (logger) {
            console.log("Scene:", index + 1);
            console.log("Character Image Present:", !!input.characterImageBase64);
            console.log("Canonical Character Present:", !!input.characterImage);
            console.log("Previous Scene Present:", !!previousSceneImageUrl);
            console.log("Product Image Present:", !!consistencyReference);
          }

          if (input.characterImageBase64) {
            if (logger) console.log("Using gemini-3.1-flash-image for character consistency...");
            
            // Extract base64 properly
            let base64Data = input.characterImageBase64;
            let mimeType = 'image/jpeg';
            if (base64Data.startsWith('data:')) {
              const matches = base64Data.match(/^data:(.+);base64,(.*)$/);
              if (matches && matches.length === 3) {
                mimeType = matches[1];
                base64Data = matches[2];
              }
            }

            const fixedSeed = context.jobId ? Math.abs(context.jobId.split('').reduce((hash, char) => ((hash << 5) - hash) + char.charCodeAt(0), 0)) % 100000 : 42;
            
            let cleanBase64 = input.characterImageBase64;
            if (cleanBase64.includes('data:image')) {
              cleanBase64 = cleanBase64.split(',')[1];
            }

            console.log('\n🎭 ==================== CHARACTER CONSISTENCY (NANO BANANA) ====================');
            console.log(`📸 Character: ${input.characterName || 'Unknown'}`);
            console.log(`🎬 Scene: ${promptWithConsistency}`);
            console.log(`🎨 Style: ${input.videoStyle || 'Cinematic'}`);
            console.log(`🔧 API: Gemini Nano Banana`);
            console.log('=========================================================================\n');
            
            const imageData = `data:image/jpeg;base64,${cleanBase64}`;

            const nanoResult = await generateCampaignImageNanoBanana(promptWithConsistency, {
              aspectRatio: '16:9', // default for video
              characterReferenceImage: imageData,
              isCinematic: true,
              brandName: input.useLogo !== false ? String(profile.name || '') : undefined,
              industry: input.useLogo !== false ? String(profile.industry || '') : undefined,
              tone: input.useLogo !== false ? String(profile.brandVoice || 'professional') : undefined,
            });
            
            if (nanoResult && (nanoResult.imageUrl || typeof nanoResult === 'string')) {
                return typeof nanoResult === 'string' ? nanoResult : nanoResult.imageUrl;
            } else {
                throw new Error('Nano Banana returned no image');
            }
          }

          // Fallback to NanoBanana if no character image is provided
          const result = await generateCampaignImageNanoBanana(promptWithConsistency, {
            aspectRatio: '9:16',
            brandName: input.useLogo !== false ? String(profile.name || '') : undefined,
            industry: input.useLogo !== false ? String(profile.industry || '') : undefined,
            tone: input.useLogo !== false ? String(profile.brandVoice || 'professional') : undefined,
            originalCharacterImage: input.characterEnabled ? input.originalCharacterImage : undefined,
            characterReferenceImage: (input.characterEnabled && input.characterImage) ? input.characterImage : undefined,
            previousSceneImage: previousSceneImageUrl || undefined,
            productReferenceImage: (!(input.characterEnabled && input.characterImage) && consistencyReference) ? consistencyReference : undefined,
            linkedProduct: product ? {
              name: product.name,
              description: product.description,
              imageUrl: product.imageUrl
            } : null,
            preserveCharacterIdentity: input.preserveIdentity !== false,
            characterSource: input.originalCharacterImage ? 'upload' : 'system',
            consistencyStrength: 'strict'
          });
          if (!result?.success || !result?.imageUrl) {
            throw new Error(result?.error || 'AI image generation failed');
          }
          return result.imageUrl;
        },
        2,
        logger
      );

      let finalImageUrl = imageResult;

      if (input.characterEnabled && input.characterImage && input.preserveIdentity !== false) {
        if (logger) {
          logger(`Executing Face Swap post-processing for scene ${scene.sceneId}...`);
          console.log("Starting FaceSwap for Scene", index + 1);
          console.log("Source Face:", input.originalCharacterImage ? "present" : "missing");
          console.log("Target Scene:", imageResult);
        }
        const faceSwapTarget = input.originalCharacterImage || input.characterImage;
        finalImageUrl = await applyFaceSwapFal(imageResult, faceSwapTarget);
        
        if (logger) {
          console.log("FaceSwap Result:", finalImageUrl ? "success" : "failed");
        }
      }

      if (logger) {
        console.log("Saving Final Scene Image:", finalImageUrl);
      }
      await materializeSourceToFile({
        source: finalImageUrl,
        destinationPath: localPath
      });

      if (logger) {
        console.log("Final Pipeline Summary");
        console.log(JSON.stringify({
          geminiReferenceImageAttached: !!input.characterImage || !!input.originalCharacterImage,
          pulidExecuted: false,
          faceSwapExecuted: !!(input.characterEnabled && input.characterImage && input.preserveIdentity !== false),
          faceSwapSucceeded: finalImageUrl !== imageResult,
          finalOutputUrl: finalImageUrl
        }, null, 2));
      }

      const finishedScene = {
        ...scene,
        imageUrl: mediaUrl,
        imagePath: localPath,
        imageSource: 'ai_generated'
      };
      
      outputScenes.push(finishedScene);
      previousSceneImageUrl = finalImageUrl;
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
    '-preset', VIDEO_ENCODE_PRESET,
    '-crf', VIDEO_ENCODE_CRF,
    '-an',
    outputPath
  ];

  await runFfmpeg(args);
}

async function normalizeSceneVideoClip({ inputPath, outputPath, durationSeconds, logoPath = '', logoMode = 'watermark' }) {
  const safeDuration = clamp(Number.parseInt(String(durationSeconds || 4), 10), 1, 120);

  // `tpad=stop_mode=clone` holds the final frame if the source is shorter
  // than the target. Scene durations are now snapped to what Kling actually
  // renders (5s or 10s), so this should never fire — it stays purely as a
  // safety net for a model that returns a short clip. If you see a frozen
  // tail again, that means the snapping upstream has drifted.
  const videoFilters = [
    `scale=${VIDEO_TARGET.width}:${VIDEO_TARGET.height}:force_original_aspect_ratio=increase`,
    `crop=${VIDEO_TARGET.width}:${VIDEO_TARGET.height}`,
    `fps=${VIDEO_TARGET.fps}`,
    `tpad=stop_mode=clone:stop_duration=${safeDuration}`,
    'format=yuv420p'
  ];

  const args = ['-y', '-i', inputPath];

  if (logoPath && fs.existsSync(logoPath)) {
    // Stamp the logo AFTER the model has rendered. Kling regenerates every
    // pixel it is given, so a logo baked into its input image comes back
    // smeared. Compositing here means the mark is never re-synthesised —
    // it lands on finished video, pixel-exact.
    const isProminent = String(logoMode) === 'prominent';
    const logoWidth = Math.round(VIDEO_TARGET.width * (isProminent ? 0.26 : 0.14));
    const margin = Math.round(VIDEO_TARGET.width * 0.035);
    const x = isProminent ? '(W-w)/2' : `W-w-${margin}`;
    const y = isProminent ? String(margin) : String(margin);
    const opacity = isProminent ? 1.0 : 0.85;

    args.push('-i', logoPath);
    const filterComplex =
      `[0:v]${videoFilters.join(',')}[base];` +
      `[1:v]scale=${logoWidth}:-1,format=rgba,colorchannelmixer=aa=${opacity}[wm];` +
      `[base][wm]overlay=${x}:${y}:format=auto[v]`;
    args.push('-filter_complex', filterComplex, '-map', '[v]');
  } else {
    args.push('-vf', videoFilters.join(','));
  }

  args.push(
    '-t', String(safeDuration),
    '-r', String(VIDEO_TARGET.fps),
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-preset', VIDEO_ENCODE_PRESET,
    '-crf', VIDEO_ENCODE_CRF,
    '-an',
    outputPath
  );

  await runFfmpeg(args);
}

// Enrich each scene's videoPrompt using the "Video Prompts.docx" spec.
// Runs before Fal.ai Kling clip generation so every scene gets a
// natural, premium image-to-video prompt covering camera/character/
// facial/background movement, lighting changes, duration, ending frame.
async function enrichVideoPromptsWithLLM({ scenes, plan, input, product, profile, logger }) {
  if (!Array.isArray(scenes) || scenes.length === 0) return scenes;

  const brandToneFromProfile = Array.isArray(profile?.brandVoice)
    ? profile.brandVoice.join(', ')
    : String(profile?.brandVoice || profile?.tone || 'Cinematic');

  const characterMotionBlock = input?.characterEnabled
    ? `- The main character (${input.characterName || 'lead character'}) MUST retain identical facial identity across the clip. Do NOT morph the face.`
    : '';

  const systemPrompt = `You are a Professional AI Video Prompt Engineer for premium commercial ad production.
Using the approved storyboard and its generated scene images, create ONE image-to-video prompt for every scene.

Each prompt MUST describe:
• Camera movement (e.g. slow push in, pull out, orbit shot, tracking shot, handheld realism, subtle dolly, static)
• Character movement (natural gestures, small posture shifts — no exaggerated motion)
• Facial movement (subtle expression shifts only — no morphing, no unrealistic changes)
• Background movement (drifting particles, cloth flow, lighting flicker, ambient life — subtle)
• Lighting changes (rim light shift, sun ray reveal, subtle temperature drift)
• Duration (seconds — match the scene's durationSeconds)
• Ending frame (what the last visible frame should be, to enable smooth cut to next scene)

Rules:
- Natural movement ONLY. No exaggerated AI motion.
- No morphing of faces, hands, product geometry, text, or logos.
- No unrealistic facial changes.
- Every scene should feel like a premium commercial worthy of a top brand.
- Optimize for Kling, Minimax, Veo, Runway image-to-video models.
- Do NOT repeat visual details already present in the scene image (environment, wardrobe, lighting palette). Focus ONLY on MOTION.
- Keep prompts crisp — 2-4 sentences per scene.
${characterMotionBlock}

BRAND CONTEXT
- Business: ${profile?.name || 'N/A'}
- Industry: ${profile?.industry || 'N/A'}
- Brand Tone: ${brandToneFromProfile}
- Global Visual Style: ${plan?.globalVisualStyle || 'Premium cinematic vertical ad style.'}

STORYBOARD SCENES (source material — use imagePrompt as the visual anchor, describe motion that fits it):
${scenes.map((s, i) => `Scene ${i + 1} — id: ${s.sceneId}
  Title: ${s.title || ''}
  imagePrompt (visual anchor): ${s.imagePrompt || ''}
  existing videoPrompt: ${s.videoPrompt || ''}
  Duration: ${s.durationSeconds || 3} seconds
  Voice line: ${s.voiceLine || ''}`).join('\n\n')}

OUTPUT FORMAT — STRICT JSON ONLY
Return ONLY a valid JSON object with this exact schema:
{
  "scenes": [
    { "sceneId": "scene_1", "videoPrompt": "single string covering camera/character/facial/background movement + lighting changes + duration + ending frame" }
  ]
}
- Return exactly ${scenes.length} scenes in the same sceneId order as above.
- No markdown, no code fences, no text outside the JSON.`;

  try {
    let raw;
    try {
      raw = await callOpenAI(systemPrompt, {
        temperature: 0.6,
        maxTokens: 3000,
        timeout: 120000,
        jsonMode: true
      });
    } catch (openAiErr) {
      if (logger) logger(`OpenAI video-prompt enrichment failed, falling back to Gemini: ${openAiErr.message || openAiErr}`);
      raw = await callGemini(systemPrompt, {
        skipCache: true,
        temperature: 0.6,
        maxTokens: 3000,
        timeout: 120000
      });
    }
    const parsed = parseGeminiJSON(raw);
    const enriched = Array.isArray(parsed?.scenes) ? parsed.scenes : [];
    if (!enriched.length) return scenes;
    const byId = new Map(enriched.map((s) => [String(s?.sceneId || '').trim(), String(s?.videoPrompt || '').trim()]));
    return scenes.map((s) => {
      const better = byId.get(String(s.sceneId).trim());
      return better ? { ...s, videoPrompt: better } : s;
    });
  } catch (err) {
    if (logger) logger(`Video-prompt enrichment failed, using storyboard prompts as-is: ${err.message || err}`);
    return scenes;
  }
}

async function generateSceneClips({
  scenes,
  context,
  logger = null,
  onSceneDone = null
}) {
  // Enrich videoPrompts with the "Video Prompts.docx" specification before
  // sending each scene to Fal.ai. Adds proper motion vocabulary and
  // guards against face morphing / exaggerated AI motion.
  const enrichedScenes = await enrichVideoPromptsWithLLM({
    scenes,
    plan: context?.plan || null,
    input: context?.input || {},
    product: context?.product || null,
    profile: context?.user?.businessProfile || {},
    logger
  });
  if (Array.isArray(enrichedScenes) && enrichedScenes.length === scenes.length) {
    for (let i = 0; i < enrichedScenes.length; i++) {
      scenes[i] = enrichedScenes[i];
    }
  }

  // Upload a local clip to Cloudinary. Never throws — returns null on failure.
  const uploadClipToCloud = async (sceneId, localPath) => {
    try {
      if (logger) logger(`Uploading ${sceneId} to Cloudinary...`);
      const result = await uploadVideoFile(localPath, 'nebula-scene-clips');
      if (result?.success && result?.url) {
        if (logger) logger(`✓ ${sceneId} backed up to Cloudinary`);
        return result.url;
      }
    } catch (err) {
      if (logger) logger(`Cloudinary upload failed for ${sceneId}: ${err.message}. Using local URL fallback.`);
      console.error(`[Cloudinary clip upload failed: ${sceneId}]`, err.message);
    }
    return null;
  };

  return runWithConcurrency(scenes, SCENE_CLIP_CONCURRENCY, async (scene, index) => {
    const clipName = `scene_${scene.index}.mp4`;
    const clipPath = path.join(context.dirs.clips, clipName);
    const rawClipPath = path.join(context.dirs.temp, `fal_${sanitizeSegment(scene.sceneId || scene.index, 'scene')}.mp4`);
    const clipUrl = buildMediaUrl(context.baseUrl, context.jobId, ['clips', clipName]);

    // Cache guard 0 (BEST): Cloudinary URL already saved from prior run → reuse for free, no download needed
    const savedCloudUrl = String(scene.clipCloudUrl || '').trim();
    if (savedCloudUrl && savedCloudUrl.startsWith('http')) {
      if (logger) logger(`Reusing Cloudinary-backed clip for ${scene.sceneId} (no regen, no download)`);
      const enriched = {
        ...scene,
        clipUrl: savedCloudUrl,
        clipCloudUrl: savedCloudUrl,
        falVideoUrl: scene.falVideoUrl || scene.video_url || scene.videoUrl || ''
      };
      if (typeof onSceneDone === 'function') {
        onSceneDone(index, scenes.length, enriched);
      }
      return enriched;
    }

    // Cache guard 1: clip already on disk → reuse free
    if (scene.clipUrl && scene.clipUrl.startsWith('http') && fs.existsSync(clipPath)) {
      if (logger) logger(`Reusing existing generated video clip for scene ${scene.sceneId}`);
      // Opportunistically back up to Cloudinary if not already
      const cloudUrl = await uploadClipToCloud(scene.sceneId, clipPath);
      const enriched = {
        ...scene,
        clipPath,
        clipUrl: cloudUrl || clipUrl,
        clipCloudUrl: cloudUrl || null,
        falVideoUrl: scene.falVideoUrl || scene.video_url || scene.videoUrl || ''
      };
      if (typeof onSceneDone === 'function') {
        onSceneDone(index, scenes.length, enriched);
      }
      return enriched;
    }

    // Cache guard 2 (CRITICAL on ephemeral filesystems like Render):
    // Local file gone (dyno restart) but we have the fal CDN URL from a prior run.
    // Re-download from fal's CDN instead of re-paying fal to regenerate the clip.
    const savedFalUrl = String(scene.falVideoUrl || scene.video_url || scene.videoUrl || '').trim();
    if (savedFalUrl && savedFalUrl.startsWith('http') && !fs.existsSync(clipPath)) {
      try {
        if (logger) logger(`Local clip missing for ${scene.sceneId} — re-downloading from fal CDN (free, no re-generation)`);
        await materializeSourceToFile({ source: savedFalUrl, destinationPath: rawClipPath });
        await normalizeSceneVideoClip({
          inputPath: rawClipPath,
          outputPath: clipPath,
          // Snap to what Kling actually renders — older drafts still carry
          // 6s scenes, which would otherwise get a frozen tail.
          durationSeconds: getKlingDuration(scene)
        });
        const stat = await fs.promises.stat(clipPath);
        if (stat.size) {
          const cloudUrl = await uploadClipToCloud(scene.sceneId, clipPath);
          const enriched = {
            ...scene,
            clipPath,
            clipUrl: cloudUrl || clipUrl,
            clipCloudUrl: cloudUrl || null,
            falVideoUrl: savedFalUrl
          };
          if (typeof onSceneDone === 'function') {
            onSceneDone(index, scenes.length, enriched);
          }
          return enriched;
        }
      } catch (rehydrateErr) {
        if (logger) logger(`Re-download from fal CDN failed for ${scene.sceneId}: ${rehydrateErr.message}. Will regenerate.`);
      }
    }

    if (logger) logger(`Generating Fal.ai clip for ${scene.sceneId}`);
    let enriched;
    try {
      if (context.input?.characterEnabled || context.input?.videoStyle) {
        scene.videoPrompt = `${scene.videoPrompt}. ${context.input.videoStyle ? `Cinematic Style: ${context.input.videoStyle}.` : ''} ${context.input.characterEnabled ? 'Maintain exact facial identity. Preserve character appearance. Do not generate a different person. Animate naturally while preserving identity.' : ''}`;
      }
      
      console.log(`[${new Date().toISOString()}] [Job ID: ${context.jobId}] STEP 4: Fal.ai render started for scene ${scene.sceneId}`);
      const falScene = await generateVideoClip(scene);
      console.log(`[${new Date().toISOString()}] [Job ID: ${context.jobId}] STEP 5: Fal.ai render completed for scene ${scene.sceneId}`);
      
      await materializeSourceToFile({ source: falScene.video_url, destinationPath: rawClipPath });
      await normalizeSceneVideoClip({
        inputPath: rawClipPath,
        outputPath: clipPath,
        // Match the rendered length exactly so tpad never freezes a tail.
        durationSeconds: falScene.renderedDurationSeconds || getKlingDuration(scene)
      });

      const stat = await fs.promises.stat(clipPath);
      if (!stat.size) throw new Error(`Generated clip is empty for ${scene.sceneId}`);

      const cloudUrl = await uploadClipToCloud(scene.sceneId, clipPath);
      enriched = {
        ...falScene,
        clipPath,
        clipUrl: cloudUrl || clipUrl,
        clipCloudUrl: cloudUrl || null,
        falVideoUrl: falScene.video_url
      };
    } catch (error) {
      const isFallbackAllowed = process.env.NODE_ENV === 'development' || 
                                 process.env.DEMO_MODE === 'true' || 
                                 process.env.VIDEO_FALLBACK_ALLOWED === 'true';

      if (!isFallbackAllowed) {
        if (logger) {
          logger(`❌ Fal.ai clip generation failed for scene ${scene.sceneId} and fallback is disabled: ${error.message}`);
        }
        throw error;
      }

      if (logger) {
        logger(`⚠️ Fal.ai clip generation failed for scene ${scene.sceneId}: ${error.message}. Falling back to static image to video clip conversion via FFmpeg.`);
      }
      console.warn(`[Fal.ai Fallback] scene ${scene.sceneId}:`, error.message);

      // Verify that the static image exists
      if (!scene.imagePath || !fs.existsSync(scene.imagePath)) {
        throw new Error(`Fallback failed: Scene ${scene.sceneId} is missing static imagePath`);
      }

      await createSceneVideoClip({ scene, outputPath: clipPath });

      const stat = await fs.promises.stat(clipPath);
      if (!stat.size) throw new Error(`Fallback generated clip is empty for ${scene.sceneId}`);

      const cloudUrl = await uploadClipToCloud(scene.sceneId, clipPath);
      enriched = {
        ...scene,
        clipPath,
        clipUrl: cloudUrl || clipUrl,
        clipCloudUrl: cloudUrl || null,
        falVideoUrl: scene.imageUrl || '',
        video_url: scene.imageUrl || '',
        videoUrl: scene.imageUrl || '',
        fallbackUsed: true
      };
    }

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

  // Validate that all clip files exist and are non-empty before merging
  for (const scene of scenes) {
    if (!scene.clipPath) {
      throw new Error(`Scene ${scene.sceneId || scene.index} is missing clipPath`);
    }
    if (!fs.existsSync(scene.clipPath)) {
      throw new Error(`Scene clip file does not exist: ${scene.clipPath}`);
    }
    const stat = fs.statSync(scene.clipPath);
    if (stat.size === 0) {
      throw new Error(`Scene clip file is empty (0 bytes): ${scene.clipPath}`);
    }
  }

  await fs.promises.writeFile(
    concatPath,
    buildConcatListContent(scenes.map((scene) => scene.clipPath)),
    'utf8'
  );

  try {
    await runFfmpeg([
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', concatPath,
      '-c', 'copy',
      '-an',
      '-movflags', '+faststart',
      outputPath
    ]);
  } catch (_) {
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
      '-movflags', '+faststart',
      outputPath
    ];
    await runFfmpeg(args);
  }

  return {
    path: outputPath,
    url: outputUrl
  };
}

// Remove sentences the narrator would otherwise speak more than once.
// Two sources of repeats: an LLM looping on itself, and storyboard scenes
// that carry the same voiceLine getting concatenated into one script.
// Comparison is accent/punctuation/case-insensitive and Unicode-aware so
// it works for Tamil, Hindi and the rest, not just English.
function dedupeRepeatedSentences(text = '') {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';

  const sentences = clean.match(/[^.!?]+[.!?]*/g) || [clean];
  const seen = new Set();
  const kept = [];

  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;
    const key = sentence
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
    // Very short fragments ("Yes.", "இதோ.") can legitimately recur as a
    // rhetorical beat, so only dedupe substantive lines.
    if (!key || key.length < 12) {
      kept.push(sentence);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(sentence);
  }

  return kept.join(' ').replace(/\s+/g, ' ').trim() || clean;
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

function toTtsLocaleCode(code = 'en') {
  const normalized = String(code || '').toLowerCase().trim().replace(/_/g, '-');
  const localeAliases = {
    en: 'en-in',
    'en-in': 'en-in',
    'en-us': 'en-us',
    'en-gb': 'en-gb',
    hi: 'hi-in',
    'hi-in': 'hi-in',
    ta: 'ta-in',
    'ta-in': 'ta-in',
    te: 'te-in',
    'te-in': 'te-in',
    kn: 'kn-in',
    'kn-in': 'kn-in',
    ml: 'ml-in',
    'ml-in': 'ml-in'
  };
  return localeAliases[normalized] || `${toTtsLanguageCode(normalized)}-in`;
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

async function getMediaDurationSecondsFromFile(filePath) {
  return getAudioDurationSecondsFromFile(filePath);
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
  const locale = toTtsLocaleCode(languageCode);
  const gender = String(voiceGender || 'female').toLowerCase() === 'male' ? 'male' : 'female';
  const voices = {
    'en-in': {
      languageCode: 'en-IN',
      male: GOOGLE_TTS_EN_IN_MALE_VOICE,
      female: GOOGLE_TTS_EN_IN_FEMALE_VOICE
    },
    'en-us': {
      languageCode: 'en-US',
      male: GOOGLE_TTS_EN_MALE_VOICE,
      female: GOOGLE_TTS_EN_FEMALE_VOICE
    },
    'en-gb': {
      languageCode: 'en-GB',
      male: GOOGLE_TTS_EN_GB_MALE_VOICE,
      female: GOOGLE_TTS_EN_GB_FEMALE_VOICE
    },
    'hi-in': {
      languageCode: 'hi-IN',
      male: GOOGLE_TTS_HI_IN_MALE_VOICE,
      female: GOOGLE_TTS_HI_IN_FEMALE_VOICE
    },
    'ta-in': {
      languageCode: 'ta-IN',
      male: 'ta-IN-Wavenet-B',
      female: 'ta-IN-Wavenet-A'
    },
    'te-in': {
      languageCode: 'te-IN',
      male: 'te-IN-Wavenet-B',
      female: 'te-IN-Wavenet-A'
    },
    'kn-in': {
      languageCode: 'kn-IN',
      male: 'kn-IN-Wavenet-B',
      female: 'kn-IN-Wavenet-A'
    },
    'ml-in': {
      languageCode: 'ml-IN',
      male: 'ml-IN-Wavenet-B',
      female: 'ml-IN-Wavenet-A'
    }
  };
  const voice = voices[locale] || voices['en-in'];
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
    pitch: 0
  };
}

function voiceCacheHash(value = '') {
  return crypto.createHash('sha1').update(String(value || '').replace(/\s+/g, ' ').trim()).digest('hex');
}

function isMatchingVoiceCache(cache, expected = {}) {
  if (!cache?.path || !fs.existsSync(cache.path)) return false;
  return (
    String(cache.voiceGender || '').toLowerCase() === String(expected.voiceGender || '').toLowerCase() &&
    String(cache.languageCode || '').toLowerCase() === String(expected.languageCode || '').toLowerCase() &&
    String(cache.sourceScriptHash || '') === String(expected.sourceScriptHash || '') &&
    Number(cache.durationSeconds || 0) === Number(expected.durationSeconds || 0)
  );
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
  const locale = toTtsLocaleCode(languageCode);
  const gender = String(voiceGender || 'female').toLowerCase() === 'male' ? 'male' : 'female';
  const voices = {
    'en-in': { male: 'en-IN-PrabhatNeural', female: 'en-IN-NeerjaNeural' },
    'en-us': { male: 'en-US-GuyNeural', female: 'en-US-JennyNeural' },
    'en-gb': { male: 'en-GB-RyanNeural', female: 'en-GB-SoniaNeural' },
    'hi-in': { male: 'hi-IN-MadhurNeural', female: 'hi-IN-SwaraNeural' },
    'ta-in': { male: 'ta-IN-ValluvarNeural', female: 'ta-IN-PallaviNeural' },
    'te-in': { male: 'te-IN-MohanNeural', female: 'te-IN-ShrutiNeural' },
    'kn-in': { male: 'kn-IN-GaganNeural', female: 'kn-IN-SapnaNeural' },
    'ml-in': { male: 'ml-IN-MidhunNeural', female: 'ml-IN-SobhanaNeural' }
  };
  const configuredOverride = locale.startsWith('en-')
    ? (gender === 'male' ? EDGE_TTS_MALE_VOICE : EDGE_TTS_FEMALE_VOICE)
    : '';
  return configuredOverride || voices[locale]?.[gender] || voices['en-in'][gender];
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
  return toTtsLocaleCode(code);
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

// Voice IDs that failed a lookup on the user's account get cached
// with the resolved ID from the community library after we auto-add
// them. Prevents re-hitting the ElevenLabs "add" endpoint on every
// synthesis call for the same voice.
const _elevenLabsSharedVoiceCache = new Map();

async function ensureElevenLabsVoiceInAccount(voiceId) {
  if (!voiceId || !fetchImpl || !ELEVENLABS_API_KEY) return voiceId;
  if (_elevenLabsSharedVoiceCache.has(voiceId)) return _elevenLabsSharedVoiceCache.get(voiceId);

  // If the voice already exists on the account, /v1/voices/{id}
  // returns 200. Otherwise 404 → it's a shared voice we must add.
  try {
    const checkRes = await fetchImpl(`https://api.elevenlabs.io/v1/voices/${encodeURIComponent(voiceId)}`, {
      headers: { 'xi-api-key': ELEVENLABS_API_KEY }
    });
    if (checkRes.ok) {
      _elevenLabsSharedVoiceCache.set(voiceId, voiceId);
      return voiceId;
    }
  } catch (_) { /* fall through to add */ }

  // Voice isn't in the account — look it up in the shared library to
  // grab its owner ID, then add.
  try {
    const searchRes = await fetchImpl(`https://api.elevenlabs.io/v1/shared-voices?search=${encodeURIComponent(voiceId)}&page_size=100`, {
      headers: { 'xi-api-key': ELEVENLABS_API_KEY }
    });
    if (!searchRes.ok) return voiceId; // give up — let TTS return real error
    const searchPayload = await searchRes.json();
    const match = (searchPayload?.voices || []).find((v) => v.voice_id === voiceId);
    if (!match || !match.public_owner_id) return voiceId;

    const addRes = await fetchImpl(
      `https://api.elevenlabs.io/v1/voices/add/${encodeURIComponent(match.public_owner_id)}/${encodeURIComponent(voiceId)}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ new_name: match.name || `Shared voice ${voiceId.slice(0, 6)}` })
      }
    );
    if (!addRes.ok) return voiceId;
    const addPayload = await addRes.json();
    const newId = addPayload?.voice_id || voiceId;
    _elevenLabsSharedVoiceCache.set(voiceId, newId);
    return newId;
  } catch (e) {
    console.warn('[ElevenLabs] ensureElevenLabsVoiceInAccount failed:', e.message);
    return voiceId;
  }
}

// Auto-derive a music prompt from the voice script + scene emotions.
// Simple keyword extraction — no extra LLM call to keep it fast/cheap.
function deriveMusicPromptFromScript(voiceScript = '', sceneData = [], durationSeconds = 30) {
  const emotions = new Set();
  (sceneData || []).forEach((s) => {
    String(s?.emotion || '').split(/[,;/&]+/).forEach((e) => {
      const t = e.trim().toLowerCase();
      if (t) emotions.add(t);
    });
  });
  const emotionStr = [...emotions].slice(0, 3).join(', ');

  // Very light heuristic on script sentiment
  const script = String(voiceScript || '').toLowerCase();
  let mood = 'warm, cinematic';
  if (/loss|grief|farewell|goodbye|miss/i.test(script)) mood = 'melancholic, tender, slow';
  else if (/celebrate|festival|joy|happy|dance/i.test(script)) mood = 'uplifting, joyful, celebratory';
  else if (/journey|adventure|discover|explore/i.test(script)) mood = 'epic, expansive, aspirational';
  else if (/family|home|memory|nostalgi/i.test(script)) mood = 'warm, sentimental, nostalgic, gentle strings';
  else if (/luxury|premium|exclusive/i.test(script)) mood = 'sophisticated, elegant, minimal piano';
  else if (/product|launch|showcase|brand/i.test(script)) mood = 'confident, modern, motivational';

  const parts = [
    `Instrumental background music for a ${Math.round(durationSeconds)}-second commercial`,
    mood,
    emotionStr ? `Scene emotions: ${emotionStr}` : '',
    'No lyrics, no vocals, radio-quality mix suitable for advertising, soft dynamics that sit under a spoken voiceover, gentle intro and outro'
  ].filter(Boolean).join('. ');

  return parts;
}

async function generateElevenLabsMusic({
  prompt,
  durationSeconds = 30,
  outputPath,
  logger = null
}) {
  if (!fetchImpl || !ELEVENLABS_API_KEY) return false;
  const clampedDuration = clamp(Number.parseInt(String(durationSeconds || 30), 10), 10, 300);
  const musicLengthMs = clampedDuration * 1000;

  try {
    if (logger) logger(`[ElevenLabs Music] composing ${clampedDuration}s track — prompt: "${prompt.slice(0, 120)}..."`);
    // ElevenLabs music compose endpoint. Returns audio bytes.
    const response = await fetchImpl(
      `https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prompt,
          music_length_ms: musicLengthMs
        })
      }
    );
    if (!response.ok) {
      const details = await response.text().catch(() => '');
      console.warn(`[ElevenLabs Music] HTTP ${response.status}: ${details.slice(0, 240)}`);
      return false;
    }
    const arrayBuffer = typeof response.arrayBuffer === 'function'
      ? await response.arrayBuffer()
      : await response.buffer();
    await fs.promises.writeFile(outputPath, Buffer.from(arrayBuffer));
    const stat = await fs.promises.stat(outputPath);
    return stat.size > 2000;
  } catch (e) {
    if (logger) logger(`[ElevenLabs Music] failed: ${e.message}`);
    return false;
  }
}

async function synthesizeElevenLabsTts({
  text,
  languageCode,
  voiceGender,
  outputPath,
  voiceId = ''
}) {
  if (!fetchImpl || !ELEVENLABS_API_KEY) return false;
  // Resolve which voice ID to use.
  // Priority: explicit voiceId from audio config (voice starred by user)
  //           > gender-specific env override
  //           > ElevenLabs premade default (Rachel for female, Adam for male)
  const isMale = String(voiceGender || '').toLowerCase() === 'male';
  const envFemaleId = String(process.env.ELEVENLABS_FEMALE_VOICE_ID || '').trim();
  const envMaleId = ELEVENLABS_MALE_VOICE_ID;
  let resolvedId = String(voiceId || '').trim()
    || (isMale ? envMaleId : envFemaleId)
    // ElevenLabs premade defaults (public, always available on any account)
    || (isMale ? 'pNInz6obpgDQGcFmaJgB' /* Adam */ : '21m00Tcm4TlvDq8ikWAM' /* Rachel */);
  if (!resolvedId) return false;

  // Auto-add shared/community voices to the account (needed for TTS).
  resolvedId = await ensureElevenLabsVoiceInAccount(resolvedId);

  // Try eleven_v3 first (latest, most expressive). If the voice
  // doesn't support v3 yet, fall back to eleven_multilingual_v2.
  const callElevenLabs = async (modelId) => fetchImpl(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(resolvedId)}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
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

  let response = await callElevenLabs(ELEVENLABS_MODEL_ID);
  if (!response.ok && ELEVENLABS_MODEL_ID !== ELEVENLABS_MODEL_FALLBACK) {
    // Voice-model incompatibility → try the multilingual v2 fallback
    const bodyText = await response.text().catch(() => '');
    console.warn(`[ElevenLabs] ${ELEVENLABS_MODEL_ID} rejected for voice ${resolvedId} (HTTP ${response.status}). Retrying with ${ELEVENLABS_MODEL_FALLBACK}. Detail: ${bodyText.slice(0, 200)}`);
    response = await callElevenLabs(ELEVENLABS_MODEL_FALLBACK);
  }

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

async function synthesizeNeuralTts({
  text,
  languageCode,
  voiceGender,
  outputPath,
  speakingRate = 1,
  logger = null,
  voiceId = ''
}) {
  const normalizedGender = String(voiceGender || 'female').toLowerCase() === 'male' ? 'male' : 'female';
  const normalizedLocale = toTtsLocaleCode(languageCode);
  const preferGoogleMale = normalizedGender === 'male' && /^(en-in|hi-in|ta-in|te-in|kn-in|ml-in)$/.test(normalizedLocale);
  const preferElevenLabs = !!String(voiceId || '').trim();

  const tryGoogle = async () => {
    try {
      const ok = await synthesizeGoogleCloudTts({
        text,
        languageCode,
        voiceGender: normalizedGender,
        outputPath,
        speakingRate
      });
      if (ok) {
        if (logger) logger(`Google Cloud TTS ${googleCloudTtsVoice(languageCode, normalizedGender).name} succeeded`);
        return true;
      }
    } catch (error) {
      if (logger) logger(`Google Cloud TTS failed: ${error.message || error}`);
    }
    return false;
  };

  const tryEdge = async () => {
    try {
      return await synthesizeEdgeTts({
        text,
        languageCode,
        voiceGender: normalizedGender,
        outputPath,
        speakingRate,
        logger
      });
    } catch (error) {
      if (logger) logger(`Edge TTS failed: ${error.message || error}`);
    }
    return false;
  };

  const tryElevenLabs = async () => {
    try {
      return await synthesizeElevenLabsTts({
        text,
        languageCode,
        voiceGender: normalizedGender,
        outputPath,
        voiceId
      });
    } catch (error) {
      if (logger) logger(`ElevenLabs voice failed: ${error.message || error}`);
    }
    return false;
  };

  // User-picked voice (starred / selected in the Audio Config UI) is
  // ALWAYS ElevenLabs — try that first and only fall through on failure.
  if (preferElevenLabs && await tryElevenLabs()) return true;
  if (preferGoogleMale && await tryGoogle()) return true;
  if (await tryEdge()) return true;
  if (!preferElevenLabs && await tryElevenLabs()) return true;
  if (!preferGoogleMale && await tryGoogle()) return true;
  return false;
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
  logger = null,
  voiceId = ''
}) {
  const normalizedLang = toTtsLanguageCode(languageCode);
  const safeTarget = Number.isFinite(Number(targetDurationSeconds)) ? Number(targetDurationSeconds) : null;

  // Step 1: Translate with duration awareness (scene-timed) and avoid summarization.
  // Drop duplicate sentences first — nothing downstream benefits from
  // narrating the same line twice, and repeats inflate the script length,
  // which is what used to force the voice into a sped-up atempo.
  let scriptForTts = dedupeRepeatedSentences(voiceScript);
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

  const normalizedGender = String(voiceGender || 'female').toLowerCase() === 'male' ? 'male' : 'female';
  const ttsLocale = toTtsVoiceLocale(languageCode, normalizedGender);
  const finalVoiceFileName = `voice_track_${normalizedGender}.mp3`;
  const finalVoicePath = path.join(context.dirs.audio, finalVoiceFileName);
  const voiceMetadata = {
    voiceGender: normalizedGender,
    languageCode: toTtsLocaleCode(languageCode),
    sourceScriptHash: voiceCacheHash(sourceVoiceScript || voiceScript || scriptForTts),
    durationSeconds: Number(safeTarget || 0),
    voiceProvider: 'auto-neural'
  };

  const maybeStretchToTarget = async () => {
    if (!fitToDuration || !safeTarget) return;
    const actual = await getAudioDurationSecondsFromFile(finalVoicePath);
    if (!Number.isFinite(actual) || actual <= 0) return;
    
    // Negligible time differences (less than 0.2s) do not require modification
    if (Math.abs(actual - safeTarget) < 0.2) return;

    // Nudge the tempo only within the imperceptible band. Anything the
    // cap can't absorb is handled by padding (too short) or a faded trim
    // (too long) — never by making the narrator talk fast.
    const ratio = actual / safeTarget;
    const atempo = clamp(ratio, AUDIO_MAX_SLOWDOWN, AUDIO_MAX_SPEEDUP);
    const stretchedPath = path.join(context.dirs.audio, `voice_track_${normalizedGender}_stretched.mp3`);
    const filters = [];

    if (Math.abs(atempo - 1) > 0.005) filters.push(`atempo=${atempo.toFixed(3)}`);

    // Duration after the capped tempo change.
    const afterTempo = actual / atempo;

    if (afterTempo > safeTarget + 0.05) {
      // Script genuinely overruns the scene. Trim, but fade the last
      // 0.35s so it tails off instead of chopping mid-word.
      const fadeStart = Math.max(0, safeTarget - 0.35);
      filters.push(`atrim=0:${safeTarget.toFixed(3)}`, `afade=t=out:st=${fadeStart.toFixed(3)}:d=0.35`);
      if (logger) {
        logger(`Voice overruns scene: ${actual.toFixed(2)}s vs ${safeTarget}s target. ` +
          `Capped tempo at ${atempo.toFixed(3)} (limit ${AUDIO_MAX_SPEEDUP}) and trimmed ` +
          `${(afterTempo - safeTarget).toFixed(2)}s with a fade. Shorten the script to avoid this.`);
      }
    } else if (afterTempo < safeTarget - 0.05) {
      // Short script — pad with silence. Inaudible, unlike slowing speech.
      filters.push('apad', `atrim=0:${safeTarget.toFixed(3)}`);
      if (logger) {
        logger(`Voice shorter than scene: ${actual.toFixed(2)}s vs ${safeTarget}s target. ` +
          `Tempo ${atempo.toFixed(3)}, padding ${(safeTarget - afterTempo).toFixed(2)}s of silence.`);
      }
    } else if (logger) {
      logger(`Syncing voice duration: actual=${actual.toFixed(2)}s, target=${safeTarget}s, atempo=${atempo.toFixed(3)}`);
    }

    if (!filters.length) return;

    await runFfmpeg([
      '-y',
      '-i', finalVoicePath,
      '-vn',
      '-af', filters.join(','),
      '-c:a', 'libmp3lame',
      '-q:a', '2',
      stretchedPath
    ]);

    await fs.promises.copyFile(stretchedPath, finalVoicePath);
  };

  // Try single pass synthesis for ultra fast TTS performance
  let singlePassSuccess = false;
  try {
    if (logger) logger(`Attempting single-pass TTS synthesis for entire script (${scriptForTts.length} chars)`);

    const ok = await synthesizeNeuralTts({
      text: scriptForTts,
      languageCode,
      voiceGender: normalizedGender,
      outputPath: finalVoicePath,
      speakingRate,
      logger,
      voiceId
    });

    if (ok && fs.existsSync(finalVoicePath)) {
      const stat = await fs.promises.stat(finalVoicePath);
      if (stat.size > 2000) {
        singlePassSuccess = true;
        if (logger) logger(`✅ Single-pass TTS synthesis succeeded (size = ${stat.size} bytes)`);
        await maybeStretchToTarget();
        return {
          path: finalVoicePath,
          url: publicAudioUrl(context, finalVoiceFileName),
          script: scriptForTts,
          sceneData: localizedScenes,
          ...voiceMetadata
        };
      }
    }
  } catch (singlePassError) {
    if (logger) logger(`⚠️ Single-pass TTS synthesis failed: ${singlePassError.message}. Falling back to chunked TTS.`);
  }

  // --- FALLBACK: Chunked TTS execution (preserves original safety mechanism) ---
  const chunks = chunkTextForTts(scriptForTts, 170);
  if (!chunks.length) return null;

  const chunkPaths = [];
  const chunkResults = await runWithConcurrency(chunks, 2, async (text, index) => {
    const outPath = path.join(context.dirs.audio, `voice_chunk_${index + 1}.mp3`);

    const neuralOk = await synthesizeNeuralTts({
      text,
      languageCode,
      voiceGender: normalizedGender,
      outputPath: outPath,
      speakingRate,
      logger: logger ? (line) => logger(`Voice chunk ${index + 1}: ${line}`) : null,
      voiceId
    });
    if (neuralOk) return outPath;

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
    await fs.promises.copyFile(chunkPaths[0], finalVoicePath);

    await maybeStretchToTarget();
    return {
      path: finalVoicePath,
      url: publicAudioUrl(context, finalVoiceFileName),
      script: scriptForTts,
      sceneData: localizedScenes,
      ...voiceMetadata
    };
  }

  const concatListPath = path.join(context.dirs.temp, 'voice_chunks_concat.txt');
  await fs.promises.writeFile(concatListPath, buildConcatListContent(chunkPaths), 'utf8');

  try {
    await runFfmpeg([
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', concatListPath,
      '-c', 'copy',
      finalVoicePath
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
      finalVoicePath
    ]);
  }

  await maybeStretchToTarget();
  return {
    path: finalVoicePath,
    url: publicAudioUrl(context, finalVoiceFileName),
    script: scriptForTts,
    sceneData: localizedScenes,
    ...voiceMetadata
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

async function prepareBackgroundTrack({ audioOptions, context, durationSeconds = 60, voiceScript = '', sceneData = [], logger = null }) {
  const tone = normalizeTone(audioOptions.tone) || 'professional';
  const durationBucket = bucketDurationSeconds(durationSeconds);

  // Option: ElevenLabs AI-composed music with mood-derived prompt.
  // Takes priority when musicSource === 'elevenlabs_ai'.
  if (audioOptions.musicSource === 'elevenlabs_ai') {
    const promptText = String(audioOptions.musicPrompt || '').trim()
      || deriveMusicPromptFromScript(voiceScript, sceneData, durationSeconds);
    const outputName = 'background_ai.mp3';
    const outputPath = path.join(context.dirs.audio, outputName);
    const ok = await generateElevenLabsMusic({
      prompt: promptText,
      durationSeconds,
      outputPath,
      logger
    });
    if (ok) {
      return {
        path: outputPath,
        url: buildMediaUrl(context.baseUrl, context.jobId, ['audio', outputName]),
        tone,
        source: 'elevenlabs_ai',
        prompt: promptText,
        durationBucketSeconds: durationBucket
      };
    }
    if (logger) logger('[ElevenLabs Music] failed — falling back to library track');
  }

  if (audioOptions.musicSource === 'library') {
    const root = musicLibraryRoot();
    const durationDir = path.join(root, `${durationBucket}s`);

    const preferredTrack = String(audioOptions.musicTrack || '').trim();
    const searchDirs = [durationDir];

    let candidates = [];
    for (const dirPath of searchDirs) {
      candidates = candidates.concat(listMusicCandidates(dirPath));
    }

    let selectedPath = null;
    if (preferredTrack) {
      const lower = preferredTrack.toLowerCase();
      selectedPath =
        candidates.find((p) => path.basename(p).toLowerCase() === lower) ||
        candidates.find((p) => p.toLowerCase().includes(lower)) ||
        null;
    }
    if (!selectedPath) {
      selectedPath = stablePick(candidates, context?.jobId || '') || null;
    }

    if (selectedPath) {
      const ext = path.extname(selectedPath) || '.mp3';
      const outputName = `background_track${ext}`;
      const outputPath = path.join(context.dirs.audio, outputName);
      await fs.promises.copyFile(selectedPath, outputPath);
      return {
        path: outputPath,
        url: buildMediaUrl(context.baseUrl, context.jobId, ['audio', outputName]),
        tone,
        source: 'library',
        durationBucketSeconds: durationBucket,
        trackName: path.basename(selectedPath)
      };
    }
  }

  const tonePath = audioFilePathForTone(tone) || audioFilePathForTone('professional');
  if (!tonePath) return null;
  const outputName = 'background_track.mp3';
  const outputPath = path.join(context.dirs.audio, outputName);
  await fs.promises.copyFile(tonePath, outputPath);
  return {
    path: outputPath,
    url: buildMediaUrl(context.baseUrl, context.jobId, ['audio', outputName]),
    tone,
    source: 'tone',
    durationBucketSeconds: durationBucket
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
  const background = await prepareBackgroundTrack({
    audioOptions,
    context,
    durationSeconds: input.durationSeconds,
    voiceScript: plan.voiceScript || input.description,
    sceneData: plan.sceneData || [],
    logger: null
  });
  const sfx = await prepareSoundEffects({ audioOptions, context, logger });

  let voice = null;
  let cachedFemaleVoice = null;
  let cachedMaleVoice = null;
  const requestedVoiceScript = plan.voiceScript || input.description;
  const requestedSourceVoiceScript = plan.sourceVoiceScript || plan.voiceScript || input.description;
  const expectedVoiceCache = {
    voiceGender: audioOptions.voiceGender,
    languageCode: toTtsLocaleCode(audioOptions.languageCode),
    sourceScriptHash: voiceCacheHash(requestedSourceVoiceScript || requestedVoiceScript),
    durationSeconds: Number(input.durationSeconds || 0)
  };

  // Attempt to fetch cached voice tracks from MongoDB draft to support instant gender switching
  try {
    const existingDraft = await VideoDraft.findOne({ jobId: context.jobId }).lean();
    if (existingDraft?.audio?.tracks) {
      cachedFemaleVoice = existingDraft.audio.tracks.voice_female || null;
      cachedMaleVoice = existingDraft.audio.tracks.voice_male || null;
      
      // If we already generated this specific gender, load it directly
      const targetCache = audioOptions.voiceGender === 'male' ? cachedMaleVoice : cachedFemaleVoice;
      if (isMatchingVoiceCache(targetCache, expectedVoiceCache)) {
        if (logger) logger(`Reusing cached ${audioOptions.voiceGender} ${expectedVoiceCache.languageCode} voice track: ${targetCache.path}`);
        voice = targetCache;
      }
    }
  } catch (draftError) {
    if (logger) logger(`⚠️ Failed to inspect cached voice tracks in MongoDB: ${draftError.message}`);
  }

  if (audioOptions.mode === 'auto' && !voice) {
    voice = await synthesizeVoiceTrack({
      voiceScript: requestedVoiceScript,
      sourceVoiceScript: requestedSourceVoiceScript,
      sceneData: plan.sceneData || [],
      languageCode: audioOptions.languageCode,
      voiceGender: audioOptions.voiceGender,
      voiceId: audioOptions.voiceId,
      targetDurationSeconds: input.durationSeconds,
      fitToDuration: audioOptions.fitVoiceToDuration,
      context,
      logger
    });

    // Update local cache records
    if (audioOptions.voiceGender === 'male') {
      cachedMaleVoice = voice;
    } else {
      cachedFemaleVoice = voice;
    }
  }

  return {
    enabled: true,
    mode: audioOptions.mode,
    durationSeconds: input.durationSeconds,
    tracks: {
      manual,
      voice,
      background,
      soundEffects: sfx,
      voice_female: cachedFemaleVoice,
      voice_male: cachedMaleVoice
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

  // ffmpeg can exit 0 having written nothing usable (bad filter graph, an
  // input that resolved to a 0-byte file). Returning the URL anyway gave the
  // UI a player it could never load — a silent 0:00 / 0:00. Verify instead.
  const assertPlayableOutput = async (outPath) => {
    const stat = await fs.promises.stat(outPath).catch(() => null);
    if (!stat || stat.size < 1024) {
      throw new Error(
        `Audio mix produced an unplayable file (${stat ? `${stat.size} bytes` : 'missing'}). ` +
        `Inputs: ${inputTracks.map((t) => `${t.label}=${path.basename(t.path)}`).join(', ')}`
      );
    }
  };

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
    await assertPlayableOutput(outputPath);
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
  await assertPlayableOutput(outputPath);
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
  context,
  onProgress = null,
  totalDuration = 0
}) {
  const outputPath = path.join(context.dirs.final, 'final_output.mp4');
  const outputUrl = buildMediaUrl(context.baseUrl, context.jobId, ['final', 'final_output.mp4']);

  if (!mergedAudio?.path && !subtitles?.path) {
    await fs.promises.copyFile(mergedVideo.path, outputPath);
    return { path: outputPath, url: outputUrl };
  }

  let syncedAudio = mergedAudio;
  let progressDuration = Number(totalDuration) || 0;
  if (mergedAudio?.path) {
    const videoDuration = await getMediaDurationSecondsFromFile(mergedVideo.path);
    const audioDuration = await getMediaDurationSecondsFromFile(mergedAudio.path);
    const targetDuration = Number.isFinite(videoDuration) && videoDuration > 0
      ? videoDuration
      : (Number(totalDuration) || 0);
    progressDuration = targetDuration || progressDuration;
    if (Number.isFinite(audioDuration) && audioDuration > 0 && targetDuration > 0) {
      const syncedPath = path.join(context.dirs.audio, 'final_audio_synced.m4a');
      const shouldRetempo = Math.abs(audioDuration - targetDuration) > AUDIO_SYNC_THRESHOLD_SECONDS;
      // Same cap as maybeStretchToTarget — apad/atrim absorbs whatever the
      // tempo limit leaves over, so the mix never speeds the voice up.
      const mixTempo = clamp(audioDuration / targetDuration, AUDIO_MAX_SLOWDOWN, AUDIO_MAX_SPEEDUP);
      const audioFilter = shouldRetempo && Math.abs(mixTempo - 1) > 0.005
        ? `atempo=${mixTempo.toFixed(3)},apad,atrim=0:${targetDuration.toFixed(3)}`
        : `apad,atrim=0:${targetDuration.toFixed(3)}`;
      await runFfmpeg([
        '-y',
        '-i', mergedAudio.path,
        '-vn',
        '-af', audioFilter,
        '-c:a', 'aac',
        '-b:a', '192k',
        syncedPath
      ]);
      syncedAudio = {
        ...mergedAudio,
        path: syncedPath,
        durationValidation: {
          videoDurationSeconds: targetDuration,
          originalAudioDurationSeconds: audioDuration,
          synced: true,
          retimed: shouldRetempo
        }
      };
    }
  } else if (subtitles?.path) {
    const videoDuration = await getMediaDurationSecondsFromFile(mergedVideo.path);
    if (Number.isFinite(videoDuration) && videoDuration > 0) {
      progressDuration = videoDuration;
    }
  }

  const args = ['-y', '-i', mergedVideo.path];
  if (syncedAudio?.path) {
    args.push('-i', syncedAudio.path);
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

  if (syncedAudio?.path) {
    args.push('-c:a', 'aac', '-b:a', '192k', '-shortest');
  } else {
    args.push('-an');
  }

  args.push(outputPath);
  await runFfmpeg(args, { onProgress, totalDuration: progressDuration || totalDuration });
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
  const context = createJobContext({ baseUrl: baseUrl || getPublicBaseUrl(), providedJobId, input });
  const product = await resolveProductContext({ user, payload: input });

  const update = (progress, currentStep, metadata = null) => {
    if (typeof onProgress === 'function') onProgress({ progress, currentStep, metadata });
  };
  const log = (message) => {
    if (typeof onLog === 'function') onLog(message);
  };

  console.log(`[${new Date().toISOString()}] [Job ID: ${context.jobId}] STEP 1: Prompt generation completed`);
  log(`STEP 1: Prompt generation completed`);

  update(5, 'generateScenes');
  log('Generating structured scene plan');
  const plan = await measureStep('generateScenes', () => generateScenesPlan({ input, product, user, logger: log }), log);

  console.log(`[${new Date().toISOString()}] [Job ID: ${context.jobId}] STEP 2: Scene generation completed. Storyboard with ${plan.scenes?.length} scenes generated successfully.`);
  log(`STEP 2: Scene generation completed`);

  // Attach input/plan/product/user to context so downstream steps
  // (generateSceneClips + prompt enrichment) can read them without
  // threading through every function signature.
  context.input = input;
  context.plan = plan;
  context.product = product;
  context.user = user;

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

  console.log(`[${new Date().toISOString()}] [Job ID: ${context.jobId}] STEP 3: Scene image generation completed`);
  log(`STEP 3: Scene image generation completed`);

  update(45, 'generateVideoClips');
  log('Rendering scene video clips');
  
  console.log(`[${new Date().toISOString()}] [Job ID: ${context.jobId}] STEP 4: Fal.ai render started`);
  log(`STEP 4: Fal.ai render started`);
  
  const scenesWithClips = await measureStep('generateVideoClips', () => generateSceneClips({
    scenes: scenesWithImages,
    context,
    logger: log,
    onSceneDone: (sceneIndex, totalScenes) => {
      const stepProgress = 45 + Math.round((sceneProgress(sceneIndex, totalScenes) / 100) * 20);
      update(stepProgress, 'generateVideoClips', { completed: sceneIndex + 1, total: totalScenes });
    }
  }), log);

  console.log(`[${new Date().toISOString()}] [Job ID: ${context.jobId}] STEP 5: Fal.ai render completed`);
  log(`STEP 5: Fal.ai render completed`);

  update(66, 'mergeVideo');
  log('Merging scene clips into final_video.mp4');
  
  console.log(`[${new Date().toISOString()}] [Job ID: ${context.jobId}] STEP 7: FFmpeg merge started (Video clips merge)`);
  log(`STEP 7: FFmpeg merge started`);
  
  const mergedVideo = await measureStep('mergeVideo', () => mergeSceneVideos({ scenes: scenesWithClips, context }), log);

  // Upload merged video (step 7 output) to Cloudinary so it survives restarts
  try {
    log('Uploading merged video to Cloudinary for permanent storage...');
    const mergedUpload = await uploadVideoFile(mergedVideo.path, 'nebula-merged-videos');
    if (mergedUpload?.success && mergedUpload?.url) {
      mergedVideo.url = mergedUpload.url;
      log(`Merged video uploaded to Cloudinary: ${mergedUpload.url}`);
    }
  } catch (uploadErr) {
    log(`Cloudinary upload (merged video) failed: ${uploadErr.message}`);
    console.error('[Cloudinary merged video upload failed]', uploadErr);
  }

  update(74, 'generateAudio');
  log('Preparing audio tracks');
  const audioTracks = await audioTracksPromise;

  console.log(`[${new Date().toISOString()}] [Job ID: ${context.jobId}] STEP 6: Audio generation completed`);
  log(`STEP 6: Audio generation completed`);

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
    context,
    totalDuration: input.durationSeconds || 60,
    onProgress: (pct) => {
      const overallPct = 92 + Math.round((pct / 100) * 4);
      update(overallPct, 'finalMerge');
    }
  }), log);

  console.log(`[${new Date().toISOString()}] [Job ID: ${context.jobId}] STEP 8: FFmpeg merge completed`);
  log(`STEP 8: FFmpeg merge completed`);

  // Upload final video to Cloudinary so it survives Render restarts.
  // Falls back to local URL if upload fails — never blocks the pipeline.
  let cloudFinalUrl = null;
  try {
    log('Uploading final video to Cloudinary for permanent storage...');
    const cloudUpload = await uploadVideoFile(finalOutput.path, 'nebula-final-videos');
    if (cloudUpload?.success && cloudUpload?.url) {
      cloudFinalUrl = cloudUpload.url;
      log(`Final video uploaded to Cloudinary: ${cloudUpload.url}`);
    }
  } catch (uploadErr) {
    log(`Cloudinary upload failed (using local URL as fallback): ${uploadErr.message}`);
    console.error('[Cloudinary final video upload failed]', uploadErr);
  }

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
    finalVideoUrl: cloudFinalUrl || finalOutput.url,
    finalOutputUrl: cloudFinalUrl || finalOutput.url,
    finalOutputCloudUrl: cloudFinalUrl || null,
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
  
  console.log(`[${new Date().toISOString()}] [Job ID: ${context.jobId}] STEP 9: Final DB update completed`);
  log(`STEP 9: Final DB update completed`);
  
  update(100, 'completed');

  return responsePayload;
}

async function runGenerateScenes({
  payload,
  user
}) {
  const input = normalizeCreateInput(payload);
  const product = await resolveProductContext({ user, payload: input });
  // Pass a console logger so the elaboration guard actually surfaces its
  // retry decisions in local backend output (Step 3 UI path).
  const stepLogger = (msg) => console.log('[generateScenes]', msg);
  const plan = await generateScenesPlan({ input, product, user, logger: stepLogger });
  return {
    success: true,
    sceneData: plan.scenes,
    totalDurationSeconds: plan.totalDurationSeconds,
    sceneCount: plan.sceneCount,
    globalVisualStyle: plan.globalVisualStyle,
    voiceScript: plan.voiceScript,
    thumbnailPrompt: plan.thumbnailPrompt,
    story: plan.story || null
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

  // Hydrate context with draft's input/plan/product/user so prompt
  // enrichment inside generateSceneClips has the full picture. Falls
  // back gracefully if the draft can't be loaded.
  try {
    if (payload?.jobId) {
      const draft = await VideoDraft.findOne({ jobId: payload.jobId }).lean();
      if (draft) {
        context.input = draft.input || {};
        context.plan = {
          scenes: draft.scenes || rawScenes,
          globalVisualStyle: draft?.scenesMetadata?.globalVisualStyle || ''
        };
        context.product = draft?.input?.product || null;
        if (draft.userId) {
          const draftUser = await User.findById(draft.userId).lean().catch(() => null);
          if (draftUser) context.user = draftUser;
        }
      }
    }
  } catch (hydrateErr) {
    if (typeof onLog === 'function') onLog(`Context hydration for generateClips failed: ${hydrateErr.message}`);
  }

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

// Rewrite the voiceover script using the "Voiceover Assistant" spec from
// the docx. Aims for natural, emotional, believable narration that sounds
// human — not AI marketing copy. Runs before TTS synthesis so ElevenLabs
// / Google TTS speaks the polished version.
async function enrichVoiceoverWithLLM({ voiceScript, sceneData, input, product, profile, languageCode, logger }) {
  const source = String(voiceScript || '').trim();
  if (!source) return { voiceScript: source, voiceType: null, speakingStyle: null };

  const durationSeconds = Number(input?.durationSeconds || 60) || 60;
  // Docx word budgets: 30s = 60-75, 45s = 90-110, 60s = 120-150
  // Interpolate for other durations at ~2.2 words/sec.
  const targetWords = Math.round(durationSeconds * 2.2);
  const minWords = Math.round(targetWords * 0.85);
  const maxWords = Math.round(targetWords * 1.15);

  const brandToneFromProfile = Array.isArray(profile?.brandVoice)
    ? profile.brandVoice.join(', ')
    : String(profile?.brandVoice || profile?.tone || 'Emotional');

  const sceneSummary = Array.isArray(sceneData) && sceneData.length
    ? sceneData.map((s, i) => `Scene ${i + 1}: ${s.title || ''} — ${s.voiceLine || ''}`).join('\n')
    : '';

  const isTamil = String(languageCode || 'en').toLowerCase().startsWith('ta');

  const systemPrompt = `You are an Elite Advertisement Voiceover Writer.
Your job is to create professional, emotional and natural-sounding voiceovers for commercial advertisements.

PRIMARY OBJECTIVE
Create voiceovers that sound like real humans.
The voiceover must feel: natural, emotional, conversational, believable, professional.
Avoid: cringe marketing language, overused advertising phrases, robotic wording, generic AI content.

VOICEOVER STYLE
Write like Tamil TV commercials, premium brand films, emotional storytelling ads, real conversations.
The voiceover should feel like someone is sharing a story — not selling a product.

BUSINESS CONTEXT
- Business Name: ${profile?.name || 'N/A'}
- Business Type / Industry: ${profile?.industry || 'N/A'}
- Products / Services: ${product?.name || profile?.description || 'N/A'}
- Target Audience: ${profile?.targetAudience || 'General audience'}
- Brand Tone / Core Emotion: ${brandToneFromProfile}

STORYBOARD (source material — align voiceover with the scene flow):
${sceneSummary || String(source).slice(0, 400)}

DURATION RULES
- Total duration: ${durationSeconds} seconds
- Target word count: ${targetWords} words (acceptable range: ${minWords}-${maxWords})
- Never exceed the requested duration.

IMPORTANT RULES
- Sound human. Sound emotional. Sound believable. Sound cinematic.
- NEVER repeat a sentence, phrase or idea. Every line must say something
  new. Do not restate the hook later, and do not echo the storyboard's
  wording back — the storyboard is context, not script to copy.
- hook, mainVoiceover and closingCta must not overlap in content.
- Stay inside the word budget. If you run out of things to say, stop early
  rather than padding with repetition.
- Create pauses naturally with short sentences and line breaks.
- Make every sentence easy to speak.
- Match the emotion of the storyboard.
- Match the business type.
- The output must feel like a real commercial — not an AI-generated script.
- Output MUST be directly usable in ElevenLabs / AI voice generators (plain text, no stage directions, no bracketed notes).

${isTamil ? `LANGUAGE — TAMIL REQUESTED
- Generate the voiceover naturally in spoken Tamil (do NOT translate word-by-word from English).
- Also provide a Tanglish (romanized Tamil) version for TTS compatibility.
- Set voiceScript to the Tamil version. Set tanglishVoiceScript to the romanized version.
` : `LANGUAGE
- English voiceover. Natural, conversational, cinematic tone.
`}

OUTPUT FORMAT — STRICT JSON ONLY
{
  "hook": "string — first 3-5 seconds that pull the viewer in",
  "mainVoiceover": "string — the middle body of the narration",
  "closingCta": "string — final memorable brand line",
  "voiceScript": "string — the full concatenated voiceover (hook + main + cta), ready for TTS",
  ${isTamil ? '"tanglishVoiceScript": "string — romanized Tamil version of voiceScript",' : ''}
  "estimatedDurationSeconds": number,
  "voiceType": "one of: Female Soft | Female Elegant | Female Luxury | Male Deep | Male Corporate | Male Storytelling | Young Adult | Elderly Narrator",
  "speakingStyle": "string — brief guidance for the TTS engine (pace, pauses, warmth)"
}
No markdown. No code fences. No prose outside the JSON.`;

  try {
    let raw;
    try {
      raw = await callOpenAI(systemPrompt, {
        temperature: 0.75,
        maxTokens: 2000,
        timeout: 90000,
        jsonMode: true
      });
    } catch (openAiErr) {
      if (logger) logger(`OpenAI voiceover enrichment failed, falling back to Gemini: ${openAiErr.message || openAiErr}`);
      raw = await callGemini(systemPrompt, {
        skipCache: true,
        temperature: 0.7,
        maxTokens: 2000,
        timeout: 90000
      });
    }
    const parsed = parseGeminiJSON(raw);
    // hook/main/cta frequently restate each other even when the prompt says
    // not to, and the joined form is the worst case — dedupe both paths.
    const enrichedScript = dedupeRepeatedSentences(
      String(parsed?.voiceScript || '').trim()
        || [parsed?.hook, parsed?.mainVoiceover, parsed?.closingCta].filter(Boolean).join(' ')
    );
    if (!enrichedScript) return { voiceScript: source, voiceType: null, speakingStyle: null };
    return {
      voiceScript: enrichedScript,
      tanglishVoiceScript: dedupeRepeatedSentences(parsed?.tanglishVoiceScript) || null,
      voiceType: String(parsed?.voiceType || '').trim() || null,
      speakingStyle: String(parsed?.speakingStyle || '').trim() || null,
      hook: String(parsed?.hook || '').trim() || null,
      cta: String(parsed?.closingCta || '').trim() || null
    };
  } catch (err) {
    if (logger) logger(`Voiceover enrichment failed, using storyboard voiceScript as-is: ${err.message || err}`);
    return { voiceScript: source, voiceType: null, speakingStyle: null };
  }
}

// Recommend background music per the "Commercial Music Director" spec.
// Analyzes the storyboard + voiceover and returns style/mood/instruments/
// tempo/reference-feel + opening/middle/ending music guidance. Stored on
// the draft for the UI to show and for future music-picker automation.
async function recommendMusicWithLLM({ voiceScript, sceneData, input, product, profile, logger }) {
  const durationSeconds = Number(input?.durationSeconds || 60) || 60;
  const brandToneFromProfile = Array.isArray(profile?.brandVoice)
    ? profile.brandVoice.join(', ')
    : String(profile?.brandVoice || profile?.tone || 'Emotional');

  const sceneSummary = Array.isArray(sceneData) && sceneData.length
    ? sceneData.map((s, i) => `Scene ${i + 1}: ${s.title || ''} — ${s.voiceLine || ''}`).join('\n')
    : '';

  const systemPrompt = `You are a Commercial Music Director for premium ad production.
Analyze the storyboard and voiceover, then recommend the background music that will most enhance the emotion of the advertisement.

BUSINESS CONTEXT
- Business: ${profile?.name || 'N/A'}
- Industry: ${profile?.industry || 'N/A'}
- Product: ${product?.name || 'N/A'}
- Brand Tone: ${brandToneFromProfile}
- Total Duration: ${durationSeconds} seconds

STORYBOARD:
${sceneSummary || 'N/A'}

VOICEOVER:
${String(voiceScript || '').slice(0, 800)}

Recommend the music using this framework:
- Music Style
- Mood
- Instruments
- Tempo (BPM range)
- Reference Feel (compare to one of: Tamil Emotional | Family Advertisement | Luxury Jewellery | Restaurant Commercial | Corporate Inspiration | Fashion Brand | Premium Product Commercial — or your own if none fit)
- Opening Music (first ~${Math.round(durationSeconds * 0.25)}s) — mood/direction for how the track opens
- Middle Music (middle section) — how energy builds
- Ending Music (last ~${Math.round(durationSeconds * 0.2)}s) — how it resolves and lands the brand

OUTPUT FORMAT — STRICT JSON ONLY
{
  "style": "string",
  "mood": "string",
  "instruments": ["string", "string"],
  "tempoBpm": number,
  "referenceFeel": "string",
  "openingMusic": "string",
  "middleMusic": "string",
  "endingMusic": "string"
}
No markdown. No code fences. No prose outside the JSON.`;

  try {
    let raw;
    try {
      raw = await callOpenAI(systemPrompt, {
        temperature: 0.6,
        maxTokens: 1000,
        timeout: 60000,
        jsonMode: true
      });
    } catch (openAiErr) {
      if (logger) logger(`OpenAI music recommendation failed, falling back to Gemini: ${openAiErr.message || openAiErr}`);
      raw = await callGemini(systemPrompt, {
        skipCache: true,
        temperature: 0.6,
        maxTokens: 1000,
        timeout: 60000
      });
    }
    const parsed = parseGeminiJSON(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      style: String(parsed.style || '').trim(),
      mood: String(parsed.mood || '').trim(),
      instruments: Array.isArray(parsed.instruments) ? parsed.instruments.map((x) => String(x).trim()).filter(Boolean) : [],
      tempoBpm: Number(parsed.tempoBpm) || null,
      referenceFeel: String(parsed.referenceFeel || '').trim(),
      openingMusic: String(parsed.openingMusic || '').trim(),
      middleMusic: String(parsed.middleMusic || '').trim(),
      endingMusic: String(parsed.endingMusic || '').trim()
    };
  } catch (err) {
    if (logger) logger(`Music recommendation failed: ${err.message || err}`);
    return null;
  }
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

  // Hydrate context so the enrichers can read business profile + product.
  let profileForEnrichment = {};
  let productForEnrichment = null;
  try {
    if (payload?.jobId) {
      const draft = await VideoDraft.findOne({ jobId: payload.jobId }).lean();
      if (draft) {
        productForEnrichment = draft?.input?.product || null;
        if (draft.userId) {
          const draftUser = await User.findById(draft.userId).lean().catch(() => null);
          if (draftUser?.businessProfile) profileForEnrichment = draftUser.businessProfile;
        }
      }
    }
  } catch (_) { /* soft-fail — enrichment will use defaults */ }

  // The Step 3 "Script & Scenes" flow (generateStoryAndSkeleton) writes
  // the FINAL voiceScript for this video. Do NOT re-enrich it here —
  // that used to run enrichVoiceoverWithLLM which rewrites the text
  // via a non-deterministic LLM, producing a different script on
  // every "Generate Preview" click (bad UX + broke script/audio
  // consistency after refresh). We use the Step 3 script verbatim.
  //
  // Enrichment only runs as a one-shot fallback when NO script exists
  // yet (e.g. user clicks Audio Preview without visiting Step 3).
  let enrichedVoice = null;
  const hasLockedScript = String(plan.voiceScript || '').trim().length > 20;
  if (!hasLockedScript) {
    enrichedVoice = await enrichVoiceoverWithLLM({
      voiceScript: plan.voiceScript,
      sceneData: plan.sceneData,
      input,
      product: productForEnrichment,
      profile: profileForEnrichment,
      languageCode: payload?.audio?.languageCode || 'en',
      logger: null
    });
    if (enrichedVoice?.voiceScript) {
      plan.voiceScript = enrichedVoice.voiceScript;
      plan.sourceVoiceScript = enrichedVoice.voiceScript;
    }
  }

  // STEP 6 (docx): Run in parallel with voice synthesis — recommend
  // background music. Result is returned to the caller for UI display
  // and saved on the draft.
  const musicRecommendationPromise = recommendMusicWithLLM({
    voiceScript: plan.voiceScript,
    sceneData: plan.sceneData,
    input,
    product: productForEnrichment,
    profile: profileForEnrichment,
    logger: null
  });

  const audioTracks = await generateAudioTracks({ input, plan, context });
  const musicRecommendation = await musicRecommendationPromise;
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
    enrichedVoiceover: enrichedVoice || null,
    musicRecommendation: musicRecommendation || null,
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

  const reportProgress = async (progress, currentStep, metadata = null) => {
    if (typeof onProgress === 'function') {
      await onProgress({ progress, currentStep, metadata });
    }
  };

  const logLine = (line) => {
    if (typeof onLog === 'function') onLog(String(line || '').trim());
  };

  const localClipPaths = await runWithConcurrency(sceneClips, MEDIA_IO_CONCURRENCY, async (clipSource, i) => {
    const source = String(sceneClips[i] || '').trim();
    if (!source) return null;
    const outputName = `scene_${i + 1}.mp4`;
    const outputPath = path.join(context.dirs.clips, outputName);
    await reportProgress(10 + Math.round((i / Math.max(1, sceneClips.length)) * 35), 'downloading_clips', {
      index: i + 1,
      total: sceneClips.length
    });
    logLine(`Downloading clip ${i + 1}/${sceneClips.length}`);
    await materializeSourceToFile({ source, destinationPath: outputPath });
    return outputPath;
  });
  const resolvedClipPaths = localClipPaths.filter(Boolean);

  await reportProgress(50, 'merging_clips');
  const scenes = resolvedClipPaths.map((clipPath, index) => ({
    index: index + 1,
    sceneId: `scene_${index + 1}`,
    clipPath
  }));

  const mergedVideo = await mergeSceneVideos({ scenes, context });

  // Upload merged video (step 7 output) to Cloudinary so it survives restarts
  let mergedVideoCloudUrl = null;
  try {
    logLine('Uploading merged video to Cloudinary for permanent storage...');
    const mergedUpload = await uploadVideoFile(mergedVideo.path, 'nebula-merged-videos');
    if (mergedUpload?.success && mergedUpload?.url) {
      mergedVideoCloudUrl = mergedUpload.url;
      mergedVideo.url = mergedUpload.url;
      logLine(`Merged video uploaded to Cloudinary: ${mergedUpload.url}`);
    }
  } catch (uploadErr) {
    logLine(`Cloudinary upload (merged video) failed: ${uploadErr.message}`);
    console.error('[Cloudinary merged video upload failed]', uploadErr);
  }

  let mergedAudio = null;
  const audioSource = String(payload?.finalAudioUrl || '').trim();
  if (audioSource) {
    const audioPath = path.join(context.dirs.audio, 'input_audio.mp3');
    await reportProgress(65, 'downloading_audio');
    logLine('Downloading final audio track');
    await materializeSourceToFile({ source: audioSource, destinationPath: audioPath });
    mergedAudio = {
      path: audioPath,
      url: buildMediaUrl(context.baseUrl, context.jobId, ['audio', 'input_audio.mp3'])
    };
  }

  let subtitles = null;
  if (payload?.subtitles?.enabled && Array.isArray(payload?.sceneData)) {
    await reportProgress(75, 'generating_subtitles');
    subtitles = await generateSrtFile({
      sceneData: payload.sceneData.map((scene, idx) => ensureSceneInputForClipStage(scene, idx)),
      context
    });
  }

  await reportProgress(88, 'merging_final_output');
  const finalOutput = await mergeFinalOutput({
    mergedVideo,
    mergedAudio,
    subtitles,
    context,
    totalDuration: Number(payload?.durationSeconds) || 60,
    onProgress: (pct) => {
      const overallPct = 88 + Math.round((pct / 100) * 10);
      reportProgress(overallPct, 'merging_final_output').catch(() => {});
    }
  });

  await reportProgress(95, 'uploading_to_cloud');
  // Upload final video to Cloudinary so it survives Render's ephemeral filesystem.
  // Falls back to local URL if upload fails — never blocks the pipeline.
  let cloudFinalUrl = null;
  try {
    logLine('Uploading final video to Cloudinary for permanent storage...');
    const upload = await uploadVideoFile(finalOutput.path, 'nebula-final-videos');
    if (upload?.success && upload?.url) {
      cloudFinalUrl = upload.url;
      logLine(`Final video uploaded to Cloudinary: ${upload.url}`);
    }
  } catch (uploadErr) {
    logLine(`Cloudinary upload failed (using local URL as fallback): ${uploadErr.message}`);
    console.error('[Cloudinary final video upload failed]', uploadErr);
  }

  await reportProgress(98, 'finalizing');
  return {
    success: true,
    jobId: context.jobId,
    finalVideoUrl: mergedVideo.url,
    finalOutputUrl: cloudFinalUrl || finalOutput.url,
    finalOutputCloudUrl: cloudFinalUrl || null,
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
  runMergeVideo,
  // Sequential v3 helpers (skeleton + per-scene enrichment)
  generateStoryAndSkeleton,
  generateSingleScene,
  normalizeCreateInput,
  // Low-level helpers exposed for the per-scene /generateSingleVideoClip route
  materializeSourceToFile,
  normalizeSceneVideoClip,
  createJobContext,
  // Pure text/timing helpers — exported so the narration rules (no repeated
  // sentences, no duplicated scene lines, capped tempo) can be unit tested.
  sentenceChunks,
  dedupeRepeatedSentences,
  buildFallbackSceneSkeleton,
  AUDIO_MAX_SPEEDUP,
  AUDIO_MAX_SLOWDOWN
};
