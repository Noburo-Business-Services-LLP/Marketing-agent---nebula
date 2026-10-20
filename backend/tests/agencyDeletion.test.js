// backend/tests/agencyDeletion.test.js
// Removing a client, deleting an agency with its clients, and keeping client workspaces out of staff numbers and schedulers.
const test = require('node:test');
const assert = require('node:assert');
const d = require('../services/accountDeletion');
const w = require('../services/agencyWorkspaces');
const ag = require('../services/agency');
const { erasable, filterFor, ruleFor } = require('../services/dataRegistry');

const DAY = 86400000;
const NOW = new Date('2026-10-16T06:00:00Z');
const REFUSAL = /Wait until this client's videos and jobs finish, then try again/;


// The purge query: pending or failed requests that are due, plus "running" ones whose claim is older than the cutoff.
const dueFilter = (q, x) => x.purgeAfter <= q.purgeAfter.$lte && x.attempts < q.attempts.$lt && q.$or.some((c) => (c.status.$in ? c.status.$in.includes(x.status) : (x.status === c.status && x.runningSince && x.runningSince < c.$or[0].runningSince.$lt)));
const claimMatch = (f, y) => y._id === f._id && (f.status.$in ? f.status.$in.includes(y.status) : (y.status === f.status && (f.runningSince == null ? y.runningSince == null : +y.runningSince === +f.runningSince)));

// ---- a small in-memory world: one agency, two clients, one ordinary customer
const match = (doc, f) => {
  if (f.$or && !f.$or.some((x) => match(doc, x))) return false;
  return Object.entries(f).filter(([k]) => k !== '$or').every(([k, v]) => {
    const have = k.split('.').reduce((c, p) => (c == null ? c : c[p]), doc);
    if (v && typeof v === 'object' && '$in' in v) return v.$in.map(String).includes(String(have));
    if (v && typeof v === 'object' && '$ne' in v) return String(have) !== String(v.$ne);
    if (v && typeof v === 'object' && '$gt' in v) return Number(have) > v.$gt;
    if (v && typeof v === 'object' && '$lt' in v) return have != null && +have < +v.$lt;
    return String(have) === String(v);
  });
};
const apply = (doc, u) => {
  for (const [k, v] of Object.entries(u.$set || {})) { const ps = k.split('.'); let c = doc; ps.slice(0, -1).forEach((p) => { c[p] = c[p] || {}; c = c[p]; }); c[ps.at(-1)] = v; }
  for (const [k, v] of Object.entries(u.$inc || {})) { const ps = k.split('.'); let c = doc; ps.slice(0, -1).forEach((p) => { c[p] = c[p] || {}; c = c[p]; }); c[ps.at(-1)] = (c[ps.at(-1)] || 0) + v; }
  if (u.$push) for (const [k, v] of Object.entries(u.$push)) (doc[k] = doc[k] || []).push(v);
  for (const k of Object.keys(u.$unset || {})) { const ps = k.split('.'); let c = doc; ps.slice(0, -1).forEach((p) => { c = c && c[p]; }); if (c) delete c[ps.at(-1)]; }
};

