'use strict';
// A7 (pino logging, no secrets in a request line) and A8 (compression, cache headers), each in-process on a random 127.0.0.1 port.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const zlib = require('zlib');
const express = require('express');
const { Writable } = require('stream');
const { createLogger, scrub, levelFromEnv } = require('../utils/logger');
const { createRequestLogger } = require('../middleware/requestLogger');
const { createCompression } = require('../middleware/compression');
const { cacheControlFor, setStaticHeaders } = require('../middleware/staticCache');

const BEARER = 'eyJhbGciOiJIUzI1NiJ9.SECRETPAYLOAD.SIGNATURE123';
const QTOKEN = 'QUERYTOKEN-abc123xyz';

function sink() { const lines = []; return { lines, stream: new Writable({ write(chunk, _e, cb) { lines.push(String(chunk)); cb(); } }) }; }
function listen(app) { return new Promise((resolve) => { const s = http.createServer(app).listen(0, '127.0.0.1', () => resolve(s)); }); }
function get(server, pathName, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: pathName, headers: { 'Accept-Encoding': 'identity', ...headers } }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject); req.end();
  });
}

test('logger: LOG_LEVEL is honoured, silent under test by default', () => {
  assert.strictEqual(levelFromEnv({ LOG_LEVEL: 'DEBUG' }), 'debug');
  assert.strictEqual(levelFromEnv({ LOG_LEVEL: 'nonsense', NODE_ENV: 'production' }), 'info');
  assert.strictEqual(levelFromEnv({ NODE_ENV: 'test' }), 'silent');
  assert.strictEqual(levelFromEnv({}), 'info');
  const s = sink(); const log = createLogger({ level: 'warn', destination: s.stream });
  log.info('hidden'); log.warn('shown');
  assert.strictEqual(s.lines.length, 1);
  assert.match(s.lines[0], /"msg":"shown"/);
});

test('logger: printf arguments, Error objects, and secrets scrubbed from any message', () => {
  const s = sink(); const log = createLogger({ level: 'info', destination: s.stream });
  log.info('user %s did %d things', 'ann', 3);
  log.error('call failed', new Error('boom'));
  log.warn(`GET /api/stream?token=${QTOKEN}&x=1 with Authorization: Bearer ${BEARER}`);
  const out = s.lines.join('');
  assert.match(s.lines[0], /user ann did 3 things/);
  assert.match(s.lines[1], /"err":\{[^}]*"message":"boom"/);
  assert.ok(!out.includes(QTOKEN), 'query token removed');
  assert.ok(!out.includes('SECRETPAYLOAD'), 'bearer token removed');
  assert.match(out, /x=1/);
  assert.strictEqual(scrub('a?token=zzz&b=2'), 'a?token=[redacted]&b=2');
});

test('request line: never contains a bearer token, a cookie, or a token= value', async () => {
  const s = sink(); const log = createLogger({ level: 'info', destination: s.stream });
  const app = express();
  app.use(createRequestLogger({ log }));
  app.get('/api/social/inbox/stream', (req, res) => { res.setHeader('Set-Cookie', 'sid=COOKIEVALUE123; HttpOnly'); res.json({ ok: true }); });
  app.get('/api/ready', (req, res) => res.json({ ok: true }));
  app.get('/api/boom', (req, res) => res.status(500).json({ ok: false }));
  const server = await listen(app);
  try {
    const r = await get(server, `/api/social/inbox/stream?token=${QTOKEN}&since=5`, { Authorization: `Bearer ${BEARER}`, Cookie: 'session=SESSIONCOOKIE999' });
    assert.strictEqual(r.status, 200);
    await get(server, '/api/ready');
    await get(server, '/api/boom');
  } finally { server.close(); }
  await new Promise((r) => setImmediate(r));
  const out = s.lines.join('');
  assert.ok(s.lines.length >= 2, 'request lines were written');
  for (const secret of [QTOKEN, 'SECRETPAYLOAD', BEARER, 'SESSIONCOOKIE999', 'COOKIEVALUE123']) assert.ok(!out.includes(secret), `no ${secret} in the log`);
  assert.ok(!/token=(?!\[redacted\])/.test(out), 'every token= is redacted');
  const first = JSON.parse(s.lines[0]);
  assert.strictEqual(first.res.statusCode, 200);
  assert.match(first.req.url, /since=5/, 'other query parameters stay');
  assert.ok(!('headers' in first.req), 'headers are not logged');
  assert.ok(!out.includes('/api/ready'), 'the load balancer probe stays out of the info stream');
  assert.strictEqual(JSON.parse(s.lines[s.lines.length - 1]).level, 50, '5xx is an error line');
});

