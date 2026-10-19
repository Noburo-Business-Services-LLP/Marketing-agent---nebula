// The read model behind GET /api/competitors/best-posts: pure, stored data only (no read, no model call).
const test = require('node:test');
const assert = require('node:assert');
const bp = require('../services/competitors/bestPosts');
const { upcoming } = require('../config/festivals');

const NOW = new Date('2026-10-17T06:00:00Z'); // Saturday 11:30 IST, week of Monday 2026-10-12
const WEEK = '2026-10-12';
const PREV = '2026-10-05';
const DAY = 864e5;
// A post `daysAgo` before NOW at an India clock hour.
const at = (daysAgo, istHour = 11) => { const d = new Date(NOW.getTime() - daysAgo * DAY); d.setUTCHours(istHour - 5, 30 - 30, 0, 0); return new Date(d.getTime() - 30 * 60000); };
let seq = 0;
const p = (when, type, likes, comments = 0, extra = {}) => ({ at: when, type, likes, comments, pinned: false, url: `https://www.instagram.com/p/x${++seq}/`, ...extra });
const snap = (weekStart, posts, extra = {}) => ({ weekStart, ok: true, takenAt: new Date(NOW.getTime() - 3600e3), followers: 5400, postsInWindow: 3, postsInWindowMayBeTruncated: false, posts, ...extra });
const comp = (id, name, handle) => ({ _id: id, name, socialHandles: { instagram: handle } });

test('score: likes plus three times comments; a post with hidden likes has no score', () => {
  assert.strictEqual(bp.scoreOf(p(at(1), 'image', 10, 2)), 16);
  assert.strictEqual(bp.scoreOf(p(at(1), 'image', 10, null)), 10);
  assert.strictEqual(bp.scoreOf(p(at(1), 'image', null, 50)), null);
  assert.strictEqual(bp.SCORE_COMMENT_WEIGHT, 3);
});

test('posts from several weekly snapshots are merged by link, the newest reading wins, newest post first', () => {
  const a = p(at(2), 'video', 90, 4, { url: 'https://www.instagram.com/p/same/' });
  const older = snap(PREV, [{ ...a, likes: 40 }, p(at(9), 'image', 30)]);
  const newer = snap(WEEK, [a, p(at(1), 'image', 10)]);
  const merged = bp.mergePosts([newer, older]);
  assert.strictEqual(merged.length, 3);
  assert.strictEqual(merged.find((x) => x.url.endsWith('/same/')).likes, 90, 'the newest reading of a post is used');
  assert.ok(merged[0].at >= merged[1].at && merged[1].at >= merged[2].at);
  assert.deepStrictEqual(bp.mergePosts([snap(WEEK, undefined)]), [], 'older snapshots without posts give nothing');
});

test('best post of the India week and of the last 30 days; an old pinned post and hidden likes never win', () => {
  const posts = [
    p(at(0), 'image', 50, 1),                    // this week
    p(at(4), 'video', 70, 2),                    // this week (Tuesday)
    p(at(6), 'image', 400, 10),                  // Sunday 11 October: last week, inside the month
    p(at(3), 'carousel', null, 900),             // hidden likes
    p(at(160), 'carousel', 5000, 9, { pinned: true }) // pinned, five months old
  ];
  const week = bp.bestOf(posts, { now: NOW, period: 'week' });
  assert.strictEqual(week.likes, 70);
  const month = bp.bestOf(posts, { now: NOW, period: 'month' });
  assert.strictEqual(month.likes, 400);
  assert.strictEqual(bp.bestOf([], { now: NOW, period: 'month' }), null);
  assert.strictEqual(bp.bestOf([p(at(1), 'image', 0, 0)], { now: NOW, period: 'month' }), null, 'a post with nothing on it is not a best post');
});

test('what worked: format pattern when reels clearly beat photos (at least 6 posts with known likes)', () => {
  const posts = [p(at(1), 'video', 300), p(at(3), 'video', 330), p(at(8), 'video', 270), p(at(2), 'image', 90), p(at(5), 'image', 110), p(at(9), 'image', 100), p(at(12), 'image', 100)];
  const w = bp.whatWorked(posts, NOW);
  assert.strictEqual(w.kind, 'format');
  assert.strictEqual(w.best, 'video');
  assert.strictEqual(w.text, 'Reels got 3 times the likes of photos on average this month.');
  assert.strictEqual(bp.MIN_POSTS_FOR_PATTERN, 6);
  assert.strictEqual(bp.MIN_RATIO, 1.5);
});