function world(over = {}) {
  const x = {
    users: [
      { _id: 'o1', email: 'boss@agency.example', firstName: 'Boss', plan: { tier: 'agency', subscriptions: [{ subscriptionId: 'sub_agency', kind: 'plan', key: 'agency', active: true }, { subscriptionId: 'sub_slot1', kind: 'slot', key: 'slot', active: true }] }, agency: { clientCount: 2, extraSlots: 1 }, payments: [{ razorpayPaymentId: 'pay_ag', amount: 8258.82, item: 'Agency', paidAt: new Date('2026-10-01') }], ...over.owner },
      { _id: 'w1', email: 'ws-w1@workspace.invalid', firstName: 'Sweet', agency: { ownerId: 'o1', workspaceName: 'Sweet' }, ayrshare: { profileKey: 'PK-W1' }, createdAt: new Date('2026-09-01'), ...over.w1 },
      { _id: 'w2', email: 'ws-w2@workspace.invalid', firstName: 'Tea', agency: { ownerId: 'o1', workspaceName: 'Tea' }, createdAt: new Date('2026-09-02') },
      { _id: 'u9', email: 'asha@example.com', firstName: 'Asha', plan: { tier: 'starter' }, agency: {} }
    ],
    ledger: [{ _id: 'l1', user: 'o1', workspace: 'w1', quarks: -5 }, { _id: 'l2', user: 'o1', workspace: 'w2', quarks: -3 }, { _id: 'l3', user: 'o1', quarks: 100 }],
    campaigns: [{ _id: 'c1', userId: 'w1', status: 'scheduled' }, { _id: 'c2', userId: 'o1', status: 'scheduled' }, { _id: 'c3', userId: 'u9', status: 'scheduled' }],
    docs: { Draft: [{ _id: 'd1', userId: 'w1', image: 'https://res.cloudinary.com/x/image/upload/v1/nebula-campaign-posts/w1.jpg' }, { _id: 'd2', userId: 'w2' }, { _id: 'd3', userId: 'u9' }] },
    running: {}, // model name -> true when that collection holds running work for w1
    deletions: [], retained: [], tombstones: [], staff: [{ client: 'o1' }], deletedFiles: [], social: [], mails: [], log: []
  };
  const q = (list) => ({ sort: () => q(list), select: () => q(list), lean: async () => list, then: (a, b) => Promise.resolve(list).then(a, b) });
  const models = {
    User: {
      find: (f) => q(x.users.filter((u) => match(u, f))),
      findById: (id) => ({ select: () => ({ lean: async () => x.users.find((u) => u._id === id) || null }) }),
      updateOne: async (f, u) => { const t = x.users.find((y) => match(y, f)); if (t) apply(t, u); x.log.push(['user.updateOne', f, u]); return { modifiedCount: t ? 1 : 0 }; },
      deleteOne: async (f) => { x.users = x.users.filter((y) => !match(y, f)); x.log.push(['user.deleteOne', f._id]); }
    },
    Campaign: { updateMany: async (f, u) => { x.campaigns.filter((c) => (f.userId && f.userId.$in ? f.userId.$in.includes(c.userId) : c.userId === f.userId) && (f.status === undefined || c.status === f.status) && (f.pausedForDeletion === undefined || c.pausedForDeletion === f.pausedForDeletion)).forEach((c) => apply(c, u)); } },
    AccountDeletion: {
      create: async (doc) => { const r = { _id: `r${x.deletions.length + 1}`, attempts: 0, steps: [], ...doc }; x.deletions.push(r); return r; },
      updateOne: async (f, u) => { const r = x.deletions.find((y) => y._id === f._id); if (r) apply(r, u); },
      updateMany: async () => {},
      find: (qq) => ({ limit: () => ({ lean: async () => x.deletions.filter((r) => dueFilter(qq, r)).map((r) => structuredClone(r)) }) }),
      findOneAndUpdate: async (f, u) => { const r = x.deletions.find((y) => claimMatch(f, y)); if (!r) return null; apply(r, u); return r; }
    },
    RetainedPayment: { updateOne: async (f, u) => { if (!x.retained.some((r) => r.razorpayPaymentId === f.razorpayPaymentId)) x.retained.push(u.$setOnInsert); } },
    DeletedAccount: { updateOne: async (f, u) => { x.tombstones.push(u.$setOnInsert); } },
    StaffAction: { updateMany: async () => {} }
  };
  for (const r of erasable()) {
    const name = r.model;
    const list = () => (name === 'QuarkLedger' ? x.ledger : name === 'Campaign' ? x.campaigns : (x.docs[name] || []));
    const set = (v) => { if (name === 'QuarkLedger') x.ledger = v; else if (name === 'Campaign') x.campaigns = v; else x.docs[name] = v; };
    models[name] = { ...(models[name] || {}),
      find: (f) => ({ lean: () => ({ cursor: async function* () { for (const y of list().filter((z) => match(z, f))) yield y; } }) }),
      deleteMany: async (f) => { const before = list().length; set(list().filter((z) => !match(z, f))); return { deletedCount: before - list().length }; },
      exists: async () => !!x.running[name]
    };
  }
  const razorpay = { calls: [], subscriptions: { cancel: async (id, atEnd) => { razorpay.calls.push([id, atEnd]); } } };
  const deps = {
    deleteAssets: async (a) => { x.deletedFiles.push(...a); return { requested: a.length, failedBatches: 0 }; },
    deleteSocialProfile: async (k) => { x.social.push(k); return { success: true }; },
    mail: { sendDeleted: async (u) => x.mails.push(['deleted', u.email]) }
  };
  return { x, models, razorpay, deps };
}
const owner = (x) => x.users.find((u) => u._id === 'o1');

