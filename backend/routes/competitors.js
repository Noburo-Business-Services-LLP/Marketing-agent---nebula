/**
 * Competitor Routes
 * Add, fetch, and analyze competitors with REAL web scraping
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const Competitor = require('../models/Competitor');
const User = require('../models/User');
const ScrapeJob = require('../models/ScrapeJob');
const OnboardingContext = require('../models/OnboardingContext');
const { generateWithLLM } = require('../services/llmRouter');
const { scrapeWebsite, extractTextContent, getPageTitle } = require('../services/scraper');

// Import Gemini AI for generating competitor insights (not for posts)
const { generateCompetitorActivity } = require('../services/geminiAI');

// Import real social media API service for fetching actual posts
const {
  scrapeInstagramProfile,
  scrapeInstagramPosts,
  scrapeTwitterProfile,
  scrapeTikTokProfile,
  scrapeCompetitor,
  searchInstagramByName
} = require('../services/socialMediaAPI');

// Try to use the old services if they exist, otherwise use stubs
let callGemini, parseGeminiJSON, generatePostUrl, generateCompetitorPosts, fetchIndustryTrendingPosts;
try {
  const geminiService = require('../services/geminiAI');
  callGemini = geminiService.callGemini;
  parseGeminiJSON = geminiService.parseGeminiJSON;
} catch (e) {
  callGemini = async (prompt) => {
    const result = await generateWithLLM({ provider: 'gemini', prompt, taskType: 'analysis' });
    return result.text;
  };
  parseGeminiJSON = (text) => {
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1] || jsonMatch[0]);
    }
    return JSON.parse(text);
  };
}

try {
  const fetcher = require('../services/socialMediaFetcher');
  generatePostUrl = fetcher.generatePostUrl;
  generateCompetitorPosts = fetcher.generateCompetitorPosts;
  fetchIndustryTrendingPosts = fetcher.fetchIndustryTrendingPosts;
} catch (e) {
  generatePostUrl = (platform, handle) => `https://${platform}.com/${handle}`;
  generateCompetitorPosts = async () => [];
  fetchIndustryTrendingPosts = async () => [];
}

/**
 * POST /api/competitors/auto-discover
 * Discover 12-15 competitors using AI - SIMPLE AND RELIABLE
 */
router.post('/auto-discover', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const user = await User.findById(userId);
    const { forceRefresh = false } = req.body;

    console.log('🔍 ===========================================');
    console.log('🔍 AUTO-DISCOVER COMPETITORS');
    console.log('🔍 User:', userId);
    console.log('🔍 ===========================================');

    // Get business context from OnboardingContext
    const onboardingContext = await OnboardingContext.findOne({ userId });
    const bp = user?.businessProfile || {};

    // Build business context
    const websiteUrl = onboardingContext?.company?.website || bp.website;
    
    const businessContext = {
      companyName: onboardingContext?.company?.name || bp.name || bp.companyName || 'Your Business',
      industry: onboardingContext?.company?.industry || bp.industry || 'General',
      description: onboardingContext?.company?.description || bp.niche || bp.description || '',
      targetCustomer: onboardingContext?.targetCustomer?.description || bp.targetAudience || '',
      location: onboardingContext?.geography?.businessLocation || onboardingContext?.geography?.regions?.[0] || bp.businessLocation || 'Global',
      website: websiteUrl || ''
    };

    console.log('📋 Business Context:', JSON.stringify(businessContext, null, 2));

    if (!businessContext.industry || businessContext.industry === 'General') {
      return res.status(400).json({
        success: false,
        message: 'Please complete your onboarding first to discover competitors'
      });
    }

    // Check for recent cached competitors (unless force refresh)
    if (!forceRefresh) {
      const existingCompetitors = await Competitor.find({
        userId,
        isAutoDiscovered: true,
        createdAt: { $gte: new Date(Date.now() - 12 * 60 * 60 * 1000) } // Last 12 hours
      });

      if (existingCompetitors.length >= 10) {
        console.log('📦 Returning cached competitors:', existingCompetitors.length);
        const posts = await getCompetitorPosts(existingCompetitors);
        return res.json({
          success: true,
          competitors: existingCompetitors,
          posts,
          cached: true,
          message: `Found ${existingCompetitors.length} competitors`
        });
      }
    }

    // Delete old auto-discovered competitors
    const deleted = await Competitor.deleteMany({ userId, isAutoDiscovered: true });
    console.log(`🗑️ Deleted ${deleted.deletedCount} old competitors`);

    // SIMPLE, RELIABLE competitor discovery prompt
    const prompt = `You are a market research expert. Find competitors for this business.

BUSINESS:
- Company: ${businessContext.companyName}
- Industry: ${businessContext.industry}
- Description: ${businessContext.description || 'Not provided'}
- Target Customer: ${businessContext.targetCustomer || 'Not specified'}
- Location: ${businessContext.location}
- Website: ${businessContext.website || 'Not provided'}

FIND 15 REAL COMPETITORS that offer similar products/services.

Include this mix:
- 4 LOCAL competitors (same region as ${businessContext.location})
- 5 NATIONAL competitors (major players in the country)
- 3 GLOBAL competitors (international leaders)
- 3 STARTUPS (emerging players)

For each competitor, provide:
- Real company name
- Real website URL
- Real Instagram handle (without @)
- Real Twitter handle (without @)
- Brief description
- Their location
- Type (local/national/global/startup)

RETURN THIS JSON:
{
  "competitors": [
    {
      "name": "Company Name",
      "website": "https://company.com",
      "instagram": "companyhandle",
      "twitter": "companyhandle",
      "description": "What they do",
      "location": "City, Country",
      "competitorType": "local|national|global|startup",
      "estimatedFollowers": 10000
    }
  ]
}

IMPORTANT: All 15 competitors must be REAL companies that exist. Return only valid JSON.`;

    console.log('📤 Calling Gemini for competitor discovery...');
    
    const response = await callGemini(prompt, { maxTokens: 4000, skipCache: true });
    const parsed = parseGeminiJSON(response);

    if (!parsed || !parsed.competitors || !Array.isArray(parsed.competitors)) {
      console.error('❌ Failed to parse Gemini response');
      console.log('Raw response:', response?.substring(0, 500));
      return res.status(500).json({
        success: false,
        message: 'Failed to discover competitors. Please try again.'
      });
    }

    console.log(`✅ Gemini returned ${parsed.competitors.length} competitors`);

    // Save competitors to database
    const savedCompetitors = [];
    for (const comp of parsed.competitors) {
      if (!comp.name || comp.name.length < 2) continue;

      try {
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
        console.log(`✅ Saved: ${comp.name}`);
      } catch (saveError) {
        console.error(`❌ Error saving ${comp.name}:`, saveError.message);
      }
    }

    console.log(`🎯 Total competitors saved: ${savedCompetitors.length}`);

    // Fetch posts for competitors (in background, don't wait)
    fetchPostsForCompetitors(savedCompetitors).catch(err => 
      console.error('Background post fetch error:', err.message)
    );

    res.json({
      success: true,
      competitors: savedCompetitors,
      posts: [],
      discovered: savedCompetitors.length,
      message: `Discovered ${savedCompetitors.length} competitors for ${businessContext.companyName}`
    });

  } catch (error) {
    console.error('❌ Competitor auto-discovery error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to discover competitors',
      error: error.message
    });
  }
});

