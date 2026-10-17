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

test('spend guard: record uses an exact dollar figure when given, and the per-unit estimate otherwise', async () => {
  const { createSpendGuard } = require('../services/spendGuard');
  const { ACTION_USD } = require('../config/apiCosts');
  const incs = [];
  const Spend = () => ({ findOne: () => ({ lean: async () => null }), findOneAndUpdate: async (f, u) => { incs.push(u.$inc.totalUsd); return { totalUsd: 1, alerted100: true, alerted70: true }; } });
  const g = createSpendGuard({ Spend, Switch: () => ({ find: () => ({ lean: async () => [] }) }), alert: async () => {}, env: {}, now: () => new Date('2026-10-17T00:00:00Z') });
  await g.record('listening_score', 1, { usd: 0.25 });
  await g.record('listening_score', 2);
  assert.strictEqual(incs[0], 0.25);
  assert.ok(Math.abs(incs[1] - ACTION_USD.listening_score * 2) < 1e-12);
});
