
const express = require('express');
const { protect } = require('../middleware/auth');
const { getInfluencers, createInfluencer, updateInfluencer, deleteInfluencer } = require('../controllers/influencerController');

const router = express.Router();
// A malformed id is a plain 400 before any query runs (middleware/validateObjectId.js).
require('../middleware/validateObjectId').applyObjectIdParams(router, ['id']);

router.get('/', protect, getInfluencers);
router.post('/', protect, createInfluencer);
router.put('/:id', protect, updateInfluencer);
router.delete('/:id', protect, deleteInfluencer);

module.exports = router;
