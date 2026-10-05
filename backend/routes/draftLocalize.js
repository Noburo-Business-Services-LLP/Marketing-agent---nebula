// POST /api/drafts/:id/localize - make extra-language versions of one of the user's own drafts.
// Each language becomes a separate new draft that needs approval; nothing is published and no
// Quarks are taken (the existing localisation has no price). Kept in its own small router so it can
// be tested without loading the whole drafts router. Mounted on /api/drafts in server-main.js.
const express = require('express');
const rateLimit = require('express-rate-limit');
const { protect } = require('../middleware/auth');
const Draft = require('../models/Draft');
const User = require('../models/User');
const { createDraftLocalizer } = require('../services/draftLocalization');

const router = express.Router();

const localizeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'You have sent too many requests. Please try again in a few minutes.' },
  keyGenerator: (req) => String(req.user?._id || req.user?.id || rateLimit.ipKeyGenerator(req.ip))
});

// Loaded on first use; tests replace it so no AI call is ever made.
router.localizeDeps = {
  localize: (payload) => require('../services/geminiAI').localizeCampaignContent(payload)
};

router.post('/:id/localize', protect, localizeLimiter, async (req, res) => {
  try {
    const localizeDraft = createDraftLocalizer({ Draft, User, localize: (p) => router.localizeDeps.localize(p) });
    const out = await localizeDraft({
      userId: req.user.userId || req.user.id || req.user._id,
      draftId: req.params.id,
      languages: req.body && req.body.languages
    });
    return res.status(out.status).json(out.json);
  } catch (error) {
    console.error('Localize draft error:', error.message);
    return res.status(500).json({ success: false, message: 'We could not create the language versions. Please try again.' });
  }
});

module.exports = router;
