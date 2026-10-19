const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const router = require('../routes/competitorInsights');
const { createCompetitorInsightsRouter } = router;
const { runTrackerOnce } = require('../services/competitors/tracker');
const { weekStartOf } = require('../services/week/weekMath');
const { can } = require('../services/staff/permissions');
const { isBlockedWhileActing } = require('../services/csmAccess');
const { isBlockedInsideClient } = require('../services/agencyWorkspaces');

const quiet = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };
const routesOf = (r) => r.stack.filter((l) => l.route).map((l) => ({ path: l.route.path, method: Object.keys(l.route.methods)[0], handlers: l.route.stack.map((s) => s.handle) }));
const mkRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });

const NOW = new Date('2026-10-14T06:00:00Z'); // a Wednesday
const WEEK = weekStartOf(NOW);
const PREV = weekStartOf(new Date(NOW.getTime() - 7 * 864e5));
const DAY = 864e5;

const owner = (extra = {}) => ({ _id: 'u1', isActive: true, plan: { tier: 'starter', addons: ['competitors'] }, ...extra });
const comp = (id, userId, extra = {}) => ({
  _id: id, userId, name: `Rival ${id}`, isActive: true, isIgnored: false, socialHandles: { instagram: `@h_${id}` },
  createdAt: new Date(2026, 0, 1), tracking: {}, ...extra
});
const snap = (competitorId, weekStart, extra = {}) => ({
  competitorId, userId: 'u1', weekStart, ok: true, takenAt: new Date(NOW.getTime() - DAY), followers: 1000,
  postsInWindow: 3, posts30: 10, avgLikes: 20, avgComments: 2, formats: { image: 5, video: 3, carousel: 2 }, topPost: null, hashtags: [], ...extra
});

// A fake store keyed by competitor id, like the real one: it answers only for the id it is asked about.
function world({ competitors = [], snapshots = [] } = {}) {
  const asked = [];
  const deps = {
    competitorsFor: async (userId) => competitors.filter((c) => String(c.userId) === String(userId) && c.isActive !== false && !c.isIgnored),
    store: {
      async latest(id, n = 4) { asked.push(String(id)); return snapshots.filter((s) => String(s.competitorId) === String(id) && s.ok !== false).sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1)).slice(0, n); },
      async lastAttempt(id) { asked.push(String(id)); return snapshots.filter((s) => String(s.competitorId) === String(id)).sort((a, b) => b.takenAt - a.takenAt)[0] || null; }
    }
  };
  return { deps, asked };
}

// Runs the real chain after `protect` and the limiter (they need a signed token): the entitlement gate, then the handler.
async function call({ deps, user, loadUser }) {
  const r = routesOf(createCompetitorInsightsRouter({ deps, now: () => NOW, loadUser: loadUser || (async () => user) })).find((x) => x.method === 'get' && x.path === '/');
  assert.strictEqual(r.handlers.length, 4, 'protect, limiter, entitlement, handler');
  const res = mkRes();
  const req = { user };
  const chain = r.handlers.slice(2);
  let i = 0;
  const next = async () => { const h = chain[i++]; if (h) await h(req, res, next); };
  await next();
  return res;
}

test('an account without the add-on is refused with the standard add-on message', async () => {
  const user = owner({ plan: { tier: 'starter', addons: [] } });
  const res = await call({ deps: world().deps, user });
  assert.strictEqual(res.code, 403);
  assert.strictEqual(res.body.success, false);
  assert.strictEqual(res.body.upgradeRequired, true);
  assert.strictEqual(res.body.feature, 'competitors');
  assert.strictEqual(res.body.message, 'This needs an add-on. Please add it to your plan or upgrade.');
  const free = await call({ deps: world().deps, user: owner({ plan: { tier: 'free' } }) });
  assert.strictEqual(free.code, 403);
  assert.strictEqual(free.body.upgradeRequired, true);
});

test('no signed-in user id is a 401', async () => {
  const res = await call({ deps: world().deps, user: {}, loadUser: async () => owner() });
  assert.strictEqual(res.code, 401);
  assert.strictEqual(res.body.success, false);
});

