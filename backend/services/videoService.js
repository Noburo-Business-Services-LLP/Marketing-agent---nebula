const fs = require('fs');
const path = require('path');

const DEFAULT_MODEL = 'fal-ai/ltx-2.3-22b/text-to-video';
const IMAGE_TO_VIDEO_MODEL = 'fal-ai/ltx-2.3-22b/image-to-video';
const DEFAULT_SEED = 149063119;
const DEFAULT_NUM_FRAMES = 33;
const VIDEO_SIZE = { width: 288, height: 512 };

let falClientPromise = null;

function clamp(value, min, max) {
  const n = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function getScenePrompt(scene = {}) {
  return String(
    scene.video_prompt ||
      scene.videoPrompt ||
      scene.prompt ||
      scene.imagePrompt ||
      scene.title ||
      'Subtle cinematic motion for a short marketing video scene.'
  ).trim();
}

function getSceneImageUrl(scene = {}) {
  return String(scene.image_url || scene.imageUrl || '').trim();
}

function getMimeType(filePath = '') {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/jpeg';
}

function isLocalhostUrl(url = '') {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\//i.test(String(url || '').trim());
}

async function getFalClient() {
  const apiKey = String(process.env.FAL_KEY || '').trim();
  if (!apiKey) {
    throw new Error('FAL_KEY environment variable is required for Fal.ai video clip generation');
  }

  if (!falClientPromise) {
    falClientPromise = import('@fal-ai/serverless-client').then((mod) => {
      const fal = mod.default || mod;
      if (typeof fal.config === 'function') {
        fal.config({ credentials: apiKey });
      }
      return fal;
    });
  }

  return falClientPromise;
}

async function uploadSceneImageIfNeeded({ fal, scene, imageUrl }) {
  const imagePath = String(scene.imagePath || scene.image_path || '').trim();
  if (!imagePath) return imageUrl;
  if (imageUrl && !isLocalhostUrl(imageUrl)) return imageUrl;
  if (!fal.storage?.upload) return imageUrl;

  const buffer = await fs.promises.readFile(imagePath);
  const fileName = path.basename(imagePath) || 'scene.jpg';
  const blob = new Blob([buffer], { type: getMimeType(imagePath) });
  blob.name = fileName;
  return fal.storage.upload(blob);
}

function extractVideoUrl(result) {
  const candidates = [
    result?.video?.url,
    result?.data?.video?.url,
    result?.output?.video?.url,
    result?.url,
    result?.data?.url
  ];
  const url = candidates.find((item) => typeof item === 'string' && item.trim());
  if (!url) {
    throw new Error('Fal.ai response did not include a video URL');
  }
  return url.trim();
}

async function retry(label, fn, maxRetries = 2) {
  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
  }
  throw lastError || new Error(`${label} failed`);
}

async function generateVideoClip(scene = {}) {
  const fal = await getFalClient();
  const prompt = getScenePrompt(scene);
  const imageUrl = await uploadSceneImageIfNeeded({
    fal,
    scene,
    imageUrl: getSceneImageUrl(scene)
  });
  const model = imageUrl ? IMAGE_TO_VIDEO_MODEL : DEFAULT_MODEL;
  const numFrames = clamp(scene.num_frames || scene.numFrames || DEFAULT_NUM_FRAMES, 25, 33);
  const seed = Number.parseInt(String(scene.seed || DEFAULT_SEED), 10) || DEFAULT_SEED;

  const input = {
    prompt,
    num_frames: numFrames,
    video_size: VIDEO_SIZE,
    fps: 25,
    seed,
    generate_audio: false,
    use_multiscale: false
  };

  if (imageUrl) {
    input.image_url = imageUrl;
  }

  const result = await retry(
    `Fal.ai video clip for ${scene.sceneId || scene.id || 'scene'}`,
    () => fal.subscribe(model, { input }),
    2
  );

  const videoUrl = extractVideoUrl(result);
  return {
    ...scene,
    video_url: videoUrl,
    videoUrl,
    clipUrl: videoUrl,
    fal: {
      model,
      seed,
      num_frames: numFrames,
      width: VIDEO_SIZE.width,
      height: VIDEO_SIZE.height
    }
  };
}

async function generateVideoClips(scenes = []) {
  if (!Array.isArray(scenes) || scenes.length === 0) {
    throw new Error('At least one scene is required for video clip generation');
  }
  return Promise.all(scenes.map((scene) => generateVideoClip(scene)));
}

module.exports = {
  generateVideoClip,
  generateVideoClips
};
