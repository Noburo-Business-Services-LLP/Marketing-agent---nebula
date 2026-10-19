'use strict';
// The Performance view's cache: one answer per account, look (own or a staff or agency pass), range and platform, for
// 60 seconds, in memory only (the same small cache the Home summary uses). Writers of the numbers clear an account's
// entries: the daily snapshot job (services/snapshotScheduler.js) and the post measuring job (services/performanceTracker.js).
const { createSummaryCache } = require('../homeSummaryCache');

let shared = null;
const sharedCache = () => (shared = shared || createSummaryCache({ max: 2000 }));

/** Forget an account's cached answers. Never throws. */
function forgetAccount(accountId) {
  try { if (accountId) sharedCache().invalidate(String(accountId)); } catch (_) { /* never let the cache break a job */ }
}

module.exports = { sharedCache, forgetAccount };
