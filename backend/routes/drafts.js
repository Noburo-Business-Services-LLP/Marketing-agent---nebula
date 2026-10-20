const { priceText } = require('../config/quarkWording');
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const router = express.Router();
const { protect } = require('../middleware/auth');
// Shared per-user limits for paid AI, scraping, uploads and ad spend (docs/superpowers/ops/security-hardening.md).
const L = require('../middleware/limits');
const { listTimeout } = require('../utils/listQueryTimeout');
const { requireFeature } = require('../middleware/requireFeature');
const { checkTrial, deductCredits, refundCredits, CREDIT_COSTS } = require('../middleware/trialGuard');
const Draft = require('../models/Draft');
const Campaign = require('../models/Campaign');
const User = require('../models/User');
const { publishCampaignToSocial } = require('../services/campaignPublisher');
const { handlePublishError } = require('../utils/publishErrorHandler');
const { buildPrompt } = require('../services/promptRegistry');
const { buildBrandMemoryBlock } = require('../services/brandMemory');
const { callTextLLM } = require('../services/openAI');
const { parseGeminiJSON } = require('../services/geminiAI');
const { normalizeLanguage } = require('../services/contentCalendarService');
const postLifecycle = require('../services/postLifecycle');
const { publishGate, editableFields, listStatusFilter } = postLifecycle;

// Approve, Bin, archive, restore and counts (services/postLifecycle.js). Built lazily so tests can load this file.
let lifecycle = null;
const actions = () => (lifecycle = lifecycle || postLifecycle.createPostActions({ Draft, Campaign, upsertCampaign: (...a) => upsertCampaignFromDraft(...a) }));
const ownerId = (req) => req.user.userId || req.user.id;
const send = (res, out) => res.status(out.status).json(out.json);
const lifecycleRoute = (name, failMessage) => async (req, res) => {
  try {
    return send(res, await actions()[name](ownerId(req), req.params.id));
  } catch (error) {
    console.error(`Draft ${name} error:`, error && error.message);
    return res.status(500).json({ success: false, message: failMessage });
  }
};

// 1. POST /save - Create or update a draft (upsert by _id if provided)
router.post('/save', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { _id } = req.body || {};
    // Status and origin are never taken from the body: approval and the Bin have their own routes.
    const draftData = editableFields(req.body);

    let draft;
    if (_id) {
      draft = await Draft.findOne({ _id, userId });
      if (draft) {
        Object.assign(draft, draftData);
        await draft.save();
        return res.status(200).json({ success: true, draft });
      }
    }

    // A draft saved here is made by the customer by hand (Create, Campaigns), so it needs no approval.
    draft = new Draft({
      ...draftData,
      status: req.body && req.body.status === 'completed' ? 'completed' : 'draft',
      origin: 'manual',
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

    // The Bin is only listed when asked for (?status=binned).
    const query = { userId, status: listStatusFilter(status) };
    if (type) {
      if (type.includes(',')) {
        query.contentType = { $in: type.split(',') };
      } else {
        query.contentType = type;
      }
    }

    // One page (load-test weeks 2 to 3): newest first, 30 by default, ?limit= up to 50, ?cursor= for the next page;
    // list fields only (services/listPage.js). `drafts` stays the list, so older screens keep working.
    const page = require('../services/listPage');
    const limit = page.parseLimit(req.query.limit, 30);
    query.userId = new mongoose.Types.ObjectId(String(userId));
    const q = page.pageQuery(query, { cursor: req.query.cursor, limit });
    const rows = await listTimeout(Draft.aggregate(page.pagePipeline(q, page.DRAFT_TRIM)));
    await Draft.populate(rows, { path: 'campaignId', select: 'campaignName', options: { lean: true } });
    const { items, nextCursor, hasMore } = page.finishPage(rows, { limit, cursor: q.cursor });
    res.status(200).json({ success: true, drafts: items, nextCursor, hasMore });
  } catch (error) {
    if (error && error.status === 400) return res.status(400).json({ success: false, message: error.message });
    console.error('Get drafts error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch drafts', error: error.message });
  }
});

