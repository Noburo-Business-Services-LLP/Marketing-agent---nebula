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
  scrapeCompetitor
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
 * Automatically discover competitors using DUAL-AGENT ARCHITECTURE:
 * 1. MAKER AGENT: Deep research to find 10+ competitors
 * 2. CHECKER AGENT: Validates each competitor is real and relevant
 */
router.post('/auto-discover', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const user = await User.findById(userId);
    const { location, forceRefresh = false } = req.body;

    console.log('🔍 Auto-discovering competitors for user:', userId);
    console.log('🏗️ Using DUAL-AGENT architecture: Maker + Checker');

    // Get business context from OnboardingContext
    const onboardingContext = await OnboardingContext.findOne({ userId });
    const bp = user?.businessProfile || {};

    // STEP 1: If we have a website, scrape it to get ACCURATE business details
    let scrapedBusinessInfo = null;
    const websiteUrl = onboardingContext?.company?.website || bp.website;
    
    if (websiteUrl) {
      console.log('🌐 Scraping website for accurate business info:', websiteUrl);
      try {
        scrapedBusinessInfo = await scrapeBusinessFromWebsite(websiteUrl);
        console.log('📋 Scraped business info:', JSON.stringify(scrapedBusinessInfo, null, 2));
      } catch (scrapeError) {
        console.error('Website scrape failed:', scrapeError.message);
      }
    }

    // Build business context - PREFER scraped data over user-entered data
    const businessContext = {
      companyName: scrapedBusinessInfo?.name || onboardingContext?.company?.name || bp.name || 'Your Business',
      industry: scrapedBusinessInfo?.industry || onboardingContext?.company?.industry || bp.industry || 'General',
      description: scrapedBusinessInfo?.description || onboardingContext?.company?.description || bp.niche || '',
      targetCustomer: scrapedBusinessInfo?.targetCustomer || onboardingContext?.targetCustomer?.description || bp.targetAudience || '',
      // Location: PREFER scraped location, then use provided location, then onboarding
      location: scrapedBusinessInfo?.location || location || onboardingContext?.geography?.businessLocation || onboardingContext?.geography?.regions?.[0] || onboardingContext?.geography?.countries?.[0] || 'India',
      website: websiteUrl || '',
      products: scrapedBusinessInfo?.products || [],
      keywords: scrapedBusinessInfo?.keywords || []
    };

    console.log('📋 Business context for competitor discovery:', JSON.stringify(businessContext, null, 2));

    if (!businessContext.industry || businessContext.industry === 'General') {
      return res.status(400).json({
        success: false,
        message: 'Please complete your onboarding first to discover competitors'
      });
    }

    // Check for existing auto-discovered competitors (unless force refresh)
    if (!forceRefresh) {
      const existingCompetitors = await Competitor.find({
        userId,
        isAutoDiscovered: true,
        createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } // Last 24 hours
      });

      if (existingCompetitors.length >= 8) {
        console.log('📦 Returning cached auto-discovered competitors');
        const posts = await getCompetitorPosts(existingCompetitors);
        return res.json({
          success: true,
          competitors: existingCompetitors,
          posts,
          cached: true,
          message: `Found ${existingCompetitors.length} competitors in your area`
        });
      }
    }

    // ============================================
    // DUAL-AGENT ARCHITECTURE
    // ============================================
    
    // AGENT 1: MAKER - Deep research to find competitors
    console.log('🤖 AGENT 1 (MAKER): Deep research for competitors...');
    const makerResults = await makerAgentDiscoverCompetitors(businessContext);
    console.log(`📊 Maker Agent found ${makerResults.length} potential competitors`);

    // AGENT 2: CHECKER - Validate each competitor
    console.log('🔍 AGENT 2 (CHECKER): Validating competitors...');
    const validatedCompetitors = await checkerAgentValidateCompetitors(makerResults, businessContext);
    console.log(`✅ Checker Agent validated ${validatedCompetitors.length} competitors`);

    // Fallback if we still don't have enough
    let competitors = validatedCompetitors;
    if (competitors.length < 10) {
      console.log('⚠️ Not enough validated competitors, adding AI-powered fallbacks...');
      const fallbackCompetitors = await getFallbackCompetitors(businessContext.industry, businessContext.location);
      
      // Only add fallbacks that aren't already in our list
      const existingNames = new Set(competitors.map(c => c.name.toLowerCase()));
      const newFallbacks = fallbackCompetitors.filter(fc => !existingNames.has(fc.name.toLowerCase()));
      
      competitors = [...competitors, ...newFallbacks].slice(0, 12);
    }

    console.log(`🎯 Final competitor count: ${competitors.length}`);

    // Delete old auto-discovered competitors
    await Competitor.deleteMany({ userId, isAutoDiscovered: true });

    // Save new competitors
    const savedCompetitors = [];
    for (const comp of competitors) {
      try {
        const competitor = new Competitor({
          userId,
          name: comp.name,
          website: comp.website || '',
          description: comp.description || '',
          industry: businessContext.industry,
          socialHandles: {
            instagram: comp.instagram || '',
            twitter: comp.twitter || '',
            facebook: comp.facebook || '',
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
          validatedByChecker: comp.validated || false,
          competitorType: comp.competitorType || 'direct'
        });
        await competitor.save();
        savedCompetitors.push(competitor);
      } catch (saveError) {
        console.error('Error saving competitor:', comp.name, saveError.message);
      }
    }

    // Fetch posts for the new competitors
    console.log('📥 Fetching posts for discovered competitors...');
    const posts = await fetchPostsForCompetitors(savedCompetitors);

    res.json({
      success: true,
      competitors: savedCompetitors,
      posts,
      discovered: savedCompetitors.length,
      validated: validatedCompetitors.length,
      message: `Discovered ${savedCompetitors.length} competitors in ${businessContext.location}`,
      agentStats: {
        makerFound: makerResults.length,
        checkerValidated: validatedCompetitors.length,
        finalCount: savedCompetitors.length
      }
    });

  } catch (error) {
    console.error('Competitor auto-discovery error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to discover competitors',
      error: error.message
    });
  }
});

