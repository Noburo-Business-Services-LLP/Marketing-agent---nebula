const test = require('node:test');
const assert = require('node:assert');
const { createJobCaps, FLOWS, capSettings } = require('../services/userJobCap');

/** A fake model: countDocuments answers from a list of rows with a tiny matcher (status $in, extra fields, createdAt $gt). */
function fakeModel(rows, seen = []) {
  return {
    countDocuments(filter) {
      seen.push(filter);
      const n = rows.filter((r) => {
        if (String(r.userId) !== String(filter.userId)) return false;
        if (!filter.status.$in.includes(r.status)) return false;
        if (filter.createdAt && !(r.createdAt > filter.createdAt.$gt)) return false;
        if (filter.kind && filter.kind.$ne && r.kind === filter.kind.$ne) return false;
        if (filter.contentType && r.contentType !== filter.contentType) return false;
        return true;
      }).length;
      return { maxTimeMS() { return Promise.resolve(n); } };
    }
  };
}
const now = Date.now();
const rowsOf = (userId, list) => list.map(([status, extra = {}]) => ({ userId, status, createdAt: new Date(now - 1000), ...extra }));

test('defaults: 2 active and 5 waiting per account; the streaming carousel has no queue (2 at once)', () => {
  const s = capSettings({});
  assert.deepStrictEqual([s.active, s.queued], [2, 5]);
  assert.strictEqual(FLOWS.carousel.queued, 0);
  const t = capSettings({ JOB_CAP_ACTIVE: '3', JOB_CAP_QUEUED: 'x' });
  assert.deepStrictEqual([t.active, t.queued], [3, 5]);
});

test('video: the 8th job (2 running, 5 waiting) is refused with a plain 429; another account is not affected', async () => {
  const rows = rowsOf('u1', [['processing'], ['processing'], ['queued'], ['queued'], ['queued'], ['queued'], ['queued'], ['completed'], ['failed']]);
  const caps = createJobCaps({ models: { video: fakeModel(rows) }, now: () => now });
  const r = await caps.check('video', 'u1');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.status, 429);
  assert.match(r.message, /already/i);
  assert.ok(!/job|queue|mongo/i.test(r.message), 'customer words only');
  assert.strictEqual((await caps.check('video', 'u2')).ok, true);
});

test('video: 2 running and 4 waiting still lets one more in', async () => {
  const rows = rowsOf('u1', [['processing'], ['processing'], ['queued'], ['queued'], ['queued'], ['queued']]);
  const caps = createJobCaps({ models: { video: fakeModel(rows) }, now: () => now });
  assert.strictEqual((await caps.check('video', 'u1')).ok, true);
});

test('rows older than the stale bound are not counted (a stuck job never blocks an account for good)', async () => {
  const old = new Date(now - 7 * 3600 * 1000);
  const rows = Array.from({ length: 9 }, () => ({ userId: 'u1', status: 'processing', createdAt: old }));
  const caps = createJobCaps({ models: { hero: fakeModel(rows) }, now: () => now });
  assert.strictEqual((await caps.check('hero', 'u1')).ok, true);
});

test('blueprint does not count plan runs; carousel counts only carousels being made', async () => {
  const seen = [];
  const bp = fakeModel(rowsOf('u1', Array.from({ length: 7 }, () => ['processing', { kind: 'plan' }])), seen);
  const car = fakeModel(rowsOf('u1', [['processing', { contentType: 'carousel' }], ['processing', { contentType: 'carousel' }], ['processing', { contentType: 'post' }]]));
  const caps = createJobCaps({ models: { blueprint: bp, carousel: car }, now: () => now });
  assert.strictEqual((await caps.check('blueprint', 'u1')).ok, true);
  assert.deepStrictEqual(seen[0].kind, { $ne: 'plan' });
  const c = await caps.check('carousel', 'u1');
  assert.strictEqual(c.ok, false);
  assert.match(c.message, /carousel/i);
});

test('a database error lets the request through (like the limiters) and is logged', async () => {
  const warned = [];
  const broken = { countDocuments() { return { maxTimeMS() { return Promise.reject(new Error('down')); } }; } };
  const caps = createJobCaps({ models: { video: broken }, now: () => now, log: { warn: (m) => warned.push(m) } });
  assert.strictEqual((await caps.check('video', 'u1')).ok, true);
  assert.strictEqual(warned.length, 1);
});

test('middleware: 429 JSON when full, next() otherwise, 401 without a user', async () => {
  const rows = rowsOf('u1', Array.from({ length: 7 }, () => ['queued']));
  const caps = createJobCaps({ models: { video: fakeModel(rows) }, now: () => now });
  const mw = caps.middleware('video');
  const run = async (user) => {
    let status = 0; let body = null; let passed = false;
    await mw({ user }, { status(c) { status = c; return this; }, json(b) { body = b; return this; } }, () => { passed = true; });
    return { status, body, passed };
  };
  const full = await run({ _id: 'u1' });
  assert.strictEqual(full.status, 429);
  assert.strictEqual(full.body.success, false);
  assert.strictEqual(full.body.tooManyJobs, true);
  assert.strictEqual((await run({ _id: 'u2' })).passed, true);
  assert.strictEqual((await run(null)).status, 401);
});

test('every flow uses an indexed user field and a time bound', async () => {
  const seen = [];
  const m = fakeModel([], seen);
  const caps = createJobCaps({ models: { video: m, hero: m, blueprint: m, carousel: m }, now: () => now });
  for (const f of ['video', 'hero', 'blueprint', 'carousel']) await caps.check(f, 'u1');
  assert.strictEqual(seen.length, 4);
  for (const f of seen) { assert.ok(f.userId); assert.ok(f.createdAt && f.createdAt.$gt instanceof Date); }
});

test('the start routes of each flow carry the cap', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'routes', f), 'utf8');
  for (const r of ['createVideo', 'generateClips', 'mergeVideo', 'renderMissing']) assert.match(read('videoGeneration.js'), new RegExp(`router\\.post\\('/${r}',[^\\n]*jobCap\\('video'\\)`));
  assert.match(read('heroVideo.js'), /router\.post\('\/generate',[^\n]*jobCap\('hero'\)/);
  assert.match(read('blueprint.js'), /router\.post\('\/', protect,[^\n]*writeLimiter, jobCap\('blueprint'\)/);
  assert.match(read('carousels.js'), /router\.post\('\/generate-stream',[^\n]*jobCap\('carousel'\)/);
  // Flows with their own cap keep it.
  assert.match(read('studioVideos.js'), /if \(active >= 2\) return tooMany\(\)/);
});
