### Task 5: The API for customers and staff

**Files:**
- Create: `backend/routes/plan.js`
- Modify: `backend/server-main.js` (mount `/api/plan`), `backend/routes/staff.js` (client plan summary and refresh), `backend/routes/campaigns.js` (retire `GET/PUT /icp-strategy`: answer 410 with a plain message and remove their use)
- Test: `backend/tests/planRoutes.test.js`

**Interfaces:**
- `GET /api/plan` (protect): `{ success, plan: { id, completedAt, stale, result } | null, running: boolean, failed: boolean, nextRefreshAt: string|null, eligible: boolean, reason: '' | 'free' | 'profile_incomplete' | 'not_eligible', missing: string[], freeBlueprint: { id } | null }`. For a free account `eligible:false, reason:'free'` and `freeBlueprint` is the account's free Blueprint id when it has one (reuse `Blueprint.findOne({ userId, kind: 'blueprint', status: 'completed', freeSlot: true })`).
- `POST /api/plan/refresh` (protect, rate limited 5 per 15 minutes): `{ success, message, nextRefreshAt }`; 429 with the rule's message when too soon; 400 when not eligible.
- Staff: `GET /api/staff/clients/:id/plan` (permission `view_clients`): the same body for that client, plus `{ lastRunAt, lastStatus }`; `POST /api/staff/clients/:id/plan/refresh` (permission `manage_client` or the one used by other client actions; read `routes/staff.js` for the right one): bypasses the weekly limit, logs a `StaffAction` like the other actions.
- Both customer routes work for an account inside a CSM pass (the plan is the client's); inside an agency pass they are allowed (read and refresh) because they touch no money.

- [ ] **Step 1: Write the failing test** (use the same fake-service style as `tests/blueprintRoutes.test.js`: build the router with an injected `service` and a fake `protect`; copy its harness)

```js
// backend/tests/planRoutes.test.js — adapt the harness of tests/blueprintRoutes.test.js
const test = require('node:test');
const assert = require('node:assert');
// harness: const { call } = makeHarness(createPlanRouter({ service: fake, now: () => NOW }), { user })

test('GET /api/plan for a paying account with a plan returns it with the date and no staleness', async () => { /* expect plan.id, running false, eligible true */ });
test('GET /api/plan for a free account explains and points to the free Blueprint', async () => { /* eligible false, reason free, freeBlueprint.id */ });
test('GET /api/plan for an incomplete profile lists what is missing in plain words', async () => { /* reason profile_incomplete, missing array */ });
test('POST /api/plan/refresh: first time ok, second time 429 with the once-a-week message', async () => {});
test('a plan older than 45 days is returned with stale true', async () => {});
test('the old ICP endpoints answer 410 and never call the old generator', async () => {});
test('staff refresh ignores the weekly limit and is logged; a CSM without access to the client is refused', async () => {});
```
Write each test fully against the harness (assert status codes and bodies); the comments above state the exact expectations.

- [ ] **Step 2: Run to verify they fail** — module not found.

- [ ] **Step 3: Implement** `routes/plan.js` as `createPlanRouter(impl = {})` with lazy service creation like `routes/blueprint.js`; a `serialise(user, planService)` helper builds the GET body using `planRules`; reuse `isStale`; rate limiter as in the Blueprint routes. Staff endpoints in `routes/staff.js` use the existing `requireStaff(...)` and `clientFor` (which now excludes workspaces: confirm) and `logStaffAction`. In `routes/campaigns.js` replace the two ICP handlers' bodies with `res.status(410).json({ success:false, message:'Your customer profile now lives in My plan.' })` and remove the now-unused generator code only if nothing else imports it (grep first); leave `User.icpStrategy` in the model.

- [ ] **Step 4: Run to verify they pass**, plus the full backend suite.

- [ ] **Step 5: Commit** — `git add backend && git commit -m "Plan: /api/plan for customers, staff client plan and refresh, old ICP endpoints retired"`

---

