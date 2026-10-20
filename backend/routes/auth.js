const express = require('express');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { generateToken, protect, protectCached } = require('../middleware/auth');
const Competitor = require('../models/Competitor');
const { removeCompetitorsWithSnapshots } = require('../services/competitors/cleanup');

const { generateWithLLM } = require('../services/llmRouter');
const { lookupInstagramHandle } = require('../services/serperLookup');
const { callClaude, parseClaudeJSON } = require('../services/claudeAI');
const axios = require('axios');
const otpService = require('../services/otpService');
// Password and code hashing: native bcrypt on the thread pool, at most 3 at once; a full queue answers a plain 503.
const { isBusyError, BUSY_MESSAGE: HASH_BUSY_MESSAGE, rehashIfNeeded } = require('../services/passwordHash');
const answerBusy = (res, error) => {
  if (!isBusyError(error)) return false;
  res.status(503).json({ success: false, message: HASH_BUSY_MESSAGE });
  return true;
};

// Account enumeration (B3, docs/superpowers/ops/security-hardening.md section 10): the code and reset routes answer the
// same status and body whether or not the email has an account, and do the same hashing work in both branches (a
// dummy hash when there is no account), so neither the answer nor its time tells them apart. Storing and sending the
// code happen after the answer. Sign-up keeps "already exists" on purpose (decision D50).
const CODE_SENT = 'If an account exists, we have sent a code.';
const CODE_FAILED = 'That code did not work. Check it, or request a new code.';
const LOGIN_FAILED = 'Invalid email or password. Please try again.';
const { passwordRule } = require('../utils/passwordPolicy');
const loginGuard = () => require('../services/loginGuard').sharedLoginGuard();
const passwordHashing = require('../services/passwordHash');
let dummyOtpHash = null;
let dummyPasswordHash = null;
/** A real bcrypt hash at the code cost, made once: compared against when there is no account or no usable code. */
const dummyOtp = () => (dummyOtpHash = dummyOtpHash || otpService.hashOTP('000000'));
/** A real bcrypt hash at the password cost, made once: compared against when the email has no account. */
const dummyPassword = () => (dummyPasswordHash = dummyPasswordHash || passwordHashing.hash(`no-account-${Date.now()}`));
const otpCodeFields = '+otp.code +otp.expiresAt +otp.attempts +otp.lastSentAt';
const OTP_GAP_MS = 60000;

/** Hashes a fresh code in every case; stores and mails it (after the answer) only when `deliver` is true. */
async function issueCodeQuietly({ user, email, deliver, label }) {
  const otp = otpService.generateOTP();
  const hashed = await otpService.hashOTP(otp);
  if (!deliver || !user) return;
  user.otp = { code: hashed, expiresAt: new Date(Date.now() + 10 * 60 * 1000), attempts: 0, lastSentAt: new Date() };
  setImmediate(() => {
    Promise.resolve()
      .then(() => user.save({ validateBeforeSave: false }))
      .then(() => otpService.sendOTP(email, otp, user.firstName))
      .then(() => console.log(`📧 ${label} code sent`))
      .catch((e) => console.error(`${label} code could not be sent:`, e && e.message));
  });
}
const sentRecently = (user) => Boolean(user && user.otp && user.otp.lastSentAt && Date.now() - new Date(user.otp.lastSentAt).getTime() < OTP_GAP_MS);

/**
 * Checks a code with the same work for every case. `usable` is the account's code when it exists, is not expired and
 * has tries left; otherwise a dummy hash is compared and the answer is "no". Returns { ok, wrongOnRealCode }; the
 * caller counts a wrong try only on a real code.
 */
async function checkCodeEvenly(user, otp, { requireUnverified = false } = {}) {
  const c = user && user.otp;
  const usable = Boolean(user && (!requireUnverified || !user.isVerified) && c && c.code && new Date() <= new Date(c.expiresAt) && (c.attempts || 0) < 5);
  const match = await otpService.verifyOTP(otp, usable ? c.code : await dummyOtp());
  return { ok: usable && match, wrongOnRealCode: usable && !match };
}
const { newAccountPlan } = require('../config/entitlements');
const rateLimit = require('../services/rateLimitStore').rateLimit;
const { signupGuard, publicConfig, canonicalEmail, MSG: SIGNUP_MSG } = require('../services/signupGuard');
const agencyRules = require('../services/agency');
const { determineBrandColors } = require('../services/brandIntelligenceService');
const { scrapeWebsite } = require('../services/scraper');

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