// NOTE: scrapeBusinessFromWebsite, makerAgentDiscoverCompetitors, and checkerAgentValidateCompetitors
// have been replaced by the simpler single-prompt discovery in /auto-discover route

/**
 * Check if text is primarily English (Latin characters)
 */
function isEnglishContent(text) {
  if (!text || text.length < 10) return true; // Short or empty text passes
  
  // Count Latin vs non-Latin characters
  const latinChars = (text.match(/[a-zA-Z]/g) || []).length;
  const nonLatinChars = (text.match(/[^\x00-\x7F]/g) || []).length;
  
  // If more than 30% is non-Latin, consider it non-English
  const totalChars = latinChars + nonLatinChars;
  if (totalChars === 0) return true;
  
  const nonLatinRatio = nonLatinChars / totalChars;
  return nonLatinRatio < 0.3;
}

/**
 * Smart Instagram handle finder
 * Tries the given handle first, then name-based variations if it fails
 * Updates the competitor's handle in DB once found so future scrapes work
 */
async function findInstagramProfile(competitor) {
  const handles = competitor.socialHandles || {};
  const givenHandle = handles.instagram?.replace('@', '');
  
  // STEP 1: Try the given handle first (fastest)
  if (givenHandle) {
    try {
      console.log(`  🔎 Trying given handle @${givenHandle} for ${competitor.name}...`);
      const result = await scrapeInstagramProfile(givenHandle);
      if (result?.success && result?.data?.length > 0) {
        const posts = result.data[0].latestPosts || result.data[0].posts || [];
        if (posts.length > 0) {
          console.log(`  ✅ @${givenHandle} works! ${posts.length} posts found.`);
          return { result, handle: givenHandle };
        }
      }
    } catch (err) {
      console.log(`  ⚠️ @${givenHandle} failed: ${err.message}`);
    }
  }

  // STEP 2: Search Instagram by business name (universal, works for ANY business)
  try {
    const searchResult = await searchInstagramByName(competitor.name);
    if (searchResult?.success && searchResult?.username) {
      const foundHandle = searchResult.username;
      console.log(`  🔍 Search found @${foundHandle} for ${competitor.name}, fetching profile...`);
      
      const result = await scrapeInstagramProfile(foundHandle);
      if (result?.success && result?.data?.length > 0) {
        const posts = result.data[0].latestPosts || result.data[0].posts || [];
        if (posts.length > 0) {
          console.log(`  ✅ @${foundHandle} confirmed! ${posts.length} posts. Updating DB handle.`);
          await Competitor.findByIdAndUpdate(competitor._id, {
            'socialHandles.instagram': foundHandle
          });
          return { result, handle: foundHandle };
        }
      }
    }
  } catch (err) {
    console.log(`  ⚠️ Instagram search failed for ${competitor.name}: ${err.message}`);
  }

  // STEP 3: Quick name-based variations as last resort
  const nameCleaned = competitor.name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const quickVariations = [
    nameCleaned,
    'the' + nameCleaned,
    nameCleaned + '_official',
  ].filter(v => v && v !== givenHandle && v.length >= 3 && v.length <= 30);

  for (const handle of quickVariations.slice(0, 2)) {
    try {
      console.log(`  🔎 Trying variation @${handle}...`);
      const result = await scrapeInstagramProfile(handle);
      if (result?.success && result?.data?.length > 0) {
        const posts = result.data[0].latestPosts || result.data[0].posts || [];
        if (posts.length > 0) {
          console.log(`  ✅ @${handle} works! Updating DB handle.`);
          await Competitor.findByIdAndUpdate(competitor._id, {
            'socialHandles.instagram': handle
          });
          return { result, handle };
        }
      }
    } catch (err) { /* skip */ }
  }

  console.log(`  ❌ No working Instagram found for ${competitor.name}`);
  return null;
}

/**
 * Fetch posts for a list of competitors
 * Only keeps English-language posts from verified brands
 * CRITICAL: Only posts from the last 3 months are allowed - NO older posts
 */
async function fetchPostsForCompetitors(competitors) {
  const allPosts = [];
  const threeMonthsAgo = Date.now() - (90 * 24 * 60 * 60 * 1000);
  console.log(`📅 3-month threshold: ${new Date(threeMonthsAgo).toLocaleDateString()}`);

  for (const competitor of competitors.slice(0, 5)) {
    try {
      console.log(`📸 Finding Instagram for ${competitor.name}...`);
      const found = await findInstagramProfile(competitor);
      
      if (!found) continue;
      
      const profile = found.result.data[0];
      const latestPosts = profile.latestPosts || profile.posts || [];
      const posts = processAndSavePosts(latestPosts, competitor, threeMonthsAgo);
      
      if (posts.length > 0) {
        await Competitor.findByIdAndUpdate(competitor._id, { posts });
        allPosts.push(...posts);
        console.log(`✅ Saved ${posts.length} REAL posts for ${competitor.name}`);
      }
    } catch (fetchError) {
      console.error(`Failed for ${competitor.name}:`, fetchError.message);
    }
  }

  return allPosts;
}

