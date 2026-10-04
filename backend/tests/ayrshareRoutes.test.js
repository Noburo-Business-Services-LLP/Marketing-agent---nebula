const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

// Fakes only: the User model and the Ayrshare client are replaced before the routes load.
const calls = [];
let currentUser = null;
function stub(rel, exports) {
  const id = require.resolve(path.join('..', rel));
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
stub('models/User', { findById: async () => currentUser });
stub('models/AnalyticsSnapshot', {});
stub('models/SocialSnapshot', {});
stub('middleware/auth', { protect: (q, s, n) => n() });
stub('services/llmRouter', {});
stub('services/aiPerformanceTracker', { trackCampaignPerformanceFromAnalytics: async () => {} });
stub('services/aiMemoryService', { resolveOrganizationId: () => 'org' });
stub('services/socialMediaAPI', {
  getPostAnalytics: async (...a) => { calls.push(['post', ...a]); return { success: true, data: { likes: 1 } }; },
  getSocialAnalyticsDetailed: async (...a) => { calls.push(['daily', ...a]); return { success: true, data: { ok: 1 } }; },
  getAyrshareUserProfile: async () => ({ success: true, data: { activeSocialAccounts: [] } }),
  getUserSocialAnalytics: async () => ({ success: true, data: {} })
});
const analytics = require('../routes/analytics');
const { requireOwnProfileKey } = require('../services/ayrshareGuard');

function handlerOf(r, p) {
  const layer = r.stack.find((l) => l.route && l.route.path === p && l.route.methods.post);
  assert.ok(layer, p);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}
async function hit(p, body) {
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  const q = console.error; console.error = () => {}; console.log = () => {};
  try { await handlerOf(analytics, p)({ user: { id: 'u1' }, body }, res); } finally { console.error = q; }
  return res;
}
const log = console.log;
test.after(() => { console.log = log; });

const NO_KEY = ['free', 'starter', 'professional'];

test('analytics routes: a free, starter or professional account without its own key gets 403 and the master profile is never called', async () => {
  for (const tier of NO_KEY) {
    for (const [p, body] of [['/post-analytics', { postId: 'p1' }], ['/daily-analytics', { platforms: ['instagram'] }]]) {
      calls.length = 0;
      currentUser = { plan: { tier }, ayrshare: {} };
      const res = await hit(p, body);
      assert.strictEqual(res.code, 403, `${tier} ${p}`);
      assert.strictEqual(res.body.success, false);
      assert.match(res.body.message, /connect your own social profile/i);
      assert.strictEqual(calls.length, 0, `${tier} ${p} reached Ayrshare`);
    }
  }
});

test('analytics routes: a paid account with its own key passes with that key; managed passes on the master profile as before', async () => {
  calls.length = 0;
  currentUser = { plan: { tier: 'starter' }, ayrshare: { profileKey: 'KEY_1' } };
  assert.strictEqual((await hit('/post-analytics', { postId: 'p1' })).code, 200);
  assert.strictEqual(calls[0][3], 'KEY_1');
  calls.length = 0;
  currentUser = { ayrshare: {} }; // managed: no plan.tier, no key
  assert.strictEqual((await hit('/post-analytics', { postId: 'p1' })).code, 200);
  assert.strictEqual(calls[0][3], null);
  assert.strictEqual((await hit('/daily-analytics', { platforms: ['instagram'] })).code, 200);
  assert.strictEqual(calls[1][1], null);
});

test('guard: no-key tiers throw 403, managed gets null, own key is returned', () => {
  for (const tier of NO_KEY) {
    assert.throws(() => requireOwnProfileKey({ plan: { tier } }), (e) => e.status === 403 && e.code === 'NO_PROFILE_KEY');
  }
  assert.strictEqual(requireOwnProfileKey({}), null);
  assert.strictEqual(requireOwnProfileKey({ plan: { tier: 'professional' }, ayrshare: { profileKey: 'K' } }), 'K');
});

test('every route that calls Ayrshare with a per-user key goes through the guard or returns early without one', () => {
  const fs = require('fs');
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  assert.match(read('routes/social.js'), /requireOwnProfileKey\(req\.user\)/);
  const camp = read('routes/campaigns.js');
  assert.ok((camp.match(/requireOwnProfileKey\(user\)/g) || []).length >= 2);
  assert.match(read('routes/analytics.js'), /return requireOwnProfileKey\(user\)/);
  assert.match(read('routes/ads.js'), /requireOwnProfileKey\(user\)/);
});
