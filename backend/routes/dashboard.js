/**
 * Dashboard Routes
 * Provides AI-powered personalized dashboard data with REAL metrics from database
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { deductCredits, ensureCreditCycle } = require('../middleware/creditGuard');
const User = require('../models/User');
const Campaign = require('../models/Campaign');
const Competitor = require('../models/Competitor');
const Influencer = require('../models/Influencer');
const CachedCampaign = require('../models/CachedCampaign');
const OnboardingContext = require('../models/OnboardingContext');
const { 
  generateDashboardInsights,
  generateCampaignSuggestions,
  generateSectionSynopsis,
  generateSingleCampaign,
  generateRivalPost,
  generateEventPost
} = require('../services/geminiAI');
const { generateWithLLM } = require('../services/llmRouter');
const { getAyrshareUserProfile, getUserSocialAnalytics } = require('../services/socialMediaAPI');

// In-memory dashboard cache for fast loading
const dashboardCache = new Map();
const CACHE_TTL = 60 * 1000; // 1 minute cache for dashboard data

// Cache helper functions
function getCachedDashboard(userId) {
  const cached = dashboardCache.get(userId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`📦 Dashboard cache hit for user ${userId}`);
    return cached.data;
  }
  return null;
}

function setCachedDashboard(userId, data) {
  dashboardCache.set(userId, {
    data,
    timestamp: Date.now()
  });
  
  // Clean old cache entries
  if (dashboardCache.size > 100) {
    const now = Date.now();
    for (const [key, value] of dashboardCache.entries()) {
      if (now - value.timestamp > CACHE_TTL * 5) {
        dashboardCache.delete(key);
      }
    }
  }
}

// Import socialMediaAPI for real competitor scraping (Instagram only)
let socialMediaAPI = null;
try {
  socialMediaAPI = require('../services/socialMediaAPI');
} catch (e) {
  console.warn('socialMediaAPI not available:', e.message);
}

// Helper to parse LLM JSON response
function parseGeminiJSON(text) {
  try {
    if (!text || typeof text !== 'string') {
      console.error('parseGeminiJSON: Invalid input - not a string:', typeof text);
      return null;
    }
    
    // Try direct JSON parse first
    try {
      return JSON.parse(text.trim());
    } catch (e) {
      // Continue to try other methods
    }
    
    // Try to extract from markdown code blocks
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch && jsonMatch[1]) {
      return JSON.parse(jsonMatch[1].trim());
    }
    
    // Try to find JSON object in text
    const objectMatch = text.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      return JSON.parse(objectMatch[0]);
    }
    
    console.error('parseGeminiJSON: No valid JSON found in text');
    return null;
  } catch (e) {
    console.error('JSON parse error:', e.message);
    return null;
  }
}

/**
 * ROBUST COMPETITOR DISCOVERY - Find 12-15 REAL competitors
 * Uses a simple, reliable prompt that consistently returns good results
 */
async function autoDiscoverCompetitorsForUser(userId, businessContext) {
  console.log('🔍 ===========================================');
  console.log('🔍 STARTING COMPETITOR DISCOVERY');
  console.log('🔍 ===========================================');
  console.log('📋 Business:', businessContext.companyName);
  console.log('📋 Industry:', businessContext.industry);
  console.log('📋 Location:', businessContext.location);
  console.log('📋 Description:', businessContext.description);
  
  // Delete any existing auto-discovered competitors first
  try {
    const deleted = await Competitor.deleteMany({ userId, isAutoDiscovered: true });
    console.log(`🗑️ Deleted ${deleted.deletedCount} old auto-discovered competitors`);
  } catch (e) {
    console.error('Could not delete old competitors:', e.message);
  }

  const prompt = `You are a market research expert. Find competitors for this business.

BUSINESS INFO:
- Name: ${businessContext.companyName}
- Industry: ${businessContext.industry}
- What they do: ${businessContext.description || 'Not specified'}
- Target customers: ${businessContext.targetCustomer || 'Not specified'}
- Location: ${businessContext.location}

YOUR TASK: Find 15 REAL competitors that offer similar products/services.

REQUIREMENTS:
1. All competitors must be REAL companies that actually exist
2. Include a mix of:
   - 3 LOCAL competitors (same city/region as ${businessContext.location})
   - 6 NATIONAL competitors (same country, major players)
   - 3 GLOBAL competitors (international leaders in this space)
   - 3 EMERGING competitors (startups/new players)
3. Each competitor must have an active online presence
4. Only include companies you are CERTAIN exist

RETURN EXACTLY THIS JSON FORMAT:
{
  "competitors": [
    {
      "name": "Company Name",
      "website": "https://example.com",
      "instagram": "handle_without_at",
      "twitter": "handle_without_at",
      "linkedin": "https://linkedin.com/company/name",
      "description": "What this company does and why they compete with ${businessContext.companyName}",
      "location": "City, Country",
      "competitorType": "local|national|global|emerging",
      "estimatedFollowers": 50000
    }
  ]
}

IMPORTANT: Return EXACTLY 15 competitors. Be accurate with company names and social handles.`;

  try {
    console.log('📤 Sending competitor discovery prompt to Gemini...');
    const result = await generateWithLLM({ 
      provider: 'gemini', 
      prompt, 
      taskType: 'analysis',
      maxTokens: 8192  // Increased for 15 competitors
    });
    
    const responseText = typeof result === 'string' ? result : (result?.text || result?.content || JSON.stringify(result));
    console.log('📥 Gemini response received, length:', responseText?.length || 0);
    
    const parsed = parseGeminiJSON(responseText);

    if (!parsed || !parsed.competitors || !Array.isArray(parsed.competitors)) {
      console.error('❌ Failed to parse Gemini response');
      console.log('Raw response:', responseText?.substring(0, 500));
      return [];
    }

    console.log(`✅ Parsed ${parsed.competitors.length} competitors from Gemini`);
    
    // Save competitors to database
    const savedCompetitors = [];
    for (const comp of parsed.competitors) {
      if (!comp.name || comp.name.length < 2) {
        console.log('⚠️ Skipping invalid competitor:', comp);
        continue;
      }
      
      try {
        // Check if competitor already exists
        const existing = await Competitor.findOne({ userId, name: comp.name });
        if (existing) {
          console.log(`⏭️ Competitor already exists: ${comp.name}`);
          savedCompetitors.push(existing);
          continue;
        }
        
        const competitor = new Competitor({
          userId,
          name: comp.name,
          website: comp.website || '',
          description: comp.description || '',
          industry: businessContext.industry,
          socialHandles: {
            instagram: (comp.instagram || '').replace('@', ''),
            twitter: (comp.twitter || '').replace('@', ''),
            facebook: (comp.facebook || '').replace('@', ''),
            linkedin: comp.linkedin || ''
          },
          location: comp.location || businessContext.location,
          isActive: true,
          isAutoDiscovered: true,
          posts: [],
          metrics: {
            followers: comp.estimatedFollowers || 0,
            lastFetched: new Date()
          },
          competitorType: comp.competitorType || 'national'
        });
        
        await competitor.save();
        savedCompetitors.push(competitor);
        console.log(`✅ Saved: ${comp.name} (${comp.competitorType || 'unknown'})`);
      } catch (saveError) {
        console.error(`❌ Error saving ${comp.name}:`, saveError.message);
      }
    }
    
    console.log('🔍 ===========================================');
    console.log(`🔍 DISCOVERY COMPLETE: ${savedCompetitors.length} competitors saved`);
    console.log('🔍 ===========================================');
    
    return savedCompetitors;
  } catch (error) {
    console.error('❌ Auto-discover error:', error.message);
    console.error(error.stack);
    return [];
  }
}

