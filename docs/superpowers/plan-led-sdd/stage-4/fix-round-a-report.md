# Stage 4 fix round A (backend): report

Backend `node --test tests/*.test.js`: 1540 pass, 0 fail (was 1487). Frontend `node --test tests/*.test.mjs`: 360 pass (untouched). Fakes only: no scraper, no AI, no database was called. No frontend files, no Kling files.

## New building blocks

| File | What it is |
|---|---|
| `services/competitors/readLedger.js` + `models/CompetitorReadLog.js` | One row per read ATTEMPT (day, user, competitor, handle, source), also kept in process memory. Counts take the larger of the two, so a failed database write or read cannot hide a read. 14-day expiry. Listed in `services/dataRegistry.js` (delete). |
| `services/competitors/readGuard.js` | The one guard for every read: switch exactly `on`, then per-account daily cap, then daily ceiling (counting ledger attempts), then the spend guard. `note()` records ledger + spend. `guardedRead()` wraps a scraper call and throws `ReadRefused` (plain message) before it. |
| `services/competitors/lease.js` | Single-runner lease in `OpsState` (key `competitor_tracker_lease`, atomic upsert claim, expiry, renew, release). A store failure means "not claimed". |
| `services/competitors/tracked.js` | `trackedCompetitors()` (the shared ordered list, cap 5), `isReadable()`, `handleStatusOf()`, `isValidHandle()`, `competitorsQuery()`. |
| `services/competitors/cleanup.js` | `removeCompetitorsWithSnapshots(filter)`. |
| `routes/competitorHandle.js` | `PUT /api/competitors/:id/handle`. |

Config added in `config/competitors.js`: `maxReadsPerAccountPerDay: 5`, `ACCOUNTS_PER_PASS: 60`, `LEASE_MINUTES: 45`.

## Per finding

