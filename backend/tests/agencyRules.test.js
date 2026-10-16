// backend/tests/agencyRules.test.js
const test = require('node:test');
const assert = require('node:assert');
const a = require('../services/agency');
const { AGENCY } = require('../config/apiCosts');

const owner = (extra = 0, tier = 'agency') => ({ _id: 'o1', plan: { tier }, agency: { extraSlots: extra, clientCount: 0 } });

test('limit: 5 included, plus paid slots, never above 25, zero for other plans', () => {
  assert.strictEqual(a.clientLimitOf(owner(0)), AGENCY.includedClients);
  assert.strictEqual(a.clientLimitOf(owner(3)), AGENCY.includedClients + 3);
  assert.strictEqual(a.clientLimitOf(owner(99)), AGENCY.maxClients);
  assert.strictEqual(a.clientLimitOf(owner(0, 'professional')), 0);
  assert.strictEqual(a.clientLimitOf(null), 0);
});

test('payer: a workspace is paid by its agency, anyone else by themselves', () => {
  assert.strictEqual(a.payerIdOf({ _id: 'w1', agency: { ownerId: 'o1' } }), 'o1');
  assert.strictEqual(a.payerIdOf({ _id: 'u1' }), 'u1');
  assert.strictEqual(a.isWorkspace({ agency: { ownerId: 'o1' } }), true);
  assert.strictEqual(a.isWorkspace({ agency: {} }), false);
  assert.strictEqual(a.isAgency(owner()), true);
});

test('the plan mirrored onto a workspace is the agency plan, or free when the agency has none', () => {
  assert.deepStrictEqual(a.workspacePlanFields(owner()), { 'plan.tier': 'agency', 'plan.addons': [] });
  assert.deepStrictEqual(a.workspacePlanFields({ _id: 'o1', plan: { tier: 'free' } }), { 'plan.tier': 'free', 'plan.addons': [] });
  assert.deepStrictEqual(a.workspacePlanFields(null), { 'plan.tier': 'free', 'plan.addons': [] });
});

test('placeholder email is valid-looking and cannot receive mail', () => {
  assert.match(a.placeholderEmail('abc123'), /^ws-abc123@workspace\.invalid$/);
});

test('wallet: the balance of the payer, 0 when the payer is missing', async () => {
  const User = { findById: (id) => ({ select: () => ({ lean: async () => ({ o1: { credits: { balance: 42 } }, w1: { agency: { ownerId: 'o1' } }, gone: { agency: { ownerId: 'none' } } })[id] || null }) }) };
  assert.strictEqual(await a.walletBalance('w1', { User }), 42);
  assert.strictEqual(await a.walletBalance('o1', { User }), 42);
  assert.strictEqual(await a.walletBalance('gone', { User }), 0);
});
