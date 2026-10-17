const test = require('node:test');
const assert = require('node:assert');
const { trackOne, runTrackerOnce, startCompetitorTracker } = require('../services/competitors/tracker');
const { weekStartOf } = require('../services/week/weekMath');

const NOW = new Date('2026-10-14T06:00:00Z'); // a Wednesday
const WEEK = weekStartOf(NOW);
const HOUR = 36e5;
const CAPS = { MAX_TRACKED: 5, READS_PER_DAY_MAX: 200, COOLDOWN_HOURS: 12, KEEP_WEEKS: 12, FAIL_PAUSE_AFTER: 3 };

const profileFor = () => ({
  followersCount: 1000, postsCount: 40,
  latestPosts: [{ timestamp: Math.floor(NOW.getTime() / 1000) - 3600, likesCount: 10, commentsCount: 2, type: 'Image', caption: 'hi' }]
});

function world({ users, competitors, scrape, caps = {}, gateIds = [], spendOk = true, rows = [], readsTodayFn } = {}) {
  const calls = { scrape: [], recorded: [], checked: [], slept: [], saved: [], tracking: [] };
  const store = {
    rows,
    async save(s) { calls.saved.push(s); rows.push({ ...s }); return s; },
    async latest(id, n = 4) { return rows.filter((r) => String(r.competitorId) === String(id) && r.ok !== false).sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1)).slice(0, n); },
    async lastAttempt(id) { const r = rows.filter((x) => String(x.competitorId) === String(id)).sort((a, b) => b.takenAt - a.takenAt); return r[0] || null; },
    async prune() {},
    async readsToday() { return readsTodayFn ? readsTodayFn() : 0; }
  };
  const deps = {
    caps: { ...CAPS, ...caps },
    accounts: async () => users,
    competitorsFor: async (u) => competitors.filter((c) => String(c.userId) === String(u._id)),
    canUse: (u) => ({ allowed: u.entitled !== false }),
    gate: async () => gateIds,
    spend: { check: async (a) => { calls.checked.push(a); return spendOk ? { ok: true } : { ok: false }; }, record: async (a, n) => { calls.recorded.push([a, n]); } },
    scrapeProfile: scrape || (async (h) => { calls.scrape.push(h); return { success: true, data: [profileFor()] }; }),
    saveTracking: async (c, t) => { calls.tracking.push([c._id, t]); },
    sleep: async (ms) => { calls.slept.push(ms); },
    store
  };
  return { deps, calls, store };
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

test('(g) the daily cap stops the pass exactly, even when the stored count undercounts', async () => {
  const competitors = Array.from({ length: 5 }, (_, i) => comp(`c${i}`, 'u1'));
  // The store always reports 0 reads (simulates a failed save that did not refresh takenAt).
  const w = world({ users: [user('u1')], competitors, caps: { READS_PER_DAY_MAX: 3 } });
  const r = await runTrackerOnce({ deps: w.deps, now: NOW });
  assert.strictEqual(r.checked, 3);
  assert.strictEqual(w.calls.scrape.length, 3);
  // Stored reads already near the cap: 2 left.
  const w2 = world({ users: [user('u1')], competitors, caps: { READS_PER_DAY_MAX: 200 }, readsTodayFn: () => 198 });
  const r2 = await runTrackerOnce({ deps: w2.deps, now: NOW });
  assert.strictEqual(r2.checked, 2);
  // Cap already reached: nothing read.
  const w3 = world({ users: [user('u1')], competitors, readsTodayFn: () => 200 });
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

test('startCompetitorTracker is off in tests and with the env switch', () => {
  assert.strictEqual(startCompetitorTracker({ env: { NODE_ENV: 'test' } }), null);
  assert.strictEqual(startCompetitorTracker({ env: { NODE_ENV: 'production', ENABLE_COMPETITOR_TRACKER: 'off' } }), null);
});

test('startCompetitorTracker schedules timers and logs once', () => {
  const lines = [];
  const h = startCompetitorTracker({ env: { NODE_ENV: 'production' }, logger: { log: (m) => lines.push(m), error() {}, warn() {} }, firstDelayMs: 1e9, intervalMs: 1e9 });
  assert.ok(h);
  assert.strictEqual(lines.length, 1);
  h.stop();
});
