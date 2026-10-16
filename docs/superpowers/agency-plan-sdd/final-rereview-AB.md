# Final re-review, parts A and B (backend fix wave)

Reviewer: Opus 5.5, read-only, 2026-10-16. Scope: the fix diff `6b26bc2..4737564` (backend source), checked against `final-review-A.md`, `final-review-B.md` and `final-fix-AB-report.md`, with the current source read for context.
Tests: `node --test tests/agency*.test.js tests/billing*.test.js tests/finalFix*.test.js tests/protectDeletion.test.js tests/csmAccess.test.js tests/accountDeletion.test.js`: 272 pass, 0 fail.
Extra checks (no database, no external calls):
- an in-memory Express router compared with `normalisePath` on about 25 tricky URLs;
- a localhost-only raw-socket check of which request lines Node 24's HTTP parser accepts at all.

## Verdicts

| Finding | Verdict | Where (current source) | Note |
|---|---|---|---|
| A-I1 staff Usage with Agency | ADDRESSED | `services/staff/usage.js:178-180` | `agency` is in the tier list and unknown tiers are skipped. Test passes. |
| A-I2 retry-invoices | ADDRESSED | `routes/payment.js:975-979` | Only `paid` rows are invoiced (a missing status counts as paid). The schema enum is paid/failed/refunded, so refused and refunded rows are skipped. |
| A-I3 first-payment race and renewal guard | ADDRESSED | `routes/payment.js:264-302` | See "A-I3 in detail" below. |
| A-I4 slot Quarks vs top-up expiry | ADDRESSED (as ruled), with a side effect | `services/billingPlans.js:208`, `quarkBuckets.js:188-200` | Slot Quarks no longer move the expiry date. The side effect is N1 below. |
| A-M3 late charge revives slot | ADDRESSED (small gap) | `routes/payment.js:257`, `billingPlans.js:236-241` | `ended` is only set when the slot was **active** at the ending event (the `$elemMatch active:true` filter). A slot cancelled before its first charge was ever applied is not marked. Very unlikely. |
| A-M4 wrong-amount Agency charge | ADDRESSED (the smaller version) | `routes/payment.js:222-229`, `:586`, `:604` | First Agency payment: cancelled at Razorpay. A running plan is only recorded and alerted. A halted plan (record inactive) that resumes with a wrong amount would be cancelled, which is acceptable. |
| A-M6 false cancel alerts | ADDRESSED | `routes/payment.js:127-131` | |
| A-M7 / B-M1 staff `clientFor` | ADDRESSED | `services/staff/clientActions.js:16-18`, `routes/staff.js:277-283` | `clientFor` loads the full document, so `agency.ownerId` is seen. |
| A-M9 HERO_LIMITS | ADDRESSED | `config/entitlements.js:21` | |
| A-M10 / B-M8 credits routes | ADDRESSED | `routes/credits.js:31-44`, `:93-98` | Pool balance and total used only, no history. A frozen client gets 403. `publicCredits` returns 0 when the agency cannot pay. |
| B-I2 removal claim, single release, real count | ADDRESSED | `agencyWorkspaces.js:135-150`, `:23` (releaseSlot clamped at 0), `:79` (sync skips a client being removed); `accountDeletion.js:43-53`, `:105-106`, `:221` | The claim is atomic and the release happens once. Deletion uses the real workspace count for its pause, restore and purge steps. Small notes are N3 and N4. |
| B-I3 staff and `/api/account` | ADDRESSED | `csmAccess.js:20-23`, `:39-43`; `clientActions.js:21-26`; `routes/staff.js:512-513` | Order in `protect`: the 423 allow-list comes first, then the CSM block, so a CSM cannot reach `/deletion/restore` or `/consent`. Only `GET /api/account/status` passes. |
| B-I4 purge claim and stale pickup | ADDRESSED | `accountDeletion.js:237-262` | A completed request is never re-claimed. Two runs cannot both claim. A live purge can be re-taken only if it runs for more than 30 minutes, and the next run on the same instance is 6 hours away (N5). |
| B-I5 reminder emails | ADDRESSED | `notificationScheduler.js:255-266`, `:269`, `:350`; `routes/notifications.js:327`, `:362`, `:384` | Grep for `gmail` in backend source (tests excluded) finds only provider and canonicalisation code. The personal address is gone. Workspaces (`agency.ownerId`, `.invalid`), switched-off and pending accounts get no email. The behaviour change is N2. |
| B-I6 shared path normaliser | ADDRESSED | `services/requestPath.js`; used in `csmAccess.js:40`, `agencyWorkspaces.js:174`, `middleware/auth.js:21` | Bypass search below. No bypass reaches the app through Node's parser. |
| B-M2 pass from CSM session | ADDRESSED | `routes/agency.js:94` | |
| B-M3 halted agency | ADDRESSED | `middleware/auth.js:32`; `protect` selects `subscription.status` | |
| B-M4 live inbox and sockets | ADDRESSED (small gap) | `middleware/auth.js:43-55`, `socialInboxRoutes.js:40`, `socketHub.js:34-36` | The socket's `select` leaves out `assignedCsm` (N6). |
| B-M6 schedulers | ADDRESSED | `services/backgroundGate.js`; `campaignScheduler.js:194-197`, `contentCalendarService.js:821-826`, `snapshotScheduler.js:53-56` | Ordinary and managed accounts are unaffected unless their own deletion is pending: `agency.frozen:true` exists only on workspaces, and the "ended" set is limited to owners of workspaces. With an empty list the query is unchanged, and a failed read means no filter. `userId` is an ObjectId in both models, so `$nin` works. A halted agency plan is not in the gate (minor). |
| B-M7 tombstone canonical | ADDRESSED (partial, as stated) | `accountDeletion.js:25`, `:192`; `blueprint/service.js:40` | Old tombstones still match. They stored the plain hash, and for a non-aliased deleted address that equals the canonical hash of any later alias. A deleted aliased address only matches itself. The `JWT_SECRET`-as-HMAC-key point from M7 is not addressed (not in scope). |
| `/api/account/consent` inside an agency pass vs frontend | CONSISTENT | backend `agencyWorkspaces.js:169`; frontend `utils/accountDeletion.ts:22-28`, `App.tsx:204`, `services/api.ts:448` (`mergeActing`) | `needsTermsPrompt` returns false when `actingAgency` is set or a return pass is held, so the prompt never shows to an agency or CSM working inside a client. |

