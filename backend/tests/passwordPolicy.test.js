'use strict';
// B10: new passwords are at least 10 characters with a letter and a number, and not a very common one. Applies to
// sign-up, change-password and reset only: an existing account signs in with whatever it has.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { checkPassword, commonPasswords, MIN_LENGTH } = require('../utils/passwordPolicy');
const { createAuthHarness } = require('./helpers/authHttp');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-password-policy-0123456789';

test('the deny list has at least 200 entries, is loaded once into a Set, and is compared without case', () => {
  const set = commonPasswords();
  assert.ok(set instanceof Set);
  assert.ok(set.size >= 200, String(set.size));
  assert.strictEqual(commonPasswords(), set, 'loaded once');
  for (const p of ['password', '12345678', 'qwerty123', 'iloveyou']) assert.ok(set.has(p), p);
  assert.ok(!set.has('# very common passwords refused for new passwords (sign-up, change, reset). one per line, compared without case.'));
});

test('rules: 10 characters, a letter, a number, not common, not the email name', () => {
  assert.strictEqual(MIN_LENGTH, 10);
  assert.match(checkPassword('Short1a'), /at least 10 characters/);
  assert.match(checkPassword('onlyletterslong'), /number/);
  assert.match(checkPassword('1234567890123'), /letter/);
  assert.match(checkPassword('Password123'), /too common/);
  assert.match(checkPassword('QWERTYUIOP1'), /too common/);
  assert.match(checkPassword('asha.kumar1', { email: 'asha.kumar1@example.test' }), /email/);
  assert.match(checkPassword(12345), /at least 10/);
  assert.strictEqual(checkPassword('Plum-river-42'), '');
  assert.strictEqual(checkPassword('blue lantern 7 sky'), '', 'spaces are fine');
});

let h; let base; let token;
test.before(async () => {
  h = createAuthHarness();
  const u = await h.addUser({ email: 'old@example.test', password: 'oldpass12' }); // 9 characters, set before the policy
  token = require('../middleware/auth').generateToken(u._id, 0);
  base = await h.start();
});
test.after(async () => { await h.restore(); });

test('HTTP: an existing account with a short old password still signs in', async () => {
  const r = await h.call(base, '/api/auth/login', { body: { email: 'old@example.test', password: 'oldpass12' }, ip: '192.0.2.40' });
  assert.strictEqual(r.status, 200);
});

test('HTTP: change-password and reset-password refuse a weak new password with a friendly message', async () => {
  const weak = await h.call(base, '/api/auth/change-password', { method: 'PUT', token, body: { currentPassword: 'oldpass12', newPassword: 'password123' } });
  assert.strictEqual(weak.status, 400);
  assert.match(weak.body.message, /too common/);
  const short = await h.call(base, '/api/auth/reset-password', { body: { email: 'old@example.test', otp: '123456', newPassword: 'abc12' } });
  assert.strictEqual(short.status, 400);
  assert.match(short.body.message, /at least 10 characters/);
  const ok = await h.call(base, '/api/auth/change-password', { method: 'PUT', token, body: { currentPassword: 'oldpass12', newPassword: 'Plum-river-42' } });
  assert.strictEqual(ok.status, 200);
});

test('sign-up uses the same policy (source check: the route runs signupGuard and a bot check first)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../routes/auth.js'), 'utf8');
  const signup = src.slice(src.indexOf("router.post('/signup'"), src.indexOf("router.post('/send-otp'"));
  assert.match(signup, /body\('password'\)\s*\.custom\(passwordRule\)/);
  assert.ok(!/isLength\(\{ min: 8 \}\)/.test(src), 'no 8-character rule left in the auth routes');
});
