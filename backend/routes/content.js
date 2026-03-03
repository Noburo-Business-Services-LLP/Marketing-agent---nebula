const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { generateImageFromCustomPrompt, refineImageWithPrompt } = require('../services/geminiAI');
const { uploadBase64Image } = require('../services/imageUploader');

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

    console.log(`🎨 Regenerate image request - prompt: "${prompt.substring(0, 80)}...", platform: ${platform || 'instagram'}`);

    // Generate image from the custom prompt
    const imageResult = await generateImageFromCustomPrompt(prompt, platform || 'instagram');

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

    res.json({
      success: true,
      imageUrl: finalUrl,
      prompt
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
