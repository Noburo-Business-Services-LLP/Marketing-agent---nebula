/**
 * Campaign Routes
 * Full CRUD for marketing campaigns with social media posting
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { checkTrial, deductCredits, requireCredits } = require('../middleware/trialGuard');
const Campaign = require('../models/Campaign');
const User = require('../models/User');
const { callGemini, parseGeminiJSON, generateICPAndStrategy, generateCampaignImageNanoBanana } = require('../services/geminiAI');
// Import Ayrshare for social media posting
const { postToSocialMedia, getPostStatus, deletePost: deleteAyrsharePost } = require('../services/socialMediaAPI');

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
 * POST /api/campaigns/generate-campaign-stream
 * SSE endpoint — generates campaign posts with AI images one by one, streaming each to the frontend
 */
router.post('/generate-campaign-stream', protect, checkTrial, async (req, res) => {
  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  let aborted = false;
  req.on('close', () => { aborted = true; });

  try {
    const userId = req.user.userId || req.user.id;
    const user = await User.findById(userId);
    const bp = user?.businessProfile || {};

    // Parse params from request body (POST)
    const {
      campaignName, campaignDescription, objective,
      platforms: platformsInput, tone, aspectRatio,
      keyMessages, duration, startDate: startDateParam,
      preferredDays: daysInput, targetAge, targetGender,
      targetLocation, targetInterests, productLogo
    } = req.body;

    const platforms = Array.isArray(platformsInput) ? platformsInput : (platformsInput ? platformsInput.split(',') : ['instagram']);
    const preferredDays = Array.isArray(daysInput) ? daysInput : (daysInput ? daysInput.split(',') : ['monday', 'wednesday', 'friday']);
    const startDate = startDateParam || new Date().toISOString().split('T')[0];
    const weeks = duration === '2weeks' ? 2 : 1;
    const totalPosts = Math.min(preferredDays.length * weeks, 14);

    // Deduct credits: 1 text generation + 1 per image
    const creditCost = 7 + (totalPosts * 5); // 7 for text gen + 5 per image
    const creditResult = await deductCredits(userId, 'campaign_full', totalPosts, `AI campaign generation (${totalPosts} posts with images)`);
    if (!creditResult.success) {
      sendEvent('error', { message: creditResult.error, creditsExhausted: true });
      return res.end();
    }

    sendEvent('status', { message: 'Generating campaign content...', totalPosts });

    // Generate schedule dates
    const scheduleDates = [];
    const start = new Date(startDate);
    let postsCreated = 0;
    let currentDay = 0;
    while (postsCreated < totalPosts && currentDay < 100) {
      const checkDate = new Date(start);
      checkDate.setDate(start.getDate() + currentDay);
      const dayName = checkDate.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
      if (preferredDays.includes(dayName)) {
        scheduleDates.push({
          date: checkDate.toISOString().split('T')[0],
          time: '10:00',
          week: postsCreated < preferredDays.length ? 1 : 2
        });
        postsCreated++;
      }
      currentDay++;
    }

    // Step 1: Generate all captions via Gemini (ROCI format prompt)
    const captionPrompt = `ROLE: You are a senior social media strategist and copywriter at a leading digital marketing agency. You craft high-converting, scroll-stopping social media campaigns for premium brands.

OBJECTIVE: Create exactly ${totalPosts} unique, varied social media posts for a marketing campaign. Each post must feel distinct — different angles, hooks, and content themes — while maintaining a cohesive brand voice across the series. Also provide a detailed image description for each post that will be used to generate AI ad creatives.

CONTEXT:
- Brand: ${bp.companyName || bp.name || 'Brand'} (${bp.industry || 'General'} industry)
- Campaign: "${campaignName}"${campaignDescription ? ` — ${campaignDescription}` : ''}
- Objective: ${objective || 'awareness'}
- Target audience: ${targetAge || '18-35'} age, ${targetGender || 'all'} gender${targetLocation ? ', located in ' + targetLocation : ''}${targetInterests ? ', interested in ' + targetInterests : ''}
- Platforms: ${platforms.join(', ')}
- Tone: ${tone || 'professional'}
${keyMessages ? `- Core message (use as UNDERLYING THEME, do NOT repeat verbatim in every post): ${keyMessages}` : ''}

INSTRUCTIONS:
1. Create exactly ${totalPosts} posts. Each post MUST have a DIFFERENT content angle. Distribute across these themes: problem/solution (2-3 posts), social proof/testimonial (1-2 posts), educational/tips (2-3 posts), behind-the-scenes/story (1-2 posts), promotional/CTA (1-2 posts), engagement/question (1 post). Adjust distribution based on total count.
2. Captions must be platform-native: ${platforms.includes('twitter') ? 'Twitter posts under 280 chars.' : ''} ${platforms.includes('instagram') ? 'Instagram captions with hook in first line.' : ''} ${platforms.includes('linkedin') ? 'LinkedIn posts that open with a bold statement or question.' : ''} Use natural language, not corporate jargon.
3. Each caption should open with a strong hook (question, bold claim, statistic, or story opener) — the first line must make someone stop scrolling.
4. Include 3-5 relevant hashtags per post. Mix broad and niche hashtags. Never use generic tags like #marketing or #business alone.
5. Include appropriate emojis but don't overdo it (2-4 per post max).
6. The imageDescription for each post should describe a PROFESSIONAL AD CREATIVE — describe the visual style (photography, illustration, graphic design), subjects, colors, mood, lighting, and composition. Do NOT mention aspect ratios, post numbers, "Brand" labels, or any metadata. Do NOT use placeholder text like [Date] or [Name]. Describe it as if briefing a professional designer.
7. The key message should influence the overall campaign narrative but each post should express it differently — through stories, statistics, questions, tips, or social proof. NEVER copy-paste the same message across posts.

Return ONLY valid JSON (no markdown, no backticks):
{
  "posts": [
    {
      "platform": "${platforms[0] || 'instagram'}",
      "caption": "The full caption text with emojis and line breaks",
      "hashtags": ["#tag1", "#tag2", "#tag3"],
      "contentTheme": "educational|promotional|engagement|storytelling|social_proof|problem_solution",
      "imageDescription": "Detailed visual description for AI image generation — describe the creative direction, visual style, subjects, colors, mood, composition. No metadata or placeholder text."
    }
  ]
}`;

    const textResponse = await callGemini(captionPrompt, { maxTokens: 8000, temperature: 0.85, skipCache: true });
    const parsed = parseGeminiJSON(textResponse);

    if (!parsed?.posts?.length) {
      sendEvent('error', { message: 'Failed to generate campaign content' });
      return res.end();
    }

    if (aborted) return res.end();

    sendEvent('status', { message: 'Content generated! Now creating images...', totalPosts });

    // Step 2: Generate images one by one and stream each
    const postsToProcess = parsed.posts.slice(0, totalPosts);

    for (let i = 0; i < postsToProcess.length; i++) {
      if (aborted) break;

      const post = postsToProcess[i];
      const schedule = scheduleDates[i] || { date: startDate, time: '10:00', week: 1 };

      sendEvent('generating', { index: i, total: postsToProcess.length, message: `Generating image ${i + 1} of ${postsToProcess.length}...` });

      // Generate image with Nano Banana 2
      const imageResult = await generateCampaignImageNanoBanana(post.imageDescription, {
        aspectRatio: aspectRatio || '1:1',
        brandName: bp.companyName || bp.name || '',
        brandLogo: productLogo || null,
        industry: bp.industry || '',
        tone: tone || 'professional',
        postIndex: i,
        totalPosts: postsToProcess.length,
        campaignTheme: campaignName,
        keyMessages: keyMessages || ''
      });

      const postData = {
        id: `post-${i + 1}`,
        index: i,
        week: schedule.week,
        platform: post.platform?.toLowerCase() || platforms[i % platforms.length],
        caption: post.caption,
        hashtags: Array.isArray(post.hashtags)
          ? post.hashtags.map(h => h.startsWith('#') ? h : `#${h}`)
          : ['#marketing'],
        imageUrl: imageResult.success ? imageResult.imageUrl : '',
        imageDescription: post.imageDescription || '',
        suggestedDate: schedule.date,
        suggestedTime: schedule.time,
        contentTheme: post.contentTheme || 'promotional',
        status: 'pending',
        model: imageResult.success ? imageResult.model : 'failed'
      };

      sendEvent('post', postData);
    }

    // Done
    const updatedUser = await User.findById(userId).select('credits.balance');
    sendEvent('complete', {
      totalPosts: postsToProcess.length,
      creditsRemaining: updatedUser?.credits?.balance ?? 0
    });

    res.end();

  } catch (error) {
    console.error('SSE campaign generation error:', error);
    sendEvent('error', { message: error.message || 'Failed to generate campaign' });
    res.end();
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
 * Delete a campaign — also removes from Ayrshare & social platforms if posted/scheduled
 */
router.delete('/:id', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;

    const campaign = await Campaign.findOne({ _id: req.params.id, userId });

    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    let ayrshareDeleted = false;

    // If this campaign was posted/scheduled on Ayrshare, delete it there first
    if (campaign.socialPostId) {
      const user = await User.findById(userId);
      const profileKey = user?.ayrshare?.profileKey;

      console.log(`🗑️ Deleting post ${campaign.socialPostId} from Ayrshare (campaign: ${campaign.name})`);
      const deleteResult = await deleteAyrsharePost(campaign.socialPostId, { profileKey });

      if (deleteResult.success) {
        console.log(`✅ Ayrshare post ${campaign.socialPostId} deleted successfully`);
        ayrshareDeleted = true;
      } else {
        // Log but don't block — still delete from our DB
        console.warn(`⚠️ Ayrshare delete failed for ${campaign.socialPostId}:`, deleteResult.error);
      }
    }

    await Campaign.findByIdAndDelete(campaign._id);

    res.json({
      success: true,
      message: 'Campaign deleted',
      ayrshareDeleted,
      socialPostId: campaign.socialPostId || null
    });
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
router.post('/generate-campaign-posts', protect, checkTrial, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const user = await User.findById(userId);
    const bp = user?.businessProfile || {};

    // Deduct flat 7 credits for campaign post generation (text only, no bulk images)
    const textCreditResult = await deductCredits(userId, 'campaign_full', 1, 'AI campaign generation');
    if (!textCreditResult.success) {
      return res.status(403).json({
        success: false,
        creditsExhausted: true,
        message: textCreditResult.error,
        creditsRemaining: textCreditResult.creditsRemaining
      });
    }
    
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

    // Use stock placeholder images — NO bulk AI image generation
    // Users can generate images individually per post if they want
    const stockImages = [
      'https://images.unsplash.com/photo-1559136555-9303baea8ebd?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1552664730-d307ca884978?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1573164713988-8665fc963095?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1551434678-e076c223a692?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1531482615713-2afd69097998?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1553877522-43269d4ea984?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1542744173-8e7e53415bb0?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1556761175-5973dc0f32e7?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1553028826-f4804a6dba3b?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1556155092-490a1ba16284?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1553729459-afe8f2e2ed65?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1497215728101-856f4ea42174?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1554200876-56c2f25224fa?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1543286386-713bdd548da4?w=800&h=600&fit=crop',
    ];

    const postsWithImages = [];
    const postsToProcess = parsed.posts.slice(0, totalPosts);
    
    for (let index = 0; index < postsToProcess.length; index++) {
      const post = postsToProcess[index];
      const schedule = scheduleDates[index] || { date: startDate, time: '10:00' };
      
      postsWithImages.push({
        id: `post-${index + 1}`,
        platform: post.platform?.toLowerCase() || platforms[index % platforms.length],
        caption: post.caption,
        hashtags: Array.isArray(post.hashtags) 
          ? post.hashtags.map(h => h.startsWith('#') ? h : `#${h}`)
          : ['#marketing', '#brand'],
        imageUrl: stockImages[index % stockImages.length],
        imageDescription: post.imageDescription || '',
        suggestedDate: schedule.date,
        suggestedTime: schedule.time,
        contentTheme: post.contentTheme || 'promotional',
        callToAction: post.callToAction || content?.callToAction || 'Learn more'
      });
    }

    console.log(`✅ Generated ${postsWithImages.length} text-only posts for campaign: ${campaignName}`);

    // Fetch latest credit balance for frontend update
    const updatedUser = await User.findById(userId).select('credits.balance');
    const creditsRemaining = updatedUser?.credits?.balance ?? 0;

    res.json({
      success: true,
      posts: postsWithImages,
      contentCalendar: scheduleDates,
      creditsRemaining,
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
router.post('/regenerate-post-image', protect, checkTrial, requireCredits('image_edit'), async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id || req.user._id;
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

    // Deduct credits for image edit/regenerate
    const editResult = await deductCredits(userId, 'image_edit', 1, 'Regenerated post image');

    res.json({
      success: true,
      imageUrl,
      postId,
      creditsRemaining: editResult.creditsRemaining
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
router.post('/generate-caption', protect, checkTrial, requireCredits('campaign_text'), async (req, res) => {
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

    // Deduct 2 credits for caption generation
    const captionCreditResult = await deductCredits(userId, 'campaign_text', 1, `AI caption for ${platform || 'instagram'}`);
    
    res.json({
      success: true,
      caption: caption.trim(),
      hashtags: hashtags,
      creditsRemaining: captionCreditResult.creditsRemaining
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
router.post('/template-poster', protect, checkTrial, requireCredits('image_generated'), async (req, res) => {
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
      
      // Deduct credits for image generation
      const userId = req.user.userId || req.user.id || req.user._id;
      const posterCreditResult = await deductCredits(userId, 'image_generated', 1, 'Generated template poster');

      res.json({
        success: true,
        imageBase64: finalImageBase64,
        imageUrl: hostedUrl,
        model: result.model || result.method,
        logoApplied: logoReplaced,
        message: 'Poster generated successfully',
        creditsRemaining: posterCreditResult.creditsRemaining
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
router.post('/template-poster/edit', protect, checkTrial, requireCredits('image_edit'), async (req, res) => {
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

      // Deduct credits for image edit
      const userId = req.user.userId || req.user.id || req.user._id;
      const editCreditResult = await deductCredits(userId, 'image_edit', 1, 'Edited template poster');

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
        message: 'Poster updated successfully',
        creditsRemaining: editCreditResult.creditsRemaining
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
router.post('/template-poster/from-reference', protect, checkTrial, requireCredits('image_generated'), async (req, res) => {
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

      // Deduct credits for image generation from reference
      const userId = req.user.userId || req.user.id || req.user._id;
      const refCreditResult = await deductCredits(userId, 'image_generated', 1, 'Generated poster from reference');
      
      return res.json({
        success: true,
        imageBase64: result.imageBase64,
        imageUrl: hostedUrl,
        model: result.model,
        creditsRemaining: refCreditResult.creditsRemaining
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
router.post('/template-poster/batch', protect, checkTrial, requireCredits('image_generated', (req) => (req.body.posters?.length || 1)), async (req, res) => {
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

        // Deduct credits per image generated in batch
        const userId = req.user.userId || req.user.id || req.user._id;
        await deductCredits(userId, 'image_generated', 1, `Batch poster ${i + 1}`);
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

    // Fetch latest credit balance for frontend
    const latestUser = await User.findById(req.user.userId || req.user.id || req.user._id).select('credits.balance');
    
    res.json({
      success: true,
      results,
      creditsRemaining: latestUser?.credits?.balance ?? 0,
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
