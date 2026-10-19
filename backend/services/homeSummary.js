'use strict';
// GET /api/home/summary: everything the Home page needs in ONE small answer, read from data we already hold.
// Reads only (it never creates a weekly proposal, stamps a setup step, charges anything or calls an outside service).
// Every query is a count or a small projection, bounded by a limit and by a 20 s time limit. A number we cannot source
// is never invented: it comes back as { available: false, reason } with a plain sentence for the customer.
// How each number is computed and what each reason means: docs/superpowers/ops/home-summary.md
const { istWeek, istDay } = require('./weekIst');
const { nextActions } = require('./homeActions');
const { needsApprovalFilter } = require('./draftStatus');
const { canUse, resolveTier } = require('../config/entitlements');
const { setupSteps } = require('./week/setupSteps');
const { profileComplete } = require('./plan/profileInput');
const { shouldHavePlan, isStale } = require('./plan/planRules');
const { connectedCount } = require('./staff/clientStatus');
const { handleOf, isValidHandle, handleStatusOf, trackedCompetitors } = require('./competitors/tracked');
const { QUARK_COSTS, outputsFor } = require('../config/apiCosts');
const { balanceText, equivalentText } = require('../config/quarkWording');
const { LIMITS } = require('../config/blueprint');

const DAY_MS = 86400000;
const MAX_TIME_MS = 20000;
const STALE_SNAPSHOT_DAYS = 3;
const TODAY_LIMIT = 6;
const RECENT_LIMIT = 4;
const COMPETITOR_LIMIT = 25;
const PLAN_RUN_LIMIT = 5;
const MAX_URL = 600;

const FAILED_REASON = 'We could not load this just now. Please try again in a moment.';
const REASONS = {
  connectFree: 'Connecting accounts comes with a paid plan.',
  connect: 'Connect an account to see this.',
  soon: 'Your first numbers arrive within a day of connecting.',
  notReported: 'Your connected accounts have not reported this yet.',
  inbox: 'Messages are part of the Inbox add-on.'
};

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const round1 = (v) => Math.round(v * 10) / 10;
const toDate = (v) => { const d = v ? new Date(v) : null; return d && Number.isFinite(d.getTime()) ? d : null; };
const istDateOf = (d) => new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10);
const safeUrl = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) && u.length <= MAX_URL ? u : null);

/** A real percentage change, or null when there is nothing honest to compare with. */
function changePct(value, previous) {
  if (!isNum(value) || !isNum(previous) || previous <= 0) return null;
  const pct = round1(((value - previous) / previous) * 100);
  return Object.is(pct, -0) ? 0 : pct;
}

/** The newest snapshot that is at least seven days older than `latestDate` (and within fourteen). */
function pickPrevious(rows, latestDate) {
  const hi = latestDate.getTime() - 7 * DAY_MS;
  const lo = latestDate.getTime() - 14 * DAY_MS;
  const ok = (Array.isArray(rows) ? rows : []).filter((r) => r && toDate(r.date) && toDate(r.date).getTime() <= hi && toDate(r.date).getTime() >= lo);
  ok.sort((a, b) => toDate(b.date) - toDate(a.date));
  return ok[0] || null;
}

const available = (extra) => ({ value: null, previous: null, changePct: null, available: true, reason: null, ...extra });
const unavailable = (reason, extra) => ({ value: null, previous: null, changePct: null, available: false, reason, ...extra });

function platformMap(snapshot) {
  const p = snapshot && snapshot.platforms;
  if (!p) return {};
  if (p instanceof Map) return Object.fromEntries(p);
  return typeof p === 'object' ? p : {};
}
function meanEngagement(snapshot) {
  const rates = Object.values(platformMap(snapshot)).map((m) => (m ? m.engagementRate : 0)).filter((r) => isNum(r) && r > 0);
  return rates.length ? round1(rates.reduce((a, b) => a + b, 0) / rates.length) : null;
}

function platformsOf(user) {
  const names = [];
  for (const s of (user && user.connectedSocials) || []) if (s && s.platform) names.push(String(s.platform).toLowerCase());
  for (const p of (user && user.ayrshare && user.ayrshare.activeSocialAccounts) || []) if (p) names.push(String(p).toLowerCase());
  return [...new Set(names)].slice(0, 6);
}

