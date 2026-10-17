# Competitor tracking and weekly insights (Stage 4) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Every account with competitor insights gets an automatic weekly check of its competitors' public Instagram activity, kept as small snapshots, compared week to week, and shown as a plain-language "What your competitors did" card.

**Architecture:** A pure analysis module turns a profile and its recent posts into a snapshot and compares two snapshots; a tracker service (with a scheduler) reads each tracked competitor once a week through the existing Instagram scraper and stores snapshots; a read-only API serves highlights and trends; a card shows them on My plan and the Competitors page.

**Tech Stack:** Node/Express/Mongoose (`node --test tests/*.test.js`), React 19 + TypeScript + Vite (`node --test tests/*.test.mjs`).

**Spec:** `docs/superpowers/specs/2026-10-17-competitor-tracking-design.md` (decisions 1 to 9 are binding).

## Global Constraints

- Only accounts with `canUse(user, 'competitors').allowed` are ever checked; staff accounts never; skip paused, frozen and deleting accounts (`services/backgroundGate.js`); free accounts never.
- Instagram only; only competitors that already have a stored Instagram handle (`socialHandles.instagram`); the tracker never searches for handles; no language filter; at most 5 competitors per account; 12 weekly snapshots kept per competitor.
- Cost safety: one profile read per competitor per 7 days (12-hour cooldown), global cap `COMPETITOR_READS_PER_DAY_MAX = 200` reads per day (config), `spendGuard.check` before and `spendGuard.record('competitor_scrape', 1)` after each read (read `services/spendGuard.js` for the action names; add the action to its cost table only if required), switch `ENABLE_COMPETITOR_TRACKER=off`, a competitor that fails 3 weeks in a row is paused until its handle changes. A failed read never overwrites the last good snapshot.
- Insights are rule-built sentences from snapshot numbers only: no language model, no invented claims, no vendor names ("public posts", never Apify/scraper). Customers see posts, never Quarks; wording guard bans 'credit', 'trial', '7 days', 'quark' in customer-facing text. `brand-audit` and `voice-audit` 0; regenerate layer lists after UI changes.
- Real runs only on `nebulaa_dev` through throwaway scripts that refuse any other database; throwaway users deleted afterwards; the one real scraper read needs the owner's OK. Never read or print `.env`/secrets. Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; never push (the controller pushes).

## Review Focus

1. The tracker can never read more than the caps allow (per account, per competitor, per day), even with overlapping ticks or a restart mid-run (Task 3).
2. A private, renamed or deleted Instagram account: stored as a failed check, shown as "fix the handle", never crashes the run, never wipes history (Tasks 1, 3).
3. Entitlement: an account that loses the add-on stops being checked and stops seeing insights (the data stays but the API refuses) (Tasks 3, 4).
4. Insights sentences are correct for empty windows, first week (no previous snapshot), zero division and huge jumps; no sentence claims what the numbers do not show (Task 1).
5. Account deletion erases snapshots; the unique index exists (Task 2).

## File Structure

Backend, create: `models/CompetitorSnapshot.js`, `services/competitors/snapshot.js`, `services/competitors/tracker.js`, `services/competitors/snapshotStore.js`, `routes/competitorInsights.js` (mounted under `/api/competitors/insights` before the existing competitors router so the path wins), tests `tests/competitorSnapshot.test.js`, `competitorTracker.test.js`, `competitorInsightsRoutes.test.js`.
Backend, modify: `services/dataRegistry.js`, `config/blueprint.js` or a new `config/competitors.js` (caps), `server-main.js` (scheduler, mount), `routes/staff.js` (`GET /api/staff/clients/:id/competitors` and a staff 'check now'), `models/Competitor.js` (add `tracking: { failures, pausedAt, lastCheckedAt }`).
Frontend, create: `utils/competitorInsights.ts`, `components/CompetitorInsights.tsx`, `tests/competitorInsights.test.mjs`. Modify: `services/api.ts`, `types.ts`, `pages/MyPlan.tsx`, `pages/Competitors.tsx`, `index.html` (generated), `tests/voice-scope.json`.

---

### Task 1: Snapshot analysis (pure)

**Files:** Create `backend/services/competitors/snapshot.js`; Test `backend/tests/competitorSnapshot.test.js`.

