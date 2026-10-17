# Stage 1 final review fixes: report

Commits on nebulaa-redesign (not pushed): 947e1d8 (blueprint core), d9582c6 (plan layer, scheduler, backfill), and the frontend commit after it (see git log, "Build my plan button").

Suites: backend 1335/1335, frontend 315/315, tsc only the old Influencers.tsx error, brand-audit 0, voice-audit 0, gen-layer-lists run (index.html unchanged).

## Critical
- C1 fixed. pipeline.js stores the normalised planner output in `result.plan` (all twelve keys); the shape already matched utils/plan.ts and MyPlan.tsx so no frontend change was needed. `scanPlanExtras` rescans every icp and effort claim with the shared scanner before storing. Blueprint view and designed deck ignore the key (tested with buildDeck). Tests: planFinalBlueprint.test.js (real buildBlueprint path with fake callLLM).
- C2 fixed. `inFlight` ignores heartbeats older than STALE_MS; `reapStalePlanRuns({now, all})` fails stale runs (error 'interrupted', charge untouched); runs at boot (all, from server-main via `reapOnBoot`) and first in every tick (`runSchedulerTick`). Tests in planFinalPlan and planFinalScheduler.
- C3 fixed. `startSystem` calls spendGuard first (`busy`), enforces `PLAN_RUNS_PER_DAY_MAX = 100` (`daily_cap`, one owner alert a day via opsAlerts.notify), nothing created on refusal. planService passes reasons through; customer refresh gets 503 "We are busy right now, please try again later"; scheduler (monthly and retry) and backfill stop on busy/daily_cap.

## Important
- I1 fixed. Backfill polls each started run (15 s, 10 min timeout, `waitForRun`), starts the next only after, exits at the end; comment corrected; rerun ignores runs with a dead heartbeat. The --yes path itself is still not run against a database (not allowed here); `waitForRun` and selection are unit-tested.
- I2 fixed. Candidates filtered in Mongo (tier not free, active, not staff/CSM, onboarded, gate), sorted by planState.lastStartedAt ascending, index added, cap 5 per tick. Because of I3 the window is further restricted to accounts that have a completed plan older than 30 days (via distinct on plan runs), otherwise accounts without a plan would fill the window again.
- I3 fixed per RULING. Monthly pass skips accounts without a completed plan; `retryFailedFirstPlans` kept; first tick at 15 minutes (`FIRST_TICK_MS`).
- Button RULING done. planBanner 'can_build' with the text "This takes about a minute. It is free."; MyPlan shows a Build my plan button (POST /api/plan/refresh); the weekly limit does not apply with no plan, and building the first plan does not stamp lastRefreshAt.
- I4 fixed. `GET /api/plan` returns `stopped: { message }`; My plan shows it with a Business profile button (and Build again when there is no plan); scheduler and retry ignore stopped runs; the hook starts again only if user.updatedAt is after the stopped run's createdAt; after a stopped run on a changed profile the weekly limit is also lifted. Spend is now recorded in `run()` just before the planner is called (plan runs only), so a stopped run costs nothing. Old test updated to drain first.
- I5 fixed. `profileComplete` runs `normaliseInput`; 'none', '-', 'foo' give missing 'website or Instagram page'. `startSystem` returns `invalid_input` with errors; planService and refresh reply (400, plain words) surface it.
- I6 fixed. `firstPlanAllowed` (used by the hook): no start when firstPlanFailedAt is set or lastStartedAt is under an hour old.
- I7 fixed. icp/effort drops go to `droppedExtra` (own list), a note flag 'removed_plan_items' is added, not counted toward MAX_DROPPED.
- I8 fixed. runner.js has lanes; 'plan' lane is concurrency 1 and separate; startSystem uses it. Tests in planFinalRunner.test.js.
- I9 fixed. `kind: { $ne: 'plan' }`; `defaultFreeBlueprint` takes an optional model so a kind-less document is tested.

## Minor
- M1 fixed: `claimStart` conditional update on planState.startingAt (60 s), released when a start is refused; `startingAt` added to the User schema.
- M2 fixed: customer daily cap and per-IP cap both skip plan runs.
- M3 fixed: My plan nav entry shows for agency owners (lapsed agencies still excluded).
- M4 fixed: failed scan limited to 14 days and 200 rows; newest run must be 'failed'.
- M5 fixed: staff refresh leaves lastRefreshAt alone.
- M6 fixed: geminiAI.js-e removed; no other tracked `*-e` files.
- M7 fixed: MyPlan polling re-arms after every look, including a failed one (`shouldPoll`).
- M8 fixed: backfill skips accounts the background gate blocks (`blocked` reason).
- M9 fixed: get, continue and designed answer 404 for plan runs.

## Notes
- Untracked backend/scripts/_tmp-planreal.js belongs to the controller; left alone, not committed.
- The scheduler candidate query, the failed-first scan and the start claim are verified against recording fakes, not a database.
