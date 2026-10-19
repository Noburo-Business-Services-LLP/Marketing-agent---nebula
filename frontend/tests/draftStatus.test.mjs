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
test('origin and needs approval mean the same as on the server, including old rows without an origin', async () => {
  const { originOf, needsApproval, ORIGINS } = await import('../utils/draftStatus.ts');
  assert.deepEqual([...ORIGINS], [...backend.ORIGINS]);
  const rows = [
    { origin: 'manual', contentCalendarId: 'c1' }, { origin: 'automation' }, { contentCalendarId: 'c1' }, { calendarDay: 3 }, { calendarDay: null },
    { origin: 'x' }, {}, null,
    { status: 'completed', origin: 'automation', sourceType: 'post' }, { status: 'completed', calendarDay: 2, sourceType: 'post' },
    { status: 'completed', origin: 'manual', sourceType: 'post' }, { status: 'approved', origin: 'automation', sourceType: 'post' },
    { status: 'binned', origin: 'automation', sourceType: 'post' }, { status: 'draft', origin: 'automation', sourceType: 'reel' }
  ];
  for (const d of rows) {
    assert.equal(originOf(d), backend.originOf(d), JSON.stringify(d));
    assert.equal(needsApproval(d), backend.needsApproval(d), JSON.stringify(d));
  }
  for (const s of ['approved', 'binned']) assert.equal(stateOf(s), backend.stateOf(s), s);
});