test('compression: JSON over 1 KB is gzip with Accept-Encoding gzip; small bodies and clients without it are not', async () => {
  const app = express();
  app.use(createCompression());
  app.get('/big', (req, res) => res.json({ rows: Array.from({ length: 200 }, (_, i) => ({ id: i, name: `row number ${i}`, note: 'lorem ipsum dolor sit amet' })) }));
  app.get('/small', (req, res) => res.json({ ok: true }));
  const server = await listen(app);
  try {
    const big = await get(server, '/big', { 'Accept-Encoding': 'gzip' });
    assert.strictEqual(big.headers['content-encoding'], 'gzip');
    assert.strictEqual(JSON.parse(zlib.gunzipSync(big.body).toString()).rows.length, 200);
    const plain = await get(server, '/big', { 'Accept-Encoding': 'identity' });
    assert.ok(!plain.headers['content-encoding']);
    assert.ok(plain.body.length > big.body.length);
    const small = await get(server, '/small', { 'Accept-Encoding': 'gzip' });
    assert.ok(!small.headers['content-encoding'], 'under 1 KB stays as is');
  } finally { server.close(); }
});

test('compression: a text/event-stream route is not compressed and its events arrive at once', async () => {
  const app = express();
  app.use(createCompression());
  app.get('/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache');
    res.flushHeaders();
    res.write(`data: ${'x'.repeat(3000)}\n\n`);
    setTimeout(() => res.end(), 50);
  });
  const server = await listen(app);
  try {
    const r = await get(server, '/stream', { 'Accept-Encoding': 'gzip', Accept: 'text/event-stream' });
    assert.ok(!r.headers['content-encoding'], 'no content-encoding on SSE');
    assert.match(r.body.toString(), /^data: x{3000}/);
  } finally { server.close(); }
});

test('static cache headers: hashed assets immutable, index.html no-cache, nosniff kept', async () => {
  assert.strictEqual(cacheControlFor('/srv/public/assets/index-3fA9c2Bd.js'), 'public, max-age=31536000, immutable');
  assert.strictEqual(cacheControlFor('C:\\app\\public\\assets\\style-9f8e7d6c.css'), 'public, max-age=31536000, immutable');
  assert.strictEqual(cacheControlFor('/srv/public/index.html'), 'no-cache');
  assert.strictEqual(cacheControlFor('/srv/public/assets/logo.png'), null, 'an unhashed name is not immutable');
  assert.strictEqual(cacheControlFor('/srv/public/robots.txt'), null);
  const fs = require('fs'); const os = require('os'); const path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pub-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<html></html>');
  fs.writeFileSync(path.join(dir, 'assets', 'app-abcdef123456.js'), 'console.log(1)');
  const app = express(); app.use(express.static(dir, { setHeaders: setStaticHeaders }));
  const server = await listen(app);
  try {
    const a = await get(server, '/assets/app-abcdef123456.js');
    assert.strictEqual(a.headers['cache-control'], 'public, max-age=31536000, immutable');
    assert.strictEqual(a.headers['x-content-type-options'], 'nosniff');
    const i = await get(server, '/index.html');
    assert.strictEqual(i.headers['cache-control'], 'no-cache');
  } finally { server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('wiring: server-main uses the request logger, compression and static headers; no console.* in the converted files', () => {
  const fs = require('fs'); const path = require('path');
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const main = read('server-main.js');
  assert.match(main, /createRequestLogger\(\)/);
  assert.match(main, /createCompression\(\)/);
  assert.match(main, /setHeaders: require\('\.\/middleware\/staticCache'\)\.setStaticHeaders/);
  assert.ok(main.indexOf('createCompression()') < main.indexOf("app.use('/api/auth'"), 'compression is before the routes');
  assert.ok(!/new Date\(\)\.toISOString\(\)\} - \$\{req\.method\}/.test(main), 'the old per-request console line is gone');
  const files = ['server-main.js', 'routes/auth.js', 'services/videoGenerationQueue.js', 'services/notificationScheduler.js', 'services/snapshotScheduler.js',
    ...fs.readdirSync(path.join(__dirname, '..', 'middleware')).filter((f) => f.endsWith('.js')).map((f) => `middleware/${f}`)];
  for (const f of files) assert.ok(!/\bconsole\.(log|warn|error|info|debug)\(/.test(read(f)), `${f} uses the logger, not console`);
});
