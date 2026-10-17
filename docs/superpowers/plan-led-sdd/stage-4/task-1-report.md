# Task 1 report: snapshot analysis (pure)

Status: DONE. Files: backend/services/competitors/snapshot.js, backend/tests/competitorSnapshot.test.js.
Tests: 9/9 new pass; full backend suite 1445 pass, 0 fail.

Test adjustments (rules kept):
- Removed the loose `/We have started tracking Bake Lab|Bake Lab/` assertion from the highlights test: with max 3 strongest highlights, the weak first-week note is correctly cut when stronger changes exist. Added a separate test asserting the exact first-week sentence for a one-snapshot competitor, and none for zero snapshots.
- Added a test for follower thresholds (>=50 and >=1%), best-post recency (7 days) and the 1.5x own-average rule.

Decisions / concerns:
- summarise also returns weekStart (weekStartOf(now)) and topPostAt (Date or null); Task 2 model needs topPostAt.
- Weights: posting |change|/max(prev,1); followers |change|/prev followers x10; best post (likes/avg)/6; first-week note 0.1. Ties keep input order. No per-competitor cap on highlights.
- The brief's "the same as last week" sentence is never emitted: it is only allowed when change >= 2 or first week with posts, which cannot produce equal counts. For prev 0 and now 1, the sentence is "X posted 1 time this week, after none last week."
- Negative likes (Instagram hidden counts) are treated as 0. Posts dated in the future are ignored.