test('what worked: weekend and evening patterns, the strongest one is chosen, ratios read plainly', () => {
  // all photos: weekend posts (Sat 17, Sun 11, Sat 10 Oct) around 250 likes, weekday posts around 100
  const weekend = [p(at(0), 'image', 240), p(at(6), 'image', 260), p(at(7), 'image', 250)];
  const weekday = [p(at(1), 'image', 100), p(at(2), 'image', 90), p(at(3), 'image', 110), p(at(4), 'image', 100)];
  const w = bp.whatWorked([...weekend, ...weekday], NOW);
  assert.strictEqual(w.kind, 'day');
  assert.strictEqual(w.text, 'Weekend posts got 2.5 times the likes of weekday posts on average this month.');
  const evening = [p(at(1, 19), 'image', 200), p(at(2, 20), 'image', 180), p(at(4, 18), 'image', 220)];
  const earlier = [p(at(1, 9), 'image', 100), p(at(2, 10), 'image', 100), p(at(3, 9), 'image', 100), p(at(4, 10), 'image', 100)];
  const e = bp.whatWorked([...evening, ...earlier], NOW);
  assert.strictEqual(e.kind, 'time');
  assert.strictEqual(e.text, 'Posts after 5 pm got 2 times the likes of earlier posts on average this month.');
});

test('what worked: nothing is said with too few posts, a small difference, hidden likes or only one kind of post', () => {
  const five = [p(at(1), 'video', 300), p(at(2), 'video', 300), p(at(3), 'image', 10), p(at(4), 'image', 10), p(at(5), 'image', 10)];
  assert.strictEqual(bp.whatWorked(five, NOW), null, 'five posts are not enough');
  const hidden = [...five, p(at(6), 'image', null), p(at(7), 'video', null)];
  assert.strictEqual(bp.whatWorked(hidden, NOW), null, 'posts with hidden likes do not count towards the minimum');
  const close = [p(at(1), 'video', 120), p(at(2), 'video', 130), p(at(3), 'image', 100), p(at(4), 'image', 100), p(at(5), 'image', 100), p(at(8), 'image', 100)];
  assert.strictEqual(bp.whatWorked(close.map((x) => ({ ...x, at: at(Number(x.at === null) + 2, 11) })), NOW), null, 'a 1.25 times difference is not a pattern');
  const zeroRest = [p(at(1), 'video', 50), p(at(2), 'video', 60), p(at(3), 'image', 0), p(at(4), 'image', 0), p(at(5), 'image', 0), p(at(8), 'image', 0)];
  const z = bp.whatWorked(zeroRest, NOW);
  assert.ok(!z || !/Infinity|NaN/.test(z.text), 'never an infinite ratio');
  const old = Array.from({ length: 8 }, (_, i) => p(at(31 + i), i < 4 ? 'video' : 'image', i < 4 ? 900 : 10));
  assert.strictEqual(bp.whatWorked(old, NOW), null, 'only the last 30 days count');
});

test('a competitor card: followers with the week-on-week change, posts this week (at least N when cut short), best post, what worked', () => {
  const posts = [p(at(0), 'video', 300, 5), p(at(1), 'video', 330), p(at(4), 'video', 270), p(at(8), 'image', 90), p(at(9), 'image', 110), p(at(10), 'image', 100), p(at(12), 'image', 100)];
  const snapshots = [snap(WEEK, posts, { followers: 5400, postsInWindow: 3, postsInWindowMayBeTruncated: true }), snap(PREV, [], { followers: 5280 })];
  const card = bp.competitorCard({ competitor: comp('c1', 'Sweet Co Bakery', 'sweetco'), status: 'tracking', snapshots, now: NOW });
  assert.strictEqual(card.id, 'c1');
  assert.strictEqual(card.handle, 'sweetco');
  assert.strictEqual(card.profileUrl, 'https://www.instagram.com/sweetco/');
  assert.deepStrictEqual(card.followers, { value: 5400, change: 120 });
  assert.deepStrictEqual(card.postsThisWeek, { value: 3, atLeast: true });
  assert.strictEqual(card.bestPost.period, 'week');
  assert.strictEqual(card.bestPost.type, 'video');
  assert.strictEqual(card.bestPost.likes, 330);
  assert.strictEqual(card.worked.kind, 'format');
  assert.strictEqual(card.isCurrentWeek, true);
  assert.strictEqual(card.weekOf, WEEK);
});

