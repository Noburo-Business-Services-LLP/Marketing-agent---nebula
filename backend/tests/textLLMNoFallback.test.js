const test = require('node:test');
const assert = require('node:assert');

process.env.OPENAI_API_KEY = 'test-key';
const { callTextLLM } = require('../services/openAI');
const gemini = require('../services/geminiAI');

function withFakes({ openAiOk }, fn) {
  const realFetch = global.fetch;
  const realGemini = gemini.callGemini;
  const calls = { openai: 0, gemini: 0 };
  global.fetch = async () => {
    calls.openai++;
    return openAiOk
      ? { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'fine' } }] }) }
      : { ok: false, status: 500, text: async () => 'boom', clone() { return this; } };
  };
  gemini.callGemini = async () => { calls.gemini++; return 'from gemini'; };
  const restore = () => { global.fetch = realFetch; gemini.callGemini = realGemini; };
  return fn(calls).finally(restore);
}

test('with noFallback a failed OpenAI call throws and never calls Gemini or a second provider', () => withFakes({ openAiOk: false }, async (calls) => {
  await assert.rejects(() => callTextLLM('hi', { model: 'small-model', noFallback: true }), /OpenAI HTTP 500/);
  assert.strictEqual(calls.openai, 1, 'exactly one provider call');
  assert.strictEqual(calls.gemini, 0, 'no fallback call');
}));

test('without noFallback every other caller keeps today behaviour: a failure falls back to Gemini', () => withFakes({ openAiOk: false }, async (calls) => {
  const out = await callTextLLM('hi', { model: 'small-model' });
  assert.strictEqual(out, 'from gemini');
  assert.strictEqual(calls.gemini, 1);
}));

test('noFallback does not change a successful call', () => withFakes({ openAiOk: true }, async (calls) => {
  assert.strictEqual(await callTextLLM('hi', { model: 'small-model', noFallback: true }), 'fine');
  assert.strictEqual(calls.openai, 1);
  assert.strictEqual(calls.gemini, 0);
}));

test('onUsage receives the provider usage on a good reply and on an empty reply (which still throws)', async () => {
  const realFetch = global.fetch;
  try {
    let body;
    global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ usage: { prompt_tokens: 11, completion_tokens: 22 }, choices: [{ message: { content: body } }] }) });
    const seen = [];
    body = 'fine';
    assert.strictEqual(await callTextLLM('hi', { model: 'small-model', noFallback: true, onUsage: (u) => seen.push(u) }), 'fine');
    body = '';
    await assert.rejects(() => callTextLLM('hi', { model: 'small-model', noFallback: true, onUsage: (u) => seen.push(u) }), /empty content/);
    assert.deepStrictEqual(seen, [{ prompt_tokens: 11, completion_tokens: 22 }, { prompt_tokens: 11, completion_tokens: 22 }]);
  } finally { global.fetch = realFetch; }
});

test('maxOutputTokens is the limit actually sent: three times the answer budget, at least 4,000, for a thinking model', () => {
  const { maxOutputTokens } = require('../services/openAI');
  assert.strictEqual(maxOutputTokens('small-model', 1500), 4500);
  assert.strictEqual(maxOutputTokens('small-model', 100), 4000);
  assert.strictEqual(maxOutputTokens('gpt-4o', 1500), 1500);
});