const { sanitizeAdditionalLanguages } = require('../services/languageSupport');
const { cleanAccountKind } = require('../services/accountKind');
const { cleanBusinessProfile } = require('../services/businessProfile');

// Keep the extra post languages to the allowed base codes, deduplicated,
// at most three, and never the same language as the primary one.
// Also cleans the questionnaire answers (old values mapped, unknown choices dropped) so a save never fails on them.
function withCleanLanguages(profile) {
  if (!profile || typeof profile !== 'object') return profile;
  const clean = cleanBusinessProfile(profile);
  return cleanAccountKind({ ...clean, additionalLanguages: sanitizeAdditionalLanguages(clean.additionalLanguages, clean.contentLanguage) });
}

// OnboardingContext (outreach) words for the first goal and the business-customer size.
function onboardingPrimaryGoal(goals) {
  const first = String((Array.isArray(goals) ? goals[0] : goals) || '').toLowerCase();
  if (/lead|enquir/.test(first)) return 'leads';
  if (/sale/.test(first)) return 'sales';
  if (/awareness|brand/.test(first)) return 'awareness';
  return 'leads';
}
function onboardingCompanySize(size) {
  return ({ solo: '1-10', small: '11-50', medium: '51-200', large: '1000+' })[size] || 'any';
}

// The public profile, with a client workspace's Quarks replaced by the agency pool balance (no history).
async function withPoolCredits(user) {
  const pub = user.toPublicJSON();
  const pool = await agencyRules.publicCredits(user);
  if (pool) pub.credits = pool;
  return pub;
}

const router = express.Router();

// Signup abuse limits (per visitor address). Kept small: a real customer signs up once.
const signupLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: 'Too many sign-ups from this connection today. Please try again tomorrow, or sign in if you already have an account.' }
});
const brandColorsLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 12, standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please try again in a while.' }
});

