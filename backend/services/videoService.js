const fs = require('fs');
const path = require('path');
const { Blob: BufferBlob } = require('buffer');

const DEFAULT_MODEL = 'fal-ai/ltx-2.3-22b/text-to-video';
const IMAGE_TO_VIDEO_MODEL = process.env.FAL_IMAGE_TO_VIDEO_MODEL || 'fal-ai/kling-video/v1';
const DEFAULT_SEED = Number.parseInt(String(process.env.FAL_VIDEO_SEED || '-1'), 10);
const DEFAULT_NUM_FRAMES = 33;
const VIDEO_SIZE = {
  width: clamp(process.env.FAL_VIDEO_WIDTH || 576, 288, 1080),
  height: clamp(process.env.FAL_VIDEO_HEIGHT || 1024, 512, 1920)
};
const FAL_VIDEO_RESOLUTION = String(process.env.FAL_VIDEO_RESOLUTION || '1080p').trim();
const FAL_VIDEO_ASPECT_RATIO = String(process.env.FAL_VIDEO_ASPECT_RATIO || '9:16').trim();

let falClientPromise = null;

function clamp(value, min, max) {
  const n = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function getScenePrompt(scene = {}) {
  const basePrompt = String(
    scene.video_prompt ||
      scene.videoPrompt ||
      scene.prompt ||
      scene.imagePrompt ||
      scene.title ||
      'Subtle cinematic motion for a short marketing video scene.'
  ).trim();

  return [
    basePrompt,
    'Vertical 9:16 professional marketing video, high-detail 1080p look, sharp product details, clean edges, realistic materials, stable camera motion, natural lighting.',
    'Use smooth cinematic motion with minimal shake. Keep faces, hands, product packaging, logos, and object geometry consistent from frame to frame.',
    'Avoid pixelation, distortion, flicker, duplicated objects, warped text, noisy backgrounds, blur, compression artifacts, and low-resolution details.'
  ].filter(Boolean).join(' ');
}

function getSceneImageUrl(scene = {}) {
  return String(scene.image_url || scene.imageUrl || '').trim();
}

function isSeedanceModel(model = '') {
  return String(model || '').toLowerCase().includes('seedance');
}

function getSeedanceDuration(scene = {}) {
  const duration = Number.parseInt(String(scene.durationSeconds || scene.duration || 5), 10);
  return clamp(Number.isFinite(duration) ? duration : 5, 4, 12);
}

function getSeed(scene = {}) {
  const sceneSeed = Number.parseInt(String(scene.seed || ''), 10);
  if (Number.isFinite(sceneSeed)) return sceneSeed;
  if (Number.isFinite(DEFAULT_SEED)) return DEFAULT_SEED;
  return -1;
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
  console.log("Fal key exists:", !!process.env.FAL_KEY);
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
  if (!fal.storage?.upload) {
    throw new Error(
      'Cannot upload scene image to Fal.ai storage. ' +
      'This usually happens when `@fal-ai/serverless-client` is missing storage support. ' +
      'Upgrade the dependency and/or provide a publicly accessible image URL.'
    );
  }

  const buffer = await fs.promises.readFile(imagePath);
  const fileName = path.basename(imagePath) || 'scene.jpg';
  const BlobImpl = globalThis.Blob || BufferBlob;
  if (!BlobImpl) {
    throw new Error('Node.js Blob is not available. Upgrade Node.js to v18+ to upload images to Fal.ai.');
  }
  const blob = new BlobImpl([buffer], { type: getMimeType(imagePath) });
  blob.name = fileName;
  return fal.storage.upload(blob);
}

function extractVideoUrl(result) {
  console.log(`[Fal.ai Debug] Full Response JSON:`, JSON.stringify(result, null, 2));
  const candidates = [
    result?.video?.url,
    result?.data?.video?.url,
    result?.output?.video?.url,
    result?.url,
    result?.data?.url
  ];
  const url = candidates.find((item) => typeof item === 'string' && item.trim());
  if (!url) {
    console.error(`[Fal.ai Error] Missing video URL in response:`, JSON.stringify(result, null, 2));
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
      if (Number(error?.status) === 403) {
        break;
      }
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
  }
  throw lastError || new Error(`${label} failed`);
}

function mapFalError(error, model) {
  const status = Number(error?.status || 0);
  const message = String(error?.message || '').trim();
  if (status === 403 || /^forbidden$/i.test(message)) {
    return new Error(
      `Fal.ai access denied (403) for model "${model}". ` +
      `Your Fal.ai payment/subscription may be incomplete or inactive. ` +
      `Update \`FAL_KEY\` with a key that has access to this model, or set \`FAL_IMAGE_TO_VIDEO_MODEL\` to a model your key can use.`
    );
  }
  if (status === 401 || /^unauthorized$/i.test(message)) {
    return new Error('Fal.ai authentication failed (401). Check `FAL_KEY` in backend/.env.');
  }
  return error;
}

async function generateVideoClip(scene = {}) {
  const fal = await getFalClient();
  const prompt = getScenePrompt(scene);
  const imageUrl = await uploadSceneImageIfNeeded({
    fal,
    scene,
    imageUrl: getSceneImageUrl(scene)
  });

  if (imageUrl && !imageUrl.startsWith("https://")) {
    throw new Error(`Invalid public image URL for Fal.ai: ${imageUrl}. Must be a public HTTPS URL.`);
  }

  const model = imageUrl ? IMAGE_TO_VIDEO_MODEL : DEFAULT_MODEL;
  const numFrames = clamp(scene.num_frames || scene.numFrames || DEFAULT_NUM_FRAMES, 25, 33);
  const seed = getSeed(scene);
  const seedance = isSeedanceModel(model);

  const input = seedance
    ? {
        prompt,
        image_url: imageUrl,
        aspect_ratio: FAL_VIDEO_ASPECT_RATIO,
        resolution: FAL_VIDEO_RESOLUTION,
        duration: String(getSeedanceDuration(scene)),
        camera_fixed: false,
        seed,
        enable_safety_checker: true
      }
    : {
        prompt,
        num_frames: numFrames,
        video_size: VIDEO_SIZE,
        fps: 25,
        seed,
        generate_audio: false,
        use_multiscale: true
      };

  if (imageUrl && !seedance) {
    input.image_url = imageUrl;
  }

  const payload = { model, input };
  console.log("Fal request payload:", JSON.stringify(payload, null, 2));

  const startTime = Date.now();
  let result;
  try {
    result = await retry(
      `Fal.ai video clip for ${scene.sceneId || scene.id || 'scene'}`,
      async (attempt) => {
        console.log(`Fal render attempt ${attempt + 1} starting...`);
        const subStart = Date.now();
        const res = await fal.subscribe(model, { input });
        const subDuration = Date.now() - subStart;
        console.log(`Fal render attempt ${attempt + 1} completed in ${subDuration}ms. Status: Success`);
        return res;
      },
      2
    );
    const durationMs = Date.now() - startTime;
    console.log(`Scene ${scene.sceneId || scene.id || 'unknown'} render duration: ${durationMs}ms`);
    console.log("Fal response JSON:", JSON.stringify(result, null, 2));

    const videoUrl = extractVideoUrl(result);
    console.log("Fal response URL:", videoUrl);

    return {
      ...scene,
      video_url: videoUrl,
      videoUrl,
      clipUrl: videoUrl,
      fal: {
        model,
        seed,
        num_frames: seedance ? undefined : numFrames,
        width: seedance ? undefined : VIDEO_SIZE.width,
        height: seedance ? undefined : VIDEO_SIZE.height,
        aspect_ratio: seedance ? FAL_VIDEO_ASPECT_RATIO : undefined,
        resolution: seedance ? FAL_VIDEO_RESOLUTION : undefined,
        duration: seedance ? getSeedanceDuration(scene) : undefined
      }
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    console.error("Fal.ai Full Error:", JSON.stringify(error, null, 2));
    console.log(`Scene ${scene.sceneId || scene.id || 'unknown'} render duration: ${durationMs}ms`);
    // Surface as much detail as possible so the UI logger shows the real reason
    const detail =
      error.response?.data?.detail ||
      error.response?.data?.message ||
      (error.response?.data && JSON.stringify(error.response.data).slice(0, 400)) ||
      error.body?.detail ||
      error.body?.message ||
      (error.body && JSON.stringify(error.body).slice(0, 400)) ||
      error.message ||
      (typeof error === 'object' ? JSON.stringify(error).slice(0, 400) : String(error));
    const status = error.response?.status || error.status || error.statusCode || '?';
    throw new Error(`Fal.ai [${status}] model=${model}: ${detail}`);
  }
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
