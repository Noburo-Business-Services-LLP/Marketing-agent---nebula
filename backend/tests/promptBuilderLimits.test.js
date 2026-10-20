// The video prompt builder (POST /api/generateVideoStylePrompts) was public with no caps (a 221 MB answer in the load
// test). It now needs a login, caps scenes, duration and text lengths, and sits behind the AI limiter.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const router = require('../routes/api-video-style-prompts');
const { styleDefinitions } = require('../services/video-style-prompt-engineering');
const { LIMITS } = router;

const routeOf = (method, p) => router.stack.find((l) => l.route && l.route.path === p && l.route.methods[method]).route;
const handler = (method, p) => { const s = routeOf(method, p).stack; return s[s.length - 1].handle; };
const mkRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const STYLE = Object.keys(styleDefinitions)[0];
const good = { description: 'A bakery opening a new shop', videoStyle: STYLE, characterName: 'Asha', sceneCount: 4, duration: 20 };

test('both builder routes require a login (the static style list stays public)', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', router);
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try {
    const base = `http://127.0.0.1:${server.address().port}/api`;
    for (const p of ['/generateVideoStylePrompts', '/generateSceneDescriptions']) {
      const r = await fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(good) });
      assert.equal(r.status, 401, p);
    }
    assert.equal((await fetch(`${base}/videoStyles`)).status, 200);
  } finally { server.close(); }
});

test('a normal request still works', async () => {
  const res = mkRes();
  await handler('post', '/generateVideoStylePrompts')({ body: good, user: { _id: 'u1' } }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.scenes.length, 4);
});

test('scene count, duration and text lengths are capped with a plain 400', async () => {
  const bad = [
    { sceneCount: LIMITS.maxScenes + 1 }, { sceneCount: 0 }, { sceneCount: 2.5 }, { sceneCount: '1e6' },
    { duration: LIMITS.maxDurationSeconds + 1 }, { duration: 0 }, { duration: 'long' },
    { description: 'x'.repeat(LIMITS.maxDescription + 1) }, { characterName: 'y'.repeat(LIMITS.maxName + 1) },
    { productName: 'z'.repeat(LIMITS.maxName + 1) }, { description: { $gt: '' } }, { videoStyle: ['a'] }
  ];
  for (const change of bad) {
    const res = mkRes();
    await handler('post', '/generateVideoStylePrompts')({ body: { ...good, ...change }, user: { _id: 'u1' } }, res);
    assert.equal(res.code, 400, JSON.stringify(change).slice(0, 80));
    assert.equal(res.body.success, false);
    assert.equal(typeof res.body.message, 'string');
  }
  assert.equal(LIMITS.maxScenes, 20);
});

test('at the caps the answer stays small', async () => {
  const res = mkRes();
  await handler('post', '/generateVideoStylePrompts')({ body: { ...good, sceneCount: LIMITS.maxScenes, duration: LIMITS.maxDurationSeconds, description: 'd'.repeat(LIMITS.maxDescription) }, user: { _id: 'u1' } }, res);
  assert.equal(res.code, 200);
  assert.ok(Buffer.byteLength(JSON.stringify(res.body)) < 2 * 1024 * 1024, 'under 2 MB');
});

test('scene descriptions: scene number capped', async () => {
  const res = mkRes();
  await handler('post', '/generateSceneDescriptions')({ body: { videoStyle: STYLE, sceneNumber: 999999 }, user: { _id: 'u1' } }, res);
  assert.equal(res.code, 400);
});

test('server-main puts the AI limiter in front of both builder routes', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server-main.js'), 'utf8');
  assert.ok(/app\.use\(\['\/api\/generateVideoStylePrompts', '\/api\/generateSceneDescriptions'\], aiLimiter\)/.test(src));
  assert.ok(src.indexOf("['/api/generateVideoStylePrompts', '/api/generateSceneDescriptions'], aiLimiter") < src.indexOf("app.use('/api', videoStylePromptRoutes)"));
});
