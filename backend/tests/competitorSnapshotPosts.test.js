// The weekly snapshot now keeps a compact list of the posts it read (date, type, likes, comments, pinned, link), so the
// Competitors page and Home can show a best post and a "what worked" line from stored data only. No caption, no picture.
const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const fixture = require('./fixtures/instagram-profile-real-nebulaa-os.json');
const CompetitorSnapshot = require('../models/CompetitorSnapshot');
const { summarise, compactPosts, MAX_STORED_POSTS } = require('../services/competitors/snapshot');

const SAT = new Date('2026-10-17T06:00:00Z');
const profile = fixture.data[0];

test('the real 12-post read becomes 12 compact posts, newest order kept, pinned marked, no caption or picture', () => {
  const s = summarise({ profile, posts: profile.latestPosts, now: SAT });
  assert.strictEqual(MAX_STORED_POSTS, 12);
  assert.strictEqual(s.posts.length, 12);
  assert.strictEqual(s.posts[0].pinned, true);
  assert.strictEqual(s.posts[0].type, 'carousel');
  assert.strictEqual(s.posts[1].type, 'image');
  assert.strictEqual(s.posts[2].type, 'video');
  assert.strictEqual(s.posts[1].likes, 2);
  assert.strictEqual(s.posts[1].comments, 0);
  assert.strictEqual(s.posts[1].url, 'https://www.instagram.com/p/DegZm0ukjMo/');
  assert.strictEqual(new Date(s.posts[1].at).toISOString(), '2026-10-15T07:15:58.000Z');
  for (const p of s.posts) {
    assert.deepStrictEqual(Object.keys(p).sort(), ['at', 'comments', 'likes', 'pinned', 'type', 'url']);
    assert.ok(!JSON.stringify(p).includes('displayUrl'));
  }
});

test('hidden likes (-1) are stored as unknown (null), never as zero; a missing count is unknown too', () => {
  const posts = compactPosts([
    { timestamp: '2026-10-15T07:00:00Z', likesCount: -1, commentsCount: -1, type: 'Video', url: 'https://www.instagram.com/p/a/' },
    { timestamp: '2026-10-14T07:00:00Z', type: 'Image', shortCode: 'b' }
  ], SAT);
  assert.strictEqual(posts[0].likes, null);
  assert.strictEqual(posts[0].comments, null);
  assert.strictEqual(posts[1].likes, null);
  assert.strictEqual(posts[1].url, 'https://www.instagram.com/p/b/');
});

test('posts without a date, from the future, or with a link that is not an https Instagram link are dropped or unlinked', () => {
  const posts = compactPosts([
    { likesCount: 5, type: 'Image' },
    { timestamp: '2026-10-20T07:00:00Z', likesCount: 5, type: 'Image' },
    { timestamp: '2026-10-15T07:00:00Z', likesCount: 5, type: 'Image', url: 'javascript:alert(1)' },
    { timestamp: '2026-10-15T07:00:00Z', likesCount: 5, type: 'Image', url: 'https://evil.example/p/x' }
  ], SAT);
  assert.strictEqual(posts.length, 2);
  assert.strictEqual(posts[0].url, '');
  assert.strictEqual(posts[1].url, '');
});

test('at most 12 posts are kept even when the read returns more', () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ timestamp: new Date(SAT - (i + 1) * 3600e3).toISOString(), likesCount: i, type: 'Image' }));
  assert.strictEqual(compactPosts(many, SAT).length, 12);
});

test('a snapshot with the compact posts validates against the model (the nested type key is declared)', () => {
  const s = summarise({ profile, posts: profile.latestPosts, now: SAT });
  const doc = new CompetitorSnapshot({ ...s, userId: new mongoose.Types.ObjectId(), competitorId: new mongoose.Types.ObjectId(), handle: 'x', takenAt: SAT, ok: true });
  assert.strictEqual(doc.validateSync(), undefined);
  assert.strictEqual(doc.posts.length, 12);
  assert.strictEqual(doc.posts[2].type, 'video');
  assert.strictEqual(doc.posts[0].pinned, true);
});
