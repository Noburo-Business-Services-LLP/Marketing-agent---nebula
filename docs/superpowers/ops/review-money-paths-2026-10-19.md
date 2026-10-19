# Money-path and security review, 2026-10-19

Independent read-only review of the Home drafts, Photoshoot studio, calendar cover retry, competitor avatar and Home
summary cache. Branch `nebulaa-redesign` (reviewed at 915638f, which contains dd87fa0). No code changed, nothing
committed, no provider or database touched. All 14 related unit test files pass (234 tests): calendarCoverManual,
calendarCoverRetry, competitorAvatar, homeDraftsDecency, homeDraftsPrompt, homeDraftsRoutes, homeDraftsService,
homeRoutes, homeSummary, photoshootPacks, photoshootRefsSsrf, photoshootRoutes, photoshootService, photoshootStaleQueued.

Counts: blocker 0, should fix 4, minor 9.

## Should fix

### S1. Photoshoot: a charge that throws is closed as "refused" and never refunded
`backend/services/photoshoot/service.js:300-306`. `spend()` throwing is treated like "no balance": `closeRefused` moves
the row to `refused` (inFlight cleared). `sweepStale` only looks at `queued` rows (`repo.js:61`), so nothing ever checks
the ledger for that row again.
Scenario: `User.findOneAndUpdate` in `quarkBuckets.spend` commits the debit but the driver throws on the reply (a
network blip, a primary step-down, or the Atlas disk ceiling the cluster has already hit). The customer loses the whole
pack price (24 photos at most), sees "Please top up", and no alert is raised.
Home drafts handles the same case (`homeDrafts/service.js:334-339`, `spendThrew` then a ledger check). Fix: copy that
path: on a throw, leave the row `queued` (the stale sweep then settles it from the ledger) or settle it right away with
`ledgerFor(row._id)`; only `closeRefused` when `spend` returned `success: false`.

### S2. Both recovery paths trust a Quark ledger row that is written fire-and-forget
`backend/services/quarkBuckets.js:51-53, 99`. `spend()` debits the wallet atomically, then calls `record(...)` without
awaiting it, and a failed insert is only a `console.warn`. Two recovery paths decide "was this charged?" only from that row:
- Home drafts, a stale row with `chargedConfirmed: false` (`homeDrafts/service.js:148-153`): no spend row means no refund.
- Photoshoot `sweepStale` (`photoshoot/service.js:539-544`): no spend row means the job is closed with a 0 refund.
Scenario: the process dies between the debit and marking the row (the case these paths exist for), and the ledger insert
also failed or was still in memory. The wallet is debited, the row is closed as refunded-nothing, money is lost silently.
Fix: write a proof of the charge inside the same atomic update: add `ref` to the `credits.history` entry built in
`spendPipeline` (it is already pushed in the same `findOneAndUpdate`), and have the recovery paths look for
`credits.history.ref` on the payer when the ledger row is missing. Or await `record()` in `spend()` and alert on failure.

### S3. Home drafts: a lost request is only recovered when the same account asks for another draft
`backend/services/homeDrafts/service.js:184-191, 296`. `recoverStale(userId)` runs only at the start of `make()` for that
user. There is no loop (Photoshoot has `startPhotoshootResume`; nothing similar is started for `HomeDraft`, checked with a
grep of server-main.js and services). The row has a 30-day TTL (`models/HomeDraft.js:39`).
Scenario: the server restarts mid-draft after the charge. The customer gave up and never presses the button again. The
row stays `inFlight`, the Quarks are never returned, and after 30 days the TTL deletes the only record of it.
Fix: a small periodic sweep (like `startPhotoshootResume`) that finds `inFlight: true` rows with an old `leaseAt` across
all accounts and runs the same `finish(..., refund: true)`. Also run it at server start.

### S4. A refund that fails is never retried, while the customer is told it is on its way
Home drafts `service.js:165-169` then `finish` (`:178`) clears `inFlight`, so the row is never looked at again.
Photoshoot `service.js:486-489` and `:547-550` set `refundFailed` and stop. No code reads `refundFailed` (grep: only the
models, the two services and `repo.setRefundFailed`). The customer sees "We are returning your Quarks; this can take a
little while" (`photoshoot/service.js:134`, `MESSAGES.refundLate`).
Scenario: `refundTo` hits a transient DB error. Only an ops alert is raised; nobody has a list or a button to finish it.
Fix: a retry sweep for `refundFailed: true` rows (claim with `{refundFailed: true}` then `$unset` it before `refundTo`,
check the ledger for an existing `refund` row with that ref first to avoid a double refund), or at minimum a staff list
of these rows and a runbook step in the two ops docs.

