// Shared in-memory fakes for payment route tests (copied from slotCancel.test.js): a User model, Razorpay, and a router.
const crypto = require('crypto');
const assert = require('node:assert');
const { createPaymentRouter } = require('../routes/payment');
const ENV = { RAZORPAY_KEY_ID: 'rzp_test_fake', RAZORPAY_KEY_SECRET: 'test_key_secret', RAZORPAY_WEBHOOK_SECRET: 'test_webhook_secret' };
const hmac = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');

// Just enough of Mongo's $expr for the limit checks.
function evalExpr(doc, e) {
  if (typeof e === 'string' && e.startsWith('$')) return getAt(doc, e.slice(1));
  if (!e || typeof e !== 'object') return e;
  const [op, args] = Object.entries(e)[0];
  const a = Array.isArray(args) ? args.map((x) => evalExpr(doc, x)) : [evalExpr(doc, args)];
  switch (op) {
    case '$ifNull': return a[0] == null ? a[1] : a[0];
    case '$min': return Math.min(...a); case '$max': return Math.max(...a);
    case '$add': return a.reduce((x, y) => x + y, 0); case '$subtract': return a[0] - a[1];
    case '$lt': return a[0] < a[1]; case '$lte': return a[0] <= a[1];
    default: throw new Error(`fake does not support ${op}`);
  }
}
function matchFilter(doc, filter) {
  return Object.entries(filter).every(([k, v]) => {
    if (k === '$or') return v.some((f) => matchFilter(doc, f));
    if (k === '$expr') return !!evalExpr(doc, v);
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

module.exports = { ENV, hmac, fakeUserModel, mkAgency, mkFree, fakeRazorpay, setup, stored, handlerOf, mkRes, call };