// Helper to generate post URL based on platform
function generatePlatformPostUrl(platform, socialHandles) {
  const handle = socialHandles?.[platform] || 'user';
  const cleanHandle = handle.replace('@', '');
  const postId = Math.random().toString(36).substring(2, 15);
  
  switch (platform?.toLowerCase()) {
    case 'instagram':
      return `https://www.instagram.com/p/${postId}/`;
    case 'twitter':
    case 'x':
      return `https://twitter.com/${cleanHandle}/status/${Date.now()}`;
    case 'facebook':
      return `https://www.facebook.com/${cleanHandle}/posts/${postId}`;
    case 'linkedin':
      return `https://www.linkedin.com/feed/update/urn:li:activity:${Date.now()}`;
    case 'youtube':
      return `https://www.youtube.com/watch?v=${postId}`;
    default:
      return `#`;
  }
}

/**
 * GET /api/dashboard/overview
 * Get personalized dashboard overview with REAL data from database
 */
router.get('/overview', protect, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const userId = req.user.userId || req.user.id;
    
    // Check cache first for instant response
    const cached = getCachedDashboard(userId);
    if (cached) {
      console.log(`⚡ Dashboard served from cache in ${Date.now() - startTime}ms`);
      return res.json(cached);
    }
    
    // Run initial queries in parallel for faster loading
    const [user, allCampaigns, competitors] = await Promise.all([
      User.findById(userId).lean(),
      Campaign.find({ userId }).sort({ createdAt: -1 }).lean(),
      Competitor.find({ userId }).limit(10).lean()
    ]);
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    console.log(`📊 Initial queries completed in ${Date.now() - startTime}ms`);

    // Process campaign data
    const activeCampaigns = allCampaigns.filter(c => ['active', 'posted', 'scheduled'].includes(c.status));
    const recentCampaigns = allCampaigns.slice(0, 10);
    
    // Calculate REAL spend from campaigns
    const totalSpent = allCampaigns.reduce((sum, c) => sum + (c.budget?.spent || 0), 0);
    
    // Calculate REAL daily spend for the graph (last 7 days)
    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      
      const daySpend = allCampaigns
        .filter(c => c.createdAt && c.createdAt.toISOString().split('T')[0] === dateStr)
        .reduce((sum, c) => sum + (c.budget?.spent || 0), 0);
      
      last7Days.push({
        date: dateStr,
        day: date.toLocaleDateString('en-US', { weekday: 'short' }),
        spend: daySpend
      });
    }
    
    // Calculate REAL performance metrics
    const totalImpressions = allCampaigns.reduce((sum, c) => sum + (c.performance?.impressions || 0), 0);
    const totalClicks = allCampaigns.reduce((sum, c) => sum + (c.performance?.clicks || 0), 0);
    const totalEngagement = allCampaigns.reduce((sum, c) => sum + (c.performance?.engagement || 0), 0);
    const avgCTR = totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(2) : 0;
    
    // Get competitor data - already fetched in parallel above
    let competitorList = [...competitors]; // Use from parallel query
    let competitorPosts = [];
    
    // Get competitor names from onboarding (businessProfile.competitors)
    const onboardingCompetitors = user.businessProfile?.competitors || [];
    
    // If no Competitor documents exist but we have names from onboarding, create them (background task)
    if (competitorList.length === 0 && onboardingCompetitors.length > 0) {
      console.log('Syncing competitors from onboarding:', onboardingCompetitors);
      
      // Create Competitor documents from onboarding data (don't await - do in background)
      Promise.all(onboardingCompetitors.filter(n => n && n.trim()).map(async (competitorName) => {
        try {
          const existingComp = await Competitor.findOne({ userId, name: competitorName.trim() });
          if (!existingComp) {
            await Competitor.create({
              userId,
              name: competitorName.trim(),
              platforms: ['instagram', 'twitter', 'linkedin'],
              posts: []
            });
          }
        } catch (e) {
          console.error('Error creating competitor:', e.message);
        }
      })).catch(console.error);
      
      // Use onboarding competitors for this request
      competitorList = onboardingCompetitors.filter(n => n && n.trim()).map(name => ({
        name: name.trim(),
        platforms: ['instagram', 'twitter', 'linkedin'],
        posts: []
      }));
      // Re-fetch competitors after creation
      competitorList = await Competitor.find({ userId }).limit(10).lean();
    }
    
    // If still no competitors, skip auto-discovery for speed (do in background later)
    if (competitorList.length === 0) {
      console.log('⚠️ No competitors found - will auto-discover in background');
      
      // Start background auto-discovery (don't wait)
      const onboardingContext = await OnboardingContext.findOne({ userId }).lean();
      const bp = user?.businessProfile || {};
      
      const businessContext = {
        companyName: onboardingContext?.company?.name || bp.name || bp.companyName || 'Your Business',
        industry: onboardingContext?.company?.industry || bp.industry || bp.niche || bp.category || 'General',
        description: onboardingContext?.company?.description || bp.description || bp.niche || 'Business services',
        targetCustomer: onboardingContext?.targetCustomer?.description || bp.targetAudience || 'General consumers',
        location: onboardingContext?.geography?.businessLocation || bp.location || 'India'
      };
      
      // Run auto-discovery in background (non-blocking)
      autoDiscoverCompetitorsForUser(userId, businessContext).catch(console.error);
    }
    
    // Get competitor names for activity generation
    const competitorNames = competitorList.length > 0 
      ? competitorList.map(c => c.name)
      : onboardingCompetitors.filter(n => n && n.trim());
    
    // Check if we have fresh posts in DB (less than 2 hours old)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const threeMonthsAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 1 month filter
    
    const hasRecentPostsInDB = competitorList.some(c => 
      c.posts && c.posts.length > 0 && 
      c.posts.some(p => p.fetchedAt && new Date(p.fetchedAt) > twoHoursAgo)
    );
    
    if (competitorNames.length > 0) {
      // PRIORITY 1: Try to fetch REAL posts using Apify
      if (!hasRecentPostsInDB && socialMediaAPI?.fetchRealCompetitorPosts) {
        try {
          console.log('Fetching REAL competitor posts using Apify...');
          
          // Build competitor handles for real scraping (Instagram ONLY)
          const competitorHandles = competitorList.map(comp => ({
            name: comp.name,
            instagram: comp.socialHandles?.instagram?.replace('@', '') || comp.name?.toLowerCase().replace(/[^a-z0-9]/g, '')
          }));
          
          const realResult = await socialMediaAPI.fetchRealCompetitorPosts(competitorHandles, { limit: 5 });
          
          if (realResult.success && realResult.posts && realResult.posts.length > 0) {
            console.log(`✅ Fetched ${realResult.posts.length} REAL competitor posts`);
            
            // STRICT 3-MONTH FILTER: Only show posts from the last 3 months
            // This is a CRITICAL requirement - NO posts older than 3 months should ever be displayed
            const threeMonthsAgoTimestamp = Date.now() - (30 * 24 * 60 * 60 * 1000); // 1 month filter
            const filteredPosts = realResult.posts.filter(post => {
              const postTime = post.postedAtTimestamp || 0;
              if (postTime < threeMonthsAgoTimestamp) {
                console.log(`⚠️ Filtering out old post from ${post.competitorName} - posted ${new Date(postTime).toLocaleDateString()}`);
                return false;
              }
              return true;
            });
            
            console.log(`📅 After 3-month filter: ${filteredPosts.length} posts (removed ${realResult.posts.length - filteredPosts.length} old posts)`);
            
            // Sort by timestamp (most recent first)
            filteredPosts.sort((a, b) => (b.postedAtTimestamp || 0) - (a.postedAtTimestamp || 0));
            
            // Only include posts that have a valid timestamp — never fake it
            competitorPosts = filteredPosts
              .filter(post => post.postedAtTimestamp && post.postedAtTimestamp > 0)
              .map(post => ({
              id: post.id,
              competitorName: post.competitorName,
              competitorLogo: post.competitorLogo || post.competitorName?.charAt(0) || 'C',
              content: post.content || 'No content available',
              sentiment: post.sentiment || 'neutral',
              postedAt: getRelativeTime(post.postedAt || post.postedAtTimestamp),
              postedAtTimestamp: post.postedAtTimestamp,
              likes: post.likes || 0,
              comments: post.comments || 0,
              platform: 'instagram',
              postUrl: post.postUrl || `https://www.instagram.com/${post.competitorName?.toLowerCase().replace(/[^a-z0-9]/g, '')}/`,
              imageUrl: post.imageUrl || null,
              isReal: true
            }));
            
            // Save fetched posts to DB for caching (only posts within 3 months)
            for (const comp of competitorList) {
              const compPosts = competitorPosts.filter(p => p.competitorName === comp.name && p.postedAtTimestamp > threeMonthsAgoTimestamp);
              if (compPosts.length > 0 && comp._id) {
                try {
                  await Competitor.findByIdAndUpdate(comp._id, {
                    posts: compPosts.filter(p => p.postedAtTimestamp).map(p => ({
                      platform: 'instagram',
                      content: p.content,
                      likes: p.likes,
                      comments: p.comments,
                      postUrl: p.postUrl,
                      imageUrl: p.imageUrl,
                      postedAt: new Date(p.postedAtTimestamp),
                      postedAtTimestamp: p.postedAtTimestamp,
                      fetchedAt: new Date(),
                      isRealData: true
                    })),
                    'metrics.lastFetched': new Date()
                  });
                } catch (saveErr) {
                  console.log('Could not save posts to DB:', saveErr.message);
                }
              }
            }
          }
        } catch (realError) {
          console.log('Real post fetching failed:', realError.message);
        }
      }
      
      // NO Gemini AI fallback — only real Instagram data is allowed
      
      // If no real posts from Apify, check database for cached Instagram posts
      if (competitorPosts.length === 0) {
        const oneMonthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        for (const comp of competitorList) {
          if (comp.posts && comp.posts.length > 0) {
            // Only show Instagram posts with valid timestamps within 1 month
            const recentDbPosts = comp.posts.filter(p => {
              if (!p.postedAt) return false;
              const postDate = new Date(p.postedAt);
              if (isNaN(postDate.getTime())) return false;
              return postDate > oneMonthAgo;
            });
            
            recentDbPosts.slice(0, 5).forEach(post => {
              const postTimestamp = new Date(post.postedAt).getTime();
              const handle = comp.socialHandles?.instagram || comp.name.toLowerCase().replace(/[^a-z0-9]/g, '');
              const validPostUrl = post.postUrl && post.postUrl !== '#' && post.postUrl !== '' 
                ? post.postUrl 
                : `https://www.instagram.com/${handle}/`;
              
              competitorPosts.push({
                id: post._id?.toString() || Math.random().toString(),
                competitorName: comp.name,
                competitorLogo: comp.name?.charAt(0) || 'C',
                content: post.content || 'No content available',
                sentiment: post.sentiment || 'neutral',
                postedAt: getRelativeTime(post.postedAt),
                postedAtTimestamp: postTimestamp,
                likes: post.likes || 0,
                comments: post.comments || 0,
                platform: 'instagram',
                postUrl: validPostUrl,
                isReal: true
              });
            });
          }
        }
        
        // Sort by timestamp (most recent first)
        competitorPosts.sort((a, b) => (b.postedAtTimestamp || 0) - (a.postedAtTimestamp || 0));
      }
      
      // If no real posts exist, return empty array — NO fake/placeholder data
      if (competitorPosts.length === 0) {
        console.log('No real Instagram posts available for competitors — returning empty');
      }
    }

    // Get REAL influencer count (already in parallel, but just count is fast)
    const influencerCount = await Influencer.countDocuments({ userId });
    
    // Generate AI-powered insights using Gemini (with real context)
    const metrics = {
      totalCampaigns: allCampaigns.length,
      activeCampaigns: activeCampaigns.length,
      totalSpent,
      engagementRate: totalImpressions > 0 ? ((totalEngagement / totalImpressions) * 100).toFixed(2) : 0
    };
    const aiData = user.businessProfile?.name 
      ? await generateDashboardInsights(user.businessProfile, metrics)
      : { suggestedActions: [], trendingTopics: [], personalizedTips: [], brandScoreFactors: {} };
    
    // Calculate brand score based on REAL data
    const brandScore = calculateRealBrandScore({
      campaignCount: allCampaigns.length,
      activeCampaignCount: activeCampaigns.length,
      totalSpent,
      totalImpressions,
      totalEngagement,
      avgCTR,
      competitorCount: competitorList.length,
      influencerCount
    });
    
    // Build response with REAL data
    
    // Fetch Ayrshare connected accounts - FAST (no analytics call to avoid slow loading)
    let ayrshareProfiles = [];
    if (user.ayrshare?.profileKey) {
      try {
        const userProfile = await getAyrshareUserProfile(user.ayrshare.profileKey);
        if (userProfile.success && userProfile.data?.activeSocialAccounts?.length > 0) {
          const ayrshareAccounts = userProfile.data.activeSocialAccounts;
          const displayNames = userProfile.data.displayNames || [];
          
          // Map Ayrshare platform names
          const platformNameMap = {
            'instagram': 'Instagram',
            'facebook': 'Facebook',
            'twitter': 'X',
            'linkedin': 'LinkedIn',
            'youtube': 'YouTube',
            'tiktok': 'TikTok'
          };
          
          ayrshareProfiles = ayrshareAccounts.map(platformKey => {
            const displayInfo = displayNames.find(d => d.platform === platformKey);
            
            return {
              platform: platformNameMap[platformKey] || platformKey,
              accountName: displayInfo?.username || displayInfo?.displayName || platformKey,
              profileImage: displayInfo?.userImage || null,
              source: 'ayrshare'
            };
          });
        }
      } catch (e) {
        console.log('Ayrshare profile fetch for dashboard failed:', e.message);
      }
    }
    
    // Combine OAuth-connected accounts (like YouTube) with Ayrshare accounts
    const oauthProfiles = (user.connectedSocials || []).filter(s => s.accessToken).map(social => ({
      platform: social.platform,
      accountName: social.accountName || social.channelData?.title || 'Connected Account',
      profileImage: social.channelData?.thumbnailUrl || null,
      connectedAt: social.connectedAt,
      source: 'oauth'
    }));
    
    // Merge profiles, avoiding duplicates
    const allProfiles = [...ayrshareProfiles];
    oauthProfiles.forEach(oauthProfile => {
      const exists = allProfiles.some(p => p.platform.toLowerCase() === oauthProfile.platform.toLowerCase());
      if (!exists) {
        allProfiles.push(oauthProfile);
      }
    });
    
    const dashboardData = {
      success: true,
      data: {
        overview: {
          totalCampaigns: allCampaigns.length,
          activeCampaigns: activeCampaigns.length,
          activeCampaignsChange: calculateChange(activeCampaigns.length, 0), // Would compare to previous period
          totalSpent: totalSpent,
          dailySpend: last7Days,
          brandScore: brandScore,
          brandScoreChange: 0, // Would compare to previous period
          engagementRate: totalImpressions > 0 ? ((totalEngagement / totalImpressions) * 100).toFixed(2) : 0,
          totalImpressions,
          totalClicks,
          avgCTR,
          connectedPlatforms: allProfiles.length,
          influencerCount,
          // Social profiles data for dashboard card - includes Ayrshare + OAuth
          socialProfiles: allProfiles
        },
        trends: aiData.trendingTopics || [],
        recentCampaigns: recentCampaigns.map(c => ({
          _id: c._id,
          name: c.name,
          objective: c.objective,
          platforms: c.platforms,
          status: c.status,
          scheduling: c.scheduling,
          performance: c.performance,
          creative: c.creative,
          createdAt: c.createdAt
        })),
        suggestedActions: (aiData.suggestedActions && aiData.suggestedActions.length > 0) 
          ? aiData.suggestedActions.map(action => ({
              id: action.id || `action_${Math.random().toString(36).substr(2, 9)}`,
              title: action.title,
              description: action.description,
              actionType: action.actionType || action.type || 'create_campaign',
              priority: action.priority || 'medium'
            }))
          : [
              // Fallback actions if AI fails
              {
                id: 'fallback_1',
                title: `Create your first ${user.businessProfile?.industry || 'marketing'} campaign`,
                description: 'Get started by creating a campaign to reach your audience',
                actionType: 'create_campaign',
                priority: 'high'
              },
              {
                id: 'fallback_2',
                title: 'Connect your social media accounts',
                description: 'Link your social accounts to enable posting and analytics',
                actionType: 'connect_social',
                priority: 'high'
              },
              {
                id: 'fallback_3',
                title: 'Analyze your competitors',
                description: 'See what strategies work for your competitors',
                actionType: 'analyze_competitors',
                priority: 'medium'
              },
              {
                id: 'fallback_4',
                title: 'Find influencers in your niche',
                description: 'Discover potential partnerships to expand your reach',
                actionType: 'find_influencers',
                priority: 'medium'
              }
            ],
        competitorActivity: competitorPosts.length > 0 ? competitorPosts : (aiData.competitorInsights || []).map(insight => ({
          id: insight.id,
          competitorName: insight.competitorName,
          competitorLogo: insight.competitorName?.charAt(0) || 'C',
          content: insight.content,
          sentiment: insight.sentiment || 'neutral',
          postedAt: 'AI Generated',
          likes: insight.likes || 0,
          comments: insight.comments || 0,
          platform: insight.platform || 'instagram',
          insight: insight.insight,
          isAIGenerated: true
        })),
        trackedCompetitors: competitorNames.map(name => ({
          name: name,
          logo: name?.charAt(0)?.toUpperCase() || 'C',
          platforms: ['instagram', 'twitter', 'linkedin']
        })),
        campaignIdeas: aiData.campaignIdeas || [],
        brandScoreFactors: aiData.brandScoreFactors || {},
        personalizedTips: aiData.personalizedTips || [],
        businessContext: {
          name: user.businessProfile?.name,
          industry: user.businessProfile?.industry,
          niche: user.businessProfile?.niche
        },
        generatedAt: new Date().toISOString(),
        dataSource: 'real' // Indicates this is real data, not mock
      }
    };

    // Cache the response for faster subsequent loads
    setCachedDashboard(userId, dashboardData);
    console.log(`⚡ Dashboard generated in ${Date.now() - startTime}ms (cached for next load)`);

    res.json(dashboardData);
  } catch (error) {
    console.error('Dashboard overview error:', error);
    res.status(500).json({ success: false, message: 'Failed to load dashboard', error: error.message });
  }
});

