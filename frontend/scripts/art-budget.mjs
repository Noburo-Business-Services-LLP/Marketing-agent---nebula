#!/usr/bin/env node
// Art budget for the tile illustrations and small tile photos (design draft 2026-10-18, section 3).
//
//   node scripts/art-budget.mjs          check the real tree (exit 1 on any violation)
//   node scripts/art-budget.mjs <dir>    check another frontend-shaped folder (used by the tests)
//
// Rules: each file in components/art/ at most 2 KB raw; the whole set at most 40 KB gzip (sum of each
// file's gzip, which is the stricter way to count); each photo in public/assets/tiles/ at most 40 KB;
// no external image, no inner HTML, no text (fonts), no scripts and at most one gradient in a piece;
// Tile must build photo attributes with rasterAttrs(), which must set lazy loading, async decoding,
// width and height.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

export const LIMITS = { pieceRaw: 2048, totalGzip: 40 * 1024, raster: 40 * 1024 };

const RASTER_EXT = /\.(png|jpe?g|webp|avif|gif|svg)$/i;
const kb = (n) => (n / 1024).toFixed(2);

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full) : [full];
  });
}

/** The things an illustration must never contain, with a plain reason. */
const ART_RULES = [
  [/<image\b[^>]*(?:xlink:?href|href)\s*=\s*["'{]*\s*(?:https?:)?\/\//i, 'an image from another site'],
  [/<image\b/i, 'an <image> tag (draw with shapes instead)'],
  [/dangerouslySetInnerHTML/, 'dangerouslySetInnerHTML'],
  [/<text\b/i, 'a <text> element (it would need a font)'],
  [/<script\b/i, 'a <script> element'],
  [/<foreignObject\b/i, 'a <foreignObject> element'],
  [/url\(\s*["']?(?:https?:)?\/\//i, 'a url() to another site'],
  [/@import/, '@import'],
];

export function checkBudget(root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')) {
  const violations = [];
  const art = [];
  for (const full of walk(path.join(root, 'components/art')).filter((f) => /\.(tsx?|jsx?|svg)$/.test(f)).sort()) {
    const buf = fs.readFileSync(full);
    const text = buf.toString('utf8');
    const rel = path.relative(root, full);
    const raw = buf.length;
    const gzip = zlib.gzipSync(buf, { level: 9 }).length;
    art.push({ file: rel, raw, gzip });
    if (raw > LIMITS.pieceRaw) violations.push(`${rel} is ${kb(raw)} KB, over the 2 KB limit for one piece`);
    for (const [re, why] of ART_RULES) if (re.test(text)) violations.push(`${rel} contains ${why}`);
    const gradients = (text.match(/<(?:linear|radial)Gradient\b/g) || []).length;
    if (gradients > 1) violations.push(`${rel} has ${gradients} gradients (one at most per piece)`);
  }
  const totalGzip = art.reduce((s, a) => s + a.gzip, 0);
  const totalRaw = art.reduce((s, a) => s + a.raw, 0);
  if (totalGzip > LIMITS.totalGzip) violations.push(`The whole set is ${kb(totalGzip)} KB gzip, over the 40 KB limit`);

  const rasters = walk(path.join(root, 'public/assets/tiles'))
    .filter((f) => RASTER_EXT.test(f))
    .sort()
    .map((f) => ({ file: path.relative(root, f), bytes: fs.statSync(f).size }));
  for (const r of rasters) if (r.bytes > LIMITS.raster) violations.push(`${r.file} is ${kb(r.bytes)} KB, over the 40 KB limit for one photo tile`);

  // Photos must go through the helper that makes them lazy and fixed in size.
  const tilePath = path.join(root, 'components/Tile.tsx');
  if (fs.existsSync(tilePath)) {
    const tile = fs.readFileSync(tilePath, 'utf8');
    const imgs = tile.match(/<img\b[^>]*>/g) || [];
    if (imgs.some((i) => !i.includes('{...rasterAttrs('))) violations.push('components/Tile.tsx has an <img> that does not use rasterAttrs()');
    if (imgs.length && !tile.includes('rasterAttrs(')) violations.push('components/Tile.tsx must call rasterAttrs()');
    if (/dangerouslySetInnerHTML/.test(tile)) violations.push('components/Tile.tsx contains dangerouslySetInnerHTML');
  }
  const helperPath = path.join(root, 'utils/tiles.ts');
  if (fs.existsSync(helperPath)) {
    const h = fs.readFileSync(helperPath, 'utf8');
    const fn = h.slice(h.indexOf('function rasterAttrs'));
    for (const [needle, what] of [["loading: 'lazy'", "loading: 'lazy'"], ["decoding: 'async'", "decoding: 'async'"], ['width', 'a width'], ['height', 'a height']]) {
      if (!fn.includes(needle)) violations.push(`utils/tiles.ts rasterAttrs() must set ${what} (lazy loading)`);
    }
  }
  return { art, rasters, totalGzip, totalRaw, violations };
}

function printTable(r) {
  const pad = (s, n) => String(s).padEnd(n);
  const num = (s, n) => String(s).padStart(n);
  console.log(`${pad('File', 34)}${num('Raw KB', 9)}${num('Gzip KB', 10)}  Limit`);
  for (const a of r.art) console.log(`${pad(path.basename(a.file), 34)}${num(kb(a.raw), 9)}${num(kb(a.gzip), 10)}  ${a.raw > LIMITS.pieceRaw ? 'OVER' : 'ok'}`);
  console.log(`${pad('Total (art)', 34)}${num(kb(r.totalRaw), 9)}${num(kb(r.totalGzip), 10)}  ${r.totalGzip > LIMITS.totalGzip ? 'OVER' : 'ok'} (limit ${kb(LIMITS.totalGzip)} KB gzip)`);
  if (r.art.length) {
    const biggest = r.art.reduce((m, a) => (a.raw > m.raw ? a : m));
    console.log(`Largest piece: ${path.basename(biggest.file)} at ${kb(biggest.raw)} KB raw (limit ${kb(LIMITS.pieceRaw)} KB)`);
  }
  if (r.rasters.length) {
    console.log('\nPhoto tiles');
    for (const f of r.rasters) console.log(`${pad(path.basename(f.file), 34)}${num(kb(f.bytes), 9)}  ${f.bytes > LIMITS.raster ? 'OVER' : 'ok'}`);
  } else console.log('\nNo photo tiles registered in public/assets/tiles/.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
  const r = checkBudget(root);
  printTable(r);
  if (r.violations.length) {
    console.log(`\n${r.violations.length} violation(s):`);
    for (const v of r.violations) console.log(`  - ${v}`);
    process.exit(1);
  }
  console.log('\nOK: the art is inside the budget.');
}
