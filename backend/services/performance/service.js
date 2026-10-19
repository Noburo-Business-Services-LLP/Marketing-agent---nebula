'use strict';
// Reads for GET /api/analytics/performance. Reads only: no write, no model call, no outside call, nothing charged.
// Every query is narrowed by the signed-in account's id (an existing index leads with it), bounded by a limit and by a
// time limit. A source that fails is named in `degraded` and its figures say so; the rest still loads.
const { canUse, resolveTier } = require('../../config/entitlements');
const { connectedCount } = require('../staff/clientStatus');
const { buildPerformanceView } = require('./view');
const M = require('./metrics');

const MAX_TIME_MS = 15000;
const SNAPSHOT_LIMIT = 200;   // 90 days plus the 90 before: at most 181 daily rows
const MEASURED_LIMIT = 400;   // measured posts (one row per post and platform) across both periods
const CAMPAIGN_LIMIT = 400;
const PUBLISHED_LIMIT = 1000; // posted campaigns across both periods; more than this is flagged as capped

function platformsOf(user) {
  const names = [];
  for (const s of (user && user.connectedSocials) || []) if (s && s.platform) names.push(M.normPlatform(s.platform));
  for (const p of (user && user.ayrshare && user.ayrshare.activeSocialAccounts) || []) if (p) names.push(M.normPlatform(p));
  return [...new Set(names.filter(Boolean))].slice(0, 10);
}

function defaultDeps() {
  const m = (name) => require(`../../models/${name}`);
  return {
    now: () => new Date(),
    snapshots: (userId, since) => m('SocialSnapshot').find({ userId, date: { $gte: since } })
      .sort({ date: 1 }).limit(SNAPSHOT_LIMIT).select('date platforms').maxTimeMS(MAX_TIME_MS).lean(),
    measured: (userId, since) => m('AIContentPerformance').find({ userId, publishedAt: { $gte: since } })
      .sort({ publishedAt: -1 }).limit(MEASURED_LIMIT)
      .select('campaignId platform postId contentType caption assets.thumbnails assets.images metrics rawAnalytics publishedAt measuredAt')
      .maxTimeMS(MAX_TIME_MS).lean(),
    campaigns: (userId, ids) => (ids.length ? m('Campaign').find({ userId, _id: { $in: ids } })
      .limit(CAMPAIGN_LIMIT).select('name platforms creative.type creative.imageUrls creative.videoUrl creative.captions creative.textContent publishedAt publishResult.postIds publishResult.postUrl')
      .maxTimeMS(MAX_TIME_MS).lean() : []),
    published: (userId, since, until) => m('Campaign').find({ userId, status: 'posted', publishedAt: { $gte: since, $lte: until } })
      .limit(PUBLISHED_LIMIT + 1).select('platforms publishedAt').maxTimeMS(MAX_TIME_MS).lean()
  };
}

function createPerformanceService(given = {}) {
  const deps = { ...defaultDeps(), ...given };

  async function build({ user, range, platform }) {
    const now = deps.now();
    const w = M.rangeWindow(M.rangeKey(range), now);
    const userId = user._id;
    const degraded = [];
    const safe = async (name, fn, fallback) => {
      try { return await fn(); } catch (e) {
        if (!degraded.includes(name)) degraded.push(name);
        console.error(`[performance] ${name} could not be read:`, e && e.message);
        return fallback;
      }
    };
    const connected = platformsOf(user);
    const count = connectedCount(user);
    const staff = Boolean(user && (user.staffRole || user.isCsm));
    const account = {
      free: resolveTier(user) === 'free',
      canConnect: canUse(user, 'social_connect').allowed,
      clientWorkspace: Boolean(user && user.agency && user.agency.ownerId),
      staff
    };
    // A day of slack before the previous period so its first daily number is found.
    const since = new Date(w.previousFrom.getTime() - M.DAY_MS);
    const [snapshots, rows, published] = await Promise.all([
      count > 0 ? safe('snapshots', () => deps.snapshots(userId, since), []) : [],
      safe('measured', () => deps.measured(userId, w.previousFrom), []),
      safe('posts', () => deps.published(userId, w.previousFrom, w.to), [])
    ]);
    const ids = [...new Set((rows || []).map((r) => r.campaignId).filter(Boolean).map(String))].slice(0, CAMPAIGN_LIMIT);
    const camps = await safe('measured', () => deps.campaigns(userId, ids), []);
    const campaigns = new Map((camps || []).map((c) => [String(c._id), c]));
    const publishedCapped = (published || []).length > PUBLISHED_LIMIT;
    return buildPerformanceView({
      now, range: w.key, platform, account, connected, connectedCount: count,
      snapshots: snapshots || [], rows: rows || [], campaigns, published: (published || []).slice(0, PUBLISHED_LIMIT),
      publishedCapped, rowsCapped: (rows || []).length >= MEASURED_LIMIT, degraded
    });
  }
  return { build };
}

module.exports = { createPerformanceService, platformsOf, MAX_TIME_MS, SNAPSHOT_LIMIT, MEASURED_LIMIT, CAMPAIGN_LIMIT, PUBLISHED_LIMIT };
