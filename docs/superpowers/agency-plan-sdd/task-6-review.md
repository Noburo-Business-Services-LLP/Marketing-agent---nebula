# Task 6 review: Agency billing (commit 47c4659)

Reviewer: read-only. Evidence: `node --test tests/agencyBilling.test.js tests/billing.test.js` gives 82/82 pass. Code read: `routes/payment.js` (whole file), `services/billingPlans.js`, `services/agency.js`, `services/agencyWorkspaces.js`, `services/quarkBuckets.js` (spend, refund, settle, grant helpers), `services/opsAlerts.js`, `middleware/auth.js` (pass check), `models/User.js` (agency and subscriptions schema), `services/renewalReminders.js`, `services/staff/money.js`, `services/welcomeEmail.js`, both ops scripts (diff only, not run), and the full new test file.

**Overall: approve, with fixes.** No Critical findings. Fix I1 to I3 before release. I4 is a gap across tasks that this task makes reachable (route it to Task 9, or fix it now in `quarkBuckets.spend`). I5 needs a decision from the owner.

Counts: Critical 0, Important 5, Minor 11.

---

## 1. Spec compliance: PASS

- Prices and Quarks come only from config: `AGENCY.slot.inr`, `AGENCY.slot.quarks`, `PLANS.agency`, `AGENCY.maxClients` (in the message too). The diff has no 6999, 1499, 6000, 500 or 25 literals outside the tests. Amounts are integer paise through `chargePaise`/`gstPaise`, and GST is 18% on top, read from `GST_RATE`.
- Plan ids: `RAZORPAY_PLAN_ID_AGENCY` comes through `PLAN_PRESENTATION.agency.envVar`, and `RAZORPAY_PLAN_ID_SLOT` through `SLOT_ENV_VAR` (`config/plans.js`). A test confirms the env values are used and nothing is created at Razorpay.
- Ops scripts: the two names were appended to `ALLOWED` and `OPTIONAL` and nothing else changed (git diff checked).
- Managed accounts cannot buy by mistake. `create-subscription` refuses `managed` (pre-existing) and `canBuySlot` needs `isAgency`. Both are tested.
- Client workspaces cannot start billing. There is a 403 on `create-subscription`, `create-addon-subscription`, `create-slot-subscription` and `create-order` (`payment.js:306,352,384,519`). The atomic slot gate also has `'agency.ownerId': null`, and `isBlockedInsideClient` blocks `/api/payment` in any case form or encoding.
- The implementer's deviations are justified: the cap formula (see 3), `isAgency` in place of `resolveTier` (a workspace mirrors tier `agency`), the item names, and the atomic first-cycle decision. Separate subscriptions per slot, where the spec says "add-on with a quantity", follow the brief, which governs.

## 2. Webhook and verify security: PASS, one Important

- Signature: the webhook fails closed. No secret gives 503 and a bad or missing signature gives 400 (`verifyWebhookSignature` needs a Buffer and a timing-safe compare). Verify checks the HMAC of `payment|subscription` with the key secret, and a missing secret gives `false`, so 400. Both are tested.
- The stored record decides the kind. `recordMatches` (`payment.js:103-109`) needs a known kind and key (`isSlotKey`), `entity.plan_id === record.razorpayPlanId`, and `notes.userId === owner._id`. The owner is found by the stored `subscriptionId`, so a grant cannot land on a different user. An unknown id returns 200 and grants nothing. Quarks and slots come from config, and payload `notes` are ignored (tested with a forged `quarks: 99999, slots: 99`).
- Idempotency is atomic: one `findOneAndUpdate` with `'payments.razorpayPaymentId': {$ne: paymentId}` in the same filter as the slot gate. A replay, or a verify plus a webhook for the same payment, matches nothing. The re-read branch treats a payment already present as `already_processed`. I traced both orders (verify reads before or after the webhook applies), and neither grants twice or refuses falsely.
- **I2 (Important): the strict amount check runs only on the webhook, so in practice it rarely acts.** `payment.js:532` refuses an agency or slot charge whose `payment.amount` differs from config. Verify (`payment.js:469-470`) passes `paidPaise: spec.totalPaise` and never reads the real amount. Checkout calls verify straight away, so verify usually wins. Scenario: `RAZORPAY_PLAN_ID_AGENCY` is set by mistake to the Starter Razorpay plan. `record.razorpayPlanId` is taken from that env value, so `recordMatches` passes. The customer pays the Starter price plus GST, verify grants 6,000 Quarks and the agency tier, and the webhook then sees a replay. The report's claim that a wrongly configured env value is caught does not hold. Fix: in verify, fetch the payment (`rz().payments.fetch(razorpay_payment_id)`) and apply the same amount check. Better still, when a plan id comes from env, check the Razorpay plan's `item.amount` against `chargePaise` once in `getOrCreateRazorpayPlan`, and refuse to create subscriptions on a mismatch.

