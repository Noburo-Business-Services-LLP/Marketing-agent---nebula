'use strict';
const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const { inlineImagesPlugin, processDocument, processUpdate, containsDataUri, lastKey } = require('../models/plugins/inlineImages');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString('base64');
const uri = (n = 1) => `data:image/png;base64,${PNG}${'A'.repeat(n * 4)}`;

function fakeStore({ fail = false } = {}) {
  const calls = [];
  return {
    calls,
    storeImage: async (d) => { calls.push(d); if (fail) { const e = new Error('down'); e.code = 'upload_failed'; throw e; } return { url: `https://cdn.test/${calls.length}.png`, stored: true }; },
    isConfigured: () => true
  };
}
const quiet = { error: () => {}, warn: () => {}, log: () => {} };

test('lastKey skips indexes and positional operators', () => {
  assert.strictEqual(lastKey('carouselSlides.$.imageUrl'), 'imageUrl');
  assert.strictEqual(lastKey('creative.imageUrls.0'), 'imageUrls');
  assert.strictEqual(lastKey('carouselSlides.$[s].imageUrl'), 'imageUrl');
});

test('containsDataUri only looks at picture keys', () => {
  assert.strictEqual(containsDataUri({ imageUrls: [uri()] }, 'creative'), true);
  assert.strictEqual(containsDataUri({ referenceImage: uri() }, 'generationProgress'), false);
  assert.strictEqual(containsDataUri(uri(), 'caption'), false);
});

test('Draft document: imageUrl, creative.imageUrls and slides are stored; the same picture is uploaded once', async () => {
  const Draft = require('../models/Draft');
  const same = uri(2);
  const d = new Draft({ userId: new mongoose.Types.ObjectId(), title: 't', sourceType: 'post', imageUrl: same, imageUrlNoLogo: 'https://cdn.test/clean.png',
    creative: { imageUrls: [same], captions: 'hi', reference: uri(3) }, carouselSlides: [{ order: 1, imageUrl: uri(4) }, { order: 2, imageUrl: '' }] });
  const store = fakeStore();
  const stats = await processDocument(d, { paths: ['imageUrl', 'imageUrlNoLogo', 'creative', 'carouselSlides'], store, logger: quiet });
  assert.strictEqual(store.calls.length, 2, 'the shared picture once, the slide once; non-picture keys untouched');
  assert.strictEqual(d.imageUrl, 'https://cdn.test/1.png');
  assert.deepStrictEqual(d.creative.imageUrls, ['https://cdn.test/1.png']);
  assert.strictEqual(d.creative.reference, uri(3), 'a non-picture key is left alone');
  assert.strictEqual(d.creative.captions, 'hi');
  assert.strictEqual(d.carouselSlides[0].imageUrl, 'https://cdn.test/2.png');
  assert.strictEqual(d.imageUrlNoLogo, 'https://cdn.test/clean.png');
  assert.strictEqual(stats.stored, 2);
});

test('Campaign document: creative.imageUrls stored', async () => {
  const Campaign = require('../models/Campaign');
  const c = new Campaign({ userId: new mongoose.Types.ObjectId(), name: 'c', creative: { type: 'image', imageUrls: [uri(), 'https://cdn.test/ok.png'] } });
  const store = fakeStore();
  await processDocument(c, { paths: ['creative'], store, logger: quiet });
  assert.deepStrictEqual([...c.creative.imageUrls], ['https://cdn.test/1.png', 'https://cdn.test/ok.png']);
});

test('a failed store keeps the value and never fails the write', async () => {
  const Draft = require('../models/Draft');
  const d = new Draft({ userId: new mongoose.Types.ObjectId(), title: 't', sourceType: 'post', imageUrl: uri() });
  const errors = [];
  const stats = await processDocument(d, { paths: ['imageUrl'], store: fakeStore({ fail: true }), logger: { error: (m) => errors.push(m) } });
  assert.strictEqual(d.imageUrl, uri());
  assert.strictEqual(stats.kept, 1);
  assert.ok(/kept a data URI \(upload_failed\)/.test(errors[0]));
});

test('an existing document: unmodified paths are not touched (no upload on an unrelated save)', async () => {
  const Draft = require('../models/Draft');
  const d = Draft.hydrate({ _id: new mongoose.Types.ObjectId(), userId: new mongoose.Types.ObjectId(), title: 't', sourceType: 'post', imageUrl: uri(), status: 'draft' });
  d.status = 'approved';
  const store = fakeStore();
  await processDocument(d, { paths: ['imageUrl', 'creative'], store, logger: quiet });
  assert.strictEqual(store.calls.length, 0);
});

test('update queries: $set, positional slide paths, top-level keys and $push $each', async () => {
  const store = fakeStore();
  const u = {
    imageUrl: uri(1),
    $set: { 'carouselSlides.$.imageUrl': uri(2), 'creative.imageUrls': [uri(3)], caption: 'x', 'generationProgress.ref': uri(5) },
    $push: { 'creative.imageUrls': { $each: [uri(4)] } }
  };
  await processUpdate(u, { paths: ['imageUrl', 'imageUrlNoLogo', 'creative', 'carouselSlides'], store, logger: quiet });
  assert.strictEqual(u.imageUrl, 'https://cdn.test/1.png');
  assert.strictEqual(u.$set['carouselSlides.$.imageUrl'], 'https://cdn.test/2.png');
  assert.deepStrictEqual(u.$set['creative.imageUrls'], ['https://cdn.test/3.png']);
  assert.deepStrictEqual(u.$push['creative.imageUrls'].$each, ['https://cdn.test/4.png']);
  assert.strictEqual(u.$set['generationProgress.ref'], uri(5), 'not a configured path');
  assert.strictEqual(u.$set.caption, 'x');
});

test('the hooks run through mongoose middleware and the legacy switch turns them off', async () => {
  const store = fakeStore();
  const schema = new mongoose.Schema({ imageUrl: String, creative: { imageUrls: [String] } });
  inlineImagesPlugin(schema, { paths: ['imageUrl', 'creative'], storeModule: () => store, logger: quiet });
  const M = mongoose.model(`ZzInlineHook${Date.now()}`, schema);
  const run = (name, ctx, args = []) => new Promise((resolve, reject) => schema.s.hooks.execPre(name, ctx, args, (e) => (e ? reject(e) : resolve())));
  const doc = new M({ imageUrl: uri() });
  await run('save', doc);
  assert.strictEqual(doc.imageUrl, 'https://cdn.test/1.png');
  const q = M.updateOne({}, { $set: { 'creative.imageUrls': [uri(2)] } });
  await run('updateOne', q);
  assert.deepStrictEqual(q.getUpdate().$set['creative.imageUrls'], ['https://cdn.test/2.png']);
  const docs = [{ imageUrl: uri(3) }];
  await run('insertMany', M, [docs]);
  assert.strictEqual(docs[0].imageUrl, 'https://cdn.test/3.png');
  process.env.INLINE_IMAGE_MODE = 'legacy';
  try {
    const d2 = new M({ imageUrl: uri(9) });
    await run('save', d2);
    assert.strictEqual(d2.imageUrl, uri(9));
  } finally { delete process.env.INLINE_IMAGE_MODE; }
});

test('Draft and Campaign carry the plugin', () => {
  const names = (m) => (m.schema.s.hooks._pres.get('save') || []).map((h) => h.fn && h.fn.name);
  assert.ok(names(require('../models/Draft')).includes('inlineImagesSave'));
  assert.ok(names(require('../models/Campaign')).includes('inlineImagesSave'));
});
