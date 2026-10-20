'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { ObjectId } = require('mongodb');
const { databaseRule, planDocument, migrateCollection, headOk, SPECS } = require('../scripts/migrate-inline-images');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString('base64');
const pic = (n) => `data:image/png;base64,${PNG}${'A'.repeat(n)}`;
const quiet = { warn() {}, error() {}, log() {} };

function fakeStore({ fail = false } = {}) {
  const calls = [];
  return { calls, storeImage: async (d) => { calls.push(d.length); if (fail) { const e = new Error('down'); e.code = 'upload_failed'; throw e; } return { url: `https://cdn.test/${calls.length}.png`, stored: true }; }, isConfigured: () => true };
}

test('database rule: nebulaa_dev dry run by default, acts only with CONFIRM_MIGRATE=yes; other databases refused', () => {
  assert.deepStrictEqual(databaseRule('nebulaa_dev', {}), { ok: true, act: false });
  assert.deepStrictEqual(databaseRule('nebulaa_dev', { CONFIRM_MIGRATE: 'yes' }), { ok: true, act: true });
  assert.strictEqual(databaseRule('nebulaa', {}).ok, false);
  assert.strictEqual(databaseRule('nebulaa', { CONFIRM_MIGRATE: 'yes' }).ok, false, 'confirm alone never opens production');
  assert.deepStrictEqual(databaseRule('nebulaa', { ALLOW_PROD_MIGRATION: 'yes' }), { ok: true, act: false }, 'production dry run');
  assert.deepStrictEqual(databaseRule('nebulaa', { ALLOW_PROD_MIGRATION: 'yes', CONFIRM_MIGRATE: 'yes' }), { ok: true, act: true });
  assert.strictEqual(databaseRule('nebulaa_dev2', {}).ok, false, 'exact name only');
});

test('dry run: counts and bytes, nothing stored', async () => {
  const store = fakeStore();
  const doc = { _id: new ObjectId(), imageUrl: pic(4000), creative: { imageUrls: [pic(4000)] }, errorMessage: 'x' };
  const plan = await planDocument(doc, SPECS.drafts, { act: false, store, head: async () => true, backupCap: 1e9 });
  assert.strictEqual(store.calls.length, 0);
  assert.deepStrictEqual(plan.touched.sort(), ['creative.imageUrls', 'imageUrl']);
  assert.ok(plan.savedBytes > 7000);
});

test('acting: the same picture in two fields is uploaded once; HEAD must pass; small documents keep a backup', async () => {
  const store = fakeStore();
  const same = pic(400);
  const doc = { _id: new ObjectId(), imageUrl: same, creative: { imageUrls: [same, 'https://cdn.test/keep.png'] }, carouselSlides: [{ imageUrl: pic(10) }, { imageUrl: '' }] };
  const plan = await planDocument(doc, SPECS.drafts, { act: true, store, head: async () => true, backupCap: 1e9 });
  assert.strictEqual(store.calls.length, 2);
  assert.strictEqual(plan.set.imageUrl, 'https://cdn.test/1.png');
  assert.deepStrictEqual(plan.set['creative.imageUrls'], ['https://cdn.test/1.png', 'https://cdn.test/keep.png']);
  assert.strictEqual(plan.set['carouselSlides.0.imageUrl'], 'https://cdn.test/2.png');
  assert.strictEqual(plan.set['legacyInline.imageUrl'], same);
  assert.ok(plan.set['legacyInline.migratedAt'] instanceof Date);
});

test('a document over the cap keeps only the hash and size of the old value', async () => {
  const doc = { _id: new ObjectId(), imageUrl: pic(5000) };
  const plan = await planDocument(doc, SPECS.drafts, { act: true, store: fakeStore(), head: async () => true, backupCap: 1000 });
  assert.strictEqual(plan.set['legacyInline.imageUrl'], undefined);
  assert.match(plan.set['legacyInline.imageUrlSha256'], /^[0-9a-f]{64}$/);
  assert.ok(plan.set['legacyInline.imageUrlBytes'] > 5000);
});

test('a failed HEAD or upload leaves the picture in place', async () => {
  const doc = { _id: new ObjectId(), imageUrl: pic(100) };
  const noHead = await planDocument(doc, SPECS.drafts, { act: true, store: fakeStore(), head: async () => false, backupCap: 1e9, logger: quiet });
  assert.deepStrictEqual(noHead.touched, []);
  assert.strictEqual(noHead.pictures.failed, 1);
  const down = await planDocument(doc, SPECS.drafts, { act: true, store: fakeStore({ fail: true }), head: async () => true, backupCap: 1e9, logger: quiet });
  assert.deepStrictEqual(down.touched, []);
});

