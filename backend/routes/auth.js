const express = require('express');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { generateToken, protect } = require('../middleware/auth');
const Competitor = require('../models/Competitor');
const { generateWithLLM } = require('../services/llmRouter');
const { lookupInstagramHandle } = require('../services/serperLookup');
const axios = require('axios');
const otpService = require('../services/otpService');

// ScrapingDog API for LinkedIn fallback
const SCRAPINGDOG_API_KEY = process.env.SCRAPINGDOG_API_KEY || '';

// Import REAL Instagram post fetching via Apify - NO AI FALLBACK
let scrapeInstagramProfile;
try {
  const socialAPI = require('../services/socialMediaAPI');
  scrapeInstagramProfile = socialAPI.scrapeInstagramProfile;
} catch (e) {
  console.warn('socialMediaAPI not available');
  scrapeInstagramProfile = async () => ({ success: false });
}

/**
 * Scrape LinkedIn company posts using ScrapingDog
 * Fallback when Instagram has no posts
 */
async function scrapeLinkedInPosts(linkedinUrl) {
  if (!SCRAPINGDOG_API_KEY) {
    console.log('⚠️ ScrapingDog API key not configured');
    return { success: false, posts: [] };
  }
  
  if (!linkedinUrl) {
    return { success: false, posts: [] };
  }
  
  try {
    console.log(`🔗 Fetching LinkedIn posts from: ${linkedinUrl}`);
    
    // Extract company name/id from URL
    // URL format: https://linkedin.com/company/actfibernet or linkedin.com/company/actfibernet/
    const companyMatch = linkedinUrl.match(/linkedin\.com\/company\/([^\/\?]+)/i);
    if (!companyMatch) {
      console.log('⚠️ Invalid LinkedIn company URL format');
      return { success: false, posts: [] };
    }
    
    const companyId = companyMatch[1];
    
    const response = await axios.get('https://api.scrapingdog.com/linkedin/company/posts', {
      params: {
        api_key: SCRAPINGDOG_API_KEY,
        company_id: companyId,
        count: 10
      },
      timeout: 60000
    });
    
    if (response.status === 200 && response.data) {
      const posts = response.data.posts || response.data || [];
      
      if (Array.isArray(posts) && posts.length > 0) {
        console.log(`✅ Got ${posts.length} LinkedIn posts`);
        return {
          success: true,
          posts: posts.map(post => ({
            platform: 'linkedin',
            content: post.text || post.content || post.commentary || '',
            likes: post.likes || post.numLikes || post.likeCount || 0,
            comments: post.comments || post.numComments || post.commentCount || 0,
            shares: post.shares || post.numShares || post.repostCount || 0,
            imageUrl: post.image || post.imageUrl || post.media?.[0]?.url || null,
            postUrl: post.url || post.postUrl || linkedinUrl,
            postedAt: post.postedAt || post.date || new Date(),
            fetchedAt: new Date(),
            isRealData: true
          }))
        };
      }
    }
    
    console.log('⚠️ No LinkedIn posts found');
    return { success: false, posts: [] };
  } catch (error) {
    console.error('LinkedIn scrape error:', error.message);
    return { success: false, posts: [], error: error.message };
  }
}

const router = express.Router();

/**
 * BACKGROUND COMPETITOR DISCOVERY
 * Triggered automatically after onboarding completion
 */
