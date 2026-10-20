/**
 * Real-database check of the short auth cache (protectCached, services/authCache.js) against the DEVELOPMENT database.
 * Refuses any database except nebulaa_dev. NO AI call, NO outside call: real routes run inside this process on a random
 * 127.0.0.1 port (never 3000, 3200 or 5000), with real tokens for throwaway users.
 *   node scripts/auth-cache-check.js          run every check, print PASS/FAIL, then delete everything it made
 *   node scripts/auth-cache-check.js cleanup  delete leftovers of an interrupted run and print what is left
 * Everything it creates belongs to throwaway users whose email starts with "zz.authcache-" (and the client workspace of
 * the throwaway agency, found by its owner). Exit code is non-zero on any FAIL, or if anything is left over.
 * See docs/superpowers/ops/auth-cache.md.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const http = require('http');
const express = require('express');
const assert = require('assert');

const PREFIX = 'zz.authcache-';
const DEV_DB = 'nebulaa_dev';

const results = [];
let section = '';
const note = (s) => console.log(`      ${s}`);
async function check(name, fn) {
  const label = `${section} ${name}`;
  try {
    const detail = await fn();
    results.push({ label, ok: true });
    console.log(`PASS  ${label}${detail ? ` (${detail})` : ''}`);
  } catch (e) {
    results.push({ label, ok: false, error: e && e.message });
    console.log(`FAIL  ${label}: ${e && e.message}`);
  }
}

function assertDevDatabase(name) {
  if (name !== DEV_DB) throw new Error(`Refusing: database is ${name}, not ${DEV_DB}`);
}
async function connect() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set (run from the backend folder so .env is found).');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  assertDevDatabase(mongoose.connection.name);
}

const rx = () => ({ $regex: `^${PREFIX.replace(/\./g, '\\.')}` });
async function throwawayIds(db) {
  const base = await db.collection('users').find({ email: rx() }, { projection: { _id: 1 } }).toArray();
  const owners = base.map((u) => u._id);
  const clients = owners.length ? await db.collection('users').find({ 'agency.ownerId': { $in: owners } }, { projection: { _id: 1 } }).toArray() : [];
  return [...owners, ...clients.map((u) => u._id)];
}
async function cleanup(db) {
  const ids = await throwawayIds(db);
  const removed = {};
  if (ids.length) {
    for (const [coll, field] of [['notifications', 'userId'], ['quarkledgers', 'user']]) {
      const c = (await db.collection(coll).deleteMany({ [field]: { $in: ids } })).deletedCount;
      if (c) removed[coll] = c;
    }
    const c = (await db.collection('users').deleteMany({ _id: { $in: ids } })).deletedCount;
    if (c) removed.users = c;
  }
  console.log('removed', JSON.stringify(removed));
  const left = {
    users: await db.collection('users').countDocuments({ email: rx() }) + (ids.length ? await db.collection('users').countDocuments({ _id: { $in: ids } }) : 0),
    notifications: ids.length ? await db.collection('notifications').countDocuments({ userId: { $in: ids } }) : 0,
    quarkledgers: ids.length ? await db.collection('quarkledgers').countDocuments({ user: { $in: ids } }) : 0
  };
  console.log('left', JSON.stringify(left));
  return { removed, left };
}

async function runChecks() {
  const db = mongoose.connection.db;
  const User = require('../models/User');
  const legal = require('../config/legalVersions');
  const auth = require('../middleware/auth');
  const ac = require('../services/authCache');
  const quarkBuckets = require('../services/quarkBuckets');
  const { createWorkspace, issueAgencyPass } = require('../services/agencyWorkspaces');
  const cache = ac.sharedAuthCache();
  const keyOf = (u, extra = {}) => ac.keyFor({ id: String(u._id), ...extra });

  section = '(0) safety:';
  await check('a database that is not nebulaa_dev is refused, and the live connection is the dev one', async () => {
    assert.throws(() => assertDevDatabase('nebulaa'), /Refusing/);
    assert.throws(() => assertDevDatabase(''), /Refusing/);
    assert.strictEqual(mongoose.connection.name, DEV_DB);
  });

  delete process.env.AUTH_CACHE; delete process.env.AUTH_CACHE_TTL_MS;
  const stamp = Date.now();
  const tag = `${PREFIX}${stamp}`;
  const PASSWORD = 'Check-only-1';
  const mkUser = (suffix, extra = {}) => User.create({
    email: `${tag}-${suffix}@example.test`, password: PASSWORD, firstName: `Check ${suffix}`, isVerified: true, onboardingCompleted: true,
    plan: { tier: 'starter', addons: [] },
    consent: { termsVersion: legal.TERMS_VERSION, privacyVersion: legal.PRIVACY_VERSION, acceptedAt: new Date(), source: 'realdb-check' },
    credits: { balance: 600 },
    ...extra
  });
  const tokenOf = (u) => auth.generateToken(u._id);

  // ---- in-process server: the real routes and middleware, random port ------------------------------------------
  const app = express();
  app.use(express.json());
  app.use('/api', require('../routes/home').watch);
  app.use('/api/auth', require('../routes/auth'));
  app.use('/api/credits', require('../routes/credits'));
  app.use('/api/notifications', require('../routes/notifications'));
  // A stand-in money route: what a spend/charge route sees from protect.
  app.get('/api/zz/money-probe', auth.protect, (req, res) => res.json({ isDocument: req.user instanceof mongoose.Document, balance: req.user.credits && req.user.credits.balance }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  assert.ok(![3000, 3200, 5000].includes(port));
  note(`in-process server on 127.0.0.1:${port}`);
  const call = async (method, path, token, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    let json = null; try { json = await res.json(); } catch (_) { /* not json */ }
    return { status: res.status, body: json };
  };
  const get = (path, token) => call('GET', path, token);

  try {
    const a = await mkUser('a'); const b = await mkUser('b'); const c = await mkUser('c'); const d = await mkUser('d');
    const owner = await mkUser('agency', { plan: { tier: 'agency', addons: [] }, credits: { balance: 3000 } });
    const created = await createWorkspace({ owner, name: 'Auth Cache Client', models: { User } });
    assert.ok(created.ok, created.message);
    const ws = created.workspace;
    const pass = issueAgencyPass({ workspaceId: ws._id, ownerId: owner._id });

    section = '(1) cache use:';
    await check('two /me calls: the same account each time, and the second is served from the cache', async () => {
      const before = cache.stats().hits;
      const r1 = await get('/api/auth/me', tokenOf(a)); const r2 = await get('/api/auth/me', tokenOf(a));
      assert.strictEqual(r1.status, 200, JSON.stringify(r1.body)); assert.strictEqual(r2.status, 200);
      assert.strictEqual(String(r1.body.user._id), String(a._id)); assert.strictEqual(String(r2.body.user._id), String(a._id));
      assert.ok(cache.stats().hits > before, 'a hit was counted');
      return `hits +${cache.stats().hits - before}`;
    });
    await check('a money route (protect) still gets a real Mongoose document while the cache holds the user', async () => {
      assert.ok(cache.get(keyOf(a)), 'the cache holds a');
      const r = await get('/api/zz/money-probe', tokenOf(a));
      assert.strictEqual(r.status, 200); assert.strictEqual(r.body.isDocument, true); assert.strictEqual(r.body.balance, 600);
    });

    section = '(2) other users:';
    await check('alternating requests of two accounts never mix them up (session, credits, unread count)', async () => {
      for (let i = 0; i < 4; i += 1) {
        for (const u of [a, b]) {
          const me = await get('/api/auth/me', tokenOf(u));
          assert.strictEqual(String(me.body.user._id), String(u._id));
          assert.strictEqual(me.body.user.email, u.email);
          const cr = await get('/api/credits', tokenOf(u)); assert.strictEqual(cr.status, 200);
          const n = await get('/api/notifications/unread-count', tokenOf(u)); assert.strictEqual(n.status, 200);
        }
      }
    });

    section = '(3) credits:';
    await check('a spend through the central helper shows on /credits at once (and clears the cached entry)', async () => {
      const before = await get('/api/credits', tokenOf(a));
      assert.strictEqual(before.body.credits.balance, 600);
      await get('/api/notifications/unread-count', tokenOf(a)); // make sure a is cached
      assert.ok(cache.get(keyOf(a)));
      const out = await quarkBuckets.spend(String(a._id), 10, { action: 'zz_auth_cache_check', description: 'auth cache check' });
      assert.strictEqual(out.success, true, JSON.stringify(out));
      assert.strictEqual(cache.get(keyOf(a)), undefined, 'the write hook cleared a');
      const after = await get('/api/credits', tokenOf(a));
      assert.strictEqual(after.body.credits.balance, 590);
      return '600 -> 590';
    });

    section = '(4) plan:';
    await check('the agency plan ends: the client pass is refused on the very next request; renewed: it works again', async () => {
      const ok = await get('/api/notifications/unread-count', pass);
      assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
      await User.updateOne({ _id: owner._id }, { $set: { 'plan.tier': 'starter' } });
      const no = await get('/api/notifications/unread-count', pass);
      assert.strictEqual(no.status, 401); assert.match(no.body.message, /agency plan is not active/);
      await User.updateOne({ _id: owner._id }, { $set: { 'plan.tier': 'agency' } });
      const back = await get('/api/notifications/unread-count', pass);
      assert.strictEqual(back.status, 200);
    });
    await check('a plan change is visible on /me straight away', async () => {
      await get('/api/auth/me', tokenOf(b));
      await User.updateOne({ _id: b._id }, { $set: { 'plan.tier': 'free' } });
      const me = await get('/api/auth/me', tokenOf(b));
      assert.strictEqual(me.body.user.plan.tier, 'free');
    });

    section = '(5) agency pass:';
    await check('the owner and the client pass never share an entry or an answer', async () => {
      for (let i = 0; i < 3; i += 1) {
        const o = await get('/api/auth/me', tokenOf(owner)); const p = await get('/api/auth/me', pass);
        assert.strictEqual(String(o.body.user._id), String(owner._id)); assert.strictEqual(o.body.actingAgency, null);
        assert.strictEqual(String(p.body.user._id), String(ws._id)); assert.ok(p.body.actingAgency && p.body.actingAgency.name, 'the pass names the agency');
      }
      const ownerEntry = cache.get(keyOf(owner)); const passEntry = cache.get(keyOf(ws, { actingAgency: String(owner._id) }));
      assert.ok(ownerEntry && passEntry, 'two separate entries');
      assert.strictEqual(String(ownerEntry.user._id), String(owner._id));
      assert.strictEqual(String(passEntry.user._id), String(ws._id));
      assert.strictEqual(cache.get(keyOf(ws)), undefined, 'no plain (no-pass) entry for the client was made');
      const own = await get('/api/credits', pass);
      assert.strictEqual(own.status, 200);
      assert.deepStrictEqual(own.body.credits.history, [], 'inside the client: the pool only, no agency history');
    });
    await check('a password URL is still blocked inside the client after the pass was cached', async () => {
      await get('/api/auth/me', pass);
      const r = await call('PUT', '/api/auth/change-password', pass, { currentPassword: 'x', newPassword: 'Another-pass-2' });
      assert.strictEqual(r.status, 403);
    });

    section = '(6) password:';
    await check('a password change clears the cached entry at once (the old token is not revoked today, as before)', async () => {
      await get('/api/auth/me', tokenOf(c));
      assert.ok(cache.get(keyOf(c)));
      const r = await call('PUT', '/api/auth/change-password', tokenOf(c), { currentPassword: PASSWORD, newPassword: 'Changed-pass-9' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.strictEqual(cache.get(keyOf(c)), undefined, 'cleared by the save hook');
      const me = await get('/api/auth/me', r.body.token);
      assert.strictEqual(me.status, 200);
    });

    section = '(7) deactivation and deletion:';
    await check('deactivated: refused on the very next request', async () => {
      await get('/api/auth/me', tokenOf(c));
      await User.updateOne({ _id: c._id }, { $set: { isActive: false } });
      const r = await get('/api/auth/me', tokenOf(c));
      assert.strictEqual(r.status, 401); assert.match(r.body.message, /deactivated/);
    });
    await check('deletion requested: the next non-account request is refused (423), /me still answers', async () => {
      await get('/api/notifications/unread-count', tokenOf(b));
      await User.updateOne({ _id: b._id }, { $set: { 'deletion.status': 'pending', 'deletion.purgeAfter': new Date(Date.now() + 14 * 864e5) } });
      const r = await get('/api/notifications/unread-count', tokenOf(b));
      assert.strictEqual(r.status, 423);
      const me = await get('/api/auth/me', tokenOf(b));
      assert.strictEqual(me.status, 200);
    });
    await check('deleted: refused on the very next request, and a missing user is never cached', async () => {
      await get('/api/auth/me', tokenOf(d));
      await User.deleteOne({ _id: d._id });
      const r = await get('/api/auth/me', tokenOf(d));
      assert.strictEqual(r.status, 401); assert.match(r.body.message, /no longer exists/);
      assert.strictEqual(cache.get(keyOf(d)), undefined);
    });

    section = '(8) staleness bound:';
    await check('a write that skips the model (like another server process) is seen at worst after the TTL', async () => {
      process.env.AUTH_CACHE_TTL_MS = '1500';
      const e = await mkUser('e');
      await get('/api/auth/me', tokenOf(e));
      await db.collection('users').updateOne({ _id: e._id }, { $set: { isActive: false } }); // no hook runs
      const stale = await get('/api/auth/me', tokenOf(e));
      await new Promise((r) => setTimeout(r, 1700));
      const fresh = await get('/api/auth/me', tokenOf(e));
      delete process.env.AUTH_CACHE_TTL_MS;
      assert.strictEqual(fresh.status, 401, 'refused after the TTL');
      return `inside the TTL: ${stale.status} (the documented bound), after: ${fresh.status}`;
    });
    await check('kill switch AUTH_CACHE=off: the same skipped write is seen at once, and nothing is cached', async () => {
      const f = await mkUser('f');
      await get('/api/auth/me', tokenOf(f));
      process.env.AUTH_CACHE = 'off';
      try {
        cache.clear();
        await get('/api/auth/me', tokenOf(f));
        assert.strictEqual(cache.size(), 0);
        await db.collection('users').updateOne({ _id: f._id }, { $set: { isActive: false } });
        const r = await get('/api/auth/me', tokenOf(f));
        assert.strictEqual(r.status, 401);
      } finally { delete process.env.AUTH_CACHE; }
    });
  } finally {
    await new Promise((r) => server.close(r));
  }
}

(async () => {
  let code = 0;
  try {
    await connect();
    if (process.argv[2] === 'cleanup') {
      const { left } = await cleanup(mongoose.connection.db);
      code = Object.values(left).some((n) => n > 0) ? 1 : 0;
    } else {
      try { await runChecks(); } finally {
        const { left } = await cleanup(mongoose.connection.db);
        if (Object.values(left).some((n) => n > 0)) { console.log('FAIL  leftovers after cleanup'); code = 1; }
      }
      const failed = results.filter((r) => !r.ok);
      console.log(`\n${results.length - failed.length} PASS, ${failed.length} FAIL`);
      if (failed.length) code = 1;
    }
  } catch (e) {
    console.error('check stopped:', e && e.message);
    code = 1;
  } finally {
    await mongoose.disconnect().catch(() => {});
    process.exit(code);
  }
})();
