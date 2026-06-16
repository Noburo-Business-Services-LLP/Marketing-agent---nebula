const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const controller = require('../controllers/socialInboxController');

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
router.get('/stream', streamAuth, controller.stream);

router.use(protect);

router.get('/summary', controller.getSummary);
router.get('/settings', controller.getSettings);
router.put('/settings', controller.updateSettings);
router.get('/conversations', controller.listConversations);
router.get('/conversations/:id/messages', controller.getMessages);
router.post('/conversations/:id/reply', controller.reply);
router.patch('/conversations/:id/status', controller.updateStatus);
router.patch('/conversations/:id/meta', controller.updateMeta);
router.post('/sync/:platform', controller.syncPlatform);
router.post('/dev/ingest', controller.devIngest);
router.post('/dev/test', controller.testWebhook);

module.exports = router;
