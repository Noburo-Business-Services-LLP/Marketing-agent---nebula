### Task 2: Snapshot storage

**Files:** Create `backend/models/CompetitorSnapshot.js`, `backend/services/competitors/snapshotStore.js`, `backend/config/competitors.js`; Modify `backend/services/dataRegistry.js`, `backend/models/Competitor.js`.

**Interfaces:** Model fields per the spec plus `topPostAt` and `weekStart`; unique index `{ competitorId: 1, weekStart: 1 }`; `config/competitors.js` exports `{ MAX_TRACKED: 5, READS_PER_DAY_MAX: 200, COOLDOWN_HOURS: 12, KEEP_WEEKS: 12, FAIL_PAUSE_AFTER: 3 }`. `snapshotStore(Model)`: `save(snapshot)` (upsert by competitor+weekStart, never overwriting an `ok:true` snapshot with an `ok:false` one), `latest(competitorId, n)` (newest first, ok only), `lastAttempt(competitorId)` (newest of any status), `prune(competitorId, keep)`, `readsToday(now)` (count of snapshot attempts in the last 24 hours across accounts, used for the daily cap). `Competitor.tracking = { failures: Number, pausedAt: Date, lastCheckedAt: Date }`. `dataRegistry` rule for `CompetitorSnapshot` (field `userId`, action `delete`).

- [ ] Steps (TDD where logic exists): write `tests/competitorSnapshotStore.test.js` with an in-memory fake model proving: ok never overwritten by failed, upsert idempotent per week, `latest` order and filter, `prune` keeps N newest, `readsToday` counts only last 24 h; add the data registry rule and run `tests/dataRegistry.test.js` (must pass: it fails if the model with a user ref is missing); run a throwaway real check against `nebulaa_dev` that the unique index exists after `Model.init()` and a duplicate insert gives code 11000 (throwaway script deleted afterwards). Run the full backend suite. Commit `git commit -m "Competitors: snapshot model, store, caps config, erasure rule"`.

---

