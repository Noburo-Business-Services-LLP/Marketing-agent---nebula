### Task 6: Billing: buying the agency plan and extra client slots

**Files:**
- Modify: `backend/services/billingPlans.js` (`buildChargeUpdate`, ended-subscription helper, `invoiceSpec`, `razorpayPlanBody`, `isPlanId`-style helpers for kind `slot`), `backend/config/plans.js` (`ADDON_ENV_VARS`-style `SLOT_ENV_VAR`), `backend/routes/payment.js` (new route `create-slot-subscription`, webhook/verify handlers where `record.kind` is switched)
- Test: `backend/tests/agencyBilling.test.js`

**Interfaces:**
- Consumes: `AGENCY`, `PLANS.agency`.
- Produces: subscription record kind `'slot'` (key `'client'`); `bp.slotQuote()`, `bp.canBuySlot(user)`, `buildChargeUpdate({kind:'slot',...})` that `$inc`s `agency.extraSlots` by 1 on the first payment of that subscription and grants `AGENCY.slot.quarks` to the top-up bucket on every paid cycle; `bp.endUpdateFor(record)` for slot decrements `agency.extraSlots` by 1; `route POST /api/payment/create-slot-subscription` (no body) → `{ success, subscription_id, key, ... }` like the add-on route.

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/agencyBilling.test.js
const test = require('node:test');
const assert = require('node:assert');
const bp = require('../services/billingPlans');
const { PLANS, AGENCY, chargePaise } = require('../config/apiCosts');

test('the agency plan is billed like the other plans and sets the pool, the tier and the client limit', () => {
  const rec = { kind: 'plan', key: 'agency', subscriptionId: 'sub_a', razorpayPlanId: 'plan_a' };
  const u = bp.buildChargeUpdate(rec, { paymentId: 'pay_1', paidPaise: bp.planQuote('agency').chargePaise });
  assert.strictEqual(u.update.$set['plan.tier'], 'agency');
  assert.strictEqual(u.quarks, PLANS.agency.quarks);
  assert.strictEqual(u.update.$push.payments.exGstAmount, PLANS.agency.inr);
  assert.match(bp.invoiceSpec('plan', 'agency').description, /Agency plan/);
});

test('a client slot costs Rs 1,499 plus GST and is its own monthly subscription', () => {
  const q = bp.slotQuote();
  assert.strictEqual(q.inr, AGENCY.slot.inr);
  assert.strictEqual(q.chargePaise, chargePaise(AGENCY.slot.inr));
  assert.strictEqual(bp.invoiceSpec('slot', 'client').amountInr, AGENCY.slot.inr);
  const body = bp.razorpayPlanBody('slot', 'client');
  assert.strictEqual(body.item.amount, q.chargePaise);
  assert.strictEqual(body.notes.kind, 'slot');
});

test('a paid slot adds one client and grants its Quarks; a repeat payment of the same cycle grants nothing more', () => {
  const rec = { kind: 'slot', key: 'client', subscriptionId: 'sub_s' };
  const first = bp.buildChargeUpdate(rec, { paymentId: 'pay_s1', paidPaise: bp.slotQuote().chargePaise, firstCycle: true });
  assert.strictEqual(first.update.$inc['agency.extraSlots'], 1);
  assert.strictEqual(first.quarks, AGENCY.slot.quarks);
  const renewal = bp.buildChargeUpdate(rec, { paymentId: 'pay_s2', paidPaise: bp.slotQuote().chargePaise, firstCycle: false });
  assert.strictEqual(renewal.update.$inc['agency.extraSlots'], undefined);
  assert.strictEqual(renewal.quarks, AGENCY.slot.quarks);
});

test('only an agency account may buy a slot', () => {
  assert.strictEqual(bp.canBuySlot({ plan: { tier: 'professional' } }).ok, false);
  assert.strictEqual(bp.canBuySlot({ plan: { tier: 'agency' }, agency: { extraSlots: 20 } }).ok, true);
  assert.strictEqual(bp.canBuySlot({ plan: { tier: 'agency' }, agency: { extraSlots: 20 + 1 } }).ok, false, 'already at 25 clients');
});

