// scripts/generate-demo-photos.js (fake provider, fake sharp, no network) and how the demo seed uses real photos:
// cost maths from apiCosts, the cap, the approval gate, reuse of made files, the slot to file-name mapping, no key logged.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const mongoose = require('mongoose');
const gen = require('../scripts/generate-demo-photos');
const prompts = require('../scripts/demo-brand/photoPrompts');
const real = require('../scripts/demo-brand/realPhotos');
const { PROVIDER_RATES } = require('../config/apiCosts');

const { SLOTS, STYLE_RULES, promptFor, CAROUSEL_EXTRA } = prompts;
const KEY = 'sk-test-SECRETSECRET123';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'demo-photos-'));
const sink = () => { const lines = []; return { lines, log: (...a) => lines.push(a.join(' ')), err: (...a) => lines.push(a.join(' ')) }; };
const fakeSharp = (bytesAt = (q) => q * 1500) => (input) => {
  let q = 80;
  const api = { resize: () => api, jpeg: (o) => { q = o.quality; return api; }, toBuffer: async () => Buffer.alloc(bytesAt(q), input.length % 7) };
  return api;
};
const setup = (extra = {}) => {
  const demoDir = path.join(tmp(), 'zaya'); const scratchDir = path.join(tmp(), 'photos'); const s = sink();
  fs.mkdirSync(demoDir, { recursive: true });
  const calls = [];
  const deps = {
    env: { I_APPROVED_DEMO_PHOTOS: 'yes' }, demoDir, scratchDir, ...s, sharp: fakeSharp(),
    askHidden: async () => KEY,
    ask: async (q) => (/PROMOTE/.test(q) ? 'PROMOTE' : 'YES'),
    generate: async (prompt, item) => { calls.push(item.slot); return Buffer.from(`png-${item.slot}`); },
    ...extra
  };
  return { deps, calls, demoDir, scratchDir, lines: s.lines };
};

test('24 slots, unique names and files, safe paths, safe rules on every prompt', () => {
  assert.strictEqual(SLOTS.length, 24);
  assert.strictEqual(new Set(SLOTS.map((s) => s.slot)).size, 24);
  assert.strictEqual(new Set(SLOTS.map((s) => s.rel)).size, 24);
  for (const s of SLOTS) {
    assert.ok(prompts.relOk(s.rel), s.rel);
    const p = promptFor(s);
    assert.ok(p.endsWith(STYLE_RULES)); assert.ok(p.length < 4000);
    assert.doesNotMatch(s.scene, /\b(face|faces|woman|man|girl|boy|model|logo)\b/i, `${s.slot} asks for no person or logo`);
  }
  assert.match(STYLE_RULES, /No people and no faces/); assert.match(STYLE_RULES, /No real brand names or logos/); assert.match(STYLE_RULES, /No text, letters, numbers/);
  const need = ['diya', 'turmeric', 'neem', 'amla', 'rose', 'marble', 'clay', 'leaf', 'monsoon', 'hamper', 'bathroom'];
  for (const w of need) assert.ok(SLOTS.some((s) => new RegExp(w, 'i').test(`${s.slot} ${s.scene}`)), `a slot for ${w}`);
  assert.strictEqual(SLOTS.filter((s) => /^carousel-/.test(s.slot)).length, 4);
  assert.strictEqual(SLOTS.filter((s) => /^photoshoot-/.test(s.slot)).length, 3);
  assert.strictEqual(prompts.relOk('../x.jpg'), false); assert.strictEqual(prompts.relOk('/etc/x.jpg'), false); assert.strictEqual(prompts.relOk('brand/logo.png'), false);
});

