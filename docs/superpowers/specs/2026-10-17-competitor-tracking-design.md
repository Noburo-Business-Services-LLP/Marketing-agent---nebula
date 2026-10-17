# Competitor tracking and weekly insights (Stage 4)

Date: 2026-10-17. Status: decisions taken by the assistant under the owner's instruction to keep building (2026-10-17); the owner reviews it later. Follows `2026-10-17-plan-led-home-design.md` (Stage 4 section).

## Purpose
Customers can already list competitors and fetch their latest Instagram posts by pressing a button. Nothing is remembered, so a customer cannot see what changed. This stage checks each competitor automatically every week, keeps a small snapshot each time, compares it with the last one and tells the customer in plain words what their competitors did ("Sweet Co posted 5 times this week, up from 2. Their best post was a reel about Diwali boxes with 3 times their usual likes").

Success: a customer with competitor insights sees, on My plan and on the Competitors page, a short "What your competitors did this week" card with up to three highlights and a per-competitor trend over the last four weeks, with no button pressed; managed clients get it automatically; cost stays a few rupees per account per month.

## Decisions (taken by the assistant, owner to confirm)
1. **Weekly**, not bi-weekly: one check per competitor per 7 days (the data is cheap: one profile read per competitor). A per-account setting can slow it later.
2. **Who gets it:** accounts for which `canUse(user, 'competitors')` is allowed (the Competitor insights add-on, the Agency plan, managed clients). Free accounts and plans without the add-on never trigger a check.
3. **Instagram only** in this stage (it is the only competitor source that works today). Other networks need new scrapers and are out of scope.
4. **No discovery in the tracker:** it only uses competitors that already have a verified Instagram handle stored. It never searches for or guesses handles (cost and wrong-account risk). A competitor without a handle is listed as "add their Instagram handle to track them".
5. **No language filter:** unlike the existing feed (which keeps English posts only), the tracker counts every post, so regional-language competitors are tracked fairly.
6. **Plain-language insights from rules, not from a language model:** no model cost, no invented claims. Every sentence is built from the numbers in two snapshots.
7. **Our own comparison ("versus you") is out of scope** for this stage (needs the customer's own post metrics through the connected account); the card compares each competitor with its own previous week.
8. **Retention:** 12 weekly snapshots per competitor, older ones deleted.
9. **Limits:** at most 5 competitors tracked per account (existing UI allows up to 7: the five most recently added are tracked), a global cap of 200 profile reads a day (`COMPETITOR_READS_PER_DAY_MAX`), the daily AI spend ceiling and provider switches apply, and the tracker skips accounts that are paused, frozen or being deleted.

## Design
- `models/CompetitorSnapshot.js` (collection `competitor_snapshots`): `userId`, `competitorId`, `weekStart` (Monday, India time), `takenAt`, `handle`, `followers`, `postsInWindow` (posts in the last 7 days), `posts30` (posts in the last 30 days), `avgLikes`, `avgComments`, `formats` (counts of image/video/carousel), `topPost { url, likes, comments, type, caption (160 chars) }`, `hashtags` (top 5), `ok` (false when the profile could not be read), `error`. Unique on `competitorId + weekStart`. Listed as erasable in `dataRegistry`.
- `services/competitors/snapshot.js` (pure): `weekStartOf` reuse from `services/week/weekMath.js`; `summarise({ profile, posts, now })` -> snapshot fields; `compare(prev, cur)` -> deltas (posts, followers, engagement, format shift); `insights({ competitors, now })` -> up to three plain sentences ranked by how big the change is, plus per-competitor trend arrays.
- `services/competitors/tracker.js`: `trackOne({ competitor, deps })` (reads the profile through the existing Instagram scraper, builds and stores the snapshot, never throws), `runTrackerOnce({ deps, now, limit })` (selects due accounts, honours entitlement, gate, caps, 12-hour cooldown per competitor and a failure back-off: a competitor that fails 3 weeks in a row is paused until its handle changes), `startCompetitorTracker({ intervalMs: 6h })` (off in tests; `ENABLE_COMPETITOR_TRACKER=off`; first tick 20 minutes after boot).
- API: `GET /api/competitors/insights` -> `{ highlights: [{ competitorId, name, text }], competitors: [{ id, name, handle, status ('tracking'|'no_handle'|'failed'|'waiting'), trend: [{ weekStart, postsInWindow, avgLikes }], lastCheckedAt }], weekStart }` (needs the competitors entitlement; read-only; for staff `GET /api/staff/clients/:id/competitors`). `POST /api/competitors/insights/refresh` is NOT offered (cost control): a customer can add or fix a handle and the next weekly check picks it up; staff can force a check for a client.
- Frontend: a "What your competitors did" card (`components/CompetitorInsights.tsx`) shown on the My plan page (below the 90 days) and at the top of the Competitors page; states: no competitors, tracking started ("first results next week"), highlights, failed handles with "fix the handle". Posts and videos wording only; no vendor names (do not say Apify/Instagram scraping; say "public posts").

## Testing
Pure `summarise`/`compare`/`insights` tests (including empty windows, zero-division, a competitor with no posts, a private/missing profile); tracker tests with fakes (entitlement, gate, caps, cooldown, back-off, never throws, a failed read stores `ok:false` and does not overwrite the last good snapshot); route tests; frontend helper tests; a real run of one tracker pass on `nebulaa_dev` with one real competitor handle (a few paise of scraper cost; needs the owner's OK).
