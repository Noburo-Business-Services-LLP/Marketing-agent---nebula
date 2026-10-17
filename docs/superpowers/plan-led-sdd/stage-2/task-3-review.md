# Task 3 review: weekly proposal storage and make-a-post wrapper

Reviewed: commits d1b3831 + ed3d084 (diff dfea803..ed3d084), current `backend/services/week/weekService.js`, `backend/models/WeeklyProposal.js`, and the code they call (`middleware/trialGuard.js`, `services/quarkBuckets.js` spend, `services/agency.js` walletBalance/resolvePayer, `services/backgroundQueue.js` generateSingleCalendarItem, `services/contentCalendarService.js`, `services/spendGuard.js`, `routes/drafts.js`).
Tests run (pure): `node --test tests/weekService.test.js tests/dataRegistry.test.js tests/creditAccessGuard.test.js`: 32/32 pass.

## Verdict

**Not ready for Task 5 as is. The structure is right, but the money handling has gaps.** The claim design is sound: one conditional `findOneAndUpdate` with `$elemMatch` plus the positional `$`, approve only claims, `runApprovedPosts` owns approved -> making, and the charge is carried on the item. The common path is correct: double Approve, two runners at once, generation throws, no pool. The gaps are in the less common paths:
- A refund that fails is still recorded as a refund.
- Refunds and final writes don't check who owns the post, so a takeover while the first runner is still working can double-refund or flip the state.
- The week is worked out from the clock on every call, not taken from the proposal.
- The spend guard is skipped.
- A post whose picture failed is refunded, but its draft stays in Review.

All of these fixes are small.

## Findings

### Important

**I1. A failed refund is treated as a success, and the charge flag is cleared anyway.** `weekService.js:197-199`
`refundCredits` never throws: on any error it returns `{ success: false }` (`trialGuard.js:236-239`). `refund()` ignores the result and always sets `charged: false`. The `try/catch` around it is dead code for the real dependency.
- Failing scenario: a database blip during the refund. The customer has paid 11 Quarks, the item is `failed` with `charged: false`, and a retry charges again. The money is lost silently with no record.
- Confidence: high.
- Fix: `const r = await deps.refund(...); if (r && r.success) setItem(charged:false) else log and keep charged:true`. Then a retry of that item is free (the charge carries over), which is the behaviour the code comments intend.

**I2. Taking over a stale post while the first runner is still alive can double-refund, give away a post, or flip a made post back to failed.** `weekService.js:182, 197-213, 254`
- `claimStale` moves ownership correctly. But runner A, which is slow (more than 10 minutes) and still running, keeps writing with the unconditional `setItem` (arrayFilters on `id` only) and refunds without checking who owns the post. Runner B read `charged: true`, so it doesn't charge. That part is correct.
- What can go wrong, in order:
  - (a) Both fail: A refunds and B refunds again. That is **two refunds for one charge**: the customer gains 11 Quarks.
  - (b) A succeeds, then B fails: B refunds, so the customer gets A's post free, and B overwrites `made` with `failed`. The card says it failed while a draft exists. A re-approve then charges again and makes a third draft.
  - (c) A fails and refunds, then B succeeds: the post is `made` and free.
  - (d) Both succeed: two drafts and one charge.
- Generation is LLM text (60 s timeout plus retries) and then the image (90 s timeout plus retries), so a run over 10 minutes is rare but possible: event-loop stalls, retry storms, provider slowness.
- Confidence: high that the logic is wrong; low-to-medium on how often it happens.
- Smallest fix:
  - Pass the claim's `makingAt` (the `at` value) into `makePost` as an ownership token.
  - Do every final write (`made`, `failed`, `charged`) as a conditional update matching `items: { $elemMatch: { id, status: 'making', makingAt: token } }`. If it matches nothing, this runner lost ownership: write nothing and refund nothing. A draft it may have made is left as is, and it should log.
  - Make the refund itself conditional: flip `charged: true -> false` with `$elemMatch: { id, charged: true }` first, and call `refundCredits` only if the flip won. If the refund then fails, flip it back. That alone rules out a double refund on every path.

