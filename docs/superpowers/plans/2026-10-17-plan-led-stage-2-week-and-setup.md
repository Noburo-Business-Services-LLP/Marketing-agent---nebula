# Plan-led Nebulaa, Stage 2: content follows the plan, setup path, "This week" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The calendar is generated from the customer's plan; the home screen shows a clear setup path and a weekly proposal ("this week we will make 5 posts, 1 carousel and 2 videos, shall we go?") that, once approved, makes the cheap posts at once and sends carousels and videos to their create screens pre-filled.

**Architecture:** Pure helpers decide the setup steps and the week's proposal (scaled to what the pool can pay). A `WeeklyProposal` document per account per week stores each item's status so nothing is made twice. Posts reuse the existing calendar generator (`generateSingleCalendarItem` in `services/backgroundQueue.js`, which writes the caption, renders the image and leaves a draft in Review and approve) behind one charge-and-refund wrapper; carousels and videos open the existing create screens through a one-shot prefill. The home screen gets a Setup card and a This week card.

**Tech Stack:** Node/Express/Mongoose, React 19 + TypeScript + Vite, node:test.

**Spec:** `docs/superpowers/specs/2026-10-17-plan-led-home-design.md` (Stage 2). **Depends on:** Stage 1 (`docs/superpowers/plans/2026-10-17-plan-led-stage-1-my-plan.md`): `planService.currentPlan(userId)`, `planRules.shouldHavePlan`, `profileComplete`, `GET /api/plan`, and the plan's `result.plan` shape (`pillars`, `calendar[{day,pillar,format,hook}]`, `channels`, `roadmap`, `effort`).

## Global Constraints

