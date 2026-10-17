import test from 'node:test';
import assert from 'node:assert/strict';
import { cardState, statusText, trendLabel, highlightsFor, linkLabel, handleAction, handleActionLabel, validateHandle, lastCheckedLine, weekOverWeekOk, consecutiveTrend, competitorsUpgradeCopy, LOCKED_NOTE, handleSavedNote, listHandleAction } from '../utils/competitorInsights.ts';

const comp = (o = {}) => ({ id: 'c1', name: 'Acme', handle: 'acme', status: 'tracking', trend: [], lastCheckedAt: null, ...o });

test('cardState follows the response shape', () => {
  assert.equal(cardState({ locked: true }), 'locked');
  assert.equal(cardState({ success: false, locked: true }), 'locked');
  assert.equal(cardState(null), 'error');
  assert.equal(cardState(undefined), 'error');
  assert.equal(cardState({ error: true }), 'error');
  assert.equal(cardState({ success: false }), 'error');
  assert.equal(cardState({ success: true, highlights: [], competitors: [] }), 'none');
  assert.equal(cardState({ success: true, highlights: [], competitors: [comp()] }), 'started');
  assert.equal(cardState({ success: true, highlights: [{ competitorId: 'c1', name: 'Acme', text: 'Acme posted 5 times.' }], competitors: [comp()] }), 'ready');
});

test('statusText for each competitor state', () => {
  const trend = [{ weekStart: '2026-10-12', postsInWindow: 2, avgLikes: 10 }];
  assert.equal(statusText(comp({ trend })), 'Tracking since Monday 12 October');
  assert.equal(statusText(comp({ trend: [...trend, { weekStart: '2026-10-19', postsInWindow: 1, avgLikes: 1 }] })), 'Tracking since Monday 12 October');
  assert.equal(statusText(comp({ trend: [] })), 'First results next week');
  assert.equal(statusText(comp({ status: 'no_handle' })), 'Add their Instagram handle to track them');
  assert.equal(statusText(comp({ status: 'failed' })), 'We could not read this account. Check the handle.');
  assert.equal(statusText(comp({ status: 'paused' })), 'Paused after repeated problems. Edit the handle to resume.');
  assert.equal(statusText(comp({ status: 'waiting' })), 'First results next week');
});

test('trendLabel with 0, 1 and 4 weeks', () => {
  assert.equal(trendLabel([]), '');
  assert.equal(trendLabel(undefined), '');
  assert.equal(trendLabel([{ weekStart: 'a', postsInWindow: 3, avgLikes: 1 }]), 'Posts a week: 3');
  const four = [2, 5, 3, 4].map((n, i) => ({ weekStart: String(i), postsInWindow: n, avgLikes: 0 }));
  assert.equal(trendLabel(four), 'Posts a week: 2, 5, 3, 4');
});

test('highlightsFor returns at most three sentences', () => {
  const hs = [1, 2, 3, 4, 5].map((n) => ({ competitorId: 'c' + n, name: 'N', text: `Sentence ${n}.` }));
  assert.deepEqual(highlightsFor({ success: true, highlights: hs, competitors: [] }), ['Sentence 1.', 'Sentence 2.', 'Sentence 3.']);
  assert.deepEqual(highlightsFor(null), []);
  assert.deepEqual(highlightsFor({ locked: true }), []);
  assert.deepEqual(highlightsFor({ success: true, highlights: [{ text: '' }, { text: 'Ok.' }], competitors: [] }), ['Ok.']);
});

test('statusText for an unconfirmed handle asks the customer to confirm it', () => {
  assert.equal(statusText(comp({ status: 'unconfirmed', handleStatus: 'suggested' })), 'We found this handle. Confirm it so we can track them.');
});

