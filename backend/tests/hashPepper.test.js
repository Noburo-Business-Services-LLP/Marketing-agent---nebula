'use strict';
// G7: no literal fallback keys. HASH_PEPPER keys the kept one-way hashes; records made before (keyed with JWT_SECRET)
// still match on lookup, so a person deleted before the change is still recognised.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const hp = require('../utils/hashPepper');

test('HASH_PEPPER is the key when set; production without it throws; development derives it from JWT_SECRET', () => {
  assert.strictEqual(hp.primaryKey({ HASH_PEPPER: 'pep', JWT_SECRET: 'jwt' }), 'pep');
  assert.throws(() => hp.primaryKey({ NODE_ENV: 'production', JWT_SECRET: 'jwt' }), /HASH_PEPPER/);
  const derived = hp.primaryKey({ NODE_ENV: 'development', JWT_SECRET: 'jwt' });
  assert.ok(derived && derived !== 'jwt');
  assert.strictEqual(hp.primaryKey({ JWT_SECRET: 'jwt' }), derived, 'stable');
  assert.ok(hp.primaryKey({}), 'a random per-process key when nothing is set (tests)');
});

test('lookups also try JWT_SECRET (records made before G7), new records use the primary key only', () => {
  assert.deepStrictEqual(hp.verificationKeys({ HASH_PEPPER: 'pep', JWT_SECRET: 'jwt' }), ['pep', 'jwt']);
  assert.deepStrictEqual(hp.verificationKeys({ HASH_PEPPER: 'same', JWT_SECRET: 'same' }), ['same']);
});

test('account deletion: a tombstone made with the old key (JWT_SECRET) is still found; new ones use the pepper', () => {
  const saved = { p: process.env.HASH_PEPPER, j: process.env.JWT_SECRET };
  process.env.HASH_PEPPER = 'pepper-for-test-0123456789abcdef';
  process.env.JWT_SECRET = 'jwt-for-test-0123456789abcdefghij';
  try {
    const d = require('../services/accountDeletion');
    const old = crypto.createHmac('sha256', process.env.JWT_SECRET).update('email:asha@example.test').digest('hex');
    const fresh = crypto.createHmac('sha256', process.env.HASH_PEPPER).update('email:asha@example.test').digest('hex');
    assert.strictEqual(d.emailHash('asha@example.test'), fresh, 'written with the pepper');
    assert.deepStrictEqual(d.emailHashes('asha@example.test'), [fresh], 'what a new tombstone stores');
    assert.ok(d.emailLookupHashes('asha@example.test').includes(old), 'an old tombstone still matches');
    assert.ok(d.emailLookupHashes('asha@example.test').includes(fresh));
  } finally {
    if (saved.p === undefined) delete process.env.HASH_PEPPER; else process.env.HASH_PEPPER = saved.p;
    if (saved.j === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = saved.j;
  }
});

test('the free Blueprint check looks a deleted person up with every key', () => {
  const src = fs.readFileSync(path.join(__dirname, '../services/blueprint/service.js'), 'utf8');
  assert.match(src, /emailLookupHashes\(email\)/);
});

test('guard: no literal fallback for a secret, salt, pepper or hash key in the app code', () => {
  const root = path.join(__dirname, '..');
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'tests', 'scripts', 'public', 'storage', 'data'].includes(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) {
        for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
          if (/(SECRET|PEPPER|SALT|HASH_KEY|SIGNING_KEY)\b[^\n]*\|\|\s*['"`][^'"`\s]{3,}['"`]/.test(line)) offenders.push(`${path.relative(root, p)}: ${line.trim().slice(0, 120)}`);
        }
      }
    }
  };
  walk(root);
  assert.deepStrictEqual(offenders, []);
});
