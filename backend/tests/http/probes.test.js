'use strict';
// Regression probe pack P1 to P20 (the tester's master prompt, section 1.2) as automated tests.
// The whole app runs in this process on a random 127.0.0.1 port; the user store is in memory; any outgoing request to a
// non-local host is refused. Each test asserts the FIXED behaviour. Table of probes and cross-references:
// docs/superpowers/ops/regression-probes.md. P16 and P18 (load, two processes) are in backend/scripts/loadtest/.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const mongoose = require('mongoose');
const { boot } = require('./helpers/appHarness');

const STRONG = 'Tr0ub4dor&3-horse-battery';
let t; // the booted harness

test.before(async () => {
  t = await boot();
  // Reminder: no database. A new reminder's save() keeps the document in memory.
  const Reminder = require('../../models/Reminder');
  t.reminders = [];
  t.savedReminderSave = Reminder.prototype.save;
  Reminder.prototype.save = async function save() { t.reminders.push(this.toObject()); return this; };
});
test.after(async () => {
  require('../../models/Reminder').prototype.save = t.savedReminderSave;
  assert.deepEqual(t.outgoing, [], 'no outgoing request left this machine');
  await t.close();
});

const bearer = (user, tv = 0) => t.generateToken(user._id, tv);
async function member(fields = {}) {
  const n = Math.random().toString(36).slice(2, 8);
  return t.addUser({ email: `probe-${n}@example.test`, password: STRONG, firstName: 'Probe', ...fields });
}

// ---- P1 ---------------------------------------------------------------------------------------------------------------
test('P1 text is stored exactly as typed (no HTML-entity rewriting)', async () => {
  const u = await member();
  const cases = [
    { title: 'Tom & Jerry <3', description: 'if (a<b) 5 > 3' },
    { title: '<b>bold</b>', description: 'Q&A "quoted" \'single\'' }
  ];
  for (const c of cases) {
    const r = await t.call(t.base, '/api/reminders', { token: bearer(u), body: { ...c, scheduledFor: new Date(Date.now() + 86400000).toISOString() } });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.body.reminder.title, c.title);
    assert.equal(r.body.reminder.description, c.description);
  }
  assert.equal(t.reminders.at(-2).title, 'Tom & Jerry <3', 'what was handed to the database');
  assert.equal(t.reminders.at(-2).description, 'if (a<b) 5 > 3');
});

// ---- P2 ---------------------------------------------------------------------------------------------------------------
test('P2 25 signed-in /api/auth/me calls from one address all return 200', async () => {
  const u = await member();
  const codes = [];
  for (let i = 0; i < 25; i += 1) codes.push((await t.call(t.base, '/api/auth/me', { method: 'GET', token: bearer(u) })).status);
  assert.deepEqual(codes, Array(25).fill(200));
});

// ---- P3 ---------------------------------------------------------------------------------------------------------------
test('P3 the video prompt builder needs a token and never returns more than 20 scenes', async () => {
  const body = { description: 'A calm product film', videoStyle: 'Cinematic Commercial', characterName: 'Asha', sceneCount: 100000 };
  assert.equal((await t.call(t.base, '/api/generateVideoStylePrompts', { body })).status, 401, 'no token');
  const u = await member();
  const big = await t.call(t.base, '/api/generateVideoStylePrompts', { token: bearer(u), body });
  assert.ok(big.status === 400 || (big.body && (big.body.scenes || []).length <= 20), `huge scene count: ${big.status}`);
  assert.ok(big.text.length < 100000, 'response stays small');
  const ok = await t.call(t.base, '/api/generateVideoStylePrompts', { token: bearer(u), body: { ...body, sceneCount: 20 } });
  assert.equal(ok.status, 200, ok.text.slice(0, 200));
  const scenes = (ok.body.scenes || ok.body.data?.scenes || []);
  assert.ok(scenes.length >= 1 && scenes.length <= 20, `scenes: ${scenes.length}`);
});

