const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const seoController = require('../controllers/seoController');

router.use(protect);

router.get('/dashboard', seoController.getDashboard);
router.get('/reports', seoController.getReports);
router.post('/keywords', seoController.keywordResearch);
router.post('/metadata', seoController.metadata);
router.post('/hashtags', seoController.hashtags);
router.post('/competitor-analysis', seoController.competitorAnalysis);

module.exports = router;