| Finding | What changed | Tests (file: name) |
|---|---|---|
| I1 | The read attempt is recorded in the ledger (database row + memory) BEFORE the scrape, in `trackOne` via `onRead`. The cooldown and one-read-a-week rule are judged from `tracking.lastCheckedAt`, the ledger and the newest stored row, so a failed snapshot save or tracking save no longer makes a competitor due again. | `competitorTracker`: "(I1) both saves fail...second pass reads nothing", "(I1) the read attempt is recorded durably even when the snapshot save throws"; `competitorReadControls`: "the ledger still counts and remembers when every database write and read fails" |
| I2 | The daily ceiling counts ledger attempts, not snapshot rows. | `competitorTracker`: "(I2) a second read of the same competitor in the same week is counted", "(g) the daily cap stops the pass exactly, counting real reads"; `competitorReadControls`: ledger count tests |
| I3 | `runTrackerOnce` claims the lease after the switch check, renews it per account, releases it in `finally`. No lease means no pass (`busy: true`). | `competitorReadControls`: four lease tests (second claimant gets nothing, expired lease can be taken, renew and stale release, store failure); `competitorTracker`: "(I3) a pass takes the lease first, releases it...", "(I3) a lease that cannot be claimed" |
| I4 | `startCompetitorTracker` returns null unless `ENABLE_COMPETITOR_TRACKER` is exactly `on` (after trim; `ON`, `true`, `1` are off) and not in tests. `server-main.js` comment, tracker header comment and `docs/superpowers/ops/plan-launch-checklist.md` (Switches section) updated. | `competitorTracker`: "(I4) startCompetitorTracker is off unless...", "(I4) a pass with the switch off reads nothing and never touches the lease"; `competitorReadControls`: "I4: the tracker is on only when the switch is exactly on" |
| I5 | Tracker and insights route both use `trackedCompetitors()` (active, not ignored, newest first with `_id` tie-break, cap 5) and one shared query. The tracker reads only the readable ones of that shown list. | `competitorTracker`: "(I5) the competitors that are read are exactly the ones shown"; `competitorInsightsRoutes`: "(I5) ... same list, same order, same cap"; `competitorReadControls`: "I5: the tracked list is deterministic" |
| I6 | `snapshot.insights` writes sentences only for a snapshot of the current week, and a week-over-week change only when the previous snapshot is exactly 7 days before. Rows return `weekOf`, `isCurrentWeek`, `previousWeekOf`, `lastCheckedOn`. | `competitorSnapshot`: four "I6" tests; `competitorInsightsRoutes`: "(I6) each row says which week..." |
| I7 | `force` now skips the cooldown, same-week and ledger checks (`isDue` returns true), but not the switch, the daily ceiling, the per-account cap, the spend guard, entitlement, the paused/unconfirmed filter. The forced read is counted (source `staff`) and audited. `staffCheck` returns `busy` and `disabled`. Tests now use competitors that WERE checked this week (`tracking.lastCheckedAt`, a stored row, a ledger entry). | `competitorInsightsRoutes`: "(I7) staff check reads a competitor that was already checked this week...", "(I7) ... still respects the daily cap, the per-account cap, the spend guard, the add-on and the switch", "(I7) ... says so when another pass is running"; `competitorTracker`: "(force, I7) ..." |
| I8 | `Competitor.handleStatus` (`suggested`, `verified`, `confirmed`). The tracker reads only `verified` or `confirmed` handles with a valid format. Older records with no status: manually added = confirmed, auto-discovered = suggested. New auto-discovered and manually added handles are saved `suggested` (also in `auth.js`, `brand.js`, `dashboard.js`). The customer finder marks a handle `verified` when `validateProfileMatch` passes, and never replaces a `confirmed` handle with a search result. `PUT /api/competitors/:id/handle` added (protect, limiter 30 per 15 min, `requireFeature('competitors')` which loads the user server-side, owner-only query, strict `^[A-Za-z0-9._]{1,30}$`, sets `confirmed`, `tracking.failures` 0, `tracking.pausedAt` null, `tracking.lastCheckedAt` null). `handleStatus` is returned in the insights rows and in the `/posts` competitors list. | `competitorHandleRoute` (8 tests); `competitorTracker`: "(I8) a suggested handle is never read..."; `competitorInsightsRoutes`: "(I8) rows carry handleStatus..."; `competitorCustomerGuard`: "I8: a handle our own profile check accepts is marked verified..." |
| I11 | Default account lookup pages through ALL non-free accounts by `_id` (no 500 cut-off) with a `select` of only the needed fields. Accounts are sorted by `User.competitorsReadAt` (never read first, then oldest) and stamped after a read. `ACCOUNTS_PER_PASS` is 60. | `competitorTracker`: "(I11) 1,000 accounts and a cap that serves 280 a week...", "(I11) the oldest read goes first...", "(I11) the default account lookup pages through every account". Mutation check: removing the sort makes both fail. |
| I12 | `maxReadsPerAccountPerDay` (default 5) in the guard, counted per account per UTC day from the ledger; applies to tracker, staff and customer reads. | `competitorTracker`: "(I12) at most maxReadsPerAccountPerDay reads for one account in a day..."; `competitorReadControls`: guard order test |
| I13 | `routes/competitors.js`: every `scrapeInstagramProfile` and `searchInstagramByName` call goes through `guardedRead` (same switch, ceiling, account cap, spend guard, counted in the same ledger). `fetchPostsForCompetitors` stops quietly on a refusal; `/scrape-by-type` answers 429 with a plain message before scraping and reports a `notice` if it is stopped half way. | `competitorCustomerGuard` (8 tests), `competitorReadControls`: "I13: guardedRead..." |
| Minor (snapshots) | Re-discovery in `routes/competitors.js`, `auth.js`, `brand.js`, `dashboard.js` now uses `removeCompetitorsWithSnapshots`. Data-deletion registry guard stays green (`CompetitorReadLog` added). | `competitorReadControls`: "removing competitors also removes their snapshots"; `competitorCustomerGuard`: source check of the four files |

Also: `scripts/competitors-ui-check.js` fake deps now pass `env`, an in-memory ledger and lease (syntax checked only; it was not run).

## Response shapes round B needs

`GET /api/competitors/insights` (and the staff view `GET /api/staff/clients/:id/competitors`, same body):

