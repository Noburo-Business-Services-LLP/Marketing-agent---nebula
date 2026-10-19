import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHIP_LABELS, chipLabel, countText, isGoogleConnected, repliesGoOutOnTheirOwn, messagesTile, messagesCountLine, reviewsTile, autoTile,
  autoStatus, overviewTiles, tileAccessibleName, partFromParam, EXPLAINER, EXPLAINER_STEPS, explainerAction, ADDON_NOTE, ADDON_LINE,
  INBOX_LIVE_PROVEN, EXPLAINER_VERSIONS, lastMessageLine, ADDON_NOTE_CLIENT,
} from '../utils/inboxOverview.ts';
import { parseColor, ratio } from '../scripts/visual-audit/contrast-math.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(here, '..', rel), 'utf8');

const base = { entitled: true, connectedCount: 2, inboxStatus: 'active', pending: 0, unread: 0, googleConnected: true, settings: null };
const autoOn = { enabled: true, automationMode: 'fully_automatic', platforms: { instagram: true, facebook: false }, channels: { messages: true, comments: false } };

test('the chips are in words', () => {
  assert.deepEqual(CHIP_LABELS, { connected: 'Connected', needs_setup: 'Needs setup', addon: 'Add-on', on: 'On', off: 'Off' });
  assert.equal(chipLabel(null), '');
  assert.equal(chipLabel('addon'), 'Add-on');
});

test('without the add-on every tile says Add-on, whatever else is known', () => {
  const tiles = overviewTiles({ ...base, entitled: false, settings: autoOn });
  assert.deepEqual(tiles.map((t) => t.status), ['addon', 'addon', 'addon']);
  assert.ok(tiles.every((t) => t.line === ADDON_LINE));
  assert.deepEqual(tiles.map((t) => t.id), ['messages', 'reviews', 'auto-reply']);
});

test('Messages and comments: Needs setup without Instagram or Facebook, Connected otherwise', () => {
  assert.equal(messagesTile({ ...base, connectedCount: 0 }).status, 'needs_setup');
  assert.equal(messagesTile({ ...base, connectedCount: 0 }).line, 'Connect Instagram or Facebook');
  assert.equal(messagesTile({ ...base, inboxStatus: 'needs_setup' }).status, 'needs_setup');
  assert.equal(messagesTile(base).status, 'connected');
});

test('the Messages tile shows when the last message arrived and asks for live updates when they are off', () => {
  const now = Date.parse('2026-10-19T10:00:00Z');
  assert.equal(lastMessageLine('2026-10-19T09:55:00Z', now), 'Last message 5 min ago');
  assert.equal(lastMessageLine('2026-10-19T09:59:40Z', now), 'Last message just now');
  assert.equal(lastMessageLine('2026-10-19T07:00:00Z', now), 'Last message 3 hours ago');
  assert.equal(lastMessageLine('2026-10-18T09:00:00Z', now), 'Last message 1 day ago');
  assert.equal(lastMessageLine(null, now), '');
  assert.equal(lastMessageLine('nonsense', now), '');
  const t = messagesTile({ ...base, lastAt: '2026-10-19T09:55:00Z', now });
  assert.equal(t.subtitle, 'Last message 5 min ago');
  assert.equal(messagesTile(base).subtitle, 'Instagram and Facebook');
  assert.deepEqual([messagesTile({ ...base, liveUpdates: 'off' }).status, messagesTile({ ...base, liveUpdates: 'off' }).line], ['needs_setup', 'Switch on live updates']);
  assert.deepEqual([messagesTile({ ...base, liveUpdates: 'failed' }).status, messagesTile({ ...base, liveUpdates: 'failed' }).line], ['needs_setup', 'Live updates could not start']);
  assert.equal(messagesTile({ ...base, liveUpdates: 'on' }).status, 'connected');
  // No add-on or nothing connected wins over live updates.
  assert.equal(messagesTile({ ...base, liveUpdates: 'off', connectedCount: 0 }).line, 'Connect Instagram or Facebook');
});

test('the counts line puts approvals first, then unread, never a zero count', () => {
  assert.equal(messagesCountLine(3, 5), 'Waiting for your approval 3');
  assert.equal(messagesCountLine(0, 5), 'Waiting for a reply 5');
  assert.equal(messagesCountLine(0, 0), 'Nothing waiting right now');
  assert.equal(messagesCountLine(null, undefined), 'Nothing waiting right now');
  assert.equal(messagesCountLine(150, 0), 'Waiting for your approval 99+');
  assert.equal(messagesCountLine(-2, 0.5), 'Nothing waiting right now');
  assert.equal(messagesTile({ ...base, pending: 3, unread: 5 }).line, 'Waiting for your approval 3');
  assert.equal(countText(99), '99');
  assert.equal(countText(100), '99+');
  assert.equal(countText(NaN), '0');
});

