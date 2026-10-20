const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const mongoose = require('mongoose');

const { errorHandler, statusFor } = require('../middleware/errorHandler');

async function call(app, { method = 'POST', url = '/api/x', body, headers = {} } = {}) {
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${url}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body });
    return { status: res.status, json: await res.json().catch(() => null) };
  } finally { server.close(); }
}

function appThrowing(err) {
  const app = express();
  app.use(express.json({ limit: '1kb' }));
  app.post('/api/x', (req, res, next) => (err ? next(err) : res.json({ body: req.body })));
  app.use(errorHandler);
  return app;
}

test('a Mongoose validation error is the caller\'s mistake: 400 with a plain message and the field names', async () => {
  const M = mongoose.model('ZzErrCheck', new mongoose.Schema({ name: { type: String, required: true }, status: { type: String, enum: ['a', 'b'] } }));
  const err = new M({ status: 'zzz' }).validateSync();
  const r = await call(appThrowing(err), { body: '{}' });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.json.success, false);
  assert.strictEqual(r.json.message, 'Some of the details are not valid. Please check them and try again.');
  assert.deepStrictEqual(r.json.fields.sort(), ['name', 'status']);
  assert.ok(!JSON.stringify(r.json).includes('Path `name`'), 'no raw validator text');
});

test('broken JSON is a 400, too large is a 413, a bad id is a 400, anything else is a plain 500', async () => {
  let r = await call(appThrowing(null), { body: '{"a":' });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.json.message, 'That request is not valid.');

  r = await call(appThrowing(null), { body: JSON.stringify({ a: 'x'.repeat(5000) }) });
  assert.strictEqual(r.status, 413);
  assert.strictEqual(r.json.message, 'That file or request is too large.');

  r = await call(appThrowing(new mongoose.Error.CastError('ObjectId', 'nope', '_id')), { body: '{}' });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.json.message, 'That request is not valid.');

  r = await call(appThrowing(new Error('db exploded at 10.0.0.1')), { body: '{}' });
  assert.strictEqual(r.status, 500);
  assert.strictEqual(r.json.message, 'Something went wrong. Please try again.');
  assert.ok(!JSON.stringify(r.json).includes('10.0.0.1'));
});

test('an error that names a 4xx status keeps it; only the hashing 503 keeps its own words', () => {
  const { messageFor } = require('../middleware/errorHandler');
  const { PasswordHashBusyError } = require('../services/passwordHash');
  assert.strictEqual(messageFor(new PasswordHashBusyError(), 503), 'Please try again in a moment.');
  assert.strictEqual(messageFor(Object.assign(new Error('upstream secret detail'), { status: 503 }), 503), 'Something went wrong. Please try again.');
  assert.strictEqual(statusFor({ statusCode: 429 }), 429);
  assert.strictEqual(statusFor({ name: 'ValidationError', errors: {} }), 400);
  assert.strictEqual(statusFor({ type: 'entity.parse.failed', status: 400 }), 400);
  assert.strictEqual(statusFor({}), 500);
});

test('text is no longer rewritten on the way in: no global sanitize-html pass in server-main', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server-main.js'), 'utf8');
  assert.ok(!/sanitize-html|sanitizeHtml/.test(src));
  assert.ok(/require\('\.\/middleware\/errorHandler'\)/.test(src));
});

test('a body is kept exactly as sent (ampersands, angle brackets, emoji)', async () => {
  const text = 'Fish & chips < 5 > 3, <b>bold</b> 🎉 "quoted"';
  const r = await call(appThrowing(null), { body: JSON.stringify({ text }) });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.body.text, text);
});