test('every slot replaces a picture the seed really draws, at the same size (so no database row changes)', () => {
  const { PRODUCTS } = require('../scripts/demo-brand/constants');
  const content = require('../scripts/demo-brand/content');
  const products = require('../scripts/demo-brand/products');
  const shoot = require('../scripts/demo-brand/photoshoot');
  const { PHOTO_SIZES } = require('../scripts/demo-brand/images3');
  const id = new mongoose.Types.ObjectId();
  const productIds = Object.fromEntries(PRODUCTS.map((p) => [p.slug, id]));
  const built = content.build({ userId: id, now: new Date(), base: 'http://localhost:5000', productIds, hasExtraSlide: () => true });
  const sizes = new Map();
  for (const sp of products.productPictureSpecs()) sizes.set(sp.rel, [800, 800]);
  for (const rel of built.posters.keys()) if (rel.startsWith('posts/')) sizes.set(rel, [864, 1080]);
  const jobs = shoot.build({ userId: id, now: new Date(), base: 'http://localhost:5000', products: [] });
  for (const j of shoot.JOBS) for (const rel of jobs.pictures.keys()) if (rel.startsWith(`photoshoot/job${j.no}-`)) sizes.set(rel, PHOTO_SIZES[j.aspect]);
  for (const s of SLOTS) {
    assert.ok(sizes.has(s.rel), `${s.slot}: ${s.rel} is a picture the seed draws`);
    assert.deepStrictEqual(s.size, sizes.get(s.rel), `${s.slot} has the drawn picture's size`);
  }
  // the fourth slide appears only with its real photo
  const find = (b) => b.drafts.find((d) => d.imageUrl.endsWith(`/${CAROUSEL_EXTRA.key}.jpg`));
  assert.strictEqual(find(built).carouselSlides.length, 4);
  // the slide is composed from that photo (D125): its own picture under feed/, and the photo itself is still copied in
  assert.ok(find(built).carouselSlides[3].imageUrl.endsWith(`feed/${CAROUSEL_EXTRA.key}-4.jpg`));
  assert.ok(built.posters.has(CAROUSEL_EXTRA.rel) && built.composed.has(`feed/${CAROUSEL_EXTRA.key}-4.jpg`));
  const plain = content.build({ userId: id, now: new Date(), base: 'http://localhost:5000', productIds });
  assert.strictEqual(find(plain).carouselSlides.length, 3);
  assert.ok(!plain.posters.has(CAROUSEL_EXTRA.rel) && !plain.composed.has(`feed/${CAROUSEL_EXTRA.key}-4.jpg`));
});

test('the estimate comes from apiCosts.js, the hard cap is USD 3', () => {
  assert.strictEqual(gen.MAX_USD, 3);
  const each = PROVIDER_RATES.gpt_image_2_per_picture.medium;
  assert.ok(Math.abs(gen.perPhotoUsd('medium', PROVIDER_RATES) - each) < 1e-12, 'priced at the measured 1024x1280 rate, no factor');
  const e = gen.estimate(24, 'medium', PROVIDER_RATES);
  assert.ok(Math.abs(e.total - 24 * each) < 1e-9); assert.ok(e.withinCap); assert.ok(e.total < 1.3, 'inside the owner\'s budget');
  assert.strictEqual(gen.estimate(24, 'high', PROVIDER_RATES).withinCap, false);
  assert.strictEqual(gen.estimate(16, 'high', PROVIDER_RATES).withinCap, true);
  assert.throws(() => gen.perPhotoUsd('ultra', PROVIDER_RATES));
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../scripts/generate-demo-photos.js'), 'utf8'), /0\.0457|0\.184|0\.0056/, 'no price typed in the script');
});

test('refuses without the approval, in production, with a bad option, unknown slot, over the cap, bad path; spends nothing', async () => {
  for (const [argv, env] of [[[], {}], [[], { I_APPROVED_DEMO_PHOTOS: 'yes', NODE_ENV: 'production' }], [['--what'], undefined], [['--quality', 'ultra'], undefined], [['--only', 'nope'], undefined], [['--quality', 'high'], undefined]]) {
    const t = setup(env ? { env } : {});
    assert.strictEqual(await gen.main(argv, t.deps), 2, argv.join(' ') + JSON.stringify(env));
    assert.deepStrictEqual(t.calls, []);
  }
  const t = setup({ slots: [{ ...SLOTS[0], rel: '../../.env.jpg' }] });
  assert.strictEqual(await gen.main([], t.deps), 2); assert.deepStrictEqual(t.calls, []);
});

