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
