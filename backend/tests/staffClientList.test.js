const test = require('node:test');
const assert = require('node:assert');
const { buildList } = require('../services/staff/clientList');

const NOW = new Date('2026-10-07T12:00:00Z').getTime();
const ago = (d) => new Date(NOW - d * 86400000);
const mk = (id, over = {}) => ({ _id: id, email: `${id}@x.com`, companyName: `Co ${id}`, isActive: true, onboardingCompleted: true, lastLoginAt: ago(1), credits: { balance: 500 }, connectedSocials: [{ platform: 'Instagram' }], ...over });

const users = [
  mk('a', { assignedCsm: 'c1' }),
  mk('b', { lastLoginAt: ago(20), assignedCsm: 'c2' }),
  mk('c', { isActive: false }),
  mk('d', { payments: [{ status: 'paid' }], credits: { balance: 20 } }),
  mk('e', { isHidden: true }),
  { _id: 'staff1', email: 's@x.com', staffRole: 'csm', isCsm: true },
  { _id: 'owner1', email: 'o@x.com', staffRole: 'owner' }
];
const owner = { _id: 'owner1', staffRole: 'owner' };
const csm1 = { _id: 'c1', staffRole: 'csm' };

test('staff accounts and hidden accounts are never in the numbers', () => {
  const r = buildList({ viewer: owner, users, now: NOW });
  assert.strictEqual(r.counts.all, 4);
  assert.strictEqual(r.counts.hidden, 1);
  assert.ok(!r.rows.some((x) => x.id === 'staff1' || x.id === 'owner1' || x.id === 'e'));
});

test('counts for every filter match what each filter returns', () => {
  const r = buildList({ viewer: owner, users, now: NOW });
  for (const f of ['active', 'inactive', 'disabled', 'trial', 'paying', 'attention', 'no_csm']) {
    assert.strictEqual(buildList({ viewer: owner, users, now: NOW, filter: f }).total, r.counts[f], f);
  }
  assert.strictEqual(r.counts.active, 2);
  assert.strictEqual(r.counts.inactive, 1);
  assert.strictEqual(r.counts.disabled, 1);
  assert.strictEqual(r.counts.paying, 1);
});

test('the hidden filter shows hidden accounts and nothing else', () => {
  const r = buildList({ viewer: owner, users, now: NOW, filter: 'hidden' });
  assert.deepStrictEqual(r.rows.map((x) => x.id), ['e']);
});

test('a CSM sees only their own clients, in the rows and in the counts', () => {
  const r = buildList({ viewer: csm1, users, now: NOW });
  assert.deepStrictEqual(r.rows.map((x) => x.id), ['a']);
  assert.strictEqual(r.counts.all, 1);
});

test('search matches name, email, company and phone', () => {
  const u = [mk('a', { mobileNumber: '98765', firstName: 'Priya' }), mk('b')];
  assert.deepStrictEqual(buildList({ viewer: owner, users: u, now: NOW, q: '98765' }).rows.map((x) => x.id), ['a']);
  assert.deepStrictEqual(buildList({ viewer: owner, users: u, now: NOW, q: 'priya' }).rows.map((x) => x.id), ['a']);
  assert.deepStrictEqual(buildList({ viewer: owner, users: u, now: NOW, q: 'co b' }).rows.map((x) => x.id), ['b']);
});

test('sorting and paging', () => {
  const many = Array.from({ length: 30 }, (_, i) => mk(`u${String(i).padStart(2, '0')}`, { credits: { balance: i * 10 } }));
  const first = buildList({ viewer: owner, users: many, now: NOW, sort: 'quarks', dir: 'asc', pageSize: 10 });
  assert.strictEqual(first.pages, 3);
  assert.deepStrictEqual(first.rows.map((x) => x.quarks), [0, 10, 20, 30, 40, 50, 60, 70, 80, 90]);
  assert.strictEqual(buildList({ viewer: owner, users: many, now: NOW, pageSize: 10, page: 99 }).page, 3);
});

test('a row carries the CSM name, platforms and access ticks', () => {
  const r = buildList({ viewer: owner, users, now: NOW, csmNames: { c1: 'Priya' } });
  const a = r.rows.find((x) => x.id === 'a');
  assert.deepStrictEqual([a.csm.name, a.platforms, a.access.publish], ['Priya', ['instagram'], true]);
});

test('loadClientData asks only for customers, scopes a CSM to their clients, and folds activity in', async () => {
  const { loadClientData } = require('../services/staff/clientList');
  const asked = [];
  const User = { find: (q) => { asked.push(q); return { lean: async () => (q.$or ? [{ _id: 'c1', firstName: 'Priya' }] : [{ _id: 'u1', email: 'u@x.com' }]) }; } };
  const FeatureEvent = { aggregate: async () => [{ _id: 'u1', last: new Date('2026-10-06') }] };
  const Draft = { aggregate: async (p) => (p[0].$match.status === 'failed' ? [{ _id: 'u1', n: 2 }] : [{ _id: 'u1', oldest: new Date('2026-10-01') }]) };
  const out = await loadClientData({ viewer: { _id: 'c1', staffRole: 'csm' }, models: { User, FeatureEvent, Draft }, now: new Date('2026-10-07').getTime() });
  assert.strictEqual(asked[0].staffRole, null);
  assert.strictEqual(asked[0].assignedCsm, 'c1');
  assert.deepStrictEqual(Object.keys(out.extras.u1).sort(), ['failedPosts7d', 'lastEventAt', 'oldestDraftAt']);
  assert.strictEqual(out.csmNames.c1, 'Priya');
  const owner = await loadClientData({ viewer: { _id: 'o', staffRole: 'owner' }, models: { User, FeatureEvent, Draft } });
  assert.strictEqual(asked[asked.length - 2].assignedCsm, undefined);
  assert.ok(owner.users.length === 1);
});
