# SDD ledger — plan: docs/superpowers/plans/2026-10-17-plan-led-stage-2-week-and-setup.md
Spec: docs/superpowers/specs/2026-10-17-plan-led-home-design.md (Stage 2)
Ruling: sonnet implementers; opus per-task review ONLY for Task 3 (charging/refund + idempotency); controller verifies tests, does real dev runs and visual checks; ONE final whole-branch review on the most capable model. Stage 1 lesson: mock fixtures hid a real shape bug, so verify with real data/one real run.
Pre-flight scan: T1 weekMath/weekProposal (consumed by 3); T2 setupSteps uses Stage1 profileComplete (consumed 5,7); T3 weekService uses weekProposal, walletBalance, deductCredits/refundCredits, generateSingleCalendarItem (consumed 5); T4 planContext uses Stage1 currentPlan (calendar prompt); T5 routes use T2,T3 and Stage1 planService; T6 prefill (consumed 5 prefill shapes, 7); T7 UI uses T5,T6. T5 prefill field names must match T6 (video: idea,language; carousel: mode,topic,platform,language). No contradictions found.
BASE Task 1: 52c116f
Task 1: complete (commit 684c764; suite 1342; ids re-indexed after scaling (stored once at creation); videos over reelsPerWeek cap silently dropped)
BASE Task 2: 684c764
Task 2: complete (commit dfea803; suite 1348; next=null while plan missing)
BASE Task 3: dfea803
Task 3: complete (commits d1b3831, ed3d084, cafad56 after opus review: 7 Important fixed; suite 1382; real dev Mongo check by controller: unique index, dup key, 20-way claim = 1 winner, 10-way stale takeover = 1 winner, settle token, setItem scope: all PASS)
OWNER FLAGS: (a) generateSingleCalendarItem and processAutoGeneration/auto-generate-week/regenerate do NOT charge: calendar auto-generation is free for paying accounts (cost leak) and processAutoGeneration re-makes the same day every minute until the monthly cap of 7 (pre-existing, untouched); (b) video price basis now studio_video 161, carousel 40 (5 x 8), post 11; (c) M3 eligibility+backgroundGate gating belongs to Task 5 route/scheduler; (d) unique index on weekly_proposals must exist after deploy (Atlas disk ceiling).
BASE Task 4: cafad56
Task 4: complete (commits 2b0c1c3, b9c32e6 other calendar entry points wired; suite 1390)
BASE Task 5: b9c32e6
Task 5: complete (commit f3b2bcf; suite 1403; approve returns at once and runs posts in background; GET recovers stale; gate uses non-Safe blockedAccountIds (500 on read failure))
BASE Task 6: f3b2bcf
Task 6: complete (commit b6ad9ae; frontend 320; prefill read on mount; GravityCreate puts topic into title and brief)
BASE Task 7: b6ad9ae
Task 7: complete (commits c155156, af65cd0 polish: compact rows, wording balance, prefill rebuilt after reload, polling hygiene; frontend 332; visual check by controller on REAL service data: ready/small(scaled note)/tiny(top-up)/free+newacct(not eligible); desktop+375px no sideways scroll)
Task 8 real run (owner OK for ONE real post): approve answered 0.85s; post made in 154s in background; pool 3000->2989 (=11); 1 ledger row image_generated -11; Draft completed with image+caption; second approve no change; calendar row generated. Throwaway rows cleaned (dev Cloudinary image remains).
Final review: no Critical; Important fixed in 0f40a9e (I1 plan fallback, I2 markMade, retry cap, recovery), 7fcddf5 (calendar auto-generation claims rows atomically, spend ceiling, count kept, cooldowns), 8f84211 (screens report made, done state, item errors, slow notice, focus).
