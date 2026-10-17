### Task 4: Triggers and the monthly scheduler

**Files:**
- Create: `backend/services/plan/planScheduler.js`
- Modify: `backend/routes/auth.js` and the route that saves the business profile / completes onboarding (locate with `grep -n "onboardingCompleted: true" routes/auth.js` and the profile `PUT`; call `require('../services/plan/planService').maybeStartFirstPlan(userId)` after a successful save, fire-and-forget, errors logged), `backend/server-main.js` (start the scheduler beside the other schedulers; skip in tests), `backend/services/opsAlerts.js` use only (existing `recordFailure`)
- Test: `backend/tests/planScheduler.test.js`

**Interfaces:**
- Produces: `maybeStartFirstPlan(userId): Promise<void>` (in `planService.js`: starts a plan only when the account `shouldHavePlan` and has no completed or running plan); `runMonthlyOnce({ deps, now, limit = 20 }): Promise<{ started, skipped }>` (selects users that `shouldHavePlan` and `monthlyDue`, at most `limit` per tick, skipping accounts with a run in flight); `startPlanScheduler({ intervalMs = 6 * 3600 * 1000 })` (env `ENABLE_PLAN_SCHEDULER`, default on, off in tests); failure handling: a plan run that ends `failed` for an account with NO completed plan increments `planState.attempts`, retries on the next tick up to 2 times with at least 30 minutes between tries, then calls `opsAlerts.recordFailure('plan', 'first plan failed for <userId>')` once and sets `planState.firstPlanFailedAt`.

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/planScheduler.test.js
const test = require('node:test');
const assert = require('node:assert');
const { runMonthlyOnce, retryFailedFirstPlans } = require('../services/plan/planScheduler');
const DAY = 86400000;
const NOW = new Date('2026-10-17T06:00:00Z');
const user = (id, extra = {}) => ({ _id: id, isActive: true, onboardingCompleted: true, plan: { tier: 'starter' }, businessProfile: { name: 'Sweet Co', website: 'a.in', description: 'Custom cakes baked to order', targetAudience: 'Families' }, ...extra });

test('the monthly run starts plans for due accounts only, at most the limit, one at a time per account', async () => {
  const started = [];
  const deps = {
    candidates: async () => [user('a'), user('b'), user('c', { plan: { tier: 'free' } }), user('d'), user('e')],
    lastPlanAt: async (id) => ({ a: null, b: new Date(NOW - 5 * DAY), d: new Date(NOW - 40 * DAY), e: null })[id] ?? null,
    inFlight: async (id) => id === 'e',
    startPlan: async ({ userId }) => { started.push(userId); return { ok: true }; }
  };
  const out = await runMonthlyOnce({ deps, now: NOW, limit: 1 });
  assert.deepStrictEqual(started, ['a'], 'b is fresh, c is free, d waits for the limit, e is running');
  assert.strictEqual(out.started, 1);
  const out2 = await runMonthlyOnce({ deps, now: NOW, limit: 10 });
  assert.deepStrictEqual(started.slice(1), ['a', 'd']);
  assert.ok(out2.skipped >= 3);
});

test('a failed first plan is retried twice with a pause, then the owner is told once', async () => {
  const alerts = []; const started = [];
  const states = { x: { attempts: 0, lastStartedAt: new Date(NOW - 60 * 60000) } };
  const deps = {
    failedFirst: async () => [{ user: user('x'), state: states.x }],
    startPlan: async ({ userId }) => { started.push(userId); states.x.attempts += 1; states.x.lastStartedAt = NOW; return { ok: true }; },
    saveState: async (id, patch) => Object.assign(states[id], patch),
    alert: (m) => alerts.push(m)
  };
  await retryFailedFirstPlans({ deps, now: NOW });                       // attempt 1
  await retryFailedFirstPlans({ deps, now: new Date(+NOW + 10 * 60000) }); // too soon: nothing
  await retryFailedFirstPlans({ deps, now: new Date(+NOW + 40 * 60000) }); // attempt 2
  await retryFailedFirstPlans({ deps, now: new Date(+NOW + 90 * 60000) }); // out of attempts: alert once
  await retryFailedFirstPlans({ deps, now: new Date(+NOW + 200 * 60000) }); // already alerted: silent
  assert.strictEqual(started.length, 2);
  assert.strictEqual(alerts.length, 1);
  assert.ok(states.x.firstPlanFailedAt);
});
```

- [ ] **Step 2: Run to verify it fails** — module not found.

- [ ] **Step 3: Implement** `planScheduler.js` with the two functions above (deps injected, defaults wired to Mongo: `candidates` = users with `onboardingCompleted:true, isActive:{$ne:false}, staffRole:null, isCsm:{$ne:true}` limited to 200 per tick sorted by `planState.lastStartedAt` ascending; `lastPlanAt` = newest completed plan run's `completedAt`; `inFlight` = a queued/processing plan run; `failedFirst` = users with a failed plan run, no completed plan run, `planState.firstPlanFailedAt` unset). `startPlanScheduler` uses `setInterval(...).unref()`, logs one line at start, and runs `retryFailedFirstPlans` then `runMonthlyOnce` each tick. Wire the hooks in the routes and `server-main.js`. Errors never crash the process.

- [ ] **Step 4: Run to verify it passes** — `cd backend && node --test tests/planScheduler.test.js` then the full backend suite.

- [ ] **Step 5: Commit** — `git add backend && git commit -m "Plan: first plan when the profile is complete, monthly refresh, retries and an owner alert"`

---

