// backend/tests/staffPermissions.test.js
const test = require('node:test');
const assert = require('node:assert');
const p = require('../services/staff/permissions');

const owner = { _id: 'o1', staffRole: 'owner' };
const admin = { _id: 'a1', staffRole: 'admin' };
const csm = { _id: 'c1', staffRole: 'csm' };
const legacyCsm = { _id: 'c2', isCsm: true };
const nobody = { _id: 'u1' };
const mine = { assignedCsm: 'c1' };
const other = { assignedCsm: 'c9' };

test('roleOf reads staffRole and treats the old isCsm flag as csm', () => {
  assert.strictEqual(p.roleOf(owner), 'owner');
  assert.strictEqual(p.roleOf(legacyCsm), 'csm');
  assert.strictEqual(p.roleOf(nobody), null);
  assert.strictEqual(p.isStaff(nobody), false);
  assert.strictEqual(p.isStaff(csm), true);
});

test('the table matches the spec', () => {
  const expect = {
    view_home:          [true, true, true],
    view_clients:       [true, true, true],
    open_client:        [true, true, true],
    add_quarks:         [true, false, false],
    toggle_client:      [true, true, false],
    assign_csm:         [true, true, false],
    add_csm:            [true, true, false],
    manage_admins:      [true, false, false],
    reset_accounts:     [true, false, false],
    view_money:         [true, false, false],
    view_usage_full:    [true, false, false],
    view_usage_summary: [true, true, false],
    manage_coupons:     [true, false, false],
    export_csv:         [true, false, false],
    view_activity_all:  [true, true, false]
  };
  for (const [action, [o, a, c]] of Object.entries(expect)) {
    assert.strictEqual(p.can(owner, action), o, `owner ${action}`);
    assert.strictEqual(p.can(admin, action), a, `admin ${action}`);
    assert.strictEqual(p.can(csm, action, mine), c, `csm ${action}`);
  }
  assert.deepStrictEqual([...p.ACTIONS].sort(), Object.keys(expect).sort());
});

test('a CSM is limited to their own clients for client actions', () => {
  assert.strictEqual(p.can(csm, 'open_client', mine), true);
  assert.strictEqual(p.can(csm, 'open_client', other), false);
  assert.strictEqual(p.can(csm, 'open_client'), true); // list-level check, results filtered elsewhere
  assert.strictEqual(p.can(csm, 'view_clients', other), false);
});

test('non-staff and unknown actions are always refused', () => {
  assert.strictEqual(p.can(nobody, 'view_home'), false);
  assert.strictEqual(p.can(owner, 'launch_rockets'), false);
  assert.strictEqual(p.can(null, 'view_home'), false);
});
