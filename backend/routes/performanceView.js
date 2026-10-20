// GET /api/analytics/performance?range=week|month|90d&platform=instagram: the Performance page in one answer (overall
// numbers, one block per platform, top posts, formats, best day and time, findings). The account is always the signed-in
// one (inside an agency or CSM pass req.user already is the client); an id in the request is ignored. Reads only.
// Cached for 60 seconds per account, look, range and platform; ?refresh=1 skips the cache. See docs/superpowers/ops/performance-view.md
const express = require('express');
const rateLimit = require('../services/rateLimitStore').rateLimit;
const { ipKeyGenerator } = rateLimit;
const { protect } = require('../middleware/auth');
const { sharedCache } = require('../services/performance/cache');
const M = require('../services/performance/metrics');

const toUserId = (user) => (!user ? null : user._id ? String(user._id) : user.id ? String(user.id) : null);
const GENERIC_ERROR = 'We could not load your performance numbers. Please try again.';
const keyGenerator = (req) => String(req.user?._id || req.user?.id || ipKeyGenerator(req.ip));
const readLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 600, standardHeaders: true, legacyHeaders: false, keyGenerator,
  message: { success: false, message: 'You have sent too many requests. Please try again in a few minutes.' }
});

function createPerformanceRouter(impl = {}) {
  const router = express.Router();
  const cache = impl.cache || sharedCache();
  let service = impl.service || null;
  const getService = () => (service = service || require('../services/performance/service').createPerformanceService());

  router.get('/performance', protect, readLimiter, async (req, res) => {
    try {
      const userId = toUserId(req.user);
      if (!userId) return res.status(401).json({ success: false, message: 'Please sign in to continue.' });
      const q = req.query || {};
      const range = M.rangeKey(q.range);
      const asked = M.normPlatform(q.platform);
      if (asked && !M.isKnownPlatform(asked)) return res.status(400).json({ success: false, message: 'That platform is not one we show.' });
      const pass = Boolean(req.actingCsm || req.actingAgency);
      const key = `${userId}:${pass ? 1 : 0}:${range}:${asked || 'all'}`;
      res.set('Cache-Control', 'private, no-store');
      if (String(q.refresh || '') !== '1') {
        const hit = cache.get(key);
        if (hit) return res.json({ success: true, ...hit, cached: true });
      }
      const body = await getService().build({ user: req.user, range, platform: asked });
      if (!body.degraded || body.degraded.length === 0) cache.set(key, body);
      return res.json({ success: true, ...body, cached: false });
    } catch (err) {
      console.error('[performance] view error:', err && err.message);
      return res.status(500).json({ success: false, message: GENERIC_ERROR });
    }
  });
  return router;
}

const router = createPerformanceRouter();
router.createPerformanceRouter = createPerformanceRouter;
module.exports = router;