// What the signup screen needs (invitation box, bot check). Never includes a secret.
router.get('/signup-config', (req, res) => res.json({ success: true, ...publicConfig() }));

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

    if (!businessContext.description && (!businessContext.industry || businessContext.industry === 'General')) {
      console.log('⚠️ No niche or industry specified, skipping competitor discovery');
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
    await removeCompetitorsWithSnapshots({ userId, isAutoDiscovered: true });

    const prompt = `You are a market research expert. Find competitors for this business.

BUSINESS:
- Company: ${businessContext.companyName}
- Industry: ${businessContext.industry}
- Description: ${businessContext.description || 'Not provided'}
- Target Customer: ${businessContext.targetCustomer || 'Not specified'}
- Location: ${businessContext.location}

FIND EXACTLY 15 REAL COMPETITORS that offer similar products/services.

MANDATORY SPLIT (strictly follow this):
- 5 LOCAL competitors (same city/region as ${businessContext.location})
- 5 NATIONAL competitors (major players in the country)
- 5 GLOBAL competitors (international leaders)

CRITICAL RULES:
- Competitors must do THE SAME THING as this business (same products/services/business model)
- All 15 must be REAL companies that currently exist
- Do NOT include generic big tech companies unless they directly compete
- Be HYPER-SPECIFIC to the business niche

For each competitor, provide:
- Real company name
- Real website URL
- LinkedIn company URL (https://linkedin.com/company/companyname)
- Brief description of what they do
- Their location
- competitorType: must be exactly "local", "national", or "global"

RETURN THIS JSON:
{
  "competitors": [
    {
      "name": "Company Name",
      "website": "https://company.com",
      "linkedin": "https://linkedin.com/company/companyname",
      "description": "What they do",
      "location": "City, Country",
      "competitorType": "local|national|global",
      "estimatedFollowers": 10000
    }
  ]
}

IMPORTANT: Return EXACTLY 15 competitors (5 local + 5 national + 5 global). Return only valid JSON.`;

    console.log('📤 Calling Claude Sonnet 4.6 for competitor discovery...');
    const responseText = await callClaude(prompt);
    
    let parsed;
    try {
      parsed = parseClaudeJSON(responseText);
    } catch (e) {
      console.error('Failed to parse Claude response:', e.message);
      console.log('Response preview:', responseText?.substring(0, 300));
      return;
    }

    if (!parsed?.competitors?.length) {
      console.log('⚠️ No competitors found in Claude response');
      return;
    }

    console.log(`✅ Found ${parsed.competitors.length} competitors`);

    // Use Serper to resolve REAL Instagram handles
    console.log('🔍 Resolving Instagram handles via Serper...');
    const handleMap = {};
    for (const comp of parsed.competitors) {
      if (!comp.name || comp.name.length < 2) continue;
      const lookup = await lookupInstagramHandle(comp.name, comp.description);
      handleMap[comp.name] = lookup.handle;
      await new Promise(r => setTimeout(r, 300));
    }

    // Save competitors and generate posts for each
    let savedCount = 0;
    const savedCompetitors = [];
    
    for (const comp of parsed.competitors) {
      if (!comp.name || comp.name.length < 2) continue;
      
      // Use Serper-verified handle, fall back to Claude's guess only if Serper found nothing
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
          handleStatus: 'suggested', // a guessed or searched handle: not read until verified or confirmed
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

async function detectWebsiteBrandColors(websiteInput) {
  const result = await determineBrandColors({
    websiteUrl: websiteInput,
    scrapeWebsite: async (url) => scrapeWebsite(url, {
      ignoreRobots: true,
      includeRaw: true,
      forceRefresh: true
    })
  });

  return {
    primary: result?.primary_color || '',
    secondary: result?.secondary_color || '',
    source: result?.source || 'none',
    confidence: result?.confidence || 0,
    reason: result?.reason || ''
  };
}

// @route   POST /api/auth/signup-brand-colors
// @desc    Detect brand colors from company website during signup
// @access  Public
router.post('/signup-brand-colors', brandColorsLimiter, [
  body('website')
    .trim()
    .notEmpty()
    .withMessage('Website is required'),
  handleValidationErrors
], async (req, res) => {
  try {
    const { website } = req.body;
    const colors = await detectWebsiteBrandColors(website);

    res.status(200).json({
      success: true,
      primaryColor: colors.primary,
      secondaryColor: colors.secondary,
      source: colors.source,
      confidence: colors.confidence
    });
  } catch (error) {
    console.error('Signup brand color detection error:', error);
    res.status(500).json({
      success: false,
      message: 'Unable to detect brand colors right now.'
    });
  }
});

// @route   POST /api/auth/signup
// @desc    Register a new user
// @access  Public
router.post('/signup', signupLimiter, signupGuard(), [
  body('email')
    .isEmail()
    .withMessage('Please enter a valid email address')
    .normalizeEmail(),
  // New passwords: at least 10 characters, a letter and a number, not a very common one (utils/passwordPolicy.js, B10).
  body('password').custom(passwordRule),
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
  body('website')
    .optional()
    .trim()
    .isLength({ max: 300 })
    .withMessage('Website URL cannot exceed 300 characters'),
  body('acceptedTerms').custom(require('../services/consent').acceptedTermsCheck),
  handleValidationErrors
], async (req, res) => {
  try {
    const { email, password, firstName, lastName, companyName, website } = req.body;

    // Check if user already exists (the same mailbox written another way counts as the same account)
    const emailKey = canonicalEmail(email);
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'An account with this email already exists. Please sign in.'
      });
    }
    if (await User.exists({ emailKey })) {
      return res.status(400).json({ success: false, message: SIGNUP_MSG.alias });
    }

    let brandAssets = undefined;
    let normalizedWebsite = '';
    if (website && String(website).trim()) {
      normalizedWebsite = String(website).trim();
      if (!/^https?:\/\//i.test(normalizedWebsite)) {
        normalizedWebsite = `https://${normalizedWebsite}`;
      }
      try {
        const colors = await detectWebsiteBrandColors(normalizedWebsite);
        brandAssets = {
          brandColors: [colors.primary, colors.secondary].filter(Boolean)
        };
      } catch (colorError) {
        console.error('Website color detection failed during signup:', colorError.message);
      }
    }

    // Create new user (unverified)
    const user = await User.create({
      email: email.toLowerCase(),
      emailKey,
      password,
      firstName,
      lastName: lastName || '',
      companyName: companyName || '',
      businessProfile: {
        website: normalizedWebsite,
        brandAssets: brandAssets || {
          brandColors: []
        }
      },
      isVerified: false,
      plan: newAccountPlan(),
      consent: require('../services/consent').consentRecord()
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
    if (answerBusy(res, error)) return;
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
    const user = await User.findOne({ email: email.toLowerCase() }).select(otpCodeFields);
    // Only an unverified account gets a code, at most one a minute; every other case gets the same answer (B3).
    await issueCodeQuietly({ user, email, deliver: Boolean(user && !user.isVerified && !sentRecently(user)), label: 'Verification' });
    res.status(200).json({ success: true, message: CODE_SENT });
  } catch (error) {
    if (answerBusy(res, error)) return;
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

    const user = await User.findOne({ email: email.toLowerCase() }).select(otpCodeFields);

    // No account, already verified, no code, expired, five wrong tries or a wrong code: one answer for all (B3).
    const { ok, wrongOnRealCode } = await checkCodeEvenly(user, otp, { requireUnverified: true });
    if (!ok) {
      if (wrongOnRealCode) await User.updateOne({ _id: user._id }, { $inc: { 'otp.attempts': 1 } });
      return res.status(400).json({ success: false, message: CODE_FAILED });
    }

    // OTP is valid — mark user as verified and clear OTP data
    user.isVerified = true;
    user.otp = undefined;
    await user.save({ validateBeforeSave: false });

    // Generate fresh token
    const token = generateToken(user._id, user.tokenVersion);

    console.log(`✅ Email verified: ${email}`);

    res.status(200).json({
      success: true,
      message: 'Email verified successfully! Welcome to Nebulaa.',
      token,
      user: user.toPublicJSON()
    });
  } catch (error) {
    if (answerBusy(res, error)) return;
    console.error('Verify OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Verification failed. Please try again.'
    });
  }
});

