/**
 * Signs in as the demo brand account through the REAL login route and reads three screens' data, against the
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
  } finally {
    await new Promise((r) => server.close(r));
    await mongoose.disconnect();
  }
  process.exit(ok ? 0 : 1);
})().catch((e) => { say('FAILED:', e.message); process.exit(1); });
