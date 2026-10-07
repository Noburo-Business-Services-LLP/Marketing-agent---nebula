const test = require('node:test');
const assert = require('node:assert');
const { parseQuarkAmount, checkAssignment } = require('../services/staff/clientActions');

test('Quark grants must be whole numbers within limits', () => {
  assert.deepStrictEqual(parseQuarkAmount('500'), { ok: true, amount: 500 });
  for (const bad of [0, -5, 1.5, 'abc', '', null, undefined, 100001]) assert.strictEqual(parseQuarkAmount(bad).ok, false, String(bad));
  assert.strictEqual(parseQuarkAmount(100000).ok, true);
});

test('only an active CSM can be assigned, and only to a client', () => {
  const client = { _id: 'u1' };
  assert.strictEqual(checkAssignment({ csm: { _id: 'c1', staffRole: 'csm' }, client }).ok, true);
  assert.strictEqual(checkAssignment({ csm: null, client }).ok, true);
  assert.strictEqual(checkAssignment({ csm: { _id: 'a1', staffRole: 'admin' }, client }).ok, false);
  assert.strictEqual(checkAssignment({ csm: { _id: 'c1', staffRole: 'csm', isActive: false }, client }).ok, false);
  assert.strictEqual(checkAssignment({ csm: { _id: 'c1', staffRole: 'csm' }, client: { _id: 's', staffRole: 'csm' } }).ok, false);
});
