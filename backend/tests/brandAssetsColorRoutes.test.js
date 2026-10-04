const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

// Fakes only: models, upload, scraper and the logo colour reader are replaced; no network, no Cloudinary.
function stub(rel, exports) {
  const id = require.resolve(path.join('..', rel));
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
const state = { logos: [], profile: null, user: null, updates: [] };
function query(v) { const q = { sort: () => q, select: () => q, then: (a, b) => Promise.resolve(v).then(a, b) }; return q; }
class FakeAsset {
  constructor(d) { Object.assign(this, d); }
  async save() { state.logos.push(this); }
  static findOne() { return query(state.logos[0] || null); }
  static async countDocuments() { return state.logos.length; }
  static async updateMany() {}
}
stub('models/BrandAsset', FakeAsset);
stub('models/BrandIntelligenceProfile', {
  findOne: async () => state.profile,
  findOneAndUpdate: async (q, u) => { state.updates.push(u); return {}; }
});
stub('models/Campaign', {});
stub('models/User', { findById: () => query(state.user) });
stub('middleware/auth', { protect: (q, s, n) => n() });
stub('services/imageUploader', { uploadBase64Image: async () => ({ success: true, url: 'https://cdn.example.com/l.png', publicId: 'p' }), deleteImage: async () => {} });
stub('services/scraper', { deepScrapeWebsite: async () => ({ success: false }) });
const router = require('../routes/brandAssets');

function handler(p, method = 'post') {
  const layer = router.stack.find((l) => l.route && l.route.path === p && l.route.methods[method]);
  assert.ok(layer, p);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}
async function call(p, body = {}) {
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await handler(p)({ user: { _id: 'u1' }, body }, res);
  return res;
}
function reset() { state.logos = []; state.profile = null; state.user = null; state.updates = []; }
const quiet = async (fn) => { const e = console.error, l = console.log; console.error = () => {}; console.log = () => {}; try { return await fn(); } finally { console.error = e; console.log = l; } };

test('colors-from-logo: 400 with a plain message when there is no logo', async () => {
  reset();
  const r = await call('/colors-from-logo');
  assert.strictEqual(r.code, 400);
  assert.strictEqual(r.body.message, 'Upload your logo first, then Nebulaa can read its colours.');
});

test('colors-from-logo: reads the stored logo of the user, ignores any url in the body, saves nothing', async () => {
  reset();
  state.logos = [{ url: 'https://cdn.example.com/mine.png' }];
  let asked = '';
  router._deps.colorsFromLogoUrl = async (u) => { asked = u; return { primary: '#AA0000', secondary: '#0000AA' }; };
  const r = await call('/colors-from-logo', { url: 'https://evil.example.com/x.png', logoUrl: 'http://127.0.0.1/x' });
  assert.strictEqual(asked, 'https://cdn.example.com/mine.png');
  assert.deepStrictEqual(r.body, { success: true, primary_color: '#AA0000', secondary_color: '#0000AA', source: 'logo', reason: 'Colours were taken from your logo.' });
  assert.strictEqual(state.updates.length, 0);
});

test('colors-from-logo: no readable colour gives 200 with empty colours', async () => {
  reset();
  state.logos = [{ url: 'https://cdn.example.com/mine.png' }];
  router._deps.colorsFromLogoUrl = async () => ({ primary: '', secondary: '' });
  const r = await call('/colors-from-logo');
  assert.strictEqual(r.code, 200);
  assert.deepStrictEqual(r.body, { success: true, primary_color: '', secondary_color: '', source: 'logo', reason: 'Nebulaa could not read colours from this logo.' });
});

const upload = { imageData: 'data:image/png;base64,AAAA', type: 'logo', name: 'Logo' };

test('upload: empty colours are filled from the logo and reported', async () => {
  reset();
  router._deps.extractLogoColors = async () => ({ primary: '#112233', secondary: '#445566' });
  const r = await quiet(() => call('/upload', upload));
  assert.strictEqual(r.code, 201);
  assert.deepStrictEqual(r.body.colorsFromLogo, { primary: '#112233', secondary: '#445566' });
  const set = state.updates.map((u) => u.$set).find((x) => x['assets.primaryColor']);
  assert.deepStrictEqual(set, { 'assets.primaryColor': '#112233', 'assets.secondaryColor': '#445566' });
});

test('upload: a one-colour logo saves only the primary', async () => {
  reset();
  router._deps.extractLogoColors = async () => ({ primary: '#112233', secondary: '' });
  const r = await quiet(() => call('/upload', upload));
  assert.deepStrictEqual(r.body.colorsFromLogo, { primary: '#112233', secondary: '' });
  const set = state.updates.map((u) => u.$set).find((x) => x['assets.primaryColor']);
  assert.deepStrictEqual(set, { 'assets.primaryColor': '#112233' });
});

test('upload: colours the client already has are never overwritten', async () => {
  reset();
  let read = false;
  router._deps.extractLogoColors = async () => { read = true; return { primary: '#112233', secondary: '' }; };
  state.profile = { assets: { primaryColor: '#336699', secondaryColor: '' } };
  const r = await quiet(() => call('/upload', upload));
  assert.strictEqual(r.code, 201);
  assert.strictEqual(r.body.colorsFromLogo, undefined);
  assert.strictEqual(read, false);
  assert.ok(!state.updates.some((u) => u.$set['assets.primaryColor']));
});

test('upload: colours saved at sign-up also count as already set', async () => {
  reset();
  router._deps.extractLogoColors = async () => ({ primary: '#112233', secondary: '' });
  state.user = { businessProfile: { brandAssets: { brandColors: ['#ff0000'] } } };
  const r = await quiet(() => call('/upload', upload));
  assert.strictEqual(r.body.colorsFromLogo, undefined);
});

test('upload: a logo with no readable colour leaves colours empty and still succeeds', async () => {
  reset();
  router._deps.extractLogoColors = async () => ({ primary: '', secondary: '' });
  const r = await quiet(() => call('/upload', upload));
  assert.strictEqual(r.code, 201);
  assert.strictEqual(r.body.colorsFromLogo, undefined);
});

test('colours route: failure returns empty colours, source none, an honest reason', async () => {
  reset();
  const orig = router._deps.deepScrapeWebsite;
  const r = await quiet(async () => {
    const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await handler('/intelligence-profile/colors')({ get body() { throw new Error('boom'); } }, res);
    return res;
  });
  assert.strictEqual(r.code, 500);
  assert.strictEqual(r.body.primary_color, '');
  assert.strictEqual(r.body.secondary_color, '');
  assert.strictEqual(r.body.source, 'none');
  assert.ok(/could not detect/i.test(r.body.reason));
  router._deps.deepScrapeWebsite = orig;
});
