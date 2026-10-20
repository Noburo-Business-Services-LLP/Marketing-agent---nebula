
const express = require('express');
const { protect } = require('../middleware/auth');
const {
  createSubmission,
  getSubmissions,
  approveSubmission,
  rejectSubmission,
  requestChangesSubmission
} = require('../controllers/submissionController');

const router = express.Router();
// A malformed id is a plain 400 before any query runs (middleware/validateObjectId.js).
require('../middleware/validateObjectId').applyObjectIdParams(router, ['id']);

router.get('/', protect, getSubmissions);
router.post('/', protect, createSubmission);
router.put('/:id/approve', protect, approveSubmission);
router.put('/:id/reject', protect, rejectSubmission);
router.put('/:id/request-changes', protect, requestChangesSubmission);

module.exports = router;