test('stops without a key or without YES, before any call', async () => {
  let t = setup({ askHidden: async () => '' });
  assert.strictEqual(await gen.main([], t.deps), 3); assert.deepStrictEqual(t.calls, []);
  t = setup({ ask: async () => 'no' });
  assert.strictEqual(await gen.main([], t.deps), 2); assert.deepStrictEqual(t.calls, []);
});

test('one call per slot; originals and small JPEGs outside the repo; PROMOTE copies them under the drawn names; the key never shows', async () => {
  const t = setup();
  assert.strictEqual(await gen.main([], t.deps), 0);
  assert.deepStrictEqual(t.calls, SLOTS.map((s) => s.slot));
  for (const s of SLOTS) {
    assert.ok(fs.existsSync(path.join(t.scratchDir, 'originals', `${s.slot}.png`)));
    const f = path.join(t.scratchDir, 'final', s.rel);
    assert.ok(fs.existsSync(f)); assert.ok(fs.statSync(f).size <= gen.MAX_BYTES);
    assert.ok(fs.existsSync(path.join(t.demoDir, s.rel)), `${s.rel} promoted under the same name`);
  }
  assert.ok(fs.existsSync(path.join(t.scratchDir, 'contact-sheet.html')));
  const text = t.lines.join('\n');
  assert.ok(!text.includes(KEY) && !text.includes('SECRET'));
  assert.match(text, /Calls made: 24/);
});

test('idempotent: a second run makes no call and asks for no key; --only --force redoes one slot only', async () => {
  const t = setup();
  await gen.main([], t.deps);
  t.calls.length = 0;
  let asked = 0; t.deps.askHidden = async () => { asked += 1; return KEY; };
  assert.strictEqual(await gen.main([], t.deps), 0);
  assert.deepStrictEqual(t.calls, []); assert.strictEqual(asked, 0);
  const keep = fs.readFileSync(path.join(t.scratchDir, 'final', SLOTS[3].rel));
  assert.strictEqual(await gen.main(['--only', 'diwali-diyas', '--force'], t.deps), 0);
  assert.deepStrictEqual(t.calls, ['diwali-diyas']);
  assert.deepStrictEqual(fs.readFileSync(path.join(t.scratchDir, 'final', SLOTS[3].rel)), keep);
});

test('not promoted: the demo folder is untouched; a missing demo folder is not created', async () => {
  let t = setup({ ask: async (q) => (/PROMOTE/.test(q) ? 'later' : 'YES') });
  assert.strictEqual(await gen.main(['--only', 'product-marble'], t.deps), 0);
  assert.deepStrictEqual(fs.readdirSync(t.demoDir), []);
  t = setup(); fs.rmSync(t.demoDir, { recursive: true });
  assert.strictEqual(await gen.main(['--only', 'product-marble'], t.deps), 0);
  assert.ok(!fs.existsSync(t.demoDir));
  assert.match(t.lines.join('\n'), /does not exist yet/);
});

test('a failed slot does not lose the others; an access error stops further calls; the cap stops spending; messages are scrubbed', async () => {
  let t = setup({ generate: async (p, item) => { if (item.slot === 'product-clay') throw new Error(`boom with ${KEY}`); return Buffer.from('ok'); } });
  assert.strictEqual(await gen.main(['--only', 'product-marble,product-clay,product-leaf'], t.deps), 4);
  assert.ok(fs.existsSync(path.join(t.scratchDir, 'final', SLOTS[0].rel)) && fs.existsSync(path.join(t.scratchDir, 'final', SLOTS[2].rel)));
  assert.ok(!fs.existsSync(path.join(t.scratchDir, 'final', SLOTS[1].rel)));
  assert.ok(!t.lines.join('\n').includes(KEY));
  let n = 0;
  t = setup({ generate: async () => { n += 1; const e = new Error('Incorrect API key'); e.status = 401; throw e; } });
  assert.strictEqual(await gen.main([], t.deps), 4); assert.strictEqual(n, 1);
});

