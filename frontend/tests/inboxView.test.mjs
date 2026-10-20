import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  initialsOf, markOf, conversationChips, threadFacts, approvalReason, alertTitle, reviewsSummaryLine, messagesBodyState, reviewsState,
  liveNote, suggestionsHeading, WHAT_WILL_APPEAR, holdsClientPass, avgStars,
} from '../utils/inboxView.ts';
import { parseColor, ratio } from '../scripts/visual-audit/contrast-math.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(here, '..', rel), 'utf8');

test('initials: two letters from a name, one from a one-word handle, "?" for nothing', () => {
  assert.equal(initialsOf('Asha Raman'), 'AR');
  assert.equal(initialsOf('asha'), 'A');
  assert.equal(initialsOf('  @meena.k  '), 'MK');
  assert.equal(initialsOf('@meena'), 'M');
  assert.equal(initialsOf(''), '?');
  assert.equal(initialsOf(null), '?');
  assert.equal(initialsOf('ராஜா குமார்'), 'ரா'.slice(0, 1) + 'கு'.slice(0, 1));
});

test('platform marks: Instagram, Facebook and Google have their own, everything else is other', () => {
  assert.equal(markOf('Instagram'), 'instagram');
  assert.equal(markOf('facebook'), 'facebook');
  assert.equal(markOf('gmb'), 'google');
  assert.equal(markOf('linkedin'), 'other');
  assert.equal(markOf(undefined), 'other');
});

test('row chips come only from real, non-default data', () => {
  const plain = { message_types: ['comment'], sentiment: 'neutral', priority: 'normal', spam_score: 0.04 };
  assert.deepEqual(conversationChips(plain).map((c) => c.label), ['Comment']);
  assert.deepEqual(conversationChips({ message_types: ['message'] }).map((c) => c.label), ['Direct message']);
  const loud = { message_types: ['message'], sentiment: 'negative', priority: 'urgent', spam_score: 0.92 };
  assert.deepEqual(conversationChips(loud).map((c) => c.label), ['Direct message', 'Urgent', 'Unhappy', 'Looks like spam']);
  assert.deepEqual(conversationChips({ message_types: ['comment'], sentiment: 'positive', priority: 'high' }).map((c) => c.label), ['Comment', 'Important', 'Positive']);
  // Unknown values never become a chip.
  assert.deepEqual(conversationChips({ message_types: [], sentiment: 'odd', priority: 'odd' }).map((c) => c.label), ['Direct message']);
  assert.ok(conversationChips(loud).every((c) => ['kind', 'warn', 'alert', 'good', 'muted'].includes(c.tone)));
});

test('thread facts list only what is known and not a default', () => {
  assert.deepEqual(threadFacts({ sentiment: 'neutral', priority: 'normal', spam_score: 0.04, status: 'unread' }), [{ label: 'Status', value: 'Not read yet' }]);
  assert.deepEqual(threadFacts({ sentiment: 'negative', priority: 'high', spam_score: 0.9, status: 'replied' }), [
    { label: 'Mood', value: 'Sounds unhappy' }, { label: 'Importance', value: 'Looks important' }, { label: 'Spam', value: 'Looks like spam' }, { label: 'Status', value: 'Replied' },
  ]);
  assert.deepEqual(threadFacts(null), []);
});

test('approval reasons are in plain words; unknown ones are left out', () => {
  assert.equal(approvalReason('Approval required mode'), 'You asked to approve each reply.');
  assert.equal(approvalReason('Negative sentiment requires approval'), 'The person sounds unhappy.');
  assert.equal(approvalReason('High priority message requires approval'), 'The message looks important.');
  assert.equal(approvalReason('Daily auto-reply limit reached'), 'This person already had the most automatic replies for today.');
  assert.equal(approvalReason('Matched rule: Opening hours'), 'Your rule "Opening hours" asks you first.');
  assert.equal(approvalReason('The reply could not be drafted in your tone'), 'The reply could not be drafted in your tone, so it is a general one.');
  assert.equal(approvalReason('Something internal'), '');
  assert.equal(approvalReason(undefined), '');
});

