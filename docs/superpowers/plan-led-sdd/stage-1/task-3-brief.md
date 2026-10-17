### Task 3: Plan runs: rules and the service

**Files:**
- Create: `backend/services/plan/planRules.js`, `backend/services/plan/planService.js`
- Modify: `backend/models/Blueprint.js` (add `kind: { type: String, enum: ['blueprint', 'plan'], default: 'blueprint', index: true }`), `backend/models/User.js` (add `planState: { lastStartedAt: Date, lastRefreshAt: Date, firstPlanFailedAt: Date, attempts: Number }`), `backend/services/blueprint/service.js` (export what `planService` needs: `createBlueprintService` returns `{ start, run, get, list }` today: add `startSystem({ user, input, kind })` described below, reusing `Blueprint.create`, `deps.enqueue`, `run`)
- Test: `backend/tests/planRules.test.js`, `backend/tests/planService.test.js`

**Interfaces:**
- Produces in `planRules.js` (pure): `canRefresh({ user, now, staff }): { ok, nextAt?, message? }` (7-day rule via `planState.lastRefreshAt`, staff always ok); `shouldHavePlan(user): boolean` (not staff, not CSM, not a pending deletion, onboarding completed, profile complete, account active; free accounts: false — they keep the free Blueprint); `monthlyDue({ user, lastPlanAt, now }): boolean` (a plan older than 30 days, or none); `isStale(planDoc, now): boolean` (older than 45 days).
- Produces in `planService.js`: `createPlanService(deps)` returning `{ startPlan({ userId, reason }), currentPlan(userId), inFlight(userId), refresh({ user, staff }) }` where `startPlan` loads the user, checks `shouldHavePlan`, refuses if a plan run for the user is `queued` or `processing` (returns `{ ok:true, alreadyRunning:true }`), builds `inputFromProfile`, calls the Blueprint service `startSystem`, and records `planState.lastStartedAt`; `currentPlan(userId)` returns the newest `kind:'plan'`, `status:'completed'` Blueprint document trimmed to `{ id, completedAt, result }` or null; `refresh` applies `canRefresh` then `startPlan({ reason: 'refresh' })`.
- `startSystem` creates the Blueprint with `kind: 'plan'`, `tierAtStart: resolveTier(user)`, `freeSlot: false`, `charge: { state: 'none', quarks: 0 }`, no deduct, no per-account daily cap, and enqueues `run`. It must still respect `MAX_CONCURRENT_RUNS` (the runner queue does).

- [ ] **Step 1: Write the failing tests**

