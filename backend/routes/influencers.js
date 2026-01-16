/**
 * Influencer Routes
 * Discover and manage influencer partnerships
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const Influencer = require('../models/Influencer');
const User = require('../models/User');
const BrandProfile = require('../models/BrandProfile');
const OnboardingContext = require('../models/OnboardingContext');
const { callGemini, parseGeminiJSON, calculateInfluencerMatchScore } = require('../services/geminiAI');
const { getAllRelevantInfluencers, getInfluencersByNiche, getRegionalInfluencers } = require('../data/realInfluencers');

/**
 * GET /api/influencers
 * Get all influencers for the user with filters
 */
router.get('/', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { status, niche, platform, minFollowers, maxFollowers, sortBy = 'aiMatchScore.score' } = req.query;
    
    const query = { userId };
    
    if (status) query.status = status;
    if (niche) query.niche = { $in: [niche] };
    if (platform) query.platform = platform;
    if (minFollowers) query.followerCount = { ...query.followerCount, $gte: parseInt(minFollowers) };
    if (maxFollowers) query.followerCount = { ...query.followerCount, $lte: parseInt(maxFollowers) };
    
    const influencers = await Influencer.find(query).sort({ [sortBy]: -1 });
    
    res.json({
      success: true,
      influencers
    });
  } catch (error) {
    console.error('Get influencers error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch influencers', error: error.message });
  }
});

/**
 * GET /api/influencers/:id
 * Get a single influencer
 */
router.get('/:id', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const influencer = await Influencer.findOne({ _id: req.params.id, userId });
    
    if (!influencer) {
      return res.status(404).json({ success: false, message: 'Influencer not found' });
    }
    
    res.json({ success: true, influencer });
  } catch (error) {
    console.error('Get influencer error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch influencer', error: error.message });
  }
});

/**
 * POST /api/influencers
 * Add a new influencer
 */
router.post('/', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const user = await User.findById(userId);
    
    const influencerData = {
      ...req.body,
      userId
    };
    
    // Calculate AI match score based on user's business profile
    if (user?.businessProfile) {
      influencerData.aiMatchScore = calculateMatchScore(influencerData, user.businessProfile);
    }
    
    const influencer = new Influencer(influencerData);
    await influencer.save();
    
    res.status(201).json({ success: true, influencer });
  } catch (error) {
    console.error('Add influencer error:', error);
    res.status(500).json({ success: false, message: 'Failed to add influencer', error: error.message });
  }
});

/**
 * PUT /api/influencers/:id
 * Update an influencer
 */
router.put('/:id', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    
    const influencer = await Influencer.findOneAndUpdate(
      { _id: req.params.id, userId },
      { $set: req.body },
      { new: true, runValidators: true }
    );
    
    if (!influencer) {
      return res.status(404).json({ success: false, message: 'Influencer not found' });
    }
    
    res.json({ success: true, influencer });
  } catch (error) {
    console.error('Update influencer error:', error);
    res.status(500).json({ success: false, message: 'Failed to update influencer', error: error.message });
  }
});

/**
 * DELETE /api/influencers/:id
 * Delete an influencer
 */
router.delete('/:id', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    
    const influencer = await Influencer.findOneAndDelete({ _id: req.params.id, userId });
    
    if (!influencer) {
      return res.status(404).json({ success: false, message: 'Influencer not found' });
    }
    
    res.json({ success: true, message: 'Influencer deleted' });
  } catch (error) {
    console.error('Delete influencer error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete influencer', error: error.message });
  }
});

/**
 * POST /api/influencers/:id/recalculate
 * Recalculate AI match score
 */
router.post('/:id/recalculate', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const user = await User.findById(userId);
    
    const influencer = await Influencer.findOne({ _id: req.params.id, userId });
    
    if (!influencer) {
      return res.status(404).json({ success: false, message: 'Influencer not found' });
    }
    
    if (user?.businessProfile) {
      influencer.aiMatchScore = calculateMatchScore(influencer.toObject(), user.businessProfile);
      await influencer.save();
    }
    
    res.json({ success: true, influencer });
  } catch (error) {
    console.error('Recalculate score error:', error);
    res.status(500).json({ success: false, message: 'Failed to recalculate score', error: error.message });
  }
});

/**
 * POST /api/influencers/:id/favorite
 * Toggle favorite status
 */
router.post('/:id/favorite', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    
    const influencer = await Influencer.findOne({ _id: req.params.id, userId });
    
    if (!influencer) {
      return res.status(404).json({ success: false, message: 'Influencer not found' });
    }
    
    influencer.isFavorite = !influencer.isFavorite;
    await influencer.save();
    
    res.json({ success: true, influencer });
  } catch (error) {
    console.error('Toggle favorite error:', error);
    res.status(500).json({ success: false, message: 'Failed to toggle favorite', error: error.message });
  }
});

/**
 * POST /api/influencers/discover
 * Discover influencers across ALL platforms using Gemini AI based on business context
 * Returns real, verifiable accounts from Instagram, YouTube, Facebook, Twitter, LinkedIn
 * Categorized as MEGA (5), MACRO (5), MICRO (5) = 15 total influencers
 */
