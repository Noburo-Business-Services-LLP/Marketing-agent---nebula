# Stage 5 fix round report (social listening, Phase A)

Branch nebulaa-redesign. Fakes only: no real model call, no external service, nothing pushed or deployed. TDD: each rule got a failing test first (RED observed for the scorer, filter and route rules), then the change.

## Test summary
- Backend `node --test tests/*.test.js`: 1732 pass, 0 fail (was 1712; every file exits on its own).
- Frontend `node --test tests/*.test.mjs`: 386 pass, 0 fail (was 382).
- `npx tsc --noEmit`: 1 error, the old one (`pages/Influencers.tsx`). `gen-layer-lists`, `brand-audit` (0), `voice-audit` (0).
- Card states looked at 375 and 1280 on the sample-data preview (127.0.0.1:3101, started and stopped by me): ready, stale, not enough, waiting, off (card absent), locked (plans note). No horizontal scroll at 375. Screenshots: `/private/tmp/claude-501/-Users-dineshkannaa-Documents-0-CONTENT-Claude-Agents/09560377-72af-47d7-b772-e6de37dcc6da/scratchpad/stage5-shots-b/`.

## Findings
- **I1 spend under-counted.** `scorer.js` now records spend after every billed attempt, whatever came back (`recordSpend`). It uses the provider's reported usage (new `onUsage` callback through `callTextLLM` and `callOpenAI`, also fired for an empty reply) and otherwise a worst case: one input token per prompt byte plus `maxOutputTokens` (4,500 for the 1,500 budget). `spendGuard.record` takes an exact `{ usd }`. Placeholder rates unchanged. Tests: `(I1) a throwing model call is still recorded...`, `(I1) an empty reply and a garbage reply...`, `(I1) when the provider reports token usage...`, `(I1) the daily ceiling trips at the real worst case` (real `createSpendGuard`: ceiling of 1.5 batches allows exactly 2 failing calls), plus `onUsage receives...`, `maxOutputTokens is the limit actually sent`, and `spend guard: record uses an exact dollar figure`.
- **I2 caps only in memory.** `ledger.record` returns false when the database write fails; the scorer then makes no model call, stops, and logs one plain line (no text, no error message). `ledger` joins the stop reasons, so the whole pass ends at the first account. Memory counters remain a second guard. Tests: `(I2) a ledger write that fails means NO model call...`, `(I2) after a restart (fresh memory)...` (three restarts, zero calls), `record says whether the database row was stored`.
- **I3 wrong baseline.** The route loads from the first baseline day (35 days). Sentence now says "in the week to 17 October" and "in the four weeks before", which is what is compared. Test `the card loads 35 days of scores so the trend compares with the FULL previous four weeks` has its baseline only on days 29 to 34 and asserts the load start; it fails on the old 28-day load (checked by mutation).
- **I4 stale data.** Windows end on the India day of the last scoring (new `store.lastScoredAt`, index on `scoredAt`). The response has `stale` (more than 10 days); the card always shows "Based on N comments from <from> to <to>." and, when stale, "Last checked on <date>." Tests: `windows end on the day of the last scoring, not today...`, `a last scoring more than 10 days old is flagged stale...` (10 days not stale, 11 stale), frontend `basedOn wording...`, `last checked line...`.
- **I5 untrue messages while off.** State `off` when the switch is off or the account was never scored; message null; the card renders nothing for entitled accounts (plans note kept for locked ones); the Inbox shows nothing. Removed "Nothing is scored yet" and the weekly texts from not-enough. "Comments are checked once a week." appears only in the ready state; the waiting message says it once itself. Mock states updated (`?listenstate=off` and `empty` show nothing, new `stale`). Tests: `the switch off: state off...`, `switched on but this account has never been scored...`, frontend `state off...`, `the weekly-check sentence exists only as weeklyNote...`, `the card renders nothing in the off state...`.
- **I6 broken links.** `UnifiedInbox` uses `useLocation` and reacts to every navigation (`[location.key, linkedId]`), selects only an id present in the loaded list (pure `pickSelectedId`, `conversationIdFromSearch`), and clears filters when the id is not found. Test: `?conversation=<id> is read from the location...`.
- **I7 quote filter.** `foldText` (NFKC, all `\p{Cf}` removed, Cyrillic and Greek look-alikes to Latin, accents dropped, lower case), `abuseForm` (pictures removed, separator runs collapsed), `contactForm` (spaced or bracketed dots joined). All rules run on the original and the normalised text. Stems accept `s|es|ing|in|ed|er|y` (and "-e" words their `-ing/-ed/-er` forms). Separators include comma, slash, bar, colon. Phone numbers: 7 or more digits with commas, slashes, dots, dashes, spaces, brackets between them, and spelled-out digit words counted together. Input is cut to 2,000 code units before any rule. Abuse list gaps from the review added. New `listeningQuoteBypass.test.js`: 55 bypass rows (all rejected), 16 harmless (all pass unchanged), 5,000-character hostile strings under 200 ms (measured worst about 1 ms), 160-character ones under 50 ms; the old timing test still passes.
- **I8 lease.** The scorer renews from `clock()` (current time) before every account and every batch. Tests: `(I8) the lease is renewed from the CURRENT time...` and `(I8) a pass longer than 45 minutes keeps the lease...` (real `createLease`, fake clock: second claimant gets nothing at 3 calls of 20 minutes; an abandoned lease is takable after expiry).

## Minors
Fixed (one line each):
- M4 TTL index of 90 days on `ListeningScore.itemAt`.
- M7 spec sentence about injection corrected to say a comment can nudge other labels in its batch.
- M8 "Most" now needs more than half; wording "Most negative comments are about X"; table column renamed "Comments and messages".
- M10 lease warning no longer says `[competitors]`; `startListeningScorer` trims the switch; ledger default `source` is `scorer`.

Skipped:
- M1 UTC-day caps (design choice), M2 staff score-now permission and budget (policy), M3 800-item sampling, M5 dead `ListeningWeekly` storage, M6 DM minimisation (owner decision), M9 re-processing of unstamped accounts, M11 recreated rows after a client removal, M12 pause lifting on a newer item, M8 spec wording of the not-enough note, M8 unused `topReason`: each needs more than a one-line change or an owner decision.

## Real-database script
Updated for the new behaviour (card baseline, off states, waiting, lease, indexes, spend, ledger failure) with a new section "(7) fix round (I1 to I8)". **It could not be run: this machine's IP (175.110.113.114) is refused by the Atlas cluster ("Could not connect to any servers... IP that isn't whitelisted"), two attempts.** Syntax-checked only. Nothing was created, so cleanup count is not applicable (0 left by construction). Whitelisting the IP is a security setting, so I did not touch it. Nothing listens on 3000 or 5000 (`lsof` empty); I did not start or stop anything there.

## Still open
- Run `cd backend && node scripts/listening-realdb-check.js` once the IP is allowed; expect the new section (7) and the changed assertions to be the places to look if anything fails.
- The competitor tracker (`services/competitors/tracker.js:227`) renews its lease with the pass start time, the same I8 bug; not in scope, one line to fix (`new Date()`).
- Placeholder token rates in `apiCosts.js` and `LISTENING_MODEL` still to be chosen, then one owner-approved real call to compare reported usage.
- Handle without "@" ("insta: name") is still not caught by the quote filter.