async function triggerCompetitorDiscovery(userId, contextData) {
  console.log('🔍 ===========================================');
  console.log('🔍 BACKGROUND COMPETITOR DISCOVERY STARTED');
  console.log('🔍 User:', userId);
  console.log('🔍 ===========================================');
  
  try {
    const businessContext = {
      companyName: contextData.company?.name || 'Your Business',
      industry: contextData.company?.industry || 'General',
      description: contextData.company?.description || '',
      targetCustomer: contextData.targetCustomer?.description || '',
      location: contextData.geography?.businessLocation || contextData.geography?.regions?.[0] || 'Global'
    };

    console.log('📋 Business:', businessContext.companyName);
    console.log('📋 Industry:', businessContext.industry);
    console.log('📋 Location:', businessContext.location);

    if (!businessContext.industry || businessContext.industry === 'General') {
      console.log('⚠️ No industry specified, skipping competitor discovery');
      return;
    }

    // Check if competitors were already discovered recently (avoid race condition with auto-discover route)
    const existing = await Competitor.find({
      userId,
      isAutoDiscovered: true,
      createdAt: { $gte: new Date(Date.now() - 60 * 60 * 1000) } // Last 1 hour
    });
    if (existing.length >= 10) {
      console.log(`⚠️ ${existing.length} competitors already discovered recently, skipping`);
      return;
    }

    // Delete existing auto-discovered competitors
    await Competitor.deleteMany({ userId, isAutoDiscovered: true });

    const prompt = `You are a market research expert. Find competitors for this business.

BUSINESS:
- Company: ${businessContext.companyName}
- Industry: ${businessContext.industry}
- Description: ${businessContext.description || 'Not provided'}
- Target Customer: ${businessContext.targetCustomer || 'Not specified'}
- Location: ${businessContext.location}

FIND 15 REAL COMPETITORS that offer similar products/services.

Include this mix:
- 4 LOCAL competitors (same region as ${businessContext.location})
- 5 NATIONAL competitors (major players in the country)
- 3 GLOBAL competitors (international leaders)
- 3 STARTUPS (emerging players)

CRITICAL INSTAGRAM HANDLE RULES:
1. Indian telecom/ISP companies often use patterns like:
   - @vibusinessindia (Vi/Vodafone Idea business)
   - @actaboroadband (ACT Fibernet)
   - @airaboroadband (Airtel broadband)
   - @reliaboroadband or @jiofiberbusiness
2. B2B companies often use: brandnamebusiness, brandname_business, brandnameindia
3. Consumer brands: @brandname_india, @brandname_in, @brandname_official
4. SEARCH the actual Instagram handle before providing - don't guess!
5. If unsure, provide the company's official website and leave instagram as empty string ""
6. NEVER use generic handles like @vi_official or @act_official - these are often wrong
7. Include variations: brandnameindia, brandname_india, brandnamebusiness, brandname_official

ALSO INCLUDE LinkedIn company URL for each competitor (used as fallback if Instagram fails).
Format: https://linkedin.com/company/companyname

RETURN THIS JSON:
{
  "competitors": [
    {
      "name": "Company Name",
      "website": "https://company.com",
      "instagram": "exacthandle_india",
      "linkedin": "https://linkedin.com/company/companyname",
      "twitter": "exacthandle",
      "description": "What they do",
      "location": "City, Country",
      "competitorType": "local|national|global|startup",
      "estimatedFollowers": 10000
    }
  ]
}

All 15 competitors must be REAL companies with VERIFIED handles. Return only valid JSON.`;

    const result = await generateWithLLM({ 
      provider: 'gemini', 
      prompt, 
      taskType: 'analysis',
      maxTokens: 8192  // Increased for 15 competitors
    });
    const responseText = typeof result === 'string' ? result : (result?.text || result?.content || '');
    
    // Parse JSON from response with repair logic
    let parsed;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        let jsonStr = jsonMatch[0];
        try {
          parsed = JSON.parse(jsonStr);
        } catch (parseErr) {
          // Try to repair truncated JSON
          if (parseErr.message.includes('Unterminated') || parseErr.message.includes('Unexpected end')) {
            console.log('Attempting to repair truncated JSON...');
            const lastComplete = jsonStr.lastIndexOf('},');
            if (lastComplete > 0) {
              let repaired = jsonStr.substring(0, lastComplete + 1);
              const openBrackets = (repaired.match(/\[/g) || []).length;
              const closeBrackets = (repaired.match(/]/g) || []).length;
              const openBraces = (repaired.match(/{/g) || []).length;
              const closeBraces = (repaired.match(/}/g) || []).length;
              for (let i = 0; i < openBrackets - closeBrackets; i++) repaired += ']';
              for (let i = 0; i < openBraces - closeBraces; i++) repaired += '}';
              parsed = JSON.parse(repaired);
              console.log('✅ Successfully repaired truncated JSON');
            }
          }
          if (!parsed) throw parseErr;
        }
      }
    } catch (e) {
      console.error('Failed to parse Gemini response:', e.message);
      console.log('Response preview:', responseText?.substring(0, 300));
      return;
    }

    if (!parsed?.competitors?.length) {
      console.log('⚠️ No competitors found in Gemini response');
      return;
    }

    console.log(`✅ Found ${parsed.competitors.length} competitors`);

    // Use Serper to resolve REAL Instagram handles
    console.log('🔍 Resolving Instagram handles via Serper...');
    const handleMap = {};
    for (const comp of parsed.competitors) {
      if (!comp.name || comp.name.length < 2) continue;
      const lookup = await lookupInstagramHandle(comp.name);
      handleMap[comp.name] = lookup.handle;
      if (lookup.handle) {
        console.log(`  ✅ ${comp.name} → @${lookup.handle}`);
      } else {
        console.log(`  ⚠️ ${comp.name} → no Instagram found`);
      }
      await new Promise(r => setTimeout(r, 300));
    }

    // Save competitors and generate posts for each
    let savedCount = 0;
    const savedCompetitors = [];
    
    for (const comp of parsed.competitors) {
      if (!comp.name || comp.name.length < 2) continue;
      
      // Use Serper-verified handle, fall back to Gemini's guess only if Serper found nothing
      const serperHandle = handleMap[comp.name];
      const instagramHandle = serperHandle || (comp.instagram || '').replace('@', '');

      try {
        const competitor = await Competitor.create({
          userId,
          name: comp.name,
          website: comp.website || '',
          description: comp.description || '',
          industry: businessContext.industry,
          socialHandles: {
            instagram: instagramHandle,
            twitter: (comp.twitter || '').replace('@', ''),
            facebook: '',
            linkedin: comp.linkedin || ''
          },
          location: comp.location || businessContext.location,
          isActive: true,
          isAutoDiscovered: true,
          posts: [],
          metrics: { followers: comp.estimatedFollowers || 0, lastFetched: new Date() },
          competitorType: comp.competitorType || 'national'
        });
        savedCount++;
        savedCompetitors.push(competitor);
        console.log(`✅ Saved competitor: ${comp.name}`);
      } catch (e) {
        // Ignore duplicate errors
      }
    }

    console.log(`🎯 Saved ${savedCount} competitors for user ${userId}`);
    
    // Fetch REAL Instagram posts for all saved competitors using Apify
    // NO AI FALLBACK - Only real data from Instagram
    console.log('📸 Fetching REAL Instagram posts for all competitors via Apify...');
    console.log(`📸 Total competitors to scrape: ${savedCompetitors.length}`);
    
    // Common Instagram handle suffixes to try as fallbacks (limited to avoid timeout)
    const handleVariations = [
      '_india', 'india', '_official', 'official', '_in',
      'business', 'businessindia'
    ];
    
    // Helper function to try scraping with handle variations
    async function scrapeWithVariations(baseHandle, competitorName) {
      // First try the original handle
      let result = await scrapeInstagramProfile(baseHandle);
      
      if (result && result.success && result.data && result.data.length > 0) {
        const profile = result.data[0];
        const posts = profile.latestPosts || profile.posts || [];
        if (posts.length > 0) {
          return { result, usedHandle: baseHandle };
        }
      }
      
      // If original failed or has no posts, try variations
      console.log(`🔄 Trying handle variations for ${competitorName}...`);
      
      // Clean the base handle (remove common suffixes to get root)
      let rootHandle = baseHandle
        .replace(/_india$/, '')
        .replace(/_official$/, '')
        .replace(/_in$/, '')
        .replace(/_hq$/, '')
        .replace(/india$/, '')
        .replace(/official$/, '');
      
      for (const suffix of handleVariations) {
        const variantHandle = rootHandle + suffix;
        if (variantHandle === baseHandle) continue; // Skip if same as original
        
        console.log(`   🔍 Trying @${variantHandle}...`);
        result = await scrapeInstagramProfile(variantHandle);
        
        if (result && result.success && result.data && result.data.length > 0) {
          const profile = result.data[0];
          const posts = profile.latestPosts || profile.posts || [];
          if (posts.length > 0) {
            console.log(`   ✅ Found posts with @${variantHandle}!`);
            return { result, usedHandle: variantHandle };
          }
        }
      }
      
      // Return original result if no variations worked
      return { result: null, usedHandle: baseHandle };
    }
    
    // Process ONE AT A TIME sequentially for maximum reliability
    for (let i = 0; i < savedCompetitors.length; i++) {
      const competitor = savedCompetitors[i];
      console.log(`📸 Processing competitor ${i + 1}/${savedCompetitors.length}...`);
      try {
        const instagramHandle = competitor.socialHandles?.instagram;
        
        // Only fetch if we have an Instagram handle
        if (!instagramHandle) {
          console.log(`⚠️ No Instagram handle for ${competitor.name}, skipping...`);
          continue;
        }
        
        console.log(`📸 Fetching real Instagram posts for ${competitor.name} (@${instagramHandle})...`);
        
        // Try with variations if original fails
        const { result, usedHandle } = await scrapeWithVariations(instagramHandle, competitor.name);
        
        // Update the handle if we found a working variation
        if (usedHandle !== instagramHandle && result) {
          competitor.socialHandles.instagram = usedHandle;
          console.log(`📝 Updated handle to @${usedHandle}`);
        }
        
        // Apify returns { success: true, data: [profile] } where profile has latestPosts
        if (result && result.success && result.data && result.data.length > 0) {
          const profile = result.data[0];
          
          // Debug: Log available fields to understand Apify response structure
          const availableFields = Object.keys(profile).filter(k => 
            Array.isArray(profile[k]) || (profile[k] && typeof profile[k] === 'object')
          );
          console.log(`📋 ${competitor.name} profile fields: ${availableFields.join(', ')}`);
          
          // Apify returns posts in various field names depending on scraper version
          const latestPosts = profile.latestPosts 
            || profile.posts 
            || profile.edge_owner_to_timeline_media?.edges?.map(e => e.node)
            || profile.recentPosts
            || [];
          
          console.log(`📋 ${competitor.name} found ${latestPosts.length} posts`);
          
          if (latestPosts.length > 0) {
            const oneMonthAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
            const posts = latestPosts.slice(0, 10).map(post => {
              // Check ALL possible Apify timestamp fields
              let rawTs = null;
              if (post.timestamp) rawTs = post.timestamp;
              else if (post.takenAt) rawTs = post.takenAt;
              else if (post.takenAtTimestamp && !isNaN(post.takenAtTimestamp)) rawTs = post.takenAtTimestamp * 1000;
              else if (post.taken_at_timestamp && !isNaN(post.taken_at_timestamp)) rawTs = post.taken_at_timestamp * 1000;
              else if (post.date) rawTs = post.date;

              if (!rawTs) return null;
              const timestamp = new Date(rawTs).getTime();
              if (isNaN(timestamp) || timestamp < oneMonthAgo) return null;

              return {
                platform: 'instagram',
                content: post.caption || post.text || post.description || post.edge_media_to_caption?.edges?.[0]?.node?.text || '',
                likes: post.likesCount || post.likes || post.edge_liked_by?.count || 0,
                comments: post.commentsCount || post.comments || post.edge_media_to_comment?.count || 0,
                shares: post.shares || 0,
                imageUrl: post.displayUrl || post.imageUrl || post.thumbnailUrl || null,
                postUrl: post.url || `https://instagram.com/p/${post.shortCode || post.id || ''}`,
                postedAt: new Date(timestamp),
                postedAtTimestamp: timestamp,
                fetchedAt: new Date(),
                isRealData: true
              };
            }).filter(Boolean);
            
            // Update follower count if available
            if (profile.followersCount || profile.followers) {
              competitor.metrics.followers = profile.followersCount || profile.followers;
            }
            
            competitor.posts = posts;
            competitor.metrics.lastFetched = new Date();
            await competitor.save();
            console.log(`✅ Saved ${posts.length} REAL Instagram posts for ${competitor.name}`);
          } else {
            console.log(`⚠️ Profile found but no Instagram posts for ${competitor.name} (@${usedHandle}) - trying LinkedIn fallback...`);
            
            // LinkedIn fallback
            const linkedinUrl = competitor.socialHandles?.linkedin;
            if (linkedinUrl) {
              const linkedinResult = await scrapeLinkedInPosts(linkedinUrl);
              if (linkedinResult.success && linkedinResult.posts.length > 0) {
                competitor.posts = linkedinResult.posts;
                competitor.metrics.lastFetched = new Date();
                await competitor.save();
                console.log(`✅ Saved ${linkedinResult.posts.length} LinkedIn posts for ${competitor.name} (fallback)`);
              } else {
                console.log(`⚠️ No posts found on Instagram or LinkedIn for ${competitor.name}`);
              }
            } else {
              console.log(`⚠️ No LinkedIn URL for ${competitor.name}, skipping fallback`);
            }
          }
        } else {
          console.log(`⚠️ No Instagram data for ${competitor.name} - trying LinkedIn fallback...`);
          
          // LinkedIn fallback when Instagram completely fails
          const linkedinUrl = competitor.socialHandles?.linkedin;
          if (linkedinUrl) {
            const linkedinResult = await scrapeLinkedInPosts(linkedinUrl);
            if (linkedinResult.success && linkedinResult.posts.length > 0) {
              competitor.posts = linkedinResult.posts;
              competitor.metrics.lastFetched = new Date();
              await competitor.save();
              console.log(`✅ Saved ${linkedinResult.posts.length} LinkedIn posts for ${competitor.name} (fallback)`);
            } else {
              console.log(`⚠️ No posts found on Instagram or LinkedIn for ${competitor.name}`);
            }
          } else {
            console.log(`⚠️ No LinkedIn URL for ${competitor.name}, no fallback available`);
          }
        }
      } catch (postError) {
        console.error(`❌ Failed to fetch posts for ${competitor.name}:`, postError.message);
      }
      
      // Brief delay between requests to avoid rate limiting
      if (i < savedCompetitors.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    console.log('🔍 ===========================================');
    console.log('🔍 BACKGROUND COMPETITOR DISCOVERY COMPLETE');
    console.log(`🔍 ${savedCount} competitors - REAL Instagram posts only`);
    console.log('🔍 ===========================================');
  } catch (error) {
    console.error('❌ Background competitor discovery error:', error.message);
  }
}

