const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const src = fs.readFileSync(require.resolve('../middleware/auth'), 'utf8');
const m = src.match(/!\/(\^\\\/api[^\n]*?)\/\.test\(/);

test('an account waiting for deletion can still reach only its own status, restore, me and logout', () => {
  assert.ok(m, 'allow-list pattern found');
  const re = new RegExp(m[1]);
  for (const ok of ['/api/account/status', '/api/account/deletion/restore', '/api/auth/me', '/api/auth/logout']) assert.ok(re.test(ok), ok);
  for (const no of ['/api/campaigns', '/api/auth/login-as', '/api/payment/create-order', '/api/drafts/1']) assert.ok(!re.test(no), no);
});
