const mongoose = require('mongoose');
const SeoReport = require('../models/SeoReport');
const { generateWithLLM } = require('./llmRouter');

const clampScore = (value, fallback = 70) => {
  const score = Number(value);
  if (!Number.isFinite(score)) return fallback;
  return Math.max(0, Math.min(100, Math.round(score)));
};

const normalizeArray = (value, fallback = []) => {
  if (!Array.isArray(value)) return fallback;
  return value.map(item => String(item || '').trim()).filter(Boolean);
};

const getProvider = () => 'gemini';

const canPersistForUser = (userId) => mongoose.Types.ObjectId.isValid(String(userId || ''));

async function saveReport(userId, reportType, query, inputs, output, scores, recommendations) {
  if (!canPersistForUser(userId)) {
    return null;
  }

  return SeoReport.create({
    userId,
    reportType,
    query,
    inputs,
    output,
    scores,
    recommendations: normalizeArray(recommendations),
    provider: getProvider()
  });
}

function buildBusinessContext(businessContext = {}) {
  return {
    businessName: businessContext.businessName || businessContext.name || '',
    industry: businessContext.industry || '',
    description: businessContext.description || businessContext.niche || '',
    targetAudience: businessContext.targetAudience || '',
    location: businessContext.location || businessContext.businessLocation || '',
    website: businessContext.website || ''
  };
}

function fallbackKeywords(topic, businessContext = {}) {
  const base = String(topic || businessContext.businessName || 'business growth').trim();
  const compact = base.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
  const words = compact.split(' ').filter(Boolean);
  const niche = businessContext.industry || 'marketing';
  return {
    primaryKeywords: [base, `${base} services`, `${base} solutions`],
    relatedKeywords: [`${niche} strategy`, `${base} marketing`, `${base} online`, `${base} growth`, `${base} brand`],
    longTailKeywords: [
      `best ${compact || 'business'} solutions for customers`,
      `how to choose ${compact || 'business'} services`,
      `${compact || 'business'} ideas for small business`
    ],
    searchIntent: words.length > 2 ? 'Commercial investigation' : 'Informational and commercial',
    keywordDifficulty: 52,
    scores: { seo: 72, content: 70, hashtag: 64, competitor: 58 },
    recommendations: [
      'Use the primary keyword in the title, first paragraph, and one subheading.',
      'Create one landing page for high-intent long-tail terms.',
      'Group related keywords by customer intent before publishing.'
    ]
  };
}

function fallbackMetadata(input = {}) {
  const topic = String(input.topic || input.businessName || 'growth campaign').trim();
  const slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'seo-page';
  return {
    seoTitle: `${topic} | Practical Growth Solutions`,
    metaDescription: `Discover ${topic} strategies designed to improve visibility, engagement, and qualified customer action.`,
    focusKeyword: topic,
    urlSlugSuggestions: [slug, `${slug}-guide`, `${slug}-solutions`],
    scores: { seo: 76, content: 72, hashtag: 60, competitor: 55 },
    recommendations: [
      'Keep the SEO title close to 50 to 60 characters where possible.',
      'Place the focus keyword near the beginning of the meta description.',
      'Use a short URL slug with readable words.'
    ]
  };
}

function fallbackHashtags(content = '', platforms = []) {
  const seed = String(content || 'business growth').toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  const terms = seed.split(/\s+/).filter(word => word.length > 3).slice(0, 6);
  const baseTags = terms.length ? terms.map(word => `#${word}`) : ['#growth', '#marketing', '#business'];
  const selected = platforms.length ? platforms : ['facebook', 'instagram', 'linkedin', 'x', 'youtube'];
  const platformHashtags = {};
  selected.forEach(platform => {
    platformHashtags[platform] = Array.from(new Set([...baseTags, '#brandgrowth', '#digitalmarketing'])).slice(0, 8);
  });
  return {
    platformHashtags,
    trending: ['#aitools', '#growthmarketing', '#contentstrategy'],
    relevant: baseTags,
    scores: { seo: 65, content: 70, hashtag: 82, competitor: 55 },
    recommendations: [
      'Mix broad discovery tags with niche tags that match the offer.',
      'Use fewer, more specific hashtags on LinkedIn and X.',
      'Refresh trend tags before each campaign push.'
    ]
  };
}

function fallbackCompetitor(url = '') {
  const domain = String(url || '').replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] || 'competitor website';
  return {
    competitorKeywords: [`${domain} products`, `${domain} pricing`, `${domain} reviews`, `${domain} alternatives`],
    contentStrategy: 'Likely uses category pages, comparison content, social proof, and conversion-focused landing pages.',
    postingFrequency: '2 to 4 posts per week recommended benchmark',
    seoOpportunities: [
      'Create comparison pages against competitor alternatives.',
      'Publish long-tail educational content for underserved queries.',
      'Strengthen landing page metadata and internal links.'
    ],
    contentRecommendations: [
      'Build a buying-guide article around customer pain points.',
      'Create social posts that answer objections before purchase.',
      'Use case studies to differentiate on trust and outcomes.'
    ],
    scores: { seo: 70, content: 74, hashtag: 58, competitor: 78 },
    recommendations: [
      'Target lower-difficulty long-tail keywords where competitors are broad.',
      'Clarify your unique positioning above the fold.',
      'Turn competitor gaps into campaign angles.'
    ]
  };
}

