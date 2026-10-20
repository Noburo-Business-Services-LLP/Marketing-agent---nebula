'use strict';
// D74 item 1: the Smart Calendar reel (POST /items/:itemId/auto-generate) charges with a real ref and records the charge
// on the job (metadata.quarkCharge), so no flat refund guess is left. Fakes only: no database, no network.
const test = require('node:test');
const assert = require('node:assert/strict');

const geminiPath = require.resolve('../services/geminiAI');
require.cache[geminiPath] = { id: geminiPath, filename: geminiPath, loaded: true, exports: {} };
const router = require('../routes/contentCalendar');
const { calendarMonth } = require('../services/contentCalendarService');

const handler = () => {
  const layer = router.stack.find((l) => l.route && l.route.path === '/items/:itemId/auto-generate' && l.route.methods.post);
  assert.ok(layer);
  return layer.route.stack[layer.route.stack.length - 1].handle;
};
const mkRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const quiet = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };

function setup({ deduct, enqueue } = {}) {
  const item = { _id: 'i1', day: 3, format: 'Reel', headline: 'h', status: 'approved', creativeConcept: 'c' };
  const calendar = { _id: 'c1', userId: 'u1', month: calendarMonth(), weeks: [{ weekNumber: 1, items: [item] }], save: async () => {} };
  const calls = { deduct: [], refund: [], enqueue: [] };
  router.testDeps = {
    ContentCalendar: { findOne: () => ({ sort: async () => calendar }) },
    User: { findById: async () => ({ businessProfile: {} }) },
    Draft: { findOneAndUpdate: async () => ({}) },
    deductCredits: async (...a) => { calls.deduct.push(a); return deduct ? deduct(...a) : { success: true, payerId: 'agency9' }; },
    refundCredits: async (...a) => { calls.refund.push(a); return { success: true }; },
    videoGenerationQueue: { enqueue: async (j) => { calls.enqueue.push(j); if (enqueue) return enqueue(j); return { jobId: 'job1', status: 'queued', progress: 0, currentStep: 'queued' }; } }
  };
  return { calls, item };
}
const req = () => ({ user: { _id: 'u1' }, params: { itemId: 'i1' }, protocol: 'https', get: () => 'x.test', body: {} });

test('the reel is charged with a calreel ref and the job records that exact charge and payer', async () => {
  const { calls } = setup();
  const res = mkRes();
  await quiet(() => handler()(req(), res));
  assert.equal(res.code, 202);
  assert.equal(calls.deduct.length, 1);
  const [, action, count, , opts] = calls.deduct[0];
  assert.deepEqual([action, count], ['campaign_full', 1]);
  assert.match(opts.ref, /^calreel:/);
  assert.deepEqual(calls.enqueue[0].metadata.quarkCharge, [{ action: 'campaign_full', count: 1, ref: opts.ref, payerId: 'agency9' }]);
  assert.equal(calls.refund.length, 0);
  router.testDeps = undefined;
});

test('if the enqueue itself fails, the charge is refunded here once, with the same ref and payer', async () => {
  const { calls } = setup({ enqueue: async () => { throw new Error('db down'); } });
  const res = mkRes();
  await quiet(() => handler()(req(), res));
  assert.equal(res.code, 500);
  assert.equal(calls.refund.length, 1);
  assert.deepEqual(calls.refund[0].slice(1, 3), ['campaign_full', 1]);
  assert.equal(calls.refund[0][4].ref, calls.deduct[0][4].ref);
  assert.equal(calls.refund[0][4].payerId, 'agency9');
  router.testDeps = undefined;
});

test('once the job exists it owns the refund: a later failure in the route does not refund a second time', async () => {
  const { calls, item } = setup();
  router.testDeps.ContentCalendar = { findOne: () => ({ sort: async () => ({ _id: 'c1', weeks: [{ items: [item] }], save: async () => { throw new Error('save failed'); } }) }) };
  const res = mkRes();
  await quiet(() => handler()(req(), res));
  assert.equal(res.code, 500);
  assert.equal(calls.enqueue.length, 1);
  assert.equal(calls.refund.length, 0, 'the queued job refunds its recorded charge if it fails');
  router.testDeps = undefined;
});

test('no charge goes through: nothing is enqueued', async () => {
  const { calls } = setup({ deduct: async () => ({ success: false, error: 'no' }) });
  const res = mkRes();
  await quiet(() => handler()(req(), res));
  assert.equal(res.code, 403);
  assert.equal(calls.enqueue.length, 0);
  router.testDeps = undefined;
});