## 3. Money correctness: PASS with fixes

- **Cap boundary: correct.** `MAX_EXTRA_SLOTS = 25 - 5 = 20` paid slots. `canBuySlot` refuses when `clientLimitOf >= 25`, so an agency holding 0 to 19 slots may buy one more and an agency holding 20 may not. That gives at most 5 + 20 = 25 clients, as the spec says. The atomic gate `extraSlots < 20 OR missing` matches. The brief's own test (`extraSlots: 20` allowed) was wrong, and the implementer was right to change it.
- First payment adds the slot and its Quarks once (`$inc agency.extraSlots: 1` and the record set active in one update). A renewal (record active) grants Quarks only. Two racing payments on one inactive record: the loser's `$elemMatch active:{$ne:true}` fails, it re-reads, and it applies as a renewal. The result is one slot and two Quark grants, which is correct because both payments are real. Two subscriptions racing for the last place: the `$lt` gate lets one through and the other is refused. All of this is tested.
- A payment that cannot be honoured grants nothing (no payment row, no invoice) and cancels that slot subscription immediately (`cancel(id, 0)`). Cancelling is correct and safe. A first-cycle refusal leaves the record inactive, so the later `subscription.cancelled` event matches nothing in `active:true` and lowers nothing. A refused renewal leaves the record active, so its cancelled event lowers the count once. The 409 message is plain.
- **I1 (Important): a refused paid slot payment may never reach a person.** `alert` (`payment.js:58`) calls `opsAlerts.recordFailure('payment', …)`. That sends an email only after `ALERT_THRESHOLD` (default 3) failures inside 10 minutes, then a 60-minute cooldown, and keeps everything in memory per process (`opsAlerts.js:38-63`). One refused payment (`refuseSlot`, `payment.js:166-171`) sends no email and is lost on restart. There is also no durable record of the refused payment. Scenario: an agency at 24 clients opens two slot checkouts and pays both. One is refused, Rs 1,768.82 is taken, and no one is emailed. The customer saw "Our team has been told and will contact you about a refund", and that is now untrue. Fix: use `opsAlerts.recordCritical` (one occurrence is enough), or better, also persist the refusal (for example a `refusedPayments` entry on the user, or a payment row with `status: 'refund_due'`) so the staff Money page lists it.
- **I3 (Important): the strict amount check stops renewals after the repricing the spec plans.** The spec's "Watch and reprice rule" moves the agency base price from Rs 6,999 to Rs 9,999 for new sign-ups by editing config, and says existing agencies keep the price they signed up at. After that edit, every renewal of an existing agency subscription charges 6,999 + GST against an expected 9,999 + GST. `payment.js:532` then grants nothing (no Quarks, no new period), and only the throttled alert from I1 fires. The same applies to a slot price change. Fix: compare against the price the subscription was created at (store `chargePaise` on the subscription record at creation and compare with that), not against today's config.
- Minor, pre-existing (M8): when verify and the webhook for a first plan payment run at the same time, each calls `settle(..., {forcePlan:true})` before its atomic grant (`payment.js:189-192`). The loser's `settle` can expire the allowance the winner has just granted. This applies to every plan, but with Agency it is 6,000 Quarks. Worth a follow-up.

## 4. Cancel, halt and freeze: PASS for this task, one Important across tasks

