const test = require('node:test');
const assert = require('node:assert');
const { extractAssets, deleteAssets } = require('../services/cloudinaryCleanup');

test('finds our own files in any text, with or without version and transformations, once each', () => {
  const text = JSON.stringify({ a: 'https://res.cloudinary.com/c/image/upload/v12/nebula-campaign-posts/p1.jpg', b: 'https://res.cloudinary.com/c/image/upload/c_fill,w_400/v3/nebula-campaign-posts/p1.jpg', c: 'https://res.cloudinary.com/c/video/upload/v9/nebula-studio-videos/v1.mp4' });
  const out = extractAssets(text);
  assert.deepStrictEqual(out.map((x) => `${x.resourceType}:${x.publicId}`).sort(), ['image:nebula-campaign-posts/p1', 'video:nebula-studio-videos/v1']);
});

test('stock and shared files outside our folders are never picked up', () => {
  assert.deepStrictEqual(extractAssets('https://res.cloudinary.com/c/image/upload/v1/stock/people/a.jpg https://example.com/x.jpg'), []);
});

test('deletes in batches of 100 per type and reports a failed batch', async () => {
  const calls = [];
  const assets = Array.from({ length: 230 }, (_, i) => ({ resourceType: 'image', publicId: `nebula-x/${i}` })).concat([{ resourceType: 'video', publicId: 'nebula-v/1' }]);
  const cloudinary = { api: { delete_resources: async (ids, o) => { calls.push([ids.length, o.resource_type]); if (calls.length === 2) throw new Error('x'); } } };
  const out = await deleteAssets(assets, { cloudinary });
  assert.deepStrictEqual(calls, [[100, 'image'], [100, 'image'], [30, 'image'], [1, 'video']]);
  assert.deepStrictEqual(out, { requested: 231, failedBatches: 1 });
});
