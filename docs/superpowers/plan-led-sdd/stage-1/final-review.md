# Stage 1 (My plan): final whole-branch review

Range a483aa5..477f3bb, branch nebulaa-redesign. Read-only review of the current source. Unit tests: backend `tests/plan*.test.js tests/blueprint*.test.js` 273/273 pass; frontend `tests/plan.test.mjs` 4/4 pass; `tsc --noEmit` reports nothing in the touched files.

## Verdict

**Not ready to merge.** Three Critical defects:
1. The page cannot show a real plan, because the stored result has no `plan` key.
2. A plan run that is interrupted (by a deploy, or by the backfill script exiting) blocks that account forever.
3. Runs started by the system skip the provider kill switch and the daily spend ceiling.

The tests miss all three because they use fakes at exactly these seams. Several Important cost and liveness problems follow, mostly in the scheduler.

What holds up:
- Access scoping is sound: the user id comes from the session, staff routes go through `clientFor` with the CSM scope, and the staff refresh needs `open_client`.
- Plan runs are left out of `GET /api/blueprint` and staff Usage.
- Account deletion covers plan runs (dataRegistry deletes `Blueprint` by `userId`).
- The model cannot mint Verified. `nebulaaDoes` is limited to the allowed list, percentages are repaired, and a missing `icp` or `effort` degrades to `null` / `[]`.
- The old ICP endpoints return 410, and the frontend has no remaining caller.

---

## Critical

### C1. A real plan result has no `plan` key, so My plan and the staff card always render empty (confidence: high)
- `backend/services/blueprint/pipeline.js:9` stores `assembleBlueprint(...)` as `result`. `backend/services/blueprint/assemble.js:98-108` returns `{version, mode, basis, generatedAt, cover, pages, sources, closing}`, with no `plan`, `icp` or `effort`. The `icp` and `effort` built in `planner.js:134-153` are therefore thrown away and never stored.
- The frontend reads `view.plan.result.plan`: `frontend/utils/plan.ts:13` (`planOf`), `frontend/pages/MyPlan.tsx:63`, and the staff card in `frontend/pages/staff/StaffClientPage.tsx` (`plan.plan?.result?.plan`).
- **Scenario:** any completed plan run. `sectionsOf()` returns `[]`. The page shows the "My plan / Made on …" header and nothing else. The staff card shows "Up to date" with no promise and no channels.
- **Why it slipped through:** the frontend tests and the controller's visual check used a mock `{ result: { plan: {...} } }`. The backend route tests use a fake `currentPlan`.
- **Fix:** carry the planner's cleaned `plan` (or at least `icp`, `effort`, `channels`, `roadmap`, `pillars`, `calendar`, `firstSteps`, `promise`, `positioning`) into the stored result for `kind:'plan'` runs, or change the frontend to read `pages[]`.
- **Also note:** `runQa` (`qa.js:132`) only scans `pages[].sections`. Once `icp` and `effort` are stored outside `pages`, they get only the per-claim `toClaim` scan, not the document-level QA. Either add them to the QA walk or render them as page sections.

### C2. An interrupted plan run stays "in flight" forever, blocking that account permanently (confidence: high)
- Runs live only in the in-process queue (`services/blueprint/runner.js`). The only stale-job reconcile is inside `get()` (`services/blueprint/service.js:331`), which runs when a customer polls a Blueprint by id. Nothing ever polls plan runs by id: `/api/plan` uses `currentPlan` and `inFlight`.
- **Scenario:** a deploy or restart while a plan run is `queued` or `processing`. A tick 2 minutes after boot starts up to 20 runs into a 2-slot queue, so a deploy in the next ~10-20 minutes strands most of them. The doc stays `queued`/`processing` with no reconcile. Then:
  - `inFlight` is true forever (`planService.js:29-32`, `planScheduler.js:17`).
  - My plan shows "We are building your plan" forever and polls every 5 seconds.
  - Refresh, both customer and staff, answers "Your plan is already being updated."
  - The monthly path skips the account (`planScheduler.js:69`) and the retry path skips it (`failedFirst` excludes accounts with queued or processing runs).
  - Nothing ever recovers the account.
