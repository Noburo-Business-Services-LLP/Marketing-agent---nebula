# Task 5 review (80f6116..c3639f3): one shared Quark pool

Evidence: read brief, report, plan header/Global Constraints/Review Focus, spec, task 1-4 reports, full commit diff, and the
current state of every file that reads or writes Quarks. Independent greps over `routes`, `services`, `middleware`,
`controllers`, `utils`, `models` for `credits.balance|totalUsed|history`, `$inc` on credits, `balance +=/-=`,
`QuarkLedger`, `AiSpendDay`, `settle(`, `spend(`, `refundTo(`, `deductCredits|refundCredits`, `toPublicJSON`.
Backend suite run: 1055 tests, 1055 pass, 0 fail. No database touched, no server started.

## Verdicts
1. SPEC COMPLIANCE: PASS. Every call site in the brief is changed as specified (`resolvePayer` verbatim; ledger field and
   index; `spend` resolves payer first and refuses with no payer; trialGuard `deductCredits`/`requireCredits`/`refundCredits`;
   creditGuard three comparisons and the deduct; studioVideos both raw `$inc` writes; credits.js both routes; all listed
   dashboard/content/chat/campaigns/videoGeneration reads; social reward checked (5, now skipped for workspaces)). Extras
   are justified: `checkTrial` read, `settleWallet` for every settle caller, payer stamped at charge time for Hero, Blueprint
   and Videos, `PAID_TIERS` + `agency`, `CLIENT_PAYER_FILTER` in the atomic spend. Deviations accepted: `walletBalance` = 0
   when the agency cannot pay (reads must agree with the spend filter); client refunds add a ledger row (needed by Task 7).
2. COMPLETENESS: PASS. Every debit in the backend goes through `quarkBuckets.spend` (trialGuard, creditGuard, studioVideos x2);
   every refund through `refundCredits` or the new `refundTo`. No remaining site charges or refunds a workspace's own
   balance. Remaining direct writers are staff grants (`routes/staff.js:114,:329`, `services/staff/clientBulk.js:56`),
   purchase grants (`services/billingPlans.js:166`, payment blocked inside a client) and the social reward (now skipped).
   Nothing was changed that should not have been.
3. MONEY SAFETY: PASS WITH NOTES. Client spend is one `findOneAndUpdate` on the agency with `$gte` and the payer-can-pay
   filter in the same update (no read-modify-write). Refunds are atomic `$inc`. Agency gone / no agency plan / halted /
   inactive / pending deletion / agency that is itself a client: spend refused, client record never charged, nothing negative.
   `agency.ownerId` never changes, so "current payer" equals "payer at charge time" except after a client or agency is
   deleted; Hero, Blueprint and Videos record the payer and refund to it; the Kling queue and other refundCredits callers
   resolve at refund time and fail safe (no wallet credited) after a client is removed (I2). Double refund guards
   (`refundOnce` claims, `StudioVideo.refunded`) are unchanged.
4. NO REGRESSION: PASS. Non-workspace spend filter is byte-identical (pinned by test for managed and starter), ledger row
   shape unchanged (no `workspace` key saved), refund update identical and still no ledger row; route reads now go through
   `walletBalance`, which for a non-workspace is the own balance floored at 0 (only difference: a negative balance shows as
   0). The one edited existing test (`agencyRules.test.js` wallet data: owner gets `plan.tier: 'agency'`) is a required
   consequence of the walletBalance deviation and does not weaken it; non-paying agencies are covered by a new test.
5. PRIVACY and ISOLATION: PASS WITH NOTES. A client view sees only its agency's pool, never another agency's. It does see
   the agency's whole `credits.history` (M1), as the brief asked; the only person who can open a client is the agency itself.
6. TEST QUALITY: PASS WITH NOTES. The key money tests would fail if the rule were wrong (filter variants, client record
   untouched, ledger tagging, exact non-workspace filter). Gaps: new money code with no test at all (I3); concurrency test
   is atomic by construction (M9); guard regex narrow (M8).

## Critical
None.

## Important
I1. Free first campaign batch per client, farmable (outside the brief, owner decision). `routes/dashboard.js:795` and `:954`
    skip the charge when `!user.initialCampaignsGenerated`; `services/agencyWorkspaces.js:43` creates workspaces without
    setting it. Scenario: an agency adds a client, opens Campaigns, gets up to `count || 6` `campaign_full` generations
    (image cost) free, removes the client (slot released), adds another: repeat without limit. This is the same kind of free
    offer the spec closes for Blueprints. Fix: create workspaces with `initialCampaignsGenerated: true`, or charge the pool.
