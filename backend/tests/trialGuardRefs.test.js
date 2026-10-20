const test = require('node:test');
const assert = require('node:assert');
const User = require('../models/User');
const quarkBuckets = require('../services/quarkBuckets');
const agency = require('../services/agency');
const { deductCredits, refundCredits } = require('../middleware/trialGuard');

function patch(obj, name, fn) { const real = obj[name]; obj[name] = fn; return () => { obj[name] = real; }; }

test('refundCredits writes opts.ref into the history entry and pays opts.payerId; existing callers are unchanged', async () => {
  const updates = [];
  const undo = [
    patch(User, 'findById', async () => ({ credits: {} })),
    patch(User, 'findByIdAndUpdate', async (id, update) => { updates.push({ id, update }); return { credits: { balance: 5 } }; }),
    patch(agency, 'resolvePayer', async (u) => ({ payerId: u, workspaceId: null })),
    patch(quarkBuckets, 'record', () => {})
  ];
  try {
    const a = await refundCredits('u1', 'blueprint', 1, 'with ref', { ref: 'bp-1', payerId: 'agency9' });
    assert.strictEqual(a.success, true);
    assert.strictEqual(updates[0].id, 'agency9', 'the recorded payer is paid, not whoever pays now');
    assert.strictEqual(updates[0].update.$push['credits.history'].$each[0].ref, 'bp-1');
    const b = await refundCredits('u1', 'blueprint', 1, 'plain');
    assert.strictEqual(b.success, true);
    assert.strictEqual('ref' in updates[1].update.$push['credits.history'].$each[0], false, 'no ref key when none was given');
  } finally { undo.forEach((f) => f()); }
});

test('deductCredits passes opts.ref to the spend so the debit carries it', async () => {
  const seen = [];
  const undo = [
    patch(quarkBuckets, 'settleWallet', async () => null),
    patch(quarkBuckets, 'spend', async (u, cost, o) => { seen.push(o); return { success: true, user: { credits: { balance: 1 } }, payerId: u, workspaceId: null }; })
  ];
  try {
    await deductCredits('u1', 'blueprint', 1, 'x', { ref: 'bp-9' });
    await deductCredits('u1', 'blueprint', 1, 'y');
    assert.strictEqual(seen[0].ref, 'bp-9');
    assert.strictEqual('ref' in seen[1], false);
  } finally { undo.forEach((f) => f()); }
});
