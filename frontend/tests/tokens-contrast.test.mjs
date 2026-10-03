import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
const start = html.indexOf(':root {');
const end = html.indexOf('.dark {', start);
assert.ok(start >= 0 && end > start, ':root and .dark blocks found');
const block = html.slice(start, end);
const tokens = {};
for (const m of block.matchAll(/--gv-([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})\s*;/g)) tokens[m[1]] = m[2].toUpperCase();

const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
};
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

const TEXT = ['text-primary', 'text-secondary', 'text-tertiary', 'accent-text'];
const BGS = ['bg', 'panel', 'panel-2'];

test('token values from the plan', () => {
  const expected = {
    bg: '#FBF5EA', panel: '#FFFDF8', 'panel-2': '#F3E8D4',
    'text-primary': '#14203A', 'text-secondary': '#33405C', 'text-tertiary': '#6D6250',
    'text-muted': '#8F836E', accent: '#F5A623',
  };
  for (const [k, v] of Object.entries(expected)) assert.equal(tokens[k], v, `--gv-${k}`);
  assert.match(tokens['accent-text'] ?? '', /^#[98]/);
  for (const k of ['coral', 'coral-text', 'peach', 'mint', 'sky', 'lav']) assert.ok(tokens[k], `--gv-${k} exists`);
});

test('WCAG AA contrast on every background', () => {
  const rows = [];
  for (const t of [...TEXT, 'text-muted']) {
    const min = t === 'text-muted' ? 3.0 : 4.5;
    for (const b of BGS) {
      assert.ok(tokens[t] && tokens[b], `${t}/${b} defined`);
      const r = ratio(tokens[t], tokens[b]);
      rows.push(`${t} ${tokens[t]} on ${b} ${tokens[b]}: ${r.toFixed(2)} (min ${min})`);
      assert.ok(r >= min, `${t} on ${b} is ${r.toFixed(2)}, needs ${min}`);
    }
  }
  console.log(rows.join('\n'));
});
