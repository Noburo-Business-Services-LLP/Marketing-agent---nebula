const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

// Fakes only: the real router runs, but its network is a fake fetch. No real AI service is called.
function stub(rel, exports) {
  const id = require.resolve(path.join('..', rel));
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
const user = { _id: 'u1', businessProfile: { name: 'Acme', industry: 'Bakery' } };
const chain = (v) => ({ lean: async () => v, then: (r) => r(v) });
stub('models/User', { findById: () => chain(user) });
stub('middleware/auth', { protect: (q, s, n) => n() });
stub('middleware/requireFeature', { requireFeature: () => (q, s, n) => n() });
const noop = new Proxy({}, { get: () => async () => ({}) });
for (const m of ['services/geminiAI', 'models/Campaign', 'models/Competitor', 'models/Influencer', 'models/CachedCampaign', 'models/OnboardingContext', 'models/DashboardCache', 'models/SocialInboxConversation', 'middleware/trialGuard', 'middleware/creditGuard']) {
  stub(m, m === 'middleware/trialGuard' ? { deductCredits: async () => {}, CREDIT_COSTS: {} } : noop);
}
stub('services/socialInboxService', new Proxy({}, { get: () => () => {} }));
stub('services/instagram-fix', { publishSocialPostWithSafetyWrapper: async () => ({}), getInstagramAccountHealthReport: async () => ({}) });
stub('utils/socialPostValidation', new Proxy({}, { get: () => () => ({}) }));
stub('services/socialMediaAPI', new Proxy({}, { get: () => async () => ({ success: false }) }));
stub('services/ayrshareGuard', { requireOwnProfileKey: () => 'k' });

const router = require('../services/llmRouter');
const dashboard = require('../routes/dashboard');

const GONE = { error: { code: 404, message: 'This model models/gemini-2.5-flash-lite is no longer available to new users.' } };
function fakeFetch({ geminiStatus, geminiBody, openai }) {
  const calls = [];
  const f = async (url) => {
    calls.push(String(url));
    if (/openai/.test(url)) { const [status, body] = openai; return { ok: status < 300, status, json: async () => body }; }
    return { ok: geminiStatus < 300, status: geminiStatus, json: async () => geminiBody };
  };
  f.calls = calls;
  return f;
}
const OPENAI_OK = [200, { choices: [{ message: { content: '```html\n<div>plan</div>\n```' } }] }];

function find(r, p, method) {
  const l = r.stack.find((x) => x.route && x.route.path === p && x.route.methods[method]);
  assert.ok(l, p);
  return l.route.stack[l.route.stack.length - 1].handle;
}
async function call(handler) {
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  const e = console.error, l = console.log, w = console.warn;
  console.error = () => {}; console.log = () => {}; console.warn = () => {};
  try { await handler({ user: { _id: 'u1', id: 'u1' }, params: {}, query: {}, body: {} }, res); } finally { console.error = e; console.log = l; console.warn = w; }
  return res;
}

test.beforeEach(() => {
  process.env.GEMINI_TEXT_MODELS = 'only-model';
  process.env.OPENAI_API_KEY = 'test-key-not-real';
});
test.afterEach(() => { delete process.env.OPENAI_API_KEY; delete process.env.GEMINI_TEXT_MODELS; });

test('content strategy returns html from the fallback when Gemini has no usable model', async () => {
  const f = fakeFetch({ geminiStatus: 404, geminiBody: GONE, openai: OPENAI_OK });
  router._setTestHooks({ fetch: f });
  const res = await call(find(dashboard, '/content-strategy', 'get'));
  assert.strictEqual(res.code, 200);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(res.body.html, '<div>plan</div>');
});

test('content strategy still uses Gemini first when it works', async () => {
  const f = fakeFetch({ geminiStatus: 200, geminiBody: { candidates: [{ content: { parts: [{ text: '<p>g</p>' }] } }] }, openai: OPENAI_OK });
  router._setTestHooks({ fetch: f });
  const res = await call(find(dashboard, '/content-strategy', 'get'));
  assert.strictEqual(res.body.html, '<p>g</p>');
  assert.ok(!f.calls.some((u) => /openai/.test(u)));
});

test('content strategy gives the friendly error only when every provider fails', async () => {
  const f = fakeFetch({ geminiStatus: 404, geminiBody: GONE, openai: [500, { error: { message: 'openai down' } }] });
  router._setTestHooks({ fetch: f });
  const res = await call(find(dashboard, '/content-strategy', 'get'));
  assert.strictEqual(res.code, 500);
  assert.strictEqual(res.body.success, false);
  assert.strictEqual(res.body.error, 'This feature is temporarily unavailable. Please try again later.');
  assert.doesNotMatch(JSON.stringify(res.body), /gemini|openai|google|model/i);
});
