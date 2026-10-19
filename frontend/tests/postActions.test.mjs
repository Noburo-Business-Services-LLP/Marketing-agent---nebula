import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_ORDER, REASONS, BIN_DAYS, postActionsFor, publishAccessOf, needsApproval, confirmFor, binDaysLeft,
  picturesOf, platformList, postStateWord, DONE_WORDS,
} from '../utils/postActions.ts';

const IMG = 'https://res.cloudinary.com/demo/image/upload/v1/a.jpg';
const OK = { publish: 'ok', hasAccount: true, makeAgainQuarks: 11 };
const post = (status, origin = 'manual', extra = {}) => ({ _id: 'd1', status, origin, imageUrl: IMG, platforms: ['instagram', 'facebook'], sourceType: 'post', ...extra });
const keys = (d, ctx = OK) => postActionsFor(d, ctx).map((a) => a.key);
const byKey = (d, ctx = OK) => Object.fromEntries(postActionsFor(d, ctx).map((a) => [a.key, a]));
const primary = (d, ctx = OK) => (postActionsFor(d, ctx).find((a) => a.primary) || {}).key;

test('the fixed order is the owner order', () => {
  assert.deepEqual([...ACTION_ORDER], ['approve', 'schedule', 'postNow', 'download', 'edit', 'makeAgain', 'unschedule', 'unapprove', 'archive', 'delete', 'restore']);
});

test('every status and origin gives its actions in the fixed order', () => {
  const statuses = ['draft', 'pending', 'ready', 'completed', 'processing', 'failed', 'approved', 'scheduled', 'published', 'archived', 'binned', ''];
  for (const origin of ['manual', 'automation']) {
    for (const status of statuses) {
      const list = keys(post(status, origin));
      const idx = list.map((k) => ACTION_ORDER.indexOf(k));
      assert.deepEqual(idx, [...idx].sort((a, b) => a - b), `${origin} ${status} is out of order: ${list}`);
      assert.equal(new Set(list).size, list.length, `${origin} ${status} repeats an action`);
      assert.ok(postActionsFor(post(status, origin), OK).filter((a) => a.primary).length <= 1, `${origin} ${status} has two primaries`);
    }
  }
});

test('an automation post waiting for approval: Approve first, Schedule and Post now locked until approved', () => {
  for (const status of ['draft', 'pending', 'ready', 'completed']) {
    const d = post(status, 'automation');
    assert.equal(needsApproval(d), true);
    assert.deepEqual(keys(d), ['approve', 'schedule', 'postNow', 'download', 'edit', 'makeAgain', 'archive', 'delete']);
    assert.equal(primary(d), 'approve');
    const a = byKey(d);
    assert.equal(a.schedule.disabled, true); assert.equal(a.schedule.reason, REASONS.approveFirst);
    assert.equal(a.postNow.disabled, true); assert.equal(a.postNow.reason, REASONS.approveFirst);
    assert.equal(a.approve.disabled, false);
  }
});

test('approve is offered even on a free plan (it is free and never posts)', () => {
  const a = byKey(post('draft', 'automation'), { publish: 'upgrade', hasAccount: false });
  assert.equal(a.approve.disabled, false);
  assert.equal(a.approve.confirm, undefined);
});

test('old rows without an origin read as automation from their calendar link', () => {
  assert.equal(keys(post('draft', null, { contentCalendarId: 'c1' }))[0], 'approve');
  assert.equal(keys(post('draft', null, { calendarDay: 3 }))[0], 'approve');
  assert.notEqual(keys(post('draft', null))[0], 'approve');
});

test('a manual post needs no approval: Schedule is the main button', () => {
  const d = post('draft', 'manual');
  assert.equal(needsApproval(d), false);
  assert.deepEqual(keys(d), ['schedule', 'postNow', 'download', 'edit', 'makeAgain', 'archive', 'delete']);
  assert.equal(primary(d), 'schedule');
  assert.equal(byKey(d).postNow.disabled, false);
});

