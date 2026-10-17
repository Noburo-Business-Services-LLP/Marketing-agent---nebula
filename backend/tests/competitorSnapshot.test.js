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
  assert.doesNotMatch(text, /quark|credit|apify|scrap/i);
  assert.strictEqual(out.competitors.find((c) => c.id === 'a').trend.length, 2);
});
test('a first week, an empty week and a failed-only history are handled without errors', () => {
  const out = insights({ items: [{ competitor: { _id: 'x', name: 'New Co' }, snapshots: [] }], now: NOW });
  assert.deepStrictEqual(out.highlights, []);
  assert.deepStrictEqual(out.competitors[0].trend, []);
});
test('a competitor with exactly one snapshot gets the started-tracking note, and one with none gets nothing', () => {
  const one = insights({ items: [{ competitor: { _id: 'c', name: 'Bake Lab' }, snapshots: [{ weekStart: '2026-10-12', postsInWindow: 1, followers: 10, avgLikes: 3 }] }], now: NOW });
  assert.deepStrictEqual(one.highlights.map((h) => h.text), ['We have started tracking Bake Lab. Changes show from next week.']);
});
test('follower change needs at least 50 and 1 percent, and a best post must be recent and well above average', () => {
  const base = { weekStart: '2026-10-12', postsInWindow: 3, followers: 10000, avgLikes: 100 };
  const prev = { weekStart: '2026-10-05', postsInWindow: 3, followers: 9960, avgLikes: 100 };
  const quiet = insights({ items: [{ competitor: { _id: 'q', name: 'Quiet' }, snapshots: [{ ...base, topPost: { likes: 140, type: 'Image' }, topPostAt: new Date(NOW - DAY) }, prev] }], now: NOW });
  assert.deepStrictEqual(quiet.highlights, []);
  const old = insights({ items: [{ competitor: { _id: 'o', name: 'Old' }, snapshots: [{ ...base, followers: 9800, topPost: { likes: 900, type: 'Image' }, topPostAt: new Date(NOW - 20 * DAY) }, { ...prev, followers: 10000 }] }], now: NOW });
  assert.deepStrictEqual(old.highlights.map((h) => h.text), ['Old lost 200 followers this week.']);
  const photo = insights({ items: [{ competitor: { _id: 'p', name: 'Pic' }, snapshots: [{ ...base, topPost: { likes: 150, type: 'Image' }, topPostAt: new Date(NOW - DAY) }, prev] }], now: NOW });
  assert.deepStrictEqual(photo.highlights.map((h) => h.text), ["Pic's best post this week was a photo with 150 likes."]);
});
