const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const L = require('../scripts/lib/razorpayTestCheck');
const script = require('../scripts/razorpay-test-check');
const bp = require('../services/billingPlans');
const { PLANS, AGENCY, chargePaise } = require('../config/apiCosts');
const { createFakeRazorpay } = require('./helpers/fakeRazorpayLifecycle');

const KEY = 'rzp_test_SENTINELKEY01';
const SECRET = 'sentinel-secret-value-0001';
const okEnv = (over = {}) => ({ I_APPROVED_RAZORPAY_TEST: 'yes', RAZORPAY_KEY_ID: KEY, RAZORPAY_KEY_SECRET: SECRET, MONGODB_URI: 'mongodb://example.invalid/nebulaa_dev', ...over });

// ---------------------------------------------------------------- guards
test('guards pass for a test key, the approval flag and the dev database', () => {
  assert.deepStrictEqual(L.evaluateGuards({ env: okEnv(), dbName: 'nebulaa_dev' }), { ok: true, problems: [] });
});

test('guards refuse a LIVE key id, a key id with no mode, and a missing key', () => {
  for (const id of ['rzp_live_ABCDEF123456', 'RZP_LIVE_ABCDEF123456', 'ABCDEF123456', 'rzp_test_', '']) {
    const g = L.evaluateGuards({ env: okEnv({ RAZORPAY_KEY_ID: id }) });
    assert.strictEqual(g.ok, false, `accepted "${id}"`);
  }
  const g = L.evaluateGuards({ env: okEnv({ RAZORPAY_KEY_ID: 'rzp_live_ABCDEF123456' }) });
  assert.match(g.problems.join(' '), /LIVE/);
});

test('guards refuse a secret that looks like a key id, has spaces or quotes, is short or missing', () => {
  for (const s of ['rzp_live_abcdefghijklmnop', 'rzp_test_abcdefghijklmnop', 'has a space in it 12345', '"quoted-secret-value-123"', 'short', '']) {
    assert.strictEqual(L.evaluateGuards({ env: okEnv({ RAZORPAY_KEY_SECRET: s }) }).ok, false, `accepted "${s}"`);
  }
});

test('guards refuse every database except nebulaa_dev', () => {
  for (const name of ['nebulaa', 'nebulaa_prod', 'test', 'nebulaa_dev2', '', 'Nebulaa_dev']) {
    assert.strictEqual(L.evaluateGuards({ env: okEnv(), dbName: name }).ok, false, `accepted database "${name}"`);
  }
});

test('guards refuse without the approval flag, with anything but exactly "yes", and in production', () => {
  for (const v of [undefined, '', 'YES', 'true', '1', 'y']) {
    const e = okEnv(); if (v === undefined) delete e.I_APPROVED_RAZORPAY_TEST; else e.I_APPROVED_RAZORPAY_TEST = v;
    assert.strictEqual(L.evaluateGuards({ env: e }).ok, false, `accepted flag ${JSON.stringify(v)}`);
  }
  assert.strictEqual(L.evaluateGuards({ env: okEnv({ NODE_ENV: 'production' }) }).ok, false);
});

test('guard messages never contain the key or the secret', () => {
  const g = L.evaluateGuards({ env: okEnv({ RAZORPAY_KEY_ID: 'rzp_live_SENTINELLIVEKEY', RAZORPAY_KEY_SECRET: 'rzp_live_sentinelsecretvalue', I_APPROVED_RAZORPAY_TEST: 'no' }), dbName: 'prod' });
  const text = g.problems.join('\n');
  assert.ok(g.problems.length >= 4);
  for (const v of ['SENTINELLIVEKEY', 'sentinelsecretvalue']) assert.ok(!text.includes(v));
});

// ---------------------------------------------------------------- main refuses cleanly (no file read, no network, no database)
function refusalRun(env, extra = {}) {
  const lines = []; let touched = 0;
  const trap = new Proxy({}, { get() { touched += 1; throw new Error('must not be touched'); } });
  return script.main({ env, argv: ['run'], out: (s) => lines.push(String(s)), noDotenv: true, noSignals: true, sdk: trap, mongoose: trap, ask: async () => { touched += 1; return ''; }, ...extra })
    .then((code) => ({ code, text: lines.join('\n'), touched }));
}

