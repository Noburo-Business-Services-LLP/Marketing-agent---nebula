const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { createHealth } = require('../services/healthCheck');

function fakeConnection({ readyState = 1, ping = async () => ({ ok: 1 }) } = {}) {
  const conn = { readyState, pings: 0 };
  conn.db = { admin: () => ({ command: async (cmd) => { assert.deepStrictEqual(cmd, { ping: 1 }); conn.pings += 1; return ping(); } }) };
  return conn;
}

function res() {
  return { code: 0, body: null, headers: {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set(k, v) { this.headers[k] = v; return this; } };
}

test('health is 200 when the database is connected and answers a ping', async () => {
  const conn = fakeConnection();
  const h = createHealth({ connection: () => conn });
  const r = res();
  await h.health({}, r);
  assert.strictEqual(r.code, 200);
  assert.deepStrictEqual(r.body, { status: 'ok', db: 'up' });
  assert.strictEqual(r.headers['Cache-Control'], 'no-store');
});

test('health is 503 when the database is not connected (no ping is tried)', async () => {
  const conn = fakeConnection({ readyState: 0 });
  const h = createHealth({ connection: () => conn });
  const r = res();
  await h.health({}, r);
  assert.strictEqual(r.code, 503);
  assert.deepStrictEqual(r.body, { status: 'down', db: 'disconnected' });
  assert.strictEqual(conn.pings, 0);
});

test('health is 503 when the ping fails or takes longer than the timeout', async () => {
  let h = createHealth({ connection: () => fakeConnection({ ping: async () => { throw new Error('no primary'); } }) });
  let r = res();
  await h.health({}, r);
  assert.strictEqual(r.code, 503);
  assert.strictEqual(r.body.db, 'no-answer');

  h = createHealth({ connection: () => fakeConnection({ ping: () => new Promise((ok) => setTimeout(ok, 500)) }), pingTimeoutMs: 30 });
  r = res();
  const t0 = Date.now();
  await h.health({}, r);
  assert.strictEqual(r.code, 503);
  assert.ok(Date.now() - t0 < 300, 'answers by the timeout');
});

test('the ping result is kept 5 seconds, and requests at the same moment share one ping', async () => {
  let t = 1000;
  const conn = fakeConnection();
  const h = createHealth({ connection: () => conn, now: () => t });
  await Promise.all([h.health({}, res()), h.health({}, res()), h.health({}, res())]);
  assert.strictEqual(conn.pings, 1);
  t += 4000;
  await h.health({}, res());
  assert.strictEqual(conn.pings, 1);
  t += 1500;
  await h.health({}, res());
  assert.strictEqual(conn.pings, 2);
  // a connection that drops is seen at once, whatever is cached
  conn.readyState = 0;
  const r = res();
  await h.health({}, r);
  assert.strictEqual(r.code, 503);
});

test('ready: database connected and not shutting down', async () => {
  const conn = fakeConnection();
  const h = createHealth({ connection: () => conn });
  let r = res();
  await h.ready({}, r);
  assert.strictEqual(r.code, 200);
  assert.deepStrictEqual(r.body, { status: 'ready', db: 'up' });

  h.markShuttingDown();
  r = res();
  await h.ready({}, r);
  assert.strictEqual(r.code, 503);
  assert.strictEqual(r.body.status, 'shutting-down');
  // health also tells the load balancer to stop sending new requests
  r = res();
  await h.health({}, r);
  assert.strictEqual(r.code, 503);
});

test('server-main keeps the load balancer path /api/health and adds /api/ready before the limits', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server-main.js'), 'utf8');
  const health = src.indexOf("app.get('/api/health', health.health)");
  const ready = src.indexOf("app.get('/api/ready', health.ready)");
  const limits = src.indexOf("app.use('/api', limits.general)");
  assert.ok(health > 0 && ready > 0 && limits > health && limits > ready);
  assert.ok(/process\.on\('SIGTERM'/.test(src), 'ECS stops tasks with SIGTERM');
});
