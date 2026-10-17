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
  LEASE_MINUTES: 45        // how long one tracker pass may hold the single-runner lease before it counts as dead
};
