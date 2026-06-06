const seoService = require('../services/seoService');

const getUserId = (req) => req.user?._id || req.user?.id || req.user?.userId;

const getBusinessContext = (req) => {
  const profile = req.user?.businessProfile || {};
  return {
    businessName: profile.name || profile.companyName || req.body?.businessName || '',
    industry: profile.industry || req.body?.industry || '',
    description: profile.description || profile.niche || '',
    targetAudience: profile.targetAudience || '',
    location: profile.businessLocation || '',
    website: profile.website || ''
  };
};

const sendResult = (res, payload) => res.json({
  success: true,
  data: payload.result,
  report: payload.report
});

exports.getDashboard = async (req, res) => {
  try {
    const data = await seoService.getDashboard(getUserId(req));
    res.json({ success: true, data });
  } catch (error) {
    console.error('SEO dashboard error:', error);
    res.status(500).json({ success: false, message: 'Failed to load SEO dashboard' });
  }
};

exports.getReports = async (req, res) => {
  try {
    const reports = await seoService.getReports(getUserId(req), req.query.type);
    res.json({ success: true, reports });
  } catch (error) {
    console.error('SEO reports error:', error);
    res.status(500).json({ success: false, message: 'Failed to load SEO reports' });
  }
};

exports.keywordResearch = async (req, res) => {
  try {
    const topic = String(req.body.topic || req.body.businessName || '').trim();
    if (topic.length < 2) {
      return res.status(400).json({ success: false, message: 'Enter a business, product, campaign, or topic.' });
    }
    const payload = await seoService.generateKeywordResearch({
      userId: getUserId(req),
      topic,
      businessContext: { ...getBusinessContext(req), ...(req.body.businessContext || {}) }
    });
    sendResult(res, payload);
  } catch (error) {
    console.error('SEO keyword research error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate keyword research' });
  }
};

exports.metadata = async (req, res) => {
  try {
    const topic = String(req.body.topic || req.body.businessName || '').trim();
    if (topic.length < 2) {
      return res.status(400).json({ success: false, message: 'Enter a page, topic, product, or campaign.' });
    }
    const payload = await seoService.generateMetadata({
      userId: getUserId(req),
      topic,
      businessName: req.body.businessName,
      pageType: req.body.pageType,
      focusKeyword: req.body.focusKeyword,
      businessContext: { ...getBusinessContext(req), ...(req.body.businessContext || {}) }
    });
    sendResult(res, payload);
  } catch (error) {
    console.error('SEO metadata error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate metadata' });
  }
};

exports.hashtags = async (req, res) => {
  try {
    const content = String(req.body.content || req.body.topic || '').trim();
    if (content.length < 2) {
      return res.status(400).json({ success: false, message: 'Enter content or a topic for hashtag generation.' });
    }
    const payload = await seoService.generateHashtagSet({
      userId: getUserId(req),
      content,
      topic: req.body.topic,
      platforms: req.body.platforms,
      businessContext: { ...getBusinessContext(req), ...(req.body.businessContext || {}) }
    });
    sendResult(res, payload);
  } catch (error) {
    console.error('SEO hashtag error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate hashtags' });
  }
};

exports.competitorAnalysis = async (req, res) => {
  try {
    const competitorUrl = String(req.body.competitorUrl || req.body.url || '').trim();
    if (!/^https?:\/\/[^\s]+\.[^\s]+/i.test(competitorUrl)) {
      return res.status(400).json({ success: false, message: 'Enter a valid competitor website URL, including https://.' });
    }
    const payload = await seoService.analyzeCompetitor({
      userId: getUserId(req),
      competitorUrl,
      businessContext: { ...getBusinessContext(req), ...(req.body.businessContext || {}) }
    });
    sendResult(res, payload);
  } catch (error) {
    console.error('SEO competitor analysis error:', error);
    res.status(500).json({ success: false, message: 'Failed to analyze competitor' });
  }
};
