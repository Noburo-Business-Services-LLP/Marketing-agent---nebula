'use strict';
/**
 * Starts the real app (server-main.js, no scheduler, no outside call) on a random local port with in-memory stand-ins,
 * seeds throwaway accounts, prints ONE json line on stdout when ready and keeps running until it is stopped.
 * It is the "server under test" for mixed.js, in its own process so the load generator does not share its CPU or event loop.
 *   node scripts/loadtest/serve.js [--users=20] [--drafts=150] [--campaigns=100]
 * Refuses any MONGODB_URI whose database is not nebulaa_dev, and never connects to one (see lib/guard.js).
 */
const path = require('path');
const { assertSafeDatabase, RESERVED_PORTS } = require('./lib/guard');

const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v === undefined ? true : v]; }));
const USERS = Number(args.users) || 20;
const DRAFTS = Number(args.drafts) || 150;
const CAMPAIGNS = Number(args.campaigns) || 100;
const PASSWORD = 'Load-Test-Only-1!';

async function main() {
  assertSafeDatabase(process.env.MONGODB_URI);
  delete process.env.MONGODB_URI; // in-memory only
  Object.assign(process.env, {
    NEBULAA_SERVER_NO_START: '1', NODE_ENV: 'test', LOG_LEVEL: process.env.LOG_LEVEL || 'silent',
    JWT_SECRET: process.env.JWT_SECRET || 'loadtest-only-secret-loadtest-only-secret-123',
    HASH_PEPPER: 'loadtest-only-pepper', AUTH_CACHE: process.env.AUTH_CACHE || 'on', RATE_LIMIT_STORE: 'memory'
  });
  delete process.env.ALLOW_DEMO_AUTH;
  // No request may leave this machine.
  const { LOOPBACK } = require('./lib/runner');
  const https = require('https'); const http = require('http');
  for (const mod of [http, https]) for (const fn of ['request', 'get']) {
    const orig = mod[fn];
    mod[fn] = function guarded(a, ...rest) {
      const host = typeof a === 'string' || a instanceof URL ? new URL(String(a)).hostname : (a && (a.hostname || a.host));
      if (host && !LOOPBACK.test(String(host))) throw new Error(`loadtest server: outgoing request to ${host} refused`);
      return orig.call(this, a, ...rest);
    };
  }
  const realFetch = global.fetch;
  global.fetch = (input, init) => {
    const host = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url).hostname;
    if (!LOOPBACK.test(host)) return Promise.reject(new Error(`loadtest server: outgoing fetch to ${host} refused`));
    return realFetch(input, init);
  };

  const mongoose = require('mongoose');
  const { createAuthHarness } = require(path.join(__dirname, '..', '..', 'tests', 'helpers', 'authHttp'));
  const passwordHash = require(path.join(__dirname, '..', '..', 'services', 'passwordHash'));
  const harness = createAuthHarness();
  const { app } = require(path.join(__dirname, '..', '..', 'server-main'));

  // A model that was not loaded yet would wait 10 s for a database that is not there; fail at once instead.
  mongoose.set('bufferCommands', false);
  // The health probes read the connection: present a connected, answering one (there is nothing else to ask).
  Object.defineProperty(mongoose.connection, 'readyState', { get: () => 1, configurable: true });
  // Raw collection access (the login lockout rows, Home's week and plan reads) finds nothing and writes nowhere.
  const cursor = () => ({ toArray: async () => [], next: async () => null, project() { return this; }, sort() { return this; }, limit() { return this; }, skip() { return this; }, hasNext: async () => false });
  const collection = new Proxy({}, { get: (t, name) => (name === 'find' || name === 'aggregate' ? cursor : name === 'countDocuments' ? async () => 0 : async () => null) });
  const db = { admin: () => ({ command: async () => ({ ok: 1 }) }), collection: () => collection };
  Object.defineProperty(mongoose.connection, 'db', { get: () => db, configurable: true });

  const { installEmptyModels } = require('./lib/memoryStore');
  const now = Date.now();
  const draftRows = Array.from({ length: DRAFTS }, (_, i) => ({
    _id: new mongoose.Types.ObjectId(), title: `Draft ${i}`, contentType: i % 3 ? 'post' : 'reel', status: 'draft', platforms: ['instagram'],
    caption: 'A short caption for a bakery post. '.repeat(6), hashtags: ['#fresh', '#bake'], createdAt: new Date(now - i * 60000), updatedAt: new Date(now)
  }));
  const campaignRows = Array.from({ length: CAMPAIGNS }, (_, i) => ({
    _id: new mongoose.Types.ObjectId(), campaignName: `Campaign ${i}`, status: i % 2 ? 'posted' : 'draft', platforms: ['instagram'],
    creative: { textContent: 'x'.repeat(400) }, createdAt: new Date(now - i * 60000), updatedAt: new Date(now)
  }));
  const pageOf = (rows) => (pipeline) => { const lim = (pipeline || []).find((s) => s && s.$limit); return rows.slice(0, lim ? lim.$limit : 20); };
  installEmptyModels({
    Draft: { aggregate: pageOf(draftRows) },
    Campaign: { aggregate: pageOf(campaignRows), countDocuments: () => CAMPAIGNS },
    Notification: { countDocuments: () => 3 }
  });
  // The calendar read: an account with a stored calendar (the common case).
  const ContentCalendar = require(path.join(__dirname, '..', '..', 'models', 'ContentCalendar'));
  const calendar = { _id: new mongoose.Types.ObjectId(), month: new Date().toISOString().slice(0, 7), approved: false, coverStatus: 'ready', weeks: [1, 2, 3, 4].map((w) => ({ _id: new mongoose.Types.ObjectId(), weekNumber: w, items: [1, 2, 3, 4, 5, 6, 7].map((d) => ({ _id: new mongoose.Types.ObjectId(), day: (w - 1) * 7 + d, format: d % 3 ? 'post' : 'reel', headline: `Idea ${w}-${d}`, creativeConcept: 'A cake on a table', status: 'draft' })) })) };
  const q = (v) => require('./lib/memoryStore').fakeQuery(() => v);
  ContentCalendar.findOne = () => q({ ...calendar });
  ContentCalendar.find = () => q([{ ...calendar }]);

  // Accounts: real password hashes at the configured cost, so sign-in costs what it costs in production.
  const { generateToken } = require(path.join(__dirname, '..', '..', 'middleware', 'auth'));
  const hash = await passwordHash.hash(PASSWORD);
  const users = [];
  for (let i = 0; i < USERS; i += 1) {
    const email = `zz.loadtest-${i}@example.test`;
    const d = await harness.addUser({ email, firstName: 'Load', onboardingCompleted: true, plan: { tier: 'starter' }, businessProfile: { name: 'Load Bakery', businessType: 'B2C' } });
    d.password = hash;
    users.push({ email, token: generateToken(d._id, 0) });
  }
  const staff = await harness.addUser({ email: 'zz.loadtest-staff@example.test', firstName: 'Staff', staffRole: 'owner', onboardingCompleted: true });
  staff.password = hash;

  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const port = server.address().port;
  if (RESERVED_PORTS.has(port)) throw new Error(`reserved port ${port}`);
  process.stdout.write(`${JSON.stringify({ ready: true, port, password: PASSWORD, users, staffToken: generateToken(staff._id, 0), pid: process.pid })}\n`);
  const stop = () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 1000).unref(); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}

main().catch((e) => { process.stderr.write(`loadtest server failed: ${e && e.message}\n`); process.exit(1); });
