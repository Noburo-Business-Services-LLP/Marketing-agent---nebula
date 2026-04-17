const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { protect } = require('../middleware/auth');
const AdCampaign = require('../models/AdCampaign');
const Campaign = require('../models/Campaign');
const User = require('../models/User');
const {
  getAdAccounts,
  boostPost,
  getAyrshareUserProfile,
  getPostStatus,
  updateAd
} = require('../services/socialMediaAPI');

function getUserId(req) {
  return req.user?._id || req.user?.id || req.user?.userId || null;
}

function toObjectId(value) {
  const raw = String(value || '').trim();
  if (!mongoose.Types.ObjectId.isValid(raw)) return null;
  return new mongoose.Types.ObjectId(raw);
}

function normalizePlatformSelection(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'meta') return 'meta';
  if (raw === 'google') return 'google';
  if (raw === 'both') return 'both';
  return '';
}

function normalizeMetaPostPlatform(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'facebook') return 'facebook';
  if (raw === 'instagram') return 'instagram';
  return '';
}

function parseSelectedMetaPostPlatforms(value, { defaultToFacebook = true } = {}) {
  if (value === undefined || value === null) {
    return defaultToFacebook ? ['facebook'] : [];
  }

  const selected = new Set();
  const add = (entry) => {
    const normalized = normalizeMetaPostPlatform(entry);
    if (normalized) selected.add(normalized);
  };

  if (typeof value === 'string') {
    const token = value.trim().toLowerCase();
    if (token === 'both' || token === 'meta') {
      selected.add('facebook');
      selected.add('instagram');
    } else {
      add(token);
    }
  } else if (Array.isArray(value)) {
    for (const entry of value) add(entry);
  } else if (typeof value === 'object') {
    if (value.facebook === true) selected.add('facebook');
    if (value.instagram === true) selected.add('instagram');
  }

  return Array.from(selected);
}

function normalizeCurrency(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(raw)) return '';
  return raw;
}

const META_ACCOUNT_SETUP_INCOMPLETE_MESSAGE =
  'Ad account setup incomplete. Please add payment method and complete setup before creating ads.';
const META_CREATE_NOT_ELIGIBLE_MESSAGE =
  'Ad creation failed or not eligible. Please check ad account setup.';
const STANDALONE_ADS_DISABLED_MESSAGE =
  'Standalone ads are disabled. Please select a valid published campaign.';
const FACEBOOK_POST_MISSING_MESSAGE =
  'Facebook post not available.';
const INSTAGRAM_POST_MISSING_MESSAGE =
  'Instagram post not available.';
const AD_CREATE_REASON = Object.freeze({
  POST_NOT_READY: 'POST_NOT_READY',
  DUPLICATE_CONTENT: 'DUPLICATE_CONTENT',
  INVALID_POST_ID: 'INVALID_POST_ID',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  AD_ACCOUNT_SETUP_INCOMPLETE: 'AD_ACCOUNT_SETUP_INCOMPLETE'
});
const AD_CREATE_REASON_MESSAGE = Object.freeze({
  [AD_CREATE_REASON.POST_NOT_READY]: 'Your post is still being processed. Please try again shortly.',
  [AD_CREATE_REASON.DUPLICATE_CONTENT]: 'This content was already posted recently. Please modify the content.',
  [AD_CREATE_REASON.INVALID_POST_ID]: 'No valid Facebook post found. Please publish the campaign first.',
  [AD_CREATE_REASON.VALIDATION_ERROR]: 'Please select at least one post to create an ad.'
});

function getAdCreateReasonMessage(reason = '', fallbackMessage = '') {
  const token = String(reason || '').trim().toUpperCase();
  if (token === AD_CREATE_REASON.VALIDATION_ERROR && String(fallbackMessage || '').trim()) {
    return String(fallbackMessage).trim();
  }
  if (AD_CREATE_REASON_MESSAGE[token]) return AD_CREATE_REASON_MESSAGE[token];
  return String(fallbackMessage || META_CREATE_NOT_ELIGIBLE_MESSAGE);
}

function hasDuplicateContentTextSignal(value = '') {
  const text = String(value || '').toLowerCase();
  if (!text) return false;
  return (
    /\bduplicate\b/.test(text) ||
    /already\s+posted/.test(text) ||
    /already\s+exists/.test(text) ||
    /\bcode\s*137\b/.test(text) ||
    /\b137\b/.test(text)
  );
}

function hasDuplicateContentSignal({ campaignDoc = null, sourceInfo = null, metaStatus = null } = {}) {
  const candidates = [
    campaignDoc?.lastPublishError,
    sourceInfo?.error,
    sourceInfo?.ayrshareError,
    metaStatus?.message,
    metaStatus?.errorCode
  ];

  const sourceErrors = Array.isArray(sourceInfo?.errorDetails) ? sourceInfo.errorDetails : [];
  const metaErrors = Array.isArray(metaStatus?.errorDetails) ? metaStatus.errorDetails : [];
  for (const entry of [...sourceErrors, ...metaErrors]) {
    candidates.push(entry?.message, entry?.details, entry?.code);
  }

  return candidates.some((value) => hasDuplicateContentTextSignal(value));
}

function mapAdCreateReasonFromSourceInfo(sourceInfo = {}, campaignDoc = null) {
  const code = String(sourceInfo?.errorCode || '').trim().toUpperCase();
  if (code === 'POST_NOT_READY') return AD_CREATE_REASON.POST_NOT_READY;
  if (code === 'DUPLICATE_CONTENT') return AD_CREATE_REASON.DUPLICATE_CONTENT;
  if (['FACEBOOK_POST_ID_MISSING', 'INSTAGRAM_POST_ID_MISSING'].includes(code)) {
    return AD_CREATE_REASON.VALIDATION_ERROR;
  }
  if (['META_SOURCE_POST_INVALID', 'INVALID_FACEBOOK_POST_ID'].includes(code)) {
    return AD_CREATE_REASON.INVALID_POST_ID;
  }
  if (hasDuplicateContentSignal({ campaignDoc, sourceInfo })) {
    return AD_CREATE_REASON.DUPLICATE_CONTENT;
  }
  return '';
}

function mapAdCreateReasonFromMetaStatus(metaStatus = {}, campaignDoc = null) {
  const code = String(metaStatus?.errorCode || '').trim().toUpperCase();
  if (code === 'POST_NOT_READY') return AD_CREATE_REASON.POST_NOT_READY;
  if (code === 'DUPLICATE_CONTENT') return AD_CREATE_REASON.DUPLICATE_CONTENT;
  if (['INVALID_FACEBOOK_POST_ID', 'META_CREATE_ID_MISSING', 'META_SOURCE_POST_INVALID', 'INVALID_INSTAGRAM_POST_ID'].includes(code)) {
    return AD_CREATE_REASON.INVALID_POST_ID;
  }
  if (code === 'META_ACCOUNT_SETUP_INCOMPLETE') return AD_CREATE_REASON.AD_ACCOUNT_SETUP_INCOMPLETE;
  if (hasDuplicateContentSignal({ campaignDoc, metaStatus })) {
    return AD_CREATE_REASON.DUPLICATE_CONTENT;
  }
  return '';
}

const COUNTRY_NAME_TO_CODE = {
  india: 'IN',
  bharat: 'IN',
  usa: 'US',
  'u.s.a': 'US',
  'united states': 'US',
  'united states of america': 'US',
  uk: 'GB',
  'united kingdom': 'GB',
  england: 'GB',
  canada: 'CA',
  australia: 'AU',
  germany: 'DE',
  france: 'FR',
  italy: 'IT',
  spain: 'ES',
  japan: 'JP',
  singapore: 'SG',
  uae: 'AE',
  'united arab emirates': 'AE'
};

function normalizeCountryCode(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const upper = raw.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper)) return upper;

  const lower = raw.toLowerCase();
  return COUNTRY_NAME_TO_CODE[lower] || '';
}

function normalizeCountryCodeList(values = []) {
  const list = Array.isArray(values) ? values : [values];
  const deduped = [];
  const seen = new Set();

  for (const entry of list) {
    const code =
      normalizeCountryCode(entry) ||
      extractCountryCodeFromText(entry);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    deduped.push(code);
  }

  return deduped;
}

function extractCountryCodeFromText(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const direct = normalizeCountryCode(raw);
  if (direct) return direct;

  const segments = raw
    .split(/[,|/\\>\-]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const code = normalizeCountryCode(segments[index]);
    if (code) return code;
  }

  const lowered = raw.toLowerCase();
  for (const [countryName, countryCode] of Object.entries(COUNTRY_NAME_TO_CODE)) {
    if (lowered.includes(countryName)) return countryCode;
  }

  return '';
}

function getRequestedTargetCountries(payload = {}) {
  const candidates = [
    payload?.targetCountries,
    payload?.countries,
    payload?.locations?.countries,
    payload?.targeting?.locations?.countries
  ];

  for (const candidate of candidates) {
    const normalized = normalizeCountryCodeList(candidate);
    if (normalized.length > 0) return normalized;
  }

  return [];
}

function extractCountryCodeFromAdAccount(account = {}) {
  if (!account || typeof account !== 'object') return '';

  const directCandidates = [
    account.countryCode,
    account.country_code,
    account.country,
    account.accountCountry,
    account.account_country,
    account.businessCountry,
    account.business_country,
    account.businessCountryCode,
    account.business_country_code,
    account.pageCountry,
    account.page_country,
    account.pageCountryCode,
    account.page_country_code
  ];

  for (const candidate of directCandidates) {
    const code = normalizeCountryCode(candidate) || extractCountryCodeFromText(candidate);
    if (code) return code;
  }

  const nestedNodes = [
    account.business,
    account.account,
    account.page,
    account.meta,
    account.details,
    account.location,
    account.address
  ];

  for (const node of nestedNodes) {
    if (!node || typeof node !== 'object') continue;
    const nestedCandidates = [
      node.countryCode,
      node.country_code,
      node.country,
      node.accountCountry,
      node.account_country,
      node.businessCountry,
      node.business_country,
      node.pageCountry,
      node.page_country
    ];
    for (const candidate of nestedCandidates) {
      const code = normalizeCountryCode(candidate) || extractCountryCodeFromText(candidate);
      if (code) return code;
    }
  }

  return '';
}

