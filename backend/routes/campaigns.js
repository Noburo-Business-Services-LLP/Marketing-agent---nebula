/**
 * Campaign Routes
 * Full CRUD for marketing campaigns with social media posting
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { checkTrial, deductCredits, requireCredits } = require('../middleware/trialGuard');
const Campaign = require('../models/Campaign');
const User = require('../models/User');
const crypto = require('crypto');
const { callGemini, parseGeminiJSON, generateICPAndStrategy, generateCampaignImageNanoBanana } = require('../services/geminiAI');
// Import Ayrshare for social media posting
const { getPostStatus, retryPost: retryAyrsharePost, deletePost: deleteAyrsharePost } = require('../services/socialMediaAPI');
const {
  classifyInstagramPublishFailure,
  publishSocialPostWithSafetyWrapper
} = require('../services/instagram-fix');
const { URL } = require('url');

function isMongoTimeoutOrSelectionError(err) {
  const name = String(err?.name || '');
  const msg = String(err?.message || '');
  const blob = `${name} ${msg}`.toLowerCase();
  return (
    blob.includes('mongoserverselectionerror') ||
    blob.includes('mongonetworktimeouterror') ||
    blob.includes('timed out') ||
    blob.includes('ec onnreset') || // sometimes seen as ECONNRESET in logs
    blob.includes('econnreset')
  );
}

async function validateMediaUrl(mediaUrl) {
  if (!mediaUrl || typeof mediaUrl !== 'string') return { valid: false, reason: 'No media URL provided' };
  if (!/^https?:\/\//i.test(mediaUrl)) return { valid: false, reason: 'Media URL is not HTTP/HTTPS: ' + mediaUrl };

  const extMatch = mediaUrl.match(/\.([^.?#]+)(\?|#|$)/);
  const ext = extMatch ? extMatch[1].toLowerCase() : null;
  const supportedExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'mov'];

  if (ext && !supportedExts.includes(ext)) {
    return { valid: false, reason: `Unsupported media extension .${ext}. Supported: ${supportedExts.join(', ')}` };
  }

  try {
    // Try lightweight HEAD request to validate access. Some CDN/prefix may not support HEAD; fallback to GET.
    let fetchFn = global.fetch || (await import('node-fetch')).default;
    const headResp = await fetchFn(mediaUrl, { method: 'HEAD', redirect: 'follow', timeout: 12000 });
    if (headResp.ok) {
      const contentType = headResp.headers.get('content-type');
      const length = headResp.headers.get('content-length');
      if (contentType && !contentType.startsWith('image/') && !contentType.startsWith('video/')) {
        return { valid: false, reason: `Invalid content-type ${contentType}` };
      }
      return { valid: true, contentType, contentLength: length };
    }

    const getResp = await fetchFn(mediaUrl, { method: 'GET', redirect: 'follow', timeout: 12000 });
    if (!getResp.ok) {
      return { valid: false, reason: `HTTP ${getResp.status} ${getResp.statusText}` };
    }
    const contentType = getResp.headers.get('content-type');
    if (contentType && !contentType.startsWith('image/') && !contentType.startsWith('video/')) {
      return { valid: false, reason: `Invalid content-type ${contentType}` };
    }

    return { valid: true, contentType, contentLength: getResp.headers.get('content-length') };
  } catch (err) {
    return { valid: false, reason: `Unable to verify URL: ${err.message}` };
  }
}

/**
 * Normalize schedule date per requirements:
 * - Must be future at least 10 minutes from now
 * - ISO format string
 * - Null => immediate posting
 */
function normalizeScheduleDate(rawDate) {
  if (!rawDate) return null;

  const now = new Date();
  const minFutureMs = 10 * 60 * 1000;
  let target = new Date(rawDate);

  if (Number.isNaN(target.getTime())) {
    target = new Date(now.getTime() + minFutureMs);
  }

  if (target.getTime() < now.getTime() + minFutureMs) {
    target = new Date(now.getTime() + minFutureMs);
  }

  return target.toISOString();
}

function buildInstagramCaption(baseCaption = '', callToAction = '') {
  const hook = baseCaption.trim().split('\n')[0] || '🔥 Quick update:';
  const cta = callToAction.trim();
  const captionBody = baseCaption.trim() ? baseCaption.trim() : 'Check this out now!';

  const finalCTA = cta ? `${cta.trim()} ` : '';
  return `${hook}\n\n${captionBody}\n\n${finalCTA}Tap link in bio to learn more.`.trim();
}

