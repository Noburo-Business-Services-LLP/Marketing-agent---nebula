const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');
const FeatureEvent = require('../models/FeatureEvent');
const Coupon = require('../models/Coupon');
const adminAuth = require('../middleware/adminAuth');

const FEATURE_LABELS = {
  dashboard_viewed: 'Dashboard',
  campaigns_viewed: 'Campaigns Viewed',
  campaign_created: 'Campaign Created',
  post_generated: 'Post Generated',
  post_published: 'Post Published',
  competitor_viewed: 'Competitors Viewed',
  competitor_added: 'Competitor Added',
  competitor_scraped: 'Competitor Scraped',
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

// GET /api/admin/overview — DAU/WAU/MAU + signups + trial funnel
router.get('/overview', adminAuth, async (req, res) => {
  try {
    const now = new Date();
    const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
    const start7d = new Date(now); start7d.setDate(now.getDate() - 7);
    const start30d = new Date(now); start30d.setDate(now.getDate() - 30);
    const in3days = new Date(now); in3days.setDate(now.getDate() + 3);

    const [
      totalUsers,
      newToday,
      newThisWeek,
      newThisMonth,
      dau,
      wau,
      mau,
      activeTrials,
      expiringSoon,
      expiredTrials,
      totalCreditsUsed,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ createdAt: { $gte: startOfToday } }),
      User.countDocuments({ createdAt: { $gte: start7d } }),
      User.countDocuments({ createdAt: { $gte: start30d } }),
      User.countDocuments({ lastLoginAt: { $gte: startOfToday } }),
      User.countDocuments({ lastLoginAt: { $gte: start7d } }),
      User.countDocuments({ lastLoginAt: { $gte: start30d } }),
      User.countDocuments({ 'trial.isExpired': { $ne: true }, 'trial.migratedToProd': { $ne: true }, 'trial.expiresAt': { $gt: now } }),
      User.countDocuments({ 'trial.expiresAt': { $gt: now, $lte: in3days }, 'trial.isExpired': { $ne: true } }),
      User.countDocuments({ $or: [{ 'trial.isExpired': true }, { 'trial.expiresAt': { $lte: now } }] }),
      User.aggregate([{ $group: { _id: null, total: { $sum: '$credits.totalUsed' } } }]),
    ]);

    res.json({
      success: true,
      data: {
        totalUsers,
        newToday,
        newThisWeek,
        newThisMonth,
        dau,
        wau,
        mau,
        activeTrials,
        expiringSoon,
        expiredTrials,
        totalCreditsUsed: totalCreditsUsed[0]?.total || 0,
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch overview' });
  }
});

// GET /api/admin/trial-funnel — users by trial stage
router.get('/trial-funnel', adminAuth, async (req, res) => {
  try {
    const now = new Date();
    const in3days = new Date(now); in3days.setDate(now.getDate() + 3);

    const users = await User.find(
      {},
      { email: 1, companyName: 1, 'trial.expiresAt': 1, 'trial.isExpired': 1, 'trial.migratedToProd': 1, 'credits.balance': 1, lastLoginAt: 1, createdAt: 1 }
    ).lean();

    const funnel = { active: [], expiringSoon: [], expired: [], migrated: [] };

    for (const u of users) {
      const exp = u.trial?.expiresAt ? new Date(u.trial.expiresAt) : null;
      if (u.trial?.migratedToProd) {
        funnel.migrated.push(u);
      } else if (u.trial?.isExpired) {
        funnel.expired.push(u);
      } else if (exp && exp <= in3days) {
        funnel.expiringSoon.push(u);
      } else {
        funnel.active.push(u);
      }
    }

    res.json({ success: true, data: funnel });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch trial funnel' });
  }
});

// GET /api/admin/content-stats — generate→publish rate
router.get('/content-stats', adminAuth, async (req, res) => {
  try {
    const [generated, published] = await Promise.all([
      FeatureEvent.countDocuments({ feature: 'post_generated' }),
      FeatureEvent.countDocuments({ feature: 'post_published' }),
    ]);

    const publishRate = generated > 0 ? Math.round((published / generated) * 100) : 0;

    // Top 5 users by posts generated
    const topGenerators = await FeatureEvent.aggregate([
      { $match: { feature: 'post_generated' } },
      { $group: { _id: '$userId', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
      { $unwind: { path: '$user', preserveNullAndEmpty: true } },
      { $project: { email: '$user.email', companyName: '$user.companyName', count: 1 } }
    ]);

    res.json({ success: true, data: { generated, published, publishRate, topGenerators } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch content stats' });
  }
});

// GET /api/admin/users — all users with enriched info
router.get('/users', adminAuth, async (req, res) => {
  try {
    const users = await User.find(
      {},
      {
        email: 1, firstName: 1, lastName: 1, companyName: 1, isActive: 1,
        createdAt: 1, lastLoginAt: 1, mobileNumber: 1, isHidden: 1,
        'credits.balance': 1, 'credits.totalUsed': 1,
        'trial.expiresAt': 1, 'trial.isExpired': 1, 'trial.migratedToProd': 1, 'trial.reenabled': 1,
        connectedSocials: 1, onboardingCompleted: 1
      }
    ).sort({ createdAt: -1 }).lean();

    // Get event counts per user
    const eventCounts = await FeatureEvent.aggregate([
      { $group: { _id: '$userId', total: { $sum: 1 }, lastEvent: { $max: '$timestamp' } } }
    ]);
    const eventMap = {};
    eventCounts.forEach(e => { eventMap[e._id.toString()] = { total: e.total, lastEvent: e.lastEvent }; });

    const enriched = users.map(u => ({
      ...u,
      eventTotal: eventMap[u._id.toString()]?.total || 0,
      lastActivity: eventMap[u._id.toString()]?.lastEvent || null,
      socialCount: u.connectedSocials?.length || 0,
    }));

    res.json({ success: true, data: enriched });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// GET /api/admin/users/:id/usage — per-user feature breakdown
router.get('/users/:id/usage', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const oid = mongoose.Types.ObjectId.createFromHexString(id);

    const [user, events, creditsBurned] = await Promise.all([
      User.findById(id, {
        email: 1, firstName: 1, lastName: 1, companyName: 1, isActive: 1,
        createdAt: 1, lastLoginAt: 1,
        'credits.balance': 1, 'credits.totalUsed': 1,
        'trial.expiresAt': 1, 'trial.isExpired': 1, 'trial.migratedToProd': 1, 'trial.reenabled': 1,
        connectedSocials: 1, onboardingCompleted: 1
      }).lean(),
      FeatureEvent.aggregate([
        { $match: { userId: oid } },
        { $group: { _id: '$feature', count: { $sum: 1 }, lastUsed: { $max: '$timestamp' }, creditsTotal: { $sum: '$credits_consumed' } } },
        { $sort: { count: -1 } }
      ]),
      FeatureEvent.aggregate([
        { $match: { userId: oid } },
        { $group: { _id: null, total: { $sum: '$credits_consumed' } } }
      ])
    ]);

    if (!user) return res.status(404).json({ error: 'User not found' });

    const usage = events.map(e => ({
      feature: e._id,
      label: FEATURE_LABELS[e._id] || e._id,
      count: e.count,
      lastUsed: e.lastUsed,
      creditsUsed: e.creditsTotal || 0,
    }));

    // Generate → publish rate for this user
    const generated = events.find(e => e._id === 'post_generated')?.count || 0;
    const published = events.find(e => e._id === 'post_published')?.count || 0;
    const publishRate = generated > 0 ? Math.round((published / generated) * 100) : 0;

    const now = new Date();
    const trialExp = user.trial?.expiresAt ? new Date(user.trial.expiresAt) : null;
    const trialDaysLeft = trialExp ? Math.max(0, Math.ceil((trialExp - now) / (1000 * 60 * 60 * 24))) : null;

    res.json({
      success: true,
      data: {
        user: {
          ...user,
          trialDaysLeft,
          socialCount: user.connectedSocials?.length || 0,
        },
        usage,
        publishRate,
        generated,
        published,
        totalCreditsBurned: creditsBurned[0]?.total || 0,
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch usage' });
  }
});

// PUT /api/admin/users/:id/toggle
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

// ─── Coupon Management ───────────────────────────────────────────────────────

// GET /api/admin/coupons
router.get('/coupons', adminAuth, async (req, res) => {
  try {
    const coupons = await Coupon.find().sort({ createdAt: -1 }).lean();
    res.json({ success: true, data: coupons });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch coupons' });
  }
});

// POST /api/admin/coupons
router.post('/coupons', adminAuth, async (req, res) => {
  try {
    const { code, discountedAmount, maxUses, note } = req.body;
    if (!code) return res.status(400).json({ error: 'Coupon code is required' });

    const coupon = await Coupon.create({
      code: code.toUpperCase().trim(),
      discountedAmount: discountedAmount || 5000,
      maxUses: maxUses || 1,
      note: note || ''
    });
    res.json({ success: true, data: coupon });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error: 'Coupon code already exists' });
    res.status(500).json({ error: 'Failed to create coupon' });
  }
});

// PATCH /api/admin/coupons/:code/deactivate
router.patch('/coupons/:code/deactivate', adminAuth, async (req, res) => {
  try {
    const coupon = await Coupon.findOneAndUpdate(
      { code: req.params.code.toUpperCase() },
      { isActive: false },
      { new: true }
    );
    if (!coupon) return res.status(404).json({ error: 'Coupon not found' });
    res.json({ success: true, data: coupon });
  } catch (err) {
    res.status(500).json({ error: 'Failed to deactivate coupon' });
  }
});

// DELETE /api/admin/coupons/:code
router.delete('/coupons/:code', adminAuth, async (req, res) => {
  try {
    await Coupon.findOneAndDelete({ code: req.params.code.toUpperCase() });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete coupon' });
  }
});

// POST /api/admin/users/:id/toggle-hidden
router.post('/users/:id/toggle-hidden', adminAuth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.isHidden = !user.isHidden;
    await user.save({ validateBeforeSave: false });
    res.json({ success: true, isHidden: user.isHidden });
  } catch (err) {
    res.status(500).json({ error: 'Failed to toggle hidden' });
  }
});

// POST /api/admin/users/:id/reset-trial
router.post('/users/:id/reset-trial', adminAuth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.trial = {
      ...user.trial,
      isExpired: false,
      reenabled: true
    };
    await user.save({ validateBeforeSave: false });

    res.json({ success: true, message: 'Trial re-enabled for 30 days' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reset trial' });
  }
});

// POST /api/admin/users/:id/add-credits
router.post('/users/:id/add-credits', adminAuth, async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || isNaN(amount) || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (!user.credits) user.credits = { balance: 0, totalUsed: 0, history: [] };
    user.credits.balance = (user.credits.balance || 0) + Number(amount);
    user.credits.history = user.credits.history || [];
    user.credits.history.push({
      action: 'admin_grant',
      amount: Number(amount),
      description: `Admin added ${amount} credits`,
      createdAt: new Date()
    });
    await user.save({ validateBeforeSave: false });

    res.json({ success: true, newBalance: user.credits.balance });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add credits' });
  }
});

module.exports = router;
