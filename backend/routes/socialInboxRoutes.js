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
    if (String(token).startsWith('demo:')) {
      req.user = { _id: String(token).slice(5), id: String(token).slice(5), isActive: true };
      return next();
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    req.user = user;
    return next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
};

router.get('/webhooks/:platform', controller.verifyWebhook);
router.post('/webhooks/:platform', controller.receiveWebhook);
router.post('/webhooks/comments/:platform', controller.receiveCommentWebhook);
router.get('/stream', streamAuth, controller.stream);

router.use(protect);

router.get('/summary', requireFeature('inbox'), controller.getSummary);
router.get('/settings', requireFeature('inbox'), controller.getSettings);
router.put('/settings', requireFeature('inbox'), controller.updateSettings);
router.post('/auto-reply/toggle', requireFeature('auto_reply'), controller.toggleAutoReply);
router.get('/conversations', requireFeature('inbox'), controller.listConversations);
router.get('/conversations/:id/messages', requireFeature('inbox'), controller.getMessages);
router.post('/conversations/:id/reply', requireFeature('inbox'), controller.reply);
router.patch('/conversations/:id/status', requireFeature('inbox'), controller.updateStatus);
router.patch('/conversations/:id/meta', requireFeature('inbox'), controller.updateMeta);
router.post('/sync/:platform', requireFeature('inbox'), controller.syncPlatform);
// Google Business Profile reviews: read-only list with a suggested reply for each one without a reply.
router.get('/reviews', requireFeature('inbox'), async (req, res) => {
  try {
    const { profileKey } = await loadReviewContext(req);
    const result = await googleReviews.fetchReviews({ profileKey });
    if (!result.success) {
      return res.json({ success: true, connected: false, reviews: [], message: friendlyMessage(null, 'social') });
    }
    const reviews = result.reviews.map((review) => ({ ...review, needsApproval: googleReviews.needsHumanApproval(review) }));
    return res.json({ success: true, connected: true, reviews, summary: result.summary || null });
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

module.exports = router;
