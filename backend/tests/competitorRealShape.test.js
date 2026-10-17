// backend/tests/competitorRealShape.test.js
// Runs the real snapshot code against REAL data: one approved read of the public account nebulaa.os, captured on
// 2026-10-17 (fixtures/instagram-profile-real-nebulaa-os.json; captions cut to 40 characters, signed URLs removed,
// numbers/types/timestamps exact). Tests marked UNVERIFIED are written from the code's own assumptions: the private
// account and non-existent handle responses have NOT been seen from the real scraper.
const test = require('node:test');
const assert = require('node:assert');
const fixture = require('./fixtures/instagram-profile-real-nebulaa-os.json');
const { summarise, insights } = require('../services/competitors/snapshot');
const { trackOne } = require('../services/competitors/tracker');
const { validateProfileMatch } = require('../services/competitors/profileMatch');
const { weekStartOf } = require('../services/week/weekMath');

const profile = fixture.data[0];
const SAT = new Date('2026-10-17T06:00:00Z'); // Saturday 11:30 IST, week of Monday 2026-10-12
const SUN = new Date('2026-10-11T10:00:00Z'); // Sunday, week of Monday 2026-10-05
const MON = new Date('2026-10-12T02:00:00Z'); // Monday 07:30 IST: the new week has just begun
const sum = (now, over = {}) => summarise({ profile: { ...profile, ...over.profile }, posts: over.posts || profile.latestPosts, now });
const stamp = (iso, extra = {}) => ({ timestamp: iso, likesCount: 5, commentsCount: 1, type: 'Image', caption: 'x', hashtags: [], isPinned: false, ...extra });

test('the real response has the shape the tracker reads', () => {
  assert.strictEqual(fixture.success, true);
  assert.ok(Array.isArray(fixture.data) && fixture.data.length === 1);
  assert.strictEqual(profile.followersCount, 70);
  assert.strictEqual(profile.postsCount, 55);
  assert.strictEqual(profile.private, false);
  assert.strictEqual(profile.verified, false);
  assert.strictEqual(profile.latestPosts.length, 12);
  assert.strictEqual(profile.latestPosts[0].isPinned, true);
  assert.strictEqual(profile.latestPosts[0].timestamp, '2026-05-06T12:32:16.000Z');
  assert.ok(!('videoViewCount' in profile.latestPosts[1])); // images carry no view count
  assert.strictEqual(typeof profile.latestPosts[2].videoViewCount, 'number');
});

test('followers, week count, 30-day window and formats on the real posts (Saturday 2026-10-17)', () => {
  const s = sum(SAT);
  assert.strictEqual(s.followers, 70);
  assert.strictEqual(s.weekStart, '2026-10-12');
  assert.strictEqual(s.postsInWindow, 1); // only 2026-10-15; the pinned May post is not "this week"
  assert.strictEqual(s.posts30, 8); // 10-15, 10-09, 10-08, 09-28, 09-22, 09-21, 09-18 x2 (the pinned one is 5 months old)
  assert.deepStrictEqual(s.formats, { image: 2, video: 6, carousel: 0 });
  assert.strictEqual(s.avgLikes, 5); // (2+4+9+5+2+10+3+3)/8 = 4.75
  assert.strictEqual(s.avgComments, 0); // 2/8 = 0.25
});

test('the week is the Monday-to-Sunday week in India, not the last 7 days', () => {
  assert.strictEqual(sum(SUN).weekStart, '2026-10-05');
  assert.strictEqual(sum(SUN).postsInWindow, 2); // 10-08 and 10-09
  assert.strictEqual(sum(MON).weekStart, '2026-10-12');
  assert.strictEqual(sum(MON).postsInWindow, 0); // nothing yet this week on Monday morning, though 10-08/09 are < 7 days old
  // 2026-10-11 19:00 UTC is 00:30 IST on Monday 10-12: it belongs to the new week
  const edge = summarise({ profile: {}, posts: [stamp('2026-10-11T19:00:00.000Z'), stamp('2026-10-11T18:00:00.000Z')], now: new Date('2026-10-12T05:00:00Z') });
  assert.strictEqual(edge.postsInWindow, 1);
});

test('a pinned old post is never the top post and never counted in this week', () => {
  const loud = profile.latestPosts.map((p, i) => (i === 0 ? { ...p, likesCount: 9999, commentsCount: 500 } : p));
  const s = sum(SAT, { posts: loud });
  assert.strictEqual(s.topPost.likes, 10); // the 09-21 reel
  assert.strictEqual(s.topPost.type, 'Video');
  assert.strictEqual(s.postsInWindow, 1);
  // pinned but recent stays eligible (it is a post of the window like any other)
  const recentPin = [stamp('2026-10-14T05:00:00.000Z', { isPinned: true, likesCount: 80 }), ...profile.latestPosts.slice(1)];
  assert.strictEqual(sum(SAT, { posts: recentPin }).topPost.likes, 80);
});

