/**
 * The manual reminder triggers (POST /api/notifications/process, /check-now and /test) are for Nebulaa staff only
 * (tester's note 2026-10-20: any signed-in user could run the whole scheduler again and again). Campaign reminders for
 * customers keep coming from the scheduler; the reads and mark-as-read routes are unchanged.
 */
const test = require('node:test');
const assert = require('node:assert');
const p = require('../services/staff/permissions');
const router = require('../routes/notifications');

const layers = (method, path) => router.stack.filter((l) => l.route && l.route.path === path && l.route.methods[method]);

test('process, check-now and both test routes run the staff check after sign-in', () => {
  for (const path of ['/process', '/check-now', '/test']) {
    const found = layers('post', path);
    assert.ok(found.length >= 1, path);
    for (const l of found) {
      const names = l.route.stack.map((s) => s.handle);
      assert.strictEqual(names[1], router.staffOnly, `${path}: the second step is the staff check`);
    }
  }
});

test('reads and mark-as-read stay open to every signed-in user', () => {
  for (const [m, path] of [['get', '/'], ['get', '/unread-count'], ['put', '/:id/read'], ['put', '/read-all'], ['delete', '/:id'], ['delete', '/']]) {
    for (const l of layers(m, path)) assert.ok(!l.route.stack.some((s) => s.handle === router.staffOnly), `${m} ${path}`);
  }
});

test('the staff check refuses a normal user and lets owner and admin through', async () => {
  const run = async (user) => {
    const gate = require('../middleware/requireStaff')('run_jobs', { loadUser: async () => user });
    let status = 0; let passed = false;
    await gate({ user: { _id: 'u1' } }, { status(c) { status = c; return this; }, json() { return this; } }, () => { passed = true; });
    return passed ? 'next' : status;
  };
  assert.strictEqual(await run({ email: 'a@x.test' }), 403);
  assert.strictEqual(await run({ email: 'c@x.test', isCsm: true }), 403);
  assert.strictEqual(await run({ email: 'o@x.test', staffRole: 'owner' }), 'next');
  assert.strictEqual(await run({ email: 'd@x.test', staffRole: 'admin' }), 'next');
  assert.strictEqual(p.can({ staffRole: 'admin' }, 'run_jobs'), true);
});