function sanitizeHashtags(rawHashtags = []) {
  if (!Array.isArray(rawHashtags)) return [];
  const sanitized = rawHashtags
    .map((tag) => (typeof tag === 'string' ? tag.trim().replace(/^#+/, '#') : ''))
    .filter((tag) => /^#[A-Za-z0-9_]+$/.test(tag));
  return Array.from(new Set(sanitized)).slice(0, 25);
}

function isValidFacebookPostId(value) {
  const raw = String(value || '').trim();
  return /^\d{5,}_\d{5,}$/.test(raw);
}

function normalizeFacebookPostId(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return isValidFacebookPostId(raw) ? raw : '';
}

function extractFacebookPageId(value) {
  const normalized = normalizeFacebookPostId(value);
  if (!normalized) return '';
  return normalized.split('_')[0] || '';
}

function normalizeNumericId(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return /^\d+$/.test(raw) ? raw : '';
}

function parseFacebookPostUrl(rawUrl) {
  const urlValue = String(rawUrl || '').trim();
  if (!urlValue) return { pageId: '', postId: '' };

  try {
    const parsed = new URL(urlValue);
    const host = String(parsed.hostname || '').toLowerCase();
    if (!host.includes('facebook.com') && !host.includes('fb.com')) {
      return { pageId: '', postId: '' };
    }

    const pathname = String(parsed.pathname || '');
    const query = parsed.searchParams;

    const queryPostId =
      normalizeNumericId(query.get('fbid')) ||
      normalizeNumericId(query.get('story_fbid')) ||
      '';
    const queryPageId = normalizeNumericId(query.get('id')) || '';
    if (queryPostId && queryPageId) {
      return { pageId: queryPageId, postId: queryPostId };
    }

    const postsMatch = pathname.match(/\/posts\/(\d{5,})/i);
    if (postsMatch?.[1]) {
      const pathPageId =
        pathname.match(/^\/(\d{5,})(?:\/|$)/)?.[1] ||
        pathname.match(/\/pages\/[^/]+\/(\d{5,})\//i)?.[1] ||
        '';
      return { pageId: normalizeNumericId(pathPageId), postId: normalizeNumericId(postsMatch[1]) };
    }

    const videosMatch = pathname.match(/\/videos\/(\d{5,})/i);
    if (videosMatch?.[1]) {
      const pathPageId =
        pathname.match(/^\/(\d{5,})(?:\/|$)/)?.[1] ||
        pathname.match(/\/pages\/[^/]+\/(\d{5,})\//i)?.[1] ||
        '';
      return { pageId: normalizeNumericId(pathPageId), postId: normalizeNumericId(videosMatch[1]) };
    }

    if (queryPostId) {
      const setParam = String(query.get('set') || '').trim();
      const setPageIdMatch = setParam.match(/(?:^|\.)(?:pcb|pb)\.(\d{5,})(?:\.|$)/i);
      const guessedSetPageId = normalizeNumericId(setPageIdMatch?.[1] || '');
      return { pageId: queryPageId || guessedSetPageId, postId: queryPostId };
    }

    const reelMatch = pathname.match(/\/reel\/(\d{5,})/i);
    if (reelMatch?.[1]) {
      return { pageId: queryPageId, postId: normalizeNumericId(reelMatch[1]) };
    }
  } catch (error) {
    return { pageId: '', postId: '' };
  }

  return { pageId: '', postId: '' };
}

function buildFacebookPostId({ pageId = '', postId = '' } = {}) {
  const normalizedPageId = normalizeNumericId(pageId);
  const normalizedPostId = normalizeNumericId(postId);
  if (!normalizedPageId || !normalizedPostId) return '';
  return `${normalizedPageId}_${normalizedPostId}`;
}

function extractFacebookPostIdFromUrl(rawUrl, { fallbackPageId = '' } = {}) {
  const parsed = parseFacebookPostUrl(rawUrl);
  return normalizeFacebookPostId(
    buildFacebookPostId({
      pageId: parsed.pageId || fallbackPageId,
      postId: parsed.postId
    })
  );
}

function extractRawFacebookPostIdCandidate(payload = {}) {
  const posts = Array.isArray(payload?.posts) ? payload.posts : [];
  if (posts.length > 0) {
    const firstRaw = String(posts[0]?.fbId || posts[0]?.facebookPostId || '').trim();
    if (firstRaw) return firstRaw;
  }

  for (const post of posts) {
    const raw = String(post?.fbId || post?.facebookPostId || '').trim();
    if (raw) return raw;
  }

  return String(payload?.fbId || payload?.facebookPostId || '').trim();
}

function isValidInstagramPostId(value) {
  const raw = String(value || '').trim();
  return /^\d+$/.test(raw);
}

function normalizeInstagramPostId(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return isValidInstagramPostId(raw) ? raw : '';
}

function extractFacebookPostIdFromAyrsharePayload(payload = {}, options = {}) {
  const posts = Array.isArray(payload?.posts) ? payload.posts : [];
  const fallbackPageId =
    normalizeNumericId(options?.fallbackPageId || '') ||
    extractFacebookPageId(options?.existingFacebookPostId || '');

  if (posts.length > 0) {
    const firstPostFbId = normalizeFacebookPostId(posts[0]?.fbId || posts[0]?.facebookPostId || '');
    if (firstPostFbId) return firstPostFbId;
  }

  for (const post of posts) {
    const fbId = normalizeFacebookPostId(post?.fbId || post?.facebookPostId || '');
    if (fbId) return fbId;
  }

  const topLevelFbId = normalizeFacebookPostId(payload?.fbId || payload?.facebookPostId || '');
  if (topLevelFbId) return topLevelFbId;

  const topLevelPageId =
    normalizeNumericId(payload?.facebookPageId || payload?.fbPageId || payload?.pageId || payload?.page_id || '') ||
    fallbackPageId;
  const topLevelUrl = String(payload?.postUrl || payload?.url || payload?.link || '').trim();
  const fromTopLevelUrl = extractFacebookPostIdFromUrl(topLevelUrl, { fallbackPageId: topLevelPageId });
  if (fromTopLevelUrl) return fromTopLevelUrl;

  for (const post of posts) {
    const postPageId =
      normalizeNumericId(
        post?.facebookPageId ||
          post?.fbPageId ||
          post?.pageId ||
          post?.page_id ||
          post?.accountId ||
          ''
      ) ||
      topLevelPageId;
    const postUrl = String(post?.postUrl || post?.url || post?.link || '').trim();
    const fromPostUrl = extractFacebookPostIdFromUrl(postUrl, { fallbackPageId: postPageId });
    if (fromPostUrl) return fromPostUrl;
  }

  return '';
}

function getAyrsharePostLifecycleStatus(payload = {}) {
  return String(payload?.status || payload?.posts?.[0]?.status || '').trim().toLowerCase();
}

function isAyrsharePostLifecycleReady(status = '') {
  return ['success', 'posted', 'published'].includes(String(status || '').toLowerCase());
}

function isAyrsharePostLifecyclePending(status = '') {
  return ['processing', 'scheduled', 'pending', 'queued', 'in_progress'].includes(
    String(status || '').toLowerCase()
  );
}

const FACEBOOK_POST_ID_POLL_ATTEMPTS = 4;
const FACEBOOK_POST_ID_POLL_DELAY_MS = (() => {
  const raw = Number.parseInt(String(process.env.FACEBOOK_POST_ID_POLL_DELAY_MS || '15000'), 10);
  if (!Number.isFinite(raw)) return 15000;
  return Math.min(Math.max(raw, 5000), 30000);
})();

async function waitForFacebookPostIdFromAyrshare({
  profileKey = '',
  ayrsharePostId = '',
  initialPayload = null,
  fallbackPageId = '',
  existingFacebookPostId = ''
} = {}) {
  const immediate = extractFacebookPostIdFromAyrsharePayload(initialPayload || {}, {
    fallbackPageId,
    existingFacebookPostId
  });
  if (immediate) return immediate;

  const postId = String(ayrsharePostId || '').trim();
  if (!postId) return '';

  for (let attempt = 1; attempt <= FACEBOOK_POST_ID_POLL_ATTEMPTS; attempt += 1) {
    const statusResult = await getPostStatus(postId, { profileKey });
    if (!statusResult?.success || !statusResult?.data) {
      if (attempt < FACEBOOK_POST_ID_POLL_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, FACEBOOK_POST_ID_POLL_DELAY_MS));
      }
      continue;
    }

    const payload = statusResult.data || {};
    const fbId = extractFacebookPostIdFromAyrsharePayload(payload, {
      fallbackPageId,
      existingFacebookPostId
    });
    if (fbId) return fbId;

    const lifecycleStatus = getAyrsharePostLifecycleStatus(payload);
    if (!isAyrsharePostLifecyclePending(lifecycleStatus)) {
      break;
    }

    if (attempt < FACEBOOK_POST_ID_POLL_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, FACEBOOK_POST_ID_POLL_DELAY_MS));
    }
  }

  return '';
}

async function deleteScheduledAyrsharePostBeforeReschedule(postId, { profileKey, logger = console } = {}) {
  if (!postId || typeof postId !== 'string') {
    logger.warn('[Ayrshare Reschedule] Missing or invalid post ID. Skipping delete.');
    return {
      success: false,
      skipped: true,
      canScheduleReplacement: true,
      reason: 'missing_post_id'
    };
  }

  logger.log(`[Ayrshare Reschedule] Checking existing post before delete: ${postId}`);

  let statusResult = null;
  try {
    statusResult = await getPostStatus(postId, { profileKey });
    logger.log(`[Ayrshare Reschedule] Status response for ${postId}: ${JSON.stringify(statusResult?.data || {})}`);
  } catch (error) {
    logger.warn(`[Ayrshare Reschedule] Failed to fetch status for ${postId}: ${error.message || error}`);
  }

  const ayrshareStatus = String(
    statusResult?.data?.status ||
    statusResult?.data?.posts?.[0]?.status ||
    ''
  ).toLowerCase();

  if (['success', 'posted', 'published'].includes(ayrshareStatus)) {
    logger.log(`[Ayrshare Reschedule] Post ${postId} is already published. Skipping delete.`);
    return {
      success: true,
      skipped: true,
      canScheduleReplacement: true,
      status: ayrshareStatus,
      reason: 'already_published'
    };
  }

  logger.log(`[Ayrshare Reschedule] Deleting scheduled post ${postId} before rescheduling.`);
  const deleteResult = await deleteAyrsharePost(postId, { profileKey });
  logger.log(`[Ayrshare Reschedule] Delete result for ${postId}: ${JSON.stringify(deleteResult?.data || deleteResult || {})}`);

  if (deleteResult.success) {
    logger.log(`[Ayrshare Reschedule] Successfully deleted scheduled post ${postId}.`);
    return {
      success: true,
      deleted: true,
      canScheduleReplacement: true,
      status: ayrshareStatus || 'scheduled',
      data: deleteResult.data || null
    };
  }

  logger.warn(`[Ayrshare Reschedule] Delete failed for ${postId}: ${deleteResult.error || 'Unknown delete error'}`);
  return {
    success: false,
    deleted: false,
    canScheduleReplacement: ['success', 'posted', 'published'].includes(ayrshareStatus),
    status: ayrshareStatus || 'unknown',
    error: deleteResult.error || 'Failed to delete old scheduled post',
    data: deleteResult.data || null
  };
}

/** Generate validated social posts JSON for publishing. */
async function generateSocialMediaPosts(input) {
  const {
    platforms = ['instagram'],
    mediaUrl,
    audioUrl,
    caption = '',
    hashtags = [],
    imageDescription = '',
    scheduleDate = null,
    callToAction = ''
  } = input || {};

  const results = {
    posts: []
  };

  if (!mediaUrl || typeof mediaUrl !== 'string') {
    throw new Error('mediaUrl is required and must be a non-empty string');
  }

  const mediaValidation = await validateMediaUrl(mediaUrl);
  if (!mediaValidation.valid) {
    throw new Error(`Media validation failed: ${mediaValidation.reason}`);
  }

  const normalizedSchedule = normalizeScheduleDate(scheduleDate);
  const hashtagList = sanitizeHashtags(hashtags);
  const normalizedPlatforms = (Array.isArray(platforms) ? platforms : [platforms]).map((p) => String(p).toLowerCase());

  const hasInstagram = normalizedPlatforms.includes('instagram');
  const isInstagramAudio = hasInstagram && audioUrl && typeof audioUrl === 'string' && audioUrl.trim().length > 0;
  // IMPORTANT: `validateMediaUrl` can successfully validate media even when the remote
  // server returns a JSON `content-type` header for HEAD/blocked requests.
  // Use `mediaKind` (derived from extension + minimal type detection) to avoid
  // misclassifying a video as "image" (or vice-versa) when `content-type` is wrong.
  const derivedMediaType = mediaValidation?.mediaKind === 'video' ? 'video' : 'image';

  // Instagram post
  if (hasInstagram) {
    const instagramPost = {
      platform: 'instagram',
      caption: buildInstagramCaption(caption, callToAction),
      hashtags: hashtagList,
      imageDescription: imageDescription || 'Image for Instagram campaign',
      scheduleDate: normalizedSchedule,
      mediaType: isInstagramAudio ? 'video' : derivedMediaType,
      mediaUrl: isInstagramAudio ? mediaUrl : mediaUrl,
      audioUrl: isInstagramAudio ? audioUrl : null
    };
    results.posts.push(instagramPost);
  }

  // Other platforms
  const otherPlatforms = normalizedPlatforms.filter((p) => p !== 'instagram');
  for (const platform of otherPlatforms) {
    const otherPost = {
      platform,
      caption: caption || 'Check this out now!',
      hashtags: hashtagList,
      imageDescription: imageDescription || 'Media for social campaign',
      scheduleDate: normalizedSchedule,
      mediaType: derivedMediaType,
      mediaUrl,
      audioUrl: null
    };
    results.posts.push(otherPost);
  }

  if (results.posts.length === 0) {
    throw new Error('No valid platforms found. At least one platform is required.');
  }

  return results;
}


// Import image uploader for converting base64 to hosted URLs
const { ensurePublicUrl, ensurePublicAudioUrl, uploadBase64Audio, isBase64DataUrl } = require('../services/imageUploader');
// Media composer (image -> video + audio) for Instagram audio posts
const { composeImageToVideoWithAudio, validateVideoForInstagramPosting } = require('../services/mediaComposer');
const {
  normalizePlatforms: normalizePlatformsList,
  normalizeScheduleDate: normalizeScheduleDateDetails,
  pickPrimaryMediaUrl,
  validateAndNormalizePost
} = require('../utils/socialPostValidation');

// Import logo overlay service for compositing logos onto posters
const { overlayLogoAndUpload, replaceLogoAtBboxAndUpload } = require('../services/logoOverlay');

// Import BrandAsset model for fetching user's logos
const BrandAsset = require('../models/BrandAsset');
const BrandIntelligenceProfile = require('../models/BrandIntelligenceProfile');

// Import logo detection from Gemini
const { detectLogoInImage } = require('../services/geminiAI');
const { publishCampaignToSocial } = require('../services/campaignPublisher');
const { buildGenerationGuidelines } = require('../services/brandIntelligenceService');

async function resolveBrandIntelligenceContext(userId, businessProfile = {}) {
  const profile = await BrandIntelligenceProfile.findOne({ userId }).lean();
  const primaryLogoAsset =
    (await BrandAsset.findOne({ user: userId, type: 'logo', isPrimary: true }).sort({ createdAt: -1 })) ||
    (await BrandAsset.findOne({ user: userId, type: 'logo' }).sort({ createdAt: -1 }));

  const profileAssets = profile?.assets || {};
  const primaryLogoUrl = String(profileAssets.primaryLogoUrl || primaryLogoAsset?.url || '').trim();

  const profileForRules = {
    ...(profile || {}),
    assets: {
      ...profileAssets,
      primaryLogoUrl
    },
    hasBrandAssets: Boolean(
      profile?.hasBrandAssets ||
        primaryLogoUrl ||
        profileAssets?.primaryColor ||
        profileAssets?.secondaryColor ||
        profileAssets?.fontType ||
        profile?.brandName ||
        profile?.brandDescription
    ),
    hasPastPosts: Boolean(profile?.hasPastPosts || (profile?.pastPosts || []).length)
  };

  const guidelineBundle = buildGenerationGuidelines(profileForRules);

  const fallbackTone = Array.isArray(businessProfile?.brandVoice)
    ? String(businessProfile.brandVoice[0] || 'professional').toLowerCase()
    : String(businessProfile?.brandVoice || 'professional').toLowerCase();

  const effectiveTone = String(guidelineBundle?.effectiveProfile?.tone || fallbackTone || 'professional').toLowerCase();
  const visualTokens = profileForRules?.assets || {};
  const visualHints = [
    visualTokens.primaryColor ? `Primary color ${visualTokens.primaryColor}` : null,
    visualTokens.secondaryColor ? `Secondary color ${visualTokens.secondaryColor}` : null,
    visualTokens.fontType ? `Font style ${visualTokens.fontType}` : null
  ]
    .filter(Boolean)
    .join(', ');

  return {
    profile: profileForRules,
    guidelineBundle,
    effectiveTone,
    primaryLogoUrl,
    visualHints
  };
}

function isStrictBrandLockEnabled(brandCtx = {}) {
  return Boolean(brandCtx?.guidelineBundle?.strictMode);
}

function getBrandPalette(brandCtx = {}) {
  const primary = String(brandCtx?.profile?.assets?.primaryColor || '').trim();
  const secondary = String(brandCtx?.profile?.assets?.secondaryColor || '').trim();
  return [primary, secondary].filter(Boolean);
}

function buildStrictBrandLockText(brandCtx = {}) {
  const effective = brandCtx?.guidelineBundle?.effectiveProfile || {};
  const palette = getBrandPalette(brandCtx);
  const primary = String(palette[0] || '').trim();
  const secondary = String(palette[1] || '').trim();
  const fontType = String(brandCtx?.profile?.assets?.fontType || '').trim();
  const visualStyle = String(effective.visualStyle || '').trim();
  const writingStyle = String(effective.writingStyle || '').trim();
  const ctaStyle = String(effective.ctaStyle || '').trim();
  const tone = String(brandCtx?.effectiveTone || effective.tone || 'professional').trim();

  let strictText = 'BRAND LOCK (MANDATORY): ';
  strictText += `Use tone "${tone}" exactly and do not drift to other tones.`;
  if (writingStyle) strictText += ` Writing style must remain "${writingStyle}".`;
  if (ctaStyle) strictText += ` CTA style must remain "${ctaStyle}".`;
  if (visualStyle) strictText += ` Visual style must remain "${visualStyle}".`;
  if (palette.length) strictText += ` Use this color palette only: ${palette.join(' + ')}.`;
  if (primary && secondary) {
    strictText += ` Use ${primary} as the dominant background/gradient and ${secondary} for text, highlights, and contrast.`;
  } else if (primary) {
    strictText += ` Use ${primary} as the dominant color across the design.`;
  }
  strictText += ' Brand identity must override product appearance, and product colors must never become the main theme.';
  if (brandCtx?.primaryLogoUrl) {
    strictText += ' Keep the logo clearly visible (top center or top corner), properly integrated, and never hidden.';
  }
  if (fontType) strictText += ` Typography must follow "${fontType}".`;
  strictText += ' Do not use placeholders or generic styling that conflicts with this profile.';
  return strictText;
}

function buildBrandContextForImages(brandCtx = {}, fallback = {}) {
  const palette = getBrandPalette(brandCtx);
  return {
    companyName: String(brandCtx?.profile?.brandName || fallback.companyName || 'Brand').trim() || 'Brand',
    industry: String(fallback.industry || '').trim(),
    description: String(brandCtx?.profile?.brandDescription || fallback.description || '').trim(),
    targetAudience: String(fallback.targetAudience || '').trim(),
    brandVoice: String(brandCtx?.effectiveTone || fallback.brandVoice || 'professional').trim(),
    brandColors: palette,
    hasLogo: Boolean(brandCtx?.primaryLogoUrl),
    productLogo: brandCtx?.primaryLogoUrl || null
  };
}

const generationLocks = new Map();
const recentGenerationRequests = new Map();
const GENERATION_LOCK_TTL_MS = 8 * 60 * 1000;
const DUPLICATE_REQUEST_WINDOW_MS = 15000;

function buildGenerationSignature(payload = {}) {
  try {
    return crypto.createHash('sha1').update(JSON.stringify(payload)).digest('hex');
  } catch (_) {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

function tryAcquireGenerationLock(userId, signature) {
  const now = Date.now();
  const existingLock = generationLocks.get(String(userId));

  if (existingLock && now - existingLock.startedAt > GENERATION_LOCK_TTL_MS) {
    generationLocks.delete(String(userId));
  }

  const activeLock = generationLocks.get(String(userId));
  if (activeLock) {
    return { ok: false, reason: 'in_progress', lock: activeLock };
  }

  const recent = recentGenerationRequests.get(String(userId));
  if (recent && recent.signature === signature && now - recent.at < DUPLICATE_REQUEST_WINDOW_MS) {
    return { ok: false, reason: 'duplicate_recent' };
  }

  generationLocks.set(String(userId), { signature, startedAt: now });
  return { ok: true };
}

function releaseGenerationLock(userId, signature) {
  const key = String(userId);
  const lock = generationLocks.get(key);
  if (!lock) return;
  if (signature && lock.signature !== signature) return;
  generationLocks.delete(key);
  recentGenerationRequests.set(key, { signature: lock.signature, at: Date.now() });
}

async function enforceBrandProfileOnGeneratedPosts(
  posts,
  { brandCtx = {}, campaignName = '', objective = '', platforms = [] } = {}
) {
  if (!Array.isArray(posts) || posts.length === 0) return posts;
  if (!isStrictBrandLockEnabled(brandCtx)) return posts;

  const strictBrandText = buildStrictBrandLockText(brandCtx);
  const brandRules = brandCtx?.guidelineBundle?.instructions || '';

  const prompt = `You are a brand-governance editor.
Your task is to refine generated social posts so they are 100% aligned to the locked brand profile.

MANDATORY BRAND RULES:
${strictBrandText}
${brandRules}

CAMPAIGN CONTEXT:
- Campaign: ${campaignName || 'Campaign'}
- Objective: ${objective || 'awareness'}
- Platforms: ${(Array.isArray(platforms) ? platforms : []).join(', ') || 'instagram'}

OUTPUT REQUIREMENTS:
1. Keep the same number of posts and the same post order.
2. Keep each post's platform unchanged.
3. Keep each post's structure intact (caption + hashtags + contentTheme + imageDescription).
4. Improve wording only to match the locked brand tone/style/CTA.
5. Ensure imageDescription reflects the brand palette/tokens when relevant.
6. Return ONLY valid JSON:
{
  "posts": [
    {
      "platform": "instagram|linkedin|twitter|facebook",
      "caption": "refined caption",
      "hashtags": ["#tag1", "#tag2"],
      "contentTheme": "educational|promotional|engagement|storytelling|social_proof|problem_solution|behindthescenes",
      "imageDescription": "refined visual prompt"
    }
  ]
}

POSTS TO ALIGN:
${JSON.stringify(posts)}`;

  try {
    const refinedRaw = await callGemini(prompt, { temperature: 0.3, maxTokens: 8000, skipCache: true });
    const refined = parseGeminiJSON(refinedRaw);
    if (!Array.isArray(refined?.posts) || refined.posts.length !== posts.length) {
      return posts;
    }
    return refined.posts.map((p, idx) => ({
      platform: String(p?.platform || posts[idx]?.platform || '').toLowerCase(),
      caption: String(p?.caption || posts[idx]?.caption || ''),
      hashtags: Array.isArray(p?.hashtags) ? p.hashtags : posts[idx]?.hashtags || [],
      contentTheme: String(p?.contentTheme || posts[idx]?.contentTheme || 'promotional'),
      imageDescription: String(p?.imageDescription || posts[idx]?.imageDescription || '')
    }));
  } catch (error) {
    console.warn('Brand post enforcement pass failed, using original posts:', error.message || error);
    return posts;
  }
}

/**
 * GET /api/campaigns
 * Get all campaigns for the user with optional filters
 */
router.get('/', protect, async (req, res) => {
  try {
    const { status, platform, startDate, endDate, limit = 50 } = req.query;
    const userId = req.user.userId || req.user.id;
    
    // Build query
    const query = { userId };
    
    if (status && status !== 'all') {
      query.status = status;
    }
    
    if (platform) {
      query.platforms = { $in: [platform] };
    }
    
    if (startDate || endDate) {
      query['scheduling.startDate'] = {};
      if (startDate) query['scheduling.startDate'].$gte = new Date(startDate);
      if (endDate) query['scheduling.startDate'].$lte = new Date(endDate);
    }
    
    const campaigns = await Campaign.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));
    
    // For scheduled campaigns whose time has passed, verify with Ayrshare if actually posted
    const now = new Date();
    const scheduledPastDue = campaigns.filter(c => 
      c.status === 'scheduled' && 
      c.scheduledFor && 
      new Date(c.scheduledFor) < now &&
      c.socialPostId  // Must have an Ayrshare post ID to verify
    );
    
    if (scheduledPastDue.length > 0) {
      console.log(`🔍 Verifying ${scheduledPastDue.length} past-due scheduled campaigns with Ayrshare...`);
      
      // Get the user's Ayrshare profile key for API calls
      const user = await User.findById(userId);
      const profileKey = user?.ayrshare?.profileKey;
      
      for (const campaign of scheduledPastDue) {
        try {
          const statusResult = await getPostStatus(campaign.socialPostId, { profileKey });
          
          if (statusResult.success && statusResult.data) {
            const postData = statusResult.data;
            const resolvedFbIdFromStatus = extractFacebookPostIdFromAyrsharePayload(postData, {
              existingFacebookPostId: campaign?.facebookPostId || ''
            });
            // Check if Ayrshare confirms the post was actually published
            // Ayrshare returns status 'success' for posted, 'scheduled' for pending, 'error' for failed
            const ayrshareStatus = postData.status || 
              (postData.posts && postData.posts[0]?.status) || 
              'unknown';
            
            console.log(`📊 Campaign ${campaign._id} Ayrshare status: ${ayrshareStatus}`);
            
            if (resolvedFbIdFromStatus && campaign.facebookPostId !== resolvedFbIdFromStatus) {
              const existingSocialPostIds = campaign?.socialPostIds && typeof campaign.socialPostIds === 'object'
                ? campaign.socialPostIds
                : {};
              const nextSocialPostIds = {
                ...existingSocialPostIds,
                facebook: resolvedFbIdFromStatus
              };

              await Campaign.findByIdAndUpdate(campaign._id, {
                $set: {
                  facebookPostId: resolvedFbIdFromStatus,
                  socialPostIds: nextSocialPostIds
                }
              });

              campaign.facebookPostId = resolvedFbIdFromStatus;
              campaign.socialPostIds = nextSocialPostIds;
            }

            if (ayrshareStatus === 'success' || ayrshareStatus === 'posted') {
              // Ayrshare confirmed it was actually posted!
              await Campaign.findByIdAndUpdate(campaign._id, { 
                $set: { status: 'posted', publishedAt: now, ayrshareStatus: 'success', lastPublishError: null } 
              });
              campaign.status = 'posted';
              campaign.publishedAt = now;
              console.log(`✅ Confirmed posted: ${campaign.name}`);
            } else if (ayrshareStatus === 'error') {
              const classifiedFailure = classifyInstagramPublishFailure({
                success: false,
                data: postData,
                error: postData?.message || postData?.posts?.[0]?.message || ''
              });
              // Ayrshare says it failed
              const failureMessage =
                classifiedFailure?.userMessage ||
                postData?.message ||
                postData?.posts?.[0]?.message ||
                postData?.posts?.[0]?.errors?.[0]?.message ||
                postData?.errors?.[0]?.message ||
                'Ayrshare reported an error';

              const retryAvailable = !!postData?.retryAvailable;
              const normalized = Array.isArray(campaign.platforms)
                ? campaign.platforms.map((p) => String(p || '').toLowerCase()).filter(Boolean)
                : [];
              const isInstagramOnly = normalized.length === 1 && normalized[0] === 'instagram';

              const looksTransient = /cannot process your post at this time/i.test(failureMessage) || /please try your post again/i.test(failureMessage);
              const canRetry = retryAvailable || looksTransient;
              const retryCount = Number.isFinite(Number(campaign.publishResult?.retryCount))
                ? Number(campaign.publishResult.retryCount)
                : (campaign.publishResult?.retryRequestedAt ? 1 : 0);
              const maxRetries = (() => {
                const raw = process.env.INSTAGRAM_SCHEDULED_RETRY_MAX || process.env.IG_SCHEDULED_RETRY_MAX;
                const n = raw ? Number.parseInt(String(raw), 10) : NaN;
                if (Number.isFinite(n) && n >= 0 && n <= 10) return n;
                return 3;
              })();

              // If Instagram reports a transient error and Ayrshare allows retry, try once instead of reverting to Draft.
              if (canRetry && isInstagramOnly && campaign.socialPostId && retryCount < maxRetries) {
                try {
                  const campaignLooksLikeInstagramVideo = Boolean(
                    campaign?.creative?.instagramAudio?.url ||
                    campaign?.creative?.videoUrl ||
                    ['video', 'reel'].includes(String(campaign?.creative?.type || '').toLowerCase()) ||
                    (Array.isArray(campaign?.creative?.imageUrls) &&
                      campaign.creative.imageUrls.some((url) => /\.(mp4|mov|m4v|webm)(\?|#|$)/i.test(String(url || ''))))
                  );

                  if (campaignLooksLikeInstagramVideo) {
                    console.log(`[Instagram Retry] Rebuilding failed scheduled Instagram video payload for campaign ${campaign._id}.`);
                    const freshRetryRes = await publishCampaignToSocial(campaign);
                    const pendingId = freshRetryRes?.postId || campaign.socialPostId;
                    if (freshRetryRes?.success) {
                      const nextRetryCount = retryCount + 1;
                      await Campaign.findByIdAndUpdate(campaign._id, {
                        $set: {
                          status: 'posted',
                          publishedAt: now,
                          socialPostId: pendingId,
                          socialPostIds: { instagram: pendingId },
                          ayrshareStatus: 'success',
                          lastPublishError: null,
                          instagramAccountKey: freshRetryRes?.instagramFix?.accountKey || campaign.instagramAccountKey || null,
                          publishResult: {
                            verifiedError: postData || null,
                            retry: freshRetryRes?.data || freshRetryRes,
                            retryRequestedAt: now.toISOString(),
                            retryCount: nextRetryCount
                          }
                        }
                      });

                      campaign.status = 'posted';
                      campaign.publishedAt = now;
                      campaign.socialPostId = pendingId;
                      campaign.ayrshareStatus = 'success';
                      campaign.lastPublishError = null;
                      console.log(`🔁 Rebuilt and published Instagram video payload for ${campaign.name} (${pendingId})`);
                      continue;
                    }
                  }

                  const retryRes = await retryAyrsharePost(campaign.socialPostId, { profileKey });
                  const pendingId = retryRes?.data?.id || campaign.socialPostId;
                  if (retryRes?.success) {
                    const nextRetryCount = retryCount + 1;
                    const delayMinutes = Math.min(60, 5 * Math.pow(2, Math.max(0, nextRetryCount - 1))); // 5, 10, 20...
                    const nextAttemptAt = new Date(now.getTime() + delayMinutes * 60 * 1000);
                    await Campaign.findByIdAndUpdate(campaign._id, {
                      $set: {
                        status: 'scheduled',
                        scheduledFor: nextAttemptAt,
                        socialPostId: pendingId,
                        socialPostIds: { instagram: pendingId },
                        ayrshareStatus: 'pending',
                        lastPublishError: null,
                        publishResult: {
                          verifiedError: postData || null,
                          retry: retryRes?.data || retryRes,
                          retryRequestedAt: now.toISOString(),
                          retryCount: nextRetryCount
                        }
                      }
                    });

                    campaign.status = 'scheduled';
                    campaign.scheduledFor = nextAttemptAt;
                    campaign.socialPostId = pendingId;
                    campaign.ayrshareStatus = 'pending';
                    campaign.lastPublishError = null;
                    console.log(`🔁 Retried failed Instagram post for ${campaign.name} — pending (${pendingId}) (attempt ${nextRetryCount}/${maxRetries}, next check in ~${delayMinutes}m)`);
                    continue;
                  }
                } catch (retryError) {
                  console.warn(`⚠️ Retry failed for campaign ${campaign._id}:`, retryError?.message || retryError);
                }
              }

              // If it's transient/ retryable, do NOT revert to draft. Keep scheduled so user can retry later.
              if (canRetry && isInstagramOnly) {
                await Campaign.findByIdAndUpdate(campaign._id, {
                  $set: { status: 'scheduled', ayrshareStatus: 'error', lastPublishError: failureMessage }
                });
                campaign.status = 'scheduled';
                campaign.lastPublishError = failureMessage;
                console.log(`⏳ Instagram transient error persists; keeping scheduled: ${campaign.name}`);
              } else {
                await Campaign.findByIdAndUpdate(campaign._id, { 
                  $set: { status: 'draft', ayrshareStatus: 'error', lastPublishError: failureMessage } 
                });
                campaign.status = 'draft';
                campaign.lastPublishError = failureMessage;
                console.log(`❌ Ayrshare post failed: ${campaign.name}`);
              }
            } else {
              // Still scheduled/pending on Ayrshare side - don't change status
              console.log(`⏳ Still pending on Ayrshare: ${campaign.name} (status: ${ayrshareStatus})`);
            }
          }
        } catch (verifyError) {
          console.warn(`⚠️ Could not verify campaign ${campaign._id}:`, verifyError.message);
          // Don't change status if we can't verify
        }
      }
    }
    
    // After verification, filter out campaigns whose status changed and no longer matches the query
    const filteredCampaigns = (status && status !== 'all')
      ? campaigns.filter(c => c.status === status)
      : campaigns;

    // Get counts by status (re-fetch after potential updates)
    const mongoose = require('mongoose');
    const statusCounts = await Campaign.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId) } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);
    
    const counts = {
      all: 0,
      draft: 0,
      scheduled: 0,
      active: 0,
      posted: 0,
      archived: 0
    };
    
    statusCounts.forEach(s => {
      counts[s._id] = s.count;
      counts.all += s.count;
    });
    
    res.json({
      success: true,
      campaigns: filteredCampaigns,
      counts
    });
  } catch (error) {
    console.error('Get campaigns error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch campaigns', error: error.message });
  }
});

/**
 * GET /api/campaigns/icp-strategy
 * Returns stored ICP from DB. If none exists, generates via AI and saves.
 * Use ?regenerate=true to force fresh AI generation.
 */
router.get('/icp-strategy', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const bp = user.businessProfile || {};
    const forceRegenerate = req.query.regenerate === 'true';

    // If stored in DB and not forcing regenerate, return it
    if (!forceRegenerate && user.icpStrategy && user.icpStrategy.icp && user.icpStrategy.icp.summary) {
      console.log(`✅ Returning stored ICP for: ${bp.name || 'Unknown business'}`);
      return res.json({
        success: true,
        icp: user.icpStrategy.icp,
        channelStrategy: user.icpStrategy.channelStrategy || [],
        businessName: bp.name || 'Your Business'
      });
    }

    // Generate fresh via AI
    console.log(`🎯 Generating ICP & Strategy for: ${bp.name || 'Unknown business'}`);
    const result = await generateICPAndStrategy(bp);

    // Save to DB using $set to avoid validation issues with select:false fields
    const icpPayload = {
      icp: result.icp,
      channelStrategy: result.channelStrategy,
      generatedAt: new Date()
    };
    await User.findByIdAndUpdate(userId, { $set: { icpStrategy: icpPayload } });
    console.log(`💾 ICP saved to DB for user ${userId}`);

    res.json({
      success: true,
      icp: result.icp,
      channelStrategy: result.channelStrategy,
      businessName: bp.name || 'Your Business'
    });
  } catch (error) {
    console.error('ICP Strategy error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/campaigns/smart-populate-template
 * AI-assisted template filling to avoid placeholders like [Key Point 1]
 */
router.post('/smart-populate-template', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id || req.user._id;
    const { template, campaignName, campaignDescription, objective } = req.body;
    
    if (!template) {
      return res.status(400).json({ success: false, message: 'Template is required' });
    }

    const user = await User.findById(userId).select('businessProfile companyName');
    const bp = user?.businessProfile || {};
    const brandCtx = await resolveBrandIntelligenceContext(userId, bp);
    const strictBrandMode = isStrictBrandLockEnabled(brandCtx);
    const enforcedTone = strictBrandMode
      ? brandCtx.effectiveTone
      : String(brandCtx?.effectiveTone || bp?.brandVoice || 'professional').toLowerCase();
    const strictBrandText = strictBrandMode ? buildStrictBrandLockText(brandCtx) : '';

    const prompt = `You are a professional social media content editor. 
Your task is to fill in the bracketed placeholders in a post template with high-quality, meaningful content.

CAMPAIGN DETAILS:
- Name: ${campaignName || 'General'}
- Description: ${campaignDescription || 'N/A'}
- Objective: ${objective || 'awareness'}
- Tone to follow: ${enforcedTone || 'professional'}
${strictBrandMode ? `- ${strictBrandText}` : ''}
${brandCtx?.guidelineBundle?.instructions || ''}

TEMPLATE TO FILL:
${template}

RULES:
1. Replace every bracketed placeholder (e.g., [Key Point 1], [Tip 1], [Point], [Outcome], [Date/Time], [Location]) with REAL meaningful content based on the campaign details.
2. If details like Date/Location are not provided, invent realistic ones (e.g., "This Friday at 10 AM", "Our Online Event Hub").
3. DO NOT change the structure, symbols (like 🎯, •, 📸), or headings.
4. Keep the output EXACTLY the same format as the input template, just with placeholders filled.
5. ONLY leave "[Link]" or "[Your CTA Link]" as is.
6. Return ONLY the filled content. No introduction or extra text.`;

    const filledContent = await callGemini(prompt, { temperature: 0.7, maxTokens: 1000, skipCache: true });
    
    res.json({ success: true, filledContent: filledContent.trim() });
  } catch (error) {
    console.error('Smart populate error:', error);
    res.status(500).json({ success: false, message: 'Failed to populate template' });
  }
});

/**
 * PUT /api/campaigns/icp-strategy
 * Save user-edited ICP data to DB
 */
router.put('/icp-strategy', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { icp, channelStrategy } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const icpPayload = {
      icp: icp || user.icpStrategy?.icp,
      channelStrategy: channelStrategy || user.icpStrategy?.channelStrategy,
      generatedAt: new Date()
    };
    await User.findByIdAndUpdate(userId, { $set: { icpStrategy: icpPayload } });

    console.log(`💾 ICP edits saved for user ${userId}`);
    res.json({ success: true, message: 'ICP saved' });
  } catch (error) {
    console.error('ICP save error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/campaigns/generate-campaign-stream
 * SSE endpoint — generates campaign posts with AI images one by one, streaming each to the frontend
 */
router.post('/generate-campaign-stream', protect, checkTrial, async (req, res) => {
  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  let aborted = false;
  let generationLockSignature = null;
  let hasGenerationLock = false;
  req.on('close', () => { aborted = true; });

  try {
    const userId = req.user.userId || req.user.id;
    const user = await User.findById(userId);
    const bp = user?.businessProfile || {};

    // Parse params from request body (POST)
    const {
      campaignName, campaignDescription, objective,
      platforms: platformsInput, tone, aspectRatio,
      keyMessages, duration, startDate: startDateParam,
      preferredDays: daysInput, targetAge, targetGender,
      targetLocation, targetInterests, productLogo,
      linkedProduct
    } = req.body;

    generationLockSignature = buildGenerationSignature({
      route: 'generate-campaign-stream',
      campaignName,
      campaignDescription,
      objective,
      platformsInput,
      tone,
      aspectRatio,
      keyMessages,
      duration,
      startDateParam,
      daysInput,
      targetAge,
      targetGender,
      targetLocation,
      targetInterests,
      linkedProduct: linkedProduct
        ? {
            id: linkedProduct.id || null,
            name: linkedProduct.name || null,
            price: linkedProduct.price || null,
            currency: linkedProduct.currency || null
          }
        : null,
      hasLogo: Boolean(productLogo)
    });
    const lockAttempt = tryAcquireGenerationLock(userId, generationLockSignature);
    if (!lockAttempt.ok) {
      const duplicateMessage =
        lockAttempt.reason === 'duplicate_recent'
          ? 'Duplicate generate request detected. Please wait a few seconds before retrying.'
          : 'Campaign generation is already in progress. Please wait until it finishes.';
      sendEvent('error', { message: duplicateMessage, duplicateRequest: true });
      return res.end();
    }
    hasGenerationLock = true;

    const brandCtx = await resolveBrandIntelligenceContext(userId, bp);
    const brandDisplayName =
      String(brandCtx?.profile?.brandName || bp.companyName || bp.name || 'Brand').trim() || 'Brand';
    const strictBrandMode = isStrictBrandLockEnabled(brandCtx);
    const enforcedTone = strictBrandMode
      ? brandCtx.effectiveTone
      : String(tone || brandCtx.effectiveTone || 'professional').toLowerCase();
    const effectiveLogo = productLogo || brandCtx.primaryLogoUrl || null;
    const brandGuidelinesText = brandCtx?.guidelineBundle?.instructions || '';
    const visualHints = brandCtx?.visualHints || '';
    const strictBrandText = strictBrandMode ? buildStrictBrandLockText(brandCtx) : '';
    const lockedPaletteArray = getBrandPalette(brandCtx);
    const lockedPalette = lockedPaletteArray.join(', ');
    const primaryLockedColor = String(lockedPaletteArray[0] || '').trim();
    const secondaryLockedColor = String(lockedPaletteArray[1] || '').trim();

    const platforms = Array.isArray(platformsInput) ? platformsInput : (platformsInput ? platformsInput.split(',') : ['instagram']);
    const preferredDays = Array.isArray(daysInput) ? daysInput : (daysInput ? daysInput.split(',') : ['monday', 'wednesday', 'friday']);
    const startDate = startDateParam || new Date().toISOString().split('T')[0];
    const weeks = duration === '2weeks' ? 2 : 1;
    const numSlots = Math.min(preferredDays.length * weeks, 14);
    // Support multi-platform: Generate posts for all platforms for every slot
    const totalPosts = numSlots * platforms.length;

    // Deduct credits: 7 per individual post generated
    const creditCost = totalPosts * 7; 
    const creditResult = await deductCredits(userId, 'campaign_full', totalPosts, `AI campaign generation (${totalPosts} posts across ${platforms.length} platforms)`);
    if (!creditResult.success) {
      sendEvent('error', { message: creditResult.error, creditsExhausted: true });
      return res.end();
    }

    sendEvent('status', { message: 'Generating campaign content...', totalPosts });

    // Generate unique slot dates
    const slotDates = [];
    const start = new Date(startDate);
    let dayIdx = 0;
    while (slotDates.length < numSlots && dayIdx < 100) {
      const checkDate = new Date(start);
      checkDate.setDate(start.getDate() + dayIdx);
      const dayName = checkDate.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
      if (preferredDays.includes(dayName)) {
        slotDates.push({
          date: checkDate.toISOString().split('T')[0],
          time: '10:00',
          week: slotDates.length < preferredDays.length ? 1 : 2
        });
      }
      dayIdx++;
    }

    // Expand unique slots into per-post schedule mappings
    const scheduleDates = [];
    for (const slot of slotDates) {
      for (const platform of platforms) {
        scheduleDates.push({
          ...slot,
          platform: platform.trim().toLowerCase()
        });
      }
    }

    // Step 1: Generate all captions via Gemini (ROCI format prompt)
    const captionPrompt = `ROLE: You are a senior social media strategist and copywriter at a leading digital marketing agency. You craft high-converting, scroll-stopping social media campaigns for premium brands.

OBJECTIVE: You are a strict content generator. Your job is to STRICTLY follow and fill the provided template structures.

STRICTOR RULES:
- Do NOT change the format, do NOT remove sections, and do NOT convert content into paragraphs.
- Automatically fill ALL bullet points, numbered points, highlights, tips, outcomes, and sections with meaningful content based on the campaign details.
- Do NOT leave any placeholders like [Key Point 1], [Tip 1], [Point], or [Outcome].
- ONLY keep the CTA link field as "[Link]" or "[Your CTA Link]".
- Do NOT add any introduction, conversational filler, or extra commentary.
- Keep all headings, symbols, and markers (like colons :) exactly as they appear in the template.

CONTEXT:
- Brand: ${brandDisplayName} (${bp.industry || 'General'} industry)
- Campaign: "${campaignName}"${campaignDescription ? ` — ${campaignDescription}` : ''}
- Objective: ${objective || 'awareness'}
- Target audience: ${targetAge || '18-35'} age, ${targetGender || 'all'} gender${targetLocation ? ', located in ' + targetLocation : ''}${targetInterests ? ', interested in ' + targetInterests : ''}
- Platforms: ${platforms.join(', ')}
- Tone: ${enforcedTone || 'professional'}
${linkedProduct ? `- Featured Product: ${linkedProduct.name} - ${linkedProduct.currency || '$'}${linkedProduct.price}\n- Product Description: ${linkedProduct.description || 'N/A'}` : ''}
${visualHints ? `- Brand Visual Tokens: ${visualHints}` : ''}
${strictBrandText ? `- ${strictBrandText}` : ''}
${lockedPalette ? `- Locked Brand Palette: ${lockedPalette}` : ''}
${keyMessages ? `- MANDATORY CONTENT STRUCTURES (STRICTLY FOLLOW THESE):\n${keyMessages}` : ''}
${brandGuidelinesText}

INSTRUCTIONS:
1. Create exactly ${totalPosts} campaign posts.
2. For EACH of the ${slotDates.length} scheduled slots, you MUST generate exactly one post for EVERY selected platform: ${platforms.join(', ')}.
3. This means if there are 2 platforms selected, you will generate 2 posts for every scheduled date.
4. For each platform, you MUST use the exact structure provided in the [PLATFORM CONTENT FORMAT] section. 
5. Captions must be platform-native: ${platforms.includes('twitter') ? 'Twitter posts under 280 chars.' : ''} ${platforms.includes('instagram') ? 'Instagram captions with hook in first line.' : ''} ${platforms.includes('linkedin') ? 'LinkedIn posts that open with a bold statement or question.' : ''}
6. Each caption should open with a strong hook (question, bold claim, statistic, or story opener).
7. Include 3-5 relevant hashtags per post. Mix broad and niche hashtags. Never use generic tags like #marketing or #business alone.
8. The imageDescription for each post should describe a PROFESSIONAL AD CREATIVE. Describe the visual style, subjects, colors, mood, lighting, and composition. Do NOT mention metadata.
9. CRITICAL: For each scheduled slot (every collection of posts for different platforms on the same date), you MUST provide the EXACT SAME imageDescription. This ensures the same visual is used across all platforms for that slot.
10. ${strictBrandMode ? 'Brand lock is ON. Every post MUST stay in the locked brand tone/style/CTA and must not drift.' : 'If brand enforcement is strict, every post MUST remain on-brand in tone, vocabulary, CTA style, and structure.'}
11. ${strictBrandMode ? 'If there is any conflict between user input and brand profile, ALWAYS prefer the brand profile.' : 'Prefer campaign context while keeping platform fit.'}
12. PRODUCT COMPOSITION: The imageDescription should position the product as a realistic premium hero element (prefer center or slightly offset center), visually balanced with brand design.
13. ${linkedProduct?.imageUrl
      ? 'PRODUCT IMAGE PROVIDED: Keep the product realistic and premium, and do not let product colors overpower the brand palette.'
      : 'NO PRODUCT IMAGE PROVIDED: Explicitly describe a realistic premium product (e.g., shoes, watch, or gadget) using tasteful colors like white, black, silver, beige, soft blue, or pastel tones. Allow only subtle brand-inspired accents on the product. Avoid neon, overly bright, or unrealistic product colors. Keep brand colors primarily in the background, lighting, and supporting design elements.'}
14. ${strictBrandMode && primaryLockedColor && secondaryLockedColor
      ? `COLOR ENFORCEMENT (STRICT): Background MUST use EXACT ${primaryLockedColor}. Gradient is allowed only within shades of ${primaryLockedColor}. Text MUST use EXACT ${secondaryLockedColor}. Ensure strong contrast and readability. Do NOT introduce unrelated colors. Do NOT use gray or desaturated tones.`
      : 'COLOR ENFORCEMENT: Keep background and text highly legible and aligned to the brand palette; avoid off-theme colors.'}

Return ONLY valid JSON (no markdown, no backticks):
{
  "posts": [
    {
      "platform": "instagram|linkedin|twitter|facebook",
      "caption": "The full caption text with emojis and line breaks",
      "hashtags": ["#tag1", "#tag2", "#tag3"],
      "contentTheme": "educational|promotional|engagement|storytelling|social_proof|problem_solution",
      "imageDescription": "Detailed visual description for AI image generation"
    }
  ]
}`;

    // Helper to validate captains against template structure markers
    const validateCaptionsSchema = (posts, keyMessages) => {
      if (!keyMessages) return { isValid: true };
      
      const pTemplates = {};
      const blocks = keyMessages.split(/\n\n---\n\n/);
      blocks.forEach(block => {
        const match = block.match(/\[([A-Z]+) CONTENT FORMAT\]\n([\s\S]*)/);
        if (match) {
          const platform = match[1].toLowerCase();
          const lines = match[2].split('\n').filter(l => l.trim().length > 0);
          const mkrs = lines.map(l => {
            const cIdx = l.indexOf(':');
            return cIdx !== -1 ? l.substring(0, cIdx + 1).trim() : l.trim();
          }).filter(m => m.length > 2);
          pTemplates[platform] = mkrs;
        }
      });

      const errs = [];
      posts.forEach((post, i) => {
        const platform = post.platform?.toLowerCase();
        const mkrs = pTemplates[platform];
        
        if (mkrs) {
          const miss = mkrs.filter(m => !post.caption.includes(m));
          if (miss.length > 0) {
            errs.push(`Post ${i + 1} (${post.platform}) is missing markers: ${miss.join(', ')}`);
          }
        }

        // CRITICAL CHECK: Detect if any placeholders from the template were left unfilled
        const placeholderRegex = /\[[^\]]*[A-Z0-9][^\]]*\]/g;
        const foundPlaceholders = post.caption.match(placeholderRegex);
        
        if (foundPlaceholders && foundPlaceholders.length > 0) {
          // Filter out valid [Link] or [Your CTA Link] placeholders
          const realPlaceholders = foundPlaceholders.filter(p => 
            !p.toLowerCase().includes('link') && 
            !p.toLowerCase().includes('cta')
          );
          
          if (realPlaceholders.length > 0) {
            errs.push(`Post ${i + 1} (${post.platform}) still contains unfilled placeholders: ${realPlaceholders.join(', ')}`);
          }
        }
      });

      return { isValid: errs.length === 0, errorDetails: errs.join('; ') };
    };

    let attempts = 0;
    let maxAttempts = 3;
    let parsed = null;
    let currentPrompt = captionPrompt;

    while (attempts < maxAttempts) {
      if (aborted) return res.end();
      attempts++;
      
      if (attempts > 1) {
        sendEvent('status', { message: `Regenerating to fix formatting (Attempt ${attempts})...` });
      }

      const textRes = await callGemini(currentPrompt, { maxTokens: 8000, temperature: 0.85, skipCache: true });
      parsed = parseGeminiJSON(textRes);

      if (parsed?.posts?.length) {
        const validation = validateCaptionsSchema(parsed.posts, keyMessages);
        if (validation.isValid) {
          console.log(`✅ Content generation passed validation on attempt ${attempts}`);
          break;
        } else {
          console.log(`⚠️ Attempt ${attempts} failed validation: ${validation.errorDetails}`);
          // Update prompt with feedback for next attempt
          currentPrompt = `${captionPrompt}\n\nCRITICAL FIX REQUIRED: Your previous response failed validation with the following errors: ${validation.errorDetails}. 
- You MUST replace every single bracketed placeholder (e.g. [Key Point], [Tip], [Outcome]) with actual meaningful content. 
- Do NOT leave any square brackets except for [Link] or [Your CTA Link].
- Follow the structure STRICTLY while filling in the details. 
- DO NOT USE PARAGRAPHS.`;
        }
      } else if (attempts === maxAttempts) {
        sendEvent('error', { message: 'Failed to generate campaign content after multiple attempts' });
        return res.end();
      }
    }

    if (!parsed?.posts?.length) {
      sendEvent('error', { message: 'Failed to generate valid campaign content' });
      return res.end();
    }

    if (strictBrandMode) {
      const refinedPosts = await enforceBrandProfileOnGeneratedPosts(parsed.posts, {
        brandCtx,
        campaignName,
        objective,
        platforms
      });
      const refinedValidation = validateCaptionsSchema(refinedPosts, keyMessages);
      if (refinedValidation.isValid) {
        parsed.posts = refinedPosts;
      } else {
        console.warn('Skipping refined posts due to schema drift after brand lock pass:', refinedValidation.errorDetails);
      }
    }

    if (aborted) return res.end();

    sendEvent('status', { message: 'Content generated! Now creating images...', totalPosts });

    // Step 2: Generate images one by one and stream each
    const postsToProcess = parsed.posts.slice(0, totalPosts);
    const slotImageCache = new Map();

    for (let i = 0; i < postsToProcess.length; i++) {
      if (aborted) break;

      const post = postsToProcess[i];
      const schedule = scheduleDates[i] || { date: startDate, time: '10:00', week: 1, platform: platforms[i % platforms.length] };
      
      // Calculate which slot this belongs to (grouped by platforms per date)
      const slotIndex = Math.floor(i / platforms.length);

      // Only generate a new image if we haven't created one for this slot yet
      let imageResult;
      if (slotImageCache.has(slotIndex)) {
        imageResult = slotImageCache.get(slotIndex);
      } else {
        sendEvent('generating', { index: i, total: postsToProcess.length, message: `Generating image for slot ${slotIndex + 1}...` });
        
        imageResult = await generateCampaignImageNanoBanana(post.imageDescription, {
          aspectRatio: aspectRatio || '1:1',
          brandName: brandDisplayName,
          brandLogo: effectiveLogo || null,
          industry: bp.industry || '',
          tone: enforcedTone || 'professional',
          strictBrandLock: strictBrandMode,
          brandPalette: getBrandPalette(brandCtx),
          fontType: brandCtx?.profile?.assets?.fontType || '',
          postIndex: slotIndex, // Use slot index for image context
          totalPosts: numSlots,
          campaignTheme: campaignName,
          keyMessages: [keyMessages || '', visualHints || '', strictBrandText || '', brandGuidelinesText || ''].filter(Boolean).join('\n'),
          linkedProduct
        });
        
        slotImageCache.set(slotIndex, imageResult);
      }

      const postData = {
        id: `post-${i + 1}`,
        index: i,
        week: schedule.week,
        platform: post.platform?.toLowerCase() || schedule.platform,
        caption: post.caption,
        hashtags: Array.isArray(post.hashtags)
          ? post.hashtags.map(h => h.startsWith('#') ? h : `#${h}`)
          : ['#marketing'],
        imageUrl: imageResult.success ? imageResult.imageUrl : '',
        imageDescription: post.imageDescription || '',
        suggestedDate: schedule.date,
        suggestedTime: schedule.time,
        contentTheme: post.contentTheme || 'promotional',
        status: 'pending',
        model: imageResult.success ? imageResult.model : 'failed'
      };

      sendEvent('post', postData);
    }

    // Done
    const updatedUser = await User.findById(userId).select('credits.balance');
    sendEvent('complete', {
      totalPosts: postsToProcess.length,
      creditsRemaining: updatedUser?.credits?.balance ?? 0
    });

    res.end();

  } catch (error) {
    console.error('SSE campaign generation error:', error);
    sendEvent('error', { message: error.message || 'Failed to generate campaign' });
    res.end();
  } finally {
    const userId = req.user?.userId || req.user?.id;
    if (hasGenerationLock && userId && generationLockSignature) {
      releaseGenerationLock(userId, generationLockSignature);
    }
  }
});

/**
 * GET /api/campaigns/:id
 * Get a single campaign by ID
 */
router.get('/:id', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const campaign = await Campaign.findOne({ _id: req.params.id, userId });
    
    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }
    
    res.json({ success: true, campaign });
  } catch (error) {
    console.error('Get campaign error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch campaign', error: error.message });
  }
});

