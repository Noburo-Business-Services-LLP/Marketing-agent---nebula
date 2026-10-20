// Final review fixes, part B (access, isolation, deletion). In-memory fakes only: no database, no network.
const test = require('node:test');
const assert = require('node:assert');
const { normalisePath } = require('../services/requestPath');
const { isBlockedWhileActing } = require('../services/csmAccess');
const { isBlockedInsideClient } = require('../services/agencyWorkspaces');
const { isCustomer, openProblem, checkAssignment } = require('../services/staff/clientActions');

// ---- B-I6: one path reading for every check
test('B-I6: normalisePath reads only the route: case, slashes, query, fragment, encoding, absolute URLs', () => {
  assert.strictEqual(normalisePath('/API/PAYMENT/x'), '/api/payment/x');
  assert.strictEqual(normalisePath('//api//payment'), '/api/payment');
  assert.strictEqual(normalisePath('http://x/api/payment/cancel-subscription'), '/api/payment/cancel-subscription');
  assert.strictEqual(normalisePath('https://host:8080/api/payment?x=1#f'), '/api/payment');
  assert.strictEqual(normalisePath('/api/payment%2Fcancel'), '/api/payment/cancel');
  assert.strictEqual(normalisePath('/api/payment/'), '/api/payment');
  assert.strictEqual(normalisePath('/'), '/');
  assert.strictEqual(normalisePath('http://x'), '/');
  assert.strictEqual(normalisePath('/api/%E0%A4%A'), null, 'a broken percent sequence cannot be read');
});

const PAY_VARIANTS = ['/api/payment/cancel-subscription', '/API/PAYMENT/x', '//api//payment', 'http://x/api/payment/cancel-subscription',
  '/api/payment%2Fcancel', '/api/payment/', '/api/payment?x=1', '/api/payment#f', 'https://h/API/Payment/create-order?a=b', '/api/%ZZ'];
test('B-I6: the CSM block and the agency block read every variant the same way', () => {
  for (const u of PAY_VARIANTS) {
    assert.strictEqual(isBlockedWhileActing(u, 'POST'), true, `csm ${u}`);
    assert.strictEqual(isBlockedInsideClient(u, 'POST'), true, `agency ${u}`);
  }
  assert.strictEqual(isBlockedInsideClient('http://x/api/agency/clients/abc/delete', 'DELETE'), true);
  assert.strictEqual(isBlockedInsideClient('http://x/API/agency/clients', 'GET'), false);
  assert.strictEqual(isBlockedWhileActing('/api/campaigns', 'GET'), false);
  assert.strictEqual(isBlockedInsideClient('/api/campaigns', 'GET'), false);
});

// ---- B-I3: staff inside an account cannot act on the customer's privacy choices
test('B-I3: a CSM inside an account is blocked from /api/account except reading its status', () => {
  for (const u of ['/api/account/deletion/restore', '/api/account/deletion/request', '/api/account/consent', '/api/account/export', '/API/ACCOUNT/consent', 'http://x/api/account/consent']) {
    assert.strictEqual(isBlockedWhileActing(u, 'POST'), true, u);
  }
  assert.strictEqual(isBlockedWhileActing('/api/account/status', 'GET'), false);
  assert.strictEqual(isBlockedWhileActing('/api/account/status', 'POST'), true);
});
test('B-I3: an agency pass is also blocked from accepting the Terms for a client', () => {
  assert.strictEqual(isBlockedInsideClient('/api/account/consent', 'POST'), true);
});
test('B-I3: staff cannot open an account with a deletion waiting or one that is switched off', () => {
  assert.match(openProblem({ deletion: { status: 'pending' } }), /deletion/i);
  assert.match(openProblem({ isActive: false }), /switched off/);
  assert.strictEqual(openProblem({ isActive: true, deletion: { status: 'none' } }), null);
  assert.strictEqual(openProblem({}), null);
});

// ---- A-M7 / B-M1: a client workspace is not a customer staff can act on
test('A-M7/B-M1: a workspace is not a customer for staff (no open, no Quarks, no CSM assignment)', () => {
  const ws = { _id: 'w', agency: { ownerId: 'o' } };
  assert.strictEqual(isCustomer(ws), false);
  assert.strictEqual(isCustomer({ _id: 'c', agency: { clientCount: 3 } }), true, 'an agency owner is a customer');
  assert.strictEqual(isCustomer({ _id: 'c' }), true);
  assert.strictEqual(checkAssignment({ csm: null, client: ws }).ok, false);
});

