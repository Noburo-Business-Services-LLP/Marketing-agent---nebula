# Money review: Photoshoot on worker consumers (E9 stage B step 2)

Date: 2026-10-20. Reviewer: an independent read-only reviewer (not the author). Subject: commits `c0db429`, `c87b3d2`,
`c4d5c25`, `5092d67`, `c8ff126` on `nebulaa-redesign`, switch `ENABLE_PHOTOSHOOT_CONSUMER` (default off).
Method: I read the impact map (Stage B step 2), D73 to D98, the runbook section, and every changed file. I diffed
`service.js`/`repo.js` against `7867b59` and read `3a281f2` (the production image) for the old-image paths. I ran the unit
tests (38/38 consumer and drain, 101/101 across the five Photoshoot money files) and ran 21 one-line mutations on a
TEMPORARY COPY under the scratchpad (never the repo). No database, provider or network was used. Line numbers are those of HEAD `c8ff126`.

Counts: **BLOCKER 0, SHOULD FIX 6, MINOR 7.**

Verdict: the claim/lease/close design holds up. Every consumer close claims its refund in one conditional write, proof
first, and never pays above the proven charge. A lost run cannot start a paid call or record a photo. Old and new settle
sweeps share one claim field. I found no likely interleaving that mints or loses Quarks. The switch can be turned on once
S1 and S2 are fixed (both small), S5 is decided by the owner, and the S6 tests are added. S3 is older than B2 (the
in-process path has it too) and should be fixed in the same pass. S4 is a docs fix.

---

## SHOULD FIX

### S1. The consumer close stamps `finishedAt` before the proof read: the settle sweep can pay a second time
`backend/services/photoshoot/service.js:665` takes `now` at the start of `consumerClose`. The close then does
`failOpenWhere`, `findById` and `ledgerFor` (chargeProof: two ledger queries, `resolvePayer` and a `User.find`, all with
no `maxTimeMS`). The close write at `:686` stores `finishedAt: now`, the time from before all of that.
`sweepUnsettled` (`:892`, filter `finishedAt < now - SETTLE_AFTER_MS` = 2 min) treats a row as "crashed after the claim"
as soon as `finishedAt` is 2 minutes old.
- Scenario: a run closes job J (8 photos, 3 failed, 30 Quarks due) while the database is slow, and the proof read takes
  2.5 min. `closeWhere` lands with a `finishedAt` already 2.5 min old. Before this caller's `refundTo` (`:691`) lands, the
  resume loop on another task (every 2 min), or any create's `resumeLost()`, runs `claimSettle`. Its `settleRefund` reads
  the proof (no refund yet) and pays 30. Then the first `refundTo` lands: **+30 Quarks minted.**
- The in-process `finalize` does not have this: it stamps `deps.now()` at the close write. So this is a B2 regression of
  the D17 guard. It needs a slow database, but the cluster has hit its write-blocking disk limit before.
- Fix: take `finishedAt: deps.now()` at the `closeWhere` call (after the proof read). Optionally also give `ledgerFor` a
  `maxTimeMS`. Test: a proof read that advances the fake clock by 3 min, a settle sweep run between the close and the
  refund, one refund in total.

### S2. Unknown write outcome: the photo file is deleted, but the late write can still land and record a dead link
`service.js:717-731` (`makePhotoClaimed`, success branch). `finishPhotoOwned` throws. The code re-reads the row, sees no
url, sets `kept = false` and calls `deleteImage(url)`. A write that timed out on the client can still be applied on the
server after the read: a slow primary, or a failover with a retried write.
- Scenario: photo 3 of job J is made. Its `done` write times out, the read-back shows `calling`, the file is deleted and
  the run marks itself lost. Then the write is applied: photo 3 is `done` with the deleted link. The next run sees it as
  finished and the job closes `done` with no refund. **The customer pays 10 Quarks for a broken image.**
- Fix: delete only on a definite `false` (the condition did not match). On a throw, keep the file whatever the read-back
  says (the orphan costs storage only) and stop the run. The impact map's own rule ("cannot tell = keep the file") should
  cover this case too. No test covers a throwing `finishPhotoOwned` today (see S6, mutation M22).

