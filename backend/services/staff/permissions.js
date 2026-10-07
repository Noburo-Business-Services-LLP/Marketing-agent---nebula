/**
 * Who on the Nebulaa team may do what. Pure: no database, no network.
 * The server checks every staff action with can(); the screens only hide what this refuses.
 */
const ROLES = ['owner', 'admin', 'csm'];

// [owner, admin, csm]
const TABLE = {
  view_home:          [true, true, true],
  view_clients:       [true, true, true],
  open_client:        [true, true, true],
  add_quarks:         [true, false, false],
  toggle_client:      [true, true, false],
  assign_csm:         [true, true, false],
  hide_client:        [true, true, false],
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
const ACTIONS = Object.keys(TABLE);
// Actions a CSM may take only on clients assigned to them.
const CLIENT_SCOPED = new Set(['view_home', 'view_clients', 'open_client']);

function idOf(v) {
  if (!v) return '';
  return String(v._id || v.id || v);
}

function roleOf(user) {
  if (!user) return null;
  if (ROLES.includes(user.staffRole)) return user.staffRole;
  if (user.isCsm) return 'csm';
  return null;
}

function isStaff(user) {
  return roleOf(user) !== null;
}

function can(staff, action, client) {
  const role = roleOf(staff);
  const row = TABLE[action];
  if (!role || !row) return false;
  const allowed = row[ROLES.indexOf(role)];
  if (!allowed) return false;
  if (role === 'csm' && client && CLIENT_SCOPED.has(action)) {
    return idOf(client.assignedCsm) !== '' && idOf(client.assignedCsm) === idOf(staff);
  }
  return true;
}

module.exports = { ROLES, ACTIONS, can, isStaff, roleOf };
