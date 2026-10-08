const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();

// Anyone can reach this form, and every message becomes an email to the support inbox, so it is limited hard.
const supportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: 'You have sent several messages already. Please try again in an hour, or write to support@nebulaa.ai.' }
});
const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\r\n\t]+/g, ' ').trim().slice(0, max) : '');
const { optionalAuth } = require('../middleware/auth');
const User = require('../models/User');
const { sendSupportEmail } = require('../services/supportEmail');

router.post('/query', supportLimiter, optionalAuth, async (req, res) => {
  try {
    const { message, name: providedName, email: providedEmail } = req.body || {};

    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ success: false, message: 'Message is required' });
    }
    if (message.length > 5000) {
      return res.status(400).json({ success: false, message: 'Please keep your message under 5,000 characters.' });
    }

    let name = clean(providedName, 120);
    let email = clean(providedEmail, 200);
    if (email && !/^\S+@\S+\.\S+$/.test(email)) email = '';

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

