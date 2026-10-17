### Task 6: Backfill for existing managed clients

**Files:**
- Create: `backend/scripts/plan-backfill.js`, `backend/services/plan/backfill.js` (pure selection and throttle plan)
- Test: `backend/tests/planBackfill.test.js`

**Interfaces:**
- `selectForBackfill({ users, hasPlanIds, limit }): { chosen: User[], skipped: Array<{ id, why }> }` (pure): chooses accounts that `shouldHavePlan`, are not in `hasPlanIds` (already have a completed or running plan), up to `limit`, oldest accounts first; skip reasons are plain codes (`not_eligible`, `has_plan`, `over_limit`).
- The script: `node scripts/plan-backfill.js [--limit 20] [--per-minute 3] [--yes]`. Without `--yes` it is a dry run: prints who would get a plan and an estimated cost (count times a configured `PLAN_RUN_INR_ESTIMATE = 5`) and exits without writing. With `--yes` it starts runs through `planService.startPlan({ reason: 'backfill' })` at the throttled rate, prints each result, and stops at `--limit` (default 20, hard maximum 200). It prints the database name first and, when the database is not `nebulaa_dev`, requires `--yes` AND `CONFIRM_PROD=yes` in the environment.

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/planBackfill.test.js
const test = require('node:test');
const assert = require('node:assert');
const { selectForBackfill, throttleDelayMs } = require('../services/plan/backfill');
const u = (id, extra = {}) => ({ _id: id, createdAt: new Date(`2026-0${id}-01`), isActive: true, onboardingCompleted: true, plan: { tier: 'managed' }, businessProfile: { name: 'Biz', website: 'b.in', description: 'We sell good things here', targetAudience: 'Everyone nearby' }, ...extra });

test('picks eligible accounts without a plan, oldest first, up to the limit, and explains every skip', () => {
  const users = [u('3'), u('1'), u('2', { staffRole: 'csm' }), u('4'), u('5', { plan: { tier: 'free' } })];
  const out = selectForBackfill({ users, hasPlanIds: new Set(['4']), limit: 1 });
  assert.deepStrictEqual(out.chosen.map((x) => x._id), ['1']);
  const why = Object.fromEntries(out.skipped.map((s) => [s.id, s.why]));
  assert.strictEqual(why['2'], 'not_eligible');
  assert.strictEqual(why['4'], 'has_plan');
  assert.strictEqual(why['5'], 'not_eligible');
  assert.strictEqual(why['3'], 'over_limit');
});

test('the throttle spaces runs evenly and never divides by zero', () => {
  assert.strictEqual(throttleDelayMs(3), 20000);
  assert.strictEqual(throttleDelayMs(60), 1000);
  assert.strictEqual(throttleDelayMs(0), 60000);
});

test('a hard maximum caps the limit whatever is asked', () => {
  const users = Array.from({ length: 300 }, (_, i) => u(String(i + 1)));
  const out = selectForBackfill({ users, hasPlanIds: new Set(), limit: 5000 });
  assert.strictEqual(out.chosen.length, 200);
});
```

- [ ] **Step 2: Run to verify it fails.** **Step 3: Implement** the two pure functions (`HARD_MAX = 200`, `throttleDelayMs(perMinute) = perMinute > 0 ? Math.round(60000 / perMinute) : 60000`) and the script around them (connect with `MONGODB_URI`, print DB name, dry run by default, dev-vs-prod guard as above, sleep between starts, never run two starts at once). **Step 4:** run the test, then run the script in DRY RUN mode against `nebulaa_dev` and paste the output into the commit message body (no writes). **Step 5: Commit** — `git add backend && git commit -m "Plan: throttled backfill for existing managed clients, dry run by default"`

---