test('a lookup or store failure is a generic 500 that never leaks the error text', async () => {
  const deps = { competitorsFor: async () => { throw new Error('mongo secret detail'); }, store: {} };
  const res = await quiet(() => call({ deps, user: owner() }));
  assert.strictEqual(res.code, 500);
  assert.strictEqual(res.body.message, 'We could not complete that request. Please try again.');
  assert.ok(!JSON.stringify(res.body).includes('secret'));
});

test('the body has one row per competitor with the right status, and never raw snapshots', async () => {
  const competitors = [
    comp('ok', 'u1', { createdAt: new Date(2026, 5, 6), tracking: { lastCheckedAt: new Date('2026-10-13T06:00:00Z') } }),
    comp('nohandle', 'u1', { createdAt: new Date(2026, 5, 5), socialHandles: {} }),
    comp('failed', 'u1', { createdAt: new Date(2026, 5, 4) }),
    comp('paused', 'u1', { createdAt: new Date(2026, 5, 3), tracking: { failures: 3, pausedAt: new Date('2026-10-01') } }),
    comp('waiting', 'u1', { createdAt: new Date(2026, 5, 2) })
  ];
  const snapshots = [
    snap('ok', WEEK, { postsInWindow: 5 }), snap('ok', PREV, { postsInWindow: 2 }),
    { competitorId: 'failed', userId: 'u1', weekStart: WEEK, ok: false, error: 'This account is private', takenAt: new Date(NOW.getTime() - DAY) },
    snap('paused', PREV)
  ];
  const res = await call({ deps: world({ competitors, snapshots }).deps, user: owner() });
  assert.strictEqual(res.code, 200);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(res.body.weekStart, WEEK);
  const by = Object.fromEntries(res.body.competitors.map((c) => [c.id, c]));
  assert.deepStrictEqual(res.body.competitors.map((c) => c.id), ['ok', 'nohandle', 'failed', 'paused', 'waiting'], 'most recently added first');
  assert.strictEqual(by.ok.status, 'tracking');
  assert.strictEqual(by.ok.handle, 'h_ok');
  assert.strictEqual(by.ok.name, 'Rival ok');
  assert.strictEqual(by.ok.lastCheckedAt, '2026-10-13T06:00:00.000Z');
  assert.deepStrictEqual(by.ok.trend, [{ weekStart: PREV, postsInWindow: 2, avgLikes: 20 }, { weekStart: WEEK, postsInWindow: 5, avgLikes: 20 }]);
  assert.strictEqual(by.nohandle.status, 'no_handle');
  assert.strictEqual(by.nohandle.handle, '');
  assert.strictEqual(by.failed.status, 'failed');
  assert.strictEqual(by.failed.lastCheckedAt, new Date(NOW.getTime() - DAY).toISOString());
  assert.strictEqual(by.paused.status, 'paused');
  assert.strictEqual(by.waiting.status, 'waiting');
  assert.strictEqual(by.waiting.lastCheckedAt, null);
  assert.deepStrictEqual(by.waiting.trend, []);
  assert.ok(res.body.highlights.length >= 1);
  assert.ok(res.body.highlights.some((h) => /Rival ok posted 5 times this week, up from 2\./.test(h.text)));
  for (const h of res.body.highlights) assert.deepStrictEqual(Object.keys(h).sort(), ['competitorId', 'name', 'text', 'weight']);
  const text = JSON.stringify(res.body);
  for (const leak of ['formats', 'topPost', 'hashtags', 'private', 'takenAt', 'userId']) assert.ok(!text.includes(leak), leak);
  // Followers only as { value, change } from the newest good reading (the tiles on the competitors card), or null.
  for (const c of res.body.competitors) {
    assert.ok(c.followers === null || (Object.keys(c.followers).sort().join() === 'change,value' && c.followers.value > 0), `${c.name} followers shape`);
  }
});

