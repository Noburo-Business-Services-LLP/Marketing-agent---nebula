/**
 * Local load benchmark of the real API (server-main.js) against the DEVELOPMENT database only.
 * Refuses any database except nebulaa_dev. No AI call, no outside call, nothing charged:
 *  - the server runs inside this process on a random 127.0.0.1 port (never 3000, 3200 or 5000), with no schedulers
 *    (NEBULAA_SERVER_NO_START=1 makes server-main export the app instead of starting it);
 *  - one throwaway account (email starts with "zz.bench-") with a seeded calendar and seeded draft/posted campaigns
 *    (never "scheduled", so no scheduler anywhere can pick them up), deleted at the end;
 *  - every request carries a random X-Forwarded-For address so the per-address limits do not stop the benchmark
 *    (the app trusts one proxy hop, as behind the load balancer).
 *
 *   node scripts/bench-local.js                       run every scenario, print a table, write JSON with --out=<file>
 *   node scripts/bench-local.js --only=login,health   run some scenarios
 *   node scripts/bench-local.js cleanup               delete leftovers of an interrupted run
 * Options: --seconds=10 --concurrency=10 --out=<file>
 */
require('dotenv').config();
process.env.NEBULAA_SERVER_NO_START = '1';
const mongoose = require('mongoose');
const http = require('http');
const crypto = require('crypto');

const PREFIX = 'zz.bench-';
const DEV_DB = 'nebulaa_dev';
const PASSWORD = 'Bench-only-1';

const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
  const [k, v] = a.slice(2).split('=');
  return [k, v === undefined ? true : v];
}));
const SECONDS = Number(args.seconds) || 10;
const CONCURRENCY = Number(args.concurrency) || 10;

// The server logs every request; keep the benchmark's own lines readable.
const say = (...a) => process.stderr.write(`${a.join(' ')}\n`);
if (!args.verbose) { console.log = () => {}; console.info = () => {}; }

async function connect() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set (run from the backend folder so .env is found).');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  if (mongoose.connection.name !== DEV_DB) throw new Error(`Refusing: database is ${mongoose.connection.name}, not ${DEV_DB}`);
}

async function cleanup() {
  const db = mongoose.connection.db;
  const users = await db.collection('users').find({ email: { $regex: `^${PREFIX.replace(/\./g, '\\.')}` } }, { projection: { _id: 1 } }).toArray();
  const ids = users.map((u) => u._id);
  if (ids.length) {
    for (const c of ['contentcalendars', 'campaigns', 'featureevents', 'notifications']) {
      await db.collection(c).deleteMany({ userId: { $in: ids } }).catch(() => {});
    }
    await db.collection('users').deleteMany({ _id: { $in: ids } });
  }
  return ids.length;
}

const randomIp = () => `10.${crypto.randomInt(0, 255)}.${crypto.randomInt(0, 255)}.${crypto.randomInt(1, 254)}`;
const agent = new http.Agent({ keepAlive: true, maxSockets: 256 });

function request(port, { method = 'GET', path, token, body }) {
  return new Promise((resolve) => {
    const payload = body === undefined ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const started = process.hrtime.bigint();
    const req = http.request({
      host: '127.0.0.1', port, method, path, agent,
      headers: {
        'X-Forwarded-For': randomIp(),
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, ms: Number(process.hrtime.bigint() - started) / 1e6 }));
    });
    req.on('error', () => resolve({ status: 0, ms: Number(process.hrtime.bigint() - started) / 1e6 }));
    if (payload) req.write(payload);
    req.end();
  });
}

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : 0);

/** Closed loop: `concurrency` workers each send the next request as soon as the last one answered. */
async function load(port, spec, { seconds = SECONDS, concurrency = CONCURRENCY } = {}) {
  const until = Date.now() + seconds * 1000;
  const times = [];
  const statuses = {};
  const worker = async () => {
    while (Date.now() < until) {
      const r = await request(port, typeof spec === 'function' ? spec() : spec);
      times.push(r.ms);
      statuses[r.status] = (statuses[r.status] || 0) + 1;
    }
  };
  const t0 = Date.now();
  await Promise.all(Array.from({ length: concurrency }, worker));
  const elapsed = (Date.now() - t0) / 1000;
  times.sort((a, b) => a - b);
  return {
    requests: times.length, rps: +(times.length / elapsed).toFixed(1),
    p50: +pct(times, 50).toFixed(1), p90: +pct(times, 90).toFixed(1), p99: +pct(times, 99).toFixed(1), max: +(times[times.length - 1] || 0).toFixed(1),
    statuses
  };
}