test('(I6) a competitor without a current-week snapshot says when it was last checked, not "this week"', () => {
  const trend = [{ weekStart: '2026-09-07', postsInWindow: 5, avgLikes: 3 }];
  const old = comp({ trend, isCurrentWeek: false, weekOf: '2026-09-07', lastCheckedOn: '2026-09-09' });
  assert.equal(statusText(old), 'Last checked on 9 September');
  assert.equal(lastCheckedLine(old), 'Last checked on 9 September');
  assert.equal(lastCheckedLine(comp({ trend, isCurrentWeek: true, lastCheckedOn: '2026-10-13' })), '');
  assert.equal(lastCheckedLine(comp({ isCurrentWeek: false, lastCheckedOn: null })), '');
  assert.equal(lastCheckedLine(comp({ isCurrentWeek: false, lastCheckedOn: 'junk' })), '');
  // older responses without the flag keep the old text
  assert.equal(statusText(comp({ trend })), 'Tracking since Monday 7 September');
  // a paused competitor keeps its own status text; the card adds the last checked line below it
  assert.equal(statusText(comp({ status: 'paused', isCurrentWeek: false, lastCheckedOn: '2026-09-09' })), 'Paused after repeated problems. Edit the handle to resume.');
});

test('(I6) week over week claims need the previous week to be the week before', () => {
  assert.equal(weekOverWeekOk(comp({ isCurrentWeek: true, weekOf: '2026-10-12', previousWeekOf: '2026-10-05' })), true);
  assert.equal(weekOverWeekOk(comp({ isCurrentWeek: true, weekOf: '2026-10-12', previousWeekOf: null })), false);
  assert.equal(weekOverWeekOk(comp({ isCurrentWeek: false, weekOf: '2026-10-05', previousWeekOf: '2026-09-28' })), false);
  assert.equal(weekOverWeekOk(comp({ isCurrentWeek: true, weekOf: '2026-10-12', previousWeekOf: '2026-09-28' })), false, 'two weeks apart is not consecutive');
  assert.equal(weekOverWeekOk(comp({})), false, 'no flags, no claim');
});

test('(I6) the trend only lists weeks that follow each other', () => {
  const t = (w, n) => ({ weekStart: w, postsInWindow: n, avgLikes: 0 });
  const gap = [t('2026-09-14', 2), t('2026-09-21', 4), t('2026-10-05', 3), t('2026-10-12', 6)];
  assert.deepEqual(consecutiveTrend(gap).map((x) => x.weekStart), ['2026-10-05', '2026-10-12']);
  assert.equal(trendLabel(gap), 'Posts a week: 3, 6');
  assert.deepEqual(consecutiveTrend([t('2026-10-12', 1)]).length, 1);
  assert.deepEqual(consecutiveTrend([]), []);
});

test('(I6) highlights about a competitor whose numbers are not from this week are dropped', () => {
  const rows = [
    comp({ id: 'a', isCurrentWeek: false, previousWeekOf: null }),
    comp({ id: 'b', isCurrentWeek: true, previousWeekOf: null }),
    comp({ id: 'c', isCurrentWeek: true, previousWeekOf: '2026-10-05' })
  ];
  const res = { success: true, competitors: rows, highlights: [
    { competitorId: 'a', name: 'A', text: 'A posted 5 times this week, up from 2.' },
    { competitorId: 'b', name: 'B', text: 'B posted 5 times this week, up from 2.' },
    { competitorId: 'b', name: 'B', text: "B's best post this week was a reel with 40 likes." },
    { competitorId: 'c', name: 'C', text: 'C posted 5 times this week, up from 2.' },
    { name: 'D', text: 'D has no id.' }
  ] };
  assert.deepEqual(highlightsFor(res), ["B's best post this week was a reel with 40 likes.", 'C posted 5 times this week, up from 2.', 'D has no id.']);
});

