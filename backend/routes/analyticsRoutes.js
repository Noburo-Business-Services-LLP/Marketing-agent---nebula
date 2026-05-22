
const express = require('express');
const { protect } = require('../middleware/auth');
const { getInfluencerAnalytics } = require('../controllers/analyticsController');

const router = express.Router();

router.get('/influencer', protect, getInfluencerAnalytics);

module.exports = router;