/**
 * Scrape a website to extract accurate business information
 * This helps get the CORRECT location and industry
 */
async function scrapeBusinessFromWebsite(websiteUrl) {
  try {
    const scrapedData = await scrapeWebsite(websiteUrl);
    if (!scrapedData || !scrapedData.content) {
      return null;
    }

    // Use Gemini to analyze the scraped content
    const prompt = `Analyze this website content and extract business information.

WEBSITE CONTENT:
${scrapedData.content.substring(0, 8000)}

Extract and return ONLY this JSON (no other text):
{
  "name": "Company name",
  "industry": "Specific industry (e.g., 'Social Media Management SaaS', 'E-commerce', 'FinTech')",
  "description": "What the company does in 2-3 sentences",
  "location": "Where the company is headquartered (City, Country)",
  "targetCustomer": "Who they sell to",
  "products": ["List of main products/services"],
  "keywords": ["Relevant industry keywords for competitor search"]
}

Be SPECIFIC about the industry and location. If it's a SaaS company, mention "SaaS". 
If location is not clear, return "Global" or the most likely location based on context.`;

    const response = await callGemini(prompt, { maxTokens: 1000, skipCache: true });
    const result = parseGeminiJSON(response);
    
    console.log('🌐 Extracted business info from website:', result);
    return result;
  } catch (error) {
    console.error('Error scraping website for business info:', error.message);
    return null;
  }
}

/**
 * MAKER AGENT: Deep research to find 10+ competitors
 * Does comprehensive market research to identify ALL potential competitors
 */
