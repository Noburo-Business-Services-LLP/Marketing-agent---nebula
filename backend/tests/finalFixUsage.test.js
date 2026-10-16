const test = require('node:test');
const assert = require('node:assert');
const { buildUsage } = require('../services/staff/usage');
const { heroLimitForUser } = require('../config/entitlements');

test('A-I1: staff usage does not throw for an Agency account and lists the tier', () => {
  const u = buildUsage({ users: [{ _id: 'a', createdAt: new Date(), plan: { tier: 'agency' } }], usage: { images: [], postsDrafted: [], postsPublished: [], videos: [], heroVideos: [], blueprints: [], repliesDrafted: [] }, now: Date.now() });
  const t = u.topByTier.tiers.find((x) => x.id === 'agency');
  assert.ok(t); assert.strictEqual(t.clients, 1);
});

test('A-M9: agency has an explicit hero limit', () => {
  assert.strictEqual(heroLimitForUser({ plan: { tier: 'agency' } }), Infinity);
});

test('A-M8: staff MRR counts each active extra client slot of an Agency account', () => {
  const { buildRecurring } = require('../services/staff/recurring');
  const { PLANS, AGENCY } = require('../config/apiCosts');
  const u = { _id: 'a', plan: { tier: 'agency', subscriptions: [
    { kind: 'plan', key: 'agency', active: true }, { kind: 'slot', key: 'client', active: true }, { kind: 'slot', key: 'client', active: true }, { kind: 'slot', key: 'client', active: false }
  ] }, subscription: { status: 'active' } };
  const r = buildRecurring({ users: [u], now: Date.now() });
  assert.strictEqual(r.now.onlineMrrPaise, (PLANS.agency.inr + 2 * AGENCY.slot.inr) * 100);
});
