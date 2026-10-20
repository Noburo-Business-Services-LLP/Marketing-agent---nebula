'use strict';
/**
 * Event-loop lag, measured with perf_hooks.monitorEventLoopDelay (a timer every 10 ms; the histogram records how late
 * each tick ran). A busy loop (a long synchronous job, a slow hash) shows up here before anything else, so the load
 * tests (scripts/loadtest/) read it and staff can read it through GET /api/metrics/event-loop (routes/metrics.js).
 * Cheap: one unref'd native timer. Numbers are in milliseconds above the timer's own 10 ms interval (an idle process reads about 0).
 */
const { monitorEventLoopDelay } = require('perf_hooks');

const RESOLUTION_MS = 10;
let histogram = null;
let since = Date.now();

function start() {
  if (histogram) return histogram;
  histogram = monitorEventLoopDelay({ resolution: RESOLUTION_MS });
  histogram.enable();
  since = Date.now();
  return histogram;
}

// The histogram records how long each 10 ms timer really took, so an idle process reads about 10 ms. Lag is what is
// above the timer's own interval.
const ms = (ns) => Math.max(0, Math.round((ns / 1e6 - RESOLUTION_MS) * 100) / 100);

/** { p50, p90, p99, max, mean, samples, sinceSeconds } for the window since start() or the last reset(). */
function snapshot() {
  const h = start();
  return {
    p50: ms(h.percentile(50)),
    p90: ms(h.percentile(90)),
    p99: ms(h.percentile(99)),
    max: ms(h.max),
    mean: ms(h.mean || 0),
    samples: h.count,
    sinceSeconds: Math.round((Date.now() - since) / 1000)
  };
}

/** Starts a new window (a soak test resets before it begins). */
function reset() {
  start().reset();
  since = Date.now();
}

module.exports = { start, snapshot, reset };
