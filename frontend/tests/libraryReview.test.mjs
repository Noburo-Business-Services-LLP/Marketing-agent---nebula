import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Navigation phase 5: Review one by one is a view of the Library, not its own page.
const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

test('the Library draws Review one by one for ?view=approve&mode=one, with the shared post actions', () => {
  const lib = read('pages/Library.tsx');
  assert.match(lib, /params\.get\('mode'\) === 'one'/);
  assert.match(lib, /<GravityApprove user=\{user\} embedded onBack=/);
  assert.doesNotMatch(lib, /navigate\('\/drafts'\)/);
  const review = read('pages/GravityApprove.tsx');
  assert.match(review, /<PostActions/);
  assert.match(review, /embedded \? null/);
});

test('the arrow keys move between posts only in the one-by-one view and never while typing or in a dialog', () => {
  const review = read('pages/GravityApprove.tsx');
  assert.match(review, /if \(reviewView !== 'single'\) return undefined;/);
  assert.match(review, /closest\('input, textarea, select/);
});

test('no customer screen links to /drafts any more; the old address redirects', () => {
  const files = ['pages/Library.tsx', 'pages/GravityApprove.tsx', 'pages/GravityCalendar.tsx', 'pages/GravityCreate.tsx', 'components/Layout.tsx', 'utils/homeLayout.ts'];
  for (const f of files) assert.doesNotMatch(read(f), /['"`]\/drafts['"`?]/, f);
  assert.match(read('App.tsx'), /path="\/drafts" element=\{<OldAddress from="\/drafts" \/>\}/);
});

test('the calendar counts what waits for approval with the Library count', () => {
  const cal = read('pages/GravityCalendar.tsx');
  assert.match(cal, /draftsAPI\.getDraftCounts\(\)/);
  assert.match(cal, /counts\?\.needsApproval/);
});
