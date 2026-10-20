/**
 * Local before/after benchmark of the auth cache on the DEVELOPMENT database (refuses anything but nebulaa_dev).
 * Reads only, gently (the dev database shares its cluster with production): per endpoint and mode, 5 s at a fixed
 * 50 requests per second, then 5 s closed loop with 10 requests in flight (the sustained rate this one process reaches).
 * "before" is AUTH_CACHE=off (protectCached falls back to protect: the full user document on every request, exactly the
 * old code); "after" is the cache on. Real routes, in-process server on a random 127.0.0.1 port, one throwaway user
 * ("zz.authbench-"), deleted at the end. Usage: node scripts/auth-cache-bench.js [seconds]
 */
require('dotenv').config();
const mongoose = require('mongoose');
const http = require('http');
const express = require('express');

const PREFIX = 'zz.authbench-';
const SECONDS = Math.min(Math.max(Number(process.argv[2]) || 5, 2), 10);
const RATE = 50;
const IN_FLIGHT = 10;

const pct = (arr, p) => { if (!arr.length) return NaN; const s = [...arr].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const r1 = (n) => Math.round(n * 10) / 10;

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  if (mongoose.connection.name !== 'nebulaa_dev') throw new Error(`Refusing: database is ${mongoose.connection.name}`);
  const db = mongoose.connection.db;
  const User = require('../models/User');
  const legal = require('../config/legalVersions');
  const { generateToken } = require('../middleware/auth');
  const user = await User.create({
    email: `${PREFIX}${Date.now()}@example.test`, password: 'Bench-only-1', firstName: 'Bench', isVerified: true, onboardingCompleted: true,
    plan: { tier: 'starter', addons: [] }, credits: { balance: 600 },
    consent: { termsVersion: legal.TERMS_VERSION, privacyVersion: legal.PRIVACY_VERSION, acceptedAt: new Date(), source: 'realdb-check' },
    // a realistic, heavy document: what protect hydrates on every request
    businessProfile: { name: 'Bench Co', description: 'x'.repeat(2000), targetAudience: 'y'.repeat(1000), website: 'https://example.com' },
    connectedSocials: [...Array(4)].map((_, i) => ({ platform: ['instagram', 'facebook', 'linkedin', 'youtube'][i], accountName: `Bench ${i}` }))
  });
  await User.updateOne({ _id: user._id }, { $push: { 'credits.history': { $each: [...Array(200)].map((_, i) => ({ action: 'bench', amount: -1, description: `row ${i}`, createdAt: new Date() })) } } });
  const token = generateToken(user._id);

  const app = express();
  app.use('/api/auth', require('../routes/auth'));
  app.use('/api/credits', require('../routes/credits'));
  app.use('/api/notifications', require('../routes/notifications'));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  if ([3000, 3200, 5000].includes(port)) throw new Error('bad port');
  const agent = new http.Agent({ keepAlive: true, maxSockets: 64 });
  const hit = (path) => new Promise((resolve) => {
    const t0 = process.hrtime.bigint();
    const req = http.request({ host: '127.0.0.1', port, path, agent, headers: { Authorization: `Bearer ${token}` } }, (res) => {
      res.resume();
      res.on('end', () => resolve({ ok: res.statusCode === 200, ms: Number(process.hrtime.bigint() - t0) / 1e6 }));
    });
    req.on('error', () => resolve({ ok: false, ms: Number(process.hrtime.bigint() - t0) / 1e6 }));
    req.end();
  });

  async function fixedRate(path) {
    const lat = []; let bad = 0; const jobs = [];
    const total = RATE * SECONDS; const start = Date.now();
    for (let i = 0; i < total; i += 1) {
      const due = start + (i * 1000) / RATE; const wait = due - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      jobs.push(hit(path).then((x) => { lat.push(x.ms); if (!x.ok) bad += 1; }));
    }
    await Promise.all(jobs);
    return { p50: r1(pct(lat, 50)), p90: r1(pct(lat, 90)), p99: r1(pct(lat, 99)), bad };
  }
  async function closedLoop(path) {
    const lat = []; let bad = 0; const end = Date.now() + SECONDS * 1000; const t0 = Date.now();
    await Promise.all([...Array(IN_FLIGHT)].map(async () => { while (Date.now() < end) { const x = await hit(path); lat.push(x.ms); if (!x.ok) bad += 1; } }));
    return { tps: r1(lat.length / ((Date.now() - t0) / 1000)), p50: r1(pct(lat, 50)), p90: r1(pct(lat, 90)), bad };
  }

  const out = [];
  try {
    for (const path of ['/api/auth/me', '/api/credits', '/api/notifications/unread-count']) {
      for (const mode of ['before', 'after']) {
        if (mode === 'before') process.env.AUTH_CACHE = 'off'; else delete process.env.AUTH_CACHE;
        for (let i = 0; i < 20; i += 1) await hit(path); // warm up
        const fr = await fixedRate(path);
        const cl = await closedLoop(path);
        out.push({ path, mode, ...fr, maxTps: cl.tps, loopP50: cl.p50, loopP90: cl.p90, bad: fr.bad + cl.bad });
        console.log(JSON.stringify(out[out.length - 1]));
      }
    }
  } finally {
    await new Promise((r) => server.close(r));
    agent.destroy();
    const del = await db.collection('users').deleteMany({ email: { $regex: `^${PREFIX.replace(/\./g, '\\.')}` } });
    const left = await db.collection('users').countDocuments({ email: { $regex: `^${PREFIX.replace(/\./g, '\\.')}` } });
    console.log(`cleanup: removed ${del.deletedCount} user(s), left ${left}`);
    await mongoose.disconnect();
    if (left) process.exitCode = 1;
  }
  console.log(`\n${RATE} TPS fixed for ${SECONDS}s (p50/p90/p99 ms), then ${IN_FLIGHT} in flight for ${SECONDS}s (max sustained TPS):`);
  for (const r of out) console.log(`${r.path.padEnd(32)} ${r.mode.padEnd(7)} p50 ${String(r.p50).padStart(6)}  p90 ${String(r.p90).padStart(6)}  p99 ${String(r.p99).padStart(6)}  | max ${String(r.maxTps).padStart(6)} TPS (p50 ${r.loopP50}, p90 ${r.loopP90})  errors ${r.bad}`);
}

main().catch(async (e) => { console.error('bench stopped:', e && e.message); try { await mongoose.disconnect(); } catch (_) { /* ignore */ } process.exit(1); });