// Validation middleware
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: errors.array()[0].msg,
      errors: errors.array()
    });
  }
  next();
};

// @route   POST /api/auth/signup
// @desc    Register a new user
// @access  Public
router.post('/signup', [
  body('email')
    .isEmail()
    .withMessage('Please enter a valid email address')
    .normalizeEmail(),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long')
    .matches(/\d/)
    .withMessage('Password must contain at least one number')
    .matches(/[a-zA-Z]/)
    .withMessage('Password must contain at least one letter'),
  body('firstName')
    .trim()
    .notEmpty()
    .withMessage('First name is required')
    .isLength({ max: 50 })
    .withMessage('First name cannot exceed 50 characters'),
  body('companyName')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Company name cannot exceed 100 characters'),
  handleValidationErrors
], async (req, res) => {
  try {
    const { email, password, firstName, lastName, companyName } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'An account with this email already exists. Please sign in.'
      });
    }

    // Create new user (unverified)
    const user = await User.create({
      email: email.toLowerCase(),
      password,
      firstName,
      lastName: lastName || '',
      companyName: companyName || '',
      isVerified: false
    });

    // Generate and send OTP
    try {
      const otp = otpService.generateOTP();
      const hashedOtp = await otpService.hashOTP(otp);
      
      user.otp = {
        code: hashedOtp,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
        attempts: 0,
        lastSentAt: new Date()
      };
      await user.save({ validateBeforeSave: false });
      
      await otpService.sendOTP(email, otp, firstName);
      console.log(`📧 OTP sent to ${email} during signup`);
    } catch (otpError) {
      console.error('OTP send error during signup:', otpError.message);
      // Don't fail signup if OTP fails — user can request resend
    }

    // SECURITY: Do NOT issue token until OTP is verified
    res.status(201).json({
      success: true,
      message: 'Account created! Please verify your email.',
      user: user.toPublicJSON(),
      requiresVerification: true
    });
  } catch (error) {
    console.error('Signup error:', error);
    
    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'An account with this email already exists.'
      });
    }
    
    // Handle validation errors
    if (error.name === 'ValidationError') {
      const message = Object.values(error.errors).map(err => err.message).join('. ');
      return res.status(400).json({
        success: false,
        message
      });
    }

    res.status(500).json({
      success: false,
      message: 'Unable to create account. Please try again later.'
    });
  }
});

