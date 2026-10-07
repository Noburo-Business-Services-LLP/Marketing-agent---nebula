const test = require('node:test');
const assert = require('node:assert');
const { grantStaffQuarks } = require('../services/staff/tools');

const OWNER = { _id: 'o1', staffRole: 'owner' };
const ADMIN = { _id: 'a1', staffRole: 'admin' };
function fakes() {
  const state = { balances: { o1: 350, c1: 10 }, log: [] };
  const people = { o1: { _id: 'o1', staffRole: 'owner' }, c1: { _id: 'c1' } };
  return {
    state,
    repo: { findById: async (id) => people[id] || null, grantQuarks: async (id, n) => (state.balances[id] += n) },
    record: async (a) => { state.log.push(a); }
  };
}

test('the owner can add Quarks to a team account, and it is logged', async () => {
  const f = fakes();
  const r = await grantStaffQuarks({ actor: OWNER, targetId: 'o1', amount: 500, ...f });
  assert.equal(r.status, 200);
  assert.equal(r.body.balance, 850);
  assert.equal(f.state.log[0].action, 'add_quarks');
});

test('admins, bad amounts and non-team accounts are refused and nothing changes', async () => {
  const f = fakes();
  assert.equal((await grantStaffQuarks({ actor: ADMIN, targetId: 'o1', amount: 5, ...f })).status, 403);
  assert.equal((await grantStaffQuarks({ actor: OWNER, targetId: 'o1', amount: -5, ...f })).status, 400);
  assert.equal((await grantStaffQuarks({ actor: OWNER, targetId: 'c1', amount: 5, ...f })).status, 404);
  assert.equal(f.state.balances.o1, 350);
  assert.equal(f.state.balances.c1, 10);
  assert.equal(f.state.log.length, 0);
});