test('alert titles name the kind and the platform', () => {
  assert.equal(alertTitle('new_comment', 'instagram'), 'New comment on Instagram');
  assert.equal(alertTitle('new_dm', 'facebook'), 'New direct message on Facebook');
  assert.equal(alertTitle('new_message', 'facebook'), 'New direct message on Facebook');
  assert.equal(alertTitle('new_mention', 'instagram'), 'New mention on Instagram');
  assert.equal(alertTitle('other', ''), 'New activity');
});

test('the reviews summary only shows numbers the provider sent', () => {
  assert.equal(reviewsSummaryLine({ averageRating: 4.56, totalReviewCount: 128 }), '4.6 average from 128 reviews');
  assert.equal(reviewsSummaryLine({ averageRating: 5, totalReviewCount: 1 }), '5.0 average from 1 review');
  assert.equal(reviewsSummaryLine({ averageRating: 4.5 }), '');
  assert.equal(reviewsSummaryLine({ averageRating: 0, totalReviewCount: 0 }), '');
  assert.equal(reviewsSummaryLine(null), '');
  assert.equal(avgStars(4.56), 5);
  assert.equal(avgStars(4.2), 4);
  assert.equal(avgStars(undefined), 0);
});

test('the Messages part picks one state in a fixed order', () => {
  const ok = { entitled: true, connectedCount: 2, liveUpdates: 'on' };
  assert.equal(messagesBodyState({ ...ok, entitled: false }), 'addon');
  assert.equal(messagesBodyState({ ...ok, connectedCount: 0 }), 'connect');
  assert.equal(messagesBodyState({ ...ok, liveUpdates: 'off' }), 'live_off');
  assert.equal(messagesBodyState({ ...ok, liveUpdates: 'failed' }), 'live_failed');
  // An older server without the field: no note.
  assert.equal(messagesBodyState({ ...ok, liveUpdates: undefined }), 'list');
  assert.equal(messagesBodyState(ok), 'list');
});

test('live updates notes are honest and offer the one action', () => {
  const off = liveNote('off');
  assert.match(off.text, /will not arrive/);
  assert.equal(off.action, 'Switch on live updates');
  const failed = liveNote('failed');
  assert.match(failed.title, /could not be switched on/);
  assert.equal(failed.action, 'Try again');
  assert.equal(liveNote('on'), null);
});

test('the reviews part picks one state', () => {
  assert.equal(reviewsState({ connected: false }), 'not_connected');
  assert.equal(reviewsState({ connected: true, loadFailed: true, reviews: [] }), 'failed');
  assert.equal(reviewsState({ connected: true, reviews: [] }), 'empty');
  assert.equal(reviewsState({ connected: true, reviews: [{ id: 'a' }] }), 'list');
  assert.equal(reviewsState(null), 'failed');
});

test('suggestions say whether they were drafted for this message', () => {
  assert.equal(suggestionsHeading('drafted'), 'Suggested replies');
  assert.equal(suggestionsHeading('general'), 'Quick replies to start from');
  assert.equal(suggestionsHeading(undefined), 'Suggested replies');
  assert.equal(suggestionsHeading('paused'), 'Draft paused for now. Quick replies to start from');
});

test('what will appear lists three things in plain words', () => {
  assert.equal(WHAT_WILL_APPEAR.length, 3);
  const all = WHAT_WILL_APPEAR.map((w) => `${w.title} ${w.text}`).join(' ');
  for (const banned of [/quark/i, /credit/i, /trial/i, /7 days/i, /ayrshare/i, /!/, /—/]) assert.doesNotMatch(all, banned);
});

