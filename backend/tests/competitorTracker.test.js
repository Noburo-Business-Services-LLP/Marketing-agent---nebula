const test = require('node:test');
const assert = require('node:assert');
const { trackOne, runTrackerOnce, startCompetitorTracker } = require('../services/competitors/tracker');
const { weekStartOf } = require('../services/week/weekMath');
const { createReadLedger } = require('../services/competitors/readLedger');

const NOW = new Date('2026-10-14T06:00:00Z'); // a Wednesday
const WEEK = weekStartOf(NOW);
const HOUR = 36e5;
const CAPS = { MAX_TRACKED: 5, READS_PER_DAY_MAX: 200, maxReadsPerAccountPerDay: 5, COOLDOWN_HOURS: 12, KEEP_WEEKS: 12, FAIL_PAUSE_AFTER: 3, ACCOUNTS_PER_PASS: 60, LEASE_MINUTES: 45 };
const ON = { ENABLE_COMPETITOR_TRACKER: 'on' };
// An in-memory lease like the real one: one holder at a time.
function fakeLease() {
  let held = false;
  const l = { claims: 0, releases: 0, async claim() { l.claims++; if (held) return null; held = true; return { value: 'x' }; }, async renew(t) { return t; }, async release() { l.releases++; held = false; }, isHeld: () => held };
  return l;
}
const seedReads = async (ledger, n, userId = 'seed') => { for (let i = 0; i < n; i++) await ledger.record({ userId: `${userId}${i}`, competitorId: `s${i}`, handle: 'x', at: NOW, source: 'tracker' }); };

const profileFor = () => ({
  followersCount: 1000, postsCount: 40,
  latestPosts: [{ timestamp: Math.floor(NOW.getTime() / 1000) - 3600, likesCount: 10, commentsCount: 2, type: 'Image', caption: 'hi' }]
});

function world({ users, competitors, scrape, caps = {}, gateIds = [], spendOk = true, rows = [], lease = fakeLease(), ledger = createReadLedger({ Model: null }) } = {}) {
  const calls = { scrape: [], recorded: [], checked: [], slept: [], saved: [], tracking: [] };
  const store = {
    rows,
    async save(s) { calls.saved.push(s); rows.push({ ...s }); return s; },
    async latest(id, n = 4) { return rows.filter((r) => String(r.competitorId) === String(id) && r.ok !== false).sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1)).slice(0, n); },
    async lastAttempt(id) { const r = rows.filter((x) => String(x.competitorId) === String(id)).sort((a, b) => b.takenAt - a.takenAt); return r[0] || null; },
    async prune() {},
  };
  const deps = {
    caps: { ...CAPS, ...caps },
    accounts: async () => users,
    markAccountRead: async () => {},
    lease,
    ledger,
    env: ON,
    competitorsFor: async (u) => competitors.filter((c) => String(c.userId) === String(u._id)),
    canUse: (u) => ({ allowed: u.entitled !== false }),
    gate: async () => gateIds,
    spend: { check: async (a) => { calls.checked.push(a); return spendOk ? { ok: true } : { ok: false }; }, record: async (a, n) => { calls.recorded.push([a, n]); } },
    scrapeProfile: scrape || (async (h) => { calls.scrape.push(h); return { success: true, data: [profileFor()] }; }),
    saveTracking: async (c, t) => { calls.tracking.push([c._id, t]); },
    sleep: async (ms) => { calls.slept.push(ms); },
    store
  };
  return { deps, calls, store, ledger, lease };
}
const user = (id, extra = {}) => ({ _id: id, isActive: true, onboardingCompleted: true, staffRole: null, isCsm: false, plan: { tier: 'growth' }, ...extra });
const comp = (id, userId, extra = {}) => ({
  _id: id, userId, isActive: true, isIgnored: false, socialHandles: { instagram: `h_${id}` }, createdAt: new Date(2026, 0, 1), tracking: {}, ...extra
});

