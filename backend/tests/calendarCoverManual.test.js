// POST /api/content-calendar/cover (manual "Make a cover"): atomic claim, 60s cooldown, 3 a day, spend guard. Fakes only.
const test = require('node:test');
const assert = require('node:assert/strict');

const geminiPath = require.resolve('../services/geminiAI');
require.cache[geminiPath] = { id: geminiPath, filename: geminiPath, loaded: true, exports: {} };
const ContentCalendar = require('../models/ContentCalendar');
const User = require('../models/User');
const { startManualCover } = require('../services/contentCalendarService');
const router = require('../routes/contentCalendar');

const MIN = 60 * 1000;
const NOW = new Date('2026-10-19T12:00:00Z');
const DAY = '2026-10-19';

// Understands exactly the claim startManualCover sends.
function store(docs) {
  const calls = { updates: 0 };
  return {
    calls,
    find: () => ({ lean: async () => docs }),
    async updateOne(filter, update) {
      const doc = docs.find((d) => String(d._id) === String(filter._id));
      if (!doc) return { modifiedCount: 0 };
      const dayKey = Object.keys(filter).find((k) => k.startsWith('manualCoverDays.'));
      const day = dayKey.split('.')[1];
      if (Number((doc.manualCoverDays || {})[day] || 0) >= 3) return { modifiedCount: 0 };
      const cut = filter.$and[0].$or[1].lastCoverAttemptAt.$lt;
      if (doc.coverStatus === 'pending' && !(doc.lastCoverAttemptAt && doc.lastCoverAttemptAt < cut)) return { modifiedCount: 0 };
      Object.assign(doc, update.$set);
      doc.manualCoverDays = { ...(doc.manualCoverDays || {}), [day]: ((doc.manualCoverDays || {})[day] || 0) + 1 };
      calls.updates += 1;
      return { modifiedCount: 1 };
    }
  };
}
const guard = (ok = true) => ({ checks: [], recorded: [], async check(a) { this.checks.push(a); return { ok }; }, async record(a, n) { this.recorded.push([a, n]); } });
const mk = (id, extra = {}) => ({ _id: id, userId: 'u1', month: '2026-10', coverStatus: 'ready', lastCoverAttemptAt: new Date(NOW - 60 * MIN), weeks: [], ...extra });
const tick = () => new Promise((r) => setImmediate(r));

test('two parallel manual requests start exactly one render', async () => {
  const doc = mk('c1'); const g = guard(); let renders = 0; const model = store([doc]);
  const deps = { ContentCalendar: model, spendGuard: g, generate: async () => { renders++; return 'https://x/c.jpg'; } };
  const rs = await Promise.all([startManualCover({ ...doc }, {}, { now: NOW, deps }), startManualCover({ ...doc }, {}, { now: NOW, deps })]);
  await tick();
  assert.equal(rs.filter((r) => r.started).length, 1);
  assert.equal(renders, 1);
  assert.deepEqual(g.recorded, [['campaign_text', 1], ['image_generated', 1]]);
  assert.deepEqual(g.checks.slice(0, 1), ['image_generated']);
});

test('a render that is already running (under 10 minutes) is left alone; a stuck one is restarted', async () => {
  const fresh = mk('c1', { coverStatus: 'pending', lastCoverAttemptAt: new Date(NOW - 2 * MIN) });
  const a = await startManualCover(fresh, {}, { now: NOW, deps: { ContentCalendar: store([fresh]), spendGuard: guard(), generate: async () => '' } });
  assert.equal(a.reason, 'pending');
  const stuck = mk('c2', { coverStatus: 'pending', lastCoverAttemptAt: new Date(NOW - 11 * MIN) });
  const b = await startManualCover(stuck, {}, { now: NOW, deps: { ContentCalendar: store([stuck]), spendGuard: guard(), generate: async () => '' } });
  assert.equal(b.started, true);
});

test('3 manual renders per account per day across months, a 4th is refused, and a new day resets', async () => {
  const docs = [mk('a'), mk('b', { month: '2026-11' }), mk('c', { month: '2026-09' }), mk('d', { month: '2026-08' })];
  const model = store(docs); let renders = 0;
  const deps = { ContentCalendar: model, spendGuard: guard(), generate: async () => { renders++; return ''; } };
  for (const d of docs.slice(0, 3)) assert.equal((await startManualCover({ ...d }, {}, { now: NOW, deps })).started, true);
  const fourth = await startManualCover({ ...docs[3] }, {}, { now: NOW, deps });
  assert.equal(fourth.reason, 'daily-cap'); assert.equal(renders, 3);
  const nextDay = await startManualCover({ ...docs[3], coverStatus: 'ready' }, {}, { now: new Date(NOW.getTime() + 24 * 60 * MIN), deps });
  assert.equal(nextDay.started, true);
});

test('a refused spend check starts nothing and changes nothing', async () => {
  const doc = mk('c1'); const model = store([doc]); let renders = 0;
  const r = await startManualCover(doc, {}, { now: NOW, deps: { ContentCalendar: model, spendGuard: guard(false), generate: async () => { renders++; return ''; } } });
  assert.equal(r.reason, 'spend-guard'); assert.equal(renders, 0); assert.equal(model.calls.updates, 0); assert.equal(doc.coverStatus, 'ready');
});

// ---- the route itself
const handler = router.stack.find((l) => l.route && l.route.path === '/cover' && l.route.methods.post).route.stack.pop().handle;
const mkRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
function wire({ docs, g = guard() }) {
  const model = store(docs); let renders = 0;
  router.testDeps = { ContentCalendar: model, spendGuard: g, generate: async () => { renders++; return ''; } };
  ContentCalendar.findOne = async ({ month }) => docs.find((d) => d.month === month) || null;
  User.findById = async () => ({});
  return { renders: () => renders, model };
}
const post = (userId, month = '2026-10') => { const res = mkRes(); return handler({ user: { _id: userId }, body: { month } }, res).then(() => res); };

test('route: success returns pending quickly, a second call within a minute is 429 with the calm message', async () => {
  const w = wire({ docs: [mk('c1')] });
  const a = await post('rt-a'); await tick();
  assert.equal(a.code, 200); assert.deepEqual(a.body, { success: true, status: 'pending' }); assert.equal(w.renders(), 1);
  const b = await post('rt-a');
  assert.equal(b.code, 429); assert.equal(b.body.message, 'Please wait a minute before making another cover.');
  assert.equal(w.renders(), 1);
});

test('route: spend guard blocked and daily cap give calm 429s and start nothing', async () => {
  const w = wire({ docs: [mk('c1')], g: guard(false) });
  const a = await post('rt-b');
  assert.equal(a.code, 429); assert.match(a.body.message, /try again a little later/); assert.equal(w.renders(), 0);
  const full = wire({ docs: [mk('c1', { manualCoverDays: { [new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10)]: 3 } })] });
  const b = await post('rt-c');
  assert.equal(b.code, 429); assert.match(b.body.message, /enough covers for today/); assert.equal(full.renders(), 0);
});

test('route: no calendar for the month is a plain 404', async () => {
  wire({ docs: [] });
  assert.equal((await post('rt-d')).code, 404);
});
