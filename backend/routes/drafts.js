const express = require('express');
const path = require('path');
const router = express.Router();
const { protect } = require('../middleware/auth');
const Draft = require('../models/Draft');
const Campaign = require('../models/Campaign');
const User = require('../models/User');
const { publishCampaignToSocial } = require('../services/campaignPublisher');
const { handlePublishError } = require('../utils/publishErrorHandler');

// 1. POST /save - Create or update a draft (upsert by _id if provided)
router.post('/save', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { _id, ...draftData } = req.body;

    let draft;
    if (_id) {
      draft = await Draft.findOne({ _id, userId });
      if (draft) {
        Object.assign(draft, draftData);
        await draft.save();
        return res.status(200).json({ success: true, draft });
      }
    }

    draft = new Draft({
      ...draftData,
      userId
    });
    await draft.save();
    res.status(201).json({ success: true, draft });
  } catch (error) {
    console.error('Save draft error:', error);
    res.status(500).json({ success: false, message: 'Failed to save draft', error: error.message });
  }
});

// 2. GET / - List all drafts for current user (with optional ?status= and ?type= filter)
router.get('/', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { status, type } = req.query;

    const query = { userId };
    if (status && status !== 'all') {
      if (status === 'draft') {
        query.status = { $in: ['draft', 'processing', 'completed', 'failed'] };
      } else {
        query.status = status;
      }
    }
    if (type) {
      if (type.includes(',')) {
        query.contentType = { $in: type.split(',') };
      } else {
        query.contentType = type;
      }
    }

    const drafts = await Draft.find(query).populate('campaignId', 'campaignName').sort({ createdAt: -1 });
    res.status(200).json({ success: true, drafts });
  } catch (error) {
    console.error('Get drafts error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch drafts', error: error.message });
  }
});

// 3. GET /:id - Get single draft by ID
router.get('/:id', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const draft = await Draft.findOne({ _id: req.params.id, userId });

    if (!draft) {
      return res.status(404).json({ success: false, message: 'Draft not found' });
    }

    res.status(200).json({ success: true, draft });
  } catch (error) {
    console.error('Get draft by ID error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch draft', error: error.message });
  }
});

// 4. PUT /:id - Update draft fields (title, caption, hashtags, CTA, image, etc.)
router.put('/:id', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const draft = await Draft.findOne({ _id: req.params.id, userId });

    if (!draft) {
      return res.status(404).json({ success: false, message: 'Draft not found' });
    }

    Object.assign(draft, req.body);
    await draft.save();

    // If there is an associated campaign, update that too to keep them in sync
    if (draft.campaignId) {
      const campaign = await Campaign.findOne({ _id: draft.campaignId, userId });
      if (campaign) {
        campaign.name = draft.title || campaign.name;
        campaign.objective = draft.objective || campaign.objective;
        campaign.platforms = draft.platforms || campaign.platforms;
        campaign.creative = {
          type: draft.creative?.type || campaign.creative?.type || 'image',
          textContent: draft.caption || campaign.creative?.textContent || '',
          captions: draft.caption || campaign.creative?.captions || '',
          imageUrls: draft.imageUrl ? [draft.imageUrl] : (draft.creative?.imageUrls || campaign.creative?.imageUrls || []),
          videoUrl: draft.creative?.videoUrl || campaign.creative?.videoUrl || '',
          hashtags: draft.hashtags || campaign.creative?.hashtags || [],
          callToAction: draft.cta || campaign.creative?.callToAction || ''
        };
        if (draft.scheduledDate) {
          campaign.scheduling = {
            startDate: draft.scheduledDate,
            frequency: 'once',
            postTime: new Date(draft.scheduledDate).toTimeString().split(' ')[0].substring(0, 5)
          };
          campaign.status = 'scheduled';
        }
        await campaign.save();
      }
    }

    res.status(200).json({ success: true, draft });
  } catch (error) {
    console.error('Update draft error:', error);
    res.status(500).json({ success: false, message: 'Failed to update draft', error: error.message });
  }
});

// Helper to convert draft to campaign object or update existing
async function upsertCampaignFromDraft(draft, userId, targetStatus) {
  let campaign;
  if (draft.campaignId) {
    campaign = await Campaign.findOne({ _id: draft.campaignId, userId });
  }

  const campaignData = {
    userId,
    name: draft.title || 'Untitled Campaign',
    objective: draft.objective || 'awareness',
    platforms: draft.platforms || [],
    status: targetStatus,
    tone: draft.tone || null,
    creative: {
      type: draft.creative?.type || 'image',
      textContent: draft.caption || '',
      captions: draft.caption || '',
      imageUrls: draft.imageUrl ? [draft.imageUrl] : (draft.creative?.imageUrls || []),
      videoUrl: draft.creative?.videoUrl || '',
      hashtags: draft.hashtags || [],
      callToAction: draft.cta || ''
    }
  };

  if (draft.scheduledDate) {
    campaignData.scheduling = {
      startDate: draft.scheduledDate,
      frequency: 'once',
      postTime: new Date(draft.scheduledDate).toTimeString().split(' ')[0].substring(0, 5)
    };
  }

  if (campaign) {
    Object.assign(campaign, campaignData);
  } else {
    campaign = new Campaign(campaignData);
  }

  await campaign.save();
  return campaign;
}