### S3. A charge slower than 3 minutes is lost, never refunded (older than B2, inherited)
`service.js:398-399` (`queueForWorker`), `:861-871` (`sweepStale`), `repo.js:92-95` (`closeStale`).
- Scenario: the job row is written at T0 (`createdAt` = the start of `create`, `:464`). `settle` plus `spend` stall past
  T0+3 min. `sweepStale` reads the proof (no spend yet) and closes the row `failed` with `refunded: true` and
  `refundedQuarks: 0`. The spend then lands (40 Quarks). `queueCharged` matches nothing (the row is not `queued`), and
  `closeLedger` matches nothing either. The customer is told "they come back by themselves". **Nothing ever refunds the
  40 Quarks**: `sweepUnsettled` needs `refundedQuarks > 0`.
- The in-process `markCharged` failure path has the same hole, so this is not new. On the consumer path the request does
  a little more work after `now` is taken (`resumeLost()` at `:467` now also runs the two consumer sweeps).
- Fix: when `closeLedger` returns null, re-read the row. If it was closed by the stale sweep with `refundedQuarks: 0`, set
  `refundedQuarks = cost` and leave `refundSettledAt` unset, conditional on `refundedQuarks: 0` (one atomic update). The
  existing settle sweep then pays it once with proof. Also stamp the stale window from the moment of the charge attempt,
  not from `create` start.

### S4. Old image on consumer rows: a full refund for a job whose photos were already delivered. The docs call this "customer-favourable"
D90 and impact map B2.8 say an older image "closes a waiting row through its own stale sweep ... with the proven refund
(customer-favourable)". In `3a281f2`, `staleQueued` is `{ status: 'queued', createdAt < 3 min ago }` with no `chargedAt`
filter, and `sweepStale` refunds `led.spend.quarks` in full.
- Scenario (rollback without the drain, or a pre-B2 task alive during a deploy that already has the switch on): job J
  (8 photos, 80 Quarks) has 5 photos done when its worker's lease is lost. `requeueLost` puts it back to `queued` (or
  SIGTERM hands it back). The old task's sweep closes it `failed` and refunds 80. The 5 finished photos stay visible on
  the job page (`jobView` shows `done` photos with links). **That is 50 Quarks of photos given away.** The old resume
  loop (`lostJobs` and `get` without the `via` filter) also runs `running` consumer rows in-process once their 60 s lease
  has run out.
- Neither of these can double-charge, and the drain rule prevents both. But the docs say "money-safe" and leave out the
  over-refund. Fix: correct D90 and B2.8, and the runbook sentence "depending on how old it is it refunds them". Say that a
  re-queued or handed-back row is refunded in full even when photos were made, and that an old resume loop takes over
  running consumer rows. Keep the drain mandatory, and add "never deploy the release with the switch already on" to the
  turn-on steps.

### S5. Daily AI ceiling: already-charged jobs, including the one that crossed the ceiling, wait 30 min and are then refunded
`photoshootConsumer.js:108-121`, `spendGuard.js:73` (`c.total >= limit`). `quarkBuckets.spend` records the job's units at
the charge.
- Scenario: the ceiling is 1000 units and 996 are used. Customer A's 8-photo job is charged, the total becomes 1004, and
  the job waits. Every consumer now holds claims. A sees "making" for 30 min, then gets a full refund with no photos. The
  in-process path runs the same job (`runJob` comment at `:632-633`: "the daily ceiling does not stop a charged job").
  The units counted at the charge are never taken back, so the ceiling stays tripped for every other held job.
- No money is lost, but this is a customer-visible behaviour change and the ceiling ends up over-counted. Fix (owner
  decides; D95 chose to hold): either let rows that are already charged run (parity with the in-process path, and their
  cost is already counted), or close held rows at once with the refund instead of after 30 minutes.

### S6. Tests do not pin several guards the docs rely on (mutation results)
Each mutation below was applied to a temporary copy, and the five Photoshoot money test files still passed:
- M12: the lease-sweep condition without `leaseUntil` (`service.js:805`). The race between a sweep and a heartbeat
  renewal is untested. Without the guard, a live run is re-queued and its photo in flight is paid for twice by us.
