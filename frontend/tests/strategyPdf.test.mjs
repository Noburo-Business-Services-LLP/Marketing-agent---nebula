import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeStrategyHtml, nonWhiteShare } from '../utils/strategyPdf.ts';

test('styles, scripts, classes and inline styling from the AI are removed', () => {
  const dirty = '```html\n<!DOCTYPE html><html><head><style>*{color:#fff}</style></head><body><div class="x" style="background:#000;color:#fff"><h1 style="color:white" id="a">Plan</h1><script>alert(1)</script><p onclick="x()">Text</p></div></body></html>\n```';
  const clean = sanitizeStrategyHtml(dirty);
  assert.equal(clean, '<div><h1>Plan</h1><p>Text</p></div>');
});

test('tables, lists and cell spans survive', () => {
  const clean = sanitizeStrategyHtml('<table style="x"><thead><tr><th colspan="2" style="y">Pillar</th></tr></thead><tbody><tr><td rowspan=2>A</td><td>B</td></tr></tbody></table><ul class="l"><li>One</li></ul>');
  assert.equal(clean, '<table><thead><tr><th colspan="2">Pillar</th></tr></thead><tbody><tr><td rowspan="2">A</td><td>B</td></tr></tbody></table><ul><li>One</li></ul>');
});

test('images, links and unknown tags are dropped but their text stays', () => {
  const clean = sanitizeStrategyHtml('<p>See <a href="http://x.test">our site</a><img src="http://x.test/a.png"> now <font color="red">today</font></p>');
  assert.equal(clean, '<p>See our site now today</p>');
});

test('a mostly white picture counts as blank and a page with text does not', () => {
  const blank = new Uint8ClampedArray(4 * 1000).fill(255);
  assert.ok(nonWhiteShare(blank) < 0.004);
  const text = new Uint8ClampedArray(4 * 1000).fill(255);
  for (let i = 0; i < 20; i++) { text[i * 4] = 20; text[i * 4 + 1] = 20; text[i * 4 + 2] = 20; }
  assert.ok(nonWhiteShare(text) >= 0.004);
  assert.equal(nonWhiteShare(new Uint8ClampedArray(0)), 0);
});