```js
// backend/tests/planRules.test.js
const test = require('node:test');
const assert = require('node:assert');
const r = require('../services/plan/planRules');
const DAY = 86400000;
const NOW = new Date('2026-10-17T06:00:00Z');
const ok = (extra = {}) => ({ isActive: true, onboardingCompleted: true, plan: { tier: 'starter' }, staffRole: null, isCsm: false, businessProfile: { name: 'Sweet Co', website: 'sweetco.in', description: 'Custom cakes baked to order', targetAudience: 'Families' }, ...extra });

test('who should have a plan: paying and managed accounts with a complete profile, never staff, free or deleting accounts', () => {
  assert.strictEqual(r.shouldHavePlan(ok()), true);
  assert.strictEqual(r.shouldHavePlan(ok({ plan: { tier: 'managed' } })), true);
  assert.strictEqual(r.shouldHavePlan(ok({ plan: {} })), true, 'legacy accounts without a tier are managed');
  assert.strictEqual(r.shouldHavePlan(ok({ plan: { tier: 'free' } })), false);
  assert.strictEqual(r.shouldHavePlan(ok({ staffRole: 'csm' })), false);
  assert.strictEqual(r.shouldHavePlan(ok({ isCsm: true })), false);
  assert.strictEqual(r.shouldHavePlan(ok({ deletion: { status: 'pending' } })), false);
  assert.strictEqual(r.shouldHavePlan(ok({ onboardingCompleted: false })), false);
  assert.strictEqual(r.shouldHavePlan(ok({ isActive: false })), false);
  assert.strictEqual(r.shouldHavePlan(ok({ businessProfile: { name: 'x' } })), false);
});

test('the weekly refresh rule, and staff are never limited', () => {
  assert.strictEqual(r.canRefresh({ user: ok(), now: NOW }).ok, true);
  const recent = ok({ planState: { lastRefreshAt: new Date(NOW - 2 * DAY) } });
  const c = r.canRefresh({ user: recent, now: NOW });
  assert.strictEqual(c.ok, false);
  assert.strictEqual(+c.nextAt, +new Date(NOW - 2 * DAY + 7 * DAY));
  assert.match(c.message, /once a week/);
  assert.strictEqual(r.canRefresh({ user: recent, now: NOW, staff: true }).ok, true);
  assert.strictEqual(r.canRefresh({ user: ok({ planState: { lastRefreshAt: new Date(NOW - 8 * DAY) } }), now: NOW }).ok, true);
});

test('monthly due and stale', () => {
  assert.strictEqual(r.monthlyDue({ user: ok(), lastPlanAt: null, now: NOW }), true);
  assert.strictEqual(r.monthlyDue({ user: ok(), lastPlanAt: new Date(NOW - 29 * DAY), now: NOW }), false);
  assert.strictEqual(r.monthlyDue({ user: ok(), lastPlanAt: new Date(NOW - 31 * DAY), now: NOW }), true);
  assert.strictEqual(r.isStale({ completedAt: new Date(NOW - 46 * DAY) }, NOW), true);
  assert.strictEqual(r.isStale({ completedAt: new Date(NOW - 10 * DAY) }, NOW), false);
  assert.strictEqual(r.isStale(null, NOW), false);
});
```

```js
// backend/tests/planService.test.js
const test = require('node:test');
const assert = require('node:assert');
const { createPlanService } = require('../services/plan/planService');

const goodUser = () => ({ _id: 'u1', isActive: true, onboardingCompleted: true, plan: { tier: 'starter' }, businessProfile: { name: 'Sweet Co', website: 'sweetco.in', description: 'Custom cakes baked to order', targetAudience: 'Families', marketingGoals: ['enquiries'] } });
function setup({ user = goodUser(), docs = [] } = {}) {
  const calls = [];
  const deps = {
    loadUser: async () => user,
    findRuns: async (q) => docs.filter((d) => d.userId === 'u1' && (!q.status || q.status.includes(d.status))),
    startSystem: async ({ user: u, input, kind }) => { calls.push({ id: u._id, kind, goal: input.goal }); return { id: 'bp1' }; },
    saveState: async (id, patch) => { user.planState = { ...(user.planState || {}), ...patch }; },
    now: () => new Date('2026-10-17T06:00:00Z')
  };
  return { svc: createPlanService(deps), calls, user, deps };
}

test('a qualifying account starts one plan run, never charged, and records when', async () => {
  const { svc, calls, user } = setup();
  const r = await svc.startPlan({ userId: 'u1', reason: 'first' });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(calls, [{ id: 'u1', kind: 'plan', goal: 'enquiries' }]);
  assert.ok(user.planState.lastStartedAt);
});

test('a run already queued or processing is not started twice', async () => {
  const { svc, calls } = setup({ docs: [{ userId: 'u1', status: 'processing', kind: 'plan' }] });
  const r = await svc.startPlan({ userId: 'u1', reason: 'monthly' });
  assert.strictEqual(r.alreadyRunning, true);
  assert.strictEqual(calls.length, 0);
});

test('a free account, a staff account or an incomplete profile starts nothing', async () => {
  for (const patch of [{ plan: { tier: 'free' } }, { staffRole: 'owner' }, { businessProfile: { name: 'x' } }]) {
    const { svc, calls } = setup({ user: { ...goodUser(), ...patch } });
    const r = await svc.startPlan({ userId: 'u1', reason: 'first' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(calls.length, 0);
  }
});

test('refresh: once a week for customers, any time for staff, and it stamps lastRefreshAt', async () => {
  const { svc, calls, user } = setup();
  assert.strictEqual((await svc.refresh({ userId: 'u1' })).ok, true);
  assert.ok(user.planState.lastRefreshAt);
  const again = await svc.refresh({ userId: 'u1' });
  assert.strictEqual(again.ok, false);
  assert.match(again.message, /once a week/);
  assert.strictEqual(calls.length, 1);
  const staff = await svc.refresh({ userId: 'u1', staff: true });
  assert.strictEqual(staff.ok, true);
});

test('the current plan is the newest completed plan run, and a failed run never hides it', async () => {
  const docs = [
    { userId: 'u1', kind: 'plan', status: 'completed', completedAt: new Date('2026-09-01'), blueprintId: 'old', result: { v: 1 } },
    { userId: 'u1', kind: 'plan', status: 'completed', completedAt: new Date('2026-10-01'), blueprintId: 'new', result: { v: 2 } },
    { userId: 'u1', kind: 'plan', status: 'failed', completedAt: new Date('2026-10-10'), blueprintId: 'bad' }
  ];
  const { svc } = setup({ docs });
  const cur = await svc.currentPlan('u1');
  assert.strictEqual(cur.id, 'new');
  assert.deepStrictEqual(cur.result, { v: 2 });
});
```

