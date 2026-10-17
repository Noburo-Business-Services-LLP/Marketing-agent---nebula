import test from 'node:test';
import assert from 'node:assert/strict';
import { cardState, statusText, trendLabel, highlightsFor } from '../utils/competitorInsights.ts';

const comp = (o = {}) => ({ id: 'c1', name: 'Acme', handle: 'acme', status: 'tracking', trend: [], lastCheckedAt: null, ...o });

test('cardState follows the response shape', () => {
  assert.equal(cardState({ locked: true }), 'locked');
  assert.equal(cardState({ success: false, locked: true }), 'locked');
  assert.equal(cardState(null), 'error');
  assert.equal(cardState(undefined), 'error');
  assert.equal(cardState({ error: true }), 'error');
  assert.equal(cardState({ success: false }), 'error');
  assert.equal(cardState({ success: true, highlights: [], competitors: [] }), 'none');
  assert.equal(cardState({ success: true, highlights: [], competitors: [comp()] }), 'started');
  assert.equal(cardState({ success: true, highlights: [{ competitorId: 'c1', name: 'Acme', text: 'Acme posted 5 times.' }], competitors: [comp()] }), 'ready');
});

test('statusText for each competitor state', () => {
  const trend = [{ weekStart: '2026-10-12', postsInWindow: 2, avgLikes: 10 }];
  assert.equal(statusText(comp({ trend })), 'Tracking since Monday 12 October');
  assert.equal(statusText(comp({ trend: [...trend, { weekStart: '2026-10-19', postsInWindow: 1, avgLikes: 1 }] })), 'Tracking since Monday 12 October');
  assert.equal(statusText(comp({ trend: [] })), 'First results next week');
  assert.equal(statusText(comp({ status: 'no_handle' })), 'Add their Instagram handle to track them');
  assert.equal(statusText(comp({ status: 'failed' })), 'We could not read this account. Check the handle.');
  assert.equal(statusText(comp({ status: 'paused' })), 'Paused after repeated problems. Update the handle to resume.');
  assert.equal(statusText(comp({ status: 'waiting' })), 'First results next week');
});

test('trendLabel with 0, 1 and 4 weeks', () => {
  assert.equal(trendLabel([]), '');
  assert.equal(trendLabel(undefined), '');
  assert.equal(trendLabel([{ weekStart: 'a', postsInWindow: 3, avgLikes: 1 }]), 'Posts a week: 3');
  const four = [2, 5, 3, 4].map((n, i) => ({ weekStart: String(i), postsInWindow: n, avgLikes: 0 }));
  assert.equal(trendLabel(four), 'Posts a week: 2, 5, 3, 4');
});

test('highlightsFor returns at most three sentences', () => {
  const hs = [1, 2, 3, 4, 5].map((n) => ({ competitorId: 'c' + n, name: 'N', text: `Sentence ${n}.` }));
  assert.deepEqual(highlightsFor({ success: true, highlights: hs, competitors: [] }), ['Sentence 1.', 'Sentence 2.', 'Sentence 3.']);
  assert.deepEqual(highlightsFor(null), []);
  assert.deepEqual(highlightsFor({ locked: true }), []);
  assert.deepEqual(highlightsFor({ success: true, highlights: [{ text: '' }, { text: 'Ok.' }], competitors: [] }), ['Ok.']);
});
