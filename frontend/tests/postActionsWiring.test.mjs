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

// Approve handlers that still call publish. Empty since the Create results moved onto PostActions; never add one.
const KNOWN_PUBLISH_TO_APPROVE = new Set([]);

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
  // The Bin is the drafts list with status=binned, read page after page (load-test weeks 2 to 3).
  assert.match(src, /getBin: async[\s\S]{0,120}draftsAPI\.getDrafts\('binned'\)/);
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
  for (const f of ['utils/postActions.ts', 'components/PostActions.tsx', 'components/DraftPreviewModal.tsx', 'pages/Library.tsx', 'pages/GravityApprove.tsx',
    'components/ItemActions.tsx', 'utils/itemActions.ts', 'utils/scheduleAll.ts', 'utils/calendarPosts.ts', 'pages/GravityCreate.tsx',
    'pages/Photoshoot.tsx', 'pages/GravityCalendar.tsx', 'utils/homeLayout.ts']) {
    // Comments and the plans page address (/trial-expired) are not customer words.
    const src = read(f).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '').replace(/\/trial-expired/g, '');
    const hit = src.match(/\bcredits?\b(?!\.)|\btrial\b|7 days|Ayrshare|Cloudinary|OpenAI|Gemini/i);
    assert.equal(hit, null, `${f}: ${hit && hit[0]}`);
  }
});

test('Create results: the shared post actions, no publish anywhere, and Schedule all instead of "Send all to approval"', () => {
  const src = read('pages/GravityCreate.tsx');
  assert.doesNotMatch(src, /publishDraft/, 'Create never posts by itself; Post now lives in PostActions and asks first');
  assert.doesNotMatch(src, /Send all to approval|sendAllToApproval|approveNow/);
  assert.match(src, /<PostActions[\s\S]{0,120}variant="row"/);
  assert.match(src, /makeAgainQuarks=\{regenerateCostFor\(d\)\}/, 'Make again shows its price');
  // Schedule all schedules (never posts), only what can be scheduled, after a confirm that says what will happen.
  assert.match(src, /const scheduleAll = async[\s\S]{0,900}draftsAPI\.scheduleDraft\(/);
  assert.match(src, /schedulable\(results/);
  assert.match(src, /scheduleSummary\(count, platforms, first, gap\)/);
  assert.match(src, /Schedule all \{scheduleList\.length\}/);
  assert.doesNotMatch(src, /navigate\('\/drafts'\)/);
});

test('the calendar opens a post in its post sheet and refreshes after a change, never the old review list', () => {
  const src = read('pages/GravityCalendar.tsx');
  assert.doesNotMatch(src, /navigate\('\/drafts'\)/);
  assert.match(src, /<DraftPreviewModal[\s\S]{0,300}onChanged=\{\(\) => load\(true\)\}/);
  assert.match(src, /draftByCampaign\(drafts\)/);
  assert.match(src, /onClick=\{\(\) => openPost\(p\.id/);
  // The plan view of the calendar opens a day's post in the same sheet.
  assert.doesNotMatch(read('components/calendar/PlanDayList.tsx'), /\/drafts\?draftId/);
  assert.match(read('pages/ContentCalendar.tsx'), /<DraftPreviewModal[\s\S]{0,300}onChanged=\{\(\) => loadCalendar\(true\)\}/);
});

test('Review and approve never makes a picture again by itself (it charges); Make again is a priced button', () => {
  const src = read('pages/GravityApprove.tsx');
  assert.doesNotMatch(src, /autoRetried/);
  assert.equal((src.match(/retryImageGeneration\(/g) || []).length, 1, 'only the asked-for Make again');
  assert.match(src, /const redoDraft = async[\s\S]{0,700}await confirm\([\s\S]{0,200}retryImageGeneration\(/);
});

test('Videos and Photoshoot results use the post button style, with no Schedule or Post now', () => {
  const video = read('pages/CreateVideo.tsx');
  assert.match(video, /<ItemActions items=\{videoActions\(current\)\} variant="row"/);
  assert.match(video, /<ItemActions items=\{videoActions\(v\)\} variant="compact"/);
  const noComments = (t) => t.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
  assert.doesNotMatch(noComments(video), /Post now|scheduleDraft|publishDraft|>Schedule</);
  const photo = read('pages/Photoshoot.tsx');
  assert.match(photo, /<ItemActions items=\{items\} variant="compact"/);
  assert.match(photo, /confirm: photoMakeAgainConfirm\(perPhoto\)/, 'a photo is made again only after a question with its price');
  assert.doesNotMatch(noComments(photo), /Post now|scheduleDraft|publishDraft/);
  const lib = read('pages/Library.tsx');
  assert.match(lib, /studioVideosAPI\.list\(\)/, 'videos from the Videos page are in the Library');
  assert.match(lib, /studioVideosAPI\.remove\(i\.id\)/);
});

test('Home: the approval number and Do this next lead to the Library approval view', () => {
  assert.match(read('utils/homeLayout.ts'), /title: 'Needs approval', to: '\/library\?view=approve'/);
  assert.match(read('components/ThisWeekCard.tsx'), /to="\/library\?view=approve"/);
});