// @route   POST /api/auth/send-otp
// @desc    Send or resend OTP to user's email
// @access  Public (requires token or email)
router.post('/send-otp', [
  body('email')
    .isEmail()
    .withMessage('Please enter a valid email address')
    .normalizeEmail(),
  handleValidationErrors
], async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email: email.toLowerCase() }).select('+otp.code +otp.expiresAt +otp.attempts +otp.lastSentAt');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No account found with this email.'
      });
    }

    if (user.isVerified) {
      return res.status(400).json({
        success: false,
        message: 'Email is already verified.'
      });
    }

    // Rate limit: 1 OTP per 60 seconds
    if (user.otp?.lastSentAt) {
      const timeSinceLastSend = Date.now() - new Date(user.otp.lastSentAt).getTime();
      if (timeSinceLastSend < 60000) {
        const waitSeconds = Math.ceil((60000 - timeSinceLastSend) / 1000);
        return res.status(429).json({
          success: false,
          message: `Please wait ${waitSeconds} seconds before requesting a new code.`,
          retryAfter: waitSeconds
        });
      }
    }

    // Generate new OTP
    const otp = otpService.generateOTP();
    const hashedOtp = await otpService.hashOTP(otp);

    user.otp = {
      code: hashedOtp,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      attempts: 0,
      lastSentAt: new Date()
    };
    await user.save({ validateBeforeSave: false });

    // Send email
    await otpService.sendOTP(email, otp, user.firstName);

    res.status(200).json({
      success: true,
      message: 'Verification code sent to your email.'
    });
  } catch (error) {
    console.error('Send OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send verification code. Please try again.'
    });
  }
});

