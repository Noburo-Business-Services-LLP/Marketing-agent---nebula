// The staff index script (dry run by default, confirm flag to build, never prints the address, safe to repeat)
// and the model declarations that keep these indexes out of automatic builds.
const test = require('node:test');
const assert = require('node:assert');
const { STAFF_INDEXES } = require('../config/staffIndexes');
const script = require('../scripts/create-staff-indexes');
const { isTimeout, unreadable, READ_OPTIONS } = require('../services/staff/readErrors');
const { loadUsageData } = require('../services/staff/usage');

const SECRET_URI = 'mongodb+srv://theuser:Sup3rSecretPw@cluster0.abcde.mongodb.net/nebulaa_prod?retryWrites=true';
const LOCAL_URI = 'mongodb://127.0.0.1:27111/nebulaa_seed_x';

// A fake database: collections with indexes and counts, createIndex that records what it was asked to build.
function fakeMongoose({ fsTotal = 100e9, fsUsed = 40e9, count = 1000 } = {}) {
  const state = { indexes: {}, built: [], connected: null, disconnected: false, order: [] };
  for (const d of STAFF_INDEXES) state.indexes[d.collection] = state.indexes[d.collection] || [{ name: '_id_', key: { _id: 1 } }];
  const db = {
    collection: (name) => ({
      indexes: async () => state.indexes[name].map((i) => ({ ...i })),
      estimatedDocumentCount: async () => count,
      createIndex: async (keys, options) => {
        state.order.push(`start ${name}.${options.name}`);
        await new Promise((r) => setImmediate(r));
        state.built.push({ collection: name, keys, options });
        state.indexes[name].push({ name: options.name, key: keys, ...(options.partialFilterExpression ? { partialFilterExpression: options.partialFilterExpression } : {}) });
        state.order.push(`end ${name}.${options.name}`);
      }
    }),
    command: async (c) => {
      if (c.collStats) return { indexSizes: { _id_: 1048576 } };
      if (c.dbStats) return { fsTotalSize: fsTotal, fsUsedSize: fsUsed };
      throw new Error('unexpected');
    }
  };
  return { state, mongoose: { connect: async (uri) => { state.connected = uri; }, connection: { db }, disconnect: async () => { state.disconnected = true; } } };
}
async function runScript(env, argv = [], opts) {
  const f = fakeMongoose(opts); const lines = []; const errors = [];
  const code = await script.run({ argv, env, say: (m = '') => lines.push(m), fail: (m) => errors.push(m), mongoose: f.mongoose });
  return { code, out: lines.join('\n'), err: errors.join('\n'), ...f };
}

test('without MONGODB_URI the script refuses and connects to nothing', async () => {
  const r = await runScript({}, []);
  assert.strictEqual(r.code, 2);
  assert.match(r.err, /MONGODB_URI is not set/);
  assert.strictEqual(r.state.connected, null);
});

test('the default is a dry run: it lists what it would create and builds nothing', async () => {
  const r = await runScript({ MONGODB_URI: SECRET_URI });
  assert.strictEqual(r.code, 0);
  assert.match(r.out, /DRY RUN/);
  assert.strictEqual(r.state.built.length, 0);
  assert.strictEqual((r.out.match(/would create/g) || []).length, STAFF_INDEXES.length);
  assert.match(r.out, /Dry run only/);
});

test('--dry-run wins even when the confirm variable is set', async () => {
  const r = await runScript({ MONGODB_URI: SECRET_URI, CONFIRM_CREATE_INDEXES: 'yes' }, ['--dry-run']);
  assert.strictEqual(r.state.built.length, 0);
  assert.match(r.out, /DRY RUN/);
});

test('asking to create without the confirm variable is refused', async () => {
  const r = await runScript({ MONGODB_URI: SECRET_URI, CONFIRM_CREATE_INDEXES: 'true' }, ['--create']);
  assert.strictEqual(r.code, 2);
  assert.match(r.err, /CONFIRM_CREATE_INDEXES=yes/);
  assert.strictEqual(r.state.connected, null);
  const wrong = await runScript({ MONGODB_URI: SECRET_URI, CONFIRM_CREATE_INDEXES: 'YES' });
  assert.strictEqual(wrong.state.built.length, 0, 'only the exact word yes builds');
});

