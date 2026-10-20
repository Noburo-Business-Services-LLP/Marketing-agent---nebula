'use strict';
// A password change signs out the account's other sessions: every session token carries the account's token version
// (`tv`), a password change raises the version, and `protect`, `protectCached`, the live inbox stream and the socket
// hub refuse a token whose version is older. Tokens issued before this change carry no version and count as 0, so
// nobody is signed out by the release itself. Agency and CSM passes are not session tokens (they carry no version).
const test = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-token-version';
const SECRET = process.env.JWT_SECRET;
const auth = require('../middleware/auth');
const ac = require('../services/authCache');
const User = require('../models/User');

const oid = () => new mongoose.Types.ObjectId();

function fakeUsers(seed) {
  const docs = new Map(seed.map((d) => [String(d._id), d]));
  return {
    schema: User.schema,
    docs,
    findById(id) {
      const q = {
        sel: null, isLean: false,
        select(s) { q.sel = s; return q; },
        lean() { q.isLean = true; return q; },
        then(res, rej) {
          const d = docs.get(String(id));
          const out = !d ? null : (q.isLean ? { ...d } : User.hydrate({ ...d }));
          return Promise.resolve(out).then(res, rej);
        }
      };
      return q;
    }
  };
}
function run(mw, token) {
  return new Promise((resolve) => {
    const req = { headers: { authorization: `Bearer ${token}` }, originalUrl: '/api/notifications', method: 'GET' };
    const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; resolve({ res: this, nexted: false }); return this; } };
    Promise.resolve(mw(req, res, () => resolve({ res, nexted: true }))).catch((e) => resolve({ res, error: e }));
  });
}
const sign = (p) => jwt.sign(p, SECRET, { expiresIn: '1h' });

test('a new session token carries the account token version', () => {
  const d = jwt.verify(auth.generateToken('abc', 3), SECRET);
  assert.strictEqual(d.id, 'abc');
  assert.strictEqual(d.tv, 3);
  assert.strictEqual(jwt.verify(auth.generateToken('abc'), SECRET).tv, 0);
});

test('the schema has tokenVersion (default 0) and the lean auth read includes it', () => {
  assert.strictEqual(new User({ email: 'zz@x.test' }).tokenVersion, 0);
  assert.ok(auth.AUTH_FIELDS.split(' ').includes('tokenVersion'));
});

for (const kind of ['protect', 'protectCached']) {
  test(`${kind}: an older version is refused, the current one and an old token without a version (account at 0) pass`, async () => {
    const changed = oid(); const untouched = oid();
    const users = fakeUsers([{ _id: changed, email: 'a@x.test', isActive: true, tokenVersion: 2 }, { _id: untouched, email: 'b@x.test', isActive: true }]);
    const cache = ac.createAuthCache({ ttlMs: 15000, max: 100 });
    const mw = kind === 'protect'
      ? auth.createProtect({ UserModel: users, demoMode: false })
      : auth.createProtectCached({ UserModel: users, cache, demoMode: false, settings: () => ({ enabled: true, ttlMs: 15000, max: 100 }) });
    const old = await run(mw, sign({ id: String(changed), tv: 1 }));
    assert.strictEqual(old.nexted, false);
    assert.strictEqual(old.res.statusCode, 401);
    assert.match(old.res.body.message, /password was changed/i);
    const noVersion = await run(mw, sign({ id: String(changed) }));
    assert.strictEqual(noVersion.res.statusCode, 401, 'a token from before the change is version 0, older than 2');
    assert.strictEqual((await run(mw, sign({ id: String(changed), tv: 2 }))).nexted, true);
    assert.strictEqual((await run(mw, sign({ id: String(untouched) }))).nexted, true, 'nobody is signed out by the release');
    if (kind === 'protectCached') {
      // A cached state from the current token never lets an older token through.
      assert.strictEqual((await run(mw, sign({ id: String(changed), tv: 2 }))).nexted, true);
      assert.strictEqual((await run(mw, sign({ id: String(changed), tv: 1 }))).res.statusCode, 401);
    }
  });
}

test('agency and CSM passes carry no version and are not affected by it', async () => {
  const client = oid(); const csm = oid();
  const users = fakeUsers([
    { _id: client, email: 'cl@x.test', isActive: true, tokenVersion: 4 },
    { _id: csm, email: 'c@x.test', staffRole: 'admin', isActive: true }
  ]);
  const mw = auth.createProtect({ UserModel: users, demoMode: false });
  const r = await run(mw, sign({ id: String(client), actingCsm: String(csm) }));
  assert.strictEqual(r.nexted, true);
});

test('the live stream and socket checks refuse an older version too', async () => {
  const u = { _id: oid(), isActive: true, tokenVersion: 1 };
  assert.match(await auth._tokenProblem({ id: String(u._id), tv: 0 }, u), /password was changed/i);
  assert.strictEqual(await auth._tokenProblem({ id: String(u._id), tv: 1 }, u), '');
});

test('changing the password raises the version (saving anything else does not)', async () => {
  const doc = new User({ email: 'zz.tv@x.test', password: 'secret123', firstName: 'Z' });
  doc.isNew = false;
  doc.$__reset();
  doc.firstName = 'Y';
  await runPreSave(doc);
  assert.strictEqual(doc.tokenVersion, 0);
  doc.password = 'another123';
  await runPreSave(doc);
  assert.strictEqual(doc.tokenVersion, 1);
});

/** Runs the schema's pre('save') hooks without a database. */
async function runPreSave(doc) {
  const hooks = User.schema.s.hooks._pres.get('save') || [];
  for (const h of hooks) {
    if (h.fn.length >= 1) await new Promise((resolve, reject) => { const r = h.fn.call(doc, (e) => (e ? reject(e) : resolve())); if (r && typeof r.then === 'function') r.then(() => {}, reject); });
    else await h.fn.call(doc);
  }
}

test('the password routes issue the new version and sign-in passes the current one', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'routes', 'auth.js'), 'utf8');
  assert.ok(!/generateToken\(user\._id\)/.test(src), 'every session token passes the version');
  assert.ok((src.match(/generateToken\(user\._id, user\.tokenVersion\)/g) || []).length >= 3);
});
