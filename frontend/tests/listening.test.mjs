import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cardState, splitBar, percentsOf, barRows, barSummary, basedOn, dateRange, dayText, quoteLabel, quoteText, notEnoughText, notEnoughLines, waitingText, lastCheckedLine, weeklyNote, conversationIdFromSearch, pickSelectedId, commentsText, recentNegativeRows, recentLinkLabel, platformName, LOCKED_NOTE, LOAD_ERROR, TITLE } from '../utils/listening.ts';

const ready = (o = {}) => ({
  success: true, enabled: true, state: 'ready', message: null,
  period: { from: '2026-09-20', to: '2026-10-17' }, asOf: '2026-10-17', total: 86,
  counts: { positive: 53, neutral: 21, negative: 12 }, percentages: { positive: 62, neutral: 24, negative: 14 },
  trend: null, quotes: [], recentNegative: [], lastScoredOn: '2026-10-17', ...o,
});

test('cardState follows the response shape', () => {
  assert.equal(cardState({ locked: true }), 'locked');
  assert.equal(cardState({ success: false, locked: true }), 'locked');
  assert.equal(cardState(null), 'error');
  assert.equal(cardState(undefined), 'error');
  assert.equal(cardState({ error: true }), 'error');
  assert.equal(cardState({ success: false }), 'error');
  assert.equal(cardState({ success: true, state: 'strange' }), 'error');
  assert.equal(cardState(ready()), 'ready');
  assert.equal(cardState({ success: true, state: 'not_enough', message: 'Not enough comments yet to show a score.' }), 'not_enough');
  assert.equal(cardState({ success: true, state: 'waiting', message: 'x' }), 'waiting');
});

test('state off, or the switch off, means the card shows nothing (also for old data)', () => {
  assert.equal(cardState({ success: true, state: 'off', enabled: false }), 'off');
  assert.equal(cardState({ success: true, state: 'off', enabled: true }), 'off');
  assert.equal(cardState(ready({ enabled: false })), 'off');
  assert.equal(cardState({ success: true, enabled: false, state: 'not_enough', message: 'Nothing is scored yet.' }), 'off');
  assert.equal(cardState({ locked: true, enabled: false }), 'locked', 'the plans note for a locked account is kept');
});

test('a ready response with no counts is an error, never a card of zeros', () => {
  assert.equal(cardState(ready({ counts: undefined })), 'error');
  assert.equal(cardState(ready({ total: 0, counts: { positive: 0, neutral: 0, negative: 0 } })), 'error');
});

test('splitBar sums to 100, keeps small shares visible and is all zero for no comments', () => {
  const sum = (b) => b.positive + b.neutral + b.negative;
  assert.deepEqual(splitBar({ positive: 0, neutral: 0, negative: 0 }), { positive: 0, neutral: 0, negative: 0 });
  const a = splitBar({ positive: 53, neutral: 21, negative: 12 });
  assert.equal(sum(a), 100);
  const b = splitBar({ positive: 500, neutral: 1, negative: 1 });
  assert.equal(sum(b), 100);
  assert.ok(b.neutral >= 2 && b.negative >= 2);
  const c = splitBar({ positive: 30, neutral: 0, negative: 1 });
  assert.equal(c.neutral, 0);
  assert.equal(sum(c), 100);
  assert.ok(c.negative >= 2);
  assert.deepEqual(splitBar({ positive: 5, neutral: 0, negative: 0 }), { positive: 100, neutral: 0, negative: 0 });
  for (const t of [[1, 1, 1], [7, 3, 90], [33, 33, 34], [2, 98, 0]]) {
    assert.equal(sum(splitBar({ positive: t[0], neutral: t[1], negative: t[2] })), 100);
  }
});

test('percentsOf gives whole numbers that sum to 100', () => {
  assert.deepEqual(percentsOf({ positive: 53, neutral: 21, negative: 12 }), { positive: 62, neutral: 24, negative: 14 });
  const p = percentsOf({ positive: 1, neutral: 1, negative: 1 });
  assert.equal(p.positive + p.neutral + p.negative, 100);
  assert.deepEqual(percentsOf({ positive: 0, neutral: 0, negative: 0 }), { positive: 0, neutral: 0, negative: 0 });
});

test('barRows uses the server percentages when they add up, and words not colour name each row', () => {
  const rows = barRows(ready());
  assert.deepEqual(rows.map((r) => r.label), ['Positive', 'Neutral', 'Negative']);
  assert.deepEqual(rows.map((r) => r.count), [53, 21, 12]);
  assert.deepEqual(rows.map((r) => r.percent), [62, 24, 14]);
  assert.equal(rows[0].text, 'Positive: 53 comments, 62%');
  const bad = barRows(ready({ percentages: { positive: 10, neutral: 10, negative: 10 } }));
  assert.equal(bad.reduce((n, r) => n + r.percent, 0), 100);
});

