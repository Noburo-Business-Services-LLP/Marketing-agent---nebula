# Final fixes, parts A and B (backend)

Branch `nebulaa-redesign`. Full backend suite: 1225 pass, 0 fail (was 1188). Frontend untouched.

Commits: `acb230a` (A-I1, A-M9), `149219b` (money path), `9948dae` (access and deletion), `b52ce26` (renewal guard fix, staff MRR), `d5d830a` (reminder emails, live inbox checks, schedulers, tombstone).

## Part A (money path)

| Finding | Result | What and where | Tests |
|---|---|---|---|
| A-I1 staff Usage 500 | Fixed | `services/staff/usage.js`: `agency` added to the tier list and labels; unknown tiers no longer throw | `finalFixUsage.test.js`; `staffUsage.test.js` expectation updated (5 tiers) |
| A-I2 retry-invoices | Fixed | `routes/payment.js`: only rows with status `paid` (missing status counts as paid) are invoiced | `agencyBilling.test.js` "A-I2" |
| A-I3 first-payment race | Fixed | `applyCharge` no longer expires the plan bucket in a separate step. The old allowance is subtracted inside the same guarded update as the grant, guarded on the `planBalance` and `topupHeld` that were read (a spend in between makes it re-read and retry, up to 4 times). The `$ne paymentId` filter still makes it idempotent. A plain `settle` still runs first for due top-ups. The router has a new `deps.settle` hook for tests | verify + webhook interleaving, two concurrent renewal webhooks, spend-between-read-and-write retry (all with fakes; the interleaving test fails on the old code) |
| A-I4 slot Quarks and top-up expiry | Fixed (controller ruling) | `quarkBuckets.topupGrantUpdate(keepExpiry)` and `topupIsLive`; `billingPlans.buildChargeUpdate` takes the current top-up state. Slot Quarks are still added to the top-up bucket, but `topupExpiresAt` is only set when the bucket is empty or already expired. A bought pack still renews the 60 days | `agencyBilling.test.js` unit and webhook tests |
| A-M3 late charge after cancel | Fixed | Cancelled or completed slots are marked `ended` (new schema field `plan.subscriptions.ended`, already in `542c0c9` which picked it up from the shared `models/User.js`); a later charge is refused as `slot_ended`, recorded for refund, emailed once, and cancelled again at Razorpay. Halted slots are not marked (the customer can resume them) | "A-M3" test |
| A-M4 wrong-amount Agency charge | Fixed, the smaller safe version | A wrong-amount FIRST Agency payment (plan not yet active) is cancelled at Razorpay, on both verify and webhook. A wrong-amount renewal of a running plan is only recorded and alerted (already was), because auto-cancelling a paying customer's plan is harsher than the problem | "A-M4" test both cases |
| A-M6 false cancel alerts | Fixed | `cancelAddonSubscriptions` uses the same "already cancelled" test as `cancel-subscription`; real failures still alert | "A-M6" test both cases |
| A-M7 / B-M1 staff `clientFor` | Fixed | `isCustomer` excludes workspaces (`agency.ownerId`), which covers open, add Quarks, single assign-csm, via `clientFor` and `checkAssignment` | `finalFixAccess.test.js` |
| A-M8 staff MRR with slots | Partly fixed | Online MRR now adds each active slot at the configured price (`services/staff/recurring.js`). Upcoming renewals still list the plan only: slot renewal dates are not stored, so slots cannot be listed without new data. Left for the owner | `finalFixUsage.test.js` |
| A-M9 HERO_LIMITS | Fixed | `agency: Infinity` | `finalFixUsage.test.js` |
| A-M10 / B-M8 credits routes | Fixed | `routes/credits.js`: inside a client both routes return only the pool balance and total used (history `[]`, buckets show the pool as "kept"); a frozen client gets 403 | `agencyPayerCoverage.test.js` (2 tests) |
| A-M2, A-M5 | Deferred as instructed | | |

## Part B (access, isolation, deletion)