/**
 * Process raw Instagram posts: filter English, recent, map fields, limit to 5
 */
function processAndSavePosts(latestPosts, competitor, threeMonthsAgo) {
  const englishPosts = latestPosts.filter(post =>
    isEnglishContent(post.caption || post.text || post.description || '')
  );

  const mappedPosts = englishPosts.map(post => {
    const timestamp = new Date(post.timestamp || post.takenAtTimestamp * 1000 || post.date || Date.now()).getTime();
    return {
      platform: 'instagram',
      content: post.caption || post.text || post.description || '',
      likes: post.likesCount || post.likes || 0,
      comments: post.commentsCount || post.comments || 0,
      imageUrl: post.displayUrl || post.imageUrl || post.thumbnailUrl || null,
      postUrl: post.url || post.postUrl || `https://instagram.com/p/${post.shortCode || post.id || ''}`,
      postedAt: post.timestamp || post.takenAtTimestamp || post.date || new Date(),
      postedAtTimestamp: timestamp,
      sentiment: analyzeSentiment(post.caption || ''),
      isRealData: true
    };
  });

  const recentPosts = threeMonthsAgo
    ? mappedPosts.filter(p => p.postedAtTimestamp >= threeMonthsAgo)
    : mappedPosts;

  return recentPosts.slice(0, 5);
}

/**
 * Get posts from existing competitors
 */
async function getCompetitorPosts(competitors) {
  const allPosts = [];
  for (const comp of competitors) {
    if (comp.posts && comp.posts.length > 0) {
      allPosts.push(...comp.posts.map(post => ({
        ...post.toObject ? post.toObject() : post,
        competitorName: comp.name
      })));
    }
  }
  return allPosts;
}

/**
 * Simple sentiment analysis
 */
function analyzeSentiment(text) {
  if (!text) return 'neutral';
  const positiveWords = ['amazing', 'beautiful', 'luxury', 'premium', 'excellent', 'love', 'best', 'happy', 'great', 'wonderful'];
  const negativeWords = ['bad', 'worst', 'terrible', 'poor', 'disappointed', 'hate', 'awful'];
  
  const lowerText = text.toLowerCase();
  const positiveCount = positiveWords.filter(w => lowerText.includes(w)).length;
  const negativeCount = negativeWords.filter(w => lowerText.includes(w)).length;
  
  if (positiveCount > negativeCount) return 'positive';
  if (negativeCount > positiveCount) return 'negative';
  return 'neutral';
}

/**
 * PUT /api/competitors/:id/ignore
 * Ignore a competitor (hide from view)
 */
router.put('/:id/ignore', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const competitor = await Competitor.findOneAndUpdate(
      { _id: req.params.id, userId },
      { isIgnored: true },
      { new: true }
    );
    
    if (!competitor) {
      return res.status(404).json({ success: false, message: 'Competitor not found' });
    }
    
    console.log(`🚫 Ignored competitor: ${competitor.name}`);
    res.json({ success: true, message: `${competitor.name} has been ignored`, competitor });
  } catch (error) {
    console.error('Error ignoring competitor:', error);
    res.status(500).json({ success: false, message: 'Failed to ignore competitor' });
  }
});

/**
 * PUT /api/competitors/:id/unignore
 * Unignore a competitor (show again)
 */
router.put('/:id/unignore', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const competitor = await Competitor.findOneAndUpdate(
      { _id: req.params.id, userId },
      { isIgnored: false },
      { new: true }
    );
    
    if (!competitor) {
      return res.status(404).json({ success: false, message: 'Competitor not found' });
    }
    
    console.log(`✅ Unignored competitor: ${competitor.name}`);
    res.json({ success: true, message: `${competitor.name} is now visible`, competitor });
  } catch (error) {
    console.error('Error unignoring competitor:', error);
    res.status(500).json({ success: false, message: 'Failed to unignore competitor' });
  }
});

/**
 * GET /api/competitors/ignored
 * Get all ignored competitors
 */
router.get('/ignored', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const competitors = await Competitor.find({ userId, isIgnored: true })
      .select('name industry location socialHandles')
      .sort({ updatedAt: -1 });
    
    res.json({ success: true, competitors });
  } catch (error) {
    console.error('Error fetching ignored competitors:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch ignored competitors' });
  }
});

/**
 * GET /api/competitors/real/:id
 * Fetch REAL-TIME social media data for a competitor using Apify
 */
