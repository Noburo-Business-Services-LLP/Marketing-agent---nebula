# Task 5 report: one shared Quark pool

Status: done. Backend 1055/1055 (was 1034, +21). Frontend and tsc untouched. RED seen (14 of 17 new money and payer tests failed first), then GREEN. Commit message ends with the required trailer.

## Core
- `services/agency.js`: `resolvePayer` (as in the brief, plus tolerance for a mock whose `select()` has no `.lean()`), `canPayForClients(owner)` and `CLIENT_PAYER_FILTER` (same test as the pass check in `auth.js`: agency tier, not itself a client, active, not pending deletion, not halted). `walletBalance` now returns 0 for a client whose agency cannot pay (deviation, see below).
- `services/quarkBuckets.js`:
  - `spend`: first resolves the payer; no payer = `{success:false}`. For a client the one atomic `findOneAndUpdate` filter is `{_id: agency, 'credits.balance': {$gte}, ...CLIENT_PAYER_FILTER}`, so plan, active state and balance are checked in the same update. Ledger row: `user` = agency, `workspace` = client. For any other account the filter is exactly `{_id: userId, 'credits.balance': {$gte: amount}}` as before. Result also carries `payerId` and `workspaceId`.
  - new `refundTo(userId, quarks, {action, ref, payerId})` (atomic `$inc`, ledger row with `workspace` for a client; used by the two Videos refunds) and `settleWallet(userId)` (settles the payer so a client's activity expires the agency's Quarks).
  - `PAID_TIERS` now includes `agency` (otherwise `settle` would hold the agency's top-ups as soon as its plan month ends).
- `models/QuarkLedger.js`: `workspace` field (indexed) and index `{user, workspace, createdAt}`.

## Call sites changed (before -> after)
- `middleware/trialGuard.js`: `checkTrial` (:27-:40) own balance -> `walletBalance` for a workspace, settle -> `settleWallet`; `deductCredits` (:82, :92) settle -> `settleWallet`, failure-path balance read -> `walletBalance` for a workspace (0 if the agency cannot pay, message unchanged), result now also returns `payerId`/`workspaceId`; `requireCredits` (:137-:139) balance and settle -> payer; `refundCredits` (:150-:215) new 5th argument `{payerId}`, else `resolvePayer`; both Mongo calls target the payer; no payer = `User not found`, null update result = failure instead of a thrown error; client refunds add a ledger row with `workspace` (other accounts still write none, as before).
- `middleware/creditGuard.js`: `checkCredits` (:82), `deductCredits` (:128-:163, available amount, settle, final read of the pool, safe when the agency is gone), `requireCredits` -> wallet for a workspace. `ensureCreditCycle` left alone (it only initialises the client's own empty record).
- `routes/studioVideos.js`: :148 `User.updateOne({_id: doc.user}, $inc ...)` -> `quarkBuckets.refundTo(..., {payerId: claimed.payer})`; :154 `charge` stamps `StudioVideo.payer` at charge time; :231/:241 reference spend/refund -> `settleWallet` and `refundTo(..., {payerId: paid.payerId})`. `models/StudioVideo.js`: `payer` field. A refund with no payer to return to logs and does nothing.
- `routes/credits.js` :34 and `/history`: balance, parts and history come from the agency pool for a client (an empty view if the agency cannot pay).
- `routes/dashboard.js` :804, :821, :960, :1088, :1241, :1604, :1653, :1692; `routes/content.js` :33, :269; `routes/chat.js` :37; `routes/campaigns.js` :2444, :4673, :5900 (post-action `creditsRemaining`); `routes/videoGeneration.js` :3973: each own-balance read -> `walletBalance`.
- `routes/social.js` `rewardSocialConnect`: reward is 5, so it now returns false for a workspace.
- Payer recorded on the job at charge time, refund uses it: `services/heroVideoFlow.js` (`metadata.payerId` only for a client; `refundOnce` and the "job not created" refund pass `{payerId}`; order of quota, deduct, create, recheck, submit, poll, complete or refund-once unchanged), `services/blueprint/service.js` + `models/Blueprint.js` (`charge.payerId`, same rule), `StudioVideo.payer`. Non-client jobs store nothing new and call refund with the same arguments as before.

## Extra sites found beyond the brief
- `middleware/trialGuard.js checkTrial` reads the balance (routed).
- `services/quarkBuckets.js` `settle` callers (trialGuard x3, creditGuard, credits.js, studioVideos x2): routed through `settleWallet`.
- `routes/studioVideos.js` also `fail()` refund and reference charge/refund (routed).
- `PAID_TIERS` missing `agency` (fixed).
- `routes/social.js` reward (skipped for workspaces).
- Left as they are, with reason: `routes/payment.js`, `services/billingPlans.js` (grants go to the paying account, blocked inside a client), `routes/staff.js`, `services/staff/*`, `routes/csm.js` (staff never act on workspaces), `routes/auth.js` and `models/User.js getPublicProfile` (`/me` already shows the agency pool from Task 4; the profile method is not used for a workspace's balance), `services/migrationService.js` and scripts (offline). `services/staff/usage.js` and `money.js` read `credits.history` of customers only (workspaces are excluded in Task 9).
- NOT changed: `services/videoGenerationQueue.js` (Kling files, not listed in the brief). Its six refund calls use `refundCredits(job.userId, ...)`, which resolves the agency now. Same for `drafts`, `carousels`, `contentCalendar`, `staleDrafts`, `designedService`, `campaigns` and `videoGeneration` refunds.

## Real run (nebulaa_dev only, script `backend/scripts/agency-pool-check.js`, refuses other databases)
Throwaway agency (100 Quarks), 2 clients, 1 managed account. Results: client spend took the pool 100 -> 89 while the client's own 777 stayed; ledger row user = agency, workspace = client; the real `/api/credits` route with a client pass shows 89; refund returned the pool to 100 with a refund row naming the client; 8 concurrent spends from two clients on a pool worth 3 spends: exactly 3 succeeded, pool 0, never negative; empty pool refused with "Insufficient Quarks"; agency plan ended: spend refused though Quarks remained, nothing charged, a late refund still reached the agency; client removed: refund with the recorded payer landed on the agency, without it nothing was credited; agency deleted: orphaned client refused, own record untouched; managed account spend and refund as before (ledger row without `workspace`, no refund row). Cleanup removed all users and ledger rows, left over 0. The script also puts the shared daily AI spend counter (`AiSpendDay`) back exactly as it was. My FIRST run, before that restore existed, had added 5 image spends to today's counter; I subtracted exactly that amount afterwards (openai_image 0.5201 -> 0.0955, total 1.5256 -> 1.1010).

## Tests added
`tests/agencyPayer.test.js` (resolvePayer, unknown user, walletBalance for non-paying agencies, hero payer recorded and refunded to it, hero unchanged for others), `tests/agencyPayerMoney.test.js` (12: client spend charged to agency with ledger, too few Quarks, no active plan variants, agency gone, concurrency, managed and starter pinned exactly (filter and ledger shape), client refund, refund after plan ended, refund with recorded payer after removal, refund refused with no payer, plain refund identical update and no ledger row, `checkTrial`/`requireCredits`, creditGuard helpers for client and plain account), `tests/creditAccessGuard.test.js` (reviewed list as in the brief, plus a check that the read sites use `walletBalance` and `studioVideos` has no raw balance write). `agencyRules.test.js`: wallet test data now gives the agency the agency tier.

## Deviations and concerns
- `walletBalance` returns 0 when the agency has no active agency plan (brief left it open; rule (b) and the reads must agree with the spend).
- Frozen clients: money layer does not check `agency.frozen` (the pass check already refuses them; background jobs of a frozen client could still run on the pool).
- Loss case: a client removed while a job from the Kling queue or any flow other than Hero, Blueprint and Videos is running cannot refund (no payer to find). Task 8 and 9 deletion should refuse or wait while a client has running jobs.
- `deductCredits` of creditGuard (the "take what is there" variant) still reports success with 0 deducted when the pool is empty, same as for any empty account today.
- A client refund writes a ledger refund row where others write none, so the per-client report (Task 7) can net spends and refunds.
- The deductCredits result gains `payerId` and `workspaceId` keys.
- No Kling file edited. No .env read or printed.
