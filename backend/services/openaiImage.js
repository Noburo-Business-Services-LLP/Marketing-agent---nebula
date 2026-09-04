const { uploadBase64Image } = require('./imageUploader');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_IMAGE_URL = 'https://api.openai.com/v1/images/generations';
const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';

function fetchWithTimeout(url, opts = {}, timeoutMs = 120000) {
  return new Promise(async (resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...opts, signal: controller.signal });
      resolve(res);
    } catch (err) {
      reject(err);
    } finally {
      clearTimeout(timer);
    }
  });
}

// gpt-image-1 only accepts these three sizes — map the app's aspect ratios to
// the closest one rather than failing on anything else.
function sizeForAspectRatio(aspectRatio) {
  const ratio = String(aspectRatio || '1:1').trim();
  if (ratio === '9:16' || ratio === '4:5') return '1024x1536';
  if (ratio === '16:9') return '1536x1024';
  return '1024x1024';
}

/**
 * The second image provider: Nano Banana stays primary everywhere, this is
 * only reached after both of its own attempts (nano-banana-pro-preview, then
 * gemini-2.5-flash-image) have already failed — a reliability fallback, not
 * a competing default.
 *
 * Deliberate limitation, stated rather than hidden: this does not carry
 * reference images. The whole point of Nano Banana being primary is that it
 * anchors to a real product/environment/logo/previous-slide photo when one
 * is selected; this fallback generates from the text prompt alone. That is
 * an acceptable trade for "something renders" over "nothing does", but it
 * is not feature parity, and a creative that leaned on a specific real
 * asset may look less anchored to it if this path is the one that succeeds.
 */
async function generateOpenAIImage(prompt, { aspectRatio } = {}) {
  if (!OPENAI_API_KEY) {
    return { success: false, error: 'OPENAI_API_KEY is not configured' };
  }

  try {
    const res = await fetchWithTimeout(OPENAI_IMAGE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: OPENAI_IMAGE_MODEL,
        prompt: String(prompt || '').slice(0, 4000),
        size: sizeForAspectRatio(aspectRatio),
        n: 1,
        quality: 'high'
      })
    }, 120000);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`OpenAI image HTTP ${res.status}: ${text.slice(0, 300)}`);
    }

    const data = await res.json();
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) {
      throw new Error('OpenAI returned no image data');
    }

    const base64Image = `data:image/png;base64,${b64}`;
    try {
      const uploadResult = await uploadBase64Image(base64Image, 'nebula-campaign-posts');
      if (uploadResult.success && uploadResult.url) {
        return { success: true, imageUrl: uploadResult.url, model: OPENAI_IMAGE_MODEL };
      }
    } catch (uploadErr) {
      console.warn('[OpenAI Image] Cloudinary upload failed, returning base64:', uploadErr.message);
    }
    return { success: true, imageUrl: base64Image, model: OPENAI_IMAGE_MODEL };
  } catch (error) {
    console.error('[OpenAI Image] Generation failed:', error.message);
    return { success: false, error: error.message };
  }
}

module.exports = { generateOpenAIImage };
