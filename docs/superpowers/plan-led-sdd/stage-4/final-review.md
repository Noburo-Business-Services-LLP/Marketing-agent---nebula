# Stage 4 final review: competitor tracking and weekly insights

Reviewer: final read-only review, 2026-10-17. Scope: `fb098dc~1..d9a576a` (10 commits, 42 files). I checked every claim against the code, not against the reports.
Test evidence (run during this review): backend `node --test tests/*.test.js` 1487 pass, 0 fail. Frontend `node --test tests/*.test.mjs` 360 pass, 0 fail.

**Overall verdict: not ready to release yet. No Critical findings. 13 Important and 10 Minor.** Account isolation, entitlement and erasure hold. Daily cost is capped in normal running, but the cap leaks in four specific situations (I1 to I4). Some insight sentences can be stale or wrong (I6). Two customer-facing problems break owner rules or leave the customer stuck (I9, I10).

| Area | Verdict |
|---|---|
| 1. Cost caps | PASS WITH FIXES (I1, I2, I3, I4, I11, I12, I13) |
| 2. Entitlement | PASS |
| 3. Isolation and privacy | PASS (handle trust issue I8) |
| 4. Correctness | FAIL until I5, I6, I7 are fixed |
| 5. Erasure | PASS (M6) |
| 6. Wording and UI | FAIL until I9, I10 are fixed |
| 7. Test quality | WEAK in the places that matter (see section 7) |

---

## 1. Cost caps

What holds:
- **5 per account.** `tracker.js:182-185` takes the five newest eligible competitors.
- **200 a day.** `tracker.js:191-192` checks `max(stored + passReads, fresh readsToday)` before every read.
- **Spend guard.** It is called around every read: check at `tracker.js:193`, record at `:200`. `competitor_scrape` maps to `apify_scrape` in `spendGuard.js:21-23`, so the staff switch card, `AI_KILLED` and the daily USD ceiling all apply. The Quark cost stays 0 (`apiCosts.js:372`).
- **Env switch.** `ENABLE_COMPETITOR_TRACKER=off` and `NODE_ENV=test` turn the tracker off (`tracker.js:216`).
- **No overlap in one process.** The `running` flag stops two passes overlapping inside one process.
- **One read a week.** In normal running a competitor is read at most once per India-time week, at least 12 h apart (`isDue`, `tracker.js:124-143`).
- **Bounded cost.** At the configured caps the tracker costs at most 200 x USD 0.0023, about USD 0.46 a day (about USD 14 a month), whatever the number of accounts.

**I1 (Important): when database writes fail, every pass reads the same competitors again and the daily ceiling stops working.** `tracker.js:100-116`, `:128-139`, `:166`, `:191`.
- The Atlas cluster has already hit its write-blocking disk ceiling once. When that happens, `store.save` throws and `saveTracking` throws (the error is swallowed at `:116`). `spend.record` also fails (`spendGuard.js` logs and returns null), so the USD ceiling never moves.
- The next pass reloads the competitors from the database without `tracking.lastCheckedAt`, and finds no row in `lastAttempt` either. Every competitor is due again.
- `readsToday` stays at the old count, and `passReads` resets at the start of every pass. So each 6-hourly pass can read up to 20 accounts x 5 competitors = 100 again, about 400 reads a day, twice the 200 ceiling. These are repeated reads of the same competitors.
- Test (k) covers only "save throws, saveTracking works". Nobody tested both failing.
- Fix: keep an in-process map of competitor id to read time and a per-UTC-day read counter that does not depend on database writes. Stop the pass on the first failed save.

**I2 (Important): `readsToday` counts snapshot rows, not reads, so a second read in the same week is not counted.** `snapshotStore.js:21` and `:41`, `tracker.js:191`.
- Rows are upserted on `competitorId + weekStart`. Any re-read in the same week overwrites the existing row, so the count does not go up. The store test "saving the same week twice keeps one row" confirms this behaviour.
- Re-reads in the same week happen on a handle change (`applyHandleChange` clears `lastCheckedAt`, and `isDue` treats `changed` as due), on a forced staff check, and with two server instances (I3).
- Fix: count reads in an append-only or `$inc` counter, for example a per-day reads document or a `byProviderCount` field on `AiSpendDay`, and cap on that.

