'use strict';
// E2: a lease around every scheduler tick, so an accidental second worker cannot double-send, double-publish or double-charge.
const test = require('node:test');
const assert = require('node:assert');
const { createLeaseLock } = require('../services/leaseLock');

// An in-memory store with the same atomic rule as the MongoDB one: a claim succeeds only on a missing or expired row.
function memoryStore() {
  const rows = new Map();
  return {
    rows,
    async claim(name, holder, now, expiresAt) {
      const r = rows.get(name);
      if (r && r.expiresAt > now) return false;
      rows.set(name, { holder, expiresAt });
      return true;
    },
    async renew(name, holder, expiresAt) {
      const r = rows.get(name);
      if (!r || r.holder !== holder) return false;
      r.expiresAt = expiresAt; return true;
    },
    async release(name, holder, expiresAt) {
      const r = rows.get(name);
      if (r && r.holder === holder) r.expiresAt = expiresAt;
    }
  };
}
const quiet = { log() {}, warn() {} };
const fakeTimers = () => { const t = { fns: [], setInterval(fn) { const h = { fn }; t.fns.push(h); return h; }, clearInterval(h) { t.fns = t.fns.filter((x) => x !== h); } }; return t; };
const mk = (store, holder, clock, timers) => createLeaseLock({ store, holder, clock, log: quiet, timers: timers || fakeTimers() });

test('two holders: only one runs the tick at a time', async () => {
  const store = memoryStore(); let now = 1000;
  const a = mk(store, 'A', () => now); const b = mk(store, 'B', () => now);
  let release; const gate = new Promise((r) => { release = r; });
  let runs = 0;
  const first = a.withLease('job', 60000, async () => { runs += 1; await gate; return 'a'; });
  await new Promise((r) => setImmediate(r));
  const second = await b.withLease('job', 60000, async () => { runs += 1; return 'b'; });
  assert.strictEqual(second.ran, false);
  assert.strictEqual(second.reason, 'held');
  release();
  assert.deepStrictEqual(await first, { ran: true, result: 'a' });
  assert.strictEqual(runs, 1);
  // once released, the other holder can run
  assert.strictEqual((await b.withLease('job', 60000, async () => 'b')).ran, true);
});

test('different names do not block each other; the same holder cannot run one name twice at once', async () => {
  const store = memoryStore(); const now = 1;
  const a = mk(store, 'A', () => now);
  let release; const gate = new Promise((r) => { release = r; });
  const p = a.withLease('x', 1000, () => gate);
  await new Promise((r) => setImmediate(r));
  assert.strictEqual((await a.withLease('y', 1000, async () => 1)).ran, true);
  assert.strictEqual((await a.withLease('x', 1000, async () => 1)).ran, false, 'overlapping tick in the same process skips');
  release(); await p;
});

test('expiry takeover: a crashed holder lease runs out and the other takes over', async () => {
  const store = memoryStore(); let now = 1000;
  const a = mk(store, 'A', () => now); const b = mk(store, 'B', () => now);
  const lease = await a.acquire('job', 60000); // A takes it and "crashes" (never released)
  assert.ok(lease);
  assert.strictEqual((await b.withLease('job', 60000, async () => 1)).ran, false);
  now += 59999;
  assert.strictEqual((await b.withLease('job', 60000, async () => 1)).ran, false, 'still live one ms before the end');
  now += 2;
  assert.deepStrictEqual(await b.withLease('job', 60000, async () => 'took over'), { ran: true, result: 'took over' });
});

test('renewal: a timer every ttl/3 pushes the end out while the tick runs; a lost lease is reported', async () => {
  const store = memoryStore(); let now = 0; const timers = fakeTimers();
  const a = mk(store, 'A', () => now, timers);
  let seen; let release; const gate = new Promise((r) => { release = r; });
  const p = a.withLease('job', 30000, async (ctx) => { seen = ctx; await gate; });
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(timers.fns.length, 1);
  assert.strictEqual(store.rows.get('job').expiresAt.getTime(), 30000);
  now = 10000; timers.fns[0].fn(); await new Promise((r) => setImmediate(r));
  assert.strictEqual(store.rows.get('job').expiresAt.getTime(), 40000, 'renewed from the current time');
  // somebody else took it after it expired: the next renewal says lost
  store.rows.set('job', { holder: 'B', expiresAt: new Date(99999) });
  timers.fns[0].fn(); await new Promise((r) => setImmediate(r));
  assert.strictEqual(seen.isLost(), true);
  release(); await p;
  assert.strictEqual(timers.fns.length, 0, 'renew timer cleared');
  assert.strictEqual(store.rows.get('job').holder, 'B', 'a lost lease is not released over the new holder');
});

test('a failing tick releases the lease and rethrows', async () => {
  const store = memoryStore(); const now = 5;
  const a = mk(store, 'A', () => now); const b = mk(store, 'B', () => now);
  await assert.rejects(() => a.withLease('job', 60000, async () => { throw new Error('boom'); }), /boom/);
  assert.strictEqual((await b.withLease('job', 60000, async () => 'ok')).ran, true, 'free again at once');
});

test('cooldown: after a successful tick the lease is kept so a second server does not repeat an hourly job; a failure is not kept', async () => {
  const store = memoryStore(); let now = 1000;
  const a = mk(store, 'A', () => now); const b = mk(store, 'B', () => now);
  assert.strictEqual((await a.withLease('hourly', 60000, async () => 1, { cooldownMs: 1800000 })).ran, true);
  now += 5000;
  assert.strictEqual((await b.withLease('hourly', 60000, async () => 1, { cooldownMs: 1800000 })).ran, false);
  now += 1800000;
  assert.strictEqual((await b.withLease('hourly', 60000, async () => 1, { cooldownMs: 1800000 })).ran, true);
  await assert.rejects(() => a.withLease('weekly', 60000, async () => { throw new Error('x'); }, { cooldownMs: 1800000 }));
  assert.strictEqual((await b.withLease('weekly', 60000, async () => 1)).ran, true);
});

test('a store that fails means "not claimed": the tick does not run', async () => {
  const bad = { async claim() { throw new Error('db down'); }, async renew() {}, async release() {} };
  const a = mk(bad, 'A', () => 0);
  let ran = false;
  assert.strictEqual((await a.withLease('job', 1000, async () => { ran = true; })).ran, false);
  assert.strictEqual(ran, false);
});

test('leased(): wraps a tick, passes arguments, returns the result or undefined when skipped', async () => {
  const store = memoryStore(); const now = 0;
  const a = mk(store, 'A', () => now); const b = mk(store, 'B', () => now);
  const tickA = a.leased('t', 1000, async (x) => x * 2);
  assert.strictEqual(await tickA(21), 42);
  await a.acquire('t', 1000);
  assert.strictEqual(await b.leased('t', 1000, async () => 'no')(), undefined);
});

test('single process: the lease is acquired immediately and every tick runs in turn', async () => {
  const store = memoryStore(); let now = 0;
  const a = mk(store, 'A', () => now);
  let n = 0; const tick = a.leased('t', 60000, async () => { n += 1; });
  for (let i = 0; i < 3; i += 1) { await tick(); now += 30000; }
  assert.strictEqual(n, 3);
});
