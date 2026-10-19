// scripts/generate-sample-photos.js with a fake generator and a fake sharp: planning, the budget cap, idempotency,
// the PROMOTE step and that the key never reaches the screen. No network.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const gen = require('../scripts/generate-sample-photos');
const { SLOTS, STYLE_RULES, promptFor } = require('../config/samplePhotoPrompts');
const { PROVIDER_RATES } = require('../config/apiCosts');

const KEY = 'sk-test-SECRETSECRET123';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sample-photos-'));
const sink = () => { const lines = []; return { lines, log: (...a) => lines.push(a.join(' ')), err: (...a) => lines.push(a.join(' ')) }; };
// A fake sharp: resize(), webp({ quality }) and toBuffer() give a buffer whose size falls with the quality.
const fakeSharp = (bytesAt = (q) => q * 600) => (input) => {
  let q = 80;
  const api = { resize: () => api, webp: (o) => { q = o.quality; return api; }, toBuffer: async () => Buffer.alloc(bytesAt(q), input.length % 7) };
  return api;
};
const setup = (extra = {}) => {
  const samplesDir = tmp(); const scratchDir = path.join(tmp(), 'scratch'); const s = sink();
  const calls = [];
  const deps = {
    env: { I_APPROVED_SAMPLE_PHOTOS: 'yes' }, samplesDir, scratchDir, ...s, sharp: fakeSharp(),
    askHidden: async () => KEY,
    ask: async (q) => (/PROMOTE/.test(q) ? 'PROMOTE' : 'YES'),
    generate: async (prompt, item) => { calls.push(item.slot); return Buffer.from(`png-${item.slot}`); },
    ...extra
  };
  return { deps, calls, samplesDir, scratchDir, lines: s.lines };
};

