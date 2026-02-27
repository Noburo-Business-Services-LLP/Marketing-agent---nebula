/**
 * Campaign Routes
 * Full CRUD for marketing campaigns with social media posting
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { deductCredits, ensureCreditCycle, requireCredits } = require('../middleware/creditGuard');
const Campaign = require('../models/Campaign');
const User = require('../models/User');
const { callGemini, parseGeminiJSON, generateICPAndStrategy } = require('../services/geminiAI');
// Import Ayrshare for social media posting
const { postToSocialMedia, getPostStatus } = require('../services/socialMediaAPI');

// Import image uploader for converting base64 to hosted URLs
const { ensurePublicUrl, isBase64DataUrl } = require('../services/imageUploader');

// Import logo overlay service for compositing logos onto posters
const { overlayLogoAndUpload, replaceLogoAtBboxAndUpload } = require('../services/logoOverlay');

// Import BrandAsset model for fetching user's logos
const BrandAsset = require('../models/BrandAsset');

// Import logo detection from Gemini
const { detectLogoInImage } = require('../services/geminiAI');

/**
 * GET /api/campaigns
 * Get all campaigns for the user with optional filters
 */
router.get('/', protect, async (req, res) => {
  try {
    const { status, platform, startDate, endDate, limit = 50 } = req.query;
    const userId = req.user.userId || req.user.id;
    
    // Build query
    const query = { userId };
    
    if (status && status !== 'all') {
      query.status = status;
    }
    
    if (platform) {
      query.platforms = { $in: [platform] };
    }
    
    if (startDate || endDate) {
      query['scheduling.startDate'] = {};
      if (startDate) query['scheduling.startDate'].$gte = new Date(startDate);
      if (endDate) query['scheduling.startDate'].$lte = new Date(endDate);
    }
    
    const campaigns = await Campaign.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));
    
    // For scheduled campaigns whose time has passed, verify with Ayrshare if actually posted
    const now = new Date();
    const scheduledPastDue = campaigns.filter(c => 
      c.status === 'scheduled' && 
      c.scheduledFor && 
      new Date(c.scheduledFor) < now &&
      c.socialPostId  // Must have an Ayrshare post ID to verify
    );
    
    if (scheduledPastDue.length > 0) {
      console.log(`🔍 Verifying ${scheduledPastDue.length} past-due scheduled campaigns with Ayrshare...`);
      
      // Get the user's Ayrshare profile key for API calls
      const user = await User.findById(userId);
      const profileKey = user?.ayrshare?.profileKey;
      
      for (const campaign of scheduledPastDue) {
        try {
          const statusResult = await getPostStatus(campaign.socialPostId, { profileKey });
          
          if (statusResult.success && statusResult.data) {
            const postData = statusResult.data;
            // Check if Ayrshare confirms the post was actually published
            // Ayrshare returns status 'success' for posted, 'scheduled' for pending, 'error' for failed
            const ayrshareStatus = postData.status || 
              (postData.posts && postData.posts[0]?.status) || 
              'unknown';
            
            console.log(`📊 Campaign ${campaign._id} Ayrshare status: ${ayrshareStatus}`);
            
            if (ayrshareStatus === 'success' || ayrshareStatus === 'posted') {
              // Ayrshare confirmed it was actually posted!
              await Campaign.findByIdAndUpdate(campaign._id, { 
                $set: { status: 'posted', publishedAt: now, ayrshareStatus: 'success' } 
              });
              campaign.status = 'posted';
              campaign.publishedAt = now;
              console.log(`✅ Confirmed posted: ${campaign.name}`);
            } else if (ayrshareStatus === 'error') {
              // Ayrshare says it failed
              await Campaign.findByIdAndUpdate(campaign._id, { 
                $set: { status: 'draft', ayrshareStatus: 'error' } 
              });
              campaign.status = 'draft';
              console.log(`❌ Ayrshare post failed: ${campaign.name}`);
            } else {
              // Still scheduled/pending on Ayrshare side - don't change status
              console.log(`⏳ Still pending on Ayrshare: ${campaign.name} (status: ${ayrshareStatus})`);
            }
          }
        } catch (verifyError) {
          console.warn(`⚠️ Could not verify campaign ${campaign._id}:`, verifyError.message);
          // Don't change status if we can't verify
        }
      }
    }
    
    // For scheduled campaigns past due WITHOUT a socialPostId, keep as scheduled
    // (they were never actually sent to Ayrshare)
    
    // Get counts by status
    const mongoose = require('mongoose');
    const statusCounts = await Campaign.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId) } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);
    
    const counts = {
      all: 0,
      draft: 0,
      scheduled: 0,
      active: 0,
      posted: 0,
      archived: 0
    };
    
    statusCounts.forEach(s => {
      counts[s._id] = s.count;
      counts.all += s.count;
    });
    
    res.json({
      success: true,
      campaigns,
      counts
    });
  } catch (error) {
    console.error('Get campaigns error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch campaigns', error: error.message });
  }
});

/**
 * GET /api/campaigns/icp-strategy
 * Returns stored ICP from DB. If none exists, generates via AI and saves.
 * Use ?regenerate=true to force fresh AI generation.
 */
router.get('/icp-strategy', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const bp = user.businessProfile || {};
    const forceRegenerate = req.query.regenerate === 'true';

    // If stored in DB and not forcing regenerate, return it
    if (!forceRegenerate && user.icpStrategy && user.icpStrategy.icp && user.icpStrategy.icp.summary) {
      console.log(`✅ Returning stored ICP for: ${bp.name || 'Unknown business'}`);
      return res.json({
        success: true,
        icp: user.icpStrategy.icp,
        channelStrategy: user.icpStrategy.channelStrategy || [],
        businessName: bp.name || 'Your Business'
      });
    }

    // Generate fresh via AI
    console.log(`🎯 Generating ICP & Strategy for: ${bp.name || 'Unknown business'}`);
    const result = await generateICPAndStrategy(bp);

    // Save to DB using $set to avoid validation issues with select:false fields
    const icpPayload = {
      icp: result.icp,
      channelStrategy: result.channelStrategy,
      generatedAt: new Date()
    };
    await User.findByIdAndUpdate(userId, { $set: { icpStrategy: icpPayload } });
    console.log(`💾 ICP saved to DB for user ${userId}`);

    res.json({
      success: true,
      icp: result.icp,
      channelStrategy: result.channelStrategy,
      businessName: bp.name || 'Your Business'
    });
  } catch (error) {
    console.error('ICP Strategy error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * PUT /api/campaigns/icp-strategy
 * Save user-edited ICP data to DB
 */
router.put('/icp-strategy', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { icp, channelStrategy } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const icpPayload = {
      icp: icp || user.icpStrategy?.icp,
      channelStrategy: channelStrategy || user.icpStrategy?.channelStrategy,
      generatedAt: new Date()
    };
    await User.findByIdAndUpdate(userId, { $set: { icpStrategy: icpPayload } });

    console.log(`💾 ICP edits saved for user ${userId}`);
    res.json({ success: true, message: 'ICP saved' });
  } catch (error) {
    console.error('ICP save error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/campaigns/:id
 * Get a single campaign by ID
 */
router.get('/:id', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const campaign = await Campaign.findOne({ _id: req.params.id, userId });
    
    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }
    
    res.json({ success: true, campaign });
  } catch (error) {
    console.error('Get campaign error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch campaign', error: error.message });
  }
});