/**
 * POST /api/campaigns/upload-audio
 * Upload an audio file (base64 data URL) to Cloudinary for Instagram audio posts
 */
router.post('/upload-audio', protect, async (req, res) => {
  try {
    const { audioData, originalName } = req.body || {};

    if (!audioData || typeof audioData !== 'string') {
      return res.status(400).json({ success: false, message: 'audioData is required' });
    }

    const uploadResult = await uploadBase64Audio(audioData, 'nebula-instagram-audio');
    if (!uploadResult.success || !uploadResult.url) {
      return res.status(500).json({ success: false, message: 'Failed to upload audio', error: uploadResult.error });
    }

    res.json({
      success: true,
      url: uploadResult.url,
      publicId: uploadResult.publicId || null,
      originalName: originalName || null,
      bytes: uploadResult.bytes || null,
      format: uploadResult.format || null,
      duration: uploadResult.duration || null
    });
  } catch (error) {
    console.error('Upload audio error:', error);
    res.status(500).json({ success: false, message: 'Failed to upload audio', error: error.message });
  }
});

/**
 * POST /api/campaigns
 * Create a new campaign
 */
router.post('/', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    
    const campaignData = {
      ...req.body,
      userId
    };

    const campaign = new Campaign(campaignData);
    await campaign.save();
    
    // Notifications are automatically scheduled by the background scheduler
    if (campaign.status === 'scheduled' && campaign.scheduling?.startDate) {
      console.log(`📅 Campaign scheduled: ${campaign.name} - notifications will be sent automatically`);
    }
    
    res.status(201).json({ success: true, campaign });
  } catch (error) {
    console.error('Create campaign error:', error);
    res.status(500).json({ success: false, message: 'Failed to create campaign', error: error.message });
  }
});

