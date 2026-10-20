// Tailwind is built at build time (D67): the Play CDN, its inline config script and the esm.sh import map are gone
// from index.html, and the cascade order the CDN produced is kept (page <style> first, then Tailwind, then each
// component's own .css). See docs/superpowers/ops/frontend-performance.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import tailwindConfig from '../tailwind.config.js';
import postcssConfig from '../postcss.config.js';
import { enableFontStylesheet } from '../utils/fontStyles.ts';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const html = read('../index.html');
const pkg = JSON.parse(read('../package.json'));

test('index.html loads no Tailwind CDN, no import map and no inline script', () => {
  assert.doesNotMatch(html, /cdn\.tailwindcss\.com/);
  assert.doesNotMatch(html, /esm\.sh/);
  assert.doesNotMatch(html, /importmap/);
  assert.doesNotMatch(html, /tailwind\.config\s*=/);
  // Every <script> has a src (the app bundle); no inline event handler such as onload="...".
  for (const m of html.matchAll(/<script\b([^>]*)>/g)) assert.match(m[1], /\ssrc=/, m[0]);
  assert.doesNotMatch(html, /\son[a-z]+="/);
  // Google Fonts stays non-blocking: media=print until the bundle switches it on, plus the noscript copy.
  assert.match(html, /<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^"]*" media="print" id="nb-font-styles" \/>/);
  assert.match(html, /<noscript><link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com/);
});

test('the Tailwind sheet is the first import of the entry, before App and its component styles', () => {
  const entry = read('../index.tsx');
  const imports = [...entry.matchAll(/^import\s.*$/gm)].map((m) => m[0]);
  assert.equal(imports[0], "import './index.css';");
  assert.ok(imports.findIndex((l) => l.includes("from './App'")) > 0);
  const css = read('../index.css');
  assert.match(css, /@tailwind base;\s*@tailwind components;\s*@tailwind utilities;/);
  // The page <style> (tokens and the override layer) stays in index.html, so it comes before the utilities as before.
  assert.match(html, /begin LIGHT SEMANTICS/);
});

test('Tailwind is pinned to the version the Play CDN served, with the config index.html used to set', () => {
  assert.equal(pkg.devDependencies.tailwindcss, '3.4.17');
  assert.ok(pkg.devDependencies.postcss && pkg.devDependencies.autoprefixer);
  assert.ok(!pkg.dependencies.tailwindcss, 'a build tool, not a runtime dependency');
  assert.deepEqual(Object.keys(postcssConfig.plugins), ['tailwindcss', 'autoprefixer']);
  assert.equal(tailwindConfig.darkMode, 'class');
  assert.deepEqual(tailwindConfig.plugins, []);
  const { colors, fontFamily } = tailwindConfig.theme.extend;
  assert.deepEqual(colors.nebula, { dark: '#070A12', gold: '#ffcc29', silver: '#ededed' });
  assert.equal(colors.gravity.gold, '#F5A623');
  assert.equal(Object.keys(colors.gravity).length, 13);
  assert.deepEqual(fontFamily.sans, ['"Plus Jakarta Sans"', 'Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif']);
  assert.deepEqual(fontFamily.serif, ['"Playfair Display"', 'Georgia', 'serif']);
  // Every folder with page source is scanned; tests and scripts are not.
  const files = tailwindConfig.content.files.join(' ');
  for (const dir of ['components', 'pages', 'context', 'hooks', 'utils', 'services', 'constants']) assert.ok(files.includes(dir), dir);
  assert.ok(files.includes('./index.html') && files.includes('./*.{ts,tsx}'));
  assert.ok(!/scripts|tests|node_modules/.test(files));
});

test('class names built from pieces are safelisted (the build cannot see them, the Play CDN could)', async () => {
  const { readdirSync, statSync } = await import('node:fs');
  const { join, relative } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = fileURLToPath(new URL('..', import.meta.url));
  const files = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (/(^|\/)(node_modules|dist|scripts|tests|public)(\/|$)/.test(relative(root, p))) continue; if (statSync(p).isDirectory()) walk(p); else if (/\.(tsx?|jsx?)$/.test(f) && !/\.config\./.test(f)) files.push(p); } };
  walk(root);
  // A variant written in front of an interpolation, e.g. `hover:${isDarkMode ? 'bg-x' : 'bg-y'}`.
  const hits = [];
  for (const p of files) for (const m of readFileSync(p, 'utf8').matchAll(/\b(hover|focus|active|group-hover|focus-visible|disabled|placeholder|dark|sm|md|lg|xl|2xl):\$\{([^}]*)\}/g)) hits.push(`${relative(root, p)}: ${m[0]}`);
  // Known today (all listed in tailwind.config.js safelist). A new one: add its classes to the safelist, then here.
  assert.deepEqual(hits.map((h) => h.split(':')[0]).sort(), ['components/NotificationBell.tsx', 'pages/Dashboard.tsx', 'pages/Dashboard.tsx', 'pages/Dashboard.tsx'], hits.join('\n'));
  for (const c of ['hover:bg-[#ededed]/5', 'hover:bg-gray-50', 'hover:bg-[#161b22]', 'hover:bg-[#f5f5f5]', 'hover:text-[#ededed]', 'hover:text-[#070A12]']) {
    assert.ok(tailwindConfig.safelist.includes(c), c);
  }
});

test('the font stylesheet is switched on when it has loaded, or at once when it already has', () => {
  const dom = new JSDOM('<link rel="stylesheet" href="x.css" media="print" id="nb-font-styles">');
  const doc = dom.window.document;
  const link = doc.getElementById('nb-font-styles');
  enableFontStylesheet(doc);
  assert.equal(link.media, 'print');
  link.dispatchEvent(new dom.window.Event('load'));
  assert.equal(link.media, 'all');
  // Already loaded: .sheet is set.
  const dom2 = new JSDOM('<link rel="stylesheet" href="x.css" media="print" id="nb-font-styles">');
  const l2 = dom2.window.document.getElementById('nb-font-styles');
  Object.defineProperty(l2, 'sheet', { value: {} });
  enableFontStylesheet(dom2.window.document);
  assert.equal(l2.media, 'all');
  // No link: nothing happens.
  enableFontStylesheet(new JSDOM('').window.document);
});