test('(I9) which handle control a competitor gets', () => {
  assert.equal(handleAction(comp({ status: 'unconfirmed' })), 'confirm');
  assert.equal(handleAction(comp({ status: 'no_handle' })), 'edit');
  assert.equal(handleAction(comp({ status: 'paused' })), 'edit');
  assert.equal(handleAction(comp({ status: 'failed' })), 'edit');
  assert.equal(handleAction(comp({ status: 'tracking' })), null);
  assert.equal(handleAction(comp({ status: 'waiting' })), null);
  assert.equal(handleActionLabel('confirm'), 'Confirm handle');
  assert.equal(handleActionLabel('edit'), 'Edit handle');
  // the Competitors page list only knows handleStatus and the handle
  assert.equal(listHandleAction({ handleStatus: 'suggested', handle: 'acme' }), 'confirm');
  assert.equal(listHandleAction({ handleStatus: 'confirmed', handle: 'acme' }), 'edit');
  assert.equal(listHandleAction({ handleStatus: 'verified', handle: 'acme' }), 'edit');
  assert.equal(listHandleAction({ handle: '' }), 'edit');
  assert.equal(listHandleAction({ handleStatus: 'suggested', handle: '' }), 'edit');
  assert.equal(listHandleAction({ handle: 'acme' }), 'edit');
});

test('(I9) handle validation matches the server: letters, digits, dots, underscores, 30 at most, no @ or link', () => {
  const ok = (v) => assert.deepEqual(validateHandle(v), { ok: true, handle: v.trim() });
  ok('sweetco'); ok('Sweet.Co_1'); ok('a'); ok('x'.repeat(30)); ok('  sweetco  ');
  const bad = (v) => { const r = validateHandle(v); assert.equal(r.ok, false, String(v)); assert.ok(r.message && !/[!—]/.test(r.message) && !/quark|credit|trial/i.test(r.message)); return r.message; };
  bad(''); bad('   '); bad(undefined);
  assert.match(bad('@sweetco'), /without @/);
  assert.match(bad('https://instagram.com/sweetco'), /without @ or a link/);
  assert.match(bad('instagram.com/sweetco'), /without @ or a link/);
  assert.match(bad('sweet co'), /letters, numbers, dots and underscores/);
  assert.match(bad('sweet-co'), /letters, numbers, dots and underscores/);
  assert.match(bad('x'.repeat(31)), /30/);
  assert.equal(handleSavedNote({ name: 'Sweet Co', handle: 'sweetco' }), 'Saved. We will check @sweetco in the next weekly check.');
});

test('(I10) the add-on note and the upgrade prompt copy never say Quarks, trial or credit', () => {
  assert.equal(LOCKED_NOTE.before + LOCKED_NOTE.link + LOCKED_NOTE.after, 'Tracking competitors is an add-on. See plans to add it.');
  for (const reason of ['addon', 'upgrade', 'quarks']) {
    const c = competitorsUpgradeCopy(reason);
    assert.ok(c.message.length > 10 && c.actionLabel === 'See plans');
    assert.ok(!/quark|credit|trial|7 days|!|—/i.test(c.message + c.actionLabel), c.message);
  }
  assert.equal(competitorsUpgradeCopy('addon').message, 'Tracking competitors is an add-on. See plans to add it.');
});

test('linkLabel only talks about fixing handles when some competitor needs it', () => {
  assert.equal(linkLabel([comp(), comp({ status: 'waiting' })]), 'Open Competitors');
  assert.equal(linkLabel([comp(), comp({ status: 'failed' })]), 'Open Competitors to fix handles');
  assert.equal(linkLabel([comp({ status: 'no_handle' })]), 'Open Competitors to fix handles');
  assert.equal(linkLabel([comp({ status: 'paused' })]), 'Open Competitors to fix handles');
  assert.equal(linkLabel([comp({ status: 'unconfirmed' })]), 'Open Competitors to confirm handles');
  assert.equal(linkLabel([comp({ status: 'unconfirmed' }), comp({ status: 'paused' })]), 'Open Competitors to fix handles');
  assert.equal(linkLabel([]), 'Open Competitors');
  assert.equal(linkLabel(undefined), 'Open Competitors');
});
