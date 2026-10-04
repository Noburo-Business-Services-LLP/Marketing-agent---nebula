'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { QUARK_COSTS, ACTION_USD, ACTION_UNITS, USD_PER_QUARK } = require('../config/apiCosts');
const { canUse, FEATURES } = require('../config/entitlements');
const cfg = require('../config/blueprint');

test('blueprint cost is derived, small, and shared with the trial guard', () => {
  assert.equal(QUARK_COSTS.blueprint, Math.max(1, Math.round((ACTION_USD.blueprint * 2.5) / USD_PER_QUARK)));
  assert.ok(QUARK_COSTS.blueprint >= 1 && QUARK_COSTS.blueprint <= 10);
  assert.equal(ACTION_UNITS.blueprint, 'per blueprint');
  assert.equal(require('../middleware/trialGuard').CREDIT_COSTS.blueprint, QUARK_COSTS.blueprint);
});

test('blueprint is allowed on every tier while free is still blocked from publish', () => {
  assert.ok(FEATURES.includes('blueprint'));
  for (const user of [{ plan: { tier: 'free' } }, { plan: { tier: 'starter' } }, { plan: { tier: 'professional' } }, { plan: { tier: 'managed' } }, {}]) {
    const r = canUse(user, 'blueprint');
    assert.equal(r.allowed, true);
    assert.equal(r.reason, 'ok');
  }
  const blocked = canUse({ plan: { tier: 'free' } }, 'publish');
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, 'upgrade');
});

test('config/blueprint invariants', () => {
  assert.deepEqual(cfg.PAGES.map((p) => p.id), ['where-today', 'audience-positioning', 'competitor-read', 'content-pillars', 'calendar-preview', 'offers-hooks', 'channel-plan', 'roadmap-90', 'first-steps']);
  assert.equal(cfg.PAGES.length, 9);
  assert.equal(cfg.PHASES.length, 3);
  assert.deepEqual(Object.keys(cfg.STOP_MESSAGES).sort(), ['thin', 'unreachable']);
  assert.ok(cfg.WARNING_MESSAGES.identity_mismatch);
  for (const m of [...Object.values(cfg.STOP_MESSAGES), ...Object.values(cfg.WARNING_MESSAGES)]) {
    assert.ok(m.endsWith('.'));
    assert.ok(!/!|credit|trial/i.test(m));
  }
  assert.equal(cfg.NEBULAA.email, 'support@nebulaa.ai');
  assert.equal(cfg.NEBULAA.phone, '+91 9384801049');
});

test('Blueprint model has the atomic one-free rules and opens no connection', () => {
  const Blueprint = require('../models/Blueprint');
  const idx = Blueprint.schema.indexes();
  for (const key of ['emailKey', 'businessKeys']) {
    const hit = idx.find(([f, o]) => Object.keys(f).length === 1 && f[key] === 1 && o.unique === true);
    assert.ok(hit, key);
    assert.equal(hit[1].unique, true);
    assert.deepEqual(hit[1].partialFilterExpression, { freeSlot: true });
  }
  assert.deepEqual(Blueprint.schema.path('charge.state').enumValues, ['none', 'pending', 'charged', 'refunded']);
  assert.equal(Blueprint.collection.name, 'blueprints');
});
