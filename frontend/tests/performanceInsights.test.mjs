import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  rangeChip, gainChip, kpisFromView, platformTile, postChips, compareBars, heatStrip, insightHandoff, heroSentence, rangeSpan,
  isPerformanceView, markOf, shortDate, TOP_TABS, RANGES,
} from '../utils/performanceInsights.ts';

const yes = (value, previous = null, extra = {}) => ({ value, previous, change: previous === null ? null : value - previous, changePct: null, available: true, reason: null, ...extra });
const no = (reason) => ({ value: null, previous: null, change: null, changePct: null, available: false, reason });
const view = (extra = {}) => ({
  range: { key: 'month', days: 30, from: '2026-09-20T12:00:00.000Z', to: '2026-10-20T12:00:00.000Z', previousFrom: '2026-08-21T12:00:00.000Z', words: 'this month' },
  platform: null, account: { free: false, canConnect: true, clientWorkspace: false, staff: false }, connected: { count: 1, platforms: ['instagram'] },
  overall: { followers: yes(1200, 1000), reach: yes(6000, 5000), engagementRate: yes(4, 3.5, { unit: 'percent' }), likes: yes(500, 400), posts: yes(8, 7), postsMeasured: yes(6), spark: { followers: [1000, 1100, 1200], reach: [5000, 6000], engagementRate: null, posts: [1, 2, 0, 3, 1, 1] } },
  platforms: [], topPosts: { measured: 0, reason: null, lists: { engagement: { posts: [], reason: null }, likes: { posts: [], reason: null }, comments: { posts: [], reason: null }, reach: { posts: [], reason: null } } },
  byFormat: { available: false, reason: 'x', metric: 'likes', rows: [] }, byDay: { available: false, reason: 'x', metric: 'engagement', rows: [] }, byTime: { available: false, reason: 'x', metric: 'engagement', rows: [] },
  insights: [], insightsReason: null, degraded: [], ...extra,
});

test('change chips name the period they compare with, and need both numbers', () => {
  assert.deepEqual(rangeChip(112, 100, 'month'), { text: 'Up 12 percent on the month before', dir: 'up' });
  assert.deepEqual(rangeChip(97, 100, 'week'), { text: 'Down 3 percent on the week before', dir: 'down' });
  assert.deepEqual(rangeChip(5, 0, '90d'), { text: 'None the 90 days before', dir: 'flat' });
  assert.equal(rangeChip(5, null, 'month'), null);
  assert.deepEqual(gainChip(120, 'month'), { text: '+120 this month', dir: 'up' });
  assert.deepEqual(gainChip(-4, 'week'), { text: '-4 this week', dir: 'down' });
  assert.equal(gainChip(null, 'week'), null);
});

test('KPI tiles come from the overall block: values, lines only from two or more real points, reasons otherwise', () => {
  const t = kpisFromView(view());
  assert.deepEqual(t.map((x) => x.key), ['reach', 'engagement', 'followers', 'posts']);
  assert.equal(t[0].value, '6,000');
  assert.equal(t[0].chip.text, 'Up 20 percent on the month before');
  assert.deepEqual(t[0].spark, [5000, 6000]);
  assert.equal(t[1].spark, null, 'no line without two points');
  assert.equal(t[2].value, '+200');
  assert.equal(t[2].detail, '1,200 in all');
  assert.equal(t[3].detail, '6 measured');
  const off = kpisFromView(view({ overall: { ...view().overall, reach: no('Connect an account to see this.') } }));
  assert.equal(off[0].value, null);
  assert.equal(off[0].reason, 'Connect an account to see this.');
  assert.deepEqual(off[0].link, { to: '/connect-socials', text: 'Connect an account' });
  const failed = kpisFromView(null, true);
  assert.ok(failed.every((x) => x.reason === 'We could not load this just now.'));
});

test('platform tiles: not connected offers the connect action, numbers only when stored, a follower line', () => {
  const nc = platformTile({ platform: 'linkedin', label: 'LinkedIn', connected: false, state: 'notconnected', reason: 'Connect LinkedIn to see its numbers here.', asOf: null, postsMeasured: 0, metrics: {}, spark: {} }, 'month');
  assert.deepEqual(nc.action, { to: '/connect-socials', text: 'Connect' });
  assert.equal(nc.selectable, false);
  const free = platformTile({ platform: 'instagram', label: 'Instagram', connected: false, state: 'notconnected', reason: 'Connecting accounts comes with a paid plan.', metrics: {}, spark: {} }, 'month');
  assert.deepEqual(free.action, { to: '/trial-expired', text: 'See plans' });
  const inClient = platformTile({ platform: 'instagram', label: 'Instagram', connected: false, state: 'notconnected', reason: 'Connecting accounts comes with a paid plan.', metrics: {}, spark: {} }, 'month', true);
  assert.equal(inClient.action, null, 'no plan links inside a client workspace');
  const ig = platformTile({
    platform: 'instagram', label: 'Instagram', connected: true, state: 'ready', reason: null, asOf: '2026-10-20', postsMeasured: 4,
    metrics: { followers: yes(1200, 1000), reach: yes(6000), engagementRate: yes(4.25), likes: no('No Instagram post was measured in this period.'), posts: yes(8, 7) }, spark: { followers: [1000, 1200] },
  }, 'month');
  assert.equal(ig.headline, '1,200');
  assert.equal(ig.chip.text, '+200 this month');
  assert.deepEqual(ig.stats.map((s) => s.value), ['6,000', '4.3%', null, '8']);
  assert.equal(ig.stats[2].reason, 'No Instagram post was measured in this period.');
  assert.deepEqual(ig.spark, [1000, 1200]);
  assert.equal(ig.selectable, true);
  assert.equal(markOf('twitter'), 'x');
  assert.equal(markOf('gmb'), 'google');
  assert.equal(markOf('tiktok'), 'other');
});

