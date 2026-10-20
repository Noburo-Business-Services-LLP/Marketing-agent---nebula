'use strict';
// backend/tests/authCache.test.js: the short in-process auth cache behind `protectCached` (see docs/superpowers/ops/auth-cache.md).
// `protect` must stay exactly as it was (full, fresh document, never the cache); `protectCached` must give the same
// answers for every case while reading the user lean and from a short cache.
const test = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-auth-cache';
const SECRET = process.env.JWT_SECRET;

const ac = require('../services/authCache');
const hooks = require('../services/authCacheHooks');
const auth = require('../middleware/auth');
const UserModelReal = require('../models/User');
const UserSchema = UserModelReal.schema;

const oid = () => new mongoose.Types.ObjectId();

// ---- fakes -------------------------------------------------------------------------------------------------------
function fakeUsers(seed = []) {
  const docs = new Map(seed.map((d) => [String(d._id), d]));
  const calls = [];
  const plain = (d) => JSON.parse(JSON.stringify(d), (k, v) => (k === '_id' || k === 'ownerId' || k === 'assignedCsm') && typeof v === 'string' && /^[a-f0-9]{24}$/.test(v) ? new mongoose.Types.ObjectId(v) : (k === 'purgeAfter' && typeof v === 'string' ? new Date(v) : v));
  const project = (d, sel) => {
    if (!sel) return d;
    const out = { _id: d._id };
    for (const p of String(sel).split(/\s+/).filter(Boolean)) {
      const [a, b] = p.split('.');
      if (b) { if (d[a] && d[a][b] !== undefined) { out[a] = out[a] || {}; out[a][b] = d[a][b]; } } else if (d[a] !== undefined) out[a] = d[a];
    }
    return out;
  };
  // A real (hydrated) Mongoose document, with schema defaults and the `id` virtual, whose save writes to this fake.
  const asDoc = (d) => {
    const doc = UserModelReal.hydrate(plain(d));
    doc.isDoc = true; doc.saved = 0;
    doc.save = async function () { this.saved += 1; docs.set(String(this._id), { ...docs.get(String(this._id)), firstName: this.firstName }); return this; };
    return doc;
  };
  const model = {
    schema: UserSchema,
    calls,
    docs,
    findById(id) {
      const q = {
        sel: null, isLean: false,
        select(s) { q.sel = s; return q; },
        lean() { q.isLean = true; return q; },
        then(res, rej) {
          calls.push({ id: String(id), sel: q.sel, lean: q.isLean });
          const d = docs.get(String(id));
          const out = !d ? null : (q.isLean ? project(plain(d), q.sel) : asDoc(d));
          return Promise.resolve(out).then(res, rej);
        }
      };
      return q;
    }
  };
  return model;
}
function run(mw, { token, url = '/api/notifications', method = 'GET' } = {}) {
  return new Promise((resolve) => {
    const req = { headers: token ? { authorization: `Bearer ${token}` } : {}, originalUrl: url, method };
    const res = {
      statusCode: 200, body: null,
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; resolve({ req, res: this, nexted: false }); return this; }
    };
    Promise.resolve(mw(req, res, () => resolve({ req, res, nexted: true }))).catch((e) => resolve({ req, res, error: e }));
  });
}
const sign = (payload, opts = {}) => jwt.sign(payload, SECRET, { expiresIn: '1h', ...opts });
function clock(start = 1e12) { let t = start; const f = () => t; f.add = (ms) => { t += ms; }; return f; }
const settingsOn = () => ({ enabled: true, ttlMs: 15000, max: 5000 });
function cached(users, { now = clock(), settings = settingsOn, cache } = {}) {
  const c = cache || ac.createAuthCache({ ttlMs: () => settings().ttlMs, max: () => settings().max, now });
  return { cache: c, mw: auth.createProtectCached({ UserModel: users, cache: c, demoMode: false, settings }), full: auth.createProtect({ UserModel: users, demoMode: false }) };
}

