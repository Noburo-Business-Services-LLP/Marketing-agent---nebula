# Task 8 report: real-database check and full verification

Status: done for the script, fixes and verification. Steps 4 (browser check), 5 (one real model call, needs the owner's OK) and 6 (final review) are not part of this run.

## What changed
- `backend/scripts/listening-realdb-check.js` (new): 42 checks on `nebulaa_dev` with a fake model, trip-wires on the real model/spend/alert paths, own lease keys, throwaway `zz.rdbchk.rdbcheck5-` accounts, cleanup with counts and a stray scan. Details in `realdb-check-report.md`.
- `backend/routes/listening.js`: private messages are no longer listed in `recentNegative` (spec: never shown outside the Inbox). Test added first.
- `backend/services/listening/helpers.js`: the quote filter's patterns are compiled once at load (first call cost about 125 ms plus 90 ms for non-Latin text).
- `backend/tests/listeningQuoteTiming.test.js` (new, 2 tests): about 50 hostile 160-character strings, each under 50 ms with no warm-up; failed before the fix.
- `backend/tests/listeningRoutes.test.js`: one new test (private previews).

## Verification
Backend 1712 pass / 0 fail (1709 + 3 new; every file exits on its own), frontend 382 pass, `tsc --noEmit` 1 old error (`Influencers.tsx` breakdown), brand audit 0, voice audit 0. Real-database script: 42 PASS, 0 FAIL, twice; left 0.

## Concerns
- `recentNegative` now hides private messages; if the owner wants them on the card (his own inbox), revert the two lines in `routes/listening.js` and the new test.
- Score rows planted for an account count in that account's total even when their inbox item belongs to someone else (only the text is protected); a row can only be written by the scorer with the account's own id, so this needs a corrupt write.
- Disconnecting a social account keeps its inbox items and scores (product decision, unchanged).