// @route   POST /api/auth/verify-otp
// @desc    Verify OTP and mark email as verified
// @access  Public
router.post('/verify-otp', [
  body('email')
    .isEmail()
    .withMessage('Please enter a valid email address')
    .normalizeEmail(),
  body('otp')
    .isLength({ min: 6, max: 6 })
    .isNumeric()
    .withMessage('Please enter a valid 6-digit code'),
  handleValidationErrors
], async (req, res) => {
  try {
    const { email, otp } = req.body;

    const user = await User.findOne({ email: email.toLowerCase() }).select('+otp.code +otp.expiresAt +otp.attempts +otp.lastSentAt');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No account found with this email.'
      });
    }

    if (user.isVerified) {
      return res.status(400).json({
        success: false,
        message: 'Email is already verified.'
      });
    }

    // Check if OTP exists
    if (!user.otp?.code) {
      return res.status(400).json({
        success: false,
        message: 'No verification code found. Please request a new one.'
      });
    }

    // Check if OTP expired
    if (new Date() > new Date(user.otp.expiresAt)) {
      return res.status(400).json({
        success: false,
        message: 'Verification code has expired. Please request a new one.',
        expired: true
      });
    }

    // Check max attempts (5 attempts max)
    if (user.otp.attempts >= 5) {
      return res.status(429).json({
        success: false,
        message: 'Too many failed attempts. Please request a new code.',
        maxAttempts: true
      });
    }

    // Verify OTP
    const isValid = await otpService.verifyOTP(otp, user.otp.code);

    if (!isValid) {
      // Increment attempts
      user.otp.attempts = (user.otp.attempts || 0) + 1;
      await user.save({ validateBeforeSave: false });

      const remaining = 5 - user.otp.attempts;
      return res.status(400).json({
        success: false,
        message: `Invalid code. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`,
        attemptsRemaining: remaining
      });
    }

    // OTP is valid — mark user as verified and clear OTP data
    user.isVerified = true;
    user.otp = undefined;
    await user.save({ validateBeforeSave: false });

    // Generate fresh token
    const token = generateToken(user._id);

    console.log(`✅ Email verified: ${email}`);

    res.status(200).json({
      success: true,
      message: 'Email verified successfully! Welcome to Gravity.',
      token,
      user: user.toPublicJSON()
    });
  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Verification failed. Please try again.'
    });
  }
});

