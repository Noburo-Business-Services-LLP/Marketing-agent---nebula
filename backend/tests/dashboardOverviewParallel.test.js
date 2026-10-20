// GET /api/dashboard/overview (the classic dashboard), load-test weeks 2 to 3: the influencer count, the AI insights and
// the connected social accounts are read at the same time, and the campaign totals read only small fields. Fakes only:
// every model method and provider function used here is replaced before the route loads; no database, no provider.
const test = require('node:test');
const assert = require('node:assert');

const gemini = require('../services/geminiAI');
const social = require('../services/socialMediaAPI');
const events = [];
const slow = (name, value, ms = 40) => async () => { events.push(`start ${name}`); await new Promise((r) => setTimeout(r, ms)); events.push(`end ${name}`); return value; };
gemini.generateDashboardInsights = (...a) => slow('insights', { suggestedActions: [], trendingTopics: [], personalizedTips: [], brandScoreFactors: {} })(...a);
social.getAyrshareUserProfile = (...a) => slow('ayrshare', { success: true, data: { activeSocialAccounts: ['instagram'], displayNames: [{ platform: 'instagram', username: 'sweetco' }] } })(...a);

const User = require('../models/User');
const Campaign = require('../models/Campaign');
const Competitor = require('../models/Competitor');
const Influencer = require('../models/Influencer');
const DashboardCache = require('../models/DashboardCache');

const selects = [];
const chain = (rows) => {
  const q = {
    sort() { return q; }, limit(n) { q._limit = n; return q; }, select(s) { selects.push({ s, limit: q._limit }); q._sel = s; return q; },
    lean: async () => (q._limit ? rows.slice(0, q._limit) : rows)
  };
  return q;
};
const campaigns = Array.from({ length: 12 }, (_, i) => ({ _id: `c${i}`, name: `Post ${i}`, status: i % 2 ? 'posted' : 'draft', budget: { spent: 1 }, performance: { impressions: 10, clicks: 1, engagement: 2 }, createdAt: new Date(Date.now() - i * 1000), creative: { imageUrls: ['x'] } }));
User.findById = () => ({ lean: async () => ({ _id: 'u1', businessProfile: { name: 'Sweet Co' }, ayrshare: { profileKey: 'K' }, plan: { tier: 'starter' } }) });
Campaign.find = () => chain(campaigns);
Competitor.find = () => chain([]);
Influencer.countDocuments = (...a) => slow('influencers', 3)(...a);
DashboardCache.getCached = async () => null;
DashboardCache.setCached = async () => {};

const router = require('../routes/dashboard');
const handler = (() => {
  const layer = router.stack.find((l) => l.route && l.route.path === '/overview' && l.route.methods.get);
  return layer.route.stack[layer.route.stack.length - 1].handle;
})();

test('the influencer count, the AI insights and the social accounts start before any of them ends', async () => {
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  const quiet = console.log; console.log = () => {};
  try { await handler({ user: { id: 'u1' }, query: {} }, res); } finally { console.log = quiet; }
  assert.strictEqual(res.code, 200, JSON.stringify(res.body).slice(0, 300));
  const firstEnd = events.findIndex((e) => e.startsWith('end'));
  const starts = events.slice(0, firstEnd).filter((e) => e.startsWith('start')).sort();
  assert.deepStrictEqual(starts, ['start ayrshare', 'start influencers', 'start insights']);
  // The answer is the same shape as before.
  const d = res.body.data || res.body;
  assert.ok(JSON.stringify(d).includes('sweetco'), 'the connected Instagram account is in the answer');
  assert.ok(JSON.stringify(d).includes('"influencerCount":3'));
  // Totals read small fields of every campaign; the cards read the newest 10 with their card fields.
  const all = selects.find((x) => !x.limit);
  const recent = selects.find((x) => x.limit === 10);
  assert.ok(all && !/creative/.test(all.s) && /budget\.spent/.test(all.s), JSON.stringify(selects));
  assert.ok(recent && /creative/.test(recent.s));
  assert.ok(!JSON.stringify(d).includes('publishResult'));
});