async function generateKeywordResearch({ userId, topic, businessContext }) {
  const context = buildBusinessContext(businessContext);
  const prompt = `Generate SEO keyword research for this business/topic.

Business context: ${JSON.stringify(context)}
Topic: ${topic}

Return practical keywords for website pages, campaigns, blogs, and social content.`;

  const schema = {
    required: ['primaryKeywords', 'relatedKeywords', 'longTailKeywords', 'searchIntent', 'keywordDifficulty', 'scores', 'recommendations'],
    properties: {
      primaryKeywords: { type: 'array' },
      relatedKeywords: { type: 'array' },
      longTailKeywords: { type: 'array' },
      searchIntent: { type: 'string' },
      keywordDifficulty: { type: 'number' },
      scores: { type: 'object' },
      recommendations: { type: 'array' }
    }
  };

  let result;
  try {
    result = await generateWithLLM({ provider: getProvider(), taskType: 'seo_keyword_research', prompt, jsonSchema: schema, temperature: 0.55, maxTokens: 2500 });
  } catch (error) {
    console.warn('SEO keyword generation fallback:', error.message);
    result = fallbackKeywords(topic, context);
  }

  result.primaryKeywords = normalizeArray(result.primaryKeywords);
  result.relatedKeywords = normalizeArray(result.relatedKeywords);
  result.longTailKeywords = normalizeArray(result.longTailKeywords);
  result.keywordDifficulty = clampScore(result.keywordDifficulty, 52);
  result.scores = normalizeScores(result.scores);
  result.recommendations = normalizeArray(result.recommendations, fallbackKeywords(topic, context).recommendations);

  const report = await saveReport(userId, 'keyword_research', topic, { topic, businessContext: context }, result, result.scores, result.recommendations);
  return { report, result };
}

async function generateMetadata({ userId, topic, businessName, pageType, focusKeyword, businessContext }) {
  const context = buildBusinessContext(businessContext);
  const prompt = `Generate conversion-aware SEO metadata.

Business context: ${JSON.stringify(context)}
Business name: ${businessName || context.businessName}
Topic/Page: ${topic}
Page type: ${pageType || 'landing page'}
Preferred focus keyword: ${focusKeyword || 'choose best keyword'}

Return metadata usable for websites, blogs, and landing pages.`;

  const schema = {
    required: ['seoTitle', 'metaDescription', 'focusKeyword', 'urlSlugSuggestions', 'scores', 'recommendations'],
    properties: {
      seoTitle: { type: 'string' },
      metaDescription: { type: 'string' },
      focusKeyword: { type: 'string' },
      urlSlugSuggestions: { type: 'array' },
      scores: { type: 'object' },
      recommendations: { type: 'array' }
    }
  };

  let result;
  try {
    result = await generateWithLLM({ provider: getProvider(), taskType: 'seo_metadata_generation', prompt, jsonSchema: schema, temperature: 0.45, maxTokens: 1800 });
  } catch (error) {
    console.warn('SEO metadata fallback:', error.message);
    result = fallbackMetadata({ topic, businessName });
  }

  result.urlSlugSuggestions = normalizeArray(result.urlSlugSuggestions);
  result.scores = normalizeScores(result.scores);
  result.recommendations = normalizeArray(result.recommendations, fallbackMetadata({ topic, businessName }).recommendations);

  const query = topic || businessName || result.focusKeyword || 'metadata';
  const report = await saveReport(userId, 'metadata', query, { topic, businessName, pageType, focusKeyword, businessContext: context }, result, result.scores, result.recommendations);
  return { report, result };
}

async function generateHashtagSet({ userId, content, topic, platforms, businessContext }) {
  const context = buildBusinessContext(businessContext);
  const selectedPlatforms = Array.isArray(platforms) && platforms.length ? platforms : ['facebook', 'instagram', 'linkedin', 'x', 'youtube'];
  const prompt = `Generate platform-specific social hashtags.

Business context: ${JSON.stringify(context)}
Topic: ${topic || ''}
Content: ${content}
Platforms: ${selectedPlatforms.join(', ')}

Return relevant, trend-aware, business-safe hashtags for each platform.`;

  const schema = {
    required: ['platformHashtags', 'trending', 'relevant', 'scores', 'recommendations'],
    properties: {
      platformHashtags: { type: 'object' },
      trending: { type: 'array' },
      relevant: { type: 'array' },
      scores: { type: 'object' },
      recommendations: { type: 'array' }
    }
  };

  let result;
  try {
    result = await generateWithLLM({ provider: getProvider(), taskType: 'seo_hashtag_generation', prompt, jsonSchema: schema, temperature: 0.65, maxTokens: 2200 });
  } catch (error) {
    console.warn('SEO hashtag fallback:', error.message);
    result = fallbackHashtags(content || topic, selectedPlatforms);
  }

  const platformHashtags = {};
  selectedPlatforms.forEach(platform => {
    platformHashtags[platform] = normalizeArray(result.platformHashtags?.[platform] || result.platformHashtags?.[platform.toLowerCase()] || []);
  });
  result.platformHashtags = platformHashtags;
  result.trending = normalizeArray(result.trending);
  result.relevant = normalizeArray(result.relevant);
  result.scores = normalizeScores(result.scores);
  result.recommendations = normalizeArray(result.recommendations, fallbackHashtags(content || topic, selectedPlatforms).recommendations);

  const query = topic || String(content || '').slice(0, 80) || 'hashtags';
  const report = await saveReport(userId, 'hashtags', query, { content, topic, platforms: selectedPlatforms, businessContext: context }, result, result.scores, result.recommendations);
  return { report, result };
}