// 5. POST /:id/schedule - Set scheduledDate and change status to scheduled
router.post('/:id/schedule', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { scheduledDate } = req.body;

    if (!scheduledDate) {
      return res.status(400).json({ success: false, message: 'scheduledDate is required' });
    }

    const draft = await Draft.findOne({ _id: req.params.id, userId });
    if (!draft) {
      return res.status(404).json({ success: false, message: 'Draft not found' });
    }

    draft.scheduledDate = new Date(scheduledDate);
    draft.status = 'scheduled';
    await draft.save();

    // Create/update corresponding Campaign record so existing background scheduler publishes it
    const campaign = await upsertCampaignFromDraft(draft, userId, 'scheduled');
    
    draft.campaignId = campaign._id;
    await draft.save();

    res.status(200).json({ success: true, draft });
  } catch (error) {
    console.error('Schedule draft error:', error);
    res.status(500).json({ success: false, message: 'Failed to schedule draft', error: error.message });
  }
});

// 6. POST /:id/publish - Publish draft now
router.post('/:id/publish', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const draft = await Draft.findOne({ _id: req.params.id, userId });

    if (!draft) {
      return res.status(404).json({ success: false, message: 'Draft not found' });
    }

    // Override platforms if supplied in body, else use draft's
    if (req.body.platforms) {
      draft.platforms = req.body.platforms;
    }

    // Create or update campaign record in status 'posted' or 'active'
    const campaign = await upsertCampaignFromDraft(draft, userId, 'active');

    // Get user to check Ayrshare settings
    const user = await User.findById(userId);
    const profileKey = user?.ayrshare?.profileKey;

    if (!profileKey) {
      return res.status(400).json({
        success: false,
        message: 'No social accounts connected. Please link your social channels in Connect Socials first.'
      });
    }

    // Publish campaign using existing publisher service
    console.log(`[Draft Publish] Publishing campaign ${campaign._id} to social networks.`);
    const result = await publishCampaignToSocial(campaign);

    if (result.success) {
      campaign.status = 'posted';
      campaign.publishedAt = new Date();
      campaign.socialPostId = result.postId || campaign.socialPostId;
      campaign.socialPostIds = {
        ...(campaign.socialPostIds || {}),
        ...(result.platformPostIds || {})
      };
      campaign.facebookPostId = result.platformPostIds?.facebook || campaign.facebookPostId || null;
      campaign.instagramPostId = result.platformPostIds?.instagram || campaign.instagramPostId || null;
      campaign.publishResult = result.data;
      campaign.lastPublishError = null;
      campaign.ayrshareStatus = 'success';
      await campaign.save();

      draft.status = 'published';
      draft.campaignId = campaign._id;
      await draft.save();

      res.status(200).json({ success: true, draft, publishResult: result });
    } else {
      campaign.status = 'draft';
      campaign.lastPublishError = result.error;
      campaign.ayrshareStatus = 'error';
      await campaign.save();

      res.status(400).json({ ...handlePublishError(result.error), draft });
    }
  } catch (error) {
    console.error('Publish draft error:', error);
    res.status(500).json({ ...handlePublishError(error), draft: null });
  }
});

// 7. DELETE /:id - Soft-delete (archive) a draft
router.delete('/:id', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const draft = await Draft.findOne({ _id: req.params.id, userId });

    if (!draft) {
      return res.status(404).json({ success: false, message: 'Draft not found' });
    }

    draft.status = 'archived';
    await draft.save();

    res.status(200).json({ success: true, message: 'Draft archived successfully' });
  } catch (error) {
    console.error('Delete draft error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete draft', error: error.message });
  }
});

const ContentCalendar = require('../models/ContentCalendar');
const backgroundQueue = require('../services/backgroundQueue');

// POST /api/drafts/:id/reject
router.post('/:id/reject', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const draft = await Draft.findOne({ _id: req.params.id, userId });

    if (!draft) {
      return res.status(404).json({ success: false, message: 'Draft not found' });
    }

    draft.status = 'archived';
    await draft.save();

    // If it is linked to a ContentCalendar, update its status
    if (draft.contentCalendarId && draft.calendarDay) {
      const calendar = await ContentCalendar.findOne({ _id: draft.contentCalendarId, userId });
      if (calendar) {
        // Find the item matching the day or generatedDraftId
        let item = null;
        for (const week of calendar.weeks || []) {
          item = (week.items || []).find(
            (entry) => 
              String(entry.generatedDraftId) === String(draft._id) || 
              Number(entry.day) === Number(draft.calendarDay)
          );
          if (item) break;
        }
        if (item) {
          item.status = 'rejected';
          await calendar.save();
        }
      }
    }

    res.status(200).json({ success: true, message: 'Draft rejected successfully' });
  } catch (error) {
    console.error('Reject draft error:', error);
    res.status(500).json({ success: false, message: 'Failed to reject draft', error: error.message });
  }
});

