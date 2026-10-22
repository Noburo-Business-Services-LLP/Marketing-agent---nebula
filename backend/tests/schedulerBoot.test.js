// Starts each background scheduler with the real default logger (no override). The logger.log alias bug
// (F-18) only showed up this way: every other test passed a stub logger.
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');

const logger = require('../utils/logger');
const mongoose = require('mongoose');
// no database here: fail queries at once instead of buffering for 10 s and holding the process open
mongoose.set('bufferCommands', false);

test('default logger keeps a console-shaped log() function', () => {
  assert.equal(typeof logger.log, 'function');
  assert.notEqual(logger.log, logger);
  for (const k of ['info', 'warn', 'error', 'debug']) assert.equal(typeof logger[k], 'function');
});

const STARTERS = [
  ['campaignScheduler', 'startCampaignScheduler'],
  ['contentCalendarService', 'startContentCalendarScheduler'],
  ['performanceTracker', 'startPerformanceTrackerScheduler'],
  ['billingScheduler', 'startBillingScheduler'],
  ['accountDeletion', 'startAccountPurge'],
  ['renewalReminders', 'startRenewalReminders'],
  ['memoryDistillation', 'startMemoryDistillationScheduler']
];

for (const [file, name] of STARTERS) {
  test(`${name} starts with the real default logger and stops cleanly`, async () => {
    const fn = require(`../services/${file}`)[name];
    assert.equal(typeof fn, 'function');
    let stop;
    assert.doesNotThrow(() => { stop = fn({ intervalMs: 3_600_000 }); });
    assert.equal(typeof stop, 'function', `${name} must return a stop function`);
    assert.doesNotThrow(() => stop());
  });
}

