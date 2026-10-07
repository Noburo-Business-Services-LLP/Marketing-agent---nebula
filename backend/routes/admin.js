const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const adminAuth = require('../middleware/adminAuth');

// The old shared-login /admin page was retired in favour of the Staff area (each person signs in with their
// own account). Only the first-Owner bootstrap stays on the server: the shared login (ADMIN_EMAIL and
// ADMIN_PASSWORD) can make one account the Owner, once. There is no screen for it; see the hand-over note.

// POST /api/admin/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminEmail || !adminPassword) {
      return res.status(500).json({ error: 'Admin credentials not configured' });
    }

    if (email !== adminEmail || password !== adminPassword) {
      return res.status(401).json({ error: 'Invalid admin credentials' });
    }

    const token = jwt.sign(
      { role: 'admin', email },
      process.env.JWT_SECRET || 'fallback-secret',
      { expiresIn: '12h' }
    );

    res.json({ success: true, token });
  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
});

// One-time door: the shared admin login makes one account the Owner. Refused once an Owner exists.
router.post('/make-owner', adminAuth, async (req, res) => {
  try {
    const { canBootstrapOwner } = require('../services/staff/roles');
    const ownerCount = await User.countDocuments({ staffRole: 'owner' });
    if (!canBootstrapOwner(ownerCount)) return res.status(409).json({ success: false, message: 'An Owner already exists. The Owner can add more people from the Staff area.' });
    const email = String(req.body?.email || '').trim().toLowerCase();
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ success: false, message: 'No account uses that email. Sign up with it first.' });
    user.staffRole = 'owner';
    user.isCsm = false;
    user.isHidden = true;
    user.onboardingCompleted = true;
    await user.save();
    res.json({ success: true, data: { email: user.email } });
  } catch (error) {
    console.error('[admin] make owner failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not make the Owner.' });
  }
});

module.exports = router;
