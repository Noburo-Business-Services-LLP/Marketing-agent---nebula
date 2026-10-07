import test from 'node:test';
import assert from 'node:assert/strict';
import { formatChange, shapeSeries, niceMax, orderAttention, healthSummary, STATUS_TEXT, sinceLabel, seriesSummary } from '../utils/staffHome.ts';

test('formatChange turns the server percentage into plain words and a direction', () => {
  assert.deepEqual(formatChange(25, 4), { text: 'up 25% on the period before', dir: 'up' });
  assert.deepEqual(formatChange(-40, 5), { text: 'down 40% on the period before', dir: 'down' });
  assert.deepEqual(formatChange(0, 3), { text: 'same as the period before', dir: 'flat' });
  assert.deepEqual(formatChange(null, 0), { text: 'nothing to compare with yet', dir: 'new' });
  assert.deepEqual(formatChange(undefined, 0), { text: 'nothing to compare with yet', dir: 'new' });
});

test('shapeSeries sorts by day, fills gaps with zero and ignores bad numbers', () => {
  const out = shapeSeries([
    { day: '2026-10-03', signups: 2, active: 'x' },
    { day: '2026-10-01', signups: 1, active: 4 },
    { day: '2026-10-02' }
  ]);
  assert.deepEqual(out.days.map((d) => d.day), ['2026-10-01', '2026-10-02', '2026-10-03']);
  assert.deepEqual(out.days.map((d) => d.signups), [1, 0, 2]);
  assert.deepEqual(out.days.map((d) => d.active), [4, 0, 0]);
  assert.equal(out.totalSignups, 3);
  assert.equal(out.maxSignups, 2);
  assert.equal(out.maxActive, 4);
  assert.equal(out.days[0].label, '1 Oct');
});

test('shapeSeries copes with nothing at all', () => {
  assert.deepEqual(shapeSeries(undefined).days, []);
  assert.equal(shapeSeries(null).totalSignups, 0);
  assert.equal(shapeSeries([]).hasData, false);
  assert.equal(shapeSeries([{ day: '2026-10-01', signups: 0, active: 0 }]).hasData, false);
  assert.equal(shapeSeries([{ day: '2026-10-01', signups: 0, active: 1 }]).hasData, true);
});

test('niceMax gives a round top for the chart scale, never zero', () => {
  assert.equal(niceMax(0), 4);
  assert.equal(niceMax(3), 4);
  assert.equal(niceMax(7), 8);
  assert.equal(niceMax(13), 15);
  assert.equal(niceMax(41), 50);
  assert.equal(niceMax(120), 150);
});

test('orderAttention puts the most urgent first and keeps the server order for ties', () => {
  const items = [
    { id: 'a', quarks: 500, reasons: ['onboarding_unfinished'] },
    { id: 'b', quarks: 20, reasons: ['quarks_low'] },
    { id: 'c', quarks: 0, reasons: ['quarks_low'] },
    { id: 'd', quarks: 900, reasons: ['failed_posts'] },
    { id: 'e', quarks: 700, reasons: ['onboarding_unfinished'] }
  ];
  assert.deepEqual(orderAttention(items).map((i) => i.id), ['c', 'd', 'b', 'a', 'e']);
  assert.deepEqual(items.map((i) => i.id), ['a', 'b', 'c', 'd', 'e'], 'does not change the input');
  assert.deepEqual(orderAttention(undefined), []);
});

test('healthSummary counts cards by status and says it in one sentence', () => {
  const cards = [{ status: 'green' }, { status: 'green' }, { status: 'amber' }, { status: 'red' }];
  assert.deepEqual(healthSummary(cards), { green: 2, amber: 1, red: 1, text: '1 needs action, 1 to watch, 2 working' });
  assert.equal(healthSummary([{ status: 'green' }, { status: 'green' }]).text, 'Everything is working');
  assert.equal(healthSummary([]).text, 'No health data yet');
});

test('every status has words, so colour is never the only signal', () => {
  assert.equal(STATUS_TEXT.green, 'Working');
  assert.equal(STATUS_TEXT.amber, 'Watch');
  assert.equal(STATUS_TEXT.red, 'Needs action');
});

test('sinceLabel explains that the health numbers restart with the server', () => {
  assert.equal(sinceLabel(undefined), '');
  assert.match(sinceLabel('2026-10-07T04:30:00.000Z'), /^Counted since the server last restarted, /);
});

test('seriesSummary describes the chart in a sentence for screen readers', () => {
  const s = shapeSeries([{ day: '2026-10-01', signups: 2, active: 3 }, { day: '2026-10-02', signups: 1, active: 5 }]);
  assert.equal(seriesSummary(s), '3 sign-ups over 2 days, from 1 Oct to 2 Oct. Most clients active in one day: 5.');
  assert.equal(seriesSummary(shapeSeries([])), 'No sign-up or activity data yet.');
});

import { landingPath, staffMenuEntry } from '../utils/staffHome.ts';

test('Owners and Admins land on staff Home, CSMs on My clients, everyone else on the dashboard', () => {
  assert.equal(landingPath({ staffRole: 'owner' }, false), '/staff/home');
  assert.equal(landingPath({ staffRole: 'admin' }, false), '/staff/home');
  assert.equal(landingPath({ staffRole: 'csm', isCsm: true }, false), '/clients');
  assert.equal(landingPath({ isCsm: true }, false), '/clients');
  assert.equal(landingPath({}, false), '/dashboard');
  assert.equal(landingPath(null, false), '/dashboard');
});

test('while working inside a client account nobody is sent to the staff area', () => {
  assert.equal(landingPath({ staffRole: 'owner' }, true), '/dashboard');
  assert.equal(landingPath({ isCsm: true }, true), '/dashboard');
});

test('the menu entry says Staff home for Owner and Admin and Staff area for a CSM', () => {
  assert.deepEqual(staffMenuEntry({ staffRole: 'owner' }, false), { path: '/staff/home', label: 'Staff home', primary: true });
  assert.deepEqual(staffMenuEntry({ staffRole: 'admin' }, false), { path: '/staff/home', label: 'Staff home', primary: true });
  assert.deepEqual(staffMenuEntry({ staffRole: 'csm', isCsm: true }, false), { path: '/staff', label: 'Staff area', primary: false });
  assert.equal(staffMenuEntry({}, false), null);
  assert.equal(staffMenuEntry({ staffRole: 'owner' }, true), null);
});

// Found by opening a client as the Owner: "Back to my clients" landed on the old CSM page, which tells
// an Owner "This area is for customer success managers." Staff who opened the client from the staff
// area go back to the staff client list.
import { returnHashAfterActing } from '../utils/staffHome.ts';

test('after working in a client account, staff go back to where they opened it', () => {
  assert.equal(returnHashAfterActing('#/staff/clients'), '#/staff/clients');
  assert.equal(returnHashAfterActing('#/clients'), '#/clients');
  assert.equal(returnHashAfterActing(null), '#/clients');
  assert.equal(returnHashAfterActing(''), '#/clients');
  assert.equal(returnHashAfterActing('https://elsewhere.example/'), '#/clients');
  assert.equal(returnHashAfterActing('#/staff/clients/<script>'), '#/clients');
});
