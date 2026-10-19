# Handover 17: 2026-10-19: money-path review done and fixed (short addendum to handover 16)

Read handover 16 first (it is the main state document), then the ledger `docs/superpowers/OWNER-REQUESTS-LEDGER.md`. All standing rules from handovers 5, 15 and 16 apply (owner non-technical, plain language; he runs releases; push only to the existing `nebulaa-redesign`; never read or print `.env`; paid calls need his OK; real-DB work only on `nebulaa_dev`).

## State
Branch `nebulaa-redesign`, everything committed and pushed (head after this file). Tests: backend 2325, frontend 624, tsc only the old `pages/Influencers.tsx` error, brand and voice audits 0. Still **not released**: everything after `bc514a9` (handovers 11 to 17).

## Done this session
1. Independent strongest-model review of the money paths (Home drafts, Photoshoot, calendar cover retry, competitor avatar fetch). Core charge, refund, cap and idempotency logic found sound; seven issues found and FIXED (commits `ac28a05`, `d65b258`, `386029b`, `f06452c`):
   - Photoshoot reference fetch SSRF (resolve-time and connect-time address check, port 443 only, redirects re-validated, streamed byte cap) and a sweep that closes `queued` photoshoot rows older than 3 minutes (refunds from the Quark ledger spend row if one exists).
   - Home drafts: charge intent written before the spend; stale rows with an unconfirmed charge are settled from the ledger; refund failure now flagged (`refundFailed`) and alerted; lease (`leaseAt`) so a live row is never refunded and delivered; `STALE_MS` raised to 500 s and conditional success write.
   - Calendar: manual "Make a cover" now has an atomic claim, spend guard, 60 s cooldown and 3 a day (still free); automatic retry only for the current and next India month, at most 3 per calendar, text call recorded in the spend guard.
2. Real-database check scripts re-run on `nebulaa_dev` and updated for the new rules: `photoshoot-check` 24 of 24, `home-drafts-check` 27 of 27, `calendar-cover-check` 13 of 13 (all clean up after themselves).
3. One real Whisper call (about USD 0.001) proved subtitle timing on the 10 s Tamil test clip: speech 0.00 to 5.54 s, similarity 0.78, line said once (ledger updated).

## Residual risks found by the review, NOT fixed
- Photoshoot: if the real `spend` call takes longer than 3 minutes, the stale sweep could refund the job and then `startJob` could refund it again after `markCharged` fails (double refund). Very unlikely. Fix idea: make the two refund paths share one atomic claim.
- `quarkBuckets.record()` writes the ledger spend row after the balance update and does not wait for it: a crash in that gap leaves a charge with no ledger row, so the ledger-based recovery closes the row without a refund. Needs a change in `backend/services/quarkBuckets.js`.
- The 60 s cover cooldown is in process memory (resets on restart or a second server); the atomic claim and the daily cap hold in the database.
- Studio video chain, finishing and transcription, and the Inbox send and approval path were NOT in the reviewed range; they had no strongest-model review (I reviewed them myself earlier).

## DO NEXT (unchanged from handover 16 except item 1 is done)
2. Planner additions (Task 4 of `docs/superpowers/impact-maps/home-and-plan.md`), fakes only; one real dev plan run (about USD 0.18) needs the owner's OK.
3. Inbox, Reviews and Automatic replies tiles; Performance KPI tiles; Brand assets and Blueprint tiles; Calendar hero; Library tiles; Videos category chips: impact map first, symmetry and compact rules.
4. Landing page and website (hold the inbox claims until the live test passes), questionnaire redo.
5. Owner steps (release, index scripts, switches, real proofs, Inbox live test, Razorpay live webhook, lawyer and accountant items). A real 30 s Tamil test with subtitles on (about USD 3) needs his OK.
