/**
 * Denial-of-service hardening (tester's note 2026-10-20, docs/superpowers/ops/security-hardening.md): server timeouts,
 * a short per-route timeout for ordinary routes, list queries bounded by maxTimeMS, smaller body limits.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { applyServerTimeouts, serverTimeoutSettings, routeTimeout, LONG_ROUTE_PREFIXES, isLongRoute } = require('../services/serverTimeouts');
const { listTimeout, listMaxTimeMs } = require('../utils/listQueryTimeout');

test('server timeouts: keep-alive 65 s (above the load balancer 60 s), headers 66 s, request 300 s by default', () => {
  const s = {};
  applyServerTimeouts(s, {});
  assert.deepStrictEqual([s.keepAliveTimeout, s.headersTimeout, s.requestTimeout], [65000, 66000, 300000]);
  const t = {};
  applyServerTimeouts(t, { SERVER_REQUEST_TIMEOUT_MS: '120000' });
  assert.strictEqual(t.requestTimeout, 120000);
  // never below the headers timeout (Node requires requestTimeout >= headersTimeout when both are set)
  assert.strictEqual(serverTimeoutSettings({ SERVER_REQUEST_TIMEOUT_MS: '1000' }).requestTimeout, 66000);
});

test('generation, upload and stream routes are excluded from the short timeout; ordinary ones are not', () => {
  for (const p of ['/api/campaigns', '/api/video-generation/createVideo', '/api/videos/create', '/api/drafts/upload-media', '/api/social/inbox/stream', '/api/dashboard/campaign-suggestions-stream', '/api/carousels/generate-stream', '/api/photoshoot/jobs', '/api/account/export']) {
    assert.ok(isLongRoute(p), p);
  }
  for (const p of ['/api/notifications', '/api/credits/balance', '/api/auth/me', '/api/auth/login', '/api/tour', '/api/reminders', '/api/agency/clients']) {
    assert.ok(!isLongRoute(p), p);
  }
  assert.ok(LONG_ROUTE_PREFIXES.length > 20);
});

async function withServer(app, fn) {
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try { return await fn(`http://127.0.0.1:${server.address().port}`); } finally { server.close(); }
}

test('a slow ordinary route answers 503 after the short timeout; its late answer is dropped without an error', async () => {
  const app = express();
  app.use(routeTimeout({ ms: 80 }));
  let lateError = null;
  app.get('/api/notifications', (req, res) => setTimeout(() => {
    try { res.status(200).json({ late: true }); } catch (e) { lateError = e; }
  }, 200));
  app.get('/api/campaigns', (req, res) => setTimeout(() => res.json({ ok: true }), 150));
  app.get('/api/tour', (req, res) => res.json({ fast: true }));
  await withServer(app, async (base) => {
    const slow = await fetch(`${base}/api/notifications`);
    assert.strictEqual(slow.status, 503);
    assert.match((await slow.json()).message, /longer than expected/);
    assert.strictEqual((await fetch(`${base}/api/campaigns`)).status, 200, 'a long route is not cut');
    assert.strictEqual((await fetch(`${base}/api/tour`)).status, 200);
    await new Promise((r) => setTimeout(r, 200));
    assert.strictEqual(lateError, null);
  });
});

test('ROUTE_TIMEOUT_MS=0 switches the short timeout off', () => {
  const mw = routeTimeout({ env: { ROUTE_TIMEOUT_MS: '0' } });
  let called = false;
  mw({ path: '/api/notifications', originalUrl: '/api/notifications' }, {}, () => { called = true; });
  assert.ok(called);
});

test('list queries get maxTimeMS (5 s by default) for find queries and aggregates; anything else passes through', () => {
  assert.strictEqual(listMaxTimeMs({}), 5000);
  assert.strictEqual(listMaxTimeMs({ LIST_QUERY_MAX_TIME_MS: '2000' }), 2000);
  const calls = [];
  const q = { maxTimeMS(ms) { calls.push(['q', ms]); return this; } };
  const a = { option(o) { calls.push(['a', o.maxTimeMS]); return this; } };
  assert.strictEqual(listTimeout(q), q);
  assert.strictEqual(listTimeout(a), a);
  const plain = Promise.resolve([]);
  assert.strictEqual(listTimeout(plain), plain);
  assert.deepStrictEqual(calls, [['q', 5000], ['a', 5000]]);
});

test('the list routes use the bounded query helper', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  for (const f of ['routes/drafts.js', 'routes/campaigns.js', 'routes/notifications.js', 'routes/studioVideos.js', 'services/socialInboxService.js']) {
    assert.match(read(f), /listTimeout\(/, f);
  }
});

test('body limits: 1 MB by default, 10 MB for the few that carry one picture, 40 MB only where pictures or files are sent', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server-main.js'), 'utf8');
  const big = src.match(/const BIG_BODY_PREFIXES = \[([\s\S]*?)\];/)[1];
  const medium = src.match(/const MEDIUM_BODY_PREFIXES = \[([\s\S]*?)\];/)[1];
  for (const p of ['/api/ads', '/api/ad-campaigns', '/api/chat', '/api/brand', '/api/content', '/api/blueprint', '/api/auth/update-profile', '/api/auth/complete-onboarding']) {
    assert.ok(!big.includes(`'${p}'`), `${p} no longer gets 40 MB`);
  }
  for (const p of ['/api/content', '/api/blueprint', '/api/auth/update-profile', '/api/auth/complete-onboarding']) assert.ok(medium.includes(`'${p}'`), p);
  assert.match(src, /express\.json\(\{ limit: '10mb' \}\)/);
});

test('the media upload streams to a temporary file (no 120 MB buffer in memory)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'drafts.js'), 'utf8');
  const block = src.slice(src.indexOf('const mediaUpload = multer('), src.indexOf("router.post('/upload-media'"));
  assert.ok(!/memoryStorage/.test(block), 'memoryStorage is gone');
  assert.match(block, /diskStorage/);
});
