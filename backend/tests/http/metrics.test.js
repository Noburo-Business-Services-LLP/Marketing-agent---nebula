'use strict';
// GET /api/metrics/event-loop is staff only, tiny, and returns numbers (never customer data). The whole app, in process.
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./helpers/appHarness');

let t;
test.before(async () => { t = await boot(); });
test.after(async () => t.close());

const token = (u) => t.generateToken(u._id, 0);

test('no sign-in is 401, a normal customer is 403, on both routes', async () => {
  const customer = await t.addUser({ email: 'cust-metrics@example.test', password: 'Tr0ub4dor&3-horse' });
  assert.equal((await t.call(t.base, '/api/metrics/event-loop', { method: 'GET' })).status, 401);
  assert.equal((await t.call(t.base, '/api/metrics/event-loop', { method: 'GET', token: token(customer) })).status, 403);
  assert.equal((await t.call(t.base, '/api/metrics/event-loop/reset', { token: token(customer), body: {} })).status, 403);
});

test('staff get the event-loop numbers and memory; reset starts a new window', async () => {
  const staff = await t.addUser({ email: 'staff-metrics@example.test', password: 'Tr0ub4dor&3-horse', staffRole: 'owner' });
  await new Promise((r) => setTimeout(r, 60)); // let the 10 ms timer record a few ticks
  const r = await t.call(t.base, '/api/metrics/event-loop', { method: 'GET', token: token(staff) });
  assert.equal(r.status, 200, r.text);
  const { eventLoop, memory } = r.body;
  for (const k of ['p50', 'p90', 'p99', 'max', 'mean']) assert.equal(typeof eventLoop[k], 'number', k);
  assert.ok(eventLoop.samples > 0, 'ticks were recorded');
  assert.ok(memory.rssMb > 0 && memory.heapUsedMb > 0);
  assert.equal(r.body.customers, undefined);
  assert.equal((await t.call(t.base, '/api/metrics/event-loop/reset', { token: token(staff), body: {} })).status, 200);
  const after = await t.call(t.base, '/api/metrics/event-loop', { method: 'GET', token: token(staff) });
  assert.ok(after.body.eventLoop.samples <= eventLoop.samples + 5, 'the window restarted');
});

test('the monitor measures a blocked loop', async () => {
  const monitor = require('../../utils/eventLoopMonitor');
  monitor.reset();
  await new Promise((r) => setTimeout(r, 30));
  const end = Date.now() + 120; while (Date.now() < end) { /* block the loop */ }
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(monitor.snapshot().max >= 80, `max lag ${monitor.snapshot().max} ms`);
});

test('GET /api/metrics/queue (E9): 401 without sign-in, 403 for a customer, staff get the queue numbers of the three queues', async () => {
  const router = require('../../routes/metrics');
  const saved = router.queues;
  router.queues = {
    video: () => ({ metrics: async () => ({ queueDepth: 3, running: 2, oldestQueuedAgeSeconds: 12, byType: {}, byPool: {}, runningByWorker: { w1: 2 }, thisWorker: { workerId: 'w1', claims: 2 } }) }),
    image: () => ({ metrics: async () => ({ queueDepth: 0, running: 0, oldestQueuedAgeSeconds: 0, thisWorker: { slots: 2 } }) }),
    // Videos (Omni) consumer, E9 stage B1
    studio: () => ({ metrics: async () => ({ queueDepth: 1, running: 1, oldestQueuedAgeSeconds: 4, runningByWorker: { w1: 1 }, thisWorker: { slots: { omni: 2, cpu: 2 } } }) }),
    // Photoshoot consumer, E9 stage B2
    photoshoot: () => ({ metrics: async () => ({ queueDepth: 2, running: 0, oldestQueuedAgeSeconds: 7, runningByWorker: {}, thisWorker: { slots: { photoshoot: 2 } } }) })
  };
  try {
    const customer = await t.addUser({ email: 'cust-queue@example.test', password: 'Tr0ub4dor&3-horse' });
    const staff = await t.addUser({ email: 'staff-queue@example.test', password: 'Tr0ub4dor&3-horse', staffRole: 'owner' });
    assert.equal((await t.call(t.base, '/api/metrics/queue', { method: 'GET' })).status, 401);
    assert.equal((await t.call(t.base, '/api/metrics/queue', { method: 'GET', token: token(customer) })).status, 403);
    const r = await t.call(t.base, '/api/metrics/queue', { method: 'GET', token: token(staff) });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.videoJobs.queueDepth, 3);
    assert.deepEqual(r.body.videoJobs.runningByWorker, { w1: 2 });
    assert.equal(r.body.imageJobs.thisWorker.slots, 2);
    assert.equal(r.body.studioVideos.queueDepth, 1);
    assert.deepEqual(r.body.studioVideos.thisWorker.slots, { omni: 2, cpu: 2 });
    assert.equal(r.body.photoshoot.queueDepth, 2);
    assert.deepEqual(r.body.photoshoot.thisWorker.slots, { photoshoot: 2 });
    assert.ok(r.body.at);
  } finally { router.queues = saved; }
});