function resolveUserDefaultCountry(userDoc = {}) {
  const candidates = [
    userDoc?.businessProfile?.country,
    userDoc?.businessProfile?.businessLocation,
    userDoc?.businessProfile?.location,
    userDoc?.location
  ];

  for (const candidate of candidates) {
    const code = normalizeCountryCode(candidate) || extractCountryCodeFromText(candidate);
    if (code) return code;
  }

  return '';
}

function parseBooleanish(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
    return null;
  }

  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;

  if (
    ['true', 'yes', 'y', '1', 'enabled', 'active', 'verified', 'complete', 'completed', 'ready', 'ok'].includes(raw)
  ) {
    return true;
  }

  if (
    ['false', 'no', 'n', '0', 'disabled', 'inactive', 'unverified', 'pending', 'incomplete', 'failed', 'none', 'missing'].includes(raw)
  ) {
    return false;
  }

  return null;
}

function getNestedValue(obj, path) {
  const keys = String(path || '')
    .split('.')
    .map((entry) => entry.trim())
    .filter(Boolean);
  let cursor = obj;
  for (const key of keys) {
    if (!cursor || typeof cursor !== 'object') return undefined;
    cursor = cursor[key];
  }
  return cursor;
}

function resolveBooleanFromPaths(source = {}, paths = []) {
  for (const path of paths) {
    const parsed = parseBooleanish(getNestedValue(source, path));
    if (parsed !== null) return parsed;
  }
  return null;
}

function normalizeStatusToken(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
}

function isCampaignPublishedForAds(campaignDoc = {}) {
  const status = normalizeStatusToken(campaignDoc?.status);
  return status === 'posted' || status === 'published';
}

function resolveMetaAdAccountActiveState(account = {}) {
  const statusCandidates = [
    account?.status,
    account?.accountStatus,
    account?.account_status,
    account?.adAccountStatus,
    account?.ad_account_status,
    account?.state,
    account?.details?.status,
    account?.account?.status
  ];

  for (const candidate of statusCandidates) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric) && Number.isInteger(numeric)) {
      // Meta account_status: 1 means active. Others generally require resolution before serving ads.
      return numeric === 1;
    }

    const token = normalizeStatusToken(candidate);
    if (!token) continue;
    if (['active', 'enabled', 'open', 'ready'].includes(token)) return true;
    if (['disabled', 'inactive', 'closed', 'archived', 'pending', 'restricted', 'blocked', 'not_active'].includes(token)) {
      return false;
    }
  }

  // If account exists and no explicit "inactive" signal, treat as active enough for preflight.
  return true;
}

function resolveMetaAdAccountPaymentMethodState(account = {}) {
  const boolPaths = [
    'hasPaymentMethod',
    'paymentMethodAdded',
    'isPaymentMethodAdded',
    'paymentAdded',
    'paymentSetupComplete',
    'hasFundingSource',
    'fundingSourceAdded',
    'readyForAds',
    'account.hasPaymentMethod',
    'details.hasPaymentMethod',
    'meta.hasPaymentMethod'
  ];
  const direct = resolveBooleanFromPaths(account, boolPaths);
  if (direct !== null) return direct;

  const statusCandidates = [
    account?.paymentStatus,
    account?.payment_status,
    account?.fundingStatus,
    account?.funding_status,
    account?.fundingSourceStatus
  ];
  for (const candidate of statusCandidates) {
    const token = normalizeStatusToken(candidate);
    if (!token) continue;
    if (['active', 'added', 'configured', 'ready', 'complete', 'enabled'].includes(token)) return true;
    if (['none', 'missing', 'not_set', 'incomplete', 'pending', 'disabled', 'failed'].includes(token)) return false;
  }

  const disableReasonBlob = [
    account?.disableReason,
    account?.disable_reason,
    account?.details?.disableReason,
    account?.details?.disable_reason
  ]
    .map((entry) => String(entry || '').toLowerCase())
    .join(' | ');
  if (/\b(payment|funding|fund)\b/.test(disableReasonBlob)) return false;

  // Require explicit payment readiness to avoid creating non-runnable ads.
  return false;
}

function resolveMetaPhoneVerificationRequiredState(account = {}) {
  const required = resolveBooleanFromPaths(account, [
    'phoneVerificationRequired',
    'isPhoneVerificationRequired',
    'requiresPhoneVerification',
    'phoneVerification.required',
    'account.phoneVerificationRequired'
  ]);
  if (required !== null) return required;

  const token = normalizeStatusToken(
    account?.phoneVerificationStatus ||
      account?.phone_verification_status ||
      account?.details?.phoneVerificationStatus
  );
  if (!token) return false;
  if (['required', 'pending', 'unverified', 'not_verified'].includes(token)) return true;
  if (['verified', 'not_required', 'none', 'n_a'].includes(token)) return false;
  return false;
}

function resolveMetaPhoneVerifiedState(account = {}) {
  const verified = resolveBooleanFromPaths(account, [
    'phoneVerified',
    'isPhoneVerified',
    'phoneVerificationVerified',
    'phoneVerification.verified',
    'account.phoneVerified'
  ]);
  if (verified !== null) return verified;

  const token = normalizeStatusToken(
    account?.phoneVerificationStatus ||
      account?.phone_verification_status ||
      account?.details?.phoneVerificationStatus
  );
  if (!token) return null;
  if (['verified', 'complete', 'completed', 'ok'].includes(token)) return true;
  if (['required', 'pending', 'unverified', 'not_verified', 'failed'].includes(token)) return false;
  return null;
}

function evaluateMetaAdAccountReadiness(account = {}) {
  const adAccountActive = resolveMetaAdAccountActiveState(account);
  const paymentMethodAdded = resolveMetaAdAccountPaymentMethodState(account);
  const phoneVerificationRequired = resolveMetaPhoneVerificationRequiredState(account);
  const phoneVerified = resolveMetaPhoneVerifiedState(account);

  const ready =
    adAccountActive === true &&
    paymentMethodAdded === true &&
    (phoneVerificationRequired !== true || phoneVerified === true);

  return {
    ready,
    adAccountActive,
    paymentMethodAdded,
    phoneVerificationRequired,
    phoneVerified
  };
}

function buildFailedPlatformResult(message, errorCode = '') {
  return {
    status: 'failed',
    message: String(message || 'Platform request failed'),
    externalAdId: '',
    errorCode: String(errorCode || ''),
    currency: ''
  };
}

function buildSkippedPlatformResult(message) {
  return {
    status: 'skipped',
    message: String(message || 'Not selected'),
    externalAdId: '',
    errorCode: '',
    currency: ''
  };
}

function getCampaignPrimaryImage(campaignDoc) {
  return String(
    (Array.isArray(campaignDoc?.creative?.imageUrls) && campaignDoc.creative.imageUrls[0]) ||
      campaignDoc?.creative?.videoUrl ||
      ''
  ).trim();
}

function getCampaignCaptionText(campaignDoc) {
  return String(
    campaignDoc?.creative?.captions ||
      campaignDoc?.creative?.textContent ||
      ''
  ).trim();
}

function getCampaignCaption(campaignDoc) {
  const base = getCampaignCaptionText(campaignDoc);

  const tags = Array.isArray(campaignDoc?.creative?.hashtags)
    ? campaignDoc.creative.hashtags
        .map((tag) => String(tag || '').trim())
        .filter(Boolean)
        .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`))
    : [];

  if (tags.length === 0) return base;
  return `${base}\n\n${tags.join(' ')}`.trim();
}

function normalizeConnectedPlatforms(userDoc) {
  const fromAyrshare = Array.isArray(userDoc?.ayrshare?.activeSocialAccounts)
    ? userDoc.ayrshare.activeSocialAccounts
        .map((name) => normalizeConnectedPlatformName(name))
        .filter(Boolean)
    : [];
  const fromConnectedSocials = Array.isArray(userDoc?.connectedSocials)
    ? userDoc.connectedSocials
        .map((entry) => normalizeConnectedPlatformName(entry?.platform))
        .filter(Boolean)
    : [];
  return Array.from(new Set([...fromAyrshare, ...fromConnectedSocials]));
}

function isValidHttpUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (error) {
    return false;
  }
}

function sanitizeHandle(value) {
  return String(value || '')
    .trim()
    .replace(/^@+/, '')
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/^facebook\.com\//i, '')
    .replace(/^instagram\.com\//i, '')
    .replace(/^\/+|\/+$/g, '')
    .trim();
}

function normalizeFacebookPageUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (isValidHttpUrl(raw)) return raw;

  const handle = sanitizeHandle(raw);
  if (!handle) return '';
  return `https://www.facebook.com/${encodeURIComponent(handle)}`;
}

function normalizeInstagramProfileUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (isValidHttpUrl(raw)) return raw;

  const handle = sanitizeHandle(raw);
  if (!handle) return '';
  return `https://www.instagram.com/${encodeURIComponent(handle)}`;
}

function firstNormalizedUrl(candidates = [], normalizer) {
  for (const candidate of candidates) {
    const url = normalizer(candidate);
    if (isValidHttpUrl(url)) return url;
  }
  return '';
}

function normalizePlatformName(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'x') return 'twitter';
  return raw;
}

function isValidFacebookPostId(value) {
  const raw = String(value || '').trim();
  // Canonical FB post identifier expected by Meta Ads API: pageId_postId
  return /^\d{5,}_\d{5,}$/.test(raw);
}

function normalizeFacebookPostId(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return isValidFacebookPostId(raw) ? raw : '';
}

function normalizeConnectedPlatformName(value) {
  const raw = normalizePlatformName(value);
  if (raw.startsWith('facebook')) return 'facebook';
  if (raw.startsWith('instagram')) return 'instagram';
  if (raw.startsWith('google')) return 'google';
  return raw;
}

