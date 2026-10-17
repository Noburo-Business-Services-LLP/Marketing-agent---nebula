### Task 8: Real-database check script and verification (controller reviews)

**Files:** Create `backend/scripts/listening-realdb-check.js` (modelled on `backend/scripts/competitors-realdb-check.js`: same header, `check()`/PASS-FAIL printer, `cleanup` argument, prefix `rdbcheck5-`, lease key `listening_scorer_lease_rdbcheck5`); Create `docs/superpowers/plan-led-sdd/stage-5/` build records at the end (briefs and reports as in stage 4).

**Checks (all with a FAKE model that counts calls; spend guard replaced by a fake; refuses any database except `nebulaa_dev`; asserts `process.env` model call functions are never the real ones):**
1. Refuses to run unless the connected database name is exactly `nebulaa_dev`.
2. After `Model.init()` the unique indexes exist on `listening_scores` (`userId, inboxItemId`) and `listening_weekly` (`userId, weekStart`); a duplicate insert gives code 11000; `listening_batch_log` TTL index exists.
3. Throwaway users (entitled with the Inbox add-on, Starter without it, free, staff) with 30 real `SocialInboxMessage` documents created through the real model: only the entitled user is scored; scores stored with the right enums (proves no silently broken nested `type`-style keys: read back the raw documents with `.lean()` and assert every field).
4. Ledger durability: a save that throws (fake store wrapper) followed by a second pass sends zero further batches for the same items; counts survive a new ledger instance because rows are in the database.
5. Caps: 500 items → exactly 10 batches; daily item cap; global batch cap.
6. Lease: two concurrent `runScorerOnce` → exactly one runs, the other `busy`; lease released.
7. API: mount the real router with a real-gate user; shapes for 19 and 20 scored items; a deleted inbox item disappears from quotes; another user's scores never appear.
8. Erasure: account deletion through the registry removes the three collections' rows for the throwaway user; `eraseForInboxItems` removes scores and rebuilds weeks.
9. Cleanup removes every document the run made (users, inbox messages and conversations, scores, weekly, batch log, lease rows) and prints what is left (must be 0).

- [ ] **Step 1:** write the script. **Step 2:** run `cd backend && node scripts/listening-realdb-check.js` (needs the dev database config the existing check already uses; do not read or print `.env`); expect all PASS; run `node scripts/listening-realdb-check.js cleanup` and expect zero leftovers.
- [ ] **Step 3: Full verification:** backend `node --test tests/*.test.js`, frontend `node --test tests/*.test.mjs`, `npx tsc --noEmit`, brand and voice audits at 0, `git status` clean of stray files. Confirm no dev server was started with `ENABLE_LISTENING=on`.
- [ ] **Step 4: Browser check (controller):** the card in each state (`ready`, `not_enough`, `waiting`, `locked`, `error`) on My plan and `/inbox`, desktop and 375 px, with a real-store throwaway account (entitled with scores written through the real store, entitled with none, not entitled).
- [ ] **Step 5: One real model call** (owner's OK required; one batch of about 40 short throwaway comments on a throwaway user in `nebulaa_dev`, `LISTENING_MODEL` set by the owner) to measure real cost per 100 comments and label quality; record the figure in `docs/superpowers/plan-led-sdd/stage-5/real-call-report.md` and put the measured rates into `apiCosts.js` with their date.
- [ ] **Step 6: Final review** on the most capable model against the Review Focus list above; fix findings; copy build records to `docs/superpowers/plan-led-sdd/stage-5/`; update the handover with the owner checklist (`ENABLE_LISTENING`, `LISTENING_MODEL`, staff switch "Comment scoring", the Inbox entitlement, first result within a week, pricing decision still open); push (controller only).
- [ ] **Commit (script and records)** — `git add backend/scripts/listening-realdb-check.js docs/superpowers/plan-led-sdd/stage-5 && git commit -m "Listening: real-database check for stage 5 and build records"`.
