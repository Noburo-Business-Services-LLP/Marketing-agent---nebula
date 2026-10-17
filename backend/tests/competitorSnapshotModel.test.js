const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const CompetitorSnapshot = require('../models/CompetitorSnapshot');
const { summarise } = require('../services/competitors/snapshot');

const NOW = new Date('2026-10-17T06:00:00Z');
const ts = (daysAgo) => Math.floor((NOW.getTime() - daysAgo * 864e5) / 1000);
const base = () => ({ userId: new mongoose.Types.ObjectId(), competitorId: new mongoose.Types.ObjectId(), handle: 'rival', takenAt: NOW });

test('a real summarise() output with all three post types validates and keeps topPost', () => {
  const posts = [
    { timestamp: ts(1), likesCount: 50, commentsCount: 2, type: 'Image', caption: 'a #one', hashtags: ['one'], url: 'https://i/1' },
    { timestamp: ts(2), likesCount: 900, commentsCount: 30, type: 'Video', caption: 'b #two', hashtags: ['two'], url: 'https://i/2' },
    { timestamp: ts(3), likesCount: 70, commentsCount: 4, type: 'Sidecar', caption: 'c', hashtags: [], url: 'https://i/3' }
  ];
  const snap = summarise({ profile: { followersCount: 1000, postsCount: 40 }, posts, now: NOW });
  const doc = new CompetitorSnapshot({ ...snap, ...base(), ok: true });
  assert.strictEqual(doc.validateSync(), undefined);
  assert.strictEqual(doc.topPost.type, 'Video');
  assert.strictEqual(doc.topPost.likes, 900);
  assert.strictEqual(doc.formats.carousel, 1);
});

test('a summarise() output with no posts (topPost null) validates', () => {
  const snap = summarise({ profile: { followersCount: 10, postsCount: 0 }, posts: [], now: NOW });
  const doc = new CompetitorSnapshot({ ...snap, ...base(), ok: true });
  assert.strictEqual(doc.validateSync(), undefined);
  assert.strictEqual(doc.topPost, null);
});

test('a failed-check document validates', () => {
  const doc = new CompetitorSnapshot({ ...base(), weekStart: '2026-10-12', ok: false, error: 'This account is private.' });
  assert.strictEqual(doc.validateSync(), undefined);
});