- The backfill script guarantees this outcome; see I1.
- **Fix:** treat a plan run whose `heartbeatAt` is older than `LIMITS.STALE_MS` as dead. Mark it failed with a conditional update in `inFlight` and `currentPlan`, or add a small reaper in the plan scheduler tick and at boot.

### C3. System-started runs skip the provider kill switch, `AI_KILLED` and the daily ceiling (confidence: high)
- `startSystem` (`services/blueprint/service.js:241-254`) records spend but never calls `spendGuard.check('blueprint')`. The only check is the route middleware `spendGate` on `POST /api/blueprint` (`routes/blueprint.js:41-44`). The model layer (`openAI.callTextLLM`) has no check of its own.
- Every plan trigger goes through `startSystem`: the scheduler, the profile-save hook, the customer refresh, the staff refresh and the backfill script.
- **Scenario:** the owner switches off "Writing" (`openai_text`) in an emergency, or the $150 ceiling is reached. The 6-hourly tick still starts up to 20 runs, and backfill, refreshes and profile saves keep making model calls.
- This breaks the Global Constraint ("obeys the daily AI spend ceiling and provider switches").
- The spec's "global cap" (Cost and limits, line 115) is also not built. The only limit is 20 per tick, plus a tick at every boot.
- **Fix:** in `startSystem` (or `planService.startPlan`), `const g = await spendGuard.check('blueprint'); if (!g.ok) return { ok:false, reason:'busy', message:g.message }`. Do this before `Blueprint.create`. A run refused this way should not set `lastStartedAt` or count an attempt.

---

## Important

### I1. The backfill script runs the plans inside its own process, then exits and kills them (confidence: high)
- `scripts/plan-backfill.js:52-61`. `planService.startPlan` returns as soon as `startSystem` has created the doc and queued the run, and that queue is the script's own in-process runner. So:
  - The comment "awaited: never two at once" is wrong. Runs pile up in the script's 2-slot queue at 3 per minute.
  - `process.exit(0)` follows the last start immediately, killing every run still queued or processing. Those docs then hit C2 (stuck forever).
- Its rerun-skip treats `queued`/`processing` as "has a plan", so a rerun skips the stranded accounts too.
- The task-6 ledger notes "--yes path untested".
- **Fix:** have the script wait for each run to reach a terminal state, with a timeout, before starting the next. Alternatively, have it only create docs that the server-side reaper or worker picks up.

### I2. Ineligible accounts can fill the scheduler's candidate window and starve eligible ones (confidence: high on the logic; depends on the account mix)
- `planScheduler.js:19-24` selects every onboarded, non-staff user, with no tier filter. It sorts by `planState.lastStartedAt` ascending and stops at 200.
- Some accounts never start a run, so `lastStartedAt` stays null and sorts first: free accounts, incomplete profiles, and the inputs from I5.
- **Scenario:** 200 or more onboarded free or incomplete accounts. Each tick sees the same 200 ineligible users and skips them all. Paying and managed accounts are never reached, so they get no monthly refresh, and accounts the profile hook missed get no first plan.
- No index exists on `planState.lastStartedAt`, so each tick does a collection scan and an in-memory sort of full User documents.
- **Fix:** filter in Mongo (`'plan.tier': { $ne: 'free' }`, plus a profile-present condition), or stamp a `planState.checkedAt` on skipped users and sort by that. Add an index and a projection.

### I3. The scheduler backfills every eligible account with no plan, bypassing the owner-run backfill (confidence: high)
- `monthlyDue({ lastPlanAt: null })` is `true` (`planRules.js:33`), and `runMonthlyOnce` starts those accounts (`planScheduler.js:78-79`).
- So the first tick, 2 minutes after the deploy, starts plans for existing paying and managed accounts at 20 per tick, with a tick at every restart, and without the owner running anything.
- The spec says the managed rollout is a one-time script "run by the owner", with a dry run and a hard cap, and that the owner may want to tell clients first (spec lines 43 and 145). The script's `--yes` and `CONFIRM_PROD` guards are moot.
- This was planned (Task 4 interface), but it conflicts with the spec. **Owner decision needed:** either make the scheduler skip accounts with no plan (leave them to the hook and the backfill), or accept auto-rollout and say so.