test('a client or staff pass is read from the return pass, safely', () => {
  assert.equal(holdsClientPass({ getItem: (k) => (k === 'csmReturnToken' ? 'x' : null) }), true);
  assert.equal(holdsClientPass({ getItem: () => null }), false);
  assert.equal(holdsClientPass({ getItem: () => { throw new Error('blocked'); } }), false);
  assert.equal(holdsClientPass(null), false);
});

test('conversation and review colours keep 4.5 to 1', () => {
  const css = read('components/inbox/inbox.css');
  const pairs = [['#FFF4DA', '#5E4A31'], ['#FFE3D0', '#9A3412'], ['#FFF0C7', '#8A5000'], ['#DDF2E6', '#22603A'], ['#F1ECE2', '#5E4A31'], ['#FFFAEE', '#2B1D0E']];
  for (const [bg, fg] of pairs) {
    assert.ok(css.includes(bg) && css.includes(fg), `${bg} and ${fg} are used in inbox.css`);
    const r = ratio(parseColor(fg), parseColor(bg));
    assert.ok(r >= 4.5, `${fg} on ${bg} is ${r.toFixed(2)} to 1`);
  }
});

test('the screens keep their promises: suggestions at every width, the work first, no See plans inside a client pass', () => {
  const unified = read('pages/UnifiedInbox.tsx');
  assert.doesNotMatch(unified, /hidden xl:flex/, 'suggested replies are not hidden on smaller screens');
  assert.match(unified, /nb-ix-suggest/);
  assert.match(unified, /Back to list/);
  assert.match(unified, /suggestionsHeading\(suggestionsSource\)/);
  assert.doesNotMatch(unified, /Looks like spam<\/p><p[^>]*>\{Math\.round/, 'no made-up spam percentage');
  const page = read('pages/SocialInbox.tsx');
  assert.ok(page.indexOf('<UnifiedInbox') < page.indexOf('<ListeningCard'), 'conversations come before the listening card');
  assert.match(page, /explainerAction\(\{ entitled, connectedCount, clientPass \}\)/);
  assert.match(page, /holdsClientPass\(/);
  const reviews = read('components/ReviewsPanel.tsx');
  for (const state of ['not_connected', 'failed', 'empty']) assert.match(reviews, new RegExp(`view === '${state}'`));
  assert.match(reviews, /Nothing is posted to Google from here/);
});

test('the filter bar: three labelled chips, each asking the server for known words only', async () => {
  const { INBOX_VIEWS, inboxFilterFor, threadLine } = await import('../utils/inboxView.ts');
  assert.deepEqual(INBOX_VIEWS.map((v) => v.label), ['All', 'Needs reply', 'Important']);
  assert.deepEqual(inboxFilterFor('all'), { status: '', priority: '' });
  assert.deepEqual(inboxFilterFor('needs_reply'), { status: 'unread', priority: '' });
  assert.deepEqual(inboxFilterFor('important'), { status: '', priority: 'important' });
  assert.deepEqual(threadLine({ participant_username: 'meera', platform: 'instagram' }, 'Comment'), ['@meera', 'Instagram', 'Comment']);
  assert.deepEqual(threadLine({ platform: 'facebook' }, ''), ['Facebook']);
  assert.deepEqual(threadLine(null), []);
});

test('the conversations panel: no dropdown filters, no developer button for customers, roomy suggestions', () => {
  const unified = read('pages/UnifiedInbox.tsx');
  assert.doesNotMatch(unified, /<select/, 'filters are chips, not dropdowns');
  assert.match(unified, /INBOX_VIEWS\.map/);
  assert.match(unified, /role="switch"/, 'automatic replies is a labelled switch');
  assert.match(unified, /devtools=1/, 'the developer tool needs an explicit opt-in on top of a development build');
  const css = read('components/inbox/inbox.css');
  assert.doesNotMatch(css.split('.nb-ix-suggest ul')[1]?.split('}')[0] || '', /overflow-x: auto/, 'suggestions wrap, never clip sideways');
});
