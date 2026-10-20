// GET /api/content-calendar is read-only: it never makes a calendar (an AI call of 7 to 8 s) and never writes.
// A calendar is made by POST /api/content-calendar/prepare (in the background) or the existing generate routes. Fakes only.
const test = require('node:test');
const assert = require('node:assert/strict');

const geminiPath = require.resolve('../services/geminiAI');
require.cache[geminiPath] = { id: geminiPath, filename: geminiPath, loaded: true, exports: {} };
const router = require('../routes/contentCalendar');
const { healStaleCovers } = require('../services/contentCalendarService');

const handlerFor = (method, path) => {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  assert.ok(layer, `${method} ${path} exists`);
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
};
const mkRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const tick = () => new Promise((r) => setImmediate(r));

// A model that answers reads and fails the test on any write.
function readOnlyModel(rows) {
  const q = (result) => ({ sort() { return this; }, lean: async () => result, then: (ok, ko) => Promise.resolve(result).then(ok, ko) });
  const forbid = (name) => () => { throw new Error(`write on GET: ${name}`); };
  return {
    rows,
    findOne: (filter) => q(rows.find((r) => String(r.userId) === String(filter.userId) && (!filter.month || r.month === filter.month)) || null),
    find: (filter) => q(rows.filter((r) => String(r.userId) === String(filter.userId))),
    updateOne: forbid('updateOne'), updateMany: forbid('updateMany'), create: forbid('create'), findOneAndUpdate: forbid('findOneAndUpdate')
  };
}

function setDeps(extra) {
  const calls = { generate: 0 };
  router.testDeps = {
    User: { findById: async (id) => ({ _id: id, businessProfile: {} }) },
    withPlanGuidance: async () => ({}),
    ...extra,
    generateMonthlyCalendar: extra.generateMonthlyCalendar || (async () => { calls.generate += 1; return { _id: 'new' }; })
  };
  return calls;
}

const { calendarMonth } = require('../services/contentCalendarService');

test('GET returns the stored calendar, never generating or writing, even when its cover failed', async () => {
  const cal = { _id: 'c1', userId: 'u1', month: calendarMonth(), coverStatus: 'failed', weeks: [{ weekNumber: 1, items: [{ day: 1 }] }] };
  const calls = setDeps({ ContentCalendar: readOnlyModel([cal]) });
  const res = mkRes();
  await handlerFor('get', '/')({ user: { _id: 'u1' } }, res);
  await tick();
  assert.equal(res.code, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.status, 'ready');
  assert.equal(res.body.calendar._id, 'c1');
  assert.equal(calls.generate, 0);
});

test('GET with no calendar this month answers "not prepared yet" at once, without making one', async () => {
  const calls = setDeps({ ContentCalendar: readOnlyModel([]) });
  const res = mkRes();
  await handlerFor('get', '/')({ user: { _id: 'u2' } }, res);
  assert.equal(res.code, 200);
  assert.deepEqual({ ...res.body, message: undefined }, { success: true, calendar: null, status: 'not_prepared', message: undefined });
  assert.match(res.body.message, /not prepared yet/i);
  assert.equal(calls.generate, 0);
});

test('POST /prepare makes the month once in the background; GET says "preparing" meanwhile', async () => {
  let finish;
  const rows = [];
  const calls = { generate: 0 };
  setDeps({
    ContentCalendar: readOnlyModel(rows),
    generateMonthlyCalendar: (user, month, opts) => { calls.generate += 1; assert.equal(month, null); assert.ok(opts); return new Promise((ok) => { finish = () => { rows.push({ _id: 'made', userId: 'u3', month: calendarMonth() }); ok(rows[0]); }; }); }
  });
  const prepare = handlerFor('post', '/prepare');
  const a = mkRes(); const b = mkRes();
  await Promise.all([prepare({ user: { _id: 'u3' }, body: {} }, a), prepare({ user: { _id: 'u3' }, body: {} }, b)]);
  await tick();
  assert.equal(a.code, 202); assert.equal(a.body.status, 'preparing');
  assert.equal(b.code, 202); assert.equal(b.body.status, 'preparing');
  assert.equal(calls.generate, 1, 'two clicks make one calendar');

  const during = mkRes();
  await handlerFor('get', '/')({ user: { _id: 'u3' } }, during);
  assert.equal(during.body.status, 'preparing');
  assert.equal(during.body.calendar, null);

  finish(); await tick(); await tick();
  const after = mkRes();
  await handlerFor('get', '/')({ user: { _id: 'u3' } }, after);
  assert.equal(after.body.status, 'ready');
  assert.equal(after.body.calendar._id, 'made');
});

