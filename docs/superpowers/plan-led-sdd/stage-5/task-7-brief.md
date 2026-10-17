### Task 7: Data deletion registry and erasure

**Files:** Modify `backend/services/dataRegistry.js` (rules `ListeningScore`, `ListeningWeekly`, `ListeningBatchLog`, all `userId`, action delete, placed alphabetically near `Lead`/`Library` entries), `backend/services/listening/erase.js`; Test `backend/tests/listeningErase.test.js`, `backend/tests/dataRegistry.test.js` (must pass unchanged or with the three names added where it lists models).

**Interfaces:** `erase.eraseForInboxItems({ userId, itemIds, now, store }): Promise<{ removed }>` deletes the scores for those items (always filtered by `userId`) and calls `store.rebuildWeeks(userId, now)`; `erase.sweepOrphans({ userId, now, deps }): Promise<{ removed }>` finds scored items (newest 500) whose `SocialInboxMessage` no longer exists for that user (query `{ _id: { $in }, userId }`) and erases them; never touches another account; never throws.
The Inbox has no item-delete path today (checked `controllers/socialInboxController.js` and `routes/socialInboxRoutes.js`). If one is added later it must call `eraseForInboxItems`; add a code comment on `SocialInboxMessage` pointing to this, and a test that fails if a new route named `delete` appears in `socialInboxRoutes.js` without a call to it (grep-style test over the source file).

- [ ] **Step 1: Write the failing tests:** registry coverage (the dataRegistry test lists every model with a user ref; confirm it fails before the three rules are added, then passes); erase removes only that user's scores for the given ids even when another user has the same item id; weeks are rebuilt and a week with no scores left is removed; `sweepOrphans` removes scores whose message is gone and leaves others; account deletion path (`services/accountDeletion*` or whatever consumes the registry; find it with `grep -rn "dataRegistry" backend/services`) deletes the three collections for a throwaway user in a fake model run.
- [ ] **Step 2–4:** fail, implement (wire `sweepOrphans` into `runScorerOnce` at the end of each account), full backend suite. **Step 5: Commit** — `git add backend/services/dataRegistry.js backend/services/listening/erase.js backend/services/listening/scorer.js backend/models/SocialInboxMessage.js backend/tests/listeningErase.test.js && git commit -m "Listening: erase scores with the account and with deleted inbox items"`.

---