// ---- default (real) data access: lazy, so requiring this file starts nothing -------------------------------------------
function defaultDeps() {
  const m = (name) => require(`../models/${name}`);
  return {
    now: () => new Date(),
    draftsWaiting: (userId) => m('Draft').countDocuments(needsApprovalFilter(userId)).maxTimeMS(MAX_TIME_MS),
    publishedBetween: (userId, from, to) => m('Campaign').countDocuments({ userId, status: 'posted', publishedAt: { $gte: from, $lt: to } }).maxTimeMS(MAX_TIME_MS),
    scheduledBetween: (userId, from, to) => m('Campaign').countDocuments({ userId, status: 'scheduled', scheduledFor: { $gte: from, $lt: to } }).maxTimeMS(MAX_TIME_MS),
    todayCampaigns: (userId, from, to) => m('Campaign').find({ $or: [{ userId, scheduledFor: { $gte: from, $lt: to } }, { userId, publishedAt: { $gte: from, $lt: to } }] })
      .select('name status platforms scheduledFor publishedAt creative.imageUrls creative.textContent').sort({ scheduledFor: 1 }).limit(TODAY_LIMIT).maxTimeMS(MAX_TIME_MS).lean(),
    recentItems: async (userId) => {
      const [drafts, campaigns] = await Promise.all([
        m('Draft').find({ userId, status: { $ne: 'binned' } }).sort({ createdAt: -1 }).limit(RECENT_LIMIT + 2).select('imageUrl creative.imageUrls platforms scheduledDate createdAt').maxTimeMS(MAX_TIME_MS).lean(),
        m('Campaign').find({ userId }).sort({ createdAt: -1 }).limit(RECENT_LIMIT + 2).select('creative.imageUrls platforms scheduledFor publishedAt createdAt').maxTimeMS(MAX_TIME_MS).lean()
      ]);
      // Drafts first: the artwork a customer has made lives on drafts.
      return [
        ...drafts.map((d) => ({ image: d.imageUrl || (d.creative && d.creative.imageUrls && d.creative.imageUrls[0]) || '', platform: (d.platforms && d.platforms[0]) || '', when: d.scheduledDate || d.createdAt })),
        ...campaigns.map((c) => ({ image: (c.creative && c.creative.imageUrls && c.creative.imageUrls[0]) || '', platform: (c.platforms && c.platforms[0]) || '', when: c.scheduledFor || c.publishedAt || c.createdAt }))
      ];
    },
    latestSnapshot: (userId) => m('SocialSnapshot').findOne({ userId }).sort({ date: -1 }).select('date totals platforms').maxTimeMS(MAX_TIME_MS).lean(),
    snapshotBefore: async (userId, latestDate) => {
      const rows = await m('SocialSnapshot').find({ userId, date: { $gte: new Date(latestDate.getTime() - 14 * DAY_MS), $lte: new Date(latestDate.getTime() - 7 * DAY_MS) } })
        .sort({ date: -1 }).limit(15).select('date totals platforms').maxTimeMS(MAX_TIME_MS).lean();
      return pickPrevious(rows, latestDate);
    },
    unreadMessages: (userId) => m('SocialInboxConversation').countDocuments({ userId, status: 'unread' }).maxTimeMS(MAX_TIME_MS),
    proposal: (userId, weekStart) => m('WeeklyProposal').findOne({ userId, weekStart }).select('status items.kind items.status items.error').maxTimeMS(MAX_TIME_MS).lean(),
    planRuns: (userId) => m('Blueprint').find({ userId, kind: 'plan' }).sort({ createdAt: -1 }).limit(PLAN_RUN_LIMIT).select('status completedAt createdAt heartbeatAt').maxTimeMS(MAX_TIME_MS).lean(),
    competitors: (userId) => m('Competitor').find({ userId, isActive: { $ne: false }, isIgnored: { $ne: true } }).sort({ createdAt: -1 }).limit(COMPETITOR_LIMIT)
      .select('name socialHandles handleStatus isAutoDiscovered tracking.pausedAt createdAt isActive isIgnored userId').maxTimeMS(MAX_TIME_MS).lean(),
    productCounts: async (userId) => {
      const Product = m('Product');
      const [count, withPhotos] = await Promise.all([
        Product.countDocuments({ user: userId }).maxTimeMS(MAX_TIME_MS),
        Product.countDocuments({ user: userId, $or: [{ imageUrl: { $exists: true, $nin: ['', null] } }, { 'images.0': { $exists: true } }] }).maxTimeMS(MAX_TIME_MS)
      ]);
      return { count, withPhotos };
    },
    walletBalance: async (user) => {
      const agency = require('./agency');
      if (agency.isWorkspace(user)) return agency.walletBalance(user._id);
      const b = user && user.credits && user.credits.balance;
      return isNum(b) ? Math.max(0, b) : 0;
    }
  };
}