I2. Refund lost when a client is removed while a job is running (carry-forward; no step in Task 9 covers it). Kling queue
    (`services/videoGenerationQueue.js:166,:241,:357,:576`), `services/staleDrafts.js:41`, designed Blueprint, drafts,
    carousels, contentCalendar refund with `refundCredits(job.userId, ...)` and no recorded payer. After the workspace record
    is deleted `resolvePayer` returns null and the refund returns `User not found`: the agency paid for a failed job. Wrong
    wallet is never credited (safe), but customer money is lost silently. Fix in Task 9: refuse or defer client removal while
    it has processing jobs, or record `payerId` on those jobs too.
I3. New money code with no test. `quarkBuckets.refundTo` (`services/quarkBuckets.js:107-122`, used by both Videos refunds),
    `settleWallet` (:125), the StudioVideo payer stamp and its use in `fail()` (`routes/studioVideos.js:148,:156`), Blueprint
    `charge.payerId` recording and refund (`services/blueprint/service.js:129-130,:216,:223`), `holderOf` in
    `routes/credits.js:12-16`, and `PAID_TIERS` including `agency` (`services/quarkBuckets.js:21`). The real run used only
    `trialGuard` and `/api/credits`, so Videos and Blueprint client refunds were never exercised. Reading the code they are
    correct; a regression (for example `refundTo` crediting `userId` instead of `target`) would pass the suite.

## Minor
M1. `routes/credits.js:44` and `:87` return the agency's `credits.history` (last 20 / all) to a client view: the agency's
    purchases and every other client's spend lines. Brief step 7 asks for it, but it conflicts with the review checklist and
    with Task 4's `/me` choice (balance and totalUsed only). No exposure today (no client login). Owner ruling; if clients
    ever log in, return `[]` or ledger rows filtered by `workspace`.
M2. `PUT /api/auth/update-profile` (`routes/auth.js:1228`) and `PUT /complete-onboarding` (`:1425`) return
    `toPublicJSON()` (`models/User.js:448-451`), i.e. the workspace's own `credits` (0, or any staff grant). Inside a client
    the header may show 0 after saving the profile. Display only; the report's claim that the profile is never used for a
    workspace balance is not quite right.
M3. `/me` (`routes/auth.js:1161-1164`) shows the pool without `canPayForClients`, while `/api/credits` shows 0 for an agency
    that cannot pay. Masked because the pass is refused then.
M4. `scripts/agency-pool-check.js` restores `AiSpendDay` with `$set` of a snapshot (finally block) after a 400 ms wait.
    It erases any other dev spend recorded during the run, and a late fire-and-forget `spendGuard.record` can land after the
    restore. The first run's manual subtraction cannot be verified from here. Dev database only, so no effect on prod or
    money; next time stub `spendGuard.record` or `$inc` by the delta.
M5. `services/agency.js:43-47` comment says it is the same test as the pass check; the pass check (`middleware/auth.js:19-28`)
    does not test `subscription.status === 'halted'`. Harmless because a halted subscription sets tier `free`
    (`services/billingPlans.js:184-191`).
M6. `routes/studioVideos.js:241` ignores the `refundTo` result (brief: log and skip). Cannot fail in practice (payer just charged).
M7. `resolvePayer` runs 2-3 times per deduct (`settleWallet`, `spend`, failure path); brief said once. Performance only.
M8. `tests/creditAccessGuard.test.js` regex catches only `credits.balance`/`credits?.balance`/`'credits.balance'`; it misses
    `"credits.balance"`, `credits['balance']`, destructuring, whole-`credits` returns such as `toPublicJSON` (M2), and the
    `controllers`/`utils` folders. Verbatim from the brief; widen when convenient.
M9. `agencyPayerMoney.test.js` concurrency test: the stub's `findOneAndUpdate` checks and writes with no await in between,
    so it is atomic by construction and would not catch every non-atomic implementation.
M10. Frozen clients (implementer concern 2): the money layer ignores `agency.frozen`. Every runtime charge happens in a
    request behind `protect`, which refuses a frozen client's pass; background code only refunds. Acceptable.
M11. `creditGuard.deductCredits` "take what is there" returns success with 0 deducted for an empty pool (concern 4); it has
    no runtime callers (only `ensureCreditCycle` is imported from creditGuard), so no effect.

## Implementer concerns
1. walletBalance 0 for a non-paying agency: agree, correct. 2. Frozen: M10, acceptable. 3. Loss on removal: agree, I2,
must be handled in Task 9. 4. creditGuard empty pool: M11, no callers. 5. Client refund ledger row: agree, needed for
Task 7. 6. Extra `payerId`/`workspaceId` keys: harmless (the agency's own id). 7. Kling queue left unedited: acceptable,
refunds resolve the agency correctly while the client exists and fail safe after. 8. `PAID_TIERS`: correct and needed
(without it the agency's top-ups would be held at each month end until renewal); only `settle` uses it. AiSpendDay: M4.