test('ending a slot subscription removes one slot and nothing else', () => {
  const u = bp.endUpdateFor({ kind: 'slot', key: 'client', subscriptionId: 'sub_s' });
  assert.deepStrictEqual(u.$inc, { 'agency.extraSlots': -1 });
});
```

- [ ] **Step 2: Run to verify it fails** — `cd backend && node --test tests/agencyBilling.test.js` → FAIL.

- [ ] **Step 3: Implement**

In `services/billingPlans.js`:
- `slotQuote()` returns `{ id: 'client', ...priceBlock(AGENCY.slot.inr), quarks: AGENCY.slot.quarks }`.
- `canBuySlot(user)`: `{ ok:false, message:'Client slots are part of the Agency plan.' }` unless `resolveTier(user)==='agency'`; `{ ok:false, message:'You are at the most clients one agency account can have (25). Contact us for a larger set-up.' }` when `AGENCY.includedClients + extraSlots >= AGENCY.maxClients`.
- `invoiceSpec('slot','client')` → `inr = AGENCY.slot.inr; description = 'Extra client brand, one month'` using `INVOICE_ITEMS.addon` as the item name.
- `razorpayPlanBody('slot','client')` mirrors the add-on body: name `INVOICE_ITEMS.addon`, description `Extra client brand, monthly, including 18% GST`, notes `{ product:'nebulaa', kind:'slot', key:'client' }`.
- `envVarFor('slot', 'client')` → `'RAZORPAY_PLAN_ID_SLOT'` (add `SLOT_ENV_VAR` to `config/plans.js` and use it).
- `buildChargeUpdate`: new branch for `record.kind === 'slot'`:

```js
  } else if (record.kind === 'slot') {
    quarks = AGENCY.slot.quarks;
    const grant = buckets.topupGrantUpdate(quarks, { now });
    Object.assign($set, grant.set); inc = { ...grant.inc };
    if (firstCycle) inc['agency.extraSlots'] = 1;
```
  with `firstCycle = true` added to the destructured options (default `true` so existing callers are unaffected; the webhook caller passes `false` for renewals, see below). The existing `if (record.kind !== 'topup') $set['plan.subscriptions.$[sub].active'] = true;` continues to apply to slots.
- Agency plan: `isPlanId('agency')` is true automatically through `PLAN_PRESENTATION`. In the `record.kind === 'plan'` branch add `if (record.key === 'agency') { /* clientLimit is derived: includedClients + extraSlots */ }` (no stored limit; the limit is computed by `clientLimitOf`). Nothing else is needed there.
- `endUpdateFor(record)`: find the existing helper for "a subscription that ended" (the function after `buildChargeUpdate`, documented as "Update for a subscription that ended") and add a `slot` branch returning `{ $inc: { 'agency.extraSlots': -1 }, $set: { 'plan.subscriptions.$[sub].active': false } }`; export it as `endUpdateFor` if it has another name today (keep the old export as well). When the agency plan itself ends the existing code sets the tier back to `free`; extend that branch to also set `agency.extraSlots` to 0 only if every slot subscription ended with it (leave `extraSlots` untouched otherwise, they end through their own events).

In `routes/payment.js`: copy `create-addon-subscription` as `create-slot-subscription` (no body; `bp.canBuySlot`, `bp.slotQuote`, `getOrCreateRazorpayPlan('slot','client')`, record kind `'slot'`, key `'client'`, notes `{ userId, email, slot: 'client' }`). Where the webhook and verify handlers switch on `record.kind`, add `slot`: call `buildChargeUpdate` with `firstCycle` true when the stored subscription record is still inactive, false when it was already active (renewal), and after any successful agency plan or slot update call `require('../services/agencyWorkspaces').syncWorkspacePlans({ owner, models })` (best effort, errors logged). Block all of this for non-agency accounts through `canBuySlot`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && node --test tests/agencyBilling.test.js && node --test tests/*.test.js 2>&1 | grep -E "^ℹ (pass|fail)|^✖"` → pass. Existing payment tests that enumerate plan ids are updated for `agency` only.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "Agency billing: the Agency plan and extra client slots as monthly subscriptions"
```

---

