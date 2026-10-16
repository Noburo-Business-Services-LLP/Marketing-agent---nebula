const test = require('node:test');
const assert = require('node:assert');
const { PLANS, AGENCY, QUARK_COSTS } = require('../config/apiCosts');
const { resolveTier, addonsOf, canUse } = require('../config/entitlements');
const bp = require('../services/billingPlans');

test('the agency plan is Rs 6,999 for 6,000 shared Quarks and the numbers come from config', () => {
  assert.strictEqual(PLANS.agency.inr, 6999);
  assert.strictEqual(PLANS.agency.quarks, 6000);
  assert.deepStrictEqual(AGENCY, { includedClients: 5, maxClients: 25, slot: { inr: 1499, quarks: 500 } });
});

test('the allowance guard passes: the pool covers the expected burn', () => {
  assert.ok(PLANS.agency.quarks >= PLANS.agency.expectedQuarks);
  assert.ok(QUARK_COSTS.image_generated > 0);
});

test('an agency account may use everything an add-on would unlock, with nothing to buy', () => {
  const u = { plan: { tier: 'agency', addons: [] }, onboardingCompleted: true };
  assert.strictEqual(resolveTier(u), 'agency');
  assert.deepStrictEqual(addonsOf(u), ['bundle']);
  for (const f of ['create', 'video', 'publish', 'schedule', 'social_connect', 'inbox', 'auto_reply', 'competitors']) assert.strictEqual(canUse(u, f).allowed, true, f);
  assert.strictEqual(bp.canBuyAddon(u, 'publish').ok, false);
  assert.match(bp.canBuyAddon(u, 'publish').message, /included/);
});

test('the catalogue lists the agency plan and its client rules', () => {
  const c = bp.planCatalogue();
  assert.ok(c.plans.some((p) => p.id === 'agency' && p.name === 'Agency'));
  assert.deepStrictEqual(c.agency, { includedClients: 5, maxClients: 25, slotInr: 1499, slotQuarks: 500 });
});

test('the Blueprint schema accepts the agency tier', () => {
  const Blueprint = require('../models/Blueprint');
  const mongoose = require('mongoose');
  const err = new Blueprint({ blueprintId: 'b1', userId: new mongoose.Types.ObjectId(), emailKey: 'a@b.c', tierAtStart: 'agency' }).validateSync();
  assert.ok(!err || !err.errors.tierAtStart);
});
