// backend/tests/staffRoles.test.js
const test = require('node:test');
const assert = require('node:assert');
const { planRoleChange, canBootstrapOwner } = require('../services/staff/roles');
const { cleanDetails } = require('../services/staff/activityLog');

const owner = { _id: 'o1', staffRole: 'owner' };
const admin = { _id: 'a1', staffRole: 'admin' };
const user = { _id: 'u1' };

test('only an owner can make or remove admins and owners', () => {
  assert.strictEqual(planRoleChange({ actor: admin, target: user, newRole: 'admin', ownerCount: 1 }).ok, false);
  const r = planRoleChange({ actor: owner, target: user, newRole: 'admin', ownerCount: 1 });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.update, { staffRole: 'admin', isCsm: false, isHidden: true, onboardingCompleted: true });
});

test('an admin can make a CSM, which keeps the old isCsm flag in sync', () => {
  const r = planRoleChange({ actor: admin, target: user, newRole: 'csm', ownerCount: 1 });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.update, { staffRole: 'csm', isCsm: true, isHidden: true, onboardingCompleted: true });
});

test('an admin cannot change an admin or owner', () => {
  assert.strictEqual(planRoleChange({ actor: admin, target: { _id: 'a2', staffRole: 'admin' }, newRole: 'csm', ownerCount: 1 }).ok, false);
  assert.strictEqual(planRoleChange({ actor: admin, target: owner, newRole: null, ownerCount: 1 }).ok, false);
});

test('the last owner cannot be removed or demoted, even by themselves', () => {
  const r = planRoleChange({ actor: owner, target: owner, newRole: 'admin', ownerCount: 1 });
  assert.strictEqual(r.ok, false);
  assert.match(r.message, /last Owner/);
  assert.strictEqual(planRoleChange({ actor: owner, target: owner, newRole: 'admin', ownerCount: 2 }).ok, true);
});

test('removing a role clears isCsm but leaves the account hidden', () => {
  const r = planRoleChange({ actor: owner, target: { _id: 'c1', staffRole: 'csm', isCsm: true }, newRole: null, ownerCount: 1 });
  assert.deepStrictEqual(r.update, { staffRole: null, isCsm: false });
});

test('unknown roles are refused', () => {
  assert.strictEqual(planRoleChange({ actor: owner, target: user, newRole: 'king', ownerCount: 1 }).ok, false);
});

test('the first owner can be made only while there is none', () => {
  assert.strictEqual(canBootstrapOwner(0), true);
  assert.strictEqual(canBootstrapOwner(1), false);
});

test('activity details never keep secrets and stay small', () => {
  const out = cleanDetails({ amount: 100, password: 'x', apiKey: 'k', token: 't', note: 'a'.repeat(500) });
  assert.deepStrictEqual(Object.keys(out).sort(), ['amount', 'note']);
  assert.strictEqual(out.note.length, 300);
  assert.deepStrictEqual(cleanDetails(null), {});
});
