'use strict';
// Caps for competitor tracking. Cost safety lives here: change a number, not the code.
module.exports = {
  MAX_TRACKED: 5,          // competitors tracked (and shown) per account
  READS_PER_DAY_MAX: 200,  // profile reads per UTC day across all accounts (every read counts: tracker, staff check, customer)
  maxReadsPerAccountPerDay: 5, // profile reads per UTC day for one account, whoever triggers them
  COOLDOWN_HOURS: 12,      // minimum gap between two reads of the same competitor
  KEEP_WEEKS: 12,          // weekly snapshots kept per competitor
  FAIL_PAUSE_AFTER: 3,     // failed weeks in a row before a competitor is paused
  ACCOUNTS_PER_PASS: 60,   // most accounts read in one tracker pass (oldest read first)
  LEASE_MINUTES: 45,       // how long one tracker pass may hold the single-runner lease before it counts as dead
  THUMBS_PER_COMPETITOR: 6, // stored post pictures per competitor (best of the week, best 3 of 30 days, latest 3); postThumbs.js
  THUMBS_GLOBAL_MAX: 3000  // no new post picture once this many are stored across all accounts (about 360 x 450, at most 40 KB each)
};