// ---- world ------------------------------------------------------------------------------------------------------
function world() {
  const plainId = oid(); const owner = oid(); const ws = oid(); const csm = oid(); const client = oid(); const gone = oid(); const off = oid(); const dying = oid();
  const users = fakeUsers([
    { _id: plainId, email: 'a@x.io', firstName: 'Asha', isVerified: true, businessProfile: { brandName: 'Big' }, credits: { balance: 100 } },
    { _id: owner, email: 'o@x.io', firstName: 'Ola', isActive: true, plan: { tier: 'agency' }, subscription: { status: 'active' } },
    { _id: ws, email: 'w@x.io', firstName: 'Client', agency: { ownerId: owner, frozen: false } },
    { _id: csm, email: 'c@x.io', firstName: 'Cee', staffRole: 'admin', isActive: true },
    { _id: client, email: 'cl@x.io', firstName: 'Cli' },
    { _id: off, email: 'off@x.io', isActive: false },
    { _id: dying, email: 'd@x.io', deletion: { status: 'pending', purgeAfter: '2026-11-01T00:00:00.000Z' } }
  ]);
  return { users, plainId, owner, ws, csm, client, gone, off, dying };
}

// ---- the cache itself -------------------------------------------------------------------------------------------
test('cache: miss, hit, expiry after the TTL, and stats', () => {
  const now = clock();
  const c = ac.createAuthCache({ ttlMs: 15000, max: 10, now });
  assert.strictEqual(c.get('k'), undefined);
  assert.ok(c.set('k', { v: 1 }, ['u1'], c.ticket()));
  assert.deepStrictEqual(c.get('k'), { v: 1 });
  now.add(14999); assert.ok(c.get('k'));
  now.add(2); assert.strictEqual(c.get('k'), undefined, 'expired');
  assert.strictEqual(c.size(), 0);
  const s = c.stats(); assert.strictEqual(s.hits, 2); assert.strictEqual(s.misses, 2);
});

test('cache: bounded LRU, the least recently used entry goes first', () => {
  const c = ac.createAuthCache({ ttlMs: 15000, max: 3, now: clock() });
  for (const k of ['a', 'b', 'c']) c.set(k, k, [k], c.ticket());
  c.get('a'); // a is now the newest
  c.set('d', 'd', ['d'], c.ticket());
  assert.strictEqual(c.size(), 3);
  assert.strictEqual(c.get('b'), undefined, 'b was the oldest');
  assert.strictEqual(c.get('a'), 'a');
  c.invalidateUser('d'); assert.strictEqual(c.get('d'), undefined, 'index kept in step with eviction');
});

test('cache: invalidating any user named in an entry clears it; clear() clears everything', () => {
  const c = ac.createAuthCache({ ttlMs: 15000, max: 10, now: clock() });
  c.set('ws|c:|a:owner', 1, ['ws', 'owner'], c.ticket());
  c.set('owner|c:|a:', 2, ['owner'], c.ticket());
  c.set('other|c:|a:', 3, ['other'], c.ticket());
  c.invalidateUser('owner');
  assert.strictEqual(c.get('ws|c:|a:owner'), undefined);
  assert.strictEqual(c.get('owner|c:|a:'), undefined);
  assert.strictEqual(c.get('other|c:|a:'), 3);
  c.clear(); assert.strictEqual(c.size(), 0);
});

test('cache: a load that started before an invalidation is not stored (no stale write-back)', () => {
  const c = ac.createAuthCache({ ttlMs: 15000, max: 10, now: clock() });
  const t = c.ticket();
  c.invalidateUser('someone-else');
  assert.strictEqual(c.set('k', 1, ['u'], t), false);
  assert.strictEqual(c.get('k'), undefined);
  assert.strictEqual(c.set('k', 1, ['u'], c.ticket()), true);
});

