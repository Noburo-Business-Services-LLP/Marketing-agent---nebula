const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const User = require('../models/User');
const { ACCOUNT_KINDS, cleanAccountKind } = require('../services/accountKind');

const base = { name: 'Sample Traders', industry: 'Retail', businessLocation: 'Chennai', heroProduct: 'Silk sarees', targetCustomerProfile: 'Wedding shoppers', marketingGoals: ['More sales'], contentLanguage: 'tamil' };
const bpErrors = (bp) => {
  const err = new User({ name: 'x', email: 'a@b.co', password: 'x', businessProfile: bp }).validateSync();
  return err ? Object.keys(err.errors).filter((k) => k.startsWith('businessProfile')) : [];
};

test('the allowed answers are one and several', () => {
  assert.deepStrictEqual([...ACCOUNT_KINDS], ['one', 'several']);
});

test('the profile accepts one, several and empty; an old profile without it is unaffected', () => {
  for (const v of ['one', 'several', '']) assert.deepStrictEqual(bpErrors({ ...base, accountKind: v }), [], v);
  assert.deepStrictEqual(bpErrors(base), []);
  assert.strictEqual(new User({ name: 'x', email: 'a@b.co', password: 'x', businessProfile: base }).businessProfile.accountKind, '');
});

test('the schema rejects an unknown value', () => {
  assert.ok(bpErrors({ ...base, accountKind: 'agency' }).includes('businessProfile.accountKind'));
});

test('cleanAccountKind keeps the two answers and turns anything else into empty', () => {
  assert.strictEqual(cleanAccountKind({ accountKind: 'several' }).accountKind, 'several');
  assert.strictEqual(cleanAccountKind({ accountKind: 'one' }).accountKind, 'one');
  for (const bad of ['agency', 'SEVERAL', 7, null, {}, ['several'], '$ne']) assert.strictEqual(cleanAccountKind({ accountKind: bad }).accountKind, '', String(bad));
});

test('cleanAccountKind leaves a profile without the field alone and does not change the other fields', () => {
  const p = { name: 'A', industry: 'Retail' };
  const out = cleanAccountKind(p);
  assert.deepStrictEqual(out, p);
  assert.ok(!('accountKind' in out));
  assert.deepStrictEqual(cleanAccountKind({ name: 'A', accountKind: 'several' }), { name: 'A', accountKind: 'several' });
  assert.strictEqual(cleanAccountKind(null), null);
});

test('both save routes clean the answer before saving', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'auth.js'), 'utf8');
  const start = src.indexOf('function withCleanLanguages');
  const fn = src.slice(start, src.indexOf('\n}\n', start));
  assert.match(fn, /cleanAccountKind/);
  assert.match(src, /businessProfile: withCleanLanguages\(businessProfile \|\| \{\}\)/);
  assert.match(src, /updates\.businessProfile = withCleanLanguages\(updates\.businessProfile\)/);
});
