import test from 'node:test';
import assert from 'node:assert/strict';
import {
  agencyFeatureLines, agencyExtraClientLine, agencyCardState, agencyCardNote, slotPrice, slotAvailability,
  slotConfirmText, slotCreateMessage, slotVerifyMessage, slotConfirmedText,
  monthKeyOf, isMonthKey, shiftMonth, monthLabel, monthChoices, canGoNext, canGoPrev,
  usageRowsOf, poolText, pagerState, removedClientNote, usageLoadMessage, csvLinkLabel, insideClientBillingNotice, agencyHeadline,
} from '../utils/agencyPlan.ts';

const AGENCY = { includedClients: 5, maxClients: 25, slotInr: 1499 };
const SLOT = { id: 'client', inr: 1499, gstPaise: 26982, chargePaise: 176882 };
const PLAN = { id: 'agency', outputs: { posts: 545, videos: 37 }, features: ['Up to 545 posts a month, or', 'up to 37 short videos with voice and music', 'Spend it on posts or videos, in any mix', 'Top up any time', '5 client brands included', 'Publishing, inbox and competitor insights included', 'Usage report for each client'] };

test('the Agency card is one coherent list in plain words, with every number from the API', () => {
  const lines = agencyFeatureLines(PLAN, AGENCY);
  const text = lines.join('\n');
  assert.match(lines[0], /^5 client brands/);
  assert.match(text, /545 posts/);
  assert.match(text, /37 short videos/);
  assert.match(text, /shared/i);
  assert.match(text, /Publishing, inbox and competitor insights included/);
  assert.match(text, /usage report for each client/i);
  // no dangling fragments from the generic list ("..., or" / "up to ..." on its own line)
  for (const l of lines) { assert.doesNotMatch(l, /,\s*or$/); assert.match(l, /^[A-Z0-9]/); assert.doesNotMatch(l, /^up to/i); }
  assert.equal(new Set(lines).size, lines.length);
  const other = agencyFeatureLines({ outputs: { posts: 100, videos: 9 } }, { includedClients: 3, maxClients: 25, slotInr: 1 }).join('\n');
  assert.match(other, /^3 client brands/);
  assert.match(other, /100 posts/);
  assert.match(other, /9 short videos/);
  assert.doesNotMatch(other, /545|37\b/);
});

test('the Agency card has no Quark, credit, trial, exclamation or dash in its words', () => {
  const all = [...agencyFeatureLines(PLAN, AGENCY), agencyExtraClientLine(AGENCY, SLOT), agencyCardNote('other-plan'), agencyCardNote('current'),
    slotConfirmText(SLOT, AGENCY, 5).join(' '), slotCreateMessage(new Error('')), slotVerifyMessage({ status: 409, message: 'x' }), slotVerifyMessage(new Error('')),
    slotConfirmedText({ clientLimit: 7 }), slotAvailability({ limit: 25, used: 25, maxClients: 25 }).message, poolText(10, 1), poolText(0, 0), removedClientNote(), usageLoadMessage({ status: 500 }), usageLoadMessage({ status: 403 })].join('\n');
  assert.doesNotMatch(all, /quark|credit|trial|7 days|!|—/i);
});

test('without outputs the pool line stays true and shows no numbers', () => {
  const lines = agencyFeatureLines({}, AGENCY);
  assert.ok(lines.some((l) => /shared pool of posts and videos/i.test(l)));
  assert.doesNotMatch(lines.join(' '), /undefined|NaN/);
});

test('the extra client line takes its price and limit from the API', () => {
  assert.equal(agencyExtraClientLine(AGENCY, SLOT), 'Extra clients are ₹1,499 a month plus GST each, up to 25 clients in total.');
  assert.equal(agencyExtraClientLine({ ...AGENCY, maxClients: 10 }, { ...SLOT, inr: 900 }), 'Extra clients are ₹900 a month plus GST each, up to 10 clients in total.');
  assert.equal(agencyExtraClientLine(AGENCY, undefined), 'Extra clients are ₹1,499 a month plus GST each, up to 25 clients in total.');
  assert.equal(agencyExtraClientLine(undefined, undefined), '');
});