test('Google reviews: Connected or Needs setup from the connected accounts, no chip when unknown', () => {
  assert.equal(isGoogleConnected(['instagram', 'gmb']), true);
  assert.equal(isGoogleConnected(['Google Business']), true);
  assert.equal(isGoogleConnected(['instagram', 'facebook']), false);
  assert.equal(isGoogleConnected(null), false);
  assert.equal(reviewsTile(base).status, 'connected');
  assert.equal(reviewsTile({ ...base, googleConnected: false }).status, 'needs_setup');
  const unknown = reviewsTile({ ...base, googleConnected: null });
  assert.equal(unknown.status, null);
  assert.equal(unknown.line, 'Open to see your reviews');
  // Google reviews do not depend on Instagram or Facebook.
  assert.equal(reviewsTile({ ...base, connectedCount: 0 }).status, 'connected');
});

test('Automatic replies are On only when a reply can really go out on its own', () => {
  assert.equal(repliesGoOutOnTheirOwn(null), false);
  assert.equal(repliesGoOutOnTheirOwn(autoOn), true);
  // Fully automatic chosen but the switch is off: the server only suggests.
  assert.equal(repliesGoOutOnTheirOwn({ ...autoOn, enabled: false }), false);
  // Switched on but no Instagram or Facebook kind of message is chosen.
  assert.equal(repliesGoOutOnTheirOwn({ ...autoOn, platforms: { instagram: false, facebook: false } }), false);
  assert.equal(repliesGoOutOnTheirOwn({ ...autoOn, channels: { messages: false } }), false);
  // A header toggle (channel override) counts.
  assert.equal(repliesGoOutOnTheirOwn({ enabled: true, automationMode: 'fully_automatic', platforms: {}, channels: {}, channelOverrides: [{ platform: 'instagram', channelType: 'comment', enabled: true }] }), true);
  assert.equal(repliesGoOutOnTheirOwn({ enabled: true, automationMode: 'fully_automatic', platforms: {}, channels: {}, channelOverrides: [{ platform: 'linkedin', channelType: 'comment', enabled: true }] }), false);
  // An own rule that replies automatically sends even in "Only suggest".
  const ruled = { ...autoOn, automationMode: 'suggested', responseRules: [{ enabled: true, action: 'auto_reply' }] };
  assert.equal(repliesGoOutOnTheirOwn(ruled), true);
  assert.equal(repliesGoOutOnTheirOwn({ ...ruled, responseRules: [{ enabled: false, action: 'auto_reply' }] }), false);
  assert.deepEqual(autoStatus(ruled), { status: 'on', line: 'Your rules can send some replies' });
  assert.deepEqual(autoStatus(ruled, true), { status: 'on', line: 'Your rules send some replies' });
});

test('Automatic replies tile wording', () => {
  // Until the owner's live test passes, the tile says what is set, not that replies go out.
  assert.equal(INBOX_LIVE_PROVEN, false);
  assert.deepEqual(autoStatus(autoOn), { status: 'on', line: 'Set to send on its own' });
  assert.deepEqual(autoStatus(autoOn, true), { status: 'on', line: 'Replies go out on their own' });
  assert.deepEqual(autoStatus({ ...autoOn, automationMode: 'approval_required' }), { status: 'off', line: 'Each reply waits for your approval' });
  assert.deepEqual(autoStatus({ ...autoOn, automationMode: 'approval_required', enabled: false }), { status: 'off', line: 'Suggested replies only' });
  assert.deepEqual(autoStatus(null), { status: 'off', line: 'Suggested replies only' });
  assert.equal(autoTile({ ...base, connectedCount: 0, settings: autoOn }).status, 'needs_setup');
  assert.equal(autoTile({ ...base, settings: autoOn }).status, 'on');
});

test('a tile reads out its title, status and counts line', () => {
  const t = messagesTile({ ...base, pending: 2 });
  assert.equal(tileAccessibleName(t), 'Messages and comments. Connected. Waiting for your approval 2');
  assert.equal(tileAccessibleName(reviewsTile({ ...base, googleConnected: null })), 'Google reviews. Open to see your reviews');
});

