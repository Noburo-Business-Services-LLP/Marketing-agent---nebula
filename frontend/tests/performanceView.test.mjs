import test from 'node:test';
import assert from 'node:assert/strict';
import {
  changeWords, seriesOf, cleanHistory, engagementOf, followerGains, weeklyPosts, buildKpis, sparkPath, bestPostOfMonth,
  reachDays, istMonthKey, heroLine, reasonLink,
} from '../utils/performanceView.ts';

const NOW = new Date('2026-10-19T06:30:00.000Z'); // Monday 19 Oct, 12:00 India time
const day = (n) => new Date(NOW.getTime() - n * 86400000).toISOString();
const snap = (n, followers, reach, rate) => ({ date: day(n), platforms: { instagram: { followers, reach, engagementRate: rate } }, totals: { followers, reach, posts: 10 } });
const num = (value, previous, changePct, extra = {}) => ({ value, previous, changePct, available: true, reason: null, ...extra });
const none = (reason) => ({ value: null, previous: null, changePct: null, available: false, reason });
const summary = (numbers, extra = {}) => ({ account: { clientWorkspace: false }, connected: { count: 1, platforms: ['instagram'] }, numbers, ...extra });

test('change chips are words and need both weeks', () => {
  assert.deepEqual(changeWords(112, 100), { text: 'Up 12 percent on last week', dir: 'up' });
  assert.deepEqual(changeWords(97, 100), { text: 'Down 3 percent on last week', dir: 'down' });
  assert.deepEqual(changeWords(100, 100), { text: 'Same as last week', dir: 'flat' });
  assert.deepEqual(changeWords(3, 0), { text: 'None last week', dir: 'flat' });
  assert.equal(changeWords(0, 0), null);
  assert.equal(changeWords(5, null), null);
  assert.equal(changeWords(undefined, 4), null);
});

test('series use only real stored points: reach 0 is skipped, broken rows are dropped, oldest first', () => {
  const h = cleanHistory([snap(1, 120, 900, 3), { date: 'nope' }, null, snap(3, 100, 0, 0), snap(2, 110, 700, 2)]);
  assert.deepEqual(h.map((s) => s.totals.followers), [100, 110, 120]);
  assert.deepEqual(seriesOf(h, 'reach'), [700, 900]);
  assert.deepEqual(seriesOf(h, 'followers'), [100, 110, 120]);
  assert.deepEqual(seriesOf(h, 'engagement'), [2, 3]);
});

test('engagement is the mean of platforms that report a rate', () => {
  assert.equal(engagementOf({ platforms: { instagram: { engagementRate: 4 }, facebook: { engagementRate: 2 }, linkedin: { engagementRate: 0 } } }), 3);
  assert.equal(engagementOf({ platforms: {} }), null);
});

test('follower gains need snapshots a week and two weeks back', () => {
  const h = cleanHistory([snap(14, 100, 1, 1), snap(7, 130, 1, 1), snap(0, 150, 1, 1)]);
  assert.deepEqual(followerGains(h), { thisWeek: 20, lastWeek: 30 });
  assert.deepEqual(followerGains(cleanHistory([snap(7, 130, 1, 1), snap(0, 150, 1, 1)])), { thisWeek: 20, lastWeek: null });
  assert.deepEqual(followerGains(cleanHistory([snap(0, 150, 1, 1)])), { thisWeek: null, lastWeek: null });
  assert.deepEqual(followerGains([]), { thisWeek: null, lastWeek: null });
});

test('KPI tiles show stored figures with chips and lines, and reasons when not available', () => {
  const history = [snap(14, 100, 500, 2), snap(7, 130, 600, 3), snap(0, 150, 800, 4)];
  const tiles = buildKpis({
    summary: summary({ reach: num(800, 600, 33.3), engagement: num(4, 3, 33.3, { unit: 'percent' }), followers: num(150, 130, 15.4, { change: 20 }), postsPublishedThisWeek: num(3, 2, 50) }),
    history, campaigns: [], now: NOW,
  });
  assert.deepEqual(tiles.map((t) => t.key), ['reach', 'engagement', 'followers', 'posts']);
  const [reach, eng, fol, posts] = tiles;
  assert.equal(reach.value, '800');
  assert.equal(reach.chip.text, 'Up 33 percent on last week');
  assert.deepEqual(reach.spark, [500, 600, 800]);
  assert.equal(eng.value, '4%');
  assert.deepEqual(eng.spark, [2, 3, 4]);
  assert.equal(fol.value, '+20');
  assert.equal(fol.chip.text, 'Down 33 percent on last week'); // 20 gained this week, 30 the week before
  assert.equal(posts.value, '3');
  assert.equal(posts.chip.text, 'Up 50 percent on last week');
  assert.equal(posts.spark, null, 'no published campaigns, so no line is drawn');
  for (const t of tiles) assert.equal(t.reason, null);
});

