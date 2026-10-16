const test = require('node:test');
const assert = require('node:assert');
const a = require('../services/agency');

const User = (docs) => ({ findById: (id) => ({ select: () => ({ lean: async () => docs[id] || null }) }) });

test('a client is charged to its agency, and the original client is remembered for the report', async () => {
  const U = User({ w1: { agency: { ownerId: 'o1' } }, o1: {} });
  assert.deepStrictEqual(await a.resolvePayer('w1', { User: U }), { payerId: 'o1', workspaceId: 'w1' });
  assert.deepStrictEqual(await a.resolvePayer('o1', { User: U }), { payerId: 'o1', workspaceId: null });
});

test('an unknown user has no payer, so nothing can be charged', async () => {
  assert.deepStrictEqual(await a.resolvePayer('nobody', { User: User({}) }), { payerId: null, workspaceId: null });
});

test('a client whose agency is not an active agency plan has a wallet of 0', async () => {
  const docs = {
    w1: { agency: { ownerId: 'o1' } }, w2: { agency: { ownerId: 'o2' } }, w3: { agency: { ownerId: 'o3' } }, w4: { agency: { ownerId: 'o4' } },
    o1: { plan: { tier: 'agency' }, credits: { balance: 40 } },
    o2: { plan: { tier: 'free' }, credits: { balance: 40 } },
    o3: { plan: { tier: 'agency' }, credits: { balance: 40 }, subscription: { status: 'halted' } },
    o4: { plan: { tier: 'agency' }, credits: { balance: 40 }, isActive: false }
  };
  const U = { findById: (id) => ({ select: () => ({ lean: async () => docs[id] || null }) }) };
  assert.strictEqual(await a.walletBalance('w1', { User: U }), 40);
  assert.strictEqual(await a.walletBalance('w2', { User: U }), 0);
  assert.strictEqual(await a.walletBalance('w3', { User: U }), 0);
  assert.strictEqual(await a.walletBalance('w4', { User: U }), 0);
});

// ---- the payer is recorded on the job at charge time, so a refund goes back to the wallet that was charged ----
const { startHeroGeneration } = require('../services/heroVideoFlow');
const { makeDeps } = require('./heroFakes');

test('hero: a client job records the agency as payer and its refund goes to that wallet', async () => {
  const d = makeDeps({ deduct: async () => ({ success: true, payerId: 'o1', workspaceId: 'w1' }), submit: async () => { throw new Error('fal down'); } });
  const r = await startHeroGeneration(d, { userId: 'w1', body: { prompt: 'a hero shot' } });
  assert.strictEqual(r.status, 500);
  assert.strictEqual(d.JobModel.docs[0].metadata.payerId, 'o1');
  assert.strictEqual(d.calls.refund.length, 1);
  assert.deepStrictEqual(d.calls.refund[0].slice(0, 2), ['w1', 'hero_video_clip']);
  assert.deepStrictEqual(d.calls.refund[0][4], { payerId: 'o1' });
});

test('hero: for any other account nothing new is stored and the refund call is the same as before', async () => {
  const d = makeDeps({ deduct: async () => ({ success: true, payerId: 'u1', workspaceId: null }), submit: async () => { throw new Error('fal down'); } });
  await startHeroGeneration(d, { userId: 'u1', body: { prompt: 'a hero shot' } });
  assert.ok(!('payerId' in d.JobModel.docs[0].metadata));
  assert.strictEqual(d.calls.refund[0].length, 4);
});
