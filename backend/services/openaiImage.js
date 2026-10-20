const { uploadBase64Image } = require('./imageUploader');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_IMAGE_URL = 'https://api.openai.com/v1/images/generations';
const OPENAI_IMAGE_EDIT_URL = 'https://api.openai.com/v1/images/edits';
// The edit endpoint takes several reference photos; more than this adds cost without helping.
const MAX_REFERENCE_IMAGES = 6;
// The newest image model is the default for post pictures. If the account cannot use it (not enabled, wrong name),
// the call is repeated once with gpt-image-1 so a picture still comes back.
const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2';
const OPENAI_IMAGE_SAFE_MODEL = 'gpt-image-1';
// The designed Blueprint PDF keeps its own model, because its price per page was worked out on gpt-image-1.
const BLUEPRINT_IMAGE_MODEL = process.env.OPENAI_BLUEPRINT_IMAGE_MODEL || 'gpt-image-1';

function fetchWithTimeout(url, opts = {}, timeoutMs = 120000) {
  // eslint-disable-next-line no-async-promise-executor -- the try/catch/finally inside settles it; the safeFetch guard test matches this text
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
// gpt-image-2 accepts free sizes (multiples of 16), so posts are made at their true shape instead of the nearest of three.
function exactSizeForAspectRatio(aspectRatio) {
  const ratio = String(aspectRatio || '1:1').trim();
  return { '1:1': '1024x1024', '4:5': '1024x1280', '9:16': '1024x1824', '16:9': '1824x1024', '3:4': '1024x1360' }[ratio] || null;
}

function sizeForAspectRatio(aspectRatio) {
  const ratio = String(aspectRatio || '1:1').trim();
  if (ratio === '9:16' || ratio === '4:5') return '1024x1536';
  if (ratio === '16:9') return '1536x1024';
  return '1024x1024';
}


function extFor(mime) {
  if (/png/i.test(mime)) return 'png';
  if (/webp/i.test(mime)) return 'webp';
  return 'jpg';
}

// Keeps only usable inline reference images ({ mimeType, data } base64) from a list of Gemini-style parts.
function referencesFromParts(parts) {
  const out = [];
  for (const part of Array.isArray(parts) ? parts : []) {
    const img = part && (part.inlineData || part.inline_data);
    const data = img && img.data;
    if (!data) continue;
    out.push({ mimeType: img.mimeType || img.mime_type || 'image/png', data });
    if (out.length >= MAX_REFERENCE_IMAGES) break;
  }
  return out;
}

/** Picture quality: low is a few paise, medium about a quarter of high. Callers choose; the default stays high. */
const QUALITIES = ['low', 'medium', 'high'];
const qualityOf = (q) => (QUALITIES.includes(q) ? q : (QUALITIES.includes(process.env.IMAGE_QUALITY_DEFAULT) ? process.env.IMAGE_QUALITY_DEFAULT : 'high'));

function buildEditForm(prompt, size, references, model = OPENAI_IMAGE_MODEL, quality = 'high') {
  const form = new FormData();
  form.append('model', model);
  form.append('prompt', String(prompt || '').slice(0, 4000));
  form.append('size', size);
  form.append('n', '1');
  form.append('quality', qualityOf(quality));
  references.forEach((ref, i) => {
    const bytes = Buffer.from(ref.data, 'base64');
    form.append('image[]', new Blob([bytes], { type: ref.mimeType }), `reference-${i + 1}.${extFor(ref.mimeType)}`);
  });
  return form;
}

/**
 * The second image provider: Nano Banana stays primary everywhere, this is
 * only reached after both of its own attempts (nano-banana-pro-preview, then
 * gemini-2.5-flash-image) have already failed — a reliability fallback, not
 * a competing default.
 *
 * Reference photos (cast, product, place, logo, previous slide) are sent through the
 * image-edit endpoint when the caller has them. Older note, now only true without references: this did not carry
 * reference images. The whole point of Nano Banana being primary is that it
 * anchors to a real product/environment/logo/previous-slide photo when one
 * is selected; this fallback generates from the text prompt alone. That is
 * an acceptable trade for "something renders" over "nothing does", but it
 * is not feature parity, and a creative that leaned on a specific real
 * asset may look less anchored to it if this path is the one that succeeds.
 */
async function generateOpenAIImage(prompt, { aspectRatio, references = [], quality } = {}) {
  if (!OPENAI_API_KEY) {
    return { success: false, error: 'OPENAI_API_KEY is not configured' };
  }

  try {
    const refs = Array.isArray(references) ? references.slice(0, MAX_REFERENCE_IMAGES) : [];
    const legacySize = sizeForAspectRatio(aspectRatio);
    let size = /gpt-image-2/.test(OPENAI_IMAGE_MODEL) && exactSizeForAspectRatio(aspectRatio) || legacySize;
    const call = (model) => (refs.length > 0
      // With reference photos, use the edit endpoint so the product, cast and place are matched.
      ? fetchWithTimeout(OPENAI_IMAGE_EDIT_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
        body: buildEditForm(prompt, size, refs, model, quality)
      }, 240000)
      : fetchWithTimeout(OPENAI_IMAGE_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          prompt: String(prompt || '').slice(0, 4000),
          size,
          n: 1,
          quality: qualityOf(quality)
        })
      }, 240000));

    let usedModel = OPENAI_IMAGE_MODEL;
    let res = await call(usedModel);
    if (!res.ok && usedModel !== OPENAI_IMAGE_SAFE_MODEL && [400, 403, 404].includes(res.status)) {
      const why = await res.clone().text().catch(() => '');
      if (/model|not found|does not exist|access|verif/i.test(why)) {
        console.warn(`[OpenAI Image] ${usedModel} was refused (HTTP ${res.status}); retrying with ${OPENAI_IMAGE_SAFE_MODEL}`);
        usedModel = OPENAI_IMAGE_SAFE_MODEL;
        res = await call(usedModel);
      }
    }

    if (!res.ok && res.status === 400 && size !== legacySize) {
      const why = await res.clone().text().catch(() => '');
      if (/size/i.test(why)) {
        console.warn(`[OpenAI Image] size ${size} was refused; retrying at ${legacySize}`);
        size = legacySize;
        res = await call(usedModel);
      }
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (res.status === 429 && /insufficient_quota|credit_balance|no credits/i.test(text)) {
        try { require('./opsAlerts').recordCritical('OpenAI', 'The account has no credits remaining.'); } catch (_) { /* alerting never blocks */ }
      }
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
        return { success: true, imageUrl: uploadResult.url, imageBase64: base64Image, model: usedModel };
      }
    } catch (uploadErr) {
      console.warn('[OpenAI Image] Cloudinary upload failed, returning base64:', uploadErr.message);
    }
    return { success: true, imageUrl: base64Image, imageBase64: base64Image, model: usedModel };
  } catch (error) {
    console.error('[OpenAI Image] Generation failed:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * One image straight to a Buffer, with no upload: for pages that code finishes before they are stored.
 * Portrait 1024x1536 at high quality. Never throws.
 */
async function generateOpenAIImageBuffer(prompt, { size = '1024x1536', model } = {}) {
  if (!OPENAI_API_KEY) return { success: false, error: 'OPENAI_API_KEY is not configured' };
  try {
    const res = await fetchWithTimeout(OPENAI_IMAGE_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: model || BLUEPRINT_IMAGE_MODEL, prompt: String(prompt || '').slice(0, 4000), size, n: 1, quality: 'high' })
    }, 180000);
    if (!res.ok) throw new Error(`OpenAI image HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    const data = await res.json();
    const b64 = data && data.data && data.data[0] && data.data[0].b64_json;
    if (!b64) throw new Error('OpenAI returned no image data');
    return { success: true, buffer: Buffer.from(b64, 'base64'), model: model || BLUEPRINT_IMAGE_MODEL };
  } catch (error) {
    console.error('[OpenAI Image] page generation failed:', error.message);
    return { success: false, error: error.message };
  }
}

/** Reads the text out of a picture with a small vision model. Returns '' when it cannot. Never throws. */
async function readTextFromImage(buffer, { model } = {}) {
  if (!OPENAI_API_KEY) return '';
  try {
    const res = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model || process.env.BLUEPRINT_VISION_MODEL || 'gpt-4o-mini',
        max_tokens: 900,
        messages: [{ role: 'user', content: [
          { type: 'text', text: 'Read every piece of text printed in this image, exactly as written, including numbers. Output only the text, one line per text element. Do not describe the picture.' },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${buffer.toString('base64')}` } }
        ] }]
      })
    }, 90000);
    if (!res.ok) return '';
    const data = await res.json();
    return String((data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '');
  } catch (error) {
    console.error('[OpenAI Vision] read failed:', error.message);
    return '';
  }
}

module.exports = { generateOpenAIImageBuffer, readTextFromImage, generateOpenAIImage, referencesFromParts, buildEditForm };
