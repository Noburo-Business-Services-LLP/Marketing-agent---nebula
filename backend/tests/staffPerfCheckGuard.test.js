// The staff perf check seeds and EMPTIES a database, so it must only ever touch a throwaway local one.
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const path = require('path');
const { assertSafeTarget, SCALES } = require('../scripts/staff-perf-check');

test('accepts only a local host and a nebulaa_seed_ database', () => {
  assert.doesNotThrow(() => assertSafeTarget('mongodb://127.0.0.1:27111/nebulaa_seed_perf'));
  assert.doesNotThrow(() => assertSafeTarget('mongodb://localhost:27017/nebulaa_seed_x?directConnection=true'));
  assert.throws(() => assertSafeTarget('mongodb://127.0.0.1:27111/nebulaa_dev'), /nebulaa_seed_/);
  assert.throws(() => assertSafeTarget('mongodb://127.0.0.1:27111'), /nebulaa_seed_/);
  assert.throws(() => assertSafeTarget('mongodb://cluster0.abcde.mongodb.net/nebulaa_seed_x'), /local/);
  assert.throws(() => assertSafeTarget('mongodb+srv://u:p@cluster0.abcde.mongodb.net/nebulaa_seed_x'), /plain mongodb/);
  assert.throws(() => assertSafeTarget('mongodb://127.0.0.1:1,db.example.com:1/nebulaa_seed_x'), /more than one host/);
  assert.throws(() => assertSafeTarget(''), /MONGODB_URI/);
});

test('the run refuses a real address before it connects, and does not print the password', () => {
  const uri = 'mongodb+srv://theuser:Sup3rSecretPw@cluster0.abcde.mongodb.net/nebulaa_prod';
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'staff-perf-check.js'), '--seed'], { env: { PATH: process.env.PATH, MONGODB_URI: uri }, encoding: 'utf8', timeout: 20000 });
  assert.strictEqual(r.status, 1);
  assert.ok(!(r.stdout + r.stderr).includes('Sup3rSecretPw'));
  assert.match(r.stderr, /FAILED/);
});

test('the full scale is at least the size asked for, and the small scale is one fifth', () => {
  const f = SCALES.full;
  assert.ok(f.users >= 20000 && f.drafts >= 200000 && f.campaigns >= 60000 && f.videos >= 20000 && f.heroes >= 5000 && f.blueprints >= 5000 && f.inbox >= 300000 && f.events >= 400000);
  assert.ok(SCALES.small.users >= 4000 && SCALES.small.drafts * 5 === f.drafts);
});