test('approved: schedule, post now, download, then unapprove, archive and delete in the menu', () => {
  for (const origin of ['manual', 'automation']) {
    const d = post('approved', origin);
    assert.deepEqual(keys(d), ['schedule', 'postNow', 'download', 'edit', 'makeAgain', 'unapprove', 'archive', 'delete']);
    assert.equal(primary(d), 'schedule');
    const a = byKey(d);
    assert.equal(a.unapprove.menu, true); assert.equal(a.archive.menu, true); assert.equal(a.delete.menu, true);
    assert.equal(a.schedule.disabled, false);
  }
});

test('scheduled: change time, post now, download, edit, unschedule; never archive or delete before unscheduling', () => {
  const d = post('scheduled', 'automation');
  assert.deepEqual(keys(d), ['schedule', 'postNow', 'download', 'edit', 'unschedule']);
  assert.equal(byKey(d).schedule.label, 'Change time');
  assert.ok(byKey(d).unschedule.confirm);
});

test('posted: download, make again and archive only (posted items never go to the Bin)', () => {
  assert.deepEqual(keys(post('published')), ['download', 'makeAgain', 'archive']);
  assert.equal(primary(post('published')), 'download');
});

test('archived and the Bin: restore is the main button; archived can also go to the Bin', () => {
  assert.deepEqual(keys(post('archived')), ['download', 'delete', 'restore']);
  assert.equal(primary(post('archived')), 'restore');
  assert.deepEqual(keys(post('binned', 'manual', { binnedAt: new Date().toISOString() })), ['download', 'restore']);
  assert.equal(primary(post('binned', 'manual', { binnedAt: new Date().toISOString() })), 'restore');
});

test('a Bin item older than 14 days cannot be restored, with the reason', () => {
  const now = Date.parse('2026-10-19T10:00:00Z');
  const old = post('binned', 'manual', { binnedAt: '2026-10-01T10:00:00Z' });
  const a = byKey(old, { ...OK, now });
  assert.equal(a.restore.disabled, true); assert.equal(a.restore.reason, REASONS.binExpired);
  assert.equal(binDaysLeft('2026-10-18T10:00:00Z', now), 13);
  assert.equal(binDaysLeft('2026-10-05T10:00:00Z', now), 0);
  assert.equal(binDaysLeft(null, now), 0);
});

test('still being made: nothing; did not finish: make again leads', () => {
  assert.deepEqual(keys(post('processing')), []);
  assert.deepEqual(keys(post('failed', 'automation', { imageUrl: '' })), ['edit', 'makeAgain', 'archive', 'delete']);
  assert.equal(primary(post('failed', 'automation', { imageUrl: '' })), 'makeAgain');
});

test('no picture: no download', () => {
  assert.ok(!keys(post('draft', 'manual', { imageUrl: '' })).includes('download'));
  assert.deepEqual(picturesOf({ carouselSlides: [{ order: 2, imageUrl: 'https://b' }, { order: 1, imageUrl: 'https://a' }] }), ['https://a', 'https://b']);
  assert.deepEqual(picturesOf({ creative: { imageUrls: ['https://c'] } }), ['https://c']);
  assert.deepEqual(picturesOf({ imageUrl: 'javascript:alert(1)' }), []);
});

test('plan locks: free plan, paid without the add-on, no account, no platform', () => {
  const d = post('approved');
  let a = byKey(d, { publish: 'upgrade', hasAccount: true });
  assert.equal(a.schedule.reason, 'Needs a paid plan'); assert.equal(a.postNow.reason, 'Needs a paid plan');
  a = byKey(d, { publish: 'addon', hasAccount: true });
  assert.equal(a.schedule.reason, 'Needs the Publish add-on'); assert.equal(a.postNow.disabled, true);
  a = byKey(d, { publish: 'ok', hasAccount: false });
  assert.equal(a.postNow.reason, 'Connect an account first'); assert.equal(a.schedule.reason, 'Connect an account first');
  a = byKey({ ...d, platforms: [] }, OK);
  assert.equal(a.postNow.reason, 'Choose where to post first'); assert.equal(a.schedule.disabled, false);
  // Unknown plan and account: open, the server decides.
  a = byKey(d, {});
  assert.equal(a.schedule.disabled, false); assert.equal(a.postNow.disabled, false);
  // A locked action keeps its place.
  assert.deepEqual(keys(d, { publish: 'upgrade' }), keys(d, OK));
  // With Schedule and Post now locked, Download becomes the main button.
  assert.equal(primary(d, { publish: 'addon' }), 'download');
});