- M22: the unknown-outcome read-back (`:725`), see S2. M2: the "refund already exists" leg of `consumerClose` (`:684`).
- M16: `retryRefunds` consumer branch replaced by the old one (`:941`). The `unproven`/`over` → person path in the retry
  loop is untested.
- M11: `closeWaiting` without `queuedAt` (`:827`). M7: claim-after-SIGTERM hand-back removed (`photoshootConsumer.js:156`).
  The test passes anyway because `runClaimed` stops at round 0. Assert `releases` stays 0.
- M20: the fake `lostJobs` without `via != consumer`. The test passes because the lease sweep re-queues first. Add a
  switch-off `resumeLost()` (no `fromLoop`) case where a running consumer row has an expired lease.
- M3, M4, M23 (`gate.check`, `holdsClaim`, the heartbeat marking a run lost) are defence in depth behind the conditional
  `startPhotoOwned`, so surviving is acceptable. A short test for each would still stop silent removal.
Mutations killed (the tests are good there): M1 (proven cap), M5 (lost-reply read-back), M8 (orphan delete), M9 (consumer
settle via settleRefund), M10 (per-account re-count), M13 (re-call spend record), M15 (release limit), M17 (spend hold),
M18 (waiting rows in the all-accounts cap), M19 (hard ceiling).
The fake repo copies the rules instead of running them: the real Mongo filters are checked only by the dev check script.
Two equivalences were confirmed by hand: `refunded: false` matches because of the schema default, and
`chargedAt: null` matches a missing field.

---

## MINOR

- M-a `agencyWorkspaces.js:114`: the third clause (`refundedQuarks > 0, refundSettledAt: null`) also matches rows that
  were given up or set aside for a person (`refundNeedsPerson`), even though the second clause leaves them out on
  purpose. Such a client can never be removed until a person sets `refundSettledAt`, and no runbook step says so. Add
  `refundGaveUp: { $ne: true }` to clause 3, or document the hand step.
- M-b `repo.js:148-150` `startPhotoOwned` does not check `attempts < MAX_CALLS_PER_PHOTO`. With an old in-process runner
  in the mix, its owner-blind `finishPhoto` can set a photo back to `pending` after a consumer already made the second
  call, which allows a third call (our cost only). Add `attempts: { $lt: max }` to the `$elemMatch`.
- M-c `service.js:390-399`: when the queue write fails AND the read-back also fails, the answer is the 503 "if any Quarks
  were taken they come back", but the job is then made and charged. Money is safe. The message is wrong, which invites a
  support ticket.
- M-d `handBack` decrements `runs` (`repo.js:136`), so a `{ leaseOwner, runs }` pair can repeat if one worker re-claims a
  job it handed back. That is safe today: cap hand-backs never started a run, and SIGTERM ends the process. A random
  claim token per claim would make it safe for good.
- M-e `routes/metrics.js`: `photoshoot().metrics()` is not wrapped in try/catch, so a failure there now takes down the
  whole staff queue endpoint, which is also the drain gauge. Wrap it like a best-effort section.
- M-f `create`/`redo` run `resumeLost()` inside the customer's request (`:467`, `:513`). With the switch on, that now
  includes up to 25 + 25 + 10 consumer closes, with proof reads and refunds, and no scheduler lease. It is safe
  (conditional writes) but adds latency under a backlog. Consider running only `sweepStale` in the request.
- M-g `ENABLE_PHOTOSHOOT_RESUME=off` also turns off the consumer sweeps when the consumer switch is off. Leftover rows
  are then closed only when the customer opens the job. The runbook should say so.

---

## Checked and found sound

1. Charge to queue: `queueCharged` matches only `queued, via consumer, chargedAt null`, and `closeLedger` matches only
   `chargedAt null`. An accepted job can never be refunded by the request, and a failed queue write is refunded once,
   after the claim (M1 rule). Lost reply: the read-back answers 202 with no refund (D83 class not repeated). A queue
   write still in flight against `closeLedger`: both are conditional on the same fields, so exactly one wins. A double
   click with the same key is a replay. Different keys hit the unique `one_in_flight_per_account` index and get 409.
