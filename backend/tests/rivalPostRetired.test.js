const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const MESSAGE = "This feature has been replaced. Use What's working for your competitors on the Competitors page when it is available.";
const ROOT = path.join(__dirname, '..');

function loadRouter() {
  // The route file pulls in models and services that may open handles; none connect until used.
  return require('../routes/dashboard');
}
const mkRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
function retiredRoute() {
  const r = loadRouter().stack.find((l) => l.route && l.route.path === '/generate-rival-post');
  return r && r.route;
}

test('the old rival post route stays mounted and answers with the plain retired message', async () => {
  const route = retiredRoute();
  assert.ok(route, 'route is still mounted for old clients');
  assert.ok(route.methods.post);
  const handler = route.stack[route.stack.length - 1].handle;
  for (const plan of [{ tier: 'growth', addons: ['competitors'] }, { tier: 'free', addons: [] }]) {
    const res = mkRes();
    await handler({ user: { userId: 'u1', plan }, body: { competitorContent: 'hello', competitorName: 'X', platform: 'instagram' } }, res);
    assert.strictEqual(res.code, 410);
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(res.body.message, MESSAGE);
  }
});

test('the retired route charges nothing and calls no model', () => {
  const src = fs.readFileSync(path.join(ROOT, 'routes/dashboard.js'), 'utf8');
  const start = src.indexOf("'/generate-rival-post'");
  assert.ok(start > 0);
  const block = src.slice(start, src.indexOf('\n});', start));
  assert.ok(!/deductCredits|generateRivalPost|ensureCreditCycle|walletBalance|User\.find|geminiAI|openAI/.test(block), 'handler touches no credits, user store or model');
  assert.ok(!/generateRivalPost/.test(src), 'dashboard route file no longer imports the generator');
  const gemini = require('../services/geminiAI');
  assert.strictEqual(gemini.generateRivalPost, undefined);
});

test('the retired message follows the voice rules', () => {
  assert.ok(!/[!—–]/.test(MESSAGE));
});

const offends = (t) => /savage/i.test(t) || /\bDESTROYS?\b/.test(t) || /destroys? the competition/i.test(t);

test('no savage or destroy prompt text remains in backend services or routes', () => {
  const hits = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.js$/.test(e.name) && offends(fs.readFileSync(p, 'utf8'))) hits.push(path.relative(ROOT, p));
    }
  })(path.join(ROOT, 'services'));
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.js$/.test(e.name) && offends(fs.readFileSync(p, 'utf8'))) hits.push(path.relative(ROOT, p));
    }
  })(path.join(ROOT, 'routes'));
  assert.deepStrictEqual(hits, []);
});
