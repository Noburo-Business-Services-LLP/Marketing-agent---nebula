const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const seed = require('../scripts/seed-demo-agency');

const URI = 'mongodb+srv://someone:Sup3rSecretPw@cluster.example.net/nebulaa_dev';
const ENV = { MONGODB_URI: URI, JWT_SECRET: 'jwt-secret-value-123' };

function fakes(over = {}) {
  const calls = [];
  const deps = {
    connect: async () => { calls.push('connect'); return { dbName: 'nebulaa_dev' }; },
    disconnect: async () => { calls.push('disconnect'); },
    create: async (a) => { calls.push('create'); return { existed: false, clients: ['Demo Bakery', 'Demo Salon'], drafts: 4, password: a.password }; },
    remove: async () => { calls.push('remove'); return { removed: { users: 3, drafts: 4 }, left: 0 }; },
    verify: async () => ({ ok: true, lines: ['owner found', '2 clients', '4 drafts'] }),
    writeFile: (p, text) => { calls.push(['file', p, text]); },
    ...over,
  };
  return { deps, calls };
}
const run = async (argv, env = ENV, over = {}) => {
  const out = [];
  const { deps, calls } = fakes(over);
  let error = null;
  try { await seed.main({ argv, env, deps, log: (s) => out.push(String(s)) }); } catch (e) { error = e; }
  return { out: out.join('\n'), calls, error };
};

test('the guard accepts only the database named nebulaa_dev, exactly', () => {
  assert.doesNotThrow(() => seed.assertDevTarget(URI, 'nebulaa_dev'));
  for (const bad of ['nebulaa', 'nebulaa_prod', 'nebulaa_dev2', 'Nebulaa_Dev', 'nebulaa_dev ', 'test', '', undefined]) {
    assert.throws(() => seed.assertDevTarget(URI, bad), /nebulaa_dev/, String(bad));
  }
});

test('the guard refuses a missing connection address', () => {
  for (const missing of [undefined, '', '   ', null]) assert.throws(() => seed.assertDevTarget(missing, 'nebulaa_dev'), /MONGODB_URI/);
});

test('a missing address stops before anything is connected', async () => {
  const r = await run(['create'], {});
  assert.ok(r.error && /MONGODB_URI/.test(r.error.message));
  assert.deepStrictEqual(r.calls, []);
});

test('a database other than nebulaa_dev stops before anything is written, and the message never shows the address', async () => {
  const r = await run(['create'], ENV, { connect: async () => ({ dbName: 'nebulaa_prod' }) });
  assert.ok(r.error && /nebulaa_dev/.test(r.error.message));
  assert.ok(!r.calls.includes('create') && !r.calls.includes('remove'));
  assert.ok(!r.error.message.includes('Sup3rSecretPw') && !r.error.message.includes('cluster.example.net'));
  const rm = await run(['remove'], ENV, { connect: async () => ({ dbName: 'nebulaa_prod' }) });
  assert.ok(rm.error && !rm.calls.includes('remove'));
});

test('only create and remove are modes', async () => {
  for (const m of [undefined, 'delete', 'CREATE', '']) {
    const r = await run(m === undefined ? [] : [m]);
    assert.ok(r.error && /create|remove/.test(r.error.message), String(m));
    assert.deepStrictEqual(r.calls, []);
  }
});

test('the demo email must be an example.test address starting with demo-agency', () => {
  assert.strictEqual(seed.DEFAULT_EMAIL, 'demo-agency@example.test');
  for (const ok of ['demo-agency@example.test', 'demo-agency-throwaway@example.test']) assert.strictEqual(seed.emailOk(ok), true, ok);
  for (const bad of ['hello@nebulaa.ai', 'demo-agency@gmail.com', 'other@example.test', 'demo-agency@example.test.evil.com', 'x demo-agency@example.test', '']) assert.strictEqual(seed.emailOk(bad), false, bad);
});