test('(a) a due competitor is read once, snapshot saved, spend recorded', async () => {
  const w = world({ users: [user('u1')], competitors: [comp('c1', 'u1')] });
  const r = await runTrackerOnce({ deps: w.deps, now: NOW });
  assert.deepStrictEqual(r, { checked: 1, skipped: 0 });
  assert.deepStrictEqual(w.calls.scrape, ['h_c1']);
  assert.strictEqual(w.calls.saved.length, 1);
  assert.strictEqual(w.calls.saved[0].ok, true);
  assert.strictEqual(w.calls.saved[0].weekStart, WEEK);
  assert.strictEqual(w.calls.saved[0].handle, 'h_c1');
  assert.deepStrictEqual(w.calls.recorded, [['competitor_scrape', 1]]);
  assert.deepStrictEqual(w.calls.checked, ['competitor_scrape']);
});

test('(b) not entitled, staff, CSM, blocked by the gate, free: nothing is read', async () => {
  const users = [
    user('ne', { entitled: false }), user('st', { staffRole: 'admin' }), user('cs', { isCsm: true }),
    user('bl'), user('fr', { plan: { tier: 'free' } }), user('off', { isActive: false }), user('nb', { onboardingCompleted: false })
  ];
  const competitors = users.map((u) => comp(`c_${u._id}`, u._id));
  const w = world({ users, competitors, gateIds: ['bl'] });
  const r = await runTrackerOnce({ deps: w.deps, now: NOW });
  assert.strictEqual(r.checked, 0);
  assert.strictEqual(w.calls.scrape.length, 0);
  assert.strictEqual(w.calls.saved.length, 0);
});

test('(b2) a gate that fails skips the pass instead of crashing', async () => {
  const w = world({ users: [user('u1')], competitors: [comp('c1', 'u1')] });
  w.deps.gate = async () => { throw new Error('db down'); };
  const r = await runTrackerOnce({ deps: w.deps, now: NOW });
  assert.strictEqual(r.checked, 0);
  assert.strictEqual(w.calls.scrape.length, 0);
});

test('(c) no handle, ignored, paused, inactive: skipped', async () => {
  const competitors = [
    comp('a', 'u1', { socialHandles: {} }), comp('b', 'u1', { isIgnored: true }),
    comp('c', 'u1', { tracking: { failures: 3, pausedAt: new Date(NOW - 5 * 864e5), lastHandle: 'h_c' } }),
    comp('d', 'u1', { isActive: false })
  ];
  const w = world({ users: [user('u1')], competitors });
  const r = await runTrackerOnce({ deps: w.deps, now: NOW });
  assert.strictEqual(r.checked, 0);
  assert.strictEqual(w.calls.scrape.length, 0);
});

test('(d) cooldown and an existing snapshot for this week skip the read', async () => {
  const rows = [
    { competitorId: 'c1', weekStart: weekStartOf(new Date(NOW - 7 * 864e5)), ok: true, takenAt: new Date(NOW - 2 * HOUR), handle: 'h_c1' },
    { competitorId: 'c2', weekStart: WEEK, ok: true, takenAt: new Date(NOW - 30 * HOUR), handle: 'h_c2' }
  ];
  const w = world({ users: [user('u1')], competitors: [comp('c1', 'u1'), comp('c2', 'u1')], rows });
  const r = await runTrackerOnce({ deps: w.deps, now: NOW });
  assert.deepStrictEqual(r, { checked: 0, skipped: 2 });
  assert.strictEqual(w.calls.scrape.length, 0);
});

test('(d2) a failed attempt this week is not retried until next week', async () => {
  const rows = [{ competitorId: 'c1', weekStart: WEEK, ok: false, takenAt: new Date(NOW - 20 * HOUR), handle: 'h_c1' }];
  const w = world({ users: [user('u1')], competitors: [comp('c1', 'u1')], rows });
  const r = await runTrackerOnce({ deps: w.deps, now: NOW });
  assert.strictEqual(r.checked, 0);
  // next week it is read again
  const next = new Date(NOW.getTime() + 7 * 864e5);
  const r2 = await runTrackerOnce({ deps: w.deps, now: next });
  assert.strictEqual(r2.checked, 1);
});

