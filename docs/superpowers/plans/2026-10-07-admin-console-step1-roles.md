# Admin Console Step 1 (Roles and Access) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give staff (Owner, Admin, CSM) their own roles on normal accounts, enforce what each role may do on the server, log staff actions, let the founder become Owner once, and add an empty Staff area shell to the app.

**Architecture:** A pure permission table in `backend/services/staff/permissions.js` is the single source of truth; a `requireStaff(action)` middleware uses it on a new `/api/staff` router. `staffRole` lives on User; the existing `isCsm` flag is kept in sync. A `StaffAction` collection records actions. The frontend gets `/staff` routes with their own menu; pages after Home are empty shells filled in later steps.

**Tech Stack:** Node/Express/Mongoose backend, tests with Node's built-in `node --test` (run from `backend/`: `node --test tests/*.test.js`); React 19 + TypeScript + Vite frontend, tests `node --test tests/*.test.*` from `frontend/`, type check `npx tsc --noEmit` (3 known pre-existing errors: AdminDashboard.tsx(9), AdminLogin.tsx(4), Influencers.tsx(93)).

**Spec:** `docs/superpowers/specs/2026-10-07-admin-console-design.md` (section 1 and Architecture).

## Global Constraints
- Roles are exactly `'owner' | 'admin' | 'csm'`; field `staffRole` on User, default `null`.
- Keep `isCsm` true whenever `staffRole === 'csm'` so live CSM features (`services/csmAccess.js`, `/api/csm`) keep working.
- The last Owner cannot be removed or demoted; only an Owner can create or remove Admins or Owners.
- First-Owner bootstrap works only while no Owner exists.
- Staff accounts are `isHidden: true` (kept out of customer numbers).
- Customer-facing and staff-facing text: plain professional sentences; `frontend/scripts/voice-audit.mjs` and `brand-audit.mjs` must report 0 violations; never show vendor names or raw errors.
- Route files must declare limiters before routes use them (`backend/tests/routeOrder.test.js`).
- Never log secrets in `StaffAction.details`.

---

### Task 1: Permission table

**Files:**
- Create: `backend/services/staff/permissions.js`
- Test: `backend/tests/staffPermissions.test.js`

**Interfaces:**
- Produces: `ROLES` (array), `ACTIONS` (array of action names), `can(staff, action, client?) -> boolean`, `isStaff(user) -> boolean`, `roleOf(user) -> 'owner'|'admin'|'csm'|null`.
  - `staff` is a user-like object `{ _id, staffRole, isCsm }`; `client` is `{ assignedCsm }` (only used for CSM scoping).

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run it and see it fail**

Run (from `backend/`): `node --test tests/staffPermissions.test.js`
Expected: FAIL, `Cannot find module '../services/staff/permissions'`.

- [ ] **Step 3: Implement**

```js
// backend/services/staff/permissions.js
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
```

- [ ] **Step 4: Run it and see it pass**

Run: `node --test tests/staffPermissions.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/services/staff/permissions.js backend/tests/staffPermissions.test.js
git commit -m "feat(staff): permission table for owner, admin and CSM"
```

---

### Task 2: Role field, role changes and the activity log

**Files:**
- Modify: `backend/models/User.js` (next to `isCsm`)
- Create: `backend/models/StaffAction.js`
- Create: `backend/services/staff/roles.js`
- Create: `backend/services/staff/activityLog.js`
- Test: `backend/tests/staffRoles.test.js`

**Interfaces:**
- Consumes: `roleOf`, `ROLES` from Task 1.
- Produces:
  - `planRoleChange({ actor, target, newRole, ownerCount }) -> { ok: true, update } | { ok: false, message }` (pure). `update` is a Mongo `$set` object.
  - `canBootstrapOwner(ownerCount) -> boolean` (pure).
  - `cleanDetails(obj) -> obj` (pure; drops keys that look secret, trims strings to 300 chars, keeps at most 20 keys).
  - `recordStaffAction({ actor, action, client, details }) -> Promise<void>` (never throws).

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run it and see it fail**

