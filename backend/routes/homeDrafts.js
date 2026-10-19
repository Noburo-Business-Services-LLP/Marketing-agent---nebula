// Home drafts from a competitor's stored post (docs/superpowers/ops/home-drafts.md):
//   GET  /api/home/drafts/options   prices (from config/apiCosts.js), switch, entitlement, languages, drafts left today
//   POST /api/home/response-post    { ref, key, tone?, language? }  -> { draft: { caption, imageIdea } }
//   POST /api/home/witty-comment    { ref, key, tone?, language? }  -> { draft: { comment } }
// `ref` names a stored post of one of the caller's own tracked competitors ("<competitorId>.<postKey>" from
// GET /api/competitors/best-posts); the server looks the post up itself and never accepts any text of it. `key` is the
// idempotency key of one press of the button. Inside an agency client or a CSM pass req.user already is the client, and
// the charge goes to the wallet that pays for it. Nothing here posts anywhere: the customer copies a comment and posts it
// themselves, and a post goes to Create.
const express = require('express');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = rateLimit;
const { protect } = require('../middleware/auth');

const keyGenerator = (req) => String(req.user?._id || req.user?.id || ipKeyGenerator(req.ip));
const draftLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, keyGenerator,
  message: { success: false, message: 'You have sent too many requests. Please try again in a few minutes.' }
});
const optionsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 600, standardHeaders: true, legacyHeaders: false, keyGenerator,
  message: { success: false, message: 'You have sent too many requests. Please try again in a few minutes.' }
});
const GENERIC_ERROR = 'We could not write a draft just now. Nothing was charged. Please try again.';

function createHomeDraftsRouter(impl = {}) {
  const router = express.Router();
  let service = impl.service || null;
  const getService = () => (service = service || require('../services/homeDrafts/service').createHomeDrafts(impl.deps || {}));
  const passOf = (req) => Boolean(req.actingCsm || req.actingAgency);

  router.get('/drafts/options', protect, optionsLimiter, async (req, res) => {
    try {
      res.set('Cache-Control', 'private, no-store');
      const out = await getService().options(req.user, { pass: passOf(req) });
      return res.json({ success: true, ...out });
    } catch (err) {
      console.error('[home drafts] options error:', err && err.message);
      return res.status(500).json({ success: false, message: 'We could not load the draft options. Please try again.' });
    }
  });

  const handle = (kind) => async (req, res) => {
    try {
      res.set('Cache-Control', 'private, no-store');
      const { status, body } = await getService().make(req.user, kind, req.body, { pass: passOf(req) });
      return res.status(status).json(body);
    } catch (err) {
      console.error('[home drafts] route error:', err && err.message);
      return res.status(500).json({ success: false, message: GENERIC_ERROR });
    }
  };
  router.post('/response-post', protect, draftLimiter, handle('response_post'));
  router.post('/witty-comment', protect, draftLimiter, handle('witty_comment'));
  return router;
}

const router = createHomeDraftsRouter();
router.createHomeDraftsRouter = createHomeDraftsRouter;
module.exports = router;