/**
 * POST /api/campaigns
 * Create a new campaign
 */
router.post('/', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    
    const campaignData = {
      ...req.body,
      userId
    };
    
    const campaign = new Campaign(campaignData);
    await campaign.save();
    
    // Notifications are automatically scheduled by the background scheduler
    if (campaign.status === 'scheduled' && campaign.scheduling?.startDate) {
      console.log(`📅 Campaign scheduled: ${campaign.name} - notifications will be sent automatically`);
    }
    
    res.status(201).json({ success: true, campaign });
  } catch (error) {
    console.error('Create campaign error:', error);
    res.status(500).json({ success: false, message: 'Failed to create campaign', error: error.message });
  }
});

/**
 * PUT /api/campaigns/:id
 * Update an existing campaign
 */
router.put('/:id', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    
    const campaign = await Campaign.findOneAndUpdate(
      { _id: req.params.id, userId },
      { $set: req.body },
      { new: true, runValidators: true }
    );
    
    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }
    
    // Notifications are automatically scheduled by the background scheduler
    if (campaign.status === 'scheduled' && campaign.scheduling?.startDate) {
      console.log(`📅 Campaign updated: ${campaign.name} - notifications will be sent automatically`);
    }
    
    res.json({ success: true, campaign });
  } catch (error) {
    console.error('Update campaign error:', error);
    res.status(500).json({ success: false, message: 'Failed to update campaign', error: error.message });
  }
});

/**
 * DELETE /api/campaigns/:id
 * Delete a campaign
 */
router.delete('/:id', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    
    const campaign = await Campaign.findOneAndDelete({ _id: req.params.id, userId });
    
    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }
    
    res.json({ success: true, message: 'Campaign deleted' });
  } catch (error) {
    console.error('Delete campaign error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete campaign', error: error.message });
  }
});

/**
 * POST /api/campaigns/:id/publish
 * Actually publish a campaign to social media using Ayrshare
 * Accepts optional platforms array in request body to override campaign platforms
 */