test('a failed latest check with a good snapshot this week is still tracking; a failed week after an older good one is failed', async () => {
  const competitors = [comp('a', 'u1', { createdAt: new Date(2026, 2, 2) }), comp('b', 'u1', { createdAt: new Date(2026, 2, 1) })];
  const failedNow = (id) => ({ competitorId: id, userId: 'u1', weekStart: WEEK, ok: false, takenAt: new Date(NOW.getTime() - 3600000) });
  const snapshots = [snap('a', WEEK, { takenAt: new Date(NOW.getTime() - 2 * 3600000) }), failedNow('a'), snap('b', PREV), failedNow('b')];
  const res = await call({ deps: world({ competitors, snapshots }).deps, user: owner() });
  const by = Object.fromEntries(res.body.competitors.map((c) => [c.id, c.status]));
  assert.strictEqual(by.a, 'tracking');
  assert.strictEqual(by.b, 'failed');
});

test('ignored and inactive competitors are omitted, and at most five are shown, newest first', async () => {
  const competitors = [
    comp('ign', 'u1', { isIgnored: true }), comp('off', 'u1', { isActive: false }),
    ...[1, 2, 3, 4, 5, 6, 7].map((n) => comp(`c${n}`, 'u1', { createdAt: new Date(2026, 3, n) }))
  ];
  // a store that returns everything regardless of the flags, to prove the route filters too
  const deps = { competitorsFor: async () => competitors, store: world().deps.store };
  const res = await call({ deps, user: owner() });
  assert.deepStrictEqual(res.body.competitors.map((c) => c.id), ['c7', 'c6', 'c5', 'c4', 'c3']);
});

test('no data of another account ever appears: only this account\'s competitor ids are read', async () => {
  const competitors = [comp('mine', 'u1'), comp('theirs', 'u2', { name: 'Other Account Rival', socialHandles: { instagram: 'secret_handle' } })];
  const snapshots = [
    snap('mine', WEEK), snap('mine', PREV, { postsInWindow: 1 }),
    snap('theirs', WEEK, { userId: 'u2', postsInWindow: 99, avgLikes: 4242 }),
    // a mislabelled row under my competitor but owned by someone else is dropped too
    snap('mine', weekStartOf(new Date(NOW.getTime() - 14 * DAY)), { userId: 'u2', postsInWindow: 77 })
  ];
  const w = world({ competitors, snapshots });
  const res = await call({ deps: w.deps, user: owner() });
  assert.deepStrictEqual(res.body.competitors.map((c) => c.id), ['mine']);
  assert.ok(!w.asked.includes('theirs'), 'the other account\'s competitor is never looked up');
  const text = JSON.stringify(res.body);
  for (const leak of ['theirs', 'Other Account', 'secret_handle', '4242', '99', '77']) assert.ok(!text.includes(leak), leak);
  assert.strictEqual(res.body.competitors[0].trend.length, 2);
  // the other account's own call returns only theirs
  const other = await call({ deps: w.deps, user: { ...owner(), _id: 'u2' } });
  assert.deepStrictEqual(other.body.competitors.map((c) => c.id), ['theirs']);
  assert.ok(!JSON.stringify(other.body).includes('Rival mine'));
});

test('staff: a CSM without access is refused; the routes use the client-access check, the permission and the log', () => {
  const client = { _id: 'c1', assignedCsm: 'csmA' };
  assert.strictEqual(can({ _id: 'csmB', isCsm: true }, 'view_clients', client), false);
  assert.strictEqual(can({ _id: 'csmB', isCsm: true }, 'open_client', client), false);
  assert.strictEqual(can({ _id: 'csmA', isCsm: true }, 'open_client', client), true);
  const src = fs.readFileSync(path.join(__dirname, '../routes/staff.js'), 'utf8');
  const view = src.match(/router\.get\('\/clients\/:id\/competitors'[\s\S]*?\n\}\);/)[0];
  const check = src.match(/router\.post\('\/clients\/:id\/competitors\/check'[\s\S]*?\n\}\);/)[0];
  assert.match(view, /requireStaff\('view_clients'\)/);
  assert.match(view, /clientFor\(req, res\)/);
  assert.match(check, /requireStaff\('open_client'\)/);
  assert.match(check, /competitorInsights'\)\.checkLimiter/);
  assert.match(check, /clientFor\(req, res, 'open_client'\)/);
  assert.match(check, /record: recordStaffAction/);
  assert.ok(src.indexOf("router.use(protect)") < src.indexOf("'/clients/:id/competitors/check'"));
});