/**
 * PATCH /api/campaigns/:id/post-ids
 * Manually set platform post IDs for ad creation/tracking fallback.
 */
router.patch('/:id/post-ids', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const campaign = await Campaign.findOne({ _id: req.params.id, userId });

    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    const hasFacebookField = Object.prototype.hasOwnProperty.call(req.body || {}, 'facebookPostId');
    const hasInstagramField = Object.prototype.hasOwnProperty.call(req.body || {}, 'instagramPostId');
    if (!hasFacebookField && !hasInstagramField) {
      return res.status(400).json({
        success: false,
        message: 'Provide facebookPostId and/or instagramPostId.'
      });
    }

    let nextFacebookPostId = campaign.facebookPostId;
    let nextInstagramPostId = campaign.instagramPostId;

    if (hasFacebookField) {
      const rawFacebookPostId = req.body?.facebookPostId;
      const trimmedFacebookPostId = String(rawFacebookPostId ?? '').trim();
      if (trimmedFacebookPostId) {
        const normalizedFacebookPostId = normalizeFacebookPostId(trimmedFacebookPostId);
        if (!normalizedFacebookPostId) {
          return res.status(400).json({
            success: false,
            message: 'facebookPostId must follow format "pageId_postId".'
          });
        }
        nextFacebookPostId = normalizedFacebookPostId;
      } else {
        nextFacebookPostId = null;
      }
    }

    if (hasInstagramField) {
      const rawInstagramPostId = req.body?.instagramPostId;
      const trimmedInstagramPostId = String(rawInstagramPostId ?? '').trim();
      if (trimmedInstagramPostId) {
        const normalizedInstagramPostId = normalizeInstagramPostId(trimmedInstagramPostId);
        if (!normalizedInstagramPostId) {
          return res.status(400).json({
            success: false,
            message: 'instagramPostId must be a numeric string.'
          });
        }
        nextInstagramPostId = normalizedInstagramPostId;
      } else {
        nextInstagramPostId = null;
      }
    }

    const nextSocialPostIds =
      campaign?.socialPostIds && typeof campaign.socialPostIds === 'object'
        ? { ...campaign.socialPostIds }
        : {};

    if (hasFacebookField) {
      if (nextFacebookPostId) {
        nextSocialPostIds.facebook = nextFacebookPostId;
      } else {
        delete nextSocialPostIds.facebook;
      }
    }

    if (hasInstagramField) {
      if (nextInstagramPostId) {
        nextSocialPostIds.instagram = nextInstagramPostId;
      } else {
        delete nextSocialPostIds.instagram;
      }
    }

    campaign.facebookPostId = nextFacebookPostId;
    campaign.instagramPostId = nextInstagramPostId;
    campaign.socialPostIds = Object.keys(nextSocialPostIds).length > 0 ? nextSocialPostIds : null;
    await campaign.save();

    res.json({
      success: true,
      message: 'Campaign post IDs updated successfully.',
      campaign
    });
  } catch (error) {
    console.error('Manual campaign post ID update error:', error);
    res.status(500).json({ success: false, message: 'Failed to update campaign post IDs', error: error.message });
  }
});

/**
 * PUT /api/campaigns/:id
 * Update an existing campaign
 */
router.put('/:id', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;

    const updatePayload = { ...(req.body || {}) };
    const hasFacebookField = Object.prototype.hasOwnProperty.call(updatePayload, 'facebookPostId');
    const hasInstagramField = Object.prototype.hasOwnProperty.call(updatePayload, 'instagramPostId');

    if (hasFacebookField) {
      const trimmedFacebookPostId = String(updatePayload.facebookPostId ?? '').trim();
      if (trimmedFacebookPostId) {
        const normalizedFacebookPostId = normalizeFacebookPostId(trimmedFacebookPostId);
        if (!normalizedFacebookPostId) {
          return res.status(400).json({
            success: false,
            message: 'facebookPostId must follow format "pageId_postId".'
          });
        }
        updatePayload.facebookPostId = normalizedFacebookPostId;
      } else {
        updatePayload.facebookPostId = null;
      }
    }

    if (hasInstagramField) {
      const trimmedInstagramPostId = String(updatePayload.instagramPostId ?? '').trim();
      if (trimmedInstagramPostId) {
        const normalizedInstagramPostId = normalizeInstagramPostId(trimmedInstagramPostId);
        if (!normalizedInstagramPostId) {
          return res.status(400).json({
            success: false,
            message: 'instagramPostId must be a numeric string.'
          });
        }
        updatePayload.instagramPostId = normalizedInstagramPostId;
      } else {
        updatePayload.instagramPostId = null;
      }
    }

    if (hasFacebookField || hasInstagramField) {
      const existingCampaign = await Campaign.findOne({ _id: req.params.id, userId }).select('socialPostIds');
      if (!existingCampaign) {
        return res.status(404).json({ success: false, message: 'Campaign not found' });
      }

      const nextSocialPostIds =
        existingCampaign?.socialPostIds && typeof existingCampaign.socialPostIds === 'object'
          ? { ...existingCampaign.socialPostIds }
          : {};

      if (hasFacebookField) {
        if (updatePayload.facebookPostId) {
          nextSocialPostIds.facebook = updatePayload.facebookPostId;
        } else {
          delete nextSocialPostIds.facebook;
        }
      }
      if (hasInstagramField) {
        if (updatePayload.instagramPostId) {
          nextSocialPostIds.instagram = updatePayload.instagramPostId;
        } else {
          delete nextSocialPostIds.instagram;
        }
      }

      updatePayload.socialPostIds = Object.keys(nextSocialPostIds).length > 0 ? nextSocialPostIds : null;
    }

    const campaign = await Campaign.findOneAndUpdate(
      { _id: req.params.id, userId },
      { $set: updatePayload },
      { new: true, runValidators: true }
    );
    
    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }
    
    // Notifications are automatically scheduled by the background scheduler
    if (campaign.status === 'scheduled' && campaign.scheduling?.startDate) {
      console.log(`📅 Campaign updated: ${campaign.name} - notifications will be sent automatically`);
    }
    
    res.json({ success: true, campaign });
  } catch (error) {
    console.error('Update campaign error:', error);
    res.status(500).json({ success: false, message: 'Failed to update campaign', error: error.message });
  }
});

/**
 * DELETE /api/campaigns/:id
 * Delete a campaign — also removes from Ayrshare & social platforms if posted/scheduled
 */
router.delete('/:id', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;

    const campaign = await Campaign.findOne({ _id: req.params.id, userId });

    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    // If this campaign was posted/scheduled on Ayrshare, delete it there first
    const socialPostIdsFromMap = (campaign.socialPostIds && typeof campaign.socialPostIds === 'object')
      ? Object.values(campaign.socialPostIds)
      : [];
    const attemptedPostIds = Array.from(new Set([...(socialPostIdsFromMap || []), campaign.socialPostId].filter(Boolean)));

    const deletedPostIds = [];

    if (attemptedPostIds.length > 0) {
      const user = await User.findById(userId);
      const profileKey = user?.ayrshare?.profileKey;

      for (const postId of attemptedPostIds) {
        console.log(`🗑️ Deleting post ${postId} from Ayrshare (campaign: ${campaign.name})`);
        const deleteResult = await deleteAyrsharePost(postId, { profileKey });

        if (deleteResult.success) {
          console.log(`✅ Ayrshare post ${postId} deleted successfully`);
          deletedPostIds.push(postId);
        } else {
          // Log but don't block — still delete from our DB
          console.warn(`⚠️ Ayrshare delete failed for ${postId}:`, deleteResult.error);
        }
      }
    }

    await Campaign.findByIdAndDelete(campaign._id);

    res.json({
      success: true,
      message: 'Campaign deleted',
      ayrshareDeleted: attemptedPostIds.length > 0 && deletedPostIds.length === attemptedPostIds.length,
      deletedPostIds,
      socialPostId: campaign.socialPostId || null,
      socialPostIds: campaign.socialPostIds || null
    });
  } catch (error) {
    console.error('Delete campaign error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete campaign', error: error.message });
  }
});

/**
 * POST /api/campaigns/:id/publish
 * Actually publish a campaign to social media using Ayrshare
 * Accepts optional platforms array in request body to override campaign platforms
 */
