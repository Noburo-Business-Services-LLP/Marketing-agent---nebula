'use strict';
// B7: the server refuses to start half-configured, and demo sign-in exists only when asked for outside production.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { validateBootEnv } = require('../utils/bootEnv');
const auth = require('../middleware/auth');

const LONG = 'x'.repeat(32);
const PROD = { NODE_ENV: 'production', JWT_SECRET: LONG, MONGODB_URI: 'mongodb+srv://h/db', HASH_PEPPER: 'p'.repeat(32) };

test('a complete production environment passes', () => {
  const r = validateBootEnv(PROD);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.errors, []);
});

test('JWT_SECRET missing stops the server in every environment', () => {
  for (const NODE_ENV of ['production', 'development', 'test', undefined]) {
    const r = validateBootEnv({ ...PROD, NODE_ENV, JWT_SECRET: '' });
    assert.strictEqual(r.ok, false, String(NODE_ENV));
    assert.match(r.errors.join(' '), /JWT_SECRET/);
  }
  assert.strictEqual(validateBootEnv({ NODE_ENV: 'development', JWT_SECRET: '   ' }).ok, false, 'blank counts as missing');
});

test('production: JWT_SECRET under 32 characters, no MONGODB_URI (or the example placeholder) or no HASH_PEPPER stop it', () => {
  assert.match(validateBootEnv({ ...PROD, JWT_SECRET: 'short-secret' }).errors.join(' '), /JWT_SECRET.*32/);
  assert.match(validateBootEnv({ ...PROD, MONGODB_URI: '' }).errors.join(' '), /MONGODB_URI/);
  assert.match(validateBootEnv({ ...PROD, MONGODB_URI: 'your_mongodb_connection_string_here' }).errors.join(' '), /MONGODB_URI/);
  assert.match(validateBootEnv({ ...PROD, HASH_PEPPER: undefined }).errors.join(' '), /HASH_PEPPER/);
  const all = validateBootEnv({ NODE_ENV: 'production' });
  assert.strictEqual(all.errors.length, 3, 'JWT_SECRET, MONGODB_URI and HASH_PEPPER each named once');
});

test('development: a short secret, no database and no pepper only warn (local work keeps going)', () => {
  const r = validateBootEnv({ NODE_ENV: 'development', JWT_SECRET: 'dev' });
  assert.strictEqual(r.ok, true);
  assert.ok(r.warnings.some((w) => /HASH_PEPPER/.test(w)));
  assert.ok(r.warnings.some((w) => /32/.test(w)));
});

test('ALLOW_DEMO_AUTH in production is named as ignored', () => {
  const r = validateBootEnv({ ...PROD, ALLOW_DEMO_AUTH: '1' });
  assert.strictEqual(r.ok, true);
  assert.ok(r.warnings.some((w) => /ALLOW_DEMO_AUTH/.test(w)));
});

test('demo sign-in only with ALLOW_DEMO_AUTH=1 and never in production; a missing MONGODB_URI no longer means demo', () => {
  assert.strictEqual(auth.demoModeActive({ NODE_ENV: 'development' }), false, 'no database alone is not demo any more');
  assert.strictEqual(auth.demoModeActive({ NODE_ENV: 'development', MONGODB_URI: 'your_mongodb_connection_string_here' }), false);
  assert.strictEqual(auth.demoModeActive({ NODE_ENV: 'development', ALLOW_DEMO_AUTH: '1' }), true);
  assert.strictEqual(auth.demoModeActive({ ALLOW_DEMO_AUTH: '1' }), true);
  assert.strictEqual(auth.demoModeActive({ NODE_ENV: 'production', ALLOW_DEMO_AUTH: '1' }), false);
  assert.strictEqual(auth.demoModeActive({ NODE_ENV: 'development', ALLOW_DEMO_AUTH: 'true' }), false, 'exactly 1');
});

test('server-main runs the check at boot and exits non-zero on an error (unless loaded without starting)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../server-main.js'), 'utf8');
  assert.match(src, /validateBootEnv\(process\.env\)/);
  assert.match(src, /process\.exit\(1\)/);
  assert.ok(src.indexOf('validateBootEnv(process.env)') < src.indexOf("require('./routes/auth')"), 'before any route is loaded');
});

test('.env.example names the new switches with placeholders only', () => {
  const src = fs.readFileSync(path.join(__dirname, '../.env.example'), 'utf8');
  for (const name of ['ALLOW_DEMO_AUTH', 'HASH_PEPPER']) assert.match(src, new RegExp(`^#?\\s*${name}=`, 'm'), name);
});
