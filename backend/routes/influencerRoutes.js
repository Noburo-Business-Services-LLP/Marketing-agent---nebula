
const express = require('express');
const { protect } = require('../middleware/auth');
const { getInfluencers, createInfluencer, updateInfluencer, deleteInfluencer } = require('../controllers/influencerController');

const router = express.Router();

router.get('/', protect, getInfluencers);
router.post('/', protect, createInfluencer);
router.put('/:id', protect, updateInfluencer);
router.delete('/:id', protect, deleteInfluencer);

module.exports = router;
