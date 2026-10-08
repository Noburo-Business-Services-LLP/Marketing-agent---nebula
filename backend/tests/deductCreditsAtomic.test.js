const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

// A tiny in-memory User: findOneAndUpdate applies the balance condition and the subtraction in ONE step, like MongoDB.
const account = { _id: 'u1', credits: { balance: 500, totalUsed: 0, history: [] } };
const UserStub = {
  findOneAndUpdate: async (q, u) => {
    await new Promise((r) => setImmediate(r)); // let concurrent calls interleave
    const min = q['credits.balance'] && q['credits.balance'].$gte;
    if (account._id !== q._id || (min !== undefined && !(account.credits.balance >= min))) return null;
    account.credits.balance += u.$inc['credits.balance'];
    account.credits.totalUsed += u.$inc['credits.totalUsed'];
    return account;
  },
  findById: () => ({ select: async () => account }),
};
const userPath = require.resolve('../models/User');
require.cache[userPath] = { id: userPath, filename: userPath, loaded: true, exports: UserStub };
const { deductCredits, CREDIT_COSTS } = require('../middleware/trialGuard');

test('many requests at the same moment cannot overdraw an account', async () => {
  const action = Object.keys(CREDIT_COSTS).find((k) => CREDIT_COSTS[k] > 0 && CREDIT_COSTS[k] <= 500);
  const cost = CREDIT_COSTS[action];
  account.credits.balance = cost; // exactly enough for one
  const results = await Promise.all(Array.from({ length: 25 }, () => deductCredits('u1', action, 1, 'race')));
  assert.equal(results.filter((r) => r.success).length, 1);
  assert.equal(account.credits.balance, 0);
  assert.ok(results.filter((r) => !r.success).every((r) => /Insufficient Quarks/.test(r.error)));
});
