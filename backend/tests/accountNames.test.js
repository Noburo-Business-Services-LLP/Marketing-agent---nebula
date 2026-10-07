const test = require('node:test');
const assert = require('node:assert');
const { applyNameSync } = require('../services/accountNames');

test('saving a business name also updates the sign-up company name', () => {
  assert.strictEqual(applyNameSync({ businessProfile: { name: '  Nebulaa  ' } }).companyName, 'Nebulaa');
});

test('an empty or missing business name leaves the company name alone', () => {
  assert.strictEqual('companyName' in applyNameSync({ businessProfile: { name: '' } }), false);
  assert.strictEqual('companyName' in applyNameSync({ firstName: 'D' }), false);
  assert.strictEqual('companyName' in applyNameSync({ businessProfile: null }), false);
});

test('a very long name is cut to the 100 characters the account allows', () => {
  assert.strictEqual(applyNameSync({ businessProfile: { name: 'x'.repeat(300) } }).companyName.length, 100);
});
