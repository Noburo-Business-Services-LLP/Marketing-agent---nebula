'use strict';
/**
 * CPU slots (E9 stage A): a process-wide limit on CPU-heavy steps (ffmpeg) of the generation queue, CPU_SLOTS at once
 * (config/jobSlots.js). A job that already has its provider result waits here for a slot while it keeps its queue
 * claim (its lease keeps being renewed), so ffmpeg never blocks another user's provider call and several finishes never
 * oversubscribe the task's cores. Waiters are served first come, first served.
 */
function createSemaphore(size) {
  const max = Math.max(1, Math.floor(Number(size) || 1));
  let inUse = 0;
  const waiting = [];
  let peak = 0;

  const acquire = () => new Promise((resolve) => {
    if (inUse < max) { inUse += 1; peak = Math.max(peak, inUse); resolve(); return; }
    waiting.push(resolve);
  });
  const release = () => {
    const next = waiting.shift();
    if (next) { peak = Math.max(peak, inUse); next(); return; } // the slot passes straight to the next waiter
    inUse = Math.max(0, inUse - 1);
  };

  /** Runs fn inside a slot; the slot is released when fn settles, also when it throws. */
  async function run(fn) {
    await acquire();
    try { return await fn(); } finally { release(); }
  }

  return { run, size: max, inUse: () => inUse, waiting: () => waiting.length, peak: () => peak };
}

let shared = null;
/** The process-wide CPU pool, sized from CPU_SLOTS once. */
function cpuSlots() {
  if (!shared) shared = createSemaphore(require('../config/jobSlots').jobSlots().cpu);
  return shared;
}

module.exports = { createSemaphore, cpuSlots };