// ---- B-I5: reminder emails go to the campaign owner only
test('B-I5: no personal address is written in the scheduler or the notifications route', () => {
  for (const f of ['../services/notificationScheduler', '../routes/notifications']) {
    assert.doesNotMatch(require('fs').readFileSync(require.resolve(f), 'utf8'), /@gmail\.com|navaneetha/i, f);
  }
});

test('B-I5: a reminder email goes to the campaign owner and nobody else, and never for a workspace or a pending deletion', async () => {
  const scheduler = require('../services/notificationScheduler');
  const ses = require('../services/sesEmailService');
  const users = {
    u1: { _id: 'u1', email: 'asha@example.com' },
    u2: { _id: 'u2', email: 'ws-abc@workspace.invalid', agency: { ownerId: 'o1' } },
    u3: { _id: 'u3', email: 'gone@example.com', deletion: { status: 'pending' } },
    u4: { _id: 'u4', email: 'off@example.com', isActive: false },
    u5: { _id: 'u5', email: 'not-an-email' }
  };
  const real = { Model: scheduler.UserModel, init: ses.initialized, send: ses.sendCampaignReminder };
  const sent = [];
  scheduler.UserModel = { findById: (id) => ({ select: () => ({ lean: async () => users[String(id)] || null }) }) };
  ses.initialized = true;
  ses.sendCampaignReminder = async (m) => { sent.push(m.to); return { success: true }; };
  const log = console.log; console.log = () => {};
  const prevFlag = process.env.CAMPAIGN_REMINDER_EMAILS; process.env.CAMPAIGN_REMINDER_EMAILS = 'on';
  try {
    for (const id of ['u1', 'u2', 'u3', 'u4', 'u5', 'missing']) await scheduler.sendEmailNotification({ name: 'Diwali', userId: id, platforms: [] }, 30, new Date());
    await scheduler.sendEmailNotification({ name: 'Diwali', userId: { _id: 'u1' }, platforms: [] }, 15, new Date());
  } finally {
    console.log = log; scheduler.UserModel = real.Model; ses.initialized = real.init; ses.sendCampaignReminder = real.send;
    if (prevFlag === undefined) delete process.env.CAMPAIGN_REMINDER_EMAILS; else process.env.CAMPAIGN_REMINDER_EMAILS = prevFlag;
  }
  assert.deepStrictEqual(sent, ['asha@example.com', 'asha@example.com']);
});

// ---- N2: reminder emails are off unless CAMPAIGN_REMINDER_EMAILS is 'on'
test('N2: reminder emails send nothing by default or for any value but on; on (any case) sends to the owner only', async () => {
  const scheduler = require('../services/notificationScheduler');
  const ses = require('../services/sesEmailService');
  const real = { Model: scheduler.UserModel, init: ses.initialized, send: ses.sendCampaignReminder };
  const sent = [];
  scheduler.UserModel = { findById: () => ({ select: () => ({ lean: async () => ({ _id: 'u1', email: 'asha@example.com' }) }) }) };
  ses.initialized = true;
  ses.sendCampaignReminder = async (m) => { sent.push(m.to); return { success: true }; };
  const prev = process.env.CAMPAIGN_REMINDER_EMAILS;
  const log = console.log; console.log = () => {};
  const camp = { name: 'Diwali', userId: 'u1', platforms: [] };
  try {
    for (const v of [undefined, '', 'off', 'true', '1', 'yes', 'onn']) {
      if (v === undefined) delete process.env.CAMPAIGN_REMINDER_EMAILS; else process.env.CAMPAIGN_REMINDER_EMAILS = v;
      await scheduler.sendEmailNotification(camp, 30, new Date());
      assert.strictEqual(await scheduler.recipientFor(camp), null, String(v));
      assert.strictEqual(scheduler.reminderEmailsOn(), false, String(v));
    }
    assert.deepStrictEqual(sent, [], 'off sends nothing and does not throw');
    for (const v of ['on', 'ON', ' On ']) {
      process.env.CAMPAIGN_REMINDER_EMAILS = v;
      await scheduler.sendEmailNotification(camp, 15, new Date());
    }
    assert.deepStrictEqual(sent, ['asha@example.com', 'asha@example.com', 'asha@example.com']);
  } finally {
    console.log = log; scheduler.UserModel = real.Model; ses.initialized = real.init; ses.sendCampaignReminder = real.send;
    if (prev === undefined) delete process.env.CAMPAIGN_REMINDER_EMAILS; else process.env.CAMPAIGN_REMINDER_EMAILS = prev;
  }
});

