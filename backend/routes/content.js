const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { generateImageFromCustomPrompt, refineImageWithPrompt } = require('../services/geminiAI');
const { uploadBase64Image } = require('../services/imageUploader');
const { deductCredits } = require('../middleware/trialGuard');
const { ensureCreditCycle } = require('../middleware/creditGuard');
const User = require('../models/User');

/**
 * @route   POST /api/content/regenerate-image
 * @desc    Refine/edit an existing image using Nano Banana 2
 * @access  Private
 */
router.post('/regenerate-image', protect, async (req, res) => {
  try {
    const { prompt, style, campaignId, industry, platform, currentImageUrl } = req.body;

    if (!prompt) {
      return res.status(400).json({ success: false, error: 'Prompt is required' });
    }

    // Credit check (3 for image refinement)
    const user = await User.findById(req.user.userId || req.user.id);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    await ensureCreditCycle(user);
    if (user.credits.balance < 3) {
      return res.status(403).json({ success: false, error: 'Insufficient credits', creditsRemaining: user.credits.balance, required: 3 });
    }

    const { originalImagePrompt, caption } = req.body;

    console.log(`🎨 Refine image request - prompt: "${prompt.substring(0, 80)}...", platform: ${platform || 'instagram'}`);

    const contextPrompt = originalImagePrompt || caption || 'marketing image';

    // Use refineImageWithPrompt (Nano Banana 2) for editing
    const result = await refineImageWithPrompt(contextPrompt, prompt, style || 'professional', currentImageUrl);

    if (!result.success || !result.imageUrl) {
      return res.status(500).json({ success: false, error: result.error || 'Failed to refine image' });
    }

    // Deduct 3 credits for image refinement
    const creditResult = await deductCredits(user._id, 'refine_image', 1, 'Refine image with AI');

    res.json({
      success: true,
      imageUrl: result.imageUrl,
      prompt,
      creditsRemaining: creditResult.creditsRemaining
    });
  } catch (error) {
    console.error('❌ Refine image error:', error.message);
    res.status(500).json({ success: false, error: error.message || 'Failed to refine image' });
  }
});

/**
 * @route   POST /api/content/generate
 * @desc    Generate content (caption, hashtags, etc.) for a given topic/platform
 * @access  Private
 */
router.post('/generate', protect, async (req, res) => {
  try {
    const { type, platform, topic, tone, keywords } = req.body;

    if (!topic) {
      return res.status(400).json({ success: false, error: 'Topic is required' });
    }

    // Placeholder — wire up to a dedicated content generation function if needed
    res.json({
      success: true,
      message: 'Content generation endpoint — not yet implemented',
      params: { type, platform, topic, tone, keywords }
    });
  } catch (error) {
    console.error('Content generate error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * @route   POST /api/content/modify
 * @desc    Modify existing content draft
 * @access  Private
 */
router.post('/modify', protect, async (req, res) => {
  try {
    const { draftId, modifications } = req.body;

    // Placeholder — wire up to a content modification function if needed
    res.json({
      success: true,
      message: 'Content modification endpoint — not yet implemented',
      params: { draftId, modifications }
    });
  } catch (error) {
    console.error('Content modify error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * @route   POST /api/content/:draftId/compliance-check
 * @desc    Check content draft for compliance issues
 * @access  Private
 */
router.post('/:draftId/compliance-check', protect, async (req, res) => {
  try {
    const { draftId } = req.params;

    // Placeholder — wire up to a compliance checking function if needed
    res.json({
      success: true,
      compliant: true,
      issues: [],
      draftId
    });
  } catch (error) {
    console.error('Compliance check error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