```
{ success, weekStart, highlights: [{ competitorId, name, text, weight }],
  competitors: [{
    id, name, handle,
    handleStatus: 'suggested' | 'verified' | 'confirmed',
    status: 'no_handle' | 'unconfirmed' | 'paused' | 'failed' | 'waiting' | 'tracking',
    trend: [{ weekStart, postsInWindow, avgLikes }],
    lastCheckedAt: ISO string | null,
    weekOf: 'YYYY-MM-DD' | null,        // week of the newest good snapshot
    isCurrentWeek: boolean,             // false: do not say "this week", say "last checked on <lastCheckedOn>"
    previousWeekOf: 'YYYY-MM-DD' | null, // set only when it is exactly the week before weekOf
    lastCheckedOn: 'YYYY-MM-DD' | null
  }] }
```
- New status `unconfirmed`: the handle was suggested by us; the customer should confirm or edit it. `no_handle` now also covers a handle with an invalid format.
- Highlights are only written for current-week snapshots; a competitor whose latest snapshot is older has no highlight, so the card must build its own "last checked on" line from the row.

`PUT /api/competitors/:id/handle` body `{ handle }` (a leading `@` is accepted):
- 200 `{ success: true, competitor: { id, name, handle, handleStatus: 'confirmed' } }`
- 400 `{ success: false, message }` for a bad format; 404 not found or not yours; 403 standard add-on body (`upgradeRequired: true`); 429 rate limited.

`GET /api/competitors/posts`: `competitors[]` now includes `handleStatus`. The auto-discover and add-manual responses return the full competitor document, which now has `handleStatus`.

`POST /api/competitors/scrape-by-type`: new 429 `{ success: false, message }` when the switch, a cap or the spend guard stops it; a partial run adds `notice`.

`POST /api/staff/clients/:id/competitors/check`: `{ success, checked, skipped, busy, disabled }`. `busy: true` = another pass is running; `disabled: true` = the switch is off (checked is 0 in both cases). The staff screen should say so instead of "0 checked".

## Decisions and concerns for the controller

1. **Customer scrapes are now off until the owner sets `ENABLE_COMPETITOR_TRACKER=on`.** That follows the ruling ("the SAME switch"), but it means the existing customer features that scrape competitor posts (add-manual background fetch, auto-discover background fetch, `/scrape-by-type`) stop working in every environment until the switch is set. The launch checklist says so. If you wanted the customer scrapes to ignore the env switch and only obey the caps and spend guard, change `trackerEnabled` use in `readGuard.allow` for `source: 'customer'`.
2. **Not covered by the guard (outside `routes/competitors.js`):** `routes/dashboard.js` (`fetchRealCompetitorPosts` on the overview, `POST /refresh-competitor-posts`), `services/aiDashboard.js` and `routes/seoRoutes.js` competitor analysis also call scrapers. The ruling named `routes/competitors.js` only. Same `guardedRead` helper can wrap them in a later round.
3. **Verified counts as read-eligible.** Handles our own profile check matched (`validateProfileMatch`) are saved `verified` and read weekly without the customer confirming them (this is the "keep existing verified handles working" part). If you want strictly customer-confirmed only, drop `verified` from `isReadable`.
4. **Manually added competitors**: a new manual add is saved `suggested` (the handle comes from a search), so it is not tracked weekly until the customer confirms it or our profile check verifies it. Older manual records without a status keep working as confirmed.
5. **Day is a UTC day** for the ceiling and the per-account cap (matches the spend guard); the week is still the India-time week.
6. **Lease length is 45 minutes**, renewed per account; a crashed holder blocks passes for up to 45 minutes at most.
7. **Not changed:** the customer removing a single competitor: there is no delete endpoint (only ignore), so nothing to clean; ignored competitors keep their snapshots. The staff card text in `StaffAiSpend.tsx` ("The weekly competitor checks") is frontend, left for round B (it should now say the switch covers all competitor checks). Minors M1 to M5, M7, M11, M12 (other than the select in the accounts query) were not part of the rulings and are untouched.
8. A real-database check is still needed for: the `OpsState` lease claim (`findOneAndUpdate` upsert with the unique `key`, E11000 path), the `CompetitorReadLog` TTL index, the paged account query, and `User.updateOne(..., { timestamps: false })`. Only fakes of these were run.
