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
  // Owner decisions 2026-10-19: Hero video stays hidden; one Videos flow; nothing that leads nowhere.
  'Hero videos', 'Create a Hero video', 'Step-by-step videos', 'step-by-step video', 'Coming soon', 'legacy copy', '(soon)',
];
// The hidden Hero feature itself (its page and parts) may use its own name; nothing else may.
const HERO_OWN = /^(pages\/HeroVideo\.tsx|components\/Hero[A-Za-z]*\.tsx)$/;
// Links into the discarded pages (the routes still exist in App.tsx only).
const FORBIDDEN_LINKS = [/['"`]\/[a-z-]+-classic['"`]/, /['"`]\/reels\/hero['"`]/, /to=["']\/reels\/studio["']/, /navigate\(['"]\/reels\/studio['"]/];

test('customer screens show no link or banner to old versions', () => {
  assert.ok(files.length > 20);
  const hits = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const p of FORBIDDEN_TEXT) if (!(HERO_OWN.test(f) && /hero/i.test(p)) && src.toLowerCase().includes(p.toLowerCase())) hits.push(`${f}: "${p}"`);
    for (const re of FORBIDDEN_LINKS) if (!(HERO_OWN.test(f) && /hero/.test(String(re))) && re.test(src)) hits.push(`${f}: ${re}`);
  }
  assert.deepEqual(hits, []);
});

test('the old routes still resolve for existing bookmarks', () => {
  const app = fs.readFileSync(path.join(ROOT, 'App.tsx'), 'utf8');
  for (const r of ['/reels/studio', '/dashboard-classic', '/content-calendar-classic', '/campaigns-classic', '/analytics-classic']) {
    assert.ok(app.includes(`path="${r}"`), `route ${r} removed`);
  }
});

test('the left menu calls the video entry "Create video" and keeps "Create content"', () => {
  const nav = fs.readFileSync(path.join(ROOT, 'utils/navMenu.ts'), 'utf8');
  const layout = fs.readFileSync(path.join(ROOT, 'components/Layout.tsx'), 'utf8');
  assert.match(nav, /label: 'Create video', to: '\/reels'/);
  assert.match(nav, /label: 'Create content', to: '\/campaigns'/);
  assert.doesNotMatch(nav + layout, /label: 'Videos'/);
});

test('the Library offers no Hero filter and names the video filter "Videos"', () => {
  const lib = fs.readFileSync(path.join(ROOT, 'pages/Library.tsx'), 'utf8');
  assert.doesNotMatch(lib, /key: 'hero'/);
  // The source dropdown was removed (owner, 2026-10-19: redundant next to the type toggle); the toggle names videos "Videos".
  assert.match(lib, /key: 'video', label: 'Videos'/);
  assert.doesNotMatch(lib, /Hero video/);
});