test('staff view is the same body for that client', async () => {
  const w = world({ competitors: [comp('mine', 'c1')], snapshots: [{ ...snap('mine', WEEK), userId: 'c1' }] });
  const body = await router.viewFor({ _id: 'c1' }, { deps: w.deps, now: NOW });
  assert.strictEqual(body.success, true);
  assert.deepStrictEqual(body.competitors.map((c) => c.id), ['mine']);
});

// A small world for the real tracker pass, as production has it: one client, one competitor that WAS read 2 hours ago
// this week (tracking.lastCheckedAt set, a stored row for this week, a ledger entry), so only a forced read can go ahead.
function trackerWorld({ ledgerSeed = 0, spendOk = true, entitled = true, switchOn = true, leaseHeld = false } = {}) {
  const { createReadLedger } = require('../services/competitors/readLedger');
  const calls = { scrape: [], recorded: [], checked: [] };
  const ledger = createReadLedger({ Model: null });
  const checkedAt = new Date(NOW.getTime() - 2 * 36e5);
  const rows = [{ competitorId: 'c1', weekStart: WEEK, ok: true, handle: 'h_c1', takenAt: checkedAt }];
  let held = leaseHeld;
  const deps = {
    caps: { MAX_TRACKED: 5, READS_PER_DAY_MAX: 200, maxReadsPerAccountPerDay: 5, COOLDOWN_HOURS: 12, KEEP_WEEKS: 12, FAIL_PAUSE_AFTER: 3, ACCOUNTS_PER_PASS: 60 },
    env: switchOn ? { ENABLE_COMPETITOR_TRACKER: 'on' } : {},
    ledger,
    lease: { claim: async () => (held ? null : ((held = true), { value: 'x' })), renew: async (t) => t, release: async () => { held = false; } },
    accounts: async ({ ids } = {}) => [{ _id: 'client1', isActive: true, onboardingCompleted: true, staffRole: null, isCsm: false, plan: { tier: 'growth' } }, { _id: 'other', isActive: true, onboardingCompleted: true, plan: { tier: 'growth' } }]
      .filter((u) => !ids || ids.map(String).includes(u._id)),
    markAccountRead: async () => {},
    competitorsFor: async (u) => [comp('c1', 'client1', { tracking: { lastCheckedAt: checkedAt, lastHandle: 'h_c1', failures: 0 } }), comp('c2', 'other')].filter((c) => c.userId === u._id),
    canUse: () => ({ allowed: entitled }),
    gate: async () => [],
    spend: { check: async (a) => { calls.checked.push(a); return spendOk ? { ok: true } : { ok: false }; }, record: async (a, n) => { calls.recorded.push([a, n]); } },
    scrapeProfile: async (h) => { calls.scrape.push(h); return { success: true, data: [{ followersCount: 10, postsCount: 1, latestPosts: [] }] }; },
    saveTracking: async () => {}, sleep: async () => {},
    store: {
      async save(s) { rows.push({ ...s }); return s; },
      async latest(id) { return rows.filter((r) => String(r.competitorId) === String(id) && r.ok !== false); },
      async lastAttempt(id) { return rows.filter((r) => String(r.competitorId) === String(id)).sort((a, b) => b.takenAt - a.takenAt)[0] || null; },
      async prune() {}
    }
  };
  const ready = (async () => {
    await ledger.record({ userId: 'client1', competitorId: 'c1', handle: 'h_c1', at: checkedAt, source: 'tracker' });
    for (let i = 0; i < ledgerSeed; i++) await ledger.record({ userId: `seed${i}`, competitorId: `s${i}`, handle: 'x', at: NOW, source: 'tracker' });
  })();
  return { deps, calls, ledger, ready };
}
const client = { _id: 'client1' };
const staffUser = { _id: 's1', staffRole: 'admin' };

