import test from 'node:test';
import assert from 'node:assert/strict';
import { TOUR_STEPS, visibleSteps, shouldAutoStart, reduce } from '../utils/tour.ts';

const user = (o = {}) => ({ onboardingCompleted: true, staffRole: null, isCsm: false, tour: null, ...o });

test('five steps, in order, with plain wording', () => {
  assert.deepEqual(TOUR_STEPS.map((s) => s.id), ['welcome', 'create', 'library', 'plan', 'help']);
  for (const s of TOUR_STEPS) assert.doesNotMatch(`${s.title} ${s.body}`, /credit|trial|7 days|quark|agent/i, s.id);
});
test('a step whose target is missing is skipped', () => {
  const has = (sel) => !sel.includes('nav-library');
  assert.deepEqual(visibleSteps(TOUR_STEPS, has).map((s) => s.id), ['welcome', 'create', 'plan', 'help']);
  assert.deepEqual(visibleSteps(TOUR_STEPS, () => false), []);
});
test('the tour starts by itself once, for ordinary customers on the home screen only', () => {
  assert.equal(shouldAutoStart({ user: user(), path: '/dashboard', hasCsmPass: false }), true);
  assert.equal(shouldAutoStart({ user: user(), path: '/', hasCsmPass: false }), true);
  assert.equal(shouldAutoStart({ user: user({ tour: { completedAt: '2026-10-01' } }), path: '/dashboard', hasCsmPass: false }), false);
  assert.equal(shouldAutoStart({ user: user({ tour: { skippedAt: '2026-10-01' } }), path: '/dashboard', hasCsmPass: false }), false);
  assert.equal(shouldAutoStart({ user: user({ onboardingCompleted: false }), path: '/dashboard', hasCsmPass: false }), false);
  assert.equal(shouldAutoStart({ user: user({ staffRole: 'csm' }), path: '/dashboard', hasCsmPass: false }), false);
  assert.equal(shouldAutoStart({ user: user({ isCsm: true }), path: '/dashboard', hasCsmPass: false }), false);
  assert.equal(shouldAutoStart({ user: user({ actingAgency: { name: 'x' } }), path: '/dashboard', hasCsmPass: false }), false);
  assert.equal(shouldAutoStart({ user: user(), path: '/dashboard', hasCsmPass: true }), false);
  assert.equal(shouldAutoStart({ user: user(), path: '/campaigns', hasCsmPass: false }), false);
  assert.equal(shouldAutoStart({ user: null, path: '/dashboard', hasCsmPass: false }), false);
});
test('the state machine moves, never underflows, and finishes after the last step', () => {
  let s = reduce({ index: 0, open: false, total: 3 }, { type: 'start' });
  assert.deepEqual(s, { index: 0, open: true, total: 3 });
  s = reduce(s, { type: 'back' });
  assert.equal(s.index, 0);
  s = reduce(reduce(s, { type: 'next' }), { type: 'next' });
  assert.equal(s.index, 2);
  const done = reduce(s, { type: 'next' });
  assert.equal(done.open, false);
  assert.equal(done.finished, true);
  assert.equal(reduce({ index: 1, open: true, total: 3 }, { type: 'skip' }).skipped, true);
  assert.equal(reduce({ index: 1, open: true, total: 3 }, { type: 'finish' }).finished, true);
});

import { waitForTargets } from '../utils/tour.ts';
const fakeClock = () => { const c = { t: 0, sleeps: 0 }; c.sleep = async (ms) => { c.t += ms; c.sleeps += 1; }; return c; };
test('waitForTargets returns at once when every target is present', async () => {
  const c = fakeClock();
  assert.deepEqual(await waitForTargets(['a', 'b'], () => true, { sleep: c.sleep }), ['a', 'b']);
  assert.equal(c.sleeps, 0);
});
test('waitForTargets returns the partial list at the timeout', async () => {
  const c = fakeClock();
  const r = await waitForTargets(['a', 'b'], (s) => s === 'a', { sleep: c.sleep, timeoutMs: 2500, intervalMs: 100 });
  assert.deepEqual(r, ['a']);
  assert.equal(c.t, 2500);
});
test('waitForTargets picks up a target that appears after 300 ms', async () => {
  const c = fakeClock();
  const r = await waitForTargets(['a', 'b'], (s) => s === 'a' || c.t >= 300, { sleep: c.sleep, intervalMs: 100 });
  assert.deepEqual(r, ['a', 'b']);
  assert.equal(c.t, 300);
});
test('waitForTargets stops when cancelled', async () => {
  const c = fakeClock();
  let n = 0;
  const r = await waitForTargets(['a'], () => false, { sleep: c.sleep, cancelled: () => ++n > 2 });
  assert.deepEqual(r, []);
  assert.ok(c.t < 2500);
});

import { keyAction } from '../utils/tour.ts';
test('while no step is shown every key is ignored', () => {
  for (const key of ['Escape', 'ArrowRight', 'ArrowLeft', 'Tab', 'Enter', 'a']) assert.equal(keyAction({ key, hasStep: false }), 'ignore', key);
});
test('with a step shown the keys act', () => {
  assert.equal(keyAction({ key: 'Escape', hasStep: true }), 'skip');
  assert.equal(keyAction({ key: 'ArrowRight', hasStep: true }), 'next');
  assert.equal(keyAction({ key: 'ArrowLeft', hasStep: true }), 'back');
  assert.equal(keyAction({ key: 'Tab', hasStep: true }), 'tab');
  assert.equal(keyAction({ key: 'ArrowRight', hasStep: true, typing: true }), 'ignore');
  assert.equal(keyAction({ key: 'ArrowLeft', hasStep: true, modified: true }), 'ignore');
  assert.equal(keyAction({ key: 'x', hasStep: true }), 'ignore');
});
test('step 1 wording matches the Approve button', () => {
  assert.match(TOUR_STEPS[0].body, /Approve it and the posts are made for you\./);
});
