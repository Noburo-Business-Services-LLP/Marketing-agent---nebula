// Owner feedback 2026-10-19: real sample photos on the cover tiles (with the drawn art as the fallback), Create content
// as two rows of three, and no "posts' worth" wording on the Photoshoot page ("4 photos", "Up to 8 photos").
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  SAMPLE_SLOTS, SAMPLE_PHOTO_SIZE, PACK_PHOTO_SLOTS, CREATE_PHOTO_SLOTS, samplePhoto, packPhoto, createPhoto, photoStateAfter,
} from '../utils/samplePhotos.ts';
import { PACK_PALETTE, packPhotosText, packTileLines, priceLine } from '../utils/photoshoot.ts';
import { HOME_CREATE_TILES } from '../utils/homeLayout.ts';
import { CREATE_TILES } from '../utils/createTiles.ts';
import { rasterAttrs } from '../utils/tiles.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const require = createRequire(import.meta.url);
const { PACKS } = require('../../backend/config/photoshootPacks.js');
const COSTS = { photoshoot_image: 10, image_generated: 11, studio_video: 161 };

test('twelve photo slots: one per pack and one per Create choice, each a small fixed-size file of our own', () => {
  assert.equal(SAMPLE_SLOTS.length, 12);
  assert.equal(new Set(SAMPLE_SLOTS).size, 12);
  assert.deepEqual(Object.keys(PACK_PHOTO_SLOTS).sort(), Object.keys(PACK_PALETTE).sort(), 'every pack has a slot');
  assert.deepEqual(PACKS.map((p) => p.key).sort(), Object.keys(PACK_PHOTO_SLOTS).sort(), 'the same packs as the server catalogue');
  for (const t of CREATE_TILES) assert.ok(createPhoto(t.key), `Create ${t.key}`);
  for (const t of HOME_CREATE_TILES) assert.ok(createPhoto(t.key), `Home ${t.key}`);
  assert.ok(createPhoto('video') && createPhoto('photoshoot'));
  for (const slot of SAMPLE_SLOTS) {
    const p = samplePhoto(slot);
    assert.deepEqual(p, { src: `/samples/${slot}.webp`, width: SAMPLE_PHOTO_SIZE.width, height: SAMPLE_PHOTO_SIZE.height, alt: '' });
    const at = rasterAttrs(p);
    assert.equal(at.loading, 'lazy'); assert.equal(at.decoding, 'async'); assert.equal(at.alt, '');
  }
  assert.equal(SAMPLE_PHOTO_SIZE.width / SAMPLE_PHOTO_SIZE.height, 1.6, '16:10');
  assert.equal(samplePhoto('nope'), null); assert.equal(samplePhoto(''), null); assert.equal(packPhoto('nope'), null); assert.equal(createPhoto(null), null);
});

test('the photo shows only once it has loaded; an error keeps the drawn art for good', () => {
  assert.equal(photoStateAfter('loading', 'load'), 'ready');
  assert.equal(photoStateAfter('loading', 'error'), 'failed');
  assert.equal(photoStateAfter('ready', 'error'), 'failed');
  assert.equal(photoStateAfter('failed', 'load'), 'failed', 'a late load after an error does not bring back a half photo');
  assert.equal(photoStateAfter('failed', 'reset', true), 'loading', 'a new file is tried');
  assert.equal(photoStateAfter('ready', 'reset', false), 'failed', 'no photo: the art');
  assert.equal(photoStateAfter('loading', 'load', false), 'failed');
});

test('SamplePhoto: the art stays until the photo loads, a missing file falls back without a broken image', () => {
  const src = read('components/SamplePhoto.tsx');
  assert.ok(src.includes('<img {...rasterAttrs(photo)}'), 'lazy, fixed size, alt from the helper');
  assert.ok(/onError=\{onError\}/.test(src) && src.includes('failedOnce.add(src)'), 'an error removes the photo and is remembered');
  assert.ok(src.includes("state !== 'failed' &&"), 'the img is not rendered after a failure');
  assert.ok(src.includes('img.complete') && src.includes('naturalWidth'), 'a cached photo is noticed');
  assert.ok(src.includes('aria-hidden="true"'), 'decorative');
  const css = read('components/SamplePhoto.css');
  assert.match(css, /\.nb-photo-img \{[^}]*object-fit: cover;[^}]*opacity: 0;/, 'invisible until loaded, cropped to fill');
  assert.match(css, /\.nb-photo\[data-photo="ready"\] > \.nb-photo-img \{ opacity: 1; \}/);
  assert.match(css, /\.nb-photo\[data-photo="ready"\] > \.nb-photo-fallback \{ visibility: hidden; \}/);
  const motion = css.slice(css.indexOf('@media (prefers-reduced-motion: no-preference)'));
  assert.ok(!/transition/.test(css.replace(motion, '')), 'the fade only without reduced motion');
});

test('CoverTile takes an optional photo and keeps the art as the fallback', () => {
  const tsx = read('components/CoverTile.tsx');
  assert.ok(tsx.includes('image?: RasterArt | null'));
  assert.ok(tsx.includes('{image ? <SamplePhoto photo={image} fallback={artEl} /> : artEl}'));
  assert.ok(tsx.includes("{image && overlay && ("), 'the play or swipe mark only with a photo');
  const css = read('components/CoverTile.css');
  assert.match(css, /\.nb-cover > \.nb-photo \{ z-index: 1; \}/, 'the photo sits under the scrim (z-index 2) and the text (4)');
  assert.match(css, /\.nb-cover:has\(> \.nb-photo\[data-photo="ready"\]\) > \.nb-cover-overlay \{ display: inline-flex; \}/);
});