// GET /counts - how many posts in each Library view (the Library badge is needsApproval). countDocuments on the
// { userId, status } index. needsApproval uses the same filter as Home "drafts waiting".
router.get('/counts', protect, async (req, res) => {
  try {
    res.set('Cache-Control', 'private, no-store');
    return send(res, await actions().counts(ownerId(req)));
  } catch (error) {
    console.error('Draft counts error:', error && error.message);
    return res.status(500).json({ success: false, message: 'We could not load your post counts. Please try again.' });
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

    Object.assign(draft, editableFields(req.body));
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
        // Only a post that is scheduled moves its campaign's time. An edit never schedules a post by itself (that
        // would skip approval and the Publish add-on check).
        if (draft.scheduledDate && draft.status === 'scheduled' && campaign.status === 'scheduled') {
          campaign.scheduling = {
            startDate: draft.scheduledDate,
            frequency: 'once',
            postTime: new Date(draft.scheduledDate).toTimeString().split(' ')[0].substring(0, 5)
          };
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
router.post('/:id/schedule', protect, requireFeature('schedule'), async (req, res) => {
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
    // Automation posts must be approved first; manual posts are scheduled straight away.
    const blocked = publishGate(draft);
    if (blocked) return res.status(blocked.status).json({ success: false, message: blocked.message });
    const when = new Date(scheduledDate);
    if (Number.isNaN(when.getTime())) {
      return res.status(400).json({ success: false, message: 'Please choose a valid date and time.' });
    }

    draft.scheduledDate = when;
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
router.post('/:id/publish', protect, requireFeature('publish'), async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const draft = await Draft.findOne({ _id: req.params.id, userId });

    if (!draft) {
      return res.status(404).json({ success: false, message: 'Draft not found' });
    }
    // Automation posts must be approved first; manual posts are posted straight away.
    const blocked = publishGate(draft);
    if (blocked) return res.status(blocked.status).json({ success: false, message: blocked.message });

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

// 7. DELETE /:id - Move a draft to the Bin (restorable for 14 days, then removed for good by services/binPurge.js).
// Posted items cannot be binned (archive them); scheduled items must be unscheduled first.
router.delete('/:id', protect, async (req, res) => {
  try {
    return send(res, await actions().bin(ownerId(req), req.params.id));
  } catch (error) {
    console.error('Delete draft error:', error && error.message);
    res.status(500).json({ success: false, message: 'Failed to delete draft' });
  }
});

// Approve: "this is good enough to go out". Never posts. With a planned date ahead and the right to schedule it is
// scheduled for that date; otherwise it waits as approved. Free on every plan.
router.post('/:id/approve', protect, lifecycleRoute('approve', 'We could not approve this post. Please try again.'));
// Back to Needs approval (only from approved).
router.post('/:id/unapprove', protect, lifecycleRoute('unapprove', 'We could not change this post. Please try again.'));
// Scheduled back to approved; its campaign goes back to draft so the scheduler does not send it.
router.post('/:id/unschedule', protect, lifecycleRoute('unschedule', 'We could not unschedule this post. Please try again.'));
// Archive: out of the way, restorable any time. Posted items can be archived; scheduled ones must be unscheduled first.
router.post('/:id/archive', protect, lifecycleRoute('archive', 'We could not archive this post. Please try again.'));
// Restore from the Bin (within 14 days) or from Archived.
router.post('/:id/restore', protect, lifecycleRoute('restore', 'We could not restore this item. Please try again.'));

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

    // Reject is an archive (restorable any time) that also marks the calendar day rejected.
    const archived = await actions().archive(userId, req.params.id);
    if (archived.status !== 200) return send(res, archived);

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
router.post('/:id/regenerate', protect, L.heavyAi, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const draft = await Draft.findOne({ _id: req.params.id, userId });

    if (!draft) {
      return res.status(404).json({ success: false, message: 'Draft not found' });
    }

    if (draft.status === 'scheduled' || draft.status === 'binned') {
      return res.status(409).json({ success: false, message: draft.status === 'scheduled' ? postLifecycle.MSG.unscheduleFirst : postLifecycle.MSG.restoreFromBin });
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

    // Archive current draft (restorable, like any archive)
    draft.archivedFrom = String(draft.status || 'draft');
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
// Streamed to a temporary file (never a 120 MB buffer in memory); the handler removes it. Pictures are capped lower
// in the handler (MAX_UPLOAD_IMAGE_BYTES), because a picture is read into memory to be sent on.
const MAX_UPLOAD_IMAGE_BYTES = 20 * 1024 * 1024;
const mediaUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, require('os').tmpdir()),
    filename: (req, file, cb) => cb(null, `upload_${Date.now()}_${require('crypto').randomBytes(6).toString('hex')}`)
  }),
  limits: { fileSize: 120 * 1024 * 1024, files: 1 }, // 120MB — comfortably over a reel
  fileFilter: (req, file, cb) => {
    const ok = /^(image|video)\//i.test(file.mimetype || '');
    cb(ok ? null : new Error('Only image or video files are allowed'), ok);
  }
});

router.post('/upload-media', protect, L.upload, mediaUpload.single('file'), async (req, res) => {
  const fsp = require('fs').promises;
  let tempPath = '';
  try {
    const userId = req.user.userId || req.user.id;
    if (!req.file) return res.status(400).json({ success: false, message: 'No file received' });
    tempPath = req.file.path; // multer wrote it to a temporary file; removed in finally

    const { title, caption, platforms } = req.body || {};
    const isVideo = /^video\//i.test(req.file.mimetype);
    const { uploadBase64Image, uploadVideoFile } = require('../services/imageUploader');

    let mediaUrl = '';
    if (isVideo) {
      const up = await uploadVideoFile(tempPath, 'nebula-uploads');
      if (!up?.success || !up?.url) throw new Error(up?.error || 'Video upload failed');
      mediaUrl = up.url;
    } else {
      if (req.file.size > MAX_UPLOAD_IMAGE_BYTES) return res.status(413).json({ success: false, message: 'Please use a picture under 20 MB.' });
      const buffer = await fsp.readFile(tempPath);
      const dataUrl = `data:${req.file.mimetype};base64,${buffer.toString('base64')}`;
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
      origin: 'manual',
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
router.post('/:id/apply-logo', protect, L.lightAi, async (req, res) => {
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

// Text-only LinkedIn post generation — no image call. Mirrors
// generate-image-bg's credit-deduct/refund-on-failure shape, but meters
// as campaign_text (caption-only cost) since no image model runs here.
router.post('/generate-linkedin-post', protect, L.heavyAi, checkTrial, async (req, res) => {
  let creditsDeducted = false;
  try {
    const userId = req.user.userId || req.user.id;
    const { idea, contentPillar, objective, tone, language } = req.body;

    if (!String(idea || '').trim()) {
      return res.status(400).json({ success: false, message: 'Give it an idea or brief first.' });
    }

    const creditResult = await deductCredits(userId, 'campaign_text', 1, 'AI LinkedIn post generation');
    if (!creditResult.success) {
      return res.status(403).json({
        success: false,
        creditsExhausted: true,
        message: creditResult.error || `Insufficient Quarks. Need ${priceText(CREDIT_COSTS.campaign_text)} to generate a LinkedIn post.`
      });
    }
    creditsDeducted = true;

    const brandContextBlock = await buildBrandMemoryBlock(userId);
    const prompt = await buildPrompt(userId, 'linkedin.content', {
      idea: idea.trim(),
      contentPillar: contentPillar || '',
      objective: objective || '',
      tone: tone || '',
      language: normalizeLanguage(language || 'English'),
      brandContextBlock
    });

    const raw = await callTextLLM(prompt, { jsonMode: true, maxTokens: 2000 });
    const parsed = parseGeminiJSON(raw);

    if (!parsed?.caption) {
      throw new Error('Generation did not return a caption');
    }

    res.json({
      success: true,
      caption: parsed.caption,
      hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags : [],
      imageDescription: parsed.imageDescription || '',
      creditsRemaining: creditResult.creditsRemaining
    });
  } catch (error) {
    console.error('Generate LinkedIn post error:', error);
    if (creditsDeducted) {
      try {
        await refundCredits(req.user.userId || req.user.id, 'campaign_text', 1, 'Refund: LinkedIn post generation failed');
      } catch (refundErr) {
        console.error('⚠️ Failed to refund Quarks after LinkedIn post generation error:', refundErr.message);
      }
    }
    res.status(500).json({ success: false, message: 'Failed to generate LinkedIn post', error: error.message });
  }
});

// 10. POST /generate-image-bg - Create a draft immediately with status 'processing' and enqueue background image generation
router.post('/generate-image-bg', protect, L.heavyAi, checkTrial, async (req, res) => {
  // Declared out here, not inside the try: the catch block below needs to
  // read it to decide whether to refund, and a variable declared inside a
  // try is not visible in its own catch.
  let creditsDeducted = false;
  try {
    const userId = req.user.userId || req.user.id;
    const {
      type, title, caption, hashtags, prompt, aspectRatio, platforms, referenceImage,
      linkedProduct, productReferenceImages,
      // Context for the content-writing prompt — all optional, since a quick
      // one-line brief with none of this is the common case.
      contentPillar, contentType, campaignContext, objective, language,
      // What Create's logo picker/position grid actually chose — '' means
      // "No logo" was explicitly picked, distinct from omitting the field
      // entirely (which falls back to the brand's primary logo). See
      // backgroundQueue.js's `effectiveLogo` for how that distinction is used.
      logoUrl, logoPosition,
      // Design style, its text, and the saved header/footer chosen in Create
      postStyle, postDetails, headerUrl, footerUrl, theme, density
    } = req.body;
    const { isPostStyle, normalisePostDetails } = require('../config/postStyles');
    const httpsOnly = (u) => (typeof u === 'string' && /^https:\/\//i.test(u.trim()) ? u.trim() : undefined);

    // Single-post generation had no deduction at all — free, unlike every
    // other generation path in the app. The type:'campaign' branch here is
    // the older Campaigns.tsx page, which charges campaign_full through its
    // own flow already; only the post case is uncharged, so only it is
    // metered here.
    if (type !== 'campaign') {
      const creditResult = await deductCredits(userId, 'image_generated', 1, 'AI post generation');
      if (!creditResult.success) {
        return res.status(403).json({
          success: false,
          creditsExhausted: true,
          message: creditResult.error || `Insufficient Quarks. Need ${priceText(CREDIT_COSTS.image_generated)} to generate a post.`
        });
      }
      creditsDeducted = true;
    }

    const draft = new Draft({
      userId,
      title: title || 'Untitled Draft',
      caption: caption || '',
      hashtags: hashtags || [],
      platforms: platforms || [],
      imagePrompt: prompt || '',
      theme: String(theme || '').replace(/\s+/g, ' ').trim().slice(0, 60),
      status: 'processing',
      origin: 'manual',
      sourceType: type === 'campaign' ? 'campaign' : 'post',
      contentType: type === 'campaign' ? 'campaign' : 'post',
      language: language || 'English',
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
      referenceImage: referenceImage || null,
      contentPillar: contentPillar || '',
      contentType: contentType || (type === 'campaign' ? 'campaign' : 'post'),
      campaignContext: campaignContext || '',
      objective: objective || '',
      // Products chosen in Create. The linked one gives the model the name,
      // price and description; the image list is attached so each chosen item
      // actually appears rather than being described from memory.
      linkedProduct: linkedProduct || null,
      productReferenceImages: Array.isArray(productReferenceImages) ? productReferenceImages : [],
      // The language picked in Create for this specific generation, if any —
      // overrides the brand's stored default (see backgroundQueue.js).
      language: language || '',
      // Passed through EXACTLY as received — '' (explicit "No logo") must
      // stay distinct from undefined (field omitted entirely, meaning fall
      // back to the brand's primary logo). Coercing '' to undefined here
      // would silently ignore an explicit "No logo" choice.
      logoUrl,
      logoPosition: logoPosition || undefined,
      postStyle: isPostStyle(postStyle) && postStyle !== 'plain' ? postStyle : undefined,
      postDetails: postDetails ? normalisePostDetails(postDetails) : undefined,
      headerUrl: httpsOnly(headerUrl),
      footerUrl: httpsOnly(footerUrl),
      density: ['clean', 'balanced', 'rich'].includes(String(density)) ? String(density) : 'balanced'
    });

    res.status(201).json({ success: true, draftId: draft._id, draft });
  } catch (error) {
    console.error('Generate image bg error:', error);
    if (creditsDeducted) {
      try {
        await refundCredits(req.user.userId || req.user.id, 'image_generated', 1, 'Refund: post enqueuing failed');
      } catch (refundErr) {
        console.error('⚠️ Failed to refund Quarks after enqueuing error:', refundErr.message);
      }
    }
    res.status(500).json({ success: false, message: 'Failed to queue image generation', error: error.message });
  }
});

// 11. POST /:id/retry-image - Reset status to 'processing' and re-enqueue failed draft for image generation
router.post('/:id/retry-image', protect, L.heavyAi, async (req, res) => {
  // Declared out here, not inside the try: the catch block needs to read it
  // to decide whether to refund — same pattern as /generate-image-bg above.
  let creditsDeducted = false;
  let creditsRemaining;
  try {
    const userId = req.user.userId || req.user.id;
    const draft = await Draft.findOne({ _id: req.params.id, userId });

    if (!draft) {
      return res.status(404).json({ success: false, message: 'Draft not found' });
    }

    // Regenerate re-runs the exact same Creative Director + Art Director +
    // image-model pipeline as the original generation, so it costs us the
    // same real API spend — it must be metered the same way. This used to
    // be free (a real gap: every Regenerate click cost Nebulaa money with
    // nothing charged to the account). Mirrors /generate-image-bg's own
    // rule: campaign-type drafts are charged through the legacy Campaigns
    // flow already, so only the non-campaign case is metered here.
    if (draft.contentType !== 'campaign') {
      const creditResult = await deductCredits(userId, 'image_generated', 1, 'Regenerate post image');
      if (!creditResult.success) {
        return res.status(403).json({
          success: false,
          creditsExhausted: true,
          message: creditResult.error || `Insufficient Quarks. Need ${priceText(CREDIT_COSTS.image_generated)} to regenerate.`
        });
      }
      creditsDeducted = true;
      creditsRemaining = creditResult.creditsRemaining;
    }

    // Optional: regenerate with THIS exact prompt instead of a fresh
    // Creative Director decision. The draft's own imagePromptResolved is
    // what the UI shows and lets someone edit — round-tripped back here
    // when they want to try their edit rather than roll the dice again.
    const promptOverride = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';

    draft.status = 'processing';
    draft.errorMessage = '';
    await draft.save();

    const backgroundQueue = require('../services/backgroundQueue');
    backgroundQueue.enqueue({
      type: draft.contentType === 'campaign' ? 'generate_campaign_image' : 'generate_post_image',
      draftId: draft._id,
      aspectRatio: '1:1',
      promptOverride: promptOverride || undefined
    });

    res.status(200).json({ success: true, message: 'Requeued draft for image generation', draft, creditsRemaining });
  } catch (error) {
    console.error('Retry image generation error:', error);
    if (creditsDeducted) {
      try {
        await refundCredits(req.user.userId || req.user.id, 'image_generated', 1, 'Refund: regenerate failed to enqueue');
      } catch (refundErr) {
        console.error('⚠️ Failed to refund Quarks after retry-image error:', refundErr.message);
      }
    }
    res.status(500).json({ success: false, message: 'Failed to retry image generation', error: error.message });
  }
});

// 11b. POST /:id/edit-image - Apply a targeted edit to the EXISTING image
// (keep everything, change only what the instruction asks for), instead of
// regenerating the whole thing from a prompt.
router.post('/:id/edit-image', protect, L.heavyAi, checkTrial, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const draft = await Draft.findOne({ _id: req.params.id, userId });

    if (!draft) {
      return res.status(404).json({ success: false, message: 'Draft not found' });
    }
    if (!draft.imageUrl) {
      return res.status(400).json({ success: false, message: 'This draft has no image yet to edit' });
    }

    const instruction = typeof req.body?.instruction === 'string' ? req.body.instruction.trim() : '';
    if (!instruction) {
      return res.status(400).json({ success: false, message: 'Describe the change you want' });
    }

    const creditResult = await deductCredits(userId, 'image_edit', 1, 'Edit image');
    if (!creditResult.success) {
      return res.status(403).json({ success: false, message: creditResult.error || 'Insufficient Quarks', creditsRemaining: creditResult.creditsRemaining });
    }

    const { refineImageWithPrompt } = require('../services/geminiAI');
    const bp = req.user.businessProfile || {};
    const contextPrompt = draft.imagePromptResolved || draft.imagePrompt || draft.caption || 'marketing image';

    const result = await refineImageWithPrompt(contextPrompt, instruction, bp.tone || 'professional', draft.imageUrl);

    if (!result.success || !result.imageUrl) {
      await refundCredits(userId, 'image_edit', 1, 'Refund: edit-image failed');
      return res.status(500).json({ success: false, message: result.error || 'Could not apply that edit' });
    }

    draft.imageUrl = result.imageUrl;
    draft.imagePromptResolved = `${contextPrompt}\n\nEdit applied: ${instruction}`;
    await draft.save();

    res.status(200).json({ success: true, draft, creditsRemaining: creditResult.creditsRemaining });
  } catch (error) {
    console.error('Edit image error:', error);
    res.status(500).json({ success: false, message: 'Failed to edit image', error: error.message });
  }
});

module.exports = router;
