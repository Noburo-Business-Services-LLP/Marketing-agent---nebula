// Attack-style checks against a THROWAWAY local server (127.0.0.1:5055) and a LOCAL database only.
const path = require('path');
const BACK = '/Users/dineshkannaa/Documents/0 CONTENT/Claude Agents/nebula-worktrees/nebulaa-redesign/backend';
const mongoose = require(path.join(BACK, 'node_modules/mongoose'));
const jwt = require(path.join(BACK, 'node_modules/jsonwebtoken'));
const URI = 'mongodb://127.0.0.1:27055/attack_test';
const BASE = 'http://127.0.0.1:5055';
const SECRET = 'attack-test-secret-not-real';
let ipN = 1; const newIp = () => { ipN += 1; return `198.51.100.${ipN}`; }; let cur = newIp();
const results = [];
const rec = (area, name, pass, detail = '') => { results.push({ area, name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} [${area}] ${name}${detail ? ' — ' + detail : ''}`); };
const req = async (method, p, { token, body, headers = {}, raw } = {}) => {
  const h = { 'X-Forwarded-For': cur, ...headers }; if (token) h.Authorization = `Bearer ${token}`;
  if (body !== undefined && !raw) h['Content-Type'] = 'application/json';
  try {
    const r = await fetch(BASE + p, { method, headers: h, body: raw ? raw : body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual' });
    let j = null; const t = await r.text(); try { j = JSON.parse(t); } catch (_) {}
    return { status: r.status, json: j, text: t, headers: r.headers };
  } catch (e) { return { status: 0, error: e.message, text: '' }; }
};

(async () => {
  if (!URI.includes('127.0.0.1:27055')) throw new Error('refusing: not the local database');
  await mongoose.connect(URI);
  const User = require(path.join(BACK, 'models/User'));
  await User.deleteMany({});
  const mk = async (email, extra = {}) => User.create({ email, password: 'Passw0rd!x', firstName: 'T', isVerified: true, isActive: true, onboardingCompleted: true, ...extra });
  const A = await mk('a@attack.test'); const B = await mk('b@attack.test');
  const tok = (u, o = {}) => jwt.sign({ id: String(u._id), ...o }, SECRET, { expiresIn: '1h' });
  const tA = tok(A), tB = tok(B);

  // ---- 1. Every API route without a token
  const mounts = { '/api/staff': 'staff', '/api/csm': 'csm', '/api/drafts': 'drafts', '/api/campaigns': 'campaigns', '/api/carousels': 'carousels', '/api/brand-assets': 'brandAssets', '/api/video-generation': 'videoGeneration', '/api/hero-video': 'heroVideo', '/api/blueprint': 'blueprint', '/api/credits': 'credits', '/api/payment': 'payment', '/api/products': 'products', '/api/ideas': 'ideas', '/api/reminders': 'reminders', '/api/competitors': 'competitors', '/api/notifications': 'notifications', '/api/dashboard': 'dashboard', '/api/brand': 'brand', '/api/ai-memory': 'aiMemory', '/api/content-calendar': 'contentCalendar', '/api/social': 'social', '/api/chat': 'chat', '/api/support': 'support', '/api/analytics': 'analytics', '/api/ads': 'ads', '/api/ad-campaigns': 'adCampaigns', '/api/accounts': 'accounts', '/api/influencers': 'influencerRoutes', '/api/collaborations': 'collaborationRoutes', '/api/submissions': 'submissionRoutes', '/api/seo': 'seoRoutes', '/api/prompts': 'prompts', '/api/content': 'content', '/api/google-calendar': 'googleCalendar' };
  const fs = require('fs');
  const publicOk = [/^\/api\/auth\//, /\/callback$/, /webhooks?/, /\/plans$/, /videoStyles$/, /generateVideoStylePrompts|generateSceneDescriptions/, /^\/api\/payment\/webhook$/, /\/stream$/];
  let swept = 0; const open = [];
  for (const [prefix, file] of Object.entries(mounts)) {
    const src = fs.readFileSync(path.join(BACK, 'routes', file + '.js'), 'utf8');
    for (const m of src.matchAll(/router\.(get|post|put|delete|patch)\(\s*['"`]([^'"`]*)['"`]/g)) {
      const method = m[1].toUpperCase(); const p = (prefix + (m[2] === '/' ? '' : m[2])).replace(/:[A-Za-z]+/g, '000000000000000000000000');
      if (publicOk.some((re) => re.test(p))) continue;
      const r = await req(method, p, method === 'GET' ? {} : { body: {} });
      swept += 1;
      if (![401, 403, 404].includes(r.status) || (r.status === 404 && !/not found|API endpoint/i.test(r.text))) open.push(`${method} ${p} -> ${r.status}`);
    }
  }
  rec('access', `no-token sweep over ${swept} routes: all refused (401/403)`, open.length === 0, open.slice(0, 15).join('; '));

  cur = newIp();
  // ---- 2. Token tampering
  const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url') + '.' + Buffer.from(JSON.stringify({ id: String(A._id) })).toString('base64url') + '.';
  const wrongKey = jwt.sign({ id: String(A._id) }, 'some-other-secret');
  const expired = jwt.sign({ id: String(A._id) }, SECRET, { expiresIn: -10 });
  const ghost = jwt.sign({ id: '64b000000000000000000000' }, SECRET);
  const adminTok = jwt.sign({ role: 'admin', email: 'x' }, SECRET);
  for (const [n, t] of [['alg none', none], ['wrong secret', wrongKey], ['expired', expired], ['deleted user', ghost], ['admin-role token on a user route', adminTok], ['garbage', 'abc.def.ghi']]) {
    const r = await req('GET', '/api/auth/me', { token: t });
    rec('tokens', `${n} refused`, r.status === 401, `status ${r.status}`);
  }
  const noStaff = await req('GET', '/api/staff/overview', { token: tA });
  rec('tokens', 'ordinary user token refused on staff area', [403, 404].includes(noStaff.status), `status ${noStaff.status}`);
  const noAdmin = await req('POST', '/api/admin/make-owner', { token: tA, body: { email: 'a@attack.test' } });
  rec('tokens', 'ordinary user token cannot make an owner', noAdmin.status === 401 || noAdmin.status === 403, `status ${noAdmin.status}`);

  cur = newIp();
  // ---- 3. Mass assignment
  const mass = await req('PUT', '/api/auth/update-profile', { token: tA, body: { firstName: 'Hax', staffRole: 'owner', isCsm: true, isAdmin: true, credits: { balance: 9999999 }, plan: { tier: 'managed' }, isVerified: true, email: 'evil@attack.test' } });
  const A2 = await User.findById(A._id).lean();
  rec('mass-assignment', 'profile update cannot set role, Quarks, plan or email', !A2.staffRole && !A2.isCsm && A2.credits.balance !== 9999999 && (!A2.plan || A2.plan.tier !== 'managed') && A2.email === 'a@attack.test', `staffRole=${A2.staffRole} bal=${A2.credits && A2.credits.balance} tier=${A2.plan && A2.plan.tier}`);
  const mass2 = await req('POST', '/api/auth/signup', { body: { email: 'new1@attack.test', password: 'Passw0rd!x', firstName: 'N', staffRole: 'owner', isVerified: true, credits: { balance: 9999999 }, plan: { tier: 'managed' }, isCsm: true } });
  const N1 = await User.findOne({ email: 'new1@attack.test' }).lean();
  rec('mass-assignment', 'signup cannot set role, verification, Quarks or plan', !!N1 && !N1.staffRole && N1.isVerified === false && !N1.isCsm && N1.credits.balance !== 9999999 && (!N1.plan || N1.plan.tier === 'free'), `status ${mass2.status}`);

  cur = newIp();
  // ---- 4. Cross-account (IDOR)
  const pr = await req('POST', '/api/products', { token: tA, body: { name: 'A product', type: 'product', price: 10 } });
  const pid = pr.json && (pr.json.product && pr.json.product._id || pr.json.data && pr.json.data._id || pr.json._id);
  const idea = await req('POST', '/api/ideas', { token: tA, body: { text: 'A secret idea' } });
  const iid = idea.json && (idea.json.idea && idea.json.idea._id || idea.json.data && idea.json.data._id || idea.json._id);
  const rem = await req('POST', '/api/reminders', { token: tA, body: { title: 'A reminder', message: 'A reminder', date: new Date(Date.now() + 86400000).toISOString(), reminderDate: new Date(Date.now() + 86400000).toISOString(), type: 'custom' } });
  const rid = rem.json && (rem.json.reminder && rem.json.reminder._id || rem.json.data && rem.json.data._id || rem.json._id);
  rec('idor', 'test records created for account A', !!(pid && iid), `product=${!!pid} idea=${!!iid} reminder=${!!rid}`);
  if (pid) {
    const g = await req('GET', `/api/products/${pid}`, { token: tB }); rec('idor', 'B cannot read A\'s product', ![200].includes(g.status), `status ${g.status}`);
    const u = await req('PUT', `/api/products/${pid}`, { token: tB, body: { name: 'pwned', type: 'product' } }); rec('idor', 'B cannot edit A\'s product', ![200].includes(u.status), `status ${u.status}`);
    const d = await req('DELETE', `/api/products/${pid}`, { token: tB }); const still = await req('GET', `/api/products/${pid}`, { token: tA });
    rec('idor', 'B cannot delete A\'s product', still.status === 200, `delete ${d.status}, A still sees it: ${still.status}`);
    const list = await req('GET', '/api/products', { token: tB }); rec('idor', 'B\'s product list does not contain A\'s item', !/A product/.test(list.text));
  }
  if (iid) {
    const u = await req('PUT', `/api/ideas/${iid}`, { token: tB, body: { text: 'pwned' } }); const d = await req('DELETE', `/api/ideas/${iid}`, { token: tB });
    const l = await req('GET', '/api/ideas', { token: tA });
    rec('idor', 'B cannot edit or delete A\'s idea', /A secret idea/.test(l.text) && !/pwned/.test(l.text), `put ${u.status} delete ${d.status}`);
    const lb = await req('GET', '/api/ideas', { token: tB }); rec('idor', 'B\'s idea list does not show A\'s idea', !/A secret idea/.test(lb.text));
  }
  if (rid) { const d = await req('DELETE', `/api/reminders/${rid}`, { token: tB }); const l = await req('GET', '/api/reminders', { token: tA }); rec('idor', 'B cannot delete A\'s reminder', /A reminder/.test(l.text), `delete ${d.status}`); }
  const dr = await req('GET', '/api/drafts/000000000000000000000000', { token: tB }); rec('idor', 'unknown draft id gives a plain not-found', [404, 400].includes(dr.status), `status ${dr.status}`);

  cur = newIp();
  // ---- 5. Injection
  const inj1 = await req('POST', '/api/auth/login', { body: { email: { $gt: '' }, password: { $gt: '' } } });
  rec('injection', 'login with a database operator instead of an email is refused', inj1.status === 400 || inj1.status === 401, `status ${inj1.status}`);
  const inj2 = await req('POST', '/api/auth/login', { body: { email: 'a@attack.test', password: { $ne: 'x' } } });
  rec('injection', 'login with an operator as the password is refused', inj2.status !== 200 || !(inj2.json && inj2.json.token), `status ${inj2.status}`);
  const proto = await req('POST', '/api/auth/signup', { raw: '{"email":"p@attack.test","password":"Passw0rd!x","firstName":"P","__proto__":{"isAdmin":true},"constructor":{"prototype":{"polluted":true}}}', headers: { 'Content-Type': 'application/json' } });
  rec('injection', 'prototype-pollution payload does not pollute the server', ({}).polluted === undefined && (await req('GET', '/api/health')).status === 200, `status ${proto.status}`);
  const xss = await req('POST', '/api/ideas', { token: tA, body: { text: '<script>alert(1)</script><img src=x onerror=alert(1)>hello' } });
  const xl = await req('GET', '/api/ideas', { token: tA });
  rec('injection', 'script tags in saved text are stripped', !/<script|onerror/i.test(xl.text), '');

  cur = newIp();
  const pw = await req('POST', '/api/auth/login', { body: { email: 'a@attack.test', password: { $ne: 'x' } } });
  rec('injection', 'login with an object as password is a clean 400 (not a server error)', pw.status === 400, `status ${pw.status}`);
  const chatAnon = await req('POST', '/api/chat/message', { body: { message: 'hello' } });
  rec('spend', 'anonymous chat (paid AI) refused', chatAnon.status === 401, `status ${chatAnon.status}`);
  const chatSug = await req('GET', '/api/chat/suggestions');
  rec('spend', 'anonymous chat suggestions refused', chatSug.status === 401, `status ${chatSug.status}`);
  let sup = []; for (let i = 0; i < 7; i += 1) sup.push((await req('POST', '/api/support/query', { body: { message: 'x', name: 'n\r\nBcc: evil@x.com', email: 'a@b.co' } })).status);
  rec('spend', 'anonymous support form is limited to 5 per hour (no email flooding)', sup.filter((x) => x === 429).length >= 2, `statuses ${sup.join(',')}`);
  cur = newIp();
  const supBig = await req('POST', '/api/support/query', { body: { message: 'y'.repeat(6000) } });
  rec('spend', 'oversized support message refused', supBig.status === 400, `status ${supBig.status}`);
  // ---- 6. Size and shape
  const big = await req('POST', '/api/auth/login', { raw: JSON.stringify({ email: 'a@attack.test', password: 'x'.repeat(2 * 1024 * 1024) }), headers: { 'Content-Type': 'application/json' } });
  rec('size', '2 MB body on login refused (limit 1 MB)', big.status === 413, `status ${big.status}`);
  let deep = '1'; for (let i = 0; i < 5000; i += 1) deep = `{"a":${deep}}`;
  const deepR = await req('POST', '/api/auth/login', { raw: deep, headers: { 'Content-Type': 'application/json' } });
  rec('size', 'deeply nested JSON does not crash the server', deepR.status !== 0 && (await req('GET', '/api/health')).status === 200, `status ${deepR.status}`);
  const bad = await req('POST', '/api/auth/login', { raw: '{"email": ', headers: { 'Content-Type': 'application/json' } });
  rec('size', 'malformed JSON gives a clean error with no stack trace', bad.status === 400 && !/at .*\.js:\d+|node_modules|\/Users\//.test(bad.text), `status ${bad.status}`);
  const err500 = await req('GET', '/api/products/not-an-id', { token: tA });
  rec('size', 'bad id gives a clean 400 with no stack trace or file paths', err500.status === 400 && !/at .*\.js:\d+|node_modules|\/Users\/|CastError/.test(err500.text), `status ${err500.status}`);

  cur = newIp();
  // ---- 7. Rate limits / brute force
  let last; let limitedAt = 0;
  for (let i = 1; i <= 30; i += 1) { last = await req('POST', '/api/auth/login', { body: { email: `nobody${i}@attack.test`, password: 'wrongpass1' } }); if (last.status === 429 && !limitedAt) limitedAt = i; }
  rec('brute-force', 'repeated login attempts are rate-limited', limitedAt > 0 && limitedAt <= 21, `limited at attempt ${limitedAt}`);
  // account lockout is per account
  // admin login brute force limited by same limiter (same IP, already limited) -> check message
  const adm = await req('POST', '/api/admin/login', { body: { email: 'admin@attack.test', password: 'wrong' } });
  rec('brute-force', 'admin login shares the strict limit', adm.status === 429, `status ${adm.status}`);

  cur = newIp();
  // ---- 8. SSRF
  for (const u of ['http://127.0.0.1:5055/api/health', 'http://169.254.169.254/latest/meta-data/', 'http://localhost:27055/', 'http://[::1]:5055/', 'http://0x7f000001/', 'http://2130706433/']) {
    cur = newIp();
    const r = await req('POST', '/api/auth/signup-brand-colors', { body: { website: u } });
    const leaked = /"status":"ok"|ami-id|instance-id/.test(r.text);
    rec('ssrf', `signup website reader will not touch ${u}`, !leaked && r.status !== 429, `status ${r.status} ${(r.json && (r.json.source || r.json.message)) || ''}`);
  }

  cur = newIp();
  // ---- 9. Payments
  const pv = await req('POST', '/api/payment/verify', { token: tA, body: { razorpay_order_id: 'order_x', razorpay_payment_id: 'pay_x', razorpay_signature: 'forged' } });
  rec('payments', 'forged payment signature refused', pv.status === 400 || pv.status === 500 && !/success":true/.test(pv.text), `status ${pv.status}`);
  const wh = await req('POST', '/api/payment/webhook', { raw: JSON.stringify({ event: 'subscription.charged', payload: {} }), headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': 'forged' } });
  rec('payments', 'webhook with a forged signature refused', wh.status === 400 || wh.status === 500, `status ${wh.status}`);
  const A3 = await User.findById(A._id).lean(); rec('payments', 'no Quarks were added by forged payment attempts', A3.credits.balance === A2.credits.balance);

  cur = newIp();
  // ---- 10. Transport / headers / files
  const evil = await req('GET', '/api/health', { headers: { Origin: 'https://evil.example' } });
  rec('headers', 'a foreign website origin is not allowed by CORS', !evil.headers.get('access-control-allow-origin'), `allow-origin=${evil.headers.get('access-control-allow-origin')}`);
  const okO = await req('GET', '/api/health', { headers: { Origin: 'https://gravity.nebulaa.ai' } });
  rec('headers', 'our own site origin is allowed', okO.headers.get('access-control-allow-origin') === 'https://gravity.nebulaa.ai');
  const h = await req('GET', '/api/health');
  rec('headers', 'security headers present (nosniff, frame, HSTS) and no X-Powered-By', h.headers.get('x-content-type-options') === 'nosniff' && !!h.headers.get('x-frame-options') && !!h.headers.get('strict-transport-security') && !h.headers.get('x-powered-by'), `nosniff=${h.headers.get('x-content-type-options')} frame=${h.headers.get('x-frame-options')} hsts=${!!h.headers.get('strict-transport-security')} powered=${h.headers.get('x-powered-by')}`);
  for (const p of ['/generated-media/../../.env', '/generated-media/..%2f..%2fserver.js', '/audio/..%2f..%2f.env', '/%2e%2e/%2e%2e/etc/passwd', '/generated-media/%2e%2e/%2e%2e/package.json']) {
    const r = await req('GET', p); rec('files', `path traversal ${p} blocked`, !/JWT_SECRET|"name":|require\(|root:/.test(r.text), `status ${r.status}`);
  }
  const hd = await req('GET', '/api/health/details'); rec('headers', 'health details lists no secret names or env values', !/JWT_SECRET|MONGODB_URI|NODE_ENV/.test(hd.text));
  const demo = await req('GET', '/api/auth/me', { token: 'demo:attacker@evil.test' }); rec('tokens', 'demo-mode token refused in production', demo.status === 401, `status ${demo.status}`);

  cur = newIp();
  // ---- 11. Signup abuse
  for (const [n, e] of [['disposable email', 'x@mailinator.com'], ['gmail alias of an existing account', 'a.a+1@attack.test']]) { /* alias test below uses gmail */ }
  const disp = await req('POST', '/api/auth/signup', { body: { email: 'x@mailinator.com', password: 'Passw0rd!x', firstName: 'X' } });
  rec('signup', 'disposable email refused', disp.status === 400, `status ${disp.status}`);
  await req('POST', '/api/auth/signup', { body: { email: 'a.b.c@gmail.com', password: 'Passw0rd!x', firstName: 'G' } });
  const al = await req('POST', '/api/auth/signup', { body: { email: 'abc+2@gmail.com', password: 'Passw0rd!x', firstName: 'G' } });
  rec('signup', 'same Gmail mailbox written another way refused', al.status === 400, `status ${al.status}`);

  cur = newIp();
  // ---- 12. OTP guessing on reset (account C)
  const C = await mk('c@attack.test');
  const otpSvc = require(path.join(BACK, 'services/otpService'));
  const hashed = await otpSvc.hashOTP('123456');
  await User.updateOne({ _id: C._id }, { $set: { otp: { code: hashed, expiresAt: new Date(Date.now() + 600000), attempts: 0, lastSentAt: new Date() } } });
  let okWrong = 0; for (const guess of ['000001', '000002', '000003', '000004', '000005']) { const r = await req('POST', '/api/auth/reset-password', { body: { email: 'c@attack.test', otp: guess, newPassword: 'Newpass123' } }); if (r.status === 200) okWrong += 1; }
  const right = await req('POST', '/api/auth/reset-password', { body: { email: 'c@attack.test', otp: '123456', newPassword: 'Newpass123' } });
  rec('brute-force', 'five wrong reset codes kill the code (even the right one is then refused)', okWrong === 0 && right.status === 429, `right code after 5 wrong: status ${right.status}`);

  // ---- 13. Credit race (database level through the same function the server uses)
  const { deductCredits, CREDIT_COSTS } = require(path.join(BACK, 'middleware/trialGuard'));
  const action = Object.keys(CREDIT_COSTS).find((k) => CREDIT_COSTS[k] > 0 && CREDIT_COSTS[k] <= 500);
  await User.updateOne({ _id: B._id }, { $set: { 'credits.balance': CREDIT_COSTS[action] } });
  const rs = await Promise.all(Array.from({ length: 40 }, () => deductCredits(String(B._id), action, 1, 'race')));
  const B2 = await User.findById(B._id).lean();
  rec('money', '40 parallel spends on a balance for one: exactly one succeeds, balance never negative', rs.filter((x) => x.success).length === 1 && B2.credits.balance === 0, `succeeded ${rs.filter((x) => x.success).length}, balance ${B2.credits.balance}`);

  console.log('\nSUMMARY', results.filter((r) => r.pass).length, 'passed,', results.filter((r) => !r.pass).length, 'failed');
  fs.writeFileSync('/tmp/claude-501/attack/results.json', JSON.stringify(results, null, 2));
  await mongoose.disconnect();
})().catch((e) => { console.error('RUNNER ERROR', e); process.exit(1); });
