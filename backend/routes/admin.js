const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const FeatureEvent = require('../models/FeatureEvent');
const adminAuth = require('../middleware/adminAuth');

// Feature display labels
const FEATURE_LABELS = {
  dashboard_viewed: 'Dashboard',
  campaign_created: 'Campaign Created',
  post_generated: 'Post Generated',
  post_published: 'Post Published',
  competitor_viewed: 'Competitors Viewed',
  competitor_added: 'Competitor Added',
  brand_assets_viewed: 'Brand Assets Viewed',
  brand_assets_extracted: 'Brand Assets Extracted',
  analytics_viewed: 'Analytics Viewed',
  social_connected: 'Social Connected',
  chat_used: 'Chat Used',
  brand_profile_updated: 'Brand Profile Updated',
};

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

// GET /api/admin/stats — overview numbers
router.get('/stats', adminAuth, async (req, res) => {
  try {
    const now = new Date();
    const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
    const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - 7);

    const [total, today, thisWeek] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ createdAt: { $gte: startOfToday } }),
      User.countDocuments({ createdAt: { $gte: startOfWeek } }),
    ]);

    res.json({ success: true, data: { total, today, thisWeek } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// GET /api/admin/users — all users with basic info
router.get('/users', adminAuth, async (req, res) => {
  try {
    const users = await User.find(
      {},
      { email: 1, companyName: 1, isActive: 1, createdAt: 1, 'credits.balance': 1, 'credits.totalUsed': 1 }
    ).sort({ createdAt: -1 }).lean();

    res.json({ success: true, data: users });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// GET /api/admin/users/:id/usage — feature usage for a specific user
router.get('/users/:id/usage', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const [user, events] = await Promise.all([
      User.findById(id, { email: 1, companyName: 1, isActive: 1, createdAt: 1, 'credits.balance': 1, 'credits.totalUsed': 1, lastLoginAt: 1 }).lean(),
      FeatureEvent.aggregate([
        { $match: { userId: require('mongoose').Types.ObjectId.createFromHexString(id) } },
        { $group: { _id: '$feature', count: { $sum: 1 }, lastUsed: { $max: '$timestamp' } } },
        { $sort: { count: -1 } }
      ])
    ]);

    if (!user) return res.status(404).json({ error: 'User not found' });

    const usage = events.map(e => ({
      feature: e._id,
      label: FEATURE_LABELS[e._id] || e._id,
      count: e.count,
      lastUsed: e.lastUsed
    }));

    res.json({ success: true, data: { user, usage } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch usage' });
  }
});

// PUT /api/admin/users/:id/toggle — enable or disable a user account
router.put('/users/:id/toggle', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.isActive = !user.isActive;
    await user.save();

    res.json({ success: true, data: { isActive: user.isActive, email: user.email } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to toggle user' });
  }
});

module.exports = router;