// ---- eligibility and steps
test('a client account cannot be deleted through the account page', () => {
  const e = d.eligibility({ agency: { ownerId: 'o1' }, plan: { tier: 'agency' } }, { isStaff: () => false, resolveTier: () => 'agency' });
  assert.strictEqual(e.ok, false);
  assert.match(e.message, /agency account/);
});

test('an agency may delete its own account, and is told how many clients go with it', () => {
  const e = d.eligibility({ plan: { tier: 'agency' }, agency: { clientCount: 3 } }, { isStaff: () => false, resolveTier: () => 'agency' });
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.clients, 3);
  assert.strictEqual(d.eligibility({ plan: { tier: 'starter' } }, { resolveTier: () => 'starter' }).clients, undefined);
});

test('deleting an agency erases its clients first, then itself', () => {
  const { x, models, deps } = world();
  const names = d.stepsFor({ user: owner(x), models, deps, now: NOW }).map((s) => s.name);
  assert.ok(names.indexOf('clients') >= 0 && names.indexOf('clients') < names.indexOf('files') && names.indexOf('files') < names.indexOf('data') && names.indexOf('data') < names.indexOf('account'), names.join(','));
});

test('an agency whose plan has ended still erases its clients, and an ordinary account has no clients step', () => {
  const { x, models, deps } = world();
  const lapsed = { ...owner(x), plan: { tier: 'free' } };
  assert.ok(d.stepsFor({ user: lapsed, models, deps, now: NOW }).some((s) => s.name === 'clients'));
  const plain = d.stepsFor({ user: x.users.find((u) => u._id === 'u9'), models, deps, now: NOW }).map((s) => s.name);
  assert.deepStrictEqual(plain, ['keep_payment_records', 'files', 'social_profile', 'data', 'staff_log', 'tombstone', 'account']);
});

// ---- the 14-day flow for an agency
test('asking to delete an agency stops the agency plan and every slot at once and holds its clients\' scheduled posts', async () => {
  const { x, models, razorpay } = world();
  const out = await d.requestDeletion({ user: owner(x), models, razorpay, now: NOW, mail: { sendDeletionRequested: async () => {} } });
  assert.strictEqual(out.ok, true);
  assert.deepStrictEqual(razorpay.calls, [['sub_agency', 0], ['sub_slot1', 0]], 'plan and slot cancelled immediately');
  assert.deepStrictEqual(x.campaigns.map((c) => c.status), ['paused', 'paused', 'scheduled'], 'client and agency posts held; an unrelated customer is untouched');
  const back = await d.restoreDeletion({ user: owner(x), models });
  assert.strictEqual(back.ok, true);
  assert.deepStrictEqual(x.campaigns.map((c) => c.status), ['scheduled', 'scheduled', 'scheduled'], 'restoring puts the clients\' posts back too');
});

