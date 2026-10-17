# Task 1 report: config, models, entitlement helper, ledger

Built: `backend/config/listening.js` (all Global Constraints constants incl. a mild `ABUSE_WORDS` list; no model name), models `ListeningScore` (listening_scores), `ListeningWeekly` (listening_weekly), `ListeningBatchLog` (listening_batch_log, 14-day TTL), `services/listening/{entitlement,ledger,store}.js`, `User.listeningRunAt`.

Names later tasks need:
- `eligibleAccount(user, { blocked })` where `blocked` is a Set of string ids.
- `createBatchLedger({Model})` / `sharedBatchLedger()`: `record({userId,itemIds,at,source})`, `countBatchesToday(at)`, `countItemsUserToday(userId,at)`, `attempted(userId,itemIds,at) -> Set<string>`, `lastRunAt(userId)`; also exports `dayOf`.
- `listeningStore({Score,Weekly})`: `saveScores(userId, rows)` (rows: inboxItemId, platform, kind, label, reason, itemAt, scoredAt, modelVersion; `$setOnInsert` only, duplicate-key errors swallowed), `scoredIds`, `scoresSince`, `rebuildWeeks(userId, now)` (weeks with no scores left are deleted, older than KEEP_WEEKS ignored/deleted), `weeks(userId, n)` newest first.
- spendGuard provider/label `listening_score` / 'Comment scoring'; `ACTION_USD.listening_score` (about 0.036 USD per batch), `QUARK_COSTS.listening_score = 0`, unit label 'per batch of comments'.
- Registry rules added now for ListeningBatchLog, ListeningScore, ListeningWeekly (delete, field userId).

Deviations:
- Rates: could not confirm the chosen small model's pricing; `listening_input_per_mtok` 5.00 and `listening_output_per_mtok` 30.00 use the conservative writing-model rates (comment dated). Replace once LISTENING_MODEL is chosen.
- Added `listening_score: 'other'` to the category table in `services/staff/usage.js` (the staffUsage test requires a category for every QUARK_COSTS key).
- Added `tests/listeningEntitlementStore.test.js` (entitlement and saveScores shape) beyond the brief's two tests.
- `scoresSince` filters on `itemAt`.

Tests: backend 1571 pass (1563 + 8 new), 0 fail. Frontend untouched.