// @route   POST /api/auth/login
// @desc    Login user
// @access  Public
router.post('/login', [
  body('email')
    .isEmail()
    .withMessage('Please enter a valid email address')
    .normalizeEmail(),
  body('password')
    .notEmpty()
    .withMessage('Password is required'),
  handleValidationErrors
], async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user and include password for comparison
    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password. Please try again.'
      });
    }

    // Check if account is active
    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Your account has been deactivated. Please contact support.'
      });
    }

    // Check password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password. Please try again.'
      });
    }

    // Check if email is verified
    if (!user.isVerified) {
      // Send a new OTP automatically
      try {
        const otp = otpService.generateOTP();
        const hashedOtp = await otpService.hashOTP(otp);
        
        // Need to re-fetch with OTP fields
        const userWithOtp = await User.findById(user._id).select('+otp.lastSentAt');
        
        // Rate limit check
        const timeSinceLastSend = userWithOtp?.otp?.lastSentAt ? Date.now() - new Date(userWithOtp.otp.lastSentAt).getTime() : Infinity;
        
        if (timeSinceLastSend >= 60000) {
          await User.findByIdAndUpdate(user._id, {
            'otp.code': hashedOtp,
            'otp.expiresAt': new Date(Date.now() + 10 * 60 * 1000),
            'otp.attempts': 0,
            'otp.lastSentAt': new Date()
          });
          await otpService.sendOTP(email, otp, user.firstName);
        }
      } catch (otpErr) {
        console.error('Auto OTP on login error:', otpErr.message);
      }

      // SECURITY: Do NOT issue a JWT token until OTP is verified
      return res.status(200).json({
        success: true,
        message: 'Please verify your email to continue.',
        user: user.toPublicJSON(),
        requiresVerification: true
      });
    }

    // Generate token
    const token = generateToken(user._id);

    // Update last login
    user.lastLoginAt = new Date();
    await user.save({ validateBeforeSave: false });

    res.status(200).json({
      success: true,
      message: 'Welcome back!',
      token,
      user: user.toPublicJSON()
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Unable to sign in. Please try again later.'
    });
  }
});

