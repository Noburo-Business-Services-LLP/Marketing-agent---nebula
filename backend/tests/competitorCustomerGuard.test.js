// Stage 4 fix round A, I13 + I8 + Minor: the customer-triggered scrapes in routes/competitors.js go through the same
// switch, daily ceiling, per-account cap and spend guard as the tracker. Fakes only: no scraper, no database.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const router = require('../routes/competitors');
const { createReadGuard, ReadRefused } = require('../services/competitors/readGuard');
const { createReadLedger } = require('../services/competitors/readLedger');

const CAPS = { MAX_TRACKED: 5, READS_PER_DAY_MAX: 200, maxReadsPerAccountPerDay: 5 };
const ON = { ENABLE_COMPETITOR_TRACKER: 'on' };
const quiet = async (fn) => { const l = console.log; const e = console.error; const w = console.warn; console.log = console.error = console.warn = () => {}; try { return await fn(); } finally { console.log = l; console.error = e; console.warn = w; } };

const rich = { fullName: 'Sweet Co Bakery', biography: 'bakery cakes and sweets', username: 'sweetco', externalUrl: 'https://sweetco.com', latestPosts: [{ timestamp: new Date().toISOString(), caption: 'cake day', likesCount: 4 }] };
const competitor = (extra = {}) => ({ _id: 'c1', userId: 'u1', name: 'Sweet Co', website: 'https://sweetco.com', industry: 'bakery', description: 'cakes and sweets', socialHandles: { instagram: 'sweetco' }, ...extra });

function setup({ env = ON, caps = CAPS, spendOk = true, profile = rich, searchUsername = null } = {}) {
  const ledger = createReadLedger({ Model: null });
  const spendCalls = [];
  const guard = createReadGuard({ ledger, spend: { check: async () => (spendOk ? { ok: true } : { ok: false, message: 'Busy.' }), record: async (a, n) => spendCalls.push([a, n]) }, caps, env });
  const scraped = [];
  const searched = [];
  const db = [];
  router._deps.guard = guard;
  router._deps.scrapeProfile = async (h) => { scraped.push(h); return { success: true, data: [{ ...profile, username: h }] }; };
  router._deps.searchByName = async (name) => { searched.push(name); return searchUsername ? { success: true, username: searchUsername } : { success: false }; };
  router._deps.Competitor = {
    findByIdAndUpdate: async (id, u) => { db.push(['findByIdAndUpdate', id, u]); },
    updateOne: async (f, u) => { db.push(['updateOne', f, u]); },
    find: async () => [competitor({ posts: [] })]
  };
  return { ledger, scraped, searched, db, spendCalls, guard };
}
test.afterEach(() => { router._deps.guard = null; router._deps.scrapeProfile = null; router._deps.searchByName = null; router._deps.Competitor = null; });

test('I13: with the switch off, finding a handle refuses before any scraper call', async () => {
  const s = setup({ env: {} });
  await assert.rejects(() => quiet(() => router.findInstagramProfile(competitor())), (e) => e instanceof ReadRefused && e.reason === 'switched_off');
  assert.deepStrictEqual(s.scraped, []);
  assert.deepStrictEqual(s.searched, []);
  assert.strictEqual(await s.ledger.countToday(new Date()), 0);
});

test('I13: the background post fetch after an add or a discovery stops quietly when the guard says no', async () => {
  const s = setup({ env: {} });
  const posts = await quiet(() => router.fetchPostsForCompetitors([competitor(), competitor({ _id: 'c2' })]));
  assert.deepStrictEqual(posts, []);
  assert.deepStrictEqual(s.scraped, []);
});

test('I13: every scraper call is counted in the same ledger and with the spend guard', async () => {
  const s = setup();
  const found = await quiet(() => router.findInstagramProfile(competitor()));
  assert.ok(found && found.handle === 'sweetco');
  assert.deepStrictEqual(s.scraped, ['sweetco']);
  assert.strictEqual(await s.ledger.countToday(new Date()), 1);
  assert.strictEqual(await s.ledger.countUserToday('u1', new Date()), 1);
  assert.deepStrictEqual(s.spendCalls, [['competitor_scrape', 1]]);
});

