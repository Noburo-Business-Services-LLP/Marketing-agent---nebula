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

