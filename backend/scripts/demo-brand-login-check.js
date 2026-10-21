/**
 * Signs in as the demo brand account through the REAL login route and reads the main screens' data (Stage 2: Library counts,
 * Performance, My plan, Blueprint, calendars, What Nebulaa learned, Home), against the
 * DEVELOPMENT database only (refuses any other database before connecting). The server runs inside this process on a
 * random 127.0.0.1 port with no schedulers (NEBULAA_SERVER_NO_START=1). No AI, payment, email or social call is made.
 *
 *   node scripts/demo-brand-login-check.js --password-file /absolute/path/to/the/password/file.txt
 * The password is read from the file and is never printed.
 */
require('dotenv').config();
process.env.NEBULAA_SERVER_NO_START = '1';
const fs = require('fs');
const http = require('http');
const mongoose = require('mongoose');
const safety = require('./demo-brand/safety');

const say = (...a) => process.stderr.write(`${a.join(' ')}\n`);
const flag = process.argv.find((a) => a.startsWith('--password-file'));
const file = flag && flag.includes('=') ? flag.split('=')[1] : process.argv[process.argv.indexOf('--password-file') + 1];

function call(port, method, path, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: {
      'Content-Type': 'application/json', 'X-Forwarded-For': `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.7`,
      ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
    } }, (res) => {
      let t = ''; res.on('data', (c) => { t += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(t); } catch (_) { /* not json */ } resolve({ status: res.statusCode, json: j }); });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  safety.assertDevUri(process.env.MONGODB_URI);
  if (!file || !safety.passwordFileOk(file)) throw new Error('Give --password-file <absolute path outside the repo>.');
  const m = /^Password:\s*(.+)$/m.exec(fs.readFileSync(file, 'utf8'));
  if (!m) throw new Error('No "Password:" line in the file.');
  console.log = () => {}; console.info = () => {};
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  safety.assertDevTarget(mongoose.connection.name);
  const { app } = require('../server-main');
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  let ok = true;
  const line = (good, text) => { if (!good) ok = false; say(`${good ? 'yes' : 'NO '}: ${text}`); };
  try {
    const login = await call(port, 'POST', '/api/auth/login', { body: { email: safety.DEMO_EMAIL, password: m[1].trim() } });
    const token = login.json && login.json.token;
    line(login.status === 200 && !!token, `login answered ${login.status} with a token`);
    if (!token) throw new Error('Cannot continue without a token.');
    const me = await call(port, 'GET', '/api/auth/me', { token });
    const u = (me.json && (me.json.user || me.json)) || {};
    line(me.status === 200 && u.email === safety.DEMO_EMAIL, `/api/auth/me ${me.status}, plan ${u.plan && u.plan.tier}, onboardingCompleted ${u.onboardingCompleted}`);
    const cr = await call(port, 'GET', '/api/credits', { token });
    line(cr.status === 200, `/api/credits ${cr.status}: ${JSON.stringify(cr.json && (cr.json.data || cr.json)).slice(0, 220)}`);
    const home = await call(port, 'GET', '/api/home/summary', { token });
    line(home.status === 200, `/api/home/summary ${home.status}: keys ${Object.keys((home.json && (home.json.data || home.json)) || {}).join(',')}`);
    const soc = await call(port, 'GET', '/api/social/status', { token });
    line(soc.status === 200, `/api/social/status ${soc.status}: ${JSON.stringify(soc.json).slice(0, 260)}`);

    // ---- Stage 2: content, plan, performance, memory
    const n = (v) => (Array.isArray(v) ? v.length : 0);
    const counts = await call(port, 'GET', '/api/drafts/counts', { token });
    const c = (counts.json && counts.json.counts) || {};
    line(counts.status === 200 && Object.values(c).length === 7 && Object.values(c).every((x) => x > 0), `/api/drafts/counts ${counts.status}: ${JSON.stringify(c)}`);
    for (const view of ['draft', 'approved', 'scheduled', 'published', 'archived', 'binned']) {
      const l = await call(port, 'GET', `/api/drafts?status=${view}&limit=50`, { token });
      line(l.status === 200 && n(l.json && l.json.drafts) > 0, `/api/drafts?status=${view} ${l.status}: ${n(l.json && l.json.drafts)} shown${l.json && l.json.hasMore ? ' (more on the next page)' : ''}`);
    }
    const perf = await call(port, 'GET', '/api/analytics/performance?range=month', { token });
    const pv = (perf.json && (perf.json.data || perf.json)) || {};
    const kpi = pv.overall || {};
    const lists = (pv.topPosts && pv.topPosts.lists) || {};
    line(perf.status === 200 && kpi.followers && kpi.followers.available && kpi.reach && kpi.reach.available, `/api/analytics/performance month ${perf.status}: followers ${kpi.followers && kpi.followers.value} (${kpi.followers && kpi.followers.changePct}%), reach ${kpi.reach && kpi.reach.value}, engagement ${kpi.engagementRate && kpi.engagementRate.value}%, likes ${kpi.likes && kpi.likes.value}, posts ${kpi.posts && kpi.posts.value}, measured ${kpi.postsMeasured && kpi.postsMeasured.value}`);
    line(n(pv.platforms) > 0 && pv.platforms.filter((x) => x.state === 'ready').length >= 3, `  platform tiles ready: ${(pv.platforms || []).map((x) => `${x.platform}:${x.state}`).join(', ')}`);
    line(n(lists.engagement && lists.engagement.posts) >= 3 && lists.engagement.posts.every((x) => x.thumbnail), `  top posts with pictures: ${n(lists.engagement && lists.engagement.posts)}; format comparison ${pv.byFormat && pv.byFormat.available} (${(pv.byFormat && pv.byFormat.rows || []).map((x) => `${x.label} ${x.average}/${x.posts}`).join('; ')}); best day ${pv.byDay && pv.byDay.available}; best time ${pv.byTime && pv.byTime.available}`);
    line(n(pv.insights) >= 3, `  findings: ${n(pv.insights)} (${(pv.insights || []).map((x) => String(x.text || x.sentence || '').slice(0, 70)).join(' | ')})`);
    for (const range of ['week', '90d']) {
      const pr = await call(port, 'GET', `/api/analytics/performance?range=${range}`, { token });
      const o = (pr.json && (pr.json.data || pr.json) || {}).overall || {};
      line(pr.status === 200 && o.followers && o.followers.available, `/api/analytics/performance ${range} ${pr.status}: followers ${o.followers && o.followers.value} (${o.followers && o.followers.changePct}%), posts ${o.posts && o.posts.value}`);
    }
    const plan = await call(port, 'GET', '/api/plan', { token });
    const pl = (plan.json && plan.json.plan && plan.json.plan.result && plan.json.plan.result.plan) || {};
    line(plan.status === 200 && n(pl.pillars) === 5 && n(pl.calendar) === 30 && n(pl.offline) === 3 && n(pl.metrics) >= 3 && pl.mix, `/api/plan ${plan.status}: pillars ${n(pl.pillars)}, calendar ${n(pl.calendar)}, channels ${n(pl.channels)}, offline ${n(pl.offline)}, metrics ${n(pl.metrics)}, customers ${n(pl.icp && pl.icp.who)}, roadmap ${n(pl.roadmap)}`);
    const bp = await call(port, 'GET', '/api/blueprint', { token });
    const bl = (bp.json && (bp.json.blueprints || bp.json.items || bp.json.list || bp.json.data)) || [];
    line(bp.status === 200, `/api/blueprint ${bp.status}: ${n(bl)} listed ${JSON.stringify(Object.keys(bp.json || {}))}`);
    const cal = await call(port, 'GET', '/api/content-calendar', { token });
    line(cal.status === 200, `/api/content-calendar ${cal.status}: ${JSON.stringify(cal.json).slice(0, 160)}`);
    const mem = await call(port, 'GET', '/api/ai-memory/learned', { token });
    const srcs = (mem.json && mem.json.sources) || [];
    line(mem.status === 200 && (mem.json && mem.json.itemCount) > 0, `/api/ai-memory/learned ${mem.status}: ${mem.json && mem.json.itemCount} items; ${srcs.map((x) => `${x.key} ${x.state} (${x.items.length} items, ${x.evidenceCount} ${x.evidenceUnit || 'evidence'})`).join('; ')}`);
    const hs = await call(port, 'GET', '/api/home/summary', { token });
    const h = (hs.json && (hs.json.data || hs.json)) || {};
    line(hs.status === 200, `/api/home/summary ${hs.status}: next ${(h.nextActions || h.actions || []).map((a) => a.title).join(' | ')}; numbers ${JSON.stringify(h.numbers || h.week || '').slice(0, 300)}`);
  } finally {
    await new Promise((r) => server.close(r));
    await mongoose.disconnect();
  }
  process.exit(ok ? 0 : 1);
})().catch((e) => { say('FAILED:', e.message); process.exit(1); });