// POST /api/drafts/:id/regenerate
router.post('/:id/regenerate', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const draft = await Draft.findOne({ _id: req.params.id, userId });

    if (!draft) {
      return res.status(404).json({ success: false, message: 'Draft not found' });
    }

    if (!draft.contentCalendarId || !draft.calendarDay) {
      return res.status(400).json({ success: false, message: 'Draft is not associated with a calendar item' });
    }

    const calendar = await ContentCalendar.findOne({ _id: draft.contentCalendarId, userId });
    if (!calendar) {
      return res.status(404).json({ success: false, message: 'Calendar not found' });
    }

    let item = null;
    for (const week of calendar.weeks || []) {
      item = (week.items || []).find(
        (entry) => 
          String(entry.generatedDraftId) === String(draft._id) || 
          Number(entry.day) === Number(draft.calendarDay)
      );
      if (item) break;
    }

    if (!item) {
      return res.status(404).json({ success: false, message: 'Calendar item not found' });
    }

    // Archive current draft
    draft.status = 'archived';
    await draft.save();

    // Reset item status to draft so it can be regenerated
    item.status = 'draft';
    item.generatedDraftId = null;
    item.generatedCampaignId = null;
    await calendar.save();

    // Trigger regeneration asynchronously in the background
    (async () => {
      try {
        await backgroundQueue.generateSingleCalendarItem(calendar, item, draft.calendarWeek || 1);
        await calendar.save();
        console.log(`[Regenerate] Finished background regeneration for Calendar ${calendar._id}, Day ${item.day}`);
      } catch (genErr) {
        console.error('[Regenerate] Error in background regeneration process:', genErr.message);
      }
    })();

    res.status(200).json({ success: true, message: 'Regeneration started in background' });
  } catch (error) {
    console.error('Regenerate draft error:', error);
    res.status(500).json({ success: false, message: 'Failed to trigger draft regeneration', error: error.message });
  }
});

// POST /upload-media — bring your OWN image or video in as a draft.
//
// Everything downstream (AI caption, schedule, publish) already works on a
// Draft, so an upload just needs to become one. Uses multer + memory storage
// rather than base64 JSON so real video files don't blow the body limit.
const multer = require('multer');
const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 120 * 1024 * 1024 }, // 120MB — comfortably over a reel
  fileFilter: (req, file, cb) => {
    const ok = /^(image|video)\//i.test(file.mimetype || '');
    cb(ok ? null : new Error('Only image or video files are allowed'), ok);
  }
});

router.post('/upload-media', protect, mediaUpload.single('file'), async (req, res) => {
  const os = require('os');
  const fsp = require('fs').promises;
  let tempPath = '';
  try {
    const userId = req.user.userId || req.user.id;
    if (!req.file) return res.status(400).json({ success: false, message: 'No file received' });

    const { title, caption, platforms } = req.body || {};
    const isVideo = /^video\//i.test(req.file.mimetype);
    const { uploadBase64Image, uploadVideoFile } = require('../services/imageUploader');

    let mediaUrl = '';
    if (isVideo) {
      // uploadVideoFile works from a path, so stage the buffer on disk first.
      tempPath = path.join(os.tmpdir(), `upload_${Date.now()}_${(req.file.originalname || 'clip').replace(/[^\w.-]/g, '')}`);
      await fsp.writeFile(tempPath, req.file.buffer);
      const up = await uploadVideoFile(tempPath, 'nebula-uploads');
      if (!up?.success || !up?.url) throw new Error(up?.error || 'Video upload failed');
      mediaUrl = up.url;
    } else {
      const dataUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
      const up = await uploadBase64Image(dataUrl, 'nebula-uploads');
      if (!up?.success || !up?.url) throw new Error(up?.error || 'Image upload failed');
      mediaUrl = up.url;
    }

    let platformList = [];
    try {
      platformList = Array.isArray(platforms) ? platforms : JSON.parse(platforms || '[]');
    } catch { platformList = []; }

    const draft = new Draft({
      userId,
      title: title || req.file.originalname || 'Uploaded post',
      caption: caption || '',
      hashtags: [],
      platforms: platformList,
      status: 'completed', // media already exists — nothing to generate
      sourceType: 'post',
      contentType: 'post',
      imageUrl: isVideo ? '' : mediaUrl,
      creative: {
        type: isVideo ? 'video' : 'image',
        textContent: caption || '',
        captions: caption || '',
        imageUrls: isVideo ? [] : [mediaUrl],
        videoUrl: isVideo ? mediaUrl : undefined,
        hashtags: []
      }
    });
    await draft.save();

    res.status(201).json({ success: true, draft, mediaUrl, mediaType: isVideo ? 'video' : 'image' });
  } catch (error) {
    console.error('Upload media error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to upload media' });
  } finally {
    if (tempPath) { try { await require('fs').promises.unlink(tempPath); } catch {} }
  }
});

