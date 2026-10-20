'use strict';
// Optional Socket.IO Redis adapter (services/socketAdapter.js) and the Inbox live stream across tasks (socketHub).
const test = require('node:test');
const assert = require('node:assert');
const { attachRedisAdapter } = require('../services/socketAdapter');

const logs = () => { const lines = []; return { lines, log: (...m) => lines.push(m.join(' ')), warn: (...m) => lines.push(m.join(' ')) }; };

test('no REDIS_URL: single-process, no crash, one plain log line, no package loaded', async () => {
  const l = logs();
  let loaded = 0;
  const io = { adapter: () => { throw new Error('must not be called'); } };
  const r = await attachRedisAdapter(io, { env: {}, load: () => { loaded += 1; return {}; }, log: l });
  assert.strictEqual(r.mode, 'single');
  assert.strictEqual(loaded, 0);
  assert.ok(l.lines.some((x) => /single-process/.test(x)));
});

test('REDIS_URL set but the packages are not installed: single-process, no crash', async () => {
  const l = logs();
  const r = await attachRedisAdapter({ adapter() { throw new Error('no'); } }, { env: { REDIS_URL: 'redis://127.0.0.1:1' }, load: (m) => { throw new Error(`Cannot find module '${m}'`); }, log: l });
  assert.strictEqual(r.mode, 'single');
  assert.ok(l.lines.some((x) => /not installed/.test(x)));
});

test('Redis cannot be reached: single-process, no crash', async () => {
  const l = logs();
  const client = { on() {}, duplicate() { return client; }, connect: async () => { throw new Error('ECONNREFUSED'); } };
  const r = await attachRedisAdapter({ adapter() { throw new Error('no'); } }, { env: { REDIS_URL: 'redis://x' }, load: (m) => (m === 'redis' ? { createClient: () => client } : { createAdapter: () => ({}) }), log: l });
  assert.strictEqual(r.mode, 'single');
  assert.ok(l.lines.some((x) => /could not connect/.test(x)));
});

test('REDIS_URL and the packages: the adapter is installed on the Socket.IO server', async () => {
  const l = logs();
  let connected = 0; let adapterArgs = null; let installed = null;
  const mkClient = () => ({ on() {}, duplicate: () => mkClient(), connect: async () => { connected += 1; } });
  const io = { adapter: (a) => { installed = a; } };
  const r = await attachRedisAdapter(io, { env: { REDIS_URL: 'redis://x' }, load: (m) => (m === 'redis' ? { createClient: () => mkClient() } : { createAdapter: (p, s) => { adapterArgs = [p, s]; return 'ADAPTER'; } }), log: l });
  assert.strictEqual(r.mode, 'redis');
  assert.strictEqual(connected, 2, 'pub and sub');
  assert.strictEqual(installed, 'ADAPTER');
  assert.strictEqual(adapterArgs.length, 2);
});

test('socketHub: events go to the room; the SSE stream is forwarded to other tasks only with the adapter', () => {
  const hub = require('../services/socketHub');
  const sent = [];
  const fakeIo = { to: (room) => ({ emit: (e, p) => sent.push(['room', room, e, p]) }), serverSideEmit: (...a) => sent.push(['server', ...a]) };
  const got = [];
  const off = hub.addSseSubscriber('u1', (e, p) => got.push([e, p]));
  hub._setIoForTest(fakeIo, { crossTask: false });
  hub.emitToUser('u1', 'inbox.message.created', { a: 1 });
  assert.deepStrictEqual(sent, [['room', 'user:u1', 'inbox.message.created', { a: 1 }]]);
  assert.deepStrictEqual(got, [['inbox.message.created', { a: 1 }]]);
  sent.length = 0;
  hub._setIoForTest(fakeIo, { crossTask: true });
  hub.emitToUser('u1', 'reply:new', { b: 2 });
  assert.deepStrictEqual(sent, [['room', 'user:u1', 'reply:new', { b: 2 }], ['server', 'nebula:sse', 'u1', 'reply:new', { b: 2 }]]);
  off();
  hub._setIoForTest(null);
});
