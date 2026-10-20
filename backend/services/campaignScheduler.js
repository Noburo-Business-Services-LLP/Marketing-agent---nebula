const Campaign = require('../models/Campaign');
const Draft = require('../models/Draft');
const { publishGate } = require('./postLifecycle');
const User = require('../models/User');
const { publishCampaignToSocial } = require('./campaignPublisher');
const { getPostStatus } = require('./socialMediaAPI');
const { computeNextRecurringStartDate } = require('../utils/scheduling');
const { learnCampaignPublish } = require('./aiCampaignLearning');
const publishClaims = require('./publishClaim');

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

// A post that is binned or archived, or an automation post nobody approved, must never go out.
// Returns true when the linked Draft (if any) allows posting. A campaign with no Draft is always allowed.
async function linkedDraftAllowsPosting(campaign) {
  const draft = await Draft.findOne({ campaignId: campaign._id }).select('status origin contentCalendarId calendarDay').lean();
  if (!draft) return true;
  if (String(draft.status || '') === 'archived') return false;
  return !publishGate(draft);
}

// After the scheduler posts a campaign, the linked Draft becomes posted (status 'published', the value the
// publish-now route uses and the Library counts as Posted). Conditional on scheduled/approved, so it runs once,
// never touches binned/archived posts, and a second run changes nothing.
async function markLinkedDraftPosted(campaign, platforms, postedAt = new Date()) {
  const used = Array.isArray(platforms) ? platforms : [];
  return Draft.updateOne(
    { campaignId: campaign._id, status: { $in: ['scheduled', 'approved'] } },
    { $set: { status: 'published', publishedAt: postedAt, publishedPlatforms: used } }
  );
}

const SCHEDULER_PROJECTION = '-publishResult -lastPublishError';

async function processDueCampaigns({ now = new Date(), limit = 20 } = {}) {
  const MAX_PUBLISH_ATTEMPTS = Number(process.env.CAMPAIGN_MAX_PUBLISH_ATTEMPTS || 3);
  // Nothing goes out for a frozen client, a client whose agency plan ended, or an account waiting to be deleted.
  const paused = await require('./backgroundGate').blockedAccountIdsSafe();
  const dueCampaigns = await Campaign.find({
    status: 'scheduled',
    ...(paused.length ? { userId: { $nin: paused } } : {}),
    'scheduling.startDate': { $lte: now },
    // Defense-in-depth: skip campaigns already at the failure ceiling even if
    // their status somehow got reset back to 'scheduled'. Prevents the Ayrshare
    // post-error spam that caused suspension #3.
    $or: [
      { publishFailureCount: { $lt: MAX_PUBLISH_ATTEMPTS } },
      { publishFailureCount: { $exists: false } }
    ],
    publishAutoCancelled: { $ne: true }
  })
    // The publisher needs the whole post except the stored provider answers (which held whole pictures: D104).
    .select(SCHEDULER_PROJECTION)
    .sort({ 'scheduling.startDate': 1 })
    .limit(limit);

  for (const campaign of dueCampaigns) {
    let token = null;
    try {
      if (!(await linkedDraftAllowsPosting(campaign))) {
        // Take it out of the schedule (only if still scheduled) so it is not picked up again.
        await Campaign.updateOne({ _id: campaign._id, status: 'scheduled' }, { $set: { status: 'draft' } });
        console.warn(`[Campaign Scheduler] Skipped campaign ${campaign._id}: its post is binned, archived or not approved.`);
        continue;
      }
      // One atomic claim per campaign before anything is sent (services/publishClaim.js): a lease lost mid-tick, a
      // second server or "Post now" cannot send the same post twice. The loser skips; the next tick looks again.
      const claimed = await publishClaims.claim(Campaign, campaign._id, { statuses: ['scheduled'], now, by: 'scheduler' });
      if (!claimed.claimed) {
        console.warn(`[Campaign Scheduler] Skipped campaign ${campaign._id}: already being sent by another run.`);
        continue;
      }
      token = claimed.token;
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

        // Conditional on still holding the claim: a holder whose claim was taken over records nothing.
        if (!(await publishClaims.finish(Campaign, campaign._id, token, update))) {
          console.warn(`[Campaign Scheduler] Campaign ${campaign._id} was sent but its claim was lost; the current holder records the result.`);
          continue;
        }
        const updatedCampaign = { ...(campaign.toObject ? campaign.toObject() : campaign), ...update };
        // A repeating campaign keeps going, so its Draft stays scheduled; a one-off is done, so the Draft is posted.
        if (!nextRecurring) {
          try {
            await markLinkedDraftPosted(campaign, campaign.platforms, update.publishedAt);
          } catch (draftError) {
            console.warn(`[Campaign Scheduler] Could not mark draft posted for campaign ${campaign._id}: ${draftError.message}`);
          }
        }
        await learnCampaignPublish(updatedCampaign || campaign, result);
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

        if (!(await publishClaims.finish(Campaign, campaign._id, token, update))) continue;
        const updatedCampaign = { ...(campaign.toObject ? campaign.toObject() : campaign), ...update };
        await learnCampaignPublish(updatedCampaign || campaign, update.publishResult);
        continue;
      }

      await applyPublishFailure(campaign, result.error || result.message || 'Failed to publish', result, token);
    } catch (e) {
      await applyPublishFailure(campaign, e.message || 'Failed to publish', null, token);
    }
  }
}

