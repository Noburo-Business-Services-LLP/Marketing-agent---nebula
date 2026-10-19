import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHECK_LINE, DECENT_LINE, KIND_LABEL, OWN_PAGE_LINE, SELF_POST_LINE, WORKING_LINE, createHandoff, draftOf, draftsAvailable,
  isDraftOptions, leftLine, newDraftKey, outcomeOf, priceLabel,
} from '../utils/homeDrafts.ts';
import { isPlainCopy, draftSourceTitle, workingView } from '../utils/competitorsHome.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const opts = (over = {}) => ({
  success: true, enabled: true, entitled: true, locked: null, postsOnly: false,
  prices: { response_post: { quarks: 8, price: "8 Quarks (about 1 post's worth)", worth: "about 1 post's worth" }, witty_comment: { quarks: 6, price: "6 Quarks (about 1 post's worth)", worth: "about 1 post's worth" } },
  tones: ['friendly', 'witty'], languages: [{ key: 'english', label: 'English' }, { key: 'tamil', label: 'Tamil' }], language: 'tamil',
  perDay: 20, left: 17, maxComment: 220, maxCaption: 600, ...over,
});

test('options: the shape is checked, and the actions show only when on, allowed, not staff and the post has a reference', () => {
  assert.ok(isDraftOptions(opts()));
  assert.ok(isDraftOptions({ staff: true }));
  assert.ok(!isDraftOptions({ enabled: true }));
  assert.ok(!isDraftOptions(null));
  assert.equal(draftsAvailable(opts(), 'c1.p-abc'), true);
  assert.equal(draftsAvailable(opts({ enabled: false }), 'c1.p-abc'), false, 'switch off: no actions');
  assert.equal(draftsAvailable(opts({ entitled: false, locked: 'addon' }), 'c1.p-abc'), false);
  assert.equal(draftsAvailable(opts(), ''), false, 'an older post without a reference gets no actions');
  assert.equal(draftsAvailable({ staff: true }, 'x'), false);
  assert.equal(draftsAvailable(null, 'x'), false);
});

test('the price is shown before pressing: Quarks with the posts equivalent, or only the posts equivalent for agencies', () => {
  assert.equal(priceLabel(opts(), 'witty_comment'), '6 Quarks');
  assert.equal(priceLabel(opts(), 'response_post', true), '8 Quarks');
  assert.equal(priceLabel(opts({ postsOnly: true }), 'witty_comment'), '6 Quarks');
  assert.equal(priceLabel(null, 'witty_comment'), '');
  assert.equal(leftLine(opts()), 'You can make 17 more drafts today.');
  assert.equal(leftLine(opts({ left: 1 })), 'You can make 1 more draft today.');
  assert.equal(leftLine(opts({ left: 0 })), "You have made today's drafts. You can make more tomorrow.");
  assert.equal(leftLine(opts({ left: null })), '');
});

test('one key per press, safe for the server pattern', () => {
  const a = newDraftKey(1760000000000, () => 0.5); const b = newDraftKey(1760000000000);
  assert.match(a, /^[A-Za-z0-9_-]{8,64}$/);
  assert.notEqual(a, b);
});

test('outcomes: each failed answer maps to a plain state; nothing is shown as a draft', () => {
  const err = (status, data) => Object.assign(new Error(data.message || 'x'), { status, data });
  assert.deepEqual(outcomeOf(err(422, { blocked: true, message: 'We could not write a draft we are happy with. Nothing was charged.' })), { state: 'blocked', message: 'We could not write a draft we are happy with. Nothing was charged.', canRetry: true });
  assert.equal(outcomeOf(err(429, { limit: 'day', message: 'm' })).state, 'limit');
  assert.equal(outcomeOf(err(429, { limit: 'day', message: 'm' })).canRetry, false);
  assert.equal(outcomeOf(err(429, { limit: 'minute', message: 'm' })).canRetry, true);
  assert.equal(outcomeOf(err(409, { inProgress: true, message: 'm' })).state, 'waiting');
  assert.equal(outcomeOf(err(403, { locked: 'addon', message: 'Drafts from competitor posts need the competitor add-on.' })).state, 'locked');
  assert.equal(outcomeOf(new Error("This draft needs 6 Quarks (about 1 post's worth). Please top up or choose a plan.")).state, 'balance');
  assert.equal(outcomeOf(err(503, { serviceBusy: true, message: 'm' })).state, 'busy');
  assert.equal(outcomeOf(err(503, { disabled: true, message: 'm' })).canRetry, false);
  assert.equal(outcomeOf(err(404, { message: 'm' })).state, 'missing');
  assert.equal(outcomeOf(new Error('')).message, 'We could not write a draft just now. Nothing was charged. Please try again.');
  assert.equal(outcomeOf(null).state, 'error');
  assert.equal(draftOf({ draft: { comment: '  Lovely  ' } }, 'witty_comment').comment, 'Lovely');
  assert.equal(draftOf({ draft: { comment: '' } }, 'witty_comment'), null);
  assert.equal(draftOf({ draft: { comment: 'x' } }, 'response_post'), null, 'a reply of the wrong kind is not shown');
  assert.equal(draftOf({}, 'witty_comment'), null);
});

