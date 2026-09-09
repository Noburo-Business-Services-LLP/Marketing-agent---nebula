const express = require('express');
const router = express.Router();

const { protect } = require('../middleware/auth');
const AIBrandMemory = require('../models/AIBrandMemory');
const AICampaignHistory = require('../models/AICampaignHistory');
const AIVideoMemory = require('../models/AIVideoMemory');
const AIContentPerformance = require('../models/AIContentPerformance');
const { buildAIContext } = require('../services/aiContextBuilder');
const { resolveOrganizationId } = require('../services/aiMemoryService');
const { distillMemoryForUser } = require('../services/memoryDistillation');

function userIdFromReq(req) {
  return req.user.userId || req.user.id || req.user._id;
}

router.get('/summary', protect, async (req, res) => {
  try {
    const userId = userIdFromReq(req);
    const organizationId = resolveOrganizationId({ user: req.user, userId });
    const [brandMemory, campaignCount, videoCount, performanceCount, winners, recentCampaigns, recentVideos] = await Promise.all([
      AIBrandMemory.findOne({ organizationId, userId }).lean(),
      AICampaignHistory.countDocuments({ organizationId, userId }),
      AIVideoMemory.countDocuments({ organizationId, userId }),
      AIContentPerformance.countDocuments({ organizationId, userId }),
      AIContentPerformance.find({ organizationId, userId })
        .sort({ 'learning.score': -1, measuredAt: -1 })
        .limit(8)
        .lean(),
      AICampaignHistory.find({ organizationId, userId })
        .sort({ createdAt: -1 })
        .limit(8)
        .lean(),
      AIVideoMemory.find({ organizationId, userId })
        .sort({ createdAt: -1 })
        .limit(8)
        .lean()
    ]);

    const context = await buildAIContext({
      userId,
      user: req.user,
      organizationId,
      platform: req.query.platform || ''
    });

    res.json({
      success: true,
      summary: {
        campaignMemories: campaignCount,
        videoMemories: videoCount,
        performanceMemories: performanceCount,
        brandTone: context.brandTone,
        writingStyle: context.writingStyle,
        ctaStyle: context.ctaStyle,
        visualStyle: context.visualStyle,
        bestHashtags: context.bestHashtags,
        bestCTAs: context.bestCTAs,
        bestSceneStyles: context.bestSceneStyles,
        embeddingReady: context.embeddingReady
      },
      brandMemory,
      winners,
      recentCampaigns,
      recentVideos,
      reusableContext: context.reusablePromptText
    });
  } catch (error) {
    console.error('AI memory summary error:', error);
    res.status(500).json({ success: false, message: 'Failed to load AI memory', error: error.message });
  }
});

router.get('/campaign-history', protect, async (req, res) => {
  try {
    const userId = userIdFromReq(req);
    const organizationId = resolveOrganizationId({ user: req.user, userId });
    const { platform, action, limit = 50 } = req.query;
    const query = { organizationId, userId };
    if (platform) query.$or = [{ platform }, { platforms: platform }];
    if (action) query.action = action;
    const items = await AICampaignHistory.find(query)
      .sort({ createdAt: -1 })
      .limit(Math.min(Number(limit) || 50, 100))
      .lean();
    res.json({ success: true, items });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to load campaign history', error: error.message });
  }
});

router.get('/video-history', protect, async (req, res) => {
  try {
    const userId = userIdFromReq(req);
    const organizationId = resolveOrganizationId({ user: req.user, userId });
    const { action, limit = 50 } = req.query;
    const query = { organizationId, userId };
    if (action) query.action = action;
    const items = await AIVideoMemory.find(query)
      .sort({ createdAt: -1 })
      .limit(Math.min(Number(limit) || 50, 100))
      .lean();
    res.json({ success: true, items });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to load video history', error: error.message });
  }
});

