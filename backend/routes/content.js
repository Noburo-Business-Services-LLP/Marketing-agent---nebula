const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { generateImageFromCustomPrompt, refineImageWithPrompt } = require('../services/geminiAI');
const { uploadBase64Image } = require('../services/imageUploader');
const { deductCredits, ensureCreditCycle } = require('../middleware/creditGuard');
const User = require('../models/User');

/**
 * @route   POST /api/content/regenerate-image
 * @desc    Generate a new image from a custom prompt using Vertex AI Imagen
 * @access  Private
 */
router.post('/regenerate-image', protect, async (req, res) => {
  try {
    const { prompt, style, campaignId, industry, platform } = req.body;

    if (!prompt) {
      return res.status(400).json({ success: false, error: 'Prompt is required' });
    }

    // Credit check (5 for image generation)
    const user = await User.findById(req.user.userId || req.user.id);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    await ensureCreditCycle(user);
    if (user.credits.balance < 5) {
      return res.status(403).json({ success: false, error: 'Insufficient credits', creditsRemaining: user.credits.balance, required: 5 });
    }

    const { originalImagePrompt, caption } = req.body;

    console.log(`🎨 Regenerate image request - prompt: "${prompt.substring(0, 80)}...", platform: ${platform || 'instagram'}`);

    // Build a context-aware prompt that keeps the image relevant to the original
    let effectivePrompt;
    if (originalImagePrompt) {
      // Best case: we have the original image description, refine it
      effectivePrompt = `${originalImagePrompt}. REFINEMENT: ${prompt}. Keep the same subject matter and scene but apply the refinement.`;
    } else if (caption) {
      // Fallback: use the post caption as context
      effectivePrompt = `Create an image for this social media post: "${caption.substring(0, 300)}". Style/modification: ${prompt}. The image must be directly relevant to the post content.`;
    } else {
      effectivePrompt = prompt;
    }

    // Generate image from the prompt
    const imageResult = await generateImageFromCustomPrompt(effectivePrompt, platform || 'instagram');

    if (!imageResult) {
      return res.status(500).json({ success: false, error: 'Failed to generate image' });
    }

    // If the result is a base64 data URL, upload to Cloudinary for a permanent URL
    let finalUrl = imageResult;
    if (imageResult.startsWith('data:')) {
      const uploadResult = await uploadBase64Image(imageResult, 'nebula-content');
      if (uploadResult.success) {
        finalUrl = uploadResult.url;
        console.log('✅ Regenerated image uploaded to Cloudinary:', finalUrl);
      } else {
        console.warn('⚠️ Cloudinary upload failed, returning base64 image');
      }
    }

    // Deduct 5 credits for image generation
    const creditResult = await deductCredits(user._id, 5, 'regenerate_image');

    res.json({
      success: true,
      imageUrl: finalUrl,
      prompt,
      creditsRemaining: creditResult.balance
    });
  } catch (error) {
    console.error('❌ Regenerate image error:', error.message);
    res.status(500).json({ success: false, error: error.message || 'Failed to regenerate image' });
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
