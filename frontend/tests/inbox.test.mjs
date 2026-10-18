import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  INBOX_PLATFORMS, isInboxPlatform, platformLabel, inboxConnectedCount, conversationKind, kindLabel, messageKindLabel, replyingToLine,
  REPLY_BOX_HINT, timeAgo, lastReceivedLine, ARRIVE_LINE, sendState, sendFailureReason, notSentLine, failureFromError, replySucceeded,
  pendingAuthor, pendingWhere, approveBody, canApprove, pendingBadge, PENDING_EMPTY, PENDING_TITLE, needsAutoConfirm, autoConfirmText, autoConfirmTitle,
  REVIEWS_NOTE, FALLBACK_SEND_ERROR,
} from '../utils/inbox.ts';

test('only Instagram and Facebook are inbox platforms', () => {
  assert.deepEqual([...INBOX_PLATFORMS], ['instagram', 'facebook']);
  assert.equal(isInboxPlatform('Instagram'), true);
  for (const p of ['linkedin', 'x', 'youtube', '', null, undefined]) assert.equal(isInboxPlatform(p), false);
  assert.equal(platformLabel('facebook'), 'Facebook');
});

test('the connected count ignores LinkedIn, X and YouTube and repeats', () => {
  assert.equal(inboxConnectedCount(['instagram', 'facebook', 'linkedin', 'x', 'youtube']), 2);
  assert.equal(inboxConnectedCount(['Instagram', 'instagram']), 1);
  assert.equal(inboxConnectedCount(['linkedin', 'x', 'youtube']), 0);
  assert.equal(inboxConnectedCount(null), 0);
});

test('comments and direct messages are labelled', () => {
  assert.equal(conversationKind(['comment']), 'comment');
  assert.equal(conversationKind(['message', 'mention']), 'comment');
  assert.equal(conversationKind(['message']), 'message');
  assert.equal(conversationKind(undefined), 'message');
  assert.equal(kindLabel('comment'), 'Comment');
  assert.equal(kindLabel('message'), 'Direct message');
  assert.equal(messageKindLabel('message'), 'Direct message');
  assert.equal(messageKindLabel('reply'), 'Reply to a comment');
  assert.equal(replyingToLine('message'), 'Replying to a direct message');
  assert.equal(replyingToLine('comment', 'Asha'), "Replying to Asha's comment");
});

test('the reply box says what is true', () => {
  assert.equal(REPLY_BOX_HINT, 'Your reply goes to this person on Instagram or Facebook.');
});

test('time words', () => {
  const now = Date.parse('2026-10-18T10:00:00Z');
  assert.equal(timeAgo('2026-10-18T09:55:00Z', now), '5m');
  assert.equal(timeAgo('2026-10-18T07:00:00Z', now), '3h');
  assert.equal(timeAgo('2026-10-16T10:00:00Z', now), '2d');
  assert.equal(timeAgo('nonsense', now), '');
  assert.equal(lastReceivedLine('2026-10-18T09:55:00Z', now), 'Last message received 5 minutes ago');
  assert.equal(lastReceivedLine('2026-10-18T09:59:30Z', now), 'Last message received just now');
  assert.equal(lastReceivedLine('2026-10-18T09:00:00Z', now), 'Last message received 1 hour ago');
  assert.equal(lastReceivedLine(null, now), '');
  assert.equal(lastReceivedLine('bad', now), '');
  assert.equal(ARRIVE_LINE, 'New comments and messages arrive on their own.');
});

test('a reply counts as sent only when the server says so', () => {
  assert.equal(sendState({ direction: 'outbound', status: 'sent' }), 'sent');
  assert.equal(sendState({ direction: 'outbound', status: 'failed' }), 'failed');
  assert.equal(sendState({ direction: 'outbound' }), 'sending');
  assert.equal(sendState({ direction: 'outbound', status: 'queued' }), 'sending');
  assert.equal(sendState(null), 'sending');
  assert.equal(replySucceeded({ success: true, message: { status: 'sent' } }), true);
  assert.equal(replySucceeded({ success: true, message: { status: 'failed' } }), false);
  assert.equal(replySucceeded({ success: false, message: { status: 'failed' } }), false);
  assert.equal(replySucceeded({ success: true }), false);
  assert.equal(replySucceeded(null), false);
});

test('a failed send shows its plain reason', () => {
  assert.equal(notSentLine('Instagram did not accept the reply.'), 'Not sent: Instagram did not accept the reply.');
  assert.equal(notSentLine(''), `Not sent: ${FALLBACK_SEND_ERROR}`);
  assert.equal(sendFailureReason('x'.repeat(300)), FALLBACK_SEND_ERROR);
  const err = Object.assign(new Error('Inbox request failed'), { status: 502, data: { success: false, message: 'Facebook said no.', sentMessage: { id: 'm1', status: 'failed', error_message: 'Facebook said no.' } } });
  const f = failureFromError(err);
  assert.equal(f.reason, 'Facebook said no.');
  assert.equal(f.sentMessage.id, 'm1');
  const plain = failureFromError(new Error('Network down'));
  assert.equal(plain.reason, 'Network down');
  assert.equal(plain.sentMessage, null);
  assert.equal(failureFromError(null).reason, FALLBACK_SEND_ERROR);
});