// ---- P4 ---------------------------------------------------------------------------------------------------------------
test('P4 a rotating X-Forwarded-For cannot change the address the limits see (only the proxy-appended entry counts)', async () => {
  // The default is one trusted hop (the load balancer): it appends the real client address, so the spoofed entries to its
  // left are ignored. 30 requests with a different spoof each time all resolve to the same address.
  const seen = new Set();
  for (let i = 0; i < 30; i += 1) {
    const r = await t.call(t.base, '/api/health/details', { method: 'GET', headers: { 'X-Forwarded-For': `10.9.${i}.${i + 1}, 198.51.100.7` } });
    seen.add(r.body.checks.client.ip);
  }
  assert.deepEqual([...seen], ['198.51.100.7']);
});

// ---- P5 ---------------------------------------------------------------------------------------------------------------
test('P5 a malformed id and a query operator are 400, never a database cast error', async () => {
  const u = await member();
  for (const p of ['/api/campaigns/123', '/api/campaigns?status[$ne]=x']) {
    const r = await t.call(t.base, p, { method: 'GET', token: bearer(u) });
    assert.equal(r.status, 400, `${p}: ${r.status} ${r.text.slice(0, 120)}`);
    assert.doesNotMatch(r.text, /Cast to|ObjectId|BSON/i);
  }
});

// ---- P6 ---------------------------------------------------------------------------------------------------------------
test('P6 a request from an origin that is not allowed is a 403 JSON answer, not a 500', async () => {
  const r = await t.call(t.base, '/api/auth/me', { method: 'GET', headers: { Origin: 'https://evil.example' } });
  assert.equal(r.status, 403);
  assert.equal(r.body && r.body.success, false);
  const fine = await t.call(t.base, '/api/health', { method: 'GET', headers: { Origin: 'http://localhost:5173' } });
  assert.notEqual(fine.status, 403, 'an allowed origin is not refused');
});

// ---- P7 ---------------------------------------------------------------------------------------------------------------
test('P7 "Bearerx <token>" and other malformed headers are 401; "Bearer <token>" works', async () => {
  const u = await member();
  const token = bearer(u);
  for (const h of [`Bearerx ${token}`, token, `Bearer ${token} extra`]) {
    const r = await t.call(t.base, '/api/auth/me', { method: 'GET', headers: { Authorization: h } });
    assert.equal(r.status, 401, h.slice(0, 20));
  }
  assert.equal((await t.call(t.base, '/api/auth/me', { method: 'GET', token })).status, 200);
});

// ---- P8 ---------------------------------------------------------------------------------------------------------------
test('P8 send-otp and forgot-password answer the same for an unknown email and a known one', async () => {
  await member({ email: 'known-p8@example.test', isVerified: false });
  await member({ email: 'verified-p8@example.test', isVerified: true });
  for (const route of ['/api/auth/send-otp', '/api/auth/forgot-password']) {
    const answers = [];
    for (const email of ['nobody-p8@example.test', 'known-p8@example.test', 'verified-p8@example.test']) {
      const r = await t.call(t.base, route, { body: { email } });
      answers.push({ status: r.status, body: r.body });
    }
    assert.equal(answers[0].status, 200);
    assert.deepEqual(answers[1], answers[0], `${route} known vs unknown`);
    assert.deepEqual(answers[2], answers[0], `${route} verified vs unknown`);
  }
});

// ---- P9 ---------------------------------------------------------------------------------------------------------------
test('P9 GET /api/content-calendar for an account with no calendar is read-only: no AI call, no write', async () => {
  const router = require('../../routes/contentCalendar');
  const writes = [];
  const forbid = (name) => () => { writes.push(name); throw new Error(`write on GET: ${name}`); };
  const q = (result) => ({ sort() { return this; }, lean: async () => result, then: (ok, ko) => Promise.resolve(result).then(ok, ko) });
  let generated = 0;
  const before = router.testDeps;
  router.testDeps = {
    ContentCalendar: undefined,
    User: { findById: async (id) => ({ _id: id, businessProfile: {} }) },
    withPlanGuidance: async () => ({}),
    generateMonthlyCalendar: async () => { generated += 1; return { _id: 'new' }; }
  };
  const ContentCalendar = require('../../models/ContentCalendar');
  const saved = {};
  for (const [name, fn] of Object.entries({ findOne: () => q(null), find: () => q([]), updateOne: forbid('updateOne'), updateMany: forbid('updateMany'), create: forbid('create'), findOneAndUpdate: forbid('findOneAndUpdate') })) {
    saved[name] = ContentCalendar[name]; ContentCalendar[name] = fn;
  }
  try {
    const u = await member();
    const t0 = Date.now();
    const r = await t.call(t.base, '/api/content-calendar', { method: 'GET', token: bearer(u) });
    assert.equal(r.status, 200, r.text.slice(0, 200));
    assert.equal(r.body.calendar, null);
    assert.ok(['not_prepared', 'preparing', 'failed'].includes(r.body.status), r.body.status);
    assert.ok(Date.now() - t0 < 300, 'answers at once');
    assert.equal(generated, 0, 'no calendar generation');
    assert.deepEqual(writes, []);
  } finally {
    Object.assign(ContentCalendar, saved);
    router.testDeps = before;
  }
});

