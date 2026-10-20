'use strict';
const publishClaims = require('./publishClaim');
/**
 * Status sync for posts scheduled ON Ayrshare (load-test week 1). These checks used to run inside GET /api/campaigns,
 * one live Ayrshare call per past-due post, every time the list was opened. They now run here, in the background:
 *
 *  - Which rows: status 'scheduled', a `scheduledFor` time that has passed and an Ayrshare post id (`socialPostId`),
 *    i.e. posts handed to Ayrshare with its own scheduling. Rows the campaign scheduler posts itself (it publishes
 *    'scheduled' rows at `scheduling.startDate` and marks them posted) never get here without an Ayrshare id.
 *  - What it does with each: exactly what the list route did (moved, not rewritten): Ayrshare says posted -> the
 *    campaign is 'posted' and, as the scheduler does (handover 20), its linked Draft becomes 'published'; Ayrshare says
 *    error -> one bounded Instagram retry, else back to 'draft' (or kept 'scheduled' for a transient Instagram error);
 *    still pending -> left alone. A failed check changes nothing.
 *  - One server at a time: an OpsState lease (key campaign_status_sync_lease), like the bin purge and the Home drafts
 *    sweep. A bounded batch per run (CAMPAIGN_STATUS_SYNC_BATCH, default 25), least recently checked first
 *    (`ayrshareCheckedAt`), every 5 minutes. Paused accounts are skipped; an account without its own social profile is
 *    never checked against the master profile.
 *  - Off with ENABLE_CAMPAIGN_STATUS_SYNC=off.
 */
const EVERY_MS = 5 * 60 * 1000;
const FIRST_RUN_MS = 2 * 60 * 1000;
const LEASE_MS = 10 * 60 * 1000;
const DEFAULT_BATCH = 25;

function realDeps() {
  const social = require('./socialMediaAPI');
  return {
    Campaign: require('../models/Campaign'),
    getPostStatus: social.getPostStatus,
    retryAyrsharePost: social.retryPost,
    publishCampaignToSocial: (c) => require('./campaignPublisher').publishCampaignToSocial(c),
    classifyInstagramPublishFailure: (...a) => require('./instagram-fix').classifyInstagramPublishFailure(...a),
    extractFacebookPostIdFromAyrsharePayload: (...a) => require('../routes/campaigns').extractFacebookPostIdFromAyrsharePayload(...a),
    markLinkedDraftPosted: (...a) => require('./campaignScheduler').markLinkedDraftPosted(...a)
  };
}

/** Check one past-due campaign with Ayrshare and apply the answer (the logic GET /api/campaigns used to run). */
// A re-post needs the whole campaign; only the stored provider answers are left out (they held whole pictures: D104).
// publishResult.retryCount and publishResult.retryRequestedAt stay (read below).
const SYNC_PROJECTION = '-lastPublishError -publishResult.error -publishResult.instagramFix -publishResult.initial -publishResult.verified -publishResult.retry -publishResult.data -publishResult.rawError';