test('main refuses a live key with a non-zero exit, prints TEST MODE, touches nothing and prints no secret', async () => {
  const r = await refusalRun(okEnv({ RAZORPAY_KEY_ID: 'rzp_live_SENTINELLIVEKEY' }));
  assert.strictEqual(r.code, 1); assert.strictEqual(r.touched, 0);
  assert.match(r.text, /TEST MODE/); assert.match(r.text, /REFUSED/);
  assert.ok(!r.text.includes('SENTINELLIVEKEY') && !r.text.includes(SECRET));
});

test('main refuses without the approval flag and without keys', async () => {
  const noFlag = okEnv(); delete noFlag.I_APPROVED_RAZORPAY_TEST;
  const a = await refusalRun(noFlag);
  assert.strictEqual(a.code, 1); assert.match(a.text, /I_APPROVED_RAZORPAY_TEST=yes/); assert.strictEqual(a.touched, 0);
  const b = await refusalRun({});
  assert.strictEqual(b.code, 1); assert.strictEqual(b.touched, 0);
  assert.match(b.text, /RAZORPAY_KEY_ID is not set/);
});

test('main refuses a non-dev database after connecting, before any model is read or any Razorpay call', async () => {
  let sdkUsed = 0;
  const sdk = new Proxy({}, { get() { sdkUsed += 1; throw new Error('Razorpay must not be used'); } });
  const calls = [];
  const mongoose = { connect: async () => calls.push('connect'), connection: { name: 'nebulaa_prod' }, disconnect: async () => calls.push('disconnect') };
  const lines = [];
  const code = await script.main({ env: okEnv({ JWT_SECRET: 'x' }), argv: ['run'], out: (s) => lines.push(String(s)), noDotenv: true, noSignals: true, mongoose, sdk, ask: async () => '' });
  assert.strictEqual(code, 1); assert.strictEqual(sdkUsed, 0);
  assert.deepStrictEqual(calls, ['connect', 'disconnect']);
  assert.match(lines.join('\n'), /nebulaa_prod/);
});

