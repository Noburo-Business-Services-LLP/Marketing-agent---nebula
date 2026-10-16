# Agency Plan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One paying agency account runs up to 25 client brands, each its own workspace, paid from one shared Quark pool, with per-client usage reporting.

**Architecture:** A client workspace is a hidden `User` record owned by the agency (`agency.ownerId`), so every existing feature keeps working per client. The agency switches into a workspace with a short-lived pass (same mechanism and same browser keys as the existing CSM pass). All Quark reads and writes for a workspace are redirected to the agency account through one helper, `payerIdOf`; the plan and add-ons are mirrored onto each workspace so entitlement checks need no change.

**Tech Stack:** Node/Express/Mongoose (`node --test tests/*.test.js`), React 19 + TypeScript + Vite (`node --test tests/*.test.mjs`), Razorpay subscriptions, existing Quark bucket and ledger services.

**Spec:** `docs/superpowers/specs/2026-10-16-agency-plan-design.md`

All paths are under the worktree `/Users/dineshkannaa/Documents/0 CONTENT/Claude Agents/nebula-worktrees/nebulaa-redesign` (`backend/`, `frontend/`, `docs/`). Backend tests run from `backend/`, frontend tests from `frontend/`.

## Global Constraints

- Prices and Quark amounts live only in `backend/config/apiCosts.js`. Never write 6999, 1499, 6000 or 500 anywhere else (tests import them from config).
- Agency: Rs 6,999 a month ex-GST, 5 clients included, 6,000 shared Quarks, Publish, Inbox and Competitors included. Extra client: Rs 1,499 a month ex-GST, 500 Quarks each, up to 25 clients in total. (Spec, "Plan and price".)
- Customers see posts and videos, never Quarks. Customer-facing files must not contain the words "credit", "trial" or "7 days" (wording guard test); legal pages are exempt.
- Voice: plain, no agent names; `frontend/scripts/brand-audit.mjs` and `voice-audit.mjs` must report 0 violations.
- After any UI change run `node scripts/visual-audit/gen-layer-lists.mjs` in `frontend/` and commit `index.html`.
- Inside a client workspace these stay blocked: payments and plans, password change, account deletion and export, creating, renaming or removing clients. (Spec, "Switching into a client".)
- Every workspace has no login: placeholder email `ws-<id>@workspace.invalid`, random password, never emailed.
- The client limit is enforced in one atomic update on the agency account. A workspace cannot be created without an active agency plan.
- The existing per-day spend cap and kill switches apply to the agency account's total because spending is charged to the agency.
- Commit after every task. Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Two requests creating the 5th and 6th client at the same moment: exactly one succeeds (Task 3).
2. A workspace spends or is refunded while the agency pool is too low or the agency account is gone: the spend is refused, and nothing is ever charged to the workspace record (Task 5).
3. Data made in client A never appears in client B or in the agency's own account, including through the pass token for B (Task 4).
4. The agency plan ends or is cancelled: workspaces cannot spend, nothing is deleted, and clients above the limit after a downgrade are frozen rather than removed (Tasks 6 and 9).
5. A removed workspace's old pass is rejected on the next request; deleting the agency account removes every workspace first (Tasks 4 and 9).

## File Structure

Backend, create:
- `services/agency.js`: pure rules (is agency, is workspace, limit, payer id, plan mirror fields, wallet read).
- `services/agencyWorkspaces.js`: create, rename, list, remove, pass issue, mirror sync (uses models).
- `routes/agency.js`: `/api/agency/*`.
- `services/agencyUsage.js`: per-client usage from the ledger, plus CSV.
- `services/ayrshareProfileWatch.js`: profile count and the alert at 25.
- Tests: `tests/agencyConfig.test.js`, `tests/agencyRules.test.js`, `tests/agencyWorkspaces.test.js`, `tests/agencyAuth.test.js`, `tests/agencyPayer.test.js`, `tests/agencyBilling.test.js`, `tests/agencyUsage.test.js`, `tests/agencyProfileWatch.test.js`, `tests/agencyDeletion.test.js`, `tests/creditAccessGuard.test.js`.

Backend, modify: `config/apiCosts.js`, `config/plans.js`, `config/entitlements.js`, `services/billingPlans.js`, `routes/payment.js`, `models/User.js`, `models/QuarkLedger.js`, `services/quarkBuckets.js`, `middleware/auth.js`, `middleware/trialGuard.js`, `middleware/creditGuard.js`, `routes/credits.js`, `routes/dashboard.js`, `routes/content.js`, `routes/chat.js`, `routes/studioVideos.js`, `routes/campaigns.js`, `routes/videoGeneration.js`, `routes/auth.js`, `services/accountDeletion.js`, `routes/account.js`, `services/staff/clientList.js`, `server-main.js`.

Frontend, create: `utils/agency.ts`, `components/ClientSwitcher.tsx`, `pages/AgencyClients.tsx`, `components/AgencyUsage.tsx`, `tests/agency.test.mjs`.
Frontend, modify: `services/api.ts`, `types.ts`, `components/Layout.tsx`, `App.tsx`, `pages/TrialExpired.tsx`, `pages/TermsAndConditions.tsx`, `pages/PrivacyPolicy.tsx`, `index.html` (generated).

---

### Task 1: Agency plan in config and entitlements

**Files:**
- Modify: `backend/config/apiCosts.js` (inside `PLANS`, and export `AGENCY`)
- Modify: `backend/config/plans.js` (`PLAN_PRESENTATION`)
- Modify: `backend/config/entitlements.js` (`TIERS`, `addonsOf`)
- Modify: `backend/services/billingPlans.js` (`canBuyAddon`, `planCatalogue`)
- Test: `backend/tests/agencyConfig.test.js`

**Interfaces:**
- Produces: `AGENCY = { includedClients: 5, maxClients: 25, slot: { inr: 1499, quarks: 500 } }` exported from `config/apiCosts.js`; `PLANS.agency = { inr: 6999, quarks: 6000, ... }`; tier `'agency'` accepted by `resolveTier`; `addonsOf(agencyUser)` returns `['bundle']`; `planCatalogue().agency = { includedClients, maxClients, slotInr, slotQuarks }`.

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/agencyConfig.test.js
const test = require('node:test');
const assert = require('node:assert');
const { PLANS, AGENCY, QUARK_COSTS } = require('../config/apiCosts');
const { resolveTier, addonsOf, canUse } = require('../config/entitlements');
const bp = require('../services/billingPlans');

test('the agency plan is Rs 6,999 for 6,000 shared Quarks and the numbers come from config', () => {
  assert.strictEqual(PLANS.agency.inr, 6999);
  assert.strictEqual(PLANS.agency.quarks, 6000);
  assert.deepStrictEqual(AGENCY, { includedClients: 5, maxClients: 25, slot: { inr: 1499, quarks: 500 } });
});

test('the allowance guard passes: the pool covers the expected burn', () => {
  assert.ok(PLANS.agency.quarks >= PLANS.agency.expectedQuarks);
  assert.ok(QUARK_COSTS.image_generated > 0);
});

test('an agency account may use everything an add-on would unlock, with nothing to buy', () => {
  const u = { plan: { tier: 'agency', addons: [] }, onboardingCompleted: true };
  assert.strictEqual(resolveTier(u), 'agency');
  assert.deepStrictEqual(addonsOf(u), ['bundle']);
  for (const f of ['create', 'video', 'publish', 'schedule', 'social_connect', 'inbox', 'auto_reply', 'competitors']) assert.strictEqual(canUse(u, f).allowed, true, f);
  assert.strictEqual(bp.canBuyAddon(u, 'publish').ok, false);
  assert.match(bp.canBuyAddon(u, 'publish').message, /included/);
});

