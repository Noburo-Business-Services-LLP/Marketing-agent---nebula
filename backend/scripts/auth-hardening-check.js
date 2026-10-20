/**
 * Real-database check of the auth hardening (docs/superpowers/ops/security-hardening.md section 9), against the
 * DEVELOPMENT database only: refuses any database except nebulaa_dev. No provider call and no email: outgoing https
 * requests and fetches to non-local hosts are refused, the sign-in code mailer is stubbed (codes are captured here),
 * the owner alert email is stubbed. The whole app runs in this process on a random 127.0.0.1 port (never 3000, 3200
 * or 5000), with no background job. Different visitor addresses are simulated with X-Forwarded-For (trust proxy 1).
 * Checks:
 *   1. enumeration: send-otp, forgot-password, verify-otp, verify-reset-otp, reset-password answer the same for a
 *      verified account, an unverified account and no account; forgot-password timing is close;
 *   2. strict bearer: "Bearerx <token>" is 401 on /api/auth/me, "bearer <token>" is 200;
 *   3. lockout: an attacker address fails 5 times and is locked (even the right password waits there), another
 *      address signs in; an unknown email gets the same answers; the escalating wait; the per-email ceiling emails
 *      the owner once, keeps unseen addresses out and lets a previously seen address in; counters are in MongoDB;
 *   4. password policy: sign-up, change-password and reset-password refuse a weak password; strong ones work; an
 *      existing short password still signs in;
 *   5. token version: the token from before a password change is 401, the new one works.
 * Throwaway data only: users whose email starts with "zz.auth-hardening-check" and their login_attempts rows; all
 * deleted at the end. Exits non-zero on any FAIL or leftover.
 *   node scripts/auth-hardening-check.js          run, print PASS/FAIL, clean up
 *   node scripts/auth-hardening-check.js cleanup  delete leftovers of an interrupted run
 */
require('dotenv').config();
const https = require('https');
const outgoing = [];
const isLocal = (h) => /^(127\.0\.0\.1|localhost|\[::1\]|::1)$/.test(String(h || ''));
for (const fn of ['request', 'get']) {
  const orig = https[fn];
  https[fn] = function guarded(a, ...rest) {
    const host = typeof a === 'string' || a instanceof URL ? new URL(String(a)).hostname : (a && (a.hostname || a.host));
    if (!isLocal(host)) { outgoing.push(host); throw new Error(`auth-hardening-check: outgoing request to ${host} refused`); }
    return orig.call(this, a, ...rest);
  };
}
const realFetch = global.fetch;
global.fetch = (input, init) => {
  const host = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url).hostname;
  if (!isLocal(host)) { outgoing.push(host); return Promise.reject(new Error(`auth-hardening-check: outgoing fetch to ${host} refused`)); }
  return realFetch(input, init);
};

// No email can leave, no bot check or invitation is asked for, limiter counters stay in this process.
delete process.env.RESEND_API_KEY;
delete process.env.TURNSTILE_SECRET_KEY;
process.env.SIGNUP_MODE = 'open';
process.env.RATE_LIMIT_STORE = 'memory';
process.env.LOGIN_DELAY_BASE_MS = '0';
process.env.NEBULAA_SERVER_NO_START = '1';
if (process.env.NODE_ENV === 'production') { console.error('Refusing: NODE_ENV is production.'); process.exit(1); }

const assert = require('assert');
const mongoose = require('mongoose');

const DEV_DB = 'nebulaa_dev';
const TAG = 'zz.auth-hardening-check';
const EMAIL_RX = /^zz\.auth-hardening-check/;
const mail = (name) => `${TAG}-${name}@example.com`;
// Every email this check signs in with (accounts and unknown ones), so their lockout rows can be found and removed.
const EMAILS = ['known', 'fresh', 'ghost', 'victim', 'ceiling', 'old', 'signup', 'reset', 'delay'].map(mail);
const results = [];
async function check(name, fn) {
  try { const d = await fn(); results.push(true); console.log(`PASS  ${name}${d ? ` (${d})` : ''}`); } catch (e) { results.push(false); console.log(`FAIL  ${name}: ${e && e.message}`); }
}

const lg = () => require('../services/loginGuard');
const attemptHashes = () => EMAILS.map((e) => lg().keys(e, '').eh);

async function cleanup(db) {
  const out = {
    loginAttempts: (await db.collection('login_attempts').deleteMany({ eh: { $in: attemptHashes() } })).deletedCount,
    users: (await db.collection('users').deleteMany({ email: { $regex: EMAIL_RX } })).deletedCount
  };
  return out;
}
async function leftovers(db) {
  return (await db.collection('users').countDocuments({ email: { $regex: EMAIL_RX } }))
    + (await db.collection('login_attempts').countDocuments({ eh: { $in: attemptHashes() } }));
}