// @route   GET /api/auth/business-context
// @desc    Get user's business context including location
// @access  Private
router.get('/business-context', protect, async (req, res) => {
  try {
    const OnboardingContext = require('../models/OnboardingContext');
    const context = await OnboardingContext.findOne({ userId: req.user._id });
    
    if (!context) {
      return res.status(404).json({
        success: false,
        message: 'Business context not found. Please complete onboarding.'
      });
    }
    
    res.status(200).json({
      success: true,
      context: {
        company: context.company,
        geography: context.geography,
        targetCustomer: context.targetCustomer,
        primaryGoal: context.primaryGoal
      }
    });
  } catch (error) {
    console.error('Get business context error:', error);
    res.status(500).json({
      success: false,
      message: 'Unable to fetch business context'
    });
  }
});

// @route   GET /api/auth/me
// @desc    Get current logged in user
// @access  Private
router.get('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // SECURITY: Reject unverified users — they should not have dashboard access
    if (!user.isVerified) {
      return res.status(403).json({
        success: false,
        message: 'Email not verified. Please complete OTP verification.',
        requiresVerification: true
      });
    }

    res.status(200).json({
      success: true,
      user: user.toPublicJSON()
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      success: false,
      message: 'Unable to fetch user data'
    });
  }
});

// @route   PUT /api/auth/update-profile
// @desc    Update user profile
// @access  Private
router.put('/update-profile', protect, [
  body('firstName')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('First name cannot exceed 50 characters'),
  body('lastName')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('Last name cannot exceed 50 characters'),
  body('companyName')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Company name cannot exceed 100 characters'),
  handleValidationErrors
], async (req, res) => {
  try {
    const allowedUpdates = ['firstName', 'lastName', 'companyName', 'avatar'];
    const updates = {};
    
    allowedUpdates.forEach(field => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    const user = await User.findByIdAndUpdate(
      req.user._id,
      updates,
      { new: true, runValidators: true }
    );

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      user: user.toPublicJSON()
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Unable to update profile'
    });
  }
});

