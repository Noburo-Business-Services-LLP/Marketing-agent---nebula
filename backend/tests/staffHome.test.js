const test = require('node:test');
const assert = require('node:assert');
const { buildHealth, statusFor } = require('../services/staff/health');
const { buildHome, signupStats, series30, dayKey, pct } = require('../services/staff/home');
const { urgency } = require('../services/staff/clientStatus');
const { createAlerter } = require('../services/opsAlerts');

const NOW = new Date('2026-10-07T06:30:00Z').getTime(); // 12:00 in India
const DAY = 86400000;
const ago = (d) => new Date(NOW - d * DAY);
const owner = { _id: 'o1', staffRole: 'owner' };
const mk = (id, over = {}) => ({ _id: id, email: `${id}@x.com`, companyName: `Co ${id}`, isActive: true, onboardingCompleted: true, lastLoginAt: ago(1), credits: { balance: 500 }, connectedSocials: [{ platform: 'Instagram' }], createdAt: ago(40), ...over });

test('a card is green with no failures, amber with one or two, red with three or more', () => {
  assert.deepStrictEqual([0, 1, 2, 3, 9].map(statusFor), ['green', 'amber', 'amber', 'red', 'red']);
});

test('health cards combine categories and describe the problem in plain words', () => {
  const cards = buildHealth({ snapshot: { categories: { video: { lastHour: 1, lastDay: 2, latest: [] }, hero_video: { lastHour: 2, lastDay: 2, latest: [] }, image: { lastHour: 0, lastDay: 0, latest: [] } } }, breaker: { tripped: false } });
  const video = cards.find((c) => c.key === 'video');
  assert.deepStrictEqual([video.status, video.lastHour], ['red', 3]);
  assert.match(video.note, /failed 3 times in the last hour/);
  assert.strictEqual(cards.find((c) => c.key === 'images').status, 'green');
});

test('the posting provider refusing requests turns the social card red whatever the counts', () => {
  const cards = buildHealth({ snapshot: { categories: {} }, breaker: { tripped: true } });
  const social = cards.find((c) => c.key === 'social');
  assert.strictEqual(social.status, 'red');
  assert.doesNotMatch(social.note, /Ayrshare/);
});

test('the alerter remembers a day of failures for the Home screen', () => {
  let t = 1000000000000;
  const a = createAlerter({ env: {}, now: () => t, send: async () => {} });
  a.recordFailure('image', 'quota'); t += 60000; a.recordFailure('image', 'again'); t += 4 * 3600000; a.recordFailure('image', 'late');
  const s = a.snapshot().categories.image;
  assert.deepStrictEqual([s.lastHour, s.lastDay], [1, 3]);
  assert.strictEqual(s.latest[0].detail, 'late');
  t += 25 * 3600000;
  assert.strictEqual(a.snapshot().categories.image.lastDay, 0);
});

test('urgency puts failed posts and empty balances first', () => {
  assert.ok(urgency(['failed_posts'], 500) > urgency(['quarks_low'], 80));
  assert.ok(urgency(['quarks_low'], 0) > urgency(['quarks_low'], 80));
  assert.ok(urgency(['onboarding_unfinished'], 500) < urgency(['inactive'], 500));
});

test('Home lists clients needing attention, most urgent first, and counts the rest', () => {
  const users = [mk('a'), mk('b', { credits: { balance: 0 } }), mk('c', { connectedSocials: [] }), mk('d', { onboardingCompleted: false })];
  const h = buildHome({ viewer: owner, users, extras: { a: { failedPosts7d: 2 } }, now: NOW });
  assert.strictEqual(h.attention.total, 4);
  assert.deepStrictEqual(h.attention.items.map((i) => i.id), ['b', 'a', 'c', 'd']);
  assert.deepStrictEqual(h.attention.items[1].reasons, ['failed_posts']);
});

test('a CSM sees attention and growth only for their own clients', () => {
  const users = [mk('a', { assignedCsm: 'c1', credits: { balance: 10 } }), mk('b', { assignedCsm: 'c2', credits: { balance: 10 } })];
  const h = buildHome({ viewer: { _id: 'c1', staffRole: 'csm' }, users, now: NOW });
  assert.deepStrictEqual(h.attention.items.map((i) => i.id), ['a']);
  assert.strictEqual(h.growth.totalClients, 1);
});

test('sign-ups are counted per period against the period before, in India time', () => {
  const times = [NOW - 1000, NOW - DAY - 1000, NOW - 2 * DAY, NOW - 9 * DAY, NOW - 20 * DAY].map(Number);
  const s = signupStats(times, NOW);
  assert.deepStrictEqual([s.today.now, s.today.before], [1, 1]);
  assert.deepStrictEqual([s.week.now, s.week.before], [3, 1]);
  assert.strictEqual(s.week.change, 200);
  assert.strictEqual(pct(5, 0), null);
  assert.strictEqual(pct(0, 0), 0);
});

test('trials becoming paid are measured on the last 30 days of sign-ups', () => {
  const users = [mk('a', { createdAt: ago(5), payments: [{ status: 'paid' }] }), mk('b', { createdAt: ago(6) }), mk('c', { createdAt: ago(80), payments: [{ status: 'paid' }] })];
  const t = buildHome({ viewer: owner, users, now: NOW }).growth.trialToPaid;
  assert.deepStrictEqual(t, { signedUp: 2, paid: 1, percent: 50 });
});

test('the 30-day chart has thirty days with sign-ups and active clients on the right days', () => {
  const series = series30([NOW - 1000, NOW - 2 * DAY], [{ day: dayKey(NOW), n: 7 }], NOW);
  assert.strictEqual(series.length, 30);
  assert.deepStrictEqual([series[29].signups, series[29].active], [1, 7]);
  assert.strictEqual(series[27].signups, 1);
});

test('hidden test accounts and staff never count as growth', () => {
  const users = [mk('a', { createdAt: ago(1) }), mk('t', { createdAt: ago(1), isHidden: true }), { _id: 's', email: 's@x.com', staffRole: 'csm', isCsm: true, createdAt: ago(1) }];
  const h = buildHome({ viewer: owner, users, now: NOW });
  assert.strictEqual(h.growth.signups.week.now, 1);
  assert.strictEqual(h.growth.totalClients, 1);
});

// Found by running Home against seeded data: the daily-active chart counted hidden test accounts,
// while every other Home number leaves them out.
test('the clients counted for daily activity leave out hidden test accounts', () => {
  const { activityIds } = require('../services/staff/home');
  const users = [mk('a'), mk('b', { isHidden: true }), mk('c')];
  assert.deepStrictEqual(activityIds(users).map(String), ['a', 'c']);
});
