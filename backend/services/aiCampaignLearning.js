const { rememberCampaignGeneration, trackPerformance } = require('./aiMemoryService');

async function learnCampaignGeneration(payload = {}) {
  return rememberCampaignGeneration({
    ...payload,
    action: payload.action || 'campaign_generation'
  });
}

async function learnCaptionGeneration(payload = {}) {
  return rememberCampaignGeneration({
    ...payload,
    action: 'caption_generation',
    generatedCaptions: payload.caption ? [payload.caption] : payload.generatedCaptions,
    hashtags: payload.hashtags || []
  });
}

async function learnCampaignPublish(campaign, publishResult = {}) {
  if (!campaign) return null;
  return rememberCampaignGeneration({
    userId: campaign.userId,
    campaignId: campaign._id,
    action: 'publish',
    campaignName: campaign.name,
    objective: campaign.objective,
    platforms: campaign.platforms || [],
    tone: campaign.tone || '',
    generatedCaptions: [campaign.creative?.captions || campaign.creative?.textContent || ''].filter(Boolean),
    hashtags: campaign.creative?.hashtags || [],
    cta: campaign.creative?.callToAction || '',
    generatedImages: campaign.creative?.imageUrls || [],
    generatedVideos: campaign.creative?.videoUrl ? [campaign.creative.videoUrl] : [],
    scheduling: campaign.scheduling || {},
    sourceResponse: publishResult,
    status: campaign.status === 'scheduled' ? 'scheduled' : 'published'
  });
}

async function learnCampaignPerformance(payload = {}) {
  return trackPerformance(payload);
}

module.exports = {
  learnCampaignGeneration,
  learnCaptionGeneration,
  learnCampaignPublish,
  learnCampaignPerformance
};