router.get('/real/:id', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const competitor = await Competitor.findOne({ _id: req.params.id, userId });
    
    if (!competitor) {
      return res.status(404).json({ success: false, message: 'Competitor not found' });
    }
    
    const { platform = 'instagram' } = req.query;
    const handles = competitor.socialHandles || {};
    const handle = handles[platform]?.replace('@', '') || handles.instagram?.replace('@', '');
    
    if (!handle) {
      return res.status(400).json({ 
        success: false, 
        message: `No ${platform} handle found for this competitor` 
      });
    }
    
    let realData = null;
    
    try {
      console.log(`📸 Fetching REAL data for ${competitor.name} (@${handle}) on ${platform}...`);
      
      switch (platform) {
        case 'instagram':
          realData = await scrapeInstagramProfile(handle);
          break;
        case 'twitter':
          realData = await scrapeTwitterProfile(handle);
          break;
        case 'tiktok':
          realData = await scrapeTikTokProfile(handle);
          break;
        default:
          realData = await scrapeInstagramProfile(handle);
      }
      
      // Update competitor with real data if successful
      // Apify returns { success: true, data: [profile] } where profile has latestPosts
      if (realData && realData.success && realData.data && realData.data.length > 0) {
        const profile = realData.data[0];
        const latestPosts = profile.latestPosts || profile.posts || [];
        
        const updateData = {
          'metrics.realTimeData': profile,
          'metrics.lastFetched': new Date()
        };
        
        // If we got posts, add them
        if (latestPosts.length > 0) {
          const newPosts = latestPosts.map(post => ({
            platform,
            content: post.caption || post.text || post.description || '',
            likes: post.likesCount || post.likes || 0,
            comments: post.commentsCount || post.comments || 0,
            shares: post.shares || post.sharesCount || 0,
            imageUrl: post.displayUrl || post.imageUrl || post.thumbnailUrl || null,
            postUrl: post.url || post.postUrl || `https://instagram.com/p/${post.shortCode || post.id || ''}`,
            postedAt: post.timestamp || post.takenAtTimestamp || post.date || new Date(),
            postedAtTimestamp: new Date(post.timestamp || post.takenAtTimestamp * 1000 || post.date || Date.now()).getTime(),
            fetchedAt: new Date(),
            isRealData: true
          }));
          
          // Merge with existing posts (avoiding duplicates by URL)
          const existingUrls = new Set((competitor.posts || []).map(p => p.postUrl).filter(Boolean));
          const uniqueNewPosts = newPosts.filter(p => !existingUrls.has(p.postUrl));
          
          if (uniqueNewPosts.length > 0) {
            competitor.posts = [...uniqueNewPosts, ...(competitor.posts || [])].slice(0, 50);
          }
        }
        
        // Update follower counts
        if (profile.followersCount || profile.followers) {
          competitor.metrics = competitor.metrics || {};
          competitor.metrics.followers = profile.followersCount || profile.followers;
          competitor.metrics.following = profile.followingCount || profile.following;
          competitor.metrics.posts = profile.postsCount || profile.posts?.length;
        }
        
        await competitor.save();
        
        res.json({
          success: true,
          platform,
          handle,
          realData,
          competitor,
          message: 'Real-time data fetched successfully'
        });
      } else {
        res.json({
          success: false,
          message: realData?.error || 'Failed to fetch real-time data',
          fallback: competitor
        });
      }
    } catch (apiError) {
      console.error('Apify API error:', apiError);
      res.json({
        success: false,
        message: 'API rate limited or unavailable',
        fallback: competitor
      });
    }
  } catch (error) {
    console.error('Real competitor fetch error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/competitors/scrape-by-type
 * Scrape posts for competitors of a specific type (local, national, global, etc.)
 */
router.post('/scrape-by-type', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { competitorType } = req.body;
    
    if (!competitorType) {
      return res.status(400).json({ success: false, message: 'competitorType is required' });
    }

    console.log(`🔍 Scraping posts for ${competitorType} competitors...`);
    
    // Find competitors of this type that have NO posts yet
    const competitors = await Competitor.find({ 
      userId, 
      isActive: true, 
      isIgnored: { $ne: true },
      competitorType,
      $or: [
        { posts: { $exists: false } },
        { posts: { $size: 0 } }
      ]
    });

    if (competitors.length === 0) {
      // All competitors of this type already have posts, return them
      const allOfType = await Competitor.find({ userId, isActive: true, isIgnored: { $ne: true }, competitorType });
      const posts = [];
      allOfType.forEach(c => {
        if (c.posts && c.posts.length > 0) {
          c.posts.forEach(p => {
            posts.push({
              ...p.toObject ? p.toObject() : p,
              competitorName: c.name,
              competitorId: c._id,
              competitorType: c.competitorType
            });
          });
        }
      });
      return res.json({ success: true, posts, scraped: 0, message: 'All competitors already have posts' });
    }

    console.log(`📋 Found ${competitors.length} ${competitorType} competitors without posts`);

    const results = [];
    const threeMonthsAgo = Date.now() - (90 * 24 * 60 * 60 * 1000);

    for (const competitor of competitors.slice(0, 7)) {
      try {
        console.log(`📸 Finding Instagram for ${competitor.name}...`);
        const found = await findInstagramProfile(competitor);
        
        if (found) {
          const profile = found.result.data[0];
          const latestPosts = profile.latestPosts || profile.posts || [];
          const posts = processAndSavePosts(latestPosts, competitor, threeMonthsAgo);
          
          if (posts.length > 0) {
            await Competitor.findByIdAndUpdate(competitor._id, { posts });
            results.push({ name: competitor.name, success: true, postsCount: posts.length, handle: found.handle });
            console.log(`✅ Saved ${posts.length} REAL posts for ${competitor.name} (@${found.handle})`);
          } else {
            results.push({ name: competitor.name, success: false, error: 'Profile found but 0 recent English posts' });
          }
        } else {
          results.push({ name: competitor.name, success: false, error: 'No working Instagram handle found' });
        }
      } catch (err) {
        results.push({ name: competitor.name, success: false, error: err.message });
        console.error(`❌ Failed for ${competitor.name}:`, err.message);
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Now return ALL posts for this type
    const allOfType = await Competitor.find({ userId, isActive: true, isIgnored: { $ne: true }, competitorType });
    const allPosts = [];
    allOfType.forEach(c => {
      if (c.posts && c.posts.length > 0) {
        c.posts.forEach(p => {
          allPosts.push({
            id: p._id,
            competitorId: c._id,
            competitorName: c.name,
            competitorLogo: c.logo || c.name.charAt(0).toUpperCase(),
            competitorType: c.competitorType,
            platform: p.platform,
            content: p.content,
            imageUrl: p.imageUrl,
            postUrl: p.postUrl,
            likes: p.likes,
            comments: p.comments,
            sentiment: p.sentiment,
            postedAt: formatTimeAgo(p.postedAt)
          });
        });
      }
    });

    res.json({
      success: true,
      posts: allPosts,
      scraped: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results,
      message: `Fetched posts for ${results.filter(r => r.success).length} ${competitorType} competitors`
    });
  } catch (error) {
    console.error('Scrape by type error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/competitors/scrape-all
 * Scrape real-time data for all active competitors using Apify
 */
router.post('/scrape-all', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const competitors = await Competitor.find({ userId, isActive: true });
    
    const results = [];
    
    for (const competitor of competitors.slice(0, 5)) { // Limit to 5 to avoid rate limits
      const handles = competitor.socialHandles || {};
      const handle = handles.instagram?.replace('@', '') || handles.twitter?.replace('@', '');
      
      if (handle) {
        try {
          console.log(`📸 Fetching REAL data for ${competitor.name} (@${handle})...`);
          const result = await scrapeInstagramProfile(handle);
          
          // Apify returns { success: true, data: [profile] } where profile has latestPosts
          if (result && result.success && result.data && result.data.length > 0) {
            const profile = result.data[0];
            const latestPosts = profile.latestPosts || profile.posts || [];
            
            // Update competitor with real posts
            competitor.posts = latestPosts.slice(0, 5).map(post => ({
              platform: 'instagram',
              content: post.caption || post.text || post.description || '',
              likes: post.likesCount || post.likes || 0,
              comments: post.commentsCount || post.comments || 0,
              imageUrl: post.displayUrl || post.imageUrl || null,
              postUrl: post.url || post.postUrl || `https://instagram.com/p/${post.shortCode || ''}`,
              postedAt: post.timestamp || post.takenAtTimestamp || new Date(),
              postedAtTimestamp: new Date(post.timestamp || post.takenAtTimestamp * 1000 || Date.now()).getTime(),
              isRealData: true
            }));
            
            await competitor.save();
            
            results.push({
              competitorId: competitor._id,
              name: competitor.name,
              success: true,
              postsCount: competitor.posts.length
            });
          } else {
            results.push({
              competitorId: competitor._id,
              name: competitor.name,
              success: false,
              error: result?.error || 'No data returned'
            });
          }
        } catch (err) {
          results.push({
            competitorId: competitor._id,
            name: competitor.name,
            success: false,
            error: err.message
          });
        }
      }
      
      // Small delay between requests to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    res.json({
      success: true,
      scraped: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results
    });
  } catch (error) {
    console.error('Scrape all error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/competitors
 * Get all competitors for the user (excluding ignored ones by default)
 */
router.get('/', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { active, includeIgnored } = req.query;
    
    const query = { userId };
    if (active !== undefined) {
      query.isActive = active === 'true';
    }
    // Exclude ignored competitors by default
    if (includeIgnored !== 'true') {
      query.isIgnored = { $ne: true };
    }
    
    const competitors = await Competitor.find(query).sort({ createdAt: -1 });
    
    res.json({
      success: true,
      competitors
    });
  } catch (error) {
    console.error('Get competitors error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch competitors', error: error.message });
  }
});

/**
 * GET /api/competitors/posts
 * Get all competitor posts (for the feed), excluding ignored competitors
 */
router.get('/posts', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { platform, sentiment, days = 7 } = req.query;
    
    // Exclude ignored competitors from posts feed
    const competitors = await Competitor.find({ userId, isActive: true, isIgnored: { $ne: true } });
    
    // Flatten all posts from all competitors
    let allPosts = [];
    competitors.forEach(competitor => {
      if (competitor.posts && competitor.posts.length > 0) {
        competitor.posts.forEach(post => {
          allPosts.push({
            id: post._id,
            competitorId: competitor._id,
            competitorName: competitor.name,
            competitorLogo: competitor.logo || competitor.name.charAt(0).toUpperCase(),
            competitorType: competitor.competitorType || 'unknown',
            platform: post.platform,
            content: post.content,
            imageUrl: post.imageUrl,
            postUrl: post.postUrl,
            likes: post.likes,
            comments: post.comments,
            shares: post.shares,
            sentiment: post.sentiment,
            postedAt: post.postedAt,
            fetchedAt: post.fetchedAt
          });
        });
      }
    });
    
    // Filter by platform if specified
    if (platform) {
      allPosts = allPosts.filter(p => p.platform === platform);
    }
    
    // Filter by sentiment if specified
    if (sentiment) {
      allPosts = allPosts.filter(p => p.sentiment === sentiment);
    }
    
    // Sort by posted date (most recent first)
    allPosts.sort((a, b) => new Date(b.postedAt) - new Date(a.postedAt));
    
    // Format postedAt for display
    allPosts = allPosts.map(post => ({
      ...post,
      postedAt: formatTimeAgo(post.postedAt)
    }));
    
    // Return competitors list (with competitorType) alongside posts
    const competitorsList = competitors.map(c => ({
      _id: c._id,
      name: c.name,
      logo: c.logo,
      competitorType: c.competitorType || 'unknown',
      website: c.website,
      isActive: c.isActive
    }));

    res.json({
      success: true,
      posts: allPosts,
      competitors: competitorsList
    });
  } catch (error) {
    console.error('Get competitor posts error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch posts', error: error.message });
  }
});

/**
 * POST /api/competitors
 * Add a new competitor with real website scraping
 */
router.post('/', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { website, name } = req.body;
    
    let scrapedData = {};
    let scrapeJob = null;
    
    // If website provided, scrape it for real data
    if (website) {
      try {
        // Create scrape job
        scrapeJob = new ScrapeJob({
          userId,
          type: 'competitor_website',
          targetUrls: [website],
          status: 'running'
        });
        await scrapeJob.save();
        
        console.log(`📡 Scraping competitor website: ${website}`);
        const scrapedContent = await scrapeWebsite(website);
        
        if (scrapedContent) {
          const textContent = extractTextContent(scrapedContent);
          const pageTitle = getPageTitle(scrapedContent);
          
          // Use Gemini to analyze the scraped content
          const analysisPrompt = `Analyze this competitor website content and extract key information:

Website: ${website}
Title: ${pageTitle}
Content (truncated): ${textContent.substring(0, 3000)}

Extract and return as JSON:
{
  "companyName": "extracted or derived company name",
  "industry": "detected industry",
  "description": "brief company description",
  "products": ["list of products/services mentioned"],
  "valuePropositions": ["key value propositions"],
  "targetAudience": "detected target audience",
  "brandVoice": "detected brand voice/tone",
  "socialHandles": {
    "instagram": "handle if found",
    "twitter": "handle if found",
    "linkedin": "handle if found"
  }
}`;

          const analysis = await generateWithLLM({
            provider: 'gemini',
            prompt: analysisPrompt,
            taskType: 'analysis',
            jsonSchema: { type: 'object' }
          });
          
          if (analysis.json) {
            scrapedData = analysis.json;
          }
          
          // Update scrape job
          scrapeJob.status = 'completed';
          scrapeJob.results = [{ url: website, content: textContent.substring(0, 5000), title: pageTitle }];
          await scrapeJob.save();
        }
      } catch (scrapeError) {
        console.error('Website scraping failed:', scrapeError);
        if (scrapeJob) {
          scrapeJob.status = 'failed';
          scrapeJob.errors = [{ url: website, error: scrapeError.message }];
          await scrapeJob.save();
        }
      }
    }
    
    const competitorData = {
      ...req.body,
      userId,
      // Use scraped data if available
      name: name || scrapedData.companyName || 'Unknown Competitor',
      industry: req.body.industry || scrapedData.industry,
      description: req.body.description || scrapedData.description,
      socialHandles: req.body.socialHandles || scrapedData.socialHandles,
      metadata: {
        scrapedAt: website ? new Date() : null,
        scrapeJobId: scrapeJob?._id,
        analyzedData: scrapedData
      }
    };
    
    const competitor = new Competitor(competitorData);
    await competitor.save();
    
    // Also add to user's businessProfile competitors list
    await User.findByIdAndUpdate(userId, {
      $addToSet: { 'businessProfile.competitors': competitor.name }
    });
    
    res.status(201).json({ 
      success: true, 
      competitor,
      scraped: !!website,
      scrapedData: Object.keys(scrapedData).length > 0 ? scrapedData : null
    });
  } catch (error) {
    console.error('Add competitor error:', error);
    res.status(500).json({ success: false, message: 'Failed to add competitor', error: error.message });
  }
});

