const test = require('node:test');
const assert = require('node:assert/strict');
const brief = require('../services/heroVideoBrief');

const U = (n) => `https://res.cloudinary.com/x/${n}.jpg`;

test('isPublicHttpsUrl', () => {
  assert.equal(brief.isPublicHttpsUrl('https://res.cloudinary.com/a.jpg'), true);
  for (const bad of ['http://x', 'https://localhost/a', 'https://127.0.0.1/a', 'https://10.0.0.5/a',
    'https://192.168.1.2/a', 'https://169.254.169.254/a', 'https://[::1]/a', 'https://x.local/a',
    'https://x.internal/a', 'https://172.16.0.1/a', 'https://192.0.0.8/a', 'https://192.0.2.1/a',
    'https://198.51.100.7/a', 'https://203.0.113.9/a', 'https://198.18.0.1/a', 'https://198.19.255.1/a', 'javascript:alert(1)', 'data:image/png;base64,AAA',
    'https://a.com/' + 'x'.repeat(3000), 5, null, undefined, {}]) {
    assert.equal(brief.isPublicHttpsUrl(bad), false, String(bad).slice(0, 40));
  }
});

const member = (i) => ({ id: 'c' + i, name: 'N' + i, age: 30, gender: 'f', role: 'lead', appearance: 'a', clothing: 'c',
  hairStyle: 'h', hairColor: 'k', personality: 'p', portraitUrl: U('p' + i) });
const scene = (i, extra = {}) => ({ sceneId: 's' + i, title: 'T' + i, script: 'x', visual: 'v', durationSeconds: 5,
  charactersRequired: ['c1'], imageUrl: U('k' + i), ...extra });
const valid = () => ({
  concept: { title: 'T', storySummary: 'S', coreEmotion: 'E', visualStyle: 'V' }, aspectRatio: '16:9', language: 'English',
  cast: [member(1), member(2)], castSheetUrl: U('sheet'),
  environment: { enabled: true, notes: 'n', images: [{ url: U('e1'), alt: 'shop' }] },
  scenes: [scene(1), scene(2)]
});

test('normalizeHeroBrief valid + caps', () => {
  const r = brief.normalizeHeroBrief(valid());
  assert.equal(r.ok, true);
  assert.equal(r.brief.aspectRatio, '16:9');
  assert.equal(r.brief.cast[0].portraitUrl, U('p1'));
  const big = valid();
  big.cast = [1, 2, 3, 4, 5, 6].map(member);
  big.scenes = Array.from({ length: 20 }, (_, i) => scene(i, { script: 'y'.repeat(2000) }));
  const b = brief.normalizeHeroBrief(big).brief;
  assert.equal(b.cast.length, 4);
  assert.equal(b.scenes.length, 12);
  assert.equal(b.scenes[0].script.length, 800);
});

test('normalizeHeroBrief rejects and defaults', () => {
  const v = valid(); v.aspectRatio = '4:3';
  assert.equal(brief.normalizeHeroBrief(v).brief.aspectRatio, '9:16');
  const nc = valid(); nc.cast = [];
  const r1 = brief.normalizeHeroBrief(nc);
  assert.equal(r1.ok, false); assert.match(r1.message, /cast/i);
  const ns = valid(); ns.scenes = [];
  const r2 = brief.normalizeHeroBrief(ns);
  assert.equal(r2.ok, false); assert.match(r2.message, /script/i);
  assert.equal(brief.normalizeHeroBrief('x').ok, false);
  assert.equal(brief.normalizeHeroBrief(null).ok, false);
});

test('normalizeHeroBrief drops non-public image urls but keeps dataUrl', () => {
  const v = valid();
  v.cast[0].portraitUrl = 'http://evil/x.jpg';
  v.environment.images = [{ url: 'https://localhost/a.jpg' }, { dataUrl: 'data:image/png;base64,AAAA' }];
  const b = brief.normalizeHeroBrief(v).brief;
  assert.equal(b.cast[0].portraitUrl, '');
  assert.equal(b.environment.images.length, 1);
  assert.equal(b.environment.images[0].dataUrl, 'data:image/png;base64,AAAA');
});

