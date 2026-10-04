import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findBrandViolations } from '../scripts/brand-audit.mjs';

function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-'));
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  }
  return dir;
}

test('scanner flags visible names and ignores identifiers and comments', () => {
  const dir = fixture({
    'pages/A.tsx': [
      '<h1>Welcome to Gravity</h1>',
      "import GravityHome from './GravityHome';",
      '<div className="gravity-shell">',
      '// Gravity redesign',
      '{/* Gravity */}',
      '/* Pulsar',
      ' Orbit */',
      ' * Orbit note',
      'const x = 1; // Gravity trailing',
      '<p>Pulsar and Orbit agents</p>',
      '<a href="https://gravity.nebulaa.ai">x</a>',
    ].join('\n'),
    'node_modules/m/b.tsx': '<p>Gravity</p>',
    'tests/t.tsx': '<p>Gravity</p>',
    'index.html': '<title>Gravity</title>',
  });
  const v = findBrandViolations(dir);
  assert.deepEqual(v.map((x) => `${x.file}:${x.line}`), ['index.html:1', 'pages/A.tsx:1', 'pages/A.tsx:10']);
});

test('comment markers inside strings or line comments do not hide later lines', () => {
  const dir = fixture({
    'a.tsx': '<input accept="image/*" />\n<h1>Gravity</h1>',
    'b.tsx': '// see /audio/*\n<h1>Gravity</h1>',
    'c.tsx': '<p>a // b Gravity</p>',
    'd.tsx': '/* one\n Gravity\n */\n{/* Gravity */}\n// Gravity\nconst u = "https://gravity.nebulaa.ai";',
    'e.tsx': 'const p = "/*"; <b>Gravity</b>',
  });
  const v = findBrandViolations(dir).map((x) => `${x.file}:${x.line}`);
  assert.deepEqual(v, ['a.tsx:2', 'b.tsx:2', 'c.tsx:1', 'e.tsx:1']);
});

test('apostrophes, regex literals and stray markers never blind the scanner', () => {
  const dir = fixture({
    'a.tsx': "{/* don't touch */} <p>it's Gravity</p>\n<b>Gravity</b>",
    'b.tsx': "/* don't */ const a = 'x'; <b>Gravity</b>",
    'c.tsx': "{/* what's */} <b>Gravity</b> <i>don't</i>",
    'd.tsx': 'const r = /\\/*foo/;\n<b>Gravity</b>',
    'e.tsx': "<p>Don't /* </p>\n<b>Gravity</b>",
    'f.tsx': "/* don't Gravity */\nconst ok = 1;",
    'g.tsx': 'const g = "src/**/*.ts";\n<b>Gravity</b>',
  });
  const v = findBrandViolations(dir).map((x) => `${x.file}:${x.line}`);
  assert.deepEqual(v, ['a.tsx:1', 'a.tsx:2', 'b.tsx:1', 'c.tsx:1', 'd.tsx:2', 'e.tsx:2', 'g.tsx:2']);
});

test('scanner honours the allowlist', () => {
  const dir = fixture({
    'pages/B.tsx': '<p>Gravity internal</p>\n<p>Gravity shown</p>',
    'tests/brand-allowlist.json': JSON.stringify([{ file: 'pages/B.tsx', contains: 'Gravity internal', reason: 'test' }]),
  });
  const v = findBrandViolations(dir);
  assert.deepEqual(v.map((x) => x.line), [2]);
});

test('the real frontend has no customer-visible Gravity/Pulsar/Orbit', () => {
  const v = findBrandViolations(fileURLToPath(new URL('..', import.meta.url)));
  assert.equal(v.length, 0, v.map((x) => `${x.file}:${x.line}: ${x.text}`).join('\n'));
});