function resolveMetaProfileUrls({ userDoc, liveProfile = null, facebookPostId = '' }) {
  const connectedSocials = Array.isArray(userDoc?.connectedSocials) ? userDoc.connectedSocials : [];

  const storedDisplayNames = Array.isArray(userDoc?.ayrshare?.displayNames) ? userDoc.ayrshare.displayNames : [];
  const liveDisplayNames = Array.isArray(liveProfile?.displayNames) ? liveProfile.displayNames : [];
  const allDisplayNames = [...liveDisplayNames, ...storedDisplayNames];

  const findDisplay = (platform) =>
    allDisplayNames.find((entry) => normalizePlatformName(entry?.platform) === platform) || null;

  const findConnected = (platform) =>
    connectedSocials.find((entry) => normalizePlatformName(entry?.platform) === platform) || null;

  const facebookDisplay = findDisplay('facebook');
  const instagramDisplay = findDisplay('instagram');
  const facebookConnected = findConnected('facebook');
  const instagramConnected = findConnected('instagram');

  const fallbackFacebookPageId = String(facebookPostId || '').trim().split('_')[0] || '';

  const facebookPageUrl = firstNormalizedUrl(
    [
      facebookDisplay?.profileUrl,
      facebookConnected?.profileUrl,
      facebookConnected?.channelData?.profileUrl,
      facebookConnected?.channelData?.url,
      facebookConnected?.channelData?.link,
      facebookConnected?.channelData?.pageUrl,
      facebookConnected?.accountId,
      facebookConnected?.accountName,
      facebookConnected?.channelData?.username,
      facebookConnected?.channelData?.handle,
      facebookConnected?.channelData?.title,
      facebookDisplay?.username,
      facebookDisplay?.displayName,
      facebookDisplay?.id,
      fallbackFacebookPageId
    ],
    normalizeFacebookPageUrl
  );

  const instagramProfileUrl = firstNormalizedUrl(
    [
      instagramDisplay?.profileUrl,
      instagramConnected?.profileUrl,
      instagramConnected?.channelData?.profileUrl,
      instagramConnected?.channelData?.url,
      instagramConnected?.channelData?.link,
      instagramConnected?.accountName,
      instagramConnected?.accountId,
      instagramConnected?.channelData?.username,
      instagramConnected?.channelData?.handle,
      instagramConnected?.channelData?.title,
      instagramDisplay?.username,
      instagramDisplay?.displayName,
      instagramDisplay?.id
    ],
    normalizeInstagramProfileUrl
  );

  const ctaLink = facebookPageUrl || instagramProfileUrl;
  const ctaSourcePlatform = facebookPageUrl ? 'facebook' : (instagramProfileUrl ? 'instagram' : '');

  return {
    facebookPageUrl,
    instagramProfileUrl,
    ctaLink,
    ctaSourcePlatform
  };
}

const META_POST_READY_MESSAGE =
  'Post is still processing. Please wait before creating ad.';
const META_POST_READY_MIN_DELAY_MS = 30000;
const META_POST_READY_MAX_DELAY_MS = 60000;
const META_POST_READY_MAX_ATTEMPTS = 3;

function resolveMetaPostReadyDelayMs() {
  const rawValue = Number.parseInt(
    String(process.env.META_POST_READY_RETRY_DELAY_MS || '').trim(),
    10
  );
  if (!Number.isFinite(rawValue)) return META_POST_READY_MIN_DELAY_MS;
  return Math.min(
    META_POST_READY_MAX_DELAY_MS,
    Math.max(META_POST_READY_MIN_DELAY_MS, rawValue)
  );
}

const META_POST_READY_RETRY_DELAY_MS = resolveMetaPostReadyDelayMs();

function getAyrsharePostStatusValue(payload = {}) {
  return String(payload?.status || payload?.posts?.[0]?.status || '')
    .trim()
    .toLowerCase();
}

function isAyrsharePostReady(status) {
  return ['success', 'posted', 'published'].includes(String(status || '').toLowerCase());
}

