/**
 * Ads / Boost Routes
 * Facebook & Instagram ad boosting via Ayrshare Ads API
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const User = require('../models/User');
const {
  getAdAccounts,
  boostPost,
  getBoostedAds,
  getAdHistory,
  getAdInterests,
  updateAd
} = require('../services/socialMediaAPI');

/**
 * Helper: Get user's Ayrshare profile key
 */
async function getProfileKey(userId) {
  const user = await User.findById(userId);
  return user?.ayrshare?.profileKey || null;
}

// ============================================
// AD ACCOUNTS
// ============================================

/**
 * GET /api/ads/accounts
 * Get Facebook/Instagram ad accounts
 */
router.get('/accounts', protect, async (req, res) => {
  try {
    const profileKey = await getProfileKey(req.user.userId || req.user.id);
    const result = await getAdAccounts(profileKey);

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error || 'Failed to get ad accounts' });
    }

    res.json({ success: true, accounts: result.data });
  } catch (error) {
    console.error('Get ad accounts error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// BOOST POST
// ============================================

/**
 * POST /api/ads/boost
 * Boost a post on Facebook/Instagram
 * Body: { postId, adAccountId, objective, dailyBudget, startDate, endDate, targeting, platforms }
 */
router.post('/boost', protect, async (req, res) => {
  try {
    const profileKey = await getProfileKey(req.user.userId || req.user.id);
    const { postId, adAccountId, objective, dailyBudget, startDate, endDate, targeting, platforms } = req.body;

    if (!postId) {
      return res.status(400).json({ success: false, error: 'Post ID is required' });
    }
    if (!adAccountId) {
      return res.status(400).json({ success: false, error: 'Ad Account ID is required' });
    }
    if (!dailyBudget) {
      return res.status(400).json({ success: false, error: 'Daily budget is required' });
    }

    const result = await boostPost(profileKey, {
      postId,
      adAccountId,
      objective,
      dailyBudget,
      startDate,
      endDate,
      targeting,
      platforms
    });

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error || 'Failed to boost post', details: result.data });
    }

    res.json({ success: true, data: result.data });
  } catch (error) {
    console.error('Boost post error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// MANAGE ADS
// ============================================

/**
 * GET /api/ads/boosted
 * Get all boosted ads
 * Query: ?status=ACTIVE&limit=20
 */
router.get('/boosted', protect, async (req, res) => {
  try {
    const profileKey = await getProfileKey(req.user.userId || req.user.id);
    const { status, limit } = req.query;

    const result = await getBoostedAds(profileKey, { status, limit: limit ? parseInt(limit) : undefined });

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error || 'Failed to get boosted ads' });
    }

    res.json({ success: true, ads: result.data });
  } catch (error) {
    console.error('Get boosted ads error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/ads/:adId
 * Update an ad (pause/resume/update budget)
 * Body: { status, dailyBudget, endDate }
 */
router.put('/:adId', protect, async (req, res) => {
  try {
    const profileKey = await getProfileKey(req.user.userId || req.user.id);
    const { adId } = req.params;
    const { status, dailyBudget, endDate } = req.body;

    const result = await updateAd(profileKey, adId, { status, dailyBudget, endDate });

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error || 'Failed to update ad' });
    }

    res.json({ success: true, data: result.data });
  } catch (error) {
    console.error('Update ad error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// AD HISTORY & PERFORMANCE
// ============================================

/**
 * GET /api/ads/history
 * Get ad spend history
 * Query: ?startDate=2024-01-01&endDate=2024-12-31
 */
router.get('/history', protect, async (req, res) => {
  try {
    const profileKey = await getProfileKey(req.user.userId || req.user.id);
    const { startDate, endDate } = req.query;

    const result = await getAdHistory(profileKey, { startDate, endDate });

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error || 'Failed to get ad history' });
    }

    res.json({ success: true, history: result.data });
  } catch (error) {
    console.error('Get ad history error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// AD INTERESTS (for targeting)
// ============================================

/**
 * GET /api/ads/interests
 * Search interests for ad targeting
 * Query: ?query=fitness
 */
router.get('/interests', protect, async (req, res) => {
  try {
    const profileKey = await getProfileKey(req.user.userId || req.user.id);
    const { query } = req.query;

    if (!query) {
      return res.status(400).json({ success: false, error: 'Search query is required' });
    }

    const result = await getAdInterests(profileKey, query);

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error || 'Failed to search interests' });
    }

    res.json({ success: true, interests: result.data });
  } catch (error) {
    console.error('Get ad interests error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