test('with the confirm variable it builds every missing index, one at a time, and says how far it got', async () => {
  const r = await runScript({ MONGODB_URI: SECRET_URI, CONFIRM_CREATE_INDEXES: 'yes' });
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.state.built.length, STAFF_INDEXES.length);
  assert.deepStrictEqual(r.state.built.map((b) => `${b.collection}.${b.options.name}`), STAFF_INDEXES.map((d) => `${d.collection}.${d.name}`));
  for (let i = 0; i < r.state.order.length; i += 2) assert.match(r.state.order[i], /^start /), assert.match(r.state.order[i + 1], /^end /); // never two at once
  assert.match(r.out, /\[1\/6\] building/);
  assert.match(r.out, /\[6\/6\] done/);
  assert.strictEqual(r.state.disconnected, true);
});

test('running again creates nothing (it is safe to repeat)', async () => {
  const f = fakeMongoose(); const env = { MONGODB_URI: SECRET_URI, CONFIRM_CREATE_INDEXES: 'yes' };
  const say = () => {};
  await script.run({ argv: [], env, say, fail: say, mongoose: f.mongoose });
  assert.strictEqual(f.state.built.length, STAFF_INDEXES.length);
  const lines = [];
  const code = await script.run({ argv: [], env, say: (m = '') => lines.push(m), fail: say, mongoose: f.mongoose });
  assert.strictEqual(code, 0);
  assert.strictEqual(f.state.built.length, STAFF_INDEXES.length, 'nothing new was built');
  assert.match(lines.join('\n'), /Nothing to create/);
});

test('an index that already exists under another name with the same keys is not built twice', () => {
  const def = STAFF_INDEXES.find((d) => d.collection === 'drafts');
  const plan = script.planIndexes([def], { drafts: [{ name: 'createdAt_-1', key: { createdAt: -1 } }] });
  assert.strictEqual(plan[0].status, 'exists');
  const partial = STAFF_INDEXES.find((d) => d.options);
  assert.strictEqual(script.planIndexes([partial], { [partial.collection]: [{ name: 'other', key: partial.keys }] })[0].status, 'missing', 'a full index is not the partial one');
});

test('the address is never printed: only the database name and what kind of host', async () => {
  for (const env of [{ MONGODB_URI: SECRET_URI }, { MONGODB_URI: SECRET_URI, CONFIRM_CREATE_INDEXES: 'yes' }]) {
    const r = await runScript(env);
    const all = `${r.out}\n${r.err}`;
    for (const piece of ['Sup3rSecretPw', 'theuser', 'cluster0', 'abcde.mongodb.net', 'mongodb+srv', 'retryWrites']) assert.ok(!all.includes(piece), `printed ${piece}`);
    assert.match(r.out, /Database: nebulaa_prod/);
    assert.match(r.out, /Host: MongoDB Atlas \(cloud\)/);
  }
  assert.strictEqual(script.hostClass(LOCAL_URI), 'this computer (local)');
  assert.strictEqual(script.hostClass('mongodb://db.internal:27017/x'), 'another server');
  assert.strictEqual(script.databaseName(SECRET_URI), 'nebulaa_prod');
  assert.strictEqual(script.databaseName('mongodb://h:1'), '');
});

test('a URI with no database name is refused', async () => {
  const r = await runScript({ MONGODB_URI: 'mongodb://127.0.0.1:27017' });
  assert.strictEqual(r.code, 2);
  assert.strictEqual(r.state.connected, null);
});

test('not enough free disk: a real run refuses and builds nothing; a dry run still reports', async () => {
  const tight = { fsTotal: 100e9, fsUsed: 100e9 - 1000, count: 5000000 }; // 1 KB free, 5 million documents
  const real = await runScript({ MONGODB_URI: SECRET_URI, CONFIRM_CREATE_INDEXES: 'yes' }, [], tight);
  assert.strictEqual(real.code, 3);
  assert.strictEqual(real.state.built.length, 0);
  assert.match(real.err, /not enough free disk/);
  const dry = await runScript({ MONGODB_URI: SECRET_URI }, [], tight);
  assert.strictEqual(dry.code, 0);
  assert.match(dry.out, /NOT ENOUGH/);
  assert.deepStrictEqual(script.diskVerdict({ estimateBytes: 10, freeBytes: NaN }), { known: false, ok: true });
});