async function analyzeCompetitor({ userId, competitorUrl, businessContext }) {
  const context = buildBusinessContext(businessContext);
  const prompt = `Analyze this competitor website URL for SEO and growth intelligence.

Competitor URL: ${competitorUrl}
My business context: ${JSON.stringify(context)}

Infer likely SEO themes from the domain and business context. Do not claim live crawl data. Provide practical opportunities and content recommendations.`;

  const schema = {
    required: ['competitorKeywords', 'contentStrategy', 'postingFrequency', 'seoOpportunities', 'contentRecommendations', 'scores', 'recommendations'],
    properties: {
      competitorKeywords: { type: 'array' },
      contentStrategy: { type: 'string' },
      postingFrequency: { type: 'string' },
      seoOpportunities: { type: 'array' },
      contentRecommendations: { type: 'array' },
      scores: { type: 'object' },
      recommendations: { type: 'array' }
    }
  };

  let result;
  try {
    result = await generateWithLLM({ provider: getProvider(), taskType: 'seo_competitor_analysis', prompt, jsonSchema: schema, temperature: 0.5, maxTokens: 2400 });
  } catch (error) {
    console.warn('SEO competitor fallback:', error.message);
    result = fallbackCompetitor(competitorUrl);
  }

  result.competitorKeywords = normalizeArray(result.competitorKeywords);
  result.seoOpportunities = normalizeArray(result.seoOpportunities);
  result.contentRecommendations = normalizeArray(result.contentRecommendations);
  result.scores = normalizeScores(result.scores);
  result.recommendations = normalizeArray(result.recommendations, fallbackCompetitor(competitorUrl).recommendations);

  const report = await saveReport(userId, 'competitor_analysis', competitorUrl, { competitorUrl, businessContext: context }, result, result.scores, result.recommendations);
  return { report, result };
}

function normalizeScores(scores = {}) {
  return {
    seo: clampScore(scores.seo ?? scores.seoScore, 70),
    content: clampScore(scores.content ?? scores.contentScore, 70),
    hashtag: clampScore(scores.hashtag ?? scores.hashtagScore, 65),
    competitor: clampScore(scores.competitor ?? scores.competitorScore, 60)
  };
}

async function getDashboard(userId) {
  if (!canPersistForUser(userId)) {
    return {
      scores: { seo: 72, content: 70, hashtag: 68, competitor: 62 },
      recommendations: [
        'Generate keyword research to personalize your SEO score.',
        'Create metadata for your next landing page.',
        'Analyze one competitor to unlock opportunity insights.'
      ],
      recentReports: [],
      reportCounts: {}
    };
  }

  const reports = await SeoReport.find({ userId }).sort({ createdAt: -1 }).limit(12).lean();
  const reportCounts = await SeoReport.aggregate([
    { $match: { userId: new mongoose.Types.ObjectId(userId) } },
    { $group: { _id: '$reportType', count: { $sum: 1 } } }
  ]);

  const latestScores = reports.map(report => report.scores || {}).filter(Boolean);
  const average = key => {
    if (!latestScores.length) return 68;
    return clampScore(latestScores.reduce((sum, score) => sum + Number(score[key] || 0), 0) / latestScores.length, 68);
  };

  const recommendations = reports.flatMap(report => report.recommendations || []).slice(0, 8);
  return {
    scores: {
      seo: average('seo'),
      content: average('content'),
      hashtag: average('hashtag'),
      competitor: average('competitor')
    },
    recommendations: recommendations.length ? recommendations : [
      'Run keyword research for your newest campaign topic.',
      'Generate metadata before publishing landing pages.',
      'Use platform-specific hashtags instead of one generic set.'
    ],
    recentReports: reports,
    reportCounts: reportCounts.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {})
  };
}

async function getReports(userId, reportType) {
  if (!canPersistForUser(userId)) return [];
  const query = { userId };
  if (reportType) query.reportType = reportType;
  return SeoReport.find(query).sort({ createdAt: -1 }).limit(25).lean();
}

module.exports = {
  generateKeywordResearch,
  generateMetadata,
  generateHashtagSet,
  analyzeCompetitor,
  getDashboard,
  getReports
};
