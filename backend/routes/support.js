const express = require('express');
const router = express.Router();
const { optionalAuth } = require('../middleware/auth');
const User = require('../models/User');
const { sendSupportEmail } = require('../services/supportEmail');

router.post('/query', optionalAuth, async (req, res) => {
  try {
    const { message, name: providedName, email: providedEmail } = req.body || {};

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ success: false, message: 'Message is required' });
    }

    let name = typeof providedName === 'string' ? providedName.trim() : '';
    let email = typeof providedEmail === 'string' ? providedEmail.trim() : '';

    if ((!name || !email) && req.user) {
      const user = await User.findById(req.user.userId || req.user.id || req.user._id);
      if (user) {
        if (!name) {
          name = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.companyName || '';
        }
        if (!email) {
          email = user.email || '';
        }
      }
    }

    await sendSupportEmail({ name, email, message });

    return res.json({ success: true });
  } catch (error) {
    console.error('Support email error:', error);
    return res.status(500).json({ success: false, message: 'Failed to send query. Please try again later.' });
  }
});

module.exports = router;

