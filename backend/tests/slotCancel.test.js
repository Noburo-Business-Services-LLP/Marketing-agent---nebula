const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

const { createPaymentRouter } = require('../routes/payment');
const { isBlockedInsideClient } = require('../services/agencyWorkspaces');
const ag = require('../services/agency');
const User = require('../models/User');

// ---------------------------------------------------------------- fakes
const ENV = { RAZORPAY_KEY_ID: 'rzp_test_fake', RAZORPAY_KEY_SECRET: 'test_key_secret', RAZORPAY_WEBHOOK_SECRET: 'test_webhook_secret' };
const hmac = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');

function matchFilter(doc, filter) {
  return Object.entries(filter).every(([k, v]) => {
    if (k === '$or') return v.some((f) => matchFilter(doc, f));
    if (k === '_id') return String(doc._id) === String(v);
    let vals = [doc];
    for (const p of k.split('.')) vals = vals.flatMap((x) => (x == null ? [] : Array.isArray(x[p]) ? x[p] : [x[p]]));
    if (v === null) return vals.every((x) => x == null);
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('$ne' in v) return !vals.some((x) => x === v.$ne);
      if ('$in' in v) return v.$in.some((c) => (c === null ? vals.every((x) => x == null) || vals.some((x) => x === null) : vals.some((x) => x === c)));
      if ('$lt' in v) return vals.some((x) => typeof x === 'number' && x < v.$lt);
      if ('$elemMatch' in v) return vals.some((el) => el && typeof el === 'object' && matchFilter(el, v.$elemMatch));
      throw new Error(`fake does not support ${JSON.stringify(v)}`);
    }
    return vals.some((x) => x === v);
  });
}
const getAt = (doc, p) => p.split('.').reduce((c, k) => (c == null ? undefined : c[k]), doc);
function setAt(cur, parts, value, arrayFilters) {
  const [p, ...rest] = parts;
  const m = /^\$\[(\w+)\]$/.exec(p);
  if (m) {
    const f = (arrayFilters || []).find((x) => Object.keys(x)[0].startsWith(m[1] + '.'));
    const [fk, fv] = Object.entries(f)[0];
    const sub = fk.slice(m[1].length + 1);
    for (const el of cur) if (el[sub] === fv) setAt(el, rest, value, arrayFilters);
    return;
  }
  if (rest.length === 0) { cur[p] = value; return; }
  if (cur[p] == null) cur[p] = {};
  setAt(cur[p], rest, value, arrayFilters);
}
function applyUpdate(doc, update, arrayFilters) {
  for (const [k, v] of Object.entries(update.$set || {})) setAt(doc, k.split('.'), v, arrayFilters);
  for (const [k, v] of Object.entries(update.$inc || {})) setAt(doc, k.split('.'), (getAt(doc, k) || 0) + v, arrayFilters);
  for (const [k, v] of Object.entries(update.$push || {})) {
    const parts = k.split('.'); const parent = parts.slice(0, -1).reduce((c, x) => (c[x] = c[x] || {}), doc);
    const key = parts[parts.length - 1]; parent[key] = parent[key] || [];
    if (v && v.$each) parent[key].push(...JSON.parse(JSON.stringify(v.$each))); else parent[key].push(JSON.parse(JSON.stringify(v)));
  }
  for (const [k, v] of Object.entries(update.$addToSet || {})) {
    const parts = k.split('.'); const parent = parts.slice(0, -1).reduce((c, x) => (c[x] = c[x] || {}), doc);
    const key = parts[parts.length - 1]; parent[key] = parent[key] || [];
    for (const item of v.$each) if (!parent[key].includes(item)) parent[key].push(item);
  }
  for (const [k, v] of Object.entries(update.$pull || {})) {
    const parts = k.split('.'); const parent = parts.slice(0, -1).reduce((c, x) => (c[x] = c[x] || {}), doc);
    const key = parts[parts.length - 1]; parent[key] = (parent[key] || []).filter((x) => !v.$in.includes(x));
  }
}
// Reads return copies, like a real database, so a stale read really is stale. Updates are applied to the stored record.
function fakeUserModel(users) {
  const copy = (d) => (d ? structuredClone(d) : null);
  return {
    users,
    async findById(id) { return copy(users.find((u) => String(u._id) === String(id))); },
    async findOne(q) { return copy(users.find((u) => matchFilter(u, q))); },
    async findOneAndUpdate(filter, update, opts = {}) {
      const doc = users.find((u) => matchFilter(u, filter));
      if (!doc) return null;
      applyUpdate(doc, update, opts.arrayFilters);
      return copy(doc);
    },
    async updateOne(filter, update, opts = {}) {
      const doc = users.find((u) => matchFilter(u, filter));
      if (!doc) return { matchedCount: 0, modifiedCount: 0 };
      applyUpdate(doc, update, opts.arrayFilters);
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async updateMany(filter, update) { users.filter((u) => matchFilter(u, filter)).forEach((u) => applyUpdate(u, update)); },
    find(filter) {
      const rows = () => users.filter((u) => matchFilter(u, filter)).map(copy).sort((a, b) => a.createdAt - b.createdAt);
      return { sort() { return { lean: async () => rows() }; }, lean: async () => rows() };
    }
  };
}
function mkAgency(over = {}) {
  return {
    _id: 'user1', email: 'a@example.com', firstName: 'Asha', lastName: 'K', mobileNumber: '',
    credits: { balance: 100, topupBalance: 0, totalUsed: 0 }, payments: [],
    subscription: { status: 'active', razorpaySubscriptionId: 'sub_plan' },
    plan: { tier: 'agency', addons: [], subscriptionId: 'sub_plan', subscriptions: [{ subscriptionId: 'sub_plan', kind: 'plan', key: 'agency', razorpayPlanId: 'plan_agency', active: true }] },
    agency: { clientCount: 0, extraSlots: 0 },
    ...over
  };
}
const mkFree = (over = {}) => mkAgency({ plan: { tier: 'free', addons: [], subscriptions: [] }, subscription: { status: 'active' }, agency: undefined, ...over });
function mkWorkspace(n, ownerId = 'user1', tier = 'agency') {
  return { _id: `w${n}`, createdAt: new Date(1000 * n), email: `ws-${n}@workspace.invalid`, agency: { ownerId, workspaceName: `Client ${n}`, frozen: false }, plan: { tier, addons: [] }, credits: { balance: 0 } };
}
function fakeRazorpay() {
  const calls = { plans: [], subs: [], cancels: [] };
  const subs = {};
  return {
    calls,
    plans: { create: async (b) => { calls.plans.push(b); return { id: `plan_fake${calls.plans.length}` }; } },
    subscriptions: {
      create: async (b) => { calls.subs.push(b); const s = { id: `sub_fake${calls.subs.length}`, plan_id: b.plan_id, notes: b.notes }; subs[s.id] = s; return s; },
      fetch: async (id) => subs[id],
      cancel: async (id, atEnd) => { calls.cancels.push([id, atEnd]); return { id, status: 'cancelled' }; }
    },
    orders: { create: async () => { throw new Error('no orders here'); }, fetch: async () => null },
    // What Razorpay reports for a payment: set per payment id in `amounts`, otherwise the price the test is about.
    amounts: {}, defaultAmount: undefined,
    payments: { fetch: async function (id) { return { id, amount: Object.prototype.hasOwnProperty.call(this.amounts, id) ? this.amounts[id] : this.defaultAmount }; } }
  };
}
function setup({ user = mkAgency(), extra = [], env = ENV, settle } = {}) {
  const welcomes = []; const invoices = []; const alerts = [];
  const User = fakeUserModel([user, ...extra]);
  const razorpay = fakeRazorpay();
  razorpay.payments.fetch = razorpay.payments.fetch.bind(razorpay);
  const notifies = [];
  const r = createPaymentRouter({
    razorpay, User, env, alert: (c, d) => alerts.push([c, d]), ...(settle ? { settle: settle(User) } : {}),
    notifyNow: async (m) => { notifies.push(m); return true; },
    protect: (req, res, next) => next(),
    Coupon: { findOne: async () => null, findOneAndUpdate: async () => null },
    createInvoice: async (p) => { invoices.push(p); return { invoiceNumber: 'INV-1', invoiceUrl: 'https://invoice.example/1' }; },
    sendWelcome: async (u, info) => { welcomes.push({ email: u.email, ...info }); return { sent: true }; }
  });
  return { r, User, razorpay, invoices, user, welcomes, alerts, notifies };
}
const stored = (ctx, id = 'user1') => ctx.User.users.find((u) => String(u._id) === id);
function handlerOf(r, method, p) {
  const layer = r.stack.find((l) => l.route && l.route.path === p && l.route.methods[method]);
  assert.ok(layer, `${method} ${p} is registered`);
  const st = layer.route.stack; return st[st.length - 1].handle;
}
const mkRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
async function call(r, method, p, req) {
  const res = mkRes();
  const q = [console.error, console.log, console.warn];
  console.error = console.log = console.warn = () => {};
  try { await handlerOf(r, method, p)({ headers: {}, body: {}, user: { userId: 'user1' }, ...req }, res); }
  finally { [console.error, console.log, console.warn] = q; }
  return res;
}

const mkSlot = (id, n, over = {}) => ({ subscriptionId: id, kind: 'slot', key: 'client', razorpayPlanId: 'plan_slot', active: true, createdAt: new Date(1000 * n), ...over });
const agencyWith = (slots, { clients = 0, extra = slots.filter((s) => s.active && !s.ended).length } = {}) =>
  mkAgency({
    plan: { tier: 'agency', addons: [], subscriptionId: 'sub_plan', subscriptions: [{ subscriptionId: 'sub_plan', kind: 'plan', key: 'agency', razorpayPlanId: 'plan_agency', active: true }, ...slots] },
    subscription: { status: 'active', razorpaySubscriptionId: 'sub_plan', currentPeriodEnd: new Date('2026-11-20T00:00:00Z') },
    agency: { clientCount: clients, extraSlots: extra }
  });
const slotOf = (ctx, id) => stored(ctx).plan.subscriptions.find((s) => s.subscriptionId === id);

test('no extra client to cancel gives a plain refusal and calls nothing', async () => {
  const ctx = setup({ user: agencyWith([]) });
  const res = await call(ctx.r, 'post', '/cancel-slot', {});
  assert.strictEqual(res.code, 400);
  assert.strictEqual(res.body.message, 'You have no extra client to cancel.');
  assert.strictEqual(ctx.razorpay.calls.cancels.length, 0);
});

test('an inactive, ended or already ending slot is not something to cancel', async () => {
  const ctx = setup({ user: agencyWith([mkSlot('s1', 1, { active: false }), mkSlot('s2', 2, { active: false, ended: true })], { extra: 0 }) });
  const res = await call(ctx.r, 'post', '/cancel-slot', {});
  assert.strictEqual(res.code, 400);
  assert.strictEqual(ctx.razorpay.calls.cancels.length, 0);
});

test('when clients fill every place nothing is cancelled', async () => {
  const limit = 5 + 1;
  const ctx = setup({ user: agencyWith([mkSlot('s1', 1)], { clients: limit }) });
  const res = await call(ctx.r, 'post', '/cancel-slot', {});
  assert.strictEqual(res.code, 400);
  assert.strictEqual(res.body.message, 'You are using all your client places. Remove a client first, then cancel an extra place.');
  assert.strictEqual(ctx.razorpay.calls.cancels.length, 0);
  assert.strictEqual(slotOf(ctx, 's1').cancelAtPeriodEnd, undefined);
  assert.strictEqual(stored(ctx).agency.extraSlots, 1);
});

test('one free place is enough: clients under the lowered limit may cancel', async () => {
  const ctx = setup({ user: agencyWith([mkSlot('s1', 1)], { clients: 5 }) });
  const res = await call(ctx.r, 'post', '/cancel-slot', {});
  assert.strictEqual(res.code, 200, JSON.stringify(res.body));
});

test('success cancels the newest active slot at the end of the paid month and keeps the limit for now', async () => {
  const ctx = setup({ user: agencyWith([mkSlot('s_old', 1), mkSlot('s_new', 3), mkSlot('s_mid', 2)], { clients: 2 }) });
  const res = await call(ctx.r, 'post', '/cancel-slot', {});
  assert.strictEqual(res.code, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.success, true);
  assert.deepStrictEqual(ctx.razorpay.calls.cancels, [['s_new', 1]], 'at cycle end, only the newest');
  assert.strictEqual(slotOf(ctx, 's_new').cancelAtPeriodEnd, true);
  assert.ok(slotOf(ctx, 's_new').cancelRequestedAt instanceof Date);
  assert.strictEqual(slotOf(ctx, 's_new').active, true, 'still paid for until the month ends');
  assert.strictEqual(slotOf(ctx, 's_old').cancelAtPeriodEnd, undefined);
  assert.strictEqual(stored(ctx).agency.extraSlots, 3, 'the limit is not lowered here');
  assert.ok(res.body.endsAt, 'says when it ends');
  assert.match(res.body.message, /end of the month/i);
  assert.doesNotMatch(res.body.message, /razorpay|quark|credit|trial|7 days/i);
});

test('the ended event is what lowers the limit afterwards', async () => {
  const ctx = setup({ user: agencyWith([mkSlot('s1', 1)], { clients: 1 }) });
  await call(ctx.r, 'post', '/cancel-slot', {});
  assert.strictEqual(stored(ctx).agency.extraSlots, 1);
  const raw = Buffer.from(JSON.stringify({ event: 'subscription.cancelled', payload: { subscription: { entity: { id: 's1', plan_id: 'plan_slot', notes: { userId: 'user1' } } } } }));
  const res = await call(ctx.r, 'post', '/webhook', { headers: { 'x-razorpay-signature': hmac(ENV.RAZORPAY_WEBHOOK_SECRET, raw) }, body: raw });
  assert.strictEqual(res.code, 200);
  assert.strictEqual(stored(ctx).agency.extraSlots, 0);
});

test('a second press does not call Razorpay again and still succeeds', async () => {
  const ctx = setup({ user: agencyWith([mkSlot('s1', 1)], { clients: 1 }) });
  await call(ctx.r, 'post', '/cancel-slot', {});
  const again = await call(ctx.r, 'post', '/cancel-slot', {});
  assert.strictEqual(again.code, 200);
  assert.strictEqual(again.body.success, true);
  assert.strictEqual(ctx.razorpay.calls.cancels.length, 1);
  assert.strictEqual(stored(ctx).agency.extraSlots, 1);
});

test('a place already ending is counted when checking that clients still fit', async () => {
  // two extra places (limit 7), one already ending; 6 clients would not fit once both have ended
  const ctx = setup({ user: agencyWith([mkSlot('s1', 1, { cancelAtPeriodEnd: true }), mkSlot('s2', 2)], { clients: 6 }) });
  const res = await call(ctx.r, 'post', '/cancel-slot', {});
  assert.strictEqual(res.code, 400);
  assert.strictEqual(ctx.razorpay.calls.cancels.length, 0);
});

test('Razorpay saying it is already cancelled counts as done', async () => {
  const ctx = setup({ user: agencyWith([mkSlot('s1', 1)], { clients: 1 }) });
  ctx.razorpay.subscriptions.cancel = async () => { const e = new Error('x'); e.error = { description: 'This subscription is already cancelled' }; throw e; };
  const res = await call(ctx.r, 'post', '/cancel-slot', {});
  assert.strictEqual(res.code, 200);
  assert.strictEqual(slotOf(ctx, 's1').cancelAtPeriodEnd, true);
});

test('any other Razorpay failure is a plain error and nothing is recorded', async () => {
  const ctx = setup({ user: agencyWith([mkSlot('s1', 1)], { clients: 1 }) });
  ctx.razorpay.subscriptions.cancel = async () => { throw new Error('network down'); };
  const res = await call(ctx.r, 'post', '/cancel-slot', {});
  assert.strictEqual(res.code, 502);
  assert.doesNotMatch(res.body.message, /razorpay/i);
  assert.strictEqual(slotOf(ctx, 's1').cancelAtPeriodEnd, undefined);
});

test('refused for non-agency accounts, client workspaces and inside a client pass', async () => {
  for (const user of [mkFree(), mkAgency({ plan: { tier: 'starter', addons: [], subscriptions: [mkSlot('s1', 1)] }, agency: undefined })]) {
    const ctx = setup({ user });
    const res = await call(ctx.r, 'post', '/cancel-slot', {});
    assert.ok(res.code === 400 || res.code === 403, String(res.code));
    assert.strictEqual(ctx.razorpay.calls.cancels.length, 0);
  }
  const ws = setup({ user: mkAgency({ agency: { ownerId: 'owner9', workspaceName: 'X' } }) });
  assert.strictEqual((await call(ws.r, 'post', '/cancel-slot', {})).code, 403);
  const pass = setup({ user: agencyWith([mkSlot('s1', 1)], { clients: 1 }) });
  const res = await call(pass.r, 'post', '/cancel-slot', { actingAgency: { _id: 'user1' } });
  assert.strictEqual(res.code, 403);
  assert.strictEqual(pass.razorpay.calls.cancels.length, 0);
  for (const url of ['/api/payment/cancel-slot', '/API/PAYMENT/cancel-slot']) assert.strictEqual(isBlockedInsideClient(url, 'POST'), true, url);
});

test('slotsEndingOf counts only active, not ended, ending slots', () => {
  const u = agencyWith([mkSlot('a', 1, { cancelAtPeriodEnd: true }), mkSlot('b', 2), mkSlot('c', 3, { cancelAtPeriodEnd: true, active: false, ended: true })]);
  assert.strictEqual(ag.slotsEndingOf(u), 1);
  assert.strictEqual(ag.slotsEndingOf(null), 0);
});

test('the public profile carries extraSlots and slotsEnding in the agency block, keeping the old fields', () => {
  const u = new User({ email: 'a@example.com', firstName: 'A', agency: { clientCount: 3, extraSlots: 2, workspaceName: 'W' },
    plan: { tier: 'agency', subscriptions: [mkSlot('a', 1, { cancelAtPeriodEnd: true }), mkSlot('b', 2)] } });
  const a = u.toPublicJSON().agency;
  assert.deepStrictEqual([a.clientCount, a.workspaceName, a.extraSlots, a.slotsEnding], [3, 'W', 2, 1]);
});
