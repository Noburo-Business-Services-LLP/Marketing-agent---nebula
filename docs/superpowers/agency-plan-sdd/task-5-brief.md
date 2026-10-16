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

