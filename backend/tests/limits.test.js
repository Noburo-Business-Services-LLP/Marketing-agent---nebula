const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'zz-test-secret';
const { createLimits, limitSettings, userKey, DEFAULTS } = require('../middleware/limits');

async function withServer(app, fn) {
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try { return await fn(`http://127.0.0.1:${server.address().port}`); } finally { server.close(); }
}
const tokenFor = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '1h' });
const call = (base, p, { token, ip, method = 'POST' } = {}) => fetch(`${base}${p}`, {
  method,
  headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(ip ? { 'X-Forwarded-For': ip } : {}) }
});

test('defaults are the documented numbers', () => {
  const s = limitSettings({});
  assert.deepStrictEqual(
    Object.fromEntries(Object.entries(s).map(([k, v]) => [k, [v.max, v.windowMs]])),
    { heavyAi: [30, 900000], lightAi: [100, 900000], upload: [20, 900000], spend: [10, 900000], scrape: [20, 3600000], webhook: [300, 60000] }
  );
  assert.strictEqual(DEFAULTS.heavyAi.max, 30);
});

test('numbers come from the environment, with bad values ignored', () => {
  const s = limitSettings({ LIMIT_HEAVY_AI_MAX: '5', LIMIT_HEAVY_AI_WINDOW_MS: '60000', LIMIT_SPEND_MAX: 'abc', LIMIT_WEBHOOK_MAX: '-3' });
  assert.strictEqual(s.heavyAi.max, 5);
  assert.strictEqual(s.heavyAi.windowMs, 60000);
  assert.strictEqual(s.spend.max, 10);
  assert.strictEqual(s.webhook.max, 300);
});

test('the key is the signed-in user (signature checked), else the address', () => {
  assert.strictEqual(userKey({ headers: { authorization: `Bearer ${tokenFor('abc')}` }, ip: '1.2.3.4' }), 'u:abc');
  const forged = jwt.sign({ id: 'abc' }, 'not-the-secret');
  assert.match(userKey({ headers: { authorization: `Bearer ${forged}` }, ip: '1.2.3.4' }), /^ip:1\.2\.3\.4$/);
  assert.match(userKey({ headers: {}, ip: '::ffff:1.2.3.4' }), /^ip:/);
});

test('heavyAi counts per user: two people behind one address each get their own allowance', async () => {
  const L = createLimits({ env: { LIMIT_HEAVY_AI_MAX: '2' }, prefix: 'zz-test-a' });
  const app = express();
  app.set('trust proxy', 1);
  app.post('/gen', L.heavyAi, (req, res) => res.json({ ok: true }));
  await withServer(app, async (base) => {
    const ip = '203.0.113.9';
    const a = tokenFor('user-a'); const b = tokenFor('user-b');
    assert.strictEqual((await call(base, '/gen', { token: a, ip })).status, 200);
    assert.strictEqual((await call(base, '/gen', { token: a, ip })).status, 200);
    const blocked = await call(base, '/gen', { token: a, ip });
    assert.strictEqual(blocked.status, 429);
    const body = await blocked.json();
    assert.strictEqual(body.success, false);
    assert.match(body.message, /Too many/);
    assert.strictEqual((await call(base, '/gen', { token: b, ip })).status, 200, 'a colleague is not blocked');
  });
});

test('webhook limiter counts per address even with a token', async () => {
  const L = createLimits({ env: { LIMIT_WEBHOOK_MAX: '1' }, prefix: 'zz-test-b' });
  const app = express();
  app.set('trust proxy', 1);
  app.post('/hook', L.webhook, (req, res) => res.json({ ok: true }));
  await withServer(app, async (base) => {
    assert.strictEqual((await call(base, '/hook', { token: tokenFor('x'), ip: '198.51.100.1' })).status, 200);
    assert.strictEqual((await call(base, '/hook', { token: tokenFor('y'), ip: '198.51.100.1' })).status, 429);
    assert.strictEqual((await call(base, '/hook', { ip: '198.51.100.2' })).status, 200);
  });
});

test('spendWrites lets reads through and counts writes', async () => {
  const L = createLimits({ env: { LIMIT_SPEND_MAX: '1' }, prefix: 'zz-test-c' });
  const app = express();
  app.use(L.spendWrites);
  app.all('/x', (req, res) => res.json({ ok: true }));
  await withServer(app, async (base) => {
    const token = tokenFor('s');
    for (let i = 0; i < 3; i += 1) assert.strictEqual((await call(base, '/x', { token, method: 'GET' })).status, 200);
    assert.strictEqual((await call(base, '/x', { token })).status, 200);
    assert.strictEqual((await call(base, '/x', { token, method: 'DELETE' })).status, 429);
  });
});

test('the shared module-level limiters are one instance each (route files and server-main count together)', () => {
  const a = require('../middleware/limits');
  const b = require('../middleware/limits');
  assert.strictEqual(a.heavyAi, b.heavyAi);
  for (const k of ['heavyAi', 'lightAi', 'upload', 'spend', 'scrape', 'webhook', 'spendWrites']) assert.strictEqual(typeof a[k], 'function', k);
});

test('the inbox mount: user calls use the given limiter, provider webhooks skip it', async () => {
  const { exceptInboxWebhooks, isInboxWebhook } = require('../middleware/limits');
  assert.strictEqual(isInboxWebhook({ path: '/webhooks/instagram' }), true);
  assert.strictEqual(isInboxWebhook({ path: '/webhooks/comments/facebook' }), true);
  assert.strictEqual(isInboxWebhook({ path: '/webhooks/register' }), false);
  assert.strictEqual(isInboxWebhook({ path: '/conversations' }), false);
  const L = createLimits({ env: { LIMIT_LIGHT_AI_MAX: '1' }, prefix: 'zz-test-d' });
  const app = express();
  const inbox = express.Router();
  inbox.all('*', (req, res) => res.json({ ok: true }));
  app.use('/api/social/inbox', exceptInboxWebhooks(L.lightAi), inbox);
  await withServer(app, async (base) => {
    const token = tokenFor('inbox-user');
    assert.strictEqual((await call(base, '/api/social/inbox/conversations', { token, method: 'GET' })).status, 200);
    assert.strictEqual((await call(base, '/api/social/inbox/summary', { token, method: 'GET' })).status, 429, 'inbox user calls are limited');
    assert.strictEqual((await call(base, '/api/social/inbox/webhooks/register', { token })).status, 429);
    for (let i = 0; i < 3; i += 1) assert.strictEqual((await call(base, '/api/social/inbox/webhooks/instagram')).status, 200, 'webhooks are not');
  });
});