router.post('/:id/publish', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const campaign = await Campaign.findOne({ _id: req.params.id, userId });
    
    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }
    
    // Get the user's Ayrshare profile key for posting to their connected accounts
    const user = await User.findById(userId);
    const profileKey = user?.ayrshare?.profileKey;
    
    if (!profileKey) {
      console.warn('User does not have an Ayrshare profile key - already handled above');
    } else {
      console.log('Found user Ayrshare profileKey:', profileKey.substring(0, 20) + '...');
    }
    
    // Get the platforms from request body (user selected) or fall back to campaign platforms
    const platforms = normalizePlatformsList(req.body.platforms || campaign.platforms || ['instagram']);
    
    // Check if this is a scheduled post
    const requestedSchedule = normalizeScheduleDateDetails(req.body.scheduledFor);
    const scheduledFor = requestedSchedule.scheduleDate;
    const isScheduled = !!scheduledFor;
    let scheduleDateIso = null;
    let scheduleDateObj = null;

    if (requestedSchedule.adjusted && scheduledFor) {
      console.log(`âš ï¸ Schedule adjusted (${requestedSchedule.reason}) to ${scheduledFor}`);
    }
    
    if (isScheduled) {
      console.log('📅 Scheduling post for:', scheduledFor);
      // Validate schedule date is in the future and not too soon
      const schedDate = new Date(scheduledFor);
      const now = new Date();
      const MIN_SCHEDULE_LEAD_MINUTES = 5;
      const MIN_SCHEDULE_LEAD_MS = MIN_SCHEDULE_LEAD_MINUTES * 60 * 1000;

      if (isNaN(schedDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: `Invalid scheduled datetime. Received: ${scheduledFor}`
        });
      }
      if (schedDate <= now) {
        console.warn('⚠️ Schedule date is in the past:', scheduledFor, 'Current:', now.toISOString());
        return res.status(400).json({ 
          success: false, 
          message: `Schedule date must be in the future. Received: ${scheduledFor}, Current time: ${now.toISOString()}`
        });
      }

      if (schedDate.getTime() < now.getTime() + MIN_SCHEDULE_LEAD_MS) {
        console.warn('⚠️ Schedule date is too soon:', scheduledFor, 'Current:', now.toISOString());
        return res.status(400).json({
          success: false,
          message: `Schedule time must be at least ${MIN_SCHEDULE_LEAD_MINUTES} minutes in the future. Received: ${scheduledFor}, Current time: ${now.toISOString()}`
        });
      }

      scheduleDateIso = schedDate.toISOString();
      scheduleDateObj = schedDate;
    }
    
    if (!profileKey) {
      return res.status(400).json({
        success: false,
        message: 'No social accounts connected. Please go to Connect Socials and link your Instagram/Facebook account first.'
      });
    }

    const existingSocialPostIdsFromMap = (campaign.socialPostIds && typeof campaign.socialPostIds === 'object')
      ? Object.values(campaign.socialPostIds)
      : [];
    const existingAyrsharePostIds = Array.from(
      new Set([...(existingSocialPostIdsFromMap || []), campaign.socialPostId].filter((v) => typeof v === 'string' && v))
    );
    const preserveExistingSchedule = campaign.status === 'scheduled' && (!!campaign.scheduledFor || existingAyrsharePostIds.length > 0);
    const preDeletedAyrsharePostIds = new Set();
    const rescheduleDeleteWarnings = [];

    const persistPublishFailure = async (message, publishResult = null) => {
      try {
        // If we already have a scheduled Ayrshare post, do NOT revert to Draft on a failed reschedule attempt.
        // Keep the existing schedule and show the error instead.
        if (preserveExistingSchedule) {
          await Campaign.findByIdAndUpdate(campaign._id, {
            $set: {
              lastPublishError: message,
              publishResult: publishResult || null
            }
          });
          return;
        }

        const shouldClearScheduling = isScheduled || campaign.status === 'scheduled';
        const update = {
          status: 'draft',
          ayrshareStatus: 'error',
          lastPublishError: message,
          publishResult: publishResult || null
        };

        if (shouldClearScheduling) {
          update.scheduledFor = null;
          update.socialPostId = null;
          update.socialPostIds = null;
        }

        await Campaign.findByIdAndUpdate(campaign._id, { $set: update });
      } catch (e) {
        console.warn('Failed to persist publish failure details:', e?.message || e);
      }
    };

    if (isScheduled && existingAyrsharePostIds.length > 0) {
      console.log(`[Ayrshare Reschedule] Preparing to replace ${existingAyrsharePostIds.length} existing post(s) for campaign ${campaign._id}.`);

      for (const postId of existingAyrsharePostIds) {
        try {
          const deleteCheck = await deleteScheduledAyrsharePostBeforeReschedule(postId, { profileKey, logger: console });

          if (deleteCheck.deleted) {
            preDeletedAyrsharePostIds.add(postId);
            continue;
          }

          if (!deleteCheck.canScheduleReplacement) {
            const message = deleteCheck.error || 'Could not safely delete the previous scheduled post before rescheduling.';
            rescheduleDeleteWarnings.push({ postId, message, status: deleteCheck.status || 'unknown' });

            return res.status(409).json({
              success: false,
              message: 'Could not safely replace the old scheduled post. The existing scheduled post was not deleted, so the new schedule was not created to avoid duplicates.',
              code: 'RESCHEDULE_DELETE_FAILED',
              warnings: rescheduleDeleteWarnings
            });
          }

          if (!deleteCheck.success) {
            rescheduleDeleteWarnings.push({
              postId,
              message: deleteCheck.error || 'Delete skipped with warning',
              status: deleteCheck.status || 'unknown'
            });
          }
        } catch (e) {
          const message = e?.message || String(e);
          console.warn(`[Ayrshare Reschedule] Unexpected delete error for ${postId}:`, message);
          rescheduleDeleteWarnings.push({ postId, message, status: 'unknown' });

          return res.status(409).json({
            success: false,
            message: 'Reschedule was stopped because the old scheduled post could not be safely deleted.',
            code: 'RESCHEDULE_DELETE_FAILED',
            warnings: rescheduleDeleteWarnings
          });
        }
      }
    }

    // NOTE: We no longer delete existing scheduled Ayrshare posts *before* a new publish succeeds.
    // Deleting first can cause the campaign to lose its original schedule if the new publish fails.
    // Old scheduled posts (if any) are cleaned up after a successful publish.
    if (false && campaign.status === 'scheduled') {
      const socialPostIdsFromMap = (campaign.socialPostIds && typeof campaign.socialPostIds === 'object')
        ? Object.values(campaign.socialPostIds)
        : [];
      const existingPostIds = Array.from(
        new Set([...(socialPostIdsFromMap || []), campaign.socialPostId].filter((v) => typeof v === 'string' && v))
      );

      if (existingPostIds.length > 0) {
        console.log(`ðŸ”„ Rescheduling campaign ${campaign._id} â€” deleting ${existingPostIds.length} existing Ayrshare post(s) first...`);
        for (const postId of existingPostIds) {
          try {
            const deleteResult = await deleteAyrsharePost(postId, { profileKey });
            if (deleteResult.success) {
              console.log(`âœ… Deleted previous Ayrshare post ${postId}`);
            } else {
              console.warn(`âš ï¸ Failed to delete previous Ayrshare post ${postId}:`, deleteResult.error);
            }
          } catch (e) {
            console.warn(`âš ï¸ Error deleting previous Ayrshare post ${postId}:`, e.message || e);
          }
        }
      }
    }
    
    // Build the post content
    let postContent = campaign.creative?.textContent || campaign.creative?.caption || campaign.content || campaign.name;
    const mediaUrls = Array.isArray(campaign.creative?.imageUrls) ? campaign.creative.imageUrls : [];
    const normalizedPlatformsForDecision = Array.isArray(platforms)
      ? platforms.map((p) => String(p || '').toLowerCase())
      : [];
    const isInstagramForDecision = normalizedPlatformsForDecision.includes('instagram');
    const hasAudioForDecision =
      typeof campaign?.creative?.instagramAudio?.url === 'string' &&
      campaign.creative.instagramAudio.url.trim().length > 0;

    console.log('Decision:', {
      hasAudio: hasAudioForDecision,
      isInstagram: isInstagramForDecision,
      mode: (isInstagramForDecision && hasAudioForDecision) ? 'REEL' : 'IMAGE'
    });

    // IMPORTANT: Only treat this as a Reel/video when Instagram audio is present.
    // When there is NO audio, we always post the IMAGE to all platforms (even if Instagram-only).
    let mediaUrl = pickPrimaryMediaUrl(mediaUrls) || pickPrimaryMediaUrl(campaign.creative?.mediaUrl);
    
    // Debug logging for template poster publish
    console.log('📋 Campaign publish debug:');
    console.log('   - Campaign name:', campaign.name);
    console.log('   - textContent length:', campaign.creative?.textContent?.length || 0);
    console.log('   - imageUrls count:', mediaUrls.length);
    console.log('   - First imageUrl type:', mediaUrl ? (mediaUrl.startsWith('data:') ? 'base64' : mediaUrl.startsWith('http') ? 'URL' : 'unknown') : 'null');
    console.log('   - First imageUrl preview:', mediaUrl ? mediaUrl.substring(0, 100) + '...' : 'null');
    
    // Extract and limit hashtags for Instagram (max 5 per Ayrshare/Instagram rules)
    // First, extract all hashtags from the post content
    const hashtagRegex = /#\w+/g;
    const existingHashtags = postContent.match(hashtagRegex) || [];
    
    // Remove hashtags from post content (we'll add limited ones back)
    let cleanContent = postContent.replace(hashtagRegex, '').trim();
    // Remove duplicate newlines
    cleanContent = cleanContent.replace(/\n{3,}/g, '\n\n');
    
    // Get additional hashtags from captions field
    const captionHashtags = (campaign.creative?.captions?.match(hashtagRegex) || []);
    
    // Combine all hashtags, remove duplicates, and limit to 5 for Instagram
    const allHashtags = [...new Set([...existingHashtags, ...captionHashtags])];
    const maxHashtags = platforms.includes('instagram') ? 25 : 30;
    const limitedHashtags = sanitizeHashtags(allHashtags, { max: maxHashtags });
    
    // Format the full post with limited hashtags
    const ctaText = String(campaign.creative?.callToAction || '').replace(/_/g, ' ').trim();
    const baseCaption = platforms.includes('instagram')
      ? buildInstagramCaption(cleanContent, ctaText)
      : cleanContent;
    const fullPost = limitedHashtags.length > 0
      ? `${baseCaption}\n\n${limitedHashtags.join(' ')}`
      : baseCaption;
    
    console.log('Publishing to platforms:', platforms);
    console.log('Post content:', fullPost.substring(0, 100) + '...');
    console.log('Hashtags count:', limitedHashtags.length, '(limited from', allHashtags.length, ')');
    console.log('Media URL:', mediaUrl ? 'yes' : 'no');
    
    const instagramAudioUrlForStrict = campaign.creative?.instagramAudio?.url || null;
    const hasValidInstagramAudioForStrict =
      typeof instagramAudioUrlForStrict === 'string' &&
      instagramAudioUrlForStrict.trim().length > 0;
    const hasInstagramInPlatformsForStrict = platforms.some(p => String(p).toLowerCase() === 'instagram');
    const strictMediaUpload = hasInstagramInPlatformsForStrict && hasValidInstagramAudioForStrict;

    // If the image is a base64 data URL, upload to Cloudinary first
    if (mediaUrl && isBase64DataUrl(mediaUrl)) {
      console.log('📤 Uploading base64 image to Cloudinary...');
      try {
        const publicUrl = await ensurePublicUrl(mediaUrl, { strict: strictMediaUpload });
        if (publicUrl) {
          console.log('✅ Image uploaded, public URL:', publicUrl);
          mediaUrl = publicUrl;
        } else if (!strictMediaUpload) {
          console.warn('⚠️ Failed to upload image, posting without media');
          mediaUrl = null;
        }
      } catch (err) {
        if (strictMediaUpload) {
          const msg = `STOP: Cloudinary image upload failed (required for Instagram Reel). ${err?.message || String(err)}`;
          console.error(msg);
          await persistPublishFailure(msg);
          return res.status(400).json({ success: false, message: msg });
        }
        throw err;
      }
    }

    let mediaValidation = null;
    if (mediaUrl) {
      mediaValidation = await validateMediaUrl(mediaUrl);
      if (!mediaValidation.valid) {
        const msg = `Invalid media URL: ${mediaValidation.reason}`;
        console.error(msg);
        await persistPublishFailure(msg, { mediaValidation });
        return res.status(400).json({ success: false, message: msg, mediaValidation });
      }
    }

    // ============================================
    // DUPLICATE CONTENT GUARD (prevents IG rejects)
    // ============================================
    const normalizedPlatforms = platforms;
    const includesInstagram = normalizedPlatforms.includes('instagram');
    if (includesInstagram) {
      const normalizeTextForHash = (s) => String(s || '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/[^\p{L}\p{N}\s#@.,!?'"()\-:/]/gu, '') // drop emojis/symbols; keep words + common punctuation
        .trim();

      const textForHash = normalizeTextForHash(fullPost);
      const mediaForHash = String(mediaUrl || '').trim();
      const publishHash = crypto
        .createHash('sha256')
        .update(`${textForHash}||${mediaForHash}`)
        .digest('hex');

      // Check last 48h for a matching publishHash to avoid Ayrshare/IG duplicate rejection.
      const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
      const dup = await Campaign.findOne({
        userId,
        _id: { $ne: campaign._id },
        publishHash,
        createdAt: { $gte: twoDaysAgo },
        status: { $in: ['scheduled', 'posted'] },
        platforms: { $in: ['instagram'] }
      }).select('_id name status scheduledFor publishedAt createdAt');

      if (dup) {
        const msg =
          'Duplicate or similar content detected for Instagram within the last 48 hours. ' +
          'Instagram may reject duplicate posts and risk your account. Please regenerate/modify the caption or change the image/audio and try again.';

        await Campaign.findByIdAndUpdate(campaign._id, {
          $set: { lastPublishError: msg, ayrshareStatus: 'error', publishHash }
        });

        return res.status(400).json({
          success: false,
          message: msg,
          error: msg,
          duplicateOf: {
            id: dup._id,
            name: dup.name,
            status: dup.status,
            scheduledFor: dup.scheduledFor,
            publishedAt: dup.publishedAt,
            createdAt: dup.createdAt
          }
        });
      }

      // Store the computed hash for this campaign so future attempts can compare.
      try {
        await Campaign.findByIdAndUpdate(campaign._id, { $set: { publishHash } });
      } catch (_) {}
    }
    
    const { resolveToneAudioUrl, getPublicBaseUrl } = require('../utils/toneAudio');
    const selectedTone = campaign?.tone || campaign?.creative?.tone || null;
    const instagramAudioUrl = campaign.creative?.instagramAudio?.url || null;
    const autoToneAudioUrl = resolveToneAudioUrl(selectedTone, { baseUrl: getPublicBaseUrl({ req }) });
    const effectiveInstagramAudioUrl = instagramAudioUrl || autoToneAudioUrl;
    
    // ============================================
    // INSTAGRAM AUDIO → VIDEO CONVERSION LOGIC
    // ============================================
    // STRICT validation: Only when platform is EXPLICITLY 'instagram' AND audio exists
    const hasInstagramInPlatforms = platforms.some(p => String(p).toLowerCase() === 'instagram');
    const hasValidInstagramAudio = !!effectiveInstagramAudioUrl && typeof effectiveInstagramAudioUrl === 'string' && effectiveInstagramAudioUrl.trim().length > 0;
    
    console.log('🔍 Instagram audio check:');
    console.log('   - Platform list:', platforms);
    console.log('   - Has Instagram platform:', hasInstagramInPlatforms);
    console.log('   - Tone:', selectedTone);
    console.log('   - Audio URL exists:', !!effectiveInstagramAudioUrl);
    console.log('   - Audio URL value:', effectiveInstagramAudioUrl ? `${effectiveInstagramAudioUrl.substring(0, 80)}...` : 'null');
    console.log('   - Will convert to video:', hasInstagramInPlatforms && hasValidInstagramAudio);
    
    const shouldAttachInstagramAudio = hasInstagramInPlatforms && hasValidInstagramAudio;

    // If Instagram audio is present, MUST compose a video. No fallback to image allowed.
    let instagramComposedVideoUrl = null;
    let composed = null; // keep scope available for post-stage logging/validation
    // Snapshot the composed result immediately after ffmpeg finishes.
    // Some later code paths may accidentally reassign `composed`, but we always
    // want to post based on the actual ffmpeg output we validated earlier.
    let composedSnapshot = null;

    if (shouldAttachInstagramAudio && mediaValidation?.mediaKind && mediaValidation.mediaKind !== 'image') {
      const msg = `Instagram audio requires an image base media. Received ${mediaValidation.mediaKind}.`;
      console.error(msg);
      await persistPublishFailure(msg, { mediaValidation });
      return res.status(400).json({ success: false, message: msg, mediaValidation });
    }
    if (shouldAttachInstagramAudio) {
      if (!mediaUrl) {
        const msg = '🚫 CRITICAL: Instagram audio requires a base image to attach to. No image found in campaign creative.';
        console.error(msg);
        await persistPublishFailure(msg);
        return res.status(400).json({ success: false, message: msg });
      }

      console.log('🎵 [AUDIO FLOW] Instagram audio detected — FORCING video composition...');
      console.log(`   - Audio URL: ${effectiveInstagramAudioUrl.substring(0, 80)}...`);
      console.log(`   - Base image URL: ${mediaUrl.substring(0, 80)}...`);
      
      const audioPublicUrl = await ensurePublicAudioUrl(effectiveInstagramAudioUrl);
      if (!audioPublicUrl) {
        const msg = '🚫 CRITICAL: Failed to prepare Instagram audio file. Please re-upload the audio and try again.';
        console.error(msg, { originalUrl: effectiveInstagramAudioUrl });
        await persistPublishFailure(msg);
        return res.status(400).json({ success: false, message: msg });
      }
      console.log(`   - Audio prepared (public URL): ${audioPublicUrl.substring(0, 80)}...`);

      const requestedDurationSeconds = campaign.creative?.instagramAudio?.durationSeconds || null;
      if (requestedDurationSeconds) {
        console.log(`   - Requested audio/video duration from campaign metadata: ${requestedDurationSeconds}s`);
      }

      console.log('🎬 [AUDIO FLOW] Composing video from image + audio using ffmpeg...');
      composed = await composeImageToVideoWithAudio({ imageUrl: mediaUrl, audioUrl: audioPublicUrl, requestedDurationSeconds });
      console.log('[DEBUG] Composed result assigned:', { success: composed?.success, hasVideoUrl: !!composed?.videoUrl, error: composed?.error });
      
      // Validate composition result immediately
      if (!composed || typeof composed !== 'object') {
        const msg = '🚫 CRITICAL: composeImageToVideoWithAudio returned null or invalid object';
        console.error(msg);
        await persistPublishFailure(msg);
        return res.status(500).json({ success: false, message: msg });
      }
      
      if (!composed.success || !composed.videoUrl) {
        // Video composition or validation failed
        const detailedError = composed.validation
          ? `Video validation failed:\n   Issues: ${composed.validation.issues.join('\n   ')}`
          : composed.error || 'ffmpeg or upload failed';
        
        const msg = `🚫 CRITICAL: Video composition failed. ${detailedError}. Cannot post Instagram content without valid video.`;
        console.error(msg);
        
        // Include validation details in failure response
        await persistPublishFailure(msg, {
          composer: composed,
          validation: composed?.validation || null,
          metadata: composed?.metadata || null
        });
        
        return res.status(500).json({
          success: false,
          message: msg,
          videoValidationFailed: true,
          validationDetails: composed?.validation || null,
          videoMetadata: composed?.metadata || null
        });
      }

      instagramComposedVideoUrl = composed?.videoUrl;
      composedSnapshot = composed;
      console.log(`✅ [AUDIO FLOW] Video successfully composed!`);
      console.log(`   - Composed video URL: ${instagramComposedVideoUrl?.substring(0, 80)}...`);
      console.log(`   - Duration: ${composed?.duration || 'unknown'}`);
      console.log(`   - Size: ${composed?.bytes || 'unknown'} bytes`);
      if (composed?.metadata) {
        console.log('\n✅ [VIDEO VALIDATION] Video metadata confirm:');
        console.log(`   - Format: ${composed.metadata.format}`);
        console.log(`   - Video codec: ${composed.metadata.video?.codec || 'unknown'}`);
        console.log(`   - Resolution: ${composed.metadata.video?.resolution || 'unknown'}`);
        console.log(`   - Frame rate: ${composed.metadata.video?.fps || 'unknown'} fps`);
        console.log(`   - Audio codec: ${composed.metadata.audio?.codec || 'unknown'}`);
      }
    } else {
      console.log('ℹ️ No Instagram audio attached — Using standard image posting flow');
    }

    const analyzeAyrshareResult = (r, calledPlatforms = []) => {
      let hasAyrshareError = false;
      let errorMessage = '';
      const platformPostIds = {};

      if (!r) {
        return {
          success: false,
          errorMessage: 'No response from Ayrshare',
          extractedPostId: null,
          platformPostIds
        };
      }

      // Check if top-level status is error
      if (r.data?.status === 'error') {
        hasAyrshareError = true;
        errorMessage = r.data?.message || 'Post failed';
      }

      const extractedFacebookPostId = extractFacebookPostIdFromAyrsharePayload(r.data || {}, {
        existingFacebookPostId: campaign?.facebookPostId || ''
      });
      if (extractedFacebookPostId) {
        platformPostIds.facebook = extractedFacebookPostId;
      }

      // Some Ayrshare responses include top-level errors even when status is not explicitly "error"
      if (!hasAyrshareError && Array.isArray(r.data?.errors) && r.data.errors.length > 0) {
        hasAyrshareError = true;
        const first = r.data.errors[0];
        errorMessage = first?.message || r.data?.message || 'Post failed';
      }

      // Check individual platform posts for errors and capture IDs
      if (r.data?.posts && Array.isArray(r.data.posts)) {
        const firstPost = r.data.posts[0] || {};
        const firstFbId = normalizeFacebookPostId(firstPost?.fbId || firstPost?.facebookPostId || '');
        if (firstFbId) {
          platformPostIds.facebook = firstFbId;
        }

        for (const post of r.data.posts) {
          const pid = post.id || post.postId;
          const plat = post.platform ? String(post.platform).toLowerCase() : null;
          if (pid && plat) platformPostIds[plat] = pid;

          const fbId = normalizeFacebookPostId(post?.fbId || post?.facebookPostId || '');
          if (fbId) {
            platformPostIds.facebook = fbId;
          }

          if (Array.isArray(post?.postIds)) {
            for (const postIdEntry of post.postIds) {
              if (!postIdEntry || typeof postIdEntry !== 'object') continue;
              const postIdPlatform = String(postIdEntry.platform || '').toLowerCase().trim();
              const postIdValue = String(postIdEntry.id || postIdEntry.postId || '').trim();
              if (postIdPlatform && postIdValue && !platformPostIds[postIdPlatform]) {
                platformPostIds[postIdPlatform] = postIdValue;
              }
            }
          }

          const numericCode = (typeof post.code === 'number' && Number.isFinite(post.code))
            ? post.code
            : (post.code !== undefined && post.code !== null && Number.isFinite(Number(post.code)) ? Number(post.code) : null);
          const hasCodeError = typeof numericCode === 'number' && numericCode >= 400;

          if (hasCodeError || post.status === 'error' || post.errors?.length > 0) {
            hasAyrshareError = true;

            // Extract error message from various places
            let postErrorMessage = post.message;
            if (!postErrorMessage && post.errors?.length > 0) {
              const firstError = post.errors[0];
              postErrorMessage = firstError.message || `Error code ${firstError.code}`;
            }

            console.log('❌ Platform post error:', post.platform, post.code || post.errors?.[0]?.code, postErrorMessage);
            errorMessage = postErrorMessage || `${post.platform || 'Unknown'}: Error ${post.code || 'unknown'}`;
          } else if (pid) {
            console.log('✅ Platform post success:', post.platform, pid);
          }
        }
      }

      const firstTopLevelPostId = Array.isArray(r.data?.postIds) ? r.data.postIds[0] : null;
      const extractedPostId = r.data?.posts?.[0]?.id ||
        r.data?.id ||
        r.id ||
        firstTopLevelPostId?.id ||
        firstTopLevelPostId?.postId ||
        (typeof firstTopLevelPostId === 'string' ? firstTopLevelPostId : null) ||
        null;
      const retryAvailable = !!r.data?.retryAvailable;
      const hasSuccessId = !!extractedPostId;

      // If Ayrshare didn't return per-platform IDs but only one platform was requested, map it for convenience.
      if (Object.keys(platformPostIds).length === 0 && extractedPostId && Array.isArray(calledPlatforms) && calledPlatforms.length === 1) {
        const fallbackPlatform = String(calledPlatforms[0]).toLowerCase();
        // Never infer Facebook post ID from generic Ayrshare internal IDs.
        if (fallbackPlatform !== 'facebook') {
          platformPostIds[fallbackPlatform] = extractedPostId;
        }
      }

      const success = (r.success || hasSuccessId) && !hasAyrshareError;
      return {
        success,
        errorMessage: success ? '' : (errorMessage || r.error || r.message || r.data?.message || 'Failed to publish to social media'),
        extractedPostId,
        retryAvailable,
        platformPostIds
      };
    };

    let allResults = null;
    let otherPlatforms = [];
    let instagramResult = null;
    let otherPlatformsResult = null;

    if (shouldAttachInstagramAudio) {
      otherPlatforms = platforms.filter(p => String(p).toLowerCase() !== 'instagram');

      // ============================================
      // INSTAGRAM POST: SEND COMPOSED VIDEO
      // ============================================
      // VALIDATION: Must have video URL (error would have been thrown earlier if composition failed)
      if (!instagramComposedVideoUrl) {
        const msg = '🚫 CRITICAL: Video composition succeeded but URL is missing. This should never happen.';
        console.error(msg);
        await persistPublishFailure(msg);
        return res.status(500).json({ success: false, message: msg });
      }
      
      console.log('📤 [AUDIO FLOW] Posting to Instagram with COMPOSED VIDEO (not image)...');
      console.log(`   - Media to send: [VIDEO] ${instagramComposedVideoUrl.substring(0, 80)}...`);
      console.log(`   - Media type flag: isVideo=true`);
      console.log(`   - Platforms: ['instagram'] (audio excluded from other platforms)`);
      
      // Debug logging for Instagram video posting
      console.log('\n📹 [INSTAGRAM VIDEO DEBUG] Final video details sent to Ayrshare:');
      console.log(`   - Video URL: ${instagramComposedVideoUrl}`);
      console.log(`   - Post type: reel`);
      console.log(`   - Is video: true`);
      console.log(`   - Media type: video`);
      if (composedSnapshot?.metadata) {
        console.log(`   - Encoding details:`);
        console.log(`     * Video codec: ${composedSnapshot.metadata.video?.codec || 'unknown'} (${composedSnapshot.metadata.video?.profile || 'unknown'})`);
        console.log(`     * Resolution: ${composedSnapshot.metadata.video?.resolution || 'unknown'}`);
        console.log(`     * Frame rate: ${composedSnapshot.metadata.video?.fps || 'unknown'} fps`);
        console.log(`     * Video bitrate: ${composedSnapshot.metadata.video?.bitrateKbps || 'unknown'} kbps`);
        console.log(`     * Pixel format: ${composedSnapshot.metadata.video?.pixelFormat || 'unknown'}`);
        console.log(`     * Audio codec: ${composedSnapshot.metadata.audio?.codec || 'unknown'}`);
        console.log(`     * Audio sample rate: ${composedSnapshot.metadata.audio?.sampleRate || 'unknown'} Hz`);
        console.log(`     * Audio bitrate: ${composedSnapshot.metadata.audio?.bitrateKbps || 'unknown'} kbps`);
        console.log(`     * Duration: ${composedSnapshot.metadata.duration || 'unknown'}s`);
      }
      console.log(`   - Cloudinary transformations applied: NONE (raw video URL only)`);
      console.log(`   - Adding 5-10 second delay before posting...`);
      
      // Add small delay before posting as recommended
      await new Promise(resolve => setTimeout(resolve, 8000)); // 8 seconds
      
      // Final validation before posting
      console.log('\n🔍 [INSTAGRAM VIDEO VALIDATION] Pre-posting checks...');
      console.log('Final composed snapshot object:', JSON.stringify(composedSnapshot, null, 2));

      if (!composedSnapshot) {
        const msg = '🚫 Composed video snapshot is null - composition failed';
        console.error(msg);
        await persistPublishFailure(msg);
        return res.status(500).json({ success: false, message: msg });
      }

      if (!composedSnapshot.metadata) {
        const msg = '🚫 Video metadata is missing from composed object';
        console.error(msg);
        await persistPublishFailure(msg, { composed: composedSnapshot });
        return res.status(500).json({ success: false, message: msg });
      }

      const prePostValidation = validateVideoForInstagramPosting(composedSnapshot.metadata);
      if (!prePostValidation.valid) {
        const msg = `🚫 Pre-posting validation failed: ${prePostValidation.errors.join(' | ')}`;
        console.error(msg);
        await persistPublishFailure(msg);
        return res.status(400).json({ success: false, message: msg });
      }
      
      console.log('✅ [INSTAGRAM VIDEO VALIDATION] All pre-posting checks passed');
      console.log(`   - Duration: ${composedSnapshot?.metadata?.durationSeconds}s ✓`);
      console.log(`   - Has audio: ✓`);
      console.log(`   - Video codec: ${composedSnapshot?.metadata?.video?.codec || 'unknown'} ✓`);
      console.log(`   - Audio codec: ${composedSnapshot?.metadata?.audio?.codec || 'unknown'} ✓`);
      
      // Post to Instagram with composed video + audio
      instagramResult = await publishSocialPostWithSafetyWrapper({
        user,
        campaign,
        platforms: ['instagram'],
        content: fullPost,
        options: {
          mediaUrls: [instagramComposedVideoUrl],  // MUST send video URL (guaranteed by validation above)
          shortenLinks: true,
          profileKey: profileKey,
          scheduleDate: scheduleDateIso || scheduledFor,
          type: 'reel',
          isVideo: true,  // Signal to Ayrshare that this is a video, not an image
          mediaType: 'video',
          instagramVideoPrepared: true
          // Temporarily remove instagramOptions to test if that's causing issues
          // instagramOptions: { postType: 'post' } // Use regular post instead of reel
        },
        context: 'campaign_publish_instagram_audio'
      });
      
      console.log('✅ [AUDIO FLOW] Instagram video post sent to Ayrshare');

      // Post to all non-Instagram platforms with the original media (no audio)
      if (otherPlatforms.length > 0) {
        console.log(`📤 [AUDIO FLOW] Posting to ${otherPlatforms.join(', ')} with ORIGINAL IMAGE (no audio)...`);
        console.log(`   - Media to send: [IMAGE] ${mediaUrl ? mediaUrl.substring(0, 80) + '...' : 'none'}`);
        console.log(`   - Platforms: [${otherPlatforms.join(', ')}]`);
        console.log(`   - Note: Audio only attached to Instagram for compliance`);
        
        otherPlatformsResult = await publishSocialPostWithSafetyWrapper({
          user,
          campaign,
          platforms: otherPlatforms,
          content: fullPost,
          options: {
            mediaUrls: mediaUrl ? [mediaUrl] : undefined,
            shortenLinks: true,
            profileKey: profileKey,
            scheduleDate: scheduleDateIso || scheduledFor
          },
          context: 'campaign_publish_other_platforms'
        });
        
        console.log('✅ [AUDIO FLOW] Other platforms posts sent to Ayrshare');
      } else {
        console.log('ℹ️ [AUDIO FLOW] No other platforms selected (Instagram only)');
      }

      allResults = { instagram: instagramResult, other: otherPlatformsResult };
      console.log('✅ [AUDIO FLOW] Completed split posting (Instagram with video, others with image)');
    } else {
      // Default behavior: a single Ayrshare call for all selected platforms (NO audio processing)
      console.log('📤 Standard posting (no audio): Sending to Ayrshare...');
      console.log(`   - Platforms: [${platforms.join(', ')}]`);
      console.log(`   - Media: [${mediaUrl ? 'IMAGE' : 'TEXT-ONLY'}] ${mediaUrl ? mediaUrl.substring(0, 80) + '...' : '(no media)'}`);

      if (platforms.includes('instagram')) {
        if (!mediaUrl) {
          const msg = '🚫 Instagram publishing requires a public image/video URL when no audio is provided';
          console.error(msg);
          await persistPublishFailure(msg);
          return res.status(400).json({ success: false, message: msg });
        }

        const mediaValidation = await validateMediaUrl(mediaUrl);
        console.log('   - Instagram media validation:', mediaValidation);
        if (!mediaValidation.valid) {
          const msg = `🚫 Invalid Instagram media URL: ${mediaValidation.reason}`;
          console.error(msg);
          await persistPublishFailure(msg);
          return res.status(400).json({ success: false, message: msg, mediaValidation });
        }
      }

      allResults = await publishSocialPostWithSafetyWrapper({
        user,
        campaign,
        platforms,
        content: fullPost,
        options: {
          mediaUrls: mediaUrl ? [mediaUrl] : undefined,
          shortenLinks: true,
          profileKey: profileKey,
          scheduleDate: scheduleDateIso || scheduledFor
          // Temporarily remove instagramOptions to test if that's causing issues
          // instagramOptions: platforms.includes('instagram') ? { postType: 'post' } : undefined
        },
        context: 'campaign_publish'
      });

      console.log('✅ Standard posting completed');
    }

    console.log('📊 Ayrshare publish result summary:');
    if (shouldAttachInstagramAudio) {
      console.log('   [AUDIO FLOW] Instagram result:', instagramResult?.success ? '✅ Success' : '❌ Failed', instagramResult?.data?.message);
      if (otherPlatforms.length > 0) {
        console.log('   [AUDIO FLOW] Other platforms result:', otherPlatformsResult?.success ? '✅ Success' : '❌ Failed', otherPlatformsResult?.data?.message);
      }
    } else {
      console.log('   Standard result:', allResults?.success ? '✅ Success' : '❌ Failed', allResults?.data?.message);
      console.log('   Full response:', JSON.stringify(allResults.data, null, 2));
    }

    const analyzed = [];
    if (shouldAttachInstagramAudio) {
      analyzed.push({ key: 'instagram', platforms: ['instagram'], ...analyzeAyrshareResult(instagramResult, ['instagram']) });
      if (otherPlatforms.length > 0) {
        analyzed.push({ key: 'other', platforms: otherPlatforms, ...analyzeAyrshareResult(otherPlatformsResult, otherPlatforms) });
      }
    } else {
      analyzed.push({ key: 'all', platforms: platforms, ...analyzeAyrshareResult(allResults, platforms) });
    }

    const failures = analyzed.filter(a => !a.success);

    if (failures.length === 0) {
      const effectiveScheduleDate =
        instagramResult?.instagramFix?.adjustedScheduleDate ||
        otherPlatformsResult?.instagramFix?.adjustedScheduleDate ||
        allResults?.instagramFix?.adjustedScheduleDate ||
        scheduleDateIso ||
        scheduledFor ||
        null;

      // Combine per-platform IDs across the (possibly split) publishes
      const socialPostIds = {};
      for (const a of analyzed) {
        Object.assign(socialPostIds, a.platformPostIds || {});
      }

      // Prefer Instagram ID when present, otherwise fall back to the top-level ID.
      const extractedPostId = socialPostIds.instagram || analyzed[0]?.extractedPostId || null;
      const normalizedSelectedPlatforms = Array.isArray(platforms)
        ? platforms.map((platform) => String(platform || '').toLowerCase())
        : [];
      const facebookSelected = normalizedSelectedPlatforms.includes('facebook');
      const facebookPublishEntry = analyzed.find((entry) =>
        Array.isArray(entry?.platforms) &&
        entry.platforms.some((platform) => String(platform || '').toLowerCase() === 'facebook')
      );
      const facebookAyrsharePostId = String(
        facebookPublishEntry?.extractedPostId ||
          (facebookSelected ? extractedPostId : '') ||
          ''
      ).trim();
      const initialFacebookPayload =
        (shouldAttachInstagramAudio ? otherPlatformsResult?.data : allResults?.data) ||
        instagramResult?.data ||
        null;

      let facebookPostId = normalizeFacebookPostId(
        socialPostIds.facebook ||
          extractFacebookPostIdFromAyrsharePayload(initialFacebookPayload || {}, {
            existingFacebookPostId: campaign?.facebookPostId || ''
          }) ||
          campaign.facebookPostId ||
          ''
      ) || null;

      if (!facebookPostId && facebookSelected) {
        facebookPostId = normalizeFacebookPostId(
          await waitForFacebookPostIdFromAyrshare({
            profileKey,
            ayrsharePostId: facebookAyrsharePostId,
            initialPayload: initialFacebookPayload,
            fallbackPageId: extractFacebookPageId(campaign?.facebookPostId || ''),
            existingFacebookPostId: campaign?.facebookPostId || ''
          })
        ) || null;
      }

      if (!facebookPostId && facebookSelected) {
        const rawFacebookIdCandidate = extractRawFacebookPostIdCandidate(initialFacebookPayload || {});
        if (rawFacebookIdCandidate) {
          const invalidIdErrorMessage = 'Invalid Facebook Post ID format';
          await persistPublishFailure(invalidIdErrorMessage, {
            rawFacebookIdCandidate,
            initialFacebookPayload
          });
          return res.status(400).json({ success: false, message: invalidIdErrorMessage });
        }
      }
      if (facebookPostId) {
        socialPostIds.facebook = facebookPostId;
      }

      const instagramPostId = String(socialPostIds.instagram || campaign.instagramPostId || '').trim() || null;

      // Update campaign with post result
      const updateData = {
        status: isScheduled ? 'scheduled' : 'posted',
        'socialPostId': extractedPostId,
        'socialPostIds': Object.keys(socialPostIds).length > 0 ? socialPostIds : null,
        'facebookPostId': facebookPostId,
        'instagramPostId': instagramPostId,
        'publishResult': allResults,
        'lastPublishError': null,
        'ayrshareStatus': isScheduled ? 'scheduled' : 'success',
        'platforms': platforms,  // Update platforms to match what user actually selected
        'instagramAccountKey': (platforms.includes('instagram')
          ? (instagramResult?.instagramFix?.accountKey || allResults?.instagramFix?.accountKey || null)
          : null)
      };
      
      if (isScheduled) {
        updateData.scheduledFor = effectiveScheduleDate ? new Date(effectiveScheduleDate) : (scheduleDateObj || new Date(scheduledFor));
      } else {
        updateData.publishedAt = new Date();
        updateData.scheduledFor = null;
      }
      
      const updatedCampaign = await Campaign.findByIdAndUpdate(campaign._id, { $set: updateData }, { new: true });
      
      // ============================================
      // FINAL VALIDATION LOGGING
      // ============================================
      console.log('✅ Campaign published successfully!');
      console.log(`   - Campaign ID: ${campaign._id}`);
      console.log(`   - Campaign name: ${campaign.name}`);
      console.log(`   - Status: ${updateData.status}`);
      console.log(`   - Platforms posted: [${platforms.join(', ')}]`);
      
      if (shouldAttachInstagramAudio) {
        console.log('\n🎵 [AUDIO VERIFICATION] Audio attachment details:');
        console.log(`   ✓ Audio URL stored: ${instagramAudioUrl ? instagramAudioUrl.substring(0, 80) + '...' : 'N/A'}`);
        console.log(`   ✓ Video composition: SUCCESS`);
        console.log(`   ✓ Video URL sent to Instagram: ${instagramComposedVideoUrl.substring(0, 80)}...`);
        console.log(`   ✓ isVideo flag set: true`);
        console.log(`   ✓ Instagram media type: VIDEO (not image)`);
        if (otherPlatforms.length > 0) {
          console.log(`   ✓ Other platforms (${otherPlatforms.join(', ')}): Original image (audio excluded)`);
        }
        console.log('   ✓ FINAL VERIFICATION: Audio flow completed successfully!');
      } else {
        console.log('\n📸 Standard image posting completed (no audio)');
      }

      // Best-effort: delete any previously scheduled Ayrshare post(s) now that the new publish/schedule succeeded.
      if (existingAyrsharePostIds.length > 0) {
        const newIds = new Set(
          [extractedPostId, ...Object.values(socialPostIds || {})]
            .filter((v) => typeof v === 'string' && v)
        );
        const toDelete = existingAyrsharePostIds.filter((id) => !newIds.has(id) && !preDeletedAyrsharePostIds.has(id));

        if (toDelete.length > 0) {
          void (async () => {
            for (const postId of toDelete) {
              try {
                const del = await deleteAyrsharePost(postId, { profileKey });
                if (del.success) {
                  console.log(`🗑️ Deleted previous Ayrshare post ${postId}`);
                } else {
                  console.warn(`⚠️ Failed to delete previous Ayrshare post ${postId}:`, del.error);
                }
              } catch (e) {
                console.warn(`⚠️ Error deleting previous Ayrshare post ${postId}:`, e?.message || e);
              }
            }
          })();
        }
      }
      
      res.json({
        success: true,
        message: isScheduled 
          ? `Campaign scheduled for ${new Date(effectiveScheduleDate || scheduledFor).toLocaleString()}!` 
          : 'Campaign published to social media!',
        postId: extractedPostId,
        platforms,
        scheduled: isScheduled,
        scheduledFor: effectiveScheduleDate,
        generatedInstagramVideoUrl: instagramComposedVideoUrl || instagramResult?.instagramFix?.videoDebug?.preparedUrl || allResults?.instagramFix?.videoDebug?.preparedUrl || null,
        warnings: rescheduleDeleteWarnings,
        result: allResults,
        normalized: {
          scheduleAdjusted: requestedSchedule.adjusted || Boolean(effectiveScheduleDate && effectiveScheduleDate !== (scheduleDateIso || scheduledFor || null)),
          scheduleDate: effectiveScheduleDate,
          mediaUrl: mediaUrl || null,
          mediaType: shouldAttachInstagramAudio ? 'video' : (mediaValidation?.mediaKind || null)
        }
      });
    } else {
      const finalErrorMessage = failures[0]?.errorMessage || 'Failed to publish to social media';
      const primaryFailureResult = instagramResult || allResults || otherPlatformsResult || null;
      const requiresReconnect = Boolean(primaryFailureResult?.requiresReconnect);
      const rateLimited = Boolean(primaryFailureResult?.rateLimited);
      const failureCode = primaryFailureResult?.code || null;

      const normalizedPlatforms = Array.isArray(platforms)
        ? platforms.map((p) => String(p || '').toLowerCase()).filter(Boolean)
        : [];
      const isInstagramOnly = normalizedPlatforms.length === 1 && normalizedPlatforms[0] === 'instagram';

      // Auto-retry transient Instagram failures when Ayrshare marks them retryable.
      // Enabled for Instagram-only flows (including scheduled posts) to avoid duplicating other platforms.
      if (isInstagramOnly) {
        const igFailure = failures.find((f) => Array.isArray(f.platforms) && f.platforms.length === 1 && String(f.platforms[0]).toLowerCase() === 'instagram');
        const failureId = igFailure?.extractedPostId || null;
        const failureMsg = String(igFailure?.errorMessage || finalErrorMessage || '');
        const looksTransient = /cannot process your post at this time/i.test(failureMsg) || /please try your post again/i.test(failureMsg);
        const canRetry = !!igFailure?.retryAvailable || looksTransient;

        if (failureId && canRetry) {
          // Per Ayrshare docs, first verify the post hasn't already been published.
          try {
            const statusCheck = await getPostStatus(failureId, { profileKey });
            const postStatus = statusCheck?.data?.status || statusCheck?.data?.posts?.[0]?.status || null;
            if (postStatus === 'success' || postStatus === 'posted') {
              await Campaign.findByIdAndUpdate(campaign._id, {
                $set: {
                  status: 'posted',
                  socialPostId: failureId,
                  socialPostIds: { instagram: failureId },
                  publishResult: { initial: allResults || null, verified: statusCheck?.data || null },
                  lastPublishError: null,
                  platforms,
                  publishedAt: new Date(),
                  ayrshareStatus: 'success',
                  instagramAccountKey: instagramResult?.instagramFix?.accountKey || allResults?.instagramFix?.accountKey || campaign.instagramAccountKey || null
                }
              });

              return res.json({
                success: true,
                message: isScheduled
                  ? 'Instagram reported a temporary error, but your scheduled post is already accepted.'
                  : 'Instagram reported a temporary error, but the post is already published.',
                postId: failureId,
                platforms,
                scheduled: !!isScheduled,
                scheduledFor: isScheduled ? (scheduleDateIso || scheduledFor || null) : null,
                generatedInstagramVideoUrl: instagramComposedVideoUrl || instagramResult?.instagramFix?.videoDebug?.preparedUrl || allResults?.instagramFix?.videoDebug?.preparedUrl || null,
                result: { initial: allResults || null, verified: statusCheck?.data || null }
              });
            }
          } catch (_) {}

          try {
            const retryScheduledFor = new Date(Date.now() + 5 * 60 * 1000);
            const retryScheduledForIso = retryScheduledFor.toISOString();
            const retryMediaUrl = instagramComposedVideoUrl || mediaUrl || null;
            const retryMediaLooksLikeVideo = Boolean(
              retryMediaUrl &&
              /\.(mp4|mov|m4v|webm)(\?|#|$)/i.test(String(retryMediaUrl))
            );

            if (retryMediaLooksLikeVideo) {
              console.log('[Instagram Retry] Rebuilding a fresh Instagram Reel payload instead of using Ayrshare post retry.');
              const freshRetryResult = await publishSocialPostWithSafetyWrapper({
                user,
                campaign,
                platforms: ['instagram'],
                content: fullPost,
                options: {
                  mediaUrls: retryMediaUrl ? [retryMediaUrl] : undefined,
                  shortenLinks: true,
                  profileKey,
                  scheduleDate: retryScheduledForIso,
                  type: 'reel',
                  isVideo: true,
                  mediaType: 'video',
                  instagramVideoPrepared: Boolean(instagramComposedVideoUrl)
                },
                context: 'campaign_publish_instagram_retry'
              });

              const pendingId = freshRetryResult?.data?.posts?.[0]?.id ||
                freshRetryResult?.data?.id ||
                freshRetryResult?.data?.postIds?.[0] ||
                failureId;

              if (freshRetryResult?.success) {
                const retryRequestedAt = new Date().toISOString();
                await Campaign.findByIdAndUpdate(campaign._id, {
                  $set: {
                    status: 'scheduled',
                    scheduledFor: retryScheduledFor,
                    socialPostId: pendingId,
                    socialPostIds: { instagram: pendingId },
                    publishResult: { initial: allResults || null, retry: freshRetryResult?.data || freshRetryResult, retryRequestedAt },
                    lastPublishError: null,
                    platforms,
                    ayrshareStatus: 'pending',
                    instagramAccountKey: freshRetryResult?.instagramFix?.accountKey || instagramResult?.instagramFix?.accountKey || allResults?.instagramFix?.accountKey || campaign.instagramAccountKey || null
                  }
                });

                return res.json({
                  success: true,
                  message: isScheduled
                    ? 'Instagram had a temporary issue. We rebuilt the Reel payload and rescheduled it.'
                    : 'Instagram had a temporary issue. We rebuilt the Reel payload and queued a retry.',
                  postId: pendingId,
                  platforms,
                  scheduled: true,
                  scheduledFor: retryScheduledForIso,
                  generatedInstagramVideoUrl: retryMediaUrl,
                  result: { initial: allResults || null, retry: freshRetryResult?.data || freshRetryResult, retryRequestedAt }
                });
              }
            }

            const retryRes = await retryAyrsharePost(failureId, { profileKey });
            const pendingId = retryRes?.data?.id || failureId;

            if (retryRes?.success) {
              const retryRequestedAt = new Date().toISOString();
              await Campaign.findByIdAndUpdate(campaign._id, {
                $set: {
                  status: 'scheduled',
                  scheduledFor: retryScheduledFor,
                  socialPostId: pendingId,
                  socialPostIds: { instagram: pendingId },
                  publishResult: { initial: allResults || null, retry: retryRes?.data || retryRes, retryRequestedAt },
                  lastPublishError: null,
                  platforms,
                  ayrshareStatus: 'pending',
                  instagramAccountKey: instagramResult?.instagramFix?.accountKey || allResults?.instagramFix?.accountKey || campaign.instagramAccountKey || null
                }
              });

              return res.json({
                success: true,
                message: isScheduled
                  ? 'Instagram had a temporary issue. We retried your scheduled post and it is pending — check again in a few minutes.'
                  : 'Instagram had a temporary issue. We retried your post and it is pending — check again in a few minutes.',
                postId: pendingId,
                platforms,
                scheduled: true,
                scheduledFor: retryScheduledFor.toISOString(),
                generatedInstagramVideoUrl: retryMediaUrl,
                result: { initial: allResults || null, retry: retryRes?.data || retryRes, retryRequestedAt }
              });
            }
          } catch (_) {}
        }
      }

      // Persist the failure reason so the UI can show why it reverted to Draft.
      await persistPublishFailure(finalErrorMessage, allResults || null);
      
      console.log('❌ Publish failed:', finalErrorMessage);
      
      // If audio flow failed, add diagnostic logging
      if (shouldAttachInstagramAudio) {
        console.log('\n🎵 [AUDIO FAILURE DIAGNOSIS]');
        console.log(`   - Audio URL present at time of failure: ${instagramAudioUrl ? 'YES' : 'NO'}`);
        console.log(`   - Image URL present: ${mediaUrl ? 'YES' : 'NO'}`);
        console.log(`   - Video composition completed: ${instagramComposedVideoUrl ? 'YES' : 'NO'}`);
        console.log(`   - Video URL: ${instagramComposedVideoUrl ? instagramComposedVideoUrl.substring(0, 80) + '...' : 'NONE'}`);
        console.log(`   - Instagram result status: ${instagramResult?.success ? 'SUCCESS' : 'FAILED'}`);
        console.log(`   - Instagram error: ${instagramResult?.error || instagramResult?.data?.message || 'N/A'}`);
      }
      
      res.status(400).json({
        success: false,
        message: finalErrorMessage,
        error: finalErrorMessage,
        requiresReconnect,
        rateLimited,
        code: failureCode,
        audioFlowInfo: shouldAttachInstagramAudio ? {
          audioUrlPresent: !!instagramAudioUrl,
          imageUrlPresent: !!mediaUrl,
          videoComposed: !!instagramComposedVideoUrl,
          instagramResult: instagramResult?.data?.message || instagramResult?.error
        } : null,
        details: shouldAttachInstagramAudio
          ? analyzed.map(a => ({ key: a.key, platforms: a.platforms, errorMessage: a.errorMessage || null }))
          : allResults?.data?.posts
      });
    }
  } catch (error) {
    console.error('Publish campaign error:', error);

    // Best-effort: persist the failure on the campaign so the UI can show it.
    try {
      const userId = req.user?.userId || req.user?.id;
      if (userId && req.params?.id) {
        let shouldClearScheduling = !!req.body?.scheduledFor;
        try {
          const existing = await Campaign.findOne({ _id: req.params.id, userId }).select('status');
          if (existing?.status === 'scheduled') shouldClearScheduling = true;
        } catch (_) {}

        const update = {
          status: 'draft',
          ayrshareStatus: 'error',
          lastPublishError: error.message || 'Failed to publish',
          publishResult: { error: error.message || String(error) }
        };

        if (shouldClearScheduling) {
          update.scheduledFor = null;
          update.socialPostId = null;
          update.socialPostIds = null;
        }

        await Campaign.findOneAndUpdate(
          { _id: req.params.id, userId },
          {
            $set: update
          }
        );
      }
    } catch (_) {}

    if (isMongoTimeoutOrSelectionError(error)) {
      return res.status(503).json({
        success: false,
        message: 'MongoDB connection timed out. Please try again in a few seconds.',
        error: error.message || 'MongoDB timeout'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to publish campaign',
      error: error.message
    });
  }
});

