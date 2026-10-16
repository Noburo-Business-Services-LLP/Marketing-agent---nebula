import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isAgencyUser, clientsLeft, limitLabel, actingBannerText, isInsideClient, showClientSwitcher,
  returnButtonLabel, clientStatus, mergeUsage, usageText, lastActiveText, addClientCheck, slotOffer,
  slotPriceText, includedText, canConfirmRemoval, removalExplainer, agencyErrorMessage, pausedReason, clientAllowanceEmpty,
  mergeActing, isLapsedAgency, showsPostsNotQuarks, poolText, actingClientName, agencyAllowanceEmpty,
} from '../utils/agency.ts';
import { returnHashAfterActing } from '../utils/staffHome.ts';

test('only an account on the Agency plan is an agency, and a client inside it is not', () => {
  assert.equal(isAgencyUser({ plan: { tier: 'agency' } }), true);
  assert.equal(isAgencyUser({ plan: { tier: 'professional' } }), false);
  assert.equal(isAgencyUser(null), false);
  assert.equal(isAgencyUser({ plan: { tier: 'agency' }, actingAgency: { name: 'Studio X' } }), false);
});

test('slots left and the label never go negative', () => {
  assert.equal(clientsLeft(3, 5), 2);
  assert.equal(clientsLeft(7, 5), 0);
  assert.equal(limitLabel(3, 5), '3 of 5 clients');
  assert.equal(limitLabel(1, 5), '1 of 5 clients');
});

test('the banner inside a client names the client and says where money is handled', () => {
  assert.match(actingBannerText('Sweet Co'), /Sweet Co/);
  assert.doesNotMatch(actingBannerText('Sweet Co'), /credit|trial|quark/i);
  assert.match(actingBannerText(''), /a client/);
  assert.doesNotMatch(actingBannerText('Sweet Co'), /!|—/);
});

test('inside a client is known from the server answer', () => {
  assert.equal(isInsideClient({ actingAgency: { name: 'A' } }), true);
  assert.equal(isInsideClient({ actingAgency: null }), false);
  assert.equal(isInsideClient(null), false);
});

test('the switcher shows for an agency and inside one of its clients, nowhere else', () => {
  assert.equal(showClientSwitcher({ plan: { tier: 'agency' } }, false), true);
  assert.equal(showClientSwitcher({ plan: { tier: 'agency' }, actingAgency: { name: 'A' } }, true), true);
  assert.equal(showClientSwitcher({ plan: { tier: 'agency' }, actingAgency: { name: 'A' } }, false), false);
  assert.equal(showClientSwitcher({ plan: { tier: 'starter' } }, false), false);
  assert.equal(showClientSwitcher({ plan: { tier: 'starter' } }, true), false);
  assert.equal(showClientSwitcher(null, true), false);
});

test('the return button names where it goes', () => {
  assert.equal(returnButtonLabel('#/staff/clients'), 'Back to staff area');
  assert.equal(returnButtonLabel('#/agency/clients'), 'Back to my clients');
  assert.equal(returnButtonLabel('#/clients'), 'Back to my clients');
  assert.equal(returnButtonLabel(null), 'Back to my clients');
});

test('the shared return hash keeps the agency Clients page and still refuses anything else', () => {
  assert.equal(returnHashAfterActing('#/agency/clients'), '#/agency/clients');
  assert.equal(returnHashAfterActing('#/staff/clients'), '#/staff/clients');
  assert.equal(returnHashAfterActing('#/clients'), '#/clients');
  assert.equal(returnHashAfterActing('#/agency/clients/<x>'), '#/clients');
  assert.equal(returnHashAfterActing('https://elsewhere.example/'), '#/clients');
});

test('a paused client says Paused, gives a reason, and cannot be opened', () => {
  const live = clientStatus({ id: 'a', name: 'A', frozen: false }, 5);
  assert.deepEqual([live.paused, live.label, live.canOpen, live.reason], [false, 'Active', true, '']);
  const off = clientStatus({ id: 'b', name: 'B', frozen: true }, 5);
  assert.deepEqual([off.paused, off.label, off.canOpen], [true, 'Paused', false]);
  assert.match(off.reason, /5 clients/);
  assert.match(pausedReason(0), /not active/i);
  assert.doesNotMatch(pausedReason(5), /credit|trial|quark/i);
  assert.match(pausedReason(5), /nothing was deleted/i);
});