**I3 (Important): nothing stops two server instances running the tracker at the same time.** `tracker.js:24` and `:151`.
- `running` is a module variable, and no other scheduler in `server-main.js` has a lock either.
- With two instances (horizontal scaling, a long rolling deploy, or a second backend pointed at the same database), a pass that starts during another one quickly skips the accounts already done. It then catches up and runs in step with the other pass. Each due competitor is read twice, because a read takes up to 2 minutes and `isDue` is checked before either save lands.
- Each process caps itself at about 200, so the total can reach about 400 a day. I2 hides the duplicates in the row count.
- Fix: a lease document (`findOneAndUpdate` with `lockedUntil`) around `runTrackerOnce`, or claim each competitor atomically (`tracking.claimedAt`) before reading it.

**I4 (Important): the tracker is on by default in every environment except tests, so a local dev backend spends real money without the owner's approval.** `tracker.js:216`.
- `.claude/launch.json` starts the backend with `npm run dev` and does not set `ENABLE_COMPETITOR_TRACKER`.
- Every entitled account in `nebulaa_dev` with a handle and no good read this week gets a real paid read 20 minutes after start. That includes managed or legacy accounts with no `plan.tier`, which `resolveTier` treats as `managed`.
- `ui-check-report.md` admits this may have happened during the browser check ("I cannot prove no pass ran"). That breaks the "one real scraper spend needs the owner's OK" rule.
- Fix: make the tracker opt-in (`ENABLE_COMPETITOR_TRACKER=on`, or on only when `NODE_ENV=production`). Check the dev `AiSpendDay` row for `apify_scrape` to find out whether any read happened.

**I11 (Important): with 1,000 entitled accounts, a fixed group of accounts is served every week and the rest are never read.** `tracker.js:42-45` and `:172`.
- `accounts()` returns the first 500 users by `_id` whose tier is not free. That list includes Starter and Professional accounts without the add-on, which are only filtered out later. Accounts after position 500 are never considered.
- A pass reads at most 20 accounts (`limit`), and there are 4 passes a day: 80 accounts a day. The 200 reads a day allow about 280 accounts a week at 5 competitors each.
- Every pass starts again from the lowest `_id`, so the same low-`_id` accounts are served every week and the others never get a first result, even though they pay for the add-on.
- Cost stays capped. Coverage and fairness do not.
- Fix: put the entitlement filter in the query (`plan.addons` / tier) and order by the oldest last check (a stored `competitorsCheckedAt` per user, or a cursor). Drop the hard 500.

**I12 (Important): the per-account cap is "5 at a time", not "5 reads a week".** `tracker.js:182-185`.
- New competitor ids are always due. `add-manual` has no count limit (`routes/competitors.js:573-631`), and re-running auto-discover deletes and recreates the auto-discovered competitors (`routes/competitors.js:84`, plus `auth.js:170`, `brand.js:238`, `dashboard.js:95`).
- So one account that keeps adding or re-discovering competitors gets up to 5 reads per pass, 20 a day. Ten such accounts use up the global 200 a day for everyone else.
- Fix: a per-account weekly read budget (for example 5 plus 2 spare), counted the same way as I2.

