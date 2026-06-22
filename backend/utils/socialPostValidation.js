const { URL } = require('url');

const MIN_SCHEDULE_LEAD_MINUTES = 5;
const DEFAULT_PLATFORMS = ['instagram'];
const SUPPORTED_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp']);
const SUPPORTED_VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'm4v', 'webm']);

function normalizePlatforms(platforms, fallback = DEFAULT_PLATFORMS) {
  const input = Array.isArray(platforms) ? platforms : [platforms];
  const normalized = input
    .map((platform) => String(platform || '').trim().toLowerCase())
    .filter(Boolean);

  return Array.from(new Set(normalized.length > 0 ? normalized : fallback));
}

function pickPrimaryMediaUrl(mediaUrls) {
  if (Array.isArray(mediaUrls)) {
    return mediaUrls.map((url) => String(url || '').trim()).find(Boolean) || null;
  }

  if (typeof mediaUrls === 'string' && mediaUrls.trim()) {
    return mediaUrls.trim();
  }

  return null;
}

function getExtensionFromUrl(mediaUrl) {
  if (!mediaUrl || typeof mediaUrl !== 'string') return '';

  try {
    const parsed = new URL(mediaUrl);
    const match = parsed.pathname.match(/\.([^.\/]+)$/);
    return match ? match[1].toLowerCase() : '';
  } catch (_) {
    const match = mediaUrl.match(/\.([^.?#]+)(\?|#|$)/);
    return match ? match[1].toLowerCase() : '';
  }
}

function getMediaKindFromExtension(extension) {
  if (SUPPORTED_IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (SUPPORTED_VIDEO_EXTENSIONS.has(extension)) return 'video';
  return null;
}

function sanitizeHashtags(rawHashtags = [], options = {}) {
  const max = Number.isFinite(options.max) ? options.max : 30;
  const source = Array.isArray(rawHashtags)
    ? rawHashtags
    : typeof rawHashtags === 'string'
      ? rawHashtags.split(/[\s,]+/)
      : [];

  const hashtags = source
    .map((tag) => String(tag || '').trim())
    .filter(Boolean)
    .map((tag) => `#${tag.replace(/^#+/, '')}`)
    .filter((tag) => /^#[A-Za-z0-9_]+$/.test(tag));

  return Array.from(new Set(hashtags)).slice(0, max);
}

function buildInstagramCaption(baseCaption = '', callToAction = '') {
  const cleanedCaption = String(baseCaption || '').trim();
  const lines = cleanedCaption
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const defaultHook = 'Stop scrolling: this one is worth your attention.';
  const defaultBody = 'Here is a campaign update designed to spark action.';
  let hook = lines[0] || defaultHook;

  if (hook.length < 12) {
    hook = defaultHook;
  } else if (!/[!?]/.test(hook) && !/^stop scrolling/i.test(hook)) {
    hook = `${hook} `;
  }

  const body = lines.length > 1 ? lines.join('\n\n') : (cleanedCaption || defaultBody);
  const cta = String(callToAction || '').trim() || 'Tap the link in bio to learn more.';

  return `${hook}\n\n${body}\n\n${cta}`.trim();
}

function normalizeScheduleDate(rawDate, options = {}) {
  if (!rawDate) {
    return {
      scheduleDate: null,
      adjusted: false,
      originalValue: rawDate || null,
      reason: null,
      minimumLeadMinutes: MIN_SCHEDULE_LEAD_MINUTES
    };
  }

  const now = options.now instanceof Date ? options.now : new Date();
  const minimumLeadMinutes = Number.isFinite(options.minimumLeadMinutes)
    ? options.minimumLeadMinutes
    : MIN_SCHEDULE_LEAD_MINUTES;
  const minimumDate = new Date(now.getTime() + minimumLeadMinutes * 60 * 1000);
  let parsed = new Date(rawDate);
  let adjusted = false;
  let reason = null;

  if (Number.isNaN(parsed.getTime())) {
    parsed = minimumDate;
    adjusted = true;
    reason = 'invalid';
  } else if (parsed.getTime() < minimumDate.getTime()) {
    parsed = minimumDate;
    adjusted = true;
    reason = 'too_soon';
  }

  return {
    scheduleDate: parsed.toISOString(),
    adjusted,
    originalValue: rawDate,
    reason,
    minimumLeadMinutes
  };
}

async function getFetchFn() {
  if (typeof global.fetch === 'function') {
    return global.fetch.bind(global);
  }

  const mod = await import('node-fetch');
  return mod.default;
}

async function fetchWithTimeout(fetchFn, url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetchFn(url, {
      ...options,
      redirect: options.redirect || 'follow',
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function validateMediaUrl(mediaUrl, options = {}) {
  if (!mediaUrl || typeof mediaUrl !== 'string' || !mediaUrl.trim()) {
    return { valid: false, reason: 'No media URL provided' };
  }

  const trimmedUrl = mediaUrl.trim();
  if (!/^https?:\/\//i.test(trimmedUrl)) {
    return { valid: false, reason: `Media URL must be public HTTP/HTTPS: ${trimmedUrl}` };
  }

  const extension = getExtensionFromUrl(trimmedUrl);
  const extensionKind = getMediaKindFromExtension(extension);
  if (extension && !extensionKind) {
    return {
      valid: false,
      reason: `Unsupported media extension .${extension}. Supported images: ${Array.from(SUPPORTED_IMAGE_EXTENSIONS).join(', ')}. Supported videos: ${Array.from(SUPPORTED_VIDEO_EXTENSIONS).join(', ')}`
    };
  }

  const fetchFn = await getFetchFn();

  try {
    let response = await fetchWithTimeout(fetchFn, trimmedUrl, { method: 'HEAD' }, options.timeoutMs);
    if (!response.ok || response.status === 401 || response.status === 403 || response.status === 405) {
      response = await fetchWithTimeout(fetchFn, trimmedUrl, { method: 'GET' }, options.timeoutMs);
    }

    if (!response.ok) {
      return { valid: false, reason: `HTTP ${response.status} ${response.statusText}` };
    }

    const contentTypeHeader = String(response.headers.get('content-type') || '').toLowerCase();
    const contentType = contentTypeHeader.split(';')[0].trim();
    let mediaKind = null;

    if (contentType.startsWith('image/')) {
      mediaKind = 'image';
    } else if (contentType.startsWith('video/')) {
      mediaKind = 'video';
    } else if (extensionKind) {
      mediaKind = extensionKind;
    } else {
      return {
        valid: false,
        reason: contentType ? `Invalid content-type ${contentType}` : 'Could not determine media type'
      };
    }

    if (options.expectedMediaKind && options.expectedMediaKind !== mediaKind) {
      return {
        valid: false,
        reason: `Expected ${options.expectedMediaKind} media but received ${mediaKind}`
      };
    }

    return {
      valid: true,
      url: trimmedUrl,
      mediaKind,
      extension,
      contentType,
      contentLength: response.headers.get('content-length')
    };
  } catch (error) {
    const message = error?.name === 'AbortError'
      ? 'Timed out while verifying public media URL'
      : `Unable to verify URL: ${error.message}`;
    return { valid: false, reason: message };
  }
}

async function validateAndNormalizePost(input = {}) {
  const platform = String(input.platform || 'instagram').trim().toLowerCase();
  const mediaUrl = pickPrimaryMediaUrl(input.mediaUrl || input.mediaUrls);
  const schedule = normalizeScheduleDate(input.scheduleDate);
  const hasAudio = platform === 'instagram' && typeof input.audioUrl === 'string' && input.audioUrl.trim().length > 0;
  const hashtagLimit = platform === 'instagram' ? 25 : 30;
  const hashtags = sanitizeHashtags(input.hashtags, { max: hashtagLimit });
  const mediaValidation = mediaUrl ? await validateMediaUrl(mediaUrl) : null;

  if (mediaUrl && !mediaValidation?.valid) {
    throw new Error(`Media validation failed: ${mediaValidation.reason}`);
  }

  return {
    post: {
      platform,
      caption: platform === 'instagram'
        ? buildInstagramCaption(input.caption, input.callToAction)
        : String(input.caption || 'Check this out.').trim() || 'Check this out.',
      hashtags,
      imageDescription: String(input.imageDescription || '').trim() || 'Professional campaign creative',
      scheduleDate: schedule.scheduleDate
    },
    publishing: {
      mediaUrl,
      mediaType: hasAudio ? 'video' : (mediaValidation?.mediaKind || null),
      audioUrl: hasAudio ? input.audioUrl.trim() : null,
      scheduleDate: schedule.scheduleDate
    },
    adjustments: {
      scheduleAdjusted: schedule.adjusted,
      scheduleAdjustmentReason: schedule.reason
    }
  };
}

module.exports = {
  MIN_SCHEDULE_LEAD_MINUTES,
  buildInstagramCaption,
  normalizePlatforms,
  normalizeScheduleDate,
  pickPrimaryMediaUrl,
  sanitizeHashtags,
  validateAndNormalizePost,
  validateMediaUrl
};