test('the catalogue lists the agency plan and its client rules', () => {
  const c = bp.planCatalogue();
  assert.ok(c.plans.some((p) => p.id === 'agency' && p.name === 'Agency'));
  assert.deepStrictEqual(c.agency, { includedClients: 5, maxClients: 25, slotInr: 1499, slotQuarks: 500 });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && node --test tests/agencyConfig.test.js`
Expected: FAIL (`PLANS.agency` undefined).

- [ ] **Step 3: Implement**

In `config/apiCosts.js`, add to `PLANS` after `professional`:

```js
  agency: {
    inr: 6999,
    label: 'Agency',
    // Commitments sized so the allowance guard below holds: about 300 posts and 10 videos a month across the clients.
    commits: { image_generated: 300, studio_video: 10 },
    grant: 6000
  }
```

Above `module.exports` add and export:

```js
// The agency plan: clients are separate workspaces paid from one shared pool. Prices here only.
const AGENCY = { includedClients: 5, maxClients: 25, slot: { inr: 1499, quarks: 500 } };
```
(add `AGENCY` to the `module.exports` object).

In `config/plans.js` add to `PLAN_PRESENTATION`:

```js
  agency: {
    name: 'Agency',
    description: 'Run several client brands from one account, with one shared pool of posts and videos.',
    extraFeatures: ['5 client brands included', 'Publishing, inbox and competitor insights included', 'Usage report for each client'],
    envVar: 'RAZORPAY_PLAN_ID_AGENCY'
  }
```

In `config/entitlements.js`: `const TIERS = ['free', 'starter', 'professional', 'agency', 'managed'];` and replace `addonsOf`:

```js
function addonsOf(user) {
  if (user && user.plan && user.plan.tier === 'agency') return ['bundle'];
  const a = user && user.plan && user.plan.addons;
  return Array.isArray(a) ? a : [];
}
```

In `services/billingPlans.js` `canBuyAddon`, before the existing tier check:

```js
  if (resolveTier(user) === 'agency') return { ok: false, message: 'Publishing, inbox and competitor insights are included in the Agency plan.' };
```
and in `planCatalogue()` return object add:

```js
    agency: { includedClients: AGENCY.includedClients, maxClients: AGENCY.maxClients, slotInr: AGENCY.slot.inr, slotQuarks: AGENCY.slot.quarks },
```
(import `AGENCY` in the destructured `require('../config/apiCosts')` at the top).

- [ ] **Step 4: Run to verify it passes, then the whole backend suite**

Run: `cd backend && node --test tests/agencyConfig.test.js && node --test tests/*.test.js 2>&1 | grep -E "^ℹ (pass|fail)|^✖"`
Expected: new tests pass. If an existing test counts plans or add-ons exactly (billing and entitlement tests), update it to include `agency`; do not weaken it otherwise.

- [ ] **Step 5: Commit**

```bash
git add backend/config backend/services/billingPlans.js backend/tests
git commit -m "Agency plan config: price, shared Quarks, client rules, all add-ons included"
```

---

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

### Task 3: Client workspaces: create, list, rename, remove

**Files:**
- Create: `backend/services/agencyWorkspaces.js`
- Test: `backend/tests/agencyWorkspaces.test.js`

**Interfaces:**
- Consumes: `services/agency.js` (Task 2), `services/accountDeletion.js` (`defaultModels`, `stepsFor`, `purgeOne`; used in Task 9 for removal).
- Produces (`services/agencyWorkspaces.js`), each taking `{ models, ... }` where `models.User` is the User model:
  - `claimSlot(User, ownerId): Promise<doc|null>` atomic increment of `agency.clientCount` only while below the limit
  - `releaseSlot(User, ownerId): Promise<void>`
  - `createWorkspace({ owner, name, industry, website, models, randomId }): Promise<{ ok, workspace?, message? }>`
  - `listWorkspaces({ owner, models }): Promise<Array<{ id, name, createdAt, frozen }>>`
  - `renameWorkspace({ owner, workspaceId, name, models }): Promise<{ ok, message? }>`
  - `syncWorkspacePlans({ owner, models }): Promise<number>` writes `workspacePlanFields(owner)` to every workspace, and sets `agency.frozen` on workspaces beyond the limit (oldest first stay active)
  - `removeWorkspaceRecord` is Task 9.

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/agencyWorkspaces.test.js
const test = require('node:test');
const assert = require('node:assert');
const w = require('../services/agencyWorkspaces');
const { AGENCY } = require('../config/apiCosts');

// A small in-memory User collection that applies the same filter rules the service relies on.
function fakeUsers(seed = []) {
  const docs = seed.map((d) => ({ ...d }));
  const get = (o, p) => p.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
  const set = (o, p, v) => { const ks = p.split('.'); let c = o; ks.slice(0, -1).forEach((k) => { c[k] = c[k] || {}; c = c[k]; }); c[ks.at(-1)] = v; };
  const limitOf = (d) => Math.min(AGENCY.maxClients, AGENCY.includedClients + (get(d, 'agency.extraSlots') || 0));
  const User = {
    docs,
    findOneAndUpdate: async (f, u) => {
      const d = docs.find((x) => String(x._id) === String(f._id) && (!f['plan.tier'] || get(x, 'plan.tier') === f['plan.tier']));
      if (!d) return null;
      if (f.$expr && !((get(d, 'agency.clientCount') || 0) < limitOf(d))) return null; // the atomic limit check
      for (const [k, v] of Object.entries(u.$inc || {})) set(d, k, (get(d, k) || 0) + v);
      return d;
    },
    updateOne: async (f, u) => { const d = docs.find((x) => String(x._id) === String(f._id)); if (d) for (const [k, v] of Object.entries(u.$set || {})) set(d, k, v); for (const [k, v] of Object.entries(u.$inc || {})) if (d) set(d, k, (get(d, k) || 0) + v); },
    updateMany: async (f, u) => { docs.filter((x) => String(get(x, 'agency.ownerId')) === String(f['agency.ownerId'])).forEach((d) => { for (const [k, v] of Object.entries(u.$set || {})) set(d, k, v); }); },
    create: async (d) => { const x = { _id: d._id || `w${docs.length + 1}`, createdAt: new Date(docs.length), ...d }; docs.push(x); return x; },
    find: (f) => ({ sort: () => ({ lean: async () => docs.filter((x) => String(get(x, 'agency.ownerId')) === String(f['agency.ownerId'])) }), lean: async () => docs.filter((x) => String(get(x, 'agency.ownerId')) === String(f['agency.ownerId'])) })
  };
  return User;
}
const agency = (over = {}) => ({ _id: 'o1', plan: { tier: 'agency' }, agency: { clientCount: 0, extraSlots: 0 }, ...over });

test('creating a client makes a hidden account with no login that mirrors the agency plan', async () => {
  const User = fakeUsers([agency()]);
  const r = await w.createWorkspace({ owner: User.docs[0], name: 'Sweet Co', industry: 'Food', models: { User }, randomId: () => 'abc' });
  assert.strictEqual(r.ok, true);
  const ws = User.docs.find((d) => d.agency && d.agency.ownerId);
  assert.strictEqual(ws.email, 'ws-abc@workspace.invalid');
  assert.strictEqual(ws.plan.tier, 'agency');
  assert.strictEqual(ws.onboardingCompleted, true);
  assert.strictEqual(ws.isVerified, true);
  assert.ok(ws.password && ws.password.length >= 32);
  assert.strictEqual(User.docs[0].agency.clientCount, 1);
});

test('the sixth client is refused until a slot is bought', async () => {
  const User = fakeUsers([agency({ agency: { clientCount: 5, extraSlots: 0 } })]);
  const r = await w.createWorkspace({ owner: User.docs[0], name: 'Six', models: { User }, randomId: () => 'x' });
  assert.strictEqual(r.ok, false);
  assert.match(r.message, /5 clients/);
  assert.strictEqual(User.docs.length, 1);
});

test('two requests for the last slot: exactly one wins', async () => {
  const User = fakeUsers([agency({ agency: { clientCount: 4, extraSlots: 0 } })]);
  let n = 0;
  const go = () => w.createWorkspace({ owner: User.docs[0], name: 'Last', models: { User }, randomId: () => `r${n++}` });
  const [a, b] = await Promise.all([go(), go()]);
  assert.strictEqual([a, b].filter((r) => r.ok).length, 1);
  assert.strictEqual(User.docs[0].agency.clientCount, 5);
});

test('a non-agency account cannot create clients, and a blank name is refused', async () => {
  const User = fakeUsers([{ _id: 'u1', plan: { tier: 'professional' }, agency: {} }, agency({ _id: 'o2' })]);
  assert.strictEqual((await w.createWorkspace({ owner: User.docs[0], name: 'X', models: { User } })).ok, false);
  const r = await w.createWorkspace({ owner: User.docs[1], name: '   ', models: { User } });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(User.docs[1].agency.clientCount, 0, 'the slot is not used up by a refused request');
});

test('after a downgrade, clients beyond the limit are frozen, oldest first kept, and nothing is deleted', async () => {
  const seeded = [agency({ plan: { tier: 'agency' }, agency: { clientCount: 7, extraSlots: 2 } })];
  for (let i = 1; i <= 7; i += 1) seeded.push({ _id: `w${i}`, agency: { ownerId: 'o1' }, createdAt: new Date(i) });
  const User = fakeUsers(seeded);
  User.docs[0].agency.extraSlots = 0; // the extra slots ended
  await w.syncWorkspacePlans({ owner: User.docs[0], models: { User } });
  const frozen = User.docs.filter((d) => d.agency && d.agency.frozen).map((d) => d._id);
  assert.deepStrictEqual(frozen, ['w6', 'w7']);
  assert.strictEqual(User.docs.length, 8);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && node --test tests/agencyWorkspaces.test.js` → FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// backend/services/agencyWorkspaces.js
'use strict';
/** Client workspaces for the agency plan: make, list, rename, keep in step with the agency's plan, and stay within the limit. */
const crypto = require('crypto');
const { AGENCY } = require('../config/apiCosts');
const ag = require('./agency');

const MAX_NAME = 80;
const cleanName = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);

/** One atomic step: take a slot only while the agency is below its limit. Returns the updated agency or null. */
function claimSlot(User, ownerId) {
  return User.findOneAndUpdate(
    {
      _id: ownerId,
      'plan.tier': 'agency',
      $expr: { $lt: [{ $ifNull: ['$agency.clientCount', 0] }, { $min: [AGENCY.maxClients, { $add: [AGENCY.includedClients, { $ifNull: ['$agency.extraSlots', 0] }] }] }] }
    },
    { $inc: { 'agency.clientCount': 1 } },
    { new: true }
  );
}
const releaseSlot = (User, ownerId) => User.updateOne({ _id: ownerId }, { $inc: { 'agency.clientCount': -1 } });

async function createWorkspace({ owner, name, industry = '', website = '', models, randomId = () => crypto.randomBytes(8).toString('hex') }) {
  const { User } = models;
  const clean = cleanName(name);
  if (!ag.isAgency(owner)) return { ok: false, message: 'Client brands are part of the Agency plan.' };
  if (clean.length < 2) return { ok: false, message: 'Please enter the client\'s business name.' };
  const claimed = await claimSlot(User, owner._id);
  if (!claimed) {
    const limit = ag.clientLimitOf(owner);
    return { ok: false, message: `Your plan includes ${limit} clients and all of them are in use. Add a client slot to add more.` };
  }
  try {
    const id = randomId();
    const workspace = await User.create({
      email: ag.placeholderEmail(id),
      password: crypto.randomBytes(32).toString('hex'),
      firstName: clean, lastName: '', companyName: clean,
      isVerified: true, onboardingCompleted: true,
      businessProfile: { name: clean, industry: String(industry || '').slice(0, 80), website: String(website || '').slice(0, 200) },
      agency: { ownerId: owner._id, workspaceName: clean },
      ...ag.workspacePlanFields(owner)
    });
    return { ok: true, workspace };
  } catch (e) {
    await releaseSlot(User, owner._id); // never leave a slot used by a client that was not made
    throw e;
  }
}

async function listWorkspaces({ owner, models }) {
  const rows = await models.User.find({ 'agency.ownerId': owner._id }).sort({ createdAt: 1 }).lean();
  return rows.map((r) => ({ id: String(r._id), name: (r.agency && r.agency.workspaceName) || r.companyName || '', createdAt: r.createdAt, frozen: !!(r.agency && r.agency.frozen) }));
}

async function renameWorkspace({ owner, workspaceId, name, models }) {
  const clean = cleanName(name);
  if (clean.length < 2) return { ok: false, message: 'Please enter the client\'s business name.' };
  const own = (await listWorkspaces({ owner, models })).find((w) => w.id === String(workspaceId));
  if (!own) return { ok: false, message: 'That client was not found.' };
  await models.User.updateOne({ _id: workspaceId }, { $set: { 'agency.workspaceName': clean, companyName: clean, firstName: clean, 'businessProfile.name': clean } });
  return { ok: true };
}

/** Copy the agency's plan to every client, and freeze (never delete) clients above the limit, oldest kept first. */
async function syncWorkspacePlans({ owner, models }) {
  const { User } = models;
  const rows = await User.find({ 'agency.ownerId': owner._id }).sort({ createdAt: 1 }).lean();
  await User.updateMany({ 'agency.ownerId': owner._id }, { $set: ag.workspacePlanFields(owner) });
  const limit = ag.clientLimitOf(owner);
  let n = 0;
  for (const [i, r] of rows.entries()) {
    const frozen = i >= limit;
    if (frozen !== !!(r.agency && r.agency.frozen)) await User.updateOne({ _id: r._id }, { $set: { 'agency.frozen': frozen } });
    n += 1;
  }
  return n;
}

module.exports = { claimSlot, releaseSlot, createWorkspace, listWorkspaces, renameWorkspace, syncWorkspacePlans, cleanName };
```

Note for the implementer: read `models/User.js` `businessProfile` first and set only fields that exist there (`name` and `industry` exist; drop `website` from the create call if the schema has a different field name).

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && node --test tests/agencyWorkspaces.test.js` → PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/services/agencyWorkspaces.js backend/tests/agencyWorkspaces.test.js
git commit -m "Agency workspaces: atomic client limit, create, list, rename, plan mirror and freeze"
```

---

### Task 4: Switching into a client: pass, auth, routes

**Files:**
- Modify: `backend/middleware/auth.js` (the `actingCsm` block area, lines 74-86)
- Create: `backend/routes/agency.js`
- Modify: `backend/server-main.js` (mount `/api/agency`)
- Modify: `backend/routes/auth.js` (the `/me` response near line 1164)
- Test: `backend/tests/agencyAuth.test.js`

**Interfaces:**
- Consumes: `agency.js`, `agencyWorkspaces.js`.
- Produces:
  - In `services/agencyWorkspaces.js`: `issueAgencyPass({ workspaceId, ownerId, secret }): string` (JWT `{ id: workspaceId, actingAgency: ownerId }`, 8 h) and `isBlockedInsideClient(url, method): boolean`.
  - `GET /api/agency/clients` → `{ success, clients: [{id,name,createdAt,frozen}], limit, used, slotInr, slotQuarks }`
  - `POST /api/agency/clients` `{ name, industry }` → `{ success, client }` or `400/403 { success:false, message }`
  - `PATCH /api/agency/clients/:id` `{ name }`
  - `POST /api/agency/clients/:id/open` → `{ success, token, expiresInHours, client:{id,name} }`
  - `/me` includes `actingAgency: { name }` when a pass is in use.
  - `protect` sets `req.actingAgency = ownerDoc` and rejects (401) when the owner is gone, inactive, no longer on the agency plan, or does not own this workspace, and rejects (403) blocked routes.

Blocked while inside a client (add to `services/agencyWorkspaces.js`):

```js
const BLOCKED_INSIDE_CLIENT = [
  /^\/api\/payment(\/|$)/,
  /^\/api\/auth\/change-password/,
  /^\/api\/auth\/(delete|deactivate)/,
  /^\/api\/users?\/(me\/)?delete/,
  /^\/api\/account\/(deletion|export)/
];
function isBlockedInsideClient(url, method = 'GET') {
  const path = String(url || '').split('?')[0];
  if (BLOCKED_INSIDE_CLIENT.some((re) => re.test(path))) return true;
  // The client list may be read, and another client opened, from inside a client; nothing else under /api/agency.
  if (/^\/api\/agency(\/|$)/.test(path)) return !(String(method).toUpperCase() === 'GET' && path === '/api/agency/clients') && !/^\/api\/agency\/clients\/[^/]+\/open$/.test(path);
  return false;
}
```

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/agencyAuth.test.js
const test = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');
const w = require('../services/agencyWorkspaces');

test('the pass names the client and the agency, and lasts 8 hours', () => {
  const t = w.issueAgencyPass({ workspaceId: 'w1', ownerId: 'o1', secret: 's' });
  const d = jwt.verify(t, 's');
  assert.strictEqual(d.id, 'w1');
  assert.strictEqual(d.actingAgency, 'o1');
  assert.ok(d.exp - d.iat === 8 * 3600);
});

test('inside a client: money, passwords, deletion and client management are blocked; the list and switching are not', () => {
  for (const u of ['/api/payment/create-order', '/api/auth/change-password', '/api/account/deletion/request', '/api/account/export']) assert.strictEqual(w.isBlockedInsideClient(u, 'POST'), true, u);
  assert.strictEqual(w.isBlockedInsideClient('/api/agency/clients', 'POST'), true, 'create');
  assert.strictEqual(w.isBlockedInsideClient('/api/agency/clients/w1', 'PATCH'), true, 'rename');
  assert.strictEqual(w.isBlockedInsideClient('/api/agency/clients', 'GET'), false);
  assert.strictEqual(w.isBlockedInsideClient('/api/agency/clients/w2/open', 'POST'), false);
  assert.strictEqual(w.isBlockedInsideClient('/api/campaigns', 'GET'), false);
  assert.strictEqual(w.isBlockedInsideClient('/api/drafts', 'POST'), false);
});

test('protect: the pass is accepted only while the agency is active, on the agency plan, and owns the client', () => {
  const check = require('../middleware/auth')._agencyPassProblem; // exported for this test
  const ok = { owner: { _id: 'o1', isActive: true, plan: { tier: 'agency' } }, workspace: { _id: 'w1', agency: { ownerId: 'o1' } } };
  assert.strictEqual(check(ok.owner, ok.workspace), '');
  assert.match(check(null, ok.workspace), /ended/);
  assert.match(check({ ...ok.owner, isActive: false }, ok.workspace), /ended/);
  assert.match(check({ ...ok.owner, plan: { tier: 'professional' } }, ok.workspace), /plan/);
  assert.match(check(ok.owner, { _id: 'w1', agency: { ownerId: 'someone-else' } }), /ended/);
  assert.match(check(ok.owner, { _id: 'w1', agency: { ownerId: 'o1', frozen: true } }), /over/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && node --test tests/agencyAuth.test.js` → FAIL.

- [ ] **Step 3: Implement**

Add to `services/agencyWorkspaces.js` (and export): `issueAgencyPass`, `BLOCKED_INSIDE_CLIENT`, `isBlockedInsideClient` (code above) and:

```js
const jwt = require('jsonwebtoken');
const PASS_HOURS = 8;
function issueAgencyPass({ workspaceId, ownerId, secret = process.env.JWT_SECRET }) {
  return jwt.sign({ id: ag.idOf(workspaceId), actingAgency: ag.idOf(ownerId) }, secret, { expiresIn: `${PASS_HOURS}h` });
}
```

In `middleware/auth.js`, above the module's `protect`, add and export for tests:

```js
/** Empty when a client pass is still good, otherwise the message to show. */
function _agencyPassProblem(owner, workspace) {
  const ended = 'Your access to this client has ended. Please open it again from your clients list.';
  if (!owner || owner.isActive === false) return ended;
  if (!workspace || !workspace.agency || String(workspace.agency.ownerId) !== String(owner._id)) return ended;
  if (!owner.plan || owner.plan.tier !== 'agency') return 'The agency plan is not active, so this client is paused. Ask the agency to renew.';
  if (workspace.agency.frozen) return 'This client is over the agency\'s client limit and is paused. Add a client slot to open it.';
  return '';
}
```
Then after the `decoded.actingCsm` block insert:

```js
    // An agency working inside one of its clients: re-check ownership and plan on every request.
    if (decoded.actingAgency) {
      const ws = require('../services/agencyWorkspaces');
      const owner = await User.findById(decoded.actingAgency).select('isActive plan agency firstName lastName email').lean();
      const problem = _agencyPassProblem(owner, user);
      if (problem) return res.status(401).json({ success: false, message: problem });
      if (ws.isBlockedInsideClient(req.originalUrl, req.method)) {
        return res.status(403).json({ success: false, message: 'Payments, plans and passwords are managed in your agency account. Go back to the agency to change them.' });
      }
      req.actingAgency = owner;
    }
```
and add `_agencyPassProblem` to `module.exports`.

`routes/agency.js`: a router with `protect`, a rate limiter like `routes/account.js`, and the four endpoints. Owner is `req.actingAgency || req.user` only for list and open (so switching clients from inside one works); create and rename use `req.user` and are already blocked inside a client by `protect`. Opening a client:

```js
router.post('/clients/:id/open', protect, limiter, async (req, res) => {
  const owner = req.actingAgency ? await models.User.findById(req.actingAgency._id) : req.user;
  const mine = (await ws.listWorkspaces({ owner, models })).find((c) => c.id === req.params.id);
  if (!mine) return res.status(404).json({ success: false, message: 'That client was not found.' });
  if (mine.frozen) return res.status(403).json({ success: false, message: 'This client is over your client limit and is paused. Add a client slot to open it.' });
  await ws.syncWorkspacePlans({ owner, models }); // heals any lag between the agency plan and its clients
  res.json({ success: true, token: ws.issueAgencyPass({ workspaceId: mine.id, ownerId: owner._id }), expiresInHours: 8, client: { id: mine.id, name: mine.name } });
});
```
`models` is `require('../services/accountDeletion').defaultModels()` as in `routes/account.js` (cache it in a function `const models = () => ...`). `GET /clients` returns `limit: ag.clientLimitOf(owner)`, `used: list.length`, `slotInr`/`slotQuarks` from `AGENCY.slot`. `POST /clients` returns 403 for non-agency, 400 for the other refusals (map `createWorkspace` messages). Mount in `server-main.js` next to `/api/account`: `app.use('/api/agency', require('./routes/agency'));`.

In `routes/auth.js` near line 1164 add `actingAgency: req.actingAgency ? { name: [req.actingAgency.firstName, req.actingAgency.lastName].filter(Boolean).join(' ') || req.actingAgency.email } : null` alongside the existing `actingCsm` field. Also, in the same `/me` response, for a workspace overlay the Quarks display with the agency's balance (response only, never saved): if `req.user.agency?.ownerId`, load the owner's `credits` lean and send it as `credits` in the response object.

- [ ] **Step 4: Run to verify it passes, then the real isolation check**

Run: `cd backend && node --test tests/agencyAuth.test.js` → PASS.
Then on the dev database (`nebulaa_dev` only, throwaway users, delete afterwards): make an agency user, two workspaces A and B via `createWorkspace`, create a `Draft` for A, then call `GET /api/drafts` (or the drafts list route) with B's pass and with the agency's own token: the draft must not appear in either. Record the result in the commit message.

- [ ] **Step 5: Commit**

```bash
git add backend/middleware/auth.js backend/routes/agency.js backend/routes/auth.js backend/server-main.js backend/services/agencyWorkspaces.js backend/tests/agencyAuth.test.js
git commit -m "Agency: client pass, protect checks on every request, clients API"
```

---

### Task 5: One shared pool: Quark reads and writes go to the agency

**Files:**
- Modify: `backend/services/quarkBuckets.js` (`spend`, `record`), `backend/models/QuarkLedger.js`, `backend/middleware/trialGuard.js` (`deductCredits`, `requireCredits`, `refundCredits`), `backend/middleware/creditGuard.js` (lines ~80-161), `backend/routes/studioVideos.js` (lines 147 and 238), `backend/routes/credits.js`, `backend/routes/dashboard.js`, `backend/routes/content.js`, `backend/routes/chat.js`, `backend/routes/campaigns.js`, `backend/routes/videoGeneration.js` (line ~3972)
- Create: `backend/tests/agencyPayer.test.js`, `backend/tests/creditAccessGuard.test.js`

**Interfaces:**
- Consumes: `payerIdOf`, `walletBalance`, `isWorkspace` from `services/agency.js`.
- Produces: `quarkBuckets.spend(userId, cost, opts)` and `trialGuard.refundCredits(userId, ...)` charge or credit the payer and tag the ledger row with `workspace` (the original user id) when different. A new `services/agency.js` function:

```js
/** Resolve who to charge for `userId`: { payerId, workspaceId|null }. Reads the user once. */
async function resolvePayer(userId, { User = require('../models/User') } = {}) {
  const me = await User.findById(userId).select('agency.ownerId').lean();
  if (!me) return { payerId: null, workspaceId: null };
  return isWorkspace(me)
    ? { payerId: idOf(me.agency.ownerId), workspaceId: idOf(userId) }
    : { payerId: idOf(userId), workspaceId: null };
}
```

- [ ] **Step 1: Write the failing tests**

```js
// backend/tests/agencyPayer.test.js
const test = require('node:test');
const assert = require('node:assert');
const a = require('../services/agency');

const User = (docs) => ({ findById: (id) => ({ select: () => ({ lean: async () => docs[id] || null }) }) });

test('a client is charged to its agency, and the original client is remembered for the report', async () => {
  const U = User({ w1: { agency: { ownerId: 'o1' } }, o1: {} });
  assert.deepStrictEqual(await a.resolvePayer('w1', { User: U }), { payerId: 'o1', workspaceId: 'w1' });
  assert.deepStrictEqual(await a.resolvePayer('o1', { User: U }), { payerId: 'o1', workspaceId: null });
});

test('an unknown user has no payer, so nothing can be charged', async () => {
  assert.deepStrictEqual(await a.resolvePayer('nobody', { User: User({}) }), { payerId: null, workspaceId: null });
});
```

```js
// backend/tests/creditAccessGuard.test.js
// A reviewed list of every file that reads or writes a Quark balance. A new file with a balance access fails this
// test until someone has decided how it behaves for an agency client (use walletBalance or resolvePayer).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const REVIEWED = new Set([
  'services/quarkBuckets.js', 'services/billingPlans.js', 'services/agency.js', 'middleware/trialGuard.js', 'middleware/creditGuard.js',
  'routes/credits.js', 'routes/dashboard.js', 'routes/content.js', 'routes/chat.js', 'routes/campaigns.js', 'routes/videoGeneration.js',
  'routes/studioVideos.js', 'routes/social.js', 'routes/payment.js', 'routes/csm.js', 'routes/staff.js', 'routes/auth.js',
  'services/staff/clientBulk.js', 'services/staff/clientList.js', 'services/staff/clientStatus.js'
]);

function files(dir) { return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : [])); }

test('every file that touches credits.balance has been reviewed for agency clients', () => {
  const unreviewed = ['routes', 'services', 'middleware'].flatMap(files).filter((f) => /credits\??\.balance|'credits\.balance'/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')) && !REVIEWED.has(f.replace(/\\/g, '/')));
  assert.deepStrictEqual(unreviewed, [], `New Quark balance access in: ${unreviewed.join(', ')}. Decide how it works for an agency client, then add it to REVIEWED.`);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && node --test tests/agencyPayer.test.js tests/creditAccessGuard.test.js`
Expected: `agencyPayer` fails (`resolvePayer` missing); the guard test may pass or list files; fix the `REVIEWED` list by running it once and checking that every listed file really is handled by the steps below (do not add a file you have not reviewed).

- [ ] **Step 3: Implement**

1. Add `resolvePayer` to `services/agency.js` and export it.
2. `models/QuarkLedger.js`: add `workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true }` and an index `QuarkLedgerSchema.index({ user: 1, workspace: 1, createdAt: -1 });`.
3. `services/quarkBuckets.js`: change `spend` so the first lines are

```js
  const { payerId, workspaceId } = await require('./agency').resolvePayer(userId);
  if (!payerId) return { success: false, balance: null, spent: 0 }; // never charge a record we cannot place
  userId = payerId;
```
   and add `workspace: workspaceId || undefined` to the `record({...})` call in `spend`. (`userId` is a parameter; reassign it or use a new const and replace the later uses.)
4. `middleware/trialGuard.js`: in `deductCredits`, `settle` and the failure-path `User.findById(userId)` already pass through `spend`; resolve the payer once at the top and use `payerId` for `quarkBuckets.settle(...)` and the insufficient-balance read. In `refundCredits`, replace the lookups with `const { payerId, workspaceId } = await require('../services/agency').resolvePayer(userId); if (!payerId) return { success: false, creditsRemaining: 0, creditsRefunded: 0, error: 'User not found' };` and use `payerId` in the two Mongo calls; add a ledger row there through `quarkBuckets.record`-style call only if one exists today (otherwise leave logging unchanged). In `requireCredits`, replace `const user = await User.findById(userId); const currentBalance = user?.credits?.balance ?? 0;` with `const currentBalance = await require('../services/agency').walletBalance(userId);` and settle the payer: `await quarkBuckets.settle((await require('../services/agency').resolvePayer(userId)).payerId || userId).catch(() => null);`.
5. `middleware/creditGuard.js`: the guard loads `req.user` and compares `user.credits.balance`; for a workspace substitute the wallet balance (`walletBalance(req.user._id)`) in the three comparisons (lines ~80, ~130, ~155) and make the deduct write (lines ~130-140) target the payer id. Read the file fully before editing; keep behaviour identical for non-workspace users.
6. `routes/studioVideos.js` lines 147 and 238: replace `User.updateOne({ _id: doc.user }, ...)` and `User.updateOne({ _id: userId }, ...)` with `User.updateOne({ _id: (await resolvePayer(...)).payerId }, ...)` (import `resolvePayer`). Refuse to run the refund when `payerId` is null (log and skip).
7. Read sites: replace each Quarks read with `walletBalance`:
   - `routes/credits.js` lines 32 and 76: `balance` from `walletBalance(userId)`; also return the payer's history for workspaces (agency pool history) using the payer id.
   - `routes/dashboard.js` lines 803-819, 958-959, 1085, 1238, 1600, 1648, 1686: each `user.credits.balance` becomes `const balance = await walletBalance(user._id)` computed once per handler.
   - `routes/content.js` lines 32 and 267, `routes/chat.js` line 35, `routes/campaigns.js` lines 2443, 4672, 5900, `routes/videoGeneration.js` line 3972: same replacement (post-action `creditsRemaining` too).
   Do not change `routes/social.js` (connect reward is 0 for workspaces; confirm `SOCIAL_CONNECT_REWARD` and, if non-zero, skip the reward for workspaces), `routes/payment.js`, `routes/staff.js`, `routes/csm.js`, `services/staff/*` (staff never act on workspaces; they are excluded from staff lists in Task 9).

- [ ] **Step 4: Run to verify it passes, then a real spend**

Run: `cd backend && node --test tests/agencyPayer.test.js tests/creditAccessGuard.test.js && node --test tests/*.test.js 2>&1 | grep -E "^ℹ (pass|fail)|^✖"`
Expected: all pass (existing quark tests unchanged: non-workspace behaviour is identical).
Real check on the dev database with throwaway users: agency with 100 Quarks and a workspace; call `deductCredits(workspaceId, 'image_generated')`; the agency balance drops, the workspace's own `credits` is untouched, and a `QuarkLedger` row exists with `user` = agency and `workspace` = the client. Then `refundCredits(workspaceId, ...)` returns it. Then delete the agency and check `deductCredits` for the orphaned workspace fails and charges nothing.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "Agency: one shared Quark pool, charged to the agency and tagged by client"
```

---

### Task 6: Billing: buying the agency plan and extra client slots

**Files:**
- Modify: `backend/services/billingPlans.js` (`buildChargeUpdate`, ended-subscription helper, `invoiceSpec`, `razorpayPlanBody`, `isPlanId`-style helpers for kind `slot`), `backend/config/plans.js` (`ADDON_ENV_VARS`-style `SLOT_ENV_VAR`), `backend/routes/payment.js` (new route `create-slot-subscription`, webhook/verify handlers where `record.kind` is switched)
- Test: `backend/tests/agencyBilling.test.js`

**Interfaces:**
- Consumes: `AGENCY`, `PLANS.agency`.
- Produces: subscription record kind `'slot'` (key `'client'`); `bp.slotQuote()`, `bp.canBuySlot(user)`, `buildChargeUpdate({kind:'slot',...})` that `$inc`s `agency.extraSlots` by 1 on the first payment of that subscription and grants `AGENCY.slot.quarks` to the top-up bucket on every paid cycle; `bp.endUpdateFor(record)` for slot decrements `agency.extraSlots` by 1; `route POST /api/payment/create-slot-subscription` (no body) → `{ success, subscription_id, key, ... }` like the add-on route.

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/agencyBilling.test.js
const test = require('node:test');
const assert = require('node:assert');
const bp = require('../services/billingPlans');
const { PLANS, AGENCY, chargePaise } = require('../config/apiCosts');

test('the agency plan is billed like the other plans and sets the pool, the tier and the client limit', () => {
  const rec = { kind: 'plan', key: 'agency', subscriptionId: 'sub_a', razorpayPlanId: 'plan_a' };
  const u = bp.buildChargeUpdate(rec, { paymentId: 'pay_1', paidPaise: bp.planQuote('agency').chargePaise });
  assert.strictEqual(u.update.$set['plan.tier'], 'agency');
  assert.strictEqual(u.quarks, PLANS.agency.quarks);
  assert.strictEqual(u.update.$push.payments.exGstAmount, PLANS.agency.inr);
  assert.match(bp.invoiceSpec('plan', 'agency').description, /Agency plan/);
});

test('a client slot costs Rs 1,499 plus GST and is its own monthly subscription', () => {
  const q = bp.slotQuote();
  assert.strictEqual(q.inr, AGENCY.slot.inr);
  assert.strictEqual(q.chargePaise, chargePaise(AGENCY.slot.inr));
  assert.strictEqual(bp.invoiceSpec('slot', 'client').amountInr, AGENCY.slot.inr);
  const body = bp.razorpayPlanBody('slot', 'client');
  assert.strictEqual(body.item.amount, q.chargePaise);
  assert.strictEqual(body.notes.kind, 'slot');
});

test('a paid slot adds one client and grants its Quarks; a repeat payment of the same cycle grants nothing more', () => {
  const rec = { kind: 'slot', key: 'client', subscriptionId: 'sub_s' };
  const first = bp.buildChargeUpdate(rec, { paymentId: 'pay_s1', paidPaise: bp.slotQuote().chargePaise, firstCycle: true });
  assert.strictEqual(first.update.$inc['agency.extraSlots'], 1);
  assert.strictEqual(first.quarks, AGENCY.slot.quarks);
  const renewal = bp.buildChargeUpdate(rec, { paymentId: 'pay_s2', paidPaise: bp.slotQuote().chargePaise, firstCycle: false });
  assert.strictEqual(renewal.update.$inc['agency.extraSlots'], undefined);
  assert.strictEqual(renewal.quarks, AGENCY.slot.quarks);
});

test('only an agency account may buy a slot', () => {
  assert.strictEqual(bp.canBuySlot({ plan: { tier: 'professional' } }).ok, false);
  assert.strictEqual(bp.canBuySlot({ plan: { tier: 'agency' }, agency: { extraSlots: 20 } }).ok, true);
  assert.strictEqual(bp.canBuySlot({ plan: { tier: 'agency' }, agency: { extraSlots: 20 + 1 } }).ok, false, 'already at 25 clients');
});

test('ending a slot subscription removes one slot and nothing else', () => {
  const u = bp.endUpdateFor({ kind: 'slot', key: 'client', subscriptionId: 'sub_s' });
  assert.deepStrictEqual(u.$inc, { 'agency.extraSlots': -1 });
});
```

- [ ] **Step 2: Run to verify it fails** — `cd backend && node --test tests/agencyBilling.test.js` → FAIL.

- [ ] **Step 3: Implement**

In `services/billingPlans.js`:
- `slotQuote()` returns `{ id: 'client', ...priceBlock(AGENCY.slot.inr), quarks: AGENCY.slot.quarks }`.
- `canBuySlot(user)`: `{ ok:false, message:'Client slots are part of the Agency plan.' }` unless `resolveTier(user)==='agency'`; `{ ok:false, message:'You are at the most clients one agency account can have (25). Contact us for a larger set-up.' }` when `AGENCY.includedClients + extraSlots >= AGENCY.maxClients`.
- `invoiceSpec('slot','client')` → `inr = AGENCY.slot.inr; description = 'Extra client brand, one month'` using `INVOICE_ITEMS.addon` as the item name.
- `razorpayPlanBody('slot','client')` mirrors the add-on body: name `INVOICE_ITEMS.addon`, description `Extra client brand, monthly, including 18% GST`, notes `{ product:'nebulaa', kind:'slot', key:'client' }`.
- `envVarFor('slot', 'client')` → `'RAZORPAY_PLAN_ID_SLOT'` (add `SLOT_ENV_VAR` to `config/plans.js` and use it).
- `buildChargeUpdate`: new branch for `record.kind === 'slot'`:

```js
  } else if (record.kind === 'slot') {
    quarks = AGENCY.slot.quarks;
    const grant = buckets.topupGrantUpdate(quarks, { now });
    Object.assign($set, grant.set); inc = { ...grant.inc };
    if (firstCycle) inc['agency.extraSlots'] = 1;
```
  with `firstCycle = true` added to the destructured options (default `true` so existing callers are unaffected; the webhook caller passes `false` for renewals, see below). The existing `if (record.kind !== 'topup') $set['plan.subscriptions.$[sub].active'] = true;` continues to apply to slots.
- Agency plan: `isPlanId('agency')` is true automatically through `PLAN_PRESENTATION`. In the `record.kind === 'plan'` branch add `if (record.key === 'agency') { /* clientLimit is derived: includedClients + extraSlots */ }` (no stored limit; the limit is computed by `clientLimitOf`). Nothing else is needed there.
- `endUpdateFor(record)`: find the existing helper for "a subscription that ended" (the function after `buildChargeUpdate`, documented as "Update for a subscription that ended") and add a `slot` branch returning `{ $inc: { 'agency.extraSlots': -1 }, $set: { 'plan.subscriptions.$[sub].active': false } }`; export it as `endUpdateFor` if it has another name today (keep the old export as well). When the agency plan itself ends the existing code sets the tier back to `free`; extend that branch to also set `agency.extraSlots` to 0 only if every slot subscription ended with it (leave `extraSlots` untouched otherwise, they end through their own events).

In `routes/payment.js`: copy `create-addon-subscription` as `create-slot-subscription` (no body; `bp.canBuySlot`, `bp.slotQuote`, `getOrCreateRazorpayPlan('slot','client')`, record kind `'slot'`, key `'client'`, notes `{ userId, email, slot: 'client' }`). Where the webhook and verify handlers switch on `record.kind`, add `slot`: call `buildChargeUpdate` with `firstCycle` true when the stored subscription record is still inactive, false when it was already active (renewal), and after any successful agency plan or slot update call `require('../services/agencyWorkspaces').syncWorkspacePlans({ owner, models })` (best effort, errors logged). Block all of this for non-agency accounts through `canBuySlot`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && node --test tests/agencyBilling.test.js && node --test tests/*.test.js 2>&1 | grep -E "^ℹ (pass|fail)|^✖"` → pass. Existing payment tests that enumerate plan ids are updated for `agency` only.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "Agency billing: the Agency plan and extra client slots as monthly subscriptions"
```

---

### Task 7: Usage per client

**Files:**
- Create: `backend/services/agencyUsage.js`
- Modify: `backend/routes/agency.js` (add `GET /usage` and `GET /usage.csv`)
- Test: `backend/tests/agencyUsage.test.js`

**Interfaces:**
- Consumes: ledger rows with `workspace`, `action`, `quarks` (Task 5); `ACTION_UNITS` / `outputsFor` from config for post and video counts.
- Produces: `summarise(rows, workspaces): Array<{ id, name, posts, videos, quarksSpent }>` (pure); `toCsv(summary, monthLabel): string` (pure); `usageForMonth({ owner, month, models })` and routes `GET /api/agency/usage?month=YYYY-MM` → `{ success, month, poolLeft, clients: [...] }` and `/usage.csv`.

Counting rule: a ledger `spend` row with action in `POST_ACTIONS = ['image_generated','campaign_text','campaign_full','carousel_slide']` counts one post per `units` (use `ref`-less rows as one); actions in `VIDEO_ACTIONS = ['studio_video','video_generated','hero_video_clip']` count one video each. The implementer reads `config/apiCosts.js` `ACTION_USD`/`QUARK_COSTS` keys to complete these two lists with the real action names that `deductCredits` receives, and the test below pins the lists to those keys.

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/agencyUsage.test.js
const test = require('node:test');
const assert = require('node:assert');
const u = require('../services/agencyUsage');
const { QUARK_COSTS } = require('../config/apiCosts');

test('every action named in the usage lists is a real Quark action', () => {
  for (const a of [...u.POST_ACTIONS, ...u.VIDEO_ACTIONS]) assert.ok(a in QUARK_COSTS, a);
});

test('usage is summed per client: posts, videos and Quarks, refunds taken off', () => {
  const rows = [
    { workspace: 'w1', type: 'spend', action: 'image_generated', quarks: -11 },
    { workspace: 'w1', type: 'spend', action: 'image_generated', quarks: -11 },
    { workspace: 'w1', type: 'spend', action: 'studio_video', quarks: -161 },
    { workspace: 'w2', type: 'spend', action: 'image_generated', quarks: -11 },
    { workspace: 'w1', type: 'refund', action: 'image_generated', quarks: 11 },
    { workspace: null, type: 'spend', action: 'image_generated', quarks: -11 }
  ];
  const s = u.summarise(rows, [{ id: 'w1', name: 'Sweet Co' }, { id: 'w2', name: 'Tea House' }, { id: 'w3', name: 'Quiet' }]);
  assert.deepStrictEqual(s.find((c) => c.id === 'w1'), { id: 'w1', name: 'Sweet Co', posts: 1, videos: 1, quarksSpent: 172 });
  assert.deepStrictEqual(s.find((c) => c.id === 'w2'), { id: 'w2', name: 'Tea House', posts: 1, videos: 0, quarksSpent: 11 });
  assert.deepStrictEqual(s.find((c) => c.id === 'w3'), { id: 'w3', name: 'Quiet', posts: 0, videos: 0, quarksSpent: 0 });
  assert.strictEqual(s.length, 3, 'the agency\'s own spending is not a client');
});

test('the CSV has a header, one line per client, and quotes names that contain commas', () => {
  const csv = u.toCsv([{ id: 'w1', name: 'Sweet, Co', posts: 2, videos: 1, quarksSpent: 183 }], 'October 2026');
  const lines = csv.trim().split('\n');
  assert.strictEqual(lines[0], 'Client,Posts,Videos');
  assert.strictEqual(lines[1], '"Sweet, Co",2,1');
  assert.ok(!/quark/i.test(csv), 'customers see posts and videos, not Quarks');
});

test('month parsing accepts YYYY-MM only and falls back to the current month', () => {
  assert.deepStrictEqual(u.monthRange('2026-10', new Date('2026-12-01')), { from: new Date('2026-10-01T00:00:00.000Z'), to: new Date('2026-11-01T00:00:00.000Z'), label: 'October 2026' });
  assert.strictEqual(u.monthRange('nonsense', new Date('2026-12-15T00:00:00Z')).label, 'December 2026');
});
```

(Client w1: 11 + 11 + 161 − 11 refunded = 172 Quarks; the agency's own spending row has no workspace and is ignored.)

- [ ] **Step 2: Run to verify it fails** — `cd backend && node --test tests/agencyUsage.test.js` → FAIL.

- [ ] **Step 3: Implement**

```js
// backend/services/agencyUsage.js
'use strict';
/** What each client of an agency used in a month, from the Quark ledger. Customers see posts and videos, not Quarks. */
const POST_ACTIONS = ['image_generated', 'campaign_text'];
const VIDEO_ACTIONS = ['studio_video'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function monthRange(input, now = new Date()) {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(input || ''));
  const y = m ? Number(m[1]) : now.getUTCFullYear();
  const mo = m ? Number(m[2]) - 1 : now.getUTCMonth();
  return { from: new Date(Date.UTC(y, mo, 1)), to: new Date(Date.UTC(y, mo + 1, 1)), label: `${MONTHS[mo]} ${y}` };
}

function summarise(rows, workspaces) {
  const out = new Map(workspaces.map((w) => [String(w.id), { id: String(w.id), name: w.name, posts: 0, videos: 0, quarksSpent: 0 }]));
  for (const r of rows) {
    const c = r.workspace && out.get(String(r.workspace));
    if (!c || (r.type !== 'spend' && r.type !== 'refund')) continue;
    const sign = r.type === 'spend' ? 1 : -1;
    c.quarksSpent += sign * Math.abs(r.quarks);
    if (POST_ACTIONS.includes(r.action)) c.posts += sign;
    if (VIDEO_ACTIONS.includes(r.action)) c.videos += sign;
  }
  return [...out.values()].map((c) => ({ ...c, posts: Math.max(0, c.posts), videos: Math.max(0, c.videos), quarksSpent: Math.max(0, c.quarksSpent) }));
}

const q = (s) => (/[",\n]/.test(s) ? `"${String(s).replace(/"/g, '""')}"` : String(s));
function toCsv(summary) {
  return ['Client,Posts,Videos', ...summary.map((c) => `${q(c.name)},${c.posts},${c.videos}`)].join('\n') + '\n';
}

async function usageForMonth({ owner, month, models, now = new Date() }) {
  const { from, to, label } = monthRange(month, now);
  const { listWorkspaces } = require('./agencyWorkspaces');
  const workspaces = await listWorkspaces({ owner, models });
  const rows = await models.QuarkLedger.find({ user: owner._id, workspace: { $in: workspaces.map((w) => w.id) }, type: { $in: ['spend', 'refund'] }, createdAt: { $gte: from, $lt: to } }).lean();
  return { month: label, clients: summarise(rows, workspaces) };
}

module.exports = { POST_ACTIONS, VIDEO_ACTIONS, monthRange, summarise, toCsv, usageForMonth };
```

Add `QuarkLedger` to `defaultModels()` in `services/accountDeletion.js` only if not already included by `erasable()` (it is a user-owned model; check `dataRegistry`). In `routes/agency.js` add `GET /usage` (JSON with `poolLeft: await walletBalance(owner._id)` shown to the frontend as a count of posts via `outputsFor`) and `GET /usage.csv` (`Content-Disposition: attachment; filename="client-usage-<month>.csv"`), both agency-only and, from inside a client, readable only through the agency token (blocked by `isBlockedInsideClient`, which already blocks everything but the list and open).

- [ ] **Step 4: Run to verify it passes** — `cd backend && node --test tests/agencyUsage.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "Agency: usage per client by month, JSON and CSV"
```

---

### Task 8: Ayrshare profile watch and the alert at 25

**Files:**
- Create: `backend/services/ayrshareProfileWatch.js`
- Modify: `backend/routes/staff.js` (read-only endpoint `GET /api/staff/ayrshare-profiles`, permission the same as the AI spend card), `backend/server-main.js` (hourly check), `frontend/pages/staff/StaffMoney.tsx` (show the count) if that page exists (the spec calls it the Money page; locate with `grep -rl "Reset Ayrshare" frontend/pages/staff`)
- Test: `backend/tests/agencyProfileWatch.test.js`

**Interfaces:**
- Produces: `PROFILE_LIMIT = 30` (flat-fee profiles), `ALERT_AT = 25` (named constants, with the comment that they come from the Ayrshare Business plan); `status(count): { count, limit, alertAt, level: 'ok'|'near'|'over', message }` (pure); `countProfiles({ User }): Promise<number>` counts users with a non-empty `ayrshare.profileKey` (workspaces included: each is a profile); `check({ User, alert, state }): Promise<status>` raising `alert(message)` once per level change.

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/agencyProfileWatch.test.js
const test = require('node:test');
const assert = require('node:assert');
const p = require('../services/ayrshareProfileWatch');

test('below 25 is fine, 25 to 30 is a warning, past 30 costs extra', () => {
  assert.strictEqual(p.status(7).level, 'ok');
  assert.strictEqual(p.status(24).level, 'ok');
  assert.strictEqual(p.status(25).level, 'near');
  assert.strictEqual(p.status(30).level, 'near');
  assert.strictEqual(p.status(31).level, 'over');
  assert.match(p.status(26).message, /26 of 30/);
  assert.match(p.status(31).message, /extra/);
});

test('the alert fires once per change of level, not every hour', async () => {
  const sent = [];
  const state = {};
  const User = (n) => ({ countDocuments: async () => n });
  await p.check({ User: User(10), alert: (m) => sent.push(m), state });
  await p.check({ User: User(25), alert: (m) => sent.push(m), state });
  await p.check({ User: User(26), alert: (m) => sent.push(m), state });
  await p.check({ User: User(31), alert: (m) => sent.push(m), state });
  await p.check({ User: User(31), alert: (m) => sent.push(m), state });
  assert.strictEqual(sent.length, 2, 'near once, over once');
});
```

- [ ] **Step 2: Run to verify it fails** — `cd backend && node --test tests/agencyProfileWatch.test.js` → FAIL.

- [ ] **Step 3: Implement**

```js
// backend/services/ayrshareProfileWatch.js
'use strict';
/**
 * Ayrshare Business plan: a flat fee covers the first 30 social profiles, each one after that is billed extra
 * (USD 8.99 a month in October 2026). Every connected account and every agency client is one profile.
 */
const PROFILE_LIMIT = 30;
const ALERT_AT = 25;

function status(count) {
  const level = count > PROFILE_LIMIT ? 'over' : count >= ALERT_AT ? 'near' : 'ok';
  const message = level === 'over'
    ? `${count} connected social profiles: past the ${PROFILE_LIMIT} covered by the flat fee, so each extra profile now costs extra every month. Review the Agency and Publish prices.`
    : level === 'near'
      ? `${count} of ${PROFILE_LIMIT} connected social profiles used. Past ${PROFILE_LIMIT} each profile costs extra, so plan the price change for new Agency sign-ups.`
      : `${count} of ${PROFILE_LIMIT} connected social profiles used.`;
  return { count, limit: PROFILE_LIMIT, alertAt: ALERT_AT, level, message };
}

const countProfiles = ({ User }) => User.countDocuments({ 'ayrshare.profileKey': { $exists: true, $nin: [null, ''] } });

async function check({ User, alert, state = {} }) {
  const s = status(await countProfiles({ User }));
  if (s.level !== 'ok' && state.level !== s.level) { try { alert(s.message); } catch (_) { /* alerting never stops the check */ } }
  state.level = s.level;
  return s;
}

module.exports = { PROFILE_LIMIT, ALERT_AT, status, countProfiles, check };
```

Wire it: in `routes/staff.js` add a read-only `GET /ayrshare-profiles` with the same permission as the AI spend card, returning `status(...)`; in `server-main.js` start an hourly `setInterval` (unref'd, guarded by `process.env.NODE_ENV !== 'test'`) calling `check({ User, alert: (m) => require('./services/opsAlerts').recordFailure('billing', m), state })`. Show the count on the staff Money page as one line using the returned `message`, with a warning style when `level !== 'ok'`.

- [ ] **Step 4: Run to verify it passes** — `cd backend && node --test tests/agencyProfileWatch.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add backend frontend/pages/staff
git commit -m "Staff: Ayrshare profile count with an alert at 25 of 30"
```

---

### Task 9: Removing clients, deleting an agency, staff and scheduler exclusions

**Files:**
- Modify: `backend/services/accountDeletion.js` (eligibility, `stepsFor` agency handling, `runPurgeOnce` for workspaces), `backend/services/agencyWorkspaces.js` (`removeWorkspace`), `backend/routes/agency.js` (`DELETE /clients/:id`), `backend/routes/account.js` (agency deletion request), `backend/services/staff/clientList.js` (exclude workspaces), `backend/services/billingScheduler.js` and `renewalReminders.js` (skip users with no `subscription`/skip workspaces)
- Test: `backend/tests/agencyDeletion.test.js`

**Interfaces:**
- Consumes: `defaultModels`, `stepsFor`, `purgeOne` in `services/accountDeletion.js`; `releaseSlot`.
- Produces: `removeWorkspace({ owner, workspaceId, password verified by route, models, deps }): Promise<{ ok, message? }>` which runs the purge steps for the workspace immediately (no 14-day wait, no emails) and then `releaseSlot`; agency self-deletion: `requestDeletion` stays the same but the purge's `account` step for an agency first runs `removeWorkspace` for every client (a new step `clients` inserted before `files` in `stepsFor` when `isAgency(user)`).
- `eligibility(user, ...)` for an agency account returns `ok` (agencies may delete) and `clients: n` so the UI can list what will go; a workspace is never eligible through `/api/account` (`isWorkspace` → `{ ok:false, message:'Remove this client from your agency account.' }`).

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/agencyDeletion.test.js
const test = require('node:test');
const assert = require('node:assert');
const d = require('../services/accountDeletion');
const w = require('../services/agencyWorkspaces');

test('a client account cannot be deleted through the account page', () => {
  const e = d.eligibility({ agency: { ownerId: 'o1' }, plan: { tier: 'agency' } }, { isStaff: () => false, resolveTier: () => 'agency' });
  assert.strictEqual(e.ok, false);
  assert.match(e.message, /agency account/);
});

test('an agency may delete its own account', () => {
  const e = d.eligibility({ plan: { tier: 'agency' }, agency: { clientCount: 3 } }, { isStaff: () => false, resolveTier: () => 'agency' });
  assert.strictEqual(e.ok, true);
});

test('deleting an agency erases its clients first, then itself', () => {
  const names = d.stepsFor({ _id: 'o1', email: 'a@b.com', plan: { tier: 'agency' }, agency: { clientCount: 2 } }, { models: {}, deps: {}, now: new Date() }).map((s) => s.name);
  assert.ok(names.indexOf('clients') >= 0 && names.indexOf('clients') < names.indexOf('data') && names.indexOf('data') < names.indexOf('account'), names.join(','));
});

test('removing a client erases it at once, releases the slot and sends no email', async () => {
  const calls = [];
  const out = await w.removeWorkspace({
    owner: { _id: 'o1', plan: { tier: 'agency' } }, workspaceId: 'w1',
    models: { User: { find: () => ({ sort: () => ({ lean: async () => [{ _id: 'w1', agency: { ownerId: 'o1', workspaceName: 'Sweet' } }] }) }), updateOne: async (f, u) => calls.push(['release', u]) } },
    purge: async (id) => { calls.push(['purged', id]); return { ok: true }; }
  });
  assert.strictEqual(out.ok, true);
  assert.deepStrictEqual(calls[0], ['purged', 'w1']);
  assert.deepStrictEqual(calls[1][1], { $inc: { 'agency.clientCount': -1 } });
});

test('removing a client that belongs to someone else does nothing', async () => {
  const out = await w.removeWorkspace({ owner: { _id: 'o1' }, workspaceId: 'w9', models: { User: { find: () => ({ sort: () => ({ lean: async () => [] }) }) } }, purge: async () => { throw new Error('must not run'); } });
  assert.strictEqual(out.ok, false);
});
```

- [ ] **Step 2: Run to verify it fails** — `cd backend && node --test tests/agencyDeletion.test.js` → FAIL.

- [ ] **Step 3: Implement**

- `services/agencyWorkspaces.js`:

```js
/** Erase a client and everything it holds, at once. `purge(workspaceId)` runs the standard erase steps. */
async function removeWorkspace({ owner, workspaceId, models, purge }) {
  const mine = (await listWorkspaces({ owner, models })).find((w) => w.id === String(workspaceId));
  if (!mine) return { ok: false, message: 'That client was not found.' };
  const out = await purge(mine.id);
  if (!out || out.ok === false) return { ok: false, message: 'We could not finish removing this client. Nothing else was changed. Please try again.' };
  await releaseSlot(models.User, owner._id);
  return { ok: true };
}
```
  and export it. The default `purge` (used by the route) builds the steps with `stepsFor(workspaceUser, { models, deps: defaultDeps(), now })`, runs them in order like `purgeOne` does but skips the `keep_payment_records`, `staff_log`, `tombstone` steps (a workspace has no payments or email) and does not send the "deleted" email. Implement this as `purgeWorkspace(workspaceId)` in `services/accountDeletion.js` reusing the same step list and the `defaultDeps()`; a failed step returns `{ ok:false }` and leaves the workspace in place so it can be retried.
- `services/accountDeletion.js`:
  - `eligibility`: add at the top `if (user && user.agency && user.agency.ownerId) return { ok:false, message:'Remove this client from your agency account.' };`.
  - `stepsFor`: when `isAgency(user)`, add as the first step after `keep_payment_records`:

```js
    {
      name: 'clients',
      run: async () => {
        const list = await listWorkspaces({ owner: user, models });
        for (const c of list) {
          const out = await purgeWorkspace(c.id, { models, deps, now });
          if (!out.ok) throw new Error(`client "${c.name}" could not be erased`);
        }
        return { detail: `${list.length} clients erased`, skipped: list.length === 0 };
      }
    },
```
  - The agency's own `data` step must not re-delete clients (they are already gone) and the `RETAINED` payment step is unchanged.
- `routes/agency.js`: `DELETE /clients/:id` requires `{ password }` (reuse `passwordOk` from `routes/account.js` by moving it to `services/accountDeletion.js` as `passwordOk(userId, password)` and importing it in both routes) and `confirm: 'REMOVE'`; returns `{ success:true }`. Blocked inside a client already.
- `routes/account.js` `/status` adds `clients: user.agency?.clientCount || 0` for agency accounts so the UI can say "This also deletes N client brands."
- `services/staff/clientList.js`: add `'agency.ownerId': { $exists: false }` to the base filter so workspaces never appear in the staff client lists or counts. Check `clientBulk.js` and `clientStatus.js` use that list; if they query users directly, add the same filter.
- `services/billingScheduler.js` and `renewalReminders.js`: confirm they select only users with an active subscription (`subscription.status: 'active'`); a workspace has none, so they skip it. Add a one-line comment, and one test in `agencyDeletion.test.js` only if either selects by `plan.tier` alone (then add the filter and a test).

- [ ] **Step 4: Run to verify it passes, then a real removal**

Run: `cd backend && node --test tests/agencyDeletion.test.js && node --test tests/*.test.js 2>&1 | grep -E "^ℹ (pass|fail)|^✖"`
Real check on `nebulaa_dev` with throwaway users: agency + 2 clients with a draft each; remove one client (its data gone, `clientCount` 1, the other untouched); delete the agency with a forced-past `purgeAfter` and `runPurgeOnce`: both clients and the agency are gone, a retained payment exists for the agency only. Delete any leftovers.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "Agency: remove a client, delete an agency with its clients, keep clients out of staff lists"
```

---

### Task 10: Frontend: switcher, pass handling and the Clients page

**Files:**
- Create: `frontend/utils/agency.ts`, `frontend/components/ClientSwitcher.tsx`, `frontend/pages/AgencyClients.tsx`, `frontend/tests/agency.test.mjs`
- Modify: `frontend/services/api.ts`, `frontend/types.ts`, `frontend/components/Layout.tsx`, `frontend/App.tsx`

**Interfaces:**
- Consumes: the `/api/agency/*` endpoints of Task 4 and 9, `plan.tier === 'agency'` on the user.
- Produces in `utils/agency.ts`:
  - `isAgencyUser(user): boolean`
  - `clientsLeft(used: number, limit: number): number`
  - `limitLabel(used, limit): string` → e.g. `"3 of 5 clients"`
  - `actingBannerText(name): string`
- `apiService` methods: `getAgencyClients()`, `createAgencyClient({name, industry})`, `renameAgencyClient(id, name)`, `removeAgencyClient(id, password)`, `openAgencyClient(id)` (stores the keys below and reloads), `getAgencyUsage(month)`, `downloadAgencyUsage(month)`.
- Pass handling reuses the existing CSM keys so `getCurrentUser`'s fall-back and the Layout banner keep working: opening a client sets `csmReturnToken` to the agency's current token, `csmActingClient` to the client name, `csmReturnTo` to `'#/agency/clients'`, then sets the client's token; the existing `apiService.returnToCsmAccount()` returns.

- [ ] **Step 1: Write the failing test**

```js
// frontend/tests/agency.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { isAgencyUser, clientsLeft, limitLabel, actingBannerText } from '../utils/agency.ts';

test('only an account on the Agency plan is an agency, and a client inside it is not', () => {
  assert.equal(isAgencyUser({ plan: { tier: 'agency' } }), true);
  assert.equal(isAgencyUser({ plan: { tier: 'professional' } }), false);
  assert.equal(isAgencyUser(null), false);
  assert.equal(isAgencyUser({ plan: { tier: 'agency' }, actingAgency: { name: 'Studio X' } }), false);
});

test('slots left and the label never go negative', () => {
  assert.equal(clientsLeft(3, 5), 2);
  assert.equal(clientsLeft(7, 5), 0);
  assert.equal(limitLabel(3, 5), '3 of 5 clients');
  assert.equal(limitLabel(1, 5), '1 of 5 clients');
});

test('the banner inside a client names the client and says where money is handled', () => {
  assert.match(actingBannerText('Sweet Co'), /Sweet Co/);
  assert.doesNotMatch(actingBannerText('Sweet Co'), /credit|trial/i);
});
```

- [ ] **Step 2: Run to verify it fails** — `cd frontend && node --test tests/agency.test.mjs` → FAIL.

- [ ] **Step 3: Implement**

`utils/agency.ts`:

```ts
/** Small rules for the agency screens, kept apart so they can be tested. */
export function isAgencyUser(user: { plan?: { tier?: string | null } | null; actingAgency?: unknown } | null | undefined): boolean {
  return !!user && user.plan?.tier === 'agency' && !user.actingAgency;
}
export const clientsLeft = (used: number, limit: number): number => Math.max(0, limit - used);
export const limitLabel = (used: number, limit: number): string => `${used} of ${limit} clients`;
export const actingBannerText = (name: string): string =>
  `You are working in ${name || 'a client'}'s brand. Payments, plans and passwords are handled in your agency account.`;
```

`types.ts`: add to `User`: `actingAgency?: { name: string } | null;`.

`services/api.ts` methods (follow the `getBillingDetails` style; `openAgencyClient` implements the key hand-off):

```ts
  getAgencyClients: async (): Promise<{ success: boolean; clients: Array<{ id: string; name: string; createdAt: string; frozen: boolean }>; limit: number; used: number; slotInr: number; slotQuarks: number }> =>
    apiCall('/agency/clients', { method: 'GET' }, true),
  createAgencyClient: async (d: { name: string; industry?: string }): Promise<{ success: boolean; message?: string }> => {
    try { return await apiCall('/agency/clients', { method: 'POST', body: JSON.stringify(d) }, true); }
    catch (e: any) { return { success: false, message: e?.message || 'We could not add this client. Please try again.' }; }
  },
  renameAgencyClient: async (id: string, name: string): Promise<{ success: boolean; message?: string }> =>
    apiCall(`/agency/clients/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }, true),
  removeAgencyClient: async (id: string, password: string): Promise<{ success: boolean; message?: string }> => {
    try { return await apiCall(`/agency/clients/${id}`, { method: 'DELETE', body: JSON.stringify({ password, confirm: 'REMOVE' }) }, true); }
    catch (e: any) { return { success: false, message: e?.message || 'We could not remove this client. Nothing was changed.' }; }
  },
  openAgencyClient: async (id: string): Promise<{ success: boolean; message?: string }> => {
    try {
      const r: any = await apiCall(`/agency/clients/${id}/open`, { method: 'POST' }, true);
      if (!r?.success) return { success: false, message: r?.message };
      // Same hand-off the CSM pass uses, so "back" and the banner already work.
      if (!localStorage.getItem('csmReturnToken')) localStorage.setItem('csmReturnToken', getToken() || '');
      localStorage.setItem('csmActingClient', r.client.name);
      localStorage.setItem('csmReturnTo', '#/agency/clients');
      setToken(r.token);
      return { success: true };
    } catch (e: any) { return { success: false, message: e?.message || 'We could not open this client.' }; }
  },
  getAgencyUsage: async (month?: string): Promise<{ success: boolean; month: string; poolPosts: number; clients: Array<{ id: string; name: string; posts: number; videos: number }> }> =>
    apiCall(`/agency/usage${month ? `?month=${month}` : ''}`, { method: 'GET' }, true),
```
(plus `downloadAgencyUsage(month)` modelled on `downloadMyData`, saving the CSV).

`ClientSwitcher.tsx`: a header dropdown shown for `isAgencyUser(user)` or while `localStorage.csmReturnToken` is set and `user.actingAgency` exists; lists clients from `getAgencyClients()`; choosing one calls `openAgencyClient(id)` then `window.location.hash = '#/dashboard'; window.location.reload()`; has an "All clients" link to `#/agency/clients` and, inside a client, "Back to agency" that calls `apiService.returnToCsmAccount()` then reloads at `#/agency/clients`.

`AgencyClients.tsx` (route `/agency/clients`): heading "Clients"; the `limitLabel`; a list with name, open button, rename (inline), remove (password + type REMOVE, same pattern as `AccountPrivacy`); an "Add a client" form (name, optional industry; shows the server message on the 403/400 refusal); when `clientsLeft === 0` a card "Add a client slot, ₹{slotInr} + GST a month" that calls the Task 6 slot subscription through a new `apiService.createSlotSubscription()` and opens Razorpay the same way `TrialExpired.tsx` does for add-ons (read its add-on purchase code and reuse the helper rather than duplicating it). Style with the same `--gv-*` tokens and card classes as `AccountPrivacy.tsx`. Words: "clients", "posts", "videos"; never "credits", "trial" or "Quarks".

`Layout.tsx`: render `<ClientSwitcher user={user} />` in the header beside the user menu; change the existing acting banner copy to use `actingBannerText(name)` when `user.actingAgency` is set (keep the CSM copy otherwise); the button label is "Back to agency" when `csmReturnTo === '#/agency/clients'`. Add "Clients" to the sidebar menu only for `isAgencyUser(user)`. `App.tsx`: add `<Route path="/agency/clients" element={<AgencyClients user={user} />} />` inside the protected routes.

- [ ] **Step 4: Run, audit, check in the browser**

Run: `cd frontend && node --test tests/*.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)|^✖"; node scripts/visual-audit/gen-layer-lists.mjs | tail -1; node scripts/brand-audit.mjs | tail -1; node scripts/voice-audit.mjs | tail -1` → all pass, 0 violations.
Browser check (dev servers, throwaway agency user with `plan.tier='agency'` and a token, Task 4's throwaway pattern): the Clients page lists, adds (up to 5 then shows the slot card), renames and removes; the switcher opens a client, the banner shows with "Back to agency", Billing and Settings→Security deletion show the blocked message, and going back restores the agency view. Delete the throwaway users.

- [ ] **Step 5: Commit**

```bash
git add frontend
git commit -m "Agency screens: client switcher, back to agency, Clients page"
```

---

### Task 11: Frontend: plans page, usage view and pool display

**Files:**
- Modify: `frontend/pages/TrialExpired.tsx` (plans page: show the Agency plan), `frontend/pages/GravityHome.tsx` (agency usage block), `frontend/components/AgencyUsage.tsx` (create), `frontend/services/api.ts` (`getPlanCatalogue` type gets `agency`), `frontend/utils/plans.ts` (`tierLabel('agency')`)
- Test: add cases to `frontend/tests/plans.test.mjs`

**Interfaces:**
- Consumes: `planCatalogue().agency` (Task 1), `getAgencyUsage` (Task 10).
- Produces: `tierLabel('agency') === 'Agency'`; `AgencyUsage` component (month picker, table of client / posts / videos, "Download CSV", pool shown as roughly N posts or M videos left using the existing `outputsFor`-style numbers the server returns as `poolPosts`).

- [ ] **Step 1: Write the failing test** (append to `tests/plans.test.mjs`)

```js
test('the Agency plan has a plain label and its wording never says credits or trial', () => {
  assert.equal(tierLabel('agency'), 'Agency');
  assert.doesNotMatch(upgradeMessage('quarks'), /credit|trial/i);
});
```

- [ ] **Step 2: Run to verify it fails** — `cd frontend && node --test tests/plans.test.mjs` → FAIL (`tierLabel('agency')`).

- [ ] **Step 3: Implement**

- `utils/plans.ts`: add `agency: 'Agency'` to the label map used by `tierLabel`.
- `TrialExpired.tsx`: the plans page maps over `catalogue.plans`; add the Agency card from `plan.id === 'agency'` showing price, "5 client brands included", the listed features, and under it one line "Extra clients ₹{slotInr} + GST a month each, up to {maxClients}". Subscribing uses the existing plan checkout with `planId: 'agency'` (the server already accepts any id in `PLAN_PRESENTATION`). Hide the Agency card for accounts inside a client (`user.actingAgency`).
- `components/AgencyUsage.tsx`: month `<input type="month">`, table, CSV button; no Quark numbers anywhere.
- `GravityHome.tsx` (the dashboard): render `<AgencyUsage />` above the existing content when `isAgencyUser(user)`.
- Server: `GET /api/agency/usage` includes `poolPosts` using `outputsFor(walletBalance).posts` (Task 7 step already returns it; verify and add if missing).

- [ ] **Step 4: Run, audit, browser check**

Run the frontend tests, `gen-layer-lists.mjs`, brand and voice audits as in Task 10. In the browser: as an agency throwaway user the dashboard shows the usage table and the plans page shows the Agency card with the slot line; as a Starter user the Agency card shows too (it is a plan anyone may choose) and checkout opens.

- [ ] **Step 5: Commit**

```bash
git add frontend
git commit -m "Agency: plan on the plans page, usage table and CSV on the dashboard"
```

---

### Task 12: Terms, Privacy, full verification and release notes

**Files:**
- Modify: `frontend/pages/TermsAndConditions.tsx`, `frontend/pages/PrivacyPolicy.tsx`, `backend/config/legalVersions.js` (bump the date to the day of this change)
- Create: `docs/superpowers/ops/agency-launch-checklist.md`

**Interfaces:** none (copy and verification).

- [ ] **Step 1: Write the wording**

In the Terms, a new numbered section "Agency accounts and client brands": the agency confirms it has each client's permission to manage their brand, content and social accounts on Nebulaa; the agency is responsible for what is published; clients are paid for from the agency's plan and shared pool; removing a client erases that client's data at once; cancelling the agency plan pauses all clients and nothing is deleted until the agency removes them or deletes the account. In the Privacy Policy, under "Your Rights" or "Data Sharing": for client brands the agency decides what happens to that data and is the contact for requests about it; Nebulaa acts on the agency's instructions. Keep both marked as drafts for lawyer review like the other legal pages (follow the existing draft banner). Bump `legalVersions` date.

- [ ] **Step 2: Run everything**

```bash
cd backend && node --test tests/*.test.js 2>&1 | grep -E "^ℹ (pass|fail)|^✖"
cd ../frontend && node --test tests/*.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)|^✖"; node scripts/brand-audit.mjs | tail -1; node scripts/voice-audit.mjs | tail -1; node scripts/visual-audit/gen-layer-lists.mjs | tail -1
```
Expected: 0 failures, 0 violations. Re-run the frontend tests after `gen-layer-lists.mjs`.

- [ ] **Step 3: Real end-to-end on `nebulaa_dev` with throwaway users** (record results in the commit message, delete the users after)

1. Agency user (tier `agency`, 6,000 Quarks by `scripts/add-dev-quarks.js` or a direct update): create 5 clients; the 6th is refused with the slot message.
2. Open client A: make one post (real image generation, cost about ₹0.5 at low quality) and check: agency balance fell by the post cost, ledger row has `workspace` = A, A's own `credits` untouched, `GET /api/agency/usage` shows 1 post for A.
3. Inside A: `POST /api/payment/...` and `POST /api/account/deletion/request` both return the blocked message.
4. Agency plan removed (set tier `professional`): A's pass is rejected with the paused message; no data deleted; restore the tier and `syncWorkspacePlans` re-opens it.
5. Remove client B, then delete the agency (forced purge): all clients and the agency gone, retained payment present for the agency only.
6. Staff client list does not show any workspace; `GET /api/staff/ayrshare-profiles` returns a sensible count.

- [ ] **Step 4: Write the launch checklist**

`docs/superpowers/ops/agency-launch-checklist.md` listing the owner steps before opening the Agency plan: create the Razorpay plans (`RAZORPAY_PLAN_ID_AGENCY` and `RAZORPAY_PLAN_ID_SLOT` in the secret via `set-secret-value.sh`; add the two names to its allowlist and to `check-secret-keys.sh`), confirm with Subashni (GST and SAC on agency invoices, the new Terms clause), lawyer review of the new legal text, re-measure the cost per Quark, ask Ayrshare whether a profile created and removed in one month is billed in full, and the repricing trigger (alert at 25 profiles; new Agency sign-ups move to ₹9,999 when the platform nears 30 profiles).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Agency plan: legal wording, full verification and launch checklist"
```
