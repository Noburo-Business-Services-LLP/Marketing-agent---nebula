// The demo brand's composed post pictures (D125): the designs, their words, and the drawing rules. No database, no network,
// no real photos needed (a drawn packshot stands in for a missing photo, as on a computer without them).
const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');

const K = require('../scripts/demo-brand/constants');
const content = require('../scripts/demo-brand/content');
const designs = require('../scripts/demo-brand/postDesigns');
const composer = require('../scripts/demo-brand/postComposer');
const videos = require('../scripts/demo-brand/videos');
const images = require('../scripts/demo-brand/images');
const { SLOTS } = require('../scripts/demo-brand/photoPrompts');
const S = require('../services/draftStatus');

const NOW = new Date('2026-10-21T06:00:00Z');
const BASE = 'http://localhost:5000';
const UID = new mongoose.Types.ObjectId();
const productIds = Object.fromEntries(K.PRODUCTS.map((p) => [p.slug, new mongoose.Types.ObjectId()]));
const all = content.allSpecs();
const specs = [...all.any, ...all.past, ...all.soon];
const byKey = Object.fromEntries(specs.map((s) => [s.key, s]));
const built = content.build({ userId: UID, now: NOW, base: BASE, productIds, hasExtraSlide: () => true });
const noPhoto = () => null;
const fallback = (d) => images.packshotJpg(K.PRODUCTS.find((p) => p.slug === d.product) || K.PRODUCTS[0], 1, 480);
const everyDesign = () => specs.flatMap((s) => { const d = designs.designFor(s, { extra: true }); return [d.cover, ...d.slides]; });
const textsOf = (d) => [d.head, d.kicker, d.sub, d.body, d.note, d.badge, d.badgeSub, d.quote, d.person, d.myth, d.fact, d.big, d.line, d.price, ...(d.items || []), ...(d.options || []), ...(d.cells || []).flatMap((c) => [c.name, c.price])].filter(Boolean);

test('every post has a design: at least 12 layout families, several palette moods, real photo slots only', () => {
  const covers = specs.map((s) => designs.designFor(s).cover);
  const families = new Set(covers.map((d) => d.family));
  assert.ok(families.size >= 12, `${families.size} families: ${[...families].join(', ')}`);
  assert.ok(new Set(covers.map((d) => d.mood)).size >= 3);
  const slots = new Set(SLOTS.map((s) => s.slot));
  for (const d of everyDesign()) {
    for (const slot of designs.slotsOf(d)) assert.ok(slots.has(slot), `${d.key}: ${slot}`);
    assert.ok(composer.FAMILY_NAMES.includes(d.family), d.family);
    assert.ok(composer.MOODS[d.mood], `${d.key}: mood ${d.mood}`);
  }
  // the same photo is never used twice with the same crop and layout
  const seen = new Set();
  for (const d of everyDesign().filter((x) => x.photoSlot)) {
    const sig = `${d.family}|${d.photoSlot}|${JSON.stringify(d.crop)}`;
    assert.ok(!seen.has(sig), `${d.key} repeats ${sig}`); seen.add(sig);
  }
});

