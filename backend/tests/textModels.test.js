const test = require('node:test');
const assert = require('node:assert');

process.env.OPENAI_API_KEY = 'test-key';
delete process.env.TEXT_MODEL_ENGLISH; delete process.env.TEXT_MODEL_REGIONAL;
const { callOpenAI, callTextLLM, textModelFor, isRegionalLanguage } = require('../services/openAI');

test('English uses the English writer; anything regional or mixed uses the regional writer', () => {
  assert.strictEqual(textModelFor('English'), 'gpt-5.5');
  assert.strictEqual(textModelFor(''), 'gpt-5.5');
  assert.strictEqual(textModelFor('tamil'), 'gpt-6.1-sol');
  assert.strictEqual(textModelFor('Tamil'), 'gpt-6.1-sol');
  assert.strictEqual(textModelFor('tamil_english_mix'), 'gpt-6.1-sol');
  assert.strictEqual(isRegionalLanguage('english'), false);
});

test('current model families get max_completion_tokens and no temperature; old ones keep the old fields', async () => {
  const bodies = [];
  const real = global.fetch;
  global.fetch = async (url, opts) => { bodies.push(JSON.parse(opts.body)); return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) }; };
  try {
    await callOpenAI('hi', { model: 'gpt-5.5', maxTokens: 1000, temperature: 0.2 });
    await callOpenAI('hi', { model: 'gpt-4o', maxTokens: 1000, temperature: 0.2 });
  } finally { global.fetch = real; }
  assert.strictEqual(bodies[0].max_completion_tokens, 4000);
  assert.strictEqual(bodies[0].temperature, undefined);
  assert.strictEqual(bodies[0].max_tokens, undefined);
  assert.strictEqual(bodies[0].reasoning_effort, 'low');
  assert.strictEqual(bodies[1].max_tokens, 1000);
  assert.strictEqual(bodies[1].temperature, 0.2);
  assert.strictEqual(bodies[1].reasoning_effort, undefined);
});

test('a model that rejects reasoning_effort is asked again without it', async () => {
  const bodies = [];
  const real = global.fetch;
  global.fetch = async (url, opts) => {
    const b = JSON.parse(opts.body); bodies.push(b);
    if (b.reasoning_effort) {
      const text = JSON.stringify({ error: { message: 'Unsupported parameter: reasoning_effort' } });
      return { ok: false, status: 400, text: async () => text, clone() { return { text: async () => text }; } };
    }
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'fine' } }] }) };
  };
  try {
    const out = await callTextLLM('hi', { language: 'tamil' });
    assert.strictEqual(out, 'fine');
  } finally { global.fetch = real; }
  assert.strictEqual(bodies.length, 2);
  assert.strictEqual(bodies[0].model, 'gpt-6.1-sol');
  assert.strictEqual(bodies[1].reasoning_effort, undefined);
});