## Minor

M1. Photoshoot: possible double refund if a charge is slow. `startJob` (`service.js:311-317`) refunds and then calls
`closeLedger` (`repo.js:30`), which sets `refunded: true` without claiming it. If `sweepStale` (rows queued over 3
minutes) has already closed the row and refunded it from the ledger, `markCharged` fails and `startJob` refunds a second
time. This needs `settle`+`spend` to take over 3 minutes, so the window is small. Fix: claim first
(`findOneAndUpdate({_id, refunded: {$ne: true}}, {$set: {refunded: true}})`) and refund only if the claim won.

M2. Calendar auto retry can run next to a manual render. `contentCalendarService.js:778-786`: the claim filter checks
`coverStatus` and `lastCoverRetryAt` but not that `lastCoverAttemptAt` is still old. A manual "Make a cover" that has just
claimed `pending` leaves `lastCoverRetryAt` as it was, so a page load holding the old document wins the auto claim too, and
two renders run. Limited to 1 a day and 3 in all. Fix: add
`$or: [{lastCoverAttemptAt: null}, {lastCoverAttemptAt: {$lt: new Date(t - COVER_STALE_PENDING_MS)}}]` to the claim.

M3. Calendar cover spend is under-counted. `runAndCount` (`:689`) records the image only when a URL comes back.
`generateCalendarCover` returns `''`/`null` when the image call failed, when it returned a data URI (provider paid,
`coverStatus: failed`), or when it threw after the text call. The daily AI ceiling misses those calls, and a data-URI
result is retried and paid again. Fix: have the generator report which paid calls ran, and record those.

M4. Manual cover: the per-account daily cap of 3 (`:716`) is read and then the claim is made on one calendar only. Parallel
requests on different months can go past 3. Bounded by the number of months. Fix: an atomic per-account counter.

M5. Photoshoot upload (`service.js:616-633`) does not check `ENABLE_PHOTOSHOOT` or the entitlement. Free accounts, and
anyone while the feature is off, can store 20 x 6 MB an hour in Cloudinary as new products. Fix: the same `precheck`
gates (switch, entitlement), or at least the entitlement.

M6. Home summary cache staleness (`routes/home.js:21-33`). It is only cleared by a request with `req.user`. A Razorpay
webhook credit, a Photoshoot refund from the runner, a draft refund from a sweep, and an agency client's spend (the
owner's pool numbers are keyed by the owner) do not clear it. The balance can be up to 60 s stale. No cross-account leak.
Fix: call `router.cache.invalidate(payerId)` from `quarkBuckets` spend/refund/credit, or accept 60 s and say so in the doc.

M7. Idempotency keys are not tied to the request. Home drafts `replayOf` (`service.js:126-136`) returns the stored row
for the key whatever the `kind` or `ref` now are, so a reused key on "witty comment" returns an earlier post. Photoshoot
returns a pack job for a redo key and the other way round. No money impact. Fix: when the stored `kind`/`ref` (or
`kind`/`parent`) differ, answer 409.

M8. Global caps are counted and then inserted (`homeDrafts/service.js:193-207` all-accounts per day,
`photoshoot/service.js:206-216` running at once). Parallel requests from many accounts can overshoot by the number of
server processes times the burst. The spend ceiling still applies. Accept, or note it in the docs.

M9. Doc drift: `docs/superpowers/ops/home-drafts.md` step 2 says a request is lost "after 4 minutes"; `STALE_MS` in
`config/homeDrafts.js` is `WORST_CASE_MS + 3 min` = about 8.3 minutes.

## Checked and found sound

Home drafts
- Prices come only from `QUARK_COSTS.home_response_post` / `home_witty_comment` (`apiCosts.js:364-365`), via `homeDraft()`.
- Order: switch (default off), staff refused unless on a pass, entitlement (`canUse(user, 'competitors')`: free gets
  `upgrade`; the agency tier gets the bundle), strict input (`KEY_RE`, `REF_RE`), lock, idempotency, caps, spend guard
  (fails open only on a throw), post lookup, ledger row, intent, charge, mark, calls.
- Ownership: `ref` is parsed with a fixed regex; the competitor must be in the caller's own `competitorsQuery` result and
  `c.userId === userId`; snapshots are filtered by userId and competitorId again. Agency/CSM: `req.user` is the client.
