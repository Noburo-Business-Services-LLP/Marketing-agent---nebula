import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkBudget, LIMITS } from '../scripts/art-budget.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts/art-budget.mjs');

function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'art-budget-'));
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return dir;
}
const SMALL = '<svg viewBox="0 0 10 10"><path d="M0 0h10v10z" /></svg>';
const TILE = "import {rasterAttrs} from '../utils/tiles'; export default () => <img {...rasterAttrs(a)} />;";
const UTIL = "export function rasterAttrs(a){ return { loading: 'lazy', decoding: 'async', width: a.width, height: a.height }; }";
const base = { 'components/Tile.tsx': TILE, 'utils/tiles.ts': UTIL };

test('the limits are the agreed ones', () => {
  assert.equal(LIMITS.pieceRaw, 2048);
  assert.equal(LIMITS.totalGzip, 40 * 1024);
  assert.equal(LIMITS.raster, 40 * 1024);
});

test('the real illustration set and tile assets are inside the budget', () => {
  const r = checkBudget(ROOT);
  assert.deepEqual(r.violations, []);
  assert.ok(r.art.length >= 23, 'the 22 pieces plus the shared frame are measured');
  assert.ok(r.totalGzip < LIMITS.totalGzip);
});

test('every one of the 22 required pieces exists and is exported', () => {
  const index = fs.readFileSync(path.join(ROOT, 'components/art/index.ts'), 'utf8');
  const names = ['SinglePost', 'Campaign', 'Carousel', 'LinkedIn', 'Video', 'Reel', 'Photoshoot', 'Product', 'Model', 'Calendar', 'Inbox', 'Reviews', 'AutoReply', 'Performance', 'PlanMap', 'BrandAssets', 'Blueprint', 'Memory', 'Competitors', 'Trending', 'ReviewQueue', 'Ideas'];
  for (const n of names) {
    assert.ok(index.includes(`${n}Art }`), `${n}Art exported`);
    assert.ok(fs.existsSync(path.join(ROOT, `components/art/${n}.tsx`)), `${n}.tsx`);
  }
});

test('a piece over 2 KB fails', () => {
  const dir = fixture({ ...base, 'components/art/Big.tsx': SMALL + ' '.repeat(2100) });
  const r = checkBudget(dir);
  assert.ok(r.violations.some((v) => /Big\.tsx.*2 KB|Big\.tsx.*over/i.test(v)), r.violations.join('\n'));
});

test('a set over 40 KB gzip fails', () => {
  const noisy = () => Array.from({ length: 1900 }, () => Math.random().toString(36).slice(2, 3)).join('');
  const files = { ...base };
  for (let i = 0; i < 60; i += 1) files[`components/art/P${i}.tsx`] = `/*${noisy()}*/`;
  const r = checkBudget(fixture(files));
  assert.ok(r.violations.some((v) => /gzip/i.test(v) && /whole set|total/i.test(v)), r.violations.join('\n'));
});

test('an external image, innerHTML, text, a script or a second gradient fails', () => {
  const cases = {
    'components/art/A.tsx': '<svg><image href="https://x.example/a.png" /></svg>',
    'components/art/B.tsx': '<svg><image xlinkHref="//x.example/a.png" /></svg>',
    'components/art/C.tsx': '<svg dangerouslySetInnerHTML={{ __html: x }} />',
    'components/art/D.tsx': '<svg><text x="1">Hi</text></svg>',
    'components/art/E.tsx': '<svg><linearGradient id="a" /><radialGradient id="b" /></svg>',
    'components/art/F.tsx': '<svg><script>1</script></svg>',
  };
  const r = checkBudget(fixture({ ...base, ...cases }));
  for (const f of ['A', 'B', 'C', 'D', 'E', 'F']) assert.ok(r.violations.some((v) => v.includes(`${f}.tsx`)), `${f} flagged`);
});

test('a raster tile asset over 40 KB fails and a small one passes', () => {
  const r = checkBudget(fixture({ ...base, 'public/assets/tiles/ok.webp': 'x'.repeat(1000), 'public/assets/tiles/big.webp': 'x'.repeat(41 * 1024) }));
  assert.ok(r.violations.some((v) => v.includes('big.webp')));
  assert.ok(!r.violations.some((v) => v.includes('ok.webp')));
  assert.equal(r.rasters.length, 2);
});

test('Tile must use the lazy helper, and the helper must set lazy, async, width and height', () => {
  let r = checkBudget(fixture({ 'components/Tile.tsx': 'export default () => <img src="/a.png" />;', 'utils/tiles.ts': UTIL }));
  assert.ok(r.violations.some((v) => /Tile\.tsx/.test(v) && /rasterAttrs/.test(v)));
  r = checkBudget(fixture({ 'components/Tile.tsx': TILE, 'utils/tiles.ts': 'export function rasterAttrs(a){ return { src: a.src }; }' }));
  assert.ok(r.violations.some((v) => /tiles\.ts/.test(v) && /lazy/.test(v)));
});

test('the command line exits 0 on the real tree and prints a table', () => {
  const out = execFileSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.match(out, /SinglePost\.tsx/);
  assert.match(out, /Total/i);
  assert.match(out, /OK/);
});

test('the command line exits non-zero on a violation', () => {
  const dir = fixture({ ...base, 'components/art/Big.tsx': SMALL + ' '.repeat(2100) });
  assert.throws(() => execFileSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8', stdio: 'pipe' }));
});

test('Tile, TileGrid, DarkPanel and the art never use dangerouslySetInnerHTML', () => {
  for (const f of ['components/Tile.tsx', 'components/TileGrid.tsx', 'components/DarkPanel.tsx']) {
    assert.ok(!fs.readFileSync(path.join(ROOT, f), 'utf8').includes('dangerouslySetInnerHTML'), f);
  }
});
