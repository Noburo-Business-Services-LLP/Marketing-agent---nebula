const test = require('node:test');
const assert = require('node:assert');
const r = require('../services/plan/planRules');
const DAY = 86400000;
const NOW = new Date('2026-10-17T06:00:00Z');
const ok = (extra = {}) => ({ isActive: true, onboardingCompleted: true, plan: { tier: 'starter' }, staffRole: null, isCsm: false, businessProfile: { name: 'Sweet Co', website: 'sweetco.in', description: 'Custom cakes baked to order', targetAudience: 'Families' }, ...extra });

test('who should have a plan: paying and managed accounts with a complete profile, never staff, free or deleting accounts', () => {
  assert.strictEqual(r.shouldHavePlan(ok()), true);
  assert.strictEqual(r.shouldHavePlan(ok({ plan: { tier: 'managed' } })), true);
  assert.strictEqual(r.shouldHavePlan(ok({ plan: {} })), true, 'legacy accounts without a tier are managed');
  assert.strictEqual(r.shouldHavePlan(ok({ plan: { tier: 'free' } })), false);
  assert.strictEqual(r.shouldHavePlan(ok({ staffRole: 'csm' })), false);
  assert.strictEqual(r.shouldHavePlan(ok({ isCsm: true })), false);
  assert.strictEqual(r.shouldHavePlan(ok({ deletion: { status: 'pending' } })), false);
  assert.strictEqual(r.shouldHavePlan(ok({ onboardingCompleted: false })), false);
  assert.strictEqual(r.shouldHavePlan(ok({ isActive: false })), false);
  assert.strictEqual(r.shouldHavePlan(ok({ businessProfile: { name: 'x' } })), false);
});

test('the weekly refresh rule, and staff are never limited', () => {
  assert.strictEqual(r.canRefresh({ user: ok(), now: NOW }).ok, true);
  const recent = ok({ planState: { lastRefreshAt: new Date(NOW - 2 * DAY) } });
  const c = r.canRefresh({ user: recent, now: NOW });
  assert.strictEqual(c.ok, false);
  assert.strictEqual(+c.nextAt, +new Date(NOW - 2 * DAY + 7 * DAY));
  assert.match(c.message, /once a week/);
  assert.strictEqual(r.canRefresh({ user: recent, now: NOW, staff: true }).ok, true);
  assert.strictEqual(r.canRefresh({ user: ok({ planState: { lastRefreshAt: new Date(NOW - 8 * DAY) } }), now: NOW }).ok, true);
});

test('monthly due and stale', () => {
  assert.strictEqual(r.monthlyDue({ user: ok(), lastPlanAt: null, now: NOW }), true);
  assert.strictEqual(r.monthlyDue({ user: ok(), lastPlanAt: new Date(NOW - 29 * DAY), now: NOW }), false);
  assert.strictEqual(r.monthlyDue({ user: ok(), lastPlanAt: new Date(NOW - 31 * DAY), now: NOW }), true);
  assert.strictEqual(r.isStale({ completedAt: new Date(NOW - 46 * DAY) }, NOW), true);
  assert.strictEqual(r.isStale({ completedAt: new Date(NOW - 10 * DAY) }, NOW), false);
  assert.strictEqual(r.isStale(null, NOW), false);
});