Run: `node --test tests/staffRoles.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

In `backend/models/User.js`, directly above `isCsm: { type: Boolean, default: false },` add:

```js
  // Nebulaa team role: 'owner' | 'admin' | 'csm' (null for customers). See services/staff/permissions.js.
  staffRole: { type: String, enum: ['owner', 'admin', 'csm', null], default: null, index: true },
```

In `toPublicJSON`, after `isCsm: Boolean(this.isCsm),` add `staffRole: this.staffRole || null,`.

```js
// backend/models/StaffAction.js
const mongoose = require('mongoose');

// One row per action a Nebulaa staff member takes (add Quarks, disable, assign, role change, reset, open account).
const staffActionSchema = new mongoose.Schema({
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  actorRole: { type: String, default: '' },
  action: { type: String, required: true, index: true },
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  details: { type: mongoose.Schema.Types.Mixed, default: {} },
  at: { type: Date, default: Date.now, index: true }
});

module.exports = mongoose.models.StaffAction || mongoose.model('StaffAction', staffActionSchema);
```

```js
// backend/services/staff/roles.js
const { ROLES, roleOf } = require('./permissions');

function canBootstrapOwner(ownerCount) {
  return Number(ownerCount) === 0;
}

/**
 * Works out the change to a person's staff role, or why it is not allowed. Pure.
 * newRole: 'owner' | 'admin' | 'csm' | null (null removes the role).
 */
function planRoleChange({ actor, target, newRole, ownerCount }) {
  const actorRole = roleOf(actor);
  const currentRole = roleOf(target);
  if (newRole !== null && !ROLES.includes(newRole)) return { ok: false, message: 'That role does not exist.' };
  if (actorRole !== 'owner' && actorRole !== 'admin') return { ok: false, message: 'Your role cannot change roles.' };

  const touchesSenior = ['owner', 'admin'].includes(newRole) || ['owner', 'admin'].includes(currentRole);
  if (touchesSenior && actorRole !== 'owner') return { ok: false, message: 'Only the Owner can add or remove Admins and Owners.' };

  if (currentRole === 'owner' && newRole !== 'owner' && Number(ownerCount) <= 1) {
    return { ok: false, message: 'The last Owner cannot be removed or changed. Add another Owner first.' };
  }

  if (newRole === null) return { ok: true, update: { staffRole: null, isCsm: false } };
  return { ok: true, update: { staffRole: newRole, isCsm: newRole === 'csm', isHidden: true, onboardingCompleted: true } };
}

module.exports = { planRoleChange, canBootstrapOwner };
```

```js
// backend/services/staff/activityLog.js
const SECRET_KEY = /pass|secret|token|key|otp|card|cvv/i;

function cleanDetails(obj) {
  if (!obj || typeof obj !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(obj).slice(0, 20)) {
    if (SECRET_KEY.test(k)) continue;
    out[k] = typeof v === 'string' ? v.slice(0, 300) : v;
  }
  return out;
}

async function recordStaffAction({ actor, action, client = null, details = {} }) {
  try {
    const StaffAction = require('../../models/StaffAction');
    const { roleOf } = require('./permissions');
    await StaffAction.create({ actor: actor._id, actorRole: roleOf(actor) || '', action, client: client ? (client._id || client) : null, details: cleanDetails(details) });
  } catch (error) {
    console.error('[staff] could not record action:', error.message);
  }
}

