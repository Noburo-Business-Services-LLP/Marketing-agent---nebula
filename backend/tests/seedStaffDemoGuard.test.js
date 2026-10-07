// The staff demo seed script must only ever touch a throwaway local database.
const test = require('node:test');
const assert = require('node:assert');
const { assertSafeTarget } = require('../scripts/seed-staff-demo');

test('accepts a local database whose name starts with nebulaa_seed_', () => {
  assert.doesNotThrow(() => assertSafeTarget('mongodb://127.0.0.1:27018/nebulaa_seed_staff'));
  assert.doesNotThrow(() => assertSafeTarget('mongodb://localhost:27017/nebulaa_seed_x?directConnection=true'));
  assert.doesNotThrow(() => assertSafeTarget('mongodb://[::1]:27017/nebulaa_seed_x'));
});

test('refuses a database name without the nebulaa_seed_ prefix', () => {
  assert.throws(() => assertSafeTarget('mongodb://127.0.0.1:27018/nebulaa'), /nebulaa_seed_/);
  assert.throws(() => assertSafeTarget('mongodb://127.0.0.1:27018/test'), /nebulaa_seed_/);
  assert.throws(() => assertSafeTarget('mongodb://127.0.0.1:27018/'), /nebulaa_seed_/);
  assert.throws(() => assertSafeTarget('mongodb://127.0.0.1:27018'), /nebulaa_seed_/);
});

test('refuses any host that is not local, SRV addresses and multi-host lists', () => {
  assert.throws(() => assertSafeTarget('mongodb://cluster0.abcde.mongodb.net/nebulaa_seed_x'), /local/);
  assert.throws(() => assertSafeTarget('mongodb+srv://u:p@cluster0.abcde.mongodb.net/nebulaa_seed_x'), /local/);
  assert.throws(() => assertSafeTarget('mongodb://127.0.0.1:27017,db.example.com:27017/nebulaa_seed_x'), /local/);
  assert.throws(() => assertSafeTarget('mongodb://localhost.evil.example/nebulaa_seed_x'), /local/);
});

test('refuses an empty or malformed address', () => {
  assert.throws(() => assertSafeTarget(''), /MONGODB_URI/);
  assert.throws(() => assertSafeTarget(undefined), /MONGODB_URI/);
  assert.throws(() => assertSafeTarget('not a uri'), /MONGODB_URI|local/);
});