test('without an older snapshot there is no chip and new followers says when it will show', () => {
  const tiles = buildKpis({ summary: summary({ reach: num(800, null, null), engagement: num(4, null, null), followers: num(150, null, null), postsPublishedThisWeek: num(0, 0, null) }), history: [snap(0, 150, 800, 4)], campaigns: [], now: NOW });
  assert.equal(tiles[0].chip, null);
  assert.equal(tiles[0].spark, null);
  assert.match(tiles[0].sparkNote, /two days/);
  assert.equal(tiles[2].value, '150');
  assert.match(tiles[2].detail, /after a week/);
  assert.equal(tiles[3].chip, null, '0 this week and 0 last week gives no chip');
});

test('reasons come from the server, with a link; nothing is replaced by a zero', () => {
  const c = 'Connect an account to see this.';
  const tiles = buildKpis({ summary: summary({ reach: none(c), engagement: none(c), followers: none(c), postsPublishedThisWeek: num(2, 1, 100) }, { connected: { count: 0, platforms: [] } }), history: [snap(0, 150, 800, 4)], campaigns: [], now: NOW });
  assert.equal(tiles[0].value, null);
  assert.equal(tiles[0].reason, c);
  assert.deepEqual(tiles[0].link, { to: '/connect-socials', text: 'Connect an account' });
  assert.equal(tiles[3].value, '2');
  assert.deepEqual(reachDays([snap(0, 1, 5, 1)], true), [], 'an old snapshot of a disconnected account is hidden');
});

test('a failed summary says it could not load, and plan links never show in a client workspace', () => {
  const tiles = buildKpis({ summary: null, summaryFailed: true, history: [], campaigns: [], now: NOW });
  for (const t of tiles) { assert.equal(t.value, null); assert.equal(t.reason, 'We could not load this just now.'); }
  assert.deepEqual(reasonLink('Connecting accounts comes with a paid plan.', false), { to: '/trial-expired', text: 'See plans' });
  assert.equal(reasonLink('Connecting accounts comes with a paid plan.', true), null);
});

const posted = (id, daysAgo, perf = {}, extra = {}) => ({ _id: id, name: `Post ${id}`, status: 'posted', publishedAt: day(daysAgo), createdAt: day(daysAgo + 1), platforms: ['instagram'], creative: { imageUrls: [`https://img.example/${id}.jpg`] }, performance: perf, ...extra });

test('weekly post counts follow India weeks and leave out weeks the list cannot cover', () => {
  const list = [posted('a', 0), posted('b', 1), posted('c', 8), { _id: 'd', status: 'draft', publishedAt: day(0) }];
  const w = weeklyPosts(list, NOW, 3);
  // a: Monday 19 Oct (this India week), b: Sunday 18 Oct (last week), c: Sunday 11 Oct (the week before); the draft is not counted.
  assert.deepEqual(w.counts, [1, 1, 1]);
  assert.equal(w.complete, true);
  const full = Array.from({ length: 50 }, (_, i) => posted(`f${i}`, i % 9));
  const cut = weeklyPosts(full, NOW, 8);
  assert.equal(cut.complete, false);
  assert.ok(cut.counts.length < 8);
});

test('sparkline path is drawn only from two or more points and stays in the box', () => {
  assert.equal(sparkPath([5]), '');
  assert.equal(sparkPath([]), '');
  const d = sparkPath([1, 3, 2], 120, 36);
  assert.equal(d, 'M0.0 34.0 L60.0 2.0 L120.0 18.0');
  assert.equal(sparkPath([4, 4]), 'M0.0 18.0 L120.0 18.0');
});

test('best post of the month uses stored engagement, else says it shows the latest one', () => {
  const best = bestPostOfMonth([posted('a', 1, { likes: 10, comments: 2 }), posted('b', 2, { likes: 40, reach: 900 }), posted('old', 40, { likes: 999 })], NOW);
  assert.equal(best.kind, 'best');
  assert.equal(best.id, 'b');
  assert.equal(best.image, 'https://img.example/b.jpg');
  assert.deepEqual(best.stats, ['900 reached', '40 likes']);
  assert.match(best.note, /2 posts published this month/);
  const latest = bestPostOfMonth([posted('a', 3), posted('b', 1)], NOW);
  assert.equal(latest.kind, 'latest');
  assert.equal(latest.id, 'b');
  assert.equal(latest.title, 'Latest post this month');
  assert.match(latest.note, /cannot be picked/);
  assert.equal(bestPostOfMonth([], NOW).kind, 'none');
  assert.equal(bestPostOfMonth([posted('x', 1, {}, { creative: { imageUrls: ['data:image/png;base64,xx'] } })], NOW).image, null);
});

test('India month boundaries and the hero line', () => {
  assert.equal(istMonthKey('2026-10-31T19:00:00.000Z'), '2026-11'); // 1 Nov 00:30 in India
  assert.equal(istMonthKey('bad'), null);
  assert.equal(heroLine([{ key: 'reach', value: '800', chip: { text: 'Up 12 percent on last week', dir: 'up' } }]), 'Your posts reached 800 people, up 12 percent on last week.');
  assert.match(heroLine([{ key: 'reach', value: null, reason: 'Connect an account to see this.' }]), /^Connect an account/);
});
