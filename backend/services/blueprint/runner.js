'use strict';
// A tiny in-process FIFO with a concurrency cap. No timers, so a test process exits by itself.
// Errors are logged and never thrown.
const { LIMITS } = require('../../config/blueprint');

const queue = [];
let active = 0;
function pump(max) {
  while (active < max && queue.length) {
    const task = queue.shift();
    active += 1;
    Promise.resolve().then(task)
      .catch((e) => console.error('[blueprint] run error:', e && e.message))
      .finally(() => { active -= 1; pump(max); });
  }
}
function enqueue(task, max) { queue.push(task); pump(max || LIMITS.MAX_CONCURRENT_RUNS); }

module.exports = { enqueue, _state: () => ({ active, queued: queue.length }) };