test('the part comes from the address', () => {
  assert.equal(partFromParam('reviews'), 'reviews');
  assert.equal(partFromParam('auto-reply'), 'auto-reply');
  assert.equal(partFromParam(null), 'messages');
  assert.equal(partFromParam('other'), 'messages');
});

test('until the live test passes the explainer says what is set up, never that it has worked', () => {
  assert.equal(EXPLAINER, EXPLAINER_VERSIONS.ready);
  assert.equal(EXPLAINER.badge, 'Set up and ready to test');
  const ready = [EXPLAINER.title, ...EXPLAINER.lines, EXPLAINER.safety].join(' ');
  assert.match(ready, /is set up to read/);
  assert.match(ready, /draft a reply/);
  for (const claim of [/reads each new/, /writes a reply/, /go out on their own\./, /tested/i, /proven/i, /works/i]) assert.doesNotMatch(ready, claim);
  assert.equal(EXPLAINER_VERSIONS.proven.badge, '');
});

test('the explainer says the honest things and none of the banned ones', () => {
  const all = [EXPLAINER.title, ...EXPLAINER.lines, EXPLAINER.safety, ...EXPLAINER_STEPS.flatMap((s) => [s.title, s.text]), ...Object.values(ADDON_NOTE), ADDON_NOTE_CLIENT].join(' ');
  assert.match(all, /waits for you/);
  assert.match(all, /only when you switch that on/);
  assert.match(all, /switch it off any time/);
  assert.match(all, /Instagram and Facebook/);
  for (const banned of [/quark/i, /credit/i, /trial/i, /7 days/i, /ayrshare/i, /tested/i, /guarantee/i, /more sales/i, /!/, /—/]) {
    assert.doesNotMatch(all, banned);
  }
  assert.deepEqual(EXPLAINER_STEPS.map((s) => s.title), ['Connect', 'Choose how careful', 'Review or let it run']);
});

test('the explainer button: add-on, then connect, then none; never See plans inside a client or staff pass', () => {
  assert.deepEqual(explainerAction({ entitled: false, connectedCount: 2 }), { label: 'See plans', to: '/trial-expired' });
  assert.equal(explainerAction({ entitled: false, connectedCount: 2, clientPass: true }), null);
  assert.deepEqual(explainerAction({ entitled: true, connectedCount: 0, clientPass: true }), { label: 'Connect an account', to: '/connect-socials' });
  assert.deepEqual(explainerAction({ entitled: true, connectedCount: 0 }), { label: 'Connect an account', to: '/connect-socials' });
  assert.equal(explainerAction({ entitled: true, connectedCount: 1 }), null);
});

test('chip and explainer text colours keep 4.5 to 1 on their backgrounds', () => {
  const css = read('components/inbox/inbox.css');
  const pairs = [['#DDF2E6', '#22603A'], ['#FFF0C7', '#8A5000'], ['#ECE6FB', '#5B3FA6'], ['#F1ECE2', '#5E4A31'],
    ['#FFF1D2', '#5E4A31'], ['#FFF1D2', '#8A5200'], ['#FFE2A1', '#6B3F00'], ['#F5A623', '#1A1208']];
  for (const [bg, fg] of pairs) {
    assert.ok(css.includes(bg) && css.includes(fg), `${bg} and ${fg} are used in inbox.css`);
    const r = ratio(parseColor(fg), parseColor(bg));
    assert.ok(r >= 4.5, `${fg} on ${bg} is ${r.toFixed(2)} to 1`);
  }
});

test('the strip keeps every row full and the tiles the same height; motion only without reduced motion', () => {
  const css = read('components/inbox/inbox.css');
  assert.match(css, /repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /align-self: stretch/);
  assert.ok(!/align-items: start/.test(css), 'no masonry alignment');
  const motion = css.split('@media (prefers-reduced-motion: no-preference)')[1] || '';
  assert.match(motion, /animation: nb-ix-sway/);
  const outside = css.split('@media (prefers-reduced-motion: no-preference)')[0];
  assert.ok(!/animation:/.test(outside), 'no animation outside the motion block');
});

test('the step glyphs follow the art rules', () => {
  for (const f of ['Frame', 'Connect', 'Careful', 'Run', 'Live', 'Stars']) {
    const src = read(`components/art/inbox/${f}.tsx`);
    assert.ok(Buffer.byteLength(src) <= 2048, `${f} is at most 2 KB`);
    assert.doesNotMatch(src, /<text\b|<image\b|<script\b|dangerouslySetInnerHTML|https?:\/\//);
  }
  assert.match(read('components/art/inbox/Frame.tsx'), /aria-hidden="true"/);
});