function isAyrsharePostPending(status) {
  return ['processing', 'scheduled', 'pending', 'in_progress', 'queued'].includes(
    String(status || '').toLowerCase()
  );
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getAyrshareErrorCode(payload = null) {
  if (!payload) return '';

  const directCode = String(payload?.code || payload?.errorCode || '').trim();
  if (directCode) return directCode;

  const nestedErrors = Array.isArray(payload?.errors) ? payload.errors : [];
  for (const entry of nestedErrors) {
    const code = String(entry?.code || entry?.errorCode || '').trim();
    if (code) return code;
  }

  const nestedPosts = Array.isArray(payload?.posts) ? payload.posts : [];
  for (const post of nestedPosts) {
    const code = String(post?.code || post?.errorCode || '').trim();
    if (code) return code;
    const postErrors = Array.isArray(post?.errors) ? post.errors : [];
    for (const entry of postErrors) {
      const nestedCode = String(entry?.code || entry?.errorCode || '').trim();
      if (nestedCode) return nestedCode;
    }
  }

  return '';
}

function isDuplicateCode137FromResult(result = null) {
  const payloadCode = getAyrshareErrorCode(result?.data || null);
  if (payloadCode === '137') return true;

  const message = String(result?.error || result?.data?.message || result?.data?.error || '').toLowerCase();
  return /\b137\b/.test(message);
}

async function waitForAyrsharePostReady({ profileKey = '', postId = '' }) {
  const resolvedPostId = String(postId || '').trim();
  if (!resolvedPostId) {
    return {
      ready: false,
      status: '',
      attempts: 0,
      error: 'No post ID available for status verification.'
    };
  }

  let lastStatus = '';
  let lastError = '';

  for (let attempt = 1; attempt <= META_POST_READY_MAX_ATTEMPTS; attempt += 1) {
    const statusResult = await getPostStatus(resolvedPostId, { profileKey });
    if (statusResult?.success) {
      const postStatus = getAyrsharePostStatusValue(statusResult?.data);
      lastStatus = postStatus;

      if (isAyrsharePostReady(postStatus)) {
        return {
          ready: true,
          status: postStatus,
          attempts: attempt,
          data: statusResult?.data || null
        };
      }

      if (isAyrsharePostPending(postStatus) && attempt < META_POST_READY_MAX_ATTEMPTS) {
        await wait(META_POST_READY_RETRY_DELAY_MS);
        continue;
      }

      return {
        ready: false,
        status: postStatus,
        attempts: attempt,
        data: statusResult?.data || null
      };
    }

    lastError = String(statusResult?.error || '').trim();
    if (attempt < META_POST_READY_MAX_ATTEMPTS) {
      await wait(META_POST_READY_RETRY_DELAY_MS);
    }
  }

  return {
    ready: false,
    status: lastStatus,
    attempts: META_POST_READY_MAX_ATTEMPTS,
    error: lastError
  };
}

function extractPlatformPostIds(publishResult, requestedPlatforms = []) {
  const map = {};
  const payload = publishResult?.data || publishResult || {};
  const posts = Array.isArray(payload?.posts) ? payload.posts : [];

  const setPlatformId = (platform, postId, { override = false } = {}) => {
    const normalizedPlatform = String(platform || '').trim().toLowerCase();
    const normalizedPostId = String(postId || '').trim();
    if (!normalizedPlatform || !normalizedPostId) return;
    if (normalizedPlatform === 'facebook' && !isValidFacebookPostId(normalizedPostId)) {
      return;
    }
    if (override || !map[normalizedPlatform]) {
      map[normalizedPlatform] = normalizedPostId;
    }
  };

  const parsePostIdsArray = (postIds = []) => {
    if (!Array.isArray(postIds)) return;
    for (const entry of postIds) {
      if (!entry || typeof entry !== 'object') continue;
      const platform = String(entry.platform || '').trim().toLowerCase();
      const postId = String(entry.id || entry.postId || '').trim();
      if (platform && postId) {
        setPlatformId(platform, postId);
      }
    }
  };

  // Priority 1: use posts[0].fbId when present.
  if (posts.length > 0) {
    const firstPost = posts[0] || {};
    const firstFbId = String(firstPost?.fbId || firstPost?.facebookPostId || '').trim();
    if (firstFbId) {
      setPlatformId('facebook', firstFbId, { override: true });
    }
  }

  // Fallback priority: posts[0].postIds[] where platform === "facebook".
  if (!map.facebook && posts.length > 0) {
    parsePostIdsArray(posts[0]?.postIds);
  }

  // Parse all post-level entries for broader platform coverage.
  for (const post of posts) {
    const fbId = String(post?.fbId || post?.facebookPostId || '').trim();
    if (fbId) {
      setPlatformId('facebook', fbId, { override: true });
    }

    const igId = String(post?.igId || post?.instagramId || '').trim();
    if (igId) {
      setPlatformId('instagram', igId);
    }

    parsePostIdsArray(post?.postIds);

    const platform = String(post?.platform || '').trim().toLowerCase();
    const postId = String(post?.id || post?.postId || '').trim();
    if (platform && postId) {
      setPlatformId(platform, postId);
    }
  }

  // Parse any top-level postIds list if provided.
  parsePostIdsArray(payload?.postIds);

  // Parse top-level fbId if present.
  const topLevelFbId = String(payload?.fbId || payload?.facebookPostId || '').trim();
  if (topLevelFbId) {
    setPlatformId('facebook', topLevelFbId, { override: true });
  }

  // Final fallback for single-platform publish flows.
  if (Object.keys(map).length === 0) {
    const fallbackId = String(payload?.id || '').trim();
    if (fallbackId && Array.isArray(requestedPlatforms) && requestedPlatforms.length === 1) {
      const requestedPlatform = String(requestedPlatforms[0] || '').toLowerCase();
      // Never trust generic Ayrshare internal IDs as Facebook post IDs.
      if (requestedPlatform && requestedPlatform !== 'facebook') {
        setPlatformId(requestedPlatform, fallbackId);
      }
    }
  }

  return map;
}

function getStoredPostMap(campaignDoc) {
  const postMap = campaignDoc?.socialPostIds && typeof campaignDoc.socialPostIds === 'object'
    ? { ...campaignDoc.socialPostIds }
    : {};

  if (!postMap.facebook && campaignDoc?.facebookPostId) {
    postMap.facebook = campaignDoc.facebookPostId;
  }
  if (!postMap.instagram && campaignDoc?.instagramPostId) {
    postMap.instagram = campaignDoc.instagramPostId;
  }
  return postMap;
}

function getFacebookPostIdFromCampaign(campaignDoc) {
  const postMap = getStoredPostMap(campaignDoc);
  return normalizeFacebookPostId(
    campaignDoc?.facebookPostId ||
      postMap.facebook ||
      campaignDoc?.socialPostId ||
      ''
  );
}

const DUPLICATE_FACEBOOK_PUBLISH_MESSAGE =
  'A similar post exists but no reusable Facebook post was found.';

function normalizeAyrshareErrorEntry(entry, fallbackPlatform = '') {
  if (!entry) return null;
  if (typeof entry === 'string') {
    const message = String(entry || '').trim();
    if (!message) return null;
    return {
      code: '',
      platform: String(fallbackPlatform || '').trim().toLowerCase(),
      message,
      details: ''
    };
  }

  const code = String(entry.code ?? entry.errorCode ?? '').trim();
  const platform = String(entry.platform || fallbackPlatform || '').trim().toLowerCase();
  const message = String(entry.message || entry.error || entry.title || '').trim();
  const details = String(entry.details || entry.detail || '').trim();
  if (!code && !message && !details) return null;

  return {
    code,
    platform,
    message: message || details || 'Ayrshare publish error',
    details
  };
}

function dedupeAyrshareErrorDetails(errorDetails = []) {
  const seen = new Set();
  const deduped = [];
  for (const detail of errorDetails) {
    if (!detail) continue;
    const key = `${detail.code}|${detail.platform}|${detail.message}|${detail.details}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(detail);
  }
  return deduped;
}

function extractAyrsharePublishErrors(payload = {}, fallbackPlatforms = []) {
  const errors = [];
  const fallbackPlatform = Array.isArray(fallbackPlatforms) && fallbackPlatforms.length > 0
    ? String(fallbackPlatforms[0] || '').trim().toLowerCase()
    : '';

  if (Array.isArray(payload?.errors)) {
    for (const entry of payload.errors) {
      const normalized = normalizeAyrshareErrorEntry(entry, fallbackPlatform);
      if (normalized) errors.push(normalized);
    }
  }

  const posts = Array.isArray(payload?.posts) ? payload.posts : [];
  for (const post of posts) {
    const postPlatform = String(post?.platform || fallbackPlatform || '').trim().toLowerCase();
    if (Array.isArray(post?.errors)) {
      for (const entry of post.errors) {
        const normalized = normalizeAyrshareErrorEntry(entry, postPlatform);
        if (normalized) errors.push(normalized);
      }
    }

    if (String(post?.status || '').toLowerCase() === 'error') {
      const fallbackError = normalizeAyrshareErrorEntry(
        {
          code: post?.code || '',
          platform: postPlatform,
          message: post?.message || post?.error || '',
          details: post?.details || post?.detail || ''
        },
        postPlatform
      );
      if (fallbackError) errors.push(fallbackError);
    }
  }

  if (errors.length === 0 && String(payload?.status || '').toLowerCase() === 'error') {
    const fallbackError = normalizeAyrshareErrorEntry(
      {
        code: payload?.code || '',
        platform: fallbackPlatform,
        message: payload?.message || payload?.error || '',
        details: payload?.details || payload?.detail || ''
      },
      fallbackPlatform
    );
    if (fallbackError) errors.push(fallbackError);
  }

  return dedupeAyrshareErrorDetails(errors);
}

function getAyrshareErrorDetailsFromPublishResult(publishResult, fallbackPlatforms = []) {
  if (Array.isArray(publishResult?.errorDetails)) {
    return dedupeAyrshareErrorDetails(
      publishResult.errorDetails.map((entry) => normalizeAyrshareErrorEntry(entry)).filter(Boolean)
    );
  }
  return extractAyrsharePublishErrors(publishResult?.data || {}, fallbackPlatforms);
}

function summarizeAyrshareErrorDetails(errorDetails = []) {
  if (!Array.isArray(errorDetails) || errorDetails.length === 0) return '';
  return errorDetails
    .map((entry) => {
      const platformPrefix = entry.platform ? `${entry.platform}: ` : '';
      const codePrefix = entry.code ? `[${entry.code}] ` : '';
      const detailsSuffix = entry.details ? ` (${entry.details})` : '';
      return `${platformPrefix}${codePrefix}${entry.message}${detailsSuffix}`;
    })
    .join(' | ');
}

function findDuplicateFacebookPublishError(errorDetails = []) {
  return (
    errorDetails.find(
      (entry) =>
        String(entry?.code || '').trim() === '137' &&
        (!entry?.platform || String(entry.platform).toLowerCase() === 'facebook')
    ) || null
  );
}

async function findReusablePostIdsFromAdCampaigns({ userId, campaignId }) {
  const recentAdCampaign = await AdCampaign.findOne({
    userId,
    campaignId,
    $or: [
      { 'sourcePostIds.facebook': { $exists: true, $ne: '' } },
      { 'sourcePostIds.instagram': { $exists: true, $ne: '' } }
    ]
  })
    .sort({ createdAt: -1 })
    .select('sourcePostIds')
    .lean();

  return {
    facebook: normalizeFacebookPostId(recentAdCampaign?.sourcePostIds?.facebook),
    instagram: String(recentAdCampaign?.sourcePostIds?.instagram || '').trim()
  };
}

async function ensureMetaSourcePostIds({ userId, campaignDoc, requestedPostPlatforms = [] }) {
  const selectedPostPlatforms = parseSelectedMetaPostPlatforms(requestedPostPlatforms, { defaultToFacebook: false });
  if (selectedPostPlatforms.length === 0) {
    return {
      success: false,
      error: 'Please select at least one post to create an ad.',
      errorCode: 'META_POST_SELECTION_EMPTY'
    };
  }

  const wantsFacebook = selectedPostPlatforms.includes('facebook');
  const wantsInstagram = selectedPostPlatforms.includes('instagram');
  const campaignObjectId = toObjectId(campaignDoc?._id || campaignDoc?.id);
  if (!campaignObjectId) {
    return {
      success: false,
      error: STANDALONE_ADS_DISABLED_MESSAGE,
      errorCode: 'CAMPAIGN_NOT_FOUND'
    };
  }

  const latestCampaignDoc = await Campaign.findOne({ _id: campaignObjectId, userId });
  if (!latestCampaignDoc) {
    return {
      success: false,
      error: STANDALONE_ADS_DISABLED_MESSAGE,
      errorCode: 'CAMPAIGN_NOT_FOUND'
    };
  }

  if (!isCampaignPublishedForAds(latestCampaignDoc)) {
    return {
      success: false,
      error: STANDALONE_ADS_DISABLED_MESSAGE,
      errorCode: 'CAMPAIGN_NOT_PUBLISHED'
    };
  }

  const userDoc = await User.findById(userId).select(
    'ayrshare.profileKey ayrshare.activeSocialAccounts ayrshare.displayNames connectedSocials.platform connectedSocials.accountName connectedSocials.accountId connectedSocials.channelData businessProfile.businessLocation businessProfile.country'
  );
  const profileKey = String(userDoc?.ayrshare?.profileKey || '').trim();
  if (!profileKey) {
    return {
      success: false,
      error: 'Meta Ads not connected. Connect social/ad account first.',
      errorCode: 'META_NOT_CONNECTED'
    };
  }

  let liveAyrshareProfile = null;
  try {
    const profileResult = await getAyrshareUserProfile(profileKey);
    if (profileResult?.success) {
      liveAyrshareProfile = profileResult?.data || null;
    }
  } catch (error) {
    // Best-effort only; fall back to stored connected accounts.
  }

  const storedConnectedPlatforms = normalizeConnectedPlatforms(userDoc);
  const liveConnectedPlatforms = Array.isArray(liveAyrshareProfile?.activeSocialAccounts)
    ? liveAyrshareProfile.activeSocialAccounts
        .map((name) => normalizeConnectedPlatformName(name))
        .filter(Boolean)
    : [];
  const connectedPlatforms = Array.from(new Set([...storedConnectedPlatforms, ...liveConnectedPlatforms]));

  const hasFacebook = connectedPlatforms.includes('facebook');
  const hasInstagram = connectedPlatforms.includes('instagram');

  if (wantsFacebook && !hasFacebook) {
    return {
      success: false,
      error: 'Facebook is not connected. Connect Facebook before creating Meta ads.',
      errorCode: 'FACEBOOK_NOT_CONNECTED'
    };
  }
  if (wantsInstagram && !hasInstagram) {
    return {
      success: false,
      error: 'Instagram is not connected. Connect Instagram before creating ads.',
      errorCode: 'INSTAGRAM_NOT_CONNECTED'
    };
  }

  const campaignPostMap = getStoredPostMap(latestCampaignDoc);
  const existingFacebookPostId = normalizeFacebookPostId(
    campaignPostMap?.facebook || latestCampaignDoc?.facebookPostId
  );
  const existingInstagramPostId = String(campaignPostMap?.instagram || latestCampaignDoc?.instagramPostId || '').trim();

  if (wantsFacebook && !existingFacebookPostId) {
    return {
      success: false,
      error: FACEBOOK_POST_MISSING_MESSAGE,
      errorCode: 'FACEBOOK_POST_ID_MISSING'
    };
  }
  if (wantsInstagram && !existingInstagramPostId) {
    return {
      success: false,
      error: INSTAGRAM_POST_MISSING_MESSAGE,
      errorCode: 'INSTAGRAM_POST_ID_MISSING'
    };
  }

  const storedAyrshareStatus = normalizeStatusToken(latestCampaignDoc?.ayrshareStatus);
  const hasStoredSuccessStatus = storedAyrshareStatus === 'success';
  if (!hasStoredSuccessStatus && hasDuplicateContentSignal({ campaignDoc: latestCampaignDoc })) {
    return {
      success: false,
      error: getAdCreateReasonMessage(AD_CREATE_REASON.DUPLICATE_CONTENT),
      errorCode: 'DUPLICATE_CONTENT'
    };
  }
  const statusPostId = String(latestCampaignDoc?.socialPostId || '').trim();
  if (!hasStoredSuccessStatus && statusPostId) {
    const postReadiness = await waitForAyrsharePostReady({
      profileKey,
      postId: statusPostId
    });
    const verifiedStatus = String(postReadiness?.status || '').trim().toLowerCase();
    if (verifiedStatus !== 'success') {
      return {
        success: false,
        error: META_POST_READY_MESSAGE,
        errorCode: 'POST_NOT_READY',
        postStatus: verifiedStatus || storedAyrshareStatus || 'unknown'
      };
    }
  }
  if (!hasStoredSuccessStatus && !statusPostId) {
    return {
      success: false,
      error: META_POST_READY_MESSAGE,
      errorCode: 'POST_NOT_READY',
      postStatus: storedAyrshareStatus || 'unknown'
    };
  }

  const defaultCountry = resolveUserDefaultCountry(userDoc);
  const existingProfileUrls = resolveMetaProfileUrls({
    userDoc,
    liveProfile: liveAyrshareProfile,
    facebookPostId: existingFacebookPostId
  });

  if (!existingProfileUrls.ctaLink) {
    return {
      success: false,
      error: 'Please connect your social account to enable CTA link',
      errorCode: 'CTA_LINK_MISSING'
    };
  }

  return {
    success: true,
    profileKey,
    facebookPostId: existingFacebookPostId,
    instagramPostId: existingInstagramPostId,
    selectedPostPlatforms,
    publishedNow: false,
    note:
      selectedPostPlatforms.length === 2
        ? 'Using existing Facebook and Instagram posts for ad creation.'
        : selectedPostPlatforms[0] === 'instagram'
          ? 'Using existing Instagram post for ad creation.'
          : 'Using existing Facebook post for ad creation.',
    ctaType: 'LEARN_MORE',
    ctaLink: existingProfileUrls.ctaLink,
    ctaSourcePlatform: existingProfileUrls.ctaSourcePlatform,
    defaultCountry,
    facebookPageUrl: existingProfileUrls.facebookPageUrl,
    instagramProfileUrl: existingProfileUrls.instagramProfileUrl
  };
}

async function getProfileKey(userId) {
  if (!userId) return '';
  const user = await User.findById(userId).select('ayrshare.profileKey');
  return String(user?.ayrshare?.profileKey || '').trim();
}

function safeJsonStringify(value) {
  try {
    return JSON.stringify(value);
  } catch (error) {
    return '';
  }
}

function hasInstagramAuthorizationIssue(accountResult = {}) {
  const serializedPayload = safeJsonStringify(accountResult?.data || {});
  const blob = [
    accountResult?.error,
    accountResult?.data?.message,
    accountResult?.data?.error,
    accountResult?.data?.details,
    serializedPayload
  ]
    .map((entry) => String(entry || '').toLowerCase())
    .join(' | ');

  if (!blob) return false;

  const mentionsInstagram = /\binstagram\b/.test(blob);
  const hasCode161 = /\b161\b/.test(blob);
  const hasAuthSignal = /\bnot\s+authorized\b|\bauthori[sz](ation|ed)\b|\bpermission\b|\boauth\b|\btoken\b/.test(blob);

  return (mentionsInstagram && hasCode161) || (mentionsInstagram && hasAuthSignal);
}

function extractAccountList(accountsPayload) {
  if (!accountsPayload) return [];

  const accountCandidates = [
    accountsPayload?.adAccounts,
    accountsPayload?.ad_accounts,
    accountsPayload?.accounts,
    accountsPayload?.data?.adAccounts,
    accountsPayload?.data?.ad_accounts,
    accountsPayload?.data?.accounts,
    accountsPayload?.facebook?.adAccounts,
    accountsPayload?.facebook?.ad_accounts,
    accountsPayload?.facebook?.accounts,
    accountsPayload?.meta?.adAccounts,
    accountsPayload?.meta?.accounts,
    accountsPayload?.result?.adAccounts,
    accountsPayload?.result?.accounts,
    accountsPayload?.results?.adAccounts,
    accountsPayload?.results?.accounts,
    accountsPayload?.data,
    accountsPayload
  ];

  for (const candidate of accountCandidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
}

function selectFirstAdAccount(accounts = []) {
  if (!Array.isArray(accounts) || accounts.length === 0) return null;
  return accounts[0];
}

async function runMetaAdCreation({
  profileKey = '',
  facebookPostId = '',
  instagramPostId = '',
  postTargets = [],
  ctaLink = '',
  ctaType = 'LEARN_MORE',
  targetCountries = [],
  fallbackCountry = '',
  budgetAmount,
  currency,
  startDate,
  endDate
}) {
  if (!profileKey) {
    return buildFailedPlatformResult('Meta Ads not connected. Connect social/ad account first.', 'META_NOT_CONNECTED');
  }

  const normalizedTargets = [];
  const addTarget = (platform, postId) => {
    const normalizedPlatform = normalizeMetaPostPlatform(platform);
    const normalizedPostId = String(postId || '').trim();
    if (!normalizedPlatform || !normalizedPostId) return;

    if (normalizedPlatform === 'facebook') {
      const normalizedFacebookPostId = normalizeFacebookPostId(normalizedPostId);
      if (!normalizedFacebookPostId) {
        throw new Error('INVALID_FACEBOOK_POST_ID');
      }
      normalizedTargets.push({ platform: 'facebook', postId: normalizedFacebookPostId });
      return;
    }

    normalizedTargets.push({ platform: 'instagram', postId: normalizedPostId });
  };

  try {
    if (Array.isArray(postTargets) && postTargets.length > 0) {
      for (const entry of postTargets) {
        if (typeof entry === 'string') {
          addTarget(entry, entry === 'facebook' ? facebookPostId : instagramPostId);
          continue;
        }
        addTarget(entry?.platform, entry?.postId || entry?.id);
      }
    } else {
      addTarget('facebook', facebookPostId);
      addTarget('instagram', instagramPostId);
    }
  } catch (error) {
    if (error?.message === 'INVALID_FACEBOOK_POST_ID') {
      return buildFailedPlatformResult('Invalid Facebook post ID for Meta Ads', 'INVALID_FACEBOOK_POST_ID');
    }
    return buildFailedPlatformResult('Invalid post selection for Meta Ads', 'META_SOURCE_POST_INVALID');
  }

  if (normalizedTargets.length === 0) {
    return buildFailedPlatformResult('Please select at least one post to create an ad.', 'META_SOURCE_POST_INVALID');
  }
  const destinationLink = String(ctaLink || '').trim();
  if (!destinationLink || !isValidHttpUrl(destinationLink)) {
    return buildFailedPlatformResult(
      'Please connect your social account to enable CTA link',
      'CTA_LINK_MISSING'
    );
  }

  const accountResult = await getAdAccounts(profileKey);
  const instagramAuthorizationIssue = hasInstagramAuthorizationIssue(accountResult);
  const accounts = extractAccountList(accountResult?.data);
  const account = selectFirstAdAccount(accounts);

  if (!accountResult?.success && !instagramAuthorizationIssue && !account) {
    return buildFailedPlatformResult(
      accountResult?.error || 'Failed to load Meta ad accounts.',
      'META_ACCOUNT_FETCH_FAILED'
    );
  }

  if (!account) {
    if (instagramAuthorizationIssue) {
      return buildFailedPlatformResult(
        'No Facebook ad account found. Instagram authorization issues were ignored, but a Facebook ad account is still required.',
        'META_ACCOUNT_MISSING'
      );
    }
    return buildFailedPlatformResult('No Meta ad account found for this user.', 'META_ACCOUNT_MISSING');
  }

  const adAccountId = String(
    account.accountId || account.id || account.account_id || account.adAccountId || ''
  ).trim();
  if (!adAccountId) {
    return buildFailedPlatformResult('Meta ad account identifier is missing.', 'META_ACCOUNT_INVALID');
  }

  const accountReadiness = evaluateMetaAdAccountReadiness(account);
  if (!accountReadiness.ready) {
    return buildFailedPlatformResult(
      META_ACCOUNT_SETUP_INCOMPLETE_MESSAGE,
      'META_ACCOUNT_SETUP_INCOMPLETE'
    );
  }

  const accountCurrency = normalizeCurrency(account.currency || account.accountCurrency || '');
  if (accountCurrency && accountCurrency !== currency) {
    return {
      status: 'failed',
      message: `Currency mismatch: selected ${currency}, but Meta account uses ${accountCurrency}.`,
      externalAdId: '',
      errorCode: 'CURRENCY_MISMATCH',
      currency: accountCurrency
    };
  }

  const accountCountry = extractCountryCodeFromAdAccount(account);
  const requestedCountries = normalizeCountryCodeList(targetCountries);
  const fallbackCountryCode =
    normalizeCountryCode(fallbackCountry) || extractCountryCodeFromText(fallbackCountry);

  if (
    accountCountry &&
    requestedCountries.length > 0 &&
    requestedCountries.some((countryCode) => countryCode !== accountCountry)
  ) {
    return buildFailedPlatformResult(
      `Target country mismatch: ad account/page region is ${accountCountry}, but request targeted ${requestedCountries.join(', ')}.`,
      'TARGETING_COUNTRY_MISMATCH'
    );
  }

  const resolvedCountry =
    accountCountry ||
    requestedCountries[0] ||
    fallbackCountryCode;
  if (!resolvedCountry) {
    return buildFailedPlatformResult(
      'Unable to resolve Meta ad targeting country from account/page region.',
      'TARGETING_COUNTRY_UNRESOLVED'
    );
  }

  const resolvedLocations = { countries: [resolvedCountry] };

  const primaryTarget = normalizedTargets.find((entry) => entry.platform === 'facebook') || normalizedTargets[0];
  const boostPayload = {
    postId: primaryTarget.postId,
    postIds: normalizedTargets.map((entry) => ({
      platform: entry.platform,
      id: entry.postId,
      postId: entry.postId
    })),
    placements: normalizedTargets.map((entry) => entry.platform),
    adAccountId,
    goal: 'engagement',
    dailyBudget: budgetAmount,
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    locations: resolvedLocations,
    callToActionType: String(ctaType || 'LEARN_MORE').toUpperCase(),
    callToActionLink: destinationLink
  };

  const metaResult = await boostPost(profileKey, boostPayload);

  if (!metaResult?.success) {
    if (isDuplicateCode137FromResult(metaResult)) {
      const duplicateRetryResult = await boostPost(profileKey, boostPayload);

      if (duplicateRetryResult?.success) {
        const retryExternalAdId = String(
          duplicateRetryResult?.data?.adId ||
            duplicateRetryResult?.data?.id ||
            duplicateRetryResult?.data?.data?.adId ||
            ''
        ).trim();

        if (!retryExternalAdId) {
          return buildFailedPlatformResult(
            META_CREATE_NOT_ELIGIBLE_MESSAGE,
            'META_CREATE_ID_MISSING'
          );
        }

        return {
          status: 'success',
          message: 'Meta ad created successfully.',
          externalAdId: retryExternalAdId,
          errorCode: '',
          currency: accountCurrency || currency
        };
      }
    }

    return buildFailedPlatformResult(
      metaResult?.error || 'Meta Ads API call failed.',
      'META_CREATE_FAILED'
    );
  }

  const externalAdId = String(
    metaResult?.data?.adId ||
      metaResult?.data?.id ||
      metaResult?.data?.data?.adId ||
      ''
  ).trim();

  if (!externalAdId) {
    return buildFailedPlatformResult(
      META_CREATE_NOT_ELIGIBLE_MESSAGE,
      'META_CREATE_ID_MISSING'
    );
  }

  return {
    status: 'success',
    message: 'Meta ad created successfully.',
    externalAdId,
    errorCode: '',
    currency: accountCurrency || currency
  };
}

async function runGoogleAdCreation({ campaignDoc, budgetAmount, currency, startDate, endDate }) {
  const googlePayload = {
    title: String(campaignDoc?.name || 'Campaign Ad').trim(),
    description: getCampaignCaption(campaignDoc),
    imageUrl: getCampaignPrimaryImage(campaignDoc),
    budget: Number(budgetAmount || 0),
    currency,
    startDate: startDate?.toISOString?.() || null,
    endDate: endDate?.toISOString?.() || null
  };

  const googleAdsApiUrl = String(process.env.GOOGLE_ADS_API_URL || '').trim();
  const googleAdsApiKey = String(process.env.GOOGLE_ADS_API_KEY || '').trim();

  if (googleAdsApiUrl) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      const response = await fetch(googleAdsApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(googleAdsApiKey ? { Authorization: `Bearer ${googleAdsApiKey}` } : {})
        },
        body: JSON.stringify(googlePayload),
        signal: controller.signal
      });
      clearTimeout(timeout);

      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        return buildFailedPlatformResult(
          result?.message || result?.error || `Google Ads API request failed (${response.status}).`,
          'GOOGLE_CREATE_FAILED'
        );
      }

      const externalAdId = String(
        result?.adId ||
          result?.id ||
          result?.data?.adId ||
          ''
      ).trim();

      return {
        status: 'success',
        message: 'Google ad created successfully.',
        externalAdId,
        errorCode: '',
        currency
      };
    } catch (error) {
      return buildFailedPlatformResult(
        error?.message || 'Google Ads API call failed.',
        'GOOGLE_CREATE_FAILED'
      );
    }
  }

  // Fallback simulation mode.
  if (String(process.env.GOOGLE_ADS_SIMULATE_SUCCESS || '').toLowerCase() === 'true') {
    return {
      status: 'success',
      message: 'Google ad created successfully (simulated).',
      externalAdId: `google-sim-${Date.now()}`,
      errorCode: '',
      currency
    };
  }

  return buildFailedPlatformResult(
    'Google Ads API is not configured for this environment. Set GOOGLE_ADS_API_URL to enable real creation.',
    'GOOGLE_NOT_CONFIGURED'
  );
}

function getSelectedPlatforms(platformSelection) {
  return platformSelection === 'both' ? ['meta', 'google'] : [platformSelection];
}

function deriveOverallStatus({ platformSelection, platformStatus, startDate }) {
  const selectedPlatforms = getSelectedPlatforms(platformSelection);

  const successCount = selectedPlatforms.filter(
    (name) => platformStatus?.[name]?.status === 'success'
  ).length;
  const failedCount = selectedPlatforms.filter(
    (name) => platformStatus?.[name]?.status === 'failed'
  ).length;

  if (successCount === 0 && failedCount > 0) return 'failed';
  if (successCount > 0 && failedCount > 0) return 'partial';

  if (successCount === 0) return 'scheduled';

  const now = new Date();
  if (startDate > now) return 'scheduled';
  return 'active';
}

function getStatusMessage(status) {
  if (status === 'failed') {
    return 'Ad campaign could not be launched.';
  }
  if (status === 'partial') {
    return 'Ad campaign launched with limited platform availability.';
  }
  return 'Ad campaign created successfully.';
}

/**
 * @route   GET /api/ad-campaigns
 * @desc    List ad campaigns linked to marketing campaigns
 * @access  Private
 */
router.get('/', protect, async (req, res) => {
  try {
    const userId = getUserId(req);
    const items = await AdCampaign.find({ userId })
      .sort({ createdAt: -1 })
      .populate('campaignId', 'name status');

    res.json({
      success: true,
      adCampaigns: items
    });
  } catch (error) {
    console.error('Failed to list ad campaigns:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch ad campaigns' });
  }
});

/**
 * @route   GET /api/ad-campaigns/summary
 * @desc    Summary metrics for dashboard cards
 * @access  Private
 */
router.get('/summary', protect, async (req, res) => {
  try {
    const userId = getUserId(req);
    const items = await AdCampaign.find({ userId }).select('status performance');

    const totalAdCampaigns = items.length;
    const activeAdCampaigns = items.filter((item) => item.status === 'active').length;
    const totalClicks = items.reduce((sum, item) => sum + Number(item?.performance?.clicks || 0), 0);
    const totalImpressions = items.reduce(
      (sum, item) => sum + Number(item?.performance?.impressions || 0),
      0
    );
    const totalSpend = items.reduce((sum, item) => sum + Number(item?.performance?.spend || 0), 0);
    const ctr = totalImpressions > 0 ? Number(((totalClicks / totalImpressions) * 100).toFixed(2)) : 0;

    res.json({
      success: true,
      summary: {
        totalAdCampaigns,
        activeAdCampaigns,
        metrics: {
          clicks: totalClicks,
          impressions: totalImpressions,
          ctr,
          spend: totalSpend
        }
      }
    });
  } catch (error) {
    console.error('Failed to get ad campaign summary:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch ad campaign summary' });
  }
});

/**
 * @route   GET /api/ad-campaigns/cta-preview
 * @desc    Resolve CTA destination link for Meta Ads (Learn More)
 * @access  Private
 */
router.get('/cta-preview', protect, async (req, res) => {
  try {
    const userId = getUserId(req);
    const userDoc = await User.findById(userId).select(
      'ayrshare.profileKey ayrshare.displayNames connectedSocials.platform connectedSocials.accountName connectedSocials.accountId connectedSocials.channelData'
    );
    if (!userDoc) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const profileKey = String(userDoc?.ayrshare?.profileKey || '').trim();
    let liveAyrshareProfile = null;
    if (profileKey) {
      try {
        const profileResult = await getAyrshareUserProfile(profileKey);
        if (profileResult?.success) {
          liveAyrshareProfile = profileResult?.data || null;
        }
      } catch (error) {
        // Fall back to cached/stored profile data.
      }
    }

    const resolved = resolveMetaProfileUrls({
      userDoc,
      liveProfile: liveAyrshareProfile
    });

    if (!resolved.ctaLink) {
      return res.status(400).json({
        success: false,
        message: 'Please connect your social account to enable CTA link',
        cta: {
          type: 'LEARN_MORE',
          link: '',
          sourcePlatform: ''
        },
        urls: {
          facebook: '',
          instagram: ''
        }
      });
    }

    const previewTarget = resolved.facebookPageUrl
      ? 'Facebook page'
      : 'Instagram profile';

    res.json({
      success: true,
      cta: {
        type: 'LEARN_MORE',
        link: resolved.ctaLink,
        sourcePlatform: resolved.ctaSourcePlatform
      },
      urls: {
        facebook: resolved.facebookPageUrl,
        instagram: resolved.instagramProfileUrl
      },
      previewText: `Learn More -> opens your ${previewTarget}`
    });
  } catch (error) {
    console.error('Failed to resolve CTA preview:', error);
    res.status(500).json({ success: false, message: 'Failed to resolve CTA preview' });
  }
});

/**
 * @route   GET /api/ad-campaigns/meta-readiness
 * @desc    Validate Meta account and campaign eligibility before ad creation
 * @access  Private
 */
router.get('/meta-readiness', protect, async (req, res) => {
  try {
    const userId = getUserId(req);
    const rawCampaignId = String(req.query?.campaignId || '').trim();
    const campaignId = toObjectId(rawCampaignId);

    let campaignPublished = false;
    let facebookPostIdAvailable = false;
    let postReady = false;
    let postStatus = '';
    let eligibilityMessage = rawCampaignId && !campaignId ? STANDALONE_ADS_DISABLED_MESSAGE : '';

    if (campaignId) {
      const campaignDoc = await Campaign.findOne({ _id: campaignId, userId }).select(
        'status facebookPostId ayrshareStatus'
      );
      if (!campaignDoc) {
        eligibilityMessage = STANDALONE_ADS_DISABLED_MESSAGE;
      } else if (!isCampaignPublishedForAds(campaignDoc)) {
        eligibilityMessage = STANDALONE_ADS_DISABLED_MESSAGE;
      } else {
        campaignPublished = true;
        facebookPostIdAvailable = Boolean(normalizeFacebookPostId(campaignDoc?.facebookPostId));
        postStatus = normalizeStatusToken(campaignDoc?.ayrshareStatus);
        postReady = postStatus === 'success';
        if (!facebookPostIdAvailable) {
          eligibilityMessage = FACEBOOK_POST_MISSING_MESSAGE;
        } else if (!postReady) {
          eligibilityMessage = META_POST_READY_MESSAGE;
        }
      }
    }

    const profileKey = await getProfileKey(userId);
    if (!profileKey) {
      const message = eligibilityMessage || META_ACCOUNT_SETUP_INCOMPLETE_MESSAGE;
      return res.json({
        success: true,
        ready: false,
        readiness: {
          ready: false,
          canCreateAd: false,
          accountReady: false,
          paymentMethodAdded: false,
          adAccountActive: false,
          phoneVerificationRequired: false,
          phoneVerified: false,
          campaignPublished,
          facebookPostIdAvailable,
          postReady,
          postStatus,
          message
        }
      });
    }

    const accountResult = await getAdAccounts(profileKey);
    const accounts = extractAccountList(accountResult?.data);
    const account = selectFirstAdAccount(accounts);
    const instagramAuthorizationIssue = hasInstagramAuthorizationIssue(accountResult);
    const facebookConnected = rawCampaignId
      ? campaignPublished && facebookPostIdAvailable
      : Boolean(profileKey);
    const canIgnoreInstagramAuthorizationIssue =
      !accountResult?.success &&
      instagramAuthorizationIssue &&
      facebookConnected;

    const readiness = account ? evaluateMetaAdAccountReadiness(account) : {
      ready: false,
      paymentMethodAdded: false,
      adAccountActive: false,
      phoneVerificationRequired: false,
      phoneVerified: false
    };

    const accountReady = readiness.ready || canIgnoreInstagramAuthorizationIssue;
    const campaignEligible = rawCampaignId ? campaignPublished && facebookPostIdAvailable && postReady : true;
    const canCreateAd =
      accountReady &&
      campaignEligible;
    const message = eligibilityMessage || (canCreateAd ? '' : META_ACCOUNT_SETUP_INCOMPLETE_MESSAGE);

    res.json({
      success: true,
      ready: canCreateAd,
      readiness: {
        ready: canCreateAd,
        canCreateAd,
        accountReady: Boolean(accountReady),
        paymentMethodAdded: canIgnoreInstagramAuthorizationIssue ? true : readiness?.paymentMethodAdded === true,
        adAccountActive: canIgnoreInstagramAuthorizationIssue ? true : readiness?.adAccountActive === true,
        phoneVerificationRequired: canIgnoreInstagramAuthorizationIssue ? false : readiness?.phoneVerificationRequired === true,
        phoneVerified: canIgnoreInstagramAuthorizationIssue ? true : readiness?.phoneVerified === true,
        campaignPublished,
        facebookPostIdAvailable,
        postReady,
        postStatus,
        message
      }
    });
  } catch (error) {
    console.error('Failed to fetch Meta readiness:', error);
    res.status(500).json({ success: false, message: 'Failed to validate ad account readiness' });
  }
});

/**
 * @route   POST /api/ad-campaigns
 * @desc    Create ad campaign from existing campaign context (no standalone creation)
 * @access  Private
 */
router.post('/', protect, async (req, res) => {
  try {
    const userId = getUserId(req);
    const campaignId = toObjectId(req.body?.campaignId);
    const platformSelection = normalizePlatformSelection(req.body?.platformSelection);
    const selectedMetaPostPlatforms = parseSelectedMetaPostPlatforms(req.body?.selectedPosts, {
      defaultToFacebook: true
    });
    const requestedMetaCountries = getRequestedTargetCountries(req.body);
    const budgetAmount = Number(req.body?.budget);
    const currency = normalizeCurrency(req.body?.currency);
    const startDate = new Date(req.body?.startDate);
    const endDate = new Date(req.body?.endDate);

    if (!campaignId) {
      return res.status(400).json({
        success: false,
        reason: AD_CREATE_REASON.INVALID_POST_ID,
        message: getAdCreateReasonMessage(AD_CREATE_REASON.INVALID_POST_ID, STANDALONE_ADS_DISABLED_MESSAGE)
      });
    }
    if (!platformSelection) {
      return res
        .status(400)
        .json({
          success: false,
          reason: AD_CREATE_REASON.VALIDATION_ERROR,
          message: 'Platform must be Meta Ads, Google Ads, or Both.'
        });
    }
    if ((platformSelection === 'meta' || platformSelection === 'both') && selectedMetaPostPlatforms.length === 0) {
      return res.status(400).json({
        success: false,
        reason: AD_CREATE_REASON.VALIDATION_ERROR,
        message: 'Please select at least one post to create an ad.'
      });
    }
    if (!Number.isFinite(budgetAmount) || budgetAmount <= 0) {
      return res.status(400).json({
        success: false,
        reason: AD_CREATE_REASON.VALIDATION_ERROR,
        message: 'Budget must be greater than 0.'
      });
    }
    if (!currency) {
      return res.status(400).json({
        success: false,
        reason: AD_CREATE_REASON.VALIDATION_ERROR,
        message: 'Currency must be a 3-letter code.'
      });
    }
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return res.status(400).json({
        success: false,
        reason: AD_CREATE_REASON.VALIDATION_ERROR,
        message: 'Start date and end date are required.'
      });
    }
    if (endDate <= startDate) {
      return res.status(400).json({
        success: false,
        reason: AD_CREATE_REASON.VALIDATION_ERROR,
        message: 'End date must be after start date.'
      });
    }

    const campaignDoc = await Campaign.findOne({ _id: campaignId, userId });
    if (!campaignDoc) {
      return res.status(400).json({
        success: false,
        reason: AD_CREATE_REASON.INVALID_POST_ID,
        message: getAdCreateReasonMessage(AD_CREATE_REASON.INVALID_POST_ID, STANDALONE_ADS_DISABLED_MESSAGE)
      });
    }

    const adCreativeUrl = getCampaignPrimaryImage(campaignDoc);
    const captionText = getCampaignCaptionText(campaignDoc);
    const adDescription = getCampaignCaption(campaignDoc);
    if (!adCreativeUrl || !captionText) {
      return res.status(400).json({
        success: false,
        reason: AD_CREATE_REASON.VALIDATION_ERROR,
        message: 'Campaign must have an image and caption before creating ads.'
      });
    }

    const duplicateQuery = {
      userId,
      campaignId,
      platformSelection,
      'schedule.startDate': startDate,
      'schedule.endDate': endDate,
      'budget.amount': budgetAmount,
      'budget.currency': currency
    };
    if (platformSelection === 'meta' || platformSelection === 'both') {
      duplicateQuery['sourcePostIds.facebook'] = selectedMetaPostPlatforms.includes('facebook')
        ? { $exists: true, $ne: '' }
        : '';
      duplicateQuery['sourcePostIds.instagram'] = selectedMetaPostPlatforms.includes('instagram')
        ? { $exists: true, $ne: '' }
        : '';
    }

    const duplicateCampaign = await AdCampaign.findOne(duplicateQuery).sort({ createdAt: -1 });

    if (duplicateCampaign) {
      return res.status(409).json({
        success: false,
        reason: AD_CREATE_REASON.DUPLICATE_CONTENT,
        message: getAdCreateReasonMessage(
          AD_CREATE_REASON.DUPLICATE_CONTENT,
          'An ad campaign with the same campaign, platforms, budget, and schedule already exists.'
        ),
        adCampaign: duplicateCampaign
      });
    }

    const adTitle = String(campaignDoc?.name || '').trim() || 'Campaign Ad';

    let metaStatus = buildSkippedPlatformResult('Meta platform not selected.');
    let googleStatus = buildSkippedPlatformResult('Google platform not selected.');
    let metaPreparationNote = '';
    let ctaPayload = {
      type: '',
      link: '',
      sourcePlatform: ''
    };
    let sourceProfileUrls = {
      facebook: '',
      instagram: ''
    };
    let sourcePostIds = {
      facebook: '',
      instagram: ''
    };

    if (platformSelection === 'meta' || platformSelection === 'both') {
      const sourceInfo = await ensureMetaSourcePostIds({
        userId,
        campaignDoc,
        requestedPostPlatforms: selectedMetaPostPlatforms
      });
      if (!sourceInfo?.success) {
        const reason = mapAdCreateReasonFromSourceInfo(sourceInfo, campaignDoc) || AD_CREATE_REASON.VALIDATION_ERROR;
        const statusCode =
          reason === AD_CREATE_REASON.POST_NOT_READY || reason === AD_CREATE_REASON.DUPLICATE_CONTENT
            ? 409
            : 400;
        return res.status(statusCode).json({
          success: false,
          reason,
          message: getAdCreateReasonMessage(reason, sourceInfo?.error || 'Selected post is not ready for Meta Ads.'),
          errorCode: sourceInfo?.errorCode || 'META_SOURCE_POST_INVALID',
          ayrshareError: sourceInfo?.ayrshareError || null,
          errorDetails: Array.isArray(sourceInfo?.errorDetails) ? sourceInfo.errorDetails : []
        });
      }

      sourcePostIds = {
        facebook: selectedMetaPostPlatforms.includes('facebook') ? String(sourceInfo?.facebookPostId || '').trim() : '',
        instagram: selectedMetaPostPlatforms.includes('instagram') ? String(sourceInfo?.instagramPostId || '').trim() : ''
      };
      metaPreparationNote = String(sourceInfo?.note || '').trim();
      ctaPayload = {
        type: String(sourceInfo?.ctaType || 'LEARN_MORE').trim() || 'LEARN_MORE',
        link: String(sourceInfo?.ctaLink || '').trim(),
        sourcePlatform: String(sourceInfo?.ctaSourcePlatform || '').trim()
      };
      sourceProfileUrls = {
        facebook: String(sourceInfo?.facebookPageUrl || '').trim(),
        instagram: String(sourceInfo?.instagramProfileUrl || '').trim()
      };

      const selectedMetaPostTargets = selectedMetaPostPlatforms
        .map((platform) => ({
          platform,
          postId: platform === 'facebook'
            ? String(sourceInfo?.facebookPostId || '').trim()
            : String(sourceInfo?.instagramPostId || '').trim()
        }))
        .filter((entry) => entry.postId);

      metaStatus = await runMetaAdCreation({
        profileKey: sourceInfo.profileKey,
        facebookPostId: sourceInfo.facebookPostId,
        instagramPostId: sourceInfo.instagramPostId,
        postTargets: selectedMetaPostTargets,
        ctaLink: sourceInfo.ctaLink,
        ctaType: sourceInfo.ctaType,
        targetCountries: requestedMetaCountries,
        fallbackCountry: sourceInfo.defaultCountry,
        budgetAmount,
        currency,
        startDate,
        endDate
      });

      const metaSuccess =
        metaStatus?.status === 'success' &&
        Boolean(String(metaStatus?.externalAdId || '').trim());
      if (!metaSuccess) {
        const reason = mapAdCreateReasonFromMetaStatus(metaStatus, campaignDoc);
        const failureMessage =
          String(metaStatus?.errorCode || '').trim() === 'META_ACCOUNT_SETUP_INCOMPLETE'
            ? META_ACCOUNT_SETUP_INCOMPLETE_MESSAGE
            : META_CREATE_NOT_ELIGIBLE_MESSAGE;
        return res.status(400).json({
          success: false,
          reason: reason || AD_CREATE_REASON.AD_ACCOUNT_SETUP_INCOMPLETE,
          message: getAdCreateReasonMessage(reason, failureMessage),
          errorCode: String(metaStatus?.errorCode || 'META_CREATE_FAILED'),
          platformStatus: {
            meta: metaStatus
          }
        });
      }
    }

    if (platformSelection === 'google' || platformSelection === 'both') {
      googleStatus = await runGoogleAdCreation({
        campaignDoc,
        budgetAmount,
        currency,
        startDate,
        endDate
      });
    }

    const platformStatus = {
      meta: metaStatus,
      google: googleStatus
    };

    const status = deriveOverallStatus({
      platformSelection,
      platformStatus,
      startDate
    });

    const adCampaign = await AdCampaign.create({
      userId,
      campaignId,
      adTitle,
      adDescription,
      adCreativeUrl,
      platformSelection,
      budget: {
        amount: budgetAmount,
        currency
      },
      schedule: {
        startDate,
        endDate
      },
      status,
      platformStatus,
      sourcePostIds,
      cta: ctaPayload,
      sourceProfileUrls
    });

    const message = [getStatusMessage(status), metaPreparationNote].filter(Boolean).join(' ');

    res.status(201).json({
      success: true,
      message,
      adCampaign
    });
  } catch (error) {
    console.error('Failed to create ad campaign:', error);
    const clearFailureMessage = String(error?.message || '').trim();
    res.status(500).json({
      success: false,
      reason: AD_CREATE_REASON.INTERNAL_ERROR,
      message: clearFailureMessage || 'Ad creation failed due to an unexpected server error.'
    });
  }
});

/**
 * @route   POST /api/ad-campaigns/:id/retry
 * @desc    Retry failed platforms for an existing ad campaign
 * @access  Private
 */
router.post('/:id/retry', protect, async (req, res) => {
  try {
    const userId = getUserId(req);
    const requestedMetaCountries = getRequestedTargetCountries(req.body);
    const adCampaign = await AdCampaign.findOne({ _id: req.params.id, userId });
    if (!adCampaign) {
      return res.status(404).json({ success: false, message: 'Ad campaign not found.' });
    }

    const campaignDoc = await Campaign.findOne({ _id: adCampaign.campaignId, userId });
    if (!campaignDoc) {
      return res.status(404).json({ success: false, message: 'Source campaign not found.' });
    }

    const platformSelection = normalizePlatformSelection(adCampaign.platformSelection);
    if (!platformSelection) {
      return res.status(400).json({ success: false, message: 'Ad campaign platform configuration is invalid.' });
    }

    const selectedPlatforms = getSelectedPlatforms(platformSelection);

    const budgetAmount = Number(adCampaign?.budget?.amount || 0);
    const currency = normalizeCurrency(adCampaign?.budget?.currency);
    const startDate = new Date(adCampaign?.schedule?.startDate);
    const endDate = new Date(adCampaign?.schedule?.endDate);

    if (!Number.isFinite(budgetAmount) || budgetAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Ad campaign budget is invalid.' });
    }
    if (!currency) {
      return res.status(400).json({ success: false, message: 'Ad campaign currency is invalid.' });
    }
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Ad campaign schedule is invalid.' });
    }

    const currentPlatformStatus = {
      meta: adCampaign?.platformStatus?.meta || buildSkippedPlatformResult('Meta platform not selected.'),
      google: adCampaign?.platformStatus?.google || buildSkippedPlatformResult('Google platform not selected.')
    };

    const retryTargets = selectedPlatforms.filter(
      (name) => currentPlatformStatus?.[name]?.status === 'failed'
    );

    if (retryTargets.length === 0) {
      await adCampaign.populate('campaignId', 'name status');
      return res.json({
        success: true,
        message: 'No failed platforms to retry.',
        adCampaign
      });
    }

    const nextPlatformStatus = {
      meta: currentPlatformStatus.meta,
      google: currentPlatformStatus.google
    };
    let metaPreparationNote = '';
    let metaRetryError = null;

    if (retryTargets.includes('meta')) {
      const existingSourcePostIds = adCampaign.sourcePostIds && typeof adCampaign.sourcePostIds === 'object'
        ? adCampaign.sourcePostIds
        : {};
      let selectedMetaPostPlatforms = parseSelectedMetaPostPlatforms(
        {
          facebook: Boolean(String(existingSourcePostIds?.facebook || '').trim()),
          instagram: Boolean(String(existingSourcePostIds?.instagram || '').trim())
        },
        { defaultToFacebook: false }
      );
      if (selectedMetaPostPlatforms.length === 0) {
        selectedMetaPostPlatforms = ['facebook'];
      }

      const sourceInfo = await ensureMetaSourcePostIds({
        userId,
        campaignDoc,
        requestedPostPlatforms: selectedMetaPostPlatforms
      });

      if (!sourceInfo?.success) {
        metaRetryError = {
          errorCode: sourceInfo?.errorCode || 'META_SOURCE_POST_INVALID',
          message: sourceInfo?.error || '',
          ayrshareError: sourceInfo?.ayrshareError || null,
          errorDetails: Array.isArray(sourceInfo?.errorDetails) ? sourceInfo.errorDetails : []
        };
        console.error('Meta retry pre-publish failed:', {
          adCampaignId: String(adCampaign?._id || ''),
          campaignId: String(campaignDoc?._id || ''),
          userId: String(userId || ''),
          ...metaRetryError
        });
        nextPlatformStatus.meta = buildFailedPlatformResult(
          sourceInfo?.error || 'Selected post is not ready for Meta retry.',
          sourceInfo?.errorCode || 'META_SOURCE_POST_INVALID'
        );
      } else {
        metaPreparationNote = String(sourceInfo?.note || '').trim();
        const selectedMetaPostTargets = selectedMetaPostPlatforms
          .map((platform) => ({
            platform,
            postId: platform === 'facebook'
              ? String(sourceInfo?.facebookPostId || '').trim()
              : String(sourceInfo?.instagramPostId || '').trim()
          }))
          .filter((entry) => entry.postId);

        nextPlatformStatus.meta = await runMetaAdCreation({
          profileKey: sourceInfo.profileKey,
          facebookPostId: sourceInfo.facebookPostId,
          instagramPostId: sourceInfo.instagramPostId,
          postTargets: selectedMetaPostTargets,
          ctaLink: sourceInfo.ctaLink,
          ctaType: sourceInfo.ctaType,
          targetCountries: requestedMetaCountries,
          fallbackCountry: sourceInfo.defaultCountry,
          budgetAmount,
          currency,
          startDate,
          endDate
        });

        adCampaign.sourcePostIds = {
          facebook: selectedMetaPostPlatforms.includes('facebook')
            ? String(sourceInfo?.facebookPostId || existingSourcePostIds?.facebook || '').trim()
            : '',
          instagram: selectedMetaPostPlatforms.includes('instagram')
            ? String(sourceInfo?.instagramPostId || existingSourcePostIds?.instagram || '').trim()
            : ''
        };
        adCampaign.cta = {
          type: String(sourceInfo?.ctaType || 'LEARN_MORE').trim() || 'LEARN_MORE',
          link: String(sourceInfo?.ctaLink || '').trim(),
          sourcePlatform: String(sourceInfo?.ctaSourcePlatform || '').trim()
        };
        const existingSourceProfileUrls =
          adCampaign.sourceProfileUrls && typeof adCampaign.sourceProfileUrls === 'object'
            ? adCampaign.sourceProfileUrls
            : {};
        adCampaign.sourceProfileUrls = {
          ...existingSourceProfileUrls,
          ...(String(existingSourceProfileUrls?.facebook || '').trim()
            ? {}
            : { facebook: String(sourceInfo?.facebookPageUrl || '').trim() }),
          ...(String(existingSourceProfileUrls?.instagram || '').trim()
            ? {}
            : { instagram: String(sourceInfo?.instagramProfileUrl || '').trim() })
        };
      }
    }

    if (retryTargets.includes('google')) {
      nextPlatformStatus.google = await runGoogleAdCreation({
        campaignDoc,
        budgetAmount,
        currency,
        startDate,
        endDate
      });
    }

    const nextStatus = deriveOverallStatus({
      platformSelection,
      platformStatus: nextPlatformStatus,
      startDate
    });

    adCampaign.platformStatus = nextPlatformStatus;
    adCampaign.status = nextStatus;
    await adCampaign.save();
    await adCampaign.populate('campaignId', 'name status');

    res.json({
      success: true,
      message: [
        metaRetryError?.errorCode === 'POST_NOT_READY'
          ? META_POST_READY_MESSAGE
          : '',
        nextStatus === 'failed' ? 'Retry completed, but selected platforms are still failing.' : 'Campaign retry completed.',
        metaPreparationNote
      ].filter(Boolean).join(' '),
      adCampaign,
      metaRetryError
    });
  } catch (error) {
    console.error('Failed to retry ad campaign:', error);
    res.status(500).json({ success: false, message: 'Failed to retry ad campaign' });
  }
});

/**
 * @route   DELETE /api/ad-campaigns/:id
 * @desc    Delete ad campaign
 * @access  Private
 */
router.delete('/:id', protect, async (req, res) => {
  try {
    const userId = getUserId(req);
    const deleted = await AdCampaign.findOneAndDelete({ _id: req.params.id, userId });
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Ad campaign not found.' });
    }

    res.json({
      success: true,
      message: 'Ad campaign deleted successfully.',
      id: deleted._id
    });
  } catch (error) {
    console.error('Failed to delete ad campaign:', error);
    res.status(500).json({ success: false, message: 'Failed to delete ad campaign' });
  }
});

/**
 * @route   PUT /api/ad-campaigns/:id/status
 * @desc    Pause/resume ad campaign and sync Meta status when possible
 * @access  Private
 */
router.put('/:id/status', protect, async (req, res) => {
  try {
    const userId = getUserId(req);
    const targetStatus = String(req.body?.status || '').trim().toLowerCase();
    if (!['active', 'paused'].includes(targetStatus)) {
      return res.status(400).json({ success: false, message: 'Status must be active or paused.' });
    }

    const adCampaign = await AdCampaign.findOne({ _id: req.params.id, userId });
    if (!adCampaign) {
      return res.status(404).json({ success: false, message: 'Ad campaign not found.' });
    }

    const profileKey = await getProfileKey(userId);
    const metaExternalId = String(adCampaign?.platformStatus?.meta?.externalAdId || '').trim();
    if (profileKey && metaExternalId) {
      try {
        const metaStatus = targetStatus === 'paused' ? 'PAUSED' : 'ACTIVE';
        const syncResult = await updateAd(profileKey, metaExternalId, { status: metaStatus });
        if (!syncResult?.success) {
          adCampaign.platformStatus.meta.message =
            syncResult?.error || `Failed to sync Meta status to ${targetStatus}.`;
        }
      } catch (syncError) {
        adCampaign.platformStatus.meta.message = `Failed to sync Meta status: ${syncError.message}`;
      }
    }

    adCampaign.status = targetStatus;
    await adCampaign.save();

    res.json({
      success: true,
      adCampaign,
      message: `Ad campaign ${targetStatus === 'paused' ? 'paused' : 'resumed'} successfully.`
    });
  } catch (error) {
    console.error('Failed to update ad campaign status:', error);
    res.status(500).json({ success: false, message: 'Failed to update ad campaign status' });
  }
});

module.exports = router;
