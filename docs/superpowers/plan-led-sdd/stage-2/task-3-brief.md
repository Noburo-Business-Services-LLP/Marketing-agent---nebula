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

