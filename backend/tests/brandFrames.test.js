const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const sharp = require('sharp');

function stub(rel, exports) {
  const id = require.resolve(path.join('..', rel));
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
const state = { rows: [], uploaded: [], updatedMany: [] };
function query(v) { const q = { sort: () => q, select: () => q, lean: async () => v, then: (a, b) => Promise.resolve(v).then(a, b) }; return q; }
class FakeAsset {
  constructor(d) { Object.assign(this, d); }
  static find() { return query(state.rows); }
  static async countDocuments(f) { return state.rows.filter((r) => r.type === f.type).length; }
  static async updateMany(f, u) { state.updatedMany.push([f, u]); }
  static async create(d) { const row = { _id: `a${state.rows.length}`, ...d }; state.rows.push(row); return row; }
}
stub('models/BrandAsset', FakeAsset);
stub('models/BrandIntelligenceProfile', {});
stub('models/Campaign', {});
stub('models/User', {});
stub('middleware/auth', { protect: (q, s, n) => n() });
stub('services/imageUploader', { uploadBase64Image: async (d, f) => { state.uploaded.push([d.length, f]); return { success: true, url: 'https://cdn.example.com/f.png', publicId: 'p1' }; }, deleteImage: async () => {} });
stub('services/scraper', { deepScrapeWebsite: async () => ({ success: false }) });
const router = require('../routes/brandAssets');

function handler(p, method) {
  const layer = router.stack.find((l) => l.route && l.route.path === p && l.route.methods[method]);
  assert.ok(layer, `${method} ${p}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}
async function call(method, p, body = {}, params = {}) {
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  const q = console.error; console.error = () => {};
  try { await handler(p, method)({ user: { _id: 'u1' }, body, params }, res); } finally { console.error = q; }
  return res;
}
const png = async (w, h) => `data:image/png;base64,${(await sharp({ create: { width: w, height: h, channels: 4, background: { r: 9, g: 9, b: 9, alpha: 1 } } }).png().toBuffer()).toString('base64')}`;

test('frames: refuses a bad kind, no picture and no name in plain words', async () => {
  state.rows = [];
  assert.equal((await call('post', '/frames', { kind: 'side', imageData: await png(10, 10), name: 'x' })).body.message, 'Choose header or footer.');
  assert.equal((await call('post', '/frames', { kind: 'footer', name: 'x' })).body.message, 'Choose a picture first.');
  assert.equal((await call('post', '/frames', { kind: 'footer', imageData: await png(300, 80) })).body.message, 'Give it a name.');
});

test('frames: any picture is cut to the exact size, the first one becomes the default, and the list splits by kind', async () => {
  state.rows = []; state.uploaded = [];
  const r1 = await call('post', '/frames', { kind: 'footer', imageData: await png(2400, 500), name: 'Main branch' });
  assert.equal(r1.code, 201);
  assert.equal(r1.body.asset.isPrimary, true);
  assert.equal(r1.body.asset.width, 1080); assert.equal(r1.body.asset.height, 200);
  const r2 = await call('post', '/frames', { kind: 'footer', imageData: await png(1080, 200), name: 'Second branch' });
  assert.equal(r2.body.asset.isPrimary, false);
  await call('post', '/frames', { kind: 'header', imageData: await png(1080, 140), name: 'Top strip' });
  const list = await call('get', '/frames');
  assert.equal(list.body.footers.length, 2); assert.equal(list.body.headers.length, 1);
  assert.deepEqual(list.body.specs.footer, { width: 1080, height: 200 });
  assert.ok(state.uploaded.length === 3);
});

test('frames: the file must be a readable picture', async () => {
  const r = await call('post', '/frames', { kind: 'header', imageData: `data:image/png;base64,${Buffer.alloc(500, 1).toString('base64')}`, name: 'bad' });
  assert.equal(r.code, 400);
  assert.match(r.body.message, /could not be read/);
});

test('the image model is told which bands to keep free, and nothing is said without frames', () => {
  const { frameInstruction } = require('../services/postFrames');
  assert.strictEqual(frameInstruction({ aspectRatio: '4:5' }), '');
  const both = frameInstruction({ headerUrl: 'https://x/h.png', footerUrl: 'https://x/f.png', aspectRatio: '4:5' });
  assert.match(both, /top 10%/);
  assert.match(both, /bottom 15%/);
  assert.match(both, /continue/);
  assert.match(frameInstruction({ headerUrl: 'https://x/h.png', aspectRatio: '1:1' }), /top 13%/);
});
