const express = require('express');
const mongoose = require('mongoose');
const VideoJob = require('../models/VideoJob');
const { protect } = require('../middleware/auth');
const { toUserId } = require('../services/videoDraftStore');
const { videoGenerationQueue } = require('../services/videoGenerationQueue');
const comfyUI = require('../services/comfyUIClient');
const config = require('../services/identityLockConfig');
const { getDiskUsageBytes } = require('../services/directorStorageCleanup');
const { STORAGE_ROOT } = require('../services/videoDraftStore');
const { CHARACTER_MEMORY_ROOT } = require('../services/characterMemoryStore');
const insightFace = require('../services/identityInsightFace');

const router = express.Router();

router.get('/health', async (req, res) => {
  const mongoOk = mongoose.connection.readyState === 1;
  const comfyOk = await comfyUI.checkComfyUIAvailable(true);
  let diskBytes = 0;
  try {
    diskBytes = await getDiskUsageBytes(STORAGE_ROOT);
  } catch (_) {
    diskBytes = 0;
  }

  res.json({
    success: true,
    status: mongoOk ? 'ok' : 'degraded',
    mongo: mongoOk ? 'connected' : 'disconnected',
    comfyui: comfyOk ? 'reachable' : 'unreachable',
    redis: process.env.REDIS_URL ? 'configured' : 'not_configured',
    diskUsageBytes: diskBytes,
    timestamp: new Date().toISOString()
  });
});

router.get('/jobs', protect, async (req, res) => {
  try {
    const userId = toUserId(req.user);
    const jobs = await VideoJob.find({ userId })
      .sort({ updatedAt: -1 })
      .limit(50)
      .lean();
    res.json({
      success: true,
      jobs: jobs.map((job) => ({
        jobId: job.jobId,
        jobType: job.jobType,
        status: job.status,
        progress: job.progress,
        currentStep: job.currentStep,
        estimatedTime: job.estimatedRemainingSeconds,
        completedAssets: job.result?.sceneData || job.result?.clipUrls || job.result?.draft || null,
        updatedAt: job.updatedAt,
        createdAt: job.createdAt
      }))
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/identity/status', protect, async (req, res) => {
  const insightface = await insightFace.checkInsightFaceAvailable();
  const comfyui = await comfyUI.checkComfyUIAvailable(true);
  res.json({
    success: true,
    identityEngine: config.IDENTITY_ENGINE,
    imageEngine: config.IMAGE_ENGINE,
    insightface,
    comfyui,
    comfyuiUrl: config.COMFYUI_URL,
    characterMemoryRoot: CHARACTER_MEMORY_ROOT,
    similarityThreshold: config.SIMILARITY_THRESHOLD
  });
});

router.get('/director/status', protect, async (req, res) => {
  const userId = toUserId(req.user);
  const mongoOk = mongoose.connection.readyState === 1;
  const comfyOk = await comfyUI.checkComfyUIAvailable(true);
  const activeJobs = await VideoJob.countDocuments({
    userId,
    status: { $in: ['queued', 'processing'] }
  });

  res.json({
    success: true,
    mongo: mongoOk,
    comfyui: comfyOk,
    queue: {
      activeJobs,
      concurrency: process.env.VIDEO_QUEUE_CONCURRENCY || 2
    },
    identity: {
      engine: config.IDENTITY_ENGINE,
      autoComfyUI: config.AUTO_COMFYUI_FOR_IDENTITY
    },
    storage: {
      aiVideosRoot: STORAGE_ROOT,
      characterMemoryRoot: CHARACTER_MEMORY_ROOT
    }
  });
});

module.exports = router;
