'use strict';
/** Erasure of listening data. Task 7 fills this in; until then the scorer's orphan sweep is a no-op that returns 0. */
async function sweepOrphans() { return 0; }

module.exports = { sweepOrphans };
