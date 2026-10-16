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