test('the approval queue helpers', () => {
  assert.equal(PENDING_TITLE, 'Waiting for your approval');
  assert.equal(PENDING_EMPTY, 'Nothing is waiting for you.');
  assert.equal(pendingAuthor({ id: '1', author_name: 'Asha' }), 'Asha');
  assert.equal(pendingAuthor({ id: '1', conversation: { participant_name: 'Ravi' } }), 'Ravi');
  assert.equal(pendingAuthor({ id: '1' }), 'Someone');
  assert.equal(pendingWhere({ id: '1', message_type: 'comment', platform: 'instagram' }), 'Comment on Instagram');
  assert.equal(pendingWhere({ id: '1', message_type: 'message', conversation: { platform: 'facebook' } }), 'Direct message on Facebook');
  assert.deepEqual(approveBody('Thanks!', undefined), {});
  assert.deepEqual(approveBody('Thanks!', 'Thanks!  '), {});
  assert.deepEqual(approveBody('Thanks!', 'Thank you so much!'), { text: 'Thank you so much!' });
  assert.deepEqual(approveBody('Thanks!', '   '), {});
  assert.equal(canApprove(undefined, 'Thanks!'), true);
  assert.equal(canApprove('   ', 'Thanks!'), false);
  assert.equal(canApprove(undefined, ''), false);
  assert.equal(pendingBadge(0), '0');
  assert.equal(pendingBadge(7), '7');
  assert.equal(pendingBadge(250), '99+');
  assert.equal(pendingBadge(undefined), '0');
});

test('turning on automatic replies asks first', () => {
  assert.equal(needsAutoConfirm('suggested', 'fully_automatic'), true);
  assert.equal(needsAutoConfirm('approval_required', 'fully_automatic'), true);
  assert.equal(needsAutoConfirm('fully_automatic', 'fully_automatic'), false);
  assert.equal(needsAutoConfirm('suggested', 'approval_required'), false);
  assert.equal(autoConfirmTitle, 'Turn on automatic replies?');
  assert.equal(autoConfirmText('Instagram'), 'Nebulaa will answer everyone on Instagram without asking you. You can switch it off any time.');
});

test('the Google reviews note is plain', () => {
  assert.equal(REVIEWS_NOTE, 'Reply to reviews on Google. Copy the drafted reply below.');
});

// ---- source checks on the screens ----
const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const SCREENS = ['pages/UnifiedInbox.tsx', 'pages/SocialInbox.tsx', 'pages/AutoReplySettingsPage.tsx', 'components/ReviewsPanel.tsx', 'components/PendingApprovals.tsx', 'components/InboxConfirmDialog.tsx'];

test('the inbox screens carry no dark hard-coded colours or dark-theme helpers', () => {
  for (const f of SCREENS) {
    const src = read(f);
    assert.doesNotMatch(src, /#[0-9a-fA-F]{3,8}\b/, `${f} has a hard-coded colour`);
    assert.doesNotMatch(src, /\b(?:bg|text|border|divide)-slate-/, `${f} uses a slate class`);
    assert.doesNotMatch(src, /isDarkMode|useTheme|getThemeClasses/, `${f} still reads the theme`);
  }
});

test('removed or unsafe things are gone from the screens', () => {
  const inbox = read('pages/UnifiedInbox.tsx');
  assert.doesNotMatch(inbox, /Assigned user ID/);
  assert.doesNotMatch(inbox, /Unified Inbox|AI Assist|Notification Center|real inbox|Reply across the original/);
  assert.match(inbox, /SHOW_SIMULATE &&/);
  assert.match(inbox, /import\.meta\.env\.DEV/);
  assert.doesNotMatch(inbox, /Linkedin|Youtube|Twitter/);
  const settings = read('pages/AutoReplySettingsPage.tsx');
  assert.doesNotMatch(settings, /<option value="regex">/);
  assert.doesNotMatch(settings, /X\/Twitter|linkedin<|youtube</);
  assert.match(settings, /InboxConfirmDialog/);
  const social = read('pages/SocialInbox.tsx');
  assert.match(social, /inboxConnectedCount/);
  const connect = read('pages/ConnectSocials.tsx');
  assert.doesNotMatch(connect, /nextSyncAt/);
});

test('turning on automatic replies sends confirm only through the dialog', () => {
  const inbox = read('pages/UnifiedInbox.tsx');
  assert.match(inbox, /setConfirmAuto\(true\)/);
  assert.match(inbox, /confirm: true/);
  // the toggle button never calls the server with enabled true directly
  assert.doesNotMatch(inbox, /onClick=\{\(\) => applyToggle\(true\)\}/);
});
