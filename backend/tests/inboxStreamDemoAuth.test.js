const test = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const auth = require('../middleware/auth');
const router = require('../routes/socialInboxRoutes');
const { socketAuth } = require('../services/socketHub');

const saved = { env: process.env.NODE_ENV, uri: process.env.MONGODB_URI, secret: process.env.JWT_SECRET, find: User.findById };
test.afterEach(() => {
  process.env.NODE_ENV = saved.env;
  if (saved.uri === undefined) delete process.env.MONGODB_URI; else process.env.MONGODB_URI = saved.uri;
  process.env.JWT_SECRET = saved.secret; User.findById = saved.find;
});

function run(token) {
  return new Promise((resolve) => {
    const res = { statusCode: 0, status(c) { this.statusCode = c; return this; }, json() { resolve({ status: this.statusCode }); } };
    const req = { query: { token }, headers: {} };
    router.streamAuth(req, res, () => resolve({ status: 200, user: req.user }));
  });
}
function sock(token) {
  return new Promise((resolve) => {
    const socket = { handshake: { auth: { token } } };
    socketAuth(socket, (err) => resolve({ err, userId: socket.userId }));
  });
}
function jwtUser(id) {
  process.env.JWT_SECRET = 'test-secret';
  User.findById = () => { const u = { _id: id, id, isActive: true }; const q = Promise.resolve(u); q.select = () => Promise.resolve(u); return q; };
  return jwt.sign({ id }, 'test-secret');
}

test('production refuses demo tokens on the stream and the socket', async () => {
  process.env.NODE_ENV = 'production'; delete process.env.MONGODB_URI;
  assert.strictEqual(auth.demoModeActive(), false);
  assert.strictEqual((await run('demo:victim')).status, 401);
  const s = await sock('demo:victim');
  assert.ok(s.err); assert.strictEqual(s.userId, undefined);
});

test('a valid JWT works on both paths in production', async () => {
  process.env.NODE_ENV = 'production';
  const t = jwtUser('u1');
  assert.strictEqual((await run(t)).status, 200);
  assert.strictEqual((await sock(t)).userId, 'u1');
});

test('outside production in demo mode, demo tokens work as before', async () => {
  process.env.NODE_ENV = 'development'; delete process.env.MONGODB_URI;
  assert.strictEqual(auth.demoModeActive(), true);
  assert.strictEqual((await run('demo:abc')).user.id, 'abc');
  assert.strictEqual((await sock('demo:abc')).userId, 'abc');
});

test('a real database configured means demo tokens are refused even outside production', async () => {
  process.env.NODE_ENV = 'development'; process.env.MONGODB_URI = 'mongodb://real/db';
  assert.strictEqual((await run('demo:abc')).status, 401);
  assert.ok((await sock('demo:abc')).err);
});