module.exports = { cleanDetails, recordStaffAction };
```

- [ ] **Step 4: Run it and see it pass**

Run: `node --test tests/staffRoles.test.js`, then the full suite `node --test tests/*.test.js`.
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/models/User.js backend/models/StaffAction.js backend/services/staff/roles.js backend/services/staff/activityLog.js backend/tests/staffRoles.test.js
git commit -m "feat(staff): staffRole field, role-change rules and staff activity log"
```

---

### Task 3: requireStaff middleware and the staff API (me, team roles)

**Files:**
- Create: `backend/middleware/requireStaff.js`
- Create: `backend/routes/staff.js`
- Modify: `backend/server-main.js` (require and mount next to `csmRoutes`)
- Test: `backend/tests/requireStaff.test.js`

**Interfaces:**
- Consumes: `can`, `roleOf`, `isStaff` (Task 1); `planRoleChange` (Task 2); `recordStaffAction` (Task 2).
- Produces:
  - `requireStaff(action, { loadUser }?)` Express middleware. Sets `req.staff` (lean user with `_id, email, firstName, lastName, staffRole, isCsm`). 403 JSON `{ success:false, message }` when refused.
  - `GET /api/staff/me` -> `{ success, staff: { id, name, email, role }, can: { [action]: boolean } }`.
  - `POST /api/staff/team/:id/role` body `{ role: 'owner'|'admin'|'csm'|null }` -> `{ success, data: { id, role } }` (requires `add_csm` for csm, `manage_admins` otherwise; enforced by `planRoleChange`).

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run it and see it fail**

Run: `node --test tests/requireStaff.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```js
// backend/middleware/requireStaff.js
const { can, isStaff } = require('../services/staff/permissions');

function defaultLoadUser(id) {
  return require('../models/User').findById(id).select('email firstName lastName staffRole isCsm isActive').lean();
}

/** Use after `protect`. Refuses anyone whose staff role does not allow `action`. */
function requireStaff(action, { loadUser = defaultLoadUser } = {}) {
  return async (req, res, next) => {
    const id = req.user?._id || req.user?.id;
    if (!id) return res.status(401).json({ success: false, message: 'Please sign in.' });
    let staff;
    try {
      staff = await loadUser(id);
    } catch (error) {
      return res.status(500).json({ success: false, message: 'We could not check your access right now. Please try again.' });
    }
    if (!staff || staff.isActive === false || !isStaff(staff)) {
      return res.status(403).json({ success: false, message: 'This area is for Nebulaa staff.' });
    }
    if (!can(staff, action)) {
      return res.status(403).json({ success: false, message: 'Your role cannot do this.' });
    }
    req.staff = staff;
    next();
  };
}

module.exports = requireStaff;
```

```js
// backend/routes/staff.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const requireStaff = require('../middleware/requireStaff');
const { ACTIONS, can, roleOf } = require('../services/staff/permissions');
const { planRoleChange } = require('../services/staff/roles');
const { recordStaffAction } = require('../services/staff/activityLog');

router.use(protect);

// GET /api/staff/me: who I am and what my role may do (the screens use this to show or hide things).
router.get('/me', requireStaff('view_home'), (req, res) => {
  const s = req.staff;
  res.json({
    success: true,
    staff: { id: String(s._id), name: [s.firstName, s.lastName].filter(Boolean).join(' ') || s.email, email: s.email, role: roleOf(s) },
    can: Object.fromEntries(ACTIONS.map((a) => [a, can(s, a)]))
  });
});

// POST /api/staff/team/:id/role { role }: make someone Owner, Admin or CSM, or remove their role.
router.post('/team/:id/role', requireStaff('add_csm'), async (req, res) => {
  try {
    const newRole = req.body?.role === undefined ? undefined : (req.body.role || null);
    if (newRole === undefined) return res.status(400).json({ success: false, message: 'Choose a role.' });
    const target = await User.findById(req.params.id).select('email staffRole isCsm').lean();
    if (!target) return res.status(404).json({ success: false, message: 'That person was not found.' });
    const ownerCount = await User.countDocuments({ staffRole: 'owner' });
    const plan = planRoleChange({ actor: req.staff, target, newRole, ownerCount });
    if (!plan.ok) return res.status(403).json({ success: false, message: plan.message });
    await User.updateOne({ _id: target._id }, { $set: plan.update });
    if (newRole !== 'csm' && roleOf(target) === 'csm') {
      await User.updateMany({ assignedCsm: target._id }, { $set: { assignedCsm: null } });
    }
    await recordStaffAction({ actor: req.staff, action: 'role_change', client: target._id, details: { from: roleOf(target), to: newRole } });
    res.json({ success: true, data: { id: String(target._id), role: newRole } });
  } catch (error) {
    console.error('[staff] role change failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not change the role.' });
  }
});