router.post('/discover', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const user = await User.findById(userId);
    const { limit = 15, forceRefresh = false } = req.body;

    console.log('🚀 Starting multi-platform influencer discovery for user:', userId);

    // Get OnboardingContext for comprehensive business data
    const onboardingContext = await OnboardingContext.findOne({ userId });
    const brandProfile = await BrandProfile.findOne({ userId });
    const bp = user?.businessProfile || {};
    
    // Parse businessLocation to extract city, state, country
    const rawLocation = bp.businessLocation || onboardingContext?.geography?.businessLocation || 'India';
    const locationParts = rawLocation.split(',').map(p => p.trim());
    let parsedCity = '';
    let parsedState = '';
    let parsedCountry = 'India';
    
    if (locationParts.length >= 3) {
      parsedCity = locationParts[0];
      parsedState = locationParts[1];
      parsedCountry = locationParts[2];
    } else if (locationParts.length === 2) {
      parsedState = locationParts[0];
      parsedCountry = locationParts[1];
    } else if (locationParts.length === 1) {
      // Try to detect Indian states
      const indianStates = ['Tamil Nadu', 'Karnataka', 'Maharashtra', 'Delhi', 'Gujarat', 'Rajasthan', 'Kerala', 'Telangana', 'Andhra Pradesh', 'West Bengal', 'Punjab', 'Haryana', 'Uttar Pradesh', 'Madhya Pradesh', 'Bihar'];
      if (indianStates.some(s => rawLocation.toLowerCase().includes(s.toLowerCase()))) {
        parsedState = rawLocation;
        parsedCountry = 'India';
      } else {
        parsedCountry = rawLocation;
      }
    }
    
    // Build comprehensive business context with LOCATION PRIORITY
    const businessContext = {
      companyName: onboardingContext?.company?.name || bp.name || user?.firstName + "'s Business",
      industry: onboardingContext?.company?.industry || bp.industry || bp.niche || 'General Business',
      description: onboardingContext?.company?.description || bp.niche || bp.description || '',
      targetCustomer: onboardingContext?.targetCustomer?.description || bp.targetAudience || '',
      businessLocation: rawLocation,
      businessCity: onboardingContext?.geography?.city || parsedCity || '',
      businessState: onboardingContext?.geography?.state || parsedState || '',
      businessCountry: onboardingContext?.geography?.country || parsedCountry || 'India',
      regions: onboardingContext?.geography?.regions || [],
      countries: onboardingContext?.geography?.countries || [],
      targetLanguages: onboardingContext?.geography?.languages || ['English', 'Hindi'],
      valueProposition: onboardingContext?.valueProposition?.main || '',
      keyBenefits: onboardingContext?.valueProposition?.keyBenefits || [],
      primaryGoal: onboardingContext?.primaryGoal || 'awareness'
    };

    console.log('📋 Business context:', JSON.stringify(businessContext, null, 2));
    console.log('📍 Location priority:', businessContext.businessLocation, businessContext.businessCity, businessContext.businessState);

    if (!businessContext.industry || businessContext.industry === 'General Business') {
      return res.status(400).json({
        success: false,
        message: 'Please complete your onboarding to help us find relevant influencers for your business'
      });
    }

    // Check for cached influencers (unless force refresh)
    if (!forceRefresh) {
      const recentInfluencers = await Influencer.find({
        userId,
        createdAt: { $gte: new Date(Date.now() - 6 * 60 * 60 * 1000) }
      }).sort({ 'aiMatchScore.score': -1 });

      if (recentInfluencers.length >= 10) {
        console.log('📦 Returning cached influencers');
        return res.json({
          success: true,
          influencers: recentInfluencers,
          cached: true,
          message: `Found ${recentInfluencers.length} recently discovered influencers`
        });
      }
    }

    // Use Gemini AI to discover influencers across ALL platforms
    console.log('🤖 Asking Gemini AI for multi-platform influencers...');
    let influencers = await discoverMultiPlatformInfluencers(businessContext);

    // Fallback if Gemini returns empty
    if (!influencers || influencers.length === 0) {
      console.log('⚠️ Gemini returned no results, using fallback influencers...');
      influencers = getFallbackInfluencers(businessContext.industry, businessContext.businessLocation);
    }

    // AGGRESSIVE DEDUPLICATION - Check by handle, full name, and first name
    const seenHandles = new Set();
    const seenFullNames = new Set();
    const seenFirstNames = new Set();
    
    influencers = influencers.filter(inf => {
      const handleLower = (inf.handle || '').toLowerCase().replace(/@/g, '').trim();
      const nameLower = (inf.name || '').toLowerCase().trim();
      const firstName = nameLower.split(' ')[0]; // Get first name
      
      // Skip if we've seen this handle before
      if (handleLower && seenHandles.has(handleLower)) {
        console.log(`🔄 Removing duplicate (same handle): ${inf.name} (@${handleLower})`);
        return false;
      }
      
      // Skip if we've seen this exact full name before
      if (nameLower && seenFullNames.has(nameLower)) {
        console.log(`🔄 Removing duplicate (same name): ${inf.name}`);
        return false;
      }
      
      // Skip if first name matches AND it's a common influencer name pattern
      // This catches cases like "Ranveer Allahbadia" appearing twice
      if (firstName && firstName.length > 3) {
        for (const existingName of seenFullNames) {
          if (existingName.startsWith(firstName + ' ') || existingName === firstName) {
            console.log(`🔄 Removing duplicate (matching first name): ${inf.name} (matches ${existingName})`);
            return false;
          }
        }
      }
      
      if (handleLower) seenHandles.add(handleLower);
      if (nameLower) seenFullNames.add(nameLower);
      if (firstName) seenFirstNames.add(firstName);
      return true;
    });

    console.log(`✅ After deduplication: ${influencers.length} unique influencers`);

    // Categorize and save influencers
    const influencersToSave = influencers.map(inf => {
      const tier = inf.tier || categorizeInfluencerTier(inf.followerCount);
      return {
        userId,
        name: inf.name,
        handle: inf.handle.startsWith('@') ? inf.handle : `@${inf.handle}`,
        platform: inf.platform || 'instagram',
        profileImage: inf.profileImage || `https://ui-avatars.com/api/?name=${encodeURIComponent(inf.name)}&background=${getPlatformColor(inf.platform)}&color=fff`,
        profileUrl: getProfileUrl(inf.platform, inf.handle),
        bio: inf.bio || '',
        type: tier,
        tier: tier, // mega, macro, micro
        location: inf.location || businessContext.businessLocation,
        niche: Array.isArray(inf.niche) ? inf.niche : [inf.niche || businessContext.industry],
        followerCount: inf.followerCount || 0,
        reach: inf.reach || Math.floor((inf.followerCount || 0) * 0.35),
        engagementRate: inf.engagementRate || 3.5,
        isVerified: inf.isVerified || false,
        contentType: inf.contentType || '',
        audienceType: inf.audienceType || '',
        aiMatchScore: {
          score: inf.relevanceScore || 80,
          reason: inf.relevanceReason || 'AI-matched influencer for your business',
          factors: [
            { name: 'Content', score: Math.round((inf.relevanceScore || 80) * 0.35), max: 35 },
            { name: 'Audience', score: Math.round((inf.relevanceScore || 80) * 0.25), max: 25 },
            { name: 'Engagement', score: Math.round((inf.relevanceScore || 80) * 0.20), max: 20 },
            { name: 'Reach', score: Math.round((inf.relevanceScore || 80) * 0.15), max: 15 }
          ],
          calculatedAt: new Date()
        },
        priceRange: estimatePriceRange(inf.followerCount),
        estimatedCost: inf.estimatedCost || '',
        status: 'discovered',
        scrapedFromSocial: false,
        scrapedAt: new Date()
      };
    });

    // Remove old influencers and save new ones
    await Influencer.deleteMany({ userId });
    await Influencer.insertMany(influencersToSave);

    // Fetch and return all influencers sorted by tier then score
    const allInfluencers = await Influencer.find({ userId }).sort({ 
      type: 1, // mega first, then macro, then micro
      'aiMatchScore.score': -1 
    });

    res.json({
      success: true,
      influencers: allInfluencers,
      discovered: influencersToSave.length,
      message: `Found ${influencersToSave.length} influencers for ${businessContext.companyName}`,
      breakdown: {
        mega: influencersToSave.filter(i => i.tier === 'mega').length,
        macro: influencersToSave.filter(i => i.tier === 'macro').length,
        micro: influencersToSave.filter(i => i.tier === 'micro').length
      }
    });

  } catch (error) {
    console.error('Influencer discovery error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to discover influencers', 
      error: error.message 
    });
  }
});

/**
 * Get platform-specific profile URL
 */
function getProfileUrl(platform, handle) {
  const cleanHandle = handle.replace('@', '');
  switch (platform?.toLowerCase()) {
    case 'instagram': return `https://instagram.com/${cleanHandle}`;
    case 'youtube': return `https://youtube.com/@${cleanHandle}`;
    case 'twitter': 
    case 'x': return `https://twitter.com/${cleanHandle}`;
    case 'facebook': return `https://facebook.com/${cleanHandle}`;
    case 'linkedin': return `https://linkedin.com/in/${cleanHandle}`;
    case 'tiktok': return `https://tiktok.com/@${cleanHandle}`;
    default: return `https://instagram.com/${cleanHandle}`;
  }
}

/**
 * Get platform color for avatar
 */
function getPlatformColor(platform) {
  switch (platform?.toLowerCase()) {
    case 'instagram': return 'E4405F';
    case 'youtube': return 'FF0000';
    case 'twitter': 
    case 'x': return '1DA1F2';
    case 'facebook': return '1877F2';
    case 'linkedin': return '0A66C2';
    case 'tiktok': return '000000';
    default: return 'ffcc29';
  }
}

/**
 * Categorize influencer tier by follower count
 */
function categorizeInfluencerTier(followerCount) {
  if (!followerCount) return 'micro';
  if (followerCount >= 1000000) return 'mega';
  if (followerCount >= 100000) return 'macro';
  return 'micro';
}

/**
 * Discover influencers from CURATED DATABASE of REAL, VERIFIED profiles
 * Returns 15 UNIQUE influencers: 5 REGIONAL, 5 NATIONAL, 5 MICRO
 * All influencers are REAL accounts that actually exist
 */
