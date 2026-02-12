/**
 * Campaign Routes
 * Full CRUD for marketing campaigns with social media posting
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const Campaign = require('../models/Campaign');
const User = require('../models/User');
const { callGemini, parseGeminiJSON } = require('../services/geminiAI');
const notificationScheduler = require('../services/notificationScheduler');

// Import Ayrshare for social media posting
const { postToSocialMedia, getAyrshareAnalytics, getPostStatus } = require('../services/socialMediaAPI');

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
 * POST /api/campaigns/:id/post
 * Post/publish a campaign (legacy - marks as posted)
 */
router.post('/:id/post', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    
    const campaign = await Campaign.findOneAndUpdate(
      { _id: req.params.id, userId },
      { 
        $set: { 
          status: 'posted',
          'scheduling.startDate': new Date()
        } 
      },
      { new: true }
    );
    
    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }
    
    res.json({ success: true, campaign, message: 'Campaign posted successfully' });
  } catch (error) {
    console.error('Post campaign error:', error);
    res.status(500).json({ success: false, message: 'Failed to post campaign', error: error.message });
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
 * GET /api/campaigns/:id/verify-status
 * Check Ayrshare to see if a scheduled post was actually published
 */
router.get('/:id/verify-status', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const campaign = await Campaign.findOne({ _id: req.params.id, userId });
    
    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }
    
    if (!campaign.socialPostId) {
      return res.json({ 
        success: true, 
        status: campaign.status,
        message: 'No Ayrshare post ID — this campaign was never sent to Ayrshare' 
      });
    }
    
    const user = await User.findById(userId);
    const profileKey = user?.ayrshare?.profileKey;
    
    const statusResult = await getPostStatus(campaign.socialPostId, { profileKey });
    
    if (statusResult.success && statusResult.data) {
      const postData = statusResult.data;
      const ayrshareStatus = postData.status || 
        (postData.posts && postData.posts[0]?.status) || 
        'unknown';
      
      let newStatus = campaign.status;
      
      if (ayrshareStatus === 'success' || ayrshareStatus === 'posted') {
        newStatus = 'posted';
        await Campaign.findByIdAndUpdate(campaign._id, { 
          $set: { status: 'posted', publishedAt: new Date(), ayrshareStatus: 'success' } 
        });
      } else if (ayrshareStatus === 'error') {
        newStatus = 'draft';
        await Campaign.findByIdAndUpdate(campaign._id, { 
          $set: { status: 'draft', ayrshareStatus: 'error' } 
        });
      }
      
      return res.json({
        success: true,
        status: newStatus,
        ayrshareStatus,
        ayrshareData: postData,
        message: `Ayrshare reports: ${ayrshareStatus}`
      });
    }
    
    res.json({
      success: true,
      status: campaign.status,
      message: 'Could not get status from Ayrshare',
      ayrshareResponse: statusResult
    });
  } catch (error) {
    console.error('Verify status error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/campaigns/:id/analytics
 * Get real analytics for a published campaign from Ayrshare
 */
router.get('/:id/analytics', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const campaign = await Campaign.findOne({ _id: req.params.id, userId });
    
    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }
    
    if (!campaign.socialPostId) {
      return res.json({
        success: true,
        message: 'Campaign not yet published to social media',
        analytics: null
      });
    }
    
    // Get analytics from Ayrshare
    const platform = campaign.platforms?.[0] || 'instagram';
    const analytics = await getAyrshareAnalytics(platform);
    
    res.json({
      success: true,
      campaignId: campaign._id,
      postId: campaign.socialPostId,
      platform,
      analytics,
      publishedAt: campaign.publishedAt
    });
  } catch (error) {
    console.error('Campaign analytics error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch analytics', 
      error: error.message 
    });
  }
});

/**
 * POST /api/campaigns/:id/archive
 * Archive a campaign
 */
router.post('/:id/archive', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    
    const campaign = await Campaign.findOneAndUpdate(
      { _id: req.params.id, userId },
      { $set: { status: 'archived' } },
      { new: true }
    );
    
    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }
    
    res.json({ success: true, campaign, message: 'Campaign archived' });
  } catch (error) {
    console.error('Archive campaign error:', error);
    res.status(500).json({ success: false, message: 'Failed to archive campaign', error: error.message });
  }
});

/**
 * POST /api/campaigns/:id/schedule
 * Schedule a campaign
 */
