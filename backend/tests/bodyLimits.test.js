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
  assert.ok(/status >= 500\s*\?\s*'Something went wrong\. Please try again\.'/.test(src));
});
