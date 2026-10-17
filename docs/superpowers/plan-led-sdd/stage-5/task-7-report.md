# Task 7 report: erasure of listening data

Status: done. Backend 1709 pass / 0 fail (1695 + 14 new, every file exits), frontend 382 pass, tsc 1 old error, brand and voice audits 0 violations.

## What changed
- `services/listening/erase.js`: `eraseForInboxItems({userId,itemIds,now,store}) -> {removed}` and `sweepOrphans({userId,now,deps}) -> {removed}`. Sweep pages the account's newest scores (500 a page, 6 pages, 1000 removals a run), checks `{ _id: {$in}, userId }` against `SocialInboxMessage`, deletes the orphans, rebuilds weeks only when something went. Idempotent, never throws; a failed inbox lookup removes nothing. Every query carries `userId`.
- `store.js`: `scoredPage`, `deleteScores` (both filtered by userId).
- `scorer.js`: the sweep now runs at the start of `scoreAccount` (after the not-due check, before items are read), so only accounts about to be scored are swept, deleted comments stop counting toward the 20 minimum and the totals; the old end-of-pass stub call was removed. Test (u) updated accordingly.
- Registry: the three rules from Task 1 are verified; new tests cover account deletion, agency client removal (`purgeWorkspace`) and agency deletion (`clients` + `data` steps), each leaving other accounts' rows. Mutation checks (rule removed, sweep not called, erase not scoped by user, enum) each fail the tests.
- Export: already automatic through the registry (`erasable()`); test shows scores and weekly totals are exported and that the three schemas have no text, author or quote field.
- Inbox: no delete path exists today. Added a note on `SocialInboxMessage` and a source-grep test that fails if a delete route/handler appears without `eraseForInboxItems`.
- Privacy page: one sentence added after the service-provider paragraph in section 5.1. DRAFT FOR LAWYER REVIEW. Nothing else in the legal pages changed.

## Found and fixed
`ListeningBatchLog.source` enum was `tracker|staff` but the scorer writes `scorer`, so every batch row failed validation (the ledger swallows it and counts in memory only, so caps would not survive a restart). Enum now includes `scorer`; test added.

## Concerns
- Disconnecting a social account does not delete its inbox items today, so its scores stay (the items still exist and still show in the Inbox). The sweep follows item existence only; if disconnect should hide or erase old items, that is a product decision.
- `GET /api/listening` does not sweep (it would add writes to a read); totals reflect a deletion at the next scorer pass for that account (weekly cadence), quotes disappear at once.
- Sweep checks the newest 3000 scores per run; older orphans outside the 28-day card window do not affect numbers.
- Only fakes exercised; Task 8 must run the sweep against `nebulaa_dev`.
