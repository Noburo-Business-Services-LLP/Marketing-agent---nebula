// "What Nebulaa learned", per source (mounted on /api/ai-memory beside routes/aiMemory.js):
//   GET    /learned               the memory by source (refreshes first when nothing was learned yet or a source changed)
//   POST   /learned/refresh       Refresh now: one at a time per account, then a 10-minute cooldown (429 with the time left)
//   PATCH  /learned/:key          edit an item's words (kept on every refresh)
//   DELETE /learned/:key          delete an item (it never comes back)
// The account is always the signed-in one (inside an agency or CSM pass req.user already is the client). No model call,
// no provider call, nothing charged. See docs/superpowers/ops/brand-memory.md.
const express = require('express');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = rateLimit;
const { protect } = require('../middleware/auth');

const KEY_RE = /^[a-z0-9-]{1,80}$/;
const idOf = (user) => (!user ? null : user._id ? String(user._id) : user.id ? String(user.id) : null);
const keyGenerator = (req) => String(req.user?._id || req.user?.id || ipKeyGenerator(req.ip));
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false, keyGenerator,
  message: { success: false, message: 'You have sent too many requests. Please try again in a few minutes.' }
});

const minutesWords = (ms) => { const m = Math.max(1, Math.ceil(ms / 60000)); return `${m} ${m === 1 ? 'minute' : 'minutes'}`; };

function createLearnedRouter(impl = {}) {
  const router = express.Router();
  let memory = impl.memory || null;
  const svc = () => (memory = memory || require('../services/brandMemory/runner').sharedMemory());

  router.get('/learned', protect, limiter, async (req, res) => {
    try {
      const userId = idOf(req.user);
      if (!userId) return res.status(401).json({ success: false, message: 'Please sign in to continue.' });
      res.set('Cache-Control', 'private, no-store');
      const view = await svc().getView(userId);
      return res.json({ success: true, ...view });
    } catch (err) {
      console.error('[brand memory] view error:', err && err.message);
      return res.status(500).json({ success: false, message: 'We could not load what Nebulaa learned. Please try again.' });
    }
  });

  router.post('/learned/refresh', protect, limiter, async (req, res) => {
    try {
      const userId = idOf(req.user);
      if (!userId) return res.status(401).json({ success: false, message: 'Please sign in to continue.' });
      const r = await svc().refreshAccount(userId, { manual: true });
      if (!r.ok) {
        if (r.reason === 'staff') return res.status(403).json({ success: false, message: 'Staff accounts have no memory of their own.' });
        if (r.reason === 'cooldown') {
          res.set('Retry-After', String(Math.ceil(r.retryAfterMs / 1000)));
          return res.status(429).json({ success: false, reason: 'cooldown', retryAfterSeconds: Math.ceil(r.retryAfterMs / 1000), message: `Nebulaa looked a few minutes ago. You can refresh again in ${minutesWords(r.retryAfterMs)}.` });
        }
        if (r.reason === 'busy') return res.status(409).json({ success: false, reason: 'busy', message: 'Nebulaa is already looking. Please wait a moment.' });
        if (r.reason === 'no_user') return res.status(404).json({ success: false, message: 'We could not find your account.' });
        return res.status(503).json({ success: false, reason: r.reason, message: 'We could not refresh just now. Please try again in a little while.' });
      }
      const view = await svc().getView(userId);
      return res.json({ success: true, changed: r.changed, message: r.changed ? 'Nebulaa learned something new.' : 'Nothing new since the last look.', ...view });
    } catch (err) {
      console.error('[brand memory] refresh error:', err && err.message);
      return res.status(500).json({ success: false, message: 'We could not refresh just now. Please try again.' });
    }
  });

  router.patch('/learned/:key', protect, limiter, async (req, res) => {
    try {
      const userId = idOf(req.user);
      const key = String(req.params.key || '');
      const text = typeof (req.body && req.body.text) === 'string' ? req.body.text.trim() : '';
      if (!KEY_RE.test(key)) return res.status(400).json({ success: false, message: 'That item is not one we know.' });
      if (!text) return res.status(400).json({ success: false, message: 'Write a few words first.' });
      const r = await svc().editItem(userId, key, text);
      if (!r.ok) return res.status(404).json({ success: false, message: 'We could not find that item. Please reload the page.' });
      return res.json({ success: true, item: { id: r.item.key, text: r.item.text, userEdited: true } });
    } catch (err) {
      console.error('[brand memory] edit error:', err && err.message);
      return res.status(500).json({ success: false, message: 'The item could not be saved. Please try again.' });
    }
  });

  router.delete('/learned/:key', protect, limiter, async (req, res) => {
    try {
      const userId = idOf(req.user);
      const key = String(req.params.key || '');
      if (!KEY_RE.test(key)) return res.status(400).json({ success: false, message: 'That item is not one we know.' });
      const r = await svc().hideItem(userId, key);
      if (!r.ok) return res.status(404).json({ success: false, message: 'We could not find that item. Please reload the page.' });
      return res.json({ success: true });
    } catch (err) {
      console.error('[brand memory] delete error:', err && err.message);
      return res.status(500).json({ success: false, message: 'The item could not be deleted. Please try again.' });
    }
  });

  return router;
}

const router = createLearnedRouter();
router.createLearnedRouter = createLearnedRouter;
module.exports = router;