- A slot ending (cancelled, halted or completed) runs a single `$inc -1` with the filter `$elemMatch {subscriptionId, active:true}`, so a repeated event, a halted after a cancelled, or a never-paid slot changes nothing. A clamp at 0 follows. No client is deleted, and `syncWorkspacePlans` freezes by `createdAt` with the oldest kept. All tested.
- The agency plan ending (cancelled, halted or completed): tier goes to free, and each active slot is cancelled at Razorpay, set inactive and lowered once (`cancelAddonSubscriptions` then `endSlot`, `payment.js:112-136`). The slot's own later event does nothing. Sync then sets clients to free and freezes all of them (limit 0). Buying again re-syncs and unfreezes the clients that fit. Tested.
- Task 4 interaction: `_agencyPassProblem` refuses a pass for a frozen client or a non-agency owner (`middleware/auth.js:25-26`), and `routes/agency.js:73` refuses opening one. Correct.
- **I4 (Important, across tasks): frozen clients can still spend outside the pass.** `quarkBuckets.spend` (`quarkBuckets.js:89-93`) and `CLIENT_PAYER_FILTER` (`agency.js:53-59`) check the agency, never the workspace's `agency.frozen`. After a slot is cancelled the agency stays on tier `agency`, so the frozen client keeps mirroring tier `agency`. Any work keyed by that workspace id that does not go through a pass keeps charging the shared pool: scheduled generation, auto-replies, a job already queued. Scenario: the agency drops from 6 to 5 places, client 6 is frozen, and its automatic replies or scheduled batch keep spending. Fix: have `resolvePayer` select `agency.frozen` and refuse the spend for a frozen workspace, or add the workspace check to the atomic spend. Otherwise route this to Task 9 ("scheduler exclusions") explicitly.
- Minor (M7): when the plan ends or is halted, slots are cancelled immediately (`cancel(id, 0)`), so paid slot days are lost. This matches add-ons. After a user cancel at period end the slots are already set to end, and the immediate cancel on plan end may fail and raise a false "cancel it in Razorpay" alert (`payment.js:119-124`).
- Minor (M9): if `syncAgency` fails after a slot ends, clients above the limit stay unfrozen, and the failure goes only to the throttled alert. Removing a client in Task 9 should also call sync so a frozen client can come back.

## 5. Regression: PASS

- No existing test was changed (`git diff --stat` shows only the new test file). `billing.test.js` passes.
- Shared helpers: `invoiceSpec` takes the item name from `INVOICE_ITEMS[key]` only for plan keys present there, which today is only `agency`, so Starter and Growth keep "Nebulaa subscription" (tested). `razorpayPlanBody` gives the same names and descriptions for plans and add-ons. `buildChargeUpdate` reads `firstCycle` only in the slot branch. `buildEndUpdate` has a new slot branch first and is otherwise unchanged. The webhook spreads `built.filter || {}`, which is empty for other kinds. `cancelAddonSubscriptions` gains a loop that is empty without slots. `cancel-subscription` adds slots only. `create-order` gains only the workspace refusal. Managed, Starter, Growth, add-ons and top-ups behave as before.
- Minor (M5): the staff Money plan mix now has an `agency` row, but `isCustomer` (`money.js:23`) does not exclude client workspaces. They mirror tier `agency` (or `free` when frozen), so an agency with 5 clients counts as 6 agency customers (`money.js:122`).
- Minor (M4): the renewal reminder adds every active slot to the plan's next charge on the plan's date (`renewalReminders.js:31`). Each slot is its own subscription with its own billing date, so the amount and date shown can be wrong. Add-ons already have the same pattern.

## 6. Test quality: adequate

The tests run the real router against a fake model whose reads return copies, so stale reads are real. Concurrency is tested with `Promise.all`. Forged amount, plan id, owner and key, replay, cap, and end-once are each checked against a snapshot of the stored state. Removing the strict amount check, the end filter, the atomic gate or the first-cycle condition would fail tests.

On the implementer's two mutations:
- **Removing the limit pre-check:** I agree no test fails. Without it, the atomic `$lt` fails, the retry fails again, and the refusal reason becomes `slot_conflict` instead of `at_limit`. The test at `agencyBilling.test.js:566-569` checks only 409 and the wording, not the reason. Asserting `/most clients/` would pin it (M1). The outcome (nothing granted) is still protected, so keeping it as defence in depth is fine.
- **Removing the `agency.ownerId: null` gate:** this is defence in depth only. `ownerId` is set at creation and never changes, so the race it guards against cannot happen in practice. That is acceptable.

Weak or missing tests (M1): the refusal reason and message; refusal on the verify path for `no_agency_plan`; the `slot_conflict` path; alert content when a slot cancel fails after the plan ends; the `cancel-subscription` test checks only the cancel calls; nothing tests verify with a wrong amount (see I2). The ops-script test reads only the text, which is fine.

## 7. The implementer's concerns, judged