module.exports = router;
```

In `backend/server-main.js`, next to `const csmRoutes = require('./routes/csm');` add `const staffRoutes = require('./routes/staff');` and next to `app.use('/api/csm', csmRoutes);` add `app.use('/api/staff', staffRoutes);`.

- [ ] **Step 4: Run it and see it pass**

Run: `node --test tests/requireStaff.test.js`, `node --check routes/staff.js server-main.js`, then `node --test tests/*.test.js`.
Expected: all PASS, including `routeOrder.test.js`.

- [ ] **Step 5: Commit**

```bash
git add backend/middleware/requireStaff.js backend/routes/staff.js backend/server-main.js backend/tests/requireStaff.test.js
git commit -m "feat(staff): requireStaff middleware, /api/staff/me and role changes"
```

---

### Task 4: First Owner from the old admin login, and old CSM routes write staffRole

**Files:**
- Modify: `backend/routes/admin.js` (new route before `router.post('/users/:id/assign-csm'`; edits to `POST /users/:id/csm` and `POST /csm-accounts`)
- Modify: `frontend/pages/AdminDashboard.tsx` (one button and handler next to "+ Add CSM")
- Test: covered by `canBootstrapOwner` in Task 2; run full suites.

**Interfaces:**
- Consumes: `canBootstrapOwner` (Task 2), `recordStaffAction` (Task 2).
- Produces: `POST /api/admin/make-owner { email }` (adminAuth) -> `{ success, data: { email } }`; refused with 409 once an Owner exists.

- [ ] **Step 1: Add the route** (in `backend/routes/admin.js`, before `router.post('/users/:id/assign-csm', adminAuth,`):

```js
// One-time door: the shared admin login makes one account the Owner. Refused once an Owner exists.
router.post('/make-owner', adminAuth, async (req, res) => {
  try {
    const { canBootstrapOwner } = require('../services/staff/roles');
    const ownerCount = await User.countDocuments({ staffRole: 'owner' });
    if (!canBootstrapOwner(ownerCount)) return res.status(409).json({ success: false, message: 'An Owner already exists. The Owner can add more people from the Staff area.' });
    const email = String(req.body?.email || '').trim().toLowerCase();
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ success: false, message: 'No account uses that email. Sign up with it first.' });
    user.staffRole = 'owner';
    user.isCsm = false;
    user.isHidden = true;
    user.onboardingCompleted = true;
    await user.save();
    res.json({ success: true, data: { email: user.email } });
  } catch (error) {
    console.error('[admin] make owner failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not make the Owner.' });
  }
});
```

- [ ] **Step 2: Keep the old CSM routes in step with roles**

In `POST /users/:id/csm`, change the `$set` for `makeCsm` to include `staffRole: 'csm'`, and for un-ticking add `staffRole: null` — but never touch an Owner or Admin: add before the update
```js
    const current = await User.findById(req.params.id).select('staffRole').lean();
    if (current && ['owner', 'admin'].includes(current.staffRole)) return res.status(400).json({ success: false, message: 'Owners and Admins are managed from the Staff area.' });
```
In `POST /csm-accounts`, set `user.staffRole = user.staffRole === 'owner' || user.staffRole === 'admin' ? user.staffRole : 'csm';` for existing users and `staffRole: 'csm'` for new ones.

- [ ] **Step 3: Button in the old admin page**

In `frontend/pages/AdminDashboard.tsx`, add a handler beside `resetAyrshare`:
```tsx
  const makeOwner = async () => {
    const email = window.prompt('Enter the email of the account that should become the Owner. This works only once, while no Owner exists.');
    if (!email) return;
    try {
      const res = await adminFetch('/make-owner', { method: 'POST', body: JSON.stringify({ email }) });
      setAdminActionMsg(res.success ? `${res.data.email} is now the Owner. Sign in with it to open the Staff area.` : (res.message || 'Could not make the Owner.'));
    } catch { setAdminActionMsg('Could not make the Owner.'); }
  };
```
and a button before "Reset Ayrshare IDs":
```tsx
                        <button onClick={makeOwner} className="flex-shrink-0 px-3 py-2.5 rounded-xl text-xs font-medium bg-white/[0.04] text-white/70 border border-white/[0.06] hover:text-white">
                          Make Owner
                        </button>
```

- [ ] **Step 4: Run checks**

Backend: `node --check routes/admin.js && node --test tests/*.test.js`. Frontend: `npx tsc --noEmit` (3 known errors only), `node scripts/voice-audit.mjs` (0), `node --test tests/*.test.*`.
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/admin.js frontend/pages/AdminDashboard.tsx
git commit -m "feat(staff): one-time Make Owner from the old admin page; CSM routes write staffRole"
```

---

### Task 5: Staff area shell in the app

**Files:**
- Modify: `frontend/services/api.ts` (add `getStaffMe`)
- Modify: `frontend/types.ts` (`staffRole?: 'owner' | 'admin' | 'csm' | null` on `User`)
- Create: `frontend/pages/staff/StaffLayout.tsx`
- Create: `frontend/pages/staff/StaffHome.tsx`
- Modify: `frontend/App.tsx` (routes `/staff`, `/staff/:section`)
- Modify: `frontend/components/Layout.tsx` (menu item "Staff area" for staff)

**Interfaces:**
- Consumes: `GET /api/staff/me` (Task 3); `user.staffRole` / `user.isCsm` from `/auth/me` and sign-in (Task 2 adds `staffRole` to `toPublicJSON`).
- Produces: `apiService.getStaffMe(): Promise<{ success: boolean; staff: { id: string; name: string; email: string; role: 'owner'|'admin'|'csm' }; can: Record<string, boolean> }>`; `StaffLayout` takes `children` and the `can` map; sections `home | clients | team | money | usage`.

- [ ] **Step 1: API and type**

```ts
  getStaffMe: async (): Promise<{ success: boolean; staff: { id: string; name: string; email: string; role: 'owner' | 'admin' | 'csm' }; can: Record<string, boolean> }> => {
    return apiCall('/staff/me', { method: 'GET' }, true);
  },
```
Add `staffRole?: 'owner' | 'admin' | 'csm' | null;` to `export interface User` in `frontend/types.ts`.

- [ ] **Step 2: Layout with its own menu**

```tsx
// frontend/pages/staff/StaffLayout.tsx
import React, { useEffect, useState } from 'react';
import { NavLink, useParams } from 'react-router-dom';
import { Loader2, Home, Users, UserCog, Wallet, BarChart3 } from 'lucide-react';
import { apiService } from '../../services/api';
import { customerMessage } from '../../utils/errors';
import StaffHome from './StaffHome';

const SECTIONS = [
  { id: 'home', label: 'Home', icon: Home, needs: 'view_home' },
  { id: 'clients', label: 'Clients', icon: Users, needs: 'view_clients' },
  { id: 'team', label: 'Team', icon: UserCog, needs: 'add_csm' },
  { id: 'money', label: 'Money', icon: Wallet, needs: 'view_money' },
  { id: 'usage', label: 'Usage', icon: BarChart3, needs: 'view_usage_summary' }
] as const;

const NEXT_STEP: Record<string, string> = {
  clients: 'The client list and client pages arrive in the next release.',
  team: 'Team management arrives in a later release.',
  money: 'Revenue, payments and renewals arrive in a later release.',
  usage: 'Feature use and the sign-up funnel arrive in a later release.'
};

/** The Nebulaa staff area: its own menu, shown only to the Owner, Admins and CSMs. */
const StaffLayout: React.FC = () => {
  const { section = 'home' } = useParams();
  const [me, setMe] = useState<Awaited<ReturnType<typeof apiService.getStaffMe>> | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    apiService.getStaffMe().then(setMe).catch((e) => setError(customerMessage(e)));
  }, []);

  if (error) return <div className="max-w-xl mx-auto mt-16 text-center text-[var(--gv-text)]">{error}</div>;
  if (!me) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-[#F5A623]" /></div>;

  const visible = SECTIONS.filter((s) => me.can[s.needs]);
  const current = visible.find((s) => s.id === section) || visible[0];

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[#B7791F]">Staff area</p>
          <h1 className="text-2xl font-semibold text-[var(--gv-text)]">{current?.label}</h1>
        </div>
        <p className="text-sm text-[var(--gv-text-muted)]">{me.staff.name} · {me.staff.role === 'owner' ? 'Owner' : me.staff.role === 'admin' ? 'Admin' : 'CSM'}</p>
      </div>
      <nav className="mb-6 flex flex-wrap gap-2 border-b border-[var(--gv-border-subtle)]">
        {visible.map((s) => {
          const Icon = s.icon;
          return (
            <NavLink key={s.id} to={`/staff/${s.id}`} className={() => `flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px ${current?.id === s.id ? 'border-[#F5A623] text-[#B7791F]' : 'border-transparent text-[var(--gv-text-muted)]'}`}>
              <Icon className="w-4 h-4" /> {s.label}
            </NavLink>
          );
        })}
      </nav>
      {current?.id === 'home' ? <StaffHome role={me.staff.role} /> : <p className="py-16 text-center text-[var(--gv-text-muted)]">{NEXT_STEP[current?.id || ''] || ''}</p>}
    </div>
  );
};

