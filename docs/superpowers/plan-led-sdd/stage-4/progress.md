# SDD ledger — plan: docs/superpowers/plans/2026-10-17-competitor-tracking.md
Spec: docs/superpowers/specs/2026-10-17-competitor-tracking-design.md
Ruling: owner said keep building and collect his pending items for later; decisions 1-9 in the spec were taken by the assistant. sonnet implementers; no per-task review (no money paths; cost-capped scraper reads); controller verifies tests, real-Mongo checks, browser checks; ONE final review on the most capable model. Real scraper read needs owner OK (queued).
BASE Task 1: 1d53569
Task 1: complete (commit fb098dc; suite 1445; summarise also returns weekStart+topPostAt; "same as last week" sentence never emitted)
BASE Task 2: fb098dc
Task 2: complete (commit acbbb88; suite 1453; real dev check passed; export covers snapshots through registry; note readsToday counts by takenAt so Task 3 must count every read)
BASE Task 3: acbbb88
Task 3: complete (commits 06771fb, c1888da scraper reads under spendGuard provider apify_scrape; suite 1469; failed week not retried until next week)
BASE Task 4: c1888da
Task 4: complete (commit faf56a4; suite 1483; staff check_competitors action; force skips only cooldown and failed-week rule)
BASE Task 5: faf56a4
Task 5: complete (commit 19a7ba0; frontend 359). Real-Mongo check by controller found a Mongoose nested `type` key bug in CompetitorSnapshot.topPost (every real save failed silently): fixed fda3a36; tracker now logs save errors and waits (c55f570). Re-run on real dev DB with a fake scraper: pass 1 saved 2 snapshots, pass 2 same week read nothing, handle-less not read, insights sentences correct, add-on gate 403.
NOT DONE: on-screen check of the card (Competitors page leans dark), final whole-branch review on the most capable model, one real scraper read (owner OK), staff UI label for check_competitors action. Stopped near 90% usage to follow the 95% rule.