router.post('/:id/schedule', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { startDate, postTime } = req.body;
    
    const campaign = await Campaign.findOneAndUpdate(
      { _id: req.params.id, userId },
      { 
        $set: { 
          status: 'scheduled',
          'scheduling.startDate': new Date(startDate),
          'scheduling.postTime': postTime
        } 
      },
      { new: true }
    );
    
    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }
    
    res.json({ success: true, campaign, message: 'Campaign scheduled' });
  } catch (error) {
    console.error('Schedule campaign error:', error);
    res.status(500).json({ success: false, message: 'Failed to schedule campaign', error: error.message });
  }
});

/**
 * GET /api/campaigns/analytics/overview
 * Get campaign analytics overview
 */
router.get('/analytics/overview', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { startDate, endDate } = req.query;
    
    const query = { userId };
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }
    
    const campaigns = await Campaign.find(query);
    
    // Aggregate performance metrics
    const totals = campaigns.reduce((acc, c) => {
      acc.impressions += c.performance?.impressions || 0;
      acc.clicks += c.performance?.clicks || 0;
      acc.engagement += c.performance?.engagement || 0;
      acc.reach += c.performance?.reach || 0;
      acc.spend += c.performance?.spend || 0;
      acc.conversions += c.performance?.conversions || 0;
      return acc;
    }, { impressions: 0, clicks: 0, engagement: 0, reach: 0, spend: 0, conversions: 0 });
    
    // Calculate averages
    const count = campaigns.length || 1;
    const avgCtr = totals.clicks / (totals.impressions || 1) * 100;
    const avgEngagementRate = totals.engagement / (totals.reach || 1) * 100;
    
    // Generate daily data for charts
    const dailyData = [];
    const days = 7;
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      dailyData.push({
        date: date.toISOString().split('T')[0],
        impressions: Math.floor(Math.random() * 1000) + (totals.impressions / days),
        clicks: Math.floor(Math.random() * 50) + (totals.clicks / days),
        spend: Math.floor(Math.random() * 100) + (totals.spend / days)
      });
    }
    
    res.json({
      success: true,
      analytics: {
        totals,
        averages: {
          ctr: avgCtr.toFixed(2),
          engagementRate: avgEngagementRate.toFixed(2)
        },
        campaignCount: campaigns.length,
        dailyData
      }
    });
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch analytics', error: error.message });
  }
});

/**
 * POST /api/campaigns/generate
 * Use AI to generate a campaign based on user's business profile
 */
router.post('/generate', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const user = await User.findById(userId);
    const bp = user?.businessProfile || {};
    
    const { goal, platform, theme } = req.body;
    
    const prompt = `Generate a complete marketing campaign for:
Business: ${bp.name || 'A business'}
Industry: ${bp.industry || 'General'}
Target Audience: ${bp.targetAudience || 'General audience'}
Brand Voice: ${bp.brandVoice || 'Professional'}
Business Type: ${bp.businessType || 'B2C'}
${goal ? `Campaign Goal: ${goal}` : ''}
${platform ? `Platform: ${platform}` : ''}
${theme ? `Theme/Topic: ${theme}` : ''}

Create a campaign that aligns with their brand voice and targets their specific audience.

Return ONLY valid JSON:
{
  "name": "Campaign name",
  "description": "Campaign description",
  "content": {
    "caption": "Main social media caption with hashtags",
    "headline": "Short headline",
    "callToAction": "CTA text"
  },
  "platforms": ["instagram", "facebook"],
  "hashtags": ["hashtag1", "hashtag2", "hashtag3"],
  "targetAudience": "Specific target for this campaign",
  "estimatedReach": "10K-50K",
  "bestPostingTime": "Tuesday 2PM",
  "tips": ["tip1", "tip2"]
}`;

    const response = await callGemini(prompt, { maxTokens: 1500 });
    const campaignData = parseGeminiJSON(response);
    
    // Create the campaign in the database
    const campaign = new Campaign({
      userId,
      name: campaignData.name,
      description: campaignData.description,
      content: campaignData.content,
      platforms: campaignData.platforms || ['instagram'],
      hashtags: campaignData.hashtags || [],
      status: 'draft',
      aiGenerated: true
    });
    
    await campaign.save();
    
    res.json({
      success: true,
      campaign,
      suggestions: campaignData.tips || [],
      estimatedReach: campaignData.estimatedReach,
      bestPostingTime: campaignData.bestPostingTime
    });
  } catch (error) {
    console.error('Generate campaign error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate campaign', error: error.message });
  }
});