test('the card state: managed accounts get no purchase, a subscribed agency sees Your plan', () => {
  assert.equal(agencyCardState('managed'), 'managed');
  assert.equal(agencyCardState('agency'), 'current');
  assert.equal(agencyCardState('starter'), 'other-plan');
  assert.equal(agencyCardState('professional'), 'other-plan');
  assert.equal(agencyCardState('free'), 'available');
  assert.equal(agencyCardState(undefined), 'available');
  assert.equal(agencyCardNote('other-plan'), 'You already have an active plan.');
  assert.equal(agencyCardNote('available'), '');
});

test('slot price shows rupees and the GST-inclusive monthly amount from API values', () => {
  const p = slotPrice(SLOT, AGENCY);
  assert.equal(p.exGst, '₹1,499');
  assert.equal(p.withGst, '₹1,768.82');
  assert.equal(p.monthly, '₹1,499 a month plus GST');
  assert.equal(p.monthlyWithGst, '₹1,768.82 a month including 18 percent GST');
  const q = slotPrice({ ...SLOT, inr: 2000, chargePaise: 236000 }, AGENCY);
  assert.equal(q.withGst, '₹2,360.00');
  const noSlot = slotPrice(undefined, AGENCY);
  assert.equal(noSlot.exGst, '₹1,499');
  assert.equal(noSlot.withGst, '');
  assert.equal(noSlot.monthlyWithGst, '');
  assert.equal(slotPrice(undefined, undefined), null);
});

test('slot availability: open below the maximum, closed at it, with a plain reason', () => {
  const a = slotAvailability({ limit: 5, used: 3, maxClients: 25 });
  assert.equal(a.canBuy, true); assert.equal(a.atMax, false); assert.equal(a.nextLimit, 6);
  assert.match(a.message, /5 to 6 clients/);
  assert.equal(slotAvailability({ limit: 24, used: 24, maxClients: 25 }).canBuy, true);
  const cap = slotAvailability({ limit: 25, used: 25, maxClients: 25 });
  assert.equal(cap.canBuy, false); assert.equal(cap.atMax, true);
  assert.equal(cap.message, 'You are at the most clients one agency account can have (25). Contact us for a larger set-up.');
  assert.equal(slotAvailability({ limit: 30, used: 25, maxClients: 25 }).canBuy, false);
  const off = slotAvailability({ limit: 0, used: 4, maxClients: 25 });
  assert.equal(off.canBuy, false); assert.equal(off.atMax, false);
  assert.match(off.message, /active Agency plan/);
  assert.equal(slotAvailability({ limit: 'x', used: 1, maxClients: 25 }).canBuy, false);
  const unused = slotAvailability({ limit: 7, used: 3, maxClients: 25 });
  assert.match(unused.hint, /4 client places not in use/);
  assert.equal(slotAvailability({ limit: 7, used: 6, maxClients: 25 }).hint, 'You have 1 client place not in use.');
  assert.equal(slotAvailability({ limit: 7, used: 7, maxClients: 25 }).hint, '');
});

test('the purchase dialog states the GST-inclusive amount, renewal, and no refund or cancel promise', () => {
  const lines = slotConfirmText(SLOT, AGENCY, 5);
  const t = lines.join(' ');
  assert.match(t, /₹1,499 a month plus GST/);
  assert.match(t, /₹1,768.82/);
  assert.match(t, /5 to 6 clients/);
  assert.match(t, /renews monthly/i);
  assert.doesNotMatch(t, /cancel|refund|instant/i);
});