test('the purge erases the clients (files, connected accounts, data) and then the agency, and keeps only the agency\'s payment records', async () => {
  const { x, models, razorpay, deps } = world();
  await d.requestDeletion({ user: owner(x), models, razorpay, now: NOW, mail: { sendDeletionRequested: async () => {} } });
  const out = await d.runPurgeOnce({ models, deps, now: new Date(NOW.getTime() + 15 * DAY) });
  assert.deepStrictEqual(out, { completed: 1, failed: 0 });
  assert.deepStrictEqual(x.users.map((u) => u._id), ['u9'], 'both clients and the agency are gone; the other customer stays');
  assert.deepStrictEqual(x.social, ['PK-W1'], 'the client\'s connected accounts profile was deleted');
  assert.ok(x.deletedFiles.some((a) => a.publicId === 'nebula-campaign-posts/w1'), 'the client\'s files were deleted');
  assert.deepStrictEqual(x.docs.Draft.map((r) => r._id), ['d3'], 'only the other customer\'s data remains');
  assert.deepStrictEqual(x.retained.map((r) => r.razorpayPaymentId), ['pay_ag']);
  assert.strictEqual(x.tombstones.length, 1, 'one tombstone, for the agency only');
  assert.deepStrictEqual(x.mails, [['deleted', 'boss@agency.example']], 'no email is ever sent to a client workspace');
  assert.strictEqual(x.ledger.length, 0, 'the agency\'s own ledger goes with the agency');
  assert.strictEqual(x.deletions[0].steps.find((s) => s.name === 'clients').detail, '2 clients erased');
});

test('if one client cannot be erased the agency stays, the failure is recorded, and the next run finishes without erasing a client twice', async () => {
  const { x, models, razorpay, deps } = world();
  await d.requestDeletion({ user: owner(x), models, razorpay, now: NOW, mail: { sendDeletionRequested: async () => {} } });
  let fail = true;
  const real = deps.deleteSocialProfile;
  deps.deleteSocialProfile = async (k) => (fail ? { success: false, error: 'boom' } : real(k));
  const later = new Date(NOW.getTime() + 15 * DAY);
  const alerts = [];
  assert.deepStrictEqual(await d.runPurgeOnce({ models, deps, now: later, alert: (m) => alerts.push(m) }), { completed: 0, failed: 1 });
  assert.ok(x.users.some((u) => u._id === 'o1'), 'the agency is not deleted while a client remains');
  assert.match(alerts.join(' '), /stopped at "clients"/);
  fail = false;
  assert.deepStrictEqual(await d.runPurgeOnce({ models, deps, now: later }), { completed: 1, failed: 0 });
  assert.deepStrictEqual(x.users.map((u) => u._id), ['u9']);
});

// ---- removing a single client
test('removing a client erases it at once, releases the slot and sends no email', async () => {
  const calls = [];
  const out = await w.removeWorkspace({
    owner: { _id: 'o1', plan: { tier: 'agency' } }, workspaceId: 'w1',
    models: { User: { find: () => ({ sort: () => ({ lean: async () => [{ _id: 'w1', agency: { ownerId: 'o1', workspaceName: 'Sweet' } }] }) }), updateOne: async (f, u) => { calls.push(['update', u]); return { modifiedCount: 1 }; } } },
    isBusy: async () => [],
    purge: async (id) => { calls.push(['purged', id]); return { ok: true }; }
  });
  assert.strictEqual(out.ok, true);
  assert.deepStrictEqual(calls.find((c) => c[0] === 'purged'), ['purged', 'w1']);
  assert.deepStrictEqual(calls[calls.length - 1][1], { $inc: { 'agency.clientCount': -1 } });
});

test('removing a client that belongs to someone else does nothing', async () => {
  const out = await w.removeWorkspace({ owner: { _id: 'o1' }, workspaceId: 'w9', models: { User: { find: () => ({ sort: () => ({ lean: async () => [] }) }) } }, isBusy: async () => [], purge: async () => { throw new Error('must not run'); } });
  assert.strictEqual(out.ok, false);
});

