const test = require('node:test');
const assert = require('node:assert');
const { createBatchLedger } = require('../services/listening/ledger');
const NOW = new Date('2026-10-17T06:00:00Z');
test('batches and items are counted per day and per account', async () => {
  const l = createBatchLedger({ Model: null });
  await l.record({ userId: 'u1', itemIds: ['a', 'b'], at: NOW }); await l.record({ userId: 'u2', itemIds: ['c'], at: NOW });
  assert.strictEqual(await l.countBatchesToday(NOW), 2); assert.strictEqual(await l.countItemsUserToday('u1', NOW), 2);
  assert.strictEqual(await l.countItemsUserToday('u1', new Date('2026-10-18T06:00:00Z')), 0);
});
test('attempted items are remembered for 7 days even when nothing was saved', async () => {
  const l = createBatchLedger({ Model: null });
  await l.record({ userId: 'u1', itemIds: ['a'], at: NOW });
  assert.deepStrictEqual([...(await l.attempted('u1', ['a', 'b'], new Date(NOW.getTime() + 6 * 864e5)))], ['a']);
  assert.strictEqual((await l.attempted('u1', ['a'], new Date(NOW.getTime() + 8 * 864e5))).size, 0);
  assert.strictEqual((await l.attempted('u2', ['a'], NOW)).size, 0);
});
test('a database that throws never throws out of the ledger and memory still counts', async () => {
  const Model = { create: async () => { throw new Error('disk full'); }, countDocuments: async () => { throw new Error('down'); }, find: () => { throw new Error('down'); } };
  const l = createBatchLedger({ Model });
  await l.record({ userId: 'u1', itemIds: ['a'], at: NOW });
  assert.strictEqual(await l.countBatchesToday(NOW), 1); assert.ok((await l.attempted('u1', ['a'], NOW)).has('a'));
});
test('record says whether the database row was stored: true when it was, false when the write failed, memory still counts', async () => {
  const good = createBatchLedger({ Model: { create: async () => ({}) } });
  assert.strictEqual(await good.record({ userId: 'u1', itemIds: ['a'], at: NOW }), true);
  assert.strictEqual(await createBatchLedger({ Model: null }).record({ userId: 'u1', itemIds: ['a'], at: NOW }), true, 'memory only by choice');
  const bad = createBatchLedger({ Model: { create: async () => { throw new Error('validation failed'); }, countDocuments: async () => 0, find: () => { throw new Error('x'); } } });
  assert.strictEqual(await bad.record({ userId: 'u1', itemIds: ['a'], at: NOW }), false);
  assert.strictEqual(await bad.countBatchesToday(NOW), 1);
});