async function main() {
  await connect();
  if (process.argv.includes('cleanup')) {
    say(`removed ${await cleanup()} leftover benchmark account(s)`);
    return;
  }
  await cleanup();

  const { app } = require('../server-main');
  const User = require('../models/User');
  const { generateToken } = require('../middleware/auth');
  const { calendarMonth } = require('../services/contentCalendarService');
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const port = server.address().port;
  if ([3000, 3200, 5000].includes(port)) throw new Error(`Refusing reserved port ${port}`);

  const tag = `${PREFIX}${Date.now()}`;
  const results = {};
  try {
    const user = await User.create({
      email: `${tag}@example.test`, password: PASSWORD, firstName: 'Bench', isVerified: true, isActive: true, onboardingCompleted: true,
      plan: { tier: 'starter' }, businessProfile: { name: 'Bench Bakery', description: 'Cakes', businessType: 'B2C' }
    });
    const empty = await User.create({ email: `${tag}-empty@example.test`, password: PASSWORD, firstName: 'Bench2', isVerified: true, isActive: true });
    const token = generateToken(user._id);
    const emptyToken = generateToken(empty._id);
    const db = mongoose.connection.db;
    const now = new Date();
    await db.collection('contentcalendars').insertOne({
      userId: user._id, month: calendarMonth(), businessName: 'Bench Bakery', language: 'English', approved: false, autoGenerate: false,
      coverStatus: 'ready', createdAt: now, updatedAt: now,
      weeks: [1, 2, 3, 4].map((w) => ({ _id: new mongoose.Types.ObjectId(), weekNumber: w, items: [1, 2, 3, 4, 5, 6, 7].map((d) => ({ _id: new mongoose.Types.ObjectId(), day: (w - 1) * 7 + d, format: d % 3 ? 'post' : 'reel', headline: `Idea ${w}-${d}`, creativeConcept: 'A cake on a table', status: 'draft' })) }))
    });
    await db.collection('campaigns').insertMany(Array.from({ length: 40 }, (_, i) => ({
      userId: user._id, name: `Bench campaign ${i}`, status: i % 2 ? 'posted' : 'draft', platforms: ['instagram'],
      creative: { textContent: 'x'.repeat(400), captions: 'y'.repeat(300) }, createdAt: new Date(now - i * 60000), updatedAt: now
    })));

    const bigBody = { notes: Array.from({ length: 400 }, (_, i) => `<b>Line ${i}</b> fish & chips < 5 > 3 ${'lorem ipsum '.repeat(40)}`) };
    const scenarios = {
      health: { path: '/api/health' },
      me: { path: '/api/auth/me', token },
      login: { method: 'POST', path: '/api/auth/login', body: { email: user.email, password: PASSWORD } },
      calendar: { path: '/api/content-calendar', token },
      calendarEmpty: { path: '/api/content-calendar', token: emptyToken },
      campaigns: { path: '/api/campaigns', token },
      body200k: { method: 'POST', path: '/api/zz-bench-unknown', body: bigBody }
    };
    say(`body200k payload: ${Buffer.byteLength(JSON.stringify(bigBody))} bytes`);
    const only = args.only ? String(args.only).split(',') : Object.keys(scenarios).concat(['healthDuringLogin']);
    // The calendar GET for an account with no calendar used to make one with the AI (a real, paid call). It is only
    // measured once that GET is read-only: pass --only=calendarEmpty explicitly.
    const runList = args.only ? only : only.filter((n) => n !== 'calendarEmpty');
    for (const name of runList) {
      if (name === 'healthDuringLogin') {
        const [loginRun, healthRun] = await Promise.all([
          load(port, scenarios.login),
          load(port, scenarios.health, { concurrency: 5 })
        ]);
        results.healthDuringLogin = { ...healthRun, loginRps: loginRun.rps, loginP90: loginRun.p90 };
      } else if (scenarios[name]) {
        results[name] = await load(port, scenarios[name]);
      }
      say(`${name.padEnd(18)} ${JSON.stringify(results[name])}`);
    }
  } finally {
    server.close();
    agent.destroy();
    const n = await cleanup();
    say(`cleanup: removed ${n} benchmark account(s) and their rows`);
    await mongoose.disconnect();
  }
  if (args.out) require('fs').writeFileSync(String(args.out), JSON.stringify({ at: new Date().toISOString(), seconds: SECONDS, concurrency: CONCURRENCY, results }, null, 2));
}

main().then(() => process.exit(0)).catch((e) => { say('FAILED:', e && e.message); process.exit(1); });