router.post('/:id/publish', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const campaign = await Campaign.findOne({ _id: req.params.id, userId });
    
    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }
    
    // Get the user's Ayrshare profile key for posting to their connected accounts
    const user = await User.findById(userId);
    const profileKey = user?.ayrshare?.profileKey;
    
    if (!profileKey) {
      console.warn('User does not have an Ayrshare profile key - already handled above');
    } else {
      console.log('Found user Ayrshare profileKey:', profileKey.substring(0, 20) + '...');
    }
    
    // Get the platforms from request body (user selected) or fall back to campaign platforms
    const platforms = req.body.platforms || campaign.platforms || ['instagram'];
    
    // Check if this is a scheduled post
    const scheduledFor = req.body.scheduledFor;
    const isScheduled = !!scheduledFor;
    
    if (isScheduled) {
      console.log('📅 Scheduling post for:', scheduledFor);
      // Validate schedule date is in the future
      const schedDate = new Date(scheduledFor);
      const now = new Date();
      if (schedDate <= now) {
        console.warn('⚠️ Schedule date is in the past:', scheduledFor, 'Current:', now.toISOString());
        return res.status(400).json({ 
          success: false, 
          message: `Schedule date must be in the future. Received: ${scheduledFor}, Current time: ${now.toISOString()}`
        });
      }
    }
    
    if (!profileKey) {
      return res.status(400).json({
        success: false,
        message: 'No social accounts connected. Please go to Connect Socials and link your Instagram/Facebook account first.'
      });
    }
    
    // Build the post content
    let postContent = campaign.creative?.textContent || campaign.creative?.caption || campaign.content || campaign.name;
    const mediaUrls = campaign.creative?.imageUrls || [];
    let mediaUrl = mediaUrls[0] || campaign.creative?.mediaUrl || null;
    
    // Debug logging for template poster publish
    console.log('📋 Campaign publish debug:');
    console.log('   - Campaign name:', campaign.name);
    console.log('   - textContent length:', campaign.creative?.textContent?.length || 0);
    console.log('   - imageUrls count:', mediaUrls.length);
    console.log('   - First imageUrl type:', mediaUrl ? (mediaUrl.startsWith('data:') ? 'base64' : mediaUrl.startsWith('http') ? 'URL' : 'unknown') : 'null');
    console.log('   - First imageUrl preview:', mediaUrl ? mediaUrl.substring(0, 100) + '...' : 'null');
    
    // Extract and limit hashtags for Instagram (max 5 per Ayrshare/Instagram rules)
    // First, extract all hashtags from the post content
    const hashtagRegex = /#\w+/g;
    const existingHashtags = postContent.match(hashtagRegex) || [];
    
    // Remove hashtags from post content (we'll add limited ones back)
    let cleanContent = postContent.replace(hashtagRegex, '').trim();
    // Remove duplicate newlines
    cleanContent = cleanContent.replace(/\n{3,}/g, '\n\n');
    
    // Get additional hashtags from captions field
    const captionHashtags = (campaign.creative?.captions?.match(hashtagRegex) || []);
    
    // Combine all hashtags, remove duplicates, and limit to 5 for Instagram
    const allHashtags = [...new Set([...existingHashtags, ...captionHashtags])];
    const maxHashtags = platforms.includes('instagram') ? 5 : 30; // Instagram max is 5, others allow more
    const limitedHashtags = allHashtags.slice(0, maxHashtags);
    
    // Format the full post with limited hashtags
    const fullPost = limitedHashtags.length > 0 
      ? `${cleanContent}\n\n${limitedHashtags.join(' ')}`
      : cleanContent;
    
    console.log('Publishing to platforms:', platforms);
    console.log('Post content:', fullPost.substring(0, 100) + '...');
    console.log('Hashtags count:', limitedHashtags.length, '(limited from', allHashtags.length, ')');
    console.log('Media URL:', mediaUrl ? 'yes' : 'no');
    
    // If the image is a base64 data URL, upload to Cloudinary first
    if (mediaUrl && isBase64DataUrl(mediaUrl)) {
      console.log('📤 Uploading base64 image to Cloudinary...');
      const publicUrl = await ensurePublicUrl(mediaUrl);
      if (publicUrl) {
        console.log('✅ Image uploaded, public URL:', publicUrl);
        mediaUrl = publicUrl;
      } else {
        console.warn('⚠️ Failed to upload image, posting without media');
        mediaUrl = null;
      }
    }
    
    // Post to social media via Ayrshare with user's profile key
    const result = await postToSocialMedia(
      platforms,
      fullPost,
      {
        mediaUrls: mediaUrl ? [mediaUrl] : undefined,
        shortenLinks: true,
        profileKey: profileKey,  // Include user's Ayrshare profile key
        scheduleDate: scheduledFor  // Schedule for later if provided
      }
    );
    
    console.log('Ayrshare publish result:', result);
    console.log('Ayrshare result.data:', JSON.stringify(result.data, null, 2));
    
    // Check for Ayrshare errors more carefully
    // Success: result.data has `id`, `status: "success"`, or posts with `id` 
    // Error: result.data has `status: "error"` or posts with numeric `code` (error code)
    let hasAyrshareError = false;
    let errorMessage = '';
    
    // Check if top-level status is error
    if (result.data?.status === 'error') {
      hasAyrshareError = true;
      errorMessage = result.data?.message || 'Post failed';
    }
    
    // Check individual platform posts for errors (error posts have numeric `code`)
    if (result.data?.posts && Array.isArray(result.data.posts)) {
      for (const post of result.data.posts) {
        // Error posts have a numeric `code` field (like 151, 400, etc.) or errors array
        if (typeof post.code === 'number' || post.status === 'error' || post.errors?.length > 0) {
          hasAyrshareError = true;
          
          // Extract error message from various places
          let postErrorMessage = post.message;
          if (!postErrorMessage && post.errors?.length > 0) {
            // Error is nested in errors array
            const firstError = post.errors[0];
            postErrorMessage = firstError.message || `Error code ${firstError.code}`;
          }
          
          console.log('❌ Platform post error:', post.platform, post.code || post.errors?.[0]?.code, postErrorMessage);
          errorMessage = postErrorMessage || `${post.platform || 'Unknown'}: Error ${post.code || 'unknown'}`;
        } else if (post.id || post.postId) {
          // Successful post has id
          console.log('✅ Platform post success:', post.platform, post.id || post.postId);
        }
      }
    }
    
    // If we have an ID at the top level, it's likely successful
    const extractedPostId = result.data?.posts?.[0]?.id || result.data?.id || result.id || result.data?.postIds?.[0];
    const hasSuccessId = !!extractedPostId;
    
    if ((result.success || hasSuccessId) && !hasAyrshareError) {
      // Update campaign with post result
      const updateData = {
        status: isScheduled ? 'scheduled' : 'posted',
        'socialPostId': extractedPostId,
        'publishResult': result,
        'platforms': platforms  // Update platforms to match what user actually selected
      };
      
      if (isScheduled) {
        updateData.scheduledFor = new Date(scheduledFor);
      } else {
        updateData.publishedAt = new Date();
      }
      
      await Campaign.findByIdAndUpdate(campaign._id, { $set: updateData });
      
      res.json({
        success: true,
        message: isScheduled 
          ? `Campaign scheduled for ${new Date(scheduledFor).toLocaleString()}!` 
          : 'Campaign published to social media!',
        postId: extractedPostId,
        platforms,
        scheduled: isScheduled,
        scheduledFor: scheduledFor,
        result
      });
    } else {
      // Use the error message collected during post checking
      const finalErrorMessage = errorMessage || 'Failed to publish to social media';
      
      console.log('❌ Publish failed:', finalErrorMessage);
      
      res.status(400).json({
        success: false,
        message: finalErrorMessage,
        error: result.error || result.message || result.data?.message,
        details: result.data?.posts
      });
    }
  } catch (error) {
    console.error('Publish campaign error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to publish campaign', 
      error: error.message 
    });
  }
});

/**
 * POST /api/campaigns/generate-campaign-posts
 * Generate AI-powered posts for a campaign based on detailed inputs
 */