- One request per account: in-process `Set` plus the unique partial index `one_in_flight_per_account`; a duplicate key
  hits the `{userId, key}` unique index and replays.
- Every model call is counted on the row before it is made; at most 2 writes and 2 checks; `noFallback: true`, so no
  second paid provider.
- Refund once: `refunded` flips via a conditional `findOneAndUpdate` before `refundTo`; `delivered` needs
  `inFlight: true, refunded: false`, so a row closed by another process is never shown and never charged twice.
- Fail closed: a check reply in any other shape, a throw, or `decent: true` with reasons all mean no draft and a refund.
- Prompt injection: the competitor caption never reaches either prompt; only words the customer's own profile also
  contains (at least 4 letters, decent, not a competitor name) survive as topic words; every brand fact is stripped of
  links, @names, #tags, digits and markup; DATA/TEXT markers are explained as data; `<<`/`>>` are stripped from check input.
- The draft can never contain a competitor name/handle (local `name` rule on folded forms) or 4 words of the caption.
- No posting: the service has no social or publishing import, and a test reads the files to keep it so.

Photoshoot
- Price: `photoshoot_image` = medium picture + 3 reference inputs (an estimate, flagged) + storage; the generator reads
  the same `PHOTOSHOOT_QUALITY` and `PHOTOSHOOT_MAX_REFERENCES`. Pack = per photo x photo count, computed on the server.
- The balance is checked and debited in one pipeline update with `credits.balance >= amount` (and the agency payer filter
  and frozen check for a client), so parallel charges cannot overdraw.
- Refunds: `repo.finalize` claims `refunded: false -> true` only once all photos are terminal; the amount is
  `min(quarks, failed x perPhoto)` (all of it when none was made), to the recorded `payerId`. An unpaid row
  (`markCharged` never ran) is never `running`, so it is never refunded by `finalize`.
- Runner: the lease is a conditional update; `startPhoto` needs the lease and `pending`; `finishPhoto` needs `calling`;
  `releaseCalling` keeps the 2-calls-per-photo limit across takeovers; 10-minute lease against at most 2 photos per batch
  (image call 120 s, references 3 x 20 s); `MAX_AGE_MS` closes old jobs and refunds them.
- Caps: one job in flight per account (unique partial index), 3 starts a minute, 60 photos a day (charged rows), 24 a job,
  3 products.
- Uploads: data-URL only, size checked before decoding and after, the type is read from the bytes, re-encoded under the
  sniffed type; 40 MB body limit applies only to `/api/photoshoot/upload`.
- Reference loading (`refs.js`): https on 443 only, no IP literals or local names, every hop resolved and checked against
  private ranges, checked again at connect (`safeLookup`, DNS rebinding), at most 2 redirects, 20 s overall, running byte
  cap, image types only, bytes sniffed.
- Cross-account: every read and `setInLibrary` filters by `user`; `get` only resumes the caller's own job; `jobView` never
  shows the prompt, payer or lease.
- Free plan gated (`canUse` returns `upgrade` for free); agency client workspaces pay from the pool; staff refused unless
  on a pass; `ENABLE_PHOTOSHOOT` checked on create/redo and before every batch (a staff switch stops the rest and refunds).

Calendar cover retry
- The claim is one conditional update (status, retries under 3, last retry over 24 h); only this month and next; 10-minute
  wait after an attempt; spend guard checked first; free to the customer; repeated page loads start at most 1 render a day
  per month and 3 in all (`healCovers` max 1 per request).

Competitor avatar
- Allow-list `cdninstagram.com` / `fbcdn.net` on every hop, https/443, no IP literal or credentials, all resolved addresses
  public and checked again at connect, at most 2 redirects, 5 s overall, 200 KB running cap, image types only, `sharp`
  with `limitInputPixels` 4096x4096 and `failOn: 'error'`, re-encoded to 96x96 WebP.
- Storage key is the competitor id stripped to `[A-Za-z0-9_-]` (no traversal); only links matching our own avatar URL
  pattern are returned or deleted; removed with the competitor (`cleanup.js`, `dropAvatar`) and on a lost race; the
  account erase finds `nebula-competitor-avatars/...` through the `nebula*` folder pattern on the `Competitor` records.

Home summary
- Cache key `<accountId>:<pass 0|1>`, so an owner view and a pass view never share an entry, and accounts never share one;
  `invalidate` clears both looks; only complete answers are cached; `private, no-store`; the watcher is mounted before every
  `/api` route except the rate limiter and the webhook raw-body parser, and reads `req.user` at `finish`.

