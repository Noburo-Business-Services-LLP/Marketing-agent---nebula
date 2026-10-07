const test = require('node:test');
const assert = require('node:assert');
const s = require('../services/staff/clientStatus');

const NOW = new Date('2026-10-07T12:00:00Z').getTime();
const ago = (d) => new Date(NOW - d * 86400000);
const base = { isActive: true, onboardingCompleted: true, lastLoginAt: ago(1), credits: { balance: 500 }, connectedSocials: [{ platform: 'Instagram' }] };

test('active means active in the last 7 days; later is inactive; switched off is disabled', () => {
  assert.strictEqual(s.classifyClient(base, NOW).status, 'active');
  assert.strictEqual(s.classifyClient({ ...base, lastLoginAt: ago(10) }, NOW).status, 'inactive');
  assert.strictEqual(s.classifyClient({ ...base, isActive: false }, NOW).status, 'disabled');
});

test('a recent feature event counts as activity even if the last sign-in is old', () => {
  const c = s.classifyClient({ ...base, lastLoginAt: ago(30) }, NOW, { lastEventAt: ago(2) });
  assert.strictEqual(c.status, 'active');
});

test('paying needs a paid payment or an active subscription; refunded or failed payments do not count', () => {
  assert.strictEqual(s.isPaying({ payments: [{ status: 'paid' }] }), true);
  assert.strictEqual(s.isPaying({ plan: { subscriptions: [{ active: true }] } }), true);
  assert.strictEqual(s.isPaying({ payments: [{ status: 'failed' }, { status: 'refunded' }] }), false);
  assert.strictEqual(s.isPaying({}), false);
});

test('trial is not paying and the trial has not ended', () => {
  assert.strictEqual(s.classifyClient(base, NOW).trial, true);
  assert.strictEqual(s.classifyClient({ ...base, trial: { isExpired: true } }, NOW).trial, false);
  assert.strictEqual(s.classifyClient({ ...base, payments: [{ status: 'paid' }] }, NOW).trial, false);
});

test('each attention reason fires on its own', () => {
  assert.deepStrictEqual(s.classifyClient({ ...base, credits: { balance: 40 } }, NOW).attention, ['quarks_low']);
  assert.deepStrictEqual(s.classifyClient({ ...base, lastLoginAt: ago(9) }, NOW).attention, ['inactive']);
  assert.deepStrictEqual(s.classifyClient({ ...base, onboardingCompleted: false }, NOW).attention, ['onboarding_unfinished']);
  assert.deepStrictEqual(s.classifyClient({ ...base, connectedSocials: [] }, NOW).attention, ['no_social']);
  assert.deepStrictEqual(s.classifyClient(base, NOW, { oldestDraftAt: ago(5) }).attention, ['drafts_waiting']);
  assert.deepStrictEqual(s.classifyClient(base, NOW, { failedPosts7d: 2 }).attention, ['failed_posts']);
  assert.deepStrictEqual(s.classifyClient(base, NOW, { oldestDraftAt: ago(1) }).attention, []);
});

test('a switched-off account never asks for attention', () => {
  assert.deepStrictEqual(s.classifyClient({ ...base, isActive: false, credits: { balance: 0 } }, NOW).attention, []);
});

test('a provider-connected account counts as connected', () => {
  assert.strictEqual(s.classifyClient({ ...base, connectedSocials: [], ayrshare: { activeSocialAccounts: ['instagram', 'facebook'] } }, NOW).connected, 2);
});

test('access follows the plan rules; accounts without a plan are managed and can use everything', () => {
  assert.strictEqual(s.classifyClient(base, NOW).access.inbox, true);
  const free = s.classifyClient({ ...base, plan: { tier: 'free' } }, NOW);
  assert.strictEqual(free.access.publish, false);
  assert.strictEqual(free.access.video, true);
  const starter = s.classifyClient({ ...base, plan: { tier: 'starter', addons: ['publish'] } }, NOW);
  assert.deepStrictEqual([starter.access.publish, starter.access.inbox], [true, false]);
});

test('filters pick the right clients', () => {
  const c = s.classifyClient({ ...base, assignedCsm: null }, NOW);
  assert.strictEqual(s.matchesFilter('active', base, c), true);
  assert.strictEqual(s.matchesFilter('inactive', base, c), false);
  assert.strictEqual(s.matchesFilter('no_csm', { assignedCsm: null }, c), true);
  assert.strictEqual(s.matchesFilter('no_csm', { assignedCsm: 'x' }, c), false);
  assert.strictEqual(s.matchesFilter('all', base, c), true);
});