test('usage is merged by client id and the months of removed clients are left out of the list', () => {
  const clients = [{ id: 'a', name: 'A', frozen: false }, { id: 'b', name: 'B', frozen: true }];
  const usage = { clients: [
    { id: 'a', posts: 4, videos: 1, lastActive: '2026-10-10T00:00:00Z', quarksSpent: 99, total: { quarksSpent: 9 } },
    { id: 'removed', name: 'Removed client', removed: true, posts: 2, videos: 0 },
  ] };
  const rows = mergeUsage(clients, usage);
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].posts, rows[0].videos, rows[0].lastActive], [4, 1, '2026-10-10T00:00:00Z']);
  assert.deepEqual([rows[1].posts, rows[1].videos, rows[1].lastActive], [0, 0, null]);
  for (const r of rows) assert.equal(JSON.stringify(r).includes('uark'), false);
  assert.equal(mergeUsage(clients, null).length, 2);
});

test('usage text counts posts and videos for the month in plain words', () => {
  assert.equal(usageText(4, 1), '4 posts, 1 video this month');
  assert.equal(usageText(1, 2), '1 post, 2 videos this month');
  assert.equal(usageText(0, 0), 'Nothing made this month');
  assert.equal(usageText(3, 0), '3 posts, no videos this month');
  assert.equal(usageText(0, 2), 'No posts, 2 videos this month');
});

test('last active reads in days', () => {
  const now = Date.parse('2026-10-16T12:00:00Z');
  assert.equal(lastActiveText(null, now), 'No activity yet');
  assert.equal(lastActiveText('2026-10-16T01:00:00Z', now), 'Active today');
  assert.equal(lastActiveText('2026-10-15T01:00:00Z', now), 'Active yesterday');
  assert.equal(lastActiveText('2026-10-10T01:00:00Z', now), 'Active 6 days ago');
  assert.equal(lastActiveText('nonsense', now), 'No activity yet');
});

test('adding a client asks for a name and says what to do when no slot is left', () => {
  const room = { used: 3, limit: 5, maxClients: 25 };
  assert.equal(addClientCheck('  ', room).ok, false);
  assert.match(addClientCheck('', room).problem, /business name/i);
  assert.equal(addClientCheck('Sweet Co', room).ok, true);
  const full = addClientCheck('Sweet Co', { used: 5, limit: 5, maxClients: 25 });
  assert.deepEqual([full.ok, full.needsSlot, full.atMost], [false, true, false]);
  assert.match(full.problem, /extra client/i);
  const top = addClientCheck('Sweet Co', { used: 25, limit: 25, maxClients: 25 });
  assert.deepEqual([top.ok, top.needsSlot, top.atMost], [false, false, true]);
  assert.match(top.problem, /25/);
  assert.equal(addClientCheck('x'.repeat(200), room).ok, false);
});

test('the slot offer appears only when all slots are used and one more can be bought', () => {
  assert.equal(slotOffer({ used: 3, limit: 5, maxClients: 25, slotInr: 1499 }), null);
  const buy = slotOffer({ used: 5, limit: 5, maxClients: 25, slotInr: 1499 });
  assert.equal(buy.kind, 'buy');
  assert.match(buy.text, /₹1,499/);
  assert.match(buy.text, /GST/);
  assert.doesNotMatch(buy.text, /quark|credit|trial/i);
  const max = slotOffer({ used: 25, limit: 25, maxClients: 25, slotInr: 1499 });
  assert.equal(max.kind, 'max');
  assert.match(max.text, /25/);
  assert.equal(slotOffer({ used: 5, limit: 5, maxClients: 25, slotInr: 0 }).kind, 'buy');
  assert.equal(slotOffer({ used: 0, limit: 0, maxClients: 25, slotInr: 1499 }), null);
});

test('prices come from the figures passed in, never from the file', () => {
  assert.equal(slotPriceText(1499), '₹1,499 a month plus GST');
  assert.equal(slotPriceText(2000), '₹2,000 a month plus GST');
  assert.equal(slotPriceText(0), '');
  assert.equal(slotPriceText(undefined), '');
  assert.match(includedText(5, 1499), /5 clients/);
  assert.match(includedText(5, 1499), /₹1,499/);
  assert.match(includedText(5, 2100), /₹2,100/);
  assert.equal(includedText(5, 0), 'Your plan includes 5 clients.');
});

test('removing needs the password and REMOVE typed exactly', () => {
  assert.equal(canConfirmRemoval('secret', 'REMOVE'), true);
  assert.equal(canConfirmRemoval('secret', ' REMOVE '), true);
  assert.equal(canConfirmRemoval('secret', 'remove'), false);
  assert.equal(canConfirmRemoval('', 'REMOVE'), false);
  assert.equal(canConfirmRemoval('secret', ''), false);
});

test('the removal text says what is erased and what is kept, with no Quarks', () => {
  const t = removalExplainer('Sweet Co');
  assert.match(t.erased, /posts, videos, brand details/i);
  assert.match(t.erased, /Sweet Co/);
  assert.match(t.erased, /connected social/i);
  assert.match(t.kept, /usage history/i);
  assert.match(t.kept, /report/i);
  assert.match(t.undo, /cannot be undone/i);
  assert.doesNotMatch(JSON.stringify(t), /quark|credit|trial|!/i);
});