/**
 * POST /api/campaigns/generate-campaign-posts
 * Generate AI-powered posts for a campaign based on detailed inputs
 */
router.post('/generate-campaign-posts', protect, checkTrial, async (req, res) => {
  let generationLockSignature = null;
  let hasGenerationLock = false;
  try {
    const userId = req.user.userId || req.user.id;
    
    const {
      campaignName,
      campaignDescription,
      objective,
      targetAudience,
      content,
      scheduling,
      budget,
      kpis
    } = req.body;
    generationLockSignature = buildGenerationSignature({
      route: 'generate-campaign-posts',
      campaignName,
      campaignDescription,
      objective,
      targetAudience,
      content: {
        platforms: content?.platforms || [],
        tone: content?.tone || '',
        type: content?.type || '',
        keyMessages: content?.keyMessages || '',
        callToAction: content?.callToAction || ''
      },
      scheduling,
      budget,
      kpis,
      hasLogo: Boolean(content?.productLogo)
    });
    const lockAttempt = tryAcquireGenerationLock(userId, generationLockSignature);
    if (!lockAttempt.ok) {
      const duplicateMessage =
        lockAttempt.reason === 'duplicate_recent'
          ? 'Duplicate generate request detected. Please wait a few seconds before retrying.'
          : 'Campaign generation is already in progress. Please wait until it finishes.';
      return res.status(429).json({
        success: false,
        message: duplicateMessage,
        duplicateRequest: true
      });
    }
    hasGenerationLock = true;

    const user = await User.findById(userId);
    const bp = user?.businessProfile || {};

    // Deduct flat 7 credits for campaign post generation (text only, no bulk images)
    const textCreditResult = await deductCredits(userId, 'campaign_full', 1, 'AI campaign generation');
    if (!textCreditResult.success) {
      return res.status(403).json({
        success: false,
        creditsExhausted: true,
        message: textCreditResult.error,
        creditsRemaining: textCreditResult.creditsRemaining
      });
    }

    const brandCtx = await resolveBrandIntelligenceContext(userId, bp);
    const brandDisplayName =
      String(brandCtx?.profile?.brandName || bp.companyName || bp.name || 'Brand').trim() || 'Brand';
    const strictBrandMode = isStrictBrandLockEnabled(brandCtx);
    const enforcedTone = strictBrandMode
      ? brandCtx.effectiveTone
      : String(content?.tone || brandCtx.effectiveTone || 'professional').toLowerCase();
    const brandGuidelinesText = brandCtx?.guidelineBundle?.instructions || '';
    const visualHints = brandCtx?.visualHints || '';
    const strictBrandText = strictBrandMode ? buildStrictBrandLockText(brandCtx) : '';
    const lockedPalette = getBrandPalette(brandCtx).join(', ');

    if (!campaignName) {
      return res.status(400).json({ success: false, message: 'Campaign name is required' });
    }

    const platforms = normalizePlatformsList(content?.platforms || ['instagram']);
    const productLogo = content?.productLogo || null; // Base64 or URL of product logo
    const duration = scheduling?.duration || '2weeks';
    const postsPerWeek = scheduling?.postsPerWeek || 3;
    const preferredDays = scheduling?.preferredDays || ['monday', 'wednesday', 'friday'];
    // Fix: empty array [] is truthy in JS, so explicitly check length
    const preferredTimes = (scheduling?.preferredTimes && scheduling.preferredTimes.length > 0) 
      ? scheduling.preferredTimes 
      : ['10:00', '14:00', '18:00'];
    const startDate = scheduling?.startDate || new Date().toISOString().split('T')[0];

    console.log('📅 Preferred times received:', scheduling?.preferredTimes, '→ using:', preferredTimes);

    // Calculate number of posts based on duration
    const durationWeeks = {
      '1week': 1,
      '2weeks': 2,
      '1month': 4,
      '3months': 12
    };
    const totalPosts = Math.min(postsPerWeek * (durationWeeks[duration] || 2), 20); // Cap at 20 posts

    console.log(`🎯 Generating ${totalPosts} posts for campaign: ${campaignName}`);

    // Generate content calendar dates
    const generateScheduleDates = () => {
      const dates = [];
      const start = new Date(startDate);
      let postsCreated = 0;
      let currentDay = 0;
      
      while (postsCreated < totalPosts && currentDay < 100) {
        const checkDate = new Date(start);
        checkDate.setDate(start.getDate() + currentDay);
        const dayName = checkDate.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
        
        if (preferredDays.includes(dayName) || preferredDays.length === 0) {
          const time = preferredTimes[postsCreated % preferredTimes.length] || '10:00';
          dates.push({
            date: checkDate.toISOString().split('T')[0],
            time: time
          });
          postsCreated++;
        }
        currentDay++;
      }
      
      return dates;
    };

    const scheduleDates = generateScheduleDates();

    // Build comprehensive prompt for Gemini
    const prompt = `You are an expert social media marketing strategist. Create a series of ${totalPosts} engaging posts for a marketing campaign.

CAMPAIGN DETAILS:
- Campaign Name: "${campaignName}"
- Description: ${campaignDescription || 'Not provided'}
- Objective: ${objective || 'awareness'}
- Budget: ${budget ? '$' + budget : 'Not specified'}
- KPIs: ${kpis?.join(', ') || 'engagement, impressions'}

TARGET AUDIENCE:
- Age Range: ${targetAudience?.age || '18-35'}
- Gender: ${targetAudience?.gender || 'all'}
- Location: ${targetAudience?.location || 'Global'}
- Interests: ${targetAudience?.interests || 'Not specified'}
- Description: ${targetAudience?.description || 'General audience'}

CONTENT PREFERENCES:
- Platforms: ${platforms.join(', ')}
- Tone: ${enforcedTone || 'professional'}
- Content Type: ${content?.type || 'image'}
- Key Messages: ${content?.keyMessages || 'Not specified'}
- Call to Action: ${content?.callToAction || 'Learn more'}

BRAND CONTEXT:
- Company Name: ${brandDisplayName}
- Industry: ${bp.industry || 'General'}
- Brand Voice: ${bp.brandVoice || enforcedTone || 'Professional'}
- Niche: ${bp.niche || 'Not specified'}
${visualHints ? `- Visual Tokens: ${visualHints}` : ''}
${strictBrandText ? `- ${strictBrandText}` : ''}
${lockedPalette ? `- Locked Brand Palette: ${lockedPalette}` : ''}
${brandGuidelinesText}

REQUIREMENTS:
1. Create exactly ${totalPosts} unique, engaging posts
2. Each post should be optimized for its target platform
3. Vary content themes throughout the campaign (educational, promotional, engagement, storytelling)
4. Include relevant emojis for visual appeal
5. Each post needs a specific, actionable call-to-action
6. Hashtags should be platform-appropriate (more for Instagram, fewer for LinkedIn/Twitter)
7. Content must be relevant to the campaign objective: ${objective}
8. Posts should build upon each other to tell a cohesive brand story
9. ${strictBrandMode ? 'Brand lock is ON. Do not deviate from the saved tone/style/CTA/format profile under any circumstance.' : 'If brand enforcement is strict, do not deviate from the saved tone/style/CTA/format profile.'}

For each post, provide a detailed "imageDescription" that describes exactly what visual should accompany the post - be specific about:
- Subject matter (people, products, scenes)
- Color palette and mood
- Style (photography, illustration, minimalist, vibrant)
- Any text overlays or graphics

Return ONLY valid JSON (no markdown, no code blocks):
{
  "posts": [
    {
      "platform": "platform_name",
      "caption": "The full post caption with emojis and formatting",
      "hashtags": ["#hashtag1", "#hashtag2", "#hashtag3"],
      "contentTheme": "educational|promotional|engagement|storytelling|behindthescenes",
      "imageDescription": "Detailed description for AI image generation",
      "callToAction": "Specific CTA for this post"
    }
  ]
}`;

    const response = await callGemini(prompt, { maxTokens: 4000, temperature: 0.8, skipCache: true });
    const parsed = parseGeminiJSON(response);
    const fallbackPost = {
      platform: platforms[0] || 'instagram',
      caption: `${campaignName}\n\n${campaignDescription || `A focused ${objective || 'awareness'} campaign update for your audience.`}`,
      hashtags: [`#${String((bp.companyName || campaignName || 'Campaign')).replace(/[^A-Za-z0-9]/g, '') || 'Campaign'}`],
      contentTheme: 'promotional',
      imageDescription: `${bp.industry || 'Business'} campaign creative for ${campaignName}`,
      callToAction: content?.callToAction || 'Learn more'
    };
    let parsedPosts = Array.isArray(parsed?.posts) && parsed.posts.length > 0
      ? parsed.posts
      : [fallbackPost];

    if (strictBrandMode && parsedPosts.length > 0) {
      parsedPosts = await enforceBrandProfileOnGeneratedPosts(parsedPosts, {
        brandCtx,
        campaignName,
        objective,
        platforms
      });
    }

    // Use stock placeholder images — NO bulk AI image generation
    // Users can generate images individually per post if they want
    const stockImages = [
      'https://images.unsplash.com/photo-1559136555-9303baea8ebd?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1552664730-d307ca884978?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1573164713988-8665fc963095?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1551434678-e076c223a692?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1531482615713-2afd69097998?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1553877522-43269d4ea984?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1542744173-8e7e53415bb0?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1556761175-5973dc0f32e7?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1553028826-f4804a6dba3b?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1556155092-490a1ba16284?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1553729459-afe8f2e2ed65?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1497215728101-856f4ea42174?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1554200876-56c2f25224fa?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1543286386-713bdd548da4?w=800&h=600&fit=crop',
    ];

    const postsWithImages = [];
    const postsToProcess = parsedPosts.slice(0, Math.max(totalPosts, 1));
    
    for (let index = 0; index < postsToProcess.length; index++) {
      const post = postsToProcess[index];
      const schedule = scheduleDates[index] || { date: startDate, time: '10:00' };

      const scheduleInput = `${schedule.date}T${schedule.time}:00`;
      let validated;
      try {
        validated = await validateAndNormalizePost({
          platform: post.platform?.toLowerCase() || platforms[index % platforms.length],
          caption: post.caption,
          hashtags: post.hashtags,
          imageDescription: post.imageDescription,
          scheduleDate: scheduleInput,
          mediaUrl: stockImages[index % stockImages.length],
          callToAction: post.callToAction || content?.callToAction || 'Learn more'
        });
      } catch (validationError) {
        const fallbackSchedule = normalizeScheduleDateDetails(scheduleInput);
        validated = {
          post: {
            platform: String(post.platform || platforms[index % platforms.length] || 'instagram').toLowerCase(),
            caption: String(post.caption || fallbackPost.caption).trim(),
            hashtags: sanitizeHashtags(
              Array.isArray(post.hashtags) && post.hashtags.length > 0 ? post.hashtags : fallbackPost.hashtags,
              { max: String(post.platform || '').toLowerCase() === 'instagram' ? 5 : 30 }
            ),
            imageDescription: String(post.imageDescription || fallbackPost.imageDescription).trim(),
            scheduleDate: fallbackSchedule.scheduleDate
          },
          publishing: {
            mediaUrl: stockImages[index % stockImages.length]
          }
        };
      }
      const normalizedSchedule = validated.post.scheduleDate ? new Date(validated.post.scheduleDate) : null;

      postsWithImages.push({
        id: `post-${index + 1}`,
        platform: validated.post.platform,
        caption: validated.post.caption,
        hashtags: validated.post.hashtags,
        imageDescription: validated.post.imageDescription,
        scheduleDate: validated.post.scheduleDate,
        imageUrl: validated.publishing.mediaUrl,
        suggestedDate: normalizedSchedule ? normalizedSchedule.toISOString().split('T')[0] : schedule.date,
        suggestedTime: normalizedSchedule ? normalizedSchedule.toISOString().slice(11, 16) : schedule.time,
        contentTheme: post.contentTheme || 'promotional',
        callToAction: post.callToAction || content?.callToAction || 'Learn more'
      });
    }

    console.log(`✅ Generated ${postsWithImages.length} text-only posts for campaign: ${campaignName}`);

    const normalizedCalendar = postsWithImages.map((post) => ({
      date: post.suggestedDate,
      time: post.suggestedTime,
      platform: post.platform,
      scheduleDate: post.scheduleDate
    }));

    // Fetch latest credit balance for frontend update
    const updatedUser = await User.findById(userId).select('credits.balance');
    const creditsRemaining = updatedUser?.credits?.balance ?? 0;

    res.json({
      success: true,
      posts: postsWithImages,
      contentCalendar: normalizedCalendar,
      creditsRemaining,
      campaignSummary: {
        name: campaignName,
        objective,
        platforms,
        totalPosts: postsWithImages.length,
        startDate,
        endDate: normalizedCalendar[normalizedCalendar.length - 1]?.date || startDate
      }
    });

  } catch (error) {
    console.error('Generate campaign posts error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate posts', error: error.message });
  } finally {
    const userId = req.user?.userId || req.user?.id;
    if (hasGenerationLock && userId && generationLockSignature) {
      releaseGenerationLock(userId, generationLockSignature);
    }
  }
});