/**
 * GET /api/dashboard/campaign-suggestions
 * Get AI-powered campaign suggestions using Gemini with CACHING
 * Returns cached campaigns instantly if available, otherwise generates new ones
 */
router.get('/campaign-suggestions', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId || req.user.id);
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (!user.businessProfile?.name) {
      return res.status(400).json({ 
        success: false, 
        message: 'Please complete onboarding first',
        campaigns: []
      });
    }

    const count = parseInt(req.query.count) || 6;
    const forceRefresh = req.query.refresh === 'true';
    // Parse platforms filter (comma-separated, exclude YouTube)
    const platformsParam = req.query.platforms ? decodeURIComponent(req.query.platforms).split(',').filter(p => p && p !== 'YouTube') : null;
    
    // Generate profile hash for cache invalidation
    const profileHash = CachedCampaign.createProfileHash(user.businessProfile);
    
    // Check cache first (skip cache when platforms filter is applied — cached campaigns may not match)
    if (!forceRefresh && !platformsParam) {
      const cached = await CachedCampaign.getCachedForUser(
        user._id, 
        profileHash, 
        count
      );
      
      if (cached && cached.length >= count) {
        console.log(`✅ Returning ${cached.length} cached campaigns for user ${user._id}`);
        
        // Transform cached data to match expected format
        const campaigns = cached.map(c => ({
          id: c.campaignId,
          name: c.name,
          title: c.name,
          tagline: c.tagline,
          objective: c.objective,
          platforms: c.platforms,
          platform: c.platform,
          description: c.description,
          caption: c.caption,
          hashtags: c.hashtags,
          imageUrl: c.imageUrl,
          bestPostTime: c.bestPostTime,
          expectedReach: c.estimatedReach,
          estimatedReach: c.estimatedReach,
          duration: c.duration,
          estimatedBudget: c.estimatedBudget,
          contentIdeas: c.contentIdeas
        }));
        
        return res.json({
          success: true,
          data: { campaigns },
          personalized: true,
          cached: true,
          businessContext: {
            name: user.businessProfile.name,
            industry: user.businessProfile.industry
          }
        });
      }
    }
    
    // No cache or force refresh - generate new suggestions
    console.log(`🔄 Generating fresh campaigns for user ${user._id}${platformsParam ? ` [platforms: ${platformsParam.join(',')}]` : ''}`);
    
    // Credit check before generation
    await ensureCreditCycle(user);
    const campaignCount = count || 6;
    const creditCost = campaignCount * 7; // 5 (image) + 2 (caption) per campaign
    if (user.credits.balance < creditCost) {
      return res.status(403).json({
        success: false,
        message: 'Insufficient credits',
        creditsRemaining: user.credits.balance,
        required: creditCost
      });
    }
    
    const suggestions = await generateCampaignSuggestions(user.businessProfile, count, platformsParam);
    
    // Deduct credits after successful generation
    const generatedCount = suggestions.campaigns?.length || 0;
    let creditsRemaining = user.credits.balance;
    if (generatedCount > 0) {
      const actualCost = generatedCount * 7;
      const result = await deductCredits(user._id, actualCost, `campaign_suggestions_${generatedCount}`);
      creditsRemaining = result.balance;
    }
    
    // Cache the new suggestions
    if (suggestions.campaigns && suggestions.campaigns.length > 0) {
      try {
        await CachedCampaign.saveCampaigns(user._id, profileHash, suggestions.campaigns);
        console.log(`💾 Cached ${suggestions.campaigns.length} new campaigns`);
      } catch (cacheError) {
        console.error('Failed to cache campaigns:', cacheError);
        // Continue anyway - caching failure shouldn't break the response
      }
    }

    res.json({
      success: true,
      data: suggestions,
      personalized: true,
      cached: false,
      creditsRemaining,
      businessContext: {
        name: user.businessProfile.name,
        industry: user.businessProfile.industry
      }
    });
  } catch (error) {
    console.error('Campaign suggestions error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate suggestions', error: error.message });
  }
});

