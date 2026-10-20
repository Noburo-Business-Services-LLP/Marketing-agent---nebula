// The background status sync for posts scheduled on Ayrshare (load-test week 1). Every provider call is faked.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { syncPastDueCampaign, runCampaignStatusSyncOnce, startCampaignStatusSync } = require('../services/campaignStatusSync');
const { requireOwnProfileKey } = require('../services/ayrshareGuard');

const NOW = new Date('2026-10-20T10:00:00Z');
const quiet = async (fn) => {
  const l = console.log; const w = console.warn; console.log = () => {}; console.warn = () => {};
  try { return await fn(); } finally { console.log = l; console.warn = w; }
};

function fakeCampaignModel(rows) {
  const byId = new Map(rows.map((r) => [String(r._id), r]));
  const updates = [];
  const matches = (row, f) => Object.entries(f).every(([k, v]) => {
    if (k === '_id') return String(row._id) === String(v);
    return row[k] === v;
  });
  return {
    rows: byId, updates, lastFind: null, lastLimit: null,
    find(q) {
      this.lastFind = q;
      const self = this;
      let list = [...byId.values()].filter((r) => r.status === q.status && r.scheduledFor < q.scheduledFor.$lt && r.socialPostId
        && !(q.userId && q.userId.$nin.map(String).includes(String(r.userId))));
      return {
        select(p) { self.lastSelect = p; return this; },
        sort() { list.sort((a, b) => (a.ayrshareCheckedAt || 0) - (b.ayrshareCheckedAt || 0)); return this; },
        limit(n) { self.lastLimit = n; return Promise.resolve(list.slice(0, n).map((r) => ({ ...r }))); }
      };
    },
    async updateOne(filter, upd) {
      updates.push({ filter, set: upd.$set });
      const row = byId.get(String(filter._id));
      if (!row || !matches(row, filter)) return { modifiedCount: 0 };
      Object.assign(row, upd.$set);
      return { modifiedCount: 1 };
    }
  };
}

const row = (n, extra = {}) => ({
  _id: `c${n}`, userId: 'u1', name: `Post ${n}`, status: 'scheduled', scheduledFor: new Date(NOW - 3600e3),
  socialPostId: `ayr-${n}`, platforms: ['facebook'], ayrshareCheckedAt: null, ...extra
});
const users = {
  u1: { _id: 'u1', plan: { tier: 'starter' }, ayrshare: { profileKey: 'KEY-1' } },
  u2: { _id: 'u2', plan: { tier: 'starter' }, ayrshare: {} }, // self-serve, no profile of its own
  u3: { _id: 'u3', ayrshare: {} } // managed: the master profile, as before
};
const fakeUser = { findById: (id) => ({ select: async () => users[id] || null }) };
const fakeLease = (free = true) => ({ claims: 0, released: 0, async claim() { this.claims++; return free ? { value: 'x' } : null; }, async release() { this.released++; } });

function deps(Campaign, statusFor, extra = {}) {
  const calls = [];
  return {
    calls,
    deps: {
      Campaign,
      getPostStatus: async (id, opts) => { calls.push({ id, profileKey: opts.profileKey }); return statusFor(id); },
      retryAyrsharePost: async () => ({ success: false }),
      publishCampaignToSocial: async () => { throw new Error('must not re-post here'); },
      classifyInstagramPublishFailure: () => null,
      extractFacebookPostIdFromAyrsharePayload: () => '',
      markLinkedDraftPosted: async (c) => { calls.push({ draft: c._id }); },
      ...extra
    }
  };
}

test('posted on Ayrshare: the campaign becomes posted and its Draft published (the scheduler rule)', async () => {
  const C = fakeCampaignModel([row(1)]);
  const d = deps(C, () => ({ success: true, data: { status: 'success' } }));
  const r = await quiet(() => syncPastDueCampaign({ ...C.rows.get('c1') }, { profileKey: 'KEY-1', now: NOW, deps: d.deps }));
  assert.strictEqual(r, 'posted');
  assert.strictEqual(C.rows.get('c1').status, 'posted');
  assert.deepStrictEqual(d.calls.find((c) => c.draft), { draft: 'c1' });
});

test('error on Ayrshare: back to draft with the reason; pending: nothing changes; a failed check changes nothing', async () => {
  const C = fakeCampaignModel([row(1), row(2), row(3)]);
  const d = deps(C, (id) => {
    if (id === 'ayr-1') return { success: true, data: { status: 'error', message: 'Token expired' } };
    if (id === 'ayr-2') return { success: true, data: { status: 'scheduled' } };
    throw new Error('network down');
  });
  assert.strictEqual(await quiet(() => syncPastDueCampaign({ ...C.rows.get('c1') }, { now: NOW, deps: d.deps })), 'draft');
  assert.strictEqual(C.rows.get('c1').status, 'draft');
  assert.strictEqual(C.rows.get('c1').lastPublishError, 'Token expired');
  assert.strictEqual(await quiet(() => syncPastDueCampaign({ ...C.rows.get('c2') }, { now: NOW, deps: d.deps })), 'pending');
  assert.strictEqual(await quiet(() => syncPastDueCampaign({ ...C.rows.get('c3') }, { now: NOW, deps: d.deps })), 'error');
  assert.strictEqual(C.rows.get('c2').status, 'scheduled');
  assert.strictEqual(C.rows.get('c3').status, 'scheduled');
});

