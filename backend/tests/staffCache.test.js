// The staff page cache: fresh for 5 minutes, stale-while-revalidate, one computation shared, errors never kept, size bounded.
const test = require('node:test');
const assert = require('node:assert');
const { createStaffCache, keyFor, defaultCache, DEFAULTS } = require('../services/staff/cache');

const MIN = 60000;
function clock(start = 1000000) { const c = { t: start, now: () => c.t, tick: (ms) => { c.t += ms; } }; return c; }
const deferred = () => { let resolve; let reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

test('defaults are 5 minutes fresh, 30 minutes at most stale, a bounded number of entries', () => {
  assert.strictEqual(DEFAULTS.ttlMs, 5 * MIN);
  assert.strictEqual(DEFAULTS.maxStaleMs, 30 * MIN);
  assert.ok(DEFAULTS.maxEntries > 0 && DEFAULTS.maxEntries <= 100);
});

test('the first read computes; the next read inside 5 minutes is served from the stored copy', async () => {
  const c = clock(); const cache = createStaffCache({ now: c.now });
  let runs = 0;
  const compute = async () => ({ n: ++runs });
  const a = await cache.get('k', compute);
  assert.deepStrictEqual([a.value.n, a.fromCache, a.stale], [1, false, false]);
  c.tick(4 * MIN);
  const b = await cache.get('k', compute);
  assert.deepStrictEqual([b.value.n, b.fromCache, b.stale, b.updatedAt], [1, true, false, a.updatedAt]);
  assert.strictEqual(runs, 1);
});

test('after 5 minutes the old copy is served at once while ONE background refresh runs', async () => {
  const c = clock(); const cache = createStaffCache({ now: c.now });
  let runs = 0; const gate = deferred();
  const compute = async () => { runs += 1; if (runs > 1) await gate.promise; return { n: runs }; };
  await cache.get('k', compute);
  c.tick(6 * MIN);
  const stale = await cache.get('k', compute);
  assert.deepStrictEqual([stale.value.n, stale.fromCache, stale.stale], [1, true, true]);
  const again = await cache.get('k', compute); // refresh still running: no second refresh
  assert.strictEqual(again.value.n, 1);
  assert.strictEqual(runs, 2);
  gate.resolve();
  await new Promise((r) => setImmediate(r));
  const fresh = await cache.get('k', compute);
  assert.deepStrictEqual([fresh.value.n, fresh.fromCache, fresh.stale], [2, true, false]);
});

test('a copy older than the stale limit is not served: the caller waits for new numbers', async () => {
  const c = clock(); const cache = createStaffCache({ now: c.now });
  let runs = 0; const compute = async () => ({ n: ++runs });
  await cache.get('k', compute);
  c.tick(31 * MIN);
  const r = await cache.get('k', compute);
  assert.deepStrictEqual([r.value.n, r.fromCache], [2, false]);
});

test('requests that arrive while a computation is running join it (no stampede)', async () => {
  const cache = createStaffCache(); const gate = deferred(); let runs = 0;
  const compute = async () => { runs += 1; await gate.promise; return { n: runs }; };
  const all = [cache.get('k', compute), cache.get('k', compute), cache.get('k', compute), cache.get('k', compute, { refresh: true })];
  assert.strictEqual(cache._running(), 1);
  gate.resolve();
  const out = await Promise.all(all);
  assert.strictEqual(runs, 1);
  assert.ok(out.every((r) => r.value.n === 1));
  assert.strictEqual(cache._running(), 0);
});

test('different keys compute separately', async () => {
  const cache = createStaffCache(); let runs = 0;
  await Promise.all([cache.get('a', async () => ++runs), cache.get('b', async () => ++runs)]);
  assert.strictEqual(runs, 2);
});

test('an error is never stored: the next read tries again', async () => {
  const cache = createStaffCache(); let runs = 0;
  const flaky = async () => { runs += 1; if (runs === 1) throw new Error('db down'); return { ok: runs }; };
  await assert.rejects(() => cache.get('k', flaky), /db down/);
  assert.strictEqual(cache.has('k'), false);
  assert.strictEqual(cache._running(), 0);
  const r = await cache.get('k', flaky);
  assert.deepStrictEqual([r.value.ok, r.fromCache], [2, false]);
});

test('a failed background refresh keeps the last good copy and is reported, not thrown', async () => {
  const c = clock(); const seen = [];
  const cache = createStaffCache({ now: c.now, onError: (key, e) => seen.push([key, e.message]) });
  let runs = 0;
  const compute = async () => { runs += 1; if (runs === 2) throw new Error('slow db'); return { n: runs }; };
  await cache.get('k', compute);
  c.tick(6 * MIN);
  const stale = await cache.get('k', compute);
  assert.strictEqual(stale.value.n, 1);
  await new Promise((r) => setImmediate(r));
  assert.deepStrictEqual(seen, [['k', 'slow db']]);
  const next = await cache.get('k', compute); // still stale: tries the refresh again
  assert.deepStrictEqual([next.value.n, next.stale], [1, true]);
  await new Promise((r) => setImmediate(r));
  const fresh = await cache.get('k', compute);
  assert.deepStrictEqual([fresh.value.n, fresh.stale], [3, false]);
});

test('refresh skips the stored copy and recomputes', async () => {
  const cache = createStaffCache(); let runs = 0;
  const compute = async () => ({ n: ++runs });
  await cache.get('k', compute);
  const r = await cache.get('k', compute, { refresh: true });
  assert.deepStrictEqual([r.value.n, r.fromCache], [2, false]);
  assert.strictEqual((await cache.get('k', compute)).value.n, 2);
});

test('a refresh that fails is an error for the caller and keeps the older copy stored', async () => {
  const cache = createStaffCache(); let runs = 0;
  await cache.get('k', async () => ({ n: ++runs }));
  await assert.rejects(() => cache.get('k', async () => { throw new Error('nope'); }, { refresh: true }), /nope/);
  assert.strictEqual((await cache.get('k', async () => ({ n: 99 }))).value.n, 1);
});

test('the cache holds a bounded number of results; the least recently used goes first', async () => {
  const cache = createStaffCache({ maxEntries: 3 });
  for (const k of ['a', 'b', 'c']) await cache.get(k, async () => k);
  await cache.get('a', async () => 'x');           // a is now the most recently used
  await cache.get('d', async () => 'd');           // evicts b
  assert.deepStrictEqual([cache.has('a'), cache.has('b'), cache.has('c'), cache.has('d')], [true, false, true, true]);
  assert.strictEqual(cache.size(), 3);
  for (let i = 0; i < 50; i++) await cache.get(`k${i}`, async () => i);
  assert.strictEqual(cache.size(), 3);
});

test('the key carries the endpoint, the window, the level and (CSM only) whose clients; levels never share a key', () => {
  const k = (role, csmId) => keyFor({ endpoint: 'usage', window: '30', role, csmId });
  assert.notStrictEqual(k('owner'), k('admin'));
  assert.notStrictEqual(k('owner'), k('csm', 'c1'));
  assert.notStrictEqual(k('admin'), k('csm', 'c1'));
  assert.notStrictEqual(k('csm', 'c1'), k('csm', 'c2'));
  assert.strictEqual(k('owner', 'c1'), k('owner', 'c2'), 'an Owner is not split by CSM id');
  assert.notStrictEqual(keyFor({ endpoint: 'usage', window: '30', role: 'owner' }), keyFor({ endpoint: 'usage', window: '90', role: 'owner' }));
  assert.notStrictEqual(keyFor({ endpoint: 'home', role: 'owner' }), keyFor({ endpoint: 'clients', role: 'owner' }));
  assert.notStrictEqual(k('owner'), k('someone-made-up'));
  assert.strictEqual(k('someone-made-up'), k(undefined));
});

test('the real cache is off under the test runner and when STAFF_CACHE=off', () => {
  assert.strictEqual(defaultCache(), null); // node --test sets NODE_TEST_CONTEXT
  const saved = process.env.NODE_TEST_CONTEXT; delete process.env.NODE_TEST_CONTEXT;
  try {
    assert.ok(defaultCache());
    process.env.STAFF_CACHE = 'off';
    assert.strictEqual(defaultCache(), null);
  } finally { delete process.env.STAFF_CACHE; if (saved !== undefined) process.env.NODE_TEST_CONTEXT = saved; }
});