async function syncPastDueCampaign(campaign, { profileKey, now = new Date(), deps = {} } = {}) {
  const {
    Campaign, getPostStatus, retryAyrsharePost, publishCampaignToSocial,
    classifyInstagramPublishFailure, extractFacebookPostIdFromAyrsharePayload, markLinkedDraftPosted
  } = { ...realDeps(), ...deps };
  // Every write is conditional on the row still being the same scheduled Ayrshare post: the campaign scheduler or the
  // person may have changed it while Ayrshare was being asked, and their write wins.
  const stillSame = { _id: campaign._id, status: 'scheduled', socialPostId: campaign.socialPostId };
  const setIfStill = async (set) => {
    const r = await Campaign.updateOne(stillSame, { $set: set });
    return Number(r && (r.modifiedCount !== undefined ? r.modifiedCount : r.nModified)) > 0;
  };
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
      
      console.log(` Campaign ${campaign._id} Ayrshare status: ${ayrshareStatus}`);
      
      if (resolvedFbIdFromStatus && campaign.facebookPostId !== resolvedFbIdFromStatus) {
        const existingSocialPostIds = campaign?.socialPostIds && typeof campaign.socialPostIds === 'object'
          ? campaign.socialPostIds
          : {};
        const nextSocialPostIds = {
          ...existingSocialPostIds,
          facebook: resolvedFbIdFromStatus
        };

        await setIfStill({
          facebookPostId: resolvedFbIdFromStatus,
          socialPostIds: nextSocialPostIds
        });

        campaign.facebookPostId = resolvedFbIdFromStatus;
        campaign.socialPostIds = nextSocialPostIds;
      }

      if (ayrshareStatus === 'success' || ayrshareStatus === 'posted') {
        // Ayrshare confirmed it was actually posted!
        if (!(await setIfStill({ status: 'posted', publishedAt: now, ayrshareStatus: 'success', lastPublishError: null }))) {
          return 'changed';
        }
        campaign.status = 'posted';
        campaign.publishedAt = now;
        // The Draft rule of the scheduler (handover 20): a one-off post that went out makes its Draft 'published'.
        try { await markLinkedDraftPosted(campaign, campaign.platforms, now); } catch (draftError) {
          console.warn(`- Could not mark draft posted for campaign ${campaign._id}: ${draftError.message}`);
        }
        console.log(`- Confirmed posted: ${campaign.name}`);
        return 'posted';
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
              // The one place the sync sends a post: it takes the same per-campaign claim as the scheduler and
              // "Post now" (services/publishClaim.js), so a rebuild cannot collide with either.
              const claimed = await publishClaims.claim(Campaign, campaign._id, {
                statuses: ['scheduled'], extraFilter: { socialPostId: campaign.socialPostId }, now, by: 'sync'
              });
              if (!claimed.claimed) return 'changed';
              let freshRetryRes;
              try {
                freshRetryRes = await publishCampaignToSocial(campaign);
              } catch (sendError) {
                await publishClaims.release(Campaign, campaign._id, claimed.token);
                throw sendError;
              }
              const pendingId = freshRetryRes?.postId || campaign.socialPostId;
              if (!freshRetryRes?.success) await publishClaims.release(Campaign, campaign._id, claimed.token);
              if (freshRetryRes?.success) {
                const nextRetryCount = retryCount + 1;
                if (!(await publishClaims.finish(Campaign, campaign._id, claimed.token, {
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
                }, { status: 'scheduled' }))) return 'changed';

                campaign.status = 'posted';
                campaign.publishedAt = now;
                campaign.socialPostId = pendingId;
                campaign.ayrshareStatus = 'success';
                campaign.lastPublishError = null;
                console.log(` Rebuilt and published Instagram video payload for ${campaign.name} (${pendingId})`);
                return 'posted';
              }
            }

            const retryRes = await retryAyrsharePost(campaign.socialPostId, { profileKey });
            const pendingId = retryRes?.data?.id || campaign.socialPostId;
            if (retryRes?.success) {
              const nextRetryCount = retryCount + 1;
              const delayMinutes = Math.min(60, 5 * Math.pow(2, Math.max(0, nextRetryCount - 1))); // 5, 10, 20...
              const nextAttemptAt = new Date(now.getTime() + delayMinutes * 60 * 1000);
              if (!(await setIfStill({
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
              }))) return 'changed';

              campaign.status = 'scheduled';
              campaign.scheduledFor = nextAttemptAt;
              campaign.socialPostId = pendingId;
              campaign.ayrshareStatus = 'pending';
              campaign.lastPublishError = null;
              console.log(` Retried failed Instagram post for ${campaign.name} - pending (${pendingId}) (attempt ${nextRetryCount}/${maxRetries}, next check in ~${delayMinutes}m)`);
              return 'retried';
            }
          } catch (retryError) {
            console.warn(`- Retry failed for campaign ${campaign._id}:`, retryError?.message || retryError);
          }
        }

        // If it's transient/ retryable, do NOT revert to draft. Keep scheduled so user can retry later.
        if (canRetry && isInstagramOnly) {
          if (!(await setIfStill({ status: 'scheduled', ayrshareStatus: 'error', lastPublishError: failureMessage }))) return 'changed';
          campaign.status = 'scheduled';
          campaign.lastPublishError = failureMessage;
          console.log(`- Instagram transient error persists; keeping scheduled: ${campaign.name}`);
          return 'kept';
        } else {
          if (!(await setIfStill({ status: 'draft', ayrshareStatus: 'error', lastPublishError: failureMessage }))) return 'changed';
          campaign.status = 'draft';
          campaign.lastPublishError = failureMessage;
          console.log(`- Ayrshare post failed: ${campaign.name}`);
          return 'draft';
        }
      } else {
        // Still scheduled/pending on Ayrshare side - don't change status
        console.log(`- Still pending on Ayrshare: ${campaign.name} (status: ${ayrshareStatus})`);
        return 'pending';
      }
    }
    return 'unknown';
  } catch (verifyError) {
    console.warn(`- Could not verify campaign ${campaign._id}:`, verifyError.message);
    // Don't change status if we can't verify
    return 'error';
  }
}