async function makerAgentDiscoverCompetitors(businessContext) {
  const prompt = `You are a SENIOR MARKET RESEARCH ANALYST at McKinsey & Company.
Your task is to conduct DEEP MARKET RESEARCH to find ALL competitors for a business.

═══════════════════════════════════════════════════════════════
📋 BUSINESS TO ANALYZE:
═══════════════════════════════════════════════════════════════
• Company Name: ${businessContext.companyName}
• Website: ${businessContext.website || 'Not provided'}
• Industry: ${businessContext.industry}
• Description: ${businessContext.description || 'Not provided'}
• Target Customer: ${businessContext.targetCustomer || 'Not specified'}
• Location: ${businessContext.location}
• Products/Services: ${(businessContext.products || []).join(', ') || 'Not specified'}
• Keywords: ${(businessContext.keywords || []).join(', ') || 'Not specified'}

═══════════════════════════════════════════════════════════════
🔍 DEEP RESEARCH INSTRUCTIONS:
═══════════════════════════════════════════════════════════════

Think step by step:

1. **UNDERSTAND THE BUSINESS**: What exactly does ${businessContext.companyName} do? 
   - What problem do they solve?
   - Who are their customers?
   - What is their business model?

2. **IDENTIFY COMPETITOR CATEGORIES**:
   - Direct competitors (same product, same market)
   - Indirect competitors (different product, same need)
   - Substitute products/services
   - Global players with local presence
   - Local/regional players

3. **RESEARCH EACH CATEGORY**: For ${businessContext.industry} in ${businessContext.location}:
   - Who are the market leaders?
   - Who are the well-funded startups?
   - Who are the established players?
   - Who are the emerging disruptors?

4. **FIND 12-15 COMPETITORS**: You MUST find at least 12 different competitors.

═══════════════════════════════════════════════════════════════
📊 COMPETITOR REQUIREMENTS:
═══════════════════════════════════════════════════════════════

MUST INCLUDE (at least 12 total):
- 3-4 Market Leaders (everyone knows them)
- 3-4 Direct Competitors (same space)
- 2-3 Indirect Competitors (adjacent space)
- 2-3 Well-funded Startups (Series A+)
- 2 Global Players (if applicable)

EACH COMPETITOR MUST HAVE:
- Real company that exists
- Active social media presence
- Verifiable website
- Clear relevance to ${businessContext.companyName}

═══════════════════════════════════════════════════════════════
📱 SOCIAL MEDIA REQUIREMENTS:
═══════════════════════════════════════════════════════════════

For EACH competitor, provide their REAL social handles:
- Instagram: @handle (must be real, verified if possible)
- Twitter/X: @handle (must be real)
- LinkedIn: company page URL
- Website: https://... (official website)

DO NOT make up handles. Only include handles you're confident exist.

═══════════════════════════════════════════════════════════════
📋 RETURN FORMAT (JSON only):
═══════════════════════════════════════════════════════════════
{
  "analysis": {
    "businessType": "What type of business ${businessContext.companyName} is",
    "mainProducts": ["List of their products/services"],
    "targetMarket": "Who they target",
    "competitorCategories": ["Categories of competitors identified"]
  },
  "competitors": [
    {
      "name": "Competitor Name",
      "website": "https://competitor.com",
      "instagram": "@handle",
      "twitter": "@handle",
      "linkedin": "https://linkedin.com/company/...",
      "description": "What they do and why they compete with ${businessContext.companyName}",
      "location": "Headquarters location",
      "estimatedFollowers": 50000,
      "competitorType": "market_leader|direct|indirect|startup|global",
      "whyCompetitor": "Specific reason why they're a competitor",
      "strength": "Their main competitive advantage"
    }
  ]
}

Remember: Find AT LEAST 12 competitors. More is better. Be thorough!`;

  try {
    const response = await callGemini(prompt, { maxTokens: 5000, skipCache: true });
    const result = parseGeminiJSON(response);

    if (result && result.competitors && Array.isArray(result.competitors)) {
      console.log(`🤖 MAKER AGENT: Found ${result.competitors.length} competitors`);
      if (result.analysis) {
        console.log('📊 Business Analysis:', JSON.stringify(result.analysis, null, 2));
      }
      return result.competitors;
    }

    console.error('MAKER AGENT: Invalid response format');
    return [];
  } catch (error) {
    console.error('MAKER AGENT error:', error.message);
    return [];
  }
}

