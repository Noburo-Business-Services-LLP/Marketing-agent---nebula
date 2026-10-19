const test = require('node:test');
const assert = require('node:assert');
const { HOME_INDEXES } = require('../config/homeIndexes');
const home = require('../scripts/create-home-indexes');
const Campaign = require('../models/Campaign');

const URI = 'mongodb+srv://theuser:Sup3rSecretPw@cluster0.abcde.mongodb.net/nebulaa_prod?retryWrites=true';
function fake() {
  const state = { indexes: { campaigns: [{ name: '_id_', key: { _id: 1 } }] }, built: [] };
  const db = {
    collection: () => ({
      indexes: async () => state.indexes.campaigns.map((i) => ({ ...i })),
      estimatedDocumentCount: async () => 5000,
      createIndex: async (keys, options) => { state.built.push({ keys, options }); state.indexes.campaigns.push({ name: options.name, key: keys }); }
    }),
    command: async (c) => (c.collStats ? { indexSizes: {} } : { fsTotalSize: 100e9, fsUsedSize: 10e9 })
  };
  return { state, mongoose: { connect: async () => {}, connection: { db }, disconnect: async () => {} } };
}
const go = async (env, argv = []) => { const f = fake(); const out = []; const err = []; const code = await home.run({ argv, env, say: (m = '') => out.push(m), fail: (m) => err.push(m), mongoose: f.mongoose }); return { code, out: out.join('\n'), err: err.join('\n'), ...f }; };

test('the Home indexes are declared script-only on the Campaign model', () => {
  for (const def of HOME_INDEXES) {
    const found = Campaign.schema.indexes().find(([keys, opts]) => opts && opts.name === def.name);
    assert.ok(found, def.name);
    assert.strictEqual(found[1]._autoIndex, false, `${def.name} must never be built automatically`);
    assert.ok(def.name.startsWith('home_'));
  }
});

test('dry run is the default and builds nothing', async () => {
  const r = await go({ MONGODB_URI: URI });
  assert.strictEqual(r.code, 0);
  assert.match(r.out, /DRY RUN/);
  assert.strictEqual(r.state.built.length, 0);
  assert.strictEqual((r.out.match(/would create/g) || []).length, HOME_INDEXES.length);
  assert.ok(!r.out.includes('Sup3rSecretPw') && !r.out.includes('cluster0'), 'the address is never printed');
});

test('only the exact word yes builds, one at a time, and a second run creates nothing', async () => {
  const f = fake();
  const out = [];
  const env = { MONGODB_URI: URI, CONFIRM_CREATE_INDEXES: 'yes' };
  assert.strictEqual(await home.run({ argv: [], env, say: (m = '') => out.push(m), fail: () => {}, mongoose: f.mongoose }), 0);
  assert.strictEqual(f.state.built.length, HOME_INDEXES.length);
  await home.run({ argv: [], env, say: (m = '') => out.push(m), fail: () => {}, mongoose: f.mongoose });
  assert.strictEqual(f.state.built.length, HOME_INDEXES.length, 'nothing new on the second run');
  const wrong = await go({ MONGODB_URI: URI, CONFIRM_CREATE_INDEXES: 'YES' });
  assert.strictEqual(wrong.state.built.length, 0);
});
