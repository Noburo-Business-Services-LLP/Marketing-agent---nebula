
const express = require('express');
const { protect } = require('../middleware/auth');
const { getCollaborations, inviteCollaboration } = require('../controllers/collaborationController');

const router = express.Router();

router.get('/', protect, getCollaborations);
router.post('/invite', protect, inviteCollaboration);

module.exports = router;
