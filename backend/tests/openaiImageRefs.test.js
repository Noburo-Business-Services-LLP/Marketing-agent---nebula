const test = require('node:test');
const assert = require('node:assert');

process.env.OPENAI_API_KEY = 'test-key';
const imageUploader = require.resolve('../services/imageUploader');
require.cache[imageUploader] = { id: imageUploader, filename: imageUploader, loaded: true, exports: { uploadBase64Image: async () => ({ success: false }) } };
const { generateOpenAIImage, referencesFromParts } = require('../services/openaiImage');

const PNG = Buffer.from('iVBORw0KGgo=', 'base64').toString('base64');

test('referencesFromParts keeps inline images only and caps the count', () => {
  const parts = [{ text: 'hi' }, ...Array.from({ length: 9 }, () => ({ inlineData: { mimeType: 'image/png', data: PNG } })), { inline_data: { mime_type: 'image/jpeg', data: PNG } }];
  const refs = referencesFromParts(parts);
  assert.strictEqual(refs.length, 6);
  assert.strictEqual(refs[0].mimeType, 'image/png');
  assert.deepStrictEqual(referencesFromParts(null), []);
});

test('with references the edit endpoint is used with every photo attached', async () => {
  const calls = [];
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => { calls.push({ url, opts }); return { ok: true, json: async () => ({ data: [{ b64_json: PNG }] }) }; };
  try {
    const out = await generateOpenAIImage('a scene', { aspectRatio: '9:16', references: [{ mimeType: 'image/png', data: PNG }, { mimeType: 'image/jpeg', data: PNG }] });
    assert.strictEqual(out.success, true);
    assert.match(calls[0].url, /images\/edits$/);
    assert.ok(calls[0].opts.body instanceof FormData);
    assert.strictEqual(calls[0].opts.body.getAll('image[]').length, 2);
    assert.strictEqual(calls[0].opts.body.get('size'), '1024x1536');
    assert.strictEqual(calls[0].opts.headers['Content-Type'], undefined);
  } finally { global.fetch = realFetch; }
});

test('without references the plain generation endpoint is used', async () => {
  const calls = [];
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => { calls.push({ url, opts }); return { ok: true, json: async () => ({ data: [{ b64_json: PNG }] }) }; };
  try {
    await generateOpenAIImage('a scene', { aspectRatio: '1:1' });
    assert.match(calls[0].url, /images\/generations$/);
  } finally { global.fetch = realFetch; }
});

test('the newest model is tried first and gpt-image-1 is used once if the account is refused', async () => {
  const models = [];
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    const model = JSON.parse(opts.body).model;
    models.push(model);
    if (model === 'gpt-image-2') {
      const body = JSON.stringify({ error: { message: 'The model `gpt-image-2` does not exist or you do not have access to it.' } });
      return { ok: false, status: 404, text: async () => body, clone() { return { text: async () => body }; } };
    }
    return { ok: true, status: 200, json: async () => ({ data: [{ b64_json: PNG }] }) };
  };
  try {
    const out = await generateOpenAIImage('a scene', { aspectRatio: '1:1' });
    assert.strictEqual(out.success, true);
    assert.deepStrictEqual(models, ['gpt-image-2', 'gpt-image-1']);
    assert.strictEqual(out.model, 'gpt-image-1');
  } finally { global.fetch = realFetch; }
});
