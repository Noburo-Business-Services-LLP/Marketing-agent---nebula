// Cost controls for competitor reads (Stage 4 fix round A): the read ledger (I1, I2, I12), the single-runner lease (I3),
// the shared guard (I4, I13), the shared tracked list (I5) and the handle rules (I8). Fakes only: no database, no scraper.
const test = require('node:test');
const assert = require('node:assert');
const { createReadLedger } = require('../services/competitors/readLedger');
const { createLease, opsStateStore } = require('../services/competitors/lease');
const { createReadGuard, trackerEnabled, ReadRefused, guardedRead } = require('../services/competitors/readGuard');
const { trackedCompetitors, handleOf, handleStatusOf, isValidHandle, isReadable } = require('../services/competitors/tracked');
const { removeCompetitorsWithSnapshots } = require('../services/competitors/cleanup');

const AT = new Date('2026-10-14T06:00:00Z');
const CAPS = { MAX_TRACKED: 5, READS_PER_DAY_MAX: 200, maxReadsPerAccountPerDay: 5 };
const ON = { ENABLE_COMPETITOR_TRACKER: 'on' };

const matches = (r, f) => Object.entries(f).every(([k, v]) => String(r[k]) === String(v));
function fakeLogModel({ failCreate = false, failCount = false } = {}) {
  const rows = [];
  return {
    rows,
    async create(doc) { if (failCreate) throw new Error('disk full'); rows.push({ ...doc }); },
    async countDocuments(f) { if (failCount) throw new Error('down'); return rows.filter((r) => matches(r, f)).length; },
    findOne(f) {
      const found = rows.filter((r) => matches(r, f)).sort((a, b) => b.at - a.at)[0] || null;
      const q = { sort: () => q, lean: async () => found };
      return q;
    }
  };
}

// ---- read ledger (I1, I2, I12) ----
test('the ledger counts every recorded read, per day and per account, even for the same competitor twice (I2)', async () => {
  const l = createReadLedger({ Model: fakeLogModel() });
  for (let i = 0; i < 3; i++) await l.record({ userId: 'u1', competitorId: 'c1', handle: 'h', at: AT, source: 'tracker' });
  await l.record({ userId: 'u2', competitorId: 'c2', handle: 'h2', at: AT, source: 'staff' });
  assert.strictEqual(await l.countToday(AT), 4);
  assert.strictEqual(await l.countUserToday('u1', AT), 3);
  assert.strictEqual(await l.countUserToday('u2', AT), 1);
  assert.strictEqual(await l.countToday(new Date(AT.getTime() + 864e5)), 0, 'a new UTC day starts at zero');
});

test('the ledger still counts and remembers when every database write and read fails (I1)', async () => {
  const l = createReadLedger({ Model: fakeLogModel({ failCreate: true, failCount: true }) });
  await l.record({ userId: 'u1', competitorId: 'c1', handle: 'h', at: AT, source: 'tracker' });
  assert.strictEqual(await l.countToday(AT), 1);
  assert.strictEqual(await l.countUserToday('u1', AT), 1);
  const last = await l.lastRead('c1');
  assert.strictEqual(last.handle, 'h');
  assert.strictEqual(new Date(last.at).getTime(), AT.getTime());
});

test('a ledger with no model at all works from memory and never throws', async () => {
  const l = createReadLedger({ Model: null });
  await l.record({ userId: 'u1', competitorId: 'c1', handle: 'h', at: AT, source: 'tracker' });
  assert.strictEqual(await l.countToday(AT), 1);
  assert.strictEqual(await l.lastRead('nope'), null);
});

test('the ledger uses the larger of the stored and in-process counts (two servers)', async () => {
  const model = fakeLogModel();
  const a = createReadLedger({ Model: model });
  const b = createReadLedger({ Model: model });
  await a.record({ userId: 'u1', competitorId: 'c1', handle: 'h', at: AT, source: 'tracker' });
  await b.record({ userId: 'u1', competitorId: 'c2', handle: 'h', at: AT, source: 'tracker' });
  assert.strictEqual(await a.countToday(AT), 2, 'server A sees the read server B made');
});

