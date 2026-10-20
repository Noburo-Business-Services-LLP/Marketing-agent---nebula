'use strict';
// D74 item 3: how a long, paid pipeline listens to its queue job. The real pipeline reports progress WITHOUT awaiting
// (`onProgress(...)` inside a plain function), and the queue's progress call throws JobCancelledError once the job was
// cancelled, ended elsewhere or lost: an unawaited rejection is unhandled (the crash policy exits the worker) and the
// pipeline would keep paying for every image, clip and voice track. The gate keeps the promise, records the stop signal
// from `.catch`, and `check()` is called BEFORE each paid step: it throws that signal (or JobCancelledError when the
// queue's own isCancelled() says so), so a cancelled, lost or handed-back run stops quickly. It never leaves an
// unhandled rejection.
const { JobCancelledError } = require('./jobCancelled');

function createRunGate({ onProgress = null, isCancelled = null, jobId = 'unknown' } = {}) {
  let stop = null;
  const record = (err) => { if (!stop) stop = err || new JobCancelledError(jobId); };
  return {
    /** Report progress without awaiting; a rejection (or throw) becomes the stop signal instead of an unhandled rejection. */
    notify(payload) {
      if (typeof onProgress !== 'function') return;
      try {
        const p = onProgress(payload);
        if (p && typeof p.then === 'function') p.then(undefined, record);
      } catch (err) { record(err); }
    },
    /** Call before every paid step. Throws the recorded stop signal, or JobCancelledError when the queue says the job is over. */
    async check() {
      if (stop) throw stop;
      if (typeof isCancelled === 'function') {
        let over = false;
        try { over = Boolean(await isCancelled()); } catch (_) { over = false; } // unknown: the lease decides, do not stop paid work on a read error
        if (over) record(new JobCancelledError(jobId));
      }
      if (stop) throw stop;
    },
    get stopped() { return Boolean(stop); }
  };
}

module.exports = { createRunGate };
