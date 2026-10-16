### Task 1: Agency plan in config and entitlements

**Files:**
- Modify: `backend/config/apiCosts.js` (inside `PLANS`, and export `AGENCY`)
- Modify: `backend/config/plans.js` (`PLAN_PRESENTATION`)
- Modify: `backend/config/entitlements.js` (`TIERS`, `addonsOf`)
- Modify: `backend/services/billingPlans.js` (`canBuyAddon`, `planCatalogue`)
- Test: `backend/tests/agencyConfig.test.js`

**Interfaces:**
- Produces: `AGENCY = { includedClients: 5, maxClients: 25, slot: { inr: 1499, quarks: 500 } }` exported from `config/apiCosts.js`; `PLANS.agency = { inr: 6999, quarks: 6000, ... }`; tier `'agency'` accepted by `resolveTier`; `addonsOf(agencyUser)` returns `['bundle']`; `planCatalogue().agency = { includedClients, maxClients, slotInr, slotQuarks }`.

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/agencyConfig.test.js
const test = require('node:test');
const assert = require('node:assert');
const { PLANS, AGENCY, QUARK_COSTS } = require('../config/apiCosts');
const { resolveTier, addonsOf, canUse } = require('../config/entitlements');
const bp = require('../services/billingPlans');

test('the agency plan is Rs 6,999 for 6,000 shared Quarks and the numbers come from config', () => {
  assert.strictEqual(PLANS.agency.inr, 6999);
  assert.strictEqual(PLANS.agency.quarks, 6000);
  assert.deepStrictEqual(AGENCY, { includedClients: 5, maxClients: 25, slot: { inr: 1499, quarks: 500 } });
});

test('the allowance guard passes: the pool covers the expected burn', () => {
  assert.ok(PLANS.agency.quarks >= PLANS.agency.expectedQuarks);
  assert.ok(QUARK_COSTS.image_generated > 0);
});

test('an agency account may use everything an add-on would unlock, with nothing to buy', () => {
  const u = { plan: { tier: 'agency', addons: [] }, onboardingCompleted: true };
  assert.strictEqual(resolveTier(u), 'agency');
  assert.deepStrictEqual(addonsOf(u), ['bundle']);
  for (const f of ['create', 'video', 'publish', 'schedule', 'social_connect', 'inbox', 'auto_reply', 'competitors']) assert.strictEqual(canUse(u, f).allowed, true, f);
  assert.strictEqual(bp.canBuyAddon(u, 'publish').ok, false);
  assert.match(bp.canBuyAddon(u, 'publish').message, /included/);
});

test('the catalogue lists the agency plan and its client rules', () => {
  const c = bp.planCatalogue();
  assert.ok(c.plans.some((p) => p.id === 'agency' && p.name === 'Agency'));
  assert.deepStrictEqual(c.agency, { includedClients: 5, maxClients: 25, slotInr: 1499, slotQuarks: 500 });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && node --test tests/agencyConfig.test.js`
Expected: FAIL (`PLANS.agency` undefined).

- [ ] **Step 3: Implement**

In `config/apiCosts.js`, add to `PLANS` after `professional`:

```js
  agency: {
    inr: 6999,
    label: 'Agency',
    // Commitments sized so the allowance guard below holds: about 300 posts and 10 videos a month across the clients.
    commits: { image_generated: 300, studio_video: 10 },
    grant: 6000
  }
```

Above `module.exports` add and export:

```js
// The agency plan: clients are separate workspaces paid from one shared pool. Prices here only.
const AGENCY = { includedClients: 5, maxClients: 25, slot: { inr: 1499, quarks: 500 } };
```
(add `AGENCY` to the `module.exports` object).

In `config/plans.js` add to `PLAN_PRESENTATION`:

```js
  agency: {
    name: 'Agency',
    description: 'Run several client brands from one account, with one shared pool of posts and videos.',
    extraFeatures: ['5 client brands included', 'Publishing, inbox and competitor insights included', 'Usage report for each client'],
    envVar: 'RAZORPAY_PLAN_ID_AGENCY'
  }
```

In `config/entitlements.js`: `const TIERS = ['free', 'starter', 'professional', 'agency', 'managed'];` and replace `addonsOf`:

```js
function addonsOf(user) {
  if (user && user.plan && user.plan.tier === 'agency') return ['bundle'];
  const a = user && user.plan && user.plan.addons;
  return Array.isArray(a) ? a : [];
}
```

In `services/billingPlans.js` `canBuyAddon`, before the existing tier check:

```js
  if (resolveTier(user) === 'agency') return { ok: false, message: 'Publishing, inbox and competitor insights are included in the Agency plan.' };
```
and in `planCatalogue()` return object add:

```js
    agency: { includedClients: AGENCY.includedClients, maxClients: AGENCY.maxClients, slotInr: AGENCY.slot.inr, slotQuarks: AGENCY.slot.quarks },
```
(import `AGENCY` in the destructured `require('../config/apiCosts')` at the top).

- [ ] **Step 4: Run to verify it passes, then the whole backend suite**

Run: `cd backend && node --test tests/agencyConfig.test.js && node --test tests/*.test.js 2>&1 | grep -E "^ℹ (pass|fail)|^✖"`
Expected: new tests pass. If an existing test counts plans or add-ons exactly (billing and entitlement tests), update it to include `agency`; do not weaken it otherwise.

- [ ] **Step 5: Commit**

```bash
git add backend/config backend/services/billingPlans.js backend/tests
git commit -m "Agency plan config: price, shared Quarks, client rules, all add-ons included"
```

---

