const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// The size limits are wired in server-main.js; keep the rules honest without starting the whole server.
const src = fs.readFileSync(path.join(__dirname, '..', 'server-main.js'), 'utf8');

test('no route accepts a 150 MB body any more', () => {
  assert.ok(!/limit:\s*'150mb'/.test(src));
});

test('auth, payment and admin routes only get the small body limit', () => {
  const list = src.match(/const BIG_BODY_PREFIXES = \[([\s\S]*?)\];/)[1];
  for (const p of ['/api/payment', '/api/admin', '/api/credits', '/api/staff', '/api/csm']) assert.ok(!list.includes(`'${p}'`), p);
  assert.ok(!list.includes("'/api/auth'"));
});

test('server errors never show the raw message to the customer', () => {
  // The handler moved to middleware/errorHandler.js (its behaviour is tested in errorHandler.test.js).
  assert.ok(/require\('\.\/middleware\/errorHandler'\)\.errorHandler/.test(src));
  const handler = fs.readFileSync(path.join(__dirname, '..', 'middleware', 'errorHandler.js'), 'utf8');
  assert.ok(/if \(status >= 500\) return SERVER_MESSAGE;/.test(handler));
  assert.ok(/SERVER_MESSAGE = 'Something went wrong\. Please try again\.'/.test(handler));
});