test('a card never claims a change across a skipped week, never says "this week" for an old reading, and treats 0 followers as unknown', () => {
  const snapshots = [snap('2026-09-28', [p(at(20), 'image', 40)], { followers: 0, takenAt: new Date('2026-09-29T04:00:00Z') }), snap('2026-09-14', [], { followers: 900 })];
  const card = bp.competitorCard({ competitor: comp('c2', 'Green Leaf', 'greenleaf'), status: 'tracking', snapshots, now: NOW });
  assert.strictEqual(card.followers, null);
  assert.strictEqual(card.postsThisWeek, null);
  assert.strictEqual(card.isCurrentWeek, false);
  assert.strictEqual(card.lastCheckedOn, '2026-09-29');
  assert.strictEqual(card.bestPost.period, 'month');
  const skipped = bp.competitorCard({ competitor: comp('c3', 'X', 'x'), status: 'tracking', snapshots: [snap(WEEK, [], { followers: 1000 }), snap('2026-09-28', [], { followers: 800 })], now: NOW });
  assert.deepStrictEqual(skipped.followers, { value: 1000, change: null });
});

test('an older snapshot without the post list still shows its stored best post, and no pattern', () => {
  const s = snap(WEEK, undefined, { topPost: { url: 'https://www.instagram.com/p/old/', likes: 120, comments: 4, type: 'Video', caption: 'secret caption' }, topPostAt: at(2) });
  const card = bp.competitorCard({ competitor: comp('c4', 'Old', 'old'), status: 'tracking', snapshots: [s], now: NOW });
  assert.strictEqual(card.bestPost.likes, 120);
  assert.strictEqual(card.bestPost.type, 'video');
  assert.strictEqual(card.bestPost.url, 'https://www.instagram.com/p/old/');
  assert.strictEqual(card.worked, null);
  assert.ok(!JSON.stringify(card).includes('secret caption'), 'a competitor caption is never returned');
});

test('a card with no reading yet carries only its status; a handle-less card has no profile link', () => {
  const waiting = bp.competitorCard({ competitor: comp('c5', 'New', 'newco'), status: 'waiting', snapshots: [], now: NOW });
  assert.strictEqual(waiting.followers, null);
  assert.strictEqual(waiting.bestPost, null);
  assert.strictEqual(waiting.worked, null);
  assert.strictEqual(waiting.status, 'waiting');
  const none = bp.competitorCard({ competitor: { _id: 'c6', name: 'No handle', socialHandles: {} }, status: 'no_handle', snapshots: [], now: NOW });
  assert.strictEqual(none.profileUrl, null);
  assert.strictEqual(none.handle, '');
  const sugg = bp.competitorCard({ competitor: comp('c7', 'Guess', 'guess'), status: 'unconfirmed', snapshots: [], now: NOW });
  assert.strictEqual(sugg.profileUrl, null, 'an unconfirmed handle is not linked');
});

// ---- what's working and trending ----------------------------------------------------------------------------------
const cards = () => {
  const strong = [p(at(0), 'video', 1240, 86), p(at(1), 'video', 900), p(at(4), 'video', 1000), p(at(8), 'image', 300), p(at(9), 'image', 320), p(at(10), 'image', 310)];
  return [
    bp.competitorCard({ competitor: comp('c1', 'Sweet Co Bakery', 'sweetco'), status: 'tracking', snapshots: [snap(WEEK, strong)], now: NOW }),
    bp.competitorCard({ competitor: comp('c2', 'Crumb and Co', 'crumbandco'), status: 'tracking', snapshots: [snap(WEEK, [p(at(2), 'carousel', 200, 5)])], now: NOW }),
    bp.competitorCard({ competitor: comp('c3', 'Waiting One', 'waitingone'), status: 'waiting', snapshots: [], now: NOW })
  ];
};

test('what is working: the strongest best posts across competitors, at most three, each with a neutral brief', () => {
  const list = bp.workingPosts(cards(), { pillars: ['Fresh bakes'] });
  assert.deepStrictEqual(list.map((w) => w.competitorId), ['c1', 'c2']);
  assert.strictEqual(list[0].type, 'video');
  assert.strictEqual(list[0].reason, 'A reel on Saturday 17 October with 1,240 likes and 86 comments, their best this week.');
  assert.strictEqual(list[0].action.label, 'Make a post like this');
  assert.strictEqual(list[0].action.kind, 'video');
  assert.strictEqual(list[0].action.brief, 'A reel about Fresh bakes, in the style that works: reels are getting the most likes this month.');
  assert.strictEqual(list[1].action.kind, 'post');
  assert.strictEqual(list[1].action.mode, 'carousel');
  assert.strictEqual(list[1].action.brief, 'A carousel about Fresh bakes, in the style of the best recent posts in your market.');
});

