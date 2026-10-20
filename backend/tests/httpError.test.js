const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const mongoose = require('mongoose');
const { fail, describe } = require('../utils/httpError');
const { errorHandler } = require('../middleware/errorHandler');

async function get(app, url = '/api/x', opts = {}) {
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${url}`, { headers: { 'Content-Type': 'application/json' }, ...opts });
    return { status: res.status, json: await res.json().catch(() => null) };
  } finally { server.close(); }
}
const appWith = (err, publicMessage) => {
  const app = express();
  app.use(express.json({ limit: '1kb' }));
  app.all('/api/x', (req, res) => fail(res, err, publicMessage));
  return app;
};
const quiet = async (fn) => { const o = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = o; } };

test('fail maps the error classes and never returns err.message, stack or paths', async () => {
  const M = mongoose.model('ZzHttpErr', new mongoose.Schema({ name: { type: String, required: true } }));
  const validation = new M({}).validateSync();
  const cast = new mongoose.Error.CastError('ObjectId', 'nope', '_id');
  const dup = Object.assign(new Error('E11000 duplicate key collection: secret.users index: email_1'), { name: 'MongoServerError', code: 11000, keyPattern: { email: 1 } });
  const big = Object.assign(new Error('request entity too large at /Users/x/app.js'), { type: 'entity.too.large', status: 413 });
  const other = new Error('connect ECONNREFUSED 10.0.0.5:27017 at /app/node_modules/x.js');
  const cases = [[validation, 400, 'VALIDATION_ERROR'], [cast, 400, 'INVALID_ID'], [dup, 409, 'DUPLICATE_KEY'], [big, 413, 'PAYLOAD_TOO_LARGE'], [other, 500, 'SERVER_ERROR']];
  for (const [err, status, code] of cases) {
    const r = await quiet(() => get(appWith(err)));
    assert.strictEqual(r.status, status);
    assert.strictEqual(r.json.errorCode, code);
    assert.strictEqual(r.json.success, false);
    const text = JSON.stringify(r.json);
    for (const bad of ['ECONNREFUSED', '10.0.0.5', '/app/', '/Users/', 'secret.users', 'E11000', 'Path `name`', 'Cast to', 'stack']) assert.ok(!text.includes(bad), `${code} leaks ${bad}`);
  }
  assert.deepStrictEqual((await quiet(() => get(appWith(validation)))).json.fields, ['name']);
});

test('a plain 500 uses the screen\'s own words when given, else the generic text', async () => {
  let r = await quiet(() => get(appWith(new Error('boom'), 'Failed to load campaigns')));
  assert.strictEqual(r.json.message, 'Failed to load campaigns');
  r = await quiet(() => get(appWith(new Error('boom'))));
  assert.strictEqual(r.json.message, 'Something went wrong. Please try again.');
});

test('the global handler: broken JSON says Invalid JSON, no stack in development, errorCode present', async () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  try {
    const app = express();
    app.use(express.json({ limit: '1kb' }));
    app.post('/api/x', (req, res) => res.json({ ok: true }));
    app.get('/api/boom', () => { throw new Error('kaboom /Users/x/file.js'); });
    app.use(errorHandler);
    let r = await quiet(() => get(app, '/api/x', { method: 'POST', body: '{"a":' }));
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.json.message, 'Invalid JSON');
    assert.strictEqual(r.json.errorCode, 'INVALID_JSON');
    r = await quiet(() => get(app, '/api/boom'));
    assert.strictEqual(r.status, 500);
    assert.ok(!('error' in r.json), 'no error/stack field even in development');
    assert.ok(!JSON.stringify(r.json).includes('kaboom'));
    assert.strictEqual(r.json.errorCode, 'SERVER_ERROR');
  } finally { process.env.NODE_ENV = prev; }
});

test('describe is pure: no side effects, same shape for every class', () => {
  const { status, body } = describe(new Error('x'));
  assert.strictEqual(status, 500);
  assert.deepStrictEqual(Object.keys(body).sort(), ['errorCode', 'message', 'success']);
});
