const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const cors = require('cors');
const { isOriginAllowed, corsOptions, rejectDisallowedOrigin } = require('../middleware/corsPolicy');

const ALLOWED = ['https://gravity.nebulaa.ai', 'https://extra.example.com'];
const ENV = { NODE_ENV: 'production' };

function build(env = ENV) {
  const app = express();
  app.use(rejectDisallowedOrigin(ALLOWED, env));
  app.use(cors(corsOptions(ALLOWED, env)));
  app.get('/api/ping', (req, res) => res.json({ ok: true }));
  app.get('/asset.js', (req, res) => res.type('js').send('1'));
  return app;
}
async function call(app, url, { method = 'GET', headers = {} } = {}) {
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${url}`, { method, headers });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch (_) { /* not json */ }
    return { status: res.status, json, headers: res.headers };
  } finally { server.close(); }
}
const quiet = async (fn) => { const w = console.warn; console.warn = () => {}; try { return await fn(); } finally { console.warn = w; } };

test('a request without an Origin header is allowed', async () => {
  const r = await call(build(), '/api/ping');
  assert.strictEqual(r.status, 200);
});

test('an allowed origin gets its CORS headers', async () => {
  const r = await call(build(), '/api/ping', { headers: { Origin: 'https://gravity.nebulaa.ai' } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers.get('access-control-allow-origin'), 'https://gravity.nebulaa.ai');
  assert.strictEqual(r.headers.get('access-control-allow-credentials'), 'true');
});

test('an evil origin gets 403 Origin not allowed on /api (not a 500), and no CORS headers', async () => {
  const r = await quiet(() => call(build(), '/api/ping', { headers: { Origin: 'https://evil.example.com' } }));
  assert.strictEqual(r.status, 403);
  assert.deepStrictEqual(r.json, { success: false, message: 'Origin not allowed' });
  assert.strictEqual(r.headers.get('access-control-allow-origin'), null);
});

test('a preflight from an allowed origin is answered 204; from an evil origin 403', async () => {
  const h = { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,authorization' };
  let r = await call(build(), '/api/ping', { method: 'OPTIONS', headers: { ...h, Origin: 'https://gravity.nebulaa.ai' } });
  assert.strictEqual(r.status, 204);
  assert.strictEqual(r.headers.get('access-control-allow-origin'), 'https://gravity.nebulaa.ai');
  r = await quiet(() => call(build(), '/api/ping', { method: 'OPTIONS', headers: { ...h, Origin: 'https://evil.example.com' } }));
  assert.strictEqual(r.status, 403);
});

test('outside /api a refused origin is not an error (no 500), it just gets no CORS headers', async () => {
  const r = await call(build(), '/asset.js', { headers: { Origin: 'https://evil.example.com' } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers.get('access-control-allow-origin'), null);
});

test('local development ports are allowed outside production only', () => {
  assert.strictEqual(isOriginAllowed('http://localhost:5199', ALLOWED, { NODE_ENV: 'development' }), true);
  assert.strictEqual(isOriginAllowed('http://localhost:5199', ALLOWED, { NODE_ENV: 'production' }), false);
  assert.strictEqual(isOriginAllowed('http://localhost.evil.com:5199', ALLOWED, { NODE_ENV: 'development' }), false);
});

test('server-main wires the gate before cors, keeps CORS_ALLOWED_ORIGINS, and no longer throws on a refused origin', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server-main.js'), 'utf8');
  assert.ok(src.indexOf('rejectDisallowedOrigin(allowedOrigins)') > 0);
  assert.ok(src.indexOf('rejectDisallowedOrigin(allowedOrigins)') < src.indexOf('cors(corsPolicy.corsOptions'));
  assert.ok(/process\.env\.CORS_ALLOWED_ORIGINS/.test(src));
  assert.ok(!/Not allowed by CORS'\)\)/.test(src));
  assert.ok(src.indexOf('queryGuard') < src.indexOf('app.use(mongoSanitize())'));
});
