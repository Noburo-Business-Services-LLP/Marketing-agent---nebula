const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const Draft = require('../models/Draft');
const Campaign = require('../models/Campaign');
const User = require('../models/User');
const { publishCampaignToSocial } = require('../services/campaignPublisher');

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

      res.status(400).json({ success: false, message: result.error || 'Failed to publish to social media', draft });
    }
  } catch (error) {
    console.error('Publish draft error:', error);
    res.status(500).json({ success: false, message: 'Failed to publish draft', error: error.message });
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

// 10. POST /generate-image-bg - Create a draft immediately with status 'processing' and enqueue background image generation
router.post('/generate-image-bg', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { type, title, caption, hashtags, prompt, aspectRatio, platforms } = req.body;

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

    // Enqueue the background job
    const backgroundQueue = require('../services/backgroundQueue');
    backgroundQueue.enqueue({
      type: type === 'campaign' ? 'generate_campaign_image' : 'generate_post_image',
      draftId: draft._id,
      aspectRatio: aspectRatio || '1:1'
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