/**
 * POST /api/campaigns/regenerate-post-image
 * Regenerate a single post image with optional custom prompt
 */
router.post('/regenerate-post-image', protect, checkTrial, requireCredits('image_edit'), async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id || req.user._id;
    const user = await User.findById(userId).select('businessProfile companyName');
    const bp = user?.businessProfile || {};
    const { 
      postId,
      platform,
      caption,
      customPrompt,
      referenceImageUrl,
      productLogo, // logo for overlay
      brandContext
    } = req.body;

    const brandCtx = await resolveBrandIntelligenceContext(userId, bp);
    const strictBrandMode = isStrictBrandLockEnabled(brandCtx);
    const strictBrandText = strictBrandMode ? buildStrictBrandLockText(brandCtx) : '';
    const autoBrandContext = buildBrandContextForImages(brandCtx, {
      companyName: bp?.companyName || user?.companyName || '',
      industry: bp?.industry || '',
      description: bp?.description || '',
      targetAudience: bp?.targetAudience || '',
      brandVoice: strictBrandMode ? brandCtx.effectiveTone : bp?.brandVoice || 'professional'
    });
    const mergedBrandContext = { ...(brandContext || {}), ...(autoBrandContext || {}) };

    console.log(`🎨 Regenerating image for post ${postId || 'new'}...`);

    const { getRelevantImage } = require('../services/geminiAI');
    const { uploadLogo, uploadImageWithLogoOverlay } = require('../services/imageUploader');

    // Build image description
    let imageDescription = customPrompt || caption?.substring(0, 200) || 'Professional marketing image';
    imageDescription += `. Brand: ${mergedBrandContext.companyName || 'Brand'}, Industry: ${mergedBrandContext.industry || 'business'}.`;
    if (strictBrandText) {
      imageDescription += ` ${strictBrandText}`;
    }

    console.log('🖼️ Image prompt:', imageDescription.substring(0, 100) + '...');

    // Generate the image
    let imageUrl = await getRelevantImage(
      imageDescription,
      mergedBrandContext.industry || 'business',
      'awareness',
      'Campaign',
      platform || 'instagram',
      mergedBrandContext
    );

    // If logo is provided, overlay it
    if (productLogo && imageUrl) {
      console.log('🏷️ Overlaying logo on regenerated image...');
      const logoResult = await uploadLogo(productLogo, true); // true = remove background
      if (logoResult.success) {
        const overlayResult = await uploadImageWithLogoOverlay(imageUrl, logoResult.publicId, {
          position: 'south_east',
          width: 180,
          opacity: 95,
          margin: 25
        });
        if (overlayResult.success) {
          imageUrl = overlayResult.url;
          console.log('✅ Logo overlay applied');
        }
      }
    }

    console.log('✅ Image regenerated successfully');

    // Deduct credits for image edit/regenerate
    const editResult = await deductCredits(userId, 'image_edit', 1, 'Regenerated post image');

    res.json({
      success: true,
      imageUrl,
      postId,
      creditsRemaining: editResult.creditsRemaining
    });

  } catch (error) {
    console.error('Regenerate post image error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to regenerate image', 
      error: error.message 
    });
  }
});

// ============================================
// TEMPLATE POSTER GENERATION (Canvas + AI Fallback)
// ============================================

const { generateTemplatePoster, editTemplatePoster, generatePosterFromReference } = require('../services/geminiAI');
const { generatePosterFromTemplate, editPosterFromTemplate } = require('../services/canvasPosterService');

/**
 * POST /api/campaigns/generate-caption
 * Generate a caption from an uploaded image using AI vision
 */