test('settings: 15 s default, AUTH_CACHE=off kill switch, TTL parse and 60 s cap, 0 means off', () => {
  assert.deepStrictEqual(ac.settings({}), { enabled: true, ttlMs: 15000, max: 5000 });
  assert.strictEqual(ac.settings({ AUTH_CACHE: 'off' }).enabled, false);
  assert.strictEqual(ac.settings({ AUTH_CACHE: 'OFF' }).enabled, false);
  assert.strictEqual(ac.settings({ AUTH_CACHE_TTL_MS: '30000' }).ttlMs, 30000);
  assert.strictEqual(ac.settings({ AUTH_CACHE_TTL_MS: '999999' }).ttlMs, 60000);
  assert.strictEqual(ac.settings({ AUTH_CACHE_TTL_MS: 'nonsense' }).ttlMs, 15000);
  assert.strictEqual(ac.settings({ AUTH_CACHE_TTL_MS: '0' }).enabled, false);
});

test('key: the pass context is part of the key, so an owner, a client pass and a CSM pass never share an entry', () => {
  assert.strictEqual(ac.keyFor({ id: 'u' }), 'u|c:|a:');
  assert.strictEqual(ac.keyFor({ id: 'w', actingAgency: 'o' }), 'w|c:|a:o');
  assert.strictEqual(ac.keyFor({ id: 'w', actingCsm: 's' }), 'w|c:s|a:');
  assert.notStrictEqual(ac.keyFor({ id: 'w' }), ac.keyFor({ id: 'w', actingCsm: 's' }));
});

test('freeze: plain objects and arrays are frozen deeply; ObjectIds and Dates still work', () => {
  const id = oid();
  const u = ac.deepFreeze({ _id: id, a: { b: [1, { c: 2 }] }, when: new Date(5) });
  assert.ok(Object.isFrozen(u)); assert.ok(Object.isFrozen(u.a)); assert.ok(Object.isFrozen(u.a.b[1]));
  assert.strictEqual(String(u._id), String(id));
  assert.strictEqual(u.when.getTime(), 5);
  assert.throws(() => { u.a.b[1].c = 3; }, TypeError);
});

test('filters: an update by _id names that user; anything wider means clear all', () => {
  const a = oid(); const b = oid();
  assert.deepStrictEqual(ac.idsInFilter({ _id: a }), [String(a)]);
  assert.deepStrictEqual(ac.idsInFilter({ _id: String(a), 'credits.balance': { $gte: 5 } }), [String(a)]);
  assert.deepStrictEqual(ac.idsInFilter({ _id: { $in: [a, b] } }), [String(a), String(b)]);
  assert.deepStrictEqual(ac.idsInFilter({ _id: { $eq: a } }), [String(a)]);
  assert.strictEqual(ac.idsInFilter({ email: 'x' }), null);
  assert.strictEqual(ac.idsInFilter({ 'agency.ownerId': a }), null);
  assert.strictEqual(ac.idsInFilter({ _id: { $ne: a } }), null);
  assert.strictEqual(ac.idsInFilter({}), null);
  assert.strictEqual(ac.idsInFilter(null), null);
});