## Fixes (2026-10-19)

Each fix was written test first (the new test failed, then passed). Backend unit tests: 2373 pass, 0 fail
(`node --test tests/*.test.js`). Frontend not touched. Real database (nebulaa_dev only, fake models, cleanup removed every
row it made and took its estimated spend off the AI spend record again): `home-drafts-check.js` 33 PASS 0 FAIL (130 rows
removed, 0 left, USD 0.99 taken off), `photoshoot-check.js` 32 PASS 0 FAIL (83 rows removed, 0 left, USD 6.03 taken off),
`calendar-cover-check.js` 14 PASS 0 FAIL (28 rows removed, 0 left).

| Finding | State | Commit | What changed |
|---|---|---|---|
| S1 | fixed | 7e1c667 | A thrown charge is never `refused`: the charge proof decides at once (a proven charge is closed `ledger` and refunded once through the `closeStale` claim); with no proof, or a failed lookup, the row stays `queued` and the stale sweep decides 3 minutes later. |
| S2 | fixed | 2f1ba06, a88cb6d, 7e1c667 | `spend` puts `ref` in the `credits.history` entry of the same atomic update; `refundTo` pushes a history entry with `ref` in its own update. `quarkBuckets.chargeProof(ref)` reads the ledger first, else that history (account, recorded payer, current payer). Both recovery paths (Home drafts `chargedConfirmed: false`, Photoshoot `sweepStale`) use it by default. Test for a ledger write that fails after the debit: `tests/quarkChargeProof.test.js` and both real-database scripts. All other `spend`/`refundTo`/`deductCredits` callers and tests pass unchanged. |
| S3 | fixed | a88cb6d | `services/homeDrafts/index.js` `startHomeDraftsSweep` (45 s after start, then every 2 min; `ENABLE_HOME_DRAFTS_SWEEP=off`), started in `server-main.js`. One server at a time (OpsState lease `home_drafts_sweep_lease`), 20 rows per run, the same `refunded` claim, so never a double refund. |
| S4 | fixed | a88cb6d, 7e1c667 | Both sweeps retry `refundFailed` rows: claim first (one conditional update moves `refundRetryAt` forward and counts `refundAttempts`), read the proof (a refund that landed is only marked), then refund; back-off 2/4/8/16 min, at most 5 tries, then `refundGaveUp` and an alert email; runbook steps in `home-drafts.md` and `photoshoot.md`. |
| M1 | fixed | 7e1c667 | `repo.closeLedger` claims `refunded` (queued and not refunded) before the refund; a lost claim refunds nothing. |
| M2 | fixed | 4eca9f5 | The automatic claim also requires `lastCoverAttemptAt` to be null or older than 10 minutes. |
| M3 | skipped | | Needs `generateCalendarCover` to report which paid calls ran (a change to the generator's contract and its callers), not cheap; the covers are free to the customer and capped at 1 a day per month and 3 in all, so the under-count is small. Left open. |
| M4 | skipped | | Needs a new per-account counter document; the overshoot is bounded by the number of months an account has. Left open. |
| M5 | fixed | 7e1c667 | Upload checks the plan (`upgrade`, 403) and `ENABLE_PHOTOSHOOT` (503) before anything is stored. |
| M6 | fixed | 2f1ba06 | One cache per process (`homeSummaryCache.sharedCache()`); `spend`, `refundTo` and the Razorpay credit clear the payer's (and the client's) entry. Other processes can still be up to 60 s stale (noted in `home-summary.md`). |
| M7 | fixed | a88cb6d, 7e1c667 | A reused key for another kind or post (Home drafts) or another request type or photo (Photoshoot) gets 409 "already used". |
| M8 | accepted | a88cb6d, 7e1c667 | Noted in `home-drafts.md` and `photoshoot.md`: the global caps can be passed by a few in a burst across processes; the spend ceiling still applies. |
| M9 | fixed | a88cb6d | The doc now says about 8.3 minutes (`STALE_MS` = worst case 5 min 20 s + 3 min, which is the design: longer than any live request). |

Open notes: the history proof only covers the payer's last 100 history entries (an account with more than 100 balance
changes between the charge and the sweep, a few minutes, would fall back to the ledger row only). `QuarkLedger` has no
index on `ref`, so each proof lookup scans the ledger (as the old lookup did); worth a script-built index later given
the disk ceiling. New small partial indexes on `home_drafts` and `photoshoot_jobs` are built by the app at start.
