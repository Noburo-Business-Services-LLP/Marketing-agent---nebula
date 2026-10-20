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
