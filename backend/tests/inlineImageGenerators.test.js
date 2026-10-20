'use strict';
// The generators no longer keep a base64 picture when storage fails in production (D101).
const test = require('node:test');
const assert = require('node:assert');

process.env.OPENAI_API_KEY = 'test-key';
const uploads = [];
let uploadAnswer = { success: false, error: 'down' };
const imageUploader = require.resolve('../services/imageUploader');
require.cache[imageUploader] = { id: imageUploader, filename: imageUploader, loaded: true, exports: { uploadBase64Image: async (d, f) => { uploads.push(f); return uploadAnswer; } } };
const { generateOpenAIImage } = require('../services/openaiImage');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUg==', 'base64').toString('base64');
const KEYS = ['NODE_ENV', 'INLINE_IMAGE_MODE', 'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];

async function withEnv(env, fn) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  const realFetch = global.fetch;
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
  global.fetch = async () => ({ ok: true, json: async () => ({ data: [{ b64_json: PNG }] }) });
  try { return await fn(); } finally {
    global.fetch = realFetch;
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}
const CONF = { CLOUDINARY_CLOUD_NAME: 'c', CLOUDINARY_API_KEY: 'k', CLOUDINARY_API_SECRET: 's' };

test('production, upload fails: the call fails, flagged storageFailed, no base64 link', async () => {
  uploadAnswer = { success: false, error: 'down' };
  const out = await withEnv({ NODE_ENV: 'production', ...CONF }, () => generateOpenAIImage('a scene', { aspectRatio: '1:1' }));
  assert.strictEqual(out.success, false);
  assert.strictEqual(out.storageFailed, true);
  assert.ok(!out.imageUrl);
});

test('production, upload works: the stored https link', async () => {
  uploadAnswer = { success: true, url: 'https://res.cloudinary.com/x/a.png', publicId: 'a' };
  const out = await withEnv({ NODE_ENV: 'production', ...CONF }, () => generateOpenAIImage('a scene', { aspectRatio: '1:1' }));
  assert.strictEqual(out.success, true);
  assert.strictEqual(out.imageUrl, 'https://res.cloudinary.com/x/a.png');
});

test('production without storage keys: fails cleanly', async () => {
  const out = await withEnv({ NODE_ENV: 'production' }, () => generateOpenAIImage('a scene', { aspectRatio: '1:1' }));
  assert.strictEqual(out.success, false);
  assert.strictEqual(out.storageFailed, true);
});

test('development without storage keys: keeps working with the data URI', async () => {
  const out = await withEnv({ NODE_ENV: 'development' }, () => generateOpenAIImage('a scene', { aspectRatio: '1:1' }));
  assert.strictEqual(out.success, true);
  assert.ok(out.imageUrl.startsWith('data:image/png;base64,'));
});

test('legacy switch: a failed upload keeps the base64 as before', async () => {
  uploadAnswer = { success: false, error: 'down' };
  const out = await withEnv({ NODE_ENV: 'production', INLINE_IMAGE_MODE: 'legacy', ...CONF }, () => generateOpenAIImage('a scene', { aspectRatio: '1:1' }));
  assert.strictEqual(out.success, true);
  assert.ok(out.imageUrl.startsWith('data:image/png;base64,'));
});
