### Task 2: The setup path (pure)

**Files:**
- Create: `backend/services/week/setupSteps.js`
- Test: `backend/tests/setupSteps.test.js`

**Interfaces:**
- `setupSteps({ user, state }): { steps: Array<{ id, title, done, reason, minutes }>, next: string|null, allDone: boolean }` with ids `profile`, `socials`, `plan`, `week`. `state = { connectedCount, hasPlan, planOpened, firstWeekApproved, isPaid }`. Rules: `profile.done = profileComplete(user).complete` (Stage 1 helper); `socials.done = connectedCount > 0`; `plan.done = planOpened` (the plan exists AND was opened once); `week.done = firstWeekApproved`. `next` is the first step not done, except: `plan` is not offered (and not shown as `next`) until `hasPlan` (instead the profile step explains why); for a free account (`!isPaid`) the `plan` and `week` steps are replaced by one step `choose` ("Choose a plan") so the card never promises what a free account cannot do. Titles in plain words: 'Complete your business profile', 'Connect your social accounts', 'Read your plan', 'Approve your first week', 'Choose a plan'. `reason` is one short sentence ('Your plan is built from it.', 'So posts can go out for you. You can make posts without it.', ...). `minutes` is a small estimate (profile 5, socials 2, plan 3, week 1).

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/setupSteps.test.js
const test = require('node:test');
const assert = require('node:assert');
const { setupSteps } = require('../services/week/setupSteps');
const full = { companyName: 'Sweet Co', businessProfile: { name: 'Sweet Co', website: 'sweetco.in', description: 'Custom cakes baked to order', targetAudience: 'Families' } };
const empty = { businessProfile: {} };
const st = (o = {}) => ({ connectedCount: 0, hasPlan: false, planOpened: false, firstWeekApproved: false, isPaid: true, ...o });

test('a brand new paying account is told to complete the profile first', () => {
  const r = setupSteps({ user: empty, state: st() });
  assert.deepStrictEqual(r.steps.map((s) => s.id), ['profile', 'socials', 'plan', 'week']);
  assert.strictEqual(r.next, 'profile');
  assert.strictEqual(r.allDone, false);
});
test('the order is suggested: socials can be done before the profile, and next is always the first undone step', () => {
  const r = setupSteps({ user: empty, state: st({ connectedCount: 1 }) });
  assert.strictEqual(r.steps.find((s) => s.id === 'socials').done, true);
  assert.strictEqual(r.next, 'profile');
});
test('the plan step waits until a plan exists, then asks to read it', () => {
  const waiting = setupSteps({ user: full, state: st({ connectedCount: 1 }) });
  assert.strictEqual(waiting.next, null, 'profile and socials done, plan not built yet: nothing to ask of the customer');
  const ready = setupSteps({ user: full, state: st({ connectedCount: 1, hasPlan: true }) });
  assert.strictEqual(ready.next, 'plan');
});
test('everything done', () => {
  const r = setupSteps({ user: full, state: st({ connectedCount: 2, hasPlan: true, planOpened: true, firstWeekApproved: true }) });
  assert.strictEqual(r.allDone, true);
  assert.strictEqual(r.next, null);
});
test('a free account sees a Choose a plan step instead of promises it cannot keep', () => {
  const r = setupSteps({ user: full, state: st({ isPaid: false, connectedCount: 0 }) });
  assert.deepStrictEqual(r.steps.map((s) => s.id), ['profile', 'socials', 'choose']);
  assert.strictEqual(r.steps.find((s) => s.id === 'choose').done, false);
});
test('no step title mentions credits, trials or Quarks', () => {
  const r = setupSteps({ user: empty, state: st() });
  r.steps.forEach((s) => assert.doesNotMatch(`${s.title} ${s.reason}`, /credit|trial|quark/i));
});
```

- [ ] **Step 2: Run to verify it fails.** **Step 3: Implement** per the rules, importing `profileComplete` from `../plan/profileInput`. **Step 4: Run to verify it passes.** **Step 5: Commit** — `git add backend && git commit -m "Setup: ordered, suggested steps with one next step"`

---