test('POST /prepare with a calendar already there returns it and makes nothing', async () => {
  const calls = setDeps({ ContentCalendar: readOnlyModel([{ _id: 'c9', userId: 'u4', month: calendarMonth() }]) });
  const res = mkRes();
  await handlerFor('post', '/prepare')({ user: { _id: 'u4' }, body: {} }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.status, 'ready');
  assert.equal(res.body.calendar._id, 'c9');
  assert.equal(calls.generate, 0);
});

test('a failed background preparation is reported once, then can be tried again', async () => {
  const calls = { generate: 0 };
  setDeps({ ContentCalendar: readOnlyModel([]), generateMonthlyCalendar: async () => { calls.generate += 1; throw new Error('model down'); } });
  const prepare = handlerFor('post', '/prepare');
  await prepare({ user: { _id: 'u5' }, body: {} }, mkRes());
  await tick(); await tick();
  const res = mkRes();
  await handlerFor('get', '/')({ user: { _id: 'u5' } }, res);
  assert.equal(res.body.status, 'failed');
  assert.match(res.body.message, /could not prepare/i);
  const again = mkRes();
  await prepare({ user: { _id: 'u5' }, body: {} }, again);
  assert.equal(again.code, 202);
  await tick(); await tick();
  assert.equal(calls.generate, 2);
});

test('GET /history only reads (no cover retries from a page load)', async () => {
  setDeps({ ContentCalendar: readOnlyModel([{ _id: 'h1', userId: 'u6', month: '2026-09', coverStatus: 'failed' }]) });
  const res = mkRes();
  await handlerFor('get', '/history')({ user: { _id: 'u6' } }, res);
  await tick();
  assert.equal(res.body.success, true);
  assert.equal(res.body.calendars.length, 1);
});

test('stale covers are retried by the background job instead: bounded, paused accounts skipped', async () => {
  const seen = [];
  const docs = [{ _id: 'a', userId: 'p1' }, { _id: 'b', userId: 'ok1' }];
  const CC = {
    find(filter) {
      seen.push(filter);
      return { sort() { return this; }, limit(n) { this.n = n; return this; }, then: (ok) => ok(docs.filter((d) => !filter.userId || !filter.userId.$nin.includes(d.userId)).slice(0, this.n || 99)) };
    }
  };
  const retried = [];
  const r = await healStaleCovers({
    now: new Date('2026-10-20T06:00:00Z'), limit: 5,
    deps: { ContentCalendar: CC, blockedIds: async () => ['p1'], User: { findById: async (id) => ({ _id: id }) }, retry: async (c) => { retried.push(c._id); return { retried: true }; } }
  });
  assert.deepEqual(retried, ['b']);
  assert.equal(r.retried, 1);
  const f = seen[0];
  assert.deepEqual(f.coverStatus, { $in: ['failed', 'pending'] });
  assert.deepEqual(f.month, { $in: ['2026-10', '2026-11'] });
  assert.deepEqual(f.userId, { $nin: ['p1'] });
});

test('POST /prepare passes the optional language and focus (trimmed, bounded) with the plan guidance', async () => {
  const seen = [];
  setDeps({
    ContentCalendar: readOnlyModel([]),
    withPlanGuidance: async () => ({ planGuidance: 'PLAN' }),
    generateMonthlyCalendar: async (user, month, opts) => { seen.push(opts); return { _id: 'x' }; }
  });
  const prepare = handlerFor('post', '/prepare');
  await prepare({ user: { _id: 'u-lang' }, body: { language: ' tamil ', focus: ` ${'f'.repeat(400)} ` } }, mkRes());
  await tick(); await tick();
  assert.deepEqual(seen[0], { planGuidance: 'PLAN', language: 'tamil', focus: 'f'.repeat(300) });
  await prepare({ user: { _id: 'u-none' }, body: { language: 5, focus: '   ' } }, mkRes());
  await tick(); await tick();
  assert.deepEqual(seen[1], { planGuidance: 'PLAN' });
});