test('the prompts: twelve slots, the same names as the app, safe rules on every prompt', () => {
  assert.strictEqual(SLOTS.length, 12);
  const front = fs.readFileSync(path.join(__dirname, '../../frontend/utils/samplePhotos.ts'), 'utf8');
  const names = [...front.matchAll(/'((?:pack|create)-[a-z]+)'/g)].map((m) => m[1]);
  assert.deepStrictEqual([...new Set(names)].sort(), SLOTS.map((s) => s.slot).sort(), 'frontend/utils/samplePhotos.ts has the same slots');
  assert.match(front, /width: 768, height: 480/); assert.deepStrictEqual(gen.WEB_SIZE, { width: 768, height: 480 });
  for (const s of SLOTS) {
    const p = promptFor(s);
    assert.ok(p.endsWith(STYLE_RULES));
    assert.ok(p.length < 4000);
    assert.doesNotMatch(s.scene, /\b(face|faces|model|woman|man|girl|boy|logo)\b/i, `${s.slot} asks for no person or logo`);
  }
  assert.match(STYLE_RULES, /No people's faces/); assert.match(STYLE_RULES, /No real brand names or logos/); assert.match(STYLE_RULES, /No text, letters, numbers or watermarks/);
  assert.match(SLOTS.find((s) => s.slot === 'pack-festival').scene, /diyas/);
});

test('the estimate comes from apiCosts.js and the hard cap is USD 2', () => {
  assert.strictEqual(gen.MAX_USD, 2);
  const e = gen.estimate(12, 'medium', PROVIDER_RATES);
  assert.ok(Math.abs(e.each - PROVIDER_RATES.gpt_image_2_per_picture.medium * 1.2) < 1e-9);
  assert.ok(e.withinCap && e.total < 1);
  assert.strictEqual(gen.estimate(12, 'high', PROVIDER_RATES).withinCap, false, 'twelve at high quality is over the cap');
  assert.strictEqual(gen.estimate(6, 'high', PROVIDER_RATES).withinCap, true);
  assert.throws(() => gen.perPhotoUsd('ultra', PROVIDER_RATES));
});

test('refuses without the approval, with a bad option, an unknown slot or over the cap, and spends nothing', async () => {
  for (const [argv, env] of [[[], {}], [['--what'], undefined], [['--quality', 'low'], undefined], [['--only', 'pack-nope'], undefined], [['--quality', 'high'], undefined]]) {
    const t = setup(env ? { env } : {});
    assert.strictEqual(await gen.main(argv, t.deps), 2, argv.join(' '));
    assert.deepStrictEqual(t.calls, []);
  }
});

test('stops without a key or without YES, before any call', async () => {
  let t = setup({ askHidden: async () => '' });
  assert.strictEqual(await gen.main([], t.deps), 3); assert.deepStrictEqual(t.calls, []);
  t = setup({ ask: async () => 'no' });
  assert.strictEqual(await gen.main([], t.deps), 2); assert.deepStrictEqual(t.calls, []);
  assert.ok(!fs.existsSync(path.join(t.samplesDir, 'pack-product.webp')));
});

test('one call per slot, originals and small copies in the scratch folder, PROMOTE puts them in the app', async () => {
  const t = setup();
  assert.strictEqual(await gen.main([], t.deps), 0);
  assert.deepStrictEqual(t.calls, SLOTS.map((s) => s.slot));
  for (const s of SLOTS) {
    assert.ok(fs.existsSync(path.join(t.scratchDir, `${s.slot}.png`)));
    const w = path.join(t.samplesDir, `${s.slot}.webp`);
    assert.ok(fs.existsSync(w)); assert.ok(fs.statSync(w).size <= gen.MAX_WEB_BYTES);
  }
  assert.ok(fs.existsSync(path.join(t.scratchDir, 'contact-sheet.html')));
  const text = t.lines.join('\n');
  assert.ok(!text.includes(KEY) && !text.includes('SECRET'), 'the key never reaches the screen');
  assert.match(text, /Calls made: 12/);
  assert.match(text, /Contact sheet/);
});

test('idempotent: a second run makes no call; one slot is redone only with --only and --force', async () => {
  const t = setup();
  await gen.main([], t.deps);
  t.calls.length = 0;
  assert.strictEqual(await gen.main([], t.deps), 0);
  assert.deepStrictEqual(t.calls, [], 'everything is already in the app');
  const before = fs.readFileSync(path.join(t.samplesDir, 'pack-white.webp'));
  assert.strictEqual(await gen.main(['--only', 'pack-festival', '--force'], t.deps), 0);
  assert.deepStrictEqual(t.calls, ['pack-festival']);
  assert.deepStrictEqual(fs.readFileSync(path.join(t.samplesDir, 'pack-white.webp')), before, 'other slots untouched');
});

test('not promoted: nothing goes into the app; the next run reuses the originals without a call', async () => {
  const t = setup({ ask: async (q) => (/PROMOTE/.test(q) ? 'later' : 'YES') });
  assert.strictEqual(await gen.main(['--only', 'create-video,create-single'], t.deps), 0);
  assert.deepStrictEqual(fs.readdirSync(t.samplesDir), []);
  t.calls.length = 0;
  t.deps.ask = async (q) => (/PROMOTE/.test(q) ? 'PROMOTE' : 'YES');
  let asked = 0; t.deps.askHidden = async () => { asked += 1; return KEY; };
  assert.strictEqual(await gen.main(['--only', 'create-video,create-single'], t.deps), 0);
  assert.deepStrictEqual(t.calls, []); assert.strictEqual(asked, 0, 'no key needed when nothing is made');
  assert.deepStrictEqual(fs.readdirSync(t.samplesDir).sort(), ['create-single.webp', 'create-video.webp']);
});

test('never overwrites a file in the app without --force', async () => {
  const t = setup();
  fs.writeFileSync(path.join(t.samplesDir, 'pack-product.webp'), 'mine');
  // The app already has a copy (the owner's own): a plain run skips the slot and makes no call.
  await gen.main(['--only', 'pack-product'], t.deps);
  assert.strictEqual(fs.readFileSync(path.join(t.samplesDir, 'pack-product.webp'), 'utf8'), 'mine');
  assert.deepStrictEqual(t.calls, []);
});

test('a failed slot does not lose the others; an access error stops the remaining calls; messages are scrubbed', async () => {
  let t = setup({ generate: async (p, item) => { if (item.slot === 'pack-marketplace') throw new Error(`boom with ${KEY}`); return Buffer.from('ok'); } });
  assert.strictEqual(await gen.main(['--only', 'pack-product,pack-marketplace,pack-festival'], t.deps), 4);
  assert.ok(fs.existsSync(path.join(t.samplesDir, 'pack-product.webp')) && fs.existsSync(path.join(t.samplesDir, 'pack-festival.webp')));
  assert.ok(!fs.existsSync(path.join(t.samplesDir, 'pack-marketplace.webp')));
  assert.ok(!t.lines.join('\n').includes(KEY));
  let n = 0;
  t = setup({ generate: async () => { n += 1; const e = new Error('Incorrect API key'); e.status = 401; throw e; } });
  assert.strictEqual(await gen.main([], t.deps), 4);
  assert.strictEqual(n, 1, 'one refused call, then no more');
  assert.strictEqual(gen.scrub('key sk-abc_DEF-123 bad'), 'key sk-... bad');
});

test('the webp copy steps the quality down until it fits under 36 KB', async () => {
  const r = await gen.toWebp(fakeSharp((q) => q * 700), Buffer.from('x'));
  assert.ok(r.buffer.length <= gen.MAX_WEB_BYTES); assert.ok(r.quality < 80);
  await assert.rejects(gen.toWebp(fakeSharp(() => 50 * 1024), Buffer.from('x')), /36\.0 KB/);
});

test('the real generator sends one request with the key only in the header, and reports errors without it', async () => {
  const seen = [];
  const ok = async (url, o) => { seen.push({ url, o }); return { ok: true, json: async () => ({ data: [{ b64_json: Buffer.from('img').toString('base64') }] }) }; };
  const buf = await gen.openaiGenerate({ key: KEY, prompt: 'p', quality: 'medium', fetchImpl: ok });
  assert.strictEqual(buf.toString(), 'img');
  assert.strictEqual(seen.length, 1);
  assert.strictEqual(seen[0].o.headers.Authorization, `Bearer ${KEY}`);
  const body = JSON.parse(seen[0].o.body);
  assert.deepStrictEqual(body, { model: 'gpt-image-2', prompt: 'p', size: '1536x1024', quality: 'medium', n: 1 });
  const bad = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: `Incorrect API key provided: ${KEY}` } }) });
  await assert.rejects(gen.openaiGenerate({ key: KEY, prompt: 'p', quality: 'medium', fetchImpl: bad }), (e) => e.status === 401 && !e.message.includes(KEY));
});