test('I13: the per-account daily cap stops customer scrapes too, the spend guard refusal too', async () => {
  const s = setup({ caps: { ...CAPS, maxReadsPerAccountPerDay: 2 } });
  // a competitor whose handle fails validation, so the finder keeps trying: given handle, search, two name variations
  router._deps.scrapeProfile = async (h) => { s.scraped.push(h); return { success: true, data: [{ fullName: 'Someone Else', latestPosts: [{ timestamp: new Date().toISOString() }], username: h }] }; };
  await assert.rejects(() => quiet(() => router.findInstagramProfile(competitor({ name: 'Zed Bakes', website: '' }))), (e) => e instanceof ReadRefused && e.reason === 'account_cap');
  assert.strictEqual(s.scraped.length + s.searched.length, 2, 'stopped at the cap, not after it');
  const refused = setup({ spendOk: false });
  await assert.rejects(() => quiet(() => router.findInstagramProfile(competitor())), (e) => e instanceof ReadRefused && e.reason === 'spend');
  assert.deepStrictEqual(refused.scraped, []);
});

test('I13: the daily ceiling for all accounts stops customer scrapes', async () => {
  const s = setup({ caps: { ...CAPS, READS_PER_DAY_MAX: 3 } });
  for (let i = 0; i < 3; i++) await s.ledger.record({ userId: `other${i}`, competitorId: `x${i}`, handle: 'x', at: new Date(), source: 'tracker' });
  await assert.rejects(() => quiet(() => router.findInstagramProfile(competitor())), (e) => e instanceof ReadRefused && e.reason === 'daily_cap');
  assert.deepStrictEqual(s.scraped, []);
});

function handlerFor(p) {
  const layer = router.stack.find((l) => l.route && l.route.path === p && l.route.methods.post);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}
const mkRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });

test('I13: /scrape-by-type refuses with a plain message when the switch or a cap stops it, before any scraper call', async () => {
  const s = setup({ env: {} });
  const res = mkRes();
  await quiet(() => handlerFor('/scrape-by-type')({ user: { userId: 'u1' }, body: { competitorType: 'local' } }, res));
  assert.strictEqual(res.code, 429);
  assert.strictEqual(res.body.success, false);
  assert.match(res.body.message, /try again/i);
  assert.ok(!/quark|credit|apify|trial/i.test(res.body.message));
  assert.deepStrictEqual(s.scraped, []);
  const capped = setup({ caps: { ...CAPS, maxReadsPerAccountPerDay: 0 } });
  const res2 = mkRes();
  await quiet(() => handlerFor('/scrape-by-type')({ user: { userId: 'u1' }, body: { competitorType: 'local' } }, res2));
  assert.strictEqual(res2.code, 429);
  assert.deepStrictEqual(capped.scraped, []);
});

test('I8: a handle our own profile check accepts is marked verified; a handle the customer confirmed is never replaced', async () => {
  const s = setup();
  await quiet(() => router.findInstagramProfile(competitor({ handleStatus: 'suggested' })));
  assert.ok(s.db.some(([m, , u]) => m === 'updateOne' && u.$set && u.$set.handleStatus === 'verified'), 'verified is recorded');
  // The customer's own handle is kept even if the check does not match, and no search replaces it.
  const t = setup({ profile: { fullName: 'Nobody Related', latestPosts: [{ timestamp: new Date().toISOString() }] }, searchUsername: 'someone_else' });
  const found = await quiet(() => router.findInstagramProfile(competitor({ handleStatus: 'confirmed' })));
  assert.ok(found && found.handle === 'sweetco', 'the confirmed handle is used as it is');
  assert.deepStrictEqual(t.searched, [], 'no search for a replacement');
  assert.ok(!t.db.some(([m]) => m === 'findByIdAndUpdate'), 'the stored handle is not overwritten');
});

test('I8 + Minor: new competitors start with a suggested handle, the lists return handleStatus, and re-discovery also removes snapshots', () => {
  const dir = path.join(__dirname, '..');
  const src = fs.readFileSync(path.join(dir, 'routes/competitors.js'), 'utf8');
  assert.match(src, /handleStatus: instagramHandle \? 'suggested'/);
  assert.match(src, /handleStatus: handleStatusOf\(c\)/);
  for (const f of ['routes/competitors.js', 'routes/auth.js', 'routes/brand.js', 'routes/dashboard.js']) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.doesNotMatch(text, /Competitor\.deleteMany\(\{ userId, isAutoDiscovered: true \}\)/, `${f} deletes competitors together with their snapshots`);
    assert.match(text, /removeCompetitorsWithSnapshots\(\{ userId, isAutoDiscovered: true \}\)/, f);
  }
  for (const f of ['routes/auth.js', 'routes/brand.js', 'routes/dashboard.js']) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.match(text, /handleStatus: 'suggested'/, `${f} marks guessed handles as suggested`);
  }
});