### A-I3 in detail (`routes/payment.js:264-302`)
- **First-payment race (verify and webhook together).** The plain `settle` no longer expires a fresh grant, because `planExpiresAt` is in the future. The grant and the expiry are now one update, filtered on `$ne paymentId` plus the `planBalance` and `topupHeld` values that were read. Interleavings:
  - the second request re-reads, sees the payment row and returns early (`:270`); or
  - its guarded update fails on both filters, and the re-read sees the payment (`:296-297`).
  - Neither path can expire a grant.
- **No double grant on replay.** `$ne paymentId` stays in the filter, and every retry re-reads the payment rows first.
- **Top-ups are never touched.**
  - `expiring = min(planBalance, balance)` only (`:272`).
  - Top-ups that fell due are expired by the same plain `settle` as before.
  - Held top-ups are read after `settle`, released in the same update, and guarded by `topupHeld`. If `settle` holds top-ups for a lapsed plan just before the renewal, they are released in the same grant, so the net change is zero.
  - A top-up bought in between only `$inc`s balance and top-up, which is not in the guard, so the two increments add up correctly.
  - A spend from the top-up or kept buckets leaves `planBalance` alone, and the relative `$inc` stays correct. A spend from the plan bucket changes `planBalance`, so the update re-reads and retries.
- **Early or late renewals.**
  - Early: the plan bucket is not yet due, and `expiring` replaces it inside the update. This is identical to the old `forcePlan`.
  - Late, after expiry: `settle` has already zeroed it, so `expiring` is 0.
- **"Replaces instead of adds" is not a production change.** The old code also replaced, via `settle({forcePlan:true})`. Only the fakes in the tests made it look additive.
- **Older accounts (no `planBalance` or `topupHeld` stored).** `same()` gives `{ $in: [0, null] }`, which matches a missing field. `expiring` is 0, so legacy kept `credits.balance` is preserved.
- **Managed accounts** never reach this path: `create-subscription` refuses them.
- **Remaining risk.** After 5 failed attempts (5 plan-bucket spends, each landing inside a few-millisecond window), the payment is alerted but not recorded.
  - The webhook still answers 200, so Razorpay does not retry.
  - Verify answers `success:true, alreadyProcessed:true` (`:602`).
  - This needs sustained concurrent spending on that exact account, so it is Minor. The alert makes it recoverable.