test('the top post of the real window is the 09-21 reel (10 likes, 2 comments)', () => {
  const s = sum(SAT);
  assert.strictEqual(s.topPost.url, 'https://www.instagram.com/p/DdjCtUIh41j/');
  assert.strictEqual(s.topPost.likes, 10);
  assert.strictEqual(s.topPost.comments, 2);
  assert.ok(s.topPost.caption.length <= 40);
  assert.ok(s.hashtags.includes('brandfilms')); // lower-cased, most used first
});

test('video view counts are not part of the snapshot (known gap, nothing breaks)', () => {
  const s = sum(SAT);
  assert.ok(!('videoViews' in s));
  assert.ok(Number.isFinite(s.avgLikes));
});

test('hidden likes (-1) and closed comments (-1) are left out of the averages and never lower them', () => {
  const posts = [stamp('2026-10-14T05:00:00.000Z', { likesCount: 10 }), stamp('2026-10-13T05:00:00.000Z', { likesCount: -1, commentsCount: -1 }), stamp('2026-10-13T06:00:00.000Z', { likesCount: 20, commentsCount: 3 })];
  const s = summarise({ profile: {}, posts, now: SAT });
  assert.strictEqual(s.avgLikes, 15);
  assert.strictEqual(s.avgComments, 2); // (1 + 3) / 2
  assert.strictEqual(s.postsInWindow, 3); // the hidden-likes post still counts as a post
  const allHidden = summarise({ profile: {}, posts: [stamp('2026-10-14T05:00:00.000Z', { likesCount: -1, commentsCount: -1 })], now: SAT });
  assert.strictEqual(allHidden.avgLikes, 0);
  assert.strictEqual(allHidden.topPost.likes, 0);
});

test('an empty latestPosts gives followers and zeros, and an empty list is not "truncated"', () => {
  const s = sum(SAT, { posts: [] });
  assert.strictEqual(s.followers, 70);
  assert.strictEqual(s.postsInWindow, 0);
  assert.strictEqual(s.topPost, null);
  assert.strictEqual(s.postsInWindowMayBeTruncated, false);
});

test('a very active account: 12 posts all inside the week is flagged as maybe more', () => {
  const posts = Array.from({ length: 12 }, (_, i) => stamp(new Date(SAT - (i + 1) * 3 * 36e5).toISOString()));
  const s = summarise({ profile: { followersCount: 500, postsCount: 900 }, posts, now: SAT });
  assert.strictEqual(s.postsInWindow, 12);
  assert.strictEqual(s.postsInWindowMayBeTruncated, true);
});

test('the real account is not flagged: the oldest post is a month back', () => {
  assert.strictEqual(sum(SAT).postsInWindowMayBeTruncated, false);
  assert.strictEqual(sum(SUN).postsInWindowMayBeTruncated, false);
});

test('a small account whose every post is this week is not flagged (nothing more exists)', () => {
  const posts = [stamp('2026-10-14T05:00:00.000Z'), stamp('2026-10-15T05:00:00.000Z')];
  assert.strictEqual(summarise({ profile: { postsCount: 2 }, posts, now: SAT }).postsInWindowMayBeTruncated, false);
});

test('a pinned old post does not hide truncation', () => {
  const posts = [stamp('2026-05-06T12:32:16.000Z', { isPinned: true }), ...Array.from({ length: 11 }, (_, i) => stamp(new Date(SAT - (i + 1) * 3 * 36e5).toISOString()))];
  const s = summarise({ profile: { postsCount: 300 }, posts, now: SAT });
  assert.strictEqual(s.postsInWindow, 11);
  assert.strictEqual(s.postsInWindowMayBeTruncated, true);
});

const snapAt = (now, over = {}) => ({ ...sum(now), takenAt: now, ok: true, ...over });
const run = (snaps, now) => insights({ items: [{ competitor: { _id: 'c1', name: 'Nebulaa' }, snapshots: snaps }], now });

test('highlights with the real numbers: weeks of 10-05 (2 posts) and 10-12 (1 post) give no change sentence and no crash', () => {
  const prev = snapAt(SUN); const cur = snapAt(SAT);
  assert.strictEqual(prev.postsInWindow, 2);
  assert.strictEqual(cur.postsInWindow, 1);
  assert.strictEqual(prev.weekStart, '2026-10-05');
  assert.strictEqual(cur.weekStart, '2026-10-12');
  const r = run([cur, prev], SAT);
  assert.deepStrictEqual(r.highlights, []); // a drop of 1 is below the 2-post threshold; best post (2 likes) is not above average
  assert.strictEqual(r.competitors[0].isCurrentWeek, true);
  assert.strictEqual(r.competitors[0].previousWeekOf, '2026-10-05');
});