test('removal is refused while the client has running work, nothing is erased, the slot stays and the client is usable again', async () => {
  const { x, models, deps } = world();
  let purged = 0;
  const out = await w.removeWorkspace({ owner: owner(x), workspaceId: 'w1', models, isBusy: async () => ['video jobs'], purge: async () => { purged += 1; return { ok: true }; } });
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.busy, true);
  assert.match(out.message, REFUSAL);
  assert.strictEqual(purged, 0);
  assert.strictEqual(owner(x).agency.clientCount, 2, 'the slot is not released');
  assert.ok(!x.users.find((u) => u._id === 'w1').agency.frozen, 'the client is not left paused');
});

test('every kind of running work blocks a removal, and finished work does not', async () => {
  const kinds = ['VideoJob', 'HeroVideoJob', 'Blueprint', 'StudioVideo', 'Draft', 'Campaign', 'SocialPostAttempt'];
  for (const k of kinds) {
    const { x, models } = world();
    models.SocialPostAttempt = models.SocialPostAttempt || { exists: async () => !!x.running.SocialPostAttempt };
    models.Blueprint = models.Blueprint || { exists: async () => !!x.running.Blueprint };
    x.running[k] = true;
    const busy = await w.runningWork('w1', models, NOW.getTime());
    assert.ok(busy.length === 1, `${k}: ${JSON.stringify(busy)}`);
  }
  const { x, models } = world();
  assert.deepStrictEqual(await w.runningWork('w1', models, NOW.getTime()), []);
});

test('the running-work check looks at the right states of each collection for this client only', async () => {
  const asked = {};
  const models = {};
  for (const k of ['VideoJob', 'HeroVideoJob', 'Blueprint', 'StudioVideo', 'Draft', 'Campaign', 'SocialPostAttempt']) models[k] = { exists: async (f) => { asked[k] = f; return false; } };
  await w.runningWork('w1', models, NOW.getTime());
  assert.deepStrictEqual(asked.VideoJob, { userId: 'w1', status: { $in: ['queued', 'processing'] } });
  assert.deepStrictEqual(asked.HeroVideoJob, { userId: 'w1', status: { $in: ['queued', 'processing'] } });
  assert.deepStrictEqual(asked.StudioVideo, { user: 'w1', status: { $in: ['queued', 'processing'] } }); // queued = charged, waiting for a consumer (E9 B1)
  assert.deepStrictEqual(asked.Draft, { userId: 'w1', status: 'processing' });
  assert.deepStrictEqual(asked.Blueprint.$or, [{ status: { $in: ['queued', 'processing'] } }, { 'designed.status': { $in: ['queued', 'processing'] } }]);
  assert.strictEqual(asked.Blueprint.userId, 'w1');
  assert.strictEqual(asked.Campaign.userId, 'w1'); assert.strictEqual(asked.Campaign.status, 'scheduled');
  assert.ok(asked.Campaign['scheduling.startDate'].$lte instanceof Date && +asked.Campaign['scheduling.startDate'].$lte > NOW.getTime());
  assert.strictEqual(asked.SocialPostAttempt.status, 'queued');
});

test('a successful removal erases the client\'s data, files and connected accounts, and leaves the agency and the other client alone', async () => {
  const { x, models, deps } = world();
  const out = await w.removeWorkspace({ owner: owner(x), workspaceId: 'w1', models, isBusy: async () => [], purge: (id) => d.purgeWorkspace(id, { models, deps, now: NOW }) });
  assert.strictEqual(out.ok, true);
  assert.deepStrictEqual(x.users.map((u) => u._id), ['o1', 'w2', 'u9']);
  assert.deepStrictEqual(x.docs.Draft.map((r) => r._id), ['d2', 'd3']);
  assert.deepStrictEqual(x.social, ['PK-W1']);
  assert.ok(x.deletedFiles.some((a) => a.publicId === 'nebula-campaign-posts/w1'));
  assert.strictEqual(owner(x).agency.clientCount, 1, 'the count goes down by one');
  assert.strictEqual(owner(x).agency.extraSlots, 1, 'the paid slot stays; only the count changes');
  assert.deepStrictEqual(x.mails, [], 'no email');
  assert.deepStrictEqual(x.retained, []); assert.deepStrictEqual(x.tombstones, []);
});