// ---- lease (I3) ----
function fakeOpsModel() {
  const docs = new Map();
  return {
    docs,
    async findOneAndUpdate(filter, update, opts) {
      const cur = docs.get(filter.key);
      if (cur && cur.value < filter.value.$lt) { cur.value = update.$set.value; return { ...cur }; }
      if (!cur && opts.upsert) { docs.set(filter.key, { key: filter.key, value: update.$set.value }); return { ...docs.get(filter.key) }; }
      if (cur && opts.upsert) { const e = new Error('E11000 duplicate key'); e.code = 11000; throw e; }
      return null;
    },
    async updateOne(filter, update) {
      const cur = docs.get(filter.key);
      if (cur && cur.value === filter.value) { cur.value = update.$set.value; return { modifiedCount: 1 }; }
      return { modifiedCount: 0 };
    }
  };
}

test('lease: the second claimant gets nothing while the first holds it', async () => {
  const model = fakeOpsModel();
  const a = createLease({ store: opsStateStore(model), ttlMs: 60000, holder: 'A' });
  const b = createLease({ store: opsStateStore(model), ttlMs: 60000, holder: 'B' });
  const tokenA = await a.claim(AT);
  assert.ok(tokenA);
  assert.strictEqual(await b.claim(new Date(AT.getTime() + 1000)), null);
  assert.strictEqual(await a.claim(new Date(AT.getTime() + 2000)), null, 'not even the same holder can double-claim');
});

test('lease: an expired lease can be taken, and a released lease can be taken at once', async () => {
  const model = fakeOpsModel();
  const a = createLease({ store: opsStateStore(model), ttlMs: 60000, holder: 'A' });
  const b = createLease({ store: opsStateStore(model), ttlMs: 60000, holder: 'B' });
  await a.claim(AT);
  const later = new Date(AT.getTime() + 61000);
  const tokenB = await b.claim(later);
  assert.ok(tokenB, 'expired lease is taken');
  assert.strictEqual(await a.claim(new Date(later.getTime() + 1000)), null, 'B now holds it');
  await b.release(tokenB);
  assert.ok(await a.claim(new Date(later.getTime() + 2000)), 'a released lease is free straight away');
});

test('lease: renew pushes the expiry out, and a stale holder cannot release or renew someone else\'s lease', async () => {
  const model = fakeOpsModel();
  const a = createLease({ store: opsStateStore(model), ttlMs: 60000, holder: 'A' });
  const b = createLease({ store: opsStateStore(model), ttlMs: 60000, holder: 'B' });
  let tokenA = await a.claim(AT);
  tokenA = await a.renew(tokenA, new Date(AT.getTime() + 50000));
  assert.strictEqual(await b.claim(new Date(AT.getTime() + 70000)), null, 'renewed lease is still held');
  const tokenB = await b.claim(new Date(AT.getTime() + 120000));
  assert.ok(tokenB);
  await a.release(tokenA); // stale: must not free B's lease
  assert.strictEqual(await a.claim(new Date(AT.getTime() + 121000)), null);
});

test('lease: a store that fails is treated as not claimed (never runs unguarded)', async () => {
  const l = createLease({ store: { claim: async () => { throw new Error('down'); }, swap: async () => false }, ttlMs: 1000, holder: 'A' });
  assert.strictEqual(await l.claim(AT), null);
});

// ---- guard (I4, I12, I13) ----
const okSpend = () => ({ calls: [], check: async function () { return { ok: true }; }, record: async function (a, n) { this.calls.push([a, n]); } });

test('I4: the tracker is on only when the switch is exactly "on"', () => {
  assert.strictEqual(trackerEnabled({}), false);
  assert.strictEqual(trackerEnabled({ ENABLE_COMPETITOR_TRACKER: '' }), false);
  for (const v of ['ON', 'On', 'true', '1', 'yes', 'off', 'enabled']) assert.strictEqual(trackerEnabled({ ENABLE_COMPETITOR_TRACKER: v }), false, v);
  assert.strictEqual(trackerEnabled({ ENABLE_COMPETITOR_TRACKER: 'on' }), true);
  assert.strictEqual(trackerEnabled({ ENABLE_COMPETITOR_TRACKER: ' on ' }), true);
});