router.post('/generate-campaign-posts', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const bp = user?.businessProfile || {};
    
    // Credit check — estimate cost before generation
    await ensureCreditCycle(user);
    
    const {
      campaignName,
      campaignDescription,
      objective,
      targetAudience,
      content,
      scheduling,
      budget,
      kpis
    } = req.body;

    if (!campaignName) {
      return res.status(400).json({ success: false, message: 'Campaign name is required' });
    }

    const platforms = content?.platforms || ['instagram'];
    const productLogo = content?.productLogo || null; // Base64 or URL of product logo
    const duration = scheduling?.duration || '2weeks';
    const postsPerWeek = scheduling?.postsPerWeek || 3;
    const preferredDays = scheduling?.preferredDays || ['monday', 'wednesday', 'friday'];
    // Fix: empty array [] is truthy in JS, so explicitly check length
    const preferredTimes = (scheduling?.preferredTimes && scheduling.preferredTimes.length > 0) 
      ? scheduling.preferredTimes 
      : ['10:00', '14:00', '18:00'];
    const startDate = scheduling?.startDate || new Date().toISOString().split('T')[0];

    console.log('📅 Preferred times received:', scheduling?.preferredTimes, '→ using:', preferredTimes);

    // Calculate number of posts based on duration
    const durationWeeks = {
      '1week': 1,
      '2weeks': 2,
      '1month': 4,
      '3months': 12
    };
    const totalPosts = Math.min(postsPerWeek * (durationWeeks[duration] || 2), 20); // Cap at 20 posts

    // Credit pre-check: each post = 5 (image) + 2 (caption) = 7
    const estimatedCost = totalPosts * 7;
    if (user.credits.balance < estimatedCost) {
      return res.status(403).json({
        success: false,
        message: 'Insufficient credits',
        creditsRemaining: user.credits.balance,
        required: estimatedCost
      });
    }

    console.log(`🎯 Generating ${totalPosts} posts for campaign: ${campaignName}`);

    // Generate content calendar dates
    const generateScheduleDates = () => {
      const dates = [];
      const start = new Date(startDate);
      let postsCreated = 0;
      let currentDay = 0;
      
      while (postsCreated < totalPosts && currentDay < 100) {
        const checkDate = new Date(start);
        checkDate.setDate(start.getDate() + currentDay);
        const dayName = checkDate.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
        
        if (preferredDays.includes(dayName) || preferredDays.length === 0) {
          const time = preferredTimes[postsCreated % preferredTimes.length] || '10:00';
          dates.push({
            date: checkDate.toISOString().split('T')[0],
            time: time
          });
          postsCreated++;
        }
        currentDay++;
      }
      
      return dates;
    };

    const scheduleDates = generateScheduleDates();

    // Build comprehensive prompt for Gemini
    const prompt = `You are an expert social media marketing strategist. Create a series of ${totalPosts} engaging posts for a marketing campaign.

CAMPAIGN DETAILS:
- Campaign Name: "${campaignName}"
- Description: ${campaignDescription || 'Not provided'}
- Objective: ${objective || 'awareness'}
- Budget: ${budget ? '$' + budget : 'Not specified'}
- KPIs: ${kpis?.join(', ') || 'engagement, impressions'}

TARGET AUDIENCE:
- Age Range: ${targetAudience?.age || '18-35'}
- Gender: ${targetAudience?.gender || 'all'}
- Location: ${targetAudience?.location || 'Global'}
- Interests: ${targetAudience?.interests || 'Not specified'}
- Description: ${targetAudience?.description || 'General audience'}

CONTENT PREFERENCES:
- Platforms: ${platforms.join(', ')}
- Tone: ${content?.tone || 'professional'}
- Content Type: ${content?.type || 'image'}
- Key Messages: ${content?.keyMessages || 'Not specified'}
- Call to Action: ${content?.callToAction || 'Learn more'}

BRAND CONTEXT:
- Company Name: ${bp.companyName || bp.name || 'Brand'}
- Industry: ${bp.industry || 'General'}
- Brand Voice: ${bp.brandVoice || content?.tone || 'Professional'}
- Niche: ${bp.niche || 'Not specified'}

REQUIREMENTS:
1. Create exactly ${totalPosts} unique, engaging posts
2. Each post should be optimized for its target platform
3. Vary content themes throughout the campaign (educational, promotional, engagement, storytelling)
4. Include relevant emojis for visual appeal
5. Each post needs a specific, actionable call-to-action
6. Hashtags should be platform-appropriate (more for Instagram, fewer for LinkedIn/Twitter)
7. Content must be relevant to the campaign objective: ${objective}
8. Posts should build upon each other to tell a cohesive brand story

For each post, provide a detailed "imageDescription" that describes exactly what visual should accompany the post - be specific about:
- Subject matter (people, products, scenes)
- Color palette and mood
- Style (photography, illustration, minimalist, vibrant)
- Any text overlays or graphics

Return ONLY valid JSON (no markdown, no code blocks):
{
  "posts": [
    {
      "platform": "platform_name",
      "caption": "The full post caption with emojis and formatting",
      "hashtags": ["#hashtag1", "#hashtag2", "#hashtag3"],
      "contentTheme": "educational|promotional|engagement|storytelling|behindthescenes",
      "imageDescription": "Detailed description for AI image generation",
      "callToAction": "Specific CTA for this post"
    }
  ]
}`;

    const response = await callGemini(prompt, { maxTokens: 4000, temperature: 0.8, skipCache: true });
    const parsed = parseGeminiJSON(response);

    if (!parsed || !parsed.posts || !Array.isArray(parsed.posts)) {
      throw new Error('Invalid response format from AI');
    }

    // Import image generation function and logo overlay
    const { getRelevantImage } = require('../services/geminiAI');
    const { uploadLogo, uploadImageWithLogoOverlay, isBase64DataUrl } = require('../services/imageUploader');

    // Build rich brand context for image generation
    const brandContext = {
      companyName: bp.companyName || bp.name || 'Brand',
      industry: bp.industry || 'business',
      description: bp.description || campaignDescription || '',
      products: bp.products?.map(p => p.name).join(', ') || '',
      services: bp.services?.map(s => s.name).join(', ') || '',
      usps: bp.uniqueSellingPoints?.join(', ') || bp.valuePropositions?.join(', ') || '',
      niche: bp.niche || '',
      targetAudience: targetAudience?.description || '',
      brandVoice: bp.brandVoice || content?.tone || 'professional',
      productLogo: productLogo, // Pass the product logo for image generation
      hasLogo: !!productLogo // Flag to indicate logo is available
    };

    // Upload logo to Cloudinary if provided (for overlay)
    let logoPublicId = null;
    if (productLogo) {
      console.log('📤 Uploading product logo for overlay...');
      try {
        const logoResult = await uploadLogo(productLogo, true);
        if (logoResult.success) {
          logoPublicId = logoResult.publicId;
          console.log('✅ Logo uploaded, public ID:', logoPublicId);
        } else {
          console.error('❌ Logo upload failed:', logoResult.error);
        }
      } catch (logoErr) {
        console.error('❌ Logo upload error:', logoErr.message);
      }
    }

    // Helper function for delay (rate limiting for Imagen API - 5 RPM limit)
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // Generate images for each post SEQUENTIALLY with delay to avoid rate limiting
    // Imagen 4 Ultra has 5 RPM limit, so we wait 15 seconds between requests
    console.log(`🎨 Generating ${Math.min(parsed.posts.length, totalPosts)} images (with rate limiting)...`);
    
    const postsWithImages = [];
    const postsToProcess = parsed.posts.slice(0, totalPosts);
    
    for (let index = 0; index < postsToProcess.length; index++) {
      const post = postsToProcess[index];
      const schedule = scheduleDates[index] || { date: startDate, time: '10:00' };
      
      // Generate image based on the description + brand context
      let imageUrl;
      try {
        // Enhanced image description with brand context
        const enhancedImageDesc = `${post.imageDescription || post.caption.substring(0, 100)}. Brand: ${brandContext.companyName}, Industry: ${brandContext.industry}. ${brandContext.products ? 'Products: ' + brandContext.products + '.' : ''} ${brandContext.usps ? 'Focus on: ' + brandContext.usps : ''}`;
        
        console.log(`🎨 Generating image ${index + 1}/${postsToProcess.length}...`);
        
        imageUrl = await getRelevantImage(
          enhancedImageDesc,
          brandContext.industry,
          objective,
          campaignName,
          post.platform,
          brandContext
        );
        
        // If logo is available, overlay it on the generated image
        if (logoPublicId && imageUrl) {
          console.log(`🏷️ Overlaying logo on image ${index + 1}...`);
          try {
            const overlayResult = await uploadImageWithLogoOverlay(imageUrl, logoPublicId, {
              position: 'south_east',
              width: 180,
              opacity: 95,
              margin: 25
            });
            
            if (overlayResult.success) {
              imageUrl = overlayResult.url;
              console.log(`✅ Logo overlay applied to image ${index + 1}`);
            } else {
              console.error(`❌ Logo overlay failed for image ${index + 1}:`, overlayResult.error);
            }
          } catch (overlayErr) {
            console.error(`❌ Logo overlay error for image ${index + 1}:`, overlayErr.message);
          }
        }
        
        console.log(`✅ Image ${index + 1}/${postsToProcess.length} generated`);
      } catch (imgError) {
        console.error(`Error generating image for post ${index}:`, imgError);
        // Fallback image
        imageUrl = `https://images.unsplash.com/photo-1557804506-669a67965ba0?w=800&h=600&fit=crop&seed=${Date.now() + index}`;
      }

      postsWithImages.push({
        id: `post-${index + 1}`,
        platform: post.platform?.toLowerCase() || platforms[index % platforms.length],
        caption: post.caption,
        hashtags: Array.isArray(post.hashtags) 
          ? post.hashtags.map(h => h.startsWith('#') ? h : `#${h}`)
          : ['#marketing', '#brand'],
        imageUrl,
        suggestedDate: schedule.date,
        suggestedTime: schedule.time,
        contentTheme: post.contentTheme || 'promotional',
        callToAction: post.callToAction || content?.callToAction || 'Learn more'
      });
      
      // Wait 15 seconds before next image request to stay under 5 RPM limit
      // (except for the last image)
      if (index < postsToProcess.length - 1) {
        console.log(`⏳ Waiting 15s before next image (rate limiting)...`);
        await delay(15000);
      }
    }

    console.log(`✅ Generated ${postsWithImages.length} posts with images for campaign: ${campaignName}`);

    // Deduct credits for generated posts
    const actualCost = postsWithImages.length * 7;
    const creditResult = await deductCredits(userId, actualCost, `campaign_posts_${postsWithImages.length}`);

    res.json({
      success: true,
      posts: postsWithImages,
      contentCalendar: scheduleDates,
      creditsRemaining: creditResult.balance,
      campaignSummary: {
        name: campaignName,
        objective,
        platforms,
        totalPosts: postsWithImages.length,
        startDate,
        endDate: scheduleDates[scheduleDates.length - 1]?.date || startDate
      }
    });

  } catch (error) {
    console.error('Generate campaign posts error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate posts', error: error.message });
  }
});

