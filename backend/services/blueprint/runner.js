'use strict';
// A tiny in-process FIFO with a concurrency cap, one queue per lane. No timers, so a test process exits by itself.
// Errors are logged and never thrown. The default lane is for customer Blueprints; the 'plan' lane holds the
// system's own plan runs (one at a time) so a batch of them can never delay a customer's Blueprint.
const { LIMITS } = require('../../config/blueprint');

const lanes = new Map();
const laneOf = (name) => {
  if (!lanes.has(name)) lanes.set(name, { queue: [], active: 0 });
  return lanes.get(name);
};
function pump(lane, max) {
  while (lane.active < max && lane.queue.length) {
    const task = lane.queue.shift();
    lane.active += 1;
    Promise.resolve().then(task)
      .catch((e) => console.error('[blueprint] run error:', e && e.message))
      .finally(() => { lane.active -= 1; pump(lane, max); });
  }
}
function enqueue(task, max, lane = 'default') {
  const l = laneOf(lane);
  l.queue.push(task);
  pump(l, lane === 'plan' ? 1 : (max || LIMITS.MAX_CONCURRENT_RUNS));
}

const sum = (k) => [...lanes.values()].reduce((n, l) => n + (k === 'queued' ? l.queue.length : l.active), 0);
module.exports = { enqueue, _state: () => ({ active: sum('active'), queued: sum('queued') }) };