test('guard: refuses with a plain message for each stop, in order: switch, account cap, daily ceiling, spend guard', async () => {
  const ledger = createReadLedger({ Model: null });
  const spend = okSpend();
  const mk = (extra = {}) => createReadGuard({ ledger, spend, caps: CAPS, env: ON, ...extra });
  assert.deepStrictEqual(await mk().allow({ userId: 'u1', at: AT }), { ok: true });

  const off = await mk({ env: {} }).allow({ userId: 'u1', at: AT });
  assert.strictEqual(off.ok, false); assert.strictEqual(off.reason, 'switched_off');
  assert.ok(off.message && !/quark|credit|apify|trial/i.test(off.message));

  const refused = await createReadGuard({ ledger, spend: { check: async () => ({ ok: false, message: 'Busy.' }), record: async () => {} }, caps: CAPS, env: ON }).allow({ userId: 'u1', at: AT });
  assert.strictEqual(refused.reason, 'spend'); assert.strictEqual(refused.message, 'Busy.');

  for (let i = 0; i < 5; i++) await ledger.record({ userId: 'u1', competitorId: `c${i}`, handle: 'h', at: AT, source: 'tracker' });
  const acct = await mk().allow({ userId: 'u1', at: AT });
  assert.strictEqual(acct.reason, 'account_cap');
  assert.deepStrictEqual(await mk().allow({ userId: 'u2', at: AT }), { ok: true }, 'another account is unaffected');

  const day = await mk({ caps: { ...CAPS, READS_PER_DAY_MAX: 5 } }).allow({ userId: 'u2', at: AT });
  assert.strictEqual(day.reason, 'daily_cap');
});

test('guard.note records the read in the ledger and with the spend guard, and never throws', async () => {
  const ledger = createReadLedger({ Model: null });
  const spend = okSpend();
  const g = createReadGuard({ ledger, spend, caps: CAPS, env: ON });
  await g.note({ userId: 'u1', competitorId: 'c1', handle: 'h', at: AT, source: 'customer' });
  assert.strictEqual(await ledger.countToday(AT), 1);
  assert.deepStrictEqual(spend.calls, [['competitor_scrape', 1]]);
  const broken = createReadGuard({ ledger, spend: { check: async () => ({ ok: true }), record: async () => { throw new Error('x'); } }, caps: CAPS, env: ON });
  await broken.note({ userId: 'u1', competitorId: 'c1', handle: 'h', at: AT, source: 'customer' });
});

test('I13: guardedRead refuses before calling the scraper when the guard says no, and counts the call when it says yes', async () => {
  const ledger = createReadLedger({ Model: null });
  let calls = 0;
  const fn = async () => { calls++; return 'ok'; };
  const off = createReadGuard({ ledger, spend: okSpend(), caps: CAPS, env: {} });
  await assert.rejects(() => guardedRead({ guard: off, userId: 'u1', competitorId: 'c1', handle: 'h', at: AT, fn }), (e) => e instanceof ReadRefused && /try again/i.test(e.message));
  assert.strictEqual(calls, 0);
  const on = createReadGuard({ ledger, spend: okSpend(), caps: CAPS, env: ON });
  assert.strictEqual(await guardedRead({ guard: on, userId: 'u1', competitorId: 'c1', handle: 'h', at: AT, fn }), 'ok');
  assert.strictEqual(calls, 1);
  assert.strictEqual(await ledger.countToday(AT), 1);
  // the per-account cap stops a sixth customer-triggered read
  for (let i = 0; i < 4; i++) await guardedRead({ guard: on, userId: 'u1', competitorId: 'c1', handle: 'h', at: AT, fn });
  await assert.rejects(() => guardedRead({ guard: on, userId: 'u1', competitorId: 'c1', handle: 'h', at: AT, fn }), ReadRefused);
  assert.strictEqual(calls, 5);
});