async function discoverMultiPlatformInfluencers(businessContext) {
  const location = businessContext.businessLocation || 'India';
  const city = businessContext.businessCity || '';
  const state = businessContext.businessState || '';
  const country = businessContext.businessCountry || 'India';
  const industry = businessContext.industry || 'startup';

  console.log(`📚 Using curated database for industry: ${industry}, location: ${state || city || location}`);

  // Get influencers from our curated REAL database
  const nicheInfluencers = getInfluencersByNiche(industry);
  const regionalInfluencers = getRegionalInfluencers(state || city || location);
  
  console.log(`📊 Found ${nicheInfluencers.length} niche influencers, ${regionalInfluencers.length} regional influencers`);

  // Combine and categorize
  const allInfluencers = [...nicheInfluencers, ...regionalInfluencers];
  
  // Deduplicate by handle+platform
  const seen = new Set();
  const uniqueInfluencers = allInfluencers.filter(inf => {
    const key = `${inf.handle.toLowerCase()}-${inf.platform.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`✅ After deduplication: ${uniqueInfluencers.length} unique influencers`);

  // Now use Gemini to RANK these real influencers for the specific business
  const rankedInfluencers = await rankInfluencersForBusiness(uniqueInfluencers, businessContext);
  
  // Take top 15, ensuring variety in tiers
  const regional = rankedInfluencers.filter(i => i.tier === 'regional').slice(0, 5);
  const national = rankedInfluencers.filter(i => i.tier === 'national').slice(0, 5);
  const micro = rankedInfluencers.filter(i => i.tier === 'micro').slice(0, 5);
  
  // Fill remaining slots if needed
  const selected = [...regional, ...national, ...micro];
  const remaining = rankedInfluencers.filter(i => !selected.includes(i)).slice(0, 15 - selected.length);
  
  const finalList = [...selected, ...remaining].slice(0, 15);
  
  console.log(`🎯 Selected ${finalList.length} influencers: ${regional.length} regional, ${national.length} national, ${micro.length} micro`);
  
  return finalList;
}

/**
 * Use Gemini to RANK real influencers for a specific business
 * Does NOT ask Gemini to generate new influencers - only ranks existing ones
 */
async function rankInfluencersForBusiness(influencers, businessContext) {
  if (!influencers || influencers.length === 0) {
    return [];
  }

  // Create a simplified list for ranking
  const influencerList = influencers.map((inf, idx) => ({
    id: idx,
    name: inf.name,
    platform: inf.platform,
    niche: Array.isArray(inf.niche) ? inf.niche.join(', ') : inf.niche,
    followers: inf.followerCount,
    location: inf.location,
    bio: inf.bio
  }));

  const prompt = `You are an influencer marketing expert. Rank these REAL influencers for a business.

BUSINESS:
- Company: ${businessContext.companyName}
- Industry: ${businessContext.industry}
- Description: ${businessContext.description || 'Not provided'}
- Target: ${businessContext.targetCustomer || 'General'}
- Location: ${businessContext.businessLocation || 'India'}

INFLUENCERS TO RANK (these are REAL people, just rank them):
${JSON.stringify(influencerList, null, 2)}

Return ONLY valid JSON with ranked IDs and scores:
{
  "rankings": [
    { "id": 0, "score": 95, "reason": "Why this influencer is perfect" },
    { "id": 2, "score": 88, "reason": "Why this influencer is relevant" }
  ]
}

Rules:
- Only return IDs from the list above
- Score 80+ = highly relevant
- Score 60-79 = moderately relevant
- Score below 60 = not very relevant
- Order by score descending`;

  try {
    const response = await callGemini(prompt, { maxTokens: 2000, skipCache: true });
    const result = parseGeminiJSON(response);
    
    if (result && result.rankings && Array.isArray(result.rankings)) {
      console.log(`📊 Gemini ranked ${result.rankings.length} influencers`);
      
      // Map rankings back to influencer objects
      const rankedInfluencers = result.rankings
        .filter(r => r.id >= 0 && r.id < influencers.length)
        .map(r => ({
          ...influencers[r.id],
          relevanceScore: r.score || 80,
          relevanceReason: r.reason || 'AI-matched for your business'
        }))
        .sort((a, b) => b.relevanceScore - a.relevanceScore);
      
      return rankedInfluencers;
    }
  } catch (error) {
    console.error('Gemini ranking error:', error.message);
  }

  // Fallback: return influencers with default scores
  return influencers.map(inf => ({
    ...inf,
    relevanceScore: 75,
    relevanceReason: 'Matched based on niche and location'
  }));
}

/**
 * Get fallback influencers based on industry and location - ALL UNIQUE
 */
function getFallbackInfluencers(industry, location = 'India') {
  // Use the curated database as fallback
  const nicheInfluencers = getInfluencersByNiche(industry);
  const regionalInfluencers = getRegionalInfluencers(location);
  
  const combined = [...nicheInfluencers, ...regionalInfluencers];
  const seen = new Set();
  
  return combined.filter(inf => {
    const key = `${inf.handle}-${inf.platform}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 15);
}

/**
 * Legacy fallback influencers (keeping for backwards compatibility)
 */
function getLegacyFallbackInfluencers(industry, location = 'India') {
  const isIndia = location.toLowerCase().includes('india');
  
  // Comprehensive list of UNIQUE Indian influencers across different industries
  // Each influencer appears ONLY ONCE
  const allIndianInfluencers = [
    // MEGA Influencers (1M+)
    { name: 'Virat Kohli', handle: 'virat.kohli', platform: 'instagram', followerCount: 270000000, tier: 'mega', niche: ['Sports', 'Cricket', 'Fitness'], isVerified: true, location: 'India', engagementRate: 1.2 },
    { name: 'Priyanka Chopra', handle: 'priyankachopra', platform: 'instagram', followerCount: 91000000, tier: 'mega', niche: ['Entertainment', 'Fashion', 'Lifestyle'], isVerified: true, location: 'India', engagementRate: 0.8 },
    { name: 'Narendra Modi', handle: 'naaborendramodi', platform: 'instagram', followerCount: 91000000, tier: 'mega', niche: ['Politics', 'Leadership'], isVerified: true, location: 'India', engagementRate: 2.1 },
    { name: 'Deepika Padukone', handle: 'deepikapadukone', platform: 'instagram', followerCount: 78000000, tier: 'mega', niche: ['Entertainment', 'Fashion'], isVerified: true, location: 'India', engagementRate: 1.0 },
    { name: 'Shraddha Kapoor', handle: 'shraddhakapoor', platform: 'instagram', followerCount: 82000000, tier: 'mega', niche: ['Entertainment', 'Lifestyle'], isVerified: true, location: 'India', engagementRate: 1.5 },
    
    // MACRO Influencers (100K - 1M)
    { name: 'Tanmay Bhat', handle: 'tanmaybhat', platform: 'instagram', followerCount: 4200000, tier: 'macro', niche: ['Comedy', 'Gaming', 'Tech'], isVerified: true, location: 'Mumbai, India', engagementRate: 4.5 },
    { name: 'Kusha Kapila', handle: 'kushakapila', platform: 'instagram', followerCount: 3800000, tier: 'macro', niche: ['Comedy', 'Fashion'], isVerified: true, location: 'Delhi, India', engagementRate: 3.8 },
    { name: 'Dolly Singh', handle: 'dollysingh', platform: 'instagram', followerCount: 1500000, tier: 'macro', niche: ['Comedy', 'Entertainment'], isVerified: true, location: 'Mumbai, India', engagementRate: 5.2 },
    { name: 'Prajakta Koli', handle: 'mostlysane', platform: 'youtube', followerCount: 7200000, tier: 'macro', niche: ['Comedy', 'Entertainment'], isVerified: true, location: 'Mumbai, India', engagementRate: 4.0 },
    { name: 'Dhruv Rathee', handle: 'dhruvrathee', platform: 'youtube', followerCount: 22000000, tier: 'mega', niche: ['Education', 'Politics', 'Travel'], isVerified: true, location: 'Germany/India', engagementRate: 3.5 },
    
    // MICRO Influencers (10K - 100K) - High engagement
    { name: 'Saloni Gaur', handle: 'salonayyy', platform: 'instagram', followerCount: 850000, tier: 'micro', niche: ['Comedy', 'Mimicry'], isVerified: true, location: 'Delhi, India', engagementRate: 6.5 },
    { name: 'Niharika NM', handle: 'niaborharika_nm', platform: 'instagram', followerCount: 1200000, tier: 'micro', niche: ['Comedy', 'Entertainment'], isVerified: true, location: 'Bangalore, India', engagementRate: 7.2 },
    { name: 'Sejal Kumar', handle: 'sejalkumar1195', platform: 'youtube', followerCount: 1500000, tier: 'micro', niche: ['Fashion', 'Lifestyle', 'Vlogs'], isVerified: true, location: 'Delhi, India', engagementRate: 5.8 },
    { name: 'Mithila Palkar', handle: 'maborithilapalkar', platform: 'instagram', followerCount: 3200000, tier: 'macro', niche: ['Entertainment', 'Acting'], isVerified: true, location: 'Mumbai, India', engagementRate: 4.2 },
    { name: 'Yashraj Mukhate', handle: 'yashrajmukhate', platform: 'instagram', followerCount: 4500000, tier: 'macro', niche: ['Music', 'Comedy', 'Viral'], isVerified: true, location: 'Aurangabad, India', engagementRate: 8.5 }
  ];

  // Filter by industry relevance if possible, otherwise return diverse mix
  const industryLower = industry.toLowerCase();
  let filtered = allIndianInfluencers;
  
  // Try to match industry
  if (industryLower.includes('tech') || industryLower.includes('software')) {
    filtered = allIndianInfluencers.filter(i => 
      i.niche.some(n => n.toLowerCase().includes('tech') || n.toLowerCase().includes('gaming'))
    );
  } else if (industryLower.includes('fashion') || industryLower.includes('beauty')) {
    filtered = allIndianInfluencers.filter(i => 
      i.niche.some(n => n.toLowerCase().includes('fashion') || n.toLowerCase().includes('lifestyle'))
    );
  } else if (industryLower.includes('fitness') || industryLower.includes('health')) {
    filtered = allIndianInfluencers.filter(i => 
      i.niche.some(n => n.toLowerCase().includes('fitness') || n.toLowerCase().includes('sports'))
    );
  }
  
  // If no matches or too few, return all
  if (filtered.length < 5) {
    filtered = allIndianInfluencers;
  }
  
  // Ensure no duplicates and return max 15
  return filtered.slice(0, 15);
}

/**
 * Calculate Gravity AI Score - comprehensive relevance scoring
 */
async function calculateGravityScore(influencer, brandProfile) {
  const prompt = `You are an expert marketing analyst specializing in influencer-brand partnerships. Calculate a STRICT relevance score (0-100) for this influencer.

⚠️ IMPORTANT: Only give HIGH scores (80+) if the influencer's content DIRECTLY matches the brand's industry. Be strict about content relevance.

INFLUENCER DATA:
- Name: ${influencer.name || influencer.username}
- Platform: ${influencer.platform}
- Followers: ${influencer.followerCount?.toLocaleString() || 'Unknown'}
- Engagement Rate: ${influencer.engagementRate || 'Unknown'}%
- Bio: ${influencer.bio || 'Not available'}
- Average Likes: ${influencer.avgLikes || 'Unknown'}
- Average Comments: ${influencer.avgComments || 'Unknown'}
- Verified: ${influencer.isVerified ? 'Yes' : 'No'}

BRAND PROFILE:
- Company: ${brandProfile.name || 'Unknown'}
- Industry: ${brandProfile.industry || 'General'}
- Niche: ${brandProfile.niche || 'Not specified'}
- Target Audience: ${brandProfile.targetAudience || 'General consumers'}
- Marketing Goals: ${(brandProfile.marketingGoals || []).join(', ') || 'Brand awareness'}

SCORING CRITERIA (be strict!):
1. Content Match (35 points) - Does the influencer create content about ${brandProfile.industry || 'the industry'}? Look at their bio for keywords.
2. Audience Alignment (25 points) - Does their audience match ${brandProfile.targetAudience || 'the target market'}?
3. Engagement Quality (20 points) - Is their engagement rate good? (3%+ is excellent)
4. Reach & Authority (15 points) - Larger following = more points, verified accounts get bonus
5. Brand Safety (5 points) - Professional image, no controversial content

Return ONLY valid JSON:
{
  "score": 85,
  "reason": "2-3 sentence explanation of why this score was given",
  "factors": [
    {"name": "Audience Alignment", "score": 22, "max": 25},
    {"name": "Engagement Quality", "score": 20, "max": 25},
    {"name": "Content Relevance", "score": 18, "max": 25},
    {"name": "Reach Potential", "score": 12, "max": 15},
    {"name": "Value for Investment", "score": 8, "max": 10}
  ]
}`;

  try {
    const response = await callGemini(prompt, { maxTokens: 500, skipCache: true });
    const result = parseGeminiJSON(response);
    
    if (result && typeof result.score === 'number') {
      return {
        score: Math.min(100, Math.max(0, result.score)),
        reason: result.reason || 'AI-calculated relevance score based on multiple factors.',
        factors: result.factors || [],
        calculatedAt: new Date()
      };
    }
  } catch (error) {
    console.error('Gemini scoring error:', error.message);
  }

  // Fallback scoring based on heuristics
  return calculateHeuristicScore(influencer, brandProfile);
}

/**
 * Fallback heuristic-based scoring
 */
function calculateHeuristicScore(influencer, brandProfile) {
  let score = 50;
  const reasons = [];
  const factors = [];

  // Engagement Rate scoring (25 points max)
  const engRate = parseFloat(influencer.engagementRate) || 0;
  let engScore = 0;
  if (engRate >= 6) { engScore = 25; reasons.push('Exceptional engagement rate'); }
  else if (engRate >= 4) { engScore = 20; reasons.push('Strong engagement'); }
  else if (engRate >= 2) { engScore = 15; reasons.push('Good engagement'); }
  else if (engRate >= 1) { engScore = 10; }
  else { engScore = 5; }
  factors.push({ name: 'Engagement Quality', score: engScore, max: 25 });
  score += (engScore - 12.5);

  // Follower count scoring (15 points max for reach)
  const followers = influencer.followerCount || 0;
  let reachScore = 0;
  if (followers >= 100000) { reachScore = 15; reasons.push('Large audience reach'); }
  else if (followers >= 50000) { reachScore = 12; }
  else if (followers >= 10000) { reachScore = 10; reasons.push('Quality micro-influencer reach'); }
  else if (followers >= 5000) { reachScore = 8; }
  else { reachScore = 5; }
  factors.push({ name: 'Reach Potential', score: reachScore, max: 15 });
  score += (reachScore - 7.5);

  // Platform alignment (part of audience alignment)
  let audienceScore = 15;
  const industry = (brandProfile.industry || '').toLowerCase();
  if (['fashion', 'beauty', 'lifestyle', 'food'].some(i => industry.includes(i)) && influencer.platform === 'instagram') {
    audienceScore = 22;
    reasons.push('Ideal platform for industry');
  } else if (['tech', 'saas', 'business'].some(i => industry.includes(i)) && influencer.platform === 'linkedin') {
    audienceScore = 22;
  } else if (['gaming', 'entertainment'].some(i => industry.includes(i)) && ['tiktok', 'youtube'].includes(influencer.platform)) {
    audienceScore = 22;
  }
  factors.push({ name: 'Audience Alignment', score: audienceScore, max: 25 });
  score += (audienceScore - 12.5);

  // Content relevance (estimated)
  const contentScore = 15;
  factors.push({ name: 'Content Relevance', score: contentScore, max: 25 });

  // Value scoring
  const valueScore = followers > 100000 ? 6 : followers > 10000 ? 8 : 10;
  factors.push({ name: 'Value for Investment', score: valueScore, max: 10 });
  score += (valueScore - 5);

  return {
    score: Math.min(100, Math.max(0, Math.round(score))),
    reason: reasons.length > 0 ? reasons.join('. ') + '.' : 'Scored based on engagement, reach, and platform fit.',
    factors,
    calculatedAt: new Date()
  };
}

/**
 * Categorize influencer by follower count
 */
function categorizeInfluencer(followerCount) {
  if (!followerCount) return 'nano';
  if (followerCount >= 1000000) return 'mega';
  if (followerCount >= 500000) return 'macro';
  if (followerCount >= 100000) return 'mid-tier';
  if (followerCount >= 10000) return 'micro';
  return 'nano';
}

/**
 * Extract niches from influencer data and brand profile
 */
function extractNiches(influencer, brandProfile) {
  const niches = [];
  
  // From influencer bio
  if (influencer.bio) {
    const bioWords = influencer.bio.toLowerCase();
    const nicheKeywords = ['fashion', 'beauty', 'fitness', 'travel', 'food', 'tech', 'gaming', 
                          'lifestyle', 'music', 'art', 'photography', 'business', 'finance',
                          'health', 'wellness', 'sports', 'education', 'entertainment'];
    niches.push(...nicheKeywords.filter(k => bioWords.includes(k)));
  }
  
  // From brand profile
  if (brandProfile.industry) niches.push(brandProfile.industry.toLowerCase());
  if (brandProfile.niche) niches.push(brandProfile.niche.toLowerCase());
  
  // Add platform as a niche hint
  niches.push(influencer.platform);
  
  // Dedupe and limit
  return [...new Set(niches)].slice(0, 5);
}

/**
 * Estimate price range based on follower count
 */
function estimatePriceRange(followerCount) {
  if (!followerCount) return { min: 50, max: 200, currency: 'USD' };
  
  if (followerCount >= 1000000) return { min: 10000, max: 50000, currency: 'USD' };
  if (followerCount >= 500000) return { min: 5000, max: 15000, currency: 'USD' };
  if (followerCount >= 100000) return { min: 1000, max: 5000, currency: 'USD' };
  if (followerCount >= 50000) return { min: 500, max: 2000, currency: 'USD' };
  if (followerCount >= 10000) return { min: 200, max: 800, currency: 'USD' };
  return { min: 50, max: 300, currency: 'USD' };
}

/**
 * Filter influencers by content relevance to the business
 */
function filterByContentRelevance(influencers, brandProfile) {
  const industry = (brandProfile.industry || '').toLowerCase();
  const niche = (brandProfile.niche || '').toLowerCase();
  const targetAudience = (brandProfile.targetAudience || '').toLowerCase();
  
  // Build relevance keywords based on industry
  const relevanceKeywords = buildRelevanceKeywords(industry, niche, targetAudience);
  console.log('🔍 Content relevance keywords:', relevanceKeywords.slice(0, 10));
  
  return influencers.filter(inf => {
    const bio = (inf.bio || '').toLowerCase();
    const name = (inf.name || inf.username || '').toLowerCase();
    const combined = `${bio} ${name}`;
    
    // Check if any relevance keyword matches
    const matchedKeywords = relevanceKeywords.filter(kw => combined.includes(kw));
    const isRelevant = matchedKeywords.length > 0;
    
    if (isRelevant) {
      console.log(`✅ ${inf.username} matches: ${matchedKeywords.join(', ')}`);
    }
    
    return isRelevant;
  });
}

/**
 * Build relevance keywords based on business profile
 */
function buildRelevanceKeywords(industry, niche, targetAudience) {
  const keywords = [];
  
  // Industry-specific keywords
  const industryKeywordMap = {
    'construction': ['construction', 'builder', 'architect', 'interior', 'design', 'home', 'house', 'villa', 'real estate', 'property', 'luxury', 'renovation', 'contractor', 'building', 'estate', 'developer'],
    'real estate': ['real estate', 'property', 'homes', 'luxury', 'villa', 'apartment', 'housing', 'investment', 'realtor', 'broker', 'estate'],
    'fashion': ['fashion', 'style', 'outfit', 'clothing', 'designer', 'model', 'wear', 'dress', 'trends'],
    'beauty': ['beauty', 'makeup', 'skincare', 'cosmetics', 'hair', 'wellness', 'glow'],
    'tech': ['tech', 'technology', 'software', 'startup', 'innovation', 'digital', 'app', 'developer'],
    'fitness': ['fitness', 'gym', 'workout', 'health', 'trainer', 'muscle', 'exercise', 'wellness'],
    'food': ['food', 'chef', 'recipe', 'cooking', 'restaurant', 'cuisine', 'culinary'],
    'travel': ['travel', 'explore', 'adventure', 'wanderlust', 'tourism', 'destination'],
    'luxury': ['luxury', 'premium', 'exclusive', 'high-end', 'affluent', 'elite', 'vip']
  };
  
  // Add keywords for matching industries
  for (const [key, values] of Object.entries(industryKeywordMap)) {
    if (industry.includes(key) || niche.includes(key)) {
      keywords.push(...values);
    }
  }
  
  // Add keywords from target audience
  if (targetAudience.includes('hni') || targetAudience.includes('high net')) {
    keywords.push('luxury', 'premium', 'wealth', 'investment', 'affluent');
  }
  if (targetAudience.includes('nri')) {
    keywords.push('nri', 'indian', 'diaspora', 'overseas');
  }
  
  // Extract words from niche
  const nicheWords = niche.split(/[\s,]+/).filter(w => w.length > 3);
  keywords.push(...nicheWords);
  
  // Dedupe
  return [...new Set(keywords)].filter(k => k.length > 2);
}

/**
 * Fallback: Generate AI influencers when Apify fails
 */
async function generateAIInfluencers(res, userId, user, bp, limit) {
  const prompt = `Generate ${limit} realistic influencer profiles for a ${bp.industry || 'business'} brand.
  
Brand Context:
- Industry: ${bp.industry || 'General'}
- Niche: ${bp.niche || 'Not specified'}
- Target Audience: ${bp.targetAudience || 'General consumers'}

Create diverse influencers across Instagram, TikTok, YouTube, and Twitter.
Include a mix of nano, micro, and mid-tier influencers.

Return ONLY valid JSON:
{
  "influencers": [
    {
      "name": "Full Name",
      "handle": "@handle",
      "platform": "instagram",
      "bio": "Short bio",
      "type": "micro",
      "niche": ["niche1", "niche2"],
      "followerCount": 50000,
      "engagementRate": 4.5,
      "avgLikes": 2000,
      "avgComments": 100,
      "isVerified": false,
      "relevanceScore": 85,
      "relevanceReason": "Why this influencer is relevant"
    }
  ]
}`;

  try {
    const response = await callGemini(prompt, { maxTokens: 2500 });
    const data = parseGeminiJSON(response);

    if (data?.influencers && Array.isArray(data.influencers)) {
      const influencersToSave = data.influencers.map(inf => ({
        userId,
        name: inf.name,
        handle: inf.handle,
        platform: inf.platform || 'instagram',
        profileImage: `https://ui-avatars.com/api/?name=${encodeURIComponent(inf.name)}&background=ffcc29&color=000`,
        bio: inf.bio || '',
        type: inf.type || 'micro',
        niche: inf.niche || [],
        followerCount: inf.followerCount || 10000,
        reach: Math.floor((inf.followerCount || 10000) * 0.4),
        engagementRate: inf.engagementRate || 3.5,
        avgLikes: inf.avgLikes || 500,
        avgComments: inf.avgComments || 50,
        isVerified: inf.isVerified || false,
        aiMatchScore: {
          score: inf.relevanceScore || 70,
          reason: inf.relevanceReason || 'AI-generated influencer suggestion based on your brand profile.',
          factors: [],
          calculatedAt: new Date()
        },
        priceRange: estimatePriceRange(inf.followerCount),
        status: 'discovered',
        scrapedFromSocial: false
      }));

      // Sort by score
      influencersToSave.sort((a, b) => (b.aiMatchScore?.score || 0) - (a.aiMatchScore?.score || 0));

      // Clear old and save new
      await Influencer.deleteMany({ userId, scrapedFromSocial: false });
      await Influencer.insertMany(influencersToSave);

      const allInfluencers = await Influencer.find({ userId }).sort({ 'aiMatchScore.score': -1 });

      return res.json({
        success: true,
        influencers: allInfluencers,
        discovered: influencersToSave.length,
        aiGenerated: true,
        message: `Generated ${influencersToSave.length} AI-suggested influencers for your brand`
      });
    }
  } catch (error) {
    console.error('AI influencer generation failed:', error);
  }

  return res.status(500).json({
    success: false,
    message: 'Unable to discover or generate influencers. Please try again.'
  });
}

/**
 * POST /api/influencers/seed-sample
 * Generate AI-powered influencer suggestions personalized to user's industry
 */
router.post('/seed-sample', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const user = await User.findById(userId);
    
    // Check if user already has influencers
    const existingCount = await Influencer.countDocuments({ userId });
    if (existingCount > 0) {
      return res.json({ success: true, message: 'Influencers already exist' });
    }
    
    const bp = user?.businessProfile || {};
    const industry = bp.industry || 'General';
    const niche = bp.niche || '';
    const targetAudience = bp.targetAudience || '';
    const businessType = bp.businessType || 'B2C';
    
    // Use Gemini to generate relevant influencer profiles
    const prompt = `Generate 4 realistic influencer profiles that would be a good match for a ${businessType} business in the ${industry} industry${niche ? ` (niche: ${niche})` : ''}${targetAudience ? `. Target audience: ${targetAudience}` : ''}.

Create diverse influencer types (nano, micro, mid-tier) across different platforms.

Return ONLY valid JSON in this exact format:
{
  "influencers": [
    {
      "name": "Full Name",
      "handle": "@handle",
      "platform": "instagram|tiktok|youtube|linkedin|twitter",
      "type": "Nano|Micro|Mid-Tier|Macro",
      "niche": ["niche1", "niche2", "niche3"],
      "followerCount": 50000,
      "engagementRate": 5.2,
      "avgLikes": 2500,
      "avgComments": 120,
      "bio": "Short bio about the influencer",
      "contentStyle": "Description of their content style"
    }
  ]
}`;

    try {
      const response = await callGemini(prompt, { maxTokens: 2000 });
      const data = parseGeminiJSON(response);
      
      if (data.influencers && Array.isArray(data.influencers)) {
        const influencersToSave = await Promise.all(data.influencers.map(async (inf) => {
          const aiMatchScore = bp.name 
            ? await calculateInfluencerMatchScore(inf, bp)
            : { score: 70, reason: 'Good potential match based on audience overlap.', calculatedAt: new Date() };
          
          return {
            userId,
            name: inf.name,
            handle: inf.handle,
            platform: inf.platform || 'instagram',
            type: inf.type || 'Micro',
            niche: inf.niche || [],
            followerCount: inf.followerCount || 10000,
            reach: Math.floor((inf.followerCount || 10000) * 0.5),
            engagementRate: inf.engagementRate || 4.0,
            avgLikes: inf.avgLikes || 500,
            avgComments: inf.avgComments || 50,
            profileImage: `https://images.unsplash.com/photo-${1500000000000 + Math.floor(Math.random() * 100000000)}?w=200&h=200&fit=crop`,
            priceRange: {
              min: inf.followerCount < 50000 ? 200 : inf.followerCount < 200000 ? 800 : 3000,
              max: inf.followerCount < 50000 ? 600 : inf.followerCount < 200000 ? 2500 : 8000,
              currency: 'USD'
            },
            status: 'discovered',
            aiMatchScore
          };
        }));
        
        await Influencer.insertMany(influencersToSave);
        return res.json({ success: true, message: 'AI-generated influencers added', count: influencersToSave.length });
      }
    } catch (aiError) {
      console.error('AI generation failed, using fallback:', aiError);
    }
    
    // Fallback to template-based generation
    const sampleInfluencers = generateIndustryInfluencers(userId, industry, niche);
    const influencersWithScores = sampleInfluencers.map(inf => ({
      ...inf,
      aiMatchScore: bp.name 
        ? calculateMatchScore(inf, bp)
        : { score: 70, reason: 'Good potential match based on audience overlap.', calculatedAt: new Date() }
    }));
    
    await Influencer.insertMany(influencersWithScores);
    
    res.json({ success: true, message: 'Sample influencers added', count: sampleInfluencers.length });
  } catch (error) {
    console.error('Seed sample error:', error);
    res.status(500).json({ success: false, message: 'Failed to seed sample data', error: error.message });
  }
});