- Customers see posts and videos, never Quarks; no "credit", "trial", "7 days" in customer-facing files; no vendor names; brand and voice audits 0; regenerate layer lists after UI changes.
- The proposal never exceeds what the account's pool can pay (the pool is the agency's pool for an agency client workspace: read it through `walletBalance` from `services/agency.js`, never `credits.balance` directly; `tests/creditAccessGuard.test.js` must keep passing). Costs come from `config/apiCosts.js` (`QUARK_COSTS`), never literals.
- Nothing is made twice: item status only moves forward (proposed → approved → made, or → skipped); Approve pressed twice changes nothing; a post is charged when it is made, once, and refunded if its generation fails.
- Only single posts are made automatically after Approve; carousels and videos always wait for the customer to press Generate on their screen.
- Setup is suggested, never enforced: nothing is blocked except what cannot work (publishing without a connected account saves the post and points to Connect; the weekly proposal needs a plan).
- Managed clients are included like everyone (owner decision): the card shows for them and for staff working inside their account (a CSM pass). Staff accounts themselves never get a proposal. Free accounts get no proposal (they get the setup card and a "choose a plan" prompt).
- The weekly proposal data is user data: the new collection must be listed as erasable in `services/dataRegistry.js` (a test enforces it).
- Weeks start on Monday in `Asia/Kolkata` (the calendar's own timezone). Real runs only on `nebulaa_dev`; throwaway users deleted; any real generation (a post costs a few rupees) needs the owner's explicit OK. Do not read or print `.env`/secrets. Commit after every task with the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; never push (the controller pushes).

## Review Focus

1. Two Approve presses at once, or Approve then an automatic scheduler tick: each post is made and charged exactly once (Tasks 3, 5).
2. A post whose generation fails is refunded and shown as "could not be made, try again", never silently lost or charged twice (Task 3).
3. The pool cannot pay for the whole week: the proposal is scaled down (videos first, then carousels, then posts), says so plainly, and a pool that pays for nothing shows a top-up prompt instead of an empty card (Tasks 1, 7).
4. Agency client workspaces and managed clients: pool read from the right wallet, no direct `credits.balance` read, CSM pass allowed, staff accounts excluded (Tasks 3, 5).
5. A calendar that does not exist yet, or a plan missing: the week still gets a sensible fallback or the right next step, never an error screen (Tasks 1, 4, 7).

## File Structure

Backend, create: `services/week/weekMath.js` (week boundaries), `services/week/weekProposal.js` (pure proposal), `services/week/setupSteps.js` (pure), `services/week/weekService.js`, `models/WeeklyProposal.js`, `routes/week.js`, `services/week/planContext.js` (the plan's content guidance for the calendar prompt). Tests: `tests/weekMath.test.js`, `tests/weekProposal.test.js`, `tests/setupSteps.test.js`, `tests/weekService.test.js`, `tests/weekRoutes.test.js`, `tests/planContext.test.js`.
Backend, modify: `models/User.js` (`setup: { planOpenedAt, firstWeekApprovedAt }`), `services/dataRegistry.js` (WeeklyProposal), `services/contentCalendarService.js` (`calendarPrompt` gets plan context), `services/backgroundQueue.js` only if the charge wrapper must live there (prefer wrapping from `weekService`), `server-main.js` (mount `/api/week`, `/api/setup`).
Frontend, create: `utils/week.ts`, `utils/setup.ts`, `utils/prefill.ts`, `components/ThisWeekCard.tsx`, `components/SetupCard.tsx`, tests `tests/week.test.mjs`, `tests/setup.test.mjs`, `tests/prefill.test.mjs`. Modify: `services/api.ts`, `types.ts`, `pages/GravityHome.tsx`, `pages/GravityCreate.tsx` and `pages/CreateVideo.tsx` (consume a prefill once), `pages/MyPlan.tsx` (stamp `planOpenedAt` on open), `index.html` (generated).

---

### Task 1: The week's proposal (pure)

**Files:**
- Create: `backend/services/week/weekMath.js`, `backend/services/week/weekProposal.js`
- Test: `backend/tests/weekMath.test.js`, `backend/tests/weekProposal.test.js`

**Interfaces:**
- `weekMath.weekStartOf(date, tz = 'Asia/Kolkata'): string` → the Monday of that week as `'YYYY-MM-DD'` in `tz`; `weekDays(weekStart): string[]` → the seven `'YYYY-MM-DD'` dates; `dayOfMonth(isoDate): number`.
- `weekProposal({ planCalendar, calendarItems, cadence, pool, costs, weekStart, language }): { items, counts, scaledDown, removed, empty }` where `items: Array<{ id, kind: 'post'|'carousel'|'video', topic, channel, pillar, source: 'calendar'|'plan', calendarItemId? }>`, `counts: { posts, carousels, videos }`, `costs = { post, carousel, video }` (Quarks per unit), `pool` = Quarks available, `cadence = { postsPerWeek?, reelsPerWeek }`. Rules: (1) if `calendarItems` (this week's items from the account's ContentCalendar: `{ _id, day, format, headline, contentPillar }`) is non-empty use them (`source: 'calendar'`); else derive from `planCalendar` (`{ day, pillar, format, hook }`, day 1..30 counted from the plan start: the caller passes the 7 relevant entries already offset) (`source: 'plan'`); (2) map formats: contains 'reel' or 'video' → video; 'carousel' → carousel; else post; (3) cap videos at `cadence.reelsPerWeek` (default 1); (4) scale down while total cost > pool: remove videos first (last first), then carousels, then posts, recording `removed: { videos, carousels, posts }` and `scaledDown: true`; (5) `empty: true` when no item can be afforded (so the UI shows a top-up prompt); (6) item ids are deterministic: `${weekStart}:${index}`.

- [ ] **Step 1: Write the failing tests**

```js
// backend/tests/weekMath.test.js
const test = require('node:test');
const assert = require('node:assert');
const { weekStartOf, weekDays, dayOfMonth } = require('../services/week/weekMath');

test('the week starts on Monday in India time', () => {
  assert.strictEqual(weekStartOf(new Date('2026-10-17T06:00:00Z')), '2026-10-12'); // Saturday
  assert.strictEqual(weekStartOf(new Date('2026-10-12T00:30:00+05:30')), '2026-10-12'); // Monday just after midnight IST
  assert.strictEqual(weekStartOf(new Date('2026-10-11T20:00:00Z')), '2026-10-12'); // Sunday 20:00 UTC is already Monday 01:30 IST
  assert.strictEqual(weekStartOf(new Date('2026-10-18T17:00:00Z')), '2026-10-12'); // Sunday 22:30 IST
});
test('week days and month ends', () => {
  assert.deepStrictEqual(weekDays('2026-10-26'), ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']);
  assert.strictEqual(dayOfMonth('2026-11-01'), 1);
});
```

```js
// backend/tests/weekProposal.test.js
const test = require('node:test');
const assert = require('node:assert');
const { weekProposal } = require('../services/week/weekProposal');

const costs = { post: 11, carousel: 60, video: 161 };
const cal = (n, fmt = 'image post') => Array.from({ length: n }, (_, i) => ({ _id: `c${i}`, day: 12 + i, format: fmt, headline: `Idea ${i}`, contentPillar: 'Custom orders' }));
const mixed = () => [...cal(5), { _id: 'car', day: 17, format: 'carousel', headline: 'Five cakes', contentPillar: 'Seasonal' }, { _id: 'r1', day: 18, format: 'reel', headline: 'Behind the oven', contentPillar: 'Behind' }, { _id: 'r2', day: 19, format: 'reel video', headline: 'Second reel', contentPillar: 'Behind' }];

test('a calendar week becomes posts, carousels and videos, with videos capped by the cadence', () => {
  const p = weekProposal({ planCalendar: [], calendarItems: mixed(), cadence: { reelsPerWeek: 1 }, pool: 5000, costs, weekStart: '2026-10-12' });
  assert.deepStrictEqual(p.counts, { posts: 5, carousels: 1, videos: 1 });
  assert.strictEqual(p.scaledDown, false);
  assert.strictEqual(p.items[0].source, 'calendar');
  assert.deepStrictEqual(p.items.map((i) => i.id).slice(0, 2), ['2026-10-12:0', '2026-10-12:1']);
});

test('with no calendar the week comes from the plan', () => {
  const planCalendar = [{ day: 1, pillar: 'Behind the oven', format: 'image post', hook: { text: 'A cake being finished.' } }, { day: 2, pillar: 'Seasonal', format: 'reel', hook: { text: 'Diwali boxes.' } }];
  const p = weekProposal({ planCalendar, calendarItems: [], cadence: { reelsPerWeek: 1 }, pool: 5000, costs, weekStart: '2026-10-12' });
  assert.deepStrictEqual(p.counts, { posts: 1, carousels: 0, videos: 1 });
  assert.strictEqual(p.items[0].source, 'plan');
  assert.strictEqual(p.items[0].topic, 'A cake being finished.');
});

test('a small pool removes videos first, then carousels, then posts, and says so', () => {
  const small = weekProposal({ planCalendar: [], calendarItems: mixed(), cadence: { reelsPerWeek: 2 }, pool: 130, costs, weekStart: '2026-10-12' });
  assert.strictEqual(small.counts.videos, 0);
  assert.strictEqual(small.counts.carousels, 1, '130 pays for 1 carousel (60) and 6 posts (66)? 5 posts = 55 -> 115 fits');
  assert.strictEqual(small.scaledDown, true);
  assert.ok(small.removed.videos >= 1);
  const tiny = weekProposal({ planCalendar: [], calendarItems: mixed(), cadence: { reelsPerWeek: 1 }, pool: 25, costs, weekStart: '2026-10-12' });
  assert.deepStrictEqual(tiny.counts, { posts: 2, carousels: 0, videos: 0 });
  const none = weekProposal({ planCalendar: [], calendarItems: mixed(), cadence: { reelsPerWeek: 1 }, pool: 5, costs, weekStart: '2026-10-12' });
  assert.strictEqual(none.empty, true);
  assert.deepStrictEqual(none.items, []);
});

test('the proposal never costs more than the pool, whatever the inputs', () => {
  for (const pool of [0, 10, 11, 60, 70, 171, 233, 1000]) {
    const p = weekProposal({ planCalendar: [], calendarItems: mixed(), cadence: { reelsPerWeek: 2 }, pool, costs, weekStart: '2026-10-12' });
    const cost = p.counts.posts * costs.post + p.counts.carousels * costs.carousel + p.counts.videos * costs.video;
    assert.ok(cost <= pool, `${cost} > ${pool}`);
  }
});

test('nothing at all (no calendar, no plan) is an empty week, not an error', () => {
  const p = weekProposal({ planCalendar: [], calendarItems: [], cadence: {}, pool: 1000, costs, weekStart: '2026-10-12' });
  assert.strictEqual(p.empty, true);
  assert.deepStrictEqual(p.counts, { posts: 0, carousels: 0, videos: 0 });
});
```
Note for the implementer: in the second test of "a small pool" the comment states the arithmetic; fix the assertion text if your cost model differs, but keep the order of removal (videos, carousels, posts) and the "never over the pool" invariant.

- [ ] **Step 2: Run to verify they fail** — `cd backend && node --test tests/weekMath.test.js tests/weekProposal.test.js` → modules not found.

- [ ] **Step 3: Implement**

`weekMath.js`: use `Intl.DateTimeFormat('en-CA', { timeZone: tz, year:'numeric', month:'2-digit', day:'2-digit' })` to get the local date string of `date`, parse it as UTC midnight, compute the weekday (`(getUTCDay() + 6) % 7` = days since Monday), subtract, and format. `weekDays` adds 0..6 days in UTC arithmetic. `dayOfMonth` parses the last two characters.
`weekProposal.js` per the rules above; keep it a single pure function with small helpers `kindOf(format)`, `fromCalendar`, `fromPlan`, `scaleDown`; the removal loop removes from the end of the item list of the costliest kind present, tracking `removed`. `empty` is true when the final item list is empty.

- [ ] **Step 4: Run to verify they pass.**
- [ ] **Step 5: Commit** — `git add backend && git commit -m "Week: week boundaries and the proposal for the week, scaled to the pool"`

---

### Task 2: The setup path (pure)

**Files:**
- Create: `backend/services/week/setupSteps.js`
- Test: `backend/tests/setupSteps.test.js`

**Interfaces:**
- `setupSteps({ user, state }): { steps: Array<{ id, title, done, reason, minutes }>, next: string|null, allDone: boolean }` with ids `profile`, `socials`, `plan`, `week`. `state = { connectedCount, hasPlan, planOpened, firstWeekApproved, isPaid }`. Rules: `profile.done = profileComplete(user).complete` (Stage 1 helper); `socials.done = connectedCount > 0`; `plan.done = planOpened` (the plan exists AND was opened once); `week.done = firstWeekApproved`. `next` is the first step not done, except: `plan` is not offered (and not shown as `next`) until `hasPlan` (instead the profile step explains why); for a free account (`!isPaid`) the `plan` and `week` steps are replaced by one step `choose` ("Choose a plan") so the card never promises what a free account cannot do. Titles in plain words: 'Complete your business profile', 'Connect your social accounts', 'Read your plan', 'Approve your first week', 'Choose a plan'. `reason` is one short sentence ('Your plan is built from it.', 'So posts can go out for you. You can make posts without it.', ...). `minutes` is a small estimate (profile 5, socials 2, plan 3, week 1).

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/setupSteps.test.js
const test = require('node:test');
const assert = require('node:assert');
const { setupSteps } = require('../services/week/setupSteps');
const full = { companyName: 'Sweet Co', businessProfile: { name: 'Sweet Co', website: 'sweetco.in', description: 'Custom cakes baked to order', targetAudience: 'Families' } };
const empty = { businessProfile: {} };
const st = (o = {}) => ({ connectedCount: 0, hasPlan: false, planOpened: false, firstWeekApproved: false, isPaid: true, ...o });

test('a brand new paying account is told to complete the profile first', () => {
  const r = setupSteps({ user: empty, state: st() });
  assert.deepStrictEqual(r.steps.map((s) => s.id), ['profile', 'socials', 'plan', 'week']);
  assert.strictEqual(r.next, 'profile');
  assert.strictEqual(r.allDone, false);
});
test('the order is suggested: socials can be done before the profile, and next is always the first undone step', () => {
  const r = setupSteps({ user: empty, state: st({ connectedCount: 1 }) });
  assert.strictEqual(r.steps.find((s) => s.id === 'socials').done, true);
  assert.strictEqual(r.next, 'profile');
});
test('the plan step waits until a plan exists, then asks to read it', () => {
  const waiting = setupSteps({ user: full, state: st({ connectedCount: 1 }) });
  assert.strictEqual(waiting.next, null, 'profile and socials done, plan not built yet: nothing to ask of the customer');
  const ready = setupSteps({ user: full, state: st({ connectedCount: 1, hasPlan: true }) });
  assert.strictEqual(ready.next, 'plan');
});
test('everything done', () => {
  const r = setupSteps({ user: full, state: st({ connectedCount: 2, hasPlan: true, planOpened: true, firstWeekApproved: true }) });
  assert.strictEqual(r.allDone, true);
  assert.strictEqual(r.next, null);
});
test('a free account sees a Choose a plan step instead of promises it cannot keep', () => {
  const r = setupSteps({ user: full, state: st({ isPaid: false, connectedCount: 0 }) });
  assert.deepStrictEqual(r.steps.map((s) => s.id), ['profile', 'socials', 'choose']);
  assert.strictEqual(r.steps.find((s) => s.id === 'choose').done, false);
});
test('no step title mentions credits, trials or Quarks', () => {
  const r = setupSteps({ user: empty, state: st() });
  r.steps.forEach((s) => assert.doesNotMatch(`${s.title} ${s.reason}`, /credit|trial|quark/i));
});
```

- [ ] **Step 2: Run to verify it fails.** **Step 3: Implement** per the rules, importing `profileComplete` from `../plan/profileInput`. **Step 4: Run to verify it passes.** **Step 5: Commit** — `git add backend && git commit -m "Setup: ordered, suggested steps with one next step"`

---

### Task 3: Weekly proposal storage and the make-a-post wrapper

**Files:**
- Create: `backend/models/WeeklyProposal.js`, `backend/services/week/weekService.js`
- Modify: `backend/services/dataRegistry.js` (add `WeeklyProposal` rule: field `userId`, action `delete`), `backend/models/User.js` (add `setup: { planOpenedAt: Date, firstWeekApprovedAt: Date }`)
- Test: `backend/tests/weekService.test.js`

**Interfaces:**
- `WeeklyProposal` (collection `weekly_proposals`): `userId`, `weekStart` (string), `status: 'proposed'|'approved'|'skipped'|'expired'`, `items: [{ id, kind, topic, channel, pillar, source, calendarItemId, status: 'proposed'|'approved'|'made'|'skipped'|'failed', ref, error, madeAt }]`, `scaledDown`, `removed`, `createdAt`, unique index `{ userId: 1, weekStart: 1 }`.
- `createWeekService(deps)` returns:
  - `getOrCreate({ user, now }): Promise<{ proposal, eligible, reason }>`: eligible only when `shouldHavePlan(user)` (Stage 1) and the account is paying or managed; builds with `weekProposal` using `deps.pool(userId)`, `deps.costs`, `deps.calendarItemsForWeek`, `deps.planCalendarForWeek`, `deps.cadence`; idempotent: an existing document for the week is returned unchanged (a changed pool does not rewrite an approved week).
  - `approve({ user, itemIds?, now }): Promise<{ proposal, started }>`: marks the proposal approved and each selected `post` item `approved` using ONE atomic conditional update per item (`status: 'proposed'` → `'approved'`), then makes each newly approved post through `makePost`; carousel and video items are marked `approved` (not made) and returned with a `prefill` object for their create screen.
  - `change({ user, itemId, action: 'skip'|'swap', topic? })`: skip an item or change its topic (only while `proposed`).
  - `skipWeek({ user })`.
  - `makePost({ user, item }): Promise<{ ok, ref?, error? }>` (exported for tests): (1) charge `QUARK_COSTS.post`-equivalent through `deps.deduct(userId, 'image_generated', 1, 'Weekly plan post')`; if it fails return `{ ok:false, error:'no_pool' }` and mark the item `failed` without generating; (2) call `deps.generate(calendar, calendarItem, weekNumber)` = `generateSingleCalendarItem`; (3) on error `deps.refund(...)`, mark `failed` with a short error, return `{ ok:false }`; on success mark `made` with `ref` = the created draft id. Charging rule check (see Step 3): if the existing generator already charges, do NOT charge twice.

- [ ] **Step 1: Write the failing tests** (fakes for every dep; model the item state in memory)

```js
// backend/tests/weekService.test.js
const test = require('node:test');
const assert = require('node:assert');
const { createWeekService } = require('../services/week/weekService');

const NOW = new Date('2026-10-17T06:00:00Z');
const user = (extra = {}) => ({ _id: 'u1', isActive: true, onboardingCompleted: true, plan: { tier: 'starter' }, businessProfile: { name: 'Sweet Co', website: 'a.in', description: 'Custom cakes baked to order', targetAudience: 'Families' }, ...extra });
function world({ pool = 2000, genFails = false, deductOk = true } = {}) {
  const store = new Map(); const log = { deduct: [], refund: [], generate: [] };
  const deps = {
    costs: { post: 11, carousel: 60, video: 161 },
    pool: async () => pool,
    cadence: async () => ({ reelsPerWeek: 1 }),
    calendarItemsForWeek: async () => [{ _id: 'c1', day: 13, format: 'image post', headline: 'Idea 1', contentPillar: 'P' }, { _id: 'c2', day: 14, format: 'image post', headline: 'Idea 2', contentPillar: 'P' }, { _id: 'c3', day: 15, format: 'carousel', headline: 'Five cakes', contentPillar: 'P' }, { _id: 'c4', day: 16, format: 'reel', headline: 'Behind the oven', contentPillar: 'P' }],
    planCalendarForWeek: async () => [],
    store: {
      find: async (q) => store.get(`${q.userId}:${q.weekStart}`) || null,
      create: async (doc) => { store.set(`${doc.userId}:${doc.weekStart}`, doc); return doc; },
      claimItem: async (q, itemId, from, to) => { const d = store.get(`${q.userId}:${q.weekStart}`); const it = d.items.find((i) => i.id === itemId); if (!it || it.status !== from) return false; it.status = to; return true; },
      setItem: async (q, itemId, patch) => { const d = store.get(`${q.userId}:${q.weekStart}`); Object.assign(d.items.find((i) => i.id === itemId), patch); },
      setStatus: async (q, status) => { store.get(`${q.userId}:${q.weekStart}`).status = status; }
    },
    deduct: async (id, action, n, why) => { log.deduct.push([id, action]); return { success: deductOk }; },
    refund: async (id, action) => { log.refund.push([id, action]); return { success: true }; },
    generate: async (cal, item) => { log.generate.push(item._id || item.calendarItemId); if (genFails) throw new Error('image failed'); return { draftId: 'd' + log.generate.length }; },
    calendarFor: async () => ({ calendar: { _id: 'cal' }, find: (id) => ({ _id: id }), weekNumber: 3 }),
    now: () => NOW
  };
  return { svc: createWeekService(deps), log, store };
}

test('the week is proposed once and the same document comes back the second time', async () => {
  const { svc } = world();
  const a = await svc.getOrCreate({ user: user(), now: NOW });
  const b = await svc.getOrCreate({ user: user(), now: NOW });
  assert.strictEqual(a.eligible, true);
  assert.strictEqual(a.proposal.weekStart, '2026-10-12');
  assert.deepStrictEqual(a.proposal.items, b.proposal.items);
});

test('free, staff and incomplete accounts get no proposal', async () => {
  for (const patch of [{ plan: { tier: 'free' } }, { staffRole: 'owner' }, { businessProfile: { name: 'x' } }]) {
    const { svc } = world();
    const r = await svc.getOrCreate({ user: user(patch), now: NOW });
    assert.strictEqual(r.eligible, false);
  }
});

test('approve makes each post once and charges once; carousels and videos are only approved and returned with a prefill', async () => {
  const { svc, log } = world();
  await svc.getOrCreate({ user: user(), now: NOW });
  const out = await svc.approve({ user: user(), now: NOW });
  assert.strictEqual(log.generate.length, 2);
  assert.strictEqual(log.deduct.length, 2);
  const byKind = Object.fromEntries(out.proposal.items.map((i) => [i.kind, i.status]));
  assert.strictEqual(byKind.post, 'made');
  assert.strictEqual(byKind.carousel, 'approved');
  assert.strictEqual(byKind.video, 'approved');
  const car = out.proposal.items.find((i) => i.kind === 'carousel');
  assert.ok(out.prefills.some((p) => p.itemId === car.id && p.target === 'carousel'));
});

test('pressing Approve twice at the same moment makes and charges each post once', async () => {
  const { svc, log } = world();
  await svc.getOrCreate({ user: user(), now: NOW });
  await Promise.all([svc.approve({ user: user(), now: NOW }), svc.approve({ user: user(), now: NOW })]);
  assert.strictEqual(log.generate.length, 2);
  assert.strictEqual(log.deduct.length, 2);
});

test('a post whose image fails is refunded and shown as failed, not lost; a later approve can retry only the failed post', async () => {
  const { svc, log } = world({ genFails: true });
  await svc.getOrCreate({ user: user(), now: NOW });
  const out = await svc.approve({ user: user(), now: NOW });
  assert.strictEqual(log.refund.length, 2);
  assert.ok(out.proposal.items.filter((i) => i.kind === 'post').every((i) => i.status === 'failed'));
});

test('no pool means nothing is generated and the post is marked failed without a refund', async () => {
  const { svc, log } = world({ deductOk: false });
  await svc.getOrCreate({ user: user(), now: NOW });
  await svc.approve({ user: user(), now: NOW });
  assert.strictEqual(log.generate.length, 0);
  assert.strictEqual(log.refund.length, 0);
});

test('skip and swap only work while an item is still proposed', async () => {
  const { svc } = world();
  const { proposal } = await svc.getOrCreate({ user: user(), now: NOW });
  const id = proposal.items[0].id;
  assert.strictEqual((await svc.change({ user: user(), itemId: id, action: 'swap', topic: 'New idea', now: NOW })).ok, true);
  assert.strictEqual((await svc.change({ user: user(), itemId: id, action: 'skip', now: NOW })).ok, true);
  assert.strictEqual((await svc.change({ user: user(), itemId: id, action: 'skip', now: NOW })).ok, false, 'already skipped');
});
```

- [ ] **Step 2: Run to verify they fail** — module not found.

- [ ] **Step 3: Implement.** Read `services/backgroundQueue.js` `generateSingleCalendarItem(calendar, item, weekNumber)` and `contentCalendarService.getCurrentCalendar/findItem` first. **Charging check:** read what the generator and `processAutoGeneration` charge today. If `generateSingleCalendarItem` does NOT charge (it appears not to), `makePost` must charge with `deductCredits(userId, 'image_generated', 1, ...)` before generating and `refundCredits` on failure, exactly as the tests state; if it DOES charge, remove the wrapper's charge and change the two tests to assert no extra charge (state which in the commit message). Also report to the controller whether the existing monthly auto-generation path is charging customers at all (a possible cost leak for paying accounts): do not change it in this task, just report. `deps` defaults wire to Mongo (`WeeklyProposal`), `walletBalance` (pool), `getContentCadence`, `deductCredits`/`refundCredits` from `middleware/trialGuard`, and the calendar helpers (`calendarFor` finds the current month's `ContentCalendar` and the item by `calendarItemId`; for plan-sourced items with no calendar item, make the post through the same generator with a synthetic item `{ headline: topic, creativeConcept: topic, format: 'image post', day }` attached to a calendar created on demand with `generateMonthlyCalendar`: if that is not possible without cost, return `{ ok:false, error:'no_calendar' }` and mark failed; say which in the report). `claimItem` uses `findOneAndUpdate({ userId, weekStart, items: { $elemMatch: { id, status: from } } }, { $set: { 'items.$.status': to } })`. Add the `WeeklyProposal` rule to `dataRegistry.js` and run `tests/dataRegistry.test.js`.

- [ ] **Step 4: Run to verify they pass** — `cd backend && node --test tests/weekService.test.js tests/dataRegistry.test.js` then the full suite.
- [ ] **Step 5: Commit** — `git add backend && git commit -m "Week: weekly proposal storage, approve makes each post once, refund on failure"`

---

### Task 4: The calendar follows the plan

**Files:**
- Create: `backend/services/week/planContext.js`
- Modify: `backend/services/contentCalendarService.js` (`calendarPrompt` and `generateMonthlyCalendar`: add the plan block when a plan exists)
- Test: `backend/tests/planContext.test.js`

**Interfaces:**
- `planContext({ plan, now }): { pillars, channelMix, phase, focus, text } | null` (pure): from `plan.result.plan` and the plan's start date (`completedAt`): `phase` = `foundation` (days 1 to 30 since the plan's first run for this account), `storytelling` (31 to 60), `growth` (61 and later, capped at growth); `pillars` = the plan's pillar names; `channelMix` = `effort` rows (`channel`, `organicPct`) or channels with roles when no effort; `focus` = that phase's roadmap `focus.text` and the first two `actions`; `text` = a short instruction block (max 900 characters) for the calendar prompt: "Plan guidance: themes: …; channels: …; this month's phase: … focus: …; keep every idea inside these themes." Returns null when `plan` is null or malformed.
- `generateMonthlyCalendar` accepts `{ planGuidance }` (string) and puts it in the prompt through `calendarPrompt`; the caller loads the plan via `planService.currentPlan(userId)` and `planContext`. No plan → identical prompt to today (a test pins this).

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/planContext.test.js
const test = require('node:test');
const assert = require('node:assert');
const { planContext } = require('../services/week/planContext');
const plan = { id: 'p', completedAt: new Date('2026-09-20'), result: { plan: {
  pillars: [{ name: 'Behind the oven' }, { name: 'Custom orders' }, { name: 'Happy tables' }],
  channels: [{ channel: 'Instagram', role: { text: 'Show the cakes.' } }],
  effort: [{ channel: 'Instagram', organicPct: 80, paidPct: 20 }],
  roadmap: [{ phase: 'foundation', focus: { text: 'Set up the basics.' }, actions: [{ text: 'Post three times a week.' }, { text: 'Reply to every comment.' }, { text: 'Third' }] }, { phase: 'storytelling', focus: { text: 'Tell customer stories.' }, actions: [] }, { phase: 'growth', focus: { text: 'Grow reach.' }, actions: [] }]
} } };
test('the phase follows the days since the plan started', () => {
  assert.strictEqual(planContext({ plan, now: new Date('2026-10-05') }).phase, 'foundation');
  assert.strictEqual(planContext({ plan, now: new Date('2026-10-25') }).phase, 'storytelling');
  assert.strictEqual(planContext({ plan, now: new Date('2026-12-30') }).phase, 'growth');
});
test('the guidance text names the themes, channels and the phase focus, and stays short', () => {
  const c = planContext({ plan, now: new Date('2026-10-05') });
  assert.match(c.text, /Behind the oven/);
  assert.match(c.text, /Instagram/);
  assert.match(c.text, /Set up the basics/);
  assert.ok(c.text.length <= 900);
  assert.deepStrictEqual(c.pillars, ['Behind the oven', 'Custom orders', 'Happy tables']);
});
test('no plan or a broken plan gives null, never an error', () => {
  assert.strictEqual(planContext({ plan: null, now: new Date() }), null);
  assert.strictEqual(planContext({ plan: { result: {} }, now: new Date() }), null);
});
```
Add a second test file section in the same file for the prompt: `calendarPrompt(profile, month, '', {})` equals the old output when no `planGuidance` is passed (compute the old output once in the test by calling with an explicit empty guidance and compare equal), and contains the guidance when passed.

- [ ] **Step 2: Run to verify it fails.** **Step 3: Implement** `planContext.js` (pure) and the small additions to `calendarPrompt` (append the guidance block before the output-format instructions; read the function first and keep every existing line) and `generateMonthlyCalendar` (accept `planGuidance`, pass through). Wire the callers in `routes/contentCalendar.js` (`generate-next`, `regenerate`) and `processAutoGeneration` only where a calendar is generated: load the plan with `planService.currentPlan` inside try/catch (a plan lookup failure must never block calendar generation). **Step 4: Run the test, then the full backend suite. Step 5: Commit** — `git add backend && git commit -m "Calendar: monthly content follows the plan's themes, channels and phase"`

---

### Task 5: API for the week and the setup path

**Files:**
- Create: `backend/routes/week.js`
- Modify: `backend/server-main.js` (mount `/api/week` and `/api/setup`), `backend/routes/plan.js` (stamp `setup.planOpenedAt` when `GET /api/plan` returns a plan, once), `backend/routes/auth.js` only if `/me` should include `setup` (add `setup: { planOpenedAt, firstWeekApprovedAt }` to `toPublicJSON`)
- Test: `backend/tests/weekRoutes.test.js`

**Interfaces:**
- `GET /api/week` → `{ success, eligible, reason, proposal: { weekStart, status, items[], counts, scaledDown, removed, empty } | null, topUp: boolean }` (`topUp` true when `empty` because the pool is below one post); `POST /api/week/approve` body `{ itemIds? }` → `{ success, proposal, prefills: [{ itemId, target: 'carousel'|'video', route, prefill }] }`; `POST /api/week/items/:id` body `{ action: 'skip'|'swap', topic? }`; `POST /api/week/skip`; `GET /api/setup` → `{ success, steps, next, allDone }` built with `setupSteps` from the user, the connected account count, `planService.currentPlan` and `user.setup`.
- A switch: when the environment variable `ENABLE_WEEKLY_PROPOSAL` equals `off`, `GET /api/week` answers `{ success: true, eligible: false, reason: 'off', proposal: null }` and the write routes answer 403 (a test covers it); unset or anything else means on.
- All protected; refused with 403 for staff accounts; allowed in a CSM pass and an agency pass (no money or plan changes happen in these routes beyond the post charge, which goes to the correct payer through `deductCredits`). Rate limit 30 per 15 minutes on writes. When Approve stamps `setup.firstWeekApprovedAt` the first time.

- [ ] **Step 1: Write the failing test** (same harness style as `tests/planRoutes.test.js` from Stage 1: injected fake services)

```js
// backend/tests/weekRoutes.test.js
const test = require('node:test');
const assert = require('node:assert');
// harness: makeHarness(createWeekRouter({ week: fakeWeekService, plan: fakePlanService, setup: fakeSetupDeps }), { user })
test('GET /api/week returns the proposal for an eligible account and an explanation otherwise', async () => {});
test('POST /api/week/approve returns the prefills for carousels and videos and stamps firstWeekApprovedAt once', async () => {});
test('writes are refused for staff accounts and limited per account', async () => {});
test('GET /api/setup returns ordered steps with one next step', async () => {});
test('opening the plan stamps planOpenedAt once and never again', async () => {});
test('a request inside an agency or CSM pass works on the client account', async () => {});
```
Write each test body fully against the harness; the titles state the expected status codes and fields (200/403/429, `next`, `prefills[].target`).

- [ ] **Step 2: Run to verify they fail.** **Step 3: Implement** `routes/week.js` as `createWeekRouter(impl)` following `routes/plan.js`; prefill objects: carousel → `{ route: '/campaigns', target: 'carousel', prefill: { mode: 'carousel', topic, platform: channel, language } }`; video → `{ route: '/reels', target: 'video', prefill: { idea: topic, language } }` (exact field names must match what Task 6 consumes). **Step 4: Run the test and the full suite. Step 5: Commit** — `git add backend && git commit -m "Week: /api/week and /api/setup, first approval and plan opening are recorded"`

---

### Task 6: One-shot prefill for the create screens

**Files:**
- Create: `frontend/utils/prefill.ts`, `frontend/tests/prefill.test.mjs`
- Modify: `frontend/pages/GravityCreate.tsx` (read the prefill on mount: topic/description, mode `carousel`, platform, language), `frontend/pages/CreateVideo.tsx` (idea, language), both clearing it after use

**Interfaces:**
- `setPrefill(target: 'carousel'|'video', data: object, storage = sessionStorage)`; `takePrefill(target, storage)` returns the data once and removes it (a second call returns `null`); data older than 15 minutes is discarded; storage errors are swallowed (no prefill, no crash); `PrefillData` types for the two targets.

- [ ] **Step 1: Write the failing test**

```js
// frontend/tests/prefill.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { setPrefill, takePrefill } from '../utils/prefill.ts';
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };

test('a prefill is handed over once and then gone', () => {
  const s = mem();
  setPrefill('video', { idea: 'Behind the oven', language: 'english' }, s, 1000);
  assert.deepEqual(takePrefill('video', s, 2000), { idea: 'Behind the oven', language: 'english' });
  assert.equal(takePrefill('video', s, 2000), null);
});
test('a prefill for one screen is not given to the other', () => {
  const s = mem();
  setPrefill('carousel', { topic: 'Five cakes' }, s, 1000);
  assert.equal(takePrefill('video', s, 1500), null);
  assert.deepEqual(takePrefill('carousel', s, 1500), { topic: 'Five cakes' });
});
test('an old prefill is dropped', () => {
  const s = mem();
  setPrefill('video', { idea: 'x' }, s, 1000);
  assert.equal(takePrefill('video', s, 1000 + 16 * 60 * 1000), null);
});
test('broken storage never throws', () => {
  const bad = { getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); }, removeItem() { throw new Error('no'); } };
  assert.doesNotThrow(() => setPrefill('video', { idea: 'x' }, bad, 1));
  assert.equal(takePrefill('video', bad, 2), null);
});
```

- [ ] **Step 2: Run to verify it fails.** **Step 3: Implement** `prefill.ts` (the extra `now` argument defaults to `Date.now()`), then consume it in the two pages: read the page's own state setters first (GravityCreate: `setMode('single')` or the carousel mode, `setDescription`, `setSelectedPlatforms`, `setLanguage`; CreateVideo: `setIdea`, `setLanguage`), apply the prefill in a one-time `useEffect` on mount, and show a small note "Filled in from your plan. Change anything you like." that disappears on first edit. The page must still work unchanged when no prefill exists. **Step 4:** run `cd frontend && node --test tests/*.test.mjs`, `npx tsc --noEmit` (only the old Influencers error). **Step 5: Commit** — `git add frontend && git commit -m "Create screens accept a one-shot prefill from the plan"`

---

### Task 7: Setup card, This week card, home screen

**Files:**
- Create: `frontend/utils/week.ts`, `frontend/utils/setup.ts`, `frontend/components/ThisWeekCard.tsx`, `frontend/components/SetupCard.tsx`, `frontend/tests/week.test.mjs`, `frontend/tests/setup.test.mjs`
- Modify: `frontend/services/api.ts` (`getWeek`, `approveWeek`, `changeWeekItem`, `skipWeek`, `getSetup`), `frontend/types.ts`, `frontend/pages/GravityHome.tsx` (replace the old "Finish setting up" notice with the cards; This week card above the hero review block for set-up accounts), `frontend/pages/MyPlan.tsx` is unchanged here, `frontend/index.html` (generated)

**Interfaces:**
- `utils/week.ts` (pure): `headline(counts): string` ("This week we will make 5 posts, 1 carousel and 2 videos, based on your plan."; singular and plural correct; zero parts omitted; all zero → 'Nothing is planned for this week yet.'); `itemLine(item): string`; `cardState(res): 'ready'|'approved'|'partly'|'skipped'|'top_up'|'no_plan'|'not_eligible'|'empty'` and `actionsFor(state)`; `scaledNote(proposal): string` ("Your pool covers most of the week, so we left out 1 video. Top up to add it back."); `canRaise(item, counts, ...)` not needed (changes are skip/swap only in this stage).
- `utils/setup.ts` (pure): `cardModel(setup): { show: boolean, title, nextStep, steps }`; the card is hidden when `allDone`; the next step carries `to` (route): profile → `/settings?tab=business`, socials → `/connect-socials`, plan → `/plan`, week → `/` (focus the This week card), choose → `/trial-expired`.
- `ThisWeekCard.tsx`: shows the headline, the list of items (kind icon, topic, channel) with Skip and Change on each, Approve and Skip this week buttons, the scaled-down note, states: approved (post items show "In Review and approve" or "Making…" or "Could not be made, try again"; carousel and video items show "Make this carousel" / "Make this video" buttons that call `setPrefill` and navigate to the screen), top-up prompt ("Top up to make this week's posts"), no plan ("Your plan is being built; it appears here when ready"), free account (no card; the Setup card's Choose a plan step covers it). Never shows Quarks.
- `SetupCard.tsx`: ordered steps with ticks, the one highlighted next step with its estimated minutes and a button, collapsible on mobile.

- [ ] **Step 1: Write the failing tests**

```js
// frontend/tests/week.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { headline, cardState, scaledNote } from '../utils/week.ts';

test('the headline counts plainly and never says zero of something', () => {
  assert.equal(headline({ posts: 5, carousels: 1, videos: 2 }), 'This week we will make 5 posts, 1 carousel and 2 videos, based on your plan.');
  assert.equal(headline({ posts: 1, carousels: 0, videos: 0 }), 'This week we will make 1 post, based on your plan.');
  assert.equal(headline({ posts: 0, carousels: 0, videos: 1 }), 'This week we will make 1 video, based on your plan.');
  assert.equal(headline({ posts: 0, carousels: 0, videos: 0 }), 'Nothing is planned for this week yet.');
});
test('the card state follows the server answer', () => {
  assert.equal(cardState({ eligible: false, reason: 'free' }), 'not_eligible');
  assert.equal(cardState({ eligible: true, proposal: null }), 'no_plan');
  assert.equal(cardState({ eligible: true, topUp: true, proposal: { empty: true, items: [] } }), 'top_up');
  assert.equal(cardState({ eligible: true, proposal: { status: 'proposed', items: [{ status: 'proposed' }] } }), 'ready');
  assert.equal(cardState({ eligible: true, proposal: { status: 'approved', items: [{ status: 'made' }, { status: 'made' }] } }), 'approved');
  assert.equal(cardState({ eligible: true, proposal: { status: 'approved', items: [{ status: 'made' }, { status: 'approved', kind: 'video' }] } }), 'partly');
  assert.equal(cardState({ eligible: true, proposal: { status: 'skipped', items: [] } }), 'skipped');
});
test('the scaled-down note is plain and mentions what was left out', () => {
  assert.match(scaledNote({ scaledDown: true, removed: { videos: 1, carousels: 0, posts: 0 } }), /left out 1 video/);
  assert.equal(scaledNote({ scaledDown: false }), '');
  assert.doesNotMatch(scaledNote({ scaledDown: true, removed: { videos: 2, carousels: 1, posts: 0 } }), /quark|credit|trial/i);
});
```

```js
// frontend/tests/setup.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { cardModel } from '../utils/setup.ts';
const steps = (done) => ['profile', 'socials', 'plan', 'week'].map((id, i) => ({ id, title: id, done: done[i], reason: '', minutes: 1 }));
test('the card shows the next step with its route, and hides when everything is done', () => {
  const m = cardModel({ steps: steps([false, false, false, false]), next: 'profile', allDone: false });
  assert.equal(m.show, true);
  assert.equal(m.nextStep.to, '/settings?tab=business');
  assert.equal(cardModel({ steps: steps([true, true, true, true]), next: null, allDone: true }).show, false);
});
test('every step has a route and a free account is sent to choose a plan', () => {
  const m = cardModel({ steps: [{ id: 'choose', title: 'Choose a plan', done: false, reason: '', minutes: 1 }], next: 'choose', allDone: false });
  assert.equal(m.nextStep.to, '/trial-expired');
  for (const [id, to] of [['socials', '/connect-socials'], ['plan', '/plan'], ['week', '/']]) assert.equal(cardModel({ steps: [{ id, title: id, done: false, reason: '', minutes: 1 }], next: id, allDone: false }).nextStep.to, to);
});
test('when nothing is asked of the customer yet the card says what is happening instead of a button', () => {
  const m = cardModel({ steps: steps([true, true, false, false]), next: null, allDone: false });
  assert.equal(m.show, true);
  assert.equal(m.nextStep, null);
  assert.match(m.waiting, /plan/i);
});
```

- [ ] **Step 2: Run to verify they fail.** **Step 3: Implement** helpers, components and the home integration (follow the card style of `AgencyUsage.tsx`/`AccountPrivacy.tsx`; use `--gv-*` tokens; mobile-first; the This week card keeps focus management: after Approve, focus moves to the status line; all buttons have visible focus; items list is a real list). In `GravityHome.tsx` remove the old "Finish setting up Nebulaa" block (keep its link target in the Setup card) and render `SetupCard` then `ThisWeekCard` above the hero. The Setup card must not show for a CSM pass or staff accounts. **Step 4:** run the frontend tests, `npx tsc --noEmit`, `node scripts/visual-audit/gen-layer-lists.mjs` then tests again, brand and voice audits (0). In the browser with throwaway users (new account, profile done with plan, set up and approved, free account, pool too small, agency client workspace) check the cards at desktop and 375 px, then delete the users. **Step 5: Commit** — `git add frontend && git commit -m "Home: setup path card and the This week proposal card"`

---

### Task 8: Real run, charging check, handover

**Files:** `docs/superpowers/ops/week-launch-checklist.md`, handover update.

- [ ] **Step 1: Everything green.** Backend and frontend suites, audits 0, layer lists committed.
- [ ] **Step 2: Charging findings.** Write into the handover what Task 3 found about whether `generateSingleCalendarItem` and the monthly auto-generation charge the customer, and if they do not, raise it to the owner as a cost decision (do not change the auto-generation behaviour without the owner).
- [ ] **Step 3: Real run on `nebulaa_dev`** with the owner's OK for the spend (one post, a few rupees): throwaway paying user with a complete profile and a plan (from Stage 1, or a stored plan fixture), a calendar for the month; `GET /api/week` creates the proposal; Approve makes the posts (draft appears in Review and approve with an image; pool fell by exactly the post price; one `QuarkLedger` row each); a second Approve changes nothing; kill-switch the image provider to prove the refund path; skip and swap work; setup path steps update as the profile, socials, plan opening and approval happen; an agency client workspace pays from the agency pool; clean up all rows (drafts, campaigns, ledger, proposals, users).
- [ ] **Step 4: Checklist and handover.** The checklist lists owner steps: confirm the weekly proposal wording, decide whether the monthly auto-generation should stay on, tell managed clients before the cards appear, and how to switch the proposal off if needed (`ENABLE_WEEKLY_PROPOSAL=off` read by `GET /api/week`: add this switch in Task 5 and mention it here).
- [ ] **Step 5: Commit** — `git add docs && git commit -m "Plan-led Stage 2: verification, checklist, handover"`
