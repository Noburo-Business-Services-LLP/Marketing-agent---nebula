# Task 3 report: weekly proposal storage and make-a-post wrapper

## Investigation answers
1. `generateSingleCalendarItem` does NOT charge. No deductCredits/quarkBuckets.spend in backgroundQueue.js, and none in the image path (`generateCampaignImageNanoBanana`/Core in geminiAI.js), imageUploader, creativeDirector, logoOverlay or postFrames.
2. `processAutoGeneration` does NOT charge: it calls the same generator after only a block-list and a per-month count cap (`autoGenerateLimit`, default 7). So monthly auto-generation of calendar posts is currently FREE for paying accounts (a cost leak: image + text per post). Same for `POST /:id/auto-generate-week` (queue) and the drafts regenerate route (`routes/drafts.js:393`). Only the calendar REEL route (`/items/:itemId/auto-generate`) charges (`campaign_full`). Not changed here.
3. The generator creates a `Draft` (not ContentDraft), status 'completed' (and a Campaign status 'draft'). `GET /drafts?status=draft` includes status draft|processing|completed|failed, so it lands in Review and approve. `ref` = `out.draft._id`. The generator swallows image errors (draft saved with empty imageUrl), so makePost treats a draft with no imageUrl as failed and refunds (the empty draft stays in /drafts).

Hence makePost charges `image_generated` x1 before generating and refunds on failure, as the brief says.