function accountFlags(user, pass) {
  const tier = resolveTier(user);
  const workspace = Boolean(user && user.agency && user.agency.ownerId);
  const staff = Boolean(user && (user.staffRole || user.isCsm));
  const agencyOwner = tier === 'agency' && !workspace;
  const lapsed = !workspace && tier !== 'agency' && Number(user && user.agency && user.agency.clientCount) > 0;
  return {
    tier,
    free: tier === 'free',
    paidTier: ['starter', 'professional', 'agency'].includes(tier),
    agencyOwner,
    clientWorkspace: workspace,
    managed: tier === 'managed',
    staff,
    pass: Boolean(pass),
    frozen: Boolean(workspace && user.agency.frozen),
    showsPostsNotQuarks: agencyOwner || workspace || lapsed
  };
}

function planStateOf(runs, user, now) {
  const rows = Array.isArray(runs) ? runs : [];
  const live = (d) => {
    const hb = toDate(d.heartbeatAt) || toDate(d.createdAt);
    return !hb || now.getTime() - hb.getTime() <= LIMITS.STALE_MS;
  };
  const building = rows.some((d) => (d.status === 'queued' || d.status === 'processing') && live(d));
  const done = rows.filter((d) => d.status === 'completed' && toDate(d.completedAt)).sort((a, b) => toDate(b.completedAt) - toDate(a.completedAt))[0] || null;
  const opened = Boolean(user && user.setup && user.setup.planOpenedAt);
  const eligible = shouldHavePlan(user);
  const latest = rows[0] || null;
  let state = 'none';
  let stopped = false;
  if (building) state = 'building';
  else if (done) state = isStale({ completedAt: done.completedAt }, now) ? 'stale' : 'ready';
  else if (latest && (latest.status === 'failed' || latest.status === 'stopped')) { state = 'failed'; stopped = latest.status === 'stopped'; }
  else if (user && user.planState && user.planState.firstPlanFailedAt && eligible) state = 'failed';
  return { state, opened, eligible, stopped, completedAt: done ? toDate(done.completedAt).toISOString() : null };
}