/**
 * POST /api/competitors/:id/posts
 * Add a post to a competitor (manual entry)
 */
router.post('/:id/posts', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    
    const competitor = await Competitor.findOne({ _id: req.params.id, userId });
    
    if (!competitor) {
      return res.status(404).json({ success: false, message: 'Competitor not found' });
    }
    
    const postData = {
      ...req.body,
      fetchedAt: new Date()
    };
    
    competitor.posts.push(postData);
    await competitor.save();
    
    res.json({ success: true, competitor });
  } catch (error) {
    console.error('Add post error:', error);
    res.status(500).json({ success: false, message: 'Failed to add post', error: error.message });
  }
});

/**
 * PUT /api/competitors/:id
 * Update a competitor
 */
router.put('/:id', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    
    const competitor = await Competitor.findOneAndUpdate(
      { _id: req.params.id, userId },
      { $set: req.body },
      { new: true, runValidators: true }
    );
    
    if (!competitor) {
      return res.status(404).json({ success: false, message: 'Competitor not found' });
    }
    
    res.json({ success: true, competitor });
  } catch (error) {
    console.error('Update competitor error:', error);
    res.status(500).json({ success: false, message: 'Failed to update competitor', error: error.message });
  }
});

/**
 * DELETE /api/competitors/:id
 * Delete a competitor
 */