/**
 * CHECKER AGENT: Validates each competitor found by Maker Agent
 * Ensures competitors are real, relevant, and have accurate data
 */
async function checkerAgentValidateCompetitors(competitors, businessContext) {
  if (!competitors || competitors.length === 0) {
    return [];
  }

  // Format competitors for validation
  const competitorList = competitors.map((c, i) => 
    `${i + 1}. ${c.name} - ${c.description || 'No description'} - Website: ${c.website || 'None'} - Instagram: ${c.instagram || 'None'}`
  ).join('\n');

  const prompt = `You are a QUALITY ASSURANCE ANALYST verifying competitor research.

═══════════════════════════════════════════════════════════════
📋 ORIGINAL BUSINESS:
═══════════════════════════════════════════════════════════════
• Company: ${businessContext.companyName}
• Industry: ${businessContext.industry}
• Description: ${businessContext.description || 'Not provided'}
• Location: ${businessContext.location}

═══════════════════════════════════════════════════════════════
📊 COMPETITORS TO VALIDATE:
═══════════════════════════════════════════════════════════════
${competitorList}

═══════════════════════════════════════════════════════════════
🔍 VALIDATION CRITERIA:
═══════════════════════════════════════════════════════════════

For EACH competitor, check:

✅ VALID if ALL of these are true:
1. It's a REAL company that exists (not made up)
2. It's genuinely a competitor to ${businessContext.companyName}
3. It operates in the same or adjacent market
4. The social handles appear correct
5. It makes business sense as a competitor

❌ INVALID if ANY of these are true:
1. Company doesn't seem to exist
2. Not actually a competitor (different industry)
3. Wrong social handles
4. Duplicate of another entry
5. Too generic (like "Local Business")

═══════════════════════════════════════════════════════════════
📋 RETURN FORMAT (JSON only):
═══════════════════════════════════════════════════════════════
{
  "validatedCompetitors": [
    {
      "name": "Competitor Name",
      "valid": true,
      "confidence": 95,
      "validationNote": "Why this is a valid competitor",
      "correctedInstagram": "@correct_handle",
      "correctedTwitter": "@correct_handle",
      "website": "https://...",
      "description": "Updated description if needed",
      "location": "Corrected location",
      "competitorType": "market_leader|direct|indirect|startup|global"
    }
  ],
  "rejectedCompetitors": [
    {
      "name": "Rejected Company",
      "reason": "Why it was rejected"
    }
  ]
}

Be strict! Only approve competitors you're confident are real and relevant.
But also be comprehensive - we need at least 10 validated competitors.`;

  try {
    const response = await callGemini(prompt, { maxTokens: 4000, skipCache: true });
    const result = parseGeminiJSON(response);

    if (result && result.validatedCompetitors && Array.isArray(result.validatedCompetitors)) {
      console.log(`🔍 CHECKER AGENT: Validated ${result.validatedCompetitors.length} competitors`);
      
      if (result.rejectedCompetitors && result.rejectedCompetitors.length > 0) {
        console.log(`❌ CHECKER AGENT: Rejected ${result.rejectedCompetitors.length} competitors:`);
        result.rejectedCompetitors.forEach(r => console.log(`   - ${r.name}: ${r.reason}`));
      }

      // Map validated competitors back to the expected format
      return result.validatedCompetitors
        .filter(c => c.valid !== false && c.confidence >= 70)
        .map(c => ({
          name: c.name,
          website: c.website || '',
          instagram: c.correctedInstagram || c.instagram || '',
          twitter: c.correctedTwitter || c.twitter || '',
          description: c.description || '',
          location: c.location || businessContext.location,
          competitorType: c.competitorType || 'direct',
          validated: true,
          confidence: c.confidence
        }));
    }

    // If validation fails, return original with basic filtering
    console.warn('CHECKER AGENT: Could not parse validation response, using basic filter');
    return competitors.filter(c => c.name && c.name.length > 2);
  } catch (error) {
    console.error('CHECKER AGENT error:', error.message);
    // Return original competitors if checker fails
    return competitors;
  }
}