// ---- P10 --------------------------------------------------------------------------------------------------------------
test('P10 /api/health and /api/ready are 503 with the database down and 200 when it answers', async () => {
  // The load balancer's health path is deliberately tied to the database (services/healthCheck.js, decision D63).
  const down = await t.call(t.base, '/api/health', { method: 'GET' });
  assert.equal(down.status, 503);
  assert.equal((await t.call(t.base, '/api/ready', { method: 'GET' })).status, 503);
  const conn = mongoose.connection;
  const had = Object.getOwnPropertyDescriptor(conn, 'readyState');
  const hadDb = Object.getOwnPropertyDescriptor(conn, 'db');
  Object.defineProperty(conn, 'readyState', { get: () => 1, configurable: true });
  Object.defineProperty(conn, 'db', { get: () => ({ admin: () => ({ command: async () => ({ ok: 1 }) }) }), configurable: true });
  try {
    assert.equal((await t.call(t.base, '/api/health', { method: 'GET' })).status, 200);
    const ready = await t.call(t.base, '/api/ready', { method: 'GET' });
    assert.equal(ready.status, 200);
  } finally {
    if (had) Object.defineProperty(conn, 'readyState', had); else delete conn.readyState;
    if (hadDb) Object.defineProperty(conn, 'db', hadDb); else delete conn.db;
  }
});

// ---- P11 --------------------------------------------------------------------------------------------------------------
test('P11 the manual reminder triggers refuse a normal user', async () => {
  const u = await member();
  for (const p of ['/api/notifications/process', '/api/notifications/check-now', '/api/notifications/test']) {
    const r = await t.call(t.base, p, { token: bearer(u), body: {} });
    assert.equal(r.status, 403, p);
  }
});

// ---- P12 --------------------------------------------------------------------------------------------------------------
test('P12 the inbox developer routes are 404 in production', async () => {
  const u = await member();
  const was = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production'; // read on every request by the controller
  try {
    for (const p of ['/api/social/inbox/dev/ingest', '/api/social/inbox/dev/test']) {
      const r = await t.call(t.base, p, { token: bearer(u), body: { platform: 'instagram' } });
      assert.equal(r.status, 404, `${p}: ${r.status} ${r.text.slice(0, 120)}`);
    }
  } finally { process.env.NODE_ENV = was; }
});

// ---- P13 --------------------------------------------------------------------------------------------------------------
test('P13 an oversized JSON body is a 413 and the server stays responsive', async () => {
  const big = 'x'.repeat(5 * 1024 * 1024);
  const started = Date.now();
  const [r, health] = await Promise.all([
    t.call(t.base, '/api/auth/login', { body: { email: 'a@example.test', password: big } }).catch((e) => ({ status: `error ${e.code}` })),
    (async () => { const s = Date.now(); await t.call(t.base, '/api/health', { method: 'GET' }); return Date.now() - s; })()
  ]);
  assert.ok(r.status === 413 || /ECONNRESET|EPIPE/.test(String(r.status)), `status ${r.status}`);
  assert.ok(Date.now() - started < 3000, 'refused quickly');
  assert.ok(health < 500, `health answered in ${health} ms during the upload`);
  const after = await t.call(t.base, '/api/campaigns', { method: 'GET' });
  assert.equal(after.status, 401, 'the server is still serving');
});

