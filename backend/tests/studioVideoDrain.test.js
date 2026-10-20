'use strict';
// scripts/studio-video-drain-queued.js, the pure part, with fakes. Never touches a database.
const test = require('node:test');
const assert = require('node:assert');
const { drainQueued, explicitDbName, REASON } = require('../scripts/studio-video-drain-queued');

function fakeModel(rows) {
  return {
    countDocuments: async (q) => rows.filter((r) => r.status === q.status).length,
    find: (q) => ({ limit: (n) => ({ lean: async () => rows.filter((r) => r.status === q.status && !(q._id && q._id.$nin.includes(r._id))).slice(0, n).map((r) => ({ ...r })) }) })
  };
}

test('explicitDbName reads the database from a connection string and is empty when there is none', () => {
  assert.strictEqual(explicitDbName('mongodb+srv://u:p@cluster0.example.mongodb.net/nebulaa_dev?retryWrites=true'), 'nebulaa_dev');
  assert.strictEqual(explicitDbName('mongodb://localhost:27017/zz_test'), 'zz_test');
  assert.strictEqual(explicitDbName('mongodb+srv://u:p@cluster0.example.mongodb.net/?retryWrites=true'), '');
  assert.strictEqual(explicitDbName('mongodb://localhost:27017'), '');
  assert.strictEqual(explicitDbName(''), '');
  assert.strictEqual(explicitDbName(undefined), '');
  assert.strictEqual(explicitDbName('not a uri'), '');
});

test('dry run counts the queued videos and closes nothing', async () => {
  const rows = [{ _id: 'a', status: 'queued' }, { _id: 'b', status: 'queued' }, { _id: 'c', status: 'processing' }];
  let called = 0;
  const out = await drainQueued({ model: fakeModel(rows), fail: async () => { called += 1; return {}; }, dryRun: true });
  assert.deepStrictEqual(out, { queued: 2, closed: 0, notClosed: 0, dryRun: true });
  assert.strictEqual(called, 0);
});

test('acting closes each queued video through the refund path with the queued filter, drops its clips, and leaves the others alone', async () => {
  const rows = [{ _id: 'a', status: 'queued', clipUrls: ['u1'] }, { _id: 'b', status: 'queued' }, { _id: 'c', status: 'processing' }];
  const calls = []; const dropped = [];
  const fail = async (row, message, filter) => { calls.push([row._id, message, filter]); const r = rows.find((x) => x._id === row._id); r.status = 'failed'; return { ...r }; };
  const out = await drainQueued({ model: fakeModel(rows), fail, dropClips: async (u) => { dropped.push(...u); }, dryRun: false, batch: 1 });
  assert.deepStrictEqual(out, { queued: 2, closed: 2, notClosed: 0, dryRun: false });
  assert.deepStrictEqual(calls.map((c) => c[0]), ['a', 'b']);
  assert.ok(calls.every((c) => c[1] === REASON && JSON.stringify(c[2]) === '{"status":"queued"}'));
  assert.deepStrictEqual(dropped, ['u1']);
  assert.strictEqual(rows.find((r) => r._id === 'c').status, 'processing');
});

test('a video that cannot be closed (proof unreadable, or taken meanwhile) is counted, not retried forever, and does not stop the rest', async () => {
  const rows = [{ _id: 'a', status: 'queued' }, { _id: 'b', status: 'queued' }, { _id: 'c', status: 'queued' }];
  const fail = async (row) => {
    if (row._id === 'a') return null;
    if (row._id === 'b') throw new Error('database down');
    rows.find((x) => x._id === row._id).status = 'failed'; return { _id: row._id };
  };
  const out = await drainQueued({ model: fakeModel(rows), fail, dryRun: false, batch: 2 });
  assert.deepStrictEqual(out, { queued: 3, closed: 1, notClosed: 2, dryRun: false });
});

test('the reason is plain words for the customer and says the Quarks were returned', () => {
  assert.match(REASON, /Your Quarks were returned/);
});
