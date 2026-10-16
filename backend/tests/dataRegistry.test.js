const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { RULES, NOT_CUSTOMER_DATA, ruleFor, filterFor, erasable } = require('../services/dataRegistry');

// Load every model so mongoose knows them all.
const dir = path.join(__dirname, '../models');
for (const f of fs.readdirSync(dir)) { if (f.endsWith('.js')) { try { require(path.join(dir, f)); } catch (_) { /* a model that cannot load here is skipped */ } } }

const refsToUser = (m) => {
  const out = [];
  m.schema.eachPath((p, t) => {
    const o = (t && t.options) || {};
    if (o.ref === 'User' || (t.caster && t.caster.options && t.caster.options.ref === 'User')) out.push(p);
  });
  return out;
};

test('every model that refers to a user is on the data list (so no feature can forget a customer\'s data)', () => {
  const missing = [];
  for (const name of mongoose.modelNames()) {
    if (NOT_CUSTOMER_DATA.includes(name)) continue;
    const m = mongoose.model(name);
    if (refsToUser(m).length && !ruleFor(name)) missing.push(`${name} (${refsToUser(m).join(', ')})`);
  }
  assert.deepStrictEqual(missing, [], `Add these to services/dataRegistry.js: ${missing.join('; ')}`);
});

test('every rule names a real model and a field it really has', () => {
  const bad = [];
  for (const r of RULES) {
    if (!mongoose.modelNames().includes(r.model)) { bad.push(`${r.model}: no such model`); continue; }
    const m = mongoose.model(r.model);
    for (const f of [r.field, ...(r.also || [])]) if (!m.schema.path(f)) bad.push(`${r.model}.${f}: no such field`);
  }
  assert.deepStrictEqual(bad, []);
});

test('rules are unique, use a known action, and the list of models that need no rule is short and deliberate', () => {
  assert.strictEqual(new Set(RULES.map((r) => r.model)).size, RULES.length);
  for (const r of RULES) assert.ok(['delete', 'anonymise', 'retain'].includes(r.action), r.model);
  assert.ok(NOT_CUSTOMER_DATA.length <= 8);
  for (const name of NOT_CUSTOMER_DATA) assert.ok(!ruleFor(name) || name === 'User', name);
});

test('the filter finds a customer by every field that points at them', () => {
  assert.deepStrictEqual(filterFor(ruleFor('Campaign'), 'u1'), { userId: 'u1' });
  assert.deepStrictEqual(filterFor(ruleFor('CsmSession'), 'u1'), { $or: [{ client: 'u1' }, { csm: 'u1' }] });
  assert.ok(erasable().length > 35);
  assert.ok(!erasable().some((r) => r.model === 'ClientInvoice'), 'tax records are not erased');
});