// Increments the publish failure counter. If we've hit the max attempts OR the
// error is a "platform not linked" error (Ayrshare code 156) — a permanent
// per-post-error that will NEVER succeed on retry — mark the campaign as failed
// so the scheduler stops picking it up. This prevents the retry loops that
// caused our Ayrshare post-error suspension.
async function applyPublishFailure(campaign, errorMessage, result, token = null) {
  const MAX_PUBLISH_ATTEMPTS = Number(process.env.CAMPAIGN_MAX_PUBLISH_ATTEMPTS || 3);
  const nextCount = (Number(campaign.publishFailureCount) || 0) + 1;
  const isTerminalError = /\[156\]|not linked/i.test(String(errorMessage || ''));
  const shouldAutoCancel = nextCount >= MAX_PUBLISH_ATTEMPTS || isTerminalError;

  const update = {
    lastPublishError: errorMessage,
    publishResult: result?.data || result || null,
    ayrshareStatus: 'error',
    publishFailureCount: nextCount
  };
  if (shouldAutoCancel) {
    update.status = 'failed';
    update.publishAutoCancelled = true;
    console.warn(
      `[Campaign Scheduler] Auto-cancelling campaign ${campaign._id} after ` +
      `${nextCount} failure(s)${isTerminalError ? ' (terminal error)' : ''}. Last error: ${String(errorMessage).slice(0, 200)}`
    );
  }
  // With a claim, the failure is written (and the claim cleared, so a retry can claim) only while the claim is held.
  if (token) await publishClaims.fail(Campaign, campaign._id, token, update);
  else await Campaign.findByIdAndUpdate(campaign._id, { $set: update });
}

function startCampaignScheduler({ intervalMs = 30_000, logger = require('../utils/logger') } = {}) {
  if (!isEnabled()) {
    logger.log('🕒 Campaign scheduler disabled (ENABLE_CAMPAIGN_SCHEDULER=false)');
    return () => {};
  }

  logger.log(`🕒 Campaign scheduler started (interval ${intervalMs}ms)`);
  // Publishing is the highest-risk tick (a double run posts twice): it runs through a lease (services/leaseLock.js), so
  // ticks never overlap, in this process or across servers. 10 minutes, renewed while the tick runs.
  const tick = require('./leaseLock').leased('scheduler:campaign-publish', 10 * 60 * 1000, () => processDueCampaigns());
  const timer = setInterval(() => {
    tick().catch((e) => logger.error('Campaign scheduler error:', e));
  }, intervalMs);

  // Run once immediately
  tick().catch((e) => logger.error('Campaign scheduler error:', e));

  return () => clearInterval(timer);
}

module.exports = {
  processDueCampaigns,
  startCampaignScheduler,
  markLinkedDraftPosted,
};