test('(e) a failed read stores ok:false, keeps the last good snapshot, counts failures, pauses at 3, unpauses on a new handle', async () => {
  const good = { competitorId: 'c1', weekStart: '2026-10-05', ok: true, followers: 900, takenAt: new Date(NOW - 9 * 864e5), handle: 'h_c1' };
  const w = world({ users: [user('u1')], competitors: [], rows: [good], scrape: async () => ({ success: false, error: 'Actor failed' }) });
  const c = comp('c1', 'u1');
  for (let i = 1; i <= 3; i++) {
    const res = await trackOne({ competitor: c, user: user('u1'), now: new Date(NOW.getTime() + i * 7 * 864e5), deps: w.deps });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(c.tracking.failures, i);
  }
  assert.ok(c.tracking.pausedAt, 'paused after 3 failures');
  const failedRows = w.store.rows.filter((r) => r.ok === false);
  assert.strictEqual(failedRows.length, 3);
  assert.ok(failedRows.every((r) => r.error && r.error.length <= 200 && !/actor|apify/i.test(r.error)));
  const latest = await w.store.latest('c1', 1);
  assert.strictEqual(latest[0].followers, 900, 'last good snapshot still latest');

  // Paused: the pass skips it.
  w.deps.competitorsFor = async () => [c];
  const paused = await runTrackerOnce({ deps: w.deps, now: new Date(NOW.getTime() + 30 * 864e5) });
  assert.strictEqual(paused.checked, 0);

  // Handle changed: unpaused, failures reset, read again.
  c.socialHandles.instagram = 'new_handle';
  w.deps.scrapeProfile = async (h) => { w.calls.scrape.push(h); return { success: true, data: [profileFor()] }; };
  const fixed = await runTrackerOnce({ deps: w.deps, now: new Date(NOW.getTime() + 30 * 864e5) });
  assert.strictEqual(fixed.checked, 1);
  assert.deepStrictEqual(w.calls.scrape, ['new_handle']);
  assert.strictEqual(c.tracking.failures, 0);
  assert.ok(!c.tracking.pausedAt);
  assert.strictEqual(c.tracking.lastHandle, 'new_handle');
});

test('(e2) a good read resets the failure count', async () => {
  const w = world({ users: [], competitors: [] });
  const c = comp('c1', 'u1', { tracking: { failures: 2, lastHandle: 'h_c1' } });
  const res = await trackOne({ competitor: c, user: user('u1'), now: NOW, deps: w.deps });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(c.tracking.failures, 0);
});

test('(f) a scraper that throws never crashes the pass', async () => {
  const w = world({ users: [user('u1')], competitors: [comp('c1', 'u1'), comp('c2', 'u1')], scrape: async () => { throw new Error('boom'); } });
  const r = await runTrackerOnce({ deps: w.deps, now: NOW });
  assert.strictEqual(r.checked, 2);
  assert.strictEqual(w.calls.saved.length, 2);
  assert.ok(w.calls.saved.every((s) => s.ok === false));
  const one = await trackOne({ competitor: comp('c9', 'u1'), user: user('u1'), now: NOW, deps: { ...w.deps, store: { ...w.store, save: async () => { throw new Error('db'); } } } });
  assert.strictEqual(one.ok, false);
});

test('(g) the daily cap stops the pass exactly, counting real reads (attempts), not saved rows', async () => {
  const competitors = Array.from({ length: 5 }, (_, i) => comp(`c${i}`, 'u1'));
  const w = world({ users: [user('u1')], competitors, caps: { READS_PER_DAY_MAX: 3 } });
  const r = await runTrackerOnce({ deps: w.deps, now: NOW });
  assert.strictEqual(r.checked, 3);
  assert.strictEqual(w.calls.scrape.length, 3);
  // Reads already made today by other accounts: 2 left.
  const w2 = world({ users: [user('u1')], competitors });
  await seedReads(w2.ledger, 198);
  const r2 = await runTrackerOnce({ deps: w2.deps, now: NOW });
  assert.strictEqual(r2.checked, 2);
  // Cap already reached: nothing read.
  const w3 = world({ users: [user('u1')], competitors });
  await seedReads(w3.ledger, 200);
  assert.strictEqual((await runTrackerOnce({ deps: w3.deps, now: NOW })).checked, 0);
  assert.strictEqual(w3.calls.scrape.length, 0);
});

test('(h) a spend guard refusal stops the pass quietly with nothing read', async () => {
  const w = world({ users: [user('u1'), user('u2')], competitors: [comp('c1', 'u1'), comp('c2', 'u2')], spendOk: false });
  const r = await runTrackerOnce({ deps: w.deps, now: NOW });
  assert.strictEqual(r.checked, 0);
  assert.strictEqual(w.calls.scrape.length, 0);
  assert.strictEqual(w.calls.checked.length, 1, 'stopped at the first refusal');
  assert.strictEqual(w.calls.recorded.length, 0);
});

