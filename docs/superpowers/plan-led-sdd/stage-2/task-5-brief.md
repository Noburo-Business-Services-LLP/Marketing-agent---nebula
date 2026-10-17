### Task 5: API for the week and the setup path

**Files:**
- Create: `backend/routes/week.js`
- Modify: `backend/server-main.js` (mount `/api/week` and `/api/setup`), `backend/routes/plan.js` (stamp `setup.planOpenedAt` when `GET /api/plan` returns a plan, once), `backend/routes/auth.js` only if `/me` should include `setup` (add `setup: { planOpenedAt, firstWeekApprovedAt }` to `toPublicJSON`)
- Test: `backend/tests/weekRoutes.test.js`

**Interfaces:**
- `GET /api/week` → `{ success, eligible, reason, proposal: { weekStart, status, items[], counts, scaledDown, removed, empty } | null, topUp: boolean }` (`topUp` true when `empty` because the pool is below one post); `POST /api/week/approve` body `{ itemIds? }` → `{ success, proposal, prefills: [{ itemId, target: 'carousel'|'video', route, prefill }] }`; `POST /api/week/items/:id` body `{ action: 'skip'|'swap', topic? }`; `POST /api/week/skip`; `GET /api/setup` → `{ success, steps, next, allDone }` built with `setupSteps` from the user, the connected account count, `planService.currentPlan` and `user.setup`.
- A switch: when the environment variable `ENABLE_WEEKLY_PROPOSAL` equals `off`, `GET /api/week` answers `{ success: true, eligible: false, reason: 'off', proposal: null }` and the write routes answer 403 (a test covers it); unset or anything else means on.
- All protected; refused with 403 for staff accounts; allowed in a CSM pass and an agency pass (no money or plan changes happen in these routes beyond the post charge, which goes to the correct payer through `deductCredits`). Rate limit 30 per 15 minutes on writes. When Approve stamps `setup.firstWeekApprovedAt` the first time.

- [ ] **Step 1: Write the failing test** (same harness style as `tests/planRoutes.test.js` from Stage 1: injected fake services)

```js
// backend/tests/weekRoutes.test.js
const test = require('node:test');
const assert = require('node:assert');
// harness: makeHarness(createWeekRouter({ week: fakeWeekService, plan: fakePlanService, setup: fakeSetupDeps }), { user })
test('GET /api/week returns the proposal for an eligible account and an explanation otherwise', async () => {});
test('POST /api/week/approve returns the prefills for carousels and videos and stamps firstWeekApprovedAt once', async () => {});
test('writes are refused for staff accounts and limited per account', async () => {});
test('GET /api/setup returns ordered steps with one next step', async () => {});
test('opening the plan stamps planOpenedAt once and never again', async () => {});
test('a request inside an agency or CSM pass works on the client account', async () => {});
```
Write each test body fully against the harness; the titles state the expected status codes and fields (200/403/429, `next`, `prefills[].target`).

- [ ] **Step 2: Run to verify they fail.** **Step 3: Implement** `routes/week.js` as `createWeekRouter(impl)` following `routes/plan.js`; prefill objects: carousel → `{ route: '/campaigns', target: 'carousel', prefill: { mode: 'carousel', topic, platform: channel, language } }`; video → `{ route: '/reels', target: 'video', prefill: { idea: topic, language } }` (exact field names must match what Task 6 consumes). **Step 4: Run the test and the full suite. Step 5: Commit** — `git add backend && git commit -m "Week: /api/week and /api/setup, first approval and plan opening are recorded"`

---

