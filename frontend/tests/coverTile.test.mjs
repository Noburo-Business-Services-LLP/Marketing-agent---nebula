// Cover tiles (components/CoverTile.tsx + CoverTile.css): structure, motion and the contrast of the
// white text over the art. The art can be as bright as pure white under any text, so the check is
// the worst case: white text over the scrim (or the price chip) laid over white.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const css = read('components/CoverTile.css');
const tsx = read('components/CoverTile.tsx');

const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const over = (top, a, bottom) => top.map((c, i) => c * a + bottom[i] * (1 - a));
const ratio = (x, y) => { const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p); return (hi + 0.05) / (lo + 0.05); };
const WHITE = [255, 255, 255];

const palettes = [...tsx.match(/COVER_PALETTES = \[([^\]]*)\]/)[1].matchAll(/'(\w+)'/g)].map((m) => m[1]);
const deepOf = (p) => {
  const rule = css.match(new RegExp(`\\.nb-cover\\[data-palette="${p}"\\]\\s*\\{([^}]*)\\}`));
  assert.ok(rule, `palette ${p} has a rule`);
  return rule[1].match(/--cover-deep-rgb:\s*(\d+) (\d+) (\d+)/).slice(1).map(Number);
};

test('every palette in the component has its colours in the stylesheet', () => {
  assert.deepEqual(palettes, ['gold', 'coral', 'teal', 'blue', 'ink']);
  for (const p of palettes) assert.equal(deepOf(p).length, 3);
});

test('white text over the scrim and the price chip is at least 4.5 to 1 over the brightest art, for every palette', () => {
  // The scrim stop at 52% from the bottom is above the top of the title on the shortest tile (124 px):
  // bottom 11 + two description lines 30 + gap 3 + title line 20 = 64 px, 51.6%.
  const stop = css.match(/rgb\(var\(--cover-deep-rgb\) \/ (0\.\d+)\) 52%/);
  assert.ok(stop, 'the scrim has a stop at 52%');
  const scrimA = Number(stop[1]);
  const chip = css.match(/\.nb-cover-price \{[^}]*background: rgb\(var\(--cover-deep-rgb\) \/ (0\.\d+)\)/);
  assert.ok(chip, 'the price chip has its own backing');
  const chipA = Number(chip[1]);
  const subA = Number(css.match(/\.nb-cover-sub \{[^}]*color: rgb\(255 255 255 \/ (0\.\d+)\)/)[1]);
  const worthA = Number(css.match(/\.nb-cover-price \{[^}]*color: rgb\(255 255 255 \/ (0\.\d+)\)/)[1]);
  for (const p of palettes) {
    const deep = deepOf(p);
    const behindTitle = over(deep, scrimA, WHITE);
    assert.ok(ratio(WHITE, behindTitle) >= 4.5, `${p} title ${ratio(WHITE, behindTitle).toFixed(2)}`);
    assert.ok(ratio(over(WHITE, subA, behindTitle), behindTitle) >= 4.5, `${p} description`);
    const behindChip = over(deep, chipA, WHITE);
    assert.ok(ratio(WHITE, behindChip) >= 4.5, `${p} price amount ${ratio(WHITE, behindChip).toFixed(2)}`);
    assert.ok(ratio(over(WHITE, worthA, behindChip), behindChip) >= 4.5, `${p} price words ${ratio(over(WHITE, worthA, behindChip), behindChip).toFixed(2)}`);
  }
});

test('a cover tile is a real link or button, with focus, selection and motion done right', () => {
  assert.ok(tsx.includes('<Link') && tsx.includes('<button type="button"'), 'a link or a button');
  assert.ok(tsx.includes('aria-pressed') && tsx.includes('aria-hidden="true"'), 'selection is announced, the art is hidden from screen readers');
  assert.ok(!/\bfrom '\.\/Tile'/.test(tsx), 'separate from the compact Tile, so its variants stay as they are');
  assert.ok(/\.nb-cover:focus-visible \{ outline: 3px solid #14203A/.test(css), 'keyboard focus ring');
  assert.ok(/\.nb-cover\[data-selected="true"\] \{[^}]*#F5A623/.test(css), 'gold selected ring');
  const motion = css.slice(css.indexOf('@media (prefers-reduced-motion: no-preference)'));
  assert.ok(motion.includes('transition') && motion.includes('translateY'), 'lift only without reduced motion');
  const outside = css.slice(0, css.indexOf('@media (prefers-reduced-motion: no-preference)'));
  assert.ok(!/transition|scale\(/.test(outside), 'no motion outside the reduced-motion guard');
  assert.ok(!/https?:\/\/(?!www\.w3\.org\/2000\/svg)/.test(css), 'no external files');
});

test('the price keeps its words: only the amount is set in bold', () => {
  assert.ok(tsx.includes('/^([\\d,.]+ Quarks?)(.*)$/'), 'the amount is split off, the rest is shown as written');
});
