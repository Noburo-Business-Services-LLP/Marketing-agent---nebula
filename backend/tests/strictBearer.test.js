'use strict';
// B6: one strict reading of "Authorization: Bearer <token>" everywhere. `Bearerx <token>`, a missing space, two
// tokens or another scheme are no token. HTTP-level for protect, protectCached and optionalAuth (in-process server),
// direct for the live inbox stream, the socket hub, the admin check and the per-user limiter key.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-strict-bearer-0123456789';
const SECRET = process.env.JWT_SECRET;
const { extractBearer, bearerFromHeader, plainToken } = require('../utils/bearer');
const auth = require('../middleware/auth');
const ac = require('../services/authCache');
const User = require('../models/User');

const id = new mongoose.Types.ObjectId();
const token = jwt.sign({ id: String(id), tv: 0 }, SECRET, { expiresIn: '1h' });
const fakeUsers = {
  schema: User.schema,
  findById(x) {
    const q = { isLean: false, select() { return q; }, lean() { q.isLean = true; return q; },
      then(res, rej) { const d = String(x) === String(id) ? { _id: id, email: 'a@x.test', isActive: true, tokenVersion: 0 } : null; return Promise.resolve(d && !q.isLean ? User.hydrate(d) : d).then(res, rej); } };
    return q;
  }
};

test('extractBearer: only "Bearer <one token>" in any case', () => {
  assert.strictEqual(bearerFromHeader(`Bearer ${token}`), token);
  assert.strictEqual(bearerFromHeader(`bearer ${token}`), token);
  assert.strictEqual(bearerFromHeader(`BEARER   ${token}`), token);
  for (const bad of [`Bearerx ${token}`, `Bearer${token}`, 'Bearer', 'Bearer ', `Bearer ${token} extra`, `Basic ${token}`, ` Bearer ${token}x y`, token, '', undefined, null, 42]) {
    assert.strictEqual(bearerFromHeader(bad), '', String(bad));
  }
  assert.strictEqual(extractBearer({ headers: { authorization: `Bearer ${token}` } }), token);
  assert.strictEqual(extractBearer({}), '');
  assert.strictEqual(plainToken(token), token);
  assert.strictEqual(plainToken(`Bearer ${token}`), '');
});

async function serve(mw) {
  const app = express();
  app.get('/x', mw, (req, res) => res.json({ user: req.user ? String(req.user._id || req.user.id) : null }));
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const get = (authorization) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: '/x', headers: authorization === undefined ? {} : { authorization } }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(b) }));
    });
    req.on('error', reject); req.end();
  });
  return { get, close: () => new Promise((r) => server.close(r)) };
}

const cases = {
  protect: () => auth.createProtect({ UserModel: fakeUsers, demoMode: false }),
  protectCached: () => auth.createProtectCached({ UserModel: fakeUsers, demoMode: false, cache: ac.createAuthCache({ ttlMs: 15000 }), settings: () => ({ enabled: true, ttlMs: 15000, max: 10 }) })
};
for (const [name, make] of Object.entries(cases)) {
  test(`${name}: "Bearer" and "bearer" pass, "Bearerx", no space and two tokens are 401`, async () => {
    const s = await serve(make());
    try {
      assert.strictEqual((await s.get(`Bearer ${token}`)).status, 200);
      assert.strictEqual((await s.get(`bearer ${token}`)).status, 200);
      for (const bad of [`Bearerx ${token}`, `Bearer${token}`, `Bearer ${token} more`, `Basic ${token}`, undefined]) {
        assert.strictEqual((await s.get(bad)).status, 401, String(bad));
      }
    } finally { await s.close(); }
  });
}

test('optionalAuth: a malformed header means no user, a strict one is read', async () => {
  const s = await serve(auth.createOptionalAuth({ UserModel: fakeUsers, demoMode: false }));
  try {
    assert.strictEqual((await s.get(`Bearer ${token}`)).body.user, String(id));
    assert.strictEqual((await s.get(`Bearerx ${token}`)).body.user, null);
    assert.strictEqual((await s.get(`Bearer${token}`)).body.user, null);
  } finally { await s.close(); }
});

test('the live inbox stream and the socket hub refuse "Bearerx", accept a strict header or a plain token', async () => {
  const saved = User.findById;
  User.findById = fakeUsers.findById;
  try {
    const { streamAuth } = require('../routes/socialInboxRoutes');
    const run = (req) => new Promise((resolve) => {
      const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json() { resolve(this.statusCode); } };
      streamAuth({ query: {}, headers: {}, ...req }, res, () => resolve(200));
    });
    assert.strictEqual(await run({ headers: { authorization: `Bearer ${token}` } }), 200);
    assert.strictEqual(await run({ query: { token } }), 200);
    assert.strictEqual(await run({ headers: { authorization: `Bearerx ${token}` } }), 401);
    assert.strictEqual(await run({ query: { token: `Bearer ${token}` } }), 401);

    const { socketAuth } = require('../services/socketHub');
    const sock = (handshake) => new Promise((resolve) => { const socket = { handshake: { auth: {}, query: {}, headers: {}, ...handshake } }; socketAuth(socket, (err) => resolve(err ? 'refused' : socket.userId)); });
    assert.strictEqual(await sock({ auth: { token } }), String(id));
    assert.strictEqual(await sock({ headers: { authorization: `Bearer ${token}` } }), String(id));
    assert.strictEqual(await sock({ headers: { authorization: `Bearerx ${token}` } }), 'refused');
    assert.strictEqual(await sock({ auth: { token: `x ${token}` } }), 'refused');
  } finally { User.findById = saved; }
});

test('the per-user limiter key and the admin check read the header the same strict way', () => {
  const { tokenUserId } = require('../middleware/rateLimits');
  assert.strictEqual(tokenUserId({ headers: { authorization: `bearer ${token}` } }), String(id));
  assert.strictEqual(tokenUserId({ headers: { authorization: `Bearerx ${token}` } }), '');
  const adminAuth = require('../middleware/adminAuth');
  const adminToken = jwt.sign({ role: 'admin' }, SECRET);
  let status = 0; let passed = false;
  const res = { status(c) { status = c; return this; }, json() { return this; } };
  adminAuth({ headers: { authorization: `Bearerx ${adminToken}` } }, res, () => { passed = true; });
  assert.strictEqual(passed, false); assert.strictEqual(status, 401);
  adminAuth({ headers: { authorization: `Bearer ${adminToken}` } }, res, () => { passed = true; });
  assert.strictEqual(passed, true);
});

test('guard: no other file parses the Authorization header by hand', () => {
  const root = path.join(__dirname, '..');
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'tests', 'scripts', 'public', 'storage'].includes(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js') && p !== path.join(root, 'utils', 'bearer.js')) {
        const src = fs.readFileSync(p, 'utf8');
        if (/headers\.authorization\b[^\n]*(split|startsWith|replace|slice)|startsWith\(['"]Bearer/.test(src)) offenders.push(path.relative(root, p));
      }
    }
  };
  walk(root);
  assert.deepStrictEqual(offenders, []);
});