test('removing a client keeps the agency\'s ledger rows tagged with that client (usage history)', async () => {
  const { x, models, deps } = world();
  await w.removeWorkspace({ owner: owner(x), workspaceId: 'w1', models, isBusy: async () => [], purge: (id) => d.purgeWorkspace(id, { models, deps, now: NOW }) });
  assert.deepStrictEqual(x.ledger.map((r) => r._id), ['l1', 'l2', 'l3'], 'rows with workspace = w1 are still there');
  assert.strictEqual(x.ledger.find((r) => r._id === 'l1').workspace, 'w1');
});

test('the data list finds ledger rows by their account only, never by the client tag (this is what keeps usage history)', () => {
  const rule = ruleFor('QuarkLedger');
  assert.strictEqual(rule.field, 'user');
  assert.strictEqual(rule.also, undefined);
  assert.deepStrictEqual(filterFor(rule, 'w1'), { user: 'w1' });
});

test('a purge of a single client refuses an ordinary account and an agency', async () => {
  const { x, models, deps } = world();
  assert.strictEqual((await d.purgeWorkspace('u9', { models, deps, now: NOW })).ok, false);
  assert.strictEqual((await d.purgeWorkspace('o1', { models, deps, now: NOW })).ok, false);
  assert.strictEqual(x.users.length, 4);
  assert.strictEqual((await d.purgeWorkspace('nobody', { models, deps, now: NOW })).ok, true, 'already gone counts as done');
});

test('a client that cannot be fully erased stays in place, the slot is kept and the agency is told to try again', async () => {
  const { x, models, deps } = world();
  deps.deleteSocialProfile = async () => ({ success: false, error: 'boom' });
  const out = await w.removeWorkspace({ owner: owner(x), workspaceId: 'w1', models, isBusy: async () => [], purge: (id) => d.purgeWorkspace(id, { models, deps, now: NOW }) });
  assert.strictEqual(out.ok, false);
  assert.match(out.message, /Nothing else was changed/);
  assert.ok(x.users.some((u) => u._id === 'w1'));
  assert.strictEqual(owner(x).agency.clientCount, 2);
});

test('a removal that sees a running job after pausing the client puts the client back (no race with a job that starts at the same moment)', async () => {
  const { x, models } = world();
  const order = [];
  const real = models.User.updateOne;
  models.User.updateOne = async (f, u) => { order.push(JSON.stringify(u)); return real(f, u); };
  const out = await w.removeWorkspace({ owner: owner(x), workspaceId: 'w1', models, isBusy: async () => { order.push('check'); return ['Hero videos']; }, purge: async () => ({ ok: true }) });
  assert.strictEqual(out.ok, false);
  assert.match(order[0], /"agency\.frozen":true/, 'the client is paused before the check');
  assert.strictEqual(order[1], 'check');
  assert.match(order[2], /"agency\.frozen":false/, 'and put back if the check fails');
});

// ---- who counts as a customer
test('a new client workspace is a hidden account', async () => {
  const created = [];
  const User = { findOneAndUpdate: async () => ({ _id: 'o1' }), create: async (doc) => { created.push(doc); return { _id: 'w1', ...doc }; } };
  await w.createWorkspace({ owner: { _id: 'o1', plan: { tier: 'agency' } }, name: 'Sweet', models: { User } });
  assert.strictEqual(created[0].isHidden, true);
});

