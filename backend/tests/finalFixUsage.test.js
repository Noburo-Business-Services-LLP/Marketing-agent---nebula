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