test('every staff index is declared on its model as script-only, so a normal start-up never builds it', () => {
  for (const def of STAFF_INDEXES) {
    const Model = require(`../models/${def.model}`);
    assert.strictEqual(Model.collection.name, def.collection, `${def.model} collection name`);
    const hit = Model.schema.indexes().find(([keys, options]) => options.name === def.name);
    assert.ok(hit, `${def.model} does not declare ${def.name}`);
    assert.deepStrictEqual(hit[0], def.keys);
    assert.strictEqual(hit[1]._autoIndex, false, `${def.name} must not be built automatically`);
  }
  assert.strictEqual(new Set(STAFF_INDEXES.map((d) => `${d.collection}.${d.name}`)).size, STAFF_INDEXES.length);
});

test('no other index was made script-only by accident', () => {
  const names = new Set(STAFF_INDEXES.map((d) => d.name));
  for (const m of ['Draft', 'Campaign', 'VideoJob', 'HeroVideoJob', 'Blueprint', 'SocialInboxMessage']) {
    for (const [, options] of require(`../models/${m}`).schema.indexes()) {
      if (options._autoIndex === false) assert.ok(names.has(options.name), `${m}.${options.name} is script-only but not in the list`);
    }
  }
});

// ---- timeouts are told apart from errors ----
test('a read that ran out of time says it took too long; any other failure says it could not be read', () => {
  const timeout = Object.assign(new Error('Executor error during aggregate command :: caused by :: operation exceeded time limit'), { code: 50, codeName: 'MaxTimeMSExpired' });
  assert.strictEqual(isTimeout(timeout), true);
  assert.strictEqual(isTimeout(new Error('Socket timed out')), true);
  assert.strictEqual(isTimeout(new Error('connection reset')), false);
  assert.strictEqual(isTimeout(null), false);
  assert.match(unreadable('drafts', timeout), /took too long/);
  assert.doesNotMatch(unreadable('drafts', new Error('boom')), /took too long/);
  assert.strictEqual(unreadable('drafts', new Error('boom')), 'We could not read the drafts right now.');
  assert.deepStrictEqual({ ...READ_OPTIONS }, { maxTimeMS: 20000, allowDiskUse: true });
});

test('Usage names a timeout and an error differently, source by source, and the other sources still load', async () => {
  const timeout = Object.assign(new Error('operation exceeded time limit'), { code: 50 });
  const rows = (n) => [{ _id: 'u1', n }];
  const User = { find: () => { const p = Promise.resolve([{ _id: 'u1', createdAt: new Date(), staffRole: null }]); p.lean = () => p; return p; } };
  const model = (fn) => ({ aggregate: async (p) => fn(p) });
  const has = (p, k) => JSON.stringify(p[0]).includes(`"${k}"`);
  const models = {
    User,
    Draft: model(() => { throw timeout; }),
    Campaign: model((p) => { if (has(p, 'publishedAt') && !has(p, 'userId')) throw new Error('db hiccup'); return rows(1); }),
    VideoJob: model(() => rows(2)), HeroVideoJob: model(() => rows(3)), Blueprint: model(() => rows(4)), SocialInboxMessage: model(() => rows(5))
  };
  const q = console.error; console.error = () => {};
  let data;
  try { data = await loadUsageData({ models }); } finally { console.error = q; }
  assert.match(data.unavailable.images, /took too long/);
  assert.match(data.unavailable.postsDrafted, /took too long/);
  assert.strictEqual(data.unavailable.postsPublished, 'We could not read the published posts right now.');
  assert.deepStrictEqual(data.usage.videos, [{ _id: 'u1', n: 2 }]);
  assert.match(data.funnelData.contentReason, /took too long/);
  assert.strictEqual(data.funnelData.contentIds, null);
});
