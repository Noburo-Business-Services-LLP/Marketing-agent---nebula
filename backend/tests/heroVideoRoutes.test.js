const test = require('node:test');
const assert = require('node:assert');
const { createHeroVideoRouter, normalizePlan } = require('../routes/heroVideo');
const router = require('../routes/heroVideo');

function routes(r) {
  return r.stack.filter((l) => l.route).map((l) => ({
    path: l.route.path,
    methods: Object.keys(l.route.methods),
    names: l.route.stack.map((s) => s.name),
    handlers: l.route.stack.map((s) => s.handle)
  }));
}

test('router exposes the five routes with protect first', () => {
  const found = routes(router.router || router);
  const key = (r) => `${r.methods[0]} ${r.path}`;
  assert.deepStrictEqual(found.map(key).sort(), ['get /jobs', 'get /jobs/:jobId', 'get /quota', 'post /generate', 'post /plan']);
  for (const r of found) assert.strictEqual(r.names[0], 'protect', key(r));
  for (const r of found.filter((x) => x.path === '/plan' || x.path === '/generate')) {
    assert.ok(r.names.includes('checkTrial'), key(r));
  }
});

test('normalizePlan', () => {
  assert.strictEqual(normalizePlan(null), null);
  assert.strictEqual(normalizePlan({ prompt: '   ' }), null);
  assert.strictEqual(normalizePlan({}), null);
  const p = normalizePlan({ prompt: '  hi ', beatSheet: 'x', qaChecklist: 5, assumptions: null, dialogue: 7 });
  assert.deepStrictEqual(p, { prompt: 'hi', beatSheet: [], dialogue: '', qaChecklist: [], assumptions: [] });
  const q = normalizePlan({ prompt: 'a', dialogue: ' yo ', beatSheet: [{ time: ' 0-3s ', beat: ' open ' }], qaChecklist: [' a '], assumptions: [' b '] });
  assert.deepStrictEqual(q.beatSheet, [{ time: '0-3s', beat: 'open' }]);
  assert.strictEqual(q.dialogue, 'yo');
  assert.deepStrictEqual(q.qaChecklist, ['a']);
  assert.deepStrictEqual(q.assumptions, ['b']);
});

