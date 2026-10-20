const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ph = require('../services/passwordHash');

// Made with bcryptjs 2.4.3 (the library this app used before), so old stored hashes must keep verifying.
const OLD = {
  cost12: { plain: 'Old-password-1', hash: '$2a$12$TmVhA2DwpaRWwYDh8alnnOm8KbXtKDqdKj0g.6kxxYjmO.vjv1Xuy' },
  otp10: { plain: '123456', hash: '$2a$10$oNRMHZk4K77fZCPrCbDJlu4l0mAYP1GxFBkieeHQY8qUBADnY906S' },
  unicode: { plain: `${'é'.repeat(50)}x`, hash: '$2a$04$07T1shSZNUJEwYuAu4W8FOvEhWe8J84C.VzvlLKHpXNo/VZvphCLe' }
};

test('hash then compare works, with the configured cost', async () => {
  const h = await ph.hash('New-password-9', { rounds: 4 });
  assert.match(h, /^\$2[aby]\$04\$/);
  assert.strictEqual(await ph.compare('New-password-9', h), true);
  assert.strictEqual(await ph.compare('wrong', h), false);
});

test('hashes made by bcryptjs (cost 12, OTP cost 10, non-ASCII) still verify', async () => {
  for (const { plain, hash } of Object.values(OLD)) {
    assert.strictEqual(await ph.compare(plain, hash), true, hash);
    assert.strictEqual(await ph.compare(`Z${plain}`, hash), false, hash); // (bcrypt reads only the first 72 bytes)
  }
});

test('a missing or broken stored hash is a plain "no", never a crash', async () => {
  assert.strictEqual(await ph.compare('x', undefined), false);
  assert.strictEqual(await ph.compare('x', ''), false);
  assert.strictEqual(await ph.compare('x', 'not-a-hash'), false);
  assert.strictEqual(await ph.compare(undefined, OLD.cost12.hash), false);
});

test('cost: BCRYPT_ROUNDS, default 11, bounded to 10..15', () => {
  assert.strictEqual(ph.configuredRounds({}), 11);
  assert.strictEqual(ph.configuredRounds({ BCRYPT_ROUNDS: '12' }), 12);
  assert.strictEqual(ph.configuredRounds({ BCRYPT_ROUNDS: '4' }), 10);
  assert.strictEqual(ph.configuredRounds({ BCRYPT_ROUNDS: '30' }), 15);
  assert.strictEqual(ph.configuredRounds({ BCRYPT_ROUNDS: 'abc' }), 11);
});

test('needsRehash is true when the stored cost differs from the configured one', () => {
  assert.strictEqual(ph.needsRehash(OLD.cost12.hash, { rounds: 11 }), true);
  assert.strictEqual(ph.needsRehash(OLD.cost12.hash, { rounds: 12 }), false);
  assert.strictEqual(ph.needsRehash('garbage', { rounds: 11 }), false);
  assert.strictEqual(ph.needsRehash(undefined, { rounds: 11 }), false);
});

test('at most 3 hashes run at once; the rest queue; a full queue answers busy (503)', async () => {
  let running = 0;
  let peak = 0;
  const releases = [];
  const impl = {
    hash: () => new Promise((resolve) => { running += 1; peak = Math.max(peak, running); releases.push(() => { running -= 1; resolve('$2b$11$x'); }); }),
    compare: async () => true,
    getRounds: () => 11
  };
  const h = ph.createPasswordHasher({ impl, maxConcurrent: 3, maxQueue: 2 });
  const jobs = [1, 2, 3, 4, 5].map((i) => h.hash(`p${i}`));
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(peak, 3);
  assert.deepStrictEqual(h.stats(), { running: 3, queued: 2 });

  await assert.rejects(h.hash('p6'), (e) => {
    assert.strictEqual(e.statusCode, 503);
    assert.strictEqual(e.message, 'Please try again in a moment.');
    assert.ok(ph.isBusyError(e));
    return true;
  });

  while (releases.length) { releases.shift()(); await new Promise((r) => setImmediate(r)); }
  await Promise.all(jobs);
  assert.strictEqual(peak, 3);
  assert.deepStrictEqual(h.stats(), { running: 0, queued: 0 });
});

test('a failing hash frees its slot', async () => {
  const impl = { hash: async () => { throw new Error('boom'); }, compare: async () => true, getRounds: () => 11 };
  const h = ph.createPasswordHasher({ impl, maxConcurrent: 1, maxQueue: 0 });
  await assert.rejects(h.hash('a'), /boom/);
  await assert.rejects(h.hash('b'), /boom/); // not "busy": the slot came back
});

test('rehashIfNeeded stores a new hash at the configured cost only when the cost differs', async () => {
  const updates = [];
  const User = { updateOne: async (q, u) => { updates.push([q, u]); return { modifiedCount: 1 }; } };
  assert.strictEqual(await ph.rehashIfNeeded({ _id: 'u1', password: OLD.cost12.hash }, OLD.cost12.plain, { User, rounds: 10 }), true);
  assert.strictEqual(updates.length, 1);
  assert.deepStrictEqual(updates[0][0], { _id: 'u1', password: OLD.cost12.hash });
  assert.match(updates[0][1].$set.password, /^\$2[aby]\$10\$/);
  assert.strictEqual(await ph.compare(OLD.cost12.plain, updates[0][1].$set.password), true);
  assert.strictEqual(await ph.rehashIfNeeded({ _id: 'u1', password: OLD.cost12.hash }, OLD.cost12.plain, { User, rounds: 12 }), false);
  assert.strictEqual(updates.length, 1);
});

test('no file of the backend uses bcryptjs any more; every hash goes through the one helper', () => {
  const root = path.join(__dirname, '..');
  const hits = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'tests', 'public', 'storage', 'temp', '.git'].includes(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js') && /require\(['"]bcrypt(js)?['"]\)/.test(fs.readFileSync(p, 'utf8')) && !p.endsWith(path.join('services', 'passwordHash.js'))) hits.push(path.relative(root, p));
    }
  };
  walk(root);
  assert.deepStrictEqual(hits, []);
  const pkg = require('../package.json');
  assert.ok(pkg.dependencies.bcrypt, 'native bcrypt is a dependency');
  assert.ok(!pkg.dependencies.bcryptjs, 'bcryptjs is gone');
});

test('the User model hashes and checks through the helper', async () => {
  const User = require('../models/User');
  const u = new User({ email: 'zz.hash@example.test', password: OLD.cost12.hash });
  assert.strictEqual(await u.comparePassword(OLD.cost12.plain), true);
  assert.strictEqual(await u.comparePassword('nope'), false);
});

test('credential routes answer 503 with the plain message when hashing is saturated, and sign-in re-stores old-cost hashes', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'auth.js'), 'utf8');
  for (const label of ['Signup error', 'Send OTP error', 'Verify OTP error', 'Forgot password error', 'Verify reset OTP error', 'Reset password error', 'Login error', 'Change password error']) {
    assert.ok(new RegExp(`if \\(answerBusy\\(res, error\\)\\) return;\\n\\s*console\\.error\\('${label}:`).test(src), label);
  }
  assert.ok(/rehashIfNeeded\(user, password\)\.catch\(/.test(src));
});