test('publishAccessOf follows the server rule', () => {
  assert.equal(publishAccessOf({ tier: 'free' }), 'upgrade');
  assert.equal(publishAccessOf({ tier: 'starter', addons: [] }), 'addon');
  assert.equal(publishAccessOf({ tier: 'professional', addons: ['publish'] }), 'ok');
  assert.equal(publishAccessOf({ tier: 'starter', addons: ['bundle'] }), 'ok');
  assert.equal(publishAccessOf({ tier: 'managed' }), 'ok');
  assert.equal(publishAccessOf({ tier: 'agency', addons: [] }), 'ok');
  assert.equal(publishAccessOf({}), 'ok');
  assert.equal(publishAccessOf(null), 'unknown');
  assert.equal(publishAccessOf({ tier: 'mystery' }), 'unknown');
});

test('staff view is download only; a screen without an editor leaves Edit out', () => {
  assert.deepEqual(keys(post('draft', 'automation'), { ...OK, staffView: true }), ['download']);
  assert.ok(!keys(post('draft'), { ...OK, canEdit: false }).includes('edit'));
});

test('Make again carries its Quark amount; the confirm states it', () => {
  const a = byKey(post('draft'));
  assert.equal(a.makeAgain.quarks, 11);
  assert.match(a.makeAgain.confirm.message, /11 Quarks/);
  const free = byKey(post('draft'), { ...OK, makeAgainQuarks: 0 });
  assert.equal(free.makeAgain.quarks, undefined);
  assert.doesNotMatch(free.makeAgain.confirm.message, /Quark/);
});

test('confirm texts: delete names the Bin and 14 days; post now names the platforms; safe ones ask nothing', () => {
  const d = post('approved');
  const del = confirmFor('delete', d);
  assert.equal(del.danger, true); assert.match(del.message, /Bin/); assert.match(del.message, /14 days/);
  assert.equal(confirmFor('postNow', d).message, 'This posts it to Instagram and Facebook now.');
  for (const k of ['approve', 'download', 'edit', 'archive', 'unapprove', 'restore', 'schedule']) assert.equal(confirmFor(k, d), undefined, k);
  assert.equal(BIN_DAYS, 14);
});

test('video posts are not made again or approved here', () => {
  const reel = post('draft', 'automation', { sourceType: 'reel', imageUrl: '', creative: { videoUrl: 'https://v.mp4' } });
  assert.ok(!keys(reel).includes('makeAgain')); assert.ok(!keys(reel).includes('approve'));
  assert.ok(keys(reel).includes('download'));
});

test('state words and done words are plain', () => {
  assert.equal(postStateWord(post('draft', 'automation')), 'Needs approval');
  assert.equal(postStateWord(post('approved')), 'Approved');
  assert.equal(postStateWord(post('binned')), 'In the Bin');
  assert.equal(postStateWord(post('published')), 'Posted');
  assert.equal(platformList(['instagram', 'facebook', 'linkedin']), 'Instagram, Facebook and LinkedIn');
  assert.equal(platformList([]), '');
  const all = [...Object.values(DONE_WORDS), ...Object.values(REASONS)].join(' ');
  assert.doesNotMatch(all, /credit|trial|7 days|!|—/i);
});

test('junk input gives no actions and never throws', () => {
  assert.deepEqual(postActionsFor(null), []);
  assert.deepEqual(postActionsFor(undefined, {}), []);
  assert.ok(Array.isArray(postActionsFor({ status: 'weird' })));
});
