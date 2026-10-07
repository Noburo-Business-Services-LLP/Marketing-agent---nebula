const test = require('node:test');
const assert = require('node:assert');
const gemini = require('../services/geminiAI');
const textModels = require('../services/geminiTextModels');

const GONE = { error: { code: 404, status: 'NOT_FOUND', message: 'This model models/gemini-2.5-flash-lite is no longer available to new users. Please update your code to use models/gemini-3.5-flash-lite.' } };
const OK = (t) => ({ candidates: [{ content: { parts: [{ text: t }] } }] });
const modelOf = (url) => /models\/([^:?]+)/.exec(url)[1];

const realFetch = global.fetch;
const origLog = console.log, origErr = console.error;
let seen;
function installFetch(plan) {
  seen = [];
  global.fetch = async (url) => {
    seen.push(modelOf(String(url)));
    const [status, body] = plan[modelOf(String(url))] || [404, GONE];
    return { ok: status < 300, status, json: async () => body };
  };
}
test.beforeEach(() => {
  console.log = () => {}; console.error = () => {};
  delete process.env.GEMINI_TEXT_MODELS; delete process.env.GEMINI_PRO_MODEL;
  textModels._resetRetiredModels();
});
test.afterEach(() => { global.fetch = realFetch; console.log = origLog; console.error = origErr; });

test('callGemini starts on the current lite model and moves on from a 404 to the next one', async () => {
  installFetch({ 'gemini-3.5-flash-lite': [404, GONE], 'gemini-2.5-flash-lite': [200, OK('hi')] });
  assert.strictEqual(await gemini.callGemini('geminiAi-chain-1', { skipCache: true }), 'hi');
  assert.deepStrictEqual(seen, ['gemini-3.5-flash-lite', 'gemini-2.5-flash-lite']);
});

test('callGemini follows GEMINI_TEXT_MODELS and remembers a retired model', async () => {
  process.env.GEMINI_TEXT_MODELS = 'old-one,new-one';
  installFetch({ 'old-one': [404, GONE], 'new-one': [200, OK('hi')] });
  await gemini.callGemini('geminiAi-chain-2', { skipCache: true });
  seen.length = 0;
  await gemini.callGemini('geminiAi-chain-3', { skipCache: true });
  assert.deepStrictEqual(seen, ['new-one']);
});

test('the "no longer available" message with a non-404 code also moves on', async () => {
  process.env.GEMINI_TEXT_MODELS = 'old-one,new-one';
  installFetch({ 'old-one': [400, { error: { code: 400, message: 'This model is no longer available to new users.' } }], 'new-one': [200, OK('hi')] });
  assert.strictEqual(await gemini.callGemini('geminiAi-chain-4', { skipCache: true }), 'hi');
});

test('vision helpers use the shared chain instead of a fixed retired model', async () => {
  installFetch({ 'gemini-3.5-flash-lite': [200, OK('{"hairStyle":"short"}')] });
  const out = await gemini.extractCharacterVisualTraits('data:image/png;base64,AAAA');
  assert.deepStrictEqual(out, { hairStyle: 'short' });
  assert.deepStrictEqual(seen, ['gemini-3.5-flash-lite']);
});

test('vision helper moves to the next model when the first is gone', async () => {
  installFetch({ 'gemini-3.5-flash-lite': [404, GONE], 'gemini-2.5-flash-lite': [200, OK('{"detected":false}')] });
  const out = await gemini.detectLogoInImage('data:image/png;base64,AAAA');
  assert.strictEqual(out.success, true);
  assert.deepStrictEqual(seen, ['gemini-3.5-flash-lite', 'gemini-2.5-flash-lite']);
});