// POST /:id/apply-logo — composite a brand logo onto a draft's finished image.
//
// Deliberately a SEPARATE step from generation. Handing a logo to the image
// model as a reference gets it redrawn and smeared; compositing with Sharp
// afterwards keeps it pixel-exact. Same reasoning as the reels pipeline.
router.post('/:id/apply-logo', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { logoUrl, position, size } = req.body || {};
    if (!logoUrl) {
      return res.status(400).json({ success: false, message: 'logoUrl is required' });
    }

    const draft = await Draft.findOne({ _id: req.params.id, userId });
    if (!draft) return res.status(404).json({ success: false, message: 'Draft not found' });

    const baseImage = draft.imageUrl || draft.creative?.imageUrls?.[0] || '';
    if (!baseImage) {
      return res.status(400).json({ success: false, message: 'Draft has no image yet' });
    }

    const { overlayLogoAndUpload } = require('../services/logoOverlay');
    const result = await overlayLogoAndUpload(baseImage, logoUrl, {
      position: position || 'top-right',
      size: size || 'small'
    });

    if (!result?.success || !result?.url) {
      return res.status(502).json({ success: false, message: result?.error || 'Logo overlay failed' });
    }

    // Keep the clean original so the logo can be changed or removed later.
    if (!draft.imageUrlNoLogo) draft.imageUrlNoLogo = baseImage;
    draft.imageUrl = result.url;
    draft.logoApplied = true;
    if (Array.isArray(draft.creative?.imageUrls)) draft.creative.imageUrls[0] = result.url;
    await draft.save();

    res.json({ success: true, draft, imageUrl: result.url });
  } catch (error) {
    console.error('Apply logo error:', error);
    res.status(500).json({ success: false, message: 'Failed to apply logo', error: error.message });
  }
});

// 10. POST /generate-image-bg - Create a draft immediately with status 'processing' and enqueue background image generation
router.post('/generate-image-bg', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { type, title, caption, hashtags, prompt, aspectRatio, platforms, referenceImage } = req.body;

    const draft = new Draft({
      userId,
      title: title || 'Untitled Draft',
      caption: caption || '',
      hashtags: hashtags || [],
      platforms: platforms || [],
      imagePrompt: prompt || '',
      status: 'processing',
      sourceType: type === 'campaign' ? 'campaign' : 'post',
      contentType: type === 'campaign' ? 'campaign' : 'post',
      creative: {
        type: 'image',
        textContent: caption || '',
        captions: caption || '',
        imageUrls: [],
        hashtags: hashtags || []
      }
    });

    await draft.save();

    // Enqueue the background job. referenceImage (base64 data URL) is passed
    // through so the worker can send it to Nano Banana as a style/composition
    // guide when generating the poster.
    const backgroundQueue = require('../services/backgroundQueue');
    backgroundQueue.enqueue({
      type: type === 'campaign' ? 'generate_campaign_image' : 'generate_post_image',
      draftId: draft._id,
      aspectRatio: aspectRatio || '1:1',
      referenceImage: referenceImage || null
    });

    res.status(201).json({ success: true, draftId: draft._id, draft });
  } catch (error) {
    console.error('Generate image bg error:', error);
    res.status(500).json({ success: false, message: 'Failed to queue image generation', error: error.message });
  }
});

// 11. POST /:id/retry-image - Reset status to 'processing' and re-enqueue failed draft for image generation
router.post('/:id/retry-image', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const draft = await Draft.findOne({ _id: req.params.id, userId });

    if (!draft) {
      return res.status(404).json({ success: false, message: 'Draft not found' });
    }

    draft.status = 'processing';
    draft.errorMessage = '';
    await draft.save();

    const backgroundQueue = require('../services/backgroundQueue');
    backgroundQueue.enqueue({
      type: draft.contentType === 'campaign' ? 'generate_campaign_image' : 'generate_post_image',
      draftId: draft._id,
      aspectRatio: '1:1'
    });

    res.status(200).json({ success: true, message: 'Requeued draft for image generation', draft });
  } catch (error) {
    console.error('Retry image generation error:', error);
    res.status(500).json({ success: false, message: 'Failed to retry image generation', error: error.message });
  }
});

module.exports = router;