- **No Starter or Growth to Agency upgrade:** acceptable for v1. `hasActivePlanSubscription` blocks it, as it already blocks Starter to Growth. The owner needs to make a product decision before marketing Agency to existing customers.
- **No route to cancel a single slot: I5 (Important, owner decision).** Each slot is a recurring Rs 1,499 + GST charge. The only ways out are cancelling the whole plan or writing to support. No later task in the plan builds a slot cancel (Tasks 10 and 11 add only "Add a client slot"). The end logic (`endSlot`) can be reused. A `POST /cancel-slot` (cancel at cycle end, the newest slot first) and a button on the Clients page should exist before self-service launch.
- **A refused payment needs a manual refund:** acceptable only once I1 is fixed (a reliable alert plus a durable record). Today it can be silently missed. Also (M3): each repeated verify of a refused payment re-alerts and re-calls Razorpay cancel (rate-limited to 30 per 15 minutes). (M6): pending unpaid slot subscriptions are not counted by `canBuySlot` and are not cancelled when the plan ends, so more refunds than needed can arise. (M2): if the second attempt also conflicts, `slot_conflict` cancels a valid, paid slot subscription (rare, but it is money).
- **Atomic filters checked only against the fake:** I read each one against MongoDB semantics, and all are valid and behave as intended on a real server.
  - `{ _id, 'payments.razorpayPaymentId': {$ne: id}, 'plan.tier': 'agency', 'agency.ownerId': null, 'plan.subscriptions': {$elemMatch: {subscriptionId, active: {$ne: true} | true}}, $or: [{'agency.extraSlots': null}, {'agency.extraSlots': {$lt: 20}}] }`:
    - `$ne` on an array path matches only when no element equals the id.
    - `null` equality matches a field that is missing or null.
    - `$elemMatch` requires both conditions on the same element, and `{$ne: true}` matches an element that has no `active` field.
    - A top-level `$or` combined with the other fields is an implicit AND.
  - The update `$set 'plan.subscriptions.$[sub].active'` with `arrayFilters [{'sub.subscriptionId': id}]`, `$inc agency.extraSlots` and the credit fields, and `$push payments` has no conflicting paths. The filter's `$elemMatch` does not interfere with `$[sub]` because no positional `$` is used.
  - The end update `$inc agency.extraSlots: -1` with the `$elemMatch active:true` filter and the same `arrayFilters` is valid. The `$lt: 0` clamp is valid.
  - All paths are declared in `models/User.js:333-350`, so Mongoose 8 casting and `strictQuery` leave nothing out.
  - The one real-server difference: `$inc` fails if `agency` is stored as literal `null`. Neither the schema nor any code path writes that.
  - Residual risk is low. A dev-database run in Task 12 is still advised (first payment, renewal, cap race, end-once).

## Other Minor

- (M10) The welcome email is claimed once per account, so a past Starter subscriber who later buys Agency gets no Agency welcome (`payment.js:240`).
- (M11) Slot Quarks go to the top-up bucket. Each grant resets the single `credits.topupExpiresAt` to 60 days ahead (`quarkBuckets.js:185-189`), so monthly slot renewals effectively stop all of an agency's top-ups from expiring. The bucket already works this way, but the effect grows with recurring slots.

## Findings index

| Grade | Id | Where | Summary |
|---|---|---|---|
| Important | I1 | payment.js:58,166-171; opsAlerts.js:38-63 | A refused paid slot payment raises an alert only at 3 failures in 10 min, kept in memory; no durable record; the customer is told the team knows |
| Important | I2 | payment.js:469-470 vs 532 | Strict amount check is webhook-only; verify grants first, so a wrong env plan id is not caught |
| Important | I3 | payment.js:532; spec "Watch and reprice" | Repricing in config makes every renewal of existing agencies and slots grant nothing |
| Important | I4 | quarkBuckets.js:89-93; agency.js:53-59 | Frozen workspaces can still spend the pool through paths that do not use a pass |
| Important | I5 | (missing route) | No self-serve way to stop one recurring slot; no task in the plan builds it |
| Minor | M1 | agencyBilling.test.js:566-569 | Refusal reason and message not pinned; several refusal paths untested |
| Minor | M2 | payment.js:209-210 | A second conflict cancels a valid paid slot subscription |
| Minor | M3 | payment.js:166-171 | Repeated verify of a refused payment re-alerts and re-cancels |
| Minor | M4 | renewalReminders.js:31 | Reminder adds slots to the plan's date although they bill on their own dates |
| Minor | M5 | staff/money.js:23,122 | Client workspaces counted as agency or free customers |
| Minor | M6 | payment.js:112-127; billingPlans.js:98 | Pending slot subscriptions not counted or cancelled |
| Minor | M7 | payment.js:119-124 | Immediate slot cancel on plan end loses paid days; possible false alert |
| Minor | M8 | payment.js:189-192 | Pre-existing: concurrent `settle(forcePlan)` can expire a fresh plan grant |
| Minor | M9 | payment.js:139-147 | Sync failure leaves clients above the limit unfrozen; only a throttled alert |
| Minor | M10/M11 | payment.js:240; quarkBuckets.js:185 | Welcome once per account; top-up expiry reset by each slot renewal |