test('(i) at most 5 competitors per account, most recently added first', async () => {
  const competitors = Array.from({ length: 7 }, (_, i) => comp(`c${i}`, 'u1', { createdAt: new Date(2026, 0, 1 + i) }));
  const w = world({ users: [user('u1')], competitors });
  const r = await runTrackerOnce({ deps: w.deps, now: NOW });
  assert.strictEqual(r.checked, 5);
  assert.deepStrictEqual(w.calls.scrape, ['h_c6', 'h_c5', 'h_c4', 'h_c3', 'h_c2']);
  assert.strictEqual(w.calls.slept.filter((x) => x === 1000).length, 5);
});

test('(j) two overlapping runs: the second is a no-op', async () => {
  let release;
  const gateHold = new Promise((r) => { release = r; });
  const w = world({ users: [user('u1')], competitors: [comp('c1', 'u1')] });
  const orig = w.deps.scrapeProfile;
  w.deps.scrapeProfile = async (h) => { await gateHold; return orig(h); };
  const first = runTrackerOnce({ deps: w.deps, now: NOW });
  const second = await runTrackerOnce({ deps: w.deps, now: NOW });
  assert.strictEqual(second.checked, 0);
  release();
  const r1 = await first;
  assert.strictEqual(r1.checked, 1);
  assert.strictEqual(w.calls.scrape.length, 1);
  // after finishing, a new run is allowed again
  const third = await runTrackerOnce({ deps: world({ users: [], competitors: [] }).deps, now: NOW });
  assert.strictEqual(third.checked, 0);
});

test('(I4) startCompetitorTracker is off unless ENABLE_COMPETITOR_TRACKER is exactly "on", in every environment', () => {
  assert.strictEqual(startCompetitorTracker({ env: { NODE_ENV: 'test', ENABLE_COMPETITOR_TRACKER: 'on' } }), null);
  assert.strictEqual(startCompetitorTracker({ env: { NODE_ENV: 'production' } }), null, 'production, switch not set');
  assert.strictEqual(startCompetitorTracker({ env: {} }), null, 'development, switch not set');
  for (const v of ['off', 'ON', 'true', '1', '']) assert.strictEqual(startCompetitorTracker({ env: { NODE_ENV: 'production', ENABLE_COMPETITOR_TRACKER: v } }), null, v);
});

test('startCompetitorTracker schedules timers and logs once when the switch is on', () => {
  const lines = [];
  const h = startCompetitorTracker({ env: { NODE_ENV: 'production', ENABLE_COMPETITOR_TRACKER: 'on' }, logger: { log: (m) => lines.push(m), error() {}, warn() {} }, firstDelayMs: 1e9, intervalMs: 1e9 });
  assert.ok(h);
  assert.strictEqual(lines.length, 1);
  h.stop();
});

test('(I4) a pass with the switch off reads nothing and never touches the lease', async () => {
  const w = world({ users: [user('u1')], competitors: [comp('c1', 'u1')] });
  w.deps.env = {};
  const r = await runTrackerOnce({ deps: w.deps, now: NOW });
  assert.strictEqual(r.checked, 0);
  assert.strictEqual(r.disabled, true);
  assert.strictEqual(w.calls.scrape.length, 0);
  assert.strictEqual(w.lease.claims, 0);
});

test('(accountIds) a pass restricted to one account reads only that account', async () => {
  const w = world({ users: [user('u1'), user('u2')], competitors: [comp('c1', 'u1'), comp('c2', 'u2')] });
  const r = await runTrackerOnce({ deps: w.deps, now: NOW, accountIds: ['u2'] });
  assert.deepStrictEqual(r, { checked: 1, skipped: 0 });
  assert.deepStrictEqual(w.calls.scrape, ['h_c2']);
  const none = world({ users: [user('u1')], competitors: [comp('c1', 'u1')] });
  assert.deepStrictEqual(await runTrackerOnce({ deps: none.deps, now: NOW, accountIds: [] }), { checked: 0, skipped: 0 });
});