test('a bad email is refused before connecting', async () => {
  const r = await run(['create', '--email=hello@nebulaa.ai']);
  assert.ok(r.error && /example\.test/.test(r.error.message));
  assert.deepStrictEqual(r.calls, []);
});

test('the generated password is random, long enough, and easy to read out', () => {
  const a = seed.makePassword(); const b = seed.makePassword();
  assert.notStrictEqual(a, b);
  assert.ok(a.length >= 16);
  assert.match(a, /^[A-Za-z0-9-]+$/);
  assert.doesNotMatch(a, /[O0Il1]/, 'no look-alike characters');
});

test('the card says how to log in and what to click, with no password in it', () => {
  const card = seed.loginCard({ email: 'demo-agency@example.test' });
  assert.match(card, /http:\/\/localhost:3000/);
  assert.match(card, /5000/);
  assert.match(card, /demo-agency@example\.test/);
  assert.match(card, /Claude desktop app/);
  for (const step of ['Clients', 'Back to my clients', 'Review and approve', 'Plans', 'Agency card', 'Usage per client']) assert.ok(card.includes(step), step);
  assert.doesNotMatch(card, /password:/i);
  assert.doesNotMatch(card, /!|—|Quark|credit|trial|7 days/);
});

test('create prints the password once, writes it only to the file asked for, and never prints the address or other secrets', async () => {
  const r = await run(['create', '--password-file=/tmp/x-login.txt']);
  assert.strictEqual(r.error, null);
  const secretCount = (r.out.match(/Password: (\S+)/g) || []).length;
  assert.strictEqual(secretCount, 1);
  const pw = /Password: (\S+)/.exec(r.out)[1];
  assert.strictEqual(r.out.split(pw).length - 1, 1, 'the password appears exactly once');
  for (const secret of ['Sup3rSecretPw', 'cluster.example.net', 'jwt-secret-value-123', URI]) assert.ok(!r.out.includes(secret), 'leaked a secret');
  const file = r.calls.find((c) => Array.isArray(c) && c[0] === 'file');
  assert.ok(file && file[1] === '/tmp/x-login.txt' && file[2].includes(pw));
  assert.ok(r.calls.includes('disconnect'));
});

test('running create when the demo already exists adds nothing and prints no password', async () => {
  const r = await run(['create'], ENV, { create: async () => ({ existed: true, clients: ['Demo Bakery', 'Demo Salon'], drafts: 4 }) });
  assert.strictEqual(r.error, null);
  assert.doesNotMatch(r.out, /Password:/);
  assert.match(r.out, /already/i);
});

test('remove reports what it took away and that none are left', async () => {
  const r = await run(['remove']);
  assert.strictEqual(r.error, null);
  assert.match(r.out, /left: 0/i);
});

test('remove that leaves something behind says so and fails', async () => {
  const r = await run(['remove'], ENV, { remove: async () => ({ removed: { users: 1 }, left: 2 }) });
  assert.ok(r.error && /2/.test(r.error.message));
});

test('the sample drafts are real-looking text posts with no image to generate', () => {
  const d = seed.sampleDrafts();
  assert.ok(d.length >= 3 && d.length <= 6);
  for (const x of d) {
    assert.ok(x.title && x.caption.length > 40);
    assert.strictEqual(x.status, 'draft');
    assert.strictEqual(x.imageUrl, '');
    assert.doesNotMatch(x.caption + x.title, /!|—|Quark|credit|trial|7 days/);
  }
});

test('the script reads no secret into any output: no log line mentions the address or the environment', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'seed-demo-agency.js'), 'utf8');
  assert.match(src, /require\('dotenv'\)\.config\(\)/);
  assert.doesNotMatch(src, /(console\.(log|error|warn)|log)\([^)]*(process\.env|MONGODB_URI|JWT_SECRET)/);
  assert.doesNotMatch(src, /(console\.(log|error)|log)\([^)]*\buri\b/);
});