async function runCampaignStatusSyncOnce({
  deps = {},
  User = require('../models/User'),
  lease = require('./competitors/lease').createLease({ key: 'campaign_status_sync_lease', ttlMs: LEASE_MS }),
  blockedIds = () => require('./backgroundGate').blockedAccountIdsSafe(),
  requireOwnProfileKey = require('./ayrshareGuard').requireOwnProfileKey,
  now = () => new Date(),
  batch = Number(process.env.CAMPAIGN_STATUS_SYNC_BATCH) || DEFAULT_BATCH,
  log = console
} = {}) {
  const at = now();
  const token = await lease.claim(at);
  if (!token) return { skippedRun: true, checked: 0, skippedNoProfile: 0 };
  const out = { checked: 0, skippedNoProfile: 0, errors: 0 };
  try {
    const Campaign = deps.Campaign || realDeps().Campaign;
    const paused = await blockedIds();
    const due = await Campaign.find({
      status: 'scheduled',
      scheduledFor: { $lt: at },
      socialPostId: { $nin: [null, ''] },
      ...(paused && paused.length ? { userId: { $nin: paused } } : {})
    }).select(SYNC_PROJECTION).sort({ ayrshareCheckedAt: 1, scheduledFor: 1 }).limit(Math.max(1, Math.min(200, batch)));

    const keys = new Map();
    for (const campaign of due || []) {
      const uid = String(campaign.userId);
      if (!keys.has(uid)) {
        const user = await User.findById(campaign.userId).select('ayrshare.profileKey plan subscription isActive');
        let profileKey;
        try { profileKey = requireOwnProfileKey(user) || undefined; } catch (_) { profileKey = null; }
        keys.set(uid, user ? profileKey : null);
      }
      const profileKey = keys.get(uid);
      // Checked now, whatever the answer, so the next run looks at other rows first.
      await Campaign.updateOne({ _id: campaign._id }, { $set: { ayrshareCheckedAt: at } }).catch(() => {});
      // An account with no profile of its own must never query the master profile.
      if (profileKey === null) { out.skippedNoProfile += 1; continue; }
      out.checked += 1;
      try {
        await syncPastDueCampaign(campaign, { profileKey, now: at, deps });
      } catch (e) {
        out.errors += 1;
      }
    }
    return out;
  } finally {
    await lease.release(token);
    if (out.checked || out.errors) log.log(`[campaign status sync] checked ${out.checked}, no profile ${out.skippedNoProfile}, errors ${out.errors}`);
  }
}

/** Two minutes after start, then every 5 minutes. Off with ENABLE_CAMPAIGN_STATUS_SYNC=off. Never throws. */
function startCampaignStatusSync({ env = process.env, run = runCampaignStatusSyncOnce, logger = console } = {}) {
  if (String(env.ENABLE_CAMPAIGN_STATUS_SYNC || '').trim().toLowerCase() === 'off') return null;
  const tick = () => Promise.resolve().then(() => run()).catch((e) => logger.warn('[campaign status sync] run failed:', e && e.message));
  setTimeout(tick, FIRST_RUN_MS).unref();
  return setInterval(tick, EVERY_MS).unref();
}

module.exports = { syncPastDueCampaign, runCampaignStatusSyncOnce, startCampaignStatusSync };
