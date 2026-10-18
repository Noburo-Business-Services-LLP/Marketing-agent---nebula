import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('the Competitors page has no Create Rival Post button, handler or modal', () => {
  const src = read('pages/Competitors.tsx');
  assert.ok(!/Create Rival Post/i.test(src));
  assert.ok(!/generateRivalPost|RivalPost|rivalPost|rival-post/.test(src));
});

test('the api service no longer has the rival post call', () => {
  const api = read('services/api.ts');
  assert.ok(!/generateRivalPost|generate-rival-post/.test(api));
});

test('no page or component calls the retired rival post flow', () => {
  const hits = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!['node_modules', 'dist', 'tests', 'scripts', 'public'].includes(e.name)) walk(p); }
      else if (/\.(tsx?|jsx?)$/.test(e.name) && /generateRivalPost|generate-rival-post|Create Rival Post/.test(fs.readFileSync(p, 'utf8'))) hits.push(path.relative(ROOT, p));
    }
  })(ROOT);
  assert.deepStrictEqual(hits, []);
});