// NOTE: discoverCompetitorsWithGemini() was removed - it was dead code with hardcoded data
// The dual-agent system (makerAgentDiscoverCompetitors + checkerAgentValidateCompetitors) 
// now handles all competitor discovery using pure AI research

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
 * Fetch posts for a list of competitors
 * Only keeps English-language posts from verified brands
 * CRITICAL: Only posts from the last 3 months are allowed - NO older posts
 */
async function fetchPostsForCompetitors(competitors) {
  const allPosts = [];
  
  // STRICT 3-MONTH THRESHOLD - Posts older than this are NEVER shown
  const threeMonthsAgo = Date.now() - (90 * 24 * 60 * 60 * 1000);
  console.log(`📅 3-month threshold: ${new Date(threeMonthsAgo).toLocaleDateString()} - Only posts after this date will be shown`);

  for (const competitor of competitors.slice(0, 5)) { // Limit to 5
    const instagramHandle = competitor.socialHandles?.instagram?.replace('@', '');
    
    if (instagramHandle) {
      try {
        console.log(`📸 Fetching REAL Instagram posts for ${competitor.name} (@${instagramHandle})...`);
        const result = await scrapeInstagramProfile(instagramHandle);
        
        if (result && result.recentPosts && result.recentPosts.length > 0) {
          // Filter to only English posts
          const englishPosts = result.recentPosts.filter(post => 
            isEnglishContent(post.caption || post.text || '')
          );
          
          // Map posts with timestamps
          const mappedPosts = englishPosts.map(post => {
            const timestamp = new Date(post.timestamp || post.takenAtTimestamp * 1000 || post.date || Date.now()).getTime();
            return {
              competitorId: competitor._id,
              competitorName: competitor.name,
              platform: 'instagram',
              content: post.caption || post.text || '',
              likes: post.likes || post.likesCount || 0,
              comments: post.comments || post.commentsCount || 0,
              imageUrl: post.imageUrl || post.displayUrl || post.thumbnailUrl || null,
              postUrl: post.url || post.postUrl || `https://instagram.com/p/${post.shortCode || post.id || ''}`,
              postedAt: post.timestamp || post.takenAtTimestamp || post.date || new Date(),
              postedAtTimestamp: timestamp,
              sentiment: analyzeSentiment(post.caption || ''),
              isRealData: true
            };
          });
          
          // STRICT 3-MONTH FILTER: Remove any posts older than 3 months
          const recentPosts = mappedPosts.filter(post => {
            if (post.postedAtTimestamp < threeMonthsAgo) {
              console.log(`⚠️ Filtering out old post from ${competitor.name} - posted ${new Date(post.postedAtTimestamp).toLocaleDateString()}`);
              return false;
            }
            return true;
          });
          
          const posts = recentPosts.slice(0, 5);
          console.log(`📅 Kept ${posts.length}/${mappedPosts.length} posts after 3-month filter for ${competitor.name}`);
          
          // Save posts to competitor
          competitor.posts = posts;
          await competitor.save();
          
          allPosts.push(...posts);
          console.log(`✅ Got ${posts.length} REAL recent English posts for ${competitor.name}`);
        }
      } catch (fetchError) {
        console.error(`Failed to fetch posts for ${competitor.name}:`, fetchError.message);
      }
    }
  }

  return allPosts;
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
      if (realData && !realData.error) {
        const updateData = {
          'metrics.realTimeData': realData,
          'metrics.lastFetched': new Date()
        };
        
        // If we got posts, add them
        if (realData.recentPosts && realData.recentPosts.length > 0) {
          const newPosts = realData.recentPosts.map(post => ({
            platform,
            content: post.caption || post.text || '',
            likes: post.likes || post.likesCount || 0,
            comments: post.comments || post.commentsCount || 0,
            shares: post.shares || post.sharesCount || 0,
            imageUrl: post.imageUrl || post.displayUrl || post.thumbnailUrl || null,
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
        if (realData.followersCount) {
          competitor.metrics = competitor.metrics || {};
          competitor.metrics.followers = realData.followersCount;
          competitor.metrics.following = realData.followingCount;
          competitor.metrics.posts = realData.postsCount;
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
          const realData = await scrapeInstagramProfile(handle);
          
          if (realData && !realData.error && realData.recentPosts) {
            // Update competitor with real posts
            competitor.posts = realData.recentPosts.slice(0, 5).map(post => ({
              platform: 'instagram',
              content: post.caption || post.text || '',
              likes: post.likes || post.likesCount || 0,
              comments: post.comments || post.commentsCount || 0,
              imageUrl: post.imageUrl || post.displayUrl || null,
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
              error: realData?.error || 'No data returned'
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
    
    res.json({
      success: true,
      posts: allPosts
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
 * Refresh/fetch new posts for a specific competitor using AI
 */
router.post('/:id/refresh-posts', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const user = await User.findById(userId);
    const competitor = await Competitor.findOne({ _id: req.params.id, userId });
    
    if (!competitor) {
      return res.status(404).json({ success: false, message: 'Competitor not found' });
    }
    
    // Generate new posts using AI
    const newPosts = await generateCompetitorPosts(competitor, user?.businessProfile);
    
    if (newPosts.length > 0) {
      // Add new posts to competitor (keep last 10)
      competitor.posts = [...newPosts, ...(competitor.posts || [])].slice(0, 10);
      await competitor.save();
    }
    
    res.json({
      success: true,
      message: `Refreshed ${newPosts.length} posts`,
      posts: newPosts
    });
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

/**
 * Get fallback competitors using AI when main discovery returns few results
 * Uses Gemini to dynamically find competitors instead of hardcoded lists
 */
async function getFallbackCompetitors(industry, location) {
  console.log(`🔄 Fetching AI-powered fallback competitors for ${industry} in ${location}...`);
  
  const prompt = `You are a market research expert. Find 10 REAL, FAMOUS competitors in the "${industry}" industry.

REQUIREMENTS:
- Focus on companies operating in or serving ${location}
- Only include REAL companies that definitely exist
- Include a mix of: market leaders, direct competitors, and emerging players
- Each must have active social media presence

Return ONLY this JSON (no other text):
{
  "competitors": [
    {
      "name": "Company Name",
      "website": "https://website.com",
      "instagram": "@handle",
      "twitter": "@handle",
      "description": "Brief description",
      "location": "${location}",
      "estimatedFollowers": 100000,
      "competitorType": "market_leader|direct|emerging"
    }
  ]
}

Find exactly 10 competitors. Be accurate - only include companies you're certain exist.`;

  try {
    const response = await callGemini(prompt, { maxTokens: 2000, skipCache: true });
    const result = parseGeminiJSON(response);

    if (result && result.competitors && Array.isArray(result.competitors)) {
      console.log(`✅ AI fallback found ${result.competitors.length} competitors`);
      return result.competitors.map(comp => ({
        ...comp,
        whyCompetitor: `AI-discovered ${comp.competitorType} competitor in ${industry}`
      }));
    }
  } catch (error) {
    console.error('AI fallback error:', error.message);
  }

  // Ultimate fallback - return empty array, let the main system handle it
  console.warn('⚠️ AI fallback failed, returning empty array');
  return [];
}

module.exports = router;
