const test = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');
const c = require('../services/csmAccess');

test('a CSM can act only for clients assigned to them', () => {
  const csm = { _id: 'c1', isCsm: true };
  assert.strictEqual(c.canActFor(csm, { assignedCsm: 'c1' }), true);
  assert.strictEqual(c.canActFor(csm, { assignedCsm: { _id: 'c1' } }), true);
  assert.strictEqual(c.canActFor(csm, { assignedCsm: 'c2' }), false);
  assert.strictEqual(c.canActFor(csm, { assignedCsm: null }), false);
  assert.strictEqual(c.canActFor({ _id: 'c1', isCsm: false }, { assignedCsm: 'c1' }), false);
  assert.strictEqual(c.canActFor({ _id: 'c1', isCsm: true, isActive: false }, { assignedCsm: 'c1' }), false);
});

test('payments, password, account deletion and the CSM area are blocked while acting', () => {
  for (const u of ['/api/payment/create-order', '/api/payment', '/api/auth/change-password', '/api/csm/clients', '/api/auth/delete-account?x=1'])
    assert.strictEqual(c.isBlockedWhileActing(u), true, u);
  for (const u of ['/api/campaigns', '/api/drafts/1', '/api/social/inbox/reviews', '/api/paymentsummary-nope'.replace('summary-nope', 's')])
    assert.strictEqual(c.isBlockedWhileActing(u), u === '/api/payments' ? false : false, u);
});

test('the acting token names the client and the CSM and expires', () => {
  const t = c.issueActingToken({ clientId: 'u9', csmId: 'c1', secret: 's' });
  const d = jwt.verify(t, 's');
  assert.strictEqual(d.id, 'u9');
  assert.strictEqual(d.actingCsm, 'c1');
  assert.ok(d.exp - d.iat <= 8 * 3600);
});

test('reset needs a CSM account and the exact email typed', () => {
  assert.strictEqual(c.canResetStaffAccount({ isCsm: false, email: 'a@x.com' }, 'a@x.com').ok, false);
  assert.strictEqual(c.canResetStaffAccount({ isCsm: true, email: 'a@x.com' }, 'b@x.com').ok, false);
  assert.strictEqual(c.canResetStaffAccount({ isCsm: true, email: 'a@x.com' }, '').ok, false);
  assert.strictEqual(c.canResetStaffAccount({ isCsm: true, email: 'A@x.com' }, ' a@X.com ').ok, true);
  assert.strictEqual(c.canResetStaffAccount(null, 'a@x.com').ok, false);
});