test('starting a purchase that the server refuses shows its plain sentence', () => {
  assert.equal(slotCreateMessage({ message: 'You are at the most clients one agency account can have (25). Contact us for a larger set-up.' }), 'You are at the most clients one agency account can have (25). Contact us for a larger set-up.');
  assert.equal(slotCreateMessage({ message: 'Client slots are part of the Agency plan.' }), 'Client slots are part of the Agency plan.');
  assert.equal(slotCreateMessage(new Error('')), 'The payment could not be started. Please try again.');
  assert.equal(slotCreateMessage({ message: 'connect ECONNREFUSED 127.0.0.1:5000' }), 'The payment could not be started. Please try again.');
  assert.equal(slotCreateMessage(null), 'The payment could not be started. Please try again.');
});

test('a 409 on confirming says the payment is still being confirmed, never to pay again, and no instant refund', () => {
  const m = slotVerifyMessage({ status: 409, message: 'Your payment was received, but the extra client could not be added yet. Our team has been told.' });
  assert.match(m, /^Your payment was received/);
  assert.match(m, /do not pay again/i);
  assert.match(m, /several working days/i);
  assert.doesNotMatch(m, /instant|immediate|right away|within minutes/i);
  const bare = slotVerifyMessage({ status: 409 });
  assert.match(bare, /received your payment/i);
  assert.match(bare, /do not pay again/i);
  assert.match(bare, /several working days/i);
});

test('other confirm failures are plain and never leak technical text', () => {
  assert.equal(slotVerifyMessage({ status: 400, message: 'That payment could not be verified.' }), 'That payment could not be verified.');
  const net = slotVerifyMessage(new TypeError('Failed to fetch https://x.test/api/payment/verify-subscription'));
  assert.doesNotMatch(net, /fetch|https/);
  assert.match(net, /could not confirm/i);
  assert.match(net, /do not pay again/i);
  assert.match(slotVerifyMessage(undefined), /could not confirm/i);
});

test('a confirmed extra client shows the new client limit from the server', () => {
  assert.equal(slotConfirmedText({ clientLimit: 7 }), 'Your extra client is added. You can now have 7 clients.');
  assert.equal(slotConfirmedText({ clientLimit: 25, message: 'Your extra client is added.' }), 'Your extra client is added. You can now have 25 clients.');
  assert.equal(slotConfirmedText({ message: 'Your extra client is added.' }), 'Your extra client is added.');
  assert.equal(slotConfirmedText({}), 'Your extra client is added.');
  assert.equal(slotConfirmedText({ clientLimit: 'x' }), 'Your extra client is added.');
  assert.equal(slotConfirmedText({ clientLimit: 0 }), 'Your extra client is added.');
});

test('months are year-month keys in UTC, switched one at a time, never past this month', () => {
  assert.equal(monthKeyOf(new Date(Date.UTC(2026, 9, 16))), '2026-10');
  assert.equal(monthKeyOf(new Date(Date.UTC(2026, 0, 31, 23, 59))), '2026-01');
  assert.equal(isMonthKey('2026-10'), true);
  assert.equal(isMonthKey('2026-13'), false);
  assert.equal(isMonthKey('2026-1'), false);
  assert.equal(isMonthKey(undefined), false);
  assert.equal(shiftMonth('2026-10', -1), '2026-09');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('bad', 1), 'bad');
  assert.equal(monthLabel('2026-10'), 'October 2026');
  assert.equal(monthLabel('2025-01'), 'January 2025');
  assert.equal(monthLabel('nope'), '');
  assert.equal(canGoNext('2026-10', '2026-10'), false);
  assert.equal(canGoNext('2026-09', '2026-10'), true);
  assert.equal(canGoNext('2026-11', '2026-10'), false);
  assert.equal(canGoPrev('2026-10', '2026-10'), true);
  assert.equal(canGoPrev('2024-10', '2026-10'), false);
  assert.deepEqual(monthChoices('2026-02', 4), ['2026-02', '2026-01', '2025-12', '2025-11']);
});

