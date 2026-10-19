import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ratio, parseColor } from '../scripts/visual-audit/contrast-math.mjs';
import {
  TILE_ACCENTS, TILE_VARIANTS, ACCENT_COLORS, accentOf, variantOf, tileLabel, badgeText, isRasterArt, rasterAttrs, tileTag,
} from '../utils/tiles.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('the nine accents and five variants are fixed', () => {
  assert.deepEqual([...TILE_ACCENTS], ['create', 'review', 'inbox', 'performance', 'plan', 'brand', 'competitors', 'video', 'photoshoot']);
  assert.deepEqual([...TILE_VARIANTS], ['hero', 'standard', 'compact', 'idea', 'choice']);
});

test('an unknown accent or variant falls back instead of breaking the tile', () => {
  assert.equal(accentOf('inbox'), 'inbox');
  assert.equal(accentOf('nonsense'), 'create');
  assert.equal(accentOf(undefined), 'create');
  assert.equal(variantOf('hero'), 'hero');
  assert.equal(variantOf('x'), 'standard');
});

test('every accent has colours, and the CSS in index.html carries the same values', () => {
  const html = read('index.html');
  for (const a of TILE_ACCENTS) {
    const c = ACCENT_COLORS[a];
    assert.ok(c && /^#[0-9A-F]{6}$/.test(c.bar) && /^#[0-9A-F]{6}$/.test(c.tint), `colours for ${a}`);
    const rule = html.match(new RegExp(`\\.nb-tile\\[data-accent="${a}"\\]\\s*\\{([^}]*)\\}`));
    assert.ok(rule, `CSS rule for ${a}`);
    assert.ok(rule[1].toUpperCase().includes(c.bar) && rule[1].toUpperCase().includes(c.tint), `${a} CSS matches ACCENT_COLORS`);
  }
});

test('badge and title text on every accent tint reach AA (4.5:1)', () => {
  const ink = parseColor('#14203A');
  for (const a of TILE_ACCENTS) {
    const r = ratio(ink, parseColor(ACCENT_COLORS[a].tint));
    assert.ok(r >= 4.5, `${a} tint ${r.toFixed(2)}`);
  }
});

test('the badge text is short and a zero count is not shown', () => {
  assert.equal(badgeText('Add-on'), 'Add-on');
  assert.equal(badgeText(3), '3');
  assert.equal(badgeText(0), '');
  assert.equal(badgeText(250), '99+');
  assert.equal(badgeText(undefined), '');
  assert.equal(badgeText('  New  '), 'New');
});

test('the spoken label joins the text and adds the state', () => {
  assert.equal(tileLabel({ title: 'Single post', subtitle: 'One image post with a caption' }), 'Single post. One image post with a caption');
  assert.equal(tileLabel({ title: 'Photoshoot', subtitle: 'Product photos', footer: '4 photos', badge: 'New' }), 'Photoshoot. Product photos. 4 photos. New');
  assert.equal(tileLabel({ title: 'Competitors', locked: true }), 'Competitors. Locked');
  assert.equal(tileLabel({ title: 'Video', disabled: true }), 'Video. Not available');
});

test('raster art always gets lazy loading, async decoding and a fixed size', () => {
  const a = { src: '/assets/tiles/x.webp', width: 320, height: 240, alt: '' };
  assert.equal(isRasterArt(a), true);
  assert.equal(isRasterArt({ src: 'x' }), false);
  assert.equal(isRasterArt(null), false);
  const at = rasterAttrs(a);
  assert.equal(at.loading, 'lazy');
  assert.equal(at.decoding, 'async');
  assert.equal(at.width, 320);
  assert.equal(at.height, 240);
  assert.equal(at.src, '/assets/tiles/x.webp');
  assert.throws(() => rasterAttrs({ src: 'https://elsewhere.example/x.png', width: 1, height: 1, alt: '' }), /own/);
  assert.throws(() => rasterAttrs({ src: '/a.png', width: 0, height: 10, alt: '' }), /size/);
});

test('tileTag picks a link, a button or a disabled button', () => {
  assert.equal(tileTag({ to: '/plan' }), 'link');
  assert.equal(tileTag({ onClick: true }), 'button');
  assert.equal(tileTag({ to: '/plan', disabled: true }), 'disabled');
  assert.equal(tileTag({}), 'disabled');
});

test('Tile source: real link or button, decorative art hidden, no bare img, no innerHTML', () => {
  const src = read('components/Tile.tsx');
  assert.ok(src.includes('<Link') && src.includes('<button'), 'link and button');
  assert.ok(src.includes('aria-hidden'), 'decorative art hidden');
  assert.ok([...src.matchAll(/<img\b[^>]*>/g)].every((m) => m[0].includes('{...rasterAttrs(')), 'every image goes through rasterAttrs');
  assert.ok(src.includes('rasterAttrs('), 'uses the lazy helper');
  assert.ok(!src.includes('dangerouslySetInnerHTML'));
  assert.ok(!/<div[^>]*onClick/.test(src), 'no clickable div');
});

test('the tile styles respect reduced motion, show a focus ring and use the glow tokens', () => {
  const html = read('index.html');
  assert.ok(/--gv-glow-gold:/.test(html) && /--gv-glow-amber:/.test(html) && /--gv-glow-cool:/.test(html));
  assert.ok(html.includes('prefers-reduced-motion: no-preference'), 'motion only when allowed');
  assert.ok(/\.nb-tile:focus-visible/.test(html), 'focus ring');
  assert.ok(/\.nb-tile-grid/.test(html) && /\.nb-darkpanel/.test(html));
});

test('TileGrid is responsive and DarkPanel exists', () => {
  assert.ok(read('components/TileGrid.tsx').includes('nb-tile-grid'));
  assert.ok(read('components/DarkPanel.tsx').includes('nb-darkpanel'));
});
