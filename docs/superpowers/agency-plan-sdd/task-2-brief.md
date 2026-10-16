### Task 2: Pure agency rules

**Files:**
- Create: `backend/services/agency.js`
- Modify: `backend/models/User.js` (add the `agency` block)
- Test: `backend/tests/agencyRules.test.js`

**Interfaces:**
- Consumes: `AGENCY` from Task 1.
- Produces (all in `services/agency.js`):
  - `isAgency(user): boolean`, `isWorkspace(user): boolean`
  - `clientLimitOf(owner): number` (0 when not an agency; `min(maxClients, includedClients + extraSlots)`)
  - `payerIdOf(user): string` (agency owner id for a workspace, the user's own id otherwise)
  - `workspacePlanFields(owner): { 'plan.tier': string, 'plan.addons': string[] }` (what to mirror)
  - `placeholderEmail(id): string`
  - `walletBalance(userId, {User}): Promise<number>`

`User` schema block to add (next to `plan`):

```js
    agency: {
      ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true }, // set on a client workspace
      workspaceName: { type: String, default: '' },
      clientCount: { type: Number, default: 0 },  // on the agency: workspaces it has
      extraSlots: { type: Number, default: 0 },   // on the agency: paid extra client slots
      frozen: { type: Boolean, default: false }   // on a workspace: over the limit after a downgrade
    },
```

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/agencyRules.test.js
const test = require('node:test');
const assert = require('node:assert');
const a = require('../services/agency');
const { AGENCY } = require('../config/apiCosts');

const owner = (extra = 0, tier = 'agency') => ({ _id: 'o1', plan: { tier }, agency: { extraSlots: extra, clientCount: 0 } });

test('limit: 5 included, plus paid slots, never above 25, zero for other plans', () => {
  assert.strictEqual(a.clientLimitOf(owner(0)), AGENCY.includedClients);
  assert.strictEqual(a.clientLimitOf(owner(3)), AGENCY.includedClients + 3);
  assert.strictEqual(a.clientLimitOf(owner(99)), AGENCY.maxClients);
  assert.strictEqual(a.clientLimitOf(owner(0, 'professional')), 0);
  assert.strictEqual(a.clientLimitOf(null), 0);
});

test('payer: a workspace is paid by its agency, anyone else by themselves', () => {
  assert.strictEqual(a.payerIdOf({ _id: 'w1', agency: { ownerId: 'o1' } }), 'o1');
  assert.strictEqual(a.payerIdOf({ _id: 'u1' }), 'u1');
  assert.strictEqual(a.isWorkspace({ agency: { ownerId: 'o1' } }), true);
  assert.strictEqual(a.isWorkspace({ agency: {} }), false);
  assert.strictEqual(a.isAgency(owner()), true);
});

test('the plan mirrored onto a workspace is the agency plan, or free when the agency has none', () => {
  assert.deepStrictEqual(a.workspacePlanFields(owner()), { 'plan.tier': 'agency', 'plan.addons': [] });
  assert.deepStrictEqual(a.workspacePlanFields({ _id: 'o1', plan: { tier: 'free' } }), { 'plan.tier': 'free', 'plan.addons': [] });
  assert.deepStrictEqual(a.workspacePlanFields(null), { 'plan.tier': 'free', 'plan.addons': [] });
});

test('placeholder email is valid-looking and cannot receive mail', () => {
  assert.match(a.placeholderEmail('abc123'), /^ws-abc123@workspace\.invalid$/);
});

test('wallet: the balance of the payer, 0 when the payer is missing', async () => {
  const User = { findById: (id) => ({ select: () => ({ lean: async () => ({ o1: { credits: { balance: 42 } }, w1: { agency: { ownerId: 'o1' } }, gone: { agency: { ownerId: 'none' } } })[id] || null }) }) };
  assert.strictEqual(await a.walletBalance('w1', { User }), 42);
  assert.strictEqual(await a.walletBalance('o1', { User }), 42);
  assert.strictEqual(await a.walletBalance('gone', { User }), 0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && node --test tests/agencyRules.test.js` → FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// backend/services/agency.js
'use strict';
/**
 * Agency rules with no database of their own: who is an agency, who is a client workspace, how many clients are
 * allowed, and who pays. A client workspace is a hidden User record owned by the agency.
 */
const { AGENCY } = require('../config/apiCosts');

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const idOf = (v) => (v ? String(v._id || v.id || v) : '');

const isAgency = (u) => !!(u && u.plan && u.plan.tier === 'agency');
const isWorkspace = (u) => !!(u && u.agency && u.agency.ownerId);

function clientLimitOf(owner) {
  if (!isAgency(owner)) return 0;
  return Math.min(AGENCY.maxClients, AGENCY.includedClients + Math.max(0, num(owner.agency && owner.agency.extraSlots)));
}

/** The account whose Quarks are spent: the agency for a client workspace, the user themselves otherwise. */
const payerIdOf = (u) => (isWorkspace(u) ? idOf(u.agency.ownerId) : idOf(u));

/** What a workspace mirrors from its agency so plan and add-on checks need no special case. */
function workspacePlanFields(owner) {
  return { 'plan.tier': isAgency(owner) ? 'agency' : 'free', 'plan.addons': [] };
}

const placeholderEmail = (id) => `ws-${id}@workspace.invalid`;

/** Quarks available to this user: the payer's balance. 0 if the payer cannot be found. */
async function walletBalance(userId, { User = require('../models/User') } = {}) {
  const me = await User.findById(userId).select('credits.balance agency.ownerId').lean();
  if (!me) return 0;
  if (!isWorkspace(me)) return Math.max(0, num(me.credits && me.credits.balance));
  const payer = await User.findById(idOf(me.agency.ownerId)).select('credits.balance').lean();
  return payer ? Math.max(0, num(payer.credits && payer.credits.balance)) : 0;
}

module.exports = { isAgency, isWorkspace, clientLimitOf, payerIdOf, workspacePlanFields, placeholderEmail, walletBalance, idOf };
```

Add the `agency` block to `models/User.js` as shown above.

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && node --test tests/agencyRules.test.js && node -e "require('./models/User'); console.log('ok')"` → PASS and `ok`.

- [ ] **Step 5: Commit**

```bash
git add backend/services/agency.js backend/models/User.js backend/tests/agencyRules.test.js
git commit -m "Agency rules: limits, payer, workspace plan mirror, wallet"
```

---

