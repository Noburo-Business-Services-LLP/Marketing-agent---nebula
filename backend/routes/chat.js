const express = require('express');
const router = express.Router();
const { protect, optionalAuth } = require('../middleware/auth');
const User = require('../models/User');
const Competitor = require('../models/Competitor');
const Campaign = require('../models/Campaign');
const CachedCampaign = require('../models/CachedCampaign');
const Influencer = require('../models/Influencer');
const BrandAsset = require('../models/BrandAsset');
const { generateChatResponse, generateChatSuggestions } = require('../services/geminiAI');
const { checkTrial, deductCredits } = require('../middleware/trialGuard');

// Chat completion endpoint - uses Gemini AI with user context
router.post('/message', optionalAuth, async (req, res) => {
  try {
    const { message, conversationHistory = [], currentPage = 'dashboard' } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Message is required'
      });
    }

    // Get user's business profile if authenticated
    let businessProfile = null;
    const userId = req.user?.userId || req.user?.id || req.user?._id;
    if (req.user) {
      const user = await User.findById(userId);
      if (user && user.businessProfile) {
        businessProfile = user.businessProfile;
      }

      // Credits check only (no trial guard on promotion build)
      if (user && (user.credits?.balance ?? 100) < 0.5) {
        return res.status(403).json({ success: false, creditsExhausted: true, message: 'Insufficient credits for chat' });
      }
    }

    // Fetch page-specific context data
    let pageContext = null;
    if (userId) {
      try {
        switch (currentPage) {
          case 'competitors': {
            const competitors = await Competitor.find({ userId, isActive: true, isIgnored: { $ne: true } })
              .select('name competitorType industry location socialHandles metrics.avgEngagement metrics.followers description')
              .lean();
            pageContext = {
              page: 'Competitors',
              data: competitors.map(c => ({
                name: c.name,
                type: c.competitorType,
                industry: c.industry,
                location: c.location,
                followers: c.metrics?.followers || 0,
                avgEngagement: c.metrics?.avgEngagement || 0,
                description: c.description
              }))
            };
            break;
          }
          case 'campaigns': {
            const campaigns = await Campaign.find({ userId })
              .select('name objective platforms status scheduling.startDate performance')
              .sort({ createdAt: -1 }).limit(20).lean();
            pageContext = {
              page: 'Campaigns',
              data: campaigns.map(c => ({
                name: c.name,
                objective: c.objective,
                platforms: c.platforms,
                status: c.status,
                startDate: c.scheduling?.startDate,
                performance: c.performance
              }))
            };
            break;
          }
          case 'analytics': {
            const publishedCampaigns = await Campaign.find({ userId, status: 'posted' })
              .select('name platforms performance creative.textContent')
              .sort({ createdAt: -1 }).limit(10).lean();
            pageContext = {
              page: 'Analytics',
              data: publishedCampaigns.map(c => ({
                name: c.name,
                platforms: c.platforms,
                performance: c.performance
              }))
            };
            break;
          }
          case 'influencers': {
            const influencers = await Influencer.find({ userId })
              .select('name handle platform followerCount engagementRate niche aiMatchScore.score')
              .lean();
            pageContext = {
              page: 'Influencers',
              data: influencers.map(i => ({
                name: i.name,
                handle: i.handle,
                platform: i.platform,
                followers: i.followerCount,
                engagementRate: i.engagementRate,
                niche: i.niche,
                matchScore: i.aiMatchScore?.score
              }))
            };
            break;
          }
          case 'brand-assets': {
            const assets = await BrandAsset.find({ userId })
              .select('name type isPrimary format createdAt').lean();
            pageContext = {
              page: 'Brand Assets',
              data: assets.map(a => ({ name: a.name, type: a.type, isPrimary: a.isPrimary, format: a.format }))
            };
            break;
          }
          case 'dashboard': {
            const activeCampaigns = await Campaign.countDocuments({ userId, status: { $in: ['active', 'posted'] } });
            const competitorCount = await Competitor.countDocuments({ userId, isActive: true, isIgnored: { $ne: true } });
            pageContext = {
              page: 'Dashboard',
              data: { activeCampaigns, competitorsTracked: competitorCount }
            };
            break;
          }
          default:
            pageContext = { page: currentPage, data: null };
        }
      } catch (ctxErr) {
        console.error('Page context fetch error:', ctxErr.message);
      }
    }

    // Generate response using Gemini with business context
    const aiResponse = await generateChatResponse(message, businessProfile, conversationHistory, pageContext);

    // Deduct 0.5 credits for chat message (only for authenticated users)
    let creditsRemaining;
    if (userId) {
      const chatCreditResult = await deductCredits(userId, 'chat_message', 1, 'Chat message');
      creditsRemaining = chatCreditResult.creditsRemaining;
    }

    res.json({
      success: true,
      response: aiResponse,
      personalized: !!businessProfile,
      creditsRemaining
    });

  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get response. Please try again.'
    });
  }
});

// Quick suggestions endpoint - personalized based on business profile
router.get('/suggestions', optionalAuth, async (req, res) => {
  try {
    let businessProfile = null;
    
    if (req.user) {
      const user = await User.findById(req.user.userId || req.user.id || req.user._id);
      if (user && user.businessProfile) {
        businessProfile = user.businessProfile;
      }
    }

    const suggestions = await generateChatSuggestions(businessProfile);

    res.json({
      success: true,
      suggestions,
      personalized: !!businessProfile
    });
  } catch (error) {
    console.error('Suggestions error:', error);
    res.json({
      success: true,
      suggestions: [
        "How can I improve my social media engagement?",
        "What content should I post this week?",
        "Help me create a marketing strategy"
      ]
    });
  }
});

module.exports = router;