test('(force, I7) a forced read works on a competitor that WAS checked this week, and still obeys the daily cap, the account cap and the spend guard', async () => {
  // As in production: tracking.lastCheckedAt is set, a row exists for this week, and a good snapshot exists for this week.
  const checkedThisWeek = () => comp('c1', 'u1', { tracking: { lastCheckedAt: new Date(NOW.getTime() - HOUR), lastHandle: 'h_c1', failures: 0 } });
  const rowsFor = () => [{ competitorId: 'c1', weekStart: WEEK, ok: true, handle: 'h_c1', takenAt: new Date(NOW.getTime() - HOUR) }];
  const prime = async (w) => w.ledger.record({ userId: 'u1', competitorId: 'c1', handle: 'h_c1', at: new Date(NOW.getTime() - HOUR), source: 'tracker' });

  const plain = world({ users: [user('u1')], competitors: [checkedThisWeek()], rows: rowsFor() });
  await prime(plain);
  assert.deepStrictEqual(await runTrackerOnce({ deps: plain.deps, now: NOW }), { checked: 0, skipped: 1 });

  const forced = world({ users: [user('u1')], competitors: [checkedThisWeek()], rows: rowsFor() });
  await prime(forced);
  assert.deepStrictEqual(await runTrackerOnce({ deps: forced.deps, now: NOW, force: true }), { checked: 1, skipped: 0 });
  assert.deepStrictEqual(forced.calls.scrape, ['h_c1']);
  assert.strictEqual(await forced.ledger.countToday(NOW), 2, 'the forced read is counted');

  const capped = world({ users: [user('u1')], competitors: [checkedThisWeek()], rows: rowsFor() });
  await seedReads(capped.ledger, 200);
  assert.strictEqual((await runTrackerOnce({ deps: capped.deps, now: NOW, force: true })).checked, 0);

  const acct = world({ users: [user('u1')], competitors: [checkedThisWeek()], rows: rowsFor() });
  for (let i = 0; i < 5; i++) await acct.ledger.record({ userId: 'u1', competitorId: `x${i}`, handle: 'x', at: NOW, source: 'staff' });
  assert.strictEqual((await runTrackerOnce({ deps: acct.deps, now: NOW, force: true })).checked, 0, 'the per-account daily cap still applies');

  const guarded = world({ users: [user('u1')], competitors: [checkedThisWeek()], rows: rowsFor(), spendOk: false });
  assert.strictEqual((await runTrackerOnce({ deps: guarded.deps, now: NOW, force: true })).checked, 0);
  assert.strictEqual(guarded.calls.scrape.length, 0);
});

test('(force) a forced read does not read a paused or unconfirmed competitor', async () => {
  const w = world({ users: [user('u1')], competitors: [
    comp('p', 'u1', { tracking: { pausedAt: new Date(NOW - 864e5), failures: 3, lastHandle: 'h_p' } }),
    comp('s', 'u1', { handleStatus: 'suggested' })
  ] });
  assert.strictEqual((await runTrackerOnce({ deps: w.deps, now: NOW, force: true })).checked, 0);
});

test('(k) a store whose save always throws is read once per week across passes, logs, and a new handle reads again', async () => {
  const w = world({ users: [user('u1')], competitors: [] });
  w.store.save = async () => { throw new Error('E11000 duplicate key'); };
  const c = comp('c1', 'u1');
  w.deps.competitorsFor = async () => [c];
  const errors = [];
  const orig = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  try {
    let reads = 0;
    for (const hours of [0, 6, 12, 13]) {
      const r = await runTrackerOnce({ deps: w.deps, now: new Date(NOW.getTime() + hours * HOUR) });
      reads += r.checked;
    }
    assert.strictEqual(reads, 1);
    assert.strictEqual(w.calls.scrape.length, 1);
    assert.ok(errors.some((e) => e.includes('[competitors] could not save a check:') && e.includes('E11000')));
    assert.strictEqual(c.tracking.failures, 1, 'a failed save counts as a failure');
    assert.ok(w.calls.tracking.length >= 1, 'tracking state still saved');

    // Next week it is read again.
    const next = await runTrackerOnce({ deps: w.deps, now: new Date(NOW.getTime() + 7 * 864e5) });
    assert.strictEqual(next.checked, 1);

    // A changed handle bypasses the wait.
    c.socialHandles.instagram = 'fixed';
    const fixed = await runTrackerOnce({ deps: w.deps, now: new Date(NOW.getTime() + 7 * 864e5 + HOUR) });
    assert.strictEqual(fixed.checked, 1);
    assert.strictEqual(w.calls.scrape[w.calls.scrape.length - 1], 'fixed');
  } finally { console.error = orig; }
});

