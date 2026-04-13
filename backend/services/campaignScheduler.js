const Campaign = require('../models/Campaign');
const User = require('../models/User');
const { publishCampaignToSocial } = require('./campaignPublisher');
const { getPostStatus } = require('./socialMediaAPI');
const { computeNextRecurringStartDate } = require('../utils/scheduling');

function isEnabled() {
  return String(process.env.ENABLE_CAMPAIGN_SCHEDULER || 'true').toLowerCase() !== 'false';
}

function isValidFacebookPostId(value) {
  return /^\d{5,}_\d{5,}$/.test(String(value || '').trim());
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
    const postId =
      normalizeNumericId(query.get('fbid')) ||
      normalizeNumericId(query.get('story_fbid')) ||
      normalizeNumericId(pathname.match(/\/posts\/(\d{5,})/i)?.[1] || '') ||
      normalizeNumericId(pathname.match(/\/videos\/(\d{5,})/i)?.[1] || '') ||
      normalizeNumericId(pathname.match(/\/reel\/(\d{5,})/i)?.[1] || '') ||
      '';
    if (!postId) return { pageId: '', postId: '' };

    const setParam = String(query.get('set') || '').trim();
    const setPageId = normalizeNumericId(setParam.match(/(?:^|\.)(?:pcb|pb)\.(\d{5,})(?:\.|$)/i)?.[1] || '');
    const pathPageId =
      normalizeNumericId(pathname.match(/^\/(\d{5,})(?:\/|$)/)?.[1] || '') ||
      normalizeNumericId(pathname.match(/\/pages\/[^/]+\/(\d{5,})\//i)?.[1] || '');
    const queryPageId = normalizeNumericId(query.get('id')) || '';

    return {
      pageId: queryPageId || pathPageId || setPageId,
      postId
    };
  } catch (error) {
    return { pageId: '', postId: '' };
  }
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

function extractFacebookPostIdFromAyrsharePayload(payload = {}) {
  const posts = Array.isArray(payload?.posts) ? payload.posts : [];
  if (posts.length > 0) {
    const firstFbId = normalizeFacebookPostId(posts[0]?.fbId || posts[0]?.facebookPostId || '');
    if (firstFbId) return firstFbId;

    const firstPageId =
      normalizeNumericId(
        posts[0]?.facebookPageId ||
          posts[0]?.fbPageId ||
          posts[0]?.pageId ||
          posts[0]?.page_id ||
          posts[0]?.accountId ||
          ''
      ) ||
      '';
    const firstPostUrl = String(posts[0]?.postUrl || posts[0]?.url || posts[0]?.link || '').trim();
    const firstFromUrl = extractFacebookPostIdFromUrl(firstPostUrl, { fallbackPageId: firstPageId });
    if (firstFromUrl) return firstFromUrl;
  }

  for (const post of posts) {
    const fbId = normalizeFacebookPostId(post?.fbId || post?.facebookPostId || '');
    if (fbId) return fbId;

    const pageId =
      normalizeNumericId(
        post?.facebookPageId ||
          post?.fbPageId ||
          post?.pageId ||
          post?.page_id ||
          post?.accountId ||
          ''
      ) ||
      '';
    const postUrl = String(post?.postUrl || post?.url || post?.link || '').trim();
    const fromUrl = extractFacebookPostIdFromUrl(postUrl, { fallbackPageId: pageId });
    if (fromUrl) return fromUrl;
  }

  const topLevelFbId = normalizeFacebookPostId(payload?.fbId || payload?.facebookPostId || '');
  if (topLevelFbId) return topLevelFbId;

  const topLevelPageId =
    normalizeNumericId(payload?.facebookPageId || payload?.fbPageId || payload?.pageId || payload?.page_id || '') ||
    '';
  const topLevelPostUrl = String(payload?.postUrl || payload?.url || payload?.link || '').trim();
  return extractFacebookPostIdFromUrl(topLevelPostUrl, {
    fallbackPageId: topLevelPageId || extractFacebookPageId(topLevelFbId)
  });
}

function getAyrshareStatus(payload = {}) {
  return String(payload?.status || payload?.posts?.[0]?.status || '').trim().toLowerCase();
}

function isAyrsharePendingStatus(status = '') {
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

async function waitForFacebookPostId({ profileKey = '', ayrsharePostId = '', initialPayload = null } = {}) {
  const immediate = extractFacebookPostIdFromAyrsharePayload(initialPayload || {});
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
    const fbId = extractFacebookPostIdFromAyrsharePayload(payload);
    if (fbId) return fbId;

    const lifecycleStatus = getAyrshareStatus(payload);
    if (!isAyrsharePendingStatus(lifecycleStatus)) {
      break;
    }

    if (attempt < FACEBOOK_POST_ID_POLL_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, FACEBOOK_POST_ID_POLL_DELAY_MS));
    }
  }

  return '';
}