// ---- write hooks -------------------------------------------------------------------------------------------------
test('hooks: save, every update/delete query, bulkWrite and insertMany on the User schema clear the cache', () => {
  const posts = UserSchema.s.hooks._posts; const pres = UserSchema.s.hooks._pres;
  for (const op of ['save', 'updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndReplace', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete', 'bulkWrite', 'insertMany']) {
    assert.ok((pres.get(op) || []).some((h) => h.fn && h.fn[hooks.MARK]), `pre ${op}`);
    assert.ok((posts.get(op) || []).some((h) => h.fn && h.fn[hooks.MARK]), `post ${op}`);
  }
});

test('hooks: a document save or a query by _id clears that user; a wide query clears everything', () => {
  const c = ac.createAuthCache({ ttlMs: 15000, max: 10, now: clock() });
  const a = oid(); const b = oid();
  const fill = () => { c.set(`${a}|c:|a:`, 1, [String(a)], c.ticket()); c.set(`${b}|c:|a:`, 2, [String(b)], c.ticket()); };
  const fns = hooks.createHookFns(() => c);
  fill(); fns.onDocument.call({ _id: a }); assert.strictEqual(c.get(`${a}|c:|a:`), undefined); assert.strictEqual(c.get(`${b}|c:|a:`), 2);
  fill(); fns.onQuery.call({ getFilter: () => ({ _id: b }) }); assert.strictEqual(c.get(`${b}|c:|a:`), undefined); assert.strictEqual(c.get(`${a}|c:|a:`), 1);
  fill(); fns.onQuery.call({ getFilter: () => ({ 'agency.ownerId': a }) }); assert.strictEqual(c.size(), 0);
  fill(); fns.onModel.call({}); assert.strictEqual(c.size(), 0);
  // a hook never throws into the write
  assert.doesNotThrow(() => hooks.createHookFns(() => { throw new Error('x'); }).onQuery.call({}));
});

// ---- protect vs protectCached: identical answers ------------------------------------------------------------------
function scenarios(w) {
  return [
    ['plain user', { token: sign({ id: String(w.plainId) }) }],
    ['missing user', { token: sign({ id: String(w.gone) }) }],
    ['deactivated', { token: sign({ id: String(w.off) }) }],
    ['deletion pending, other route', { token: sign({ id: String(w.dying) }), url: '/api/campaigns' }],
    ['deletion pending, /me', { token: sign({ id: String(w.dying) }), url: '/api/auth/me' }],
    ['csm pass ok', { token: sign({ id: String(w.client), actingCsm: String(w.csm) }) }],
    ['csm pass, payment blocked', { token: sign({ id: String(w.client), actingCsm: String(w.csm) }), url: '/api/payment/create-order', method: 'POST' }],
    ['csm pass, csm missing', { token: sign({ id: String(w.client), actingCsm: String(w.gone) }) }],
    ['agency pass ok', { token: sign({ id: String(w.ws), actingAgency: String(w.owner) }) }],
    ['agency pass, blocked', { token: sign({ id: String(w.ws), actingAgency: String(w.owner) }), url: '/api/payment/verify', method: 'POST' }],
    ['agency pass, wrong owner', { token: sign({ id: String(w.ws), actingAgency: String(w.plainId) }) }],
    ['no token', {}],
    ['bad token', { token: 'nope' }],
    ['expired token', { token: sign({ id: String(w.plainId) }, { expiresIn: -10 }) }],
    ['wrong secret', { token: jwt.sign({ id: String(w.plainId) }, 'other') }]
  ];
}
const view = (r) => ({ nexted: r.nexted, status: r.nexted ? null : r.res.statusCode, body: r.nexted ? null : r.res.body, user: r.nexted && r.req.user ? String(r.req.user._id) : null, csm: r.req.actingCsm ? r.req.actingCsm.firstName : null, agency: r.req.actingAgency ? r.req.actingAgency.firstName : null });

test('parity: protectCached answers every case exactly like protect, on a miss and again on a hit', async () => {
  const w = world();
  const { mw, full } = cached(w.users);
  for (const [name, args] of scenarios(w)) {
    const a = view(await run(full, args));
    const b = view(await run(mw, args));
    const c = view(await run(mw, args));
    assert.deepStrictEqual(b, a, `${name} (miss)`);
    assert.deepStrictEqual(c, a, `${name} (hit)`);
  }
});

test('protect is unchanged: a real, fresh document every time, never the cache, and a save works', async () => {
  const w = world();
  const { cache, mw, full } = cached(w.users);
  const token = sign({ id: String(w.plainId) });
  await run(mw, { token }); // fills the cache
  const before = w.users.calls.length;
  const r = await run(full, { token });
  assert.ok(r.nexted);
  assert.strictEqual(r.req.user.isDoc, true);
  assert.strictEqual(w.users.calls.length, before + 1, 'protect read the database');
  assert.strictEqual(w.users.calls.at(-1).lean, false, 'and not lean');
  assert.strictEqual(r.req.user.credits.balance, 100, 'whole document, money fields included');
  r.req.user.firstName = 'Changed'; await r.req.user.save();
  assert.strictEqual(r.req.user.saved, 1);
  assert.strictEqual(cache.size(), 1, 'protect neither reads nor writes the cache');
});

test('protectCached: a lean, projected, frozen user with id and _id; the second request is served from the cache', async () => {
  const w = world();
  const { mw } = cached(w.users);
  const token = sign({ id: String(w.plainId) });
  const r1 = await run(mw, { token });
  assert.ok(r1.nexted);
  const u = r1.req.user;
  assert.strictEqual(typeof u.id, 'string'); assert.strictEqual(u.id, String(w.plainId));
  assert.strictEqual(String(u._id), String(w.plainId));
  assert.strictEqual(u.isDoc, undefined, 'not a document'); assert.strictEqual(u.save, undefined);
  assert.strictEqual(u.businessProfile, undefined, 'projected: no heavy fields'); assert.strictEqual(u.credits, undefined, 'and no money fields');
  assert.strictEqual(u.isActive, true, 'schema default applied to a missing field');
  assert.ok(Object.isFrozen(u));
  assert.throws(() => { u.firstName = 'x'; }, TypeError, 'writes are caught');
  assert.strictEqual(w.users.calls.at(-1).lean, true);
  assert.strictEqual(w.users.calls.at(-1).sel, auth.AUTH_FIELDS);
  const n = w.users.calls.length;
  const r2 = await run(mw, { token });
  assert.ok(r2.nexted); assert.strictEqual(w.users.calls.length, n, 'hit: no database read');
  assert.strictEqual(r2.req.authCached, true); assert.strictEqual(r1.req.authCached, false);
});

test('protectCached: expiry reloads; invalidation reloads at once', async () => {
  const w = world(); const now = clock();
  const { cache, mw } = cached(w.users, { now });
  const token = sign({ id: String(w.plainId) });
  await run(mw, { token }); let n = w.users.calls.length;
  now.add(15001); await run(mw, { token }); assert.strictEqual(w.users.calls.length, n + 1, 'reloaded after TTL');
  n = w.users.calls.length;
  cache.invalidateUser(String(w.plainId)); await run(mw, { token }); assert.strictEqual(w.users.calls.length, n + 1, 'reloaded after invalidation');
});

test('protectCached: a deleted or deactivated user is rejected right after invalidation, and at worst after the TTL', async () => {
  const w = world(); const now = clock();
  const { cache, mw } = cached(w.users, { now });
  const token = sign({ id: String(w.plainId) });
  assert.ok((await run(mw, { token })).nexted);
  w.users.docs.delete(String(w.plainId));
  cache.invalidateUser(String(w.plainId));
  const r = await run(mw, { token });
  assert.strictEqual(r.res.statusCode, 401); assert.match(r.res.body.message, /no longer exists/);
  // without an invalidation (another server process): rejected once the entry ages out
  const t2 = sign({ id: String(w.client) });
  assert.ok((await run(mw, { token: t2 })).nexted);
  w.users.docs.set(String(w.client), { ...w.users.docs.get(String(w.client)), isActive: false });
  now.add(15001);
  const r2 = await run(mw, { token: t2 });
  assert.strictEqual(r2.res.statusCode, 401); assert.match(r2.res.body.message, /deactivated/);
});

test('protectCached: a missing user, a failed pass check or a bad token is never cached', async () => {
  const w = world();
  const { cache, mw } = cached(w.users);
  await run(mw, { token: sign({ id: String(w.gone) }) });
  await run(mw, { token: sign({ id: String(w.gone) }) });
  assert.strictEqual(w.users.calls.filter((c) => c.id === String(w.gone)).length, 2);
  await run(mw, { token: sign({ id: String(w.ws), actingAgency: String(w.plainId) }) });
  await run(mw, { token: sign({ id: String(w.off) }) });
  await run(mw, { token: 'bad' });
  assert.strictEqual(cache.size(), 0);
});

test('protectCached: owner and client pass are isolated; the owner losing the plan ends the pass at once', async () => {
  const w = world();
  const { cache, mw } = cached(w.users);
  const ownerTok = sign({ id: String(w.owner) });
  const passTok = sign({ id: String(w.ws), actingAgency: String(w.owner) });
  const a = await run(mw, { token: ownerTok }); const b = await run(mw, { token: passTok });
  assert.strictEqual(String(a.req.user._id), String(w.owner)); assert.strictEqual(a.req.actingAgency, undefined);
  assert.strictEqual(String(b.req.user._id), String(w.ws)); assert.strictEqual(b.req.actingAgency.firstName, 'Ola');
  const a2 = await run(mw, { token: ownerTok }); const b2 = await run(mw, { token: passTok });
  assert.strictEqual(String(a2.req.user._id), String(w.owner)); assert.strictEqual(String(b2.req.user._id), String(w.ws));
  assert.strictEqual(cache.size(), 2);
  // the client's own CSM pass and plain login do not share either
  const own = await run(mw, { token: sign({ id: String(w.client) }) });
  const viaCsm = await run(mw, { token: sign({ id: String(w.client), actingCsm: String(w.csm) }) });
  assert.strictEqual(own.req.actingCsm, undefined); assert.strictEqual(viaCsm.req.actingCsm.firstName, 'Cee');
  // the owner's plan ends: the write hook invalidates the owner id, which also clears the client pass entry
  w.users.docs.set(String(w.owner), { ...w.users.docs.get(String(w.owner)), plan: { tier: 'starter' } });
  cache.invalidateUser(String(w.owner));
  const b3 = await run(mw, { token: passTok });
  assert.strictEqual(b3.res.statusCode, 401); assert.match(b3.res.body.message, /agency plan is not active/);
});

test('protectCached: kill switch AUTH_CACHE=off behaves exactly like protect (full document, no cache)', async () => {
  const w = world();
  const off = () => ({ enabled: false, ttlMs: 15000, max: 5000 });
  const { cache, mw } = cached(w.users, { settings: off });
  const token = sign({ id: String(w.plainId) });
  const r = await run(mw, { token }); await run(mw, { token });
  assert.strictEqual(r.req.user.isDoc, true);
  assert.strictEqual(w.users.calls.filter((c) => c.id === String(w.plainId)).length, 2);
  assert.strictEqual(cache.size(), 0);
});

test('loadFullUser: a fresh full document on demand (never the cache), loaded once per request', async () => {
  const w = world();
  const { mw } = cached(w.users);
  const token = sign({ id: String(w.plainId) });
  await run(mw, { token });
  const r = await run(mw, { token });
  const n = w.users.calls.length;
  w.users.docs.set(String(w.plainId), { ...w.users.docs.get(String(w.plainId)), credits: { balance: 40 } }); // spent elsewhere
  const doc = await r.req.loadFullUser();
  assert.strictEqual(doc.isDoc, true); assert.strictEqual(doc.credits.balance, 40, 'fresh balance');
  assert.strictEqual(w.users.calls.length, n + 1); assert.strictEqual(w.users.calls.at(-1).lean, false);
  await r.req.loadFullUser(); assert.strictEqual(w.users.calls.length, n + 1, 'memoised within the request');
  // protect gives the same helper, returning the document it already has
  const f = await run(auth.createProtect({ UserModel: w.users, demoMode: false }), { token });
  assert.strictEqual(await f.req.loadFullUser(), f.req.user);
});

test('requireFullUser: swaps the cached user for a fresh document, so a route that saves keeps working', async () => {
  const w = world();
  const { mw } = cached(w.users);
  const token = sign({ id: String(w.plainId) });
  await run(mw, { token });
  const r = await run(mw, { token });
  let nexted = false;
  await auth.requireFullUser(r.req, { status() { return this; }, json() {} }, () => { nexted = true; });
  assert.ok(nexted);
  assert.strictEqual(r.req.user.isDoc, true);
  r.req.user.firstName = 'Saved'; await r.req.user.save();
  assert.strictEqual(w.users.docs.get(String(w.plainId)).firstName, 'Saved');
});

// ---- wiring --------------------------------------------------------------------------------------------------------
function layersFor(router, method, path) {
  const l = router.stack.find((x) => x.route && x.route.path === path && x.route.methods[method]);
  assert.ok(l, `${method} ${path} exists`);
  return l.route.stack.map((s) => s.handle);
}
test('wiring: only the hot read routes use protectCached; money routes keep protect', () => {
  assert.ok(layersFor(require('../routes/credits'), 'get', '/').includes(auth.protectCached));
  assert.ok(layersFor(require('../routes/credits'), 'get', '/history').includes(auth.protectCached));
  assert.ok(layersFor(require('../routes/notifications'), 'get', '/').includes(auth.protectCached));
  assert.ok(layersFor(require('../routes/notifications'), 'get', '/unread-count').includes(auth.protectCached));
  assert.ok(layersFor(require('../routes/auth'), 'get', '/me').includes(auth.protectCached));
  assert.ok(layersFor(require('../routes/home').createHomeRouter({}), 'get', '/summary').includes(auth.protectCached));
  for (const file of ['payment', 'studioVideos', 'photoshoot', 'drafts', 'account', 'agency', 'staff']) {
    const r = require(`../routes/${file}`);
    const router = typeof r === 'function' && r.stack ? r : (r.router || r);
    for (const l of (router.stack || [])) {
      const handles = l.route ? l.route.stack.map((s) => s.handle) : [l.handle];
      assert.ok(!handles.includes(auth.protectCached), `${file} does not use the cache`);
    }
  }
  // the write routes of the switched files stay on protect
  assert.ok(layersFor(require('../routes/notifications'), 'put', '/read-all').includes(auth.protect));
  assert.ok(layersFor(require('../routes/auth'), 'put', '/change-password').includes(auth.protect));
});

test('home summary: a home-cache miss builds from a fresh full document, a hit reads no user at all', async () => {
  const built = [];
  const store = new Map();
  const homeCache = { get: (k) => store.get(k), set: (k, v) => store.set(k, v), invalidate: () => {} };
  const router = require('../routes/home').createHomeRouter({ cache: homeCache, service: { build: async ({ user, pass }) => { built.push({ user, pass }); return { n: 1 }; } } });
  const handlers = layersFor(router, 'get', '/summary');
  const final = handlers[handlers.length - 1];
  const fresh = { _id: 'u1', isDoc: true, credits: { balance: 7 } };
  let loads = 0;
  const call = () => new Promise((resolve) => {
    const req = { user: Object.freeze({ _id: 'u1', id: 'u1' }), query: {}, loadFullUser: async () => { loads += 1; return fresh; } };
    const res = { set() {}, status(c) { this.statusCode = c; return this; }, json(b) { resolve({ res: this, body: b }); } };
    final(req, res);
  });
  const a = await call();
  assert.strictEqual(a.body.cached, false); assert.strictEqual(built[0].user, fresh); assert.strictEqual(loads, 1);
  const b = await call();
  assert.strictEqual(b.body.cached, true); assert.strictEqual(loads, 1, 'hit: no user read');
});
