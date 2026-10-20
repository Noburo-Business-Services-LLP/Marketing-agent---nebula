// Cursor pages for the Drafts and Campaigns lists (load-test weeks 2 to 3): limits, cursor, ties on createdAt.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const page = require('../services/listPage');

// An in-memory "collection" that answers a pageQuery the way the index does: createdAt desc, ties in a stable order.
function runQuery(rows, q) {
  const lte = q.filter.$and ? q.filter.$and[1].createdAt.$lte.getTime() : Infinity;
  const sorted = rows.filter((r) => r.createdAt.getTime() <= lte).sort((a, b) => b.createdAt - a.createdAt || a.n - b.n);
  return sorted.slice(q.skip, q.skip + q.limit);
}
function walk(rows, limit) {
  const seen = []; let cursor; let pages = 0;
  do {
    const q = page.pageQuery({ userId: 'u' }, { cursor, limit });
    const out = page.finishPage(runQuery(rows, q), { limit, cursor: q.cursor });
    seen.push(...out.items.map((r) => r.n));
    cursor = out.nextCursor; pages += 1;
    assert.ok(pages < 1000);
  } while (cursor);
  return { seen, pages };
}

test('limit: default when missing or bad, capped at 50', () => {
  assert.strictEqual(page.parseLimit(undefined, 30), 30);
  assert.strictEqual(page.parseLimit('abc', 20), 20);
  assert.strictEqual(page.parseLimit('0', 20), 20);
  assert.strictEqual(page.parseLimit('7', 30), 7);
  assert.strictEqual(page.parseLimit('500', 30), 50);
});

test('every row exactly once, newest first, also when many rows share one createdAt and a tie spans pages', () => {
  const t0 = Date.parse('2026-10-20T00:00:00Z');
  const rows = [];
  let n = 0;
  for (let i = 0; i < 40; i++) rows.push({ n: n++, createdAt: new Date(t0 + i * 1000) });
  for (let i = 0; i < 75; i++) rows.push({ n: n++, createdAt: new Date(t0 + 20500) }); // a plan made 75 posts at once
  for (let i = 0; i < 9; i++) rows.push({ n: n++, createdAt: new Date(t0 + 30000 + (i % 3)) });
  for (const limit of [1, 7, 30, 50]) {
    const { seen } = walk(rows, limit);
    assert.strictEqual(seen.length, rows.length, `limit ${limit}`);
    assert.strictEqual(new Set(seen).size, rows.length, `limit ${limit}: no repeats`);
    const byN = new Map(rows.map((r) => [r.n, r]));
    for (let i = 1; i < seen.length; i++) assert.ok(byN.get(seen[i - 1]).createdAt >= byN.get(seen[i]).createdAt);
  }
});

test('last page has no cursor; an empty list has no cursor', () => {
  const rows = [{ n: 1, createdAt: new Date() }];
  const q = page.pageQuery({}, { limit: 30 });
  assert.deepStrictEqual(page.finishPage(runQuery(rows, q), { limit: 30 }).nextCursor, null);
  assert.deepStrictEqual(page.finishPage([], { limit: 30 }), { items: [], nextCursor: null, hasMore: false });
});

test('a cursor we did not make is a 400, not a crash', () => {
  for (const bad of ['xyz', Buffer.from('{"t":"a","k":1}').toString('base64url'), Buffer.from('{"t":1,"k":-1}').toString('base64url')]) {
    assert.throws(() => page.decodeCursor(bad), (e) => e.status === 400);
  }
  assert.strictEqual(page.decodeCursor(''), null);
  assert.deepStrictEqual(page.decodeCursor(page.encodeCursor(5, 2)), { t: 5, k: 2 });
});

test('the page is read first, then trimmed; the trims drop only the heavy copies', () => {
  const q = page.pageQuery({ userId: 'u' }, { limit: 30 });
  const p = page.pagePipeline(q, page.DRAFT_TRIM);
  assert.deepStrictEqual(Object.keys(p[0]), ['$match']);
  assert.deepStrictEqual(p[1], { $sort: { createdAt: -1 } });
  assert.deepStrictEqual(p[2], { $limit: 31 });
  assert.deepStrictEqual(page.DRAFT_TRIM[0], { $unset: ['imageUrlNoLogo'] });
  assert.deepStrictEqual(page.CAMPAIGN_TRIM[0], { $unset: ['publishResult'] });
  assert.match(JSON.stringify(page.CAMPAIGN_TRIM[1]), /"\$substrCP":\["\$lastPublishError",0,500\]/);
});

test('the routes use the pages and keep their old answer fields', () => {
  const drafts = fs.readFileSync(path.join(__dirname, '../routes/drafts.js'), 'utf8');
  assert.match(drafts, /page\.parseLimit\(req\.query\.limit, 30\)/);
  assert.match(drafts, /res\.status\(200\)\.json\(\{ success: true, drafts: items, nextCursor, hasMore \}\)/);
  const camp = fs.readFileSync(path.join(__dirname, '../routes/campaigns.js'), 'utf8');
  assert.match(camp, /page\.parseLimit\(req\.query\.limit, 20\)/);
  assert.match(camp, /campaigns: items,\s+counts,\s+nextCursor,\s+hasMore/);
  const notes = fs.readFileSync(path.join(__dirname, '../routes/notifications.js'), 'utf8');
  assert.match(notes, /parseLimit\(limit, 20\)/);
  assert.match(notes, /\.select\('-emailError'\)\s+\.lean\(\)/);
  const vids = fs.readFileSync(path.join(__dirname, '../services/videoDraftStore.js'), 'utf8');
  assert.match(vids, /\.limit\(LIST_LIMIT\)/);
});

test('the cross-account job indexes are partial (scheduled rows only), script-only, and the dry run builds nothing', async () => {
  const { PERF_INDEXES } = require('../config/perfIndexes');
  const Campaign = require('../models/Campaign');
  for (const def of PERF_INDEXES) {
    const hit = Campaign.schema.indexes().find(([, o]) => o && o.name === def.name);
    assert.ok(hit, def.name);
    assert.strictEqual(hit[1]._autoIndex, false);
    assert.deepStrictEqual(hit[1].partialFilterExpression, { status: 'scheduled' });
  }
  const built = [];
  const db = {
    collection: () => ({ indexes: async () => [{ name: '_id_', key: { _id: 1 } }], estimatedDocumentCount: async () => 500, createIndex: async (k, o) => built.push(o) }),
    command: async (c) => (c.collStats ? { indexSizes: {} } : { fsTotalSize: 100e9, fsUsedSize: 10e9 })
  };
  const out = [];
  const code = await require('../scripts/create-perf-indexes').run({ argv: [], env: { MONGODB_URI: 'mongodb://x/nebulaa_dev' }, say: (m = '') => out.push(m), fail: (m) => out.push(m), mongoose: { connect: async () => {}, connection: { db }, disconnect: async () => {} } });
  assert.strictEqual(code, 0);
  assert.strictEqual(built.length, 0);
  assert.strictEqual((out.join('\n').match(/would create/g) || []).length, PERF_INDEXES.length);
});
