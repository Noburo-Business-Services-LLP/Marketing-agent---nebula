// backend/tests/agencyAuth.test.js
const test = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');
const w = require('../services/agencyWorkspaces');

test('the pass names the client and the agency, and lasts 8 hours', () => {
  const t = w.issueAgencyPass({ workspaceId: 'w1', ownerId: 'o1', secret: 's' });
  const d = jwt.verify(t, 's');
  assert.strictEqual(d.id, 'w1');
  assert.strictEqual(d.actingAgency, 'o1');
  assert.ok(d.exp - d.iat === 8 * 3600);
});

test('inside a client: money, passwords, deletion and client management are blocked; the list and switching are not', () => {
  for (const u of ['/api/payment/create-order', '/api/auth/change-password', '/api/account/deletion/request', '/api/account/export']) assert.strictEqual(w.isBlockedInsideClient(u, 'POST'), true, u);
  assert.strictEqual(w.isBlockedInsideClient('/api/agency/clients', 'POST'), true, 'create');
  assert.strictEqual(w.isBlockedInsideClient('/api/agency/clients/w1', 'PATCH'), true, 'rename');
  assert.strictEqual(w.isBlockedInsideClient('/api/agency/clients', 'GET'), false);
  assert.strictEqual(w.isBlockedInsideClient('/api/agency/clients/w2/open', 'POST'), false);
  assert.strictEqual(w.isBlockedInsideClient('/api/campaigns', 'GET'), false);
  assert.strictEqual(w.isBlockedInsideClient('/api/drafts', 'POST'), false);
});

test('blocking cannot be dodged with a query string, upper case or encoding', () => {
  for (const u of ['/api/payment?x=1', '/API/PAYMENT/create-order', '/api/Auth/Change-Password', '/api/%70ayment/create', '/api/agency/clients?x=/open', '/api/agency/clients/w1/open/extra', '/api/agency/anything']) {
    assert.strictEqual(w.isBlockedInsideClient(u, 'POST'), true, u);
  }
  assert.strictEqual(w.isBlockedInsideClient('/api/agency/clients/w2/open?x=1', 'POST'), false);
  assert.strictEqual(w.isBlockedInsideClient('/api/agency/clients', 'get'), false);
  assert.strictEqual(w.isBlockedInsideClient('/api/agency/clients/', 'PATCH'), true);
});

test('protect: the pass is accepted only while the agency is active, on the agency plan, and owns the client', () => {
  const check = require('../middleware/auth')._agencyPassProblem; // exported for this test
  const ok = { owner: { _id: 'o1', isActive: true, plan: { tier: 'agency' } }, workspace: { _id: 'w1', agency: { ownerId: 'o1' } } };
  assert.strictEqual(check(ok.owner, ok.workspace), '');
  assert.match(check(null, ok.workspace), /ended/);
  assert.match(check({ ...ok.owner, isActive: false }, ok.workspace), /ended/);
  assert.match(check({ ...ok.owner, plan: { tier: 'professional' } }, ok.workspace), /plan/);
  assert.match(check(ok.owner, { _id: 'w1', agency: { ownerId: 'someone-else' } }), /ended/);
  assert.match(check(ok.owner, { _id: 'w1', agency: { ownerId: 'o1', frozen: true } }), /over/);
});

test('protect: an ordinary account, or one with no owner on the workspace, cannot ride an agency pass', () => {
  const check = require('../middleware/auth')._agencyPassProblem;
  const owner = { _id: 'o1', isActive: true, plan: { tier: 'agency' } };
  assert.match(check(owner, { _id: 'u9' }), /ended/);
  assert.match(check(owner, { _id: 'u9', agency: {} }), /ended/);
  assert.match(check(owner, null), /ended/);
  assert.match(check(owner, { _id: 'o1', agency: { ownerId: 'o1x' } }), /ended/);
});

test('wording: no exclamation marks, em dashes or the word credit in the messages', () => {
  const src = require('fs').readFileSync(require.resolve('../middleware/auth'), 'utf8') + require('fs').readFileSync(require.resolve('../routes/agency'), 'utf8');
  const msgs = src.match(/message: '[^']*'/g) || [];
  for (const m of msgs) assert.doesNotMatch(m, /[!—]|credit|trial/i, m);
});
