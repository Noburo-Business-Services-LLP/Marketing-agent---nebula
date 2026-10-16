const test = require('node:test');
const assert = require('node:assert');
const { _allowedWhileDeleting: allowed } = require('../middleware/auth');

test('an account waiting for deletion can still reach only its own status, restore, me and logout', () => {
  for (const ok of ['/api/account/status', '/api/account/deletion/restore', '/api/auth/me', '/api/auth/logout', '/api/auth/me?x=1', '/API/AUTH/ME', 'http://x/api/account/status']) assert.ok(allowed(ok), ok);
  for (const no of ['/api/campaigns', '/api/auth/login-as', '/api/payment/create-order', '/api/drafts/1', '/api/auth/me/x', '/api/accounts', '/api/%ZZ', 'http://x/api/campaigns']) assert.ok(!allowed(no), no);
});