router.get('/performance', protect, async (req, res) => {
  try {
    const userId = userIdFromReq(req);
    const organizationId = resolveOrganizationId({ user: req.user, userId });
    const { platform, limit = 50 } = req.query;
    const query = { organizationId, userId };
    if (platform) query.platform = platform;
    const items = await AIContentPerformance.find(query)
      .sort({ 'learning.score': -1, measuredAt: -1 })
      .limit(Math.min(Number(limit) || 50, 100))
      .lean();
    res.json({ success: true, items });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to load performance memory', error: error.message });
  }
});

router.post('/reuse/:type/:id', protect, async (req, res) => {
  try {
    const userId = userIdFromReq(req);
    const organizationId = resolveOrganizationId({ user: req.user, userId });
    const Model = req.params.type === 'video' ? AIVideoMemory : AICampaignHistory;
    const item = await Model.findOneAndUpdate(
      { _id: req.params.id, organizationId, userId },
      {
        $inc: { 'reusableMetadata.reuseCount': 1 },
        $set: { 'reusableMetadata.lastReusedAt': new Date() }
      },
      { new: true }
    ).lean();

    if (!item) {
      return res.status(404).json({ success: false, message: 'Memory item not found' });
    }

    res.json({
      success: true,
      prompt: item.prompt || item.generatedCaptions?.[0] || item.script || '',
      item
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to reuse memory item', error: error.message });
  }
});

router.patch('/notes/:noteId', protect, async (req, res) => {
  try {
    const userId = userIdFromReq(req);
    const organizationId = resolveOrganizationId({ user: req.user, userId });
    const { text, category } = req.body || {};

    const setFields = {};
    if (typeof text === 'string' && text.trim()) {
      setFields['learnedNotes.$.text'] = text.trim();
      // A human deliberately edited this note's text — mark it so the
      // distillation job preserves it verbatim on the next run instead of
      // silently rewording or dropping it.
      setFields['learnedNotes.$.userEdited'] = true;
    }
    if (['copy', 'hashtags', 'cta', 'visual', 'timing', 'format'].includes(category)) {
      setFields['learnedNotes.$.category'] = category;
    }
    if (!Object.keys(setFields).length) {
      return res.status(400).json({ success: false, message: 'Nothing to update' });
    }
    setFields['learnedNotes.$.updatedAt'] = new Date();

    const updated = await AIBrandMemory.findOneAndUpdate(
      { organizationId, userId, 'learnedNotes._id': req.params.noteId },
      { $set: setFields },
      { new: true }
    ).lean();

    if (!updated) {
      return res.status(404).json({ success: false, message: 'Note not found' });
    }
    const note = updated.learnedNotes.find((n) => String(n._id) === req.params.noteId);
    res.json({ success: true, note });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update note', error: error.message });
  }
});

router.delete('/notes/:noteId', protect, async (req, res) => {
  try {
    const userId = userIdFromReq(req);
    const organizationId = resolveOrganizationId({ user: req.user, userId });
    const updated = await AIBrandMemory.findOneAndUpdate(
      { organizationId, userId },
      { $pull: { learnedNotes: { _id: req.params.noteId } } },
      { new: true }
    ).lean();
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Memory not found' });
    }
    res.json({ success: true, learnedNotes: updated.learnedNotes || [] });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to delete note', error: error.message });
  }
});

router.post('/distill', protect, async (req, res) => {
  try {
    const userId = userIdFromReq(req);
    const organizationId = resolveOrganizationId({ user: req.user, userId });
    const notes = await distillMemoryForUser(userId, organizationId);
    if (notes === null) {
      const existing = await AIBrandMemory.findOne({ organizationId, userId }).select('learnedNotes learnedNotesUpdatedAt').lean();
      return res.json({
        success: true,
        skipped: true,
        message: 'No new performance data since the last update.',
        learnedNotes: existing?.learnedNotes || [],
        learnedNotesUpdatedAt: existing?.learnedNotesUpdatedAt || null
      });
    }
    res.json({ success: true, skipped: false, learnedNotes: notes });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to refresh memory', error: error.message });
  }
});

module.exports = router;
