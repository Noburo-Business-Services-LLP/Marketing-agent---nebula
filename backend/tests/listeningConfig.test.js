const test = require('node:test');
const assert = require('node:assert');
const cfg = require('../config/listening');
const { ACTION_USD, QUARK_COSTS } = require('../config/apiCosts');
const spend = require('../services/spendGuard');
test('caps and thresholds have the agreed values', () => {
  assert.strictEqual(cfg.BATCH_SIZE, 40); assert.strictEqual(cfg.MAX_ITEMS_PER_RUN, 400);
  assert.strictEqual(cfg.MIN_ITEMS, 20); assert.strictEqual(cfg.PERIOD_DAYS, 28);
  assert.deepStrictEqual(cfg.LABELS, ['pos', 'neu', 'neg']);
  assert.ok(cfg.REASONS.includes('delivery') && cfg.REASONS.includes('other'));
});
test('the scoring action is priced from rates, never charged in Quarks, and has its own staff switch', () => {
  assert.ok(ACTION_USD.listening_score > 0 && ACTION_USD.listening_score < 0.05);
  assert.strictEqual(QUARK_COSTS.listening_score, 0);
  assert.strictEqual(spend.providerOf('listening_score'), 'listening_score');
  assert.ok(spend.PROVIDERS.includes('listening_score'));
});
test('the schemas have the unique indexes and no schema key named type', () => {
  const S = require('../models/ListeningScore'); const W = require('../models/ListeningWeekly');
  const has = (M, keys) => M.schema.indexes().some(([k, o]) => o && o.unique && JSON.stringify(k) === JSON.stringify(keys));
  assert.ok(has(S, { userId: 1, inboxItemId: 1 })); assert.ok(has(W, { userId: 1, weekStart: 1 }));
  for (const M of [S, W, require('../models/ListeningBatchLog')]) assert.ok(!M.schema.path('type'));
});
