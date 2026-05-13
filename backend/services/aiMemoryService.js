const crypto = require('crypto');

const AIBrandMemory = require('../models/AIBrandMemory');
const AICampaignHistory = require('../models/AICampaignHistory');
const AIVideoMemory = require('../models/AIVideoMemory');
const AIContentPerformance = require('../models/AIContentPerformance');
const BrandIntelligenceProfile = require('../models/BrandIntelligenceProfile');

function toId(value) {
  if (!value) return null;
  return String(value._id || value.id || value.userId || value);
}

function resolveUserId(userOrId) {
  return toId(userOrId);
}

function resolveOrganizationId(input = {}) {
  const explicit = input.organizationId || input.orgId;
  if (explicit) return String(explicit);
  const user = input.user || {};
  return String(user.organizationId || user.companyId || user.businessProfile?._id || user._id || user.id || input.userId || 'default');
}

function uniqueStrings(values = [], max = 50) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [values])
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    )
  ).slice(0, max);
}

function hashText(text = '') {
  const raw = String(text || '').trim();
  if (!raw) return '';
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function compactObject(value, maxChars = 6000) {
  if (!value) return value;
  try {
    const text = JSON.stringify(value);
    if (text.length <= maxChars) return value;
    return JSON.parse(text.slice(0, maxChars));
  } catch (_) {
    return value;
  }
}

function normalizeProductReference(product = {}) {
  if (!product) return null;
  const rawProductId = product._id || product.id || product.productId || null;
  const productId = /^[0-9a-fA-F]{24}$/.test(String(rawProductId || '')) ? rawProductId : null;
  return {
    productId,
    name: String(product.name || '').trim(),
    category: String(product.category || '').trim(),
    tags: uniqueStrings(product.tags || [])
  };
}

function extractCTAFromText(text = '') {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.find((line) => {
    const normalized = line.toLowerCase();
    return (
      normalized.includes('[link]') ||
      normalized.includes('learn more') ||
      normalized.includes('shop now') ||
      normalized.includes('buy now') ||
      normalized.includes('get started') ||
      normalized.includes('check it out') ||
      normalized.includes('read more')
    );
  }) || '';
}

async function syncBrandMemoryFromProfile({ userId, organizationId, profile = null, businessProfile = {} }) {
  if (!userId) return null;
  const resolvedOrg = organizationId || String(userId);
  const brandProfile = profile || await BrandIntelligenceProfile.findOne({ userId }).lean();
  const effectiveProfile = brandProfile || {};
  const detected = effectiveProfile.detectedProfile || {};
  const custom = effectiveProfile.customProfile || {};
  const assets = effectiveProfile.assets || {};

  const tone = custom.tone || detected.tone || businessProfile.brandVoice || 'professional';
  const writingStyle = custom.writingStyle || detected.writingStyle || '';
  const ctaStyle = custom.ctaStyle || detected.ctaStyle || '';
  const visualStyle = custom.visualStyle || detected.visualStyle || '';
  const pastPosts = Array.isArray(effectiveProfile.pastPosts) ? effectiveProfile.pastPosts : [];
  const pastCaptions = pastPosts.map((post) => post.caption).filter(Boolean).slice(-12);
  const hashtagMatches = pastCaptions.join(' ').match(/#[A-Za-z0-9_]+/g) || [];

  return AIBrandMemory.findOneAndUpdate(
    { organizationId: resolvedOrg, userId },
    {
      $set: {
        brandName: effectiveProfile.brandName || businessProfile.companyName || businessProfile.name || '',
        tone: String(tone || 'professional').toLowerCase(),
        writingStyle,
        audienceStyle: businessProfile.targetAudience || '',
        ctaStyle,
        visualStyle,
        colors: {
          primary: assets.primaryColor || '',
          secondary: assets.secondaryColor || '',
          palette: uniqueStrings([assets.primaryColor, assets.secondaryColor])
        },
        preferredHashtags: uniqueStrings(hashtagMatches, 30),
        rawProfile: compactObject(effectiveProfile),
        reusableMetadata: {
          source: 'brand_intelligence_profile',
          confidence: effectiveProfile.confidence?.overall || 0.2,
          tags: uniqueStrings(['brand-tone', tone, writingStyle, ctaStyle, visualStyle])
        }
      },
      $addToSet: {
        'successfulPatterns.captions': { $each: pastCaptions.slice(-5) },
        'successfulPatterns.hashtags': { $each: uniqueStrings(hashtagMatches, 15) }
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function rememberCampaignGeneration(payload = {}) {
  try {
    const userId = resolveUserId(payload.userId || payload.user);
    if (!userId) return null;
    const organizationId = resolveOrganizationId({ ...payload, userId });
    const generatedPosts = Array.isArray(payload.generatedPosts) ? payload.generatedPosts : [];
    const captions = uniqueStrings([
      ...generatedPosts.map((post) => post.caption),
      ...(payload.generatedCaptions || [])
    ], 100);
    const hashtags = uniqueStrings([
      ...generatedPosts.flatMap((post) => post.hashtags || []),
      ...(payload.hashtags || [])
    ], 100);
    const cta =
      payload.cta ||
      generatedPosts.find((post) => post.callToAction)?.callToAction ||
      captions.map(extractCTAFromText).find(Boolean) ||
      '';
    const imagePrompts = uniqueStrings([
      ...generatedPosts.map((post) => post.imageDescription),
      ...(payload.imagePrompts || [])
    ], 100);
    const generatedImages = uniqueStrings([
      ...generatedPosts.map((post) => post.imageUrl),
      ...(payload.generatedImages || [])
    ], 100);
    const generatedVideos = uniqueStrings([
      ...generatedPosts.map((post) => post.videoUrl),
      ...(payload.generatedVideos || [])
    ], 100);
    const scenes = Array.isArray(payload.scenes)
      ? payload.scenes
      : generatedPosts.map((post, index) => ({
          index,
          platform: post.platform || payload.platform || '',
          caption: post.caption || '',
          imageDescription: post.imageDescription || '',
          imagePrompt: post.imageDescription || '',
          imageText: post.imageText || '',
          contentTheme: post.contentTheme || ''
        }));
    const productRef = normalizeProductReference(payload.product || payload.linkedProduct);

    const doc = await AICampaignHistory.create({
      organizationId,
      userId,
      campaignId: payload.campaignId || null,
      action: payload.action || 'campaign_generation',
      campaignName: payload.campaignName || '',
      objective: payload.objective || '',
      platform: payload.platform || payload.platforms?.[0] || 'instagram',
      platforms: uniqueStrings(payload.platforms || generatedPosts.map((post) => post.platform)),
      tone: payload.tone || '',
      language: payload.language || 'English',
      prompt: payload.prompt || '',
      userInput: compactObject(payload.userInput || {}),
      generatedCaptions: captions,
      generatedCaption: captions[0] || '',
      hashtags,
      cta,
      generatedImages,
      generatedVideos,
      imagePrompts,
      scenes: compactObject(scenes, 12000) || [],
      thumbnails: uniqueStrings(payload.thumbnails || []),
      inventoryReferences: productRef ? [productRef] : [],
      scheduling: compactObject(payload.scheduling || {}),
      aiSettings: compactObject(payload.aiSettings || {}),
      sourceResponse: compactObject(payload.sourceResponse || {}),
      status: payload.status || 'generated',
      reusableMetadata: {
        tags: uniqueStrings(payload.tags || [payload.objective, payload.tone, ...(payload.platforms || [])]),
        promptHash: hashText(payload.prompt || JSON.stringify(payload.userInput || {})),
        embeddingStatus: 'pending',
        vectorNamespace: `org_${organizationId}_campaigns`
      }
    });

    await learnFromGeneration({
      userId,
      organizationId,
      tone: payload.tone,
      hashtags,
      cta,
      product: productRef
    });

    return doc;
  } catch (error) {
    console.warn('[AI Memory] Campaign memory write failed:', error.message);
    return null;
  }
}

async function rememberVideoGeneration(payload = {}) {
  try {
    const userId = resolveUserId(payload.userId || payload.user);
    if (!userId) return null;
    const organizationId = resolveOrganizationId({ ...payload, userId });
    const sceneData = Array.isArray(payload.sceneData) ? payload.sceneData : [];
    const productRef = normalizeProductReference(payload.product || payload.linkedProduct);
    const doc = await AIVideoMemory.create({
      organizationId,
      userId,
      campaignId: payload.campaignId || null,
      jobId: payload.jobId || '',
      action: payload.action || 'reel_generation',
      prompt: payload.prompt || '',
      userInput: compactObject(payload.userInput || {}),
      script: payload.script || '',
      captions: uniqueStrings(payload.captions || []),
      hashtags: uniqueStrings(payload.hashtags || []),
      cta: payload.cta || '',
      scenePrompts: uniqueStrings([
        ...(payload.scenePrompts || []),
        ...sceneData.map((scene) => scene.imagePrompt || scene.videoPrompt || scene.title)
      ], 100),
      sceneData: compactObject(sceneData, 12000) || [],
      audioSettings: compactObject(payload.audioSettings || {}),
      voiceSettings: compactObject(payload.voiceSettings || {}),
      language: payload.language || 'English',
      duration: payload.duration || null,
      generatedVideos: uniqueStrings(payload.generatedVideos || []),
      generatedImages: uniqueStrings(payload.generatedImages || sceneData.map((scene) => scene.imageUrl)),
      thumbnails: uniqueStrings(payload.thumbnails || []),
      inventoryReferences: productRef ? [productRef] : [],
      scheduling: compactObject(payload.scheduling || {}),
      aiSettings: compactObject(payload.aiSettings || {}),
      sourceResponse: compactObject(payload.sourceResponse || {}),
      status: payload.status || 'generated',
      reusableMetadata: {
        tags: uniqueStrings(payload.tags || [payload.action, payload.language]),
        promptHash: hashText(payload.prompt || JSON.stringify(payload.userInput || {})),
        embeddingStatus: 'pending',
        vectorNamespace: `org_${organizationId}_videos`
      }
    });

    await learnFromGeneration({
      userId,
      organizationId,
      tone: payload.tone,
      hashtags: payload.hashtags,
      cta: payload.cta,
      sceneStyles: payload.scenePrompts || sceneData.map((scene) => scene.globalVisualStyle || scene.videoPrompt).filter(Boolean),
      product: productRef
    });

    return doc;
  } catch (error) {
    console.warn('[AI Memory] Video memory write failed:', error.message);
    return null;
  }
}

async function learnFromGeneration({ userId, organizationId, tone, hashtags = [], cta = '', sceneStyles = [], product = null }) {
  if (!userId || !organizationId) return null;
  const update = {
    $addToSet: {
      preferredHashtags: { $each: uniqueStrings(hashtags, 20) },
      'successfulPatterns.hashtags': { $each: uniqueStrings(hashtags, 20) },
      'successfulPatterns.ctas': { $each: uniqueStrings([cta], 10) },
      'successfulPatterns.sceneStyles': { $each: uniqueStrings(sceneStyles, 10) }
    },
    $set: {
      ...(tone ? { tone: String(tone).toLowerCase() } : {})
    }
  };

  if (product?.category) {
    const existing = await AIBrandMemory.findOne({
      organizationId,
      userId,
      'inventoryPatterns.category': product.category
    });
    if (existing) {
      await AIBrandMemory.updateOne(
        { organizationId, userId, 'inventoryPatterns.category': product.category },
        {
          $addToSet: {
            'inventoryPatterns.$.hashtags': { $each: uniqueStrings(hashtags, 12) },
            'inventoryPatterns.$.ctas': { $each: uniqueStrings([cta], 6) },
            'inventoryPatterns.$.examples': { $each: uniqueStrings([product.name], 5) }
          },
          $set: {
            ...(tone ? { 'inventoryPatterns.$.tone': String(tone).toLowerCase() } : {})
          }
        }
      );
    } else {
      update.$addToSet.inventoryPatterns = {
        category: product.category,
        tone: tone || '',
        hashtags: uniqueStrings(hashtags, 12),
        ctas: uniqueStrings([cta], 6),
        examples: uniqueStrings([product.name], 5)
      };
    }
  }

  return AIBrandMemory.findOneAndUpdate(
    { organizationId, userId },
    update,
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

function extractMetric(source = {}, keys = []) {
  for (const key of keys) {
    const value = source?.[key];
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function normalizeAnalyticsMetrics(raw = {}) {
  const flat = raw.analytics || raw.data || raw;
  const firstPlatform = Array.isArray(flat?.posts) ? flat.posts[0] : null;
  const source = firstPlatform || flat;
  const likes = extractMetric(source, ['likes', 'likeCount']);
  const comments = extractMetric(source, ['comments', 'commentCount']);
  const shares = extractMetric(source, ['shares', 'shareCount']);
  const views = extractMetric(source, ['views', 'videoViews', 'viewCount']);
  const clicks = extractMetric(source, ['clicks', 'clickCount']);
  const impressions = extractMetric(source, ['impressions', 'impressionCount']);
  const reach = extractMetric(source, ['reach']);
  const ctr = extractMetric(source, ['ctr']);
  const engagement = extractMetric(source, ['engagement']) || likes + comments + shares + clicks;
  const engagementRate = extractMetric(source, ['engagementRate']) ||
    (impressions > 0 ? Number(((engagement / impressions) * 100).toFixed(2)) : 0);

  return {
    likes,
    views,
    comments,
    shares,
    clicks,
    impressions,
    reach,
    ctr,
    engagement,
    engagementRate,
    conversions: extractMetric(source, ['conversions']),
    spend: extractMetric(source, ['spend', 'cost'])
  };
}

function scorePerformance(metrics = {}) {
  const score =
    (metrics.engagementRate || 0) * 5 +
    (metrics.ctr || 0) * 4 +
    Math.log10((metrics.views || 0) + 1) * 8 +
    Math.log10((metrics.impressions || 0) + 1) * 4 +
    (metrics.shares || 0) * 0.5 +
    (metrics.comments || 0) * 0.35 +
    (metrics.likes || 0) * 0.08;
  return Number(Math.max(0, Math.min(100, score)).toFixed(2));
}

function tierFromScore(score) {
  if (score >= 70) return 'winner';
  if (score >= 45) return 'high';
  if (score >= 20) return 'average';
  return 'low';
}

async function trackPerformance(payload = {}) {
  try {
    const userId = resolveUserId(payload.userId || payload.user);
    if (!userId) return null;
    const organizationId = resolveOrganizationId({ ...payload, userId });
    const metrics = payload.metrics || normalizeAnalyticsMetrics(payload.rawAnalytics || {});
    const score = scorePerformance(metrics);
    const tier = tierFromScore(score);
    const hashtags = uniqueStrings(payload.hashtags || []);
    const winningHashtags = ['high', 'winner'].includes(tier) ? hashtags : [];

    const doc = await AIContentPerformance.findOneAndUpdate(
      {
        organizationId,
        userId,
        postId: payload.postId || '',
        platform: payload.platform || 'instagram'
      },
      {
        $set: {
          campaignId: payload.campaignId || null,
          campaignMemoryId: payload.campaignMemoryId || null,
          videoMemoryId: payload.videoMemoryId || null,
          contentType: payload.contentType || 'post',
          caption: payload.caption || '',
          hashtags,
          cta: payload.cta || '',
          tone: payload.tone || '',
          language: payload.language || 'English',
          inventoryReferences: payload.inventoryReferences || [],
          assets: payload.assets || {},
          metrics,
          learning: {
            score,
            tier,
            winningHashtags,
            winningTone: ['high', 'winner'].includes(tier) ? (payload.tone || '') : '',
            winningCTA: ['high', 'winner'].includes(tier) ? (payload.cta || '') : '',
            winningSceneStyles: ['high', 'winner'].includes(tier) ? uniqueStrings(payload.sceneStyles || []) : [],
            notes: [`Measured ${tier} performance with score ${score}`],
            learnedAt: new Date()
          },
          rawAnalytics: compactObject(payload.rawAnalytics || {}),
          publishedAt: payload.publishedAt || null,
          measuredAt: new Date()
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    if (['high', 'winner'].includes(tier)) {
      await learnFromGeneration({
        userId,
        organizationId,
        tone: payload.tone,
        hashtags,
        cta: payload.cta,
        sceneStyles: payload.sceneStyles,
        product: payload.inventoryReferences?.[0]
      });
    }

    return doc;
  } catch (error) {
    console.warn('[AI Memory] Performance tracking failed:', error.message);
    return null;
  }
}

module.exports = {
  resolveUserId,
  resolveOrganizationId,
  uniqueStrings,
  hashText,
  normalizeProductReference,
  syncBrandMemoryFromProfile,
  rememberCampaignGeneration,
  rememberVideoGeneration,
  trackPerformance,
  normalizeAnalyticsMetrics,
  scorePerformance,
  tierFromScore
};