- [ ] **Step 2: Run to verify they fail** — modules not found.

- [ ] **Step 3: Implement**

`planRules.js` (pure) — `shouldHavePlan` uses `isStaff`-equivalent checks on `staffRole`/`isCsm`, `deletion.status !== 'pending'`, `isActive !== false`, `onboardingCompleted === true`, `resolveTier(user) !== 'free'`, and `profileComplete(user).complete`. `canRefresh`: if `staff` ok; if no `planState.lastRefreshAt` ok; else `nextAt = last + PLAN_REFRESH_DAYS days`; `ok` when `now >= nextAt`; message `'You can refresh your plan once a week. The next refresh is available on <date>.'` (date via `toLocaleDateString('en-IN', { day:'numeric', month:'long' })`). `monthlyDue`, `isStale` per the interface.
`planService.js`: `createPlanService(deps = defaultDeps())`; `defaultDeps` wires `loadUser` (`User.findById(...).lean()`), `findRuns` (`Blueprint.find({ userId, kind:'plan', status: {$in}})`), `startSystem` (the Blueprint service's `startSystem`), `saveState` (`User.updateOne({_id},{$set: {'planState.<k>': v}})`). `startPlan`: load user; if `!shouldHavePlan(user)` return `{ ok:false, reason:'not_eligible' }`; if any queued/processing plan run return `{ ok:true, alreadyRunning:true }`; `startSystem`; `saveState(lastStartedAt)`; return `{ ok:true, id }`. `refresh`: `canRefresh` then `startPlan`, stamping `lastRefreshAt` only when it started (not when `alreadyRunning`). `currentPlan`: query completed plan runs sorted by `completedAt` desc, return `{ id: blueprintId, completedAt, result }`.
`services/blueprint/service.js`: add `startSystem({ user, input, kind = 'plan' })`: `normaliseInput(input, { allowGuided: true })` (return `{ ok:false }` with errors if invalid), `Blueprint.create({ blueprintId: deps.uuid(), userId, emailKey, tierAtStart: resolveTier(user), mode: 'auto', status: 'queued', ..., input, businessKeys, freeSlot: false, ipHash: '', approvals: [], qaFlags: [], kind, charge: { state: 'none', quarks: 0 } })`, then `deps.enqueue(() => run(blueprintId))`, return `{ id }`. `run` must treat `charge.state === 'none'` as nothing to refund on failure (it already does for free runs; verify by reading `failAndRefund`). The model spend for the run must still be recorded by the existing path (`spendGuard.record('blueprint', 1)` or whatever `run` already calls): check and keep.

- [ ] **Step 4: Run to verify they pass** — `cd backend && node --test tests/planRules.test.js tests/planService.test.js && node --test tests/*.test.js 2>&1 | grep -E "^ℹ (pass|fail)|^✖"`.

- [ ] **Step 5: Commit** — `git add backend && git commit -m "Plan: plan runs from the business profile, never charged, one at a time, weekly refresh rule"`

---