// ---- B-M2: no pass into a client from inside a CSM session
test('B-M2: a CSM working inside an agency account cannot open one of its clients', async () => {
  const router = require('../routes/agency');
  const layer = router.stack.find((l) => l.route && l.route.path === '/clients/:id/open' && l.route.methods.post);
  const handle = layer.route.stack[layer.route.stack.length - 1].handle;
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await handle({ actingCsm: { _id: 'csm1' }, params: { id: 'w1' }, user: { _id: 'o1' } }, res);
  assert.strictEqual(res.code, 403);
  assert.strictEqual(res.body.success, false);
});

// ---- B-M3: the pass check and the pay check are one rule
test('B-M3: a halted agency subscription ends the pass, exactly as it stops payments for clients', () => {
  const { _agencyPassProblem: pass } = require('../middleware/auth');
  const ag = require('../services/agency');
  const owner = { _id: 'o1', isActive: true, plan: { tier: 'agency' }, subscription: { status: 'halted' } };
  const ws = { agency: { ownerId: 'o1', frozen: false } };
  assert.notStrictEqual(pass(owner, ws), '');
  assert.strictEqual(ag.canPayForClients(owner), false);
  const good = { ...owner, subscription: { status: 'active' } };
  assert.strictEqual(pass(good, ws), '');
  assert.strictEqual(ag.canPayForClients(good), true);
});

// ---- B-M4: the live inbox ways in make the same pass checks
test('B-M4: a revoked pass or a pending deletion is refused by the shared token check used for the inbox stream and sockets', async () => {
  const { _tokenProblem: problem } = require('../middleware/auth');
  const mk = (docs) => ({ findById: (id) => ({ select: () => ({ lean: async () => docs[String(id)] || null }) }) });
  const ws = { _id: 'w1', agency: { ownerId: 'o1' } };
  const ownerOk = { _id: 'o1', isActive: true, plan: { tier: 'agency' } };
  assert.strictEqual(await problem({ actingAgency: 'o1' }, ws, { UserModel: mk({ o1: ownerOk }) }), '');
  assert.notStrictEqual(await problem({ actingAgency: 'o1' }, ws, { UserModel: mk({ o1: { ...ownerOk, plan: { tier: 'free' } } }) }), '', 'plan ended');
  assert.notStrictEqual(await problem({ actingAgency: 'o1' }, { ...ws, agency: { ownerId: 'o1', frozen: true } }, { UserModel: mk({ o1: ownerOk }) }), '', 'client frozen');
  assert.notStrictEqual(await problem({ actingAgency: 'o1' }, ws, { UserModel: mk({ o1: { ...ownerOk, deletion: { status: 'pending' } } }) }), '', 'agency being deleted');
  assert.notStrictEqual(await problem({ actingCsm: 'c1' }, { _id: 'x' }, { UserModel: mk({}) }), '', 'CSM no longer exists');
  assert.notStrictEqual(await problem({}, { _id: 'x', deletion: { status: 'pending' } }, { UserModel: mk({}) }), '', 'pending deletion');
  assert.strictEqual(await problem({}, { _id: 'x' }, { UserModel: mk({}) }), '', 'a plain token is fine');
});
test('B-M4: the stream auth and the socket hub call the shared check', () => {
  const fs = require('fs');
  for (const f of ['../routes/socialInboxRoutes', '../services/socketHub']) assert.match(fs.readFileSync(require.resolve(f), 'utf8'), /_tokenProblem/, f);
});

