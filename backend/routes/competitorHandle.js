// PUT /api/competitors/:id/handle: the customer confirms or corrects a competitor's Instagram handle. Until a handle is
// confirmed (or verified by our own profile check) the weekly tracker never reads it. Confirming also clears a pause, so a
// competitor that stopped working is not a dead end. Entitled accounts only, the owner's own competitor only.
const express = require('express');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = rateLimit;
const { protect } = require('../middleware/auth');
const { requireFeature } = require('../middleware/requireFeature');
const { isValidHandle } = require('../services/competitors/tracked');

const GENERIC_ERROR = 'We could not complete that request. Please try again.';
const BAD_HANDLE = 'That does not look like an Instagram handle. Use letters, numbers, dots and underscores, up to 30 characters.';
const keyGenerator = (req) => String(req.user?._id || req.user?.id || req.user?.userId || ipKeyGenerator(req.ip));
const handleLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, keyGenerator,
  message: { success: false, message: 'You have sent too many requests. Please try again in a few minutes.' }
});

function createHandleRouter(impl = {}) {
  const router = express.Router();
  const Competitor = () => impl.Competitor || require('../models/Competitor');
  const gate = requireFeature('competitors', impl.loadUser ? { loadUser: impl.loadUser } : {});

  const handler = async (req, res) => {
    try {
      const userId = req.user && (req.user.userId || req.user.id || req.user._id);
      if (!userId) return res.status(401).json({ success: false, message: 'Please sign in to continue.' });
      const id = String(req.params.id || '');
      if (!mongoose.Types.ObjectId.isValid(id)) return res.status(404).json({ success: false, message: 'Competitor not found' });

      const raw = req.body && req.body.handle;
      const handle = typeof raw === 'string' ? raw.trim().replace(/^@/, '') : '';
      if (!isValidHandle(handle)) return res.status(400).json({ success: false, message: BAD_HANDLE });

      const competitor = await Competitor().findOne({ _id: id, userId });
      if (!competitor) return res.status(404).json({ success: false, message: 'Competitor not found' });

      await Competitor().updateOne({ _id: id, userId }, {
        $set: {
          'socialHandles.instagram': handle,
          handleStatus: 'confirmed',
          'tracking.failures': 0,
          'tracking.pausedAt': null,
          'tracking.lastCheckedAt': null // read again at the next pass (the daily caps still apply)
        }
      });
      return res.json({ success: true, competitor: { id, name: competitor.name, handle, handleStatus: 'confirmed' } });
    } catch (err) {
      console.error('[competitor-handle] route error:', err && err.message);
      return res.status(500).json({ success: false, message: GENERIC_ERROR });
    }
  };
  router.put('/:id/handle', protect, handleLimiter, gate, handler);
  return router;
}

module.exports = { createHandleRouter, handleLimiter };
