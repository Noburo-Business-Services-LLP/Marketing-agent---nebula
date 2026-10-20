'use strict';
// B4: a lockout keyed on email + source address with an escalating wait, and a per-account ceiling that emails the
// owner without locking them out of places they used before. Unit tests with a fake clock and the in-memory store,
// then HTTP-level through the real login route.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const lg = require('../services/loginGuard');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-login-guard-0123456789';

function rig(env = {}) {
  let t = 1_000_000_000_000;
  const alerts = [];
  const store = lg.createMemoryStore();
  const guard = lg.createLoginGuard({ store, now: () => t, config: () => lg.settings(env), sendAlert: async (user, fails) => { alerts.push({ to: user.email, fails }); }, log: { warn() {}, error() {} } });
  return { guard, store, alerts, tick: (ms) => { t += ms; }, now: () => t };
}

test('the wait grows 1, 2, 4, 8 s and is capped at 30 s', () => {
  const s = lg.settings({});
  assert.deepStrictEqual([1, 2, 3, 4, 5, 6, 7].map((k) => lg.delayFor(k, s)), [1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  assert.strictEqual(lg.delayFor(0, s), 0);
  assert.strictEqual(lg.delayFor(3, lg.settings({ LOGIN_DELAY_BASE_MS: '0' })), 0);
});

test('a try inside the wait is refused (and not counted); after 5 wrong passwords that address is locked for that email only', async () => {
  const r = rig();
  const a = { email: 'owner@example.test', ip: '198.51.100.7' };
  await r.guard.fail(a);
  const early = await r.guard.check(a);
  assert.strictEqual(early.allowed, false);
  assert.strictEqual(early.reason, 'delay');
  assert.strictEqual(early.retryAfter, 1);
  r.tick(1000);
  assert.strictEqual((await r.guard.check(a)).allowed, true);
  for (const wait of [2000, 4000, 8000]) { await r.guard.fail(a); assert.strictEqual((await r.guard.check(a)).allowed, false); r.tick(wait); assert.strictEqual((await r.guard.check(a)).allowed, true); }
  await r.guard.fail(a); // the 5th
  const locked = await r.guard.check(a);
  assert.strictEqual(locked.reason, 'locked');
  assert.ok(locked.retryAfter > 14 * 60 && locked.retryAfter <= 15 * 60);
  assert.match(locked.message, /15 minutes/);
  // Another address for the same email, and the same address for another email, are untouched.
  assert.strictEqual((await r.guard.check({ email: a.email, ip: '203.0.113.50' })).allowed, true);
  assert.strictEqual((await r.guard.check({ email: 'someone@example.test', ip: a.ip })).allowed, true);
  r.tick(15 * 60 * 1000);
  assert.strictEqual((await r.guard.check(a)).allowed, true, 'the lock ends');
});

test('the right password clears that address and remembers it as seen', async () => {
  const r = rig();
  const a = { email: 'owner@example.test', ip: '198.51.100.7' };
  await r.guard.fail(a); r.tick(1000); await r.guard.fail(a);
  await r.guard.success(a);
  assert.strictEqual((await r.guard.check(a)).allowed, true);
  const k = lg.keys(a.email, a.ip);
  assert.ok(await r.store.get(k.seen, r.now()));
  assert.strictEqual(await r.store.get(k.ip, r.now()), null);
  assert.ok(![...r.store._docs.keys()].some((x) => x.includes('owner@') || x.includes('198.51')), 'no email or address in clear');
});

test('30 wrong passwords in an hour from many addresses: one email to the owner, unseen addresses wait, a seen one still signs in', async () => {
  const r = rig({ LOGIN_DELAY_BASE_MS: '0' });
  const email = 'owner@example.test';
  const owner = { email, firstName: 'Asha' };
  await r.guard.success({ email, ip: '192.0.2.1' }); // the owner's usual place
  for (let i = 0; i < 31; i += 1) await r.guard.fail({ email, ip: `203.0.113.${i % 10}`, user: owner });
  await new Promise((res) => setImmediate(res));
  assert.deepStrictEqual(r.alerts, [{ to: email, fails: 30 }], 'once, at the ceiling');
  const stranger = await r.guard.check({ email, ip: '198.51.100.99' });
  assert.strictEqual(stranger.allowed, false);
  assert.strictEqual(stranger.reason, 'ceiling');
  assert.strictEqual((await r.guard.check({ email, ip: '192.0.2.1' })).allowed, true, 'the owner is never locked out from a seen address');
  r.tick(60 * 60 * 1000 + 1);
  assert.strictEqual((await r.guard.check({ email, ip: '198.51.100.99' })).allowed, true, 'the hour ends');
});

test('an email with no account counts the same way and never sends an email', async () => {
  const r = rig({ LOGIN_DELAY_BASE_MS: '0' });
  for (let i = 0; i < 30; i += 1) await r.guard.fail({ email: 'nobody@example.test', ip: `203.0.113.${i % 5}` });
  assert.strictEqual(r.alerts.length, 0);
  assert.strictEqual((await r.guard.check({ email: 'nobody@example.test', ip: '198.51.100.99' })).reason, 'ceiling');
});

test('LOGIN_CHALLENGE: off by default; on (with a bot check key) asks for it after 3 wrong passwords', async () => {
  assert.strictEqual(lg.settings({}).challenge, false);
  assert.strictEqual(lg.settings({ LOGIN_CHALLENGE: 'on' }).challenge, false, 'needs TURNSTILE_SECRET_KEY');
  let t = 0; const store = lg.createMemoryStore();
  const guard = lg.createLoginGuard({ store, now: () => t, config: () => lg.settings({ LOGIN_CHALLENGE: 'on', TURNSTILE_SECRET_KEY: 'k', LOGIN_DELAY_BASE_MS: '0' }), verifyChallenge: async (tok) => tok === 'good', log: { warn() {} } });
  const a = { email: 'x@example.test', ip: '198.51.100.1' };
  for (let i = 0; i < 3; i += 1) await guard.fail(a);
  const r = await guard.check(a);
  assert.strictEqual(r.challengeRequired, true);
  assert.strictEqual((await guard.check({ ...a, challengeToken: 'bad' })).allowed, false);
  assert.strictEqual((await guard.check({ ...a, challengeToken: 'good' })).allowed, true);
});

test('a store error lets the sign-in through (logged), like the request limiters', async () => {
  const broken = { get: async () => { throw new Error('down'); }, addFailure: async () => { throw new Error('down'); } };
  const guard = lg.createLoginGuard({ store: broken, config: () => lg.settings({}), log: { warn() {} } });
  assert.strictEqual((await guard.check({ email: 'a@b.test', ip: '1.2.3.4' })).allowed, true);
  await guard.fail({ email: 'a@b.test', ip: '1.2.3.4' });
});

test('the owner alert email is plain, escaped and names no address', () => {
  const m = lg.alertMail({ firstName: '<b>Asha</b>' }, 30);
  assert.match(m.subject, /sign-in attempts/);
  assert.ok(!m.html.includes('<b>Asha'));
  assert.match(m.text, /30 unsuccessful attempts/);
});

test('the account-wide 5-strikes lock is gone from the login route', () => {
  const src = fs.readFileSync(path.join(__dirname, '../routes/auth.js'), 'utf8');
  assert.ok(!/status\(423\)/.test(src), 'no 423 from sign-in');
  assert.ok(!/lockUntil = new Date/.test(src));
});

// ---- HTTP: the tester's case through the real route --------------------------------------------------------------
test('HTTP: an attacker address fails 5 times and is locked; the owner from another address signs in with the right password', async () => {
  process.env.LOGIN_DELAY_BASE_MS = '0';
  const { createAuthHarness } = require('./helpers/authHttp');
  const h = createAuthHarness();
  try {
    await h.addUser({ email: 'victim@example.test', password: 'Right-pass-13579' });
    const base = await h.start();
    const login = (password, ip) => h.call(base, '/api/auth/login', { body: { email: 'victim@example.test', password }, ip });
    for (let i = 0; i < 5; i += 1) assert.strictEqual((await login('wrong-guess-000', '203.0.113.66')).status, 401);
    const blocked = await login('Right-pass-13579', '203.0.113.66');
    assert.strictEqual(blocked.status, 429, 'even the right password waits on the attacker address');
    assert.ok(blocked.body.retryAfter > 0);
    const owner = await login('Right-pass-13579', '192.0.2.10');
    assert.strictEqual(owner.status, 200);
    assert.ok(owner.body.token);
    // An unknown email from the same attacker address is answered exactly like the real one.
    for (let i = 0; i < 5; i += 1) await h.call(base, '/api/auth/login', { body: { email: 'ghost@example.test', password: 'wrong-guess-000' }, ip: '203.0.113.66' });
    const ghost = await h.call(base, '/api/auth/login', { body: { email: 'ghost@example.test', password: 'x' }, ip: '203.0.113.66' });
    assert.strictEqual(ghost.status, 429);
    assert.strictEqual(ghost.body.message, blocked.body.message, 'same wording');
  } finally {
    delete process.env.LOGIN_DELAY_BASE_MS;
    await h.restore();
  }
});