// @route   PUT /api/auth/complete-onboarding
// @desc    Complete onboarding and save business profile
// @access  Private
router.put('/complete-onboarding', protect, async (req, res) => {
  try {
    const { businessProfile, connectedSocials } = req.body;

    const updateData = {
      onboardingCompleted: true,
      businessProfile: businessProfile || {}
    };

    // If connected socials are provided during onboarding, save them
    if (connectedSocials && Array.isArray(connectedSocials) && connectedSocials.length > 0) {
      updateData.connectedSocials = connectedSocials.map(social => ({
        platform: social.platform,
        accountName: social.username || social.accountName,
        connectedAt: new Date()
      }));
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      updateData,
      { new: true }
    );

    // Also save to OnboardingContext for AI outreach
    try {
      const OnboardingContext = require('../models/OnboardingContext');
      
      // Parse location from businessLocation field
      const locationParts = (businessProfile?.businessLocation || '').split(',').map(p => p.trim());
      const regions = locationParts.length > 0 ? [locationParts[0]] : [];
      const countries = locationParts.length > 1 ? [locationParts[locationParts.length - 1]] : [];
      
      const contextData = {
        userId: req.user._id,
        company: {
          name: businessProfile?.name || businessProfile?.companyName || '',
          website: businessProfile?.website || '',
          industry: businessProfile?.industry || '',
          description: businessProfile?.niche || businessProfile?.description || businessProfile?.tagline || ''
        },
        targetCustomer: {
          description: businessProfile?.targetAudience || businessProfile?.goals || 'General audience',
          roles: [],
          companySize: 'any',
          industries: [businessProfile?.industry || ''].filter(Boolean)
        },
        geography: {
          isGlobal: !businessProfile?.businessLocation,
          regions: regions,
          countries: countries,
          businessLocation: businessProfile?.businessLocation || ''
        },
        primaryGoal: businessProfile?.goals?.toLowerCase()?.includes('lead') ? 'leads' 
          : businessProfile?.goals?.toLowerCase()?.includes('sale') ? 'sales'
          : businessProfile?.goals?.toLowerCase()?.includes('awareness') ? 'awareness'
          : 'leads',
        // Handle brandVoice as array or string
        brandTone: Array.isArray(businessProfile?.brandVoice) 
          ? businessProfile.brandVoice 
          : businessProfile?.brandVoice 
            ? [businessProfile.brandVoice] 
            : ['professional'],
        valueProposition: {
          main: businessProfile?.tagline || businessProfile?.niche || '',
          keyBenefits: [],
          differentiators: []
        },
        completionStatus: {
          isComplete: true,
          completedAt: new Date()
        }
      };
      
      await OnboardingContext.findOneAndUpdate(
        { userId: req.user._id },
        contextData,
        { upsert: true, new: true }
      );
      
      console.log('✅ OnboardingContext saved for AI outreach');
      
      // START competitor discovery in background (don't wait - would timeout)
      // Fire and forget - user sees dashboard immediately
      console.log('🚀 Starting competitor discovery in background...');
      triggerCompetitorDiscovery(req.user._id, contextData)
        .then(() => console.log('✅ Competitor discovery completed!'))
        .catch(err => console.error('Competitor discovery error:', err.message));
      
    } catch (contextError) {
      console.error('Failed to save OnboardingContext:', contextError);
      // Don't fail the whole request, just log
    }

    console.log('Onboarding completed for user:', user.email);
    console.log('Business Profile saved:', JSON.stringify(user.businessProfile, null, 2));

    res.status(200).json({
      success: true,
      message: 'Onboarding completed successfully',
      user: user.toPublicJSON()
    });
  } catch (error) {
    console.error('Complete onboarding error:', error);
    res.status(500).json({
      success: false,
      message: 'Unable to complete onboarding'
    });
  }
});

// @route   PUT /api/auth/change-password
// @desc    Change password
// @access  Private
router.put('/change-password', protect, [
  body('currentPassword')
    .notEmpty()
    .withMessage('Current password is required'),
  body('newPassword')
    .isLength({ min: 8 })
    .withMessage('New password must be at least 8 characters long')
    .matches(/\d/)
    .withMessage('New password must contain at least one number')
    .matches(/[a-zA-Z]/)
    .withMessage('New password must contain at least one letter'),
  handleValidationErrors
], async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    // Get user with password
    const user = await User.findById(req.user._id).select('+password');

    // Check current password
    const isPasswordValid = await user.comparePassword(currentPassword);
    if (!isPasswordValid) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Update password
    user.password = newPassword;
    await user.save();

    // Generate new token
    const token = generateToken(user._id);

    res.status(200).json({
      success: true,
      message: 'Password changed successfully',
      token
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'Unable to change password'
    });
  }
});

// @route   POST /api/auth/logout
// @desc    Logout user (client-side token removal)
// @access  Private
router.post('/logout', protect, (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Logged out successfully'
  });
});

module.exports = router;