// ---- Stage 4 fix round A ----
const freshCopy = (tpl) => async () => tpl.map((c) => JSON.parse(JSON.stringify({ ...c, createdAt: c.createdAt })) ).map((c, i) => ({ ...c, createdAt: tpl[i].createdAt }));

test('(I1) both saves fail: the read is still recorded and the second pass reads nothing', async () => {
  const lines = [];
  const orig = console.error;
  console.error = (...a) => lines.push(a.join(' '));
  try {
    const failingLedgerModel = { create: async () => { throw new Error('disk full'); }, countDocuments: async () => { throw new Error('down'); }, findOne: () => ({ sort: () => ({ lean: async () => { throw new Error('down'); } }) }) };
    const ledger = createReadLedger({ Model: failingLedgerModel });
    const w = world({ users: [user('u1')], competitors: [], ledger });
    w.store.save = async () => { throw new Error('disk full'); };
    w.deps.saveTracking = async () => { throw new Error('disk full'); };
    w.store.lastAttempt = async () => null;
    // Competitors come back from the database fresh every pass, with no tracking state (the save failed).
    w.deps.competitorsFor = freshCopy([comp('c1', 'u1'), comp('c2', 'u1')]);
    const first = await runTrackerOnce({ deps: w.deps, now: NOW });
    assert.strictEqual(first.checked, 2);
    for (const hours of [6, 12, 13, 18]) {
      const again = await runTrackerOnce({ deps: w.deps, now: new Date(NOW.getTime() + hours * HOUR) });
      assert.strictEqual(again.checked, 0, `pass at +${hours}h`);
    }
    assert.strictEqual(w.calls.scrape.length, 2, 'each competitor read once');
    assert.strictEqual(await ledger.countToday(NOW), 2, 'the attempts are counted');
  } finally { console.error = orig; }
});

test('(I1) the read attempt is recorded durably even when the snapshot save throws', async () => {
  const rows = [];
  const model = { create: async (d) => { rows.push(d); }, countDocuments: async () => rows.length, findOne: () => ({ sort: () => ({ lean: async () => null }) }) };
  const w = world({ users: [user('u1')], competitors: [comp('c1', 'u1')], ledger: createReadLedger({ Model: model }) });
  w.store.save = async () => { throw new Error('E11000'); };
  const e = console.error; console.error = () => {};
  try { await runTrackerOnce({ deps: w.deps, now: NOW }); } finally { console.error = e; }
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(String(rows[0].competitorId), 'c1');
  assert.strictEqual(rows[0].source, 'tracker');
});

test('(I2) a second read of the same competitor in the same week is counted against the daily ceiling', async () => {
  const w = world({ users: [user('u1')], competitors: [comp('c1', 'u1')], caps: { READS_PER_DAY_MAX: 2 } });
  // save() overwrites the week's row like the real store, so the number of saved rows never grows past one.
  w.store.save = async (s) => { w.store.rows.length = 0; w.store.rows.push({ ...s }); return s; };
  assert.strictEqual((await runTrackerOnce({ deps: w.deps, now: NOW, force: true })).checked, 1);
  assert.strictEqual((await runTrackerOnce({ deps: w.deps, now: new Date(NOW.getTime() + HOUR), force: true })).checked, 1);
  assert.strictEqual(w.store.rows.length, 1, 'one row, two reads');
  assert.strictEqual(await w.ledger.countToday(NOW), 2);
  assert.strictEqual((await runTrackerOnce({ deps: w.deps, now: new Date(NOW.getTime() + 2 * HOUR), force: true })).checked, 0, 'the ceiling counts reads');
  assert.strictEqual(w.calls.scrape.length, 2);
});

