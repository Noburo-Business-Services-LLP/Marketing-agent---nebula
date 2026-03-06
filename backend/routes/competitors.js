/**
 * Competitor Routes
 * Add, fetch, and analyze competitors with REAL web scraping
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const Competitor = require('../models/Competitor');
const User = require('../models/User');
const OnboardingContext = require('../models/OnboardingContext');
const { generateWithLLM } = require('../services/llmRouter');

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

    console.log('ðŸ” ===========================================');
    console.log('ðŸ” AUTO-DISCOVER COMPETITORS');
    console.log('ðŸ” User:', userId);
    console.log('ðŸ” ===========================================');

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

    console.log('ðŸ“‹ Business Context:', JSON.stringify(businessContext, null, 2));

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
        console.log('ðŸ“¦ Returning cached competitors:', existingCompetitors.length);
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
    console.log(`ðŸ—‘ï¸ Deleted ${deleted.deletedCount} old competitors`);

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
- Go through the entire website and determine the product(s) or service offering by the company
- 4 LOCAL competitors with the context of the company's product(s) or service offering(same region as ${businessContext.location})
- 5 NATIONAL competitors with the context of the company's product(s) or service offering(major players in the country)
- 3 GLOBAL competitors with the context of the company's product(s) or service offering(international leaders)
- 3 STARTUPS with the context of the company's product(s) or service offering(emerging players)

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

    console.log('ðŸ“¤ Calling Gemini for competitor discovery...');
    
    const response = await callGemini(prompt, { maxTokens: 8000, skipCache: true });
    const parsed = parseGeminiJSON(response);

    if (!parsed || !parsed.competitors || !Array.isArray(parsed.competitors)) {
      console.error('âŒ Failed to parse Gemini response');
      console.log('Raw response:', response?.substring(0, 500));
      return res.status(500).json({
        success: false,
        message: 'Failed to discover competitors. Please try again.'
      });
    }

    console.log(`âœ… Gemini returned ${parsed.competitors.length} competitors`);

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
        console.log(`âœ… Saved: ${comp.name}`);
      } catch (saveError) {
        console.error(`âŒ Error saving ${comp.name}:`, saveError.message);
      }
    }

    console.log(`ðŸŽ¯ Total competitors saved: ${savedCompetitors.length}`);

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
    console.error('âŒ Competitor auto-discovery error:', error);
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
 * Maker-checker: Validate that a scraped Instagram profile actually matches the competitor.
 * Compares profile fullName, bio, website against competitor name, industry, website.
 * Returns { valid: boolean, score: number, reason: string }
 */
