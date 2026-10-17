# Task 2 report: Snapshot storage

Commit acbbb88. Full backend suite: 1453 pass, 0 fail (competitorSnapshotStore 7 new tests, dataRegistry passes).

Built: models/CompetitorSnapshot.js (unique {competitorId, weekStart}, plus userId and takenAt indexes), config/competitors.js, services/competitors/snapshotStore.js, Competitor.tracking, dataRegistry rule (delete). Export (accountExport.js) iterates the registry's erasable rules, so snapshots are exported automatically; no new mechanism.

Design: failed save pre-checks for an ok row, then upserts with filter ok != true and swallows duplicate-key (11000) if a good row lands concurrently. prune keeps N newest weeks (any status). readsToday counts takenAt in the last 24h.

Real check (nebulaa_dev only, throwaway ids, script deleted): uniqueIndex true; duplicate insert code 11000; ok-then-failed kept ok (followers intact); failed week stored and returned by lastAttempt; latest ok-only; failed-then-good replaced; cleanup deleted 2, remaining 0.

Concerns: readsToday counts attempts by takenAt, so the tracker (Task 3) must save a row (even failed) for every read and set takenAt = now; an ok:true row for a week keeps its original takenAt only if the caller omits it, since save sets fields passed.