test('the picture headline is the post\'s head, stored as imageText, and says what the title and caption say', () => {
  const STOP = new Set(['with', 'your', 'from', 'that', 'this', 'what', 'for', 'the', 'and', 'into', 'every', 'our', 'here']);
  for (const d of built.drafts) {
    const key = d.imageUrl.split('/').pop().replace('.jpg', '');
    const spec = byKey[key];
    assert.ok(spec, key);
    assert.strictEqual(d.imageText, spec.head);
    assert.strictEqual(designs.designFor(spec).cover.head, spec.head);
    const words = spec.head.toLowerCase().replace(/[^a-z0-9' ]/g, ' ').split(/\s+/).filter((w) => w.length >= 4 && !STOP.has(w));
    const said = `${spec.title} ${spec.caption}`.toLowerCase();
    const found = words.filter((w) => said.includes(w.replace(/'s$/, '')));
    assert.ok(!words.length || found.length / words.length >= 0.5, `${key}: "${spec.head}" (${found.length} of ${words.length} words in the caption)`);
  }
});

test('the words on the pictures keep the brand rules: no medical claims, no before-and-after, the one handle', () => {
  for (const d of everyDesign()) {
    for (const t of textsOf(d)) assert.ok(!/\b(cure|cures|treats? acne|before and after|before-and-after)\b/i.test(t), `${d.key}: ${t}`);
  }
  assert.strictEqual(composer.HANDLE, '@zaya.naturals');
  // the offer captions only say "no code" when there is no code
  for (const s of all.any.filter((x) => /-offer$/.test(x.key))) assert.ok(!(/ZAYA10/.test(s.caption) && /No code needed/.test(s.caption)), s.key);
});

test('posts link to their composed pictures under feed/, carousels to one picture per slide', () => {
  for (const d of built.drafts) {
    assert.match(d.imageUrl, /\/demo-assets\/zaya\/feed\/[a-z0-9-]+\.jpg$/);
    assert.ok(built.composed.has(d.imageUrl.split('/demo-assets/zaya/')[1]));
    if (d.contentType === 'carousel') {
      assert.ok(d.carouselSlides.length >= 3, d.title);
      d.carouselSlides.forEach((s, i) => {
        assert.ok(built.composed.has(s.imageUrl.split('/demo-assets/zaya/')[1]), s.imageUrl);
        assert.ok(s.headline && s.imageText === s.headline);
        assert.strictEqual(s.role, i === 0 ? 'hook' : i === d.carouselSlides.length - 1 ? 'payoff' : 'build');
      });
    }
  }
  // the photo slots for posts are still in the picture set, so the real photos are copied in (and never redrawn)
  for (const s of SLOTS.filter((x) => x.rel.startsWith('posts/'))) assert.ok(built.posters.has(s.rel), s.rel);
});

test('every picture draws: 864 x 1080 JPEG, at most 195 KB, every text fits, contrast at least 4.5, key text clear of the badges', () => {
  const list = everyDesign();
  assert.ok(list.length >= 130, `${list.length} pictures`);
  for (const d of list) {
    const r = composer.render(d, { photo: noPhoto, fallback });
    assert.deepStrictEqual(images.imageSize(r.buffer), { type: 'jpeg', width: 864, height: 1080 }, d.key);
    assert.ok(r.buffer.length <= composer.MAX_BYTES, `${d.key}: ${r.buffer.length}`);
    assert.deepStrictEqual(r.qa.problems, [], d.key);
    assert.ok(r.qa.texts.length >= 3 && r.qa.texts.every((t) => t.contrast >= 4.5), d.key);
    assert.ok(r.qa.texts.some((t) => t.text === composer.HANDLE) && r.qa.texts.some((t) => t.text === 'ZAYA NATURALS'), `${d.key}: handle and logo`);
  }
  const one = designs.designFor(byKey['soon-dhanteras']).cover;
  assert.ok(composer.render(one, { photo: noPhoto, fallback }).buffer.equals(composer.render(one, { photo: noPhoto, fallback }).buffer), 'deterministic');
  assert.throws(() => composer.fit({ measureText: () => ({ width: 1e6 }), set font(v) { /* */ } }, 'x', { max: 20, min: 18, width: 10 }), /does not fit/);
});

test('reels: one tall clip per reel post, its poster is the post\'s own headline, and the frames keep the text in the tile\'s band', () => {
  const reels = specs.filter((s) => s.fmt === 'reel');
  assert.strictEqual(videos.REELS.length, reels.length);
  const urls = videos.reelUrlsOf(BASE);
  assert.deepStrictEqual(Object.keys(urls).sort(), reels.map((s) => s.key).sort());
  const linked = content.build({ userId: UID, now: NOW, base: BASE, productIds, videoUrls: { ...videos.videoUrlsOf(BASE), ...urls } });
  for (const d of linked.drafts.filter((x) => x.contentType === 'reel')) {
    const key = d.imageUrl.split('/').pop().replace('.jpg', '');
    assert.strictEqual(d.creative.videoUrl, urls[key]);
  }
  for (const v of [...videos.VIDEOS, ...videos.REELS]) {
    const frames = videos.framesOf(v);
    assert.deepStrictEqual(frames.map((f) => f.kind), ['hook', 'steps', 'end']);
    if (v.reel) assert.strictEqual(frames[0].head, byKey[v.slug].head);
    for (const f of frames) {
      const r = composer.renderFrame(f, { photo: noPhoto, fallback });
      assert.deepStrictEqual(images.imageSize(r.buffer), { type: 'jpeg', width: v.wide ? 1280 : 720, height: v.wide ? 720 : 1280 });
      assert.deepStrictEqual(r.qa.problems, [], `${v.slug} ${f.kind}`);
    }
  }
});

test('no two neighbouring posts in a Library view share a layout, whatever day create runs', () => {
  const view = (x) => (S.needsApproval(x) ? 0 : S.isAwaitingReview(x) ? 1 : ['approved', 'scheduled', 'published', 'archived', 'binned'].indexOf(x.status) + 2);
  const look = (d) => { const c = designs.designFor(byKey[d.imageUrl.split('/').pop().replace('.jpg', '')]).cover; return `${c.family}:${c.variant || ''}`; };
  for (let day = 0; day < 14; day += 1) {
    const now = new Date(Date.UTC(2026, 9, 21 + day, 4 + (day % 3) * 6));
    const order = content.build({ userId: UID, now, base: BASE, productIds }).drafts.slice().sort((a, b) => view(a) - view(b) || b.createdAt - a.createdAt);
    for (let i = 1; i < order.length; i += 1) {
      if (view(order[i]) === view(order[i - 1])) assert.notStrictEqual(look(order[i]), look(order[i - 1]), `${now.toISOString()}: ${order[i - 1].title} / ${order[i].title}`);
    }
  }
});
