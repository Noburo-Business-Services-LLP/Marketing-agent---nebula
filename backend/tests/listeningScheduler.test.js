const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { startListeningScorer, scoreAccount, runScorerOnce } = require('../services/listening/scorer');
const { createSpendGuard } = require('../services/spendGuard');
const { createBatchLedger } = require('../services/listening/ledger');

const quiet = () => { const lines = { log: [], warn: [], error: [] }; return { lines, logger: { log: (...a) => lines.log.push(a.join(' ')), warn: (...a) => lines.warn.push(a.join(' ')), error: (...a) => lines.error.push(a.join(' ')) } }; };
const ON = { NODE_ENV: 'production', ENABLE_LISTENING: 'on' };

test('returns null and logs nothing unless ENABLE_LISTENING is exactly "on", and never under NODE_ENV=test', () => {
  for (const env of [{ NODE_ENV: 'production' }, {}, ...['off', 'ON', 'true', '1', ''].map((v) => ({ NODE_ENV: 'production', ENABLE_LISTENING: v })), { NODE_ENV: 'test', ENABLE_LISTENING: 'on' }]) {
    const q = quiet();
    assert.strictEqual(startListeningScorer({ env, logger: q.logger }), null, JSON.stringify(env));
    assert.deepStrictEqual(q.lines, { log: [], warn: [], error: [] });
  }
});

test('with the switch on it returns a stop handle, logs one line, and unrefs both timers', () => {
  const q = quiet();
  const made = [];
  const h = startListeningScorer({
    env: ON, logger: q.logger, intervalMs: 1e9, firstDelayMs: 1e9,
    timers: { setTimeout: (f, ms) => { const t = { f, ms, unref() { this.unrefed = true; return this; } }; made.push(t); return t; }, setInterval: (f, ms) => { const t = { f, ms, unref() { this.unrefed = true; return this; } }; made.push(t); return t; }, clearTimeout() {}, clearInterval() {} }
  });
  assert.ok(h && typeof h.stop === 'function');
  assert.strictEqual(q.lines.log.length, 1);
  assert.strictEqual(made.length, 2);
  assert.ok(made.every((t) => t.unrefed), 'unref');
  h.stop();
});

test('defaults: every 6 hours, first run 25 minutes after startup', () => {
  const made = [];
  const h = startListeningScorer({ env: ON, logger: quiet().logger, timers: { setTimeout: (f, ms) => { made.push(['first', ms]); return { unref() {} }; }, setInterval: (f, ms) => { made.push(['every', ms]); return { unref() {} }; }, clearTimeout() {}, clearInterval() {} } });
  assert.deepStrictEqual(made, [['first', 25 * 60000], ['every', 6 * 3600000]]);
  h.stop();
});

test('a tick that throws is logged without the message and never escapes', async () => {
  const q = quiet();
  let tick;
  const h = startListeningScorer({
    env: ON, logger: q.logger,
    run: async () => { const e = new Error('SECRET COMMENT TEXT'); e.name = 'BoomError'; throw e; },
    timers: { setTimeout: (f) => { tick = f; return { unref() {} }; }, setInterval: () => ({ unref() {} }), clearTimeout() {}, clearInterval() {} }
  });
  await assert.doesNotReject(async () => tick());
  assert.strictEqual(q.lines.error.length, 1);
  assert.ok(/BoomError/.test(q.lines.error[0]));
  assert.ok(!/SECRET/.test(q.lines.error[0]), 'no message text in the log');
  h.stop();
});

test('a second tick while one is still running does nothing (same process)', async () => {
  let release; let calls = 0;
  const gate = new Promise((r) => { release = r; });
  let tick;
  const h = startListeningScorer({
    env: ON, logger: quiet().logger,
    run: async () => { calls++; await gate; },
    timers: { setTimeout: () => ({ unref() {} }), setInterval: (f) => { tick = f; return { unref() {} }; }, clearTimeout() {}, clearInterval() {} }
  });
  const a = tick(); const b = tick();
  await b;
  assert.strictEqual(calls, 1);
  release(); await a;
  await tick();
  assert.strictEqual(calls, 2, 'a later tick runs after the first finished');
  h.stop();
});

test('stop clears both timers', () => {
  const cleared = [];
  const h = startListeningScorer({ env: ON, logger: quiet().logger, timers: { setTimeout: () => ({ unref() {}, id: 'a' }), setInterval: () => ({ unref() {}, id: 'b' }), clearTimeout: (t) => cleared.push(t.id), clearInterval: (t) => cleared.push(t.id) } });
  h.stop();
  assert.deepStrictEqual(cleared.sort(), ['a', 'b']);
});

test('a pass with the switch off does nothing', async () => {
  const r = await runScorerOnce({ deps: { env: {}, lease: { claim: async () => { throw new Error('touched'); } } } });
  assert.strictEqual(r.disabled, true);
});

test('the spend guard refuses listening_score when the staff switch is off or AI_KILLED names it', async () => {
  const mk = (env, off) => createSpendGuard({ env, cacheMs: 0, Switch: () => ({ find: () => ({ lean: async () => (off ? [{ provider: 'listening_score', disabled: true }] : []) }) }), Spend: () => ({ findOne: () => ({ lean: async () => null }) }) });
  assert.strictEqual((await mk({}, false).check('listening_score')).ok, true);
  const guard = mk({}, true);
  const a = await guard.check('listening_score');
  assert.strictEqual(a.ok, false);
  const b = await mk({ AI_KILLED: 'listening_score' }, false).check('listening_score');
  assert.strictEqual(b.ok, false);
  assert.ok(guard.PROVIDERS ? guard.PROVIDERS.includes('listening_score') : true);
});

test('scoring pins the model, uses noFallback, and one failed batch is one call and one ledger row', async () => {
  const ledger = createBatchLedger({ Model: null });
  const opts = [];
  const NOW = new Date('2026-10-14T06:00:00Z');
  const items = Array.from({ length: 25 }, (_, i) => ({ _id: `i${i}`, userId: 'u1', platform: 'instagram', messageType: 'comment', direction: 'inbound', senderType: 'customer', spamScore: 0, body: `comment number ${i} is here`, createdAt: new Date(NOW.getTime() - 3600e3) }));
  const deps = {
    env: { ENABLE_LISTENING: 'on', LISTENING_MODEL: 'tiny-model' },
    memory: new Map(), ledger,
    store: { scoredIds: async () => new Set(), scoresSince: async () => [], saveScores: async () => {}, rebuildWeeks: async () => {} },
    items: async () => items,
    callText: async (_p, o) => { opts.push(o); throw new Error('provider down'); },
    spend: { check: async () => ({ ok: true }), record: async () => {} },
    markRun: async () => {}, sleep: async () => {}, alert: async () => {}
  };
  const r = await scoreAccount({ user: { _id: 'u1', plan: { tier: 'growth' } }, now: NOW, deps });
  assert.strictEqual(opts.length, 1, 'one call');
  assert.strictEqual(opts[0].model, 'tiny-model');
  assert.strictEqual(opts[0].noFallback, true);
  assert.strictEqual(r.batches, 1);
  assert.strictEqual(await ledger.countBatchesToday(NOW), 1, 'the attempt is counted once');
});

test('server-main starts the scorer in a try/catch so a failure to start never stops the server', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server-main.js'), 'utf8');
  const i = src.indexOf('startListeningScorer');
  assert.ok(i > 0);
  const before = src.slice(Math.max(0, i - 300), i);
  assert.ok(/try\s*{/.test(before));
  assert.ok(/catch\s*\(/.test(src.slice(i, i + 300)));
});