test('usage rows drop every Quark figure and keep posts, videos and the removed line', () => {
  const rows = usageRowsOf({ clients: [
    { id: 'a1', name: 'Sweet Co', frozen: false, posts: 12, videos: 2, quarksSpent: 540, total: { posts: 30, videos: 5, quarksSpent: 1200 }, lastActive: '2026-10-05T10:00:00.000Z' },
    { id: 'removed', name: 'Removed client', removed: true, posts: 1, videos: 0, quarksSpent: 11 },
    { id: 'a3', name: 'Frozen Co', frozen: true, posts: -4, videos: 'x', quarksSpent: 0 },
  ] });
  assert.equal(rows.length, 3);
  assert.deepEqual(Object.keys(rows[0]).sort(), ['frozen', 'id', 'lastActive', 'name', 'posts', 'removed', 'videos']);
  assert.equal(JSON.stringify(rows).includes('quark'), false);
  assert.equal(JSON.stringify(rows).includes('1200'), false);
  assert.equal(rows[0].posts, 12);
  assert.equal(rows[1].removed, true);
  assert.equal(rows[1].name, 'Removed client');
  assert.equal(rows[2].posts, 0);
  assert.equal(rows[2].videos, 0);
  assert.deepEqual(usageRowsOf(null), []);
  assert.deepEqual(usageRowsOf({}), []);
});

test('the pool is shown as posts or videos left, never as Quarks', () => {
  assert.equal(poolText(381, 26), 'Your shared pool has about 381 posts or 26 videos left this month.');
  assert.equal(poolText(1, 1), 'Your shared pool has about 1 post or 1 video left this month.');
  assert.equal(poolText(1234, 85), 'Your shared pool has about 1,234 posts or 85 videos left this month.');
  assert.equal(poolText(0, 0), 'Your shared pool is empty. Add more to keep making posts and videos.');
  assert.equal(poolText(undefined, undefined), '');
  assert.equal(poolText(NaN, 3), '');
  assert.equal(poolText(5, undefined), 'Your shared pool has about 5 posts left this month.');
});

test('paging shows which clients are on screen and whether there is more', () => {
  assert.deepEqual(pagerState({ page: 1, limit: 25, total: 31, hasMore: true }), { page: 1, canPrev: false, canNext: true, text: 'Showing 1 to 25 of 31 clients' });
  assert.deepEqual(pagerState({ page: 2, limit: 25, total: 31, hasMore: false }), { page: 2, canPrev: true, canNext: false, text: 'Showing 26 to 31 of 31 clients' });
  assert.deepEqual(pagerState({ page: 1, limit: 25, total: 1, hasMore: false }), { page: 1, canPrev: false, canNext: false, text: '' });
  assert.deepEqual(pagerState({ page: 1, limit: 25, total: 0, hasMore: false }), { page: 1, canPrev: false, canNext: false, text: '' });
  assert.deepEqual(pagerState(null), { page: 1, canPrev: false, canNext: false, text: '' });
});

test('the removed client line explains itself; load errors are plain; the CSV link names the month', () => {
  assert.match(removedClientNote(), /Their use is kept so the totals add up/);
  assert.match(usageLoadMessage({ status: 403 }), /Agency plan is active/);
  assert.match(usageLoadMessage({ status: 500, message: 'Cannot read properties of undefined' }), /could not load/i);
  assert.doesNotMatch(usageLoadMessage({ status: 500, message: 'Cannot read properties of undefined' }), /undefined/);
  assert.equal(csvLinkLabel('2026-10'), 'Download October 2026 as CSV');
  assert.equal(csvLinkLabel(''), 'Download as CSV');
});

test('inside a client the plans page says billing is handled in the agency account', () => {
  const n = insideClientBillingNotice();
  assert.match(n.title, /agency account/);
  assert.match(n.body, /plan/i);
  assert.equal(n.action, 'Back to my clients');
  assert.doesNotMatch(JSON.stringify(n), /quark|credit|trial|!|—/i);
});