test('campaigns: provider answers compacted, message capped; performance rows lose data URI copies', async () => {
  const big = pic(300000);
  const c = { _id: new ObjectId(), creative: { imageUrls: ['https://cdn.test/a.png'] }, publishResult: { error: big, postIds: [{ id: '1', platform: 'instagram' }] }, lastPublishError: `bad ${big}` };
  const plan = await planDocument(c, SPECS.campaigns, { act: true, store: fakeStore(), head: async () => true, backupCap: 1000 });
  assert.deepStrictEqual(plan.set.publishResult.postIds, [{ id: '1', platform: 'instagram' }]);
  assert.strictEqual(plan.set.lastPublishError, 'bad [inline data removed]');
  const row = { _id: new ObjectId(), assets: { images: [big, 'https://cdn.test/a.png'], thumbnails: [big], videos: [] } };
  const p2 = await planDocument(row, SPECS.ai_content_performance, { act: true, store: fakeStore(), head: async () => true, backupCap: 1000 });
  assert.deepStrictEqual(p2.set['assets.images'], ['https://cdn.test/a.png']);
  assert.deepStrictEqual(p2.set['assets.thumbnails'], []);
});

function fakeDb(rows) {
  const coll = {
    rows,
    updates: [],
    aggregate(pipeline) {
      const m = pipeline[0].$match;
      const lim = pipeline[2].$limit;
      const list = rows.filter((r) => (!m._id || String(r._id) > String(m._id.$gt)) && (!m.userId || String(r.userId) === String(m.userId)))
        .sort((a, b) => (String(a._id) < String(b._id) ? -1 : 1)).slice(0, lim)
        .map((r) => ({ _id: r._id, needs: String(r.imageUrl || '').startsWith('data:') })); // the real expression looks at the picture fields only
      return { toArray: async () => list };
    },
    find(q) { return { toArray: async () => rows.filter((r) => q._id.$in.some((id) => String(id) === String(r._id))).map((r) => JSON.parse(JSON.stringify(r), (k, v) => (k === '_id' ? new ObjectId(v) : v))) }; },
    async updateOne(filter, u) {
      const r = rows.find((x) => String(x._id) === String(filter._id));
      if (!r) return { modifiedCount: 0 };
      for (const [k, v] of Object.entries(u.$set)) {
        const parts = k.split('.'); let o = r;
        for (const p of parts.slice(0, -1)) { o[p] = o[p] || {}; o = o[p]; }
        o[parts[parts.length - 1]] = v;
      }
      coll.updates.push(filter._id);
      return { modifiedCount: 1 };
    }
  };
  return { collection: () => coll, coll };
}

test('migrateCollection: batches of 20, resumable cursor, a rerun is a no-op', async () => {
  const rows = [];
  for (let i = 0; i < 45; i++) rows.push({ _id: new ObjectId(), imageUrl: i % 3 === 0 ? pic(200 + i) : 'https://cdn.test/ok.png', creative: {} });
  const db = fakeDb(rows);
  const stateFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mig-')), 'state.json');
  const env = { MIGRATE_SLEEP_MS: '0' };
  const store = fakeStore();
  const dry = await migrateCollection('drafts', { db, ObjectId, act: false, store, head: async () => true, stateFile, env });
  assert.strictEqual(dry.scanned, 45);
  assert.strictEqual(dry.batches, 3);
  assert.strictEqual(dry.changed, 15);
  assert.strictEqual(store.calls.length, 0);
  assert.strictEqual(fs.existsSync(stateFile), false, 'a dry run writes no state');

  const one = await migrateCollection('drafts', { db, ObjectId, act: true, store, head: async () => true, stateFile, env: { ...env, MIGRATE_MAX_BATCHES: '1' } });
  assert.strictEqual(one.scanned, 20);
  assert.strictEqual(one.changed, 7);
  const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8')).drafts;
  assert.strictEqual(saved, String(rows.slice().sort((a, b) => (String(a._id) < String(b._id) ? -1 : 1))[19]._id));
  const rest = await migrateCollection('drafts', { db, ObjectId, act: true, store, head: async () => true, stateFile, env });
  assert.strictEqual(rest.scanned, 25, 'resumed after the saved cursor');
  assert.strictEqual(rest.changed, 8);
  const again = await migrateCollection('drafts', { db, ObjectId, act: true, store, head: async () => true, stateFile, env: { ...env, MIGRATE_RESTART: 'yes' } });
  assert.strictEqual(again.needing, 0, 'idempotent');
  assert.strictEqual(again.changed, 0);
  assert.ok(rows.every((r) => !String(r.imageUrl).startsWith('data:')));
});

test('headOk: https, 2xx and an image type only', async () => {
  const res = (status, type) => async () => ({ status, headers: { get: () => type } });
  assert.strictEqual(await headOk('https://cdn.test/a.png', { fetchImpl: res(200, 'image/png') }), true);
  assert.strictEqual(await headOk('https://cdn.test/a.png', { fetchImpl: res(404, 'image/png') }), false);
  assert.strictEqual(await headOk('https://cdn.test/a.png', { fetchImpl: res(200, 'text/html') }), false);
  assert.strictEqual(await headOk('http://cdn.test/a.png', { fetchImpl: res(200, 'image/png') }), false);
  assert.strictEqual(await headOk('https://cdn.test/a.png', { fetchImpl: async () => { throw new Error('net'); } }), false);
});
