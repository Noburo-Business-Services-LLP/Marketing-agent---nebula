const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const { requireFeature } = require('../middleware/requireFeature');
const controller = require('../controllers/socialInboxController');
const googleReviews = require('../services/googleReviews');
const { friendlyMessage } = require('../services/providerErrors');

const userIdOf = (req) => req.user?.userId || req.user?.id || req.user?._id;

async function loadReviewContext(req) {
  const user = await User.findById(userIdOf(req)).lean();
  const profile = user?.businessProfile || {};
  return {
    profileKey: user?.ayrshare?.profileKey || '',
    business: {
      name: profile.name || profile.businessName || '',
      tone: Array.isArray(profile.brandVoice) ? profile.brandVoice.join(', ') : (profile.brandVoice || profile.tone || ''),
      language: profile.language || ''
    }
  };
}

const streamAuth = async (req, res, next) => {
  try {
    const token = req.query.token || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ success: false, message: 'Missing auth token' });
    // A demo token names the user with no check at all, so it works only in demo mode (never in production).
    if (String(token).startsWith('demo:') && require('../middleware/auth').demoModeActive()) {
      req.user = { _id: String(token).slice(5), id: String(token).slice(5), isActive: true };
      return next();
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    // The same pass, CSM and deletion checks as every other request.
    const problem = await require('../middleware/auth')._tokenProblem(decoded, user);
    if (problem) return res.status(401).json({ success: false, message: problem });
    req.user = user;
    return next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
};

// Registered before the :platform routes so 'register' is not read as a platform name.
router.post('/webhooks/register', protect, requireFeature('inbox'), controller.registerWebhook);
router.get('/webhooks/:platform', controller.verifyWebhook);
router.post('/webhooks/:platform', controller.receiveWebhook);
router.post('/webhooks/comments/:platform', controller.receiveCommentWebhook);
router.get('/stream', streamAuth, controller.stream);

router.use(protect);

router.get('/summary', requireFeature('inbox'), controller.getSummary);
router.get('/settings', requireFeature('inbox'), controller.getSettings);
router.put('/settings', requireFeature('inbox'), controller.updateSettings);
router.post('/auto-reply/toggle', requireFeature('auto_reply'), controller.toggleAutoReply);
router.get('/pending', requireFeature('inbox'), controller.listPending);
router.post('/pending/:id/approve', requireFeature('inbox'), controller.approvePending);
router.post('/pending/:id/discard', requireFeature('inbox'), controller.discardPending);
router.get('/conversations', requireFeature('inbox'), controller.listConversations);
router.get('/conversations/:id/messages', requireFeature('inbox'), controller.getMessages);
router.post('/conversations/:id/reply', requireFeature('inbox'), controller.reply);
router.patch('/conversations/:id/status', requireFeature('inbox'), controller.updateStatus);
router.patch('/conversations/:id/meta', requireFeature('inbox'), controller.updateMeta);
router.post('/sync/:platform', requireFeature('inbox'), controller.syncPlatform);
// Google Business Profile reviews: read-only list with a suggested reply for each one without a reply.
router.get('/reviews', requireFeature('inbox'), async (req, res) => {
  try {
    const user = await User.findById(userIdOf(req)).lean();
    // Not connected: no provider call. Connected but the provider failed: loadFailed, not "not connected".
    const view = await googleReviews.reviewsView({ user });
    return res.json({ success: true, ...view });
  } catch (error) {
    console.error('[reviews] list failed:', error.message);
    return res.status(500).json({ success: false, message: friendlyMessage(error, 'default') });
  }
});

router.post('/reviews/draft', requireFeature('inbox'), async (req, res) => {
  try {
    const { reviewer, rating, text } = req.body || {};
    const review = { reviewer: String(reviewer || 'A customer').slice(0, 80), rating: Number(rating) || 0, text: String(text || '').slice(0, 2000) };
    const { business } = await loadReviewContext(req);
    const reply = await googleReviews.draftReply({ review, business });
    if (!reply) return res.status(502).json({ success: false, message: friendlyMessage(null, 'ai') });
    return res.json({ success: true, reply, needsApproval: googleReviews.needsHumanApproval(review) });
  } catch (error) {
    console.error('[reviews] draft failed:', error.message);
    return res.status(502).json({ success: false, message: friendlyMessage(error, 'ai') });
  }
});

router.post('/dev/ingest', requireFeature('inbox'), controller.devIngest);
router.post('/dev/test', requireFeature('inbox'), controller.testWebhook);

router.streamAuth = streamAuth;
module.exports = router;
