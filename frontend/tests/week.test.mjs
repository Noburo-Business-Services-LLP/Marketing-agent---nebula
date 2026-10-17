import test from 'node:test';
import assert from 'node:assert/strict';
import { headline, cardState, scaledNote, itemLine, countsOf } from '../utils/week.ts';

test('the headline counts plainly and never says zero of something', () => {
  assert.equal(headline({ posts: 5, carousels: 1, videos: 2 }), 'This week we will make 5 posts, 1 carousel and 2 videos, based on your plan.');
  assert.equal(headline({ posts: 1, carousels: 0, videos: 0 }), 'This week we will make 1 post, based on your plan.');
  assert.equal(headline({ posts: 0, carousels: 0, videos: 1 }), 'This week we will make 1 video, based on your plan.');
  assert.equal(headline({ posts: 0, carousels: 0, videos: 0 }), 'Nothing is planned for this week yet.');
});
test('the card state follows the server answer', () => {
  assert.equal(cardState({ eligible: false, reason: 'free' }), 'not_eligible');
  assert.equal(cardState({ eligible: false, reason: 'off' }), 'not_eligible');
  assert.equal(cardState({ eligible: false, reason: 'no_plan' }), 'no_plan');
  assert.equal(cardState({ eligible: true, proposal: null }), 'no_plan');
  assert.equal(cardState({ eligible: true, topUp: true, proposal: { empty: true, items: [] } }), 'top_up');
  assert.equal(cardState({ eligible: true, proposal: { status: 'proposed', items: [{ status: 'proposed' }] } }), 'ready');
  assert.equal(cardState({ eligible: true, proposal: { status: 'approved', items: [{ status: 'made' }, { status: 'made' }] } }), 'approved');
  assert.equal(cardState({ eligible: true, proposal: { status: 'approved', items: [{ status: 'made' }, { status: 'approved', kind: 'video' }] } }), 'partly');
  assert.equal(cardState({ eligible: true, proposal: { status: 'approved', items: [{ status: 'making', kind: 'post' }] } }), 'approved');
  assert.equal(cardState({ eligible: true, proposal: { status: 'skipped', items: [] } }), 'skipped');
  assert.equal(cardState({ eligible: true, proposal: { status: 'expired', items: [] } }), 'not_eligible');
});
test('the scaled-down note is plain and mentions what was left out', () => {
  assert.match(scaledNote({ scaledDown: true, removed: { videos: 1, carousels: 0, posts: 0 } }), /left out 1 video/);
  assert.equal(scaledNote({ scaledDown: false }), '');
  assert.doesNotMatch(scaledNote({ scaledDown: true, removed: { videos: 2, carousels: 1, posts: 0 } }), /quark|credit|trial/i);
});
test('counts are computed from the items when the server sends none, skipping skipped ones', () => {
  const p = { items: [{ kind: 'post', status: 'proposed' }, { kind: 'post', status: 'skipped' }, { kind: 'video', status: 'proposed' }] };
  assert.deepEqual(countsOf(p), { posts: 1, carousels: 0, videos: 1 });
  assert.deepEqual(countsOf({ counts: { posts: 2, carousels: 1, videos: 0 }, items: [] }), { posts: 2, carousels: 1, videos: 0 });
});
test('item lines differ by what the item is doing', () => {
  assert.equal(itemLine({ kind: 'post', status: 'making' }), 'Making…');
  assert.equal(itemLine({ kind: 'post', status: 'made' }), 'In Review and approve');
  assert.equal(itemLine({ kind: 'post', status: 'failed' }), 'Could not be made, try again');
  assert.equal(itemLine({ kind: 'video', status: 'approved' }), 'Ready to make');
  assert.equal(itemLine({ kind: 'post', status: 'proposed' }), '');
});