// ---- /plan handler via injected deps ----
function mkRes() {
  return { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
}
function planHandler(deps) {
  const r = routes(createHeroVideoRouter(deps)).find((x) => x.path === '/plan');
  return r.handlers[r.handlers.length - 1];
}
function mkDeps(over = {}) {
  const calls = {};
  return {
    calls,
    deps: {
      buildPrompt: async (uid, key, vars) => { calls.build = { uid, key, vars }; return 'PROMPT'; },
      callTextLLM: async (p, o) => { calls.llm = { p, o }; return '{"prompt":" Shot ","beatSheet":[{"time":"0s","beat":"x"}]}'; },
      parseGeminiJSON: (s) => JSON.parse(s),
      findUser: async () => ({ businessProfile: { name: 'Gravity', industry: 'SaaS', brandVoice: ['bold', 'warm'] } }),
      ...over
    }
  };
}
const concept = { title: 'T', storySummary: 'S', coreEmotion: 'E', visualStyle: 'V' };
const reqOf = (body) => ({ user: { id: 'u1' }, body });

test('/plan missing concept -> 400', async () => {
  const { deps } = mkDeps();
  const res = mkRes();
  await planHandler(deps)(reqOf({}), res);
  assert.strictEqual(res.code, 400);
});

test('/plan bad aspect -> 400', async () => {
  const { deps } = mkDeps();
  const res = mkRes();
  await planHandler(deps)(reqOf({ concept, aspectRatio: '4:3' }), res);
  assert.strictEqual(res.code, 400);
});

test('/plan no prompt from model -> 502', async () => {
  const { deps } = mkDeps({ callTextLLM: async () => '{"prompt":""}' });
  const res = mkRes();
  await planHandler(deps)(reqOf({ concept }), res);
  assert.strictEqual(res.code, 502);
});

test('/plan LLM throws -> 500', async () => {
  const { deps } = mkDeps({ callTextLLM: async () => { throw new Error('boom'); } });
  const res = mkRes();
  await planHandler(deps)(reqOf({ concept }), res);
  assert.strictEqual(res.code, 500);
  assert.strictEqual(res.body.success, false);
});

test('/plan happy path with descriptive hasReferences', async () => {
  const { deps, calls } = mkDeps();
  const res = mkRes();
  await planHandler(deps)(reqOf({ concept, refImageUrls: ['https://a/1.png', 'https://a/2.png'] }), res);
  assert.strictEqual(res.code, 200);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(res.body.plan.prompt, 'Shot');
  assert.deepStrictEqual(res.body.plan.qaChecklist, []);
  assert.strictEqual(calls.build.key, 'hero_video.plan');
  assert.strictEqual(calls.build.vars.hasReferences, 'Yes - 2 reference images, tagged @image1, @image2');
  assert.strictEqual(calls.build.vars.aspectRatio, '9:16');
  assert.strictEqual(calls.build.vars.conceptTitle, 'T');
  assert.match(calls.build.vars.brandContextBlock, /Gravity/);
  assert.deepStrictEqual(calls.llm.o, { jsonMode: true, maxTokens: 3000 });

  const res2 = mkRes();
  await planHandler(deps)(reqOf({ concept }), res2);
  assert.strictEqual(calls.build.vars.hasReferences, 'No reference images');
});

test('/plan CastError -> 404', async () => {
  const { deps } = mkDeps({ findUser: async () => { const e = new Error('x'); e.name = 'CastError'; throw e; } });
  const res = mkRes();
  await planHandler(deps)(reqOf({ concept }), res);
  assert.strictEqual(res.code, 404);
});

// ---- Ruling 7: jobs / generate / poll / middleware order ----
function routeHandler(impl, path, method) {
  const r = routes(createHeroVideoRouter(mkDeps().deps, impl)).find((x) => x.path === path && x.methods[0] === method);
  return r.handlers[r.handlers.length - 1];
}

test('GET /jobs returns only whitelisted fields and filters by owner + kind', async () => {
  let seen = null;
  const rows = [
    { jobId: 'a', status: 'completed', createdAt: 'T1', userId: 'u1', result: { videoUrl: 'http://v' }, payload: { prompt: 'P', refImageUrls: ['x'] }, metadata: { kind: 'hero', falRequestId: 'fal1' }, error: { stack: 'S' } },
    { jobId: 'b', status: 'failed', createdAt: 'T0', result: { videoUrl: 'http://no' }, payload: {}, metadata: { falRequestId: 'fal2' }, error: { message: 'm', stack: 'S2' } }
  ];
  const JobModel = { find(f) { seen = { filter: f }; const q = { sort(s) { seen.sort = s; return q; }, limit(n) { seen.limit = n; return q; }, lean: async () => rows }; return q; } };
  const res = mkRes();
  await routeHandler({ JobModel }, '/jobs', 'get')({ user: { id: 'u1' } }, res);
  assert.deepStrictEqual(seen, { filter: { userId: 'u1', 'metadata.kind': 'hero' }, sort: { createdAt: -1 }, limit: 20 });
  assert.deepStrictEqual(res.body.jobs, [
    { jobId: 'a', status: 'completed', createdAt: 'T1', videoUrl: 'http://v', prompt: 'P' },
    { jobId: 'b', status: 'failed', createdAt: 'T0' }
  ]);
  const text = JSON.stringify(res.body);
  for (const bad of ['falRequestId', 'metadata', 'payload', 'stack', 'fal1']) assert.ok(!text.includes(bad), bad);
});

test('GET /jobs/:jobId CastError -> 404', async () => {
  const pollHeroJob = async () => { const e = new Error('bad id'); e.name = 'CastError'; throw e; };
  const res = mkRes();
  await routeHandler({ pollHeroJob, deps: {} }, '/jobs/:jobId', 'get')({ user: { id: 'u1' }, params: { jobId: 'zzz' } }, res);
  assert.strictEqual(res.code, 404);
  assert.strictEqual(res.body.success, false);
});

test('POST /generate and poll send {status,json} verbatim', async () => {
  const out = { status: 403, json: { success: false, creditsExhausted: true, extra: 1 } };
  let args;
  const startHeroGeneration = async (d, a) => { args = { d, a }; return out; };
  const res = mkRes();
  await routeHandler({ startHeroGeneration, deps: { tag: 'D' } }, '/generate', 'post')({ user: { id: 'u1' }, body: { prompt: 'p' } }, res);
  assert.strictEqual(res.code, 403);
  assert.deepStrictEqual(res.body, out.json);
  assert.deepStrictEqual(args, { d: { tag: 'D' }, a: { userId: 'u1', body: { prompt: 'p' } } });
  const pollHeroJob = async () => ({ status: 202, json: { success: true, status: 'processing' } });
  const res2 = mkRes();
  await routeHandler({ pollHeroJob, deps: {} }, '/jobs/:jobId', 'get')({ user: { id: 'u1' }, params: { jobId: 'j' } }, res2);
  assert.strictEqual(res2.code, 202);
  assert.deepStrictEqual(res2.body, { success: true, status: 'processing' });
});

test('checkTrial before handler on exactly /plan and /generate; limiter on every route', () => {
  for (const r of routes(router)) {
    const idx = r.names.indexOf('checkTrial');
    const wants = r.path === '/plan' || r.path === '/generate';
    assert.strictEqual(idx !== -1, wants, r.path);
    if (wants) assert.ok(idx < r.names.length - 1 && idx > 0, r.path);
    assert.ok(r.names.length >= 3 && r.names[r.names.length - 2] !== 'protect' || r.names.length >= 3, r.path);
    assert.ok(r.names.slice(1, -1).some((n) => n !== 'checkTrial'), `limiter on ${r.path}`);
  }
});