test('trending: one item per honest source with its label, a reason and a Make action; nothing names a competitor in the brief', () => {
  const festivals = upcoming(NOW, 45);
  const own = [{ type: 'video', likes: 240, comments: 18, at: at(5), caption: 'Our new sourdough loaf is here! #bread @friend https://x.example' }, { type: 'image', likes: 10, comments: 0, at: at(3), caption: 'x' }];
  const items = bp.trendItems({ cards: cards(), own, pillars: ['Fresh bakes', 'Behind the counter'], festivals, entitled: true, now: NOW });
  assert.deepStrictEqual(items.map((i) => i.source), ['competitor', 'own', 'festival', 'plan']);
  assert.deepStrictEqual(items.map((i) => i.label), ['From a competitor', 'From your own posts', 'Coming up', 'From your plan']);
  const [c, o, f, pl] = items;
  assert.strictEqual(c.title, 'What worked for Sweet Co Bakery');
  assert.strictEqual(c.reason, 'Reels got 3 times the likes of photos on average this month.', 'the pattern, when there is one, is the reason');
  assert.strictEqual(o.title, 'Your best post this month');
  assert.strictEqual(o.reason, 'Your reel on Monday 12 October got 240 likes and 18 comments.');
  assert.strictEqual(o.action.brief, 'A new reel about Our new sourdough loaf is here, in the style of your best post this month.');
  assert.strictEqual(f.title, "Children's Day");
  assert.strictEqual(f.reason, 'Saturday 14 November, in 28 days.');
  assert.strictEqual(f.action.brief, "A post for Children's Day on 14 November, about Fresh bakes.");
  assert.strictEqual(pl.title, 'Fresh bakes');
  assert.strictEqual(pl.reason, 'One of the themes in your plan.');
  for (const i of items) {
    assert.ok(i.id && i.reason && i.action && i.action.brief, i.id);
    for (const banned of ['Sweet Co', 'sweetco', 'Crumb', 'crumbandco', '#bread', '@friend', 'https://']) assert.ok(!i.action.brief.includes(banned), `${i.id}: ${banned}`);
    assert.ok(i.action.brief.length <= 200);
  }
});

test('trending without the add-on has no competitor item; with no data at all it is empty', () => {
  const items = bp.trendItems({ cards: cards(), own: [], pillars: [], festivals: upcoming(NOW, 45), entitled: false, now: NOW });
  assert.deepStrictEqual(items.map((i) => i.source), ['festival']);
  assert.strictEqual(items[0].action.brief, "A post for Children's Day on 14 November, about your business.");
  assert.deepStrictEqual(bp.trendItems({ cards: [], own: [], pillars: [], festivals: [], entitled: true, now: NOW }), []);
});

test('a plan theme that contains a competitor name is never put into the brief', () => {
  const list = bp.workingPosts(cards(), { pillars: ['Better than Sweet Co Bakery'] });
  assert.ok(!list[0].action.brief.includes('Sweet Co'));
  assert.strictEqual(list[0].action.brief, 'A reel about your business, in the style that works: reels are getting the most likes this month.');
});

test('wording guard: every sentence the read model writes is plain (no exclamation, no dash, no banned or unkind words)', () => {
  for (const bad of ['Great!', 'Reels — best', 'a – b', 'Use your credit', 'free trial', 'in 7 days', 'via Apify', 'Ayrshare says', 'OpenAI', 'Gemini', 'their worst post', 'a bad week', 'beat them', 'crush the rival', 'they are failing', 'a weak post', 'a poor reel', 'mock them']) {
    assert.strictEqual(bp.isPlainText(bad), false, bad);
  }
  assert.strictEqual(bp.isPlainText('Reels got 3 times the likes of photos on average this month.'), true);
  const texts = [];
  const items = bp.trendItems({ cards: cards(), own: [{ type: 'image', likes: 5, comments: 1, at: at(1), caption: 'Hi!!! — big sale' }], pillars: ['Fresh bakes'], festivals: upcoming(NOW, 365), entitled: true, now: NOW });
  for (const i of items) texts.push(i.title, i.reason, i.action.brief, i.label, i.action.label);
  for (const w of bp.workingPosts(cards(), { pillars: [] })) texts.push(w.reason, w.action.brief);
  for (const c of cards()) if (c.worked) texts.push(c.worked.text);
  assert.ok(texts.length > 10);
  for (const t of texts) assert.ok(bp.isPlainText(t), t);
});

test('cleanTopic keeps the first plain phrase of the customer\'s own caption', () => {
  assert.strictEqual(bp.cleanTopic('Our new sourdough loaf is here! #bread'), 'Our new sourdough loaf is here');
  assert.strictEqual(bp.cleanTopic('#only #tags'), '');
  assert.strictEqual(bp.cleanTopic('தீபாவளி சிறப்பு இனிப்புகள் 🎉 order now'), 'தீபாவளி சிறப்பு இனிப்புகள் order now');
  assert.ok(bp.cleanTopic('word '.repeat(40)).length <= 60);
});