### I4. A "stopped" run (website unreachable, or too little information) is never treated as a failure, so it repeats every 12 hours forever (confidence: high)
- `lastRunFailed` and `failedFirst` test `status === 'failed'` only (`planScheduler.js:30-33, 37`). Discovery stops end as `status: 'stopped'` (`service.js:269-271`).
- **Scenario:** the profile website cannot be read and there is no Instagram.
  1. `inputFromProfile` always sends `offers: []`, so the "add an offer" fix the stop message suggests is not possible.
  2. Each monthly pass sees `failed=false` and `lastPlanAt=null`, so it treats the run as due. It resets `attempts` to 0 (`:76`) and starts again once the 12-hour cooldown passes.
  3. That repeats twice a day, forever. Each start records a phantom `blueprint` spend unit (`service.js:251`), which inflates the daily-ceiling count, even though no model call was made.
- The customer sees "Your plan will appear here once it is made." forever. `viewFor` never shows the stop reason.
- **Fix:** treat `stopped` as failed for retries and the cap. Show `stop.message` on the page. Record spend only when the planner is actually called.

### I5. Some "complete" profiles cannot be turned into plan input, so the account never gets a plan and no reason is shown (confidence: high; checked by running both functions)
- `profileComplete` accepts any non-empty website (`profileInput.js:62`). `normaliseInput` rejects `"none"`, `"-"` and `"foo"` (`services/blueprint/input.js:76`).
- `startSystem` then returns `ok:false` without creating anything (`service.js:244`). `startPlan` returns `not_started` and saves no state.
- The page shows "none" forever. A customer refresh returns 503 "try again later" forever. The scheduler retries every tick, and `lastStartedAt` stays null, which feeds I2.
- **Fix:** run `normaliseInput` inside `profileComplete`. Report the failing fields as "missing" (for example "a website address we can read"), or drop an invalid website when an Instagram handle exists.

### I6. Each profile save after a failed first plan starts another full run, with no limit (confidence: high)
- `maybeStartFirstPlan` (`planService.js:67-72`) only checks for a current plan and a run in flight. It ignores `firstPlanFailedAt`, `attempts`, `lastStartedAt` and the weekly refresh rule. Both `/auth/update-profile` and `/auth/complete-onboarding` call it.
- **Scenario:** an account whose plan fails QA every time. Each "Save" in Settings starts another model call. That gets around the 2-retry cap and the once-a-week refresh limit.
- **Fix:** in the hook, skip when `firstPlanFailedAt` is set or `lastStartedAt` is within the retry pause. Only start when the save changed the account from incomplete to complete.

### I7. The new blocks add dropped claims to the shared QA budget, so more Blueprints, including paid ones, fail (confidence: medium)
- Claims dropped from `icp` (up to 16 claims) and `effort.youDo` (up to 20) go into the same `ctx.dropped` list. `runQa` blocks the whole Blueprint when more than `MAX_DROPPED` (6) items are dropped (`qa.js:171-172`).
- The ICP "where" and "triggers" lines will often hold capitalised names and numbers ("Instagram", "Diwali", "within 2 days"), and the scanner drops those.
- The prompt is shared, so this raises the failure rate of customer-paid Blueprints too: they get refunded but get nothing.
- This contradicts Review Focus 1 ("the bad parts dropped, the run still succeeds").
- **Fix:** count drops from `icp` and `effort` separately, and leave them out of `too_many_removed`.

### I8. Batches of plan runs can delay paid customer Blueprints until they are failed as "took too long" (confidence: medium-high)
- Plan runs and customer runs share one in-process queue with `MAX_CONCURRENT_RUNS: 2`. The monthly tick queues up to 20 runs at once (`planScheduler.js:79`), and backfill adds 3 per minute.
- A paid Blueprint queued behind them can wait more than `STALE_MS` (8 minutes). The customer's poll then fails and refunds it as "This Blueprint took too long" (`service.js:331-333`). When its turn finally comes, `run()` finds it no longer queued and does nothing.
- **Fix:** give plan runs lower priority (a separate queue with 1 slot), or start no more than 1-2 plan runs per tick, spaced out.