test('a key or plan id placed in the environment AFTER the shell cannot be swapped in: the shell values win', () => {
  const src = fs.readFileSync(path.join(__dirname, '../scripts/razorpay-test-check.js'), 'utf8');
  assert.match(src, /const keyId = env0\.RAZORPAY_KEY_ID; const keySecret = env0\.RAZORPAY_KEY_SECRET/);
  assert.match(src, /const planOverrides = \{ agency: env0\.RAZORPAY_PLAN_ID_AGENCY/);
});

// ---------------------------------------------------------------- the one Razorpay path
test('the wrapper is the only Razorpay path: the SDK is required in exactly one place, and nothing builds its own client', () => {
  const lib = fs.readFileSync(path.join(__dirname, '../scripts/lib/razorpayTestCheck.js'), 'utf8');
  const scr = fs.readFileSync(path.join(__dirname, '../scripts/razorpay-test-check.js'), 'utf8');
  assert.strictEqual((lib.match(/require\('razorpay'\)/g) || []).length, 1);
  assert.strictEqual((scr.match(/require\('razorpay'\)/g) || []).length, 0);
  assert.ok(!/new Razorpay\(/.test(scr));
  assert.ok(!/fetch\(['"`]https?:\/\/(?!127\.0\.0\.1)/.test(scr), 'the script calls an outside address directly');
  assert.match(scr, /razorpay: client, env: routeEnv/, 'the real payment route must get the wrapper');
});

test('the wrapper passes calls to the SDK, tracks created subscriptions and calls, keeps the last error, and has no other methods', async () => {
  const fake = createFakeRazorpay();
  const seen = [];
  const c = L.createRazorpayClient(fake.sdk, { onSubscriptionCreated: (id) => seen.push(id) });
  const plan = await c.plans.create({ item: { amount: 123 } });
  const sub = await c.subscriptions.create({ plan_id: plan.id, notes: { userId: 'u' } });
  assert.deepStrictEqual(c.createdSubscriptionIds(), [sub.id]); assert.deepStrictEqual(seen, [sub.id]);
  assert.ok((await c.subscriptions.fetch(sub.id)).short_url);
  await c.subscriptions.cancel(sub.id, 1);
  assert.deepStrictEqual(c.calls().map((x) => x.name), ['plans.create', 'subscriptions.create', 'subscriptions.fetch', 'subscriptions.cancel']);
  assert.deepStrictEqual(c.calls()[3].args, [sub.id, 1]);
  await assert.rejects(() => c.subscriptions.fetch('sub_nope'));
  assert.match(c.lastError().description, /does not exist/);
  assert.deepStrictEqual(Object.keys(c).sort(), ['calls', 'createdSubscriptionIds', 'invoices', 'lastError', 'payments', 'plans', 'subscriptions']);
  assert.strictEqual(c.orders, undefined); assert.strictEqual(c.refunds, undefined); assert.strictEqual(c.customers, undefined);
});

test('the real payment route runs on the wrapper: create-subscription for the agency plan calls only the wrapper', async () => {
  const fake = createFakeRazorpay();
  const client = L.createRazorpayClient(fake.sdk);
  const { createPaymentRouter } = require('../routes/payment');
  const users = [{ _id: 'u1', email: 'a@b.test', firstName: 'A', plan: { tier: 'free', subscriptions: [] }, credits: { balance: 0 } }];
  const User = {
    findById: async (id) => structuredClone(users.find((u) => u._id === id)),
    updateOne: async (f, u) => { const d = users.find((x) => x._id === f._id); (d.plan.subscriptions).push(u.$push['plan.subscriptions']); return {}; }
  };
  const r = createPaymentRouter({ razorpay: client, User, env: { RAZORPAY_KEY_ID: KEY }, protect: (q, s, n) => n(), Coupon: {}, createInvoice: async () => ({}), sendWelcome: async () => ({}) });
  const layer = r.stack.find((l) => l.route && l.route.path === '/create-subscription');
  const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await layer.route.stack[layer.route.stack.length - 1].handle({ body: { planId: 'agency' }, user: { userId: 'u1' } }, res);
  assert.strictEqual(res.code, 200);
  assert.strictEqual(res.body.amount, L.expectedAmounts().agency.chargePaise);
  assert.deepStrictEqual(client.calls().map((x) => x.name), ['plans.create', 'subscriptions.create']);
  assert.strictEqual(fake.calls.length, 2);
});

// ---------------------------------------------------------------- amounts come from config
test('expected amounts are the config prices plus 18 percent GST, and match the billing code', () => {
  const a = L.expectedAmounts();
  assert.strictEqual(a.agency.chargePaise, chargePaise(PLANS.agency.inr));
  assert.strictEqual(a.slot.chargePaise, chargePaise(AGENCY.slot.inr));
  assert.strictEqual(a.agency.chargePaise, bp.planQuote('agency').chargePaise);
  assert.strictEqual(a.slot.chargePaise, bp.slotQuote().chargePaise);
  assert.strictEqual(a.agency.quarks, PLANS.agency.quarks); assert.strictEqual(a.slot.quarks, AGENCY.slot.quarks);
  assert.strictEqual(a.maxExtraSlots, AGENCY.maxClients - AGENCY.includedClients);
  assert.strictEqual(L.rupees(a.agency.chargePaise), `Rs ${(a.agency.chargePaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
  assert.strictEqual(L.rupees(825882), 'Rs 8,258.82');
});

test('no price, Quark amount or limit is typed into the script or its helpers', () => {
  const src = ['../scripts/lib/razorpayTestCheck.js', '../scripts/razorpay-test-check.js'].map((f) => fs.readFileSync(path.join(__dirname, f), 'utf8')).join('\n');
  // Strip comments and the human-readable example in the instructions text before looking for numbers.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const lit of [/\b825882\b/, /\b176882\b/, /\b6999\b/, /\b1499\b/, /\b8258\.82\b/, /\b1768\.82\b/, /\b6000\b/, /\b6,000\b/]) assert.ok(!lit.test(code.replace(/'Rs 8,258\.82'/g, '')), `a typed-in number: ${lit}`);
});

// ---------------------------------------------------------------- signing and waiting
test('the webhook signature and the checkout signature are the ones the server verifies', () => {
  const raw = Buffer.from(JSON.stringify({ a: 1 }));
  const secret = L.newWebhookSecret();
  assert.strictEqual(secret.length, 64);
  assert.notStrictEqual(secret, L.newWebhookSecret());
  assert.strictEqual(bp.verifyWebhookSignature(raw, L.webhookSignature(secret, raw), secret), true);
  assert.strictEqual(bp.verifyWebhookSignature(raw, L.webhookSignature('other-secret-value-xyz', raw), secret), false);
  assert.strictEqual(bp.verifyCheckoutSignature('pay_1|sub_1', L.checkoutSignature(SECRET, 'pay_1', 'sub_1'), SECRET), true);
  assert.strictEqual(bp.verifyCheckoutSignature('pay_1|sub_2', L.checkoutSignature(SECRET, 'pay_1', 'sub_1'), SECRET), false);
});

test('buildEvent has the shape the webhook handler reads', () => {
  const e = L.buildEvent('subscription.charged', { id: 'sub_1' }, { id: 'pay_1', amount: 5 });
  assert.strictEqual(e.event, 'subscription.charged'); assert.strictEqual(e.payload.subscription.entity.id, 'sub_1'); assert.strictEqual(e.payload.payment.entity.id, 'pay_1');
  assert.strictEqual(L.buildEvent('subscription.cancelled', { id: 's' }).payload.payment, undefined);
});

test('waitFor returns when done, and stops at the timeout with the last value', async () => {
  let n = 0; let t = 0; const slept = [];
  const ok = await L.waitFor(async () => ({ done: ++n === 3, value: n }), { intervalMs: 10, timeoutMs: 1000, sleep: async (ms) => { slept.push(ms); t += ms; }, now: () => t });
  assert.deepStrictEqual(ok, { ok: true, value: 3 }); assert.deepStrictEqual(slept, [10, 10]);
  t = 0;
  const late = await L.waitFor(async () => ({ done: false, value: 'created' }), { intervalMs: 100, timeoutMs: 250, sleep: async (ms) => { t += ms; }, now: () => t });
  assert.deepStrictEqual(late, { ok: false, value: 'created' });
});

// ---------------------------------------------------------------- results and exit code
test('results table and exit code: FAIL, leftovers or an uncancelled subscription make it non-zero; SKIP does not', () => {
  const r = L.createResults(); r.add('a', 'PASS'); r.add('b', 'SKIP', 'why');
  const clean = { left: { users: 0, ledger: 0, opsState: 0, otherCollections: 0 }, razorpay: { failed: [] } };
  assert.strictEqual(L.exitCodeFor({ results: r, cleanup: clean }), 0);
  r.add('c', 'FAIL', 'boom');
  assert.strictEqual(L.exitCodeFor({ results: r, cleanup: clean }), 1);
  const r2 = L.createResults(); r2.add('a', 'PASS');
  assert.strictEqual(L.exitCodeFor({ results: r2, cleanup: { ...clean, left: { ...clean.left, users: 1 } } }), 1);
  assert.strictEqual(L.exitCodeFor({ results: r2, cleanup: { ...clean, razorpay: { failed: ['sub_1'] } } }), 1);
  assert.strictEqual(L.exitCodeFor({ results: r2, cleanup: null }), 1, 'no cleanup result is never a pass');
  assert.match(L.renderTable(r.rows), /FAIL\s+c\n\s+-> boom/);
});

// ---------------------------------------------------------------- cleanup
function fakeModels(seed) {
  const state = { users: [...seed.users], ledger: [...(seed.ledger || [])], ops: [...(seed.ops || [])] };
  const idIn = (v, list) => list.map(String).includes(String(v));
  const userMatch = (u, q) => (q.$or ? q.$or.some((x) => userMatch(u, x)) : Object.entries(q).every(([k, v]) => {
    if (k === 'email') return new RegExp(v.$regex).test(u.email);
    if (k === '_id') return idIn(u._id, v.$in);
    if (k === 'agency.ownerId') return !!(u.agency && idIn(u.agency.ownerId, v.$in));
    throw new Error(`fake: ${k}`);
  }));
  const chain = (rows) => ({ select() { return this; }, lean: async () => rows });
  return {
    state,
    User: {
      find: (q) => chain(state.users.filter((u) => userMatch(u, q))),
      deleteMany: async (q) => { const before = state.users.length; state.users = state.users.filter((u) => !userMatch(u, q)); return { deletedCount: before - state.users.length }; },
      countDocuments: async (q) => state.users.filter((u) => userMatch(u, q)).length
    },
    QuarkLedger: {
      deleteMany: async (q) => { const ids = q.$or[0].user.$in.map(String); const before = state.ledger.length; state.ledger = state.ledger.filter((l) => !ids.includes(String(l.user)) && !ids.includes(String(l.workspace))); return { deletedCount: before - state.ledger.length }; },
      countDocuments: async (q) => { const ids = q.$or[0].user.$in.map(String); return state.ledger.filter((l) => ids.includes(String(l.user)) || ids.includes(String(l.workspace))).length; }
    },
    OpsState: {
      deleteMany: async (q) => { const re = new RegExp(q.key.$regex); const before = state.ops.length; state.ops = state.ops.filter((o) => !re.test(o.key)); return { deletedCount: before - state.ops.length }; },
      countDocuments: async (q) => state.ops.filter((o) => new RegExp(q.key.$regex).test(o.key)).length
    }
  };
}
const tmpFile = () => L.cleanupFileApi(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rzpcheck-test-')), 'c.json'));

test('cleanup cancels every Razorpay TEST subscription, deletes every throwaway row, leaves 0 and removes the temp file', async () => {
  const fake = createFakeRazorpay();
  const client = L.createRazorpayClient(fake.sdk);
  const plan = await client.plans.create({ item: { amount: 100 } });
  const live = await client.subscriptions.create({ plan_id: plan.id, notes: {} });
  const done = await client.subscriptions.create({ plan_id: plan.id, notes: {} });
  fake.pay(done.id); await client.subscriptions.cancel(done.id, 0);
  const m = fakeModels({
    users: [
      { _id: 'o1', email: 'rzpcheck-1-owner@example.test', plan: { subscriptions: [{ subscriptionId: 'sub_from_row' }] } },
      { _id: 'w1', email: 'ws-1@workspace.invalid', agency: { ownerId: 'o1' } },
      { _id: 'real', email: 'real@customer.test' }
    ],
    ledger: [{ user: 'o1' }, { user: 'o1', workspace: 'w1' }, { user: 'real' }],
    ops: [{ key: 'rzpcheck-x' }, { key: 'other' }]
  });
  const file = tmpFile(); file.write({ tag: 'rzpcheck-1', subscriptionIds: [live.id], userIds: ['o1'] });
  const lines = [];
  const res = await L.cleanupAll({ client, models: m, file, out: (s) => lines.push(s), settleMs: 0 });
  assert.deepStrictEqual(res.left, { users: 0, ledger: 0, opsState: 0, otherCollections: 0 });
  assert.deepStrictEqual(m.state.users.map((u) => u._id), ['real'], 'a real customer must never be touched');
  assert.strictEqual(m.state.ledger.length, 1); assert.deepStrictEqual(m.state.ops.map((o) => o.key), ['other']);
  assert.strictEqual(fake.subs[live.id].status, 'cancelled');
  assert.ok(res.razorpay.cancelled.includes(live.id)); assert.ok(res.razorpay.alreadyDone.includes(done.id));
  assert.deepStrictEqual(res.razorpay.failed, ['sub_from_row'], 'an id the fake Razorpay does not know is reported, not hidden');
  assert.strictEqual(file.exists(), true, 'the file is kept while a subscription could not be cancelled');
  assert.match(lines.join('\n'), /sub_from_row/);
  assert.strictEqual(L.exitCodeFor({ results: L.createResults(), cleanup: res }), 1);
});

test('cleanup with nothing wrong removes the temp file and a second run is harmless', async () => {
  const fake = createFakeRazorpay();
  const client = L.createRazorpayClient(fake.sdk);
  const plan = await client.plans.create({ item: { amount: 100 } });
  const s = await client.subscriptions.create({ plan_id: plan.id, notes: {} });
  const m = fakeModels({ users: [{ _id: 'o1', email: 'rzpcheck-2-owner@example.test' }] });
  const file = tmpFile(); file.write({ tag: 'rzpcheck-2', subscriptionIds: [s.id], userIds: ['o1'] });
  const a = await L.cleanupAll({ client, models: m, file, settleMs: 0 });
  assert.strictEqual(file.exists(), false); assert.strictEqual(L.exitCodeFor({ results: L.createResults(), cleanup: a }), 0);
  const b = await L.cleanupAll({ client, models: m, file, settleMs: 0 });
  assert.deepStrictEqual(b.left, { users: 0, ledger: 0, opsState: 0, otherCollections: 0 });
});

test('cleanup with no Razorpay keys still deletes rows and lists the subscriptions to cancel by hand', async () => {
  const m = fakeModels({ users: [{ _id: 'o1', email: 'rzpcheck-3-owner@example.test', plan: { subscriptions: [{ subscriptionId: 'sub_X' }] } }] });
  const lines = [];
  const res = await L.cleanupAll({ client: null, models: m, file: tmpFile(), out: (s) => lines.push(s), settleMs: 0 });
  assert.strictEqual(m.state.users.length, 0); assert.deepStrictEqual(res.razorpay.failed, ['sub_X']);
  assert.match(lines.join('\n'), /cancel these by hand/);
});

test('cleanup runs once however many times it is asked, and still runs after a failing check (failure and Ctrl+C paths share it)', async () => {
  let runs = 0;
  const run = L.once(async () => { runs += 1; return 'done'; });
  const failing = async () => { try { throw new Error('a check failed'); } finally { await run(); } };
  await assert.rejects(failing, /a check failed/);
  await Promise.all([run(), run()]); // a Ctrl+C arriving during the finally
  assert.strictEqual(runs, 1);
  const src = fs.readFileSync(path.join(__dirname, '../scripts/razorpay-test-check.js'), 'utf8');
  assert.match(src, /finally \{\s*if \(mode === 'run'\) \{\s*try \{ cleanupResult = await doCleanup\(\)/);
  assert.match(src, /process\.on\('SIGINT', onSigint\)/);
  assert.match(src, /rl\.on\('SIGINT'/);
});

test('the cleanup file lives in the OS temp dir and is private', () => {
  assert.strictEqual(path.dirname(L.CLEANUP_FILE), os.tmpdir());
  const f = tmpFile(); f.write({ a: 1 });
  assert.strictEqual(fs.statSync(f.file).mode & 0o077, 0);
  assert.deepStrictEqual(f.read(), { a: 1 }); assert.strictEqual(f.remove(), true); assert.strictEqual(f.read(), null);
});

test('the script prints no key, secret or webhook secret: no log line reads those values', () => {
  const src = fs.readFileSync(path.join(__dirname, '../scripts/razorpay-test-check.js'), 'utf8');
  for (const line of src.split('\n').filter((l) => /out\(|console\.(log|error|warn)\(/.test(l))) {
    assert.ok(!/keySecret|webhookSecret|RAZORPAY_KEY_SECRET\b(?!\s+is)|\$\{keyId\}|\$\{c\.keyId\}|\.json\.key\b/.test(line.replace(/'[^']*RAZORPAY_KEY_SECRET[^']*'/g, '')), `a log line may print a secret: ${line.trim()}`);
  }
});