router.delete('/:id', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    
    const competitor = await Competitor.findOneAndDelete({ _id: req.params.id, userId });
    
    if (!competitor) {
      return res.status(404).json({ success: false, message: 'Competitor not found' });
    }
    
    res.json({ success: true, message: 'Competitor deleted' });
  } catch (error) {
    console.error('Delete competitor error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete competitor', error: error.message });
  }
});

/**
 * POST /api/competitors/seed-sample
 * Generate AI-powered competitor data personalized to user's industry
 */
router.post('/seed-sample', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const user = await User.findById(userId);
    
    // Check if user already has competitors
    const existingCount = await Competitor.countDocuments({ userId });
    if (existingCount > 0) {
      return res.json({ success: true, message: 'Competitors already exist' });
    }
    
    // Get user's business profile
    const bp = user?.businessProfile || {};
    const industry = bp.industry || 'Technology';
    const niche = bp.niche || '';
    const businessType = bp.businessType || 'B2C';
    const businessName = bp.name || 'Your Business';
    
    // Use Gemini to generate realistic competitor data
    const prompt = `Generate 3 realistic competitor profiles for a ${businessType} business in the ${industry} industry${niche ? ` (niche: ${niche})` : ''}.

For each competitor, provide:
1. A realistic company name (NOT real companies, but plausible sounding names)
2. Website URL format (use example.com domain)
3. Social media handles
4. 2-3 sample social media posts with realistic engagement

Return ONLY valid JSON in this exact format:
{
  "competitors": [
    {
      "name": "Company Name",
      "website": "https://companyname.example.com",
      "socialHandles": {
        "instagram": "@handle",
        "twitter": "@handle",
        "linkedin": "company-name"
      },
      "posts": [
        {
          "platform": "instagram",
          "content": "Post content here with hashtags",
          "likes": 1234,
          "comments": 56,
          "shares": 12,
          "sentiment": "positive",
          "postUrl": "https://instagram.com/p/example123"
        }
      ]
    }
  ]
}`;

    try {
      const response = await callGemini(prompt, { maxTokens: 2000 });
      const data = parseGeminiJSON(response);
      
      if (data.competitors && Array.isArray(data.competitors)) {
        const competitorsToSave = data.competitors.map(c => ({
          userId,
          name: c.name,
          industry: industry,
          website: c.website,
          socialHandles: c.socialHandles,
          logo: c.name.charAt(0).toUpperCase(),
          posts: (c.posts || []).map(p => ({
            ...p,
            postedAt: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000),
            fetchedAt: new Date()
          }))
        }));
        
        await Competitor.insertMany(competitorsToSave);
        return res.json({ success: true, message: 'AI-generated competitors added', count: competitorsToSave.length });
      }
    } catch (aiError) {
      console.error('AI generation failed, using fallback:', aiError);
    }
    
    // Fallback to template-based generation
    const sampleCompetitors = generateIndustryCompetitors(userId, industry, niche, businessType);
    await Competitor.insertMany(sampleCompetitors);
    
    res.json({ success: true, message: 'Sample competitors added', count: sampleCompetitors.length });
  } catch (error) {
    console.error('Seed sample error:', error);
    res.status(500).json({ success: false, message: 'Failed to seed sample data', error: error.message });
  }
});

/**
 * POST /api/competitors/analyze
 * Use AI to analyze a competitor's strategy
 */
