import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stateOf, isAwaitingReview, AWAITING_STATUSES, DRAFT_STATES } from '../utils/draftStatus.ts';
import backend from '../../backend/services/draftStatus.js';

test('the same four states and the same queue as the server', () => {
  assert.deepEqual([...DRAFT_STATES], backend.DRAFT_STATES);
  assert.deepEqual([...AWAITING_STATUSES].sort(), [...backend.AWAITING_STATUSES].sort());
  for (const s of ['pending', 'draft', 'ready', 'processing', 'completed', 'failed', 'approved', 'scheduled', 'published', 'posted', 'rejected', 'archived', '', undefined, null, 'whatever', ' DRAFT ']) {
    assert.equal(stateOf(s), backend.stateOf(s), String(s));
  }
  const drafts = [
    { status: 'draft', sourceType: 'post' }, { status: 'failed', sourceType: 'campaign' }, { status: 'published', sourceType: 'post' },
    { status: 'draft', sourceType: 'reel' }, { status: 'draft', contentType: 'video' }, { status: 'draft', sourceType: '', contentType: 'reel' },
    { status: 'draft', sourceType: 'post', contentType: 'reel' }, {}, null
  ];
  for (const d of drafts) assert.equal(isAwaitingReview(d), backend.isAwaitingReview(d), JSON.stringify(d));
});
test('a waiting post, a failed post, a video and a finished post', () => {
  assert.equal(isAwaitingReview({ status: 'completed', sourceType: 'post' }), true);
  assert.equal(isAwaitingReview({ status: 'failed', sourceType: 'post' }), true);
  assert.equal(isAwaitingReview({ status: 'draft', sourceType: 'reel' }), false);
  assert.equal(isAwaitingReview({ status: 'published', sourceType: 'post' }), false);
});
test('the Approve page uses the shared helper instead of its own list', () => {
  const src = fs.readFileSync(new URL('../pages/GravityApprove.tsx', import.meta.url), 'utf8');
  assert.match(src, /utils\/draftStatus/);
  assert.doesNotMatch(src, /APPROVABLE_STATUSES/);
});