2. `consumerClose`: unreadable proof leaves the row open, then the next run or sweep closes it (verified for the run,
   the cap, the hard ceiling, the queued timeout and the over-limit SIGTERM close). Amount = min(wanted, proven). It is 0
   with no proof (with an alert) or when a refund exists. One write closes the job and claims the refund
   (`refunded: false` plus the claim). The closes for the run, the cap sweep, the hard ceiling, the queued timeout and
   SIGTERM cannot both pay. A photo still in flight is failed first, and its late result cannot be recorded (status no
   longer `running`), so it is deleted.
3. `runClaimed`: every start, result, heartbeat and close is conditional on `{ status, leaseOwner, runs }`. A run that
   lost its claim cannot start a paid call (`startPhotoOwned` is conditional) and cannot record a photo. `pending` is set
   only when calls are left (`releaseCallingOwned`, `again`), so no third call happens with B2 code only. Re-calls are
   recorded in the spend guard (M13 killed).
4. Sweeps: the re-queue and the cap close are conditional on the `leaseUntil` that was read (a heartbeat in between wins).
   Two sweeps at once: one wins on `refunded: false`. A sweep against a late completion: one close wins, and the
   loser's photo is deleted. The queued timeout is conditional on `status queued` plus `queuedAt`, so it never touches a
   claimed run.
5. Settle and retry: consumer rows are decided by `settleRefund` (proof, never above it, payer recorded). Old and new
   images claim through the same `refundSettlingAt` field. The old image pays `min(recorded, proof)`, and the recorded
   amount was already capped by the proof at the close, so mixed versions never pay above the charge. A crash between
   the claim and the payment is paid once by the settle sweep.
6. Consumer: `_claimFair` re-counts per account across all workers after each claim (the D74/D76 class did not
   return). A claim that resolves after SIGTERM is handed back. `_release` re-reads the row and hands back only its own
   claim. A shutdown release and the run's own release cannot both act (`run.lost`, conditional `handBack`). At 3
   releases the job is closed with the per-photo refund, once.
7. `capsProblem` counts waiting rows while the switch is on (with no double count against `runningAll`, which needs
   `running`). `get()` never schedules a consumer row in-process, and it closes an overdue waiting row once.
8. Cross-account: every read is `findOwn(user, id)`. The refund goes to `led.spend.payer` (the agency pool for a client)
   with `ref = job id`. Refs are job ids, so the same idempotency key used for another request type cannot collide.
   `runningWork` is keyed on the workspace id, which is the job's `user`.
9. Switch OFF compared with `7867b59`, every behavioural difference:
   (a) `closeRefused`/`closeLedger`/`closeStale`/`staleQueued` now also require `chargedAt: null`. No effect, because an
   in-process queued row never has a charge recorded.
   (b) `lostJobs` now requires `via != consumer`. No effect.
   (c) The resume loop (`fromLoop`) also runs `sweepConsumerQueued` and `sweepConsumerLeases`: three extra indexed
   queries every 2 minutes, which match nothing.
   (d) `sweepUnsettled`/`retryRefunds`/`get` branch only on `via: 'consumer'`. The in-process code is the same,
   statement for statement.
   (e) Agency client removal now waits for in-process photoshoots and their unsettled refunds (intended, D96; see M-a).
   (f) The staff metrics endpoint and the CloudWatch emitter include a `photoshoot` section (see M-e).
   (g) The SIGTERM helper also calls the Photoshoot consumer's shutdown, which returns `skipped` when it never started.
   (h) A new partial index, `consumer_waiting`, is built on deploy.
   Nothing else changes on the request or money paths.
10. Runbook: the turn-on order (release with the switch off, then the worker, then the web service) and the mandatory
    drain before rollback (web off, wait until `queueDepth` and `running` are 0, then the worker, then the image) are
    correct. The drain script is a dry run by default, refuses a URI without a database name, and closes only waiting
    rows, through the same proof-first close. The only docs gap is the honesty point in S4.