function validateProfileMatch(profile, competitor) {
  const profileName = (profile.fullName || profile.ownerFullName || '').toLowerCase().trim();
  const profileBio = (profile.biography || profile.bio || '').toLowerCase();
  const profileUrl = (profile.externalUrl || '').toLowerCase();
  const profileUsername = (profile.username || profile.ownerUsername || '').toLowerCase();

  const compName = (competitor.name || '').toLowerCase().trim();
  const compWebsite = (competitor.website || '').toLowerCase();
  const compIndustry = (competitor.industry || '').toLowerCase();
  const compDescription = (competitor.description || '').toLowerCase();

  let score = 0;
  const reasons = [];

  // 1. Name matching (strongest signal)
  const compWords = compName.split(/\s+/).filter(w => w.length > 2);

  if (profileName && compName && profileName.length > 2 && (profileName.includes(compName) || compName.includes(profileName))) {
    // Short names (<=5 chars) are more ambiguous — e.g. "Vanta" matches "Vanta Official", "Vanta Clothing"
    const nameBonus = compName.length <= 5 ? 5 : 10;
    score += nameBonus;
    reasons.push(nameBonus < 10 ? 'short name match' : 'exact name match');
  } else {
    let nameScore = 0;
    for (const word of compWords) {
      if (profileName.includes(word)) nameScore += 3; // fullName is a strong signal
      else if (profileUsername.includes(word)) nameScore += 1; // username alone is weak — anyone can register it
    }
    if (nameScore > 0) {
      score += nameScore;
      reasons.push(`name score: ${nameScore}`);
    }
  }

  // 2. Website domain match/mismatch (very strong signal both ways)
  if (compWebsite) {
    const compDomain = compWebsite.replace(/https?:\/\//, '').replace(/www\./, '').split('/')[0];
    if (profileUrl) {
      const profileDomain = profileUrl.replace(/https?:\/\//, '').replace(/www\./, '').split('/')[0];
      if (compDomain && profileDomain) {
        if (compDomain.includes(profileDomain) || profileDomain.includes(compDomain)) {
          score += 8;
          reasons.push('website domain match');
        } else {
          score -= 4;
          reasons.push('website domain MISMATCH');
        }
      }
    }
  }

  // 3. Industry keywords in bio
  if (compIndustry) {
    const industryWords = compIndustry.split(/[\s,]+/).filter(w => w.length > 3);
    let bioMatches = 0;
    for (const word of industryWords) {
      if (profileBio.includes(word)) bioMatches++;
    }
    if (bioMatches > 0) {
      score += bioMatches * 2;
      reasons.push(`industry in bio: ${bioMatches}`);
    }
  }

  // 4. Description keywords in bio
  if (compDescription) {
    const descWords = compDescription.split(/[\s,]+/).filter(w => w.length > 4);
    let descMatches = 0;
    for (const word of descWords.slice(0, 5)) {
      if (profileBio.includes(word)) descMatches++;
    }
    if (descMatches >= 2) {
      score += descMatches;
      reasons.push(`description in bio: ${descMatches}`);
    }
  }

  // 5. Language mismatch penalty — if competitor name is Latin/English but bio is mostly non-Latin
  if (compWords.length > 0 && compWords.every(w => /^[a-z0-9]+$/.test(w)) && profileBio.length > 20) {
    const latinChars = (profileBio.match(/[a-zA-Z]/g) || []).length;
    const totalChars = profileBio.replace(/[\s\d@#.,!?:;'"()\-]/g, '').length;
    if (totalChars > 10 && latinChars / totalChars < 0.3) {
      score -= 5;
      reasons.push('non-English bio penalty');
    }
  }

  // 6. Verified accounts get a boost
  if (profile.verified || profile.isVerified) {
    score += 3;
    reasons.push('verified');
  }

  const valid = score >= 6;
  const reason = reasons.join(', ') || 'no matching signals';

  console.log(`    🔍 Maker-checker @${profileUsername} vs "${compName}": score=${score} (${reason}) → ${valid ? '✅ PASS' : '❌ REJECT'}`);

  return { valid, score, reason };
}

/**
 * Smart Instagram handle finder with maker-checker validation.
 * Tries the given handle first, then name-based variations if it fails.
 * Validates each profile against competitor identity before accepting.
 * Updates the competitor's handle in DB once found so future scrapes work.
 */
async function findInstagramProfile(competitor) {
  const handles = competitor.socialHandles || {};
  const givenHandle = handles.instagram?.replace('@', '');
  
  // STEP 1: Try the given handle first (fastest)
  if (givenHandle) {
    try {
      console.log(`  ðŸ”Ž Trying given handle @${givenHandle} for ${competitor.name}...`);
      const result = await scrapeInstagramProfile(givenHandle);
      if (result?.success && result?.data?.length > 0) {
        const profile = result.data[0];
        const posts = profile.latestPosts || profile.posts || [];
        if (posts.length > 0) {
          const validation = validateProfileMatch(profile, competitor);
          if (validation.valid) {
            console.log(`  âœ… @${givenHandle} VERIFIED for ${competitor.name} (${validation.reason})`);
            return { result, handle: givenHandle };
          } else {
            console.log(`  âš ï¸ @${givenHandle} has posts but FAILED validation for ${competitor.name} — searching further...`);
          }
        }
      }
    } catch (err) {
      console.log(`  âš ï¸ @${givenHandle} failed: ${err.message}`);
    }
  }

  // STEP 2: Search Instagram by business name (universal, works for ANY business)
  try {
    const searchResult = await searchInstagramByName(competitor.name, {
      industry: competitor.industry,
      website: competitor.website,
      description: competitor.description
    });
    if (searchResult?.success && searchResult?.username) {
      const foundHandle = searchResult.username;
      console.log(`  ðŸ” Search found @${foundHandle} for ${competitor.name}, fetching profile...`);
      
      const result = await scrapeInstagramProfile(foundHandle);
      if (result?.success && result?.data?.length > 0) {
        const profile = result.data[0];
        const posts = profile.latestPosts || profile.posts || [];
        if (posts.length > 0) {
          const validation = validateProfileMatch(profile, competitor);
          if (validation.valid) {
            console.log(`  âœ… @${foundHandle} VERIFIED! ${posts.length} posts. Updating DB handle.`);
            await Competitor.findByIdAndUpdate(competitor._id, {
              'socialHandles.instagram': foundHandle
            });
            return { result, handle: foundHandle };
          } else {
            console.log(`  âš ï¸ @${foundHandle} FAILED validation for ${competitor.name}`);
          }
        }
      }
    }
  } catch (err) {
    console.log(`  âš ï¸ Instagram search failed for ${competitor.name}: ${err.message}`);
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
      console.log(`  ðŸ”Ž Trying variation @${handle}...`);
      const result = await scrapeInstagramProfile(handle);
      if (result?.success && result?.data?.length > 0) {
        const profile = result.data[0];
        const posts = profile.latestPosts || profile.posts || [];
        if (posts.length > 0) {
          const validation = validateProfileMatch(profile, competitor);
          if (validation.valid) {
            console.log(`  âœ… @${handle} VERIFIED! Updating DB handle.`);
            await Competitor.findByIdAndUpdate(competitor._id, {
              'socialHandles.instagram': handle
            });
            return { result, handle };
          } else {
            console.log(`  âš ï¸ @${handle} FAILED validation for ${competitor.name}`);
          }
        }
      }
    } catch (err) { /* skip */ }
  }

  console.log(`  âŒ No VERIFIED Instagram found for ${competitor.name}`);
  return null;
}

/**
 * Fetch posts for a list of competitors
 * Only keeps English-language posts from verified brands
 * CRITICAL: Only posts from the last 3 months are allowed - NO older posts
 */
async function fetchPostsForCompetitors(competitors) {
  const allPosts = [];
  const threeMonthsAgo = Date.now() - (30 * 24 * 60 * 60 * 1000); // 1 month filter
  console.log(`📅 1-month threshold: ${new Date(threeMonthsAgo).toLocaleDateString()}`);

  for (const competitor of competitors.slice(0, 5)) {
    try {
      console.log(`ðŸ“¸ Finding Instagram for ${competitor.name}...`);
      const found = await findInstagramProfile(competitor);
      
      if (!found) continue;
      
      const profile = found.result.data[0];
      const latestPosts = profile.latestPosts || profile.posts || [];
      const posts = processAndSavePosts(latestPosts, competitor, threeMonthsAgo);
      
      if (posts.length > 0) {
        await Competitor.findByIdAndUpdate(competitor._id, { posts });
        allPosts.push(...posts);
        console.log(`âœ… Saved ${posts.length} REAL posts for ${competitor.name}`);
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

  const oneMonthAgo = threeMonthsAgo || (Date.now() - (30 * 24 * 60 * 60 * 1000));

  const mappedPosts = englishPosts.map(post => {
    // Check ALL possible Apify timestamp fields
    let rawTs = null;
    if (post.timestamp) rawTs = post.timestamp;
    else if (post.takenAt) rawTs = post.takenAt;
    else if (post.takenAtTimestamp && !isNaN(post.takenAtTimestamp)) rawTs = post.takenAtTimestamp * 1000;
    else if (post.taken_at_timestamp && !isNaN(post.taken_at_timestamp)) rawTs = post.taken_at_timestamp * 1000;
    else if (post.date) rawTs = post.date;

    // If no valid timestamp found, SKIP this post entirely
    if (!rawTs) {
      console.log(`  ⚠️ Skipping post (no timestamp): ${(post.caption || '').substring(0, 40)}...`);
      return null;
    }

    const timestamp = new Date(rawTs).getTime();

    // If date is invalid or older than 1 month, SKIP
    if (isNaN(timestamp) || timestamp < oneMonthAgo) {
      return null;
    }

    return {
      platform: 'instagram',
      content: post.caption || post.text || post.description || '',
      likes: post.likesCount || post.likes || 0,
      comments: post.commentsCount || post.comments || 0,
      imageUrl: post.displayUrl || post.imageUrl || post.thumbnailUrl || null,
      postUrl: post.url || post.postUrl || `https://instagram.com/p/${post.shortCode || post.id || ''}`,
      postedAt: new Date(timestamp),
      postedAtTimestamp: timestamp,
      sentiment: analyzeSentiment(post.caption || ''),
      isRealData: true
    };
  }).filter(Boolean); // Remove nulls (skipped posts)

  return mappedPosts.slice(0, 5);
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
    
    console.log(`ðŸš« Ignored competitor: ${competitor.name}`);
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
    
    console.log(`âœ… Unignored competitor: ${competitor.name}`);
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

    console.log(`ðŸ” Scraping posts for ${competitorType} competitors...`);
    
    const oneMonthAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);

    // Find all competitors of this type
    const allOfType = await Competitor.find({ 
      userId, 
      isActive: true, 
      isIgnored: { $ne: true },
      competitorType
    });

    // Check which competitors need re-scraping:
    // - No posts at all
    // - All posts are older than 1 month or have bad timestamps
    const competitors = allOfType.filter(c => {
      if (!c.posts || c.posts.length === 0) return true;
      const hasRecentPost = c.posts.some(p => {
        const ts = new Date(p.postedAt).getTime();
        return !isNaN(ts) && ts > oneMonthAgo && ts < Date.now();
      });
      if (!hasRecentPost) {
        console.log(`  Rescraping ${c.name}: no valid recent posts found`);
        return true;
      }
      return false;
    });

    if (competitors.length === 0) {
      // All competitors have valid recent posts — return them filtered
      const posts = [];
      allOfType.forEach(c => {
        if (c.posts && c.posts.length > 0) {
          c.posts.forEach(p => {
            const ts = new Date(p.postedAt).getTime();
            if (isNaN(ts) || ts < oneMonthAgo) return;
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

    console.log(`ðŸ“‹ Found ${competitors.length} ${competitorType} competitors without posts`);

    const results = [];
    const threeMonthsAgo = Date.now() - (30 * 24 * 60 * 60 * 1000); // 1 month filter

    for (const competitor of competitors.slice(0, 7)) {
      try {
        console.log(`ðŸ“¸ Finding Instagram for ${competitor.name}...`);
        const found = await findInstagramProfile(competitor);
        
        if (found) {
          const profile = found.result.data[0];
          const latestPosts = profile.latestPosts || profile.posts || [];
          const posts = processAndSavePosts(latestPosts, competitor, threeMonthsAgo);
          
          if (posts.length > 0) {
            await Competitor.findByIdAndUpdate(competitor._id, { posts });
            results.push({ name: competitor.name, success: true, postsCount: posts.length, handle: found.handle });
            console.log(`âœ… Saved ${posts.length} REAL posts for ${competitor.name} (@${found.handle})`);
          } else {
            // Clear old bad posts — no recent content for this competitor
            await Competitor.findByIdAndUpdate(competitor._id, { posts: [] });
            results.push({ name: competitor.name, success: false, error: 'No posts within last month' });
          }
        } else {
          await Competitor.findByIdAndUpdate(competitor._id, { posts: [] });
          results.push({ name: competitor.name, success: false, error: 'No working Instagram handle found' });
        }
      } catch (err) {
        results.push({ name: competitor.name, success: false, error: err.message });
        console.error(`âŒ Failed for ${competitor.name}:`, err.message);
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Now return ALL posts for this type (re-query to get updated data)
    const updatedCompetitors = await Competitor.find({ userId, isActive: true, isIgnored: { $ne: true }, competitorType });
    const oneMonthAgoFilter = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const allPosts = [];
    updatedCompetitors.forEach(c => {
      if (c.posts && c.posts.length > 0) {
        c.posts.forEach(p => {
          // Skip posts with no valid date or older than 1 month
          const postTime = new Date(p.postedAt).getTime();
          if (isNaN(postTime) || postTime < oneMonthAgoFilter) return;

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
    
    // Filter out posts older than 1 month (clean up old DB data)
    const oneMonthAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    allPosts = allPosts.filter(p => {
      const ts = new Date(p.postedAt).getTime();
      return !isNaN(ts) && ts > oneMonthAgo;
    });

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

// Helper function to format time ago
function formatTimeAgo(date) {
  if (!date) return 'Unknown';
  
  const now = new Date();
  const past = new Date(date);
  
  // Guard against invalid dates (e.g., "3d ago" strings or garbage data)
  if (isNaN(past.getTime())) return 'Unknown';
  
  // Guard against future dates
  if (past > now) return 'Just now';
  
  const diffMs = now - past;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  const diffWeeks = Math.floor(diffDays / 7);
  
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffWeeks < 5) return `${diffWeeks}w ago`;
  return past.toLocaleDateString();
}

module.exports = router;
