const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// The owner sets production settings with docs/superpowers/ops/set-secret-value.sh, which only accepts names on a list,
// and checks them with check-secret-keys.sh. HASH_PEPPER is REQUIRED in production (the server will not start without it)
// and the new feature switches must be settable, so a release does not stall on "That name is not in the list".
const dir = path.join(__dirname, '..', '..', 'docs', 'superpowers', 'ops');
const allowed = (/^ALLOWED="([^"]*)"/m.exec(fs.readFileSync(path.join(dir, 'set-secret-value.sh'), 'utf8'))[1]).split(' ');
const checkText = fs.readFileSync(path.join(dir, 'check-secret-keys.sh'), 'utf8');
const required = (/^REQUIRED="([^"]*)"/m.exec(checkText)[1]).split(' ');
const optional = (/^OPTIONAL="([^"]*)"/m.exec(checkText)[1]).split(' ');

test('every setting the owner must set or switch for the release can be set with the script', () => {
  for (const name of ['HASH_PEPPER', 'ENABLE_PHOTOSHOOT', 'ENABLE_COMPETITOR_DRAFTS', 'ENABLE_COMPETITOR_THUMBS', 'ENABLE_STUDIO_VIDEO_CONSUMER',
    'ENABLE_PHOTOSHOOT_CONSUMER', 'RATE_LIMIT_STORE', 'TRUST_PROXY_HOPS', 'UNHANDLED_REJECTION_POLICY', 'BCRYPT_ROUNDS', 'ALLOW_ADMIN_BOOTSTRAP']) {
    assert.ok(allowed.includes(name), `${name} is allowed in set-secret-value.sh`);
  }
});

test('JWT_SECRET is never settable from the script (changing it signs everybody out)', () => {
  assert.ok(!allowed.includes('JWT_SECRET'));
});

test('the secret check lists HASH_PEPPER as required and prints lengths, never values', () => {
  assert.ok(required.includes('HASH_PEPPER') && required.includes('JWT_SECRET'));
  assert.ok(optional.includes('ENABLE_PHOTOSHOOT'));
  assert.match(checkText, /length of '\+k\+/);
  assert.doesNotMatch(checkText, /console\.log\([^)]*j\[k\][^.]/);
});