**I13 (Important, existing before this stage, but the stage's claims depend on it): the "Competitor checks" switch and the 200 a day cap cover only the tracker.**
- The customer-triggered scrapes in `routes/competitors.js` do not call `spendGuard` at all: the background post fetch after add or discover (`:203`, `:616`, `fetchPostsForCompetitors` `:458`), handle finding (`:366`, `:396`, `:429`), and `/scrape-by-type`.
- The tracker header comment (`tracker.js:4`, "This is the only place scraper reads are spent") and handover 9 say otherwise.
- So if the owner switches "Competitor checks" off during a cost scare, the dearer post-scraper calls keep running.
- Fix: route these calls through the same check and record, or at least correct the comment, the handover and the staff card text (`StaffAiSpend.tsx`, "The weekly competitor checks").

## 2. Entitlement: PASS

- **Tracker.** It calls the real `canUse(user,'competitors')` per account (`tracker.js:48`, `:177`). It also skips free, inactive, not onboarded, staff and CSM accounts, and accounts blocked by `backgroundGate`. A gate read failure skips the whole pass, which is the correct cautious choice (`:160-161`).
- **Customer route.** `protect`, then the limiter, then `requireFeature('competitors')`. That middleware loads the user from the database (`requireFeature.js:20`). Free, Starter and Professional without the add-on get 403 with the standard message. The route test runs the real gate.
- **Agency client workspaces.** They are created with the agency's tier and add-ons (`agencyWorkspaces.js:44-53`), so each one is entitled, tracked separately, and costs up to 5 reads a week. An agency at the 25-client maximum costs up to 26 x 5 = 130 reads a week, about USD 0.30. Frozen clients, clients of an ended agency plan and clients of an agency waiting for deletion are blocked by `backgroundGate`. This matches the spec. It does make I11 and I12 worse, because one agency can use 130 of the roughly 1,400 weekly reads.
- **Staff routes.**
  - `GET /clients/:id/competitors` uses `requireStaff('view_clients')` and `clientFor` (scoped by `can(...)`).
  - `POST .../check` uses `requireStaff('open_client')`, `clientFor(..., 'open_client')`, a 20 per 15 minutes limiter, and `recordStaffAction` with `check_competitors`.
  - The GET is not logged, which matches the other staff GET views (M8).

## 3. Isolation and privacy: PASS

- **Own data only.** `viewFor` (`competitorInsights.js:48-82`) queries competitors by the signed-in user's id. It filters `String(c.userId) === userId` again, reads snapshots only by those competitor ids, and drops any row with a different `userId`.
- **Minimal response.** The body holds names, handles, status, trend numbers and sentences only. No raw snapshot, follower count, error text or `userId` (the route test checks this).
- **Server-side user.** The user is loaded server-side, by `protect` and again in `requireFeature`. Demo tokens have no id, so they get 401.
- **Provider errors.** Raw provider errors are never stored. They are mapped to "Could not read this profile" or "This account is private" (`tracker.js:70`, `:89-95`). Save errors are logged by message only.
- **SSRF and injection.** I found no SSRF. The handle goes only into the JSON body of the actor input (`socialMediaAPI.js:1124-1127`), never into one of our URLs or a database query operator. React escapes it on display.
- **Stored data.** Kept small: counts, averages, format counts, five hashtags, and one top post (public URL plus a 160-character caption).

**I8 (Important): handles are not verified or validated, so the tracker can pay to read the wrong account and show it under the competitor's name.**
- Spec decision 4 says the tracker reads only competitors with a verified handle. In the code, `handleOf` (`tracker.js:26`) accepts any stored string.
- Auto-discover falls back to the model's guess when the handle search finds nothing (`routes/competitors.js:165-167`). So a guessed handle (another brand, an unrelated person, or a value like `n/a` or a URL) is read every week. The customer then sees "Sweet Co gained 300 followers" built from someone else's profile.
- Garbage handles cost 3 weekly reads each before the pause.
- Fix: check `^[A-Za-z0-9._]{1,30}$` before reading. Add a `socialHandles.instagramVerified` flag, set where `validateProfileMatch` passes (`routes/competitors.js:399-406`, `:432-439`), and track only verified handles.

## 4. Correctness

What holds:
- **Week key.** `weekStartOf` gives Monday in India time (`weekMath.js:10-14`).
- **Upsert per week.** It works and keeps a good row over a failed one (`snapshotStore.js:8-22`).
- **Zero division.** Division by zero is guarded (`Math.max(...,1)`, `prevAvg > 0`).
- **First snapshot.** A first snapshot gives the "started tracking" note.
- **Nested-key scan.** I checked every new schema:
  - `CompetitorSnapshot.topPost` is now an explicit sub-schema, and the test validates a real `summarise()` output.
  - `formats {image, video, carousel}` and `Competitor.tracking {failures, pausedAt, lastCheckedAt, lastHandle}` have no `type` key or other reserved key.
  - No other trap found.

**I5 (Important): the competitors that are read are not the competitors that are shown.**
- The tracker drops no-handle and paused competitors before taking the five newest (`tracker.js:182-185`). The route takes the five newest regardless (`competitorInsights.js:53-56`).
- Example: an account has 7 competitors and the 2 newest have no handle. The tracker pays to read the 3rd to 7th newest. The card shows the 2 newest as "Add their Instagram handle" plus the 3rd to 5th. The 6th and 7th are read every week and never shown.
- Paused competitors cause the same mismatch.
- Fix: one shared `trackedCompetitors(list)` function used by both.

**I6 (Important): old numbers are shown as "this week".** `snapshot.js:101-122`.
- `sentencesFor` compares `snaps[0]` with `snaps[1]`, the two newest good snapshots, whatever their `weekStart`. Only the best-post sentence checks the date.
- Example 1: a competitor read well in early September, then failed 3 weeks and was paused. Until the handle changes, which customers cannot do (I9), the card keeps saying "Sweet Co posted 5 times this week, up from 2."
- Example 2: from Monday 00:00 India time until the new read (or all week when the daily cap runs out), last week's figures are labelled "this week".
- Example 3: when a week was skipped, "up from 2" compares weeks that are not next to each other.
- Fix: write a sentence only when `cur.weekStart` is this week or last week (and say "last week" when it is), and only when `prev.weekStart` is exactly 7 days before `cur`.

**I7 (Important): staff "check now" does nothing on real data, and the tests hide it.** `tracker.js:128-133`.
- The `lastCheckedAt` cooldown and same-week return come before `force` is looked at. Every real read, failed or good, saves `tracking.lastCheckedAt` (`:109`, `:116`). So after any scheduled read this week, `staffCheck` reads nothing.
- The force tests (`competitorTracker.test.js:238-249`, `competitorInsightsRoutes.test.js:191-226`) use `tracking: {}`, which never happens in production.
- `staffCheck` also returns `success: true, checked: 0` with no explanation when a scheduled pass is running (`running` guard, `tracker.js:151`).
- The c55f570 report says "force bypasses the due check". That is false.
- Fix: honour `force` in the `lastCheckedAt` block, as the stored-attempt block does. Return a `busy` flag when a pass is running.

Minor:
- **M1.** "with 1 likes": `snapshot.js:128` has no singular case. It happens when the top post has 1 like and the 30-day average rounds to 0 (for example likes 1, 0, 0). Use `like${likes === 1 ? '' : 's'}`.
- **M2.** "X posted 0 times this week, down from 5." (`snapshot.js:110`) reads badly. Use "did not post this week, after 5 last week."
- **M3.** A missing follower count becomes 0 (`num`) and is then treated as real (`snapshot.js:116-121`). If one read lacks `followersCount`, the next week says "gained 5000 followers". Store null for missing values and skip the sentence. The real profile shape has still not been seen (no real read yet).
- **M4.** `postsInWindow` is a rolling 7 days at read time, not the India-time week the sentence suggests. The profile read asks for only 12 posts (`socialMediaAPI.js:1126`), so a competitor posting more than 12 times in 30 days is undercounted, and `avgLikes` and `posts30` come out wrong.
- **M5.** "Tracking since" uses the oldest of the last 4 trend points (`utils/competitorInsights.ts:49`). From week 5 the date moves forward and is wrong.
- **M7.** A good upsert over a failed row keeps the old `error` field (`snapshotStore.js:21`, `$set` with no `$unset`). Two good upserts at the same time can raise E11000, which is not caught there and is counted as a failed check.
- **M11.** `compare()` is exported but unused. The spec's engagement and format-shift sentences were not built (only post count, followers and best post). Acceptable, but the spec should say so.
- **M12.** The tracker loads up to 500 full User documents per pass (`tracker.js:42-45`). It should select only the fields it needs.

## 5. Erasure: PASS

- **Account deletion and export.** `dataRegistry.js:35` lists `CompetitorSnapshot` by `userId` with action delete. Both read `erasable()` (`accountDeletion.js:113`, `accountExport.js:51`).
- **Model loading.** `defaultModels()` loads every model file and throws if a model is missing (`accountDeletion.js:266-276`), so a lazily loaded `CompetitorSnapshot` cannot be skipped by accident.
- **Agency clients.** A removed client goes through the standard purge. An agency's own deletion includes its clients (`clientIds`).
- **Guard test.** The registry guard test (`dataRegistry.test.js:22-28`) fails for any user-linked model missing from the list.

**M6 (Minor).** When re-discovery hard-deletes competitors (`routes/competitors.js:84` and the other three places), their snapshots are left with no competitor. `prune` works per competitor and never touches them, so they outlive the 12-week retention until the account is deleted. They still count in `readsToday`, which is harmless. Delete snapshots with their competitor, or prune by `userId` and age.

## 6. Wording and UI

- **Card wording.** The card follows the voice spec: plain sentences, no vendor names ("public posts"), no "credit", "trial" or "7 days". The new files are in `voice-scope.json`.
- **Phone layout.** The 375 px fix is in the diff (`Competitors.tsx`, header wraps and the search box is full width on phones).
- **Contrast.** It uses theme tokens. I did not re-measure the reported ratios (14.9 / 9.5 / 5.9) because this review was read-only with no browser, so treat them as the report's claim.

**I10 (Important): the upgrade prompt names Quarks, and this stage now shows it unprompted. It must change.**
- `UpgradePrompt.tsx:23` reads "View plans and Quarks". `utils/plans.ts:12` reads "Please upgrade your plan, or buy an add-on pack or Quarks."
- Before this stage, a customer saw it only after pressing an add button. Now `Competitors.tsx` (`onInsightsLocked`) shows it on page load to every customer without the add-on.
- The owner's rule (handover 5, line 8: "Customers see posts and videos, never Quarks") has no billing exception. "Pre-existing" does not excuse widening the exposure.
- The button also goes to `/trial-expired`, so the address bar shows the banned word "trial".
- Fix: change the shared message and button to plans and add-on wording ("This needs the Competitor insights add-on. See plans."). This also fixes every other place the prompt appears.

**I9 (Important): the card tells customers to fix a handle, but there is no way to edit one.**
- Status texts say "Check the handle" and "Update the handle to resume", and the link says "Open Competitors to fix handles".
- `routes/competitors.js` has no endpoint to edit a competitor (only ignore, unignore, add, discover and scrape). `Competitors.tsx:804` shows the handle as read-only text.
- A paused competitor can only be un-paused when background handle finding happens to change the handle. In practice it stays paused for good. It also keeps showing stale sentences (I6).
- The spec ("a customer can add or fix a handle") assumed a feature that does not exist.
- Fix: add `PUT /api/competitors/:id/handle` (protect, `requireFeature`, owner check, the handle check from I8, rate limited) and an edit control on the competitor card. Until then, change the wording to something the customer can do (for example "Remove it and add it again with the right name").

## 7. Test quality

Would the tests fail if the rules were wrong? Mostly yes for the happy-path caps. Not for the failure paths that matter. I name these as weak:
- **Force tests** (`competitorTracker.test.js:238`, `competitorInsightsRoutes.test.js:216`). They use competitors with an empty `tracking`, so they pass while the real feature does nothing (I7).
- **Tracker fake store** (`competitorTracker.test.js:20`). `save` appends a row instead of upserting, so the read undercount (I2) cannot show up. There is no test where `saveTracking` also fails (I1).
- **Missing tests.**
  - No test checks that the tracked set equals the shown set (I5).
  - No test covers an out-of-date latest snapshot (I6) or the singular "1 like" (M1).
  - The highlight ranking test only checks for one match and "3 or fewer". It does not check the order, so a broken `weight` would pass.
  - "a first week, an empty week and a failed-only history" covers only the empty case.
- **Staff route tests** (`competitorInsightsRoutes.test.js:166-181`). They are regex checks on the source text, not requests through `requireStaff` and `clientFor`.
- **Tracker entitlement** is faked (`canUse` reads `u.entitled`, and users have the non-existent tier `growth`). The default `accounts()` query, the real `canUse` wiring and the 500-account limit are untested. The route side does use the real gate.
- **Good tests.**
  - Daily cap exactness (g).
  - Spend refusal (h).
  - Five newest (i).
  - The overlap guard (j).
  - Failed read keeps the good snapshot (e).
  - Store upsert and prune.
  - The cross-account leak test, with its "asked" list.
  - The model `validateSync` test, which would have caught the `type` bug.

**The UI-check report's "Unverified" list, judged item by item:**
- **Staff view.** It cannot be verified, because no staff UI calls the two staff routes yet (handover item 3). Build it, or say the routes are API-only.
- **Dark mode and tablet widths.** Low risk (tokens, wrapping layout). Acceptable to defer.
- **Paused handle.** This is not just unverified. The state is a dead end for the customer (I9).
- **Real profile shape.** This is the biggest remaining risk. Every number (`followersCount`, `latestPosts`, `type` values Video/Sidecar, timestamp shape, likes `-1` when hidden) is assumed. Do the one owner-approved real read before release, and turn on I4's opt-in first so it is the only read.
- **Possible real read by the running dev backend.** The report itself flags this. It is a real process breach risk (I4). Check the dev spend row.

## Counts

Critical 0. Important 13 (I1 to I13). Minor 10 (M1 to M8, M11, M12). M8: the staff GET is not logged and there is no staff UI or `check_competitors` label. M9 and M10 are folded into section 7 and I10.

Fix order suggested:
1. I4 (opt-in switch).
2. I1, I2 and I3 (a read counter that does not depend on database writes, plus a lease).
3. I7.
4. I5 and I6.
5. I10 and I9.
6. I8.
7. I11 and I12.
8. I13 (wording at least).
9. Then the minors.