async function processDueCampaigns({ now = new Date(), limit = 20 } = {}) {
  const dueCampaigns = await Campaign.find({
    status: 'scheduled',
    'scheduling.startDate': { $lte: now },
  })
    .sort({ 'scheduling.startDate': 1 })
    .limit(limit);

  for (const campaign of dueCampaigns) {
    try {
      const result = await publishCampaignToSocial(campaign);
      const nextRecurring = computeNextRecurringStartDate(campaign, { now });

      if (result.success) {
        const platformPostIds = result?.platformPostIds && typeof result.platformPostIds === 'object'
          ? result.platformPostIds
          : {};
        const normalizedCampaignPlatforms = Array.isArray(campaign?.platforms)
          ? campaign.platforms.map((platform) => String(platform || '').toLowerCase())
          : [];
        const facebookSelected = normalizedCampaignPlatforms.includes('facebook');
        const initialFacebookPayload =
          result?.data?.other ||
          result?.data?.instagram ||
          result?.data ||
          null;
        const profileKey = campaign?.userId
          ? String((await User.findById(campaign.userId).select('ayrshare.profileKey'))?.ayrshare?.profileKey || '').trim()
          : '';

        let facebookPostId = normalizeFacebookPostId(platformPostIds.facebook || campaign?.facebookPostId || '');
        if (!facebookPostId && facebookSelected) {
          facebookPostId = normalizeFacebookPostId(
            await waitForFacebookPostId({
              profileKey,
              ayrsharePostId: result?.postId,
              initialPayload: initialFacebookPayload
            })
          );
        }
        const instagramPostId = String(platformPostIds.instagram || '').trim();

        const nextSocialPostIds = {
          ...(campaign?.socialPostIds && typeof campaign.socialPostIds === 'object' ? campaign.socialPostIds : {}),
          ...platformPostIds
        };
        if (facebookPostId) {
          nextSocialPostIds.facebook = facebookPostId;
        }

        const update = {
          socialPostId: result.postId,
          socialPostIds: Object.keys(nextSocialPostIds).length > 0 ? nextSocialPostIds : null,
          facebookPostId: facebookPostId || campaign?.facebookPostId || null,
          instagramPostId: instagramPostId || campaign?.instagramPostId || null,
          publishedAt: new Date(),
          publishResult: result.data,
          lastPublishError: null,
          instagramAccountKey: result?.instagramFix?.accountKey || null,
          ayrshareStatus: 'success'
        };

        if (nextRecurring) {
          update.status = 'scheduled';
          update['scheduling.startDate'] = nextRecurring.startDate;
          update['scheduling.postTime'] = nextRecurring.postTime;
          update['scheduling.scheduleType'] = nextRecurring.scheduleType;
          update['scheduling.interval'] = nextRecurring.interval;
          if (nextRecurring.timezoneOffsetMinutes !== null && nextRecurring.timezoneOffsetMinutes !== undefined) {
            update['scheduling.timezoneOffsetMinutes'] = nextRecurring.timezoneOffsetMinutes;
          }
        } else {
          update.status = 'posted';
        }

        await Campaign.findByIdAndUpdate(campaign._id, { $set: update });
        continue;
      }

      // If social publishing isn't configured, still "trigger" the scheduled campaign
      // so the UI reflects the scheduled action occurred.
      const notConfigured = String(result.error || '').toLowerCase().includes('not configured');
      if (notConfigured) {
        const update = {
          publishedAt: new Date(),
          publishResult: { simulated: true, reason: result.error || 'API not configured' },
          lastPublishError: null,
          ayrshareStatus: 'success'
        };

        if (nextRecurring) {
          update.status = 'scheduled';
          update['scheduling.startDate'] = nextRecurring.startDate;
          update['scheduling.postTime'] = nextRecurring.postTime;
          update['scheduling.scheduleType'] = nextRecurring.scheduleType;
          update['scheduling.interval'] = nextRecurring.interval;
          if (nextRecurring.timezoneOffsetMinutes !== null && nextRecurring.timezoneOffsetMinutes !== undefined) {
            update['scheduling.timezoneOffsetMinutes'] = nextRecurring.timezoneOffsetMinutes;
          }
        } else {
          update.status = 'posted';
        }

        await Campaign.findByIdAndUpdate(campaign._id, { $set: update });
        continue;
      }

      await Campaign.findByIdAndUpdate(campaign._id, {
        $set: {
          lastPublishError: result.error || result.message || 'Failed to publish',
          publishResult: result.data || result,
          ayrshareStatus: 'error'
        },
      });
    } catch (e) {
      await Campaign.findByIdAndUpdate(campaign._id, {
        $set: {
          lastPublishError: e.message || 'Failed to publish',
          ayrshareStatus: 'error'
        },
      });
    }
  }
}

function startCampaignScheduler({ intervalMs = 30_000, logger = console } = {}) {
  if (!isEnabled()) {
    logger.log('🕒 Campaign scheduler disabled (ENABLE_CAMPAIGN_SCHEDULER=false)');
    return () => {};
  }

  logger.log(`🕒 Campaign scheduler started (interval ${intervalMs}ms)`);
  const timer = setInterval(() => {
    processDueCampaigns().catch((e) => logger.error('Campaign scheduler error:', e));
  }, intervalMs);

  // Run once immediately
  processDueCampaigns().catch((e) => logger.error('Campaign scheduler error:', e));

  return () => clearInterval(timer);
}

module.exports = {
  processDueCampaigns,
  startCampaignScheduler,
};