**I3. The week is recalculated from the clock on every call, not taken from the proposal.** `weekService.js:152, 179, 244, 257`
- `runApprovedPosts({ user, now })` passes `now` (normally `undefined` from a route) to `makePost`, which recalculates `keyOf(user, now)` from `deps.now()`. A sequential run that crosses Monday 00:00 IST sends `setItem` to the new week's key. Those are silent no-ops, because the new document doesn't exist or its item ids differ (`2026-10-19:n`).
- Result: `charged: true` and `made` are never stored, and the old item stays `making` forever. Nothing ever looks at the old week again, because every later call derives the new week, so a charged post that failed in the gap is never retried. And if anyone later recovers it, `charged: false` means it would be charged again.
- The same applies to Approve on Sunday at 23:59 followed by a run after midnight: the approved posts are never made. That is no charge, but it fails silently.
- Confidence: high (the window is a few minutes per week per account).
- Fix:
  - `makePost` should take `q` (or `weekStart`) from the caller.
  - `runApprovedPosts` should use the document's `weekStart`.
  - `approve` / `change` / `runApprovedPosts` should accept an explicit `weekStart` (the week the customer is looking at), and the Task 5 route should pass it.
  - Crash recovery should look for any proposal with items in `approved` or stale `making`, not only the current week.

**I4. The spend guard (daily ceiling and provider switches) is skipped.** `weekService.js:190-195`
- Every other paid path checks `spendGuard.check(action)` before generating: `requireCredits` (`trialGuard.js:134`), blueprint, heroVideo, studioVideos. `deductCredits` / `quarkBuckets.spend` only *record* spend (`quarkBuckets.js:101`); they never refuse.
- Result: weekly posts keep generating when the owner has switched the image provider off or the daily ceiling has been reached. This matters most once Task 5 runs `runApprovedPosts` on a schedule.
- Confidence: high.
- Fix: add a `deps.spendCheck('image_generated')` step before the charge. If it is not ok, release the post (`making -> approved`, or `failed` with error `busy`) and charge nothing.

