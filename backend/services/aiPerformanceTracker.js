const Campaign = require('../models/Campaign');
const { trackPerformance } = require('./aiMemoryService');

async function trackCampaignPerformanceFromAnalytics({
  userId,
  organizationId,
  postId,
  platform = 'instagram',
  analytics = {}
}) {
  const campaign = postId
    ? await Campaign.findOne({
        userId,
        $or: [
          { socialPostId: postId },
          { facebookPostId: postId },
          { instagramPostId: postId },
          { [`socialPostIds.${platform}`]: postId }
        ]
      }).lean()
    : null;

  return trackPerformance({
    userId,
    organizationId,
    campaignId: campaign?._id || null,
    postId,
    platform,
    rawAnalytics: analytics,
    contentType: campaign?.creative?.type || 'post',
    caption: campaign?.creative?.captions || campaign?.creative?.textContent || '',
    hashtags: campaign?.creative?.hashtags || [],
    cta: campaign?.creative?.callToAction || '',
    tone: campaign?.tone || '',
    assets: {
      images: campaign?.creative?.imageUrls || [],
      videos: campaign?.creative?.videoUrl ? [campaign.creative.videoUrl] : [],
      thumbnails: campaign?.creative?.imageUrls?.slice(0, 1) || []
    },
    publishedAt: campaign?.publishedAt || null
  });
}

module.exports = {
  trackCampaignPerformanceFromAnalytics
};
