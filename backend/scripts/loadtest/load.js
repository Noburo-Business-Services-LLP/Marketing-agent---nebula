#!/usr/bin/env node
'use strict';
/**
 * One URL at a fixed rate. Prints p50/p90/p99, error count and status codes; --out writes JSON.
 *   node scripts/loadtest/load.js --url=http://127.0.0.1:4010/api/health --rate=15 --duration=10 [--token=<jwt>] [--method=POST --body='{"a":1}']
 * Only this machine by default. --allow-remote is for a staging server you own and refuses names that look like production.
 */
const fs = require('fs');
const { runLoad, LOOPBACK } = require('./lib/runner');

const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)]; }));

async function main() {
  if (!args.url) throw new Error('usage: node scripts/loadtest/load.js --url=http://127.0.0.1:PORT/path [--rate=10 --duration=10 --token=... --method=GET --body=json --out=file.json]');
  const u = new URL(String(args.url));
  const local = LOOPBACK.test(u.hostname);
  if (!local) {
    if (!args['allow-remote']) throw new Error(`refusing ${u.hostname}: this tool loads this machine only. Pass --allow-remote for a staging server you own.`);
    if (/(^|\.)(nebulaa\.ai|gravity\.nebulaa\.ai)$/.test(u.hostname) && !/^(staging|test|dev|qa|sandbox|preview)[.-]/.test(u.hostname)) throw new Error(`refusing ${u.hostname}: it looks like production`);
  }
  if ([3000, 3200, 5000].includes(Number(u.port))) throw new Error(`refusing reserved port ${u.port}`);
  const result = await runLoad({
    host: u.hostname, port: Number(u.port) || (u.protocol === 'https:' ? 443 : 80), allowRemote: !local,
    method: String(args.method || 'GET').toUpperCase(), path: u.pathname + u.search,
    headers: args.token ? { Authorization: `Bearer ${args.token}` } : {}, body: args.body
  }, { rate: Number(args.rate) || 10, duration: Number(args.duration) || 10 });
  console.log(JSON.stringify(result));
  if (args.out) fs.writeFileSync(String(args.out), JSON.stringify({ at: new Date().toISOString(), url: String(args.url), rate: Number(args.rate) || 10, duration: Number(args.duration) || 10, result }, null, 2));
}
main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
