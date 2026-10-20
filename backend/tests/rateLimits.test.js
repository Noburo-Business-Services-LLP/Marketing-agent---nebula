const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'zz-test-secret';
const { createRateLimits, trustProxySetting, isCredentialRequest } = require('../middleware/rateLimits');

function build(opts) {
  const limits = createRateLimits(opts);
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.get('/ip', (req, res) => res.json({ ip: req.ip }));
  const auth = express.Router();
  auth.get('/me', (req, res) => res.json({ ok: true }));
  auth.post('/logout', (req, res) => res.json({ ok: true }));
  for (const p of ['/login', '/signup', '/send-otp', '/verify-otp', '/forgot-password', '/verify-reset-otp', '/reset-password', '/change-password']) {
    auth.post(p, (req, res) => res.json({ ok: true }));
  }
  app.use('/api/auth', limits.credential, auth);
  app.use('/api/social', limits.social, (req, res) => res.json({ ok: true }));
  return app;
}

async function withServer(app, fn) {
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try { return await fn(`http://127.0.0.1:${server.address().port}`); } finally { server.close(); }
}

const post = (base, p, body, headers = {}) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body || {}) });

test('session checks (/auth/me, logout) never use the sign-in bucket', async () => {
  await withServer(build({ credentialMax: 2, credentialIpMax: 3 }), async (base) => {
    for (let i = 0; i < 3; i += 1) await post(base, '/api/auth/login', { email: 'a@x.test' });
    assert.strictEqual((await post(base, '/api/auth/login', { email: 'a@x.test' })).status, 429, 'the sign-in bucket is used up');
    for (let i = 0; i < 25; i += 1) assert.strictEqual((await fetch(`${base}/api/auth/me`)).status, 200);
    assert.strictEqual((await post(base, '/api/auth/logout')).status, 200);
  });
});

test('sign-in attempts are counted per address and account; another account from the same office is not blocked', async () => {
  await withServer(build({ credentialMax: 3, credentialIpMax: 8 }), async (base) => {
    const ip = { 'X-Forwarded-For': '203.0.113.7' };
    for (let i = 0; i < 3; i += 1) assert.strictEqual((await post(base, '/api/auth/login', { email: 'A@X.test ' }, ip)).status, 200);
    const blocked = await post(base, '/api/auth/login', { email: 'a@x.test' }, ip);
    assert.strictEqual(blocked.status, 429);
    assert.match((await blocked.json()).message, /Too many sign-in attempts/);
    // a colleague behind the same address still signs in
    assert.strictEqual((await post(base, '/api/auth/login', { email: 'b@x.test' }, ip)).status, 200);
    // the same account from another address has its own count
    assert.strictEqual((await post(base, '/api/auth/login', { email: 'a@x.test' }, { 'X-Forwarded-For': '198.51.100.9' })).status, 200);
  });
});

test('one address has a safety cap across all accounts', async () => {
  await withServer(build({ credentialMax: 100, credentialIpMax: 4 }), async (base) => {
    const ip = { 'X-Forwarded-For': '203.0.113.50' };
    for (let i = 0; i < 4; i += 1) assert.strictEqual((await post(base, '/api/auth/send-otp', { email: `u${i}@x.test` }, ip)).status, 200);
    assert.strictEqual((await post(base, '/api/auth/signup', { email: 'u9@x.test' }, ip)).status, 429);
  });
});

test('every credential route is limited: login, signup, codes, password reset and change', () => {
  for (const p of ['/login', '/signup', '/send-otp', '/verify-otp', '/forgot-password', '/verify-reset-otp', '/reset-password', '/change-password']) {
    assert.strictEqual(isCredentialRequest({ method: 'POST', path: p }), true, p);
  }
  for (const [m, p] of [['GET', '/me'], ['POST', '/logout'], ['GET', '/business-context'], ['PUT', '/update-profile'], ['GET', '/signup-config'], ['GET', '/login']]) {
    assert.strictEqual(isCredentialRequest({ method: m, path: p }), false, `${m} ${p}`);
  }
});

test('behind the load balancer (1 hop) the limiter sees the real client address, not a spoofed one', async () => {
  await withServer(build({}), async (base) => {
    let r = await (await fetch(`${base}/ip`, { headers: { 'X-Forwarded-For': '203.0.113.7' } })).json();
    assert.strictEqual(r.ip, '203.0.113.7');
    // a client that sends its own X-Forwarded-For: the load balancer appends the real address last
    r = await (await fetch(`${base}/ip`, { headers: { 'X-Forwarded-For': '6.6.6.6, 203.0.113.7' } })).json();
    assert.strictEqual(r.ip, '203.0.113.7');
  });
});

test('trust proxy: TRUST_PROXY_HOPS, default 1 (the ALB); 0 turns it off', () => {
  assert.strictEqual(trustProxySetting({}), 1);
  assert.strictEqual(trustProxySetting({ TRUST_PROXY_HOPS: '2' }), 2);
  assert.strictEqual(trustProxySetting({ TRUST_PROXY_HOPS: '0' }), false);
  assert.strictEqual(trustProxySetting({ TRUST_PROXY_HOPS: 'true' }), 1, 'never "trust everything"');
});

test('social publishing is limited per signed-in user, with a per-address safety cap', async () => {
  await withServer(build({ socialUserMax: 3, socialIpMax: 7 }), async (base) => {
    const ip = { 'X-Forwarded-For': '203.0.113.20' };
    const tok = (id) => ({ ...ip, Authorization: `Bearer ${jwt.sign({ id }, process.env.JWT_SECRET)}` });
    for (let i = 0; i < 3; i += 1) assert.strictEqual((await post(base, '/api/social/post', {}, tok('u1'))).status, 200);
    assert.strictEqual((await post(base, '/api/social/post', {}, tok('u1'))).status, 429);
    // a colleague in the same office has their own allowance
    for (let i = 0; i < 3; i += 1) assert.strictEqual((await post(base, '/api/social/post', {}, tok('u2'))).status, 200);
    // the same user from another address shares their allowance
    assert.strictEqual((await post(base, '/api/social/post', {}, { 'X-Forwarded-For': '198.51.100.1', Authorization: tok('u1').Authorization })).status, 429);
    // the address cap still holds across users (6 used from this address so far, plus 1 refused = 7 counted)
    assert.strictEqual((await post(base, '/api/social/post', {}, tok('u3'))).status, 429);
  });
});

test('server-main uses the scoped limits and the configurable trust proxy', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server-main.js'), 'utf8');
  assert.ok(/app\.set\('trust proxy', trustProxySetting\(process\.env\)\)/.test(src));
  assert.ok(/app\.use\('\/api\/auth', limits\.credential, authRoutes\)/.test(src));
  assert.ok(/app\.use\('\/api\/admin', limits\.credentialAll, adminRoutes\)/.test(src));
  assert.ok(/app\.use\('\/api\/social', limits\.social, socialRoutes\)/.test(src));
  assert.ok(!/authLimiter/.test(src), 'the old whole-router auth limiter is gone');
});