test('barSummary is a full text alternative for the bar', () => {
  assert.equal(barSummary(ready()), 'Positive 62% (53), neutral 24% (21), negative 14% (12).');
});

test('plural and singular', () => {
  assert.equal(commentsText(1), '1 comment');
  assert.equal(commentsText(0), '0 comments');
  assert.equal(commentsText(2), '2 comments');
  assert.equal(barRows(ready({ counts: { positive: 1, neutral: 1, negative: 1 }, total: 3, percentages: { positive: 34, neutral: 33, negative: 33 } }))[0].text, 'Positive: 1 comment, 34%');
});

test('basedOn wording and India dates: always the number and the dates', () => {
  assert.equal(basedOn(ready()), 'Based on 86 comments from 20 September to 17 October.');
  assert.equal(basedOn(ready({ total: 1 })), 'Based on 1 comment from 20 September to 17 October.');
  assert.equal(basedOn(ready({ period: { from: '2026-10-01', to: '2026-10-28' } })), 'Based on 86 comments from 1 October to 28 October.');
  assert.equal(basedOn(ready({ period: { from: '2026-12-20', to: '2027-01-16' } })), 'Based on 86 comments from 20 December 2026 to 16 January 2027.');
  assert.equal(dayText('2026-03-05'), '5 March');
  assert.equal(dayText('nope'), '');
  assert.equal(dateRange(undefined), '');
  assert.equal(basedOn(ready({ period: undefined })), 'Based on 86 comments.');
});

test('last checked line only when the last scoring is more than 10 days old', () => {
  assert.equal(lastCheckedLine(ready({ stale: true, lastScoredOn: '2026-10-05' })), 'Last checked on 5 October.');
  assert.equal(lastCheckedLine(ready({ stale: false, lastScoredOn: '2026-10-14' })), '');
  assert.equal(lastCheckedLine(ready()), '');
  assert.equal(lastCheckedLine(ready({ stale: true, lastScoredOn: null })), '');
  assert.equal(lastCheckedLine(null), '');
});

test('quote labels and text', () => {
  assert.equal(quoteLabel({ label: 'positive', platform: 'instagram', date: '2026-10-14' }), 'Positive, Instagram, 14 October');
  assert.equal(quoteLabel({ label: 'negative', platform: 'linkedin', date: '2026-10-02' }), 'Negative, LinkedIn, 2 October');
  assert.equal(quoteLabel({ label: 'negative', platform: 'facebook', date: 'bad' }), 'Negative, Facebook');
  assert.equal(platformName('x'), 'X');
  assert.equal(platformName('youtube'), 'YouTube');
  assert.equal(platformName(''), '');
  assert.equal(quoteText({ text: '  Loved the cake.  ' }), 'Loved the cake.');
  assert.equal(quoteText({}), '');
});

test('exact fixed strings', () => {
  assert.equal(notEnoughText(), 'Not enough comments yet to show a score.');
  assert.equal(TITLE, 'What people say about you');
  assert.equal(LOAD_ERROR, 'We could not load this card. Please try again.');
  assert.equal(`${LOCKED_NOTE.before}${LOCKED_NOTE.link}${LOCKED_NOTE.after}`, 'Comment insights come with the Inbox add-on. See plans.');
  assert.equal(waitingText(), 'Your comments are waiting for the next weekly check.');
});

test('not enough shows the sentence and a plain note with no numbers and no promise of a weekly check', () => {
  const l = notEnoughLines({ success: true, state: 'not_enough', enabled: true, message: 'Not enough comments yet to show a score.', total: 0 });
  assert.equal(l.headline, 'Not enough comments yet to show a score.');
  assert.ok(l.note && !/\d/.test(l.note));
  assert.ok(!/week/i.test(`${l.headline} ${l.note}`));
  assert.equal(notEnoughLines({ state: 'not_enough' }).headline, 'Not enough comments yet to show a score.');
});

test('the weekly-check sentence exists only as weeklyNote, which the card uses in the ready state only (the waiting message says it once itself)', () => {
  assert.equal(weeklyNote(), 'Comments are checked once a week.');
  const src = fs.readFileSync(new URL('../components/ListeningCard.tsx', import.meta.url), 'utf8');
  const ready = src.slice(src.indexOf("state === 'ready' && res"));
  const waiting = src.slice(src.indexOf("state === 'waiting' &&"), src.indexOf("state === 'ready' && res"));
  assert.ok(ready.includes('weeklyNote()'));
  assert.ok(!waiting.includes('weeklyNote()'), 'the waiting message already says it once');
  const lines = src.split('\n');
  const uses = lines.map((l, i) => (l.includes('weeklyNote()') ? i : -1)).filter((i) => i >= 0);
  assert.equal(uses.length, 1, 'only the ready block says it');
  const util = fs.readFileSync(new URL('../utils/listening.ts', import.meta.url), 'utf8');
  assert.equal((util.match(/checked once a week/g) || []).length, 1);
  assert.ok(!/Nothing is scored yet|waiting for the next weekly check/.test(src), 'no off-state wording in the component');
});

