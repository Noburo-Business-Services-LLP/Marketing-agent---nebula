const test = require('node:test');
const assert = require('node:assert/strict');

const geminiPath = require.resolve('../services/geminiAI');
require.cache[geminiPath] = { id: geminiPath, filename: geminiPath, loaded: true, exports: {} };
const { maybeRetryCover } = require('../services/contentCalendarService');

const MIN = 60 * 1000;
const NOW = new Date('2026-10-19T12:00:00Z');
const ago = (ms) => new Date(NOW.getTime() - ms);

// Understands exactly the claim update maybeRetryCover sends.
function fakeModel(doc) {
  return {
    updates: 0,
    async updateOne(filter, update) {
      if (String(filter._id) !== String(doc._id)) return { modifiedCount: 0 };
      if (filter.coverStatus && doc.coverStatus !== filter.coverStatus) return { modifiedCount: 0 };
      const lim = filter.$or && filter.$or[1].lastCoverRetryAt.$lt;
      if (doc.lastCoverRetryAt && !(doc.lastCoverRetryAt < lim)) return { modifiedCount: 0 };
      if (filter.autoCoverRetries && Number(doc.autoCoverRetries || 0) >= 3) return { modifiedCount: 0 };
      Object.assign(doc, update.$set); this.updates += 1;
      for (const [k, v] of Object.entries(update.$inc || {})) doc[k] = (doc[k] || 0) + v;
      return { modifiedCount: 1 };
    }
  };
}
const guard = (ok = true) => ({ checks: [], recorded: [], async check(a) { this.checks.push(a); return { ok }; }, async record(a, n) { this.recorded.push([a, n]); } });
const cal = (extra = {}) => ({ _id: 'c1', userId: 'u1', month: '2026-10', coverStatus: 'failed', lastCoverAttemptAt: ago(60 * MIN), weeks: [{ items: [{ headline: 'h' }] }], ...extra });
const go = async (doc, over = {}) => {
  const calls = [];
  const g = over.guard || guard();
  const model = fakeModel(doc);
  const r = await maybeRetryCover(doc, {}, { now: over.now || NOW, deps: { ContentCalendar: model, spendGuard: g, generate: async (c) => { calls.push(c); return over.url === undefined ? 'https://x/cover.jpg' : over.url; } } });
  await new Promise((res) => setImmediate(res));
  return { r, calls, g, model };
};

test('a failed cover is retried once, free, and marked pending', async () => {
  const doc = cal();
  const { r, calls, g } = await go(doc);
  assert.equal(r.retried, true); assert.equal(r.reason, 'failed');
  assert.equal(calls.length, 1);
  assert.equal(doc.coverStatus, 'pending');
  assert.deepEqual(doc.lastCoverRetryAt, NOW);
  assert.deepEqual(g.checks, ['image_generated']);
  assert.deepEqual(g.recorded, [['campaign_text', 1], ['image_generated', 1]]);
  assert.equal(doc.autoCoverRetries, 1);
});

test('a pending cover older than 10 minutes is retried; a fresh one is left alone', async () => {
  const stale = cal({ coverStatus: 'pending', lastCoverAttemptAt: ago(11 * MIN) });
  const a = await go(stale);
  assert.equal(a.r.retried, true); assert.equal(a.r.reason, 'stale-pending');
  const fresh = cal({ coverStatus: 'pending', lastCoverAttemptAt: ago(5 * MIN) });
  const b = await go(fresh);
  assert.equal(b.r.retried, false); assert.equal(b.r.reason, 'too-soon'); assert.equal(b.calls.length, 0);
});

test('a cover that failed a moment ago is not hammered', async () => {
  const b = await go(cal({ lastCoverAttemptAt: ago(2 * MIN) }));
  assert.equal(b.r.retried, false); assert.equal(b.r.reason, 'too-soon');
});