**Interfaces (produce):**
- `summarise({ profile, posts, now }): snapshotFields` where `profile = { followersCount, postsCount }`, each post `{ timestamp|takenAt|takenAtTimestamp (seconds)|date, likesCount|likes, commentsCount|comments, type ('Image'|'Video'|'Sidecar'|other), caption|text, hashtags[], url|postUrl|shortCode }`. Returns `{ followers, postsInWindow (posts in the 7 days before `now`), posts30 (in 30 days), avgLikes, avgComments (rounded means over the 30-day posts, 0 when none), formats: { image, video, carousel } (counts over the 30-day posts: Image/other->image, Video->video, Sidecar->carousel), topPost: { url, likes, comments, type, caption (first 160 chars) } | null (highest likes + 3 x comments in the 30 days), hashtags: [top 5 by count, lower-case, without '#'] }`. Posts with no usable timestamp are ignored. Never throws on missing fields.
- `compare(prev, cur): { posts, followers, avgLikesPct }` (differences; `avgLikesPct` null when prev avgLikes is 0 or prev missing).
- `insights({ items, now }): { highlights: [{ competitorId, name, text, weight }] (max 3, strongest first), competitors: [{ id, name, trend: [{ weekStart, postsInWindow, avgLikes }] (oldest first, max 4) }] }` where `items = [{ competitor: { _id, name }, snapshots: [newest first, only ok ones] }]`. Sentence rules (plain, use the competitor's name, only from numbers): posting change ("X posted 5 times this week, up from 2." / "down from 6." / "posted 3 times this week, the same as last week." only when change >= 2 or first week with posts), follower change (only when |change| >= 50 and >= 1% of followers: "X gained 120 followers this week." / "lost"), best post ("X's best post this week was a reel with 340 likes." only when the top post is within the last 7 days and has >= 1.5 times that competitor's own 30-day average likes; type words: reel for Video, carousel for Sidecar, photo otherwise), first-week note when no previous snapshot ("We have started tracking X. Changes show from next week."). `weight` ranks them (bigger relative change first).

- [ ] **Step 1: Write the failing tests**

```js
// backend/tests/competitorSnapshot.test.js
const test = require('node:test');
const assert = require('node:assert');
const { summarise, compare, insights } = require('../services/competitors/snapshot');
const NOW = new Date('2026-10-17T06:00:00Z'); const DAY = 864e5;
const post = (daysAgo, likes, comments, type = 'Image', extra = {}) => ({ timestamp: new Date(NOW - daysAgo * DAY).toISOString(), likesCount: likes, commentsCount: comments, type, caption: `post ${daysAgo}`, hashtags: [], url: `https://instagram.com/p/${daysAgo}`, ...extra });

test('a profile and its posts become a snapshot with counts, averages, formats and the top post', () => {
  const s = summarise({ profile: { followersCount: 1200 }, posts: [post(1, 100, 4), post(2, 40, 1, 'Video'), post(5, 60, 2, 'Sidecar'), post(12, 20, 0), post(40, 999, 99)], now: NOW });
  assert.strictEqual(s.followers, 1200);
  assert.strictEqual(s.postsInWindow, 3);
  assert.strictEqual(s.posts30, 4);
  assert.strictEqual(s.avgLikes, 55);
  assert.deepStrictEqual(s.formats, { image: 2, video: 1, carousel: 1 });
  assert.strictEqual(s.topPost.likes, 100);
  assert.ok(s.topPost.caption.length <= 160);
});
test('timestamps in several shapes are understood and posts without one are ignored', () => {
  const secs = { takenAtTimestamp: Math.floor((NOW - 2 * DAY) / 1000), likesCount: 5, commentsCount: 0, type: 'Image' };
  const s = summarise({ profile: {}, posts: [secs, { likesCount: 9, type: 'Image' }, post(3, 1, 1, 'Image', { timestamp: undefined, takenAt: new Date(NOW - 3 * DAY).toISOString() })], now: NOW });
  assert.strictEqual(s.postsInWindow, 2);
});
test('empty or missing input never throws and gives zeros', () => {
  for (const input of [{}, { profile: null, posts: null, now: NOW }, { profile: {}, posts: [], now: NOW }]) {
    const s = summarise({ now: NOW, ...input });
    assert.strictEqual(s.postsInWindow, 0); assert.strictEqual(s.avgLikes, 0); assert.strictEqual(s.topPost, null);
  }
});
test('top hashtags are counted, lower-cased and capped at five', () => {
  const tags = ['#Cake', 'cake', '#Diwali', '#a', '#b', '#c', '#d'];
  const s = summarise({ profile: {}, posts: [post(1, 1, 1, 'Image', { hashtags: tags })], now: NOW });
  assert.ok(s.hashtags.length <= 5); assert.strictEqual(s.hashtags[0], 'cake');
});
test('compare gives differences and a percentage only when the old average is above zero', () => {
  assert.deepStrictEqual(compare({ postsInWindow: 2, followers: 1000, avgLikes: 50 }, { postsInWindow: 5, followers: 1120, avgLikes: 75 }), { posts: 3, followers: 120, avgLikesPct: 50 });
  assert.strictEqual(compare({ postsInWindow: 0, followers: 10, avgLikes: 0 }, { postsInWindow: 1, followers: 10, avgLikes: 9 }).avgLikesPct, null);
  assert.strictEqual(compare(null, { postsInWindow: 1 }).avgLikesPct, null);
});
test('highlights are plain sentences built only from the numbers, strongest first, at most three', () => {
  const mk = (id, name, cur, prev) => ({ competitor: { _id: id, name }, snapshots: prev ? [cur, prev] : [cur] });
  const cur = (o) => ({ weekStart: '2026-10-12', postsInWindow: 5, followers: 1120, avgLikes: 60, topPost: { url: 'u', likes: 340, comments: 5, type: 'Video', caption: 'Diwali boxes' }, topPostAt: new Date(NOW - 2 * DAY), ...o });
  const prev = { weekStart: '2026-10-05', postsInWindow: 2, followers: 1000, avgLikes: 50 };
  const out = insights({ items: [mk('a', 'Sweet Co', cur(), prev), mk('b', 'Tea House', cur({ postsInWindow: 3 }), { ...prev, postsInWindow: 3 }), mk('c', 'Bake Lab', cur({ postsInWindow: 1 }), null), mk('d', 'Fourth', cur(), prev)], now: NOW });
  assert.ok(out.highlights.length <= 3);
  const text = out.highlights.map((h) => h.text).join(' ');
  assert.match(text, /Sweet Co posted 5 times this week, up from 2/);
  assert.match(text, /We have started tracking Bake Lab|Bake Lab/);
  assert.doesNotMatch(text, /quark|credit|apify|scrap/i);
  assert.strictEqual(out.competitors.find((c) => c.id === 'a').trend.length, 2);
});
test('a first week, an empty week and a failed-only history are handled without errors', () => {
  const out = insights({ items: [{ competitor: { _id: 'x', name: 'New Co' }, snapshots: [] }], now: NOW });
  assert.deepStrictEqual(out.highlights, []);
  assert.deepStrictEqual(out.competitors[0].trend, []);
});
```

- [ ] **Step 2: Run to verify they fail** — `cd backend && node --test tests/competitorSnapshot.test.js` → module not found.
- [ ] **Step 3: Implement** `snapshot.js` per the interfaces (pure; reuse `weekStartOf` from `services/week/weekMath.js`; store `topPostAt` alongside `topPost` in the snapshot so the 'best post this week' rule can check recency; add `topPostAt` to the model in Task 2). Where the tests and the rules disagree (for example the 'started tracking' wording for a first week), keep the rules, adjust the test minimally and say so in the report.
- [ ] **Step 4: Run tests** → pass. **Step 5: Commit** — `git add backend && git commit -m "Competitors: snapshot analysis and plain-language weekly insights (pure)"`

---

### Task 2: Snapshot storage

**Files:** Create `backend/models/CompetitorSnapshot.js`, `backend/services/competitors/snapshotStore.js`, `backend/config/competitors.js`; Modify `backend/services/dataRegistry.js`, `backend/models/Competitor.js`.

**Interfaces:** Model fields per the spec plus `topPostAt` and `weekStart`; unique index `{ competitorId: 1, weekStart: 1 }`; `config/competitors.js` exports `{ MAX_TRACKED: 5, READS_PER_DAY_MAX: 200, COOLDOWN_HOURS: 12, KEEP_WEEKS: 12, FAIL_PAUSE_AFTER: 3 }`. `snapshotStore(Model)`: `save(snapshot)` (upsert by competitor+weekStart, never overwriting an `ok:true` snapshot with an `ok:false` one), `latest(competitorId, n)` (newest first, ok only), `lastAttempt(competitorId)` (newest of any status), `prune(competitorId, keep)`, `readsToday(now)` (count of snapshot attempts in the last 24 hours across accounts, used for the daily cap). `Competitor.tracking = { failures: Number, pausedAt: Date, lastCheckedAt: Date }`. `dataRegistry` rule for `CompetitorSnapshot` (field `userId`, action `delete`).

- [ ] Steps (TDD where logic exists): write `tests/competitorSnapshotStore.test.js` with an in-memory fake model proving: ok never overwritten by failed, upsert idempotent per week, `latest` order and filter, `prune` keeps N newest, `readsToday` counts only last 24 h; add the data registry rule and run `tests/dataRegistry.test.js` (must pass: it fails if the model with a user ref is missing); run a throwaway real check against `nebulaa_dev` that the unique index exists after `Model.init()` and a duplicate insert gives code 11000 (throwaway script deleted afterwards). Run the full backend suite. Commit `git commit -m "Competitors: snapshot model, store, caps config, erasure rule"`.

---

### Task 3: Tracker and scheduler

**Files:** Create `backend/services/competitors/tracker.js`; Modify `backend/server-main.js`; Test `backend/tests/competitorTracker.test.js`.

**Interfaces:** `trackOne({ competitor, user, now, deps })` -> `{ ok, skipped?, reason? }` (reads `deps.scrapeProfile(handle)` which defaults to `require('../socialMediaAPI').scrapeInstagramProfile`; unwraps `result.data[0]`; builds the snapshot with `summarise` (no language filter) and stores it; on failure stores `ok:false` with a short `error`, increments `competitor.tracking.failures`, and pauses the competitor after `FAIL_PAUSE_AFTER` consecutive failures; a changed handle resets the failures; never throws). `runTrackerOnce({ deps, now, limit = 20 })` -> `{ checked, skipped }`: selects accounts (active, onboarded, not staff, not CSM, entitled via `canUse(user,'competitors')`, not blocked by the background gate) that have tracked competitors; per competitor: has a handle, not ignored, not paused, newest attempt older than the cooldown AND (no snapshot for the current week); at most `MAX_TRACKED` most recently added per account; honours the daily read cap (`readsToday < READS_PER_DAY_MAX`), `spendGuard.check('competitor_scrape')` (stop the whole pass quietly when refused) and `spendGuard.record('competitor_scrape', 1)` after each read; competitors processed one at a time with a 1 s pause. `startCompetitorTracker({ intervalMs = 6h, firstDelayMs = 20 min })` (off when `NODE_ENV==='test'` or `ENABLE_COMPETITOR_TRACKER=off`; one log line at start; a re-entrancy guard so two ticks never overlap).

- [ ] **Step 1: Write the failing tests** `tests/competitorTracker.test.js` with fakes for every dependency (users, competitors, store, scrape, gate, spend guard, clock). Cases (write each body fully): (a) a due competitor is read once, snapshot saved, spend recorded; (b) not entitled / staff / blocked by the gate / free account: nothing read; (c) competitor without a handle, ignored, or paused: skipped; (d) cooldown: attempted 2 hours ago -> skipped; already has this week's snapshot -> skipped; (e) failed read stores `ok:false`, keeps the previous good snapshot as `latest`, failures counted, paused at 3, unpaused when the handle changes; (f) a scraper that throws never crashes the pass; (g) the daily cap stops the pass at the cap exactly; (h) spend guard refusal stops quietly with nothing read; (i) at most 5 competitors per account, most recently added first; (j) two overlapping `runTrackerOnce` calls: the re-entrancy guard makes the second a no-op.
- [ ] **Step 2: Run to verify they fail. Step 3: Implement** with `deps` injected and Mongo defaults (use `services/competitors/snapshotStore.js`, `Competitor`, `User`). **Step 4:** full backend suite. **Step 5: Commit** — `git commit -m "Competitors: weekly tracker with caps, cooldown, failure back-off and scheduler"`.

---

### Task 4: API for customers and staff

**Files:** Create `backend/routes/competitorInsights.js`; Modify `backend/server-main.js` (mount `GET /api/competitors/insights` BEFORE the existing competitors router), `backend/routes/staff.js`; Test `backend/tests/competitorInsightsRoutes.test.js`.

**Interfaces:** `GET /api/competitors/insights` (protect, entitlement `canUse(user,'competitors')` else 403 with the standard add-on message used by `requireFeature('competitors')`; read the middleware and reuse it) -> `{ success, weekStart, highlights, competitors: [{ id, name, handle, status ('tracking'|'no_handle'|'failed'|'paused'|'waiting'), trend, lastCheckedAt }] }` built with `insights()`; never returns raw snapshots or handles of other accounts. Staff: `GET /api/staff/clients/:id/competitors` (same body for that client; permission `view_clients`/`open_client`, CSM scope via `clientFor`) and `POST /api/staff/clients/:id/competitors/check` (runs `runTrackerOnce` restricted to that account, bypassing the 12-hour cooldown but NOT the daily cap or the spend guard, logged like other staff actions; staff only). Inside CSM and agency passes the customer endpoint works (it is the client's data).

- [ ] Steps: write tests with the harness style of `tests/planRoutes.test.js` (full bodies: entitlement refused, 401, shape, statuses for each competitor state, no cross-account data, staff scope, staff check respects caps); implement; run the full backend suite; commit `git commit -m "Competitors: insights API for customers and staff"`.

---

### Task 5: The card on My plan and Competitors

**Files:** Create `frontend/utils/competitorInsights.ts`, `frontend/components/CompetitorInsights.tsx`, `frontend/tests/competitorInsights.test.mjs`; Modify `frontend/services/api.ts` (`getCompetitorInsights`), `frontend/types.ts`, `frontend/pages/MyPlan.tsx` (below the 90 days), `frontend/pages/Competitors.tsx` (top), `frontend/tests/voice-scope.json`.

**Interfaces (pure, tested):** `cardState(res): 'locked'|'none'|'started'|'ready'|'error'` (`locked` when 403 or no entitlement, `none` no competitors, `started` competitors exist but no highlights yet, `ready` highlights exist, `error` request failed); `statusText(competitor): string` ('Tracking since Monday 12 October' / 'Add their Instagram handle to track them' / 'We could not read this account. Check the handle.' / 'Paused after repeated problems. Update the handle to resume.' / 'First results next week'); `trendLabel(trend): string` (e.g. 'Posts a week: 2, 5, 3, 4'); `highlightsFor(res): string[]`.
Behaviour: card titled 'What your competitors did', up to three highlight sentences, a compact list of competitors with status and trend, a link to the Competitors page to fix handles; `locked` state shows nothing on My plan and the existing add-on prompt on the Competitors page (do not duplicate it); posts wording only, no vendor names; mobile first, no sideways scroll at 375 px; follows the card style of `components/ThisWeekCard.tsx`.

- [ ] Steps: write the helper tests first (cardState for each response shape, statusText for each competitor state, trendLabel with 0/1/4 weeks, highlightsFor limit 3); implement helpers, component, api method, placements; run `cd frontend && node --test tests/*.test.mjs`, `npx tsc --noEmit` (only the old Influencers.tsx error), `node scripts/visual-audit/gen-layer-lists.mjs` then the tests again, `node scripts/brand-audit.mjs`, `node scripts/voice-audit.mjs`; do NOT use the browser (the controller checks); commit `git commit -m "Competitors: What your competitors did card on My plan and the Competitors page"`.

---

### Task 6: Verification, review, handover (controller)

- [ ] Full suites and audits green; a real-Mongo throwaway check of the store and a tracker pass with a FAKE scraper against `nebulaa_dev` (no cost); browser check of the card in each state with real API data (throwaway users: entitled with snapshots written through the real store, entitled with none, not entitled) at desktop and 375 px; ONE real scraper read only with the owner's OK (a few paise). One final review on the most capable model; fix; copy the build records to `docs/superpowers/plan-led-sdd/stage-4/`; update handover 8 and add the owner checklist notes (`ENABLE_COMPETITOR_TRACKER`, caps, the add-on gate, the first-results-next-week behaviour); push.
