/**
 * Real-database check of the security hardening (docs/superpowers/ops/security-hardening.md), against the DEVELOPMENT
 * database only: refuses any database except nebulaa_dev. No provider call: outgoing https requests to non-local hosts
 * are refused. The whole app runs in this process on a random 127.0.0.1 port (never 3000, 3200 or 5000), with no
 * background job. Checks:
 *   1. the shared per-user limiter blocks the Nth request of one user across two limiter instances (two "tasks"
 *      counting in MongoDB), while another user from the same address is not blocked;
 *   2. the manual reminder triggers refuse a normal user (403) and let staff through;
 *   3. job caps: counted from the real job collections (video, hero, blueprint, carousel) and a 429 from the carousel
 *      route when the account already has 2 carousels being made;
 *   4. a saved bad address is never stored (competitor website, profile website 400);
 *   5. SVG uploads are refused (product picture, brand asset, media upload);
 *   6. /generated-media sends sandbox, nosniff and Content-Disposition; the report-only policy and /api/csp-report;
 *   7. a password change ends the old session (token version), the new token works.
 * Throwaway data only: users whose email starts with "zz.security-check", their rows, rate-limit rows with that
 * prefix; all deleted at the end. Exits non-zero on any FAIL or leftover.
 *   node scripts/security-check.js          run, print PASS/FAIL, clean up
 *   node scripts/security-check.js cleanup  delete leftovers of an interrupted run
 */
require('dotenv').config();
const https = require('https');
const outgoing = [];
const isLocal = (h) => /^(127\.0\.0\.1|localhost|\[::1\]|::1)$/.test(String(h || ''));
for (const fn of ['request', 'get']) {
  const orig = https[fn];
  https[fn] = function guarded(a, ...rest) {
    const host = typeof a === 'string' || a instanceof URL ? new URL(String(a)).hostname : (a && (a.hostname || a.host));
    if (!isLocal(host)) { outgoing.push(host); throw new Error(`security-check: outgoing request to ${host} refused`); }
    return orig.call(this, a, ...rest);
  };
}
// No paid or provider call can leave through fetch either (the app uses both).
const realFetch = global.fetch;
global.fetch = (input, init) => {
  const host = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url).hostname;
  if (!isLocal(host)) { outgoing.push(host); return Promise.reject(new Error(`security-check: outgoing fetch to ${host} refused`)); }
  return realFetch(input, init);
};

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const mongoose = require('mongoose');
const express = require('express');

const DEV_DB = 'nebulaa_dev';
const TAG = 'zz.security-check';
const RUN = `${TAG}-${Date.now()}`;
const EMAIL_RX = /^zz\.security-check/;
const results = [];
async function check(name, fn) {
  try { const d = await fn(); results.push(true); console.log(`PASS  ${name}${d ? ` (${d})` : ''}`); } catch (e) { results.push(false); console.log(`FAIL  ${name}: ${e && e.message}`); }
}

async function cleanup(db) {
  const users = await db.collection('users').find({ email: { $regex: EMAIL_RX } }).project({ _id: 1 }).toArray();
  const ids = users.map((u) => u._id);
  const byUser = { $in: ids };
  const out = {
    users: 0,
    rateLimits: (await db.collection('rate_limits').deleteMany({ p: { $regex: new RegExp(`^${TAG.replace(/\./g, '\\.')}`) } })).deletedCount,
    videoJobs: (await db.collection('video_jobs').deleteMany({ userId: byUser })).deletedCount,
    heroJobs: (await db.collection('hero_video_jobs').deleteMany({ userId: byUser })).deletedCount,
    blueprints: (await db.collection('blueprints').deleteMany({ userId: byUser })).deletedCount,
    drafts: (await db.collection('drafts').deleteMany({ userId: byUser })).deletedCount,
    competitors: (await db.collection('competitors').deleteMany({ userId: byUser })).deletedCount,
    notifications: (await db.collection('notifications').deleteMany({ userId: byUser })).deletedCount,
    products: (await db.collection('products').deleteMany({ user: byUser })).deletedCount
  };
  out.users = (await db.collection('users').deleteMany({ _id: byUser })).deletedCount;
  return out;
}
async function leftovers(db) {
  const users = await db.collection('users').find({ email: { $regex: EMAIL_RX } }).project({ _id: 1 }).toArray();
  const byUser = { $in: users.map((u) => u._id) };
  let n = users.length + (await db.collection('rate_limits').countDocuments({ p: { $regex: new RegExp(`^${TAG.replace(/\./g, '\\.')}`) } }));
  for (const c of ['video_jobs', 'hero_video_jobs', 'blueprints', 'drafts', 'competitors', 'notifications']) n += await db.collection(c).countDocuments({ userId: byUser });
  n += await db.collection('products').countDocuments({ user: byUser });
  return n;
}