const listen = (app) => new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
const oct = () => 1 + Math.floor(Math.random() * 250);
const RUN_NET = `${oct()}.${oct()}`;
const ipOf = (n) => `10.${RUN_NET}.${n}`; // private range, unique per run

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set (run from the backend folder so .env is found).');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  if (mongoose.connection.name !== DEV_DB) throw new Error(`Refusing: database is ${mongoose.connection.name}, not ${DEV_DB}`);
  const db = mongoose.connection.db;
  if (process.argv.includes('cleanup')) { console.log('removed', await cleanup(db)); return 0; }
  await cleanup(db);

  // Stubs before the app is loaded: codes are captured, the owner alert is recorded, nothing is sent.
  const codes = [];
  const otpService = require('../services/otpService');
  otpService.sendOTP = async (email, otp) => { codes.push({ email, otp }); return { id: 'stub' }; };
  const alerts = [];
  lg().sendAlertEmail = async (user, fails) => { alerts.push({ to: user.email, fails }); return { stubbed: true }; };

  const { app } = require('../server-main');
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}`;

  const User = require('../models/User');
  const passwordHash = require('../services/passwordHash');
  const PASSWORD = 'Zz-check-24680-pass';
  const mkUser = async (name, extra = {}) => User.create({ email: mail(name), password: PASSWORD, firstName: 'Zz', lastName: 'Check', isVerified: true, isActive: true, onboardingCompleted: true, ...extra });
  const call = (p, { method = 'POST', body, token, ip = ipOf(1), authorization } = {}) => realFetch(`${base}${p}`, {
    method,
    headers: { 'X-Forwarded-For': ip, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(authorization ? { Authorization: authorization } : {}) },
    body: body ? JSON.stringify(body) : undefined
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  const same = (a, b, what) => assert.deepStrictEqual({ s: a.status, b: a.body }, { s: b.status, b: b.body }, what);
  const settle = () => new Promise((r) => setTimeout(r, 400));

  await mkUser('known');
  await mkUser('fresh', { isVerified: false });

  // ---- 1. enumeration ------------------------------------------------------------------------------------------
  await check('enumeration: send-otp and forgot-password answer the same for a verified account, an unverified one and no account', async () => {
    for (const route of ['/api/auth/send-otp', '/api/auth/forgot-password']) {
      const k = await call(route, { body: { email: mail('known') }, ip: ipOf(2) });
      const f = await call(route, { body: { email: mail('fresh') }, ip: ipOf(2) });
      const g = await call(route, { body: { email: mail('ghost') }, ip: ipOf(2) });
      assert.strictEqual(k.status, 200);
      assert.strictEqual(k.body.message, 'If an account exists, we have sent a code.');
      same(k, f, `${route} unverified`); same(k, g, `${route} no account`);
    }
    await settle();
    assert.ok(codes.some((c) => c.email === mail('fresh')), 'the unverified account got a code');
    assert.ok(!codes.some((c) => c.email === mail('ghost')), 'no account, no email');
    return `${codes.length} codes captured, none sent`;
  });

  await check('enumeration: verify-otp, verify-reset-otp and reset-password with a wrong code answer the same with and without an account', async () => {
    for (const [route, extra] of [['/api/auth/verify-otp', {}], ['/api/auth/verify-reset-otp', {}], ['/api/auth/reset-password', { newPassword: 'Plum-river-42-zz' }]]) {
      const k = await call(route, { body: { email: mail('fresh'), otp: '000001', ...extra }, ip: ipOf(3) });
      const g = await call(route, { body: { email: mail('ghost'), otp: '000001', ...extra }, ip: ipOf(3) });
      assert.strictEqual(k.status, 400, route);
      same(k, g, route);
    }
  });

  await check('enumeration: forgot-password takes about as long with and without an account', async () => {
    const time = async (email, n) => { const t = []; for (let i = 0; i < n; i += 1) { const s = process.hrtime.bigint(); await call('/api/auth/forgot-password', { body: { email }, ip: ipOf(4) }); t.push(Number(process.hrtime.bigint() - s) / 1e6); } return t.sort((a, b) => a - b)[Math.floor(n / 2)]; };
    const k = await time(mail('known'), 5); const g = await time(mail('ghost'), 5);
    assert.ok(Math.abs(k - g) < 250, `medians ${k.toFixed(0)} ms vs ${g.toFixed(0)} ms`);
    return `median ${k.toFixed(0)} ms with an account, ${g.toFixed(0)} ms without`;
  });

  // ---- 2. strict bearer ----------------------------------------------------------------------------------------
  await check('strict bearer: "Bearerx <token>" and "Bearer<token>" are 401 on /api/auth/me, "bearer <token>" is 200', async () => {
    const r = await call('/api/auth/login', { body: { email: mail('known'), password: PASSWORD }, ip: ipOf(5) });
    assert.strictEqual(r.status, 200);
    const t = r.body.token;
    assert.strictEqual((await call('/api/auth/me', { method: 'GET', authorization: `Bearerx ${t}` })).status, 401);
    assert.strictEqual((await call('/api/auth/me', { method: 'GET', authorization: `Bearer${t}` })).status, 401);
    assert.strictEqual((await call('/api/auth/me', { method: 'GET', authorization: `bearer ${t}` })).status, 200);
  });

  // ---- 3. lockout ----------------------------------------------------------------------------------------------
  await mkUser('victim');
  await check('lockout: the attacker address fails 5 times and is locked; another address signs in with the right password', async () => {
    const attacker = ipOf(66);
    for (let i = 0; i < 5; i += 1) assert.strictEqual((await call('/api/auth/login', { body: { email: mail('victim'), password: 'wrong-guess-123' }, ip: attacker })).status, 401);
    const locked = await call('/api/auth/login', { body: { email: mail('victim'), password: PASSWORD }, ip: attacker });
    assert.strictEqual(locked.status, 429, 'even the right password waits on the attacker address');
    assert.ok(locked.body.retryAfter > 800, String(locked.body.retryAfter));
    const owner = await call('/api/auth/login', { body: { email: mail('victim'), password: PASSWORD }, ip: ipOf(10) });
    assert.strictEqual(owner.status, 200);
    for (let i = 0; i < 5; i += 1) await call('/api/auth/login', { body: { email: mail('ghost'), password: 'wrong-guess-123' }, ip: attacker });
    const ghost = await call('/api/auth/login', { body: { email: mail('ghost'), password: PASSWORD }, ip: attacker });
    assert.strictEqual(ghost.status, 429); assert.strictEqual(ghost.body.message, locked.body.message, 'no account: the same answer');
    const rows = await db.collection('login_attempts').countDocuments({ eh: { $in: attemptHashes() } });
    assert.ok(rows >= 4, `rows ${rows}`);
    const ttl = (await db.collection('login_attempts').indexes()).find((x) => x.expireAfterSeconds === 0);
    assert.ok(ttl, 'TTL index on expireAt');
    return `${rows} counter rows in MongoDB, TTL index ${ttl.name}`;
  });

  await check('lockout: the escalating wait (1 s after a first wrong password)', async () => {
    process.env.LOGIN_DELAY_BASE_MS = '1000';
    try {
      assert.strictEqual((await call('/api/auth/login', { body: { email: mail('delay'), password: 'wrong-guess-123' }, ip: ipOf(70) })).status, 401);
      const early = await call('/api/auth/login', { body: { email: mail('delay'), password: 'wrong-guess-123' }, ip: ipOf(70) });
      assert.strictEqual(early.status, 429); assert.strictEqual(early.body.retryAfter, 1);
      await new Promise((r) => setTimeout(r, 1100));
      assert.strictEqual((await call('/api/auth/login', { body: { email: mail('delay'), password: 'wrong-guess-123' }, ip: ipOf(70) })).status, 401);
      const second = await call('/api/auth/login', { body: { email: mail('delay'), password: 'wrong-guess-123' }, ip: ipOf(70) });
      assert.strictEqual(second.body.retryAfter, 2);
    } finally { process.env.LOGIN_DELAY_BASE_MS = '0'; }
    return 'waits 1 s, then 2 s';
  });

  await mkUser('ceiling');
  await check('lockout: the per-email ceiling emails the owner once, keeps unseen addresses out, lets a previously seen one in', async () => {
    process.env.LOGIN_ACCOUNT_CEILING = '8';
    try {
      const seen = ipOf(80);
      assert.strictEqual((await call('/api/auth/login', { body: { email: mail('ceiling'), password: PASSWORD }, ip: seen })).status, 200);
      for (let i = 0; i < 9; i += 1) await call('/api/auth/login', { body: { email: mail('ceiling'), password: 'wrong-guess-123' }, ip: ipOf(100 + i) });
      await settle();
      assert.deepStrictEqual(alerts, [{ to: mail('ceiling'), fails: 8 }], 'one owner email, at the ceiling');
      const stranger = await call('/api/auth/login', { body: { email: mail('ceiling'), password: PASSWORD }, ip: ipOf(150) });
      assert.strictEqual(stranger.status, 429);
      assert.strictEqual((await call('/api/auth/login', { body: { email: mail('ceiling'), password: PASSWORD }, ip: seen })).status, 200, 'the owner from a seen address');
    } finally { delete process.env.LOGIN_ACCOUNT_CEILING; }
    return '1 alert (stubbed), unseen 429, seen 200';
  });

  // ---- 4. password policy and 5. token version -----------------------------------------------------------------
  await check('password policy: sign-up refuses a weak password, a strong one creates the account; the duplicate keeps its message', async () => {
    const body = (password) => ({ email: mail('signup'), password, firstName: 'Zz', acceptedTerms: true });
    const weak = await call('/api/auth/signup', { body: body('password123'), ip: ipOf(90) });
    assert.strictEqual(weak.status, 400); assert.match(weak.body.message, /too common/);
    const short = await call('/api/auth/signup', { body: body('Ab1-short'), ip: ipOf(90) });
    assert.strictEqual(short.status, 400); assert.match(short.body.message, /at least 10/);
    assert.strictEqual(await User.countDocuments({ email: mail('signup') }), 0);
    const ok = await call('/api/auth/signup', { body: body('Plum-river-42-zz'), ip: ipOf(90) });
    assert.strictEqual(ok.status, 201, JSON.stringify(ok.body));
    const dup = await call('/api/auth/signup', { body: body('Plum-river-42-zz'), ip: ipOf(91) });
    assert.strictEqual(dup.status, 400); assert.match(dup.body.message, /already exists/);
  });

  await check('password policy: an existing short password still signs in; change-password refuses weak, takes strong; the old token is then 401', async () => {
    const old = await mkUser('old');
    await User.updateOne({ _id: old._id }, { $set: { password: await passwordHash.hash('short9pw', { rounds: 10 }) } }); // set before the policy
    const login = await call('/api/auth/login', { body: { email: mail('old'), password: 'short9pw' }, ip: ipOf(95) });
    assert.strictEqual(login.status, 200);
    const t1 = login.body.token;
    const weak = await call('/api/auth/change-password', { method: 'PUT', token: t1, body: { currentPassword: 'short9pw', newPassword: 'qwerty12345' } });
    assert.strictEqual(weak.status, 400); assert.match(weak.body.message, /too common/);
    const ok = await call('/api/auth/change-password', { method: 'PUT', token: t1, body: { currentPassword: 'short9pw', newPassword: 'Blue-lantern-7-sky' } });
    assert.strictEqual(ok.status, 200);
    assert.strictEqual((await call('/api/auth/me', { method: 'GET', token: t1 })).status, 401, 'the token from before the change');
    assert.strictEqual((await call('/api/auth/me', { method: 'GET', token: ok.body.token })).status, 200, 'the new token');
  });

  await check('password policy: reset-password with the real code refuses a weak password, takes a strong one, which then signs in', async () => {
    await mkUser('reset');
    await call('/api/auth/forgot-password', { body: { email: mail('reset') }, ip: ipOf(96) });
    await settle();
    const code = [...codes].reverse().find((c) => c.email === mail('reset'));
    assert.ok(code, 'the code was captured');
    const weak = await call('/api/auth/reset-password', { body: { email: mail('reset'), otp: code.otp, newPassword: 'iloveyou123' }, ip: ipOf(96) });
    assert.strictEqual(weak.status, 400);
    const ok = await call('/api/auth/reset-password', { body: { email: mail('reset'), otp: code.otp, newPassword: 'Quiet-harbour-58' }, ip: ipOf(96) });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
    assert.strictEqual((await call('/api/auth/login', { body: { email: mail('reset'), password: 'Quiet-harbour-58' }, ip: ipOf(97) })).status, 200);
  });

  await new Promise((r) => server.close(r));
  await settle();
  const removed = await cleanup(db);
  const left = await leftovers(db);
  console.log(`cleanup: removed ${JSON.stringify(removed)}, leftovers ${left}`);
  console.log(`outgoing provider calls refused: ${outgoing.length}${outgoing.length ? ` (${[...new Set(outgoing)].join(', ')})` : ''}`);
  const failed = results.filter((r) => !r).length;
  console.log(`${results.length - failed} PASS, ${failed} FAIL`);
  return failed || left ? 1 : 0;
}

main()
  .then(async (code) => { await mongoose.disconnect().catch(() => {}); process.exit(code); })
  .catch(async (e) => {
    console.error('auth-hardening-check error:', e && e.message);
    try { if (mongoose.connection.readyState === 1 && mongoose.connection.name === DEV_DB) console.log('cleanup:', await cleanup(mongoose.connection.db)); } catch (_) { /* best effort */ }
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
