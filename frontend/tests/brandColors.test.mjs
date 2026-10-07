import test from 'node:test';
import assert from 'node:assert/strict';
import { isPlaceholderColorPair } from '../utils/brandColors.ts';

test('the exact old placeholder pair is recognised in either letter case', () => {
  assert.equal(isPlaceholderColorPair('#111111', '#FFCC29'), true);
  assert.equal(isPlaceholderColorPair('#111111', '#ffcc29'), true);
  assert.equal(isPlaceholderColorPair(' #111111 ', '#FfCc29'), true);
});

test('one different colour is not a placeholder pair', () => {
  assert.equal(isPlaceholderColorPair('#111111', '#FFCC2A'), false);
  assert.equal(isPlaceholderColorPair('#222222', '#FFCC29'), false);
  assert.equal(isPlaceholderColorPair('#FFCC29', '#111111'), false);
});

test('empty or missing colours are not a placeholder pair', () => {
  assert.equal(isPlaceholderColorPair('', ''), false);
  assert.equal(isPlaceholderColorPair('#111111', ''), false);
  assert.equal(isPlaceholderColorPair(undefined, null), false);
});

import {
  extractPaletteFromPixels,
  canAutoApplyLogoColors,
  normalizeHexColor,
} from '../utils/brandColors.ts';

// Build an RGBA pixel array from [count, [r,g,b,a]] runs.
function pixels(runs) {
  const out = [];
  for (const [count, [r, g, b, a = 255]] of runs) {
    for (let i = 0; i < count; i++) out.push(r, g, b, a);
  }
  return new Uint8ClampedArray(out);
}

const RED = [230, 57, 70];
const BLUE = [29, 53, 87];

test('a two-colour logo gives both colours, most prominent first', () => {
  const px = pixels([[600, RED], [300, BLUE], [100, [255, 255, 255]]]);
  assert.deepEqual(extractPaletteFromPixels(px), ['#E63946', '#1D3557']);
});

test('a white background and transparent corners are ignored', () => {
  const px = pixels([
    [400, [255, 255, 255]],
    [300, [0, 0, 0, 0]],
    [200, [250, 250, 250]],
    [150, BLUE],
    [60, RED],
  ]);
  assert.deepEqual(extractPaletteFromPixels(px), ['#1D3557', '#E63946']);
});

test('a monochrome black logo still returns its one colour', () => {
  const px = pixels([[200, [0, 0, 0]], [800, [0, 0, 0, 0]]]);
  assert.deepEqual(extractPaletteFromPixels(px), ['#000000']);
});

test('near-black is dropped when a real colour is present', () => {
  const px = pixels([[500, [10, 10, 10]], [300, RED]]);
  assert.deepEqual(extractPaletteFromPixels(px), ['#E63946']);
});

test('anti-aliasing noise and near-duplicates do not become their own colours', () => {
  const runs = [[500, RED], [200, BLUE]];
  for (let i = 0; i < 8; i++) runs.push([1, [200 + i * 3, 90 + i * 5, 120 + i * 4]]);
  runs.push([40, [232, 59, 72]]);
  const out = extractPaletteFromPixels(pixels(runs));
  assert.deepEqual(out, ['#E63946', '#1D3557']);
});

test('the palette is capped and lists extra distinct colours after the first two', () => {
  const px = pixels([
    [500, RED], [400, BLUE], [300, [255, 204, 41]], [200, [40, 160, 90]], [100, [140, 60, 200]],
  ]);
  assert.equal(extractPaletteFromPixels(px, { max: 4 }).length, 4);
  assert.equal(extractPaletteFromPixels(px).length, 5);
});

test('an image with no visible pixels gives no colours', () => {
  assert.deepEqual(extractPaletteFromPixels(pixels([[100, [0, 0, 0, 0]]])), []);
  assert.deepEqual(extractPaletteFromPixels(new Uint8ClampedArray(0)), []);
});

test('logo colours are applied only to empty or placeholder colours, never over the customer own', () => {
  assert.equal(canAutoApplyLogoColors('', ''), true);
  assert.equal(canAutoApplyLogoColors(undefined, null), true);
  assert.equal(canAutoApplyLogoColors('#111111', '#FFCC29'), true);
  assert.equal(canAutoApplyLogoColors('#e63946', ''), false);
  assert.equal(canAutoApplyLogoColors('', '#1D3557'), false);
  assert.equal(canAutoApplyLogoColors('#E63946', '#1D3557'), false);
  assert.equal(canAutoApplyLogoColors('#111111', '#1D3557'), false);
});

test('hex input is normalised to uppercase #RRGGBB and invalid input is rejected', () => {
  assert.equal(normalizeHexColor('#abc'), '#AABBCC');
  assert.equal(normalizeHexColor(' #e63946 '), '#E63946');
  assert.equal(normalizeHexColor('e63946'), '#E63946');
  assert.equal(normalizeHexColor('#12345'), null);
  assert.equal(normalizeHexColor('#GGGGGG'), null);
  assert.equal(normalizeHexColor(''), null);
});