/**
 * GET /api/dashboard/campaign-suggestions-stream
 * Stream campaign suggestions using Server-Sent Events for PROGRESSIVE LOADING
 * Campaigns appear one-by-one as they're generated
 */
router.get('/campaign-suggestions-stream', protect, async (req, res) => {
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  
  try {
    const user = await User.findById(req.user.userId || req.user.id);
    
    if (!user) {
      res.write(`data: ${JSON.stringify({ error: 'User not found' })}\n\n`);
      res.end();
      return;
    }

    if (!user.businessProfile?.name) {
      res.write(`data: ${JSON.stringify({ error: 'Please complete onboarding first' })}\n\n`);
      res.end();
      return;
    }

    const count = parseInt(req.query.count) || 6;
    const forceRefresh = req.query.refresh === 'true';
    const profileHash = CachedCampaign.createProfileHash(user.businessProfile);
    // Parse platforms filter (comma-separated, exclude YouTube)
    const platformsParam = req.query.platforms ? decodeURIComponent(req.query.platforms).split(',').filter(p => p && p !== 'YouTube') : null;
    
    // Check cache first (skip cache entirely when platforms filter is applied — cached campaigns may be for different platforms)
    if (!forceRefresh && !platformsParam) {
      const cached = await CachedCampaign.getCachedForUser(user._id, profileHash, count);
      
      if (cached && cached.length >= count) {
        // Stream cached campaigns quickly (50ms apart for smooth UX)
        for (let i = 0; i < cached.length; i++) {
          const c = cached[i];
          const campaign = {
            id: c.campaignId,
            name: c.name,
            title: c.name,
            objective: c.objective,
            platforms: c.platforms,
            platform: c.platform,
            caption: c.caption,
            hashtags: c.hashtags,
            imageUrl: c.imageUrl,
            bestPostTime: c.bestPostTime,
            estimatedReach: c.estimatedReach
          };
          
          res.write(`data: ${JSON.stringify({ 
            type: 'campaign', 
            index: i, 
            total: cached.length,
            campaign,
            cached: true
          })}\n\n`);
          
          // Small delay for smooth appearance
          await new Promise(r => setTimeout(r, 50));
        }
        
        res.write(`data: ${JSON.stringify({ type: 'complete', total: cached.length, cached: true })}\n\n`);
        res.end();
        return;
      }
    }
    
    // Generate campaigns one by one using streaming
    // Credit check before generation
    await ensureCreditCycle(user);
    const creditCostStream = count * 7; // 5 (image) + 2 (caption) per campaign
    if (user.credits.balance < creditCostStream) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'Insufficient credits', creditsRemaining: user.credits.balance, required: creditCostStream })}\n\n`);
      res.end();
      return;
    }
    
    res.write(`data: ${JSON.stringify({ type: 'start', total: count, message: 'Generating personalized campaigns...' })}\n\n`);
    
    const generatedCampaigns = [];
    
    for (let i = 0; i < count; i++) {
      try {
        // Generate single campaign
        const campaign = await generateSingleCampaign(user.businessProfile, i, count, platformsParam);
        
        if (campaign) {
          generatedCampaigns.push(campaign);
          
          res.write(`data: ${JSON.stringify({ 
            type: 'campaign', 
            index: i, 
            total: count,
            campaign,
            cached: false
          })}\n\n`);
        }
      } catch (err) {
        console.error(`Error generating campaign ${i}:`, err);
        res.write(`data: ${JSON.stringify({ type: 'error', index: i, message: err.message })}\n\n`);
      }
    }
    
    // Cache all generated campaigns
    if (generatedCampaigns.length > 0) {
      try {
        await CachedCampaign.saveCampaigns(user._id, profileHash, generatedCampaigns);
      } catch (cacheError) {
        console.error('Failed to cache streamed campaigns:', cacheError);
      }
      
      // Deduct credits for all generated campaigns
      try {
        const actualCost = generatedCampaigns.length * 7;
        const result = await deductCredits(user._id, actualCost, `campaign_stream_${generatedCampaigns.length}`);
        res.write(`data: ${JSON.stringify({ type: 'credits_update', creditsRemaining: result.balance })}\n\n`);
      } catch (creditErr) {
        console.error('Credit deduction failed after streaming:', creditErr);
      }
    }
    
    res.write(`data: ${JSON.stringify({ type: 'complete', total: generatedCampaigns.length })}\n\n`);
    res.end();
    
  } catch (error) {
    console.error('Campaign streaming error:', error);
    res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
    res.end();
  }
});

/**
 * POST /api/dashboard/refresh-competitor-posts
 * Manually trigger real competitor post scraping using Apify
 */
router.post('/refresh-competitor-posts', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    // Get competitors from database
    const competitors = await Competitor.find({ userId }).limit(10);
    
    if (competitors.length === 0) {
      return res.json({ success: false, message: 'No competitors to scrape', posts: [] });
    }
    
    if (!socialMediaAPI || !socialMediaAPI.fetchRealCompetitorPosts) {
      return res.status(503).json({ success: false, message: 'Scraping service not available' });
    }
    
    // Build competitor handles (Instagram ONLY)
    const competitorHandles = competitors.map(c => ({
      name: c.name,
      instagram: c.socialHandles?.instagram || c.name.toLowerCase().replace(/\s+/g, '')
    }));
    
    console.log('Manual refresh: Fetching real posts for', competitorHandles.map(c => c.name));
    
    const realPosts = await socialMediaAPI.fetchRealCompetitorPosts(competitorHandles, { limit: 5 });
    
    if (realPosts.success && realPosts.posts.length > 0) {
      // Save to database
      for (const post of realPosts.posts) {
        const competitor = await Competitor.findOne({ userId, name: post.competitorName });
        if (competitor) {
          // Clear old posts and add new real ones
          competitor.posts = competitor.posts.filter(p => p.isReal !== false).slice(-10);
          // Only save posts that have a real timestamp
          if (post.postedAtTimestamp && post.postedAtTimestamp > 0) {
            competitor.posts.push({
              platform: 'instagram',
              postUrl: post.postUrl,
              content: post.content,
              imageUrl: post.imageUrl,
              likes: post.likes,
              comments: post.comments,
              sentiment: post.sentiment,
              postedAt: new Date(post.postedAtTimestamp),
              postedAtTimestamp: post.postedAtTimestamp,
              fetchedAt: new Date()
            });
          }
          await competitor.save();
        }
      }
      
      res.json({
        success: true,
        message: `Fetched ${realPosts.posts.length} real posts from social media`,
        posts: realPosts.posts.map(p => ({
          ...p,
          postedAt: getRelativeTime(p.postedAt || p.postedAtTimestamp)
        })),
        source: 'apify_real_scrape'
      });
    } else {
      res.json({
        success: false,
        message: 'Could not fetch real posts. Make sure competitor social handles are configured.',
        error: realPosts.error
      });
    }
  } catch (error) {
    console.error('Refresh competitor posts error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/dashboard/synopsis
 * Get AI-powered synopsis for a specific dashboard section using Gemini
 */
router.post('/synopsis', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId || req.user.id);
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const { section, data } = req.body;
    
    if (!section) {
      return res.status(400).json({ success: false, message: 'Section is required' });
    }

    // Use Gemini AI for synopsis generation
    const synopsis = await generateSectionSynopsis(
      section,
      data || {},
      user.businessProfile
    );

    res.json({
      success: true,
      ...synopsis
    });
  } catch (error) {
    console.error('Synopsis generation error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate synopsis', error: error.message });
  }
});

/**
 * POST /api/dashboard/generate-rival-post
 * Generate a rival post to counter a competitor's content
 */
router.post('/generate-rival-post', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId || req.user.id);
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Credit check
    await ensureCreditCycle(user);
    if (user.credits.balance < 7) {
      return res.status(403).json({ success: false, message: 'Insufficient credits', creditsRemaining: user.credits.balance, required: 7 });
    }

    const { competitorName, competitorContent, platform, sentiment, likes, comments } = req.body;
    
    if (!competitorContent) {
      return res.status(400).json({ success: false, message: 'Competitor content is required' });
    }

    console.log(`🗡️ Generating rival post to counter ${competitorName} on ${platform}`);

    // Generate the rival post using Gemini AI
    const rivalPost = await generateRivalPost(
      { competitorName, competitorContent, platform, sentiment, likes, comments },
      user.businessProfile
    );

    console.log('✅ Rival post generated successfully');

    // Deduct credits (5 image + 2 caption = 7)
    const creditResult = await deductCredits(user._id, 7, 'generate_rival_post');

    res.json({
      success: true,
      caption: rivalPost.caption,
      hashtags: rivalPost.hashtags,
      imageUrl: rivalPost.imageUrl,
      imagePrompt: rivalPost.imagePrompt || '',
      creditsRemaining: creditResult.balance
    });
  } catch (error) {
    console.error('Rival post generation error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate rival post', error: error.message });
  }
});

// Helper functions

/**
 * Calculate brand score based on REAL metrics
 */
function calculateRealBrandScore(metrics) {
  let score = 30; // Base score
  
  // Add points for campaigns
  if (metrics.campaignCount > 0) score += 10;
  if (metrics.campaignCount >= 5) score += 10;
  if (metrics.activeCampaignCount > 0) score += 10;
  
  // Add points for engagement
  if (metrics.totalImpressions > 100) score += 5;
  if (metrics.totalImpressions > 1000) score += 5;
  if (parseFloat(metrics.avgCTR) > 1) score += 5;
  if (parseFloat(metrics.avgCTR) > 3) score += 5;
  
  // Add points for competitor tracking
  if (metrics.competitorCount > 0) score += 5;
  if (metrics.competitorCount >= 3) score += 5;
  
  // Add points for influencer discovery
  if (metrics.influencerCount > 0) score += 5;
  if (metrics.influencerCount >= 5) score += 5;
  
  return Math.min(100, score);
}

/**
 * Calculate percentage change
 */
function calculateChange(current, previous) {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

function calculateBrandScore(factors) {
  if (!factors) return 50;
  
  const weights = {
    engagement: 0.3,
    consistency: 0.25,
    audienceGrowth: 0.25,
    contentQuality: 0.2
  };

  let totalScore = 0;
  let totalWeight = 0;

  for (const [key, value] of Object.entries(factors)) {
    if (weights[key] && value?.score) {
      totalScore += value.score * weights[key];
      totalWeight += weights[key];
    }
  }

  return totalWeight > 0 ? Math.round(totalScore / totalWeight) : 50;
}

/**
 * Get relative time from a date
 */
function getRelativeTime(date) {
  if (!date) return 'Recently';
  
  const now = new Date();
  const past = new Date(date);
  if (isNaN(past.getTime())) return 'Recently';
  const diffMs = now - past;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return past.toLocaleDateString();
}

/**
 * GET /api/dashboard/social-followers
 * Get follower counts for all connected social platforms - used for dashboard bar chart
 */
router.get('/social-followers', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const user = await User.findById(userId);
    
    if (!user?.ayrshare?.profileKey) {
      return res.json({
        success: true,
        platforms: [],
        message: 'No social accounts connected'
      });
    }
    
    // Platform configurations
    const platformConfig = {
      instagram: {
        name: 'Instagram',
        color: '#E4405F',
        bgColor: 'linear-gradient(135deg, #833AB4, #E1306C, #F77737)',
        logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e7/Instagram_logo_2016.svg/132px-Instagram_logo_2016.svg.png'
      },
      facebook: {
        name: 'Facebook',
        color: '#1877F2',
        bgColor: '#1877F2',
        logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/Facebook_Logo_%282019%29.png/1200px-Facebook_Logo_%282019%29.png'
      },
      twitter: {
        name: 'X',
        color: '#000000',
        bgColor: '#000000',
        logo: 'https://abs.twimg.com/responsive-web/client-web/icon-ios.77d25eba.png'
      },
      linkedin: {
        name: 'LinkedIn',
        color: '#0A66C2',
        bgColor: '#0A66C2',
        logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/ca/LinkedIn_logo_initials.png/800px-LinkedIn_logo_initials.png'
      },
      youtube: {
        name: 'YouTube',
        color: '#FF0000',
        bgColor: '#FF0000',
        logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/09/YouTube_full-color_icon_%282017%29.svg/1024px-YouTube_full-color_icon_%282017%29.svg.png'
      },
      tiktok: {
        name: 'TikTok',
        color: '#000000',
        bgColor: '#000000',
        logo: 'https://sf-tb-sg.ibytedtos.com/obj/eden-sg/uhtyvueh7nulogpoguhm/tiktok-icon2.png'
      }
    };
    
    // First get connected accounts from Ayrshare profile
    const userProfile = await getAyrshareUserProfile(user.ayrshare.profileKey);
    
    if (!userProfile.success || !userProfile.data?.activeSocialAccounts?.length) {
      return res.json({
        success: true,
        platforms: [],
        message: 'No connected accounts found'
      });
    }
    
    const connectedPlatforms = userProfile.data.activeSocialAccounts;
    const displayNames = userProfile.data.displayNames || [];
    console.log('[social-followers] Connected platforms:', connectedPlatforms);
    
    // Now try to get analytics for follower counts
    const analyticsResult = await getUserSocialAnalytics(user.ayrshare.profileKey, connectedPlatforms);
    console.log('[social-followers] Analytics result:', JSON.stringify(analyticsResult).substring(0, 500));
    
    const platformData = [];
    
    // Build platform data - show all connected platforms, with followers if available
    for (const platformKey of connectedPlatforms) {
      const config = platformConfig[platformKey];
      if (!config) continue;
      
      const displayInfo = displayNames.find(d => d.platform === platformKey);
      let followers = 0;
      
      // Try to extract followers from analytics
      if (analyticsResult.success && analyticsResult.data) {
        const platformAnalytics = analyticsResult.data[platformKey]?.analytics || analyticsResult.data[platformKey];
        
        if (platformAnalytics) {
          switch (platformKey) {
            case 'instagram':
              followers = platformAnalytics.followersCount || platformAnalytics.followers_count || 0;
              break;
            case 'facebook':
              followers = platformAnalytics.followersCount || platformAnalytics.fanCount || platformAnalytics.fan_count || 0;
              break;
            case 'twitter':
              followers = platformAnalytics.followersCount || platformAnalytics.followers_count || 0;
              break;
            case 'linkedin':
              followers = platformAnalytics.followers?.totalFollowerCount || platformAnalytics.followersCount || 0;
              break;
            default:
              followers = platformAnalytics.followersCount || platformAnalytics.followers || 0;
          }
        }
      }
      
      platformData.push({
        platform: platformKey,
        name: config.name,
        accountName: displayInfo?.username || displayInfo?.displayName || platformKey,
        followers: followers,
        color: config.color,
        bgColor: config.bgColor,
        logo: config.logo
      });
    }
    
    // Sort by followers descending (platforms with data first)
    platformData.sort((a, b) => b.followers - a.followers);
    
    res.json({
      success: true,
      platforms: platformData,
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    console.error('Social followers error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Import strategic advisor functions
const { 
  generateStrategicContentSuggestions,
  generatePostFromSuggestion,
  refineImageWithPrompt
} = require('../services/geminiAI');

/**
 * GET /api/dashboard/strategic-advisor
 * Get AI-powered strategic content suggestions based on trends, events, competitors
 */
router.get('/strategic-advisor', protect, async (req, res) => {
  try {
    const userId = req.user._id;
    
    // Get user's business context
    const context = await OnboardingContext.findOne({ userId }).lean();
    const user = await User.findById(userId).lean();
    const bp = user?.businessProfile || {};
    
    const businessProfile = {
      name: context?.company?.name || bp.name || bp.companyName || user?.companyName || 'Your Company',
      industry: context?.company?.industry || bp.industry || user?.industry || 'General',
      niche: context?.company?.description || bp.niche || '',
      targetAudience: context?.targetCustomer?.description || bp.targetAudience || user?.targetAudience || 'General consumers',
      brandVoice: context?.brandTone || bp.brandVoice || 'Professional',
      location: context?.geography?.businessLocation || bp.businessLocation || bp.location || 'India',
      businessType: bp.businessType || 'B2C'
    };
    
    // Get recent competitor posts
    const competitors = await Competitor.find({ userId, isActive: true })
      .sort({ 'posts.timestamp': -1 })
      .limit(5)
      .lean();
    
    const competitorPosts = [];
    competitors.forEach(comp => {
      if (comp.posts && comp.posts.length > 0) {
        comp.posts.slice(0, 3).forEach(post => {
          competitorPosts.push({
            competitorName: comp.name,
            content: post.content || post.caption || '',
            platform: post.platform || 'instagram',
            engagement: post.likes > 1000 ? 'high' : post.likes > 100 ? 'medium' : 'low',
            likes: post.likes,
            comments: post.comments
          });
        });
      }
    });
    
    // Generate strategic suggestions
    const suggestions = await generateStrategicContentSuggestions(
      businessProfile, 
      competitorPosts,
      new Date()
    );
    
    res.json({
      success: true,
      businessContext: businessProfile,
      ...suggestions
    });
  } catch (error) {
    console.error('Strategic advisor error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      suggestions: []
    });
  }
});

/**
 * POST /api/dashboard/strategic-advisor/generate-post
 * Generate a complete post from a content suggestion
 */
router.post('/strategic-advisor/generate-post', protect, async (req, res) => {
  try {
    const { suggestion } = req.body;
    const userId = req.user._id;
    
    if (!suggestion) {
      return res.status(400).json({ success: false, message: 'Suggestion is required' });
    }
    
    // Credit check (7 = 5 image + 2 caption)
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    await ensureCreditCycle(user);
    if (user.credits.balance < 7) {
      return res.status(403).json({ success: false, message: 'Insufficient credits', creditsRemaining: user.credits.balance, required: 7 });
    }
    
    // Get user's business context
    const context = await OnboardingContext.findOne({ userId }).lean();
    const userLean = await User.findById(userId).lean();
    
    const businessProfile = {
      name: context?.onboardingData?.companyName || userLean?.companyName || 'Your Company',
      industry: context?.onboardingData?.industry || userLean?.industry || 'General',
      brandVoice: context?.onboardingData?.brandVoice || 'Professional'
    };
    
    // Generate complete post
    const post = await generatePostFromSuggestion(suggestion, businessProfile);
    
    // Deduct credits
    const creditResult = await deductCredits(userId, 7, 'strategic_advisor_post');
    
    res.json({
      success: true,
      post,
      creditsRemaining: creditResult.balance
    });
  } catch (error) {
    console.error('Generate post error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/dashboard/strategic-advisor/refine-image
 * Refine/edit an image with a new prompt
 */
router.post('/strategic-advisor/refine-image', protect, async (req, res) => {
  try {
    const { originalPrompt, refinementPrompt, style, currentImageUrl } = req.body;
    const userId = req.user._id || req.user.userId || req.user.id;
    
    if (!originalPrompt || !refinementPrompt) {
      return res.status(400).json({ success: false, message: 'Prompts are required' });
    }
    
    // Credit check (3 for image edit)
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    await ensureCreditCycle(user);
    if (user.credits.balance < 3) {
      return res.status(403).json({ success: false, message: 'Insufficient credits', creditsRemaining: user.credits.balance, required: 3 });
    }
    
    const result = await refineImageWithPrompt(originalPrompt, refinementPrompt, style, currentImageUrl);
    
    // Deduct credits
    const creditResult = await deductCredits(userId, 3, 'refine_image');
    
    res.json({
      success: result.success,
      ...result,
      creditsRemaining: creditResult.balance
    });
  } catch (error) {
    console.error('Refine image error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/dashboard/generate-event-post
 * Generate a complete post for a holiday/festival/event
 * Combines business context with event details
 */
router.post('/generate-event-post', protect, async (req, res) => {
  try {
    const { event } = req.body;
    const userId = req.user._id;
    
    if (!event) {
      return res.status(400).json({ success: false, message: 'Event data is required' });
    }
    
    // Credit check (7 = 5 image + 2 caption)
    const creditUser = await User.findById(userId);
    if (!creditUser) return res.status(404).json({ success: false, message: 'User not found' });
    await ensureCreditCycle(creditUser);
    if (creditUser.credits.balance < 7) {
      return res.status(403).json({ success: false, message: 'Insufficient credits', creditsRemaining: creditUser.credits.balance, required: 7 });
    }
    
    // Get user's business context
    const context = await OnboardingContext.findOne({ userId }).lean();
    const user = await User.findById(userId).lean();
    
    const businessProfile = {
      name: context?.company?.name || context?.onboardingData?.companyName || user?.businessProfile?.name || user?.companyName || 'Your Company',
      industry: context?.company?.industry || context?.onboardingData?.industry || user?.businessProfile?.industry || user?.industry || 'General',
      brandVoice: context?.brandTone || context?.onboardingData?.brandVoice || user?.businessProfile?.brandVoice || 'Professional',
      description: context?.company?.description || user?.businessProfile?.description || '',
      targetAudience: context?.targetCustomer?.description || user?.businessProfile?.targetAudience || ''
    };
    
    // Generate event-specific post using Gemini
    const post = await generateEventPost(event, businessProfile);
    
    // Deduct credits
    const creditResult = await deductCredits(userId, 7, 'generate_event_post');
    
    res.json({
      success: true,
      post,
      creditsRemaining: creditResult.balance
    });
  } catch (error) {
    console.error('Generate event post error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