const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const over = (top, a, bottom) => top.map((c, i) => c * a + bottom[i] * (1 - a));
const ratio = (x, y) => { const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p); return (hi + 0.05) / (lo + 0.05); };

test('the play and swipe mark reads over the brightest photo (at least 3 to 1 for a graphic, computed)', () => {
  const css = read('components/CoverTile.css');
  const a = Number(css.match(/\.nb-cover-overlay \{[^}]*background: rgb\(var\(--cover-deep-rgb\) \/ (0\.\d+)\)/)[1]);
  for (const m of css.matchAll(/--cover-deep-rgb:\s*(\d+) (\d+) (\d+)/g)) {
    const deep = m.slice(1).map(Number);
    const r = ratio([255, 255, 255], over(deep, a, [255, 255, 255]));
    assert.ok(r >= 3, `${deep} ${r.toFixed(2)}`);
  }
});

test('Create content: two rows of three equal tiles at desktop, three rows of two on a phone, edge to edge', () => {
  const css = read('components/CoverTile.css');
  const base = css.match(/\.nb-cover-grid \{([^}]*)\}/)[1];
  assert.match(base, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/, 'two columns on a phone');
  assert.match(base, /width: 100%/, 'fills the width');
  const phoneRow = Number(base.match(/grid-auto-rows: (\d+)px/)[1]);
  const wide = css.match(/@media \(min-width: 640px\) \{ \.nb-cover-grid \{([^}]*)\} \}/)[1];
  assert.match(wide, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/, 'three columns from 640 px');
  const deskRow = Number(wide.match(/grid-auto-rows: (\d+)px/)[1]);
  assert.ok(deskRow >= 150 && deskRow <= 170, `desktop tile height ${deskRow}`);
  assert.ok(phoneRow >= 130 && phoneRow <= deskRow, `phone tile height ${phoneRow}`);
  assert.match(css, /\.nb-cover-grid > \.nb-cover \{ height: 100%; \}/, 'every tile exactly its row height');
  const page = read('pages/GravityCreate.tsx');
  const grid = page.slice(page.indexOf('<div className="nb-cover-grid"'), page.indexOf('{/* The brief:'));
  const fixed = (grid.match(/<CoverTile\b/g) || []).length - 1; // the mapped one
  const tiles = fixed + CREATE_TILES.length;
  assert.equal(tiles, 6, 'six tiles');
  assert.equal(tiles % 3, 0, 'rows of three are full'); assert.equal(tiles % 2, 0, 'rows of two are full');
  assert.equal((grid.match(/image=\{createPhoto\(/g) || []).length, 3, 'every tile asks for its photo');
  assert.ok(grid.includes('overlay="play"') && grid.includes("'slides'"), 'a play mark on Video, a swipe mark on Carousel');
});

test('Photoshoot packs: filled rows of equal tiles with their photos', () => {
  const css = read('components/photoshoot/photoshoot.css');
  assert.match(css, /\.nb-ps-packs \{[^}]*grid-auto-rows: \d+px;/);
  assert.match(css, /\.nb-ps-packs > \.nb-cover \{ height: 100%; \}/);
  assert.match(css, /@media \(min-width: 900px\) \{ \.nb-ps-packs \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); grid-auto-rows: 1[5-7]\dpx;/);
  assert.equal(PACKS.length % 3, 0); assert.equal(PACKS.length % 2, 0);
  assert.ok(read('pages/Photoshoot.tsx').includes('image={packPhoto(p.key)}'));
  const home = read('components/home/HomeBlocks.tsx');
  assert.ok(home.includes('image={packPhoto(r.key)}') && home.includes('image={createPhoto(t.key)}'), 'Home uses the same photos');
  assert.ok(!/<Tile\b/.test(home.slice(home.indexOf('export const CreateToday'), home.indexOf('</section>', home.indexOf('export const CreateToday')))), 'Home create tiles are cover tiles');
});

test('pack photo counts are the real ones: "4 photos" when fixed, "Up to N photos" when the customer chooses', () => {
  const lines = Object.fromEntries(PACKS.map((p) => [p.key, packPhotosText(p)]));
  assert.deepEqual(lines, {
    product: 'Up to 6 photos', marketplace: '4 photos', festival: 'Up to 8 photos', lifestyle: 'Up to 6 photos', flatlay: '4 photos', white: '4 photos',
  });
  assert.equal(packPhotosText({ counts: [1], defaultCount: 1 }), '1 photo');
  assert.equal(packPhotosText({ counts: [5, 5], defaultCount: 5 }), '5 photos');
  assert.equal(packPhotosText({ counts: [], defaultCount: 3 }), '3 photos');
});

test('no "worth" wording anywhere on the Photoshoot page or its tiles (customer accounts)', () => {
  for (const p of PACKS) {
    const view = { ...p, quarks: 10 * p.defaultCount, minutes: 3 };
    const l = packTileLines(view, COSTS);
    assert.doesNotMatch(l.price + l.subtitle, /worth|post/i, p.key);
    assert.equal(l.price, `${10 * p.defaultCount} Quarks`);
  }
  assert.equal(`${priceLine(10, COSTS)} for each photo`, '10 Quarks for each photo', 'the header chip');
  const page = read('pages/Photoshoot.tsx');
  assert.doesNotMatch(page, /worth/i);
  assert.ok(page.includes('{priceOf(perPhoto)} for each photo'));
  const util = read('utils/photoshoot.ts');
  assert.ok(!util.includes('priceWithWorth'), 'the "(about N posts\' worth)" helper is no longer used here');
});
