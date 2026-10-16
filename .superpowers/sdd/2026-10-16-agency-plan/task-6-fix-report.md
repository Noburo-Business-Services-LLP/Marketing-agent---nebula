# Task 6 fix report (agency billing review fixes)

Tests: backend 1135/1135 (was 1117; +18, every file exits on its own). Frontend untouched. Fakes only.

## Done
- I1: a refused or amount-mismatched agency plan or slot payment is stored as a payment row on the user (status `failed`, `needsRefund: true`, `reason` code, `subscriptionId`, payment id, amount, time). The staff Money failures list shows it with a plain reason and `needsRefund`. The owner is emailed at once through the existing `opsAlerts.notify` (key `refused_payment:<paymentId>`, unlimited cooldown), which needs no new function. The row is added by one atomic update guarded by `payments.razorpayPaymentId $ne`, and only the call that adds it sends the email, so a replayed webhook or verify neither duplicates nor re-emails (also holds across restarts). An email or record failure never fails the request. A replayed verify of a refused payment returns the same 409 text. Customer text says the team will refund or fix it, no vendor names.
- I2: chose to fetch. `verify-subscription` now calls `payments.fetch` on the same Razorpay client (already used for `subscriptions.fetch`) for agency and slot and applies the same strict check. If the amount cannot be read, verify grants nothing (409 "still confirming") and the webhook grants. A payment already holding a row is not re-fetched. Verify and webhook still grant at most once (tested both orders and concurrent).
- I3: create-subscription stores `expectedPaise` (paise, GST included) on the agency plan and slot record (new schema field). The strict check, the invoice and the payment row use the stored price (`bp.priceOfRecord`); records without it fall back to today's config. Tested with a repriced config on webhook and verify, plus the legacy fallback.
- I4: `quarkBuckets.spend` refuses a frozen client workspace (no pass needed to be caught), via `resolvePayer`, which now reports `frozen: true` only when set. `walletBalance` and `publicCredits` show 0 for a frozen client, so guards give the existing not-enough-Quarks refusal. Refunds still land. New file `tests/agencyFrozenSpend.test.js` includes a pass-less background-job spend.
- Tests added: slot_conflict, no_agency_plan on verify, wrong amount on verify (agency and slot), pinned reasons and wording, durable record and immediate alert with dedupe, email failure swallowed, Money list, repricing.
- Existing tests changed: four assertions that counted all payment rows now count paid rows (refusals now leave a failed row by design).

## Notes and limits
- The frozen check is a separate read of the workspace, not inside the payer's atomic update (it is a different document). A freeze landing between that read and the spend can let one spend through.
- A refused payment id is permanently refused (including slot_conflict): a later retry of the same payment will not be granted automatically.
- Amount mismatch does not cancel the Razorpay subscription (a slot refusal still does); the next charge would email again.
- I5 (single-slot cancel route) not built: owner decision pending.

## Minor findings skipped
- M1 other untested refusal paths beyond those listed above.
- M2 a second slot_conflict cancels a valid paid slot subscription (now recorded and emailed).
- M3 repeated verify re-cancels at Razorpay for slot refusals, but no longer re-alerts.
- M4 renewal reminder adds slots to the plan's date.
- M5 staff Money counts client workspaces as customers.
- M6 pending unpaid slot subscriptions are not counted or cancelled.
- M7 immediate slot cancel on plan end loses paid days.
- M8 concurrent settle(forcePlan) can expire a fresh plan grant (pre-existing).
- M9 sync failure leaves clients above the limit unfrozen.
- M10 welcome email once per account.
- M11 slot renewals reset the top-up expiry.