// @route   POST /api/auth/forgot-password
// @desc    Send OTP for password reset (works for verified users)
// @access  Public
router.post('/forgot-password', [
  body('email')
    .isEmail()
    .withMessage('Please enter a valid email address')
    .normalizeEmail(),
  handleValidationErrors
], async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() }).select(otpCodeFields);
    // Any account gets a reset code, at most one a minute; no account gets the same answer and no email (B3).
    await issueCodeQuietly({ user, email, deliver: Boolean(user && !sentRecently(user)), label: 'Password reset' });
    res.status(200).json({ success: true, message: CODE_SENT });
  } catch (error) {
    if (answerBusy(res, error)) return;
    console.error('Forgot password error:', error);
    res.status(500).json({ success: false, message: 'Failed to send reset code. Please try again.' });
  }
});

// @route   POST /api/auth/verify-reset-otp
// @desc    Verify OTP for password reset (does NOT log in)
// @access  Public
router.post('/verify-reset-otp', [
  body('email').isEmail().normalizeEmail(),
  body('otp').isLength({ min: 6, max: 6 }).isNumeric(),
  handleValidationErrors
], async (req, res) => {
  try {
    const { email, otp } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() }).select(otpCodeFields);

    // No account, no code, expired, five wrong tries or a wrong code: one answer for all (B3).
    const { ok, wrongOnRealCode } = await checkCodeEvenly(user, otp);
    if (!ok) {
      if (wrongOnRealCode) await User.updateOne({ _id: user._id }, { $inc: { 'otp.attempts': 1 } });
      return res.status(400).json({ success: false, message: CODE_FAILED });
    }

    // OTP valid — don't clear it yet, we need it for the reset step
    res.status(200).json({ success: true, message: 'Code verified. You can now set a new password.' });
  } catch (error) {
    if (answerBusy(res, error)) return;
    console.error('Verify reset OTP error:', error);
    res.status(500).json({ success: false, message: 'Verification failed.' });
  }
});