test('the staff client list, money and usage never read client workspaces', async () => {
  const asked = [];
  const User = { find: (q) => { asked.push(q); return { lean: async () => [] }; }, countDocuments: async () => 0 };
  await require('../services/staff/clientList').loadClientData({ viewer: { _id: 'o', staffRole: 'owner' }, models: { User, FeatureEvent: { aggregate: async () => [] }, Draft: { aggregate: async () => [] } } });
  await require('../services/staff/money').loadMoneyData({ models: { User } });
  const models = { User }; for (const k of ['Draft', 'Campaign', 'VideoJob', 'HeroVideoJob', 'Blueprint', 'SocialInboxMessage']) models[k] = { aggregate: async () => [], find: () => ({ lean: async () => [] }), countDocuments: async () => 0, distinct: async () => [] };
  await require('../services/staff/usage').loadUsageData({ models }).catch(() => {});
  const customerReads = asked.filter((q) => q && q.staffRole === null);
  assert.ok(customerReads.length >= 3, `expected three customer reads, saw ${customerReads.length}`);
  for (const q of customerReads) assert.strictEqual(q['agency.ownerId'], null, JSON.stringify(q));
});

test('staff bulk changes cannot reach a client workspace', () => {
  const src = require('fs').readFileSync(require.resolve('../routes/staff.js'), 'utf8');
  const hits = src.match(/updateMany\(\{ _id: \{ \$in: ids \}, staffRole: null, isCsm: \{ \$ne: true \}[^}]*\}/g) || [];
  assert.strictEqual(hits.length, 2);
  for (const h of hits) assert.match(h, /'agency\.ownerId': null/);
});

test('renewal reminders and the billing run pick only paying or managed accounts, never a workspace', async () => {
  const rr = require('../services/renewalReminders');
  let asked;
  await rr.runRenewalRemindersOnce({ now: NOW.getTime(), deps: { User: { find: (q) => { asked = q; return { select: () => ({ limit: () => ({ lean: async () => [] }) }) }; } }, transport: async () => ({}), env: {}, logger: { log() {}, error() {} } } });
  assert.strictEqual(asked['subscription.status'], 'active', 'a workspace has no subscription');
  assert.strictEqual(asked['agency.ownerId'], null, 'and is excluded by name as well');
  const bs = require('fs').readFileSync(require.resolve('../services/billingScheduler.js'), 'utf8');
  assert.match(bs, /'plan\.tier': 'managed'/);
  assert.match(bs, /'agency\.ownerId': null/);
});