const listen = (app) => new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set (run from the backend folder so .env is found).');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  if (mongoose.connection.name !== DEV_DB) throw new Error(`Refusing: database is ${mongoose.connection.name}, not ${DEV_DB}`);
  const db = mongoose.connection.db;
  if (process.argv.includes('cleanup')) { console.log('removed', await cleanup(db)); return 0; }
  await cleanup(db);

  // The whole app, in this process, without listening on its own port or starting any background job.
  process.env.NEBULAA_SERVER_NO_START = '1';
  const { app } = require('../server-main');
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}`;
  const servers = [server];

  const User = require('../models/User');
  const { generateToken } = require('../middleware/auth');
  const PASSWORD = 'Zz-check-12345';
  const mkUser = (suffix, extra = {}) => User.create({ email: `${RUN}-${suffix}@example.test`.toLowerCase(), password: PASSWORD, firstName: 'Zz', lastName: 'Check', isVerified: true, isActive: true, onboardingCompleted: true, ...extra });
  const alice = await mkUser('alice');
  const bob = await mkUser('bob');
  const staff = await mkUser('staff', { staffRole: 'admin' });
  const tok = (u) => generateToken(u._id, u.tokenVersion);
  const call = (p, { token, method = 'GET', body, headers = {} } = {}) => realFetch(`${base}${p}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? (body instanceof FormData ? body : JSON.stringify(body)) : undefined
  });

  // ---- 1. shared per-user limiter --------------------------------------------------------------------------------
  await check('limiter: the 4th request of one user is refused by either of two instances counting in MongoDB; a colleague on the same address is not', async () => {
    const before = process.env.RATE_LIMIT_STORE;
    const beforeWait = process.env.RATE_LIMIT_STORE_WAIT_MS;
    process.env.RATE_LIMIT_STORE = 'mongo';
    process.env.RATE_LIMIT_STORE_WAIT_MS = '2000'; // correctness, not speed: never let a slow answer through uncounted here
    const { createLimits } = require('../middleware/limits');
    const ports = [];
    for (let i = 0; i < 2; i += 1) {
      const L = createLimits({ env: { LIMIT_HEAVY_AI_MAX: '3' }, prefix: `${RUN}:limits` });
      const a = express();
      a.set('trust proxy', 1);
      a.post('/gen', L.heavyAi, (req, res) => res.json({ ok: true }));
      const s = await listen(a); servers.push(s); ports.push(s.address().port);
    }
    process.env.RATE_LIMIT_STORE = before || '';
    process.env.RATE_LIMIT_STORE_WAIT_MS = beforeWait || '';
    const hit = (port, user) => realFetch(`http://127.0.0.1:${port}/gen`, { method: 'POST', headers: { Authorization: `Bearer ${tok(user)}`, 'X-Forwarded-For': '203.0.113.77' } }).then((r) => r.status);
    const codes = [await hit(ports[0], alice), await hit(ports[1], alice), await hit(ports[0], alice)];
    assert.deepStrictEqual(codes, [200, 200, 200]);
    assert.strictEqual(await hit(ports[1], alice), 429);
    assert.strictEqual(await hit(ports[0], alice), 429);
    assert.strictEqual(await hit(ports[1], bob), 200, 'another user behind the same address');
    const rows = await db.collection('rate_limits').countDocuments({ p: `${RUN}:limits-heavyAi` });
    assert.ok(rows >= 2, 'one row per user and window');
    return `counts in rate_limits (${rows} rows), keyed by user`;
  });

  // ---- 2. staff-only reminder triggers ------------------------------------------------------------------------------
  await check('POST /api/notifications/process, /check-now and /test refuse a normal user (403); staff pass the gate', async () => {
    for (const p of ['/api/notifications/process', '/api/notifications/check-now', '/api/notifications/test']) {
      const r = await call(p, { token: tok(alice), method: 'POST', body: {} });
      assert.strictEqual(r.status, 403, p);
    }
    // /test without a campaign id answers 400 after the gate: nothing is run or sent.
    const s = await call('/api/notifications/test', { token: tok(staff), method: 'POST', body: {} });
    assert.strictEqual(s.status, 400);
    const list = await call('/api/notifications', { token: tok(alice) });
    assert.strictEqual(list.status, 200, 'the reminder list still opens for a normal user');
    return 'customer 403 on all three, staff 400 (past the gate), list 200';
  });

  // ---- 3. job caps --------------------------------------------------------------------------------------------------
  await check('job caps: counted from the real collections; the carousel route answers 429 when 2 are being made', async () => {
    const { checkJobCap } = require('../services/userJobCap');
    const now = new Date();
    const uid = alice._id;
    const rows = (status, n, extra = {}) => Array.from({ length: n }, (_, i) => ({ userId: uid, status, createdAt: now, updatedAt: now, ...extra, ...(extra.jobId ? { jobId: `${RUN}-${extra.jobId}-${status}-${i}` } : {}) }));
    await db.collection('video_jobs').insertMany([...rows('processing', 2, { jobId: 'v' }), ...rows('queued', 4, { jobId: 'v' })]);
    assert.strictEqual((await checkJobCap('video', uid)).ok, true, '2 running + 4 waiting: one more allowed');
    await db.collection('video_jobs').insertOne({ userId: uid, status: 'queued', jobId: `${RUN}-v-last`, createdAt: now, updatedAt: now });
    const full = await checkJobCap('video', uid);
    assert.strictEqual(full.ok, false); assert.strictEqual(full.status, 429);
    assert.strictEqual((await checkJobCap('video', bob._id)).ok, true, 'another account');
    await db.collection('hero_video_jobs').insertMany(rows('queued', 7, { jobId: 'h' }));
    assert.strictEqual((await checkJobCap('hero', uid)).ok, false);
    await db.collection('blueprints').insertMany(rows('processing', 7, { kind: 'plan' }).map((r, i) => ({ ...r, blueprintId: `${RUN}-bp-${i}` })));
    assert.strictEqual((await checkJobCap('blueprint', uid)).ok, true, 'plan runs are not counted');
    await db.collection('drafts').insertMany(rows('processing', 2, { contentType: 'carousel', title: 'zz carousel' }));
    const r = await call('/api/carousels/generate-stream', { token: tok(alice), method: 'POST', body: { brief: 'zz' } });
    assert.strictEqual(r.status, 429);
    const b = await r.json();
    assert.match(b.message, /already have 2 carousels being made/);
    return `video ${full.inFlight} in flight refused, hero refused, carousel route 429`;
  });

  // ---- 4. bad addresses ----------------------------------------------------------------------------------------------
  await check('a saved bad address is never stored; the profile route answers 400 for a script link', async () => {
    const Competitor = require('../models/Competitor');
    const c = await Competitor.create({ userId: alice._id, name: 'Zz rival', website: 'javascript:alert(1)', posts: [{ platform: 'instagram', postUrl: 'javascript:alert(1)', imageUrl: '<img src=x onerror=alert(1)>' }] });
    const raw = await db.collection('competitors').findOne({ _id: c._id });
    assert.strictEqual(raw.website, '');
    assert.strictEqual(raw.posts[0].postUrl, '');
    assert.strictEqual(raw.posts[0].imageUrl, '');
    const bad = await call('/api/auth/update-profile', { token: tok(alice), method: 'PUT', body: { businessProfile: { website: 'javascript:alert(1)' } } });
    assert.strictEqual(bad.status, 400);
    const junk = await call('/api/auth/update-profile', { token: tok(alice), method: 'PUT', body: { businessProfile: { website: 'not a site', name: 'Zz Co' } } });
    assert.strictEqual(junk.status, 200);
    const u = await db.collection('users').findOne({ _id: alice._id });
    assert.strictEqual(u.businessProfile.website, '');
    const good = await call('/api/auth/update-profile', { token: tok(alice), method: 'PUT', body: { businessProfile: { website: 'zz-example.com', name: 'Zz Co' } } });
    assert.strictEqual(good.status, 200);
    assert.strictEqual((await db.collection('users').findOne({ _id: alice._id })).businessProfile.website, 'zz-example.com');
    return 'competitor links stored empty, script link 400, junk stored empty, a real website kept';
  });

  // ---- 5. SVG uploads -----------------------------------------------------------------------------------------------
  await check('SVG uploads are refused before anything is stored (product picture, brand asset, media upload)', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>');
    const asData = (mime) => `data:${mime};base64,${svg.toString('base64')}`;
    const p = await call('/api/products/upload-image', { token: tok(alice), method: 'POST', body: { imageData: asData('image/svg+xml') } });
    assert.strictEqual(p.status, 400);
    const p2 = await call('/api/products/upload-image', { token: tok(alice), method: 'POST', body: { imageData: asData('image/png') } });
    assert.strictEqual(p2.status, 400, 'an SVG labelled as PNG');
    const b = await call('/api/brand-assets/upload', { token: tok(alice), method: 'POST', body: { imageData: asData('image/png'), type: 'logo', name: 'zz' } });
    assert.strictEqual(b.status, 400);
    const form = new FormData();
    form.append('file', new Blob([svg], { type: 'image/png' }), 'logo.png');
    const m = await call('/api/drafts/upload-media', { token: tok(alice), method: 'POST', body: form });
    assert.strictEqual(m.status, 400);
    const form2 = new FormData();
    form2.append('file', new Blob([svg], { type: 'image/svg+xml' }), 'logo.svg');
    const m2 = await call('/api/drafts/upload-media', { token: tok(alice), method: 'POST', body: form2 });
    assert.strictEqual(m2.status, 400, 'an SVG type is refused by the upload itself');
    assert.strictEqual(await db.collection('drafts').countDocuments({ userId: alice._id, sourceType: 'post' }), 0);
    return `product ${p.status}/${p2.status}, brand asset ${b.status}, media ${m.status}/${m2.status}`;
  });

  // ---- 6. headers ---------------------------------------------------------------------------------------------------
  await check('/generated-media: sandbox, nosniff, Content-Disposition; report-only policy on the API; /api/csp-report 204', async () => {
    const dir = path.join(__dirname, '..', 'storage', 'ai-videos');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${RUN}.mp4`);
    fs.writeFileSync(file, Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]));
    try {
      const r = await call(`/generated-media/${RUN}.mp4`);
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.headers.get('content-security-policy'), 'sandbox');
      assert.strictEqual(r.headers.get('x-content-type-options'), 'nosniff');
      assert.match(r.headers.get('content-disposition') || '', /^inline; filename=/);
    } finally { fs.rmSync(file, { force: true }); }
    const h = await call('/api/health');
    assert.match(h.headers.get('content-security-policy-report-only') || '', /report-uri \/api\/csp-report/);
    const rep = await call('/api/csp-report', { method: 'POST', headers: { 'Content-Type': 'application/csp-report' }, body: { 'csp-report': { 'violated-directive': 'script-src', 'blocked-uri': 'https://zz.example/x.js' } } });
    assert.strictEqual(rep.status, 204);
    return 'all present';
  });

  // ---- 7. token version -----------------------------------------------------------------------------------------------
  await check('a password change ends the old session; the token it returns works', async () => {
    const oldToken = tok(bob);
    assert.strictEqual((await call('/api/auth/me', { token: oldToken })).status, 200);
    const r = await call('/api/auth/change-password', { token: oldToken, method: 'PUT', body: { currentPassword: PASSWORD, newPassword: 'Zz-check-67890' } });
    assert.strictEqual(r.status, 200);
    const { token: fresh } = await r.json();
    assert.ok(fresh);
    const old = await call('/api/auth/me', { token: oldToken });
    assert.strictEqual(old.status, 401, 'old session refused (cached check included)');
    assert.strictEqual((await call('/api/auth/me', { token: fresh })).status, 200);
    assert.strictEqual((await call('/api/drafts', { token: oldToken })).status, 401, 'protect refuses it too');
    const v = (await db.collection('users').findOne({ _id: bob._id })).tokenVersion;
    return `tokenVersion now ${v}`;
  });

  for (const s of servers) s.close();
  const removed = await cleanup(db);
  const left = await leftovers(db);
  console.log(`cleanup: ${JSON.stringify(removed)}; leftovers ${left}; outgoing provider calls attempted: ${outgoing.length}${outgoing.length ? ` (${[...new Set(outgoing)].join(', ')})` : ''}`);
  const failed = results.filter((x) => !x).length;
  console.log(`${results.length - failed} PASS, ${failed} FAIL`);
  return failed || left ? 1 : 0;
}

main()
  .then(async (code) => { await mongoose.disconnect().catch(() => {}); process.exit(code); })
  .catch(async (e) => {
    console.error('security-check failed to run:', e && e.message);
    try { if (mongoose.connection.readyState === 1 && mongoose.connection.name === DEV_DB) console.log('removed', await cleanup(mongoose.connection.db)); } catch (_) { /* best effort */ }
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
