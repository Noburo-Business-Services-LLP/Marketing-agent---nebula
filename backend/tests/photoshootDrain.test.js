'use strict';
// scripts/photoshoot-drain-queued.js (E9 B2 rollback leftovers), the pure part with fakes, and the close it uses
// (service closeWaiting) on the fake repo. Never touches a database.
const test = require('node:test');
const assert = require('node:assert');
const { drainWaiting, WAITING, RUNNING } = require('../scripts/photoshoot-drain-queued');
const { createPhotoshoot } = require('../services/photoshoot/service');
const { createFakePhotoshootRepo } = require('./helpers/fakePhotoshootRepo');

const isMatch = (r, q) => Object.entries(q).every(([k, c]) => {
  if (k === '_id') return !c.$nin.includes(r._id);
  if (c && typeof c === 'object' && '$ne' in c) return r[k] != null && r[k] !== c.$ne;
  return r[k] === c;
});
function fakeModel(rows) {
  return {
    countDocuments: async (q) => rows.filter((r) => isMatch(r, q)).length,
    find: (q) => ({ limit: (n) => ({ lean: async () => rows.filter((r) => isMatch(r, q)).slice(0, n).map((r) => ({ ...r })) }) })
  };
}
const NOW = new Date('2026-10-20T06:00:00Z');

test('the drain lists waiting AND running consumer photoshoots; a dry run closes nothing', async () => {
  const rows = [
    { _id: 'a', status: 'queued', via: 'consumer', chargedAt: NOW },
    { _id: 'b', status: 'queued', via: 'consumer', chargedAt: NOW },
    { _id: 'c', status: 'running', via: 'consumer', chargedAt: NOW },
    { _id: 'd', status: 'queued', via: 'consumer', chargedAt: null }, // not charged yet: the stale sweep's job
    { _id: 'e', status: 'queued' }, // in-process, not charged
    { _id: 'f', status: 'running' } // in-process
  ];
  let called = 0;
  const out = await drainWaiting({ model: fakeModel(rows), close: async () => { called += 1; return {}; }, dryRun: true });
  assert.deepStrictEqual(out, { waiting: 2, running: 1, closed: 0, notClosed: 0, dryRun: true });
  assert.strictEqual(called, 0);
  assert.deepStrictEqual(WAITING, { status: 'queued', via: 'consumer', chargedAt: { $ne: null } });
  assert.deepStrictEqual(RUNNING, { status: 'running', via: 'consumer' });
});

test('acting closes each waiting row through the close, leaves running rows alone, and does not loop on a row it cannot close', async () => {
  const rows = [
    { _id: 'a', status: 'queued', via: 'consumer', chargedAt: NOW },
    { _id: 'b', status: 'queued', via: 'consumer', chargedAt: NOW },
    { _id: 'x', status: 'queued', via: 'consumer', chargedAt: NOW },
    { _id: 'c', status: 'running', via: 'consumer', chargedAt: NOW }
  ];
  const close = async (row) => {
    if (row._id === 'x') return null;
    rows.find((r) => r._id === row._id).status = 'failed';
    return { _id: row._id };
  };
  const out = await drainWaiting({ model: fakeModel(rows), close, dryRun: false, batch: 1 });
  assert.deepStrictEqual(out, { waiting: 3, running: 1, closed: 2, notClosed: 1, dryRun: false });
  assert.strictEqual(rows.find((r) => r._id === 'c').status, 'running');
});

test('the close the drain uses refunds a waiting row once, with proof, and only while it is still waiting', async () => {
  const repo = createFakePhotoshootRepo();
  const money = [{ type: 'spend', ref: '', payer: 'u1', quarks: 40 }];
  const svc = createPhotoshoot({
    repo, env: { ENABLE_PHOTOSHOOT: 'on' }, now: () => NOW, alert: () => {},
    ledgerFor: async (id) => ({ spend: money.find((m) => m.type === 'spend' && m.ref === String(id)) ? { payer: 'u1', quarks: 40 } : null, refunded: money.some((m) => m.type === 'refund' && m.ref === String(id)) }),
    refundTo: async (uid, q, o) => { money.push({ type: 'refund', ref: o.ref, q, payer: o.payerId }); return { ok: true }; }
  });
  const row = await repo.insert({ user: '6a0000000000000000000001', key: 'drain-key-1', kind: 'pack', pack: 'marketplace', day: '2026-10-20', status: 'queued', via: 'consumer', inFlight: true, photoCount: 4, quarksPerPhoto: 10, quarks: 40, payerId: 'u1', photos: [0, 1, 2, 3].map((i) => ({ index: i, status: 'pending', attempts: 0 })) });
  Object.assign(repo.rows[0], { chargedAt: NOW, queuedAt: NOW });
  money[0].ref = String(row._id);
  const first = await svc.closeWaiting(repo.rows[0]);
  const second = await svc.closeWaiting(repo.rows[0]);
  assert.ok(first);
  assert.strictEqual(second, null);
  assert.deepStrictEqual(money.filter((m) => m.type === 'refund').map((m) => [m.q, m.payer]), [[40, 'u1']]);
  assert.strictEqual(repo.rows[0].status, 'failed');
  assert.strictEqual(repo.rows[0].inFlight, undefined);
});

test('the drain refuses a connection string without a database name (shared helper)', () => {
  const { explicitDbName } = require('../scripts/studio-video-drain-queued');
  assert.strictEqual(explicitDbName('mongodb+srv://u:p@cluster0.example.mongodb.net/?retryWrites=true'), '');
});

test('rollback hazard: the runbook makes the drain wait mandatory for Photoshoot and names the drain script and the queue numbers', () => {
  const fs = require('fs');
  const path = require('path');
  const doc = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'superpowers', 'ops', 'ecs-web-worker.md'), 'utf8');
  const start = doc.indexOf('### Photoshoot on the worker');
  assert.ok(start > 0, 'the runbook has a Photoshoot on the worker section');
  const section = doc.slice(start, doc.indexOf('\n### ', start + 10));
  assert.match(section, /MANDATORY/);
  assert.match(section, /photoshoot\.queueDepth/);
  assert.match(section, /photoshoot\.running/);
  assert.match(section, /scripts\/photoshoot-drain-queued\.js/);
  assert.match(section, /CONFIRM_DRAIN=yes/);
  assert.match(section, /Worker service[^\n]*first|1\. Worker service/);
});
