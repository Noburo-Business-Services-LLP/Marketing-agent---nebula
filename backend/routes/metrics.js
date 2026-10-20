'use strict';
/**
 * Staff-only process numbers for load tests and incident checks.
 *   GET  /api/metrics/event-loop        event-loop lag (ms) and memory since the last reset
 *   POST /api/metrics/event-loop/reset  starts a new window (a soak test calls it first)
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

module.exports = router;