test('the card renders nothing in the off state for an entitled account, and the plans note stays for a locked one', () => {
  const src = fs.readFileSync(new URL('../components/ListeningCard.tsx', import.meta.url), 'utf8');
  assert.match(src, /if \(state === 'off'\) return null;/);
  assert.ok(src.indexOf("state === 'off'") < src.indexOf("state === 'locked'"));
  assert.match(src, /if \(!lockedNote\) return null;/);
});

test('?conversation=<id> is read from the location and only ever picks an id that is in the loaded list', () => {
  assert.equal(conversationIdFromSearch('?conversation=abc123'), 'abc123');
  assert.equal(conversationIdFromSearch('conversation=abc123'), 'abc123');
  assert.equal(conversationIdFromSearch('?x=1&conversation=a%20b'), 'a b');
  assert.equal(conversationIdFromSearch(''), '');
  assert.equal(conversationIdFromSearch('?conversation='), '');
  assert.equal(conversationIdFromSearch('?other=1'), '');
  assert.equal(conversationIdFromSearch(undefined), '');
  assert.equal(conversationIdFromSearch(`?conversation=${'x'.repeat(300)}`), '');
  const list = [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }];
  assert.equal(pickSelectedId(list, 'c1', 'c3'), 'c3', 'a link while another conversation is open');
  assert.equal(pickSelectedId(list, 'c2', ''), 'c2', 'no link: keep what is open');
  assert.equal(pickSelectedId(list, 'gone', 'also-gone'), 'c1', 'an id that is not in the list is never selected');
  assert.equal(pickSelectedId(list, 'c2', 'nope'), 'c2');
  assert.equal(pickSelectedId([], 'c1', 'c3'), '');
  const page = fs.readFileSync(new URL('../pages/UnifiedInbox.tsx', import.meta.url), 'utf8');
  assert.match(page, /useLocation\(\)/);
  assert.match(page, /\[location\.key, linkedId\]/, 'the page reacts to every navigation, not only the first read');
  assert.ok(!/useState\(\(\) => linkParams/.test(page), 'the one-time initial read is gone');
});

test('recent negative rows: at most 5, link to the inbox item', () => {
  const rn = Array.from({ length: 8 }, (_, i) => ({ id: 'r' + i, conversationId: 'cv' + i, platform: 'instagram', date: '2026-10-1' + (i % 8), preview: 'Late again ' + i }));
  const rows = recentNegativeRows(ready({ recentNegative: rn }));
  assert.equal(rows.length, 5);
  assert.equal(rows[0].href, '/inbox?conversation=cv0');
  assert.equal(rows[0].preview, 'Late again 0');
  assert.deepEqual(recentNegativeRows(ready()), []);
  assert.deepEqual(recentNegativeRows(null), []);
  assert.equal(recentNegativeRows(ready({ recentNegative: [{ id: 'a', conversationId: 'a b', platform: 'facebook', date: '2026-10-03', preview: 'x' }] }))[0].href, '/inbox?conversation=a%20b');
  assert.equal(recentLinkLabel({ platform: 'instagram', date: '2026-10-14' }), 'Open the conversation on Instagram from 14 October');
});

test('wording guard: helper strings and component source', () => {
  const BAD = /credit|trial|7 days|quark|openai|gpt|ai model/i;
  const strings = [
    notEnoughText(), waitingText(), TITLE, LOAD_ERROR, LOCKED_NOTE.before + LOCKED_NOTE.link + LOCKED_NOTE.after,
    basedOn(ready()), barSummary(ready()), lastCheckedLine(ready({ stale: true, lastScoredOn: '2026-10-05' })), weeklyNote(),
    quoteLabel({ label: 'positive', platform: 'instagram', date: '2026-10-14' }),
    recentLinkLabel({ platform: 'instagram', date: '2026-10-14' }),
    ...barRows(ready()).map((r) => r.text),
    ...Object.values(notEnoughLines({ state: 'not_enough', enabled: true })),
  ].filter(Boolean);
  for (const s of strings) { assert.ok(!BAD.test(s), s); assert.ok(!/[!—–]/.test(s), s); }
  for (const f of ['../components/ListeningCard.tsx', '../utils/listening.ts']) {
    const src = fs.readFileSync(new URL(f, import.meta.url), 'utf8');
    const visible = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    assert.ok(!/quark|openai|gpt|ai model/i.test(visible), f);
    assert.ok(!/[A-Za-z.]!(?=[\s'"`<.]|$)/m.test(visible), 'no exclamation mark in wording: ' + f);
  }
});
