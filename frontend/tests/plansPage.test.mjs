import test from 'node:test';
import assert from 'node:assert/strict';
import {
  orderedPlans, leftText, topupLine, plainMessage, planLines, currentPlanLine, addonBlurb, PLANS_INTRO, renewalText,
} from '../utils/plans.ts';

const costs = { image_generated: 11, studio_video: 161 };

test('plan cards are always Starter, Growth, Agency, whatever order the server sends', () => {
  const p = (id) => ({ id });
  assert.deepEqual(orderedPlans([p('agency'), p('starter'), p('professional')]).map((x) => x.id), ['starter', 'professional', 'agency']);
  assert.deepEqual(orderedPlans([p('professional'), p('agency'), p('starter')]).map((x) => x.id), ['starter', 'professional', 'agency']);
  assert.deepEqual(orderedPlans([p('agency')]).map((x) => x.id), ['agency']);
  assert.deepEqual(orderedPlans(undefined), []);
  // an unknown plan goes last rather than being dropped
  assert.deepEqual(orderedPlans([p('zzz'), p('starter')]).map((x) => x.id), ['starter', 'zzz']);
});

test('what is left is shown in posts and videos, never Quarks', () => {
  assert.equal(leftText(4200, costs), 'About 381 posts or 26 short videos left, in any mix.');
  assert.equal(leftText(11, costs), 'About 1 post left.');
  assert.equal(leftText(0, costs), 'No posts or videos left. Add more below.');
  assert.equal(leftText(4200, {}), '');
  assert.equal(leftText(null, costs), '');
  assert.equal(leftText(200, costs), 'About 18 posts or 1 short video left, in any mix.');
  for (const n of [0, 5, 4200]) assert.doesNotMatch(leftText(n, costs), /quark|credit/i);
});

test('a top-up pack says the posts and videos it adds', () => {
  assert.equal(topupLine({ posts: 21, videos: 1 }), 'About 21 posts or 1 short video');
  assert.equal(topupLine({ posts: 432, videos: 29 }), 'About 432 posts or 29 short videos');
  assert.equal(topupLine(null), '');
  assert.equal(topupLine({ posts: 0, videos: 0 }), '');
});

test('server messages that mention Quarks are replaced by a plain one', () => {
  assert.equal(plainMessage('500 Quarks added to your account.', 'Your payment is confirmed.'), 'Your payment is confirmed.');
  assert.equal(plainMessage('Please choose one of the Quark packs.', 'Please choose a pack.'), 'Please choose a pack.');
  assert.equal(plainMessage('Your card was declined.', 'x'), 'Your card was declined.');
  assert.equal(plainMessage(undefined, 'fallback'), 'fallback');
  assert.equal(plainMessage('  ', 'fallback'), 'fallback');
});

test('the first two feature lines join into one readable line', () => {
  assert.deepEqual(
    planLines(['Up to 54 posts a month, or', 'up to 3 short videos with voice and music', 'Spend it on posts or videos, in any mix', 'Top up any time']),
    ['Up to 54 posts a month, or up to 3 short videos with voice and music', 'Spend it on posts or videos, in any mix', 'Top up any time'],
  );
  assert.deepEqual(planLines(['A', 'B']), ['A', 'B']);
  assert.deepEqual(planLines(undefined), []);
});

test('the current plan line names the plan, what is left and the renewal date', () => {
  assert.equal(currentPlanLine({ tier: 'starter', left: 'About 10 posts left.', renews: '12 November 2026' }), 'Your plan: Starter. About 10 posts left. Renews on 12 November 2026.');
  assert.equal(currentPlanLine({ tier: 'professional', left: '', renews: '1 December 2026', ending: true }), 'Your plan: Growth. Ends on 1 December 2026.');
  assert.equal(currentPlanLine({ tier: 'free', left: '', renews: '' }), 'You do not have a plan yet.');
  assert.equal(currentPlanLine({ tier: 'managed', left: 'About 10 posts left.', renews: '' }), 'Your plan: Managed. About 10 posts left.');
  assert.equal(currentPlanLine({ tier: 'professional', left: '', renews: '' }), 'Your plan: Growth.');
});

test('renewal date reads in plain words and ignores bad dates', () => {
  assert.equal(renewalText('2026-11-12T10:00:00.000Z'), '12 November 2026');
  assert.equal(renewalText('nonsense'), '');
  assert.equal(renewalText(null), '');
});

test('add-on sentences are plain and honest about automatic replies', () => {
  for (const id of ['publish', 'competitors', 'inbox', 'bundle']) assert.ok(addonBlurb(id).length > 10, id);
  assert.match(addonBlurb('inbox'), /drafted for you to approve/);
  assert.match(addonBlurb('inbox'), /only when you switch (them|it) on/);
  assert.equal(addonBlurb('nope'), '');
});

test('the intro sentence is the agreed one', () => {
  assert.equal(PLANS_INTRO, 'Choose a monthly plan, add the features you need, or add more posts and videos at any time. Prices are shown before GST; 18 percent GST is added at checkout.');
});

test('the page keeps the three cards in a fixed order and prints the helpers', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../pages/TrialExpired.tsx', import.meta.url), 'utf8');
  assert.match(src, /orderedPlans\(catalogue\.plans\)/);
  assert.match(src, /<h1[^>]*>Plans<\/h1>/);
  assert.doesNotMatch(src, /Plans and Quarks|Extra Quarks|Quarks remaining/);
});
