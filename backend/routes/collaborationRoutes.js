
const express = require('express');
const { protect } = require('../middleware/auth');
const { getCollaborations, inviteCollaboration, deleteCollaboration } = require('../controllers/collaborationController');

const router = express.Router();
// A malformed id is a plain 400 before any query runs (middleware/validateObjectId.js).
require('../middleware/validateObjectId').applyObjectIdParams(router, ['id']);

router.get('/', protect, getCollaborations);
router.post('/invite', protect, inviteCollaboration);
router.delete('/:id', protect, deleteCollaboration);

module.exports = router;
