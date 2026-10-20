'use strict';
/**
 * Staff-only process numbers for load tests and incident checks.
 *   GET  /api/metrics/event-loop        event-loop lag (ms) and memory since the last reset
 *   POST /api/metrics/event-loop/reset  starts a new window (a soak test calls it first)
 *   GET  /api/metrics/queue             generation queue depth, running, oldest wait, per-worker claims (E9)
 * Nothing about any customer is read or returned.
 */
const express = require('express');
const { protect } = require('../middleware/auth');
const monitor = require('../utils/eventLoopMonitor');

const router = express.Router();
const staffOnly = require('../middleware/requireStaff')('run_jobs');
monitor.start(); // the window starts when the app loads

const mb = (bytes) => Math.round(bytes / 1024 / 1024);

router.get('/event-loop', protect, staffOnly, (req, res) => {
  const mem = process.memoryUsage();
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, eventLoop: monitor.snapshot(), memory: { rssMb: mb(mem.rss), heapUsedMb: mb(mem.heapUsed) }, uptimeSeconds: Math.round(process.uptime()) });
});

router.post('/event-loop/reset', protect, staffOnly, (req, res) => {
  monitor.reset();
  res.json({ success: true });
});

/**
 * GET /api/metrics/queue: generation queue pressure (E9 stage A). Database-wide numbers (queue depth per type and pool,
 * running, oldest waiting age, running jobs per worker) plus THIS process's counters (claims, lease re-queues, failures,
 * hand-backs). Counts and worker ids only: nothing about any customer.
 */
router.get('/queue', protect, staffOnly, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const video = await router.queues.video().metrics();
    const image = await router.queues.image().metrics();
    res.json({ success: true, at: new Date().toISOString(), videoJobs: video, imageJobs: image });
  } catch (err) {
    require('../utils/httpError').fail(res, err, 'Could not read the queue numbers.');
  }
});
// Injectable for tests.
router.queues = {
  video: () => require('../services/videoGenerationQueue').videoGenerationQueue,
  image: () => require('../services/imageJobQueue').imageJobQueue()
};

module.exports = router;