export default StaffLayout;
```

```tsx
// frontend/pages/staff/StaffHome.tsx
import React from 'react';

/** Step 1: a short welcome. Health, attention needed and growth arrive in the Home release. */
const StaffHome: React.FC<{ role: 'owner' | 'admin' | 'csm' }> = ({ role }) => (
  <div className="rounded-2xl border border-[var(--gv-border-subtle)] bg-[var(--gv-panel)] p-6">
    <p className="text-[var(--gv-text)]">
      {role === 'csm'
        ? 'This is your staff area. Your clients are listed under Clients once that release is out. Until then, use My clients in the main menu.'
        : 'This is the Nebulaa staff area. Health, clients that need attention and growth numbers appear here in the next releases.'}
    </p>
  </div>
);

export default StaffHome;
```

Note: if the token names `--gv-text`, `--gv-text-muted`, `--gv-border-subtle`, `--gv-panel` differ in `frontend/index.html`, use the names defined there (grep `--gv-` in `frontend/index.html`) and keep the light theme.

- [ ] **Step 3: Routes and menu item**

In `frontend/App.tsx`, import `StaffLayout from './pages/staff/StaffLayout'` and add inside the logged-in routes, next to `/clients`:
```tsx
                    <Route path="/staff" element={<StaffLayout />} />
                    <Route path="/staff/:section" element={<StaffLayout />} />
