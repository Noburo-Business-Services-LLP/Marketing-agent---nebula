const express = require('express');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { generateToken, protect } = require('../middleware/auth');
const Competitor = require('../models/Competitor');
const { generateWithLLM } = require('../services/llmRouter');

// Import REAL Instagram post fetching via Apify - NO AI FALLBACK
let scrapeInstagramProfile;
try {
  const socialAPI = require('../services/socialMediaAPI');
  scrapeInstagramProfile = socialAPI.scrapeInstagramProfile;
} catch (e) {
  console.warn('socialMediaAPI not available');
  scrapeInstagramProfile = async () => ({ success: false });
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

CRITICAL: For Instagram handles, provide the EXACT official Instagram username that exists. 
- Do NOT guess handles - only include handles you are certain exist
- Common patterns: companyname, company_name, company.official, getcompanyname
- If unsure about Instagram handle, leave it as empty string ""

RETURN THIS JSON:
{
  "competitors": [
    {
      "name": "Company Name",
      "website": "https://company.com",
      "instagram": "exacthandle",
      "twitter": "exacthandle",
      "description": "What they do",
      "location": "City, Country",
      "competitorType": "local|national|global|startup",
      "estimatedFollowers": 10000
    }
  ]
}

All 15 competitors must be REAL companies with VERIFIED Instagram handles. Return only valid JSON.`;

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

    // Save competitors and generate posts for each
    let savedCount = 0;
    const savedCompetitors = [];
    
    for (const comp of parsed.competitors) {
      if (!comp.name || comp.name.length < 2) continue;
      
      try {
        const competitor = await Competitor.create({
          userId,
          name: comp.name,
          website: comp.website || '',
          description: comp.description || '',
          industry: businessContext.industry,
          socialHandles: {
            instagram: (comp.instagram || '').replace('@', ''),
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
    
    // Process in batches of 5 for faster scraping
    const batchSize = 5;
    for (let i = 0; i < savedCompetitors.length; i += batchSize) {
      const batch = savedCompetitors.slice(i, i + batchSize);
      
      await Promise.all(batch.map(async (competitor) => {
        try {
          const instagramHandle = competitor.socialHandles?.instagram;
          
          // Only fetch if we have an Instagram handle
          if (!instagramHandle) {
            console.log(`⚠️ No Instagram handle for ${competitor.name}, skipping...`);
            return;
          }
          
          console.log(`📸 Fetching real Instagram posts for ${competitor.name} (@${instagramHandle})...`);
          const result = await scrapeInstagramProfile(instagramHandle);
          
          // Apify returns { success: true, data: [profile] } where profile has latestPosts
          if (result && result.success && result.data && result.data.length > 0) {
            const profile = result.data[0];
            const latestPosts = profile.latestPosts || profile.posts || [];
            
            if (latestPosts.length > 0) {
              const posts = latestPosts.slice(0, 10).map(post => ({
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
              
              competitor.posts = posts;
              competitor.metrics.lastFetched = new Date();
              await competitor.save();
              console.log(`✅ Saved ${posts.length} REAL Instagram posts for ${competitor.name}`);
            } else {
              console.log(`⚠️ Profile found but no posts for ${competitor.name} (@${instagramHandle})`);
            }
          } else {
            console.log(`⚠️ Apify returned no data for ${competitor.name} (@${instagramHandle}) - error: ${result?.error || 'unknown'}`);
          }
        } catch (postError) {
          console.error(`❌ Failed to fetch Instagram posts for ${competitor.name}:`, postError.message);
          // NO AI FALLBACK - just log the error and continue
        }
      }));
      
      // Brief delay between batches
      if (i + batchSize < savedCompetitors.length) {
        console.log(`📸 Completed batch ${Math.floor(i / batchSize) + 1}, moving to next...`);
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

    // Create new user
    const user = await User.create({
      email: email.toLowerCase(),
      password,
      firstName,
      lastName: lastName || '',
      companyName: companyName || ''
    });

    // Generate token
    const token = generateToken(user._id);

    // Update last login
    user.lastLoginAt = new Date();
    await user.save({ validateBeforeSave: false });

    res.status(201).json({
      success: true,
      message: 'Account created successfully! Welcome to Gravity.',
      token,
      user: user.toPublicJSON()
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
      
      // TRIGGER COMPETITOR DISCOVERY after onboarding
      console.log('🚀 Triggering competitor discovery after onboarding...');
      triggerCompetitorDiscovery(req.user._id, contextData).catch(err => 
        console.error('Background competitor discovery error:', err.message)
      );
      
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