test('(I3) a pass takes the lease first, releases it at the end (also after an error), and a second runner reads nothing', async () => {
  const w = world({ users: [user('u1')], competitors: [comp('c1', 'u1')] });
  assert.strictEqual((await runTrackerOnce({ deps: w.deps, now: NOW })).checked, 1);
  assert.strictEqual(w.lease.claims, 1);
  assert.strictEqual(w.lease.releases, 1);
  assert.strictEqual(w.lease.isHeld(), false);

  const other = world({ users: [user('u1')], competitors: [comp('c1', 'u1')] });
  await other.lease.claim(); // another server holds it
  const blocked = await runTrackerOnce({ deps: other.deps, now: NOW });
  assert.strictEqual(blocked.checked, 0);
  assert.strictEqual(blocked.busy, true);
  assert.strictEqual(other.calls.scrape.length, 0);
  assert.strictEqual(other.lease.releases, 0, 'a pass that never got the lease does not release it');

  const boom = world({ users: [user('u1')], competitors: [comp('c1', 'u1')] });
  boom.deps.accounts = async () => { throw new Error('db down'); };
  const e = console.error; console.error = () => {};
  try { await runTrackerOnce({ deps: boom.deps, now: NOW }); } finally { console.error = e; }
  assert.strictEqual(boom.lease.isHeld(), false, 'released after an error');
});

test('(I3) a lease that cannot be claimed (store down) means no pass', async () => {
  const w = world({ users: [user('u1')], competitors: [comp('c1', 'u1')] });
  w.deps.lease = { claim: async () => null, renew: async (t) => t, release: async () => {} };
  const r = await runTrackerOnce({ deps: w.deps, now: NOW });
  assert.strictEqual(r.checked, 0);
  assert.strictEqual(w.calls.scrape.length, 0);
});

test('(I5) the competitors that are read are exactly the ones shown: the newest five that are active and not ignored', async () => {
  const { trackedCompetitors } = require('../services/competitors/tracked');
  const competitors = Array.from({ length: 7 }, (_, i) => comp(`c${i}`, 'u1', { createdAt: new Date(2026, 0, 1 + i) }));
  competitors[6].socialHandles = {}; competitors[5].socialHandles = {}; // the two newest have no handle
  const shown = trackedCompetitors(competitors).map((c) => c._id);
  assert.deepStrictEqual(shown, ['c6', 'c5', 'c4', 'c3', 'c2']);
  const w = world({ users: [user('u1')], competitors });
  const r = await runTrackerOnce({ deps: w.deps, now: NOW });
  assert.strictEqual(r.checked, 3);
  assert.deepStrictEqual(w.calls.scrape, ['h_c4', 'h_c3', 'h_c2'], 'c1 and c0 are not shown, so they are not read');
});

test('(I8) a suggested handle is never read; verified, confirmed and older manual handles are; bad formats are not', async () => {
  const competitors = [
    comp('sug', 'u1', { handleStatus: 'suggested' }),
    comp('ver', 'u1', { handleStatus: 'verified' }),
    comp('con', 'u1', { handleStatus: 'confirmed' }),
    comp('old', 'u1', { handleStatus: undefined, isAutoDiscovered: false }),
    comp('oldauto', 'u1', { handleStatus: undefined, isAutoDiscovered: true })
  ];
  const w = world({ users: [user('u1')], competitors });
  await runTrackerOnce({ deps: w.deps, now: NOW });
  assert.deepStrictEqual(w.calls.scrape.sort(), ['h_con', 'h_old', 'h_ver']);
  const bad = world({ users: [user('u1')], competitors: ['n/a', 'https://instagram.com/x', 'a b', 'x'.repeat(31)].map((h, i) => comp(`b${i}`, 'u1', { socialHandles: { instagram: h } })) });
  assert.strictEqual((await runTrackerOnce({ deps: bad.deps, now: NOW })).checked, 0);
  assert.strictEqual(bad.calls.scrape.length, 0);
});

