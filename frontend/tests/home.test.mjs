import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isHomeSummary, timeLabel, todayRows, readCachedSummary, writeCachedSummary, summaryKey, CACHE_MS, weekPostsLine, platformsLine, stackCards } from '../utils/home.ts';

const fullSummary = () => ({ generatedAt: 'x', numbers: { postsPublishedThisWeek: {}, draftsWaiting: {} }, week: { posts: {} }, connected: { count: 0, platforms: [] } });
const row = (id, at, extra = {}) => ({ id, at, title: `Post ${id}`, subtitle: '', image: null, status: 'scheduled', platform: 'instagram', ...extra });

test('a time is shown in India time as "9:00 AM", whatever the browser timezone', () => {
  assert.equal(timeLabel('2026-10-14T03:30:00Z'), '9:00 AM');
  assert.equal(timeLabel('2026-10-14T04:30:00Z'), '10:00 AM');
  assert.equal(timeLabel('2026-10-14T18:29:00Z'), '11:59 PM');
  assert.equal(timeLabel('2026-10-14T18:30:00Z'), '12:00 AM');
  assert.equal(timeLabel('2026-10-14T06:35:00Z'), '12:05 PM');
  assert.equal(timeLabel(null), '');
  assert.equal(timeLabel('not a date'), '');
});

test('Today\'s plan puts 9:00 AM before 10:00 AM', () => {
  const rows = todayRows([row('b', '2026-10-14T04:30:00Z'), row('a', '2026-10-14T03:30:00Z'), row('c', '2026-10-14T09:30:00Z')]);
  assert.deepEqual(rows.map((r) => r.id), ['a', 'b', 'c']);
  assert.deepEqual(rows.map((r) => r.time), ['9:00 AM', '10:00 AM', '3:00 PM']);
});
test('the same minute keeps the server order, and a post with no time goes last', () => {
  const rows = todayRows([row('n', null), row('x', '2026-10-14T03:30:00Z'), row('y', '2026-10-14T03:30:00Z')]);
  assert.deepEqual(rows.map((r) => r.id), ['x', 'y', 'n']);
  assert.equal(rows[2].time, '');
});
test('rows that arrive with only a text time are sorted by the real time of day', () => {
  const rows = todayRows([{ id: 'p', time: '10:00 AM', title: 'P', status: 'scheduled' }, { id: 'q', time: '9:00 AM', title: 'Q', status: 'scheduled' }]);
  assert.deepEqual(rows.map((r) => r.id), ['q', 'p']);
});
test('rubbish in gives an empty list', () => {
  assert.deepEqual(todayRows(undefined), []);
  assert.deepEqual(todayRows(null), []);
  assert.deepEqual(todayRows([null, undefined, 5]), []);
});

test('the summary is remembered for a minute, per account, and storage failures are ignored', () => {
  const mem = new Map();
  const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, v) };
  const data = fullSummary();
  assert.equal(CACHE_MS, 60000);
  assert.equal(readCachedSummary('u1', 1000, storage), null);
  writeCachedSummary('u1', data, 1000, storage);
  assert.deepEqual(readCachedSummary('u1', 30000, storage), data);
  assert.equal(readCachedSummary('u1', 61001, storage), null);
  assert.equal(readCachedSummary('u2', 2000, storage), null, 'another account never sees it');
  assert.notEqual(summaryKey('u1'), summaryKey('u2'));
  mem.set(summaryKey('u3'), '{not json');
  assert.equal(readCachedSummary('u3', 1, storage), null);
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.equal(readCachedSummary('u1', 1, broken), null);
  assert.doesNotThrow(() => writeCachedSummary('u1', data, 1, broken));
  assert.equal(readCachedSummary('u1', 1, undefined), null);
  assert.equal(readCachedSummary('', 1, storage), null);
});

test('small text helpers say only what is known', () => {
  assert.equal(weekPostsLine(null), '');
  assert.equal(weekPostsLine({ planned: null, made: null, published: 3, scheduled: 0 }), '3 published so far');
  assert.equal(weekPostsLine({ planned: 5, made: 2, published: 2, scheduled: 1 }), '2 published so far, 1 scheduled');
  assert.equal(platformsLine([]), 'No accounts are connected yet.');
  assert.equal(platformsLine(['instagram', 'facebook']), 'Connected: instagram, facebook');
});

test('the picture stack uses only the customer\'s own posts, never a stock photo', () => {
  assert.deepEqual(stackCards([]), []);
  assert.deepEqual(stackCards(undefined), []);
  const cards = stackCards([{ image: 'https://cdn.example/a.jpg', platform: 'instagram', when: '2026-10-14T03:30:00Z' }, { image: 'http://x/b.jpg', platform: null, when: null }]);
  assert.equal(cards.length, 2);
  assert.equal(cards[0].tag, 'IG');
  assert.equal(cards[1].tag, '');
  const src = fs.readFileSync(new URL('../pages/GravityHome.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /unsplash/i);
  assert.doesNotMatch(src, /https?:\/\/images\./);
});

test('Home no longer downloads every draft and campaign', () => {
  const src = fs.readFileSync(new URL('../pages/GravityHome.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /getDrafts|getCampaigns|draftsAPI/);
  assert.match(src, /getHomeSummary/);
  assert.doesNotMatch(src, /getDay\(\)\s*[-)]/, 'no Sunday-start browser week maths');
});

test('an answer that is not a Home summary is treated as no answer', () => {
  assert.equal(isHomeSummary(fullSummary()), true);
  for (const v of [null, undefined, 5, 'x', {}, { data: [], items: [] }, { numbers: {} }, { numbers: { postsPublishedThisWeek: {}, draftsWaiting: {} } }]) assert.equal(isHomeSummary(v), false, JSON.stringify(v));
  const mem = new Map();
  const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, v) };
  mem.set(summaryKey('u1'), JSON.stringify({ at: 1, data: { numbers: {} } }));
  assert.equal(readCachedSummary('u1', 2, storage), null);
});
