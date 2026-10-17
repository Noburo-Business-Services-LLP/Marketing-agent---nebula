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
  assert.strictEqual(small.counts.carousels, 1, '130 pays for 5 posts (55) + 1 carousel (60) = 115 once both videos (322) are removed');
  assert.strictEqual(small.counts.posts, 5);
  assert.strictEqual(small.scaledDown, true);
  assert.strictEqual(small.removed.videos, 2);
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

test('a plan entry with no hook gets its pillar name as the topic, never a blank', () => {
  const planCalendar = [{ day: 1, pillar: 'Behind the oven', format: 'image post', hook: null }, { day: 2, pillar: 'Seasonal', format: 'image post', hook: { text: '' } }];
  const p = weekProposal({ planCalendar, calendarItems: [], cadence: { reelsPerWeek: 1 }, pool: 5000, costs, weekStart: '2026-10-12' });
  assert.deepStrictEqual(p.items.map((i) => i.topic), ['Behind the oven', 'Seasonal']);
});