test('errors show the server sentence when it is a plain one and a safe sentence otherwise', () => {
  const run = 'Wait until this client’s videos and jobs finish, then try again.';
  assert.equal(agencyErrorMessage({ status: 409, message: run }, 'fallback'), run);
  assert.equal(agencyErrorMessage({ status: 400, message: 'Your plan includes 5 clients and all of them are in use. Add a client slot to add more.' }, 'f'), 'Your plan includes 5 clients and all of them are in use. Add a client slot to add more.');
  assert.equal(agencyErrorMessage({ status: 403, message: 'That password is not correct.' }, 'f'), 'That password is not correct.');
  assert.equal(agencyErrorMessage({ status: 502, message: 'ECONNRESET at http://10.0.0.1:5000/x' }, 'We could not remove this client.'), 'We could not remove this client.');
  assert.equal(agencyErrorMessage({ status: 500 }, 'fb'), 'fb');
  assert.equal(agencyErrorMessage(new Error('Unable to connect to server. Please check your connection.'), 'fb'), 'Unable to connect to server. Please check your connection.');
  assert.equal(agencyErrorMessage(null, 'fb'), 'fb');
  assert.equal(agencyErrorMessage({ status: 400, message: 'x'.repeat(400) }, 'fb'), 'fb');
});

test('when the shared allowance runs out inside a client, the prompt sends the person to the agency account', () => {
  const t = clientAllowanceEmpty();
  assert.match(t.title, /agency/i);
  assert.match(t.body, /agency account/i);
  assert.equal(t.action, 'Back to my clients');
  assert.doesNotMatch(JSON.stringify(t), /quark|credit|trial|!|\u2014/i);
});

test('the server sends actingAgency next to user; mergeActing puts it on the user so the checks work', () => {
  const real = { success: true, user: { plan: { tier: 'agency' }, firstName: 'Owner' }, actingAgency: { name: 'Owner' }, actingCsm: null };
  const u = mergeActing(real);
  assert.equal(isInsideClient(u), true);
  assert.equal(isAgencyUser(u), false);
  assert.equal(showClientSwitcher(u, true), true);
  const own = mergeActing({ success: true, user: { plan: { tier: 'agency' } } });
  assert.equal(isAgencyUser(own), true);
  assert.equal(own.actingAgency, null);
  assert.equal(mergeActing({ user: { a: 1 }, actingCsm: { name: 'C' } }).actingCsm.name, 'C');
  assert.equal(mergeActing({ success: true }), null);
  assert.equal(mergeActing(null), null);
});

test('a lapsed agency is an owner of clients with a plan that is not the agency plan', () => {
  assert.equal(isLapsedAgency({ plan: { tier: 'free' }, agency: { clientCount: 2 } }), true);
  assert.equal(isLapsedAgency({ plan: { tier: 'agency' }, agency: { clientCount: 2 } }), false);
  assert.equal(isLapsedAgency({ plan: { tier: 'free' }, agency: { clientCount: 0 } }), false);
  assert.equal(isLapsedAgency({ plan: { tier: 'agency' }, actingAgency: { name: 'x' }, agency: { clientCount: 2 } }), false);
});

test('agencies and their clients see posts and videos, other customers keep Quarks', () => {
  assert.equal(showsPostsNotQuarks({ plan: { tier: 'agency' } }), true);
  assert.equal(showsPostsNotQuarks({ plan: { tier: 'agency' }, actingAgency: { name: 'x' } }), true);
  assert.equal(showsPostsNotQuarks({ plan: { tier: 'professional' } }), false);
  assert.equal(showsPostsNotQuarks(null), false);
  assert.equal(poolText(12, 1), '12 posts and 1 video left in the shared pool');
  assert.doesNotMatch(agencyAllowanceEmpty().body + agencyAllowanceEmpty().title, /quark/i);
});

test('the client name is the client, never the agency owner', () => {
  assert.equal(actingClientName({ agency: { workspaceName: 'Sweet Co' } }, ''), 'Sweet Co');
  assert.equal(actingClientName({ agency: { workspaceName: 'Sweet Co' } }, 'Bakery'), 'Bakery');
  assert.equal(actingClientName({ businessProfile: { name: 'Biz' } }, null), 'Biz');
  assert.equal(actingClientName(null, null), '');
});

test('error text never shows Quarks or vendor names', () => {
  assert.equal(agencyErrorMessage({ message: 'You have used all of your Quarks.' }, 'fb'), 'fb');
  assert.equal(agencyErrorMessage({ message: 'Gemini timed out' }, 'fb'), 'fb');
});
