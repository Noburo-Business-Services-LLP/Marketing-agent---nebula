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

