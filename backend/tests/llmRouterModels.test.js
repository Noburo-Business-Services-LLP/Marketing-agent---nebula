const test = require('node:test');
const assert = require('node:assert');
const router = require('../services/llmRouter');
const models = require('../services/geminiTextModels');

const GONE = { error: { code: 404, status: 'NOT_FOUND', message: 'This model models/gemini-2.5-flash-lite is no longer available to new users. Please update your code to use models/gemini-3.5-flash-lite for the latest features and improvements.' } };
const QUOTA = { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded' } };
const OK = (t) => ({ candidates: [{ content: { parts: [{ text: t }] } }] });
const modelOf = (url) => /models\/([^:]+):/.exec(url)[1];

// plan: model -> [status, body]; unknown models answer "gone".
function fakeFetch(plan) {
  const calls = [];
  const f = async (url, opts) => {
    calls.push(url);
    if (/api\.openai\.com/.test(url)) {
      const [status, body] = plan.openai || [500, { error: { message: 'no openai plan' } }];
      return { ok: status < 300, status, json: async () => body };
    }
    const [status, body] = plan[modelOf(url)] || [404, GONE];
    return { ok: status < 300, status, json: async () => body };
  };
  f.calls = calls;
  f.models = () => calls.filter((u) => !/openai/.test(u)).map(modelOf);
  return f;
}

const origLog = console.log;
const origWarn = console.warn;
test.beforeEach(() => {
  console.log = () => {}; console.warn = () => {};
  delete process.env.GEMINI_PRO_MODEL; delete process.env.GEMINI_TEXT_MODELS; delete process.env.OPENAI_API_KEY;
  router._setTestHooks({});
});
test.afterEach(() => { console.log = origLog; console.warn = origWarn; });

test('default chain starts with the current lite model and keeps the 2.5 chain after it', () => {
  assert.deepStrictEqual(models.getTextModelChain(), ['gemini-3.5-flash-lite', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite']);
});

test('GEMINI_PRO_MODEL still replaces the pro slot', () => {
  process.env.GEMINI_PRO_MODEL = 'gemini-3-pro';
  assert.deepStrictEqual(models.getTextModelChain(), ['gemini-3.5-flash-lite', 'gemini-3-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite']);
});

test('GEMINI_TEXT_MODELS overrides the default, trims, drops blanks and duplicates', () => {
  process.env.GEMINI_TEXT_MODELS = ' model-a , ,model-b,model-a ';
  assert.deepStrictEqual(models.getTextModelChain(), ['model-a', 'model-b']);
});

test('the provider "no longer available to new users" message moves to the next model', async () => {
  process.env.GEMINI_TEXT_MODELS = 'gemini-2.5-flash-lite,gemini-3.5-flash-lite';
  const f = fakeFetch({ 'gemini-2.5-flash-lite': [404, GONE], 'gemini-3.5-flash-lite': [200, OK('fresh')] });
  router._setTestHooks({ fetch: f });
  assert.strictEqual(await router.callGemini('p', { taskType: 't' }), 'fresh');
  assert.deepStrictEqual(f.models(), ['gemini-2.5-flash-lite', 'gemini-3.5-flash-lite']);
});

test('the same message with a non-404 status still advances', async () => {
  process.env.GEMINI_TEXT_MODELS = 'old,new';
  const f = fakeFetch({ old: [400, GONE], new: [200, OK('ok')] });
  router._setTestHooks({ fetch: f });
  assert.strictEqual(await router.callGemini('p', {}), 'ok');
});

test('a model that is gone is skipped on later calls, for the life of the process', async () => {
  process.env.GEMINI_TEXT_MODELS = 'old,new';
  const f = fakeFetch({ old: [404, GONE], new: [200, OK('ok')] });
  let now = 1000;
  router._setTestHooks({ fetch: f, now: () => now });
  await router.callGemini('p', {});
  f.calls.length = 0;
  now += 3 * 60 * 60 * 1000;
  await router.callGemini('p', {});
  assert.deepStrictEqual(f.models(), ['new']);
});

test('a quota error is not permanent: the model is tried again once the 10 minute memory ends', async () => {
  process.env.GEMINI_TEXT_MODELS = 'q,new';
  process.env.GEMINI_PRO_MODEL = 'q';
  const f = fakeFetch({ q: [429, QUOTA], new: [200, OK('ok')] });
  let now = 1000;
  router._setTestHooks({ fetch: f, now: () => now });
  await router.callGemini('p', {});
  f.calls.length = 0;
  now += 11 * 60 * 1000;
  await router.callGemini('p', {});
  assert.deepStrictEqual(f.models(), ['q', 'new']);
});

test('when every model fails the final error is clear and names what was tried', async () => {
  process.env.GEMINI_TEXT_MODELS = 'a,b';
  const f = fakeFetch({ a: [404, GONE], b: [404, GONE] });
  router._setTestHooks({ fetch: f });
  await assert.rejects(router.callGemini('p', {}), (e) => {
    assert.match(e.message, /no longer available/);
    assert.deepStrictEqual(e.triedModels, ['a', 'b']);
    return true;
  });
});

test('if every model is remembered as gone the chain is still tried once so the error is real', async () => {
  process.env.GEMINI_TEXT_MODELS = 'a';
  const f = fakeFetch({ a: [404, GONE] });
  router._setTestHooks({ fetch: f });
  await assert.rejects(router.callGemini('p', {}), /no longer available/);
  f.calls.length = 0;
  await assert.rejects(router.callGemini('p', {}), /no longer available/);
  assert.deepStrictEqual(f.models(), ['a']);
});

// ---- text fallback to OpenAI -------------------------------------------------

const OPENAI_OK = (t) => [200, { choices: [{ message: { content: t } }] }];

test('with textFallback, a Gemini failure falls back to OpenAI when a key is configured', async () => {
  process.env.GEMINI_TEXT_MODELS = 'a';
  process.env.OPENAI_API_KEY = 'test-key-not-real';
  const f = fakeFetch({ a: [404, GONE], openai: OPENAI_OK('<div>from openai</div>') });
  router._setTestHooks({ fetch: f });
  const out = await router.generateWithLLM({ provider: 'gemini', taskType: 't', prompt: 'p', textFallback: true });
  assert.strictEqual(out, '<div>from openai</div>');
});

test('without textFallback there is no OpenAI call', async () => {
  process.env.GEMINI_TEXT_MODELS = 'a';
  process.env.OPENAI_API_KEY = 'test-key-not-real';
  const f = fakeFetch({ a: [404, GONE], openai: OPENAI_OK('x') });
  router._setTestHooks({ fetch: f });
  await assert.rejects(router.generateWithLLM({ provider: 'gemini', taskType: 't', prompt: 'p' }), /LLM gemini failed/);
  assert.ok(!f.calls.some((u) => /openai/.test(u)));
});

test('textFallback without an OpenAI key keeps the Gemini error', async () => {
  process.env.GEMINI_TEXT_MODELS = 'a';
  const f = fakeFetch({ a: [404, GONE] });
  router._setTestHooks({ fetch: f });
  await assert.rejects(router.generateWithLLM({ provider: 'gemini', taskType: 't', prompt: 'p', textFallback: true }), /LLM gemini failed.*no longer available/);
});

test('when Gemini and OpenAI both fail the error mentions both', async () => {
  process.env.GEMINI_TEXT_MODELS = 'a';
  process.env.OPENAI_API_KEY = 'test-key-not-real';
  const f = fakeFetch({ a: [404, GONE], openai: [500, { error: { message: 'openai down' } }] });
  router._setTestHooks({ fetch: f });
  await assert.rejects(router.generateWithLLM({ provider: 'gemini', taskType: 't', prompt: 'p', textFallback: true }), /no longer available[\s\S]*openai down/);
});

test('the OpenAI request never puts the key in the URL', async () => {
  process.env.GEMINI_TEXT_MODELS = 'a';
  process.env.OPENAI_API_KEY = 'test-key-not-real';
  const f = fakeFetch({ a: [404, GONE], openai: OPENAI_OK('x') });
  router._setTestHooks({ fetch: f });
  await router.generateWithLLM({ provider: 'gemini', taskType: 't', prompt: 'p', textFallback: true });
  assert.ok(f.calls.filter((u) => /openai/.test(u)).every((u) => !u.includes('test-key')));
});
