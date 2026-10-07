const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

// Fakes only: models, auth, LLM and Ayrshare clients are replaced before the routes load.
function stub(rel, exports) {
  const id = require.resolve(path.join('..', rel));
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
const QUOTA = 'LLM gemini failed: You exceeded your current quota, please check your plan and billing details. Quota exceeded for metric: generativelanguage.googleapis.com model: gemini-2.5-pro';
const BIZ = 'The Business Plan is required to access this endpoint. https://www.ayrshare.com/business-plan-for-multiple-users/';
const BANNED = /gemini|google|ayrshare|https?:|quota|business plan|billing/i;

const user = { _id: { toString: () => 'abcdefgh12345678' }, email: 'a@b.c', firstName: 'A', ayrshare: {}, save: async () => {}, businessProfile: {} };
const chain = (v) => ({ lean: async () => v, then: (r) => r(v) });
stub('models/User', { findById: () => chain(user) });
stub('middleware/auth', { protect: (q, s, n) => n() });
stub('middleware/requireFeature', { requireFeature: () => (q, s, n) => n() });
stub('models/SocialInboxConversation', {});
stub('services/instagram-fix', { publishSocialPostWithSafetyWrapper: async () => ({}), getInstagramAccountHealthReport: async () => ({}) });
stub('services/socialInboxService', new Proxy({}, { get: () => () => {} }));
stub('utils/socialPostValidation', new Proxy({}, { get: () => () => ({}) }));
stub('services/llmRouter', { generateWithLLM: async () => { throw new Error(QUOTA); } });
let ayrshare = { createAyrshareProfile: async () => ({ success: false, error: BIZ, code: 169 }), generateAyrshareJWT: async () => ({ success: true, url: 'x' }), getAyrshareUserProfile: async () => ({ success: false, error: BIZ }) };
stub('services/socialMediaAPI', new Proxy({}, { get: (_, k) => ayrshare[k] || (async () => ({ success: false })) }));
stub('services/ayrshareGuard', { requireOwnProfileKey: () => 'k' });

const noop = new Proxy({}, { get: () => async () => ({}) });
for (const m of ['services/geminiAI', 'models/Campaign', 'models/Competitor', 'models/Influencer', 'models/CachedCampaign', 'models/OnboardingContext', 'models/DashboardCache', 'middleware/trialGuard', 'middleware/creditGuard']) {
  stub(m, m === 'middleware/trialGuard' ? { deductCredits: async () => {}, CREDIT_COSTS: {} } : noop);
}
const social = require('../routes/social');
const accounts = require('../routes/accounts');

// Only string values matter to customers; key names are not shown.
const strings = (v) => (typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : []);
const shown = (body) => strings(body).join(' | ');

function find(router, p, method) {
  const l = router.stack.find((x) => x.route && x.route.path === p && x.route.methods[method]);
  assert.ok(l, p);
  return l.route.stack[l.route.stack.length - 1].handle;
}
async function call(handler, req = {}) {
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  const e = console.error, l = console.log, w = console.warn;
  console.error = () => {}; console.log = () => {}; console.warn = () => {};
  try { await handler({ user: { _id: 'u1', id: 'u1' }, params: {}, query: {}, body: {}, ...req }, res); } finally { console.error = e; console.log = l; console.warn = w; }
  return res;
}

test('platform auth: profile creation failure keeps 500 and shape but hides vendor text', async () => {
  user.ayrshare = {};
  const res = await call(find(social, '/:platform/auth', 'get'), { params: { platform: 'instagram' } });
  assert.strictEqual(res.code, 500);
  assert.strictEqual(res.body.success, false);
  assert.ok(res.body.message && res.body.error);
  assert.doesNotMatch(shown(res.body), BANNED);
});

test('socials status: provider failure is not returned raw', async () => {
  user.ayrshare = { profileKey: 'realkey1234' };
  user.connectedSocials = [];
  const res = await call(find(social, '/status', 'get'));
  assert.strictEqual(res.code, 200);
  assert.strictEqual(res.body.success, true);
  // "Google Business" is a platform name customers should see; what must never appear is provider error text.
  assert.doesNotMatch(shown(res.body).replace(/Google Business/g, ''), BANNED);
});

test('account health hides a stored provider error', async () => {
  user.ayrshare = { profileKey: 'k', lastError: BIZ };
  user.connectedSocials = [];
  const res = await call(find(accounts, '/health', 'get'));
  assert.doesNotMatch(shown(res.body), BANNED);
});

test('content strategy: quota error becomes a plain sentence, status stays 500', async () => {
  const dashboard = require('../routes/dashboard');
  const res = await call(find(dashboard, '/content-strategy', 'get'));
  assert.strictEqual(res.code, 500);
  assert.strictEqual(res.body.success, false);
  assert.strictEqual(res.body.error, 'This feature is temporarily unavailable. Please try again later.');
});
