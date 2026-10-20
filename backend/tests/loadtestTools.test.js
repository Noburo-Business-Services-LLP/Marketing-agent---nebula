'use strict';
// The load tools (scripts/loadtest/): the generator's arithmetic and error counting, the database refusal, the local-only
// rule, and a very short end-to-end smoke run of the mixed-flow runner against the in-memory server (no database, no network).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { runLoad, percentile, summarise } = require('../scripts/loadtest/lib/runner');
const { assertSafeDatabase, databaseName } = require('../scripts/loadtest/lib/guard');
const { fakeQuery } = require('../scripts/loadtest/lib/memoryStore');

const listen = (handler) => new Promise((r) => { const s = http.createServer(handler).listen(0, '127.0.0.1', () => r(s)); });

test('percentiles use the nearest-rank rule and summarise reports rate, mean and errors', () => {
  const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.equal(percentile(sorted, 50), 50);
  assert.equal(percentile(sorted, 90), 90);
  assert.equal(percentile(sorted, 99), 99);
  assert.equal(percentile([], 90), 0);
  const s = summarise([10, 20, 30, 40], { 200: 4 }, 1, 2);
  assert.equal(s.requests, 4);
  assert.equal(s.rps, 2);
  assert.equal(s.mean, 25);
  assert.equal(s.errors, 1);
});

test('the generator sends the asked rate for the asked time, with keep-alive, and counts bad statuses and network errors', async () => {
  const sockets = new Set();
  const server = await listen((req, res) => { sockets.add(req.socket); res.statusCode = req.url === '/bad' ? 500 : 200; res.end('ok'); });
  const port = server.address().port;
  try {
    const ok = await runLoad({ host: '127.0.0.1', port, path: '/' }, { rate: 40, duration: 1 });
    assert.equal(ok.requests, 40);
    assert.equal(ok.errors, 0);
    assert.deepEqual(ok.statuses, { 200: 40 });
    assert.ok(sockets.size < 40, `connections are reused (${sockets.size} sockets for 40 requests)`);
    assert.ok(ok.p50 >= 0 && ok.p99 >= ok.p90 && ok.p90 >= ok.p50);
    const bad = await runLoad({ host: '127.0.0.1', port, path: '/bad' }, { rate: 10, duration: 1 });
    assert.equal(bad.errors, 10);
    const expected = await runLoad({ host: '127.0.0.1', port, path: '/bad', expectStatus: [500] }, { rate: 10, duration: 1 });
    assert.equal(expected.errors, 0, 'an expected status is not an error');
    const samples = [];
    await runLoad({ host: '127.0.0.1', port, path: '/' }, { rate: 10, duration: 1, samples });
    assert.equal(samples.length, 10);
  } finally { server.close(); }
  const dead = await runLoad({ host: '127.0.0.1', port: 1, path: '/' }, { rate: 5, duration: 1 });
  assert.equal(dead.errors, 5, 'connection refused counts as an error');
  assert.deepEqual(dead.statuses, { 0: 5 });
});

test('the generator refuses a host that is not this machine unless allowRemote is passed', async () => {
  await assert.rejects(runLoad({ host: 'example.com', port: 80, path: '/' }, { rate: 1, duration: 1 }), /only this machine/);
});

test('the database guard allows no URI (memory) and nebulaa_dev only', () => {
  assert.deepEqual(assertSafeDatabase(''), { store: 'memory' });
  assert.deepEqual(assertSafeDatabase(undefined), { store: 'memory' });
  assert.equal(assertSafeDatabase('mongodb+srv://u:p@cluster0.abcde.mongodb.net/nebulaa_dev?retryWrites=true').database, 'nebulaa_dev');
  for (const bad of ['mongodb+srv://u:p@c.example.net/nebulaa_prod?x=1', 'mongodb://u:p@c.example.net/nebulaa', 'mongodb+srv://u:p@c.example.net/?x=1', 'mongodb://localhost:27017/test']) {
    assert.throws(() => assertSafeDatabase(bad), /Refusing/, bad);
  }
  assert.equal(databaseName('mongodb+srv://u:p@c.example.net/Name%20X?a=b'), 'Name X');
});

test('load.js refuses a remote or reserved target and a missing url', () => {
  const run = (...a) => spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'loadtest', 'load.js'), ...a], { encoding: 'utf8', timeout: 20000 });
  assert.match(run('--url=https://api.example.com/x').stderr, /this machine only/);
  assert.match(run('--url=https://app.nebulaa.ai/x', '--allow-remote').stderr, /looks like production/);
  assert.match(run('--url=http://127.0.0.1:5000/x').stderr, /reserved port/);
  assert.match(run().stderr, /usage/);
});

test('the fake query is chainable and awaitable', async () => {
  const q = fakeQuery(() => [1, 2]);
  assert.deepEqual(await q.select('a').sort({ b: 1 }).limit(3).lean(), [1, 2]);
  assert.deepEqual(await q.exec(), [1, 2]);
});

test('mixed.js smoke: a 2 second run passes every flow, reads the event loop and writes JSON', { timeout: 120000 }, () => {
  const out = path.join(require('node:os').tmpdir(), `loadtest-smoke-${process.pid}.json`);
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'loadtest', 'mixed.js'), '--duration=2', '--rate=2', '--signin-rate=1', '--users=3', `--out=${out}`], { encoding: 'utf8', timeout: 110000, env: { ...process.env, MONGODB_URI: '' } });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  const j = JSON.parse(require('node:fs').readFileSync(out, 'utf8'));
  require('node:fs').unlinkSync(out);
  assert.equal(j.store, 'memory');
  assert.equal(j.flows.length, 9);
  for (const f of j.flows) { assert.equal(f.errors, 0, `${f.flow} errors`); assert.ok(f.requests >= 2, `${f.flow} requests`); }
  assert.equal(typeof j.eventLoop.p99, 'number');
  assert.ok(j.memory.after.rssMb > 0);
});

test('mixed.js refuses a MONGODB_URI that is not the development database', () => {
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'loadtest', 'mixed.js'), '--duration=1'], { encoding: 'utf8', timeout: 30000, env: { ...process.env, MONGODB_URI: 'mongodb+srv://u:p@c.example.net/nebulaa_prod' } });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Refusing/);
  assert.doesNotMatch(`${r.stdout}${r.stderr}`, /u:p@/, 'the credentials are never printed');
});