// ---- B-M6: background jobs leave paused accounts alone
const gate = require('../services/backgroundGate');
// Evaluates the small filters the gate uses against an in-memory list of accounts.
function fakeAccounts(list) {
  const get = (o, p) => p.split('.').reduce((c, k) => (c == null ? undefined : c[k]), o);
  const ok = (u, f) => Object.entries(f).every(([k, v]) => {
    if (k === '$or') return v.some((x) => ok(u, x));
    const have = get(u, k);
    if (v && typeof v === 'object' && '$in' in v) return v.$in.map(String).includes(String(have));
    if (v && typeof v === 'object' && '$ne' in v) return String(have) !== String(v.$ne) && !(v.$ne === null && have == null);
    if (v && typeof v === 'object' && '$exists' in v) return (have !== undefined) === v.$exists;
    return String(have) === String(v);
  });
  const rows = (f) => list.filter((u) => ok(u, f));
  const chain = (r) => ({ select: () => chain(r), lean: async () => r.map((x) => ({ _id: x._id })), then: (a, b) => Promise.resolve(r.map((x) => ({ _id: x._id }))).then(a, b) });
  return { find: (f) => chain(rows(f)), distinct: async (field, f) => [...new Set(rows(f).map((u) => get(u, field)))] };
}
const world6 = () => fakeAccounts([
  { _id: 'plain' },
  { _id: 'gone', deletion: { status: 'pending' } },
  { _id: 'ag', plan: { tier: 'agency' }, isActive: true },
  { _id: 'wOk', agency: { ownerId: 'ag' } },
  { _id: 'wFrozen', agency: { ownerId: 'ag', frozen: true } },
  { _id: 'ended', plan: { tier: 'free' }, isActive: true },
  { _id: 'wEnded', agency: { ownerId: 'ended' } },
  { _id: 'agGone', plan: { tier: 'agency' }, deletion: { status: 'pending' } },
  { _id: 'wGone', agency: { ownerId: 'agGone' } }
]);

test('B-M6: the gate lists pending deletions, frozen clients and clients of an ended or deleting agency, and nobody else', async () => {
  const ids = (await gate.blockedAccountIds({ User: world6() })).map(String).sort();
  assert.deepStrictEqual(ids, ['agGone', 'gone', 'wEnded', 'wFrozen', 'wGone']);
  assert.ok(!ids.includes('plain') && !ids.includes('ag') && !ids.includes('wOk') && !ids.includes('ended'));
});

test('B-M6: a read failure never stops the jobs', async () => {
  const warn = console.warn; console.warn = () => {};
  try { assert.deepStrictEqual(await gate.blockedAccountIdsSafe({ User: { find: () => { throw new Error('db down'); }, distinct: async () => [] } }), []); }
  finally { console.warn = warn; }
});

test('B-M6: the content calendar, snapshot and publishing schedulers all exclude the paused accounts in their query', async () => {
  const User = require('../models/User'); const ContentCalendar = require('../models/ContentCalendar'); const Campaign = require('../models/Campaign');
  const real = { find: User.find, distinct: User.distinct, cal: ContentCalendar.find, camp: Campaign.find };
  const fake = world6(); const seen = {};
  const base = User.find;
  User.find = (f) => { if (f && f['ayrshare.profileKey']) { seen.snapshot = f; return { select: async () => [] }; } return fake.find(f); };
  User.distinct = fake.distinct;
  ContentCalendar.find = (f) => { seen.calendar = f; return { limit: async () => [] }; };
  Campaign.find = (f) => { seen.campaign = f; const chain = { select: () => chain, sort: () => ({ limit: async () => [] }) }; return chain; };
  const log = console.log; console.log = () => {};
  try {
    await require('../services/contentCalendarService').processAutoGeneration({});
    await require('../services/campaignScheduler').processDueCampaigns({});
    await require('../services/snapshotScheduler').collectSnapshots.call({ running: false });
  } finally { console.log = log; Object.assign(User, { find: real.find, distinct: real.distinct }); ContentCalendar.find = real.cal; Campaign.find = real.camp; }
  const want = ['agGone', 'gone', 'wEnded', 'wFrozen', 'wGone'];
  assert.deepStrictEqual(seen.calendar.userId.$nin.map(String).sort(), want);
  assert.deepStrictEqual(seen.campaign.userId.$nin.map(String).sort(), want);
  assert.deepStrictEqual(seen.snapshot._id.$nin.map(String).sort(), want);
  assert.strictEqual(seen.calendar.autoGenerate, true, 'the rest of each query is unchanged');
  assert.strictEqual(seen.campaign.status, 'scheduled');
});

test('B-M6: with nothing paused the queries are exactly what they were', async () => {
  const User = require('../models/User'); const ContentCalendar = require('../models/ContentCalendar');
  const real = { find: User.find, distinct: User.distinct, cal: ContentCalendar.find };
  const fake = fakeAccounts([{ _id: 'plain' }]); let q;
  User.find = fake.find; User.distinct = fake.distinct;
  ContentCalendar.find = (f) => { q = f; return { limit: async () => [] }; };
  try { await require('../services/contentCalendarService').processAutoGeneration({}); }
  finally { Object.assign(User, { find: real.find, distinct: real.distinct }); ContentCalendar.find = real.cal; }
  assert.deepStrictEqual(q, { autoGenerate: true, approved: true });
});