test('the real HTTP call sends the key only in the header, one picture, no retry', async () => {
  const seen = [];
  const fetchImpl = async (url, opts) => { seen.push({ url, opts }); return { ok: true, json: async () => ({ data: [{ b64_json: Buffer.from('pic').toString('base64') }] }) }; };
  const buf = await gen.openaiGenerate({ key: KEY, prompt: 'p', quality: 'medium', fetchImpl });
  assert.strictEqual(buf.toString(), 'pic'); assert.strictEqual(seen.length, 1);
  assert.match(seen[0].opts.headers.Authorization, /^Bearer /); assert.ok(!seen[0].opts.body.includes(KEY));
  assert.deepStrictEqual({ n: JSON.parse(seen[0].opts.body).n, size: JSON.parse(seen[0].opts.body).size }, { n: 1, size: '1024x1280' });
  await assert.rejects(gen.openaiGenerate({ key: KEY, prompt: 'p', quality: 'medium', fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({ error: { message: `bad ${KEY}` } }) }) }), (e) => !e.message.includes(KEY));
});

test('the JPEG steps its quality down until it fits 250 KB, or fails plainly', async () => {
  const r = await gen.toJpeg(fakeSharp((q) => q * 4000), Buffer.from('x'), [800, 800]);
  assert.ok(r.buffer.length <= gen.MAX_BYTES); assert.ok(r.quality < 88);
  await assert.rejects(gen.toJpeg(fakeSharp(() => 999999), Buffer.from('x'), [800, 800]), /under/);
});

test('the seed lays a real photo over a drawn one, leaves a slot with none alone, and is idempotent', () => {
  const photos = tmp(); const demo = tmp();
  const slot = SLOTS[0];
  fs.mkdirSync(path.join(demo, 'products'), { recursive: true });
  fs.writeFileSync(path.join(demo, slot.rel), 'drawn');
  assert.strictEqual(real.applyReal(slot.rel, demo, photos), null, 'no real photo: nothing happens');
  assert.strictEqual(fs.readFileSync(path.join(demo, slot.rel), 'utf8'), 'drawn');
  fs.mkdirSync(path.dirname(path.join(photos, 'final', slot.rel)), { recursive: true });
  fs.writeFileSync(path.join(photos, 'final', slot.rel), 'REAL');
  let r = real.applyReal(slot.rel, demo, photos);
  assert.ok(r.real && r.replaced && !r.made);
  assert.strictEqual(fs.readFileSync(path.join(demo, slot.rel), 'utf8'), 'REAL');
  r = real.applyReal(slot.rel, demo, photos);
  assert.strictEqual(r.replaced, false, 'second time: unchanged');
  // only slot paths are ever taken from the photos folder
  fs.mkdirSync(path.join(photos, 'final', 'brand'), { recursive: true });
  fs.writeFileSync(path.join(photos, 'final', 'brand/logo.png'), 'x');
  assert.strictEqual(real.realFile('brand/logo.png', photos), '');
  assert.strictEqual(real.realFile('../final/' + slot.rel, photos), '');
  assert.deepStrictEqual(real.summary(demo, photos), { total: 24, real: 1, drawn: 23, inDemo: 1 });
});

test('status says how many slots are real and how many are drawn; remove cannot touch the photos folder', async () => {
  const seed = require('../scripts/seed-demo-brand');
  const lines = [];
  await seed.main({
    argv: ['status'], env: { MONGODB_URI: 'mongodb://localhost:27017/nebulaa_dev' }, log: (l) => lines.push(l),
    deps: { connect: async () => ({ dbName: 'nebulaa_dev' }), status: async () => ({ exists: true, counts: {}, files: 5, photos: { total: 24, real: 7, drawn: 17, inDemo: 6 } }) }
  });
  assert.ok(lines.some((l) => /7 of 24 slots are real \(6 in the demo folder\), 17 still drawn/.test(l)), lines.join('|'));
  const src = fs.readFileSync(path.join(__dirname, '../scripts/seed-demo-brand.js'), 'utf8');
  assert.match(src, /Refusing to remove: the demo folder and the real photos folder overlap/);
  assert.strictEqual(path.resolve(real.PHOTOS_DIR).startsWith(path.resolve(seed.DEMO_DIR)), false);
  assert.ok(!fs.readFileSync(path.join(__dirname, '../scripts/demo-brand/realPhotos.js'), 'utf8').match(/rmSync|unlink|rmdir/), 'the photos module never deletes');
});