/**
 * POST /api/campaigns/regenerate-post-image
 * Regenerate a single post image with optional custom prompt
 */
router.post('/regenerate-post-image', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    
    // Credit check (5 for image generation)
    const creditUser = await User.findById(userId);
    if (!creditUser) return res.status(404).json({ success: false, message: 'User not found' });
    await ensureCreditCycle(creditUser);
    if (creditUser.credits.balance < 5) {
      return res.status(403).json({ success: false, message: 'Insufficient credits', creditsRemaining: creditUser.credits.balance, required: 5 });
    }
    
    const { 
      postId,
      platform,
      caption,
      customPrompt,
      referenceImageUrl,
      productLogo, // logo for overlay
      brandContext
    } = req.body;

    console.log(`🎨 Regenerating image for post ${postId || 'new'}...`);

    const { getRelevantImage } = require('../services/geminiAI');
    const { uploadLogo, uploadImageWithLogoOverlay } = require('../services/imageUploader');

    // Build image description
    let imageDescription = customPrompt || caption?.substring(0, 200) || 'Professional marketing image';
    
    if (brandContext) {
      imageDescription += `. Brand: ${brandContext.companyName || 'Brand'}, Industry: ${brandContext.industry || 'business'}.`;
    }

    console.log('🖼️ Image prompt:', imageDescription.substring(0, 100) + '...');

    // Generate the image
    let imageUrl = await getRelevantImage(
      imageDescription,
      brandContext?.industry || 'business',
      'awareness',
      'Campaign',
      platform || 'instagram',
      brandContext
    );

    // If logo is provided, overlay it
    if (productLogo && imageUrl) {
      console.log('🏷️ Overlaying logo on regenerated image...');
      const logoResult = await uploadLogo(productLogo, true); // true = remove background
      if (logoResult.success) {
        const overlayResult = await uploadImageWithLogoOverlay(imageUrl, logoResult.publicId, {
          position: 'south_east',
          width: 180,
          opacity: 95,
          margin: 25
        });
        if (overlayResult.success) {
          imageUrl = overlayResult.url;
          console.log('✅ Logo overlay applied');
        }
      }
    }

    console.log('✅ Image regenerated successfully');

    // Deduct credits
    const creditResult = await deductCredits(userId, 5, 'regenerate_image');

    res.json({
      success: true,
      imageUrl,
      postId,
      creditsRemaining: creditResult.balance
    });

  } catch (error) {
    console.error('Regenerate post image error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to regenerate image', 
      error: error.message 
    });
  }
});

// ============================================
// TEMPLATE POSTER GENERATION (Canvas + AI Fallback)
// ============================================

const { generateTemplatePoster, editTemplatePoster, generatePosterFromReference } = require('../services/geminiAI');
const { generatePosterFromTemplate, editPosterFromTemplate } = require('../services/canvasPosterService');

/**
 * POST /api/campaigns/generate-caption
 * Generate a caption from an uploaded image using AI vision
 */