test('(I7) staff check reads a competitor that was already checked this week, reads only that client, counts the read and logs it', async () => {
  const w = trackerWorld(); await w.ready;
  const logged = [];
  // without force the same competitor is still waiting for next week
  assert.strictEqual((await runTrackerOnce({ deps: trackerWorld().deps, now: NOW, accountIds: ['client1'] })).checked, 0);
  const out = await router.staffCheck({ client, staff: staffUser, record: async (r) => logged.push(r), now: NOW, runTracker: (a) => runTrackerOnce({ ...a, deps: w.deps }) });
  assert.deepStrictEqual(out, { success: true, checked: 1, skipped: 0, busy: false, disabled: false });
  assert.deepStrictEqual(w.calls.scrape, ['h_c1'], 'the other account is not read');
  assert.strictEqual(await w.ledger.countToday(NOW), 2, 'the forced read is counted with the earlier one');
  assert.deepStrictEqual(logged, [{ actor: staffUser, action: 'check_competitors', client: 'client1', details: { checked: 1 } }]);
});

test('(I7) staff check still respects the daily cap, the per-account cap, the spend guard, the add-on and the switch', async () => {
  const run = (w) => (a) => runTrackerOnce({ ...a, deps: w.deps });
  const staffRun = async (w) => { await w.ready; return router.staffCheck({ client, staff: staffUser, record: async () => {}, now: NOW, runTracker: run(w) }); };
  const capped = trackerWorld({ ledgerSeed: 200 });
  assert.strictEqual((await staffRun(capped)).checked, 0);
  assert.deepStrictEqual(capped.calls.scrape, []);
  const perAccount = trackerWorld();
  await perAccount.ready;
  for (let i = 0; i < 4; i++) await perAccount.ledger.record({ userId: 'client1', competitorId: `x${i}`, handle: 'x', at: NOW, source: 'staff' });
  assert.strictEqual((await staffRun(perAccount)).checked, 0, 'five reads for this account today already');
  const guarded = trackerWorld({ spendOk: false });
  assert.strictEqual((await staffRun(guarded)).checked, 0);
  assert.deepStrictEqual(guarded.calls.scrape, []);
  assert.deepStrictEqual(guarded.calls.recorded, []);
  assert.strictEqual((await staffRun(trackerWorld({ entitled: false }))).checked, 0);
  const off = await staffRun(trackerWorld({ switchOn: false }));
  assert.strictEqual(off.checked, 0);
  assert.strictEqual(off.disabled, true);
});

test('(I7) staff check says so when another pass is running instead of pretending it checked', async () => {
  const w = trackerWorld({ leaseHeld: true }); await w.ready;
  const out = await router.staffCheck({ client, staff: staffUser, record: async () => {}, now: NOW, runTracker: (a) => runTrackerOnce({ ...a, deps: w.deps }) });
  assert.strictEqual(out.success, true);
  assert.strictEqual(out.checked, 0);
  assert.strictEqual(out.busy, true);
  assert.deepStrictEqual(w.calls.scrape, []);
});

test('(I5) the competitors shown are the ones the tracker reads: same list, same order, same cap', async () => {
  const { trackedCompetitors } = require('../services/competitors/tracker') && require('../services/competitors/tracked');
  const competitors = [
    ...[1, 2, 3, 4, 5, 6, 7].map((n) => comp(`c${n}`, 'u1', { createdAt: new Date(2026, 3, n) })),
    comp('nohandle1', 'u1', { createdAt: new Date(2026, 3, 9), socialHandles: {} }),
    comp('paused1', 'u1', { createdAt: new Date(2026, 3, 8), tracking: { pausedAt: new Date('2026-10-01'), failures: 3 } })
  ];
  const res = await call({ deps: world({ competitors }).deps, user: owner() });
  const shown = res.body.competitors.map((c) => c.id);
  assert.deepStrictEqual(shown, trackedCompetitors(competitors).map((c) => c._id));
  assert.deepStrictEqual(shown, ['nohandle1', 'paused1', 'c7', 'c6', 'c5']);
  // and the tracker, given the same list, reads only from that shown set
  const t = trackerWorld(); await t.ready;
  t.deps.competitorsFor = async () => competitors.map((c) => ({ ...c, userId: 'client1' }));
  await runTrackerOnce({ deps: t.deps, now: NOW, accountIds: ['client1'], force: true });
  assert.deepStrictEqual(t.calls.scrape, ['h_c7', 'h_c6', 'h_c5']);
});

