'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { distillMemoryDetailed, runDistillationOnce, BLOCKED_MESSAGE } = require('../services/memoryDistillation');

const chain = (rows) => ({ sort() { return this; }, limit() { return this; }, select() { return this; }, lean: async () => rows });
function fakes({ guardOk = true } = {}) {
  const calls = { llm: 0, check: [], record: [], writes: 0 };
  const winners = [{ _id: 'a', measuredAt: new Date(), learning: { tier: 'winner', score: 90 }, caption: 'hi' }];
  const deps = {
    Performance: { find: (q) => chain(q['learning.tier'] === 'low' ? [] : winners) },
    Memory: {
      findOne: () => ({ lean: async () => null }),
      find: () => chain([{ userId: 'u1', organizationId: 'o1' }, { userId: 'u2', organizationId: 'o2' }]),
      findOneAndUpdate: async () => { calls.writes += 1; return {}; }
    },
    callLLM: async () => { calls.llm += 1; return '{"notes":[{"text":"Short captions win","category":"copy","confidence":0.8}]}'; },
    guard: {
      check: async (a) => { calls.check.push(a); return guardOk ? { ok: true } : { ok: false, reason: 'daily_cap' }; },
      record: async (a, n) => { calls.record.push([a, n]); }
    }
  };
  return { deps, calls };
}

test('guard blocked: no model call, nothing recorded, nothing written, calm message', async () => {
  const { deps, calls } = fakes({ guardOk: false });
  const r = await distillMemoryDetailed('u1', 'o1', deps);
  assert.equal(r.blocked, true);
  assert.equal(r.notes, null);
  assert.equal(r.message, BLOCKED_MESSAGE);
  assert.equal(calls.llm, 0); assert.equal(calls.record.length, 0); assert.equal(calls.writes, 0);
});

test('success records exactly one spend row', async () => {
  const { deps, calls } = fakes();
  const r = await distillMemoryDetailed('u1', 'o1', deps);
  assert.equal(r.notes.length, 1);
  assert.equal(calls.llm, 1);
  assert.deepEqual(calls.record, [['campaign_text', 1]]);
  assert.equal(calls.writes, 1);
});

test('weekly run: blocked accounts are skipped and counted, warning logged once', async () => {
  const { deps, calls } = fakes({ guardOk: false });
  const warn = console.warn; const warns = [];
  console.warn = (...a) => warns.push(a.join(' '));
  try {
    const out = await runDistillationOnce({ deps });
    assert.equal(out.skipped, 2); assert.equal(out.distilled, 0);
  } finally { console.warn = warn; }
  assert.equal(warns.filter((w) => /Spend guard/.test(w)).length, 1);
  assert.equal(calls.llm, 0);
});

test('the route says the calm message when blocked, and ENABLE_MEMORY_DISTILLATION=off is honoured', () => {
  const fs = require('node:fs');
  const route = fs.readFileSync(require.resolve('../routes/aiMemory.js'), 'utf8');
  assert.ok(route.includes('distillMemoryDetailed') && route.includes('blockedMessage'));
  const { startMemoryDistillationScheduler } = require('../services/memoryDistillation');
  const prev = process.env.ENABLE_MEMORY_DISTILLATION; process.env.ENABLE_MEMORY_DISTILLATION = 'off';
  const logs = [];
  try { startMemoryDistillationScheduler({ logger: { log: (m) => logs.push(m), error() {} } })(); } finally { if (prev === undefined) delete process.env.ENABLE_MEMORY_DISTILLATION; else process.env.ENABLE_MEMORY_DISTILLATION = prev; }
  assert.ok(logs.some((l) => /disabled/.test(l)));
});
