// GET /api/home/summary: one small answer for the Home page (numbers, "Do this next", this week, plan status, balance,
// account kind). The account is always the signed-in one (inside an agency or CSM pass req.user already is the client).
// Reads only. Cached for 60 seconds per account; ?refresh=1 skips the cache. See docs/superpowers/ops/home-summary.md
const express = require('express');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = rateLimit;
const { protect } = require('../middleware/auth');
const { createSummaryCache } = require('../services/homeSummaryCache');

const toUserId = (user) => (!user ? null : user._id ? String(user._id) : user.id ? String(user.id) : null);
const GENERIC_ERROR = 'We could not load your home page numbers. Please try again.';
const keyGenerator = (req) => String(req.user?._id || req.user?.id || ipKeyGenerator(req.ip));
const readLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 600, standardHeaders: true, legacyHeaders: false, keyGenerator,
  message: { success: false, message: 'You have sent too many requests. Please try again in a few minutes.' }
});

const sharedCache = createSummaryCache();

/** Middleware: after a write that succeeded, forget the signed-in account's cached summary. */
function invalidateOnWrite(cache = sharedCache) {
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
      res.on('finish', () => {
        try {
          const id = toUserId(req.user);
          if (id && res.statusCode >= 200 && res.statusCode < 400) cache.invalidate(id);
        } catch (_) { /* never let the cache break a request */ }
      });
    }
    next();
  };
}

function createHomeRouter(impl = {}) {
  const router = express.Router();
  const cache = impl.cache || sharedCache;
  let service = impl.service || null;
  const getService = () => (service = service || require('../services/homeSummary').createHomeSummary());

  router.get('/summary', protect, readLimiter, async (req, res) => {
    try {
      const userId = toUserId(req.user);
      if (!userId) return res.status(401).json({ success: false, message: 'Please sign in to continue.' });
      const pass = Boolean(req.actingCsm || req.actingAgency);
      const key = `${userId}:${pass ? 1 : 0}`;
      const refresh = String((req.query && req.query.refresh) || '') === '1';
      res.set('Cache-Control', 'private, no-store');
      if (!refresh) {
        const hit = cache.get(key);
        if (hit) return res.json({ success: true, ...hit, cached: true });
      }
      const body = await getService().build({ user: req.user, pass });
      // Only an answer that loaded completely is kept, so a failed block is tried again on the next visit.
      if (!body.degraded || body.degraded.length === 0) cache.set(key, body);
      return res.json({ success: true, ...body, cached: false });
    } catch (err) {
      console.error('[home] summary error:', err && err.message);
      return res.status(500).json({ success: false, message: GENERIC_ERROR });
    }
  });
  return router;
}

const router = createHomeRouter();
router.createHomeRouter = createHomeRouter;
router.invalidateOnWrite = invalidateOnWrite;
router.watch = invalidateOnWrite(sharedCache);
router.cache = sharedCache;
module.exports = router;
