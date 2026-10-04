// Brand Growth Blueprint routes (/api/blueprint). Every route needs a signed-in user. The tier, user id and price are
// always read on the server; nothing the client sends can set them.
const express = require('express');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = rateLimit;
const { protect } = require('../middleware/auth');
const { requireFeature } = require('../middleware/requireFeature');
const { checkTrial, requireCredits } = require('../middleware/trialGuard');
const { resolveTier } = require('../config/entitlements');

const toUserId = (user) => (!user ? null : user._id ? String(user._id) : user.id ? String(user.id) : null);
const GENERIC_ERROR = 'We could not complete that request. Please try again.';

const keyGenerator = (req) => String(req.user?._id || req.user?.id || ipKeyGenerator(req.ip));
const makeLimiter = (max, message) => rateLimit({ windowMs: 15 * 60 * 1000, max, standardHeaders: true, legacyHeaders: false, message: { success: false, message }, keyGenerator });
const writeLimiter = makeLimiter(20, 'You have sent too many requests. Please try again in a few minutes.');
const readLimiter = makeLimiter(600, 'You have sent too many requests. Please try again in a few minutes.');

function createBlueprintRouter(impl = {}) {
  const router = express.Router();
  let service = impl.service || null;
  const getService = () => (service = service || require('../services/blueprint/service').createBlueprintService());

  // Wraps a handler: 401 without a user id, generic 500 (never any error text) otherwise.
  const handle = (fn) => async (req, res) => {
    try {
      const userId = toUserId(req.user);
      if (!userId) return res.status(401).json({ success: false, message: 'Please sign in to continue.' });
      const out = await fn(getService(), req, userId);
      return res.status(out.status).json(out.json);
    } catch (err) {
      console.error('[blueprint] route error:', err && err.message);
      return res.status(500).json({ success: false, message: GENERIC_ERROR });
    }
  };

  router.post('/', protect, requireFeature('blueprint'), checkTrial, requireCredits('blueprint', 1), writeLimiter,
    handle((svc, req) => svc.start({ user: req.user, tier: resolveTier(req.user), body: req.body || {}, ip: req.ip })));
  router.get('/', protect, readLimiter, handle((svc, req, userId) => svc.list({ userId })));
  router.get('/:id', protect, readLimiter, handle((svc, req, userId) => svc.get({ userId, id: req.params.id })));
  router.post('/:id/continue', protect, writeLimiter,
    handle((svc, req, userId) => svc.continueRun({ userId, id: req.params.id, body: req.body || {} })));

  return router;
}

const router = createBlueprintRouter();
router.createBlueprintRouter = createBlueprintRouter;
module.exports = router;