test('highlight wording: 1 time, 2 times, and the first week', () => {
  const cur = snapAt(SAT);
  assert.match(run([cur, snapAt(SUN, { postsInWindow: 0 })], SAT).highlights[0].text, /^Nebulaa posted 1 time this week, after none last week\.$/);
  assert.match(run([{ ...cur, postsInWindow: 2 }, snapAt(SUN, { postsInWindow: 0 })], SAT).highlights[0].text, /^Nebulaa posted 2 times this week, up from 0\.$|^Nebulaa posted 2 times this week, after none last week\.$/);
  assert.match(run([cur], SAT).highlights[0].text, /^We have started tracking Nebulaa\./);
});

test('highlight says "at least" when the count may be cut short', () => {
  const cur = snapAt(SAT, { postsInWindow: 12, postsInWindowMayBeTruncated: true });
  const prev = snapAt(SUN, { postsInWindow: 3 });
  const text = run([cur, prev], SAT).highlights[0].text;
  assert.strictEqual(text, 'Nebulaa posted at least 12 times this week, up from 3.');
  assert.ok(!/apify|scraper|actor/i.test(text));
});

test('a cut-short count is never described as a drop, and a cut-short earlier week is never described as a rise', () => {
  const down = run([snapAt(SAT, { postsInWindow: 12, postsInWindowMayBeTruncated: true }), snapAt(SUN, { postsInWindow: 20, postsInWindowMayBeTruncated: true })], SAT).highlights;
  assert.ok(down.every((h) => !/down from/.test(h.text)));
  const up = run([snapAt(SAT, { postsInWindow: 14 }), snapAt(SUN, { postsInWindow: 12, postsInWindowMayBeTruncated: true })], SAT).highlights;
  assert.ok(up.every((h) => !/up from/.test(h.text)));
  const wording = run([snapAt(SAT, { postsInWindow: 12, postsInWindowMayBeTruncated: true }), snapAt(SUN, { postsInWindow: 3 })], SAT).highlights[0].text;
  assert.match(wording, /at least 12 times/);
});

// ---- the tracker with the real response, and with responses nobody has seen yet ----
function trackWith(response, now = SAT) {
  const saved = [];
  const competitor = { _id: 'c1', userId: 'u1', name: 'Nebulaa', socialHandles: { instagram: 'nebulaa.os' }, tracking: {} };
  const deps = {
    caps: { KEEP_WEEKS: 12, FAIL_PAUSE_AFTER: 3 },
    scrapeProfile: async () => response,
    store: { save: async (s) => { saved.push(s); return s; }, prune: async () => {} },
    saveTracking: async () => {}, onRead: async () => {}
  };
  return trackOne({ competitor, user: { _id: 'u1' }, now, deps }).then((r) => ({ r, saved, competitor }));
}

test('the tracker saves a good snapshot from the real response', async () => {
  const { saved } = await trackWith(fixture);
  assert.strictEqual(saved.length, 1);
  assert.strictEqual(saved[0].ok, true);
  assert.strictEqual(saved[0].followers, 70);
  assert.strictEqual(saved[0].postsInWindow, 1);
  assert.strictEqual(saved[0].weekStart, weekStartOf(SAT));
});

test('UNVERIFIED (code assumption, never seen from the real scraper): a private account becomes a plain failed check', async () => {
  const { saved } = await trackWith({ success: true, data: [{ username: 'x', private: true, followersCount: 300, postsCount: 20, latestPosts: [] }] });
  assert.strictEqual(saved[0].ok, false);
  assert.strictEqual(saved[0].error, 'This account is private');
});

test('UNVERIFIED (code assumption): a handle that does not exist (empty data) becomes a plain failed check', async () => {
  for (const response of [{ success: true, data: [] }, { success: false, error: 'x' }, { success: true, data: [{ error: 'not_found', errorDescription: 'Page not found' }] }]) {
    const { saved } = await trackWith(response);
    assert.strictEqual(saved[0].ok, false);
    assert.strictEqual(saved[0].error, 'Could not read this profile');
  }
});

// ---- profile match with the real profile ----
test('validateProfileMatch accepts the real profile for the right competitor and rejects another business', () => {
  const ok = validateProfileMatch(profile, { name: 'Nebulaa', website: 'https://demo.nebulaa.ai' });
  assert.strictEqual(ok.valid, true);
  assert.ok(ok.score >= 6);
  assert.strictEqual(validateProfileMatch(profile, { name: 'Nebulaa AI Studio' }).valid, true); // name contains the full name
  const bad = validateProfileMatch(profile, { name: 'Green Valley Dairy', website: 'https://greenvalleydairy.com', industry: 'dairy farming' });
  assert.strictEqual(bad.valid, false);
});