test('loadBrand', async () => {
  const user = { businessProfile: { name: 'Acme', website: 'a.com', industry: 'tools', targetAudience: 'devs',
    targetCustomerProfile: 'icp', brandVoice: ['Warm', 'Bold'], heroProduct: 'Widget', secret: 'no' },
    brandAssets: { logoUrl: U('logo'), brandColors: ['#fff', '#000'], images: [{ src: U('i1'), alt: 'prod' }, { src: 'http://x/y.jpg' }] }, password: 'zzz' };
  const deps = {
    User: { findById: () => ({ select: () => ({ lean: async () => user }) }) },
    BrandAsset: { find: () => ({ sort: () => ({ limit: () => ({ lean: async () => [{ type: 'logo', url: U('bl'), name: 'L' }] }) }) }) }
  };
  const b = await brief.loadBrand('u1', deps);
  assert.equal(b.name, 'Acme'); assert.equal(b.audience, 'devs'); assert.equal(b.icp, 'icp');
  assert.deepEqual(b.tone, ['Warm', 'Bold']); assert.equal(b.heroProduct, 'Widget');
  assert.equal(b.logoUrl, U('logo')); assert.deepEqual(b.colors, ['#fff', '#000']);
  assert.deepEqual(b.productImages, [{ url: U('i1'), alt: 'prod' }]);
  assert.equal(b.password, undefined); assert.equal(b.secret, undefined);
  const none = await brief.loadBrand('u2', { User: { findById: () => ({ select: () => ({ lean: async () => null }) }) },
    BrandAsset: { find: () => { throw new Error('boom'); } } });
  assert.equal(none.name, ''); assert.equal(none.logoUrl, ''); assert.deepEqual(none.colors, []);
});

test('loadBrand falls back to BrandAsset logo and string tone', async () => {
  const deps = {
    User: { findById: () => ({ select: () => ({ lean: async () => ({ businessProfile: { brandVoice: 'Calm' } }) }) }) },
    BrandAsset: { find: () => ({ sort: () => ({ limit: () => ({ lean: async () => [{ type: 'logo', url: U('bl') }] }) }) }) }
  };
  const b = await brief.loadBrand('u1', deps);
  assert.deepEqual(b.tone, ['Calm']);
  assert.equal(b.logoUrl, U('bl'));
});

const emptyBrand = { name: '', website: '', industry: '', audience: '', icp: '', tone: [], heroProduct: '', logoUrl: '', colors: [], productImages: [] };

test('selectReferences priority, caps, tags', () => {
  const b = valid();
  b.cast = [1, 2, 3, 4].map(member);
  b.environment.images = [1, 2, 3].map((i) => ({ url: U('e' + i) }));
  b.scenes = [1, 2, 3, 4, 5].map((i) => scene(i));
  const brand = { ...emptyBrand, logoUrl: U('logo'), productImages: [{ url: U('pr1') }, { url: U('pr2') }] };
  const refs = brief.selectReferences(b, brand, { includePeople: true });
  assert.equal(refs.length, 9);
  assert.deepEqual(refs.map((r) => r.kind), ['cast', 'cast', 'cast', 'environment', 'environment', 'brand', 'brand', 'keyframe', 'keyframe']);
  assert.deepEqual(refs.map((r) => r.tag), Array.from({ length: 9 }, (_, i) => '@image' + (i + 1)));
  assert.equal(refs[5].url, U('pr1'));
});

test('selectReferences: required cast first, dupes skipped, sheet fallback, kept scenes, empty', () => {
  const b = valid();
  b.cast = [1, 2, 3, 4].map(member);
  b.scenes = [scene(1, { charactersRequired: ['c4'], imageUrl: '' }), scene(2, { charactersRequired: [], imageUrl: U('k2') }), scene(3, { charactersRequired: ['c4'], imageUrl: U('k3') })];
  let refs = brief.selectReferences(b, emptyBrand, { keptSceneIds: ['s3'], includePeople: true });
  assert.equal(refs[0].url, U('p4'));
  assert.equal(refs.filter((r) => r.kind === 'keyframe').length, 1);
  assert.equal(refs.find((r) => r.kind === 'keyframe').url, U('k3'));

  const d = valid(); d.cast = [member(1), { ...member(2), portraitUrl: U('p1') }]; d.scenes = [scene(1, { imageUrl: U('p1') })];
  refs = brief.selectReferences(d, emptyBrand, { includePeople: true });
  assert.equal(refs.filter((r) => r.url === U('p1')).length, 1);

  const s = valid(); s.cast = [member(1)]; s.cast[0].portraitUrl = '';
  refs = brief.selectReferences(s, emptyBrand, { includePeople: true });
  assert.equal(refs[0].url, U('sheet')); assert.equal(refs[0].kind, 'cast');

  assert.deepEqual(brief.selectReferences({}, emptyBrand), []);
  assert.deepEqual(brief.selectReferences(null, null), []);
});