// ---- P14 --------------------------------------------------------------------------------------------------------------
test('P14 after a password change the old token is 401 and the new one works', async () => {
  const u = await member();
  const old = bearer(u);
  assert.equal((await t.call(t.base, '/api/auth/me', { method: 'GET', token: old })).status, 200);
  const NEW = 'Qu1et-Harbour!Lamp-77';
  const ch = await t.call(t.base, '/api/auth/change-password', { method: 'PUT', token: old, body: { currentPassword: STRONG, newPassword: NEW } });
  assert.equal(ch.status, 200, ch.text);
  assert.equal((await t.call(t.base, '/api/auth/me', { method: 'GET', token: old })).status, 401, 'old token');
  assert.equal((await t.call(t.base, '/api/auth/me', { method: 'GET', token: ch.body.token })).status, 200, 'new token');
});

// ---- P15 --------------------------------------------------------------------------------------------------------------
test('P15 stored-XSS payloads round trip as plain text and script links are refused where a link is saved', async () => {
  const u = await member();
  const payloads = ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '"><svg/onload=alert(1)>', "'; DROP TABLE users;--", '{{constructor.constructor("alert(1)")()}}'];
  for (const p of payloads) {
    const r = await t.call(t.base, '/api/reminders', { token: bearer(u), body: { title: p, description: p, scheduledFor: new Date(Date.now() + 86400000).toISOString() } });
    assert.equal(r.status, 201);
    assert.equal(r.body.reminder.title, p);
    assert.equal(r.body.reminder.description, p);
  }
  for (const url of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>alert(1)</script>']) {
    const r = await t.call(t.base, '/api/auth/update-profile', { method: 'PUT', token: bearer(u), body: { businessProfile: { website: url } } });
    assert.equal(r.status, 400, `${url}: ${r.status} ${r.text.slice(0, 150)}`);
  }
});

// ---- P17 --------------------------------------------------------------------------------------------------------------
test('P17 the drafts list returns 30 by default with a nextCursor', async () => {
  const Draft = require('../../models/Draft');
  const rows = Array.from({ length: 150 }, (_, i) => ({ _id: new mongoose.Types.ObjectId(), title: `d${i}`, createdAt: new Date(Date.now() - i * 1000) }));
  const saved = { aggregate: Draft.aggregate, populate: Draft.populate };
  const limits = [];
  Draft.aggregate = async (pipeline) => { const lim = pipeline.find((s) => s.$limit); limits.push(lim.$limit); return rows.slice(0, lim.$limit); };
  Draft.populate = async (r) => r;
  try {
    const u = await member();
    const r = await t.call(t.base, '/api/drafts', { method: 'GET', token: bearer(u) });
    assert.equal(r.status, 200, r.text.slice(0, 200));
    assert.equal(r.body.drafts.length, 30);
    assert.ok(r.body.nextCursor, 'nextCursor');
    assert.equal(r.body.hasMore, true);
    assert.equal(limits[0], 31, 'one extra row is read to know there is a next page');
  } finally { Object.assign(Draft, saved); }
});

// ---- P19 --------------------------------------------------------------------------------------------------------------
test('P19 the server refuses to start without JWT_SECRET (non-zero exit, clear message)', () => {
  const os = require('node:os');
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', '..', 'server.js')], {
    cwd: os.tmpdir(), // no .env here
    env: { PATH: process.env.PATH, NODE_ENV: 'development', LOG_LEVEL: 'info' },
    encoding: 'utf8', timeout: 60000
  });
  assert.notEqual(r.status, 0, 'exit code');
  assert.match(`${r.stdout}${r.stderr}`, /JWT_SECRET/);
});

// ---- P20 --------------------------------------------------------------------------------------------------------------
test('P20 a "demo:" token is 401 unless ALLOW_DEMO_AUTH=1, and never works in production', async () => {
  const r = await t.call(t.base, '/api/auth/me', { method: 'GET', headers: { Authorization: 'Bearer demo:x@y.z' } });
  assert.equal(r.status, 401);
  const { demoModeActive } = require('../../middleware/auth');
  assert.equal(demoModeActive({ NODE_ENV: 'development' }), false, 'off by default');
  assert.equal(demoModeActive({ NODE_ENV: 'development', ALLOW_DEMO_AUTH: '1' }), true, 'on only when asked for');
  assert.equal(demoModeActive({ NODE_ENV: 'production', ALLOW_DEMO_AUTH: '1' }), false, 'never in production');
});
