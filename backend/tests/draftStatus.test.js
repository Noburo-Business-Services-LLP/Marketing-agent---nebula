const test = require('node:test');
const assert = require('node:assert');
const { AWAITING_STATUSES, stateOf, isAwaitingReview, awaitingFilter, DRAFT_STATES } = require('../services/draftStatus');

test('the four states the app talks about', () => {
  assert.deepStrictEqual(DRAFT_STATES, ['waiting', 'approved', 'published', 'failed']);
  for (const s of ['pending', 'draft', 'ready', 'processing', 'completed']) assert.strictEqual(stateOf(s), 'waiting', s);
  for (const s of ['approved', 'scheduled']) assert.strictEqual(stateOf(s), 'approved', s);
  for (const s of ['published', 'posted']) assert.strictEqual(stateOf(s), 'published', s);
  assert.strictEqual(stateOf('failed'), 'failed');
  assert.strictEqual(stateOf('rejected'), 'closed');
  assert.strictEqual(stateOf('archived'), 'closed');
  assert.strictEqual(stateOf(undefined), 'waiting'); // the Approve page treats a missing status as draft
  assert.strictEqual(stateOf('  PUBLISHED '), 'published');
  assert.strictEqual(stateOf('something new'), 'closed');
});

test('the Approve queue shows waiting and failed posts, never videos or finished ones', () => {
  assert.deepStrictEqual([...AWAITING_STATUSES].sort(), ['completed', 'draft', 'failed', 'pending', 'processing', 'ready']);
  assert.strictEqual(isAwaitingReview({ status: 'draft', sourceType: 'post' }), true);
  assert.strictEqual(isAwaitingReview({ status: 'failed', sourceType: 'campaign' }), true);
  assert.strictEqual(isAwaitingReview({ status: 'published', sourceType: 'post' }), false);
  assert.strictEqual(isAwaitingReview({ status: 'draft', sourceType: 'reel' }), false);
  assert.strictEqual(isAwaitingReview({ status: 'draft', contentType: 'video' }), false);
  assert.strictEqual(isAwaitingReview({ status: 'draft', sourceType: '', contentType: 'reel' }), false);
  assert.strictEqual(isAwaitingReview({ status: 'draft', sourceType: 'post', contentType: 'reel' }), true); // sourceType wins, as on the Approve page
  assert.strictEqual(isAwaitingReview({}), true);
  assert.strictEqual(isAwaitingReview(null), false);
});

test('the database filter has the same meaning as the function', () => {
  const f = awaitingFilter('USER');
  assert.strictEqual(f.userId, 'USER');
  assert.deepStrictEqual([...f.status.$in].sort(), [...AWAITING_STATUSES].sort());
  assert.ok(f.$nor && f.$nor.length === 2, 'excludes reels and videos by sourceType, or by contentType when sourceType is empty');
  assert.deepStrictEqual(f.$nor[0], { sourceType: { $in: ['reel', 'video'] } });
});