function createHomeSummary(given = {}) {
  const deps = { ...defaultDeps(), ...given };

  async function build({ user, pass = false }) {
    const now = deps.now();
    const week = istWeek(now);
    const day = istDay(now);
    const userId = user._id;
    const account = accountFlags(user, pass);
    const degraded = [];
    // Run one source; if it fails the block says so and the rest of Home still loads.
    const safe = async (name, fn, fallback) => {
      try { return await fn(); } catch (e) {
        if (!degraded.includes(name)) degraded.push(name);
        console.error(`[home] ${name} could not be read:`, e && e.message);
        return fallback;
      }
    };

    const connected = connectedCount(user);
    const platforms = platformsOf(user);
    const features = {
      inbox: canUse(user, 'inbox').allowed,
      competitors: canUse(user, 'competitors').allowed,
      publish: canUse(user, 'publish').allowed
    };
    const canConnect = canUse(user, 'social_connect').allowed;
    const profile = profileComplete(user);

    const wantsInbox = features.inbox && connected > 0;
    const wantsSnapshots = connected > 0;

    const [drafts, published, publishedBefore, scheduled, today, recent, latest, unread, proposal, runs, comps, products, balance] = await Promise.all([
      safe('drafts', () => deps.draftsWaiting(userId), null),
      safe('posts', () => deps.publishedBetween(userId, week.startsAt, week.endsAt), null),
      safe('posts', () => deps.publishedBetween(userId, week.previousStartsAt, week.startsAt), null),
      safe('posts', () => deps.scheduledBetween(userId, week.startsAt, week.endsAt), null),
      safe('today', () => deps.todayCampaigns(userId, day.startsAt, day.endsAt), []),
      safe('recent', () => deps.recentItems(userId), []),
      wantsSnapshots ? safe('snapshots', () => deps.latestSnapshot(userId), undefined) : null,
      wantsInbox ? safe('messages', () => deps.unreadMessages(userId), null) : null,
      !account.staff ? safe('week', () => deps.proposal(userId, week.start), undefined) : null,
      account.staff ? [] : safe('plan', () => deps.planRuns(userId), null),
      features.competitors ? safe('competitors', () => deps.competitors(userId), null) : [],
      safe('products', () => deps.productCounts(userId), null),
      safe('balance', () => deps.walletBalance(user), null)
    ]);

    // ---- numbers ---------------------------------------------------------------------------------------------------
    const noConnection = canConnect ? REASONS.connect : REASONS.connectFree;
    const snapshotNumbers = {};
    if (connected === 0) {
      for (const k of ['reach', 'engagement', 'followers']) snapshotNumbers[k] = unavailable(noConnection);
    } else if (latest === undefined) {
      for (const k of ['reach', 'engagement', 'followers']) snapshotNumbers[k] = unavailable(FAILED_REASON);
    } else if (!latest) {
      for (const k of ['reach', 'engagement', 'followers']) snapshotNumbers[k] = unavailable(REASONS.soon);
    } else {
      const latestDate = toDate(latest.date);
      const before = latestDate ? await safe('snapshots', () => deps.snapshotBefore(userId, latestDate), null) : null;
      const asOf = latestDate ? istDateOf(latestDate) : null;
      const stale = Boolean(latestDate && now.getTime() - latestDate.getTime() > STALE_SNAPSHOT_DAYS * DAY_MS);
      const totals = latest.totals || {};
      const prevTotals = (before && before.totals) || {};
      const extra = { asOf, stale };
      snapshotNumbers.followers = isNum(totals.followers)
        ? available({
          value: totals.followers, previous: isNum(prevTotals.followers) && before ? prevTotals.followers : null,
          changePct: changePct(totals.followers, before ? prevTotals.followers : null),
          change: before && isNum(prevTotals.followers) ? totals.followers - prevTotals.followers : null, unit: 'count', ...extra
        })
        : unavailable(REASONS.notReported);
      snapshotNumbers.reach = isNum(totals.reach) && totals.reach > 0
        ? available({
          value: totals.reach, previous: before && prevTotals.reach > 0 ? prevTotals.reach : null,
          changePct: changePct(totals.reach, before && prevTotals.reach > 0 ? prevTotals.reach : null), unit: 'count', ...extra
        })
        : unavailable(REASONS.notReported);
      const eng = meanEngagement(latest);
      const engBefore = before ? meanEngagement(before) : null;
      snapshotNumbers.engagement = eng !== null
        ? available({ value: eng, previous: engBefore, changePct: changePct(eng, engBefore), unit: 'percent', ...extra })
        : unavailable(REASONS.notReported);
    }

    const countNumber = (value, previous, extra) => (isNum(value)
      ? available({ value, previous: isNum(previous) ? previous : null, changePct: changePct(value, previous), unit: 'count', ...extra })
      : unavailable(FAILED_REASON, extra));

    let messages;
    if (!features.inbox) messages = unavailable(REASONS.inbox);
    else if (connected === 0) messages = unavailable(noConnection);
    else if (isNum(unread)) messages = available({ value: unread, unit: 'count' });
    else messages = unavailable(FAILED_REASON);

    const numbers = {
      reach: snapshotNumbers.reach,
      engagement: snapshotNumbers.engagement,
      followers: snapshotNumbers.followers,
      postsPublishedThisWeek: countNumber(published, publishedBefore),
      draftsWaiting: countNumber(drafts, null),
      unrepliedMessages: messages
    };

    // ---- plan, week, setup, balance --------------------------------------------------------------------------------
    const plan = runs === null ? { state: 'none', opened: Boolean(user.setup && user.setup.planOpenedAt), eligible: shouldHavePlan(user), stopped: false, completedAt: null, unknown: true }
      : planStateOf(runs, user, now);

    const items = proposal && Array.isArray(proposal.items) ? proposal.items : [];
    const posts = items.filter((i) => i && i.kind === 'post' && i.status !== 'skipped');
    const counts = { posts: posts.length, carousels: 0, videos: 0 };
    for (const i of items) {
      if (!i || i.status === 'skipped') continue;
      if (i.kind === 'carousel') counts.carousels += 1; else if (i.kind === 'video') counts.videos += 1;
    }
    const balanceQuarks = isNum(balance) ? Math.max(0, balance) : null;
    const noPool = items.some((i) => i && i.kind === 'post' && i.status === 'failed' && i.error === 'no_pool');
    const cannotPayOne = (plan.state === 'ready' || plan.state === 'stale') && !proposal && balanceQuarks !== null && balanceQuarks < QUARK_COSTS.image_generated;
    const weekState = proposal ? (proposal.status || 'proposed') : 'none';
    const weekBlock = {
      start: week.start,
      end: week.end,
      proposal: weekState,
      topUp: Boolean(proposal ? noPool : cannotPayOne),
      posts: {
        planned: proposal ? posts.length : null,
        made: proposal ? posts.filter((i) => i.status === 'made').length : null,
        published: isNum(published) ? published : null,
        scheduled: isNum(scheduled) ? scheduled : null
      },
      counts: proposal ? counts : null
    };

    const setup = setupSteps({
      user,
      state: {
        connectedCount: connected, hasPlan: plan.state === 'ready' || plan.state === 'stale', planOpened: plan.opened,
        firstWeekApproved: Boolean(user.setup && user.setup.firstWeekApprovedAt), isPaid: account.tier !== 'free'
      }
    });

    const balanceBlock = (() => {
      if (balanceQuarks === null) return { available: false, quarks: null, posts: null, videos: null, showQuarks: !account.showsPostsNotQuarks, text: '', paused: account.frozen };
      const o = outputsFor(balanceQuarks);
      return {
        available: true,
        quarks: account.showsPostsNotQuarks ? null : balanceQuarks,
        posts: o.posts,
        videos: o.videos,
        showQuarks: !account.showsPostsNotQuarks,
        text: account.showsPostsNotQuarks ? equivalentText(balanceQuarks) : balanceText(balanceQuarks),
        paused: account.frozen
      };
    })();

    // ---- competitors and products ----------------------------------------------------------------------------------
    const tracked = trackedCompetitors(Array.isArray(comps) ? comps.filter((c) => c && (c.userId === undefined || String(c.userId) === String(userId))) : []);
    const needHandle = tracked.filter((c) => {
      const h = handleOf(c);
      return !h || !isValidHandle(h) || handleStatusOf(c) === 'suggested' || Boolean(c.tracking && c.tracking.pausedAt);
    }).length;
    const competitorBlock = { held: features.competitors, tracked: tracked.length, needHandle: features.competitors ? needHandle : 0 };
    const productBlock = products ? { count: products.count, withPhotos: products.withPhotos } : { count: 0, withPhotos: 0 };

    // ---- today and recent ------------------------------------------------------------------------------------------
    const todayList = (Array.isArray(today) ? today : []).map((c) => {
      const at = toDate(c.scheduledFor) || toDate(c.publishedAt);
      const text = (c.creative && c.creative.textContent) || '';
      return {
        id: String(c._id), at: at ? at.toISOString() : null,
        title: String(c.name || String(text).slice(0, 60) || 'Untitled post').slice(0, 80),
        subtitle: String(text).slice(0, 80), image: safeUrl(c.creative && c.creative.imageUrls && c.creative.imageUrls[0]),
        status: c.status || 'scheduled', platform: (c.platforms && c.platforms[0]) || null
      };
    }).sort((a, b) => (a.at ? Date.parse(a.at) : Infinity) - (b.at ? Date.parse(b.at) : Infinity)).slice(0, TODAY_LIMIT);

    const recentList = (Array.isArray(recent) ? recent : []).map((r) => ({ image: safeUrl(r && r.image), platform: r && r.platform ? String(r.platform).slice(0, 20) : null, when: toDate(r && r.when) }))
      .filter((r) => r.image)
      .sort((a, b) => (b.when ? b.when.getTime() : 0) - (a.when ? a.when.getTime() : 0))
      .slice(0, RECENT_LIMIT)
      .map((r) => ({ image: r.image, platform: r.platform, when: r.when ? r.when.toISOString() : null }));

    const actions = nextActions({
      account,
      profileComplete: profile.complete === true,
      plan: { state: plan.state, opened: plan.opened },
      week: { state: weekState, topUp: weekBlock.topUp, plannedPosts: weekBlock.posts.planned },
      draftsWaiting: isNum(drafts) ? drafts : 0,
      unreplied: { entitled: features.inbox && connected > 0, value: isNum(unread) ? unread : null },
      connected: { count: connected },
      competitors: competitorBlock,
      products: productBlock
    });

    return {
      generatedAt: now.toISOString(),
      account,
      features,
      numbers,
      nextActions: actions,
      week: weekBlock,
      plan,
      setup: { next: setup.next, allDone: setup.allDone, done: setup.steps.filter((s) => s.done).length, total: setup.steps.length },
      balance: balanceBlock,
      connected: { count: connected, platforms },
      competitors: competitorBlock,
      products: productBlock,
      today: todayList,
      recent: recentList,
      degraded
    };
  }

  return { build };
}

module.exports = { createHomeSummary, changePct, pickPrevious, planStateOf, accountFlags, REASONS, FAILED_REASON, TODAY_LIMIT, RECENT_LIMIT };