| Finding | Result | What and where | Tests |
|---|---|---|---|
| B-I2 double slot release | Fixed | `removeWorkspace` claims the client with one conditional update (sets frozen and `agency.removing`; a stale claim older than 10 minutes can be retaken), so only one request purges and releases. `releaseSlot` only decrements when the count is above 0. A failed or busy removal clears the claim. `syncWorkspacePlans` skips a client that is being removed. Deletion paths (`requestDeletion`, `restoreDeletion`, `purgeOne`/`stepsFor`) count real workspaces (`ownsClients(user, realCount)`), never the stored counter | two concurrent removals, clamp, retry after failure, drifted-count agency fully erased (`agencyDeletion.test.js`) |
| B-I3 staff undo/accept for customer | Fixed | `/api/account` added to `BLOCKED_WHILE_ACTING` (only `GET /api/account/status` allowed); `/api/account/consent` added to the agency pass block list; `staff/clients/:id/open` refuses a pending deletion (`openProblem`) | `finalFixAccess.test.js` |
| B-I4 interrupted purge | Fixed | `runPurgeOnce` claims each request with a conditional update to `running` (new field `runningSince`); `running` records older than 30 minutes are picked up. Two concurrent runs erase once and send one "deleted" email | concurrent runs, stale and fresh running records |
| B-I5 hard-coded Gmail | Fixed | It was a "configured for testing" leftover, not a staff copy, so no env var was added. Reminders now go to the campaign owner's own address only; no email for workspaces (placeholder `.invalid` address), switched-off accounts, pending deletions, or unreadable addresses. Same address removed from `routes/notifications.js` (two more copies of it). Literal address is gone from the source | source test, recipient tests |
| B-I6 one path reader | Fixed | New `services/requestPath.js` (`normalisePath`): pathname only (absolute-form URLs handled), query and fragment dropped, percent-decoded once, lower-cased, duplicate slashes collapsed, trailing slash removed; null (fail closed) when undecodable. Used by `isBlockedWhileActing`, `isBlockedInsideClient`, and the deletion allow-list in `protect` (now `_allowedWhileDeleting`) | all the listed variants for both blocks; `protectDeletion.test.js` rewritten against the function instead of the source text |
| B-M2 pass from inside CSM session | Fixed | `/clients/:id/open` refuses when `req.actingCsm` is set | route handler test |
| B-M3 halted subscription | Fixed | `_agencyPassProblem` now also refuses a halted agency subscription, the same rule as `canPayForClients` (and `protect` now selects `subscription.status`) | test comparing both rules |
| B-M4 inbox stream and sockets | Fixed (small) | New shared `_tokenProblem` in `middleware/auth.js` (pending deletion, CSM assignment, agency pass checks), used by the SSE `streamAuth` and the Socket.IO hub | unit tests for revoked pass, frozen client, ended plan, deleting agency |
| B-M6 schedulers | Fixed | New `services/backgroundGate.js` lists pending-deletion accounts, frozen clients, and clients of an agency whose plan ended, is switched off, or is being deleted; `contentCalendarService.processAutoGeneration`, `snapshotScheduler.collectSnapshots` and `campaignScheduler.processDueCampaigns` add `$nin` to their queries (so skipped accounts cannot starve others). With nothing paused the queries are unchanged; a read failure logs and runs as before. Decision recorded: publishing of already scheduled posts is also skipped for those accounts | gate list, failure case, query shapes of all three, unchanged query when nothing is paused |
| B-M7 tombstone key | Fixed | Tombstones now store the plain hash (as before) and the canonical hash (no +tag, no Gmail dots); the Blueprint "already used" check looks up both. Old tombstones written for an aliased address keep working only for the exact address they stored | `accountDeletion.test.js` |
| B-M5, B-M9, B-M10, B-M11 | Skipped as instructed | | |

## Real-database check (nebulaa_dev only)

A throwaway script (refused any database name other than `nebulaa_dev`; deleted afterwards; its users were removed, 3 of 3 gone) confirmed on real MongoDB:
- two concurrent `removeWorkspace` calls: one ok, one refused, one purge, `clientCount` 2 to 1;
- `releaseSlot` at count 0 stays 0;
- the new schema fields (`agency.removing`, slot `ended`) persist;
- the plan-renewal guard matches an older account whose `planBalance` and `topupHeld` are not stored (Mongoose reads them back as 0) and refuses once they move. The first version of the guard (exact 0) did NOT match such accounts; this was caught by this check and fixed in `b52ce26` (`{ $in: [0, null] }`).

## Notes and concerns

- Behaviour change worth knowing: a plan renewal now REPLACES last month's allowance inside the update; two older tests in `billing.test.js` had asserted that Quarks piled up (an artefact of the real settle being a no-op under fakes) and were corrected.
- `models/User.js` is shared with the frontend agent; the `ended` field went in with their commit `542c0c9`, my `agency.removing` fields in `9948dae`. Their `toPublicJSON` change was not staged by me.
- A-M8 renewals list and B-M7 for tombstones of already-deleted aliased addresses remain gaps (stated above).
- Existing Razorpay behaviour for a halted slot that is later resumed is unchanged (not marked ended).
