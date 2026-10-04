const test = require('node:test');
const assert = require('node:assert/strict');

const costs = require('../config/apiCosts');
const ent = require('../config/entitlements');

const { PLANS, TOPUP_PACKS, ADDONS, GST_RATE, gstPaise, chargePaise, assertPlanAllowance, RETRY_FACTOR } = costs;

test('plan allowances: starter and professional derive from the existing method', () => {
  assert.equal(RETRY_FACTOR.hero, 1.5);
  assert.deepEqual(PLANS.starter.commits, { image_generated: 30, hero: 1 });
  assert.deepEqual(PLANS.professional.commits, { image_generated: 30, hero: 2, captions: 150 });
  assert.equal(PLANS.starter.inr, 999);
  assert.equal(PLANS.professional.inr, 1999);
  assert.equal(PLANS.starter.expectedQuarks, 1814);
  assert.equal(PLANS.professional.expectedQuarks, 3057);
  assert.equal(PLANS.starter.derivedQuarks, 2100);
  assert.equal(PLANS.professional.derivedQuarks, 3500);
  assert.equal(PLANS.starter.quarks, 2100);
  assert.equal(PLANS.professional.quarks, 3500);
  assert.ok(PLANS.starter.label && PLANS.professional.label);
});

test('managed_10k is unchanged', () => {
  assert.equal(PLANS.managed_10k.quarks, 5000);
  assert.equal(PLANS.managed_10k.inr, 10000);
  assert.ok(PLANS.managed_10k.quarks >= PLANS.managed_10k.expectedQuarks);
});

test('assertPlanAllowance throws when the grant is below expected burn', () => {
  assert.throws(() => assertPlanAllowance({ quarks: 100, expectedQuarks: 101 }), /Raise the grant/);
  assert.doesNotThrow(() => assertPlanAllowance({ quarks: 101, expectedQuarks: 101 }));
});

test('GST maths is exact integer paise', () => {
  assert.equal(GST_RATE, 0.18);
  assert.equal(chargePaise(999), 117882);
  assert.equal(chargePaise(1999), 235882);
  assert.equal(chargePaise(4999), 589882);
  assert.equal(gstPaise(999), 17982);
  assert.ok(Number.isInteger(gstPaise(1234)));
  // 0.5 paisa rounds up: 18% of 25 paise-per-rupee amounts; inr 1.5 -> 150*18/100 = 27 exactly,
  // so craft a half: 0.25 inr -> 25 paise * 18 / 100 = 4.5 -> 5
  assert.equal(gstPaise(0.25), 5);
  assert.equal(gstPaise(0.75), 14); // 13.5 -> 14
});

test('top-up packs', () => {
  assert.deepEqual(TOPUP_PACKS.map(p => [p.inr, p.quarks]), [[999, 500], [1999, 1000], [4999, 2500]]);
});

test('add-ons shape', () => {
  assert.equal(ADDONS.publish.inr, 1000);
  assert.deepEqual(ADDONS.publish.requires, []);
  assert.equal(ADDONS.competitors.inr, 500);
  assert.deepEqual(ADDONS.competitors.requires, []);
  assert.equal(ADDONS.inbox.inr, 500);
  assert.deepEqual(ADDONS.inbox.requires, ['publish']);
  assert.equal(ADDONS.bundle.inr, 1800);
  assert.deepEqual(ADDONS.bundle.includes, ['publish', 'competitors', 'inbox']);
  for (const a of Object.values(ADDONS)) assert.ok(a.label);
});

const U = (tier, addons) => ({ plan: { tier, addons } });

test('resolveTier and addonsOf', () => {
  assert.deepEqual(ent.TIERS, ['free', 'starter', 'professional', 'managed']);
  assert.equal(ent.resolveTier({}), 'managed');
  assert.equal(ent.resolveTier({ plan: {} }), 'managed');
  assert.equal(ent.resolveTier(null), 'managed');
  assert.equal(ent.resolveTier({ plan: { tier: 'free' } }), 'free');
  assert.deepEqual(ent.addonsOf({}), []);
  assert.deepEqual(ent.addonsOf(U('starter', ['publish'])), ['publish']);
});

const OUTSIDE = ['social_connect', 'publish', 'schedule', 'inbox', 'auto_reply', 'competitors'];

test('canUse: free', () => {
  for (const f of ['create', 'video']) assert.equal(ent.canUse(U('free'), f).allowed, true);
  for (const f of OUTSIDE) {
    const r = ent.canUse(U('free'), f);
    assert.deepEqual(r, { allowed: false, reason: 'upgrade', message: 'This is not included in the free plan. Please upgrade your plan, or buy an add-on pack.' });
  }
});

test('canUse: managed and legacy users always allowed', () => {
  for (const f of ent.FEATURES) {
    assert.equal(ent.canUse(U('managed'), f).allowed, true);
    assert.equal(ent.canUse({}, f).allowed, true);
    assert.equal(ent.canUse({}, f).reason, 'ok');
  }
});

test('canUse: starter and professional', () => {
  for (const tier of ['starter', 'professional']) {
    for (const f of ['create', 'video']) assert.equal(ent.canUse(U(tier), f).allowed, true);
    for (const f of OUTSIDE) {
      const r = ent.canUse(U(tier, []), f);
      assert.deepEqual(r, { allowed: false, reason: 'addon', message: 'This needs an add-on. Please add it to your plan or upgrade.' });
    }
    const pub = U(tier, ['publish']);
    for (const f of ['social_connect', 'publish', 'schedule']) assert.equal(ent.canUse(pub, f).allowed, true);
    for (const f of ['inbox', 'auto_reply', 'competitors']) assert.equal(ent.canUse(pub, f).allowed, false);
    // inbox without publish does not unlock
    for (const f of ['inbox', 'auto_reply']) assert.equal(ent.canUse(U(tier, ['inbox']), f).allowed, false);
    for (const f of ['inbox', 'auto_reply']) assert.equal(ent.canUse(U(tier, ['publish', 'inbox']), f).allowed, true);
    assert.equal(ent.canUse(U(tier, ['competitors']), 'competitors').allowed, true);
    assert.equal(ent.canUse(U(tier, ['competitors']), 'publish').allowed, false);
    for (const f of OUTSIDE) assert.equal(ent.canUse(U(tier, ['bundle']), f).allowed, true);
  }
});

test('heroLimitForUser', () => {
  assert.equal(ent.heroLimitForUser(U('managed')), 2);
  assert.equal(ent.heroLimitForUser({}), 2);
  assert.equal(ent.heroLimitForUser(U('professional')), 2);
  assert.equal(ent.heroLimitForUser(U('starter')), 1);
  assert.equal(ent.heroLimitForUser(U('free')), 1);
  assert.equal(ent.heroLimitForUser(U('free'), '5'), 5);
  assert.equal(ent.heroLimitForUser(U('managed'), 7), 7);
  for (const bad of ['0', '-1', 'abc', '', undefined, null, '1.5', '2x']) {
    assert.equal(ent.heroLimitForUser(U('starter'), bad), 1, String(bad));
  }
});
