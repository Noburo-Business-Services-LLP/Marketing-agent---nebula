// Real videos kept in the demo (D127): pure parts and the script's guards, with fakes. No database, no network, no ffmpeg.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const rv = require('../scripts/demo-brand/realVideos');
const safety = require('../scripts/demo-brand/safety');
const videos = require('../scripts/demo-brand/videos');
const K = require('../scripts/demo-brand/constants');
const script = require('../scripts/demo-real-videos');

const BASE = 'http://localhost:5000';
const products = K.PRODUCTS.map((p) => ({ slug: p.slug, name: p.name, ingredients: p.ingredients }));
const studio = videos.VIDEOS.map((v) => ({ slug: v.slug, url: safety.assetUrl(BASE, videos.mp4Rel(v)) }));
const reels = videos.REELS.map((r) => ({ key: r.slug, product: r.product, url: safety.assetUrl(BASE, videos.mp4Rel(r)) }));
const drawnRows = videos.build({ userId: 'u1', now: new Date('2026-10-22T10:00:00Z'), base: BASE }).map((r, i) => ({ ...r, _id: `d${i}` }));
const real = (id, title, at, extra = {}) => ({ _id: id, status: 'completed', videoUrl: `https://res.example.com/${id}.mp4`, title, idea: '', concept: '', spokenLine: '', createdAt: new Date(at), demoKeep: '', ...extra });

test('drawn, real and kept rows are told apart', () => {
  assert.ok(drawnRows.length === 5 && drawnRows.every((r) => rv.isDrawnUrl(r.videoUrl) && !rv.isReal(r)));
  const r = real('r1', 'x', 1);
  assert.ok(rv.isReal(r) && !rv.isKept(r) && rv.isKept({ ...r, demoKeep: 'a|b' }));
  assert.ok(!rv.isReal({ ...r, status: 'failed' }) && !rv.isReal({ ...r, status: 'processing', videoUrl: '' }));
  assert.deepStrictEqual(rv.summarize([...drawnRows, r, { ...r, _id: 'r2', demoKeep: 'a|b' }, { ...r, _id: 'r3', status: 'processing', videoUrl: '' }]), { real: 2, kept: 1, drawn: 5, other: 1 });
});

test('a real video is matched to its product by name, then ingredients', () => {
  assert.strictEqual(rv.productOf({ title: 'Kumkumadi serum reveal', idea: 'The Kumkumadi Glow Serum, 30 ml' }, products), 'kumkumadi-glow-serum');
  assert.strictEqual(rv.productOf({ title: 'Ingredient story', idea: 'fresh neem leaves, turmeric and tulsi' }, products), 'neem-turmeric-cleanser');
  assert.strictEqual(rv.productOf({ title: 'hello', idea: 'nothing here' }, products), '');
});

test('the plan tags real videos oldest first, relinks one reel each, removes the replaced drawn clip', () => {
  const rows = [...drawnRows, real('r2', 'Neem and turmeric story', 2), real('r1', 'Kumkumadi Glow Serum reveal', 1)];
  const p = rv.plan({ rows, reels, products, studio });
  assert.deepStrictEqual(p.tag.map((t) => t.id), ['r1', 'r2']);
  assert.strictEqual(p.tag[0].keep.split('|')[0], 'kumkumadi-glow-serum');
  assert.ok(reels.find((x) => x.key === p.tag[0].keep.split('|')[1]).product === 'kumkumadi-glow-serum', 'the first free reel of the product');
  assert.strictEqual(p.relink.length, 2);
  assert.ok(p.relink.every((l) => rv.isDrawnUrl(l.from) && !rv.isDrawnUrl(l.to)));
  assert.notStrictEqual(p.relink[0].from, p.relink[1].from, 'two videos never take the same reel');
  const kumkumadiRow = drawnRows.find((r) => r.videoUrl === studio.find((s) => s.slug === 'kumkumadi-glow-serum').url);
  assert.deepStrictEqual(p.removeRows, [kumkumadiRow._id], 'only the drawn studio clip of a product that has one (the cleanser has none)');
  assert.ok(p.files.includes('videos/kumkumadi-glow-serum.mp4') && p.files.every((f) => f.startsWith('videos/')));
});

test('running the plan again changes nothing for videos already kept', () => {
  const rows = [...drawnRows.slice(1), real('r1', 'Kumkumadi serum', 1, { demoKeep: 'kumkumadi-glow-serum|soon-x' })];
  const p = rv.plan({ rows, reels, products, studio });
  assert.deepStrictEqual([p.tag, p.removeRows, p.relink], [[], [], []]);
  const k = rv.keepState(rows);
  assert.deepStrictEqual([k.reelUrls, [...k.products], [...k.reels]], [{ 'soon-x': rows[rows.length - 1].videoUrl }, ['kumkumadi-glow-serum'], ['soon-x']]);
});

