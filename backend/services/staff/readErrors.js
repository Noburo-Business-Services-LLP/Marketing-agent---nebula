/**
 * Shared by the heavy staff pages: how long a database read may run, and how a failed read is worded.
 * A read that ran out of time says "took too long"; any other failure says it could not be read, so staff can tell
 * a slow database from a broken one.
 */
const MAX_TIME_MS = 20000;
/** Options for every heavy staff read. The Usage and Home aggregates can touch large collections, so they may use disk. */
const READ_OPTIONS = Object.freeze({ maxTimeMS: MAX_TIME_MS, allowDiskUse: true });

function isTimeout(error) {
  if (!error) return false;
  if (error.code === 50 || error.codeName === 'MaxTimeMSExpired') return true;
  return /exceeded time limit|operation time limit|timed out|timeout|ETIMEDOUT/i.test(String(error.message || ''));
}

/** The sentence staff see when `what` could not be read. */
function unreadable(what, error) {
  return isTimeout(error)
    ? `Reading the ${what} took too long (over ${MAX_TIME_MS / 1000} seconds), so it is left out. Try Refresh in a minute.`
    : `We could not read the ${what} right now.`;
}

module.exports = { MAX_TIME_MS, READ_OPTIONS, isTimeout, unreadable };
