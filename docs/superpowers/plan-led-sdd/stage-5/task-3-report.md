# Task 3 report: weekly scorer (fake model, caps, lease, spend guard)

Files: `backend/services/listening/scorer.js`, `backend/services/listening/erase.js` (stub), `backend/services/competitors/lease.js` (key option), `backend/models/User.js` (`listeningFailures`), `backend/tests/listeningScorer.test.js` (28 tests). Backend: 1657 pass, 0 fail (1629 + 28); every file exits on its own.

## Exports later tasks need
- `scoreAccount({ user, now, deps, force = false }) -> { scored, attempted, batches, skipped?, stopped? }`. `skipped` = nothing sent (`no_model`, `not_due`, `paused`, `too_few`, `account_cap`, `batch_cap`, `spend`, `ledger`, `error`); `stopped` = ended early after some batches (`batch_cap`, `spend`, `ledger`). Never throws.
- `runScorerOnce({ deps, now, accountIds, force, limit }) -> { accounts, scored, busy?, disabled? }` (`accounts` = accounts that had at least one batch). Never throws.
- `defaultDeps({ User? })`; `erase.sweepOrphans({ now }) -> 0` stub for Task 7 (`services/listening/erase.js`).
- `createLease({ key, store, ttlMs, holder })` and `opsStateStore(Model, keyOrOptions)` now take a key (string or `{ key }`); default key unchanged. Scorer lease key `listening_scorer_lease`.
- Deps: `caps, env, memory, ledger, store, lease, callText, spend, gate, erase, alert, sleep, accounts, items, markRun`. Default `items({userId,since,types,limit})` newest first, `markRun(user,{at,failures})`, `alert({key,subject,text})` (opsAlerts.notify, 24 h cooldown).

## How it works
- Ledger: per batch the order is `countBatchesToday` cap, `spend.check('listening_score')`, `ledger.record` (database row + process memory), model call, `spend.record('listening_score',1)`, `parseReply`, `saveScores`. A throwing model, spend record or save is caught; the batch stays recorded and its items are dropped by `ledger.attempted` (7 days) on later passes, so no repeat paid call (tests j, k, l).
- Caps count ledger attempts: items per run (400), items per account per day (400 minus `countItemsUserToday`), batches per UTC day all accounts (300). Reaching the global cap or a spend refusal ends the whole pass.
- Lease: claimed at pass start (after the switch check, so a disabled pass never touches it), renewed per account, released in `finally`; a store failure means no pass. An in-process `running` flag is a second guard. Tested with the real `createLease` + `opsStateStore` on a fake Model (second claimant null, expired lease taken).
- Rotation: default `accounts` pages ALL non-free accounts by `_id` (500 a page, no cut-off), sorted never-scored first then oldest `listeningRunAt`; `eligibleAccount` filters; accounts stamped within `RUN_EVERY_DAYS` are skipped without a query; the 60-account limit counts only accounts that sent a batch. 1 s pause after an account that made calls.
- Failures: a run where every batch failed (model threw, reply unusable, or save threw) adds 1 to `user.listeningFailures` plus an in-process mirror (survives a failed `markRun`); any success resets it. At `FAIL_PAUSE_AFTER` (3) the account is `paused` until an eligible item NEWER than the last run arrives AND a later UTC day than the last run (this combines the brief's "new item" with the request's "until the next day"). One alert per account per day in process, 24 h cooldown in opsAlerts; alert text carries only the account id.
- After each account with a batch: `store.rebuildWeeks`, `markRun`.
- Logs: only counts and error names/codes; never `e.message` (a model error can echo text), never comment text or reply (test t).

## Deviations
- Default gate is the strict `blockedAccountIds()` (throws on failure, so the pass is skipped) rather than `blockedAccountIdsSafe()`, which returns [] on failure and would score pending-deletion or frozen accounts during a database fault.
- `user.listeningFailures` Number field added to `models/User.js` (as briefed).
- Private messages (`dm`, `message`) ARE sent to the model, as the spec says (scored for counts, never quoted); no names, handles or ids go in the prompt (`buildPrompt` sends body only).
- `items` query is one page of `MAX_ITEMS_PER_RUN * 2` newest items, as briefed: if the newest 800 were all already scored or attempted, older unscored items wait for next week.
- MIN_ITEMS counts scores in the last 28 days plus fresh items in the last 28 days.

## Only fakes verified
Everything: the real `callTextLLM`, `spendGuard`, `opsAlerts`, `backgroundGate`, `SocialInboxMessage` query, `User` paging and `markRun` were never run (default deps only unit-tested for paging with a fake User model). Task 8 must exercise them on nebulaa_dev. `callTextLLM` falls back to Gemini on an OpenAI failure with a different (backup) model, so one failing batch can cost a second paid call that `spend.record` counts as one batch; consider a model-pinned call before enabling.
