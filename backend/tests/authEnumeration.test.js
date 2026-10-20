'use strict';
// B3: the code and reset routes answer the SAME status and body for an email with an account and one without, so
// nobody can find out who has an account by asking. HTTP-level (real router, in-memory users, mailer stubbed).
const test = require('node:test');
const assert = require('node:assert');
const { createAuthHarness } = require('./helpers/authHttp');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-auth-enumeration-0123456789';
const SENT = 'If an account exists, we have sent a code.';

let h; let base;
test.before(async () => {
  h = createAuthHarness();
  await h.addUser({ email: 'known@example.test', password: 'Known-pass-2468', isVerified: true });
  await h.addUser({ email: 'fresh@example.test', password: 'Fresh-pass-2468', isVerified: false });
  base = await h.start();
});
test.after(async () => { await h.restore(); });

const strip = (r) => ({ status: r.status, body: r.body });
const settle = () => new Promise((r) => setTimeout(r, 30)); // the code is stored and sent after the answer

for (const route of ['/send-otp', '/forgot-password']) {
  test(`${route}: identical answer for an account, an unverified account and no account`, async () => {
    const known = await h.call(base, `/api/auth${route}`, { body: { email: 'known@example.test' } });
    const fresh = await h.call(base, `/api/auth${route}`, { body: { email: 'fresh@example.test' } });
    const nobody = await h.call(base, `/api/auth${route}`, { body: { email: 'nobody@example.test' } });
    assert.deepStrictEqual(strip(known), { status: 200, body: { success: true, message: SENT } });
    assert.deepStrictEqual(strip(fresh), strip(known));
    assert.deepStrictEqual(strip(nobody), strip(known));
    // Asking again at once (inside the 60 s gap) is also the same answer: no 429 that only a real account would get.
    const again = await h.call(base, `/api/auth${route}`, { body: { email: 'fresh@example.test' } });
    assert.deepStrictEqual(strip(again), strip(known));
    await settle();
  });
}

test('codes are really sent only where they should be: send-otp to the unverified account, forgot-password to accounts', async () => {
  const to = h.sent.map((s) => s.email);
  assert.ok(to.includes('fresh@example.test'));
  assert.ok(!to.includes('nobody@example.test'));
  assert.strictEqual(to.filter((e) => e === 'known@example.test').length, 1, 'forgot-password only (it is already verified)');
  assert.strictEqual(to.filter((e) => e === 'fresh@example.test').length, 1, 'every later ask inside 60 s (either route) sends nothing');
});

for (const route of ['/verify-otp', '/verify-reset-otp']) {
  test(`${route}: a wrong code, no code and no account give the same answer`, async () => {
    const known = await h.call(base, `/api/auth${route}`, { body: { email: 'fresh@example.test', otp: '000001' } });
    const nobody = await h.call(base, `/api/auth${route}`, { body: { email: 'nobody@example.test', otp: '000001' } });
    const verified = await h.call(base, `/api/auth${route}`, { body: { email: 'known@example.test', otp: '000001' } });
    assert.strictEqual(known.status, 400);
    assert.deepStrictEqual(strip(nobody), strip(known));
    if (route === '/verify-otp') assert.deepStrictEqual(strip(verified), strip(known), 'an already verified account is not told apart');
    assert.ok(!('attemptsRemaining' in known.body), 'no attempts count (only a real account would have one)');
  });
}

test('reset-password: no account and a wrong code give the same answer', async () => {
  const known = await h.call(base, '/api/auth/reset-password', { body: { email: 'known@example.test', otp: '000001', newPassword: 'Brand-new-pass-97' } });
  const nobody = await h.call(base, '/api/auth/reset-password', { body: { email: 'nobody@example.test', otp: '000001', newPassword: 'Brand-new-pass-97' } });
  assert.strictEqual(known.status, 400);
  assert.deepStrictEqual(strip(nobody), strip(known));
});

test('the right code still works: verify-otp signs the unverified account in', async () => {
  const code = [...h.sent].reverse().find((s) => s.email === 'fresh@example.test').otp;
  const r = await h.call(base, '/api/auth/verify-otp', { body: { email: 'fresh@example.test', otp: code } });
  assert.strictEqual(r.status, 200);
  assert.ok(r.body.token);
});

test('login: an unknown email and a wrong password get the same 401, never 423, and the deactivated note needs the password', async () => {
  const wrong = await h.call(base, '/api/auth/login', { body: { email: 'known@example.test', password: 'not-it-12345' }, ip: '203.0.113.9' });
  const nobody = await h.call(base, '/api/auth/login', { body: { email: 'nobody@example.test', password: 'not-it-12345' }, ip: '203.0.113.9' });
  assert.strictEqual(wrong.status, 401);
  assert.deepStrictEqual(strip(nobody), strip(wrong));
  await h.addUser({ email: 'off@example.test', password: 'Off-pass-24680', isActive: false });
  const offWrong = await h.call(base, '/api/auth/login', { body: { email: 'off@example.test', password: 'not-it-12345' }, ip: '203.0.113.9' });
  assert.deepStrictEqual(strip(offWrong), strip(wrong), 'a deactivated account looks like any other to someone without its password');
  for (let i = 0; i < 6; i += 1) {
    const r = await h.call(base, '/api/auth/login', { body: { email: 'nobody2@example.test', password: 'not-it-12345' }, ip: '203.0.113.10' });
    assert.notStrictEqual(r.status, 423);
  }
});

test('timing: a code is hashed for an unknown email too (the same work as for a real account)', async () => {
  const otpService = require('../services/otpService');
  const orig = otpService.hashOTP;
  let n = 0;
  otpService.hashOTP = function counted(...a) { n += 1; return orig.apply(this, a); };
  try {
    await h.call(base, '/api/auth/forgot-password', { body: { email: 'ghost@example.test' } });
    await h.call(base, '/api/auth/send-otp', { body: { email: 'ghost@example.test' } });
  } finally { otpService.hashOTP = orig; }
  assert.strictEqual(n, 2);
});
