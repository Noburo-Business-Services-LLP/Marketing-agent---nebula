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

test('the Ayrshare reset only touches Ayrshare fields and needs RESET typed', () => {
  assert.strictEqual(c.confirmsAyrshareReset('RESET'), true);
  assert.strictEqual(c.confirmsAyrshareReset(' RESET '), true);
  assert.strictEqual(c.confirmsAyrshareReset('reset'), false);
  assert.strictEqual(c.confirmsAyrshareReset(''), false);
  const keys = Object.keys(c.AYRSHARE_RESET.update.$set);
  assert.ok(keys.length > 0 && keys.every((k) => k.startsWith('ayrshare.')));
  assert.strictEqual(c.AYRSHARE_RESET.update.$set['ayrshare.profileKey'], '');
});

test('owners and admins can open any client; a staff account is never opened this way', () => {
  const client = { _id: 'u1', assignedCsm: 'c9' };
  assert.strictEqual(c.canActFor({ _id: 'o1', staffRole: 'owner' }, client), true);
  assert.strictEqual(c.canActFor({ _id: 'a1', staffRole: 'admin' }, client), true);
  assert.strictEqual(c.canActFor({ _id: 'c1', staffRole: 'csm' }, client), false);
  assert.strictEqual(c.canActFor({ _id: 'o1', staffRole: 'owner' }, { _id: 's', staffRole: 'csm' }), false);
  assert.strictEqual(c.canActFor({ _id: 'o1', staffRole: 'owner', isActive: false }, client), false);
});
