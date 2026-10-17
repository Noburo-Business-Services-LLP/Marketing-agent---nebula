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