router.post('/generate-caption', protect, async (req, res) => {
  try {
    const { image, platform } = req.body;
    const userId = req.user.userId || req.user.id;
    
    if (!image) {
      return res.status(400).json({ 
        success: false, 
        message: 'Image is required' 
      });
    }
    
    // Credit check (2 for caption text)
    const creditUser = await User.findById(userId);
    if (!creditUser) return res.status(404).json({ success: false, message: 'User not found' });
    await ensureCreditCycle(creditUser);
    if (creditUser.credits.balance < 2) {
      return res.status(403).json({ success: false, message: 'Insufficient credits', creditsRemaining: creditUser.credits.balance, required: 2 });
    }
    
    console.log('🤖 Generating caption from image for platform:', platform || 'instagram');
    
    // Get user's brand profile for context
    const BrandProfile = require('../models/BrandProfile');
    
    const user = await User.findById(userId);
    let brandContext = '';
    
    if (user?.brandProfileId) {
      const brandProfile = await BrandProfile.findById(user.brandProfileId);
      if (brandProfile) {
        brandContext = `
Business: ${brandProfile.name || 'Unknown'}
Industry: ${brandProfile.industry || 'General'}
Target Audience: ${brandProfile.targetAudience || 'General consumers'}
Brand Voice: ${brandProfile.brandVoice || 'Professional'}`;
      }
    }
    
    // Use Gemini to analyze image and generate caption
    const { callGemini } = require('../services/geminiAI');
    
    // Extract base64 data
    let imageData = image;
    let mimeType = 'image/png';
    if (image.startsWith('data:')) {
      const matches = image.match(/^data:([^;]+);base64,(.+)$/);
      if (matches) {
        mimeType = matches[1];
        imageData = matches[2];
      }
    }
    
    const prompt = `You are a social media marketing expert. Analyze this image and create an engaging ${platform || 'Instagram'} caption for it.
${brandContext}

Requirements:
1. Write a catchy, engaging caption that matches the image content
2. Include relevant emojis
3. Add a clear call-to-action
4. Include 5-8 relevant hashtags at the end
5. Keep it concise but impactful (2-4 sentences + hashtags)
6. Match the tone appropriate for ${platform || 'Instagram'}

Return ONLY the caption text with hashtags. No JSON, no explanations.`;

    // Call Gemini with vision
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    const apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
    
    const requestBody = {
      contents: [{
        parts: [
          {
            inlineData: {
              mimeType: mimeType,
              data: imageData
            }
          },
          { text: prompt }
        ]
      }],
      generationConfig: {
        temperature: 0.8,
        maxOutputTokens: 500
      }
    };
    
    const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
    const response = await fetch(`${apiUrl}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      console.error('Gemini caption error:', data);
      return res.status(500).json({
        success: false,
        message: data.error?.message || 'Failed to generate caption'
      });
    }
    
    // Extract caption from response
    const caption = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    if (!caption) {
      return res.status(500).json({
        success: false,
        message: 'No caption generated'
      });
    }
    
    // Extract hashtags from caption
    const hashtagRegex = /#\w+/g;
    const hashtags = caption.match(hashtagRegex) || [];
    
    console.log('✅ Caption generated successfully');
    
    // Deduct credits
    const creditResult = await deductCredits(userId, 2, 'generate_caption');
    
    res.json({
      success: true,
      caption: caption.trim(),
      hashtags: hashtags,
      creditsRemaining: creditResult.balance
    });
    
  } catch (error) {
    console.error('Generate caption error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to generate caption', 
      error: error.message 
    });
  }
});

/**
 * POST /api/campaigns/process-aspect-ratio
 * Process image to fit aspect ratio with padding (no cropping)
 */
router.post('/process-aspect-ratio', protect, async (req, res) => {
  try {
    const { image, aspectRatio } = req.body;
    
    if (!image) {
      return res.status(400).json({ success: false, message: 'Image is required' });
    }
    
    console.log('📐 Processing image for aspect ratio:', aspectRatio);
    
    // Parse aspect ratio
    const ratioMap = {
      '1:1': 1,
      '4:5': 4/5,
      '16:9': 16/9,
      '9:16': 9/16,
      'original': null
    };
    
    const targetRatio = ratioMap[aspectRatio];
    
    if (targetRatio === null || aspectRatio === 'original') {
      // Return original image
      return res.json({
        success: true,
        imageBase64: image,
        message: 'Original aspect ratio kept'
      });
    }
    
    // Extract base64 data
    let imageData = image;
    let mimeType = 'image/png';
    if (image.startsWith('data:')) {
      const matches = image.match(/^data:([^;]+);base64,(.+)$/);
      if (matches) {
        mimeType = matches[1];
        imageData = matches[2];
      }
    }
    
    // Use sharp for image processing
    const sharp = require('sharp');
    const buffer = Buffer.from(imageData, 'base64');
    
    // Get image dimensions
    const metadata = await sharp(buffer).metadata();
    const originalWidth = metadata.width;
    const originalHeight = metadata.height;
    const originalRatio = originalWidth / originalHeight;
    
    console.log(`Original: ${originalWidth}x${originalHeight} (${originalRatio.toFixed(2)})`);
    console.log(`Target ratio: ${targetRatio.toFixed(2)}`);
    
    let newWidth, newHeight;
    
    if (originalRatio > targetRatio) {
      // Image is wider than target - add padding top/bottom
      newWidth = originalWidth;
      newHeight = Math.round(originalWidth / targetRatio);
    } else {
      // Image is taller than target - add padding left/right  
      newHeight = originalHeight;
      newWidth = Math.round(originalHeight * targetRatio);
    }
    
    console.log(`New dimensions: ${newWidth}x${newHeight}`);
    
    // Get dominant edge color for padding
    const edgePixels = await sharp(buffer)
      .resize(1, 1)
      .raw()
      .toBuffer();
    
    const bgColor = {
      r: edgePixels[0] || 0,
      g: edgePixels[1] || 0,
      b: edgePixels[2] || 0
    };
    
    // Create canvas with new dimensions and place image centered
    const processedBuffer = await sharp({
      create: {
        width: newWidth,
        height: newHeight,
        channels: 3,
        background: bgColor
      }
    })
    .composite([{
      input: buffer,
      gravity: 'center'
    }])
    .png()
    .toBuffer();
    
    const processedBase64 = `data:image/png;base64,${processedBuffer.toString('base64')}`;
    
    // Upload to Cloudinary
    const { ensurePublicUrl } = require('../services/imageUploader');
    let imageUrl = null;
    try {
      imageUrl = await ensurePublicUrl(processedBase64);
      console.log('✅ Processed image uploaded:', imageUrl);
    } catch (uploadError) {
      console.warn('⚠️ Could not upload processed image');
    }
    
    res.json({
      success: true,
      imageBase64: processedBase64,
      imageUrl: imageUrl,
      originalDimensions: { width: originalWidth, height: originalHeight },
      newDimensions: { width: newWidth, height: newHeight },
      message: `Image processed to ${aspectRatio} aspect ratio`
    });
    
  } catch (error) {
    console.error('Process aspect ratio error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to process image', 
      error: error.message 
    });
  }
});

/**
 * POST /api/campaigns/template-poster
 * Generate a poster from a template image and content
 * Uses Canvas for reliable text overlay, AI as fallback
 * Supports logo overlay from Brand Assets
 */
router.post('/template-poster', protect, async (req, res) => {
  try {
    const { templateImage, content, platform, style, useAI, logoOverlay } = req.body;
    const userId = req.user.userId || req.user.id;
    
    if (!templateImage) {
      return res.status(400).json({ 
        success: false, 
        message: 'Template image is required' 
      });
    }
    
    if (!content || content.trim().length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Poster content is required' 
      });
    }
    
    // Credit check (5 for image generation)
    const creditUser = await User.findById(userId);
    if (!creditUser) return res.status(404).json({ success: false, message: 'User not found' });
    await ensureCreditCycle(creditUser);
    if (creditUser.credits.balance < 5) {
      return res.status(403).json({ success: false, message: 'Insufficient credits', creditsRemaining: creditUser.credits.balance, required: 5 });
    }
    
    console.log('🎨 Generating template poster...');
    console.log('📝 Content length:', content.length, 'characters');
    console.log('📱 Platform:', platform || 'general');
    
    // Always use AI (Gemini) for poster generation - it produces better results
    const result = await generateTemplatePoster(templateImage, content, {
      platform: platform || 'instagram',
      style: style
    });
    
    if (result.success) {
      console.log('✅ Template poster generated successfully with', result.model || result.method);
      
      let finalImageBase64 = result.imageBase64;
      let hostedUrl = null;
      let logoReplaced = false;
      
      // Auto-detect and replace logo if user has a logo and enabled the feature
      if (logoOverlay?.enabled && logoOverlay?.logoUrl) {
        try {
          console.log('🔍 Detecting logo in generated poster...');
          
          // Use AI to detect where the logo/emblem is in the generated image
          const detection = await detectLogoInImage(finalImageBase64);
          
          if (detection.success && detection.detected && detection.bbox) {
            console.log(`✅ Logo detected at (${detection.bbox.x}%, ${detection.bbox.y}%) with ${(detection.confidence * 100).toFixed(0)}% confidence`);
            
            // Replace the detected logo with user's brand logo
            const replaceResult = await replaceLogoAtBboxAndUpload(
              finalImageBase64,
              logoOverlay.logoUrl,
              detection.bbox
            );
            
            if (replaceResult.success) {
              hostedUrl = replaceResult.url;
              finalImageBase64 = replaceResult.imageBase64 || finalImageBase64;
              logoReplaced = true;
              console.log('✅ Logo replaced and uploaded:', hostedUrl);
            } else {
              console.warn('⚠️ Logo replacement failed, using original image');
            }
          } else {
            console.log('ℹ️ No logo detected in poster, applying overlay at default position');
            // Fallback: overlay at bottom-right if no logo detected
            const overlayResult = await overlayLogoAndUpload(
              finalImageBase64,
              logoOverlay.logoUrl,
              {
                position: 'bottom-right',
                size: 'medium',
                opacity: 0.9,
                padding: 20
              }
            );
            
            if (overlayResult.success) {
              hostedUrl = overlayResult.url;
              logoReplaced = true;
              console.log('✅ Logo overlay applied at default position:', hostedUrl);
            }
          }
        } catch (logoError) {
          console.warn('⚠️ Logo processing error:', logoError.message);
        }
      }
      
      // If no logo processing or it failed, upload the base image
      if (!hostedUrl) {
        try {
          const uploadResult = await ensurePublicUrl(finalImageBase64);
          if (uploadResult) {
            hostedUrl = uploadResult;
            console.log('✅ Poster uploaded to Cloudinary:', hostedUrl);
          }
        } catch (uploadError) {
          console.warn('⚠️ Could not upload to Cloudinary, returning base64');
        }
      }
      
      // Deduct credits
      const creditResult = await deductCredits(userId, 5, 'template_poster');
      
      res.json({
        success: true,
        imageBase64: finalImageBase64,
        imageUrl: hostedUrl,
        model: result.model || result.method,
        logoApplied: logoReplaced,
        creditsRemaining: creditResult.balance,
        message: 'Poster generated successfully'
      });
    } else {
      res.status(500).json({
        success: false,
        message: result.error || 'Failed to generate poster'
      });
    }
  } catch (error) {
    console.error('Template poster generation error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to generate poster', 
      error: error.message 
    });
  }
});

/**
 * POST /api/campaigns/template-poster/edit
 * Edit/refine a generated poster based on user feedback
 * Supports iterative refinement through conversational prompts
 */
router.post('/template-poster/edit', protect, async (req, res) => {
  try {
    const { currentImage, originalContent, editInstructions, templateImage } = req.body;
    const userId = req.user.userId || req.user.id;
    
    if (!currentImage) {
      return res.status(400).json({ 
        success: false, 
        message: 'Current poster image is required' 
      });
    }
    
    if (!editInstructions || editInstructions.trim().length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Edit instructions are required' 
      });
    }
    
    // Credit check (3 for image edit)
    const creditUser = await User.findById(userId);
    if (!creditUser) return res.status(404).json({ success: false, message: 'User not found' });
    await ensureCreditCycle(creditUser);
    if (creditUser.credits.balance < 3) {
      return res.status(403).json({ success: false, message: 'Insufficient credits', creditsRemaining: creditUser.credits.balance, required: 3 });
    }
    
    console.log('✏️ Editing template poster...');
    console.log('📝 Edit instructions:', editInstructions.substring(0, 100));
    
    // Always use AI (Gemini) for editing - it produces better results
    const result = await editTemplatePoster(
      currentImage, 
      originalContent || '', 
      editInstructions,
      templateImage
    );
    
    if (result.success) {
      console.log('✅ Poster edited successfully');
      
      // Upload to Cloudinary
      let hostedUrl = null;
      try {
        const uploadResult = await ensurePublicUrl(result.imageBase64);
        if (uploadResult) {
          hostedUrl = uploadResult;
        }
      } catch (uploadError) {
        console.warn('⚠️ Could not upload edited image to Cloudinary');
      }
      
      // Deduct credits
      const creditResult = await deductCredits(userId, 3, 'poster_edit');
      
      res.json({
        success: true,
        imageBase64: result.imageBase64,
        imageUrl: hostedUrl,
        model: result.model || result.method,
        creditsRemaining: creditResult.balance,
        message: 'Poster updated successfully'
      });
    } else {
      res.status(500).json({
        success: false,
        message: result.error || 'Failed to edit poster'
      });
    }
  } catch (error) {
    console.error('Template poster edit error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to edit poster', 
      error: error.message 
    });
  }
});

/**
 * POST /api/campaigns/template-poster/from-reference
 * Generate a NEW poster using a REFERENCE image for style inspiration
 * The AI creates a poster that LOOKS LIKE the reference but uses user's content
 */
router.post('/template-poster/from-reference', protect, async (req, res) => {
  try {
    const { referenceImage, content, platform } = req.body;
    const userId = req.user.userId || req.user.id;
    
    if (!referenceImage) {
      return res.status(400).json({ 
        success: false, 
        message: 'Reference image is required' 
      });
    }
    
    if (!content || content.trim().length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Content is required for the new poster' 
      });
    }
    
    // Credit check (5 for image generation)
    const creditUser = await User.findById(userId);
    if (!creditUser) return res.status(404).json({ success: false, message: 'User not found' });
    await ensureCreditCycle(creditUser);
    if (creditUser.credits.balance < 5) {
      return res.status(403).json({ success: false, message: 'Insufficient credits', creditsRemaining: creditUser.credits.balance, required: 5 });
    }
    
    console.log('🎨 Generating poster from reference image with AI...');
    console.log('📝 Content:', content.substring(0, 100) + (content.length > 100 ? '...' : ''));
    
    const result = await generatePosterFromReference(referenceImage, content, {
      platform: platform || 'instagram'
    });
    
    if (result.success) {
      // Upload to Cloudinary for public URL
      let hostedUrl = null;
      try {
        const uploadResult = await ensurePublicUrl(result.imageBase64);
        if (uploadResult) {
          hostedUrl = uploadResult;
          console.log('✅ Poster uploaded to Cloudinary:', hostedUrl);
        }
      } catch (uploadError) {
        console.warn('Could not upload to Cloudinary:', uploadError.message);
      }
      
      // Deduct credits
      const creditResult = await deductCredits(userId, 5, 'poster_from_reference');
      
      return res.json({
        success: true,
        imageBase64: result.imageBase64,
        imageUrl: hostedUrl,
        model: result.model,
        creditsRemaining: creditResult.balance
      });
    } else {
      return res.status(500).json({
        success: false,
        message: 'Failed to generate poster from reference',
        error: result.error
      });
    }
  } catch (error) {
    console.error('Error generating poster from reference:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to generate poster from reference', 
      error: error.message 
    });
  }
});

/**
 * POST /api/campaigns/template-poster/batch
 * Generate multiple posters from multiple templates in batch
 */
router.post('/template-poster/batch', protect, async (req, res) => {
  try {
    const { posters, platform, useAI } = req.body;
    const userId = req.user.userId || req.user.id;
    
    if (!posters || !Array.isArray(posters) || posters.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Posters array is required' 
      });
    }
    
    if (posters.length > 10) {
      return res.status(400).json({ 
        success: false, 
        message: 'Maximum 10 posters per batch' 
      });
    }
    
    // Credit pre-check: 5 per poster
    const batchCost = posters.length * 5;
    await requireCredits(userId, batchCost);
    
    console.log(`🎨 Generating ${posters.length} template posters in batch...`);
    
    const results = [];
    
    for (let i = 0; i < posters.length; i++) {
      const { templateImage, content, style } = posters[i];
      
      if (!templateImage || !content) {
        results.push({
          index: i,
          success: false,
          error: 'Missing template or content'
        });
        continue;
      }
      
      console.log(`🎨 Generating poster ${i + 1}/${posters.length}...`);
      
      // Always use AI (Gemini) for poster generation
      const result = await generateTemplatePoster(templateImage, content, {
        platform: platform || 'instagram',
        style: style
      });
      
      if (result.success) {
        // Upload to Cloudinary
        let hostedUrl = null;
        try {
          const uploadResult = await ensurePublicUrl(result.imageBase64);
          if (uploadResult) hostedUrl = uploadResult;
        } catch (e) {
          console.warn('Could not upload batch image', i);
        }
        
        results.push({
          index: i,
          success: true,
          imageBase64: result.imageBase64,
          imageUrl: hostedUrl,
          model: result.model || result.method
        });
        console.log(`✅ Poster ${i + 1} generated`);
      } else {
        results.push({
          index: i,
          success: false,
          error: result.error
        });
      }
      
      // Rate limiting: wait 2 seconds between generations
      if (i < posters.length - 1) {
        await delay(2000);
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    console.log(`✅ Batch complete: ${successCount}/${posters.length} posters generated`);
    
    // Deduct credits for successful posters only
    let creditsRemaining = 0;
    if (successCount > 0) {
      const actualCost = successCount * 5;
      const creditResult = await deductCredits(userId, actualCost, `batch_poster_${successCount}`);
      creditsRemaining = creditResult.balance;
    }
    
    res.json({
      success: true,
      results,
      creditsRemaining,
      summary: {
        total: posters.length,
        successful: successCount,
        failed: posters.length - successCount
      }
    });
  } catch (error) {
    // Handle insufficient credits error from requireCredits
    if (error.message === 'Insufficient credits') {
      return res.status(403).json({
        success: false,
        message: 'Insufficient credits for batch',
        creditsRemaining: error.creditsRemaining,
        required: error.required
      });
    }
    console.error('Batch poster generation error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Batch generation failed', 
      error: error.message 
    });
  }
});

module.exports = router;