router.post('/analyze', protect, async (req, res) => {
  try {
    const { competitorId } = req.body;
    const userId = req.user.userId || req.user.id;
    
    const competitor = await Competitor.findOne({ _id: competitorId, userId });
    const user = await User.findById(userId);
    
    if (!competitor) {
      return res.status(404).json({ success: false, message: 'Competitor not found' });
    }
    
    const bp = user?.businessProfile || {};
    
    const prompt = `Analyze this competitor for a ${bp.businessType || 'B2C'} business in ${bp.industry || 'the'} industry:

Competitor: ${competitor.name}
Website: ${competitor.website}
Recent posts: ${JSON.stringify(competitor.posts?.slice(0, 5) || [])}

Provide analysis in JSON format:
{
  "strengths": ["strength1", "strength2"],
  "weaknesses": ["weakness1", "weakness2"],
  "contentStrategy": "Brief description of their content strategy",
  "engagementPatterns": "How they engage with audience",
  "recommendations": ["recommendation1", "recommendation2"],
  "threatLevel": "low|medium|high"
}`;

    const response = await callGemini(prompt, { maxTokens: 1000 });
    const analysis = parseGeminiJSON(response);
    
    res.json({
      success: true,
      competitor: competitor.name,
      analysis
    });
  } catch (error) {
    console.error('Competitor analysis error:', error);
    res.status(500).json({ success: false, message: 'Failed to analyze competitor', error: error.message });
  }
});

/**
 * POST /api/competitors/:id/refresh-posts
 * Refresh/fetch new REAL posts for a specific competitor using Instagram Apify
 */
router.post('/:id/refresh-posts', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const competitor = await Competitor.findOne({ _id: req.params.id, userId });
    
    if (!competitor) {
      return res.status(404).json({ success: false, message: 'Competitor not found' });
    }
    
    const instagramHandle = competitor.socialHandles?.instagram;
    
    if (!instagramHandle) {
      return res.status(400).json({ 
        success: false, 
        message: 'No Instagram handle found for this competitor' 
      });
    }
    
    // Fetch REAL Instagram posts via Apify
    console.log(`📸 Refreshing real Instagram posts for ${competitor.name} (@${instagramHandle})...`);
    const result = await scrapeInstagramProfile(instagramHandle);
    
    // Apify returns { success: true, data: [profile] } where profile has latestPosts
    if (result && result.success && result.data && result.data.length > 0) {
      const profile = result.data[0];
      const latestPosts = profile.latestPosts || profile.posts || [];
      
      if (latestPosts.length > 0) {
        const newPosts = latestPosts.map(post => ({
          platform: 'instagram',
          content: post.caption || post.text || post.description || '',
          likes: post.likesCount || post.likes || 0,
          comments: post.commentsCount || post.comments || 0,
          shares: post.shares || 0,
          imageUrl: post.displayUrl || post.imageUrl || post.thumbnailUrl || null,
          postUrl: post.url || `https://instagram.com/p/${post.shortCode || post.id || ''}`,
          postedAt: new Date(post.timestamp * 1000 || post.takenAtTimestamp * 1000 || Date.now()),
          fetchedAt: new Date(),
          isRealData: true
        }));
      
        // Update follower count if available
        if (profile.followersCount || profile.followers) {
          competitor.metrics.followers = profile.followersCount || profile.followers;
        }
      
        competitor.posts = newPosts;
        competitor.metrics.lastFetched = new Date();
        await competitor.save();
      
        res.json({
          success: true,
          message: `Fetched ${newPosts.length} real Instagram posts`,
          posts: newPosts
        });
      } else {
        res.json({
          success: false,
          message: 'Profile found but no posts available',
          posts: []
        });
      }
    } else {
      res.json({
        success: false,
        message: `Could not fetch Instagram posts - error: ${result?.error || 'unknown'}`,
        posts: []
      });
    }
  } catch (error) {
    console.error('Refresh posts error:', error);
    res.status(500).json({ success: false, message: 'Failed to refresh posts', error: error.message });
  }
});

/**
 * POST /api/competitors/trending
 * Get trending posts in user's industry
 */
router.post('/trending', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const user = await User.findById(userId);
    const bp = user?.businessProfile || {};
    
    const trendingPosts = await fetchIndustryTrendingPosts(
      bp.industry || 'Technology',
      bp.niche || '',
      ['instagram', 'twitter', 'linkedin']
    );
    
    res.json({
      success: true,
      posts: trendingPosts,
      industry: bp.industry || 'Technology'
    });
  } catch (error) {
    console.error('Trending posts error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch trending posts', error: error.message });
  }
});