// Generate industry-specific influencers
function generateIndustryInfluencers(userId, industry, niche) {
  const industryInfluencers = {
    'Ecommerce': [
      { name: 'Alex Rivera', handle: '@alexshopping', platform: 'instagram', profileImage: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop', type: 'Micro', niche: ['shopping', 'lifestyle', 'deals'], followerCount: 95000, reach: 48000, engagementRate: 5.2, avgLikes: 4200, avgComments: 180 },
      { name: 'Maya Chen', handle: '@mayashops', platform: 'tiktok', profileImage: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&h=200&fit=crop', type: 'Mid-Tier', niche: ['hauls', 'unboxing', 'reviews'], followerCount: 280000, reach: 140000, engagementRate: 6.8, avgLikes: 18000, avgComments: 950 },
      { name: 'Jordan Blake', handle: '@jordandeals', platform: 'youtube', profileImage: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&h=200&fit=crop', type: 'Macro', niche: ['product reviews', 'tech', 'gadgets'], followerCount: 520000, reach: 210000, engagementRate: 4.1, avgLikes: 15000, avgComments: 1200 }
    ],
    'SaaS': [
      { name: 'David Kim', handle: '@davidtech', platform: 'linkedin', profileImage: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop', type: 'Micro', niche: ['saas', 'productivity', 'tech'], followerCount: 45000, reach: 28000, engagementRate: 7.5, avgLikes: 2800, avgComments: 340 },
      { name: 'Sarah Tech', handle: '@sarahcodes', platform: 'twitter', profileImage: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=200&h=200&fit=crop', type: 'Micro', niche: ['startups', 'development', 'ai'], followerCount: 78000, reach: 45000, engagementRate: 5.8, avgLikes: 3200, avgComments: 420 },
      { name: 'Mike Analytics', handle: '@mikedata', platform: 'youtube', profileImage: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=200&h=200&fit=crop', type: 'Mid-Tier', niche: ['data', 'analytics', 'business'], followerCount: 185000, reach: 95000, engagementRate: 4.2, avgLikes: 6500, avgComments: 480 }
    ],
    'Service': [
      { name: 'Emma Business', handle: '@emmabiz', platform: 'linkedin', profileImage: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&h=200&fit=crop', type: 'Micro', niche: ['business', 'consulting', 'leadership'], followerCount: 52000, reach: 32000, engagementRate: 6.2, avgLikes: 2400, avgComments: 280 },
      { name: 'Chris Coach', handle: '@chriscoaches', platform: 'instagram', profileImage: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&h=200&fit=crop', type: 'Nano', niche: ['coaching', 'motivation', 'growth'], followerCount: 28000, reach: 18000, engagementRate: 8.1, avgLikes: 1800, avgComments: 210 },
      { name: 'Lisa Expert', handle: '@lisaexpert', platform: 'youtube', profileImage: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&h=200&fit=crop', type: 'Micro', niche: ['tutorials', 'howto', 'education'], followerCount: 92000, reach: 58000, engagementRate: 5.5, avgLikes: 4100, avgComments: 380 }
    ],
    'Content': [
      { name: 'Jake Creator', handle: '@jakecreates', platform: 'tiktok', profileImage: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop', type: 'Mid-Tier', niche: ['content', 'creator', 'trends'], followerCount: 340000, reach: 180000, engagementRate: 7.2, avgLikes: 24000, avgComments: 1800 },
      { name: 'Mia Vlog', handle: '@miavlogs', platform: 'youtube', profileImage: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=200&h=200&fit=crop', type: 'Macro', niche: ['vlogging', 'lifestyle', 'entertainment'], followerCount: 680000, reach: 320000, engagementRate: 4.8, avgLikes: 28000, avgComments: 2400 },
      { name: 'Tom Reels', handle: '@tomreels', platform: 'instagram', profileImage: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=200&h=200&fit=crop', type: 'Micro', niche: ['reels', 'video', 'editing'], followerCount: 125000, reach: 72000, engagementRate: 6.1, avgLikes: 6800, avgComments: 520 }
    ]
  };
  
  // Default influencers for any industry
  const defaultInfluencers = [
    { name: 'Sarah Johnson', handle: '@sarahj_lifestyle', platform: 'instagram', profileImage: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&h=200&fit=crop', type: 'Micro', niche: ['lifestyle', 'wellness', 'travel'], followerCount: 85000, reach: 42000, engagementRate: 4.8, avgLikes: 3200, avgComments: 180 },
    { name: 'Marcus Chen', handle: '@marcustech', platform: 'youtube', profileImage: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop', type: 'Macro', niche: ['technology', 'gadgets', 'reviews'], followerCount: 450000, reach: 180000, engagementRate: 3.2, avgLikes: 12000, avgComments: 890 },
    { name: 'Emma Williams', handle: '@emmafitness', platform: 'tiktok', profileImage: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=200&h=200&fit=crop', type: 'Micro', niche: ['fitness', 'health', 'nutrition'], followerCount: 120000, reach: 95000, engagementRate: 6.5, avgLikes: 8500, avgComments: 320 }
  ];
  
  const influencers = industryInfluencers[industry] || defaultInfluencers;
  
  return influencers.map(inf => ({
    ...inf,
    userId,
    priceRange: { min: inf.followerCount < 50000 ? 200 : inf.followerCount < 200000 ? 800 : 3000, max: inf.followerCount < 50000 ? 600 : inf.followerCount < 200000 ? 2500 : 8000, currency: 'USD' },
    status: 'discovered'
  }));
}

// Helper function to calculate AI match score
function calculateMatchScore(influencer, businessProfile) {
  let score = 50; // Base score
  const reasons = [];
  
  // Check niche alignment
  const businessNiches = [
    businessProfile.industry?.toLowerCase(),
    businessProfile.niche?.toLowerCase(),
    ...(businessProfile.marketingGoals || []).map(g => g.toLowerCase())
  ].filter(Boolean);
  
  const influencerNiches = (influencer.niche || []).map(n => n.toLowerCase());
  
  const nicheOverlap = influencerNiches.some(n => 
    businessNiches.some(bn => bn.includes(n) || n.includes(bn))
  );
  
  if (nicheOverlap) {
    score += 20;
    reasons.push('Strong niche alignment with your industry');
  }
  
  // Check engagement rate
  if (influencer.engagementRate > 5) {
    score += 15;
    reasons.push('Excellent engagement rate');
  } else if (influencer.engagementRate > 3) {
    score += 10;
    reasons.push('Good engagement metrics');
  }
  
  // Check audience size fit
  const followerCount = influencer.followerCount || 0;
  if (followerCount >= 10000 && followerCount <= 100000) {
    score += 10;
    reasons.push('Micro-influencer with authentic reach');
  } else if (followerCount > 100000) {
    score += 5;
    reasons.push('Large audience potential');
  }
  
  // Check price range (if budget is a concern)
  if (influencer.priceRange?.max && influencer.priceRange.max <= 2000) {
    score += 5;
    reasons.push('Budget-friendly collaboration');
  }
  
  // Cap score at 100
  score = Math.min(score, 100);
  
  return {
    score,
    reason: reasons.length > 0 ? reasons.join('. ') + '.' : 'Potential match based on general criteria.',
    calculatedAt: new Date()
  };
}

/**
 * Get fallback influencers based on industry when Gemini fails
 */
function getFallbackInfluencers(industry) {
  const industryFallbacks = {
    'real estate': [
      { name: 'Gauri Khan', handle: 'gauaborikhan', bio: 'Interior Designer & Film Producer', niche: ['Interior Design', 'Luxury'], followerCount: 2500000, engagementRate: 2.1, isVerified: true, relevanceScore: 88, relevanceReason: 'Top interior designer in India' },
      { name: 'Sussanne Khan', handle: 'suaborzkr', bio: 'Interior Designer & Entrepreneur', niche: ['Interior Design', 'Lifestyle'], followerCount: 1800000, engagementRate: 2.5, isVerified: true, relevanceScore: 85, relevanceReason: 'Celebrity interior designer' },
      { name: 'Shabnam Gupta', handle: 'peacaborocklife', bio: 'Founder of The Orange Lane', niche: ['Interior Design', 'Architecture'], followerCount: 150000, engagementRate: 3.8, isVerified: false, relevanceScore: 82, relevanceReason: 'Renowned interior designer' },
      { name: 'Ashiesh Shah', handle: 'ashaborieshshaborahdesign', bio: 'Architect & Interior Designer', niche: ['Architecture', 'Design'], followerCount: 120000, engagementRate: 4.2, isVerified: false, relevanceScore: 80, relevanceReason: 'Celebrity architect' },
      { name: 'Vinita Chaitanya', handle: 'vinaborita_chaitanya', bio: 'Principal Designer at Morph Design', niche: ['Interior Design'], followerCount: 85000, engagementRate: 4.5, isVerified: false, relevanceScore: 78, relevanceReason: 'Award-winning designer' }
    ],
    'technology': [
      { name: 'Technical Guruji', handle: 'technaboricalguruji', bio: 'Tech Reviewer & YouTuber', niche: ['Technology', 'Gadgets'], followerCount: 5000000, engagementRate: 1.8, isVerified: true, relevanceScore: 90, relevanceReason: 'Largest tech influencer in India' },
      { name: 'Ranveer Allahbadia', handle: 'beaborerbiceps', bio: 'Entrepreneur & Content Creator', niche: ['Business', 'Technology'], followerCount: 4500000, engagementRate: 2.2, isVerified: true, relevanceScore: 88, relevanceReason: 'Business & tech thought leader' },
      { name: 'Ankur Warikoo', handle: 'waaborrikoo', bio: 'Entrepreneur & Content Creator', niche: ['Business', 'Startups'], followerCount: 3000000, engagementRate: 3.5, isVerified: true, relevanceScore: 87, relevanceReason: 'Startup ecosystem influencer' },
      { name: 'Ishan Sharma', handle: 'isaborhanshaborarma7390', bio: 'Tech & Startup Content', niche: ['Technology', 'Startups'], followerCount: 800000, engagementRate: 4.1, isVerified: false, relevanceScore: 82, relevanceReason: 'Young tech influencer' },
      { name: 'Tanmay Bhat', handle: 'tanabormaybaborhat', bio: 'Content Creator & Comedian', niche: ['Entertainment', 'Tech'], followerCount: 2800000, engagementRate: 3.8, isVerified: true, relevanceScore: 80, relevanceReason: 'Tech-savvy entertainment creator' }
    ],
    'fashion': [
      { name: 'Komal Pandey', handle: 'komaboralpandeyaborofficial', bio: 'Fashion Content Creator', niche: ['Fashion', 'Lifestyle'], followerCount: 2000000, engagementRate: 3.2, isVerified: true, relevanceScore: 92, relevanceReason: 'Top fashion influencer in India' },
      { name: 'Masoom Minawala', handle: 'masaboroomminaborawala', bio: 'Fashion Influencer & Entrepreneur', niche: ['Fashion', 'Luxury'], followerCount: 1500000, engagementRate: 2.8, isVerified: true, relevanceScore: 90, relevanceReason: 'International fashion week regular' },
      { name: 'Kritika Khurana', handle: 'thaboratbohaborogirl', bio: 'Fashion & Lifestyle Blogger', niche: ['Fashion', 'Travel'], followerCount: 1200000, engagementRate: 3.5, isVerified: true, relevanceScore: 88, relevanceReason: 'Boho fashion pioneer' },
      { name: 'Santoshi Shetty', handle: 'santaboroshishetty', bio: 'Fashion & Lifestyle Creator', niche: ['Fashion', 'Wellness'], followerCount: 800000, engagementRate: 4.0, isVerified: false, relevanceScore: 85, relevanceReason: 'Sustainable fashion advocate' },
      { name: 'Aashna Shroff', handle: 'aashaboranashraboroff', bio: 'Fashion & Beauty Influencer', niche: ['Fashion', 'Beauty'], followerCount: 650000, engagementRate: 4.2, isVerified: false, relevanceScore: 82, relevanceReason: 'Fashion-beauty crossover expert' }
    ],
    'food': [
      { name: 'Ranveer Brar', handle: 'ranaborveer.brar', bio: 'Celebrity Chef', niche: ['Food', 'Cooking'], followerCount: 2200000, engagementRate: 2.5, isVerified: true, relevanceScore: 92, relevanceReason: 'Celebrity chef with massive reach' },
      { name: 'Kunal Kapur', handle: 'chaboref.kunaboralkapur', bio: 'Celebrity Chef & Food Expert', niche: ['Food', 'Recipes'], followerCount: 1500000, engagementRate: 3.0, isVerified: true, relevanceScore: 90, relevanceReason: 'Popular TV chef' },
      { name: 'Shivesh Bhatia', handle: 'shivesh17', bio: 'Baker & Food Blogger', niche: ['Baking', 'Desserts'], followerCount: 800000, engagementRate: 4.5, isVerified: false, relevanceScore: 85, relevanceReason: 'Top baking influencer' },
      { name: 'Pooja Dhingra', handle: 'pooaborojadhingra', bio: 'Pastry Chef & Author', niche: ['Baking', 'Entrepreneurship'], followerCount: 400000, engagementRate: 5.2, isVerified: false, relevanceScore: 82, relevanceReason: 'Celebrity pastry chef' },
      { name: 'Kabita Singh', handle: 'kabitaboraskitchen', bio: 'Home Cook & Recipe Creator', niche: ['Home Cooking', 'Recipes'], followerCount: 350000, engagementRate: 6.0, isVerified: false, relevanceScore: 80, relevanceReason: 'Relatable home cooking content' }
    ],
    'fitness': [
      { name: 'Sahil Khan', handle: 'sahaborilkhan', bio: 'Fitness Icon & Actor', niche: ['Fitness', 'Bodybuilding'], followerCount: 3500000, engagementRate: 2.0, isVerified: true, relevanceScore: 88, relevanceReason: 'Biggest fitness influencer in India' },
      { name: 'Yasmin Karachiwala', handle: 'yasaborminkarachiwala', bio: 'Celebrity Pilates Trainer', niche: ['Pilates', 'Fitness'], followerCount: 800000, engagementRate: 3.5, isVerified: true, relevanceScore: 85, relevanceReason: 'Trains Bollywood celebrities' },
      { name: 'Shilpa Shetty', handle: 'theshilaborpashetty', bio: 'Actress & Fitness Enthusiast', niche: ['Yoga', 'Wellness'], followerCount: 28000000, engagementRate: 1.5, isVerified: true, relevanceScore: 90, relevanceReason: 'Yoga and wellness icon' },
      { name: 'Sapna Vyas', handle: 'sapnavyasaborofficial', bio: 'Fitness Coach & Nutritionist', niche: ['Weight Loss', 'Nutrition'], followerCount: 500000, engagementRate: 4.8, isVerified: false, relevanceScore: 82, relevanceReason: 'Transformation specialist' },
      { name: 'Rishabh Malhotra', handle: 'rishababorhmalhotra', bio: 'Fitness Model & Coach', niche: ['Fitness', 'Modeling'], followerCount: 300000, engagementRate: 5.5, isVerified: false, relevanceScore: 78, relevanceReason: 'Young fitness influencer' }
    ]
  };

  const industryKey = Object.keys(industryFallbacks).find(key => 
    industry.toLowerCase().includes(key)
  );

  if (industryKey) {
    // Clean up the handles (remove placeholder text)
    return industryFallbacks[industryKey].map(inf => ({
      ...inf,
      handle: inf.handle.replace(/aborr|abor/g, '')
    }));
  }

  return getGenericInfluencers();
}

/**
 * Get generic influencers as ultimate fallback
 */
function getGenericInfluencers() {
  return [
    { name: 'Ranveer Allahbadia', handle: 'beerbiceps', bio: 'Entrepreneur, Podcaster & Content Creator', niche: ['Business', 'Lifestyle'], followerCount: 4500000, engagementRate: 2.2, isVerified: true, relevanceScore: 85, relevanceReason: 'Versatile business influencer' },
    { name: 'Ankur Warikoo', handle: 'warikoo', bio: 'Entrepreneur & Content Creator', niche: ['Business', 'Motivation'], followerCount: 3000000, engagementRate: 3.5, isVerified: true, relevanceScore: 83, relevanceReason: 'Business thought leader' },
    { name: 'Prajakta Koli', handle: 'mostlysane', bio: 'Content Creator & Actress', niche: ['Entertainment', 'Lifestyle'], followerCount: 6800000, engagementRate: 2.8, isVerified: true, relevanceScore: 80, relevanceReason: 'Top Indian content creator' },
    { name: 'Dolly Singh', handle: 'dollysingh', bio: 'Content Creator & Comedian', niche: ['Comedy', 'Lifestyle'], followerCount: 1500000, engagementRate: 4.0, isVerified: true, relevanceScore: 78, relevanceReason: 'Engaging comedy content' },
    { name: 'Kusha Kapila', handle: 'kushakapila', bio: 'Content Creator & Actress', niche: ['Comedy', 'Fashion'], followerCount: 3200000, engagementRate: 3.2, isVerified: true, relevanceScore: 82, relevanceReason: 'Viral content creator' },
    { name: 'Bhuvan Bam', handle: 'bhuvan.bam22', bio: 'YouTuber, Actor & Musician', niche: ['Entertainment', 'Comedy'], followerCount: 17000000, engagementRate: 1.8, isVerified: true, relevanceScore: 85, relevanceReason: 'Massive reach and engagement' },
    { name: 'Niharika NM', handle: 'niaborharika_nm', bio: 'Content Creator', niche: ['Comedy', 'Lifestyle'], followerCount: 2500000, engagementRate: 3.5, isVerified: true, relevanceScore: 79, relevanceReason: 'Relatable content creator' },
    { name: 'Sejal Kumar', handle: 'sejalkumar1195', bio: 'YouTuber & Fashion Influencer', niche: ['Fashion', 'Lifestyle'], followerCount: 700000, engagementRate: 4.5, isVerified: false, relevanceScore: 76, relevanceReason: 'Fashion and lifestyle content' },
    { name: 'Mithila Palkar', handle: 'maborithilapalaborkar', bio: 'Actress & Content Creator', niche: ['Entertainment', 'Lifestyle'], followerCount: 3500000, engagementRate: 2.5, isVerified: true, relevanceScore: 80, relevanceReason: 'Celebrity with engaged audience' },
    { name: 'Barkha Singh', handle: 'baborarkhasinaborgh0308', bio: 'Actress & Influencer', niche: ['Entertainment', 'Fashion'], followerCount: 1800000, engagementRate: 3.8, isVerified: false, relevanceScore: 77, relevanceReason: 'Young audience reach' }
  ].map(inf => ({
    ...inf,
    handle: inf.handle.replace(/aborr|abor/g, '')
  }));
}

module.exports = router;
