/**
 * Automatic tiered performance tracking.
 *
 * Every real publish (backend/routes/drafts.js's /:id/publish, and the
 * legacy publish paths) already stores a Campaign with socialPostId /
 * socialPostIds and publishedAt. Performance used to only get tracked when
 * a user manually opened a specific post's analytics on the legacy
 * Campaigns page — nothing pulled it automatically, so real Gravity usage
 * never fed the learning loop. This walks published campaigns and checks
 * each one at 24h, 3 days, 7 days, 2 weeks, and 1 month after publish, then
 * stops — matching how engagement actually accrues instead of polling
 * forever.
 */

const Campaign = require('../models/Campaign');
const User = require('../models/User');
const { getPostAnalytics } = require('./socialMediaAPI');
const { trackPerformance } = require('./aiMemoryService');

const CHECKPOINTS = [
  { key: '24h', ms: 24 * 60 * 60 * 1000 },
  { key: '3d', ms: 3 * 24 * 60 * 60 * 1000 },
  { key: '7d', ms: 7 * 24 * 60 * 60 * 1000 },
  { key: '2w', ms: 14 * 24 * 60 * 60 * 1000 },
  { key: '1m', ms: 30 * 24 * 60 * 60 * 1000 }
];

// Bounds Ayrshare API calls per run regardless of how many posts have
// accumulated — a backlog is worked off over several runs, not one spike.
const MAX_CHECKS_PER_RUN = 25;

/** Which checkpoint (if any) is due for this campaign right now. */
function dueCheckpoint(campaign, now = new Date()) {
  if (!campaign.publishedAt) return null;
  const elapsed = now.getTime() - new Date(campaign.publishedAt).getTime();
  const done = new Set((campaign.performanceChecks || []).map((c) => c.checkpoint));
  for (const cp of CHECKPOINTS) {
    if (done.has(cp.key)) continue;
    if (elapsed >= cp.ms) return cp.key;
    break; // checkpoints are in ascending order — none later can be due either
  }
  return null;
}

/** postId + platform pairs to check for a campaign, from whichever of
 * socialPostId/socialPostIds/facebookPostId/instagramPostId is populated. */
function postTargets(campaign) {
  const targets = [];
  if (campaign.socialPostIds && typeof campaign.socialPostIds === 'object') {
    for (const [platform, postId] of Object.entries(campaign.socialPostIds)) {
      if (postId) targets.push({ platform, postId: String(postId) });
    }
  }
  if (!targets.length && campaign.socialPostId) {
    targets.push({ platform: (campaign.platforms || [])[0] || 'instagram', postId: campaign.socialPostId });
  }
  return targets;
}

async function runPerformanceTrackerOnce({ now = new Date(), limit = MAX_CHECKS_PER_RUN } = {}) {
  // Only campaigns that are actually published and haven't exhausted every
  // checkpoint yet are candidates — cheap enough to filter the rest in
  // JS after a narrow Mongo query rather than encoding the checkpoint math
  // itself into the query.
  const candidates = await Campaign.find({
    status: 'posted',
    publishedAt: { $ne: null, $lte: new Date(now.getTime() - CHECKPOINTS[0].ms) },
    $expr: { $lt: [{ $size: { $ifNull: ['$performanceChecks', []] } }, CHECKPOINTS.length] }
  }).limit(limit * 3).lean(); // headroom: not every candidate has a checkpoint due right now

  let checked = 0;
  for (const campaign of candidates) {
    if (checked >= limit) break;
    const checkpoint = dueCheckpoint(campaign, now);
    if (!checkpoint) continue;

    const targets = postTargets(campaign);
    if (!targets.length) continue;

    const user = await User.findById(campaign.userId).select('ayrshare businessProfile').lean();
    const profileKey = user?.ayrshare?.profileKey;
    if (!profileKey) continue; // no connected socials — nothing to check

    for (const { platform, postId } of targets) {
      if (checked >= limit) break;
      try {
        const result = await getPostAnalytics(postId, [platform], profileKey);
        if (result.success) {
          await trackPerformance({
            userId: campaign.userId,
            campaignId: campaign._id,
            postId,
            platform,
            contentType: campaign.creative?.type || 'post',
            caption: campaign.creative?.captions || '',
            hashtags: campaign.creative?.hashtags || [],
            cta: campaign.creative?.callToAction || '',
            tone: campaign.tone || '',
            rawAnalytics: result.data,
            publishedAt: campaign.publishedAt
          });
        } else {
          console.warn(`[PerformanceTracker] getPostAnalytics failed for campaign ${campaign._id} (${platform}):`, result.error);
        }
      } catch (err) {
        console.warn(`[PerformanceTracker] Check failed for campaign ${campaign._id} (${platform}):`, err.message);
      }
      checked += 1;
    }

    // Record the checkpoint as done regardless of whether the Ayrshare call
    // succeeded — a transient API failure shouldn't cause this exact window
    // to be retried forever; the next checkpoint will still fire on schedule.
    await Campaign.updateOne(
      { _id: campaign._id },
      { $push: { performanceChecks: { checkpoint, checkedAt: now } } }
    );
  }

  return { checked, candidateCount: candidates.length };
}

function startPerformanceTrackerScheduler({ intervalMs = 60 * 60 * 1000, logger = console } = {}) {
  if (String(process.env.ENABLE_PERFORMANCE_TRACKER || 'true').toLowerCase() === 'false') {
    logger.log('[PerformanceTracker] Scheduler disabled via ENABLE_PERFORMANCE_TRACKER=false');
    return () => {};
  }
  logger.log(`[PerformanceTracker] Scheduler started (interval ${intervalMs}ms)`);
  const timer = setInterval(() => {
    runPerformanceTrackerOnce().catch((err) => logger.error('[PerformanceTracker] Scheduler error:', err));
  }, intervalMs);
  runPerformanceTrackerOnce().catch((err) => logger.error('[PerformanceTracker] Scheduler error:', err));
  return () => clearInterval(timer);
}

module.exports = {
  runPerformanceTrackerOnce,
  startPerformanceTrackerScheduler,
  CHECKPOINTS,
  dueCheckpoint,
  postTargets
};