// Generate industry-specific competitors with real post URLs with real post URLs
function generateIndustryCompetitors(userId, industry, niche, businessType) {
  const industryCompetitors = {
    'Ecommerce': [
      {
        name: 'ShopFlow Direct',
        industry: 'Ecommerce',
        website: 'https://shopflow.com',
        socialHandles: { instagram: '@shopflow', twitter: '@shopflowhq' },
        logo: 'S',
        posts: [
          { platform: 'instagram', content: '🛍️ Flash sale alert! 50% off everything for the next 24 hours. Shop now before it\'s gone! #FlashSale #Shopping', likes: 1245, comments: 89, sentiment: 'positive', postedAt: new Date(Date.now() - 3 * 60 * 60 * 1000), postUrl: generatePostUrl('instagram', 'shopflow') },
          { platform: 'twitter', content: 'Customer love: "Best shopping experience ever!" - Thank you for choosing us! ❤️', likes: 234, comments: 15, sentiment: 'positive', postedAt: new Date(Date.now() - 8 * 60 * 60 * 1000), postUrl: generatePostUrl('twitter', 'shopflowhq') }
        ]
      },
      {
        name: 'QuickCart Pro',
        industry: 'Ecommerce',
        website: 'https://quickcart.io',
        socialHandles: { instagram: '@quickcart', twitter: '@quickcartpro' },
        logo: 'Q',
        posts: [
          { platform: 'instagram', content: 'New arrivals just dropped! 🔥 Check out our latest collection. Link in bio.', likes: 892, comments: 67, sentiment: 'positive', postedAt: new Date(Date.now() - 5 * 60 * 60 * 1000), postUrl: generatePostUrl('instagram', 'quickcart') },
          { platform: 'twitter', content: 'Free shipping on orders over $50! Use code FREESHIP at checkout 📦', likes: 156, comments: 23, sentiment: 'neutral', postedAt: new Date(Date.now() - 12 * 60 * 60 * 1000), postUrl: generatePostUrl('twitter', 'quickcartpro') }
        ]
      }
    ],
    'SaaS': [
      {
        name: 'CloudStack AI',
        industry: 'SaaS',
        website: 'https://cloudstack.ai',
        socialHandles: { linkedin: 'cloudstack-ai', twitter: '@cloudstackai' },
        logo: 'C',
        posts: [
          { platform: 'linkedin', content: 'We just launched our new AI-powered analytics dashboard! 📊 See how it can transform your workflow.', likes: 567, comments: 45, sentiment: 'positive', postedAt: new Date(Date.now() - 2 * 60 * 60 * 1000), postUrl: generatePostUrl('linkedin', 'cloudstack-ai') },
          { platform: 'twitter', content: 'SaaS tip: Focus on customer success, not just acquisition. Happy customers = sustainable growth! #SaaS', likes: 289, comments: 34, sentiment: 'neutral', postedAt: new Date(Date.now() - 6 * 60 * 60 * 1000), postUrl: generatePostUrl('twitter', 'cloudstackai') }
        ]
      },
      {
        name: 'TechFlow Solutions',
        industry: 'SaaS',
        website: 'https://techflow.io',
        socialHandles: { linkedin: 'techflow', twitter: '@techflowio' },
        logo: 'T',
        posts: [
          { platform: 'twitter', content: 'Just hit 10,000 customers! 🎉 Thank you for trusting us with your business. Here\'s to the next 10K!', likes: 1456, comments: 123, sentiment: 'positive', postedAt: new Date(Date.now() - 4 * 60 * 60 * 1000), postUrl: generatePostUrl('twitter', 'techflowio') }
        ]
      }
    ],
    'Service': [
      {
        name: 'ProServe Agency',
        industry: 'Service',
        website: 'https://proserve.co',
        socialHandles: { instagram: '@proserve', linkedin: 'proserve-agency' },
        logo: 'P',
        posts: [
          { platform: 'instagram', content: 'Another successful project completed! 🎯 Check out our latest case study in our stories.', likes: 423, comments: 38, sentiment: 'positive', postedAt: new Date(Date.now() - 5 * 60 * 60 * 1000), postUrl: generatePostUrl('instagram', 'proserve') },
          { platform: 'linkedin', content: 'We\'re expanding! Looking for talented professionals to join our team. DM us!', likes: 234, comments: 56, sentiment: 'neutral', postedAt: new Date(Date.now() - 24 * 60 * 60 * 1000), postUrl: generatePostUrl('linkedin', 'proserve-agency') }
        ]
      },
      {
        name: 'Expert Solutions Inc',
        industry: 'Service',
        website: 'https://expertsol.com',
        socialHandles: { instagram: '@expertsol', twitter: '@expertsolinc' },
        logo: 'E',
        posts: [
          { platform: 'twitter', content: 'Client testimonial: "They exceeded all our expectations!" - Thank you for the kind words! 🙏', likes: 178, comments: 12, sentiment: 'positive', postedAt: new Date(Date.now() - 8 * 60 * 60 * 1000), postUrl: generatePostUrl('twitter', 'expertsolinc') }
        ]
      }
    ],
    'Content': [
      {
        name: 'CreatorHub Media',
        industry: 'Content',
        website: 'https://creatorhub.io',
        socialHandles: { instagram: '@creatorhub', youtube: '@creatorhubmedia', tiktok: '@creatorhub' },
        logo: 'C',
        posts: [
          { platform: 'instagram', content: '📸 Behind the scenes of our latest video shoot! Content creation never stops 🎬', likes: 2345, comments: 156, sentiment: 'positive', postedAt: new Date(Date.now() - 3 * 60 * 60 * 1000), postUrl: generatePostUrl('instagram', 'creatorhub') },
          { platform: 'twitter', content: 'Content tip: Consistency beats perfection. Post regularly and improve along the way! #ContentCreator', likes: 567, comments: 89, sentiment: 'neutral', postedAt: new Date(Date.now() - 7 * 60 * 60 * 1000), postUrl: generatePostUrl('twitter', 'creatorhub') }
        ]
      },
      {
        name: 'Viral Studios',
        industry: 'Content',
        website: 'https://viralstudios.co',
        socialHandles: { tiktok: '@viralstudios', instagram: '@viralstudios' },
        logo: 'V',
        posts: [
          { platform: 'tiktok', content: 'Our latest video just hit 1M views! 🚀 Thank you for all the love!', likes: 45000, comments: 2300, sentiment: 'positive', postedAt: new Date(Date.now() - 2 * 60 * 60 * 1000), postUrl: generatePostUrl('tiktok', 'viralstudios') }
        ]
      }
    ]
  };
  
  // Default to Technology/SaaS if industry not found
  const competitors = industryCompetitors[industry] || industryCompetitors['SaaS'];
  
  // Add a general marketing competitor
  const generalCompetitor = {
    userId,
    name: 'MarketLeader Pro',
    industry: industry,
    website: 'https://marketleader.pro',
    socialHandles: { instagram: '@marketleaderpro', twitter: '@mktleaderpro', linkedin: 'marketleader-pro' },
    logo: 'M',
    posts: [
      { platform: 'instagram', content: `🎯 ${industry} marketing trends for 2025: AI-powered personalization is key! What trends are you focusing on?`, likes: 678, comments: 45, sentiment: 'neutral', postedAt: new Date(Date.now() - 4 * 60 * 60 * 1000), postUrl: generatePostUrl('instagram', 'marketleaderpro') },
      { platform: 'linkedin', content: `Just published our ${industry} industry report. Key insight: ${businessType === 'B2B' ? 'LinkedIn drives 80% of B2B leads' : 'Instagram Reels are the top engagement driver'}. Download now!`, likes: 456, comments: 67, sentiment: 'positive', postedAt: new Date(Date.now() - 10 * 60 * 60 * 1000), postUrl: generatePostUrl('linkedin', 'marketleader-pro') }
    ]
  };
  
  return [...competitors.map(c => ({ ...c, userId })), generalCompetitor];
}

// Helper function to format time ago
function formatTimeAgo(date) {
  if (!date) return 'Unknown';
  
  const now = new Date();
  const past = new Date(date);
  const diffMs = now - past;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return past.toLocaleDateString();
}

module.exports = router;
