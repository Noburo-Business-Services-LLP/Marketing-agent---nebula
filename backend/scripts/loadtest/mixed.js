#!/usr/bin/env node
'use strict';
/**
 * Mixed-flow load run against the real app with in-memory stand-ins (no database, no provider, nothing leaves this
 * machine). It starts scripts/loadtest/serve.js in its own process, drives the flows below at the same time from this
 * process, reads the server's event-loop lag, compares each flow with the tester's targets (docs/superpowers/ops/loadtest.md)
 * and writes JSON.
 *
 *   node scripts/loadtest/mixed.js [--rate=15] [--signin-rate=5] [--duration=10] [--users=20] [--out=file.json] [--strict]
 *
 * --rate is requests per second FOR EACH read flow (so the whole mix is about 7 x rate + signin-rate + health).
 * --strict exits 1 when a target is missed. Without it the table is printed and the exit code is 0 (a short smoke
 * run on a small machine is not a verdict).
 * Flows: sign-in, /api/auth/me, credits, unread count, drafts list, campaigns list, home summary, content calendar GET,
 * plus /api/health as the "others unaffected" probe.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { runLoad } = require('./lib/runner');
const { assertSafeDatabase } = require('./lib/guard');

const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)]; }));
const RATE = Number(args.rate) || 15;
const SIGNIN_RATE = args['signin-rate'] === undefined ? 5 : Number(args['signin-rate']);
const DURATION = Number(args.duration) || 10;
const USERS = Number(args.users) || 20;

// p90 limits in ms from the tester's table (H3): [at 15 req/s, at 50 req/s]. Sign-in is 5 per second sustained.
const GROUPS = {
  light: { at15: 200, at50: 400 }, // session check, credits, unread count
  list: { at15: 300, at50: 600 }, // home summary, campaigns list, drafts list
  calendar: { at15: 150, at50: 300 }
};
const targetFor = (group) => (RATE > 15 ? GROUPS[group].at50 : GROUPS[group].at15);
const SIGNIN_P90 = 800;
const MIX_P90 = RATE >= 40 ? 300 : 400; // "whole mix": 400 ms at 100 req/s, 300 ms at the higher column
const HEALTH_P99 = 200;

function getJson(port, p, token, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers: token ? { Authorization: `Bearer ${token}`, 'Content-Length': 0 } : {} }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch (e) { reject(e); } });
    });
    req.on('error', reject); req.end();
  });
}

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'serve.js'), `--users=${USERS}`], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LOG_LEVEL: process.env.LOG_LEVEL || 'silent' } });
    let buf = ''; let done = false;
    const timer = setTimeout(() => { if (!done) { child.kill('SIGKILL'); reject(new Error('the test server did not start in 90 s')); } }, 90000);
    child.stdout.on('data', (d) => {
      buf += d.toString();
      for (const line of buf.split('\n')) {
        if (line.startsWith('{"ready"')) { done = true; clearTimeout(timer); buf = ''; resolve({ child, info: JSON.parse(line) }); return; }
      }
    });
    child.stderr.on('data', (d) => { const t = d.toString(); if (args.verbose && !/objc\[/.test(t)) process.stderr.write(t); });
    child.on('exit', (code) => { if (!done) { clearTimeout(timer); reject(new Error(`the test server exited with code ${code}`)); } });
  });
}

const pad = (v, n) => String(v).padEnd(n);

async function main() {
  assertSafeDatabase(process.env.MONGODB_URI); // refuses any database but nebulaa_dev; the run itself is in memory
  const { child, info } = await startServer();
  const { port, users, staffToken, password } = info;
  const pick = () => users[Math.floor(Math.random() * users.length)];
  const randomIp = () => `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${1 + Math.floor(Math.random() * 253)}`;
  const authed = (p) => ({ host: '127.0.0.1', port, path: p, headers: () => ({ Authorization: `Bearer ${pick().token}`, 'X-Forwarded-For': randomIp() }) });

  const flows = [
    { name: 'sign-in', group: 'signin', rate: SIGNIN_RATE, spec: { host: '127.0.0.1', port, method: 'POST', path: '/api/auth/login', headers: () => ({ 'X-Forwarded-For': randomIp() }), body: () => ({ email: pick().email, password }) } },
    { name: 'session check (auth/me)', group: 'light', rate: RATE, spec: authed('/api/auth/me') },
    { name: 'credits', group: 'light', rate: RATE, spec: authed('/api/credits') },
    { name: 'unread count', group: 'light', rate: RATE, spec: authed('/api/notifications/unread-count') },
    { name: 'drafts list', group: 'list', rate: RATE, spec: authed('/api/drafts') },
    { name: 'campaigns list', group: 'list', rate: RATE, spec: authed('/api/campaigns') },
    { name: 'home summary', group: 'list', rate: RATE, spec: authed('/api/home/summary') },
    { name: 'content calendar GET', group: 'calendar', rate: RATE, spec: authed('/api/content-calendar') },
    { name: 'health (others unaffected)', group: 'health', rate: 5, spec: { host: '127.0.0.1', port, path: '/api/health' } }
  ].filter((f) => f.rate > 0);

  // A short warm-up (module loads, JIT) is not counted.
  await Promise.all(flows.map((f) => runLoad(f.spec, { rate: Math.min(f.rate, 3), duration: 1 })));
  await getJson(port, '/api/metrics/event-loop/reset', staffToken, 'POST').catch(() => {});
  const before = await getJson(port, '/api/metrics/event-loop', staffToken);

  const all = [];
  const results = await Promise.all(flows.map(async (f) => ({ f, r: await runLoad(f.spec, { rate: f.rate, duration: DURATION, samples: all }) })));
  const after = await getJson(port, '/api/metrics/event-loop', staffToken);
  child.kill('SIGTERM');

  const sortedAll = [...all].sort((a, b) => a - b);
  const mixP90 = Math.round((sortedAll[Math.max(0, Math.ceil(0.9 * sortedAll.length) - 1)] || 0) * 10) / 10;
  const totalRps = Math.round((all.length / DURATION) * 10) / 10;

  const rows = results.map(({ f, r }) => {
    let limit = null; let metric = 'p90'; let value = r.p90;
    if (f.group === 'signin') limit = SIGNIN_P90;
    else if (f.group === 'health') { limit = HEALTH_P99; metric = 'p99'; value = r.p99; }
    else limit = targetFor(f.group);
    const pass = r.errors === 0 && value <= limit;
    return { flow: f.name, rate: f.rate, ...r, metric, value, limit, pass };
  });
  const loop = after.eventLoop;
  const mix = { requests: all.length, rps: totalRps, p90: mixP90, limit: MIX_P90, pass: mixP90 <= MIX_P90 };
  const loopPass = loop.p99 < 100;

  console.log(`\nMixed run: ${DURATION}s, ${RATE} req/s per read flow, sign-in ${SIGNIN_RATE}/s (in-memory stand-ins, one server process)\n`);
  console.log(`${pad('flow', 28)}${pad('req', 6)}${pad('p50', 8)}${pad('p90', 8)}${pad('p99', 8)}${pad('err', 5)}${pad('target', 14)}result`);
  for (const r of rows) console.log(`${pad(r.flow, 28)}${pad(r.requests, 6)}${pad(r.p50, 8)}${pad(r.p90, 8)}${pad(r.p99, 8)}${pad(r.errors, 5)}${pad(`${r.metric} <= ${r.limit}`, 14)}${r.pass ? 'PASS' : 'MISS'}`);
  console.log(`${pad('whole mix', 28)}${pad(mix.requests, 6)}${pad('', 8)}${pad(mix.p90, 8)}${pad('', 8)}${pad('', 5)}${pad(`p90 <= ${mix.limit}`, 14)}${mix.pass ? 'PASS' : 'MISS'}  (${mix.rps} req/s)`);
  console.log(`event-loop lag (server): p50 ${loop.p50} ms, p99 ${loop.p99} ms, max ${loop.max} ms  ${loopPass ? 'PASS' : 'MISS'} (p99 < 100)   rss ${after.memory.rssMb} MB (was ${before.memory.rssMb})`);
  console.log(`status codes: ${rows.map((r) => `${r.flow}: ${JSON.stringify(r.statuses)}`).join('; ')}\n`);
  console.log('Note: stand-in stores, so this measures the app layer, not MongoDB. See docs/superpowers/ops/loadtest.md.');

  const out = { at: new Date().toISOString(), node: process.version, duration: DURATION, ratePerFlow: RATE, signinRate: SIGNIN_RATE, store: 'memory', flows: rows, mix, eventLoop: loop, memory: { before: before.memory, after: after.memory } };
  if (args.out) fs.writeFileSync(String(args.out), JSON.stringify(out, null, 2));
  const ok = rows.every((r) => r.pass) && mix.pass && loopPass;
  return args.strict && !ok ? 1 : 0;
}

main().then((code) => process.exit(code)).catch((e) => { console.error('FAILED:', e && e.message); process.exit(1); });
