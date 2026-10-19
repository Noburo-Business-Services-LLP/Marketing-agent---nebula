import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Owner rule (2026-10-19): what is discarded, hidden or kept aside must not be shown on the working product.
// Old routes stay for bookmarks (App.tsx), but no customer screen may link to them or announce the old versions.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
  const rel = `${dir}/${e.name}`;
  if (e.isDirectory()) return rel.includes('staff') ? [] : walk(rel);
  return /\.tsx$/.test(e.name) ? [rel] : [];
});
const files = [...walk('pages'), ...walk('components')];

const FORBIDDEN_TEXT = [
  'old step-by-step', 'Open it here', 'old maker', 'old version', 'old dashboard', 'classic version',
  'classic dashboard', 'switch to the old', 'try the new', 'previous version', 'legacy version',
];
// Links into the discarded pages (the routes still exist in App.tsx only).
const FORBIDDEN_LINKS = [/['"`]\/[a-z-]+-classic['"`]/, /to=["']\/reels\/studio["']/, /navigate\(['"]\/reels\/studio['"]/];

test('customer screens show no link or banner to old versions', () => {
  assert.ok(files.length > 20);
  const hits = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const p of FORBIDDEN_TEXT) if (src.toLowerCase().includes(p.toLowerCase())) hits.push(`${f}: "${p}"`);
    for (const re of FORBIDDEN_LINKS) if (re.test(src)) hits.push(`${f}: ${re}`);
  }
  assert.deepEqual(hits, []);
});

test('the old routes still resolve for existing bookmarks', () => {
  const app = fs.readFileSync(path.join(ROOT, 'App.tsx'), 'utf8');
  for (const r of ['/reels/studio', '/dashboard-classic', '/content-calendar-classic', '/campaigns-classic', '/analytics-classic']) {
    assert.ok(app.includes(`path="${r}"`), `route ${r} removed`);
  }
});