test('wording: no exclamation marks, em dashes, credit or trial in the new customer messages', () => {
  const src = ['../services/agencyWorkspaces', '../routes/agency', '../services/accountDeletion'].map((f) => require('fs').readFileSync(require.resolve(f), 'utf8')).join('\n');
  for (const m of src.match(/(message|note): '[^']*'/g) || []) assert.doesNotMatch(m, /[!—]|credit|trial/i, m);
  assert.doesNotMatch(src.match(/WORKSPACE_BUSY[^;]*;/)[0], /[!—]|credit|trial/i);
});

test('DELETE on a client is among the things blocked from inside a client', () => {
  assert.strictEqual(w.isBlockedInsideClient('/api/agency/clients/w1', 'DELETE'), true);
});

test('agency rules: the filter that keeps workspaces out is the same shape everywhere', () => {
  assert.deepStrictEqual(ag.NOT_A_WORKSPACE, { 'agency.ownerId': null });
});

// ================================================================ final review fixes
test('B-I2: two removals of the same client at once erase it once and release the slot once', async () => {
  const { x, models, deps } = world();
  let purges = 0;
  const go = () => w.removeWorkspace({
    owner: owner(x), workspaceId: 'w1', models,
    isBusy: async () => { await new Promise((r) => setImmediate(r)); return []; },
    purge: async (id) => { purges += 1; await new Promise((r) => setImmediate(r)); return d.purgeWorkspace(id, { models, deps, now: NOW }); }
  });
  const [a, b] = await Promise.all([go(), go()]);
  assert.deepStrictEqual([a.ok, b.ok].sort(), [false, true]);
  assert.match([a, b].find((r) => !r.ok).message, /already being removed/);
  assert.strictEqual(purges, 1);
  assert.strictEqual(owner(x).agency.clientCount, 1, '2 clients, one removed: 1 left, not 0');
});

test('B-I2: a slot is never released below zero, and a failed removal gives the claim back so it can be tried again', async () => {
  const { x, models, deps } = world({ owner: { agency: { clientCount: 0, extraSlots: 0 } } });
  await w.releaseSlot(models.User, 'o1');
  assert.strictEqual(owner(x).agency.clientCount, 0);
  deps.deleteSocialProfile = async () => ({ success: false, error: 'boom' });
  const out = await w.removeWorkspace({ owner: owner(x), workspaceId: 'w1', models, isBusy: async () => [], purge: (id) => d.purgeWorkspace(id, { models, deps, now: NOW }) });
  assert.strictEqual(out.ok, false);
  assert.ok(!x.users.find((u) => u._id === 'w1').agency.removing, 'the claim is cleared');
  deps.deleteSocialProfile = async () => ({ success: true });
  const again = await w.removeWorkspace({ owner: owner(x), workspaceId: 'w1', models, isBusy: async () => [], purge: (id) => d.purgeWorkspace(id, { models, deps, now: NOW }) });
  assert.strictEqual(again.ok, true);
});

test('B-I2: deleting an agency erases its clients even when the stored client count has drifted to zero', async () => {
  const { x, models, razorpay, deps } = world({ owner: { plan: { tier: 'free', subscriptions: [] }, agency: { clientCount: 0, extraSlots: 0 } } });
  assert.strictEqual(d.ownsClients(owner(x), 2), true, 'the real count decides');
  assert.strictEqual(d.ownsClients(owner(x), 0), false);
  assert.strictEqual(d.ownsClients(owner(x)), false, 'only without a real count does the stored one stand in');
  await d.requestDeletion({ user: owner(x), models, razorpay, now: NOW, mail: { sendDeletionRequested: async () => {} } });
  assert.deepStrictEqual(x.campaigns.map((c) => c.status), ['paused', 'paused', 'scheduled'], 'the clients\' posts were held');
  const out = await d.runPurgeOnce({ models, deps, now: new Date(NOW.getTime() + 15 * DAY) });
  assert.deepStrictEqual(out, { completed: 1, failed: 0 });
  assert.deepStrictEqual(x.users.map((u) => u._id), ['u9'], 'no client is left behind');
});

test('B-I4: two purge runs at once erase an account once and send one "deleted" email', async () => {
  const { x, models, razorpay, deps } = world();
  await d.requestDeletion({ user: owner(x), models, razorpay, now: NOW, mail: { sendDeletionRequested: async () => {} } });
  const later = new Date(NOW.getTime() + 15 * DAY);
  const [a, b] = await Promise.all([d.runPurgeOnce({ models, deps, now: later }), d.runPurgeOnce({ models, deps, now: later })]);
  assert.strictEqual(a.completed + b.completed, 1);
  assert.deepStrictEqual(x.mails, [['deleted', 'boss@agency.example']]);
});

test('B-I4: a purge left "running" by a crash is picked up after 30 minutes, not before', async () => {
  const { x, models, razorpay, deps } = world();
  await d.requestDeletion({ user: owner(x), models, razorpay, now: NOW, mail: { sendDeletionRequested: async () => {} } });
  const later = new Date(NOW.getTime() + 15 * DAY);
  Object.assign(x.deletions[0], { status: 'running', runningSince: new Date(later.getTime() - 10 * 60 * 1000) });
  assert.deepStrictEqual(await d.runPurgeOnce({ models, deps, now: later }), { completed: 0, failed: 0 }, 'still within 30 minutes: another run owns it');
  assert.ok(x.users.some((u) => u._id === 'o1'));
  x.deletions[0].runningSince = new Date(later.getTime() - 40 * 60 * 1000);
  assert.deepStrictEqual(await d.runPurgeOnce({ models, deps, now: later }), { completed: 1, failed: 0 });
  assert.deepStrictEqual(x.users.map((u) => u._id), ['u9']);
});