**I5. A post whose picture failed is refunded, but its draft stays in Review and approve, and so does a stuck "processing" draft.** `weekService.js:104-109, 209-212`; `backgroundQueue.js:37-50, 96-152`
- With an empty image, the generator still saves a `completed` Draft with `imageUrl: ''`, creates a Campaign with status `draft`, and marks the calendar row `generated` with `generatedDraftId`. The `generate` dependency then saves that row.
- `GET /drafts?status=draft` lists `draft|processing|completed|failed` (`routes/drafts.js:55`). So the customer sees a text-only post they were refunded for, can approve or publish it free, and the week card at the same time says "could not be made, try again". A retry makes another draft, so the duplicates pile up.
- When the text LLM throws, the pre-created draft stays `processing` forever (the generator's `catch` never marks it), and the week has refunded.
- Image failures are a common real event.
- Confidence: high.
- Smallest fix, in the `generate` dependency (weekService.js:104):
  - If `out.draft` has no `imageUrl`: delete that Draft and `out.campaign` (`Draft.deleteOne`, `Campaign.deleteOne`), and **don't** call `calendar.save()`, so the calendar row is not marked generated. Then return, and `makePost` refunds as it does today.
  - For the throw case, the cleanest fix is a one-line change in `generateSingleCalendarItem`: hoist `draft` above the `try` and, in the `catch`, `if (draft) await Draft.updateOne({_id: draft._id}, {status: 'failed'})`. A failed draft is an existing, visible state (with a paid retry in `routes/drafts.js:703`). If the owner doesn't want a visible failed draft for weekly posts, delete it instead.
  - Alternative that touches only weekService: record a start time and, on a throw, delete `Draft` rows matching `{ userId, status: 'processing', calendarDay, createdAt >= start }`.

**I6. A calendar row that was already made is made, and charged, again.** `weekService.js:184-195`
- `calendarItemsForWeek` skips generated rows only when the proposal is built. `makePost` never re-checks `calItem.generatedDraftId` or `status`.
- Meanwhile `processAutoGeneration` (runs every minute, free) makes "today's" row for any calendar with `autoGenerate`. The drafts regenerate route, and "generate this week", use the same generator.
- Failing scenario: the proposal is built on Monday, auto-generation makes Wednesday's row free on Wednesday, then the customer approves on Wednesday. The week path charges and makes a duplicate.
- Confidence: medium-high.
- Fix: after `ctx.find`, if `calItem.generatedDraftId` is set, or its status is `generated`/`scheduled`/`published`, mark the item `made` with `ref = generatedDraftId` and charge nothing.

**I7. A failure right after a successful charge loses the money.** `weekService.js:192-194, 257`
- If `setItem(q, id, { charged: true })` throws after `deduct` succeeded, `makePost` throws. `runApprovedPosts` then marks the item `failed` with no refund and `charged: false`, so the customer has paid and a retry charges again. The same thing happens on a process crash between those two lines: a stale takeover sees `charged: false` and charges a second time.
- Confidence: high on the logic; low on how often it happens.
- Fix:
  - Wrap that write: if it fails, refund at once (using the I2 conditional flip) and fail the post.
  - Optionally store the charge before deducting (flip `charged false -> true` conditionally, deduct, and flip back if the deduct is refused). A crash then fails in the customer's favour, never with a double charge.

### Minor

- **M1. Swap race.** `weekService.js:273-275`: the "still proposed" check and the topic write are two separate writes. An Approve that lands in between leaves an approved item whose topic changes after approval. Fix: one write, `claimItem(q, itemId, 'proposed', 'proposed', { topic: t })`.
- **M2. Refunds go to whoever pays now.** `weekService.js:192, 198`: `deductCredits` returns `payerId`, but it isn't kept, so `refundCredits` resolves the payer at refund time. A client moved or removed between the charge and the refund would be refunded to the wrong wallet. Fix: store `chargedTo: paid.payerId` on the item and pass `{ payerId }` to the refund (`refundCredits` already supports it).
- **M3. Approve and run don't check eligibility.** `approve` / `runApprovedPosts` (`weekService.js:218, 243`) don't re-check `shouldHavePlan` or `backgroundGate`: a downgraded account, or one pending deletion, can still make an existing week. A frozen client is refused by `spend`, so that case is fine. Task 5's route and scheduler must gate on these, and a scheduler must exclude `backgroundGate.blockedAccountIdsSafe()` the way `processAutoGeneration` does.
- **M4. Wrong day on plan-sourced posts.** `weekService.js:120-121`: the day comes from the item's *index* modulo 7, not the plan entry's day. This is cosmetic only (`draft.calendarDay`/title). Store the day on the item in the proposal instead.
- **M5. Remaining items can't be skipped after a partial approve.** `skipWeek` refuses once the week is `approved`, so after a partial Approve the remaining proposed items can't be skipped in bulk (`change` still skips them one at a time). Decide this in Task 5.
- **M6. Saving the calendar can turn a made post into a refunded one.** `calendar.save()` inside `generate` (weekService.js:107): if it throws after a draft was made, `makePost` refunds and fails the post although the post exists. Catch and log the save error separately.
- **M7. A lost deduct response looks like "no pool".** If the spend update applied but its reply was lost, `deductCredits` returns `success: false` and the post is failed as `no_pool` with no refund. Nothing in this design can avoid it without transactions. Note only.
- **M8. Report wording.** The report says the plan's 30-day cycle runs from the plan's completion day, but the code counts from the Monday of that week (`weekService.js:62`). That is harmless; just align the comment or the report.
- **M9. The unique index depends on Mongoose autoIndex.** No `syncIndexes` exists anywhere. Given the Atlas disk ceiling, an index build failure would be silent and the duplicate-key safety net would be missing. Confirm the index exists on dev and prod after deploy (`db.weekly_proposals.getIndexes()`).

### Pre-existing, outside this task (report to the owner, do not fix here)

- `processAutoGeneration` (`contentCalendarService.js`, runs every 60 s) skips today's row only when it is `rejected`/`published`/`scheduled`, **not `generated`**. So it makes the same day again every minute until the monthly cap (default 7) is spent: about 7 duplicate free posts within ~7 minutes. This is alongside the cost leak the implementer already reported (auto-generation is free for paying accounts).

## Checks that came out correct

- **Atomic claims.** The claim is atomic with real MongoDB: a single-document `findOneAndUpdate` with `{ items: { $elemMatch: { id, status: from } } }` and `$set: { 'items.$.status': to }`, where the positional `$` resolves to the element the `$elemMatch` matched. Item ids are unique per document. Mongoose 8 returns the original document when it matches, so `!!r` is correct. `claimStale` is correct too: `makingAt: { $lt: before }` inside the same `$elemMatch`, `before = at - 10 min`, a Date against a Date, the field names match the schema, and `makingAt` is restamped on every claim, per item, not once per run.
- **The charging paths.** These are correct:
  - Double Approve.
  - Two runners at once.
  - A crash after charging (with `charged` stored), then takeover: no second charge.
  - Generation throws: one refund.
  - A failed post re-approved: charged again only if the earlier charge was refunded.
  - No pool: no generation, no refund.
- **Payer.** The charge goes through `quarkBuckets.spend`, which uses `resolvePayer` (the agency pool for a client workspace, refused for a frozen client). The pool is read through `walletBalance`. There is no `credits.balance` access in `services/week/*`, and `creditAccessGuard` passes.
- **getOrCreate.** It is idempotent, the duplicate-key race re-reads the winning document, an empty pool is not stored, and an existing week is returned unchanged.
- **Eligibility.** Free, staff/CSM, deletion pending, inactive and incomplete profiles are excluded. A missing tier resolves to `managed` and is included. A workspace mirrors `agency`.
- **Week boundary.** Monday in Asia/Kolkata.
- **Data registry and User.** `WeeklyProposal` is listed as erasable in `dataRegistry` (the test passes). `User.setup` was added. `markFirstApproval` is conditional on `$exists: false`.
- **Costs** come only from `QUARK_COSTS`.

## Test quality

- **The fakes hide two Mongo behaviours.**
  - The fake `find` returns the *live* stored object. With Mongo, `.lean()` returns a snapshot, so `it.charged` / `it.status` in `runApprovedPosts` can be stale; the fakes never show this.
  - The fake `claimItem` / `claimStale` are atomic only because JavaScript runs one thing at a time. They prove the service's logic, not the Mongo query.
- **The "concurrent" tests are logic tests.** They interleave at `await` points over a perfect store.
- **Paths with no test at all:**
  - A refund that returns `{ success: false }` (I1).
  - A takeover while the first runner is still running, then finishes, either way (I2).
  - A Monday rollover during a run (I3).
  - The spend guard (I4).
  - Generator-made rows (I6).
  - A failed `setItem(charged)` (I7).
  - The real `generate` dependency (draft cleanup, calendar save).
- **Unit tests to add**, using the existing fakes:
  1. Refund returns `{ success: false }`: expect `charged` to stay true, and a retry not to deduct.
  2. A takeover race. A deferred `generate` for runner A; advance `now` by 11 minutes; run B to completion; then let A resolve or reject. Expect deducts = 1, refunds no more than 1 (and only if no draft exists), and the final status set by B only.
  3. `runApprovedPosts` with `deps.now` advancing past Monday 00:00 IST between posts: every write lands on the original week.
  4. `spendCheck` refused: no deduct, no generate.
  5. The calendar row already has `generatedDraftId`: no deduct, item `made` with that ref.
- **Real-database check** (needs the owner's OK; `nebulaa_dev` only; throwaway userId; no model or credit calls). This is a script that requires `models/WeeklyProposal` and the default `store` from `defaultDeps()`, and checks the following:
  1. `await WeeklyProposal.init()`, then `getIndexes()` includes the unique `{userId:1, weekStart:1}`.
  2. Two `store.create` calls for the same key: the second throws `code === 11000`.
  3. Create a document with 3 items. Run `Promise.all` of 20 calls to `store.claimItem(q, 'W:0', 'proposed', 'approved', {approvedAt: new Date()})`. Expect exactly one `true`, with item 0 `approved` and items 1-2 untouched.
  4. `claimItem(q, 'W:1', 'approved', 'making', {makingAt: new Date(Date.now() - 11*60e3)})` returns false (wrong `from`). Set item 1 to `making` with a `makingAt` 11 minutes ago. Then `Promise.all` of 10 calls to `store.claimStale(q, 'W:1', new Date(Date.now() - 10*60e3), new Date())`: exactly one `true`. A second round with the same `before` gives 0, because `makingAt` is now fresh.
  5. `store.setItem(q, 'W:2', {charged: true, error: 'x'})` changes only item 2.
  6. After the I2 fix, the same `Promise.all` pattern for the conditional refund flip: exactly one winner.
  7. Delete the throwaway document.

## Must fix before Task 5

1. **I1**: check the refund result; clear `charged` only on a successful refund.
2. **I2**: an ownership token (`makingAt`) on every final write, plus a conditional flip of `charged` true -> false before any refund, so there is at most one refund and a runner that lost ownership never writes.
3. **I3**: take `weekStart` from the proposal through `approve` / `change` / `runApprovedPosts` / `makePost`, never recalculated from the clock mid-run. Crash recovery must cover earlier weeks.
4. **I4**: `spendGuard.check('image_generated')` before charging.
5. **I5**: on a missing image, delete the draft and campaign and don't mark the calendar row generated; on a throw, don't leave a draft stuck in `processing`.
6. **I6**: if the calendar row is already generated, adopt that draft and charge nothing.
7. **I7**: refund at once if storing `charged: true` fails after a successful charge.
8. Add the unit tests above, and run the real-database check on `nebulaa_dev` once the owner agrees.
9. For Task 5 to own: gate approve and run on eligibility and `backgroundGate` (M3), and record `payerId` (M2). Ideally do M1 now too, since it is a one-line change.
