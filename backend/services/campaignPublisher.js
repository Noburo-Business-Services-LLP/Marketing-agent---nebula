const { postToSocialMedia } = require('./socialMediaAPI');

function normalizeHashtag(tag) {
  const t = String(tag || '').trim();
  if (!t) return null;
  return t.startsWith('#') ? t : `#${t}`;
}

function extractHashtagsFromText(text) {
  return String(text || '')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.startsWith('#'));
}

function getCampaignPostContent(campaign) {
  return (
    campaign?.creative?.textContent ||
    campaign?.creative?.captions ||
    campaign?.name ||
    'New post'
  );
}

function getCampaignHashtags(campaign) {
  const explicit = campaign?.creative?.hashtags;
  if (Array.isArray(explicit) && explicit.length > 0) {
    return explicit.map(normalizeHashtag).filter(Boolean);
  }

  return extractHashtagsFromText(campaign?.creative?.captions).map(normalizeHashtag).filter(Boolean);
}

function getCampaignMediaUrls(campaign) {
  if (Array.isArray(campaign?.creative?.imageUrls) && campaign.creative.imageUrls.length > 0) {
    return campaign.creative.imageUrls;
  }
  if (campaign?.creative?.videoUrl) return [campaign.creative.videoUrl];
  return undefined;
}

function buildCampaignPostPayload(campaign) {
  const platforms = Array.isArray(campaign?.platforms) && campaign.platforms.length > 0
    ? campaign.platforms
    : ['instagram'];

  const postContent = getCampaignPostContent(campaign);
  const hashtags = getCampaignHashtags(campaign);
  const mediaUrls = getCampaignMediaUrls(campaign);

  const fullPost = hashtags.length > 0
    ? `${postContent}\n\n${hashtags.join(' ')}`
    : postContent;

  return { platforms, fullPost, mediaUrls };
}

async function publishCampaignToSocial(campaign) {
  const { platforms, fullPost, mediaUrls } = buildCampaignPostPayload(campaign);
  const result = await postToSocialMedia(platforms, fullPost, {
    mediaUrls,
    shortenLinks: true,
  });

  const postId = result?.data?.id || result?.data?.postIds?.[0] || result?.data?.postId || null;
  return { ...result, postId };
}

module.exports = {
  buildCampaignPostPayload,
  publishCampaignToSocial,
};

