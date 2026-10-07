// backend/tests/requireStaff.test.js
const test = require('node:test');
const assert = require('node:assert');
const requireStaff = require('../middleware/requireStaff');

function run(mw, user) {
  return new Promise((resolve) => {
    const req = { user: user ? { _id: user._id } : null };
    const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; resolve({ req, res: this, nextCalled: false }); return this; } };
    mw(req, res, () => resolve({ req, res, nextCalled: true }));
  });
}

const users = {
  o1: { _id: 'o1', staffRole: 'owner', email: 'o@x.com' },
  a1: { _id: 'a1', staffRole: 'admin', email: 'a@x.com' },
  u1: { _id: 'u1', email: 'u@x.com' }
};
const loadUser = async (id) => users[id] || null;

test('an owner passes an owner action and gets req.staff', async () => {
  const out = await run(requireStaff('view_money', { loadUser }), users.o1);
  assert.strictEqual(out.nextCalled, true);
  assert.strictEqual(out.req.staff.staffRole, 'owner');
});

test('an admin is refused an owner-only action with a plain message', async () => {
  const out = await run(requireStaff('view_money', { loadUser }), users.a1);
  assert.strictEqual(out.nextCalled, false);
  assert.strictEqual(out.res.statusCode, 403);
  assert.match(out.res.body.message, /Your role cannot/);
});

test('a customer is refused the whole area', async () => {
  const out = await run(requireStaff('view_home', { loadUser }), users.u1);
  assert.strictEqual(out.res.statusCode, 403);
  assert.match(out.res.body.message, /for Nebulaa staff/);
});

test('no login gets 401', async () => {
  const out = await run(requireStaff('view_home', { loadUser }), null);
  assert.strictEqual(out.res.statusCode, 401);
});