// @route   POST /api/auth/reset-password
// @desc    Reset password after OTP verification
// @access  Public
router.post('/reset-password', [
  body('email').isEmail().normalizeEmail(),
  body('otp').isLength({ min: 6, max: 6 }).isNumeric(),
  body('newPassword').custom(passwordRule),
  handleValidationErrors
], async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() }).select('+password +otp.code +otp.expiresAt +otp.attempts');

    // Re-verify the code (guessing it here counts like anywhere else: five wrong tries and it is dead). No account, no
    // code, expired, too many tries or a wrong code: one answer for all (B3).
    const { ok, wrongOnRealCode } = await checkCodeEvenly(user, otp);
    if (!ok) {
      if (wrongOnRealCode) await User.updateOne({ _id: user._id }, { $inc: { 'otp.attempts': 1 } });
      return res.status(400).json({ success: false, message: CODE_FAILED });
    }

    // Update password (pre-save hook will hash it)
    user.password = newPassword;
    user.otp = undefined;
    await user.save();

    console.log(`✅ Password reset successful for ${email}`);
    res.status(200).json({ success: true, message: 'Password updated successfully. Please sign in.' });
  } catch (error) {
    if (answerBusy(res, error)) return;
    console.error('Reset password error:', error);
    res.status(500).json({ success: false, message: 'Failed to reset password.' });
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
    .withMessage('Password is required')
    .bail()
    .isString()
    .withMessage('Please enter your password')
    .isLength({ max: 200 })
    .withMessage('Please enter your password'),
  handleValidationErrors
], async (req, res) => {
  try {
    const { email, password } = req.body;
    const attempt = { email: email.toLowerCase(), ip: req.ip, challengeToken: req.body.challengeToken };

    // Lockout per email + address with an escalating wait, and a per-account ceiling that never shuts the owner out
    // of a place they signed in from before (B4, services/loginGuard.js). Checked before the password, so a try that
    // is too early is not a free guess; the same for an email with or without an account.
    const gate = await loginGuard().check(attempt);
    if (!gate.allowed) {
      if (gate.retryAfter) res.set('Retry-After', String(gate.retryAfter));
      return res.status(429).json({ success: false, message: gate.message, retryAfter: gate.retryAfter, ...(gate.challengeRequired ? { challengeRequired: true } : {}) });
    }

    // Find user and include password for comparison
    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');

    if (!user) {
      // The same hashing work as a real check, so the time does not say "no account" (B3).
      await passwordHashing.compare(String(password), await dummyPassword());
      await loginGuard().fail(attempt);
      return res.status(401).json({ success: false, message: LOGIN_FAILED });
    }

    // Check password
    const isPasswordValid = await user.comparePassword(password);
    if (isPasswordValid && !user.isActive) {
      // Said only to someone who knows the password: without it a deactivated account looks like any other.
      return res.status(401).json({
        success: false,
        message: 'Your account has been deactivated. Please contact support.'
      });
    }
    if (!isPasswordValid) {
      await loginGuard().fail({ ...attempt, user });
      return res.status(401).json({ success: false, message: LOGIN_FAILED });
    }
    await loginGuard().success(attempt);

    // The old account-wide lock (failedLoginAttempts / lockUntil) is no longer used; clear what it left behind.
    if (user.failedLoginAttempts > 0 || user.lockUntil) {
      await User.findByIdAndUpdate(user._id, { failedLoginAttempts: 0, lockUntil: null });
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
    const token = generateToken(user._id, user.tokenVersion);

    // Update last login
    user.lastLoginAt = new Date();
    await user.save({ validateBeforeSave: false });
    // A password stored at another cost than BCRYPT_ROUNDS is stored again at that cost (not waited for, never fails the sign-in)
    rehashIfNeeded(user, password).catch(() => {});

    res.status(200).json({
      success: true,
      message: 'Welcome back!',
      token,
      user: user.toPublicJSON()
    });
  } catch (error) {
    if (answerBusy(res, error)) return;
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
// protectCached: only the id is read from req.user; the handler loads the full, fresh user itself (auth-cache.md).
router.get('/me', protectCached, async (req, res) => {
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

    // A client workspace spends from the agency's Quarks, so it shows the pool balance (response only, never saved).
    const publicUser = { ...(await withPoolCredits(user)), isCsm: Boolean(user.isCsm) };
    res.status(200).json({
      success: true,
      user: publicUser,
      // Set when a CSM is working inside this account, so the app can show who is acting.
      actingCsm: req.actingCsm ? { name: [req.actingCsm.firstName, req.actingCsm.lastName].filter(Boolean).join(' ') || req.actingCsm.email } : null,
      // Set when an agency is working inside one of its clients.
      actingAgency: req.actingAgency ? { name: [req.actingAgency.firstName, req.actingAgency.lastName].filter(Boolean).join(' ') || req.actingAgency.email } : null
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
    const allowedUpdates = ['firstName', 'lastName', 'companyName', 'avatar', 'businessProfile', 'mobileNumber'];
    const updates = {};
    
    allowedUpdates.forEach(field => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    // A website that is a script or data link, markup, or carries a password is refused (services/safeUrl.js); other
    // text that is not an address is stored as '' by the model.
    if (require('../services/safeUrl').isDangerousUrl(updates.businessProfile && updates.businessProfile.website)) {
      return res.status(400).json({ success: false, message: require('../services/safeUrl').WEBSITE_MESSAGE });
    }
    if (updates.businessProfile && typeof updates.businessProfile === 'object') {
      updates.businessProfile = withCleanLanguages(updates.businessProfile);
    }
    require('../services/accountNames').applyNameSync(updates);

    const user = await User.findByIdAndUpdate(
      req.user._id,
      updates,
      { new: true, runValidators: true }
    );

    // Fire and forget: a plan is started if this save completed the profile; it never delays or fails the save.
    require('../services/plan/planService').maybeStartFirstPlanSafe(req.user._id);
    require('../services/brandMemory/runner').refreshSoon(req.user._id, 'profile');

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      user: await withPoolCredits(user)
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Unable to update profile'
    });
  }
});

// @route   POST /api/auth/verify-gst
// @desc    Verify a GST number against government database
// @access  Private
router.post('/verify-gst', protect, async (req, res) => {
  try {
    const { gstNumber } = req.body;
    if (!gstNumber) {
      return res.status(400).json({ success: false, message: 'GST number is required' });
    }
    const { verifyGST } = require('../services/gstVerifier');
    const result = await verifyGST(gstNumber);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('GST verify error:', error);
    res.status(500).json({ success: false, message: 'GST verification failed' });
  }
});

// @route   POST /api/auth/check-duplicate
// @desc    Check if business name, website, or GST already exists in another account
// @access  Private
router.post('/check-duplicate', protect, async (req, res) => {
  try {
    const { businessName, website, gstNumber } = req.body;
    const currentUserId = req.user._id;

    // Build OR query for any matching field (case-insensitive)
    const conditions = [];
    if (businessName && businessName.trim()) {
      conditions.push({ 'businessProfile.name': { $regex: new RegExp(`^${businessName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } });
    }
    if (website && website.trim()) {
      const cleanUrl = website.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '').toLowerCase();
      conditions.push({ 'businessProfile.website': { $regex: new RegExp(cleanUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') } });
    }
    if (gstNumber && gstNumber.trim()) {
      conditions.push({ 'businessProfile.gstNumber': gstNumber.trim().toUpperCase() });
    }

    if (conditions.length === 0) {
      return res.json({ success: true, duplicate: false });
    }

    const existingUser = await User.findOne({
      _id: { $ne: currentUserId },
      onboardingCompleted: true,
      $or: conditions
    });

    if (existingUser) {
      // Determine which field matched
      const matched = [];
      if (businessName && existingUser.businessProfile?.name?.toLowerCase() === businessName.trim().toLowerCase()) matched.push('business name');
      if (website) {
        const cleanInput = website.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '').toLowerCase();
        const cleanExisting = (existingUser.businessProfile?.website || '').replace(/^https?:\/\//, '').replace(/\/+$/, '').toLowerCase();
        if (cleanInput === cleanExisting) matched.push('website');
      }
      if (gstNumber && existingUser.businessProfile?.gstNumber?.toUpperCase() === gstNumber.trim().toUpperCase()) matched.push('GST number');

      return res.json({
        success: true,
        duplicate: true,
        matchedFields: matched,
        existingEmail: existingUser.email.replace(/(.{2})(.*)(@.*)/, '$1***$3') // Mask email
      });
    }

    res.json({ success: true, duplicate: false });
  } catch (error) {
    console.error('Check duplicate error:', error);
    res.status(500).json({ success: false, message: 'Duplicate check failed' });
  }
});

// @route   PUT /api/auth/complete-onboarding
// @desc    Complete onboarding and save business profile
// @access  Private
router.put('/complete-onboarding', protect, async (req, res) => {
  try {
    const { businessProfile, connectedSocials, mobileNumber } = req.body;
    // A website that is a script or data link, markup, or carries a password is refused (services/safeUrl.js); other
    // text that is not an address is stored as '' by the model.
    if (require('../services/safeUrl').isDangerousUrl(businessProfile && businessProfile.website)) {
      return res.status(400).json({ success: false, message: require('../services/safeUrl').WEBSITE_MESSAGE });
    }

    const updateData = {
      onboardingCompleted: true,
      businessProfile: withCleanLanguages(businessProfile || {})
    };

    if (mobileNumber) updateData.mobileNumber = mobileNumber;
    require('../services/accountNames').applyNameSync(updateData);

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

    require('../services/plan/planService').maybeStartFirstPlanSafe(req.user._id);
    require('../services/brandMemory/runner').refreshSoon(req.user._id, 'profile');

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
          roles: businessProfile?.b2b?.decisionMaker ? [String(businessProfile.b2b.decisionMaker).slice(0, 120)] : [],
          companySize: onboardingCompanySize(businessProfile?.b2b?.companySize),
          industries: [businessProfile?.industry || ''].filter(Boolean)
        },
        geography: {
          isGlobal: !businessProfile?.businessLocation,
          regions: regions,
          countries: countries,
          businessLocation: businessProfile?.businessLocation || ''
        },
        // The goals are the list the questionnaire saves (an older field 'goals' never existed, so this was always 'leads').
        primaryGoal: onboardingPrimaryGoal(businessProfile?.marketingGoals),
        // Handle brandVoice as array or string
        brandTone: Array.isArray(businessProfile?.brandVoice) 
          ? (businessProfile.brandVoice.length ? businessProfile.brandVoice : ['professional'])
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
      
      // Competitor discovery is now handled by brand.js quick-analyze (single flow)
      // No separate background discovery needed
      
    } catch (contextError) {
      console.error('Failed to save OnboardingContext:', contextError);
      // Don't fail the whole request, just log
    }

    console.log('Onboarding completed for user:', user.email);
    console.log('Business Profile saved:', JSON.stringify(user.businessProfile, null, 2));

    try {
      const { generateMonthlyCalendar } = require('../services/contentCalendarService');
      // No plan exists yet at this point, so this is normally unchanged; a lookup failure never blocks it.
      const { withPlanGuidance } = require('../services/week/planContext');
      withPlanGuidance(user._id).then((opts) => generateMonthlyCalendar(user, null, opts)).catch((calendarError) => {
        console.error('Failed to generate Gravity Smart Calendar:', calendarError);
      });
    } catch (calendarError) {
      console.error('Failed to start Gravity Smart Calendar generation:', calendarError);
    }

    res.status(200).json({
      success: true,
      message: 'Onboarding completed successfully',
      user: await withPoolCredits(user)
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
  body('newPassword').custom(passwordRule),
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
    const token = generateToken(user._id, user.tokenVersion);

    res.status(200).json({
      success: true,
      message: 'Password changed successfully',
      token
    });
  } catch (error) {
    if (answerBusy(res, error)) return;
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
