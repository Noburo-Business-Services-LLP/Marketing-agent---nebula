
const express = require('express');
const { protect } = require('../middleware/auth');
const { getInfluencers, createInfluencer } = require('../controllers/influencerController');

const router = express.Router();

router.get('/', protect, getInfluencers);
router.post('/', protect, createInfluencer);

module.exports = router;
