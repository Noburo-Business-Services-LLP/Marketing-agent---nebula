const test = require('node:test');
const assert = require('node:assert');
const { eligibleAccount } = require('../services/listening/entitlement');
const { listeningStore } = require('../services/listening/store');
test('staff, CSM, inactive, not onboarded and blocked accounts are never eligible; free accounts are not entitled', () => {
  const base = { isActive: true, onboardingCompleted: true, plan: { tier: 'agency' } };
  const { canUse } = require('../config/entitlements');
  const entitled = canUse(base, 'inbox').allowed;
  assert.strictEqual(entitled, true);
  assert.strictEqual(eligibleAccount(base, {}), true);
  assert.strictEqual(eligibleAccount({ isActive: true, onboardingCompleted: true, plan: { tier: 'starter', addons: [] } }, {}), false);
  assert.strictEqual(eligibleAccount({ ...base, staffRole: 'admin' }, {}), false);
  assert.strictEqual(eligibleAccount({ ...base, isCsm: true }, {}), false);
  assert.strictEqual(eligibleAccount({ ...base, isActive: false }, {}), false);
  assert.strictEqual(eligibleAccount({ ...base, onboardingCompleted: false }, {}), false);
  assert.strictEqual(eligibleAccount({ ...base, _id: 'x' }, { blocked: new Set(['x']) }), false);
  assert.strictEqual(eligibleAccount({ isActive: true, onboardingCompleted: true, plan: { tier: 'free' } }, {}), false);
});
test('saveScores upserts without ever overwriting an existing label', async () => {
  let captured;
  const Score = { bulkWrite: async (ops) => { captured = ops; return {}; } };
  const s = listeningStore({ Score });
  await s.saveScores('u1', [{ inboxItemId: 'i1', platform: 'instagram', kind: 'public', label: 'pos', reason: 'praise', itemAt: new Date(), scoredAt: new Date(), modelVersion: 'listen-1' }]);
  const op = captured[0].updateOne;
  assert.deepStrictEqual(Object.keys(op.update), ['$setOnInsert']);
  assert.strictEqual(op.upsert, true);
  assert.deepStrictEqual(op.filter, { userId: 'u1', inboxItemId: 'i1' });
});