test('stageReferences', async () => {
  const calls = [];
  const deps = { uploadBase64Image: async (d, folder) => { calls.push(folder); return { success: true, url: U('up' + calls.length) }; } };
  const png = 'data:image/png;base64,' + 'A'.repeat(100);
  const huge = 'data:image/png;base64,' + 'A'.repeat(9 * 1024 * 1024);
  const refs = [
    { tag: '@image1', kind: 'cast', label: 'Maya', url: U('p1'), source: 'x' },
    { tag: '@image2', kind: 'environment', label: 'Shop', url: '', dataUrl: png, source: 'upload' },
    { tag: '@image3', kind: 'environment', label: 'Big', url: '', dataUrl: huge, source: 'upload' },
    { tag: '@image4', kind: 'environment', label: 'Gif', url: '', dataUrl: 'data:image/gif;base64,AAAA', source: 'upload' },
    { tag: '@image5', kind: 'brand', label: 'Http', url: 'http://x/a.jpg', source: 'b' },
    { tag: '@image6', kind: 'brand', label: 'Last', url: U('l'), source: 'b' }
  ];
  const r = await brief.stageReferences(refs, deps);
  assert.deepEqual(r.refs.map((x) => x.tag), ['@image1', '@image2', '@image3']);
  assert.equal(r.refs[1].url, U('up1'));
  assert.equal(r.refs[1].dataUrl, undefined);
  assert.equal(r.refs[2].label, 'Last');
  assert.deepEqual(r.dropped.map((d) => d.label), ['Big', 'Gif', 'Http']);
  assert.ok(r.dropped.every((d) => d.reason.length > 5));
  assert.equal(calls.length, 1);
});

test('stageReferences drops when upload fails', async () => {
  const r = await brief.stageReferences([{ tag: '@image1', kind: 'environment', label: 'E', url: '', dataUrl: 'data:image/png;base64,AAAA', source: 'u' }],
    { uploadBase64Image: async () => ({ success: false }) });
  assert.equal(r.refs.length, 0); assert.equal(r.dropped.length, 1);
});

test('selectReferences skips unsupported image types so the next candidate fills the slot', () => {
  const b = { cast: [
    { id: 'c1', name: 'A', portraitUrl: 'https://res.cloudinary.com/x/a.SVG?v=2' },
    { id: 'c2', name: 'B', portraitUrl: U('b') }
  ], scenes: [], environment: { enabled: false } };
  const brand = { productImages: ['gif', 'avif', 'heic', 'heif', 'bmp', 'tif', 'tiff', 'svg'].map((e) => ({ url: `https://res.cloudinary.com/x/p.${e}?x=1.jpg`, alt: e })).concat([{ url: U('ok.png'), alt: 'ok' }]),
    logoUrl: 'https://res.cloudinary.com/x/logo.svg' };
  const refs = brief.selectReferences(b, brand, { includePeople: true });
  assert.deepEqual(refs.map((r) => r.url), [U('b'), U('ok.png')]);
});

test('stageReferences drops unsupported image types with a plain reason', async () => {
  const r = await brief.stageReferences([
    { tag: '@image1', kind: 'brand', label: 'Logo', url: 'https://res.cloudinary.com/x/logo.svg', source: 'b' },
    { tag: '@image2', kind: 'brand', label: 'Anim', url: 'https://res.cloudinary.com/x/a.GIF?v=1', source: 'b' },
    { tag: '@image3', kind: 'brand', label: 'Fine', url: U('f'), source: 'b' }
  ], {});
  assert.deepEqual(r.refs.map((x) => x.label), ['Fine']);
  assert.deepEqual(r.dropped.map((d) => d.label), ['Logo', 'Anim']);
  for (const d of r.dropped) assert.match(d.reason, /isn't supported, use a JPG, PNG or WebP/);
});