/**
 * POST /api/campaigns/:id/enhance
 * Use AI to enhance/improve an existing campaign
 */
router.post('/:id/enhance', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const user = await User.findById(userId);
    const bp = user?.businessProfile || {};
    
    const campaign = await Campaign.findOne({ _id: req.params.id, userId });
    
    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }
    
    const prompt = `Enhance this marketing campaign for a ${bp.businessType || 'B2C'} ${bp.industry || ''} business:

Current Campaign:
Name: ${campaign.name}
Description: ${campaign.description}
Content: ${JSON.stringify(campaign.content)}
Platforms: ${campaign.platforms?.join(', ')}

Business Context:
Brand Voice: ${bp.brandVoice || 'Professional'}
Target Audience: ${bp.targetAudience || 'General'}

Improve the campaign to be more engaging and effective. Return ONLY valid JSON:
{
  "enhancedContent": {
    "caption": "Enhanced caption with better hooks and hashtags",
    "headline": "More compelling headline",
    "callToAction": "Stronger CTA"
  },
  "improvements": ["What was improved 1", "What was improved 2"],
  "additionalHashtags": ["newhash1", "newhash2"],
  "engagementTips": ["tip1", "tip2"]
}`;

    const response = await callGemini(prompt, { maxTokens: 1000 });
    const enhancements = parseGeminiJSON(response);
    
    res.json({
      success: true,
      originalCampaign: campaign,
      enhancements
    });
  } catch (error) {
    console.error('Enhance campaign error:', error);
    res.status(500).json({ success: false, message: 'Failed to enhance campaign', error: error.message });
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
    const bp = user?.businessProfile || {};
    
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

    res.json({
      success: true,
      posts: postsWithImages,
      contentCalendar: scheduleDates,
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

    res.json({
      success: true,
      imageUrl,
      postId
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

/**
 * POST /api/campaigns/edit-post-image
 * Edit an existing post image with a text prompt
 */
router.post('/edit-post-image', protect, async (req, res) => {
  try {
    const { 
      imageUrl,
      editPrompt,
      postId,
      platform
    } = req.body;

    if (!imageUrl || !editPrompt) {
      return res.status(400).json({ 
        success: false, 
        message: 'Image URL and edit prompt are required' 
      });
    }

    console.log(`✏️ Editing image for post ${postId || 'unknown'}...`);
    console.log('📝 Edit prompt:', editPrompt);

    // For now, we'll regenerate with the edit prompt as context
    // In the future, this could use image-to-image editing
    const { getRelevantImage } = require('../services/geminiAI');
    
    const enhancedPrompt = `${editPrompt}. Maintain professional marketing quality. Platform: ${platform || 'instagram'}`;
    
    const newImageUrl = await getRelevantImage(
      enhancedPrompt,
      'business',
      'awareness',
      'Campaign',
      platform || 'instagram',
      {}
    );

    console.log('✅ Image edited/regenerated successfully');

    res.json({
      success: true,
      imageUrl: newImageUrl,
      postId
    });

  } catch (error) {
    console.error('Edit post image error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to edit image', 
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
    
    if (!image) {
      return res.status(400).json({ 
        success: false, 
        message: 'Image is required' 
      });
    }
    
    console.log('🤖 Generating caption from image for platform:', platform || 'instagram');
    
    // Get user's brand profile for context
    const userId = req.user.userId || req.user.id;
    const User = require('../models/User');
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
    
    res.json({
      success: true,
      caption: caption.trim(),
      hashtags: hashtags
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
      
      res.json({
        success: true,
        imageBase64: finalImageBase64,
        imageUrl: hostedUrl,
        model: result.model || result.method,
        logoApplied: logoReplaced,
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
      
      res.json({
        success: true,
        imageBase64: result.imageBase64,
        imageUrl: hostedUrl,
        model: result.model || result.method,
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
      
      return res.json({
        success: true,
        imageBase64: result.imageBase64,
        imageUrl: hostedUrl,
        model: result.model
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
    
    res.json({
      success: true,
      results,
      summary: {
        total: posters.length,
        successful: successCount,
        failed: posters.length - successCount
      }
    });
  } catch (error) {
    console.error('Batch poster generation error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Batch generation failed', 
      error: error.message 
    });
  }
});

module.exports = router;