test('never twice in one day, again after 24 hours', async () => {
  const doc = cal();
  const first = await go(doc);
  assert.equal(first.r.retried, true);
  doc.coverStatus = 'failed'; doc.lastCoverAttemptAt = ago(30 * MIN);
  const second = await go(doc, { now: new Date(NOW.getTime() + 3 * 60 * 60 * 1000) });
  assert.equal(second.r.retried, false); assert.equal(second.r.reason, 'already-today'); assert.equal(second.calls.length, 0);
  doc.coverStatus = 'failed'; doc.lastCoverAttemptAt = ago(30 * MIN);
  const later = await go(doc, { now: new Date(NOW.getTime() + 25 * 60 * 60 * 1000) });
  assert.equal(later.r.retried, true);
});

test('two page loads at once start only one render', async () => {
  const doc = cal();
  const model = fakeModel(doc); const calls = [];
  const deps = { ContentCalendar: model, spendGuard: guard(), generate: async () => { calls.push(1); return 'https://x/c.jpg'; } };
  const [a, b] = await Promise.all([maybeRetryCover({ ...doc }, {}, { now: NOW, deps }), maybeRetryCover({ ...doc }, {}, { now: NOW, deps })]);
  assert.equal([a, b].filter((x) => x.retried).length, 1);
});

test('ready covers, empty plans and a refused spend check do nothing', async () => {
  assert.equal((await go(cal({ coverStatus: 'ready' }))).r.reason, 'not-retryable');
  assert.equal((await go(cal({ coverStatus: 'none' }))).r.reason, 'not-retryable');
  assert.equal((await go(cal({ weeks: [] }))).r.reason, 'empty-plan');
  const refused = await go(cal(), { guard: guard(false) });
  assert.equal(refused.r.reason, 'spend-guard'); assert.equal(refused.calls.length, 0); assert.equal(refused.model.updates, 0);
});

test('a generator that throws or returns nothing never breaks the caller and records no spend', async () => {
  const doc = cal();
  const g = guard();
  const r = await maybeRetryCover(doc, {}, { now: NOW, deps: { ContentCalendar: fakeModel(doc), spendGuard: g, generate: async () => { throw new Error('boom'); } } });
  await new Promise((res) => setImmediate(res));
  assert.equal(r.retried, true); assert.deepEqual(g.recorded, []);
  const none = await go(cal(), { url: '' });
  assert.deepEqual(none.g.recorded, [['campaign_text', 1]]);
  const broken = await maybeRetryCover(null);
  assert.equal(broken.retried, false);
});

test('a month that is neither this month nor next (India time) is never retried', async () => {
  const old = await go(cal({ month: '2026-07' }));
  assert.equal(old.r.retried, false); assert.equal(old.r.reason, 'old-month'); assert.equal(old.calls.length, 0); assert.equal(old.model.updates, 0);
  assert.equal((await go(cal({ month: '2026-11' }))).r.retried, true);
  // 18:30 UTC on 31 Oct is already 1 Nov in India, so October is now a past month.
  const edge = await go(cal({ month: '2026-10' }), { now: new Date('2026-10-31T19:00:00Z') });
  assert.equal(edge.r.reason, 'old-month');
});

test('at most 3 automatic retries in a calendar lifetime', async () => {
  const doc = cal();
  for (let i = 0; i < 3; i++) {
    doc.coverStatus = 'failed'; doc.lastCoverAttemptAt = ago(30 * MIN);
    const r = await go(doc, { now: new Date(NOW.getTime() + i * 25 * 60 * MIN) });
    assert.equal(r.r.retried, true, `retry ${i + 1}`);
  }
  assert.equal(doc.autoCoverRetries, 3);
  doc.coverStatus = 'failed'; doc.lastCoverAttemptAt = ago(30 * MIN);
  const fourth = await go(doc, { now: new Date(NOW.getTime() + 4 * 25 * 60 * MIN) });
  assert.equal(fourth.r.retried, false); assert.equal(fourth.r.reason, 'retry-limit'); assert.equal(fourth.calls.length, 0);
});
