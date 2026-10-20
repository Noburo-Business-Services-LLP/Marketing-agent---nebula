'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createImageStore, ImageStoreError, isDataUri } = require('../services/imageStore');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3, 4]);
const pngUri = `data:image/png;base64,${PNG.toString('base64')}`;
const svgUri = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64')}`;
const htmlAsPng = `data:image/png;base64,${Buffer.from('<html><script>alert(1)</script></html>').toString('base64')}`;
const CONFIGURED = { CLOUDINARY_CLOUD_NAME: 'c', CLOUDINARY_API_KEY: 'k', CLOUDINARY_API_SECRET: 's' };

function fakeUpload(result = { success: true, url: 'https://res.cloudinary.com/x/image/upload/v1/a.png', publicId: 'a' }) {
  const calls = [];
  const fn = async (data, folder) => { calls.push({ data, folder }); return typeof result === 'function' ? result(data) : result; };
  fn.calls = calls;
  return fn;
}

test('stores a png data URI and returns the https link', async () => {
  const upload = fakeUpload();
  const store = createImageStore({ upload, env: { NODE_ENV: 'production', ...CONFIGURED } });
  const out = await store.storeImage(pngUri, { folder: 'f' });
  assert.deepStrictEqual(out, { url: 'https://res.cloudinary.com/x/image/upload/v1/a.png', stored: true, publicId: 'a' });
  assert.strictEqual(upload.calls.length, 1);
  assert.strictEqual(upload.calls[0].folder, 'f');
});

test('a Buffer is stored as a data URI of its sniffed type', async () => {
  const upload = fakeUpload();
  const store = createImageStore({ upload, env: CONFIGURED });
  await store.storeImage(PNG);
  assert.ok(upload.calls[0].data.startsWith('data:image/png;base64,'));
});

test('an https link is returned unchanged without an upload', async () => {
  const upload = fakeUpload();
  const store = createImageStore({ upload, env: CONFIGURED });
  const out = await store.storeImage('https://res.cloudinary.com/x/a.png');
  assert.deepStrictEqual(out, { url: 'https://res.cloudinary.com/x/a.png', stored: false });
  assert.strictEqual(upload.calls.length, 0);
});

test('SVG is refused, HTML disguised as png is refused, nothing uploaded', async () => {
  const upload = fakeUpload();
  const store = createImageStore({ upload, env: CONFIGURED });
  await assert.rejects(store.storeImage(svgUri), (e) => e instanceof ImageStoreError && e.code === 'type');
  await assert.rejects(store.storeImage(htmlAsPng), (e) => e instanceof ImageStoreError && e.code === 'type');
  await assert.rejects(store.storeImage('javascript:alert(1)'), (e) => e instanceof ImageStoreError && e.code === 'type');
  assert.strictEqual(upload.calls.length, 0);
});

test('a picture over the size limit is refused', async () => {
  const upload = fakeUpload();
  const store = createImageStore({ upload, env: { ...CONFIGURED, IMAGE_STORE_MAX_BYTES: '10' } });
  await assert.rejects(store.storeImage(pngUri), (e) => e.code === 'size');
  assert.strictEqual(upload.calls.length, 0);
});

test('not configured: development and test keep the data URI; production throws', async () => {
  for (const NODE_ENV of ['development', 'test', undefined]) {
    const store = createImageStore({ env: { NODE_ENV } });
    assert.strictEqual(store.isConfigured(), false);
    assert.deepStrictEqual(await store.storeImage(pngUri), { url: pngUri, stored: false, inline: true });
  }
  const prod = createImageStore({ env: { NODE_ENV: 'production' } });
  await assert.rejects(prod.storeImage(pngUri), (e) => e instanceof ImageStoreError && e.code === 'not_configured');
});

test('an upload failure throws (development too), never returns base64', async () => {
  for (const NODE_ENV of ['development', 'production']) {
    const store = createImageStore({ upload: fakeUpload({ success: false, error: 'boom' }), env: { NODE_ENV, ...CONFIGURED } });
    await assert.rejects(store.storeImage(pngUri), (e) => e.code === 'upload_failed');
  }
  const throwing = createImageStore({ upload: async () => { throw new Error('net'); }, env: CONFIGURED });
  await assert.rejects(throwing.storeImage(pngUri), (e) => e.code === 'upload_failed');
});

test('an upload that answers a non-https link is a failure', async () => {
  const store = createImageStore({ upload: fakeUpload({ success: true, url: 'http://insecure/a.png' }), env: CONFIGURED });
  await assert.rejects(store.storeImage(pngUri), (e) => e.code === 'upload_failed');
});

test('legacy mode: a failed upload keeps the data URI (the emergency switch)', async () => {
  const store = createImageStore({ upload: fakeUpload({ success: false }), env: { NODE_ENV: 'production', INLINE_IMAGE_MODE: 'legacy', ...CONFIGURED } });
  assert.deepStrictEqual(await store.storeImage(pngUri), { url: pngUri, stored: false, inline: true });
  const unconfigured = createImageStore({ env: { NODE_ENV: 'production', INLINE_IMAGE_MODE: 'legacy' } });
  assert.strictEqual((await unconfigured.storeImage(pngUri)).url, pngUri);
});

test('finishGeneratedImage: ok with the link, or a customer-safe failure flagged storageFailed', async () => {
  const ok = createImageStore({ upload: fakeUpload(), env: CONFIGURED });
  assert.deepStrictEqual(await ok.finishGeneratedImage(pngUri, { folder: 'f' }), { ok: true, url: 'https://res.cloudinary.com/x/image/upload/v1/a.png', stored: true });
  const bad = createImageStore({ upload: fakeUpload({ success: false, error: 'Cloudinary said no: key abc' }), env: { NODE_ENV: 'production', ...CONFIGURED } });
  const out = await bad.finishGeneratedImage(pngUri);
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.storageFailed, true);
  assert.ok(!/cloudinary|key/i.test(out.error), 'no provider wording for customers');
  const dev = createImageStore({ env: { NODE_ENV: 'development' } });
  assert.deepStrictEqual(await dev.finishGeneratedImage(pngUri), { ok: true, url: pngUri, stored: false });
});

test('an injected upload counts as configured (tests and the migration fake)', () => {
  assert.strictEqual(createImageStore({ upload: fakeUpload(), env: {} }).isConfigured(), true);
});

test('isDataUri', () => {
  assert.strictEqual(isDataUri(pngUri), true);
  assert.strictEqual(isDataUri(' data:image/png;base64,AAA'), true);
  assert.strictEqual(isDataUri('https://x/y.png'), false);
  assert.strictEqual(isDataUri(null), false);
});
