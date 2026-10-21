/**
 * Signs in as the demo brand account through the REAL login route and reads the main screens' data (Stage 2: Library counts,
 * Performance, My plan, Blueprint, calendars, What Nebulaa learned, Home; Stage 3: competitors, Inbox, Photoshoot, Videos and
 * the demo files themselves), against the
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

// A plain GET of a file (no token): status, type, length, and the first bytes when asked.
function fetchFile(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path, headers }, (res) => {
      let n = 0; const head = [];
      res.on('data', (c) => { if (n < 16) head.push(c); n += c.length; });
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] || '', range: res.headers['content-range'] || '', length: n, head: Buffer.concat(head).slice(0, 16) }));
    }).on('error', reject);
  });
}

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

    // ---- Stage 3: competitors, Inbox, Photoshoot, Videos
    const local = (u) => typeof u === 'string' && /^http:\/\/(localhost|127\.0\.0\.1):\d+\/demo-assets\/zaya\//.test(u);
    const bpost = await call(port, 'GET', '/api/competitors/best-posts', { token });
    const bb = bpost.json || {};
    const cards = bb.competitors || [];
    line(bpost.status === 200 && bb.entitled && bb.state === 'ready' && cards.length === 5 && cards.every((x) => x.followers && x.followers.value > 0 && x.status === 'tracking' && x.profileUrl), `/api/competitors/best-posts ${bpost.status}: state ${bb.state}, ${cards.length} tiles (${cards.map((x) => `${x.name} ${x.followers && x.followers.value} (${x.followers && x.followers.change >= 0 ? '+' : ''}${x.followers && x.followers.change})`).join('; ')})`);
    line(cards.every((x) => local(x.avatarUrl) && x.bestPost && x.gallery.length === 6 && x.gallery.every((g) => g.url)) && cards.filter((x) => x.gallery.some((g) => local(g.thumbUrl))).length === 5, `  every tile has a local profile picture, a best post and 6 gallery posts, with post pictures on ${cards.filter((x) => x.gallery.some((g) => local(g.thumbUrl))).length} of 5`);
    line(n(bb.working) === 3 && bb.working.every((w) => w.action && w.reason && local(w.thumbUrl)) && n(bb.trending) >= 4, `  best posts to learn from: ${n(bb.working)} (${(bb.working || []).map((w) => `${w.name} ${w.type} ${w.likes} likes`).join('; ')}); trends ${n(bb.trending)} (${(bb.trending || []).map((t) => t.label).join(', ')})`);
    line(cards.some((x) => x.worked), `  what worked: ${cards.filter((x) => x.worked).map((x) => `${x.name}: ${x.worked.text}`).slice(0, 2).join(' | ')}`);
    const ins = await call(port, 'GET', '/api/competitors/insights', { token });
    const ic = (ins.json && ins.json.competitors) || [];
    line(ins.status === 200 && ic.length === 5 && ic.every((x) => x.status === 'tracking' && n(x.trend) === 4 && x.isCurrentWeek && local(x.avatarUrl)), `/api/competitors/insights ${ins.status}: ${ic.length} competitors tracking, 4 weeks of trend each; highlights ${n(ins.json && ins.json.highlights)} (${((ins.json && ins.json.highlights) || []).map((h) => h.text).join(' | ').slice(0, 220)})`);
    const feed = await call(port, 'GET', '/api/competitors/posts', { token });
    line(feed.status === 200, `/api/competitors/posts ${feed.status}: ${n(feed.json && feed.json.competitors)} competitors listed, ${n(feed.json && feed.json.posts)} feed posts (the weekly readings carry the best posts, the feed is for live reads)`);

    const isum = await call(port, 'GET', '/api/social/inbox/summary', { token });
    const iv = isum.json || {};
    line(isum.status === 200 && iv.unreadMessageCount === 7 && iv.pendingCount === 3 && iv.liveUpdates === 'on' && iv.inboxStatus === 'active', `/api/social/inbox/summary ${isum.status}: unread ${iv.unreadMessageCount} (${JSON.stringify(iv.unreadByPlatform)}), waiting for approval ${iv.pendingCount}, status ${iv.inboxStatus}, live updates ${iv.liveUpdates}, mode ${iv.aiEngagement && iv.aiEngagement.automationMode}, reviews connected ${iv.reviewsConnected}`);
    const convs = await call(port, 'GET', '/api/social/inbox/conversations?limit=100', { token });
    const cl = (convs.json && (convs.json.conversations || convs.json.data)) || [];
    const by = (k) => cl.reduce((a, x) => { a[x[k]] = (a[x[k]] || 0) + 1; return a; }, {});
    line(convs.status === 200 && cl.length === 25, `/api/social/inbox/conversations ${convs.status}: ${cl.length} conversations; by status ${JSON.stringify(by('status'))}; by network ${JSON.stringify(by('platform'))}; by priority ${JSON.stringify(by('priority'))}`);
    for (const st of ['unread', 'read', 'replied', 'closed']) {
      const f = await call(port, 'GET', `/api/social/inbox/conversations?status=${st}`, { token });
      line(f.status === 200 && n(f.json && (f.json.conversations || f.json.data)) > 0, `  filter ${st}: ${n(f.json && (f.json.conversations || f.json.data))}`);
    }
    const pend = await call(port, 'GET', '/api/social/inbox/pending', { token });
    const pl2 = (pend.json && (pend.json.pending || pend.json.items || pend.json.data)) || [];
    line(pend.status === 200 && pl2.length === 3 && pl2.every((p) => p.draft_text && p.reason && p.original_message), `/api/social/inbox/pending ${pend.status}: ${pl2.length} drafts waiting (${pl2.map((p) => `${p.platform}: ${p.reason}`).join('; ')})`);
    const open = cl.find((x) => x.status === 'closed' && x.platform === 'instagram') || cl[0];
    const thread = await call(port, 'GET', `/api/social/inbox/conversations/${open.id}/messages`, { token });
    const tm = (thread.json && (thread.json.messages || thread.json.data)) || [];
    line(thread.status === 200 && tm.length >= 3 && tm.some((x) => x.direction === 'outbound') && tm.some((x) => x.direction === 'inbound'), `/api/social/inbox/conversations/:id/messages ${thread.status}: ${tm.length} messages in "${open.participant_name}" (${tm.map((x) => x.direction[0]).join('')})`);
    const unreadOne = cl.find((x) => x.status === 'unread' && x.platform === 'instagram' && x.message_types.includes('dm'));
    const t2 = await call(port, 'GET', `/api/social/inbox/conversations/${unreadOne.id}/messages`, { token });
    line(t2.status === 200 && t2.json && t2.json.ai && t2.json.ai.autoReplyCandidate, `  an unread thread carries its drafted reply: "${String((t2.json && t2.json.ai && t2.json.ai.autoReplyCandidate) || '').slice(0, 70)}..." (${t2.json && t2.json.ai && t2.json.ai.suggestionsSource})`);
    const iset = await call(port, 'GET', '/api/social/inbox/settings', { token });
    const sv = (iset.json && (iset.json.settings || iset.json.data || iset.json)) || {};
    line(iset.status === 200 && sv.automationMode === 'approval_required' && sv.enabled === true, `/api/social/inbox/settings ${iset.status}: enabled ${sv.enabled}, mode ${sv.automationMode}, signature "${sv.guardrails && sv.guardrails.signature}", rules ${n(sv.responseRules)}`);
    const rev = await call(port, 'GET', '/api/social/inbox/reviews', { token });
    line(rev.status === 200, `/api/social/inbox/reviews ${rev.status}: connected ${rev.json && rev.json.connected}, ${n(rev.json && rev.json.reviews)} reviews (Google reviews are read live from the provider, so the panel says not connected for a demo account)`);

    const shoots = await call(port, 'GET', '/api/photoshoot/jobs', { token });
    const sj = (shoots.json && shoots.json.jobs) || [];
    line(shoots.status === 200 && sj.length === 3 && sj.every((j) => j.status === 'done' && j.done === j.photoCount && j.photos.every((p) => local(p.url))), `/api/photoshoot/jobs ${shoots.status}: ${sj.length} finished (${sj.map((j) => `${j.packTitle}, ${j.done} photos, ${j.aspectRatio}`).join('; ')})`);
    const plib = await call(port, 'GET', '/api/photoshoot/library', { token });
    line(plib.status === 200 && n(plib.json && plib.json.photos) === 14 && plib.json.photos.every((p) => local(p.url)), `/api/photoshoot/library ${plib.status}: ${n(plib.json && plib.json.photos)} photos kept in the Library`);
    const vids = await call(port, 'GET', '/api/videos', { token });
    const vl = (vids.json && vids.json.videos) || [];
    line(vids.status === 200 && vl.length === 5 && vl.every((v) => v.status === 'completed' && /\.mp4$/.test(v.videoUrl) && local(v.videoUrl)), `/api/videos ${vids.status}: ${vl.length} videos (${vl.map((v) => `${v.title.slice(0, 28)} ${v.aspectRatio} ${v.seconds}s`).join('; ')})`);
    const withVideo = await call(port, 'GET', '/api/drafts?status=published&limit=50', { token });
    const reels = ((withVideo.json && withVideo.json.drafts) || []).filter((d) => d.creative && d.creative.videoUrl);
    line(reels.length > 0 && reels.every((d) => local(d.creative.videoUrl)), `/api/drafts (posted): ${reels.length} reels carry a local video link`);

    // the files themselves (served by the dev backend from backend/demo-assets, never from the frontend)
    if (vl.length) {
      const path0 = new URL(vl[0].videoUrl).pathname;
      const whole = await fetchFile(port, path0);
      const part = await fetchFile(port, path0, { Range: 'bytes=0-1023' });
      line(whole.status === 200 && /video\/mp4/.test(whole.type) && whole.length > 100000 && whole.head.slice(4, 8).toString() === 'ftyp', `GET ${path0}: ${whole.status} ${whole.type}, ${whole.length} bytes, an MP4 file`);
      line(part.status === 206 && /^bytes 0-1023\//.test(part.range), `  a range request (what a video player sends) answers ${part.status} ${part.range}`);
      const poster = await fetchFile(port, path0.replace(/\.mp4$/, '.jpg'));
      line(poster.status === 200 && /image\/jpeg/.test(poster.type), `  its poster picture ${poster.status} ${poster.type}`);
    }
    if (cards[0]) {
      const av = await fetchFile(port, new URL(cards[0].avatarUrl).pathname);
      const th = await fetchFile(port, new URL(cards[0].gallery.find((g) => g.thumbUrl).thumbUrl).pathname);
      line(av.status === 200 && th.status === 200 && /image\/jpeg/.test(av.type + th.type), `competitor picture files: profile picture ${av.status}, post picture ${th.status}`);
    }
    const hs3 = await call(port, 'GET', '/api/home/summary', { token });
    const h3 = (hs3.json && (hs3.json.data || hs3.json)) || {};
    line(hs3.status === 200, `/api/home/summary ${hs3.status} (Stage 3): ${JSON.stringify((h3.nextActions || h3.actions || []).map((a) => `${a.title}${a.count ? ` [${a.count}]` : ''}`))}; keys ${Object.keys(h3).join(',')}`);
  } finally {
    await new Promise((r) => server.close(r));
    await mongoose.disconnect();
  }
  process.exit(ok ? 0 : 1);
})().catch((e) => { say('FAILED:', e.message); process.exit(1); });
