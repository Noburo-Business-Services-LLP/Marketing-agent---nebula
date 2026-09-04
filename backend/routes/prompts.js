const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const PromptOverride = require('../models/PromptOverride');
const { listPrompts, getPrompt } = require('../services/promptRegistry');

/**
 * Read and edit the prompts that drive generation.
 *
 * Every response carries the shipped default alongside the user's edit, so the
 * UI can show what changed and offer a reset without a second request.
 */

// GET /api/prompts
router.get('/', protect, async (req, res) => {
  try {
    const overrides = await PromptOverride.find({ user: req.user.id }).lean();
    const byId = new Map(overrides.map((o) => [o.promptId, o]));

    const prompts = listPrompts().map((p) => {
      const override = byId.get(p.id);
      return {
        ...p,
        template: override?.template || p.defaultTemplate,
        isEdited: Boolean(override),
        updatedAt: override?.updatedAt || null
      };
    });

    res.json({ success: true, prompts });
  } catch (error) {
    console.error('Get prompts error:', error);
    res.status(500).json({ success: false, message: 'Could not load your prompts.' });
  }
});

// PUT /api/prompts/:id
router.put('/:id', protect, async (req, res) => {
  try {
    const prompt = getPrompt(req.params.id);
    if (!prompt) {
      return res.status(404).json({ success: false, message: 'No such prompt.' });
    }

    const template = String(req.body?.template || '');
    if (!template.trim()) {
      return res.status(400).json({ success: false, message: 'A prompt cannot be empty. Reset it instead.' });
    }
    if (template.length > 20000) {
      return res.status(400).json({ success: false, message: 'That prompt is too long (20,000 characters max).' });
    }

    // Saving the shipped text verbatim is a reset, not an edit — otherwise the
    // prompt would read as "edited" forever and never pick up a future default.
    if (template.trim() === prompt.template.trim()) {
      await PromptOverride.deleteOne({ user: req.user.id, promptId: req.params.id });
      return res.json({ success: true, template: prompt.template, isEdited: false });
    }

    const saved = await PromptOverride.findOneAndUpdate(
      { user: req.user.id, promptId: req.params.id },
      { user: req.user.id, promptId: req.params.id, template, updatedAt: Date.now() },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    res.json({ success: true, template: saved.template, isEdited: true, updatedAt: saved.updatedAt });
  } catch (error) {
    console.error('Save prompt error:', error);
    res.status(500).json({ success: false, message: 'Could not save that prompt.' });
  }
});

// DELETE /api/prompts/:id — back to the shipped default
router.delete('/:id', protect, async (req, res) => {
  try {
    const prompt = getPrompt(req.params.id);
    if (!prompt) {
      return res.status(404).json({ success: false, message: 'No such prompt.' });
    }
    await PromptOverride.deleteOne({ user: req.user.id, promptId: req.params.id });
    res.json({ success: true, template: prompt.template, isEdited: false });
  } catch (error) {
    console.error('Reset prompt error:', error);
    res.status(500).json({ success: false, message: 'Could not reset that prompt.' });
  }
});

module.exports = router;