```
In `frontend/components/Layout.tsx`, add to `secondaryNav` (first item), shown only for staff and not while acting as a client:
```tsx
    ...(((user as any)?.staffRole || user?.isCsm) && !localStorage.getItem('csmReturnToken') ? [{ path: '/staff', label: 'Staff area', icon: Shield }] : []),
```
import `Shield` from `lucide-react`, and add `if (pathname.startsWith('/staff')) return { title: 'Staff area', crumb: '' };` to `resolveTopBarMeta`.

- [ ] **Step 4: Run checks**

`npx tsc --noEmit` (3 known errors only), `node scripts/voice-audit.mjs` (0), `node scripts/brand-audit.mjs` (0), `node --test tests/*.test.*` (all pass; if `layer-lists` fails because of new colour classes, run `node scripts/visual-audit/gen-layer-lists.mjs` and re-run).

- [ ] **Step 5: Commit**

```bash
git add frontend/services/api.ts frontend/types.ts frontend/pages/staff frontend/App.tsx frontend/components/Layout.tsx frontend/index.html
git commit -m "feat(staff): Staff area shell with a role-aware menu"
```

---

## After all tasks
- Append an Update to `docs/superpowers/HANDOVER-nebulaa-redesign-2.md`: roles, Make Owner once, `/staff`, what is still empty.
- Owner steps after release: open old `/admin`, press Make Owner with the founder's email, sign in with that account, open Staff area.
