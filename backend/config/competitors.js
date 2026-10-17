'use strict';
// Caps for competitor tracking. Cost safety lives here: change a number, not the code.
module.exports = {
  MAX_TRACKED: 5,          // competitors tracked per account
  READS_PER_DAY_MAX: 200,  // profile reads per day across all accounts
  COOLDOWN_HOURS: 12,      // minimum gap between two reads of the same competitor
  KEEP_WEEKS: 12,          // weekly snapshots kept per competitor
  FAIL_PAUSE_AFTER: 3      // failed weeks in a row before a competitor is paused
};
