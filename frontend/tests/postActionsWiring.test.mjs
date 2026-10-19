// Source checks for the shared post actions (navigation phase 2): Approve never posts, Archive is a real archive,
// and the screens use the shared component and the real routes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

function walk(dir, out = []) {
  for (const name of readdirSync(join(root, dir))) {
    const p = join(dir, name);
    if (statSync(join(root, p)).isDirectory()) walk(p, out);
    else if (/\.(tsx|ts)$/.test(name)) out.push(p);
  }
  return out;
}

// Approve handlers that still call publish. Each one is a screen the second phase 2 change moves onto PostActions
// (Create results). Remove the entry when it is fixed; never add one.
const KNOWN_PUBLISH_TO_APPROVE = new Set([
  'pages/GravityCreate.tsx:approveNow',
  'pages/GravityCreate.tsx:sendAllToApproval',
]);

test('no screen approves by calling publish', () => {
  const found = [];
  for (const file of [...walk('pages'), ...walk('components')]) {
    const src = read(file);
    let at = src.indexOf('publishDraft(');
    while (at !== -1) {
      const before = src.slice(0, at);
      const m = [...before.matchAll(/(?:const|function)\s+([A-Za-z0-9_]+)\s*=?\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z0-9_]+)?\s*(?:=>|\{)/g)].pop();
      const name = m ? m[1] : '';
      if (/approv/i.test(name)) found.push(`${relative(root, join(root, file))}:${name}`);
      at = src.indexOf('publishDraft(', at + 1);
    }
  }
  const unexpected = found.filter((f) => !KNOWN_PUBLISH_TO_APPROVE.has(f));
  assert.deepEqual(unexpected, [], `Approve must call draftsAPI.approveDraft (POST /drafts/:id/approve), not publish: ${unexpected.join(', ')}`);
});

test('Review and approve lists what needs approval and approves through the shared actions', () => {
  const src = read('pages/GravityApprove.tsx');
  assert.doesNotMatch(src, /publishDraft/);
  assert.doesNotMatch(src, /isAwaitingReview/);
  assert.match(src, /needsApproval\(d\)/);
  assert.match(src, /<PostActions/);
});

test('the post sheet archives with /archive (or Reject for calendar posts), never with DELETE', () => {
  const src = read('components/DraftPreviewModal.tsx');
  assert.doesNotMatch(src, /deleteDraft|publishDraft|scheduleDraft/);
  assert.match(src, /<PostActions/);
  assert.match(src, /archiveVia=\{isCalendarPost \? 'reject' : 'archive'\}/);
});

test('PostActions maps each action to its own route', () => {
  const src = read('components/PostActions.tsx');
  const cases = {
    approve: 'approveDraft', postNow: 'publishDraft', makeAgain: 'retryImageGeneration', unschedule: 'unscheduleDraft',
    unapprove: 'unapproveDraft', delete: 'deleteDraft', restore: 'restoreDraft',
  };
  for (const [key, fn] of Object.entries(cases)) assert.match(src, new RegExp(`case '${key}':[^\\n]*draftsAPI\\.${fn}\\(`), key);
  assert.match(src, /case 'archive':[^\n]*draftsAPI\.archiveDraft\(/);
  assert.match(src, /draftsAPI\.scheduleDraft\(/);
  // publish is only reached from Post now
  assert.equal((src.match(/publishDraft\(/g) || []).length, 1);
});

test('the api helpers call the Phase 1 routes', () => {
  const src = read('services/api.ts');
  for (const [fn, path] of [['approveDraft', '/approve'], ['unapproveDraft', '/unapprove'], ['unscheduleDraft', '/unschedule'], ['archiveDraft', '/archive'], ['restoreDraft', '/restore']]) {
    assert.match(src, new RegExp(`${fn}: async[\\s\\S]{0,200}?\\$\\{encodeURIComponent\\(id\\)\\}${path}\`, \\{ method: 'POST' \\}`), fn);
  }
  assert.match(src, /getDraftCounts: async[\s\S]{0,120}'\/drafts\/counts'/);
  assert.match(src, /getBin: async[\s\S]{0,120}'\/drafts\?status=binned'/);
});

test('the Library has the views, the counts and the Bin note', () => {
  const src = read('pages/Library.tsx');
  assert.match(src, /draftsAPI\.getDraftCounts\(\)/);
  assert.match(src, /draftsAPI\.getBin\(\)/);
  assert.match(src, /<PostActions/);
  assert.match(src, /Items stay in the Bin for \{BIN_DAYS\} days/);
  const lib = read('utils/library.ts');
  assert.match(lib, /'Needs approval'[\s\S]*'Approved'[\s\S]*'Scheduled'[\s\S]*'Posted'[\s\S]*'All'[\s\S]*'Archived'[\s\S]*'Bin'/);
});

test('customer wording on the new files stays plain', () => {
  for (const f of ['utils/postActions.ts', 'components/PostActions.tsx', 'components/DraftPreviewModal.tsx', 'pages/Library.tsx', 'pages/GravityApprove.tsx']) {
    // Comments and the plans page address (/trial-expired) are not customer words.
    const src = read(f).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '').replace(/\/trial-expired/g, '');
    const hit = src.match(/\bcredits?\b(?!\.)|\btrial\b|7 days|Ayrshare|Cloudinary|OpenAI|Gemini/i);
    assert.equal(hit, null, `${f}: ${hit && hit[0]}`);
  }
});
