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
const { postToSocialMedia, getAyrshareAnalytics } = require('../services/socialMediaAPI');

// Import image uploader for converting base64 to hosted URLs
const { ensurePublicUrl, isBase64DataUrl } = require('../services/imageUploader');

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
      console.warn('User does not have an Ayrshare profile key');
    } else {
      console.log('Found user Ayrshare profileKey:', profileKey.substring(0, 20) + '...');
    }
    
    // Get the platforms from request body (user selected) or fall back to campaign platforms
    const platforms = req.body.platforms || campaign.platforms || ['instagram'];
    
    // Build the post content
    const postContent = campaign.creative?.textContent || campaign.creative?.caption || campaign.content || campaign.name;
    const mediaUrls = campaign.creative?.imageUrls || [];
    let mediaUrl = mediaUrls[0] || campaign.creative?.mediaUrl || null;
    const hashtags = campaign.creative?.captions?.split(' ').filter(h => h.startsWith('#')) || [];
    
    // Format the full post with hashtags
    const fullPost = hashtags.length > 0 
      ? `${postContent}\n\n${hashtags.join(' ')}`
      : postContent;
    
    console.log('Publishing to platforms:', platforms);
    console.log('Post content:', fullPost.substring(0, 100) + '...');
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
        profileKey: profileKey  // Include user's Ayrshare profile key
      }
    );
    
    console.log('Ayrshare publish result:', result);
    
    if (result.success || result.id) {
      // Update campaign with post result
      await Campaign.findByIdAndUpdate(campaign._id, {
        $set: {
          status: 'posted',
          'socialPostId': result.id || result.postIds?.[0],
          'publishedAt': new Date(),
          'publishResult': result
        }
      });
      
      res.json({
        success: true,
        message: 'Campaign published to social media!',
        postId: result.id,
        platforms,
        result
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'Failed to publish to social media',
        error: result.error || result.message
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
    const duration = scheduling?.duration || '2weeks';
    const postsPerWeek = scheduling?.postsPerWeek || 3;
    const preferredDays = scheduling?.preferredDays || ['monday', 'wednesday', 'friday'];
    const preferredTimes = scheduling?.preferredTimes || ['10:00', '18:00'];
    const startDate = scheduling?.startDate || new Date().toISOString().split('T')[0];

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

    // Import image generation function
    const { getRelevantImage } = require('../services/geminiAI');

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
      brandVoice: bp.brandVoice || content?.tone || 'professional'
    };

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

module.exports = router;