### B-I6 bypass search
I compared Express routing (in memory) with `normalisePath` and both block lists. Every candidate that Express routes to `/api/payment` or `/api/account` and that the normaliser does not block is refused by Node's parser before it reaches the app:
- `http:/api/payment/x` and `https:/api/payment`: Express routes them to payment and the normaliser does not block them, but Node answers 400.
- `http://h\api/payment/x`: Express routes it to payment and the normaliser reads `/payment/x`, but Node answers 400.
- `\api/payment`: Node answers 400.
- `/api/payment<TAB>`: Node answers 400.

Everything Node accepts is either blocked or not routed:
- blocked: absolute-form in any case, userinfo, `ws://`, `//api/...`, `/api//...`, `%70ayment`, trailing slash;
- not routed: `/api\payment/x`, `/api/payment;x`, `/api/payment%00`, `/api/account/status/..`, `%2F` tricks, `/./`.

I found no reachable bypass. The normaliser does not fold `\` to `/`, which only matters if a future proxy rewrites it. That is a hardening note, not a defect.

## New issues from the fix diff

No Critical issues.

**Important (owner decisions, not defects):**
- **N1. Slot Quarks can now expire within days.** `billingPlans.js:208` with `quarkBuckets.topupIsLive`. With `keepExpiry`, a slot's 500 monthly Quarks join a live top-up bucket and inherit its end date. Example: a pack bought 58 days ago with 10 Quarks left. The slot renews, and the slot's 500 Quarks expire in 2 days. That costs a paying agency Quarks it reasonably expects to last the month (the spec lists 500 per slot per month). Before the fix, the slot pushed the expiry forward instead. Both behaviours are wrong in opposite directions. The clean fix is the other option from A-I4: give slot Quarks their own monthly life, or add them to `planBalance`. Confirm with the owner before launch.
- **N2. Every customer now gets the 30- and 15-minute reminder emails.** `notificationScheduler.js:255-266`, `:269`, `:350`; `routes/notifications.js:327`. Until now, no real customer received them, because they all went to the developer's address. After deploy, wherever SES is set up, every owner with scheduled posts gets 2 emails per post. That includes managed (CSM-run) customers, for posts that staff scheduled. Removing the leak was right. Who receives the emails is a product decision; the alternative is to switch the emails off.

**Minor:**
- **N3. Duplicate removal returns 502.** `routes/agency.js:83`. A second removal ("This client is already being removed.") is not busy and not "not found", so it returns 502. A double-click shows an error toast while the first request succeeds. Use 409.
- **N4. The 10-minute removal claim has no heartbeat.** `agencyWorkspaces.js:87`, `:136-138`. A purge that runs longer than 10 minutes can be claimed again by a second request, giving a double purge and a double release (the release is clamped at 0, so at most one count of drift). Also, `syncWorkspacePlans` still counts a client that is being removed when it works out which clients are over the limit (`:78-80`), so another client can be frozen until the next sync.
- **N5. Purge pickup gaps.** `accountDeletion.js:237`, `:245-246`. There is no heartbeat for a purge running longer than 30 minutes, which only matters with several instances. A stale `running` record with `attempts >= 5` is never picked up or alerted.
- **N6. Socket CSM check never sees the assignment.** `socketHub.js:34`. The `select` leaves out `assignedCsm`, `staffRole` and `isCsm`, so `canActFor` always fails for a CSM-role staff member acting in a client, and their socket is refused. The frontend has no socket.io client today, so nothing breaks yet. Add the fields to the `select`.
- **N7. Verify reports success when a plan payment could not be applied** (see A-I3 above).
- **N8. Scheduler gate cost.** `backgroundGate.js` runs 3-4 unindexed `User` queries (`agency.frozen`, `deletion.status`) on every scheduler tick, in three schedulers. This is fine at the current size. Add indexes or a short cache later.

## Overall
Safe to push. Nothing Critical, and no fix introduces a money or access defect. Confirm N1 (slot Quark expiry) and N2 (customers now get reminder emails) with the owner before launch.