### I9. The free Blueprint lookup misses every Blueprint made before this branch (confidence: high)
- `routes/plan.js:21` queries `{ kind: 'blueprint', ... }`. Docs created before this branch have no `kind` field, and a schema default does not apply to query filters.
- **Scenario:** an existing free user who already made their free Blueprint opens My plan. They see "Make my free Blueprint" instead of "Open my Blueprint". Clicking it ends in the 409 "already used" reply.
- **Fix:** use `kind: { $ne: 'plan' }`, as `list()` and staff Usage already do.

---

## Minor

- **M1. Starting a run is not atomic** (`planService.js:36-37`, `inFlight` then `startSystem`). Today the exposure is low: one Render instance, manual saves, and the 5-per-15-minutes refresh limit. A clash would cost one extra run (~Rs 5). The cheapest fix is an atomic claim on the user: `User.findOneAndUpdate({ _id, $or: [{ 'planState.lastStartedAt': null }, { 'planState.lastStartedAt': { $lt: now - 2min } }] }, { $set: { 'planState.lastStartedAt': now } })` before creating, instead of a partial unique index. Running more than one instance would also double every scheduler tick, because there is no leader lock.
- **M2. Plan runs use up the customer's own daily Blueprint cap.** `start()` counts all of the user's Blueprints in 24 hours, plan runs included (`service.js:182`). A new paying customer whose first plan ran today has 4 Blueprints left, not 5.
- **M3. Agency owner accounts get plan runs nobody sees.** Tier `agency` passes `shouldHavePlan` (`planRules.js:12-20`), so the hook and the scheduler build plans for owners, while `Layout.tsx` (`showsMyPlan`) hides My plan from them. This is wasted spend unless it is meant.
- **M4. The retry pass gets slower over time.** `failedFirst` (`planScheduler.js:36-47`) runs a `distinct` over every failed plan run ever, then 2 queries per user, on every tick, and the list never shrinks.
- **M5. A staff refresh blocks the customer's own refresh for 7 days.** It sets the customer's `lastRefreshAt` (`planService.js:59`). That may be acceptable, but say so on the staff card.
- **M6. A sed backup file was committed.** `backend/services/geminiAI.js-e` (5,542 lines, 243 KB, commit 030dd5c) holds the deleted `generateICPAndStrategy`. Remove it.
- **M7. Polling stops silently.** If one poll fails while the plan is building, polling stops: the effect re-arms only when `view` changes (`MyPlan.tsx` polling effect).
- **M8. The backfill script picks accounts the background gate blocks.** It does not exclude blocked accounts (frozen or orphaned agency clients). `startPlan` does not check the gate either, though the scheduler does.
- **M9. A plan run can be opened and paid for as a Blueprint.** `GET /api/blueprint/:id` returns a plan run to its owner, and `POST /:id/designed` would charge Quarks for a designed edition of it. That is the owner's own data, so it is acceptable, but confirm it is intended.

## Checked and fine
- **Customer routes:** `/api/plan` takes the user id only from the session, and `protect` swaps in the client for CSM and agency passes.
- **Staff routes:** `GET` uses `view_clients` and `POST` uses `open_client`, both through `clientFor` (CSM scope, `isCustomer`). The staff action is logged.
- **Free accounts:** never get a plan run, and their free Blueprint flow is untouched.
- **Staff and CSM accounts:** excluded in `shouldHavePlan` and in the scheduler query. Legacy accounts with no tier resolve to managed, which is eligible.
- **Planner:** `toClaim` downgrades any "verified" from the model. Inferences without real `factIds` become proposals. `nebulaaDoes` is filtered against `PLAN_NEBULAA_CAN`. A row with an invalid organic share is dropped, and an invalid paid share is set to 100 minus organic. The locked prompt was only extended (rules 9-10 and the shape).
- **Data:** account deletion covers `kind:'plan'` (dataRegistry deletes `Blueprint` by `userId`), and `planState` sits on the User document like other fields.
- **Old ICP endpoints:** retired with 410 responses. No frontend caller remains; only a mock in the visual-audit session still refers to it.
- **Backfill guards:** dry run by default, `--yes` to start, `CONFIRM_PROD` outside `nebulaa_dev`, `HARD_MAX` 200.
- **Wording:** no Quark or vendor words on the customer pages. The tags are spelled out in words, and the split bar has an aria-label.