test('with more real videos than reels the extra one is still kept and noted', () => {
  const few = reels.slice(0, 1);
  const p = rv.plan({ rows: [real('a', 'one', 1), real('b', 'two', 2)], reels: few, products, studio });
  assert.strictEqual(p.tag.length, 2);
  assert.strictEqual(p.relink.length, 1);
  assert.strictEqual(p.skipped.length, 1);
});

const fakeDeps = (over = {}) => {
  const calls = [];
  const rows = [...drawnRows, real('r1', 'Kumkumadi Glow Serum reveal', 1)];
  return {
    calls,
    assetBase: BASE,
    connect: async () => ({ dbName: 'nebulaa_dev' }), disconnect: async () => calls.push('disconnect'),
    findUser: async () => ({ _id: 'u1', email: safety.DEMO_EMAIL, ayrshare: { profileKey: 'demo-zaya-naturals' } }),
    listVideos: async () => rows, slots: () => ({ products, studio, reels }),
    apply: async (uid, p) => { calls.push('apply'); return { tagged: p.tag.length, relinked: p.relink.length, removed: p.removeRows.length, files: p.files.length }; },
    ...over
  };
};
const ENV = { MONGODB_URI: 'mongodb+srv://x:y@cluster.example.net/nebulaa_dev?retryWrites=true' };

test('status and the default adopt change nothing; CONFIRM_ADOPT=yes applies', async () => {
  const logs = []; const log = (l) => logs.push(l);
  let d = fakeDeps();
  await script.main({ argv: ['status'], env: ENV, deps: d, log });
  assert.ok(logs[0].includes('1 real (0 kept), 5 drawn'));
  d = fakeDeps();
  const dry = await script.main({ argv: ['adopt'], env: ENV, deps: d, log });
  assert.strictEqual(dry.done, false); assert.ok(!d.calls.includes('apply') && d.calls.includes('disconnect'));
  d = fakeDeps();
  const yes = await script.main({ argv: ['adopt'], env: { ...ENV, CONFIRM_ADOPT: 'yes' }, deps: d, log });
  assert.strictEqual(yes.done, true); assert.ok(d.calls.includes('apply'));
  d = fakeDeps({ listVideos: async () => drawnRows });
  assert.strictEqual((await script.main({ argv: ['adopt'], env: { ...ENV, CONFIRM_ADOPT: 'yes' }, deps: d, log })).done, false, 'nothing real: nothing to do');
});

test('refuses any database but nebulaa_dev, a missing or non-demo user, and unknown modes', async () => {
  const log = () => {};
  await assert.rejects(() => script.main({ argv: ['status'], env: { MONGODB_URI: 'mongodb+srv://x:y@c.example.net/nebulaa_prod' }, deps: fakeDeps(), log }), /nebulaa_dev/);
  await assert.rejects(() => script.main({ argv: ['status'], env: {}, deps: fakeDeps(), log }), /MONGODB_URI/);
  await assert.rejects(() => script.main({ argv: ['status'], env: ENV, deps: fakeDeps({ connect: async () => ({ dbName: 'other' }) }), log }), /nebulaa_dev/);
  await assert.rejects(() => script.main({ argv: ['adopt'], env: ENV, deps: fakeDeps({ findUser: async () => ({ _id: 'u2', email: 'someone@example.com', ayrshare: { profileKey: 'k' } }) }), log }), /not the seeded demo/);
  await assert.rejects(() => script.main({ argv: ['adopt'], env: ENV, deps: fakeDeps({ findUser: async () => null }), log }), /does not exist/);
  await assert.rejects(() => script.main({ argv: ['wipe'], env: ENV, deps: fakeDeps(), log }), /Usage/);
});

test('create keeps the kept slot: poster only for a kept reel, and remove still covers kept videos', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-'));
  try {
    const reel = videos.REELS[0];
    let ran = 0;
    const fake = (cmd, args) => { ran += 1; fs.writeFileSync(args[args.length - 1], 'x'); return { status: 0 }; };
    fs.mkdirSync(path.join(dir, 'videos'), { recursive: true });
    fs.writeFileSync(path.join(dir, videos.mp4Rel(reel)), 'old');
    const out = videos.makeVideo({ demoDir: dir, video: reel, run: fake, ffmpeg: '/fake', clip: false, photo: () => null });
    assert.strictEqual(out.skipped, ''); assert.strictEqual(ran, 0);
    assert.ok(fs.existsSync(path.join(dir, videos.posterRel(reel))) && !fs.existsSync(path.join(dir, videos.mp4Rel(reel))));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  const { erasable, filterFor } = require('../services/dataRegistry');
  const rule = erasable().find((r) => r.model === 'StudioVideo');
  assert.ok(rule, 'remove deletes every StudioVideo of the demo user, kept ones included');
  assert.deepStrictEqual(filterFor(rule, 'u1'), { user: 'u1' });
});
