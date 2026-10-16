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