## What was built
- `models/WeeklyProposal.js` (collection weekly_proposals, unique index userId+weekStart), `User.setup`, dataRegistry rule (delete), `services/week/weekService.js`, `tests/weekService.test.js` (brief tests plus retry, made-never-again, no-image refund, empty-not-stored, no_plan, duplicate-key race, plan-sourced post, skipWeek, prefills).
- Eligibility: `shouldHavePlan(user)` else `{eligible:false, reason:'not_eligible'}`; then needs calendar rows for the week OR plan calendar entries (from `currentPlan().result.plan.calendar`, 30-day cycle from the plan's completion day); neither gives `{eligible:false, reason:'no_plan'}`. Pool via `walletBalance`; no `credits.balance` read (creditAccessGuard passes, no whitelist).
- A pool that pays for nothing returns `{proposal (unsaved, items: []), reason:'empty'}` and is NOT stored, so a top-up can still make the week.
- Plan-sourced items (no calendar row): made from a one-off in-memory calendar plus synthetic row `{headline: topic, creativeConcept: topic, format:'image post'}`, no month generated, no extra cost. `no_calendar` is used only if a calendar-sourced item's calendar has vanished (checked before charging).
- Claims are single conditional `findOneAndUpdate` with `$elemMatch`; failed posts claim failed->approved on retry; made/skipped never move. Swap on a calendar-sourced item writes the new topic into the calendar row before generating.
- Costs (`defaultCosts`, from QUARK_COSTS): post = image_generated (11), carousel = 5 x carousel_generated (40), video = video_base + 5 x video_generated (552).

## Concerns
- Video 552 Quarks is nearly the whole Starter pool (600): the proposal will almost always drop videos first. Owner may want a different video price basis.
- A crash between the claim (approved) and makePost leaves a post stuck 'approved' (not charged yet if before deduct, but never made). Task 5's scheduler/route should retry stale approved posts via makePost (makePost itself is safe to re-run: charge happens inside it).
- approve awaits each image sequentially, so the HTTP request can be long; the route (Task 5) may want to not await the response.
- `User.setup.firstWeekApprovedAt` is not stamped by the service; the route should do it.
- The auto-generation cost leak above.

## Controller rulings (commit "fix(week): ...")
1. `weekCosts()` in weekService.js (`defaultCosts` kept as alias), only from QUARK_COSTS: post = image_generated = 11; carousel = 5 slides x carousel_generated (8) = 40 (the carousel route charges `carousel_generated` x slideCount, default 5, same as the Create screen's `useState(5)`); video = studio_video = 161. Test asserts equality with config.
2. `approve` now only claims (proposed|failed -> approved with approvedAt) and returns at once with proposal + prefills; it never generates or charges. New `runApprovedPosts({user, now})` claims approved -> making (conditional, stamps makingAt), then makePost -> made|failed; it also takes over posts `making` for over 10 minutes via a conditional `claimStale`. No separate retryStale (folded in). New item status `making`, plus fields approvedAt, makingAt, charged. Charge happens in makePost when a post is picked up; `charged: true` is set on success and skipped if already set; cleared on refund. Tests added for all the requested cases.
3. `approve` calls `deps.markFirstApproval` (conditional `setup.firstWeekApprovedAt $exists:false`) when at least one item was claimed; tested.
Concerns: a stale-making post may already have produced a draft before the crash, so a retry can leave a duplicate draft (never a double charge). The route must call runApprovedPosts after approve (fire and forget) and should also call it on a schedule/page load for crash recovery. I implemented before writing the new tests (not strictly test-first).

## Review fixes (I1-I7, M1, M2) - commit "fix(week): ..."
- I1: refund result checked; `charged` cleared only on success. On failure: charged stays true, item failed 'refund_failed', owner alert via `opsAlerts.notify` (same pattern as the Blueprint service), never re-charged.
- I2: `makingAt` is the ownership token; `settleItem` and `flipCharged` are single conditional updates on `status: making` + same `makingAt`. A runner that lost the post writes and refunds nothing. `charged` flips true->false before any refund, so one actor refunds.
- I3: week taken from the stored proposal in approve/change/skipWeek/makePost; `runApprovedPosts` walks every open proposal of the last 14 days (`findOpen`) incl. stale `making`.
- I4: `spendGuard.check('image_generated')` before charging; refused -> item back to `approved`, run stops with `busy: true`.
- I5: real `generate` deletes the Draft and Campaign when there is no image and skips saving the calendar row; a calendar save error is logged, not fatal (M6). `generateSingleCalendarItem`'s catch now marks its draft `failed` (3-line edit in backgroundQueue.js, test in queueDraftFailed.test.js).
- I6: a calendar row already made is adopted (item `made`, ref = its draft), no charge.
- I7: if `charged: true` cannot be stored after a charge, refund immediately to the charged wallet and fail the post.
- M1: swap is one conditional update. M2: `chargedTo` stored from the charge's `payerId`, passed to refund.
- Tests added: weekService (I1, M2, I2 takeover, I3 Monday, I4, I6, I7, M1), weekGenerate.test.js, queueDraftFailed.test.js. Full suite 1382 pass / 0 fail. Implementation was written before the new tests again (not strictly test-first).
- Still open (for Task 5 / owner): M3 (route/scheduler must gate on eligibility and backgroundGate), the real-database check, unique-index confirmation after deploy. Pre-existing, not touched: `processAutoGeneration` skips today's row only when rejected/published/scheduled (not generated), so it re-makes the same day every minute until the monthly cap, free of charge.

## Final-review fixes (I1, I2, M1, M3, M4, M5, M7, M10, M13) - commit "fix(week): ..."
- I1: `calendarRowCountForWeek` dep (all rows for the week's days, any status). Plan fallback only when it is 0; rows present but none open -> unsaved empty proposal with `reason: 'nothing_left'` (eligible true).
- I2: `markMade({ user, itemId, ref, weekStart })` (approved -> made via one conditional claim; carousels/videos only; idempotent, first ref stands; refuses proposed/skipped/unknown/other account's item). Route `POST /api/week/items/:id/made` body `{ ref, weekId? }` (write guards: staff refused, switch, write limiter; ref 1..100 chars). Prefills carry `prefill.weekItemId` and `prefill.weekId` (= weekStart).
- M1: GET runs only for an approved post or a post `making` for over 10 minutes. M3: gate read failure is caught, run skipped, GET stays 200. M4: `approve({ stampFirst })`, route passes false inside CSM/agency/staff passes.
- M5: `attempts` on items (counted when a run claims the post); after 3 failed attempts `error: 'gave_up'`; approve skips such items and returns `message` 'We could not make this post. Please try again later or contact support.' (route 409 when nothing else was claimed). `no_pool` and `refund_failed` keep their own error.
- M7: `recoverOpenWeeks({ limit, now })` + `services/week/weekRecovery.js` (`startWeekRecovery`: first pass after 60 s, then every 15 min, non-overlapping, off with NODE_ENV=test or ENABLE_WEEK_RECOVERY=off) started in server-main.js beside the other schedulers.
- M10: plan entry without hook uses the pillar as topic. M13: `languageOf` = `normalizeLanguage(businessProfile.contentLanguage)`, English fallback.
- Tests: weekService, weekRoutes, weekProposal, new weekRecovery (70 week tests pass). Full suite: 1422 pass, 6 fail, all 6 in the other agent's uncommitted `tests/calendarAutoGeneration.test.js` (in progress, not mine; I did not touch contentCalendarService.js or routes/contentCalendar.js). Written implementation-first again.
- Frontend (not done here): the create screens must call `/api/week/items/:id/made` with `prefill.weekItemId`/`weekId` and the created id; the card should show 'nothing_left'. Recovery treats an `approved` post as stale after 10 minutes from `approvedAt`.
