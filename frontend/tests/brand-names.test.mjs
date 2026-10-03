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
