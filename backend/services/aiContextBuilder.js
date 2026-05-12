const AIBrandMemory = require('../models/AIBrandMemory');
const AICampaignHistory = require('../models/AICampaignHistory');
const AIVideoMemory = require('../models/AIVideoMemory');
const AIContentPerformance = require('../models/AIContentPerformance');
const BrandIntelligenceProfile = require('../models/BrandIntelligenceProfile');
const { resolveOrganizationId, uniqueStrings, syncBrandMemoryFromProfile } = require('./aiMemoryService');

function topCounts(items = [], max = 12) {
  const counts = new Map();
  items.flat().filter(Boolean).forEach((item) => {
    const key = String(item).trim();
    if (!key) return;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([value, count]) => ({ value, count }));
}

function productCategoryFrom(input = {}) {
  return String(input.product?.category || input.linkedProduct?.category || input.category || '').trim();
}

async function buildAIContext({ userId, user = null, organizationId = null, platform = '', product = null, category = '', limit = 12 } = {}) {
  if (!userId) {
    return {
      brandMemory: null,
      reusablePromptText: '',
      bestHashtags: [],
      bestCaptions: [],
      bestCTAs: [],
      bestSceneStyles: [],
      inventoryMemory: null
    };
  }

  const orgId = organizationId || resolveOrganizationId({ user, userId });
  const brandProfile = await BrandIntelligenceProfile.findOne({ userId }).lean();
  const businessProfile = user?.businessProfile || {};
  const brandMemory = await syncBrandMemoryFromProfile({
    userId,
    organizationId: orgId,
    profile: brandProfile,
    businessProfile
  }) || await AIBrandMemory.findOne({ organizationId: orgId, userId }).lean();

  const categoryName = String(category || productCategoryFrom({ product })).trim();
  const platformFilter = platform ? { $or: [{ platform }, { platforms: platform }] } : {};

  const [campaigns, videos, winners] = await Promise.all([
    AICampaignHistory.find({ organizationId: orgId, userId, ...platformFilter })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean(),
    AIVideoMemory.find({ organizationId: orgId, userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean(),
    AIContentPerformance.find({
      organizationId: orgId,
      userId,
      ...(platform ? { platform } : {}),
      'learning.tier': { $in: ['high', 'winner'] }
    })
      .sort({ 'learning.score': -1, measuredAt: -1 })
      .limit(limit)
      .lean()
  ]);

  const inventoryMemory = categoryName
    ? (brandMemory?.inventoryPatterns || []).find((item) => String(item.category).toLowerCase() === categoryName.toLowerCase())
    : null;

  const bestHashtags = uniqueStrings([
    ...(inventoryMemory?.hashtags || []),
    ...(brandMemory?.preferredHashtags || []),
    ...winners.flatMap((item) => item.learning?.winningHashtags || item.hashtags || []),
    ...campaigns.flatMap((item) => item.hashtags || [])
  ], 20);

  const bestCTAs = uniqueStrings([
    ...(inventoryMemory?.ctas || []),
    ...(brandMemory?.successfulPatterns?.ctas || []),
    ...winners.map((item) => item.learning?.winningCTA || item.cta),
    ...campaigns.map((item) => item.cta)
  ], 12);

  const bestCaptions = uniqueStrings([
    ...(brandMemory?.successfulPatterns?.captions || []),
    ...winners.map((item) => item.caption),
    ...campaigns.flatMap((item) => item.generatedCaptions || [])
  ], 10);

  const bestSceneStyles = uniqueStrings([
    ...(inventoryMemory?.visualStyle ? [inventoryMemory.visualStyle] : []),
    ...(brandMemory?.successfulPatterns?.sceneStyles || []),
    ...winners.flatMap((item) => item.learning?.winningSceneStyles || []),
    ...videos.flatMap((item) => item.scenePrompts || [])
  ], 12);

  const hashtagCounts = topCounts([
    bestHashtags,
    ...winners.map((item) => item.hashtags || []),
    ...campaigns.map((item) => item.hashtags || [])
  ], 12);

  const context = {
    organizationId: orgId,
    brandMemory,
    brandTone: inventoryMemory?.tone || brandMemory?.tone || brandProfile?.customProfile?.tone || brandProfile?.detectedProfile?.tone || 'professional',
    writingStyle: brandMemory?.writingStyle || brandProfile?.customProfile?.writingStyle || brandProfile?.detectedProfile?.writingStyle || '',
    ctaStyle: brandMemory?.ctaStyle || brandProfile?.customProfile?.ctaStyle || brandProfile?.detectedProfile?.ctaStyle || '',
    visualStyle: inventoryMemory?.visualStyle || brandMemory?.visualStyle || brandProfile?.customProfile?.visualStyle || brandProfile?.detectedProfile?.visualStyle || '',
    colors: brandMemory?.colors || {},
    bestHashtags,
    hashtagCounts,
    bestCaptions,
    bestCTAs,
    bestSceneStyles,
    recentCampaigns: campaigns,
    highPerformingVideos: videos.filter((item) => item.status !== 'failed').slice(0, 6),
    performanceWinners: winners,
    inventoryMemory,
    embeddingReady: {
      namespace: `org_${orgId}`,
      futureProviders: ['pinecone', 'chromadb', 'weaviate'],
      status: 'metadata_ready'
    }
  };

  context.reusablePromptText = [
    'AI MEMORY CONTEXT:',
    `- Brand tone to maintain: ${context.brandTone}`,
    context.writingStyle ? `- Preferred writing style: ${context.writingStyle}` : '',
    context.ctaStyle ? `- Preferred CTA style: ${context.ctaStyle}` : '',
    context.visualStyle ? `- Preferred visual/scene style: ${context.visualStyle}` : '',
    bestHashtags.length ? `- Reuse proven hashtags when relevant: ${bestHashtags.slice(0, 12).join(', ')}` : '',
    bestCTAs.length ? `- Reuse successful CTA patterns when relevant: ${bestCTAs.slice(0, 6).join(' | ')}` : '',
    bestCaptions.length ? `- Successful caption structures to mimic, not copy: ${bestCaptions.slice(0, 3).join(' || ')}` : '',
    bestSceneStyles.length ? `- Successful scene/image styles: ${bestSceneStyles.slice(0, 5).join(' | ')}` : '',
    inventoryMemory ? `- Inventory category memory for ${categoryName}: tone=${inventoryMemory.tone || context.brandTone}; hashtags=${(inventoryMemory.hashtags || []).slice(0, 8).join(', ')}` : '',
    '- Use memory as guidance. Do not duplicate old captions verbatim.'
  ].filter(Boolean).join('\n');

  return context;
}

module.exports = {
  buildAIContext
};
