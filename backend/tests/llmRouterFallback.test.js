const test = require('node:test');
const assert = require('node:assert');
const router = require('../services/llmRouter');

const QUOTA = { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'You exceeded your current quota. Quota exceeded for metric ... model: gemini-2.5-pro' } };
const OK = (t) => ({ candidates: [{ content: { parts: [{ text: t }] } }] });

function fakeFetch(plan) {
  const urls = [];
  const f = async (url) => {
    urls.push(url);
    const model = /models\/([^:]+):/.exec(url)[1];
    const [status, body] = plan[model];
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  f.urls = urls;
  return f;
}
const modelsOf = (f) => f.urls.map((u) => /models\/([^:]+):/.exec(u)[1]);

let logs = [];
const origLog = console.log;
test.beforeEach(() => { logs = []; console.log = (m) => logs.push(String(m)); delete process.env.GEMINI_PRO_MODEL;
  // These tests describe the 2.5 chain; the new default chain is covered in llmRouterModels.test.js.
  process.env.GEMINI_TEXT_MODELS = 'gemini-2.5-pro,gemini-2.5-flash,gemini-2.5-flash-lite'; });
test.afterEach(() => { console.log = origLog; });

test('pro quota then flash ok gives the flash answer and logs the fallback', async () => {
  const f = fakeFetch({ 'gemini-2.5-pro': [429, QUOTA], 'gemini-2.5-flash': [200, OK('hello')] });
  router._setTestHooks({ fetch: f });
  assert.strictEqual(await router.callGemini('p', { taskType: 't' }), 'hello');
  assert.deepStrictEqual(modelsOf(f), ['gemini-2.5-pro', 'gemini-2.5-flash']);
  const joined = logs.join('\n');
  assert.match(joined, /llm_fallback/);
  assert.match(joined, /"model":"gemini-2.5-flash"/);
  assert.ok(!joined.includes('key='));
});

test('pro and flash quota then flash-lite ok', async () => {
  const f = fakeFetch({ 'gemini-2.5-pro': [429, QUOTA], 'gemini-2.5-flash': [429, QUOTA], 'gemini-2.5-flash-lite': [200, OK('lite')] });
  router._setTestHooks({ fetch: f });
  assert.strictEqual(await router.callGemini('p', {}), 'lite');
  assert.deepStrictEqual(modelsOf(f), ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite']);
});

test('all three failing gives the final error', async () => {
  const f = fakeFetch({ 'gemini-2.5-pro': [429, QUOTA], 'gemini-2.5-flash': [404, { error: { message: 'model not found' } }], 'gemini-2.5-flash-lite': [429, { error: { message: 'lite quota' } }] });
  router._setTestHooks({ fetch: f });
  await assert.rejects(router.callGemini('p', {}), /lite quota/);
});

test('403 PERMISSION_DENIED falls back', async () => {
  const f = fakeFetch({ 'gemini-2.5-pro': [403, { error: { status: 'PERMISSION_DENIED', message: 'no access to model' } }], 'gemini-2.5-flash': [200, OK('ok')] });
  router._setTestHooks({ fetch: f });
  assert.strictEqual(await router.callGemini('p', {}), 'ok');
});

test('unavailable memory skips pro and expires after 10 minutes', async () => {
  let now = 1000;
  const f = fakeFetch({ 'gemini-2.5-pro': [429, QUOTA], 'gemini-2.5-flash': [200, OK('a')] });
  router._setTestHooks({ fetch: f, now: () => now });
  await router.callGemini('p', {});
  assert.deepStrictEqual(modelsOf(f), ['gemini-2.5-pro', 'gemini-2.5-flash']);
  f.urls.length = 0;
  now += 9 * 60 * 1000;
  await router.callGemini('p', {});
  assert.deepStrictEqual(modelsOf(f), ['gemini-2.5-flash']);
  f.urls.length = 0;
  now += 2 * 60 * 1000;
  await router.callGemini('p', {});
  assert.deepStrictEqual(modelsOf(f), ['gemini-2.5-pro', 'gemini-2.5-flash']);
});

test('a bad request is not retried on another model', async () => {
  const f = fakeFetch({ 'gemini-2.5-pro': [400, { error: { message: 'bad request' } }], 'gemini-2.5-flash': [200, OK('x')] });
  router._setTestHooks({ fetch: f });
  await assert.rejects(router.callGemini('p', {}), /bad request/);
  assert.deepStrictEqual(modelsOf(f), ['gemini-2.5-pro']);
});

test('invalid JSON is not retried on another model', async () => {
  const f = fakeFetch({ 'gemini-2.5-pro': [200, OK('not json')], 'gemini-2.5-flash': [200, OK('{}')] });
  router._setTestHooks({ fetch: f });
  await assert.rejects(router.generateWithLLM({ provider: 'gemini', taskType: 't', prompt: 'p', jsonSchema: { required: ['a'] } }), /valid JSON/);
  assert.ok(modelsOf(f).every((m) => m === 'gemini-2.5-pro'));
});

test('GEMINI_PRO_MODEL overrides the primary model', async () => {
  delete process.env.GEMINI_TEXT_MODELS; // default chain: current lite first, then the pro slot
  process.env.GEMINI_PRO_MODEL = 'gemini-2.5-flash';
  const f = fakeFetch({ 'gemini-3.5-flash-lite': [404, { error: { message: 'is no longer available to new users' } }], 'gemini-2.5-flash': [200, OK('x')] });
  router._setTestHooks({ fetch: f });
  await router.callGemini('p', {});
  assert.deepStrictEqual(modelsOf(f), ['gemini-3.5-flash-lite', 'gemini-2.5-flash']);
});