router.post('/generate-caption', protect, checkTrial, requireCredits('campaign_text'), async (req, res) => {
  try {
    const { image, platform } = req.body;
    
    if (!image) {
      return res.status(400).json({ 
        success: false, 
        message: 'Image is required' 
      });
    }
    
    console.log('🤖 Generating caption from image for platform:', platform || 'instagram');
    
    // Get brand intelligence context for strict tone/style enforcement
    const userId = req.user.userId || req.user.id;
    const user = await User.findById(userId).select('businessProfile companyName');
    const bp = user?.businessProfile || {};
    const brandCtx = await resolveBrandIntelligenceContext(userId, bp);
    const strictBrandMode = isStrictBrandLockEnabled(brandCtx);
    const enforcedTone = strictBrandMode
      ? brandCtx.effectiveTone
      : String(brandCtx?.effectiveTone || bp?.brandVoice || 'professional').toLowerCase();
    const strictBrandText = strictBrandMode ? buildStrictBrandLockText(brandCtx) : '';
    const brandContext = `
Business: ${brandCtx?.profile?.brandName || bp?.companyName || user?.companyName || 'Unknown'}
Industry: ${bp?.industry || 'General'}
Tone: ${enforcedTone || 'professional'}
Visual tokens: ${brandCtx?.visualHints || 'Not set'}
${strictBrandText ? strictBrandText : ''}`;
    
    // Use Gemini to analyze image and generate caption
    
    // Extract base64 data — handle URLs, data URIs, and raw base64
    let imageData = image;
    let mimeType = 'image/png';
    if (image.startsWith('data:')) {
      const matches = image.match(/^data:([^;]+);base64,(.+)$/);
      if (matches) {
        mimeType = matches[1];
        imageData = matches[2];
      }
    } else if (image.startsWith('http://') || image.startsWith('https://')) {
      const fetchImg = (...args) => import('node-fetch').then(({default: f}) => f(...args));
      try {
        const imgResponse = await fetchImg(image);
        const buffer = await imgResponse.buffer();
        imageData = buffer.toString('base64');
        const contentType = imgResponse.headers.get('content-type');
        if (contentType) mimeType = contentType.split(';')[0];
      } catch (fetchErr) {
        console.error('Failed to fetch image URL:', fetchErr);
        return res.status(400).json({ success: false, message: 'Failed to fetch image from URL' });
      }
    }
    
    const prompt = `You are a social media marketing expert. Analyze this image and create an engaging ${platform || 'Instagram'} caption for it.
${brandContext}

Requirements:
1. Write a catchy, engaging caption that matches the image content
2. Include relevant emojis
3. Add a clear call-to-action
4. Include exactly 4 relevant hashtags at the end
5. Keep it concise but impactful (2-4 sentences + hashtags)
6. Match the tone appropriate for ${platform || 'Instagram'}
7. ${strictBrandMode ? `STRICT BRAND LOCK: The caption MUST follow "${enforcedTone}" tone exactly and must not drift.` : 'Keep tone aligned to the brand context above.'}
8. ${strictBrandMode ? 'If there is conflict between platform defaults and brand profile, prioritize brand profile.' : 'Balance platform-native style with brand voice.'}

Return ONLY the caption text with hashtags. No JSON, no explanations.`;

    // Call Gemini with vision
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    const apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
    
    const requestBody = {
      contents: [{
        parts: [
          {
            inlineData: {
              mimeType: mimeType,
              data: imageData
            }
          },
          { text: prompt }
        ]
      }],
      generationConfig: {
        temperature: 0.8,
        maxOutputTokens: 500
      }
    };
    
    const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
    const response = await fetch(`${apiUrl}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      console.error('Gemini caption error:', data);
      return res.status(500).json({
        success: false,
        message: data.error?.message || 'Failed to generate caption'
      });
    }
    
    // Extract caption from response
    const caption = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    if (!caption) {
      return res.status(500).json({
        success: false,
        message: 'No caption generated'
      });
    }
    
    // Extract hashtags from caption
    const hashtagRegex = /#\w+/g;
    const hashtags = caption.match(hashtagRegex) || [];
    
    console.log('✅ Caption generated successfully');

    // Deduct 2 credits for caption generation
    const captionCreditResult = await deductCredits(userId, 'campaign_text', 1, `AI caption for ${platform || 'instagram'}`);
    
    res.json({
      success: true,
      caption: caption.trim(),
      hashtags: hashtags.slice(0, 4),
      creditsRemaining: captionCreditResult.creditsRemaining
    });
    
  } catch (error) {
    console.error('Generate caption error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to generate caption', 
      error: error.message 
    });
  }
});

/**
 * POST /api/campaigns/process-aspect-ratio
 * Process image to fit aspect ratio with padding (no cropping)
 */
router.post('/process-aspect-ratio', protect, async (req, res) => {
  try {
    const { image, aspectRatio } = req.body;
    
    if (!image) {
      return res.status(400).json({ success: false, message: 'Image is required' });
    }
    
    console.log('📐 Processing image for aspect ratio:', aspectRatio);
    
    // Parse aspect ratio
    const ratioMap = {
      '1:1': 1,
      '4:5': 4/5,
      '16:9': 16/9,
      '9:16': 9/16,
      'original': null
    };
    
    const targetRatio = ratioMap[aspectRatio];
    
    if (targetRatio === null || aspectRatio === 'original') {
      // Return original image
      return res.json({
        success: true,
        imageBase64: image,
        message: 'Original aspect ratio kept'
      });
    }
    
    // Extract base64 data — handle URLs, data URIs, and raw base64
    let imageData = image;
    let mimeType = 'image/png';
    if (image.startsWith('data:')) {
      const matches = image.match(/^data:([^;]+);base64,(.+)$/);
      if (matches) {
        mimeType = matches[1];
        imageData = matches[2];
      }
    } else if (image.startsWith('http://') || image.startsWith('https://')) {
      const fetchImg = (...args) => import('node-fetch').then(({default: f}) => f(...args));
      try {
        const imgResponse = await fetchImg(image);
        const buffer = await imgResponse.buffer();
        imageData = buffer.toString('base64');
        const contentType = imgResponse.headers.get('content-type');
        if (contentType) mimeType = contentType.split(';')[0];
      } catch (fetchErr) {
        console.error('Failed to fetch image URL:', fetchErr);
        return res.status(400).json({ success: false, message: 'Failed to fetch image from URL' });
      }
    }
    
    // Use sharp for image processing
    const sharp = require('sharp');
    const buffer = Buffer.from(imageData, 'base64');
    
    // Get image dimensions
    const metadata = await sharp(buffer).metadata();
    const originalWidth = metadata.width;
    const originalHeight = metadata.height;
    const originalRatio = originalWidth / originalHeight;
    
    console.log(`Original: ${originalWidth}x${originalHeight} (${originalRatio.toFixed(2)})`);
    console.log(`Target ratio: ${targetRatio.toFixed(2)}`);
    
    let newWidth, newHeight;
    
    if (originalRatio > targetRatio) {
      // Image is wider than target - add padding top/bottom
      newWidth = originalWidth;
      newHeight = Math.round(originalWidth / targetRatio);
    } else {
      // Image is taller than target - add padding left/right  
      newHeight = originalHeight;
      newWidth = Math.round(originalHeight * targetRatio);
    }
    
    console.log(`New dimensions: ${newWidth}x${newHeight}`);
    
    // Get dominant edge color for padding
    const edgePixels = await sharp(buffer)
      .resize(1, 1)
      .raw()
      .toBuffer();
    
    const bgColor = {
      r: edgePixels[0] || 0,
      g: edgePixels[1] || 0,
      b: edgePixels[2] || 0
    };
    
    // Create canvas with new dimensions and place image centered
    const processedBuffer = await sharp({
      create: {
        width: newWidth,
        height: newHeight,
        channels: 3,
        background: bgColor
      }
    })
    .composite([{
      input: buffer,
      gravity: 'center'
    }])
    .png()
    .toBuffer();
    
    const processedBase64 = `data:image/png;base64,${processedBuffer.toString('base64')}`;
    
    // Upload to Cloudinary
    const { ensurePublicUrl } = require('../services/imageUploader');
    let imageUrl = null;
    try {
      imageUrl = await ensurePublicUrl(processedBase64);
      console.log('✅ Processed image uploaded:', imageUrl);
    } catch (uploadError) {
      console.warn('⚠️ Could not upload processed image');
    }
    
    res.json({
      success: true,
      imageBase64: processedBase64,
      imageUrl: imageUrl,
      originalDimensions: { width: originalWidth, height: originalHeight },
      newDimensions: { width: newWidth, height: newHeight },
      message: `Image processed to ${aspectRatio} aspect ratio`
    });
    
  } catch (error) {
    console.error('Process aspect ratio error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to process image', 
      error: error.message 
    });
  }
});

/**
 * POST /api/campaigns/template-poster
 * Generate a poster from a template image and content
 * Uses Canvas for reliable text overlay, AI as fallback
 * Supports logo overlay from Brand Assets
 */
router.post('/template-poster', protect, checkTrial, requireCredits('image_generated'), async (req, res) => {
  try {
    const { templateImage, content, platform, style, useAI, logoOverlay, aspectRatio } = req.body;
    const userId = req.user.userId || req.user.id || req.user._id;
    const user = await User.findById(userId).select('businessProfile companyName');
    const bp = user?.businessProfile || {};
    const brandCtx = await resolveBrandIntelligenceContext(userId, bp);
    const strictBrandMode = isStrictBrandLockEnabled(brandCtx);
    const enforcedTone = strictBrandMode
      ? brandCtx.effectiveTone
      : String(style || brandCtx?.effectiveTone || 'professional').toLowerCase();
    const strictBrandText = strictBrandMode ? buildStrictBrandLockText(brandCtx) : '';
    const effectiveStyle = strictBrandMode
      ? [brandCtx?.guidelineBundle?.effectiveProfile?.visualStyle || '', enforcedTone].filter(Boolean).join(', ')
      : style;
    const autoLogoOverlay =
      strictBrandMode && !logoOverlay?.enabled && brandCtx?.primaryLogoUrl
        ? { enabled: true, logoUrl: brandCtx.primaryLogoUrl }
        : logoOverlay;
    
    if (!templateImage) {
      return res.status(400).json({ 
        success: false, 
        message: 'Template image is required' 
      });
    }
    
    if (!content || content.trim().length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Poster content is required' 
      });
    }
    
    console.log('🎨 Generating template poster...');
    console.log('📝 Content length:', content.length, 'characters');
    console.log('📱 Platform:', platform || 'general');
    
    // Always use AI (Gemini) for poster generation - it produces better results
    const result = await generateTemplatePoster(templateImage, content, {
      platform: platform || 'instagram',
      style: effectiveStyle,
      tone: enforcedTone,
      brandGuidelines: [strictBrandText, brandCtx?.guidelineBundle?.instructions || ''].filter(Boolean).join('\n'),
      brandPalette: getBrandPalette(brandCtx),
      fontType: brandCtx?.profile?.assets?.fontType || '',
      aspectRatio: aspectRatio || null
    });

    if (result.success) {
      console.log('✅ Template poster generated successfully with', result.model || result.method);

      let finalImageBase64 = result.imageBase64;
      let hostedUrl = null;
      let logoReplaced = false;

      // If an aspect ratio is requested, adjust the image BEFORE any logo processing
      if (aspectRatio && aspectRatio !== 'original' && finalImageBase64) {
        try {
          console.log('📐 Applying aspect ratio during template poster generation:', aspectRatio);

          // Reuse the same logic as /process-aspect-ratio but inline here
          const ratioMap = {
            '1:1': 1,
            '4:5': 4/5,
            '16:9': 16/9,
            '9:16': 9/16,
            '3:4': 3/4,
            '4:3': 4/3
          };

          const targetRatio = ratioMap[aspectRatio];

          if (targetRatio) {
            let imageData = finalImageBase64;
            let mimeType = 'image/png';
            if (imageData.startsWith('data:')) {
              const matches = imageData.match(/^data:([^;]+);base64,(.+)$/);
              if (matches) {
                mimeType = matches[1];
                imageData = matches[2];
              }
            }

            const sharp = require('sharp');
            const buffer = Buffer.from(imageData, 'base64');
            const metadata = await sharp(buffer).metadata();
            const originalWidth = metadata.width;
            const originalHeight = metadata.height;

            if (originalWidth && originalHeight) {
              const originalRatio = originalWidth / originalHeight;
              let newWidth, newHeight;

              if (originalRatio > targetRatio) {
                newWidth = originalWidth;
                newHeight = Math.round(originalWidth / targetRatio);
              } else {
                newHeight = originalHeight;
                newWidth = Math.round(originalHeight * targetRatio);
              }

              const edgePixels = await sharp(buffer)
                .resize(1, 1)
                .raw()
                .toBuffer();

              const bgColor = {
                r: edgePixels[0] || 0,
                g: edgePixels[1] || 0,
                b: edgePixels[2] || 0
              };

              const processedBuffer = await sharp({
                create: {
                  width: newWidth,
                  height: newHeight,
                  channels: 3,
                  background: bgColor
                }
              })
              .composite([{
                input: buffer,
                gravity: 'center'
              }])
              .toFormat(mimeType.includes('jpeg') ? 'jpeg' : 'png')
              .toBuffer();

              finalImageBase64 = `data:${mimeType.includes('jpeg') ? 'image/jpeg' : 'image/png'};base64,${processedBuffer.toString('base64')}`;
            }
          }
        } catch (ratioError) {
          console.warn('⚠️ Aspect ratio adjustment during template poster generation failed, using original image:', ratioError.message);
        }
      }
      
      // Auto-detect and replace logo if user has a logo and enabled the feature
      if (autoLogoOverlay?.enabled && autoLogoOverlay?.logoUrl) {
        try {
          console.log('🔍 Detecting logo in generated poster...');
          
          // Use AI to detect where the logo/emblem is in the generated image
          const detection = await detectLogoInImage(finalImageBase64);
          
          if (detection.success && detection.detected && detection.bbox) {
            console.log(`✅ Logo detected at (${detection.bbox.x}%, ${detection.bbox.y}%) with ${(detection.confidence * 100).toFixed(0)}% confidence`);
            
            // Replace the detected logo with user's brand logo
            const replaceResult = await replaceLogoAtBboxAndUpload(
              finalImageBase64,
              autoLogoOverlay.logoUrl,
              detection.bbox
            );
            
            if (replaceResult.success) {
              hostedUrl = replaceResult.url;
              finalImageBase64 = replaceResult.imageBase64 || finalImageBase64;
              logoReplaced = true;
              console.log('✅ Logo replaced and uploaded:', hostedUrl);
            } else {
              console.warn('⚠️ Logo replacement failed, using original image');
            }
          } else {
            console.log('ℹ️ No logo detected in poster, applying overlay at default position');
            // Fallback: overlay at bottom-right if no logo detected
            const overlayResult = await overlayLogoAndUpload(
              finalImageBase64,
              autoLogoOverlay.logoUrl,
              {
                position: 'bottom-right',
                size: 'medium',
                opacity: 0.9,
                padding: 20
              }
            );
            
            if (overlayResult.success) {
              hostedUrl = overlayResult.url;
              logoReplaced = true;
              console.log('✅ Logo overlay applied at default position:', hostedUrl);
            }
          }
        } catch (logoError) {
          console.warn('⚠️ Logo processing error:', logoError.message);
        }
      }
      
      // If no logo processing or it failed, upload the base image
      if (!hostedUrl) {
        try {
          const uploadResult = await ensurePublicUrl(finalImageBase64);
          if (uploadResult) {
            hostedUrl = uploadResult;
            console.log('✅ Poster uploaded to Cloudinary:', hostedUrl);
          }
        } catch (uploadError) {
          console.warn('⚠️ Could not upload to Cloudinary, returning base64');
        }
      }
      
      // Deduct credits for image generation
      const posterCreditResult = await deductCredits(userId, 'image_generated', 1, 'Generated template poster');

      res.json({
        success: true,
        imageBase64: finalImageBase64,
        imageUrl: hostedUrl,
        model: result.model || result.method,
        logoApplied: logoReplaced,
        message: 'Poster generated successfully',
        creditsRemaining: posterCreditResult.creditsRemaining
      });
    } else {
      res.status(500).json({
        success: false,
        message: result.error || 'Failed to generate poster'
      });
    }
  } catch (error) {
    console.error('Template poster generation error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to generate poster', 
      error: error.message 
    });
  }
});

/**
 * POST /api/campaigns/template-poster/edit
 * Edit/refine a generated poster based on user feedback
 * Supports iterative refinement through conversational prompts
 */
router.post('/template-poster/edit', protect, checkTrial, requireCredits('image_edit'), async (req, res) => {
  try {
    const { currentImage, originalContent, editInstructions, templateImage } = req.body;
    const userId = req.user.userId || req.user.id || req.user._id;
    const user = await User.findById(userId).select('businessProfile companyName');
    const bp = user?.businessProfile || {};
    const brandCtx = await resolveBrandIntelligenceContext(userId, bp);
    const strictBrandText = isStrictBrandLockEnabled(brandCtx) ? buildStrictBrandLockText(brandCtx) : '';
    
    if (!currentImage) {
      return res.status(400).json({ 
        success: false, 
        message: 'Current poster image is required' 
      });
    }
    
    if (!editInstructions || editInstructions.trim().length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Edit instructions are required' 
      });
    }
    
    console.log('✏️ Editing template poster...');
    console.log('📝 Edit instructions:', editInstructions.substring(0, 100));
    
    const effectiveEditInstructions = strictBrandText
      ? `${editInstructions}\n\n${strictBrandText}`
      : editInstructions;

    // Always use AI (Gemini) for editing - it produces better results
    const result = await editTemplatePoster(
      currentImage, 
      originalContent || '', 
      effectiveEditInstructions,
      templateImage
    );
    
    if (result.success) {
      console.log('✅ Poster edited successfully');

      // Deduct credits for image edit
      const editCreditResult = await deductCredits(userId, 'image_edit', 1, 'Edited template poster');

      // Upload to Cloudinary
      let hostedUrl = null;
      try {
        const uploadResult = await ensurePublicUrl(result.imageBase64);
        if (uploadResult) {
          hostedUrl = uploadResult;
        }
      } catch (uploadError) {
        console.warn('⚠️ Could not upload edited image to Cloudinary');
      }
      
      res.json({
        success: true,
        imageBase64: result.imageBase64,
        imageUrl: hostedUrl,
        model: result.model || result.method,
        message: 'Poster updated successfully',
        creditsRemaining: editCreditResult.creditsRemaining
      });
    } else {
      res.status(500).json({
        success: false,
        message: result.error || 'Failed to edit poster'
      });
    }
  } catch (error) {
    console.error('Template poster edit error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to edit poster', 
      error: error.message 
    });
  }
});

/**
 * POST /api/campaigns/template-poster/from-reference
 * Generate a NEW poster using a REFERENCE image for style inspiration
 * The AI creates a poster that LOOKS LIKE the reference but uses user's content
 */
router.post('/template-poster/from-reference', protect, checkTrial, requireCredits('image_generated'), async (req, res) => {
  try {
    const { referenceImage, content, platform, logoUrl, aspectRatio } = req.body;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Content is required for the poster'
      });
    }

    const userId = req.user.userId || req.user.id || req.user._id;
    const user = await User.findById(userId).select('businessProfile companyName');
    const bp = user?.businessProfile || {};
    const brandCtx = await resolveBrandIntelligenceContext(userId, bp);
    const strictBrandMode = isStrictBrandLockEnabled(brandCtx);
    const enforcedTone = strictBrandMode
      ? brandCtx.effectiveTone
      : String(brandCtx?.effectiveTone || 'professional').toLowerCase();
    const strictBrandText = strictBrandMode ? buildStrictBrandLockText(brandCtx) : '';
    const effectiveLogoUrl = logoUrl || brandCtx?.primaryLogoUrl || null;
    const effectiveBrandName =
      String(brandCtx?.profile?.brandName || bp?.companyName || user?.companyName || req.user.companyName || 'Brand').trim() || 'Brand';
    const effectiveIndustry = bp?.industry || req.user.industry || '';

    // AI Generate from scratch (no reference image)
    if (!referenceImage) {
      console.log('🎨 Generating poster from scratch with AI (Nano Banana 2)...');
      console.log('📝 Content:', content.substring(0, 100) + (content.length > 100 ? '...' : ''));

      const imageResult = await generateCampaignImageNanoBanana(content, {
        aspectRatio: aspectRatio || '1:1',
        brandName: effectiveBrandName,
        brandLogo: effectiveLogoUrl,
        industry: effectiveIndustry,
        tone: enforcedTone || 'professional',
        strictBrandLock: strictBrandMode,
        brandPalette: getBrandPalette(brandCtx),
        fontType: brandCtx?.profile?.assets?.fontType || '',
        keyMessages: [strictBrandText, brandCtx?.guidelineBundle?.instructions || ''].filter(Boolean).join('\n')
      });

      // imageResult can be a string (URL) or object { success, imageUrl }
      const finalImageUrl = typeof imageResult === 'string' ? imageResult : imageResult?.imageUrl;

      if (finalImageUrl) {
        const creditResult = await deductCredits(userId, 'image_generated', 1, 'Generated poster from prompt');
        return res.json({
          success: true,
          imageBase64: finalImageUrl,
          imageUrl: finalImageUrl,
          model: 'nano-banana-2',
          creditsRemaining: creditResult.creditsRemaining
        });
      } else {
        return res.status(500).json({
          success: false,
          message: 'Failed to generate poster',
          error: 'Image generation returned no result'
        });
      }
    }

    // Generate from reference image
    console.log('🎨 Generating poster from reference image with AI...');
    console.log('📝 Content:', content.substring(0, 100) + (content.length > 100 ? '...' : ''));

    const result = await generatePosterFromReference(referenceImage, content, {
      platform: platform || 'instagram',
      style: brandCtx?.guidelineBundle?.effectiveProfile?.visualStyle || '',
      tone: enforcedTone || 'professional',
      brandGuidelines: [strictBrandText, brandCtx?.guidelineBundle?.instructions || ''].filter(Boolean).join('\n'),
      brandPalette: getBrandPalette(brandCtx),
      fontType: brandCtx?.profile?.assets?.fontType || '',
      aspectRatio: aspectRatio || null
    });

    if (result.success) {
      let finalImageBase64 = result.imageBase64;

      // Upload to Cloudinary for public URL
      let hostedUrl = null;
      try {
        const uploadResult = await ensurePublicUrl(finalImageBase64);
        if (uploadResult) {
          hostedUrl = uploadResult;
          console.log('✅ Poster uploaded to Cloudinary:', hostedUrl);
        }
      } catch (uploadError) {
        console.warn('Could not upload to Cloudinary:', uploadError.message);
      }

      // Deduct credits for image generation from reference
      const refCreditResult = await deductCredits(userId, 'image_generated', 1, 'Generated poster from reference');

      return res.json({
        success: true,
        imageBase64: finalImageBase64,
        imageUrl: hostedUrl,
        model: result.model,
        creditsRemaining: refCreditResult.creditsRemaining
      });
    } else {
      return res.status(500).json({
        success: false,
        message: 'Failed to generate poster from reference',
        error: result.error
      });
    }
  } catch (error) {
    console.error('Error generating poster from reference:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to generate poster from reference', 
      error: error.message 
    });
  }
});

/**
 * POST /api/campaigns/template-poster/batch
 * Generate multiple posters from multiple templates in batch
 */
router.post('/template-poster/batch', protect, checkTrial, requireCredits('image_generated', (req) => (req.body.posters?.length || 1)), async (req, res) => {
  try {
    const { posters, platform, useAI } = req.body;
    const userId = req.user.userId || req.user.id || req.user._id;
    const user = await User.findById(userId).select('businessProfile companyName');
    const bp = user?.businessProfile || {};
    const brandCtx = await resolveBrandIntelligenceContext(userId, bp);
    const strictBrandMode = isStrictBrandLockEnabled(brandCtx);
    const enforcedTone = strictBrandMode
      ? brandCtx.effectiveTone
      : String(brandCtx?.effectiveTone || 'professional').toLowerCase();
    const strictBrandText = strictBrandMode ? buildStrictBrandLockText(brandCtx) : '';
    
    if (!posters || !Array.isArray(posters) || posters.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Posters array is required' 
      });
    }
    
    if (posters.length > 10) {
      return res.status(400).json({ 
        success: false, 
        message: 'Maximum 10 posters per batch' 
      });
    }
    
    console.log(`🎨 Generating ${posters.length} template posters in batch...`);
    
    const results = [];
    
    for (let i = 0; i < posters.length; i++) {
      const { templateImage, content, style } = posters[i];
      
      if (!templateImage || !content) {
        results.push({
          index: i,
          success: false,
          error: 'Missing template or content'
        });
        continue;
      }
      
      console.log(`🎨 Generating poster ${i + 1}/${posters.length}...`);
      
      // Always use AI (Gemini) for poster generation
      const result = await generateTemplatePoster(templateImage, content, {
        platform: platform || 'instagram',
        style: strictBrandMode
          ? [brandCtx?.guidelineBundle?.effectiveProfile?.visualStyle || '', enforcedTone].filter(Boolean).join(', ')
          : style,
        tone: enforcedTone,
        brandGuidelines: [strictBrandText, brandCtx?.guidelineBundle?.instructions || ''].filter(Boolean).join('\n'),
        brandPalette: getBrandPalette(brandCtx),
        fontType: brandCtx?.profile?.assets?.fontType || ''
      });
      
      if (result.success) {
        // Upload to Cloudinary
        let hostedUrl = null;
        try {
          const uploadResult = await ensurePublicUrl(result.imageBase64);
          if (uploadResult) hostedUrl = uploadResult;
        } catch (e) {
          console.warn('Could not upload batch image', i);
        }
        
        results.push({
          index: i,
          success: true,
          imageBase64: result.imageBase64,
          imageUrl: hostedUrl,
          model: result.model || result.method
        });
        console.log(`✅ Poster ${i + 1} generated`);

        // Deduct credits per image generated in batch
        await deductCredits(userId, 'image_generated', 1, `Batch poster ${i + 1}`);
      } else {
        results.push({
          index: i,
          success: false,
          error: result.error
        });
      }
      
      // Rate limiting: wait 2 seconds between generations
      if (i < posters.length - 1) {
        await delay(2000);
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    console.log(`✅ Batch complete: ${successCount}/${posters.length} posters generated`);

    // Fetch latest credit balance for frontend
    const latestUser = await User.findById(req.user.userId || req.user.id || req.user._id).select('credits.balance');
    
    res.json({
      success: true,
      results,
      creditsRemaining: latestUser?.credits?.balance ?? 0,
      summary: {
        total: posters.length,
        successful: successCount,
        failed: posters.length - successCount
      }
    });
  } catch (error) {
    console.error('Batch poster generation error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Batch generation failed', 
      error: error.message 
    });
  }
});

module.exports = router;
