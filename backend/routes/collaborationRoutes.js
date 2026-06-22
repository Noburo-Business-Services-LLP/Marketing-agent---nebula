
const express = require('express');
const { protect } = require('../middleware/auth');
const { getCollaborations, inviteCollaboration, deleteCollaboration } = require('../controllers/collaborationController');

const router = express.Router();

router.get('/', protect, getCollaborations);
router.post('/invite', protect, inviteCollaboration);
router.delete('/:id', protect, deleteCollaboration);

module.exports = router;