test('(I12) at most maxReadsPerAccountPerDay reads for one account in a day, across passes; the next day continues', async () => {
  const mk = () => Array.from({ length: 5 }, (_, i) => comp(`c${i}`, 'u1', { createdAt: new Date(2026, 0, 1 + i) }));
  const w = world({ users: [user('u1')], competitors: mk(), caps: { maxReadsPerAccountPerDay: 2 } });
  assert.strictEqual((await runTrackerOnce({ deps: w.deps, now: NOW })).checked, 2);
  assert.strictEqual((await runTrackerOnce({ deps: w.deps, now: new Date(NOW.getTime() + 6 * HOUR) })).checked, 0);
  assert.strictEqual(w.calls.scrape.length, 2);
  // Another account is not held back by this one.
  const two = world({ users: [user('u1'), user('u2')], competitors: [...mk(), comp('d0', 'u2')], caps: { maxReadsPerAccountPerDay: 2 } });
  assert.strictEqual((await runTrackerOnce({ deps: two.deps, now: NOW })).checked, 3);
  // Next UTC day: the account gets its 2 reads again.
  const next = new Date(NOW.getTime() + 24 * HOUR);
  assert.strictEqual((await runTrackerOnce({ deps: w.deps, now: next })).checked, 2);
});

test('(I11) 1,000 accounts and a cap that serves 280 a week: after 4 weeks every account has been read at least once', async () => {
  const users = Array.from({ length: 1000 }, (_, i) => user(`u${String(i).padStart(4, '0')}`));
  const competitors = users.map((u, i) => comp(`c${i}`, u._id));
  const byUser = new Map(competitors.map((c) => [c.userId, c]));
  const readUsers = new Set();
  const w = world({ users, competitors, caps: { READS_PER_DAY_MAX: 40 } });
  w.deps.competitorsFor = async (u) => [byUser.get(u._id)];
  w.deps.scrapeProfile = async (h) => { readUsers.add(h); return { success: true, data: [profileFor()] }; };
  w.deps.markAccountRead = async () => {};
  let total = 0;
  for (let day = 0; day < 28; day++) {
    for (const h of [0, 6, 12, 17]) {
      const at = new Date(NOW.getTime() + day * 24 * HOUR + h * HOUR);
      total += (await runTrackerOnce({ deps: w.deps, now: at })).checked;
    }
  }
  assert.ok(total <= 40 * 28, `never above the daily cap (${total})`);
  assert.strictEqual(readUsers.size, 1000, 'every account was read at least once');
});

test('(I11) the oldest read goes first, and accounts never read come before every account that has been', async () => {
  const users = [user('a', { competitorsReadAt: new Date('2026-10-10T00:00:00Z') }), user('b'), user('c', { competitorsReadAt: new Date('2026-10-01T00:00:00Z') })];
  const w = world({ users, competitors: [comp('ca', 'a'), comp('cb', 'b'), comp('cc', 'c')] });
  await runTrackerOnce({ deps: w.deps, now: NOW });
  assert.deepStrictEqual(w.calls.scrape, ['h_cb', 'h_cc', 'h_ca']);
  assert.ok(users.every((u) => new Date(u.competitorsReadAt).getTime() === NOW.getTime()), 'read accounts are stamped');
});

test('(I11) the default account lookup pages through every account, not the first 500', async () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../services/competitors/tracker.js'), 'utf8');
  assert.match(src, /\$gt: last/, 'pages by _id until a short page');
  assert.doesNotMatch(src, /accounts: \(limit = 500/, 'no hard 500');
});

test('(I11) the account lookup is asked for pages of caps.ACCOUNTS_PAGE, and the default lookup honours a page size', async () => {
  const w = world({ users: [user('u1')], competitors: [comp('c1', 'u1')] });
  const asked = [];
  const accounts = w.deps.accounts;
  w.deps.accounts = async (args) => { asked.push(args); return accounts(args); };
  w.deps.caps = { ...w.deps.caps, ACCOUNTS_PAGE: 3 };
  await runTrackerOnce({ deps: w.deps, now: NOW });
  assert.strictEqual(asked[0].pageSize, 3);
  const src = require('fs').readFileSync(require('path').join(__dirname, '../services/competitors/tracker.js'), 'utf8');
  assert.match(src, /limit\(size\)/, 'the page size is not hard-coded');
});

test('(busy) the pass reports busy when a pass is already running in this process', async () => {
  let release;
  const hold = new Promise((r) => { release = r; });
  const w = world({ users: [user('u1')], competitors: [comp('c1', 'u1')] });
  const orig = w.deps.scrapeProfile;
  w.deps.scrapeProfile = async (h) => { await hold; return orig(h); };
  const first = runTrackerOnce({ deps: w.deps, now: NOW });
  const second = await runTrackerOnce({ deps: w.deps, now: NOW });
  assert.strictEqual(second.busy, true);
  release();
  await first;
});