// ---- tracked list and handle rules (I5, I8) ----
const comp = (id, extra = {}) => ({ _id: id, userId: 'u1', name: id, isActive: true, isIgnored: false, socialHandles: { instagram: `h_${id}` }, handleStatus: 'confirmed', createdAt: new Date(2026, 0, 1), ...extra });

test('I5: the tracked list is deterministic: newest first, id as tie-break, ignored and inactive dropped, capped at five', () => {
  const same = new Date(2026, 0, 1);
  const list = [comp('a', { createdAt: same }), comp('b', { createdAt: same }), comp('c', { createdAt: same }), comp('ign', { isIgnored: true }), comp('off', { isActive: false }),
    comp('d', { createdAt: new Date(2026, 5, 1) }), comp('e', { createdAt: same }), comp('f', { createdAt: same })];
  const one = trackedCompetitors(list).map((c) => c._id);
  const two = trackedCompetitors([...list].reverse()).map((c) => c._id);
  assert.deepStrictEqual(one, two, 'input order does not matter');
  assert.strictEqual(one.length, 5);
  assert.strictEqual(one[0], 'd');
  assert.ok(!one.includes('ign') && !one.includes('off'));
});

test('I8: handle format is strict and statuses decide what may be read', () => {
  for (const ok of ['sweet.co', 'a_b', 'A1', 'x'.repeat(30)]) assert.strictEqual(isValidHandle(ok), true, ok);
  for (const bad of ['', 'n/a', 'https://instagram.com/x', 'a b', 'x'.repeat(31), 'a-b', '@@x', 'é']) assert.strictEqual(isValidHandle(bad), false, bad);
  assert.strictEqual(handleOf({ socialHandles: { instagram: ' @Sweet.Co ' } }), 'Sweet.Co');
  assert.strictEqual(handleStatusOf(comp('x', { handleStatus: 'suggested' })), 'suggested');
  assert.strictEqual(handleStatusOf(comp('x', { handleStatus: 'verified' })), 'verified');
  assert.strictEqual(handleStatusOf(comp('x', { handleStatus: undefined, isAutoDiscovered: false })), 'confirmed', 'older manual competitors keep working');
  assert.strictEqual(handleStatusOf(comp('x', { handleStatus: undefined, isAutoDiscovered: true })), 'suggested', 'older guessed handles wait for the customer');
  assert.strictEqual(isReadable(comp('r')), true);
  assert.strictEqual(isReadable(comp('r', { handleStatus: 'verified' })), true);
  assert.strictEqual(isReadable(comp('s', { handleStatus: 'suggested' })), false);
  assert.strictEqual(isReadable(comp('p', { tracking: { pausedAt: new Date() } })), false);
  assert.strictEqual(isReadable(comp('n', { socialHandles: {} })), false);
  assert.strictEqual(isReadable(comp('bad', { socialHandles: { instagram: 'n/a' } })), false);
});

// ---- cleanup (Minor) ----
test('removing competitors also removes their snapshots, and a snapshot failure never stops the removal', async () => {
  const log = [];
  const Competitor = { find: () => ({ select: () => ({ lean: async () => [{ _id: 'a' }, { _id: 'b' }] }) }), deleteMany: async (f) => { log.push(['competitors', f]); return { deletedCount: 2 }; } };
  const Snapshot = { deleteMany: async (f) => { log.push(['snapshots', f]); return {}; } };
  const r = await removeCompetitorsWithSnapshots({ userId: 'u1', isAutoDiscovered: true }, { Competitor, Snapshot });
  assert.strictEqual(r.deletedCount, 2);
  assert.deepStrictEqual(log[0], ['snapshots', { competitorId: { $in: ['a', 'b'] } }]);
  const failing = await removeCompetitorsWithSnapshots({ userId: 'u1' }, { Competitor, Snapshot: { deleteMany: async () => { throw new Error('x'); } } });
  assert.strictEqual(failing.deletedCount, 2);
});
