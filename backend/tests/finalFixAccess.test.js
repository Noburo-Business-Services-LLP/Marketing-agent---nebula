// Final review fixes, part B (access, isolation, deletion). In-memory fakes only: no database, no network.
const test = require('node:test');
const assert = require('node:assert');
const { normalisePath } = require('../services/requestPath');
const { isBlockedWhileActing } = require('../services/csmAccess');
const { isBlockedInsideClient } = require('../services/agencyWorkspaces');
const { isCustomer, openProblem, checkAssignment } = require('../services/staff/clientActions');

// ---- B-I6: one path reading for every check
test('B-I6: normalisePath reads only the route: case, slashes, query, fragment, encoding, absolute URLs', () => {
  assert.strictEqual(normalisePath('/API/PAYMENT/x'), '/api/payment/x');
  assert.strictEqual(normalisePath('//api//payment'), '/api/payment');
  assert.strictEqual(normalisePath('http://x/api/payment/cancel-subscription'), '/api/payment/cancel-subscription');
  assert.strictEqual(normalisePath('https://host:8080/api/payment?x=1#f'), '/api/payment');
  assert.strictEqual(normalisePath('/api/payment%2Fcancel'), '/api/payment/cancel');
  assert.strictEqual(normalisePath('/api/payment/'), '/api/payment');
  assert.strictEqual(normalisePath('/'), '/');
  assert.strictEqual(normalisePath('http://x'), '/');
  assert.strictEqual(normalisePath('/api/%E0%A4%A'), null, 'a broken percent sequence cannot be read');
});

const PAY_VARIANTS = ['/api/payment/cancel-subscription', '/API/PAYMENT/x', '//api//payment', 'http://x/api/payment/cancel-subscription',
  '/api/payment%2Fcancel', '/api/payment/', '/api/payment?x=1', '/api/payment#f', 'https://h/API/Payment/create-order?a=b', '/api/%ZZ'];
test('B-I6: the CSM block and the agency block read every variant the same way', () => {
  for (const u of PAY_VARIANTS) {
    assert.strictEqual(isBlockedWhileActing(u, 'POST'), true, `csm ${u}`);
    assert.strictEqual(isBlockedInsideClient(u, 'POST'), true, `agency ${u}`);
  }
  assert.strictEqual(isBlockedInsideClient('http://x/api/agency/clients/abc/delete', 'DELETE'), true);
  assert.strictEqual(isBlockedInsideClient('http://x/API/agency/clients', 'GET'), false);
  assert.strictEqual(isBlockedWhileActing('/api/campaigns', 'GET'), false);
  assert.strictEqual(isBlockedInsideClient('/api/campaigns', 'GET'), false);
});

// ---- B-I3: staff inside an account cannot act on the customer's privacy choices
test('B-I3: a CSM inside an account is blocked from /api/account except reading its status', () => {
  for (const u of ['/api/account/deletion/restore', '/api/account/deletion/request', '/api/account/consent', '/api/account/export', '/API/ACCOUNT/consent', 'http://x/api/account/consent']) {
    assert.strictEqual(isBlockedWhileActing(u, 'POST'), true, u);
  }
  assert.strictEqual(isBlockedWhileActing('/api/account/status', 'GET'), false);
  assert.strictEqual(isBlockedWhileActing('/api/account/status', 'POST'), true);
});
test('B-I3: an agency pass is also blocked from accepting the Terms for a client', () => {
  assert.strictEqual(isBlockedInsideClient('/api/account/consent', 'POST'), true);
});
test('B-I3: staff cannot open an account with a deletion waiting or one that is switched off', () => {
  assert.match(openProblem({ deletion: { status: 'pending' } }), /deletion/i);
  assert.match(openProblem({ isActive: false }), /switched off/);
  assert.strictEqual(openProblem({ isActive: true, deletion: { status: 'none' } }), null);
  assert.strictEqual(openProblem({}), null);
});

// ---- A-M7 / B-M1: a client workspace is not a customer staff can act on
test('A-M7/B-M1: a workspace is not a customer for staff (no open, no Quarks, no CSM assignment)', () => {
  const ws = { _id: 'w', agency: { ownerId: 'o' } };
  assert.strictEqual(isCustomer(ws), false);
  assert.strictEqual(isCustomer({ _id: 'c', agency: { clientCount: 3 } }), true, 'an agency owner is a customer');
  assert.strictEqual(isCustomer({ _id: 'c' }), true);
  assert.strictEqual(checkAssignment({ csm: null, client: ws }).ok, false);
});