test('post chips lead with the ranking measure; engagement leads the engagement list', () => {
  const p = { metric: 'likes', metrics: { likes: 320, comments: 12, shares: 0, reach: 4100, engagement: 332 } };
  assert.deepEqual(postChips(p).map((c) => c.text), ['320 likes', '12 comments', '4.1K reached']);
  assert.deepEqual(postChips({ ...p, metric: 'engagement' }).map((c) => c.text), ['332 engagement', '320 likes', '12 comments']);
  assert.deepEqual(postChips({ ...p, metric: 'reach' })[0], { key: 'reach', text: '4.1K reached', lead: true });
  assert.deepEqual(TOP_TABS.map((t) => t.label), ['Most engagement', 'Most likes', 'Most comments', 'Most reach']);
  assert.deepEqual(RANGES.map((r) => r.label), ['This week', 'This month', 'Last 90 days']);
});

test('bars and heat strips are scaled from real averages; rows without posts stay empty', () => {
  const bars = compareBars({ rows: [{ label: 'Videos', posts: 4, average: 225 }, { label: 'Image posts', posts: 6, average: 45 }, { label: 'Text posts', posts: 0, average: null }] });
  assert.deepEqual(bars.map((b) => [b.label, b.width, b.best]), [['Videos', 100, true], ['Image posts', 20, false]]);
  const heat = heatStrip({ rows: [{ label: 'Monday', posts: 2, average: 100 }, { label: 'Tuesday', posts: 0, average: null }, { label: 'Wednesday', posts: 1, average: 30 }] });
  assert.deepEqual(heat.map((h) => h.level), [4, 0, 2]);
});

test('Make a post like this hands the neutral brief to Create (or Videos) as an idea typed on Home', () => {
  assert.deepEqual(insightHandoff({ kind: 'post', mode: 'carousel', platform: 'instagram', brief: 'A new carousel in the style of "Sourdough Sunday".' }), {
    target: 'carousel', route: '/campaigns', data: { mode: 'carousel', topic: 'A new carousel in the style of "Sourdough Sunday".', platform: 'instagram', source: 'home' },
  });
  assert.deepEqual(insightHandoff({ kind: 'video', mode: 'single', platform: null, brief: 'A new video.' }), { target: 'video', route: '/reels', data: { idea: 'A new video.', source: 'home' } });
  assert.equal(insightHandoff({ kind: 'post', mode: 'single', platform: null, brief: '  ' }), null);
  assert.equal(insightHandoff(null), null);
});

test('hero sentence, period span and the answer check', () => {
  assert.equal(heroSentence(view()), 'Your accounts reached 6,000 people, from 8 posts published this month.');
  assert.match(heroSentence(view({ connected: { count: 0, platforms: [] }, overall: { ...view().overall, reach: no('x') } })), /^Connect an account/);
  assert.match(heroSentence(view({ account: { canConnect: false }, connected: { count: 0, platforms: [] }, overall: { ...view().overall, reach: no('x') } })), /paid plan/);
  assert.match(heroSentence(null, true), /could not load/);
  assert.equal(rangeSpan(view()), '20 Sep to 20 Oct');
  assert.equal(shortDate('2026-10-05'), '5 Oct');
  assert.equal(isPerformanceView(view()), true);
  assert.equal(isPerformanceView({ success: false }), false);
});

test('wording on the page and its rules: no exclamation marks, em dashes or banned words', () => {
  for (const f of ['utils/performanceInsights.ts', 'pages/GravityInsights.tsx', 'components/performance/PerformanceSections.tsx']) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    const strings = src.match(/'[^'\n]*'|`[^`\n]*`|>[^<>{}\n]+</g) || [];
    for (const s of strings) {
      assert.ok(!/—/.test(s), `${f}: em dash in ${s}`);
      assert.ok(!/[A-Za-z]!\s|[A-Za-z]!['`<]/.test(s), `${f}: exclamation mark in ${s}`);
      assert.ok(!/\bcredits?\b|\btrial\b(?!-expired)|7 days/i.test(s.replace('/trial-expired', '')), `${f}: banned word in ${s}`);
    }
  }
});
