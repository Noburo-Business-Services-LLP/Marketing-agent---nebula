import test from 'node:test';
import assert from 'node:assert/strict';
import { sectionsOf, tagLabel, effortRows, refreshLabel, planBanner, BANNER_TEXT, stoppedMessage, shouldPoll } from '../utils/plan.ts';

const plan = { result: { plan: { promise: { text: 'More enquiries.' }, positioning: { audience: [{ text: 'Families' }] }, icp: { who: [{ text: 'Families who order for birthdays', tag: 'inference' }], pains: [], where: [], triggers: [] }, channels: [{ channel: 'Instagram', role: { text: 'Show the cakes.' } }], effort: [{ channel: 'Instagram', organicPct: 80, paidPct: 20, nebulaaDoes: ['posts', 'videos'], youDo: [{ text: 'Reply to DMs the same day.' }] }], roadmap: [{ phase: 'foundation', focus: { text: 'Set up.' }, actions: [], measure: [] }], calendar: [{ day: 1, format: 'image post' }, { day: 2, format: 'reel' }], firstSteps: [{ text: 'Post today.' }] } } };

test('sections come in the agreed order and empty ones are left out', () => {
  assert.deepEqual(sectionsOf(plan).map((s) => s.id), ['today', 'customer', 'channels', 'roadmap', 'mix', 'first']);
  const noIcp = { result: { plan: { ...plan.result.plan, icp: null, effort: [] } } };
  assert.ok(!sectionsOf(noIcp).some((s) => s.id === 'customer'));
});

test('tags are shown in plain words', () => {
  assert.equal(tagLabel('verified'), 'Confirmed');
  assert.equal(tagLabel('inference'), 'Our reading');
  assert.equal(tagLabel('proposed'), 'Suggested');
  assert.equal(tagLabel('unverified'), 'Not confirmed');
  assert.equal(tagLabel('whatever'), 'Suggested');
});

test('each channel row shows the split and who does what in plain words', () => {
  const rows = effortRows(plan);
  assert.equal(rows[0].channel, 'Instagram');
  assert.equal(rows[0].organicPct, 80);
  assert.equal(rows[0].nebulaaDoes, 'posts and videos');
  assert.deepEqual(rows[0].youDo, ['Reply to DMs the same day.']);
});

test('refresh label and banner states', () => {
  assert.equal(refreshLabel({ nextRefreshAt: null }, new Date('2026-10-17')), 'Refresh my plan');
  assert.equal(refreshLabel({ nextRefreshAt: '2026-10-24T00:00:00Z' }, new Date('2026-10-17')), 'Next refresh on 24 October');
  assert.equal(planBanner({ running: true }), 'building');
  assert.equal(planBanner({ failed: true, plan: null }), 'failed');
  assert.equal(planBanner({ plan: { stale: true } }), 'stale');
  assert.equal(planBanner({ eligible: false, reason: 'free' }), 'free');
  assert.equal(planBanner({ eligible: false, reason: 'profile_incomplete' }), 'profile_incomplete');
  assert.equal(planBanner({ plan: { id: 'x' } }), 'ready');
});

test('can_build: an eligible account with no plan, nothing running and no failure sees the build button', () => {
  assert.equal(planBanner({ eligible: true, plan: null, running: false, failed: false, stopped: null }), 'can_build');
  assert.equal(planBanner({ eligible: true, plan: null, running: true }), 'building');
  assert.equal(planBanner({ eligible: true, plan: null, failed: true }), 'failed');
  assert.equal(planBanner({ eligible: true, plan: { id: 'x' } }), 'ready');
  assert.equal(planBanner({ eligible: false, reason: 'not_eligible', plan: null }), 'none');
  assert.equal(BANNER_TEXT.can_build, 'This takes about a minute. It is free.');
});

test('stopped: its own state with the plain message, never a retry loop', () => {
  assert.equal(planBanner({ eligible: true, plan: null, stopped: { message: 'We could not read your website.' } }), 'stopped');
  assert.equal(stoppedMessage({ eligible: true, stopped: { message: 'We could not read your website.' } }), 'We could not read your website.');
  assert.equal(stoppedMessage({ eligible: true, running: true, stopped: { message: 'x' } }), '');
  assert.equal(stoppedMessage({ eligible: true, stopped: null }), '');
});

test('polling: keeps going while a plan is building, even after one failed poll', () => {
  assert.equal(shouldPoll({ running: true }), true);
  assert.equal(shouldPoll({ running: false }), false);
  assert.equal(shouldPoll(null), false);
});