test('"Use in Create" hands the caption and the picture idea to Create content as a single post', () => {
  const h = createHandoff({ caption: 'Warm brownies tonight.', imageIdea: 'A warm tray by a window.' }, 'tamil');
  assert.deepEqual(h, { route: '/campaigns', data: { mode: 'single', topic: 'Warm brownies tonight.\n\nPicture idea: A warm tray by a window.', language: 'tamil', source: 'home' } });
  assert.equal(createHandoff({ caption: '' }, ''), null);
  assert.deepEqual(createHandoff({ caption: 'Only a caption.' }, '').data, { mode: 'single', topic: 'Only a caption.', source: 'home' });
});

test('the post a draft starts from is named plainly, and working rows carry the reference', () => {
  assert.equal(draftSourceTitle('Sweet Co Bakery', 'video'), "Sweet Co Bakery's reel");
  assert.equal(draftSourceTitle('', 'carousel'), "A competitor's carousel");
  const row = workingView({ competitorId: 'c1', name: 'N', handle: 'h', period: 'week', type: 'image', likes: 1, comments: 0, at: '', url: '', ref: 'c1.p-x', reason: 'r', worked: null, action: { label: 'l', kind: 'post', mode: 'single', brief: 'b' } });
  assert.equal(row.ref, 'c1.p-x');
  assert.equal(workingView({ ...row, ref: undefined, competitorId: 'c1', name: 'N', type: 'image', reason: 'r', action: row.action }).ref, '');
});

test('the sheet says plainly that the customer posts the comment and Nebulaa never posts on other pages', () => {
  assert.equal(SELF_POST_LINE, 'You post this yourself on their page. Nebulaa never posts on other pages.');
  const sheet = read('components/home/DraftSheet.tsx');
  assert.ok(sheet.includes('SELF_POST_LINE') && sheet.includes('CHECK_LINE') && sheet.includes('OWN_PAGE_LINE'));
  assert.equal(KIND_LABEL.response_post, 'Make a post in response');
  assert.equal(KIND_LABEL.witty_comment, 'Draft a witty comment');
});

test('every customer line follows the wording rule (no exclamation marks, no long dashes, no credit or trial words, nothing unkind)', () => {
  for (const line of [SELF_POST_LINE, OWN_PAGE_LINE, CHECK_LINE, DECENT_LINE, WORKING_LINE, ...Object.values(KIND_LABEL)]) assert.ok(isPlainCopy(line), line);
});

test('the sheet is an accessible dialog: title, focus kept inside, Escape closes, focus goes back', () => {
  const src = read('components/home/DraftSheet.tsx');
  assert.match(src, /role="dialog"/);
  assert.match(src, /aria-modal="true"/);
  assert.match(src, /aria-labelledby=\{titleId\}/);
  assert.match(src, /e\.key === 'Escape'/);
  assert.match(src, /e\.key !== 'Tab'/);
  assert.match(src, /opener\?\.focus/);
  assert.match(src, /aria-live="polite"/);
});

test('the page never posts anywhere and never sends competitor text: only the reference and the key go to the server', () => {
  const sheet = read('components/home/DraftSheet.tsx');
  const calls = [...sheet.matchAll(/apiService\.(\w+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(calls)], ['makeHomeDraft'], 'the sheet calls nothing but the draft request');
  const tiles = read('components/CompetitorTiles.tsx');
  assert.deepEqual([...new Set([...tiles.matchAll(/apiService\.(\w+)/g)].map((m) => m[1]))].sort(), ['getCompetitorBestPosts', 'getHomeDraftOptions']);
  assert.ok(!/ayrshare|postComment|\/comments|publishPost|schedulePost/i.test(sheet + read('utils/homeDrafts.ts')));
  assert.match(read('components/home/DraftSheet.tsx'), /makeHomeDraft\(kind, \{ ref: source\.ref, key: key\.current, tone, language \}\)/);
  const api = read('services/api.ts');
  assert.match(api, /'\/home\/response-post' : '\/home\/witty-comment'/);
});

test('the competitor tiles and the What is working rows offer both actions, and the sheet is wired on Home and the Competitors page', () => {
  const tiles = read('components/CompetitorTiles.tsx');
  assert.match(tiles, /<DraftActions options=\{drafts\}/);
  assert.match(tiles, /<DraftActions compact options=\{drafts\}/);
  assert.equal((tiles.match(/\{sheet\}/g) || []).length, 2, 'Home and the Competitors page both render the sheet');
  assert.match(read('components/home/DraftSheet.tsx'), /'Make a post in response' : 'Draft a witty comment'/);
});

test('the new files are in the voice audit scope', () => {
  const scope = JSON.parse(read('tests/voice-scope.json'));
  for (const f of ['utils/homeDrafts.ts', 'components/home/DraftSheet.tsx']) assert.ok(scope.includes(f), f);
});