test('an agency whose shared pool is used up is told in posts and videos, not Quarks', () => {
  const h = agencyHeadline(true);
  assert.match(h.title, /shared pool/);
  assert.doesNotMatch(JSON.stringify(h), /quark|credit|trial|!|—/i);
  assert.match(agencyHeadline(false).title, /Agency plan/);
  assert.doesNotMatch(JSON.stringify(agencyHeadline(false)), /quark|credit|trial|!|—/i);
});

// ---------------- cancelling one extra client ----------------
import { canCancelExtraClient, cancelExtraConfirmText, extraClientEndingNote, cancelExtraMessage, cancelExtraDoneText } from '../utils/agencyPlan.ts';

test('the cancel link shows only when an extra place is held and not all are already ending', () => {
  assert.equal(canCancelExtraClient({ extraSlots: 0, slotsEnding: 0 }), false);
  assert.equal(canCancelExtraClient({ extraSlots: 2, slotsEnding: 0 }), true);
  assert.equal(canCancelExtraClient({ extraSlots: 2, slotsEnding: 1 }), true);
  assert.equal(canCancelExtraClient({ extraSlots: 2, slotsEnding: 2 }), false);
  assert.equal(canCancelExtraClient({ extraSlots: 1, slotsEnding: 3 }), false);
  assert.equal(canCancelExtraClient(null), false);
  assert.equal(canCancelExtraClient({}), false);
  assert.equal(canCancelExtraClient({ extraSlots: 'x', slotsEnding: undefined }), false);
});

test('the confirm text says the place ends with the paid month, the limit drops by one and a free place is needed', () => {
  const lines = cancelExtraConfirmText(7);
  const text = lines.join(' ');
  assert.match(text, /end of the month you have paid for/i);
  assert.match(text, /7 to 6 clients/);
  assert.match(text, /free client place/i);
  assert.doesNotMatch(text, /quark|credit|trial|7 days|razorpay|ayrshare/i);
});

test('the note after cancelling names the date when known, otherwise the end of the month', () => {
  assert.equal(extraClientEndingNote({ extraSlots: 2, slotsEnding: 0 }), '');
  assert.equal(extraClientEndingNote({ extraSlots: 2, slotsEnding: 1, slotsEndAt: '2026-11-20T00:00:00.000Z' }), 'Ends on 20 November 2026');
  assert.equal(extraClientEndingNote({ extraSlots: 2, slotsEnding: 1 }), 'One extra client place ends at the end of this month');
  assert.equal(extraClientEndingNote({ extraSlots: 3, slotsEnding: 2 }), '2 extra client places end at the end of this month');
  assert.equal(extraClientEndingNote({ extraSlots: 2, slotsEnding: 1, slotsEndAt: 'garbage' }), 'One extra client place ends at the end of this month');
  assert.doesNotMatch(extraClientEndingNote({ extraSlots: 1, slotsEnding: 1 }), /quark|credit|trial|7 days/i);
});

test('server refusals are shown as the server wrote them, with a plain fallback', () => {
  assert.equal(cancelExtraMessage({ status: 400, message: 'You are using all your client places. Remove a client first, then cancel an extra place.' }), 'You are using all your client places. Remove a client first, then cancel an extra place.');
  assert.match(cancelExtraMessage(new Error('Failed to fetch')), /could not cancel/i);
  assert.match(cancelExtraMessage(undefined), /Please try again/);
});

test('the done text uses the date when the server gave one', () => {
  assert.match(cancelExtraDoneText({ endsAt: '2026-11-20T00:00:00.000Z' }), /20 November 2026/);
  assert.match(cancelExtraDoneText({}), /end of the month/i);
  assert.match(cancelExtraDoneText(null), /end of the month/i);
});