test('(I6) each row says which week its numbers are from, and an old snapshot is not described as this week', async () => {
  const competitors = [
    comp('fresh', 'u1', { createdAt: new Date(2026, 5, 3) }), comp('old', 'u1', { createdAt: new Date(2026, 5, 2) }), comp('gap', 'u1', { createdAt: new Date(2026, 5, 1) })
  ];
  const oldWeek = weekStartOf(new Date(NOW.getTime() - 5 * 7 * DAY));
  const olderWeek = weekStartOf(new Date(NOW.getTime() - 6 * 7 * DAY));
  const gapWeek = weekStartOf(new Date(NOW.getTime() - 3 * 7 * DAY));
  const snapshots = [
    snap('fresh', WEEK, { postsInWindow: 5 }), snap('fresh', PREV, { postsInWindow: 2 }),
    snap('old', oldWeek, { postsInWindow: 5 }), snap('old', olderWeek, { postsInWindow: 2 }),
    snap('gap', WEEK, { postsInWindow: 5 }), snap('gap', gapWeek, { postsInWindow: 2 })
  ];
  const res = await call({ deps: world({ competitors, snapshots }).deps, user: owner() });
  const by = Object.fromEntries(res.body.competitors.map((c) => [c.id, c]));
  assert.deepStrictEqual([by.fresh.weekOf, by.fresh.isCurrentWeek, by.fresh.previousWeekOf], [WEEK, true, PREV]);
  assert.deepStrictEqual([by.old.weekOf, by.old.isCurrentWeek, by.old.previousWeekOf], [oldWeek, false, olderWeek]);
  assert.ok(by.old.lastCheckedOn, 'a date to say "last checked on"');
  assert.deepStrictEqual([by.gap.weekOf, by.gap.isCurrentWeek, by.gap.previousWeekOf], [WEEK, true, null]);
  const texts = res.body.highlights.map((h) => h.text).join(' ');
  assert.match(texts, /Rival fresh posted 5 times this week, up from 2\./);
  assert.doesNotMatch(texts, /Rival old/);
  assert.doesNotMatch(texts, /Rival gap posted/);
});

test('(I8) rows carry handleStatus; an unconfirmed or badly formed handle is shown as such and never as tracking', async () => {
  const competitors = [
    comp('sug', 'u1', { createdAt: new Date(2026, 5, 6), handleStatus: 'suggested' }),
    comp('ver', 'u1', { createdAt: new Date(2026, 5, 5), handleStatus: 'verified' }),
    comp('con', 'u1', { createdAt: new Date(2026, 5, 4), handleStatus: 'confirmed' }),
    comp('legacy', 'u1', { createdAt: new Date(2026, 5, 3), handleStatus: undefined, isAutoDiscovered: true }),
    comp('bad', 'u1', { createdAt: new Date(2026, 5, 2), socialHandles: { instagram: 'n/a' }, handleStatus: 'confirmed' })
  ];
  const res = await call({ deps: world({ competitors, snapshots: [snap('sug', WEEK)] }).deps, user: owner() });
  const by = Object.fromEntries(res.body.competitors.map((c) => [c.id, c]));
  assert.deepStrictEqual([by.sug.handleStatus, by.ver.handleStatus, by.con.handleStatus, by.legacy.handleStatus], ['suggested', 'verified', 'confirmed', 'suggested']);
  assert.strictEqual(by.sug.status, 'unconfirmed');
  assert.strictEqual(by.legacy.status, 'unconfirmed');
  assert.strictEqual(by.ver.status, 'waiting');
  assert.strictEqual(by.bad.status, 'no_handle');
});

test('the customer endpoint works inside CSM and agency passes, and is mounted before the competitors router', () => {
  assert.strictEqual(isBlockedWhileActing('/api/competitors/insights', 'GET'), false);
  assert.strictEqual(isBlockedInsideClient('/api/competitors/insights', 'GET'), false);
  const src = fs.readFileSync(path.join(__dirname, '../server-main.js'), 'utf8');
  const mine = src.indexOf("app.use('/api/competitors/insights', require('./routes/competitorInsights'))");
  const old = src.indexOf("app.use('/api/competitors', competitorRoutes)");
  assert.ok(mine > -1 && old > -1 && mine < old);
});
