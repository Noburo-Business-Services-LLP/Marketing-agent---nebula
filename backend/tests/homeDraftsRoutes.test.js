// Home drafts: the routes, the cost actions, the staff switch and the rule that nothing here ever posts anywhere.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { createHomeDraftsRouter } = require('../routes/homeDrafts');
const costs = require('../config/apiCosts');
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const routesOf = (r) => r.stack.filter((l) => l.route).map((l) => ({ path: l.route.path, method: Object.keys(l.route.methods)[0], handlers: l.route.stack.map((s) => s.handle) }));
const mkRes = () => ({ code: 200, body: null, headers: {}, set(k, v) { this.headers[k] = v; return this; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });

test('three routes behind sign-in and a rate limit, mounted under /api/home', () => {
  const list = routesOf(createHomeDraftsRouter({ service: {} }));
  assert.deepStrictEqual(list.map((r) => `${r.method} ${r.path}`), ['get /drafts/options', 'post /response-post', 'post /witty-comment']);
  for (const r of list) { assert.strictEqual(r.handlers[0], require('../middleware/auth').protect); assert.strictEqual(r.handlers.length, 3); }
  assert.match(read('server-main.js'), /app\.use\('\/api\/home', require\('\.\/routes\/homeDrafts'\)\);/);
});

test('each POST passes its own kind, the body and whether this is a CSM or agency pass', async () => {
  const seen = [];
  const service = { make: async (user, kind, body, opts) => { seen.push({ kind, body, opts }); return { status: 200, body: { success: true } }; }, options: async () => ({ enabled: false }) };
  const list = routesOf(createHomeDraftsRouter({ service }));
  for (const r of list.filter((x) => x.method === 'post')) {
    const res = mkRes();
    await r.handlers[2]({ user: { _id: 'u' }, body: { ref: 'x', key: 'y' }, actingAgency: { _id: 'a' } }, res);
    assert.strictEqual(res.code, 200); assert.strictEqual(res.headers['Cache-Control'], 'private, no-store');
  }
  assert.deepStrictEqual(seen.map((s) => s.kind), ['response_post', 'witty_comment']);
  assert.ok(seen.every((s) => s.opts.pass === true));
});

test('a service error is a plain 500 without the error text', async () => {
  const service = { make: async () => { throw new Error('secret db detail'); }, options: async () => { throw new Error('secret'); } };
  const list = routesOf(createHomeDraftsRouter({ service }));
  const e = console.error; console.error = () => {};
  try {
    for (const r of list) {
      const res = mkRes();
      await r.handlers[2]({ user: { _id: 'u' }, body: {} }, res);
      assert.strictEqual(res.code, 500); assert.ok(!JSON.stringify(res.body).includes('secret'));
    }
  } finally { console.error = e; }
});

test('cost actions are derived from provider rates in config/apiCosts.js, never typed', () => {
  for (const a of ['home_response_post', 'home_witty_comment']) {
    assert.ok(Number.isFinite(costs.ACTION_USD[a]) && costs.ACTION_USD[a] > 0, a);
    assert.strictEqual(costs.QUARK_COSTS[a], Math.max(1, Math.round((costs.ACTION_USD[a] * costs.marginFor(a)) / costs.USD_PER_QUARK)), a);
    assert.strictEqual(costs.ACTION_UNITS[a], 'per draft');
  }
  const r = costs.PROVIDER_RATES; const t = costs.TOKENS;
  const one = (shape) => ((shape.in * r.gpt4o_input_per_mtok + shape.out * r.gpt4o_output_per_mtok) / 1e6) + ((t.decency_check.in * r.regional_input_per_mtok + t.decency_check.out * r.regional_output_per_mtok) / 1e6);
  assert.ok(Math.abs(costs.ACTION_USD.home_response_post - one(t.home_response_post) * (1 + costs.HOME_DRAFT_REWRITE_RATE)) < 1e-12);
  assert.ok(Math.abs(costs.ACTION_USD.home_witty_comment - one(t.home_witty_comment) * (1 + costs.HOME_DRAFT_REWRITE_RATE)) < 1e-12);
  const src = read('config/apiCosts.js');
  assert.ok(!/QUARK_COSTS\.home_\w+\s*=/.test(src), 'no Quark price typed by hand');
  assert.ok(costs.QUARK_COSTS.home_response_post >= costs.QUARK_COSTS.home_witty_comment);
});

test('the spend guard knows both actions under their own staff switch, and the staff usage view places them', () => {
  const g = require('../services/spendGuard');
  assert.strictEqual(g.providerOf('home_response_post'), 'home_drafts');
  assert.strictEqual(g.providerOf('home_witty_comment'), 'home_drafts');
  assert.ok(g.PROVIDERS.includes('home_drafts'));
  assert.strictEqual(g.LABELS.home_drafts, 'Competitor post drafts');
  const { categoryOf } = require('../services/staff/usage');
  assert.strictEqual(categoryOf('home_response_post', true), 'captions');
  assert.strictEqual(categoryOf('home_witty_comment', true), 'captions');
});

test('the switch is off by default and documented in one place', () => {
  const caps = require('../config/homeDrafts');
  assert.strictEqual(caps.SWITCH_ENV, 'ENABLE_COMPETITOR_DRAFTS');
  assert.strictEqual(caps.MAX_ATTEMPTS, 2);
  assert.strictEqual(caps.COMMENT_MAX, 220); assert.strictEqual(caps.CAPTION_MAX, 600);
  assert.strictEqual(caps.MAX_DRAFTS_PER_DAY, 20);
});

// The owner's rule: Nebulaa never posts on anyone's page from here. These files may not call any publishing, commenting,
// social or outside service: model calls go through services/openAI.js only.
const DRAFT_FILES = ['routes/homeDrafts.js', 'services/homeDrafts/service.js', 'services/homeDrafts/decency.js', 'services/homeDrafts/prompt.js', 'services/homeDrafts/parse.js', 'config/homeDrafts.js', 'config/decency.js', 'models/HomeDraft.js'];
const FORBIDDEN = [
  /ayrshare/i, /socialMedia/i, /socialInbox/i, /publish/i, /postComment|replyToComment|sendComment|createComment/i, /\/comments\b/, /graph\.facebook/i,
  /graph\.instagram/i, /\bfetch\s*\(/, /axios/, /\bhttps?\.request\b/, /require\(['"](?:https?|net|tls|child_process)['"]\)/, /apify/i, /scrape/i,
  /require\(['"][^'"]*(?:social|ayrshare|publish|inbox|autoReply|campaign|drafts?\/save)[^'"]*['"]\)/i
];

test('no code path in the drafts feature posts, comments, publishes or calls an outside service', () => {
  const hits = [];
  for (const f of DRAFT_FILES) {
    const src = read(f).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    for (const re of FORBIDDEN) if (re.test(src)) hits.push(`${f}: ${re}`);
  }
  assert.deepStrictEqual(hits, []);
  // The only model calls are the two pinned ones.
  const svc = read('services/homeDrafts/service.js');
  assert.deepStrictEqual([...svc.matchAll(/callTextLLM\(/g)].length, 2);
});

test('the retired rival post route stays retired and the drafts never reuse it', () => {
  const src = read('routes/dashboard.js');
  const start = src.indexOf("'/generate-rival-post'");
  const block = src.slice(start, src.indexOf('\n});', start));
  assert.ok(/410/.test(block));
  for (const f of DRAFT_FILES) assert.ok(!/rival_post|generate-rival-post|generateRivalPost/.test(read(f)), f);
});

test('the request ledger is on the data list (erased with the account)', () => {
  const { ruleFor } = require('../services/dataRegistry');
  assert.deepStrictEqual({ field: ruleFor('HomeDraft').field, action: ruleFor('HomeDraft').action }, { field: 'userId', action: 'delete' });
  const M = require('../models/HomeDraft');
  const idx = M.schema.indexes().map(([k, o]) => ({ k, o }));
  assert.ok(idx.some((i) => i.k.userId === 1 && i.k.key === 1 && i.o.unique), 'one row per key');
  assert.ok(idx.some((i) => i.o.unique && i.o.partialFilterExpression && i.o.partialFilterExpression.inFlight === true), 'one request in flight per account');
});