test('a row the scheduler or the person changed meanwhile is left alone (conditional write)', async () => {
  const C = fakeCampaignModel([row(1)]);
  const d = deps(C, () => { C.rows.get('c1').status = 'posted'; C.rows.get('c1').publishedAt = 'by scheduler'; return { success: true, data: { status: 'error', message: 'x' } }; });
  const r = await quiet(() => syncPastDueCampaign({ ...C.rows.get('c1'), status: 'scheduled' }, { now: NOW, deps: d.deps }));
  assert.strictEqual(r, 'changed');
  assert.strictEqual(C.rows.get('c1').status, 'posted');
  assert.strictEqual(C.rows.get('c1').publishedAt, 'by scheduler');
  assert.ok(C.updates.every((u) => u.filter.status === 'scheduled' && u.filter.socialPostId === 'ayr-1'));
});

test('one run: lease, bounded batch, least recently checked first, own key per account, never the master profile for a self-serve account', async () => {
  const rows = [];
  for (let i = 1; i <= 8; i++) rows.push(row(i, { ayrshareCheckedAt: new Date(NOW - i * 1000) }));
  rows.push(row(20, { userId: 'u2' }), row(30, { userId: 'u3' }), row(40, { userId: 'u9' }));
  const C = fakeCampaignModel(rows);
  const d = deps(C, () => ({ success: true, data: { status: 'scheduled' } }));
  const lease = fakeLease();
  const out = await quiet(() => runCampaignStatusSyncOnce({ deps: d.deps, User: fakeUser, lease, blockedIds: async () => [], requireOwnProfileKey, now: () => NOW, batch: 6, log: { log() {} } }));
  assert.strictEqual(C.lastLimit, 6);
  assert.strictEqual(out.checked + out.skippedNoProfile, 6);
  assert.strictEqual(lease.claims, 1);
  assert.strictEqual(lease.released, 1);
  // The never-checked rows (u2, u3, u9) come first, then the oldest checks.
  const statusCalls = d.calls.filter((c) => c.id);
  assert.ok(!statusCalls.some((c) => c.id === 'ayr-20'), 'no profile of its own: never asked');
  assert.ok(!statusCalls.some((c) => c.id === 'ayr-40'), 'unknown account: never asked');
  assert.strictEqual(statusCalls.find((c) => c.id === 'ayr-30').profileKey, undefined, 'managed account: master profile as before');
  assert.ok(statusCalls.filter((c) => /^ayr-[1-8]$/.test(c.id)).every((c) => c.profileKey === 'KEY-1'));
  assert.strictEqual(out.skippedNoProfile, 2);
  // Every looked-at row is stamped, so the next run looks at other rows first.
  assert.strictEqual(C.updates.filter((u) => u.set.ayrshareCheckedAt === NOW).length, 6);
  const before = d.calls.length;
  await quiet(() => runCampaignStatusSyncOnce({ deps: d.deps, User: fakeUser, lease: fakeLease(), blockedIds: async () => [], requireOwnProfileKey, now: () => new Date(+NOW + 1), batch: 5, log: { log() {} } }));
  assert.deepStrictEqual(d.calls.slice(before).map((c) => c.id).sort(), ['ayr-1', 'ayr-2', 'ayr-3', 'ayr-4', 'ayr-5']);
});

test('another server holds the lease: nothing is read or asked; paused accounts are skipped', async () => {
  const C = fakeCampaignModel([row(1), row(2, { userId: 'u3' })]);
  const d = deps(C, () => ({ success: true, data: { status: 'success' } }));
  const busy = await quiet(() => runCampaignStatusSyncOnce({ deps: d.deps, User: fakeUser, lease: fakeLease(false), blockedIds: async () => [], requireOwnProfileKey, now: () => NOW }));
  assert.strictEqual(busy.skippedRun, true);
  assert.strictEqual(C.lastFind, null);
  assert.strictEqual(d.calls.length, 0);
  await quiet(() => runCampaignStatusSyncOnce({ deps: d.deps, User: fakeUser, lease: fakeLease(), blockedIds: async () => ['u1'], requireOwnProfileKey, now: () => NOW, log: { log() {} } }));
  assert.deepStrictEqual(d.calls.filter((c) => c.id).map((c) => c.id), ['ayr-2']);
});

test('switch: ENABLE_CAMPAIGN_STATUS_SYNC=off starts nothing; otherwise a timer is set', () => {
  assert.strictEqual(startCampaignStatusSync({ env: { ENABLE_CAMPAIGN_STATUS_SYNC: 'off' } }), null);
  assert.strictEqual(startCampaignStatusSync({ env: { ENABLE_CAMPAIGN_STATUS_SYNC: ' OFF ' } }), null);
  const t = startCampaignStatusSync({ env: {}, run: async () => {} });
  assert.ok(t);
  clearInterval(t);
});

test('GET /api/campaigns only reads: no Ayrshare call, no write in the list handler', () => {
  const src = fs.readFileSync(path.join(__dirname, '../routes/campaigns.js'), 'utf8');
  const start = src.indexOf("router.get('/', protect");
  const end = src.indexOf('router.get(', start + 10);
  const handler = src.slice(start, end);
  assert.ok(start > 0 && handler.length > 100);
  assert.doesNotMatch(handler, /getPostStatus|retryAyrsharePost|publishCampaignToSocial|findByIdAndUpdate|updateOne|updateMany|\.save\(/);
  const server = fs.readFileSync(path.join(__dirname, '../server-main.js'), 'utf8');
  assert.match(server, /require\('\.\/services\/campaignStatusSync'\)\.startCampaignStatusSync\(\)/);
});
