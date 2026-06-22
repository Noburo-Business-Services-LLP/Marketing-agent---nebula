const crypto = require('crypto');
const Campaign = require('../models/Campaign');
const SocialPostAttempt = require('../models/SocialPostAttempt');
const {
  postToSocialMedia,
  getAyrshareUserProfile
} = require('./socialMediaAPI');
const { prepareInstagramVideoForPublishing } = require('./mediaComposer');
const { validateMediaUrl } = require('../utils/socialPostValidation');

const INSTAGRAM_MIN_DELAY_MINUTES = 5;
const INSTAGRAM_MAX_RETRIES = 3;
const INSTAGRAM_MAX_HASHTAGS = 25;
const INSTAGRAM_MAX_CAPTION_LENGTH = 2200;
const DUPLICATE_WINDOW_HOURS = 48;

const accountQueues = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizePlatforms(platforms) {
  const input = Array.isArray(platforms) ? platforms : [platforms];
  return Array.from(new Set(
    input
      .map((platform) => String(platform || '').trim().toLowerCase())
      .filter(Boolean)
  ));
}

function extractHashtags(text) {
  return String(text || '').match(/#[A-Za-z0-9_]+/g) || [];
}

function stripHashtags(text) {
  return String(text || '')
    .replace(/#[A-Za-z0-9_]+/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function normalizeInstagramContent(content) {
  const rawText = String(content || '').trim();
  const hashtags = Array.from(new Set(extractHashtags(rawText))).slice(0, INSTAGRAM_MAX_HASHTAGS);
  const body = stripHashtags(rawText);

  if (!body) {
    return {
      valid: false,
      code: 'VALIDATION_EMPTY_CAPTION',
      category: 'validation',
      message: 'Instagram caption cannot be empty.',
      userMessage: 'Instagram needs a caption before posting.'
    };
  }

  const hashtagsText = hashtags.length > 0 ? `\n\n${hashtags.join(' ')}` : '';
  const availableBodyLength = Math.max(1, INSTAGRAM_MAX_CAPTION_LENGTH - hashtagsText.length);
  const normalizedBody = body.length > availableBodyLength
    ? `${body.slice(0, Math.max(1, availableBodyLength - 1)).trimEnd()}…`
    : body;
  const normalizedContent = `${normalizedBody}${hashtagsText}`.trim();

  return {
    valid: true,
    normalizedContent,
    hashtags,
    hashtagCount: hashtags.length,
    captionLength: normalizedContent.length,
    adjusted: normalizedContent !== rawText || hashtags.length !== extractHashtags(rawText).length
  };
}

function buildContentHash(content, mediaUrls = []) {
  const mediaKey = Array.isArray(mediaUrls)
    ? mediaUrls.map((url) => String(url || '').trim()).filter(Boolean).join('|')
    : String(mediaUrls || '').trim();

  return crypto
    .createHash('sha256')
    .update(`${String(content || '').trim().toLowerCase()}||${mediaKey}`)
    .digest('hex');
}

async function inspectInstagramMedia(options = {}) {
  const mediaUrls = Array.isArray(options.mediaUrls)
    ? options.mediaUrls.map((url) => String(url || '').trim()).filter(Boolean)
    : [];
  const mediaUrl = mediaUrls[0] || null;
  const declaredVideo = options.isVideo === true || String(options.mediaType || '').toLowerCase() === 'video';

  if (!mediaUrl) {
    return {
      mediaUrl: null,
      mediaValidation: null,
      hasVideo: false,
      hasAudio: false
    };
  }

  const mediaValidation = await validateMediaUrl(mediaUrl, declaredVideo ? { expectedMediaKind: 'video' } : {});
  const hasVideo = declaredVideo || mediaValidation?.mediaKind === 'video';

  return {
    mediaUrl,
    mediaValidation,
    hasVideo,
    hasAudio: declaredVideo
  };
}

function createInstagramVideoPayloadError(message, details = {}) {
  const error = new Error(message);
  error.code = 'INSTAGRAM_VIDEO_REQUIRES_REEL';
  error.category = 'validation';
  error.details = details;
  return error;
}

async function enforceInstagramVideoPublishingRules({ platforms, options = {}, logger = console } = {}) {
  const normalizedPlatforms = normalizePlatforms(platforms);
  const includesInstagram = normalizedPlatforms.includes('instagram');
  const enforcedOptions = { ...options };

  if (!includesInstagram) {
    return {
      options: enforcedOptions,
      mediaInfo: null,
      postKind: 'non_instagram'
    };
  }

  const mediaInfo = await inspectInstagramMedia(enforcedOptions);
  const declaredType = String(enforcedOptions.type || '').trim().toLowerCase();
  const hasVideo = Boolean(mediaInfo?.hasVideo);

  if (hasVideo) {
    if (declaredType && declaredType !== 'reel') {
      throw createInstagramVideoPayloadError(
        `Instagram video posts must be published as Reels. Received type "${enforcedOptions.type}".`,
        {
          declaredType: enforcedOptions.type,
          mediaUrl: mediaInfo?.mediaUrl || null
        }
      );
    }

    enforcedOptions.type = 'reel';
    enforcedOptions.isVideo = true;
    enforcedOptions.mediaType = 'video';
  } else {
    if (declaredType === 'reel') {
      logger.warn('[Instagram Fix] Removing reel type because the payload does not contain video media.');
    }

    delete enforcedOptions.type;
    delete enforcedOptions.isVideo;
    delete enforcedOptions.mediaType;
  }

  logger.log('[Instagram Fix] Final Instagram payload mode:', JSON.stringify({
    postKind: hasVideo ? 'reel' : 'feed',
    type: enforcedOptions.type || null,
    mediaUrls: Array.isArray(enforcedOptions.mediaUrls) ? enforcedOptions.mediaUrls : [],
    isVideo: Boolean(enforcedOptions.isVideo),
    mediaType: enforcedOptions.mediaType || null
  }));

  return {
    options: enforcedOptions,
    mediaInfo,
    postKind: hasVideo ? 'reel' : 'feed'
  };
}

function getInstagramDisplayInfo(user = {}) {
  const displayNames = Array.isArray(user?.ayrshare?.displayNames) ? user.ayrshare.displayNames : [];
  return displayNames.find((entry) => String(entry?.platform || '').toLowerCase() === 'instagram') || null;
}

function resolveInstagramAccountKey(user = {}, explicitProfileKey = '') {
  const displayInfo = getInstagramDisplayInfo(user);
  const connectedInstagram = Array.isArray(user?.connectedSocials)
    ? user.connectedSocials.find((entry) => String(entry?.platform || '').toLowerCase() === 'instagram')
    : null;
  const profileKey = explicitProfileKey || user?.ayrshare?.profileKey || '';
  const preferredId = displayInfo?.id || displayInfo?.username || connectedInstagram?.accountId || connectedInstagram?.accountName || profileKey;

  return preferredId ? `instagram:${String(preferredId).toLowerCase()}` : '';
}

function classifyInstagramPublishFailure(result = {}) {
  const topLevelErrors = Array.isArray(result?.data?.errors) ? result.data.errors : [];
  const postErrors = Array.isArray(result?.data?.posts)
    ? result.data.posts.flatMap((post) => Array.isArray(post?.errors) ? post.errors : [])
    : [];
  const errors = [...topLevelErrors, ...postErrors];
  const firstError = errors[0] || null;
  const rawCode = firstError?.code ?? result?.code ?? '';
  const code = rawCode === 0 ? '0' : String(rawCode || '').trim();
  const textBlob = [
    result?.error,
    result?.message,
    result?.data?.message,
    firstError?.message
  ].filter(Boolean).join(' | ');
  const normalizedText = textBlob.toLowerCase();

  if (code === '138' || /rate limit|too many|cannot process your post at this time|please try your post again|temporar/i.test(normalizedText)) {
    return {
      isError: true,
      code: code || '138',
      category: 'rate_limit',
      shouldRetry: true,
      requiresReconnect: false,
      message: textBlob || 'Instagram temporarily rejected the post.',
      userMessage: 'Instagram temporarily rejected this post. When the post contains video, we automatically retry with an Instagram-safe re-encoded MP4.'
    };
  }

  if (code === '161' || /token|auth|authorization|reauth|re-auth|permission|expired|invalid session|relink/i.test(normalizedText)) {
    return {
      isError: true,
      code: code || '161',
      category: 'auth',
      shouldRetry: false,
      requiresReconnect: true,
      message: textBlob || 'Instagram authentication is no longer valid.',
      userMessage: 'Instagram needs to be relinked before posting can continue.'
    };
  }

  if (result?.success === false) {
    return {
      isError: true,
      code,
      category: /network|timeout|socket|econn/i.test(normalizedText) ? 'network' : 'unknown',
      shouldRetry: /network|timeout|socket|econn/i.test(normalizedText),
      requiresReconnect: false,
      message: textBlob || 'Instagram publishing failed.',
      userMessage: textBlob || 'Instagram publishing failed.'
    };
  }

  return {
    isError: false,
    code: '',
    category: '',
    shouldRetry: false,
    requiresReconnect: false,
    message: '',
    userMessage: ''
  };
}

async function persistUserAyrshareError(user, message = '') {
  if (!user || typeof user.save !== 'function') return;

  try {
    user.ayrshare = user.ayrshare || {};
    user.ayrshare.lastError = String(message || '');
    user.ayrshare.lastCheckedAt = new Date();
    await user.save();
  } catch (error) {
    console.warn('Failed to persist Ayrshare account state:', error.message);
  }
}

async function logAttempt(payload) {
  try {
    return await SocialPostAttempt.create(payload);
  } catch (error) {
    console.warn('Failed to write social post attempt log:', error.message);
    return null;
  }
}

async function getRecentDuplicate({ accountKey, campaignId = null, contentHash }) {
  if (!accountKey || !contentHash) return null;

  try {
    const cutoff = new Date(Date.now() - DUPLICATE_WINDOW_HOURS * 60 * 60 * 1000);
    return await SocialPostAttempt.findOne({
      accountKey,
      contentHash,
      createdAt: { $gte: cutoff },
      status: { $in: ['scheduled', 'success'] },
      ...(campaignId ? { campaignId: { $ne: campaignId } } : {})
    }).sort({ createdAt: -1 });
  } catch (error) {
    console.warn('Duplicate post lookup failed:', error.message);
    return null;
  }
}

async function reserveScheduledSlot({ accountKey, scheduledFor, campaignId = null }) {
  if (!accountKey || !scheduledFor) {
    return {
      scheduleDate: scheduledFor || null,
      adjusted: false,
      reason: null
    };
  }

  const minDelayMs = INSTAGRAM_MIN_DELAY_MINUTES * 60 * 1000;
  let candidate = new Date(scheduledFor);

  if (Number.isNaN(candidate.getTime())) {
    candidate = new Date(Date.now() + minDelayMs);
  }

  if (candidate.getTime() < Date.now() + minDelayMs) {
    candidate = new Date(Date.now() + minDelayMs);
  }

  const originalDate = new Date(scheduledFor);
  let adjusted = Number.isNaN(originalDate.getTime()) || candidate.getTime() !== originalDate.getTime();
  let reason = adjusted ? 'minimum_lead' : null;

  try {
    while (true) {
      const windowStart = new Date(candidate.getTime() - minDelayMs + 1);
      const windowEnd = new Date(candidate.getTime() + minDelayMs - 1);
      const conflict = await Campaign.findOne({
        instagramAccountKey: accountKey,
        status: 'scheduled',
        platforms: { $in: ['instagram'] },
        scheduledFor: { $gte: windowStart, $lte: windowEnd },
        ...(campaignId ? { _id: { $ne: campaignId } } : {})
      }).sort({ scheduledFor: 1 }).select('_id name scheduledFor');

      if (!conflict?.scheduledFor) {
        break;
      }

      candidate = new Date(new Date(conflict.scheduledFor).getTime() + minDelayMs);
      adjusted = true;
      reason = 'instagram_minimum_gap';
    }
  } catch (error) {
    console.warn('Instagram schedule spacing lookup failed:', error.message);
  }

  return {
    scheduleDate: candidate.toISOString(),
    adjusted,
    reason
  };
}

function enqueueInstagramTask(accountKey, task) {
  if (!accountKey) {
    return task();
  }

  const previous = accountQueues.get(accountKey) || Promise.resolve();
  const queued = previous
    .catch(() => {})
    .then(task);

  accountQueues.set(accountKey, queued);
  queued.finally(() => {
    if (accountQueues.get(accountKey) === queued) {
      accountQueues.delete(accountKey);
    }
  });

  return queued;
}

async function getInstagramAccountHealthReport({ user, profileKey = '' } = {}) {
  const resolvedProfileKey = profileKey || user?.ayrshare?.profileKey || '';
  const accountKey = resolveInstagramAccountKey(user, resolvedProfileKey);
  const connectedInstagram = Array.isArray(user?.connectedSocials)
    ? user.connectedSocials.find((entry) => String(entry?.platform || '').toLowerCase() === 'instagram')
    : null;
  const displayInfo = getInstagramDisplayInfo(user);
  const now = new Date();

  const report = {
    platform: 'instagram',
    accountKey,
    username: displayInfo?.username || displayInfo?.displayName || connectedInstagram?.accountName || null,
    connected: Boolean(resolvedProfileKey || connectedInstagram),
    profileKeyPresent: Boolean(resolvedProfileKey),
    tokenExpiresAt: connectedInstagram?.tokenExpiresAt || null,
    tokenExpired: connectedInstagram?.tokenExpiresAt ? new Date(connectedInstagram.tokenExpiresAt) <= now : false,
    tokenExpiringSoon: connectedInstagram?.tokenExpiresAt
      ? new Date(connectedInstagram.tokenExpiresAt).getTime() <= now.getTime() + 24 * 60 * 60 * 1000
      : false,
    needsReconnect: false,
    healthy: false,
    message: '',
    monitoring: {
      error138Last24Hours: 0,
      authIssuesLast7Days: 0,
      attemptsLast24Hours: 0,
      lastSuccessAt: null,
      lastFailureAt: null
    }
  };

  try {
    if (accountKey) {
      const attempts24hCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const auth7dCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const [error138Count, authIssueCount, attemptsLast24h, lastSuccess, lastFailure] = await Promise.all([
        SocialPostAttempt.countDocuments({ accountKey, errorCode: '138', createdAt: { $gte: attempts24hCutoff } }),
        SocialPostAttempt.countDocuments({ accountKey, errorCategory: 'auth', createdAt: { $gte: auth7dCutoff } }),
        SocialPostAttempt.countDocuments({ accountKey, createdAt: { $gte: attempts24hCutoff } }),
        SocialPostAttempt.findOne({ accountKey, status: 'success' }).sort({ createdAt: -1 }).select('createdAt'),
        SocialPostAttempt.findOne({ accountKey, status: 'failure' }).sort({ createdAt: -1 }).select('createdAt')
      ]);

      report.monitoring.error138Last24Hours = error138Count;
      report.monitoring.authIssuesLast7Days = authIssueCount;
      report.monitoring.attemptsLast24Hours = attemptsLast24h;
      report.monitoring.lastSuccessAt = lastSuccess?.createdAt || null;
      report.monitoring.lastFailureAt = lastFailure?.createdAt || null;
    }
  } catch (error) {
    console.warn('Instagram monitoring lookup failed:', error.message);
  }

  if (!resolvedProfileKey) {
    report.message = 'No Ayrshare profile is linked for this user.';
    report.needsReconnect = true;
    return report;
  }

  if (report.tokenExpired) {
    report.message = 'Instagram token has expired and the account must be relinked.';
    report.needsReconnect = true;
    return report;
  }

  try {
    const ayrshareProfile = await getAyrshareUserProfile(resolvedProfileKey);
    const activeAccounts = ayrshareProfile?.success
      ? (Array.isArray(ayrshareProfile.data?.activeSocialAccounts) ? ayrshareProfile.data.activeSocialAccounts : [])
      : [];
    const hasInstagram = activeAccounts.some((entry) => String(entry || '').toLowerCase() === 'instagram');

    if (!ayrshareProfile?.success) {
      report.message = ayrshareProfile?.error || 'Unable to verify Instagram account health via Ayrshare.';
      report.needsReconnect = /token|auth|expired|permission|invalid/i.test(String(report.message).toLowerCase());
      report.healthy = !report.needsReconnect;
      return report;
    }

    if (!hasInstagram) {
      report.message = 'Instagram is not currently active in the linked Ayrshare profile.';
      report.needsReconnect = true;
      return report;
    }

    report.healthy = true;
    report.message = report.monitoring.error138Last24Hours > 0
      ? 'Instagram is connected, but recent rate-limit errors were detected.'
      : 'Instagram account is healthy.';
    return report;
  } catch (error) {
    report.message = error.message || 'Unable to check Instagram account health.';
    report.needsReconnect = /token|auth|expired|permission|invalid/i.test(String(report.message).toLowerCase());
    report.healthy = !report.needsReconnect;
    return report;
  }
}

async function publishSocialPostWithSafetyWrapper({
  user = null,
  campaign = null,
  platforms,
  content,
  options = {},
  context = 'social_post'
} = {}) {
  const normalizedPlatforms = normalizePlatforms(platforms);
  const includesInstagram = normalizedPlatforms.includes('instagram');
  const workingOptions = { ...options };
  const accountKey = includesInstagram ? resolveInstagramAccountKey(user, workingOptions.profileKey) : '';
  const normalizedInstagram = includesInstagram ? normalizeInstagramContent(content) : null;
  const normalizedContent = includesInstagram && normalizedInstagram?.valid
    ? normalizedInstagram.normalizedContent
    : String(content || '').trim();
  const mediaUrls = Array.isArray(workingOptions.mediaUrls) ? workingOptions.mediaUrls : [];
  const originalInstagramVideoUrl = includesInstagram && mediaUrls.length > 0 ? mediaUrls[0] : null;
  const contentHash = includesInstagram ? buildContentHash(normalizedContent, mediaUrls) : '';

  if (includesInstagram && !normalizedInstagram?.valid) {
    await logAttempt({
      userId: user?._id || null,
      campaignId: campaign?._id || null,
      accountKey,
      profileKey: workingOptions.profileKey || user?.ayrshare?.profileKey || '',
      platforms: normalizedPlatforms,
      status: 'blocked',
      attemptNumber: 0,
      maxRetries: INSTAGRAM_MAX_RETRIES,
      contentHash,
      captionLength: 0,
      hashtagCount: 0,
      errorCode: normalizedInstagram.code,
      errorCategory: normalizedInstagram.category,
      message: normalizedInstagram.message,
      requiresReconnect: false,
      rateLimited: false,
      requestSummary: { context }
    });

    return {
      success: false,
      error: normalizedInstagram.userMessage,
      code: normalizedInstagram.code,
      category: normalizedInstagram.category,
      requiresReconnect: false,
      rateLimited: false,
      data: null,
      instagramFix: {
        accountKey,
        adjustedScheduleDate: null,
        contentAdjusted: false
      }
    };
  }

  const execute = async () => {
    if (includesInstagram) {
      const duplicate = await getRecentDuplicate({
        accountKey,
        campaignId: campaign?._id || null,
        contentHash
      });

      if (duplicate) {
        const message = 'Duplicate Instagram content detected from the last 48 hours. Please change the caption or media before posting again.';
        await logAttempt({
          userId: user?._id || null,
          campaignId: campaign?._id || null,
          accountKey,
          profileKey: workingOptions.profileKey || user?.ayrshare?.profileKey || '',
          platforms: normalizedPlatforms,
          status: 'blocked',
          attemptNumber: 0,
          maxRetries: INSTAGRAM_MAX_RETRIES,
          scheduledFor: workingOptions.scheduleDate ? new Date(workingOptions.scheduleDate) : null,
          contentHash,
          captionLength: normalizedInstagram.captionLength,
          hashtagCount: normalizedInstagram.hashtagCount,
          errorCode: 'DUPLICATE_CONTENT',
          errorCategory: 'duplicate',
          message,
          requestSummary: { context, duplicateAttemptId: duplicate._id }
        });

        return {
          success: false,
          error: message,
          code: 'DUPLICATE_CONTENT',
          category: 'duplicate',
          requiresReconnect: false,
          rateLimited: false,
          data: null,
          instagramFix: {
            accountKey,
            adjustedScheduleDate: null,
            contentAdjusted: normalizedInstagram.adjusted
          }
        };
      }

      const health = await getInstagramAccountHealthReport({ user, profileKey: workingOptions.profileKey });
      if (!health.healthy) {
        const message = health.needsReconnect
          ? 'Instagram connection needs to be refreshed. Please relink the account before posting.'
          : (health.message || 'Instagram account is not healthy enough to post right now.');

        await persistUserAyrshareError(user, message);
        await logAttempt({
          userId: user?._id || null,
          campaignId: campaign?._id || null,
          accountKey,
          profileKey: workingOptions.profileKey || user?.ayrshare?.profileKey || '',
          platforms: normalizedPlatforms,
          status: 'blocked',
          attemptNumber: 0,
          maxRetries: INSTAGRAM_MAX_RETRIES,
          scheduledFor: workingOptions.scheduleDate ? new Date(workingOptions.scheduleDate) : null,
          contentHash,
          captionLength: normalizedInstagram.captionLength,
          hashtagCount: normalizedInstagram.hashtagCount,
          errorCode: health.needsReconnect ? '161' : 'ACCOUNT_UNHEALTHY',
          errorCategory: health.needsReconnect ? 'auth' : 'unknown',
          message,
          requiresReconnect: Boolean(health.needsReconnect),
          requestSummary: { context, health }
        });

        return {
          success: false,
          error: message,
          code: health.needsReconnect ? '161' : 'ACCOUNT_UNHEALTHY',
          category: health.needsReconnect ? 'auth' : 'unknown',
          requiresReconnect: Boolean(health.needsReconnect),
          rateLimited: false,
          data: null,
          instagramFix: {
            accountKey,
            adjustedScheduleDate: null,
            contentAdjusted: normalizedInstagram.adjusted
          }
        };
      }

      if (workingOptions.scheduleDate) {
        const spaced = await reserveScheduledSlot({
          accountKey,
          scheduledFor: workingOptions.scheduleDate,
          campaignId: campaign?._id || null
        });
        workingOptions.scheduleDate = spaced.scheduleDate;
        workingOptions.scheduleAdjustment = spaced;
      }

      let mediaInfo = null;
      try {
        const enforcedPayload = await enforceInstagramVideoPublishingRules({
          platforms: normalizedPlatforms,
          options: workingOptions,
          logger: console
        });
        Object.assign(workingOptions, enforcedPayload.options);
        mediaInfo = enforcedPayload.mediaInfo;
      } catch (error) {
        const message = error?.message || 'Instagram video posts must be published as Reels.';
        await logAttempt({
          userId: user?._id || null,
          campaignId: campaign?._id || null,
          accountKey,
          profileKey: workingOptions.profileKey || user?.ayrshare?.profileKey || '',
          platforms: normalizedPlatforms,
          status: 'blocked',
          attemptNumber: 0,
          maxRetries: INSTAGRAM_MAX_RETRIES,
          scheduledFor: workingOptions.scheduleDate ? new Date(workingOptions.scheduleDate) : null,
          contentHash,
          captionLength: normalizedInstagram.captionLength,
          hashtagCount: normalizedInstagram.hashtagCount,
          errorCode: error?.code || 'INSTAGRAM_VIDEO_REQUIRES_REEL',
          errorCategory: error?.category || 'validation',
          message,
          requestSummary: {
            context,
            mediaUrls: Array.isArray(workingOptions.mediaUrls) ? workingOptions.mediaUrls : [],
            type: workingOptions.type || null
          }
        });

        return {
          success: false,
          error: message,
          code: error?.code || 'INSTAGRAM_VIDEO_REQUIRES_REEL',
          category: error?.category || 'validation',
          requiresReconnect: false,
          rateLimited: false,
          data: null,
          instagramFix: {
            accountKey,
            adjustedScheduleDate: workingOptions.scheduleDate || null,
            contentAdjusted: normalizedInstagram.adjusted,
            hashtagCount: normalizedInstagram.hashtagCount,
            mediaUrl: Array.isArray(workingOptions.mediaUrls) ? (workingOptions.mediaUrls[0] || null) : null,
            videoTransformed: false
          }
        };
      }

      console.log('[Instagram Fix] Publish media debug:');
      console.log(`   Media URL: ${mediaInfo?.mediaUrl || 'none'}`);
      console.log(`   Video/audio flags: isVideo=${Boolean(workingOptions.isVideo)} mediaType=${workingOptions.mediaType || 'none'}`);
      console.log(`   Detected video: ${Boolean(mediaInfo?.hasVideo)} detected audio/video payload: ${Boolean(mediaInfo?.hasAudio)}`);

      if (mediaInfo?.mediaUrl && !mediaInfo?.mediaValidation?.valid) {
        const message = `Instagram media validation failed: ${mediaInfo.mediaValidation.reason}`;
        await logAttempt({
          userId: user?._id || null,
          campaignId: campaign?._id || null,
          accountKey,
          profileKey: workingOptions.profileKey || user?.ayrshare?.profileKey || '',
          platforms: normalizedPlatforms,
          status: 'blocked',
          attemptNumber: 0,
          maxRetries: INSTAGRAM_MAX_RETRIES,
          scheduledFor: workingOptions.scheduleDate ? new Date(workingOptions.scheduleDate) : null,
          contentHash,
          captionLength: normalizedInstagram.captionLength,
          hashtagCount: normalizedInstagram.hashtagCount,
          errorCode: 'INVALID_MEDIA',
          errorCategory: 'validation',
          message,
          requestSummary: { context, mediaUrl: mediaInfo.mediaUrl }
        });

        return {
          success: false,
          error: message,
          code: 'INVALID_MEDIA',
          category: 'validation',
          requiresReconnect: false,
          rateLimited: false,
          data: null,
          instagramFix: {
            accountKey,
            adjustedScheduleDate: workingOptions.scheduleDate || null,
            contentAdjusted: normalizedInstagram.adjusted,
            hashtagCount: normalizedInstagram.hashtagCount,
            mediaUrl: mediaInfo.mediaUrl,
            videoTransformed: false
          }
        };
      }

      if (mediaInfo?.hasVideo && !workingOptions.instagramVideoPrepared) {
        const preparedVideo = await prepareInstagramVideoForPublishing({
          videoUrl: mediaInfo.mediaUrl,
          cloudinaryFolder: 'nebula-instagram-videos',
          forceReencode: true
        });

        if (!preparedVideo.success || !preparedVideo.videoUrl) {
          const message = preparedVideo.error || 'Instagram-safe video preparation failed.';
          await logAttempt({
            userId: user?._id || null,
            campaignId: campaign?._id || null,
            accountKey,
            profileKey: workingOptions.profileKey || user?.ayrshare?.profileKey || '',
            platforms: normalizedPlatforms,
            status: 'blocked',
            attemptNumber: 0,
            maxRetries: INSTAGRAM_MAX_RETRIES,
            scheduledFor: workingOptions.scheduleDate ? new Date(workingOptions.scheduleDate) : null,
            contentHash,
            captionLength: normalizedInstagram.captionLength,
            hashtagCount: normalizedInstagram.hashtagCount,
            errorCode: 'INVALID_VIDEO_PROFILE',
            errorCategory: 'validation',
            message,
            requestSummary: {
              context,
              mediaUrl: mediaInfo.mediaUrl,
              metadata: preparedVideo.metadata || null,
              validation: preparedVideo.validation || null
            }
          });

          return {
            success: false,
            error: message,
            code: 'INVALID_VIDEO_PROFILE',
            category: 'validation',
            requiresReconnect: false,
            rateLimited: false,
            data: null,
            instagramFix: {
              accountKey,
              adjustedScheduleDate: workingOptions.scheduleDate || null,
              contentAdjusted: normalizedInstagram.adjusted,
              hashtagCount: normalizedInstagram.hashtagCount,
              mediaUrl: mediaInfo.mediaUrl,
              videoTransformed: false
            }
          };
        }

        workingOptions.mediaUrls = [preparedVideo.videoUrl];
        workingOptions.isVideo = true;
        workingOptions.mediaType = 'video';
        workingOptions.type = 'reel';
        workingOptions.instagramVideoPrepared = true;
        workingOptions.instagramVideoDebug = {
          originalUrl: mediaInfo.mediaUrl,
          preparedUrl: preparedVideo.videoUrl,
          transformed: preparedVideo.transformed,
          metadata: preparedVideo.metadata || null,
          validation: preparedVideo.validation || null,
          hasAudio: preparedVideo.hasAudio
        };

        const enforcedPreparedPayload = await enforceInstagramVideoPublishingRules({
          platforms: normalizedPlatforms,
          options: workingOptions,
          logger: console
        });
        Object.assign(workingOptions, enforcedPreparedPayload.options);

        console.log(`[Instagram Fix] Using Instagram-safe video URL: ${preparedVideo.videoUrl}`);
      }
    }

    const maxRetries = includesInstagram ? INSTAGRAM_MAX_RETRIES : 0;
    let attemptNumber = 0;
    let finalResult = null;
    let lastClassification = null;
    let videoFallbackAttempted = false;

    while (attemptNumber <= maxRetries) {
      attemptNumber += 1;
      if (includesInstagram) {
        console.log('[Instagram Fix] Final Ayrshare payload summary:', JSON.stringify({
          platforms: normalizedPlatforms,
          type: workingOptions.type || null,
          mediaUrls: Array.isArray(workingOptions.mediaUrls) ? workingOptions.mediaUrls : [],
          isVideo: Boolean(workingOptions.isVideo),
          mediaType: workingOptions.mediaType || null,
          scheduleDate: workingOptions.scheduleDate || null
        }, null, 2));
      }
      const rawResult = await postToSocialMedia(normalizedPlatforms, normalizedContent, workingOptions);
      const classification = includesInstagram ? classifyInstagramPublishFailure(rawResult) : {
        isError: rawResult?.success === false,
        code: '',
        category: '',
        shouldRetry: false,
        requiresReconnect: false,
        message: rawResult?.error || rawResult?.message || '',
        userMessage: rawResult?.error || rawResult?.message || ''
      };
      const status = !classification.isError
        ? (workingOptions.scheduleDate ? 'scheduled' : 'success')
        : 'failure';

      await logAttempt({
        userId: user?._id || null,
        campaignId: campaign?._id || null,
        accountKey,
        profileKey: workingOptions.profileKey || user?.ayrshare?.profileKey || '',
        platforms: normalizedPlatforms,
        status,
        attemptNumber,
        maxRetries,
        scheduledFor: workingOptions.scheduleDate ? new Date(workingOptions.scheduleDate) : null,
        contentHash,
        captionLength: normalizedInstagram?.captionLength || normalizedContent.length,
        hashtagCount: normalizedInstagram?.hashtagCount || 0,
        errorCode: classification.code,
        errorCategory: classification.category,
        message: classification.message,
        requiresReconnect: classification.requiresReconnect,
        rateLimited: classification.category === 'rate_limit',
        requestSummary: {
          context,
          mediaUrls: Array.isArray(workingOptions.mediaUrls) ? workingOptions.mediaUrls : mediaUrls,
          scheduleDate: workingOptions.scheduleDate || null,
          type: workingOptions.type || null
        },
        responseSummary: rawResult?.data || rawResult || null
      });

      if (!classification.isError) {
        await persistUserAyrshareError(user, '');
        finalResult = rawResult;
        lastClassification = classification;
        break;
      }

      lastClassification = classification;
      if (classification.requiresReconnect) {
        await persistUserAyrshareError(user, classification.message || classification.userMessage);
      }

      if (
        includesInstagram &&
        classification.code === '138' &&
        !videoFallbackAttempted &&
        (workingOptions.isVideo === true || String(workingOptions.mediaType || '').toLowerCase() === 'video') &&
        originalInstagramVideoUrl
      ) {
        console.log('[Instagram Fix] Ayrshare returned Error 138 for a video. Retrying with forced re-encoded media.');
        const fallbackVideo = await prepareInstagramVideoForPublishing({
          videoUrl: originalInstagramVideoUrl,
          cloudinaryFolder: 'nebula-instagram-videos',
          forceReencode: true
        });
        videoFallbackAttempted = true;

        if (fallbackVideo.success && fallbackVideo.videoUrl) {
          workingOptions.mediaUrls = [fallbackVideo.videoUrl];
          workingOptions.isVideo = true;
          workingOptions.mediaType = 'video';
          workingOptions.type = 'reel';
          workingOptions.instagramVideoPrepared = true;
          workingOptions.instagramVideoDebug = {
            originalUrl: originalInstagramVideoUrl,
            preparedUrl: fallbackVideo.videoUrl,
            transformed: fallbackVideo.transformed,
            metadata: fallbackVideo.metadata || null,
            validation: fallbackVideo.validation || null,
            hasAudio: fallbackVideo.hasAudio,
            fallbackTriggeredBy: '138'
          };
        } else {
          classification.message = `${classification.message} Re-encoding fallback failed: ${fallbackVideo.error || 'unknown error'}`;
          classification.userMessage = 'Instagram rejected the video, and the automatic re-encode fallback also failed. Please upload an MP4 encoded as H.264 video with AAC audio.';
          finalResult = rawResult;
          break;
        }
      }

      if (!(classification.shouldRetry && attemptNumber <= maxRetries)) {
        finalResult = rawResult;
        break;
      }

      const delayMs = 1000 * Math.pow(2, attemptNumber);
      await sleep(delayMs);
    }

    const failure = lastClassification?.isError ? lastClassification : null;
    return {
      success: !failure,
      data: finalResult?.data || null,
      status: finalResult?.status || null,
      error: failure ? failure.userMessage : '',
      rawError: failure ? (failure.message || finalResult?.error || '') : '',
      code: failure?.code || '',
      category: failure?.category || '',
      requiresReconnect: Boolean(failure?.requiresReconnect),
      rateLimited: failure?.category === 'rate_limit',
      retryCount: Math.max(0, attemptNumber - 1),
      instagramFix: {
        accountKey,
        adjustedScheduleDate: workingOptions.scheduleDate || null,
        contentAdjusted: Boolean(normalizedInstagram?.adjusted),
        hashtagCount: normalizedInstagram?.hashtagCount || 0,
        mediaUrl: Array.isArray(workingOptions.mediaUrls) ? (workingOptions.mediaUrls[0] || null) : null,
        videoTransformed: Boolean(workingOptions.instagramVideoDebug?.transformed),
        videoDebug: workingOptions.instagramVideoDebug || null
      }
    };
  };

  return includesInstagram ? enqueueInstagramTask(accountKey, execute) : execute();
}

module.exports = {
  INSTAGRAM_MAX_CAPTION_LENGTH,
  INSTAGRAM_MAX_HASHTAGS,
  INSTAGRAM_MAX_RETRIES,
  INSTAGRAM_MIN_DELAY_MINUTES,
  classifyInstagramPublishFailure,
  enforceInstagramVideoPublishingRules,
  getInstagramAccountHealthReport,
  normalizeInstagramContent,
  publishSocialPostWithSafetyWrapper,
  resolveInstagramAccountKey
};
