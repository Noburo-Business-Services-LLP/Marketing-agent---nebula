/**
 * Numbers for the staff Usage page: what clients use, where new clients drop off, what Quarks are spent on,
 * and the most used feature on each plan. `buildUsage` is pure. Anything that cannot be worked out from stored
 * data comes back as { available: false, reason } instead of a made-up figure.
 * Staff, CSM and hidden test accounts are not customers and are never counted. Months are India time.
 * Owner sees everything; an Admin gets the summary (no Quark spending).
 */
const { resolveTier } = require('../../config/entitlements');
const { USD_PER_QUARK } = require('../../config/apiCosts');
const { monthStart, HISTORY_CAP_WARN } = require('./money');
const { NOT_A_WORKSPACE } = require('../agency');
const { isPaying, connectedCount } = require('./clientStatus');
const { READ_OPTIONS, unreadable } = require('./readErrors');

const DAY = 86400000;
const FEATURE_DAYS = 30;
const WINDOWS = [30, 90];

/**
 * The only user fields the Usage numbers read. Social accounts are read as a list of platforms (only their count is used,
 * and this keeps tokens and account ids out of memory), the plan as tier, add-ons and the paid flags.
 */
const USAGE_USER_PROJECTION = Object.freeze({
  createdAt: 1, isHidden: 1, staffRole: 1, isCsm: 1, onboardingCompleted: 1,
  'connectedSocials.platform': 1, 'ayrshare.activeSocialAccounts': 1,
  'plan.tier': 1, 'plan.paidManually': 1, 'plan.subscriptions.active': 1, 'payments.status': 1
});
/** The Quark history read for the Owner's breakdown: the app keeps at most the last 100 entries per account. */
const HISTORY_READ_CAP = 100;

const toMs = (v) => { const t = v ? new Date(v).getTime() : NaN; return Number.isFinite(t) ? t : null; };
const idOf = (u) => String((u && (u._id || u.id)) || '');
const isCustomer = (u) => !u.staffRole && !u.isCsm && !u.isHidden;

/** What each count means, in words the Owner can check against the product. */
const FEATURES = [
  { key: 'images', label: 'Images generated', definition: 'Images on posts and carousel slides created in the last 30 days (language copies not counted twice). Images re-made inside an existing post are not counted.' },
  { key: 'postsDrafted', label: 'Posts drafted', definition: 'Drafts created in the last 30 days, any status, language copies not counted twice.' },
  { key: 'postsPublished', label: 'Posts published', definition: 'Posts that reached a social account in the last 30 days (a stored publish time on the post). Videos published from the video flow are not included.' },
  { key: 'videos', label: 'Videos', definition: 'Video jobs created in the last 30 days that finished. Failed or cancelled jobs are not counted.' },
  { key: 'heroVideos', label: 'Hero videos', definition: 'Hero video jobs created in the last 30 days that finished.' },
  { key: 'blueprints', label: 'Blueprints', definition: 'Brand Growth Blueprints created in the last 30 days that finished.' },
  { key: 'repliesDrafted', label: 'Replies drafted', definition: 'Inbox messages in the last 30 days for which a reply was suggested or written automatically. Replies a person typed are not counted.' }
];

const FUNNEL_STEPS = [
  { key: 'signedUp', label: 'Signed up', definition: 'Customer accounts created in the window.' },
  { key: 'onboarded', label: 'Finished onboarding', definition: 'The account is marked as having finished onboarding.' },
  { key: 'firstContent', label: 'Created first content', definition: 'The account has at least one draft, post or video job.' },
  { key: 'connected', label: 'Connected a social account', definition: 'Has a social account connected now (not whether one was ever connected).' },
  { key: 'published', label: 'Published first post', definition: 'At least one post reached a social account.' },
  { key: 'paid', label: 'Paid', definition: 'A paid payment on record, or an active plan or add-on.' }
];

const CATEGORIES = [
  { key: 'images', label: 'Images and posts' },
  { key: 'captions', label: 'Captions' },
  { key: 'video', label: 'Video' },
  { key: 'hero', label: 'Hero video' },
  { key: 'blueprint', label: 'Blueprint' },
  { key: 'other', label: 'Other' }
];

// Every action the app charges Quarks for (keys of QUARK_COSTS) and the group it belongs to. A full post
// (campaign_full and the smart-post flows) makes an image and a caption in one charge, so it sits under images.
const ACTION_CATEGORY = {
  image_generated: 'images', image_edit: 'images', refine_image: 'images', carousel_generated: 'images',
  campaign_full: 'images', rival_post: 'images', strategic_post: 'images', event_post: 'images',
  campaign_text: 'captions',
  video_base: 'video', video_generated: 'video', video_scene_image: 'video', video_scene_clip: 'video', video_character_portrait: 'video',
  hero_video_clip: 'hero', studio_video: 'video', studio_reference: 'images',
  blueprint: 'blueprint',
  blueprint_pdf: 'blueprint',
  chat_message: 'other', competitor_scrape: 'other', listening_score: 'other', studio_transcription: 'other',
  home_response_post: 'captions', home_witty_comment: 'captions'
};

/** Group of a Quark history action. `explicitOnly` returns undefined for an action nobody has placed yet. */
function categoryOf(action, explicitOnly = false) {
  const hit = ACTION_CATEGORY[String(action || '')];
  if (hit) return hit;
  return explicitOnly ? undefined : 'other';
}

function parseWindow(value) {
  if (value === undefined || value === null || value === '') return { ok: true, days: 30 };
  const n = typeof value === 'number' ? value : (typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN);
  return WINDOWS.includes(n) ? { ok: true, days: n } : { ok: false, message: 'Choose 30 or 90 days.' };
}

const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : null);

function featureUseOf(customerIds, usage, unavailable) {
  const items = FEATURES.map((f) => {
    if (unavailable[f.key]) return { key: f.key, label: f.label, definition: f.definition, available: false, reason: unavailable[f.key] };
    let count = 0; let clients = 0;
    for (const r of usage[f.key] || []) {
      const n = Number(r.n);
      if (!customerIds.has(String(r._id)) || !(n > 0)) continue;
      count += n; clients += 1;
    }
    return { key: f.key, label: f.label, definition: f.definition, available: true, count, clients };
  });
  return {
    days: FEATURE_DAYS, customers: customerIds.size, items,
    note: 'Counted from what the app stores about each client\'s work in the last 30 days. Clients is the number of different clients who used it at least once.'
  };
}

function funnelOf(customers, funnelData, days, now) {
  const from = now - days * DAY;
  const cohort = customers.filter((u) => { const t = toMs(u.createdAt); return t !== null && t >= from && t <= now; });
  if (!funnelData) {
    return { available: false, reason: 'We could not read the content and publishing records right now, so the funnel cannot be worked out.', days };
  }
  const set = (list) => (Array.isArray(list) ? new Set(list.map(String)) : null);
  const content = set(funnelData.contentIds);
  const published = set(funnelData.publishedIds);
  const reasonFor = {
    firstContent: funnelData.contentReason || 'We could not read the content records right now.',
    published: funnelData.publishedReason || 'We could not read the published posts right now.'
  };
  const tests = [
    () => true,
    (u) => Boolean(u.onboardingCompleted),
    content ? (u) => content.has(idOf(u)) : null,
    (u) => connectedCount(u) > 0,
    published ? (u) => published.has(idOf(u)) : null,
    (u) => isPaying(u)
  ];
  const steps = []; let alive = cohort; let broken = null;
  FUNNEL_STEPS.forEach((def, i) => {
    const base = { key: def.key, label: def.label, definition: def.definition };
    if (!broken && !tests[i]) broken = i === 2 ? reasonFor.firstContent : reasonFor.published;
    if (broken) { steps.push({ ...base, available: false, reason: i === 2 || i === 4 ? broken : `Needs the earlier step, which could not be counted. ${broken}` }); return; }
    const reached = cohort.filter(tests[i]).length;
    alive = alive.filter(tests[i]);
    steps.push({ ...base, available: true, count: alive.length, reached, fromPrevious: null, fromStart: null });
  });
  const start = steps[0].count;
  steps.forEach((s, i) => {
    if (!s.available) return;
    const prev = steps[i - 1];
    s.fromPrevious = i === 0 ? null : (prev.available ? pct(s.count, prev.count) : null);
    s.fromStart = pct(s.count, start);
  });
  return {
    available: true, days, from: new Date(from).toISOString(), signedUp: cohort.length, steps,
    note: `Clients who signed up in the last ${days} days. Each step counts only clients who also passed every step before it. "Reached" counts the step on its own. Connected is today's state, not whether an account was ever connected.`
  };
}

/** Spending this month, by group. Same history rules as the Money page: refunds come off their own group, staff grants and rewards are not spending. */
function quarksOf(customers, now) {
  const start = monthStart(now, 0);
  const sums = Object.fromEntries(CATEGORIES.map((c) => [c.key, 0]));
  let incomplete = 0;
  for (const u of customers) {
    const hist = (u.credits && Array.isArray(u.credits.history)) ? u.credits.history : [];
    let oldest = Infinity;
    for (const h of hist) {
      const at = toMs(h && (h.createdAt || h.timestamp));
      if (at === null) continue;
      oldest = Math.min(oldest, at);
      if (at < start || at > now) continue;
      const amount = Number(h.amount);
      const action = String(h.action || '');
      if (action === 'staff_grant') continue;
      if (Number.isFinite(amount) && amount < 0) sums[categoryOf(action)] += -amount;
      else if (Number.isFinite(amount) && amount > 0 && action.endsWith('_refund')) sums[categoryOf(action.slice(0, -'_refund'.length))] -= amount;
      else if (!Number.isFinite(amount) && Number(h.cost) > 0) sums[categoryOf(action)] += Number(h.cost);
    }
    if (hist.length >= HISTORY_CAP_WARN && oldest >= start) incomplete += 1;
  }
  const categories = CATEGORIES.map((c) => ({ key: c.key, label: c.label, quarks: Math.max(0, sums[c.key]) }));
  const total = categories.reduce((n, c) => n + c.quarks, 0);
  categories.forEach((c) => { c.percent = pct(c.quarks, total); });
  return {
    available: true, monthStart: new Date(start).toISOString(), categories, total,
    usdPerQuark: USD_PER_QUARK, totalValueUsdCents: Math.round(total * USD_PER_QUARK * 100),
    possiblyIncompleteClients: incomplete,
    note: 'Counted from each client\'s recent Quark history (the app keeps only the last 50 to 100 entries per client), so a very busy client can be undercounted. Refunds come off the group they were charged to. Quarks added by staff and sign-up rewards are not spending. A full post (image and caption in one charge) is counted under images and posts.'
  };
}

function topByTierOf(customers, usage, unavailable) {
  const okFeatures = FEATURES.filter((f) => !unavailable[f.key]);
  if (okFeatures.length === 0) return { available: false, reason: 'We could not read any feature records right now.' };
  const tierOf = new Map(customers.map((u) => [idOf(u), resolveTier(u)]));
  const ids = ['free', 'starter', 'professional', 'managed', 'agency'];
  const labels = { free: 'Free', starter: 'Starter', professional: 'Professional', managed: 'Managed', agency: 'Agency' };
  const tiers = ids.map((id) => ({ id, label: labels[id], clients: 0, top: null, _use: {} }));
  const byId = Object.fromEntries(tiers.map((t) => [t.id, t]));
  customers.forEach((u) => { { const b = byId[resolveTier(u)]; if (b) b.clients += 1; } });
  for (const f of okFeatures) {
    for (const r of usage[f.key] || []) {
      const t = tierOf.get(String(r._id)); const n = Number(r.n);
      if (!t || !(n > 0)) continue;
      const slot = byId[t]._use[f.key] || { count: 0, clients: 0 };
      slot.count += n; slot.clients += 1; byId[t]._use[f.key] = slot;
    }
  }
  for (const t of tiers) {
    let best = null;
    for (const f of okFeatures) { const s = t._use[f.key]; if (s && (!best || s.count > best.count)) best = { key: f.key, label: f.label, count: s.count, clients: s.clients }; }
    t.top = best; delete t._use;
  }
  const skipped = FEATURES.length - okFeatures.length;
  return {
    available: true, tiers,
    note: 'The feature with the most items made in the last 30 days by clients on that plan. Accounts with no plan on record count as Managed.' + (skipped ? ' Features that could not be read are not counted.' : '')
  };
}

function buildUsage({ users, usage = {}, unavailable = {}, funnelData = null, window: windowDays = 30, level = 'full', now = Date.now() }) {
  const customers = users.filter(isCustomer);
  const ids = new Set(customers.map(idOf));
  const days = WINDOWS.includes(Number(windowDays)) ? Number(windowDays) : 30;
  return {
    generatedAt: new Date(now).toISOString(),
    level,
    featureUse: featureUseOf(ids, usage, unavailable),
    funnel: funnelOf(customers, funnelData, days, now),
    quarks: level === 'full' ? quarksOf(customers, now) : { available: false, restricted: true, reason: 'Quark spending is shown to the Owner only.' },
    topByTier: topByTierOf(customers, usage, unavailable)
  };
}

/** The shape every per-client count comes back in: [{ _id: userId, n }]. */
async function perClient(model, pipeline) {
  const rows = await model.aggregate(pipeline, READ_OPTIONS);
  return rows.map((r) => ({ _id: String(r._id), n: Number(r.n) || 0 }));
}
const byUser = (match, n = { $sum: 1 }) => [{ $match: match }, { $group: { _id: '$userId', n } }];

const IMAGES_ON_DRAFT = {
  $cond: [
    { $gt: [{ $size: { $ifNull: ['$carouselSlides', []] } }, 0] },
    { $size: { $filter: { input: { $ifNull: ['$carouselSlides', []] }, as: 's', cond: { $gt: [{ $strLenCP: { $ifNull: ['$$s.imageUrl', ''] } }, 0] } } } },
    { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ['$imageUrl', ''] } }, 0] }, 1, 0] }
  ]
};
// "Published" is either of two stored signs. They are read as two separate lookups (one per sign, each narrowed by client
// id) instead of one $or, so the database never picks the date index (which would walk every published post of every client).
const PUBLISHED_SIGNS = [{ publishedAt: { $ne: null } }, { status: 'posted' }];

/**
 * The seven per-client counts the Usage page needs, as data: key, the model's name, the words used if it cannot be
 * read, and the pipeline. Shared by `loadUsageData` and by the perf check (`scripts/staff-perf-check.js --explain`).
 */
function usageSources(since) {
  const notLanguageCopy = { languageVariantOf: null };
  return [
    { key: 'images', model: 'Draft', what: 'drafts', pipeline: byUser({ createdAt: { $gte: since }, ...notLanguageCopy }, { $sum: IMAGES_ON_DRAFT }) },
    { key: 'postsDrafted', model: 'Draft', what: 'drafts', pipeline: byUser({ createdAt: { $gte: since }, ...notLanguageCopy }) },
    { key: 'postsPublished', model: 'Campaign', what: 'published posts', pipeline: byUser({ publishedAt: { $gte: since } }) },
    { key: 'videos', model: 'VideoJob', what: 'video jobs', pipeline: byUser({ status: 'completed', createdAt: { $gte: since } }) },
    { key: 'heroVideos', model: 'HeroVideoJob', what: 'hero video jobs', pipeline: byUser({ status: 'completed', createdAt: { $gte: since } }) },
    { key: 'blueprints', model: 'Blueprint', what: 'Blueprints', pipeline: byUser({ status: 'completed', kind: { $ne: 'plan' }, createdAt: { $gte: since } }) },
    {
      key: 'repliesDrafted', model: 'SocialInboxMessage', what: 'inbox',
      pipeline: byUser({ 'ai.generatedAt': { $gte: since }, $or: [{ 'ai.suggestedReplies.0': { $exists: true } }, { 'ai.autoReplyCandidate': { $nin: ['', null] } }] })
    }
  ];
}

/**
 * Reads what Usage needs. Each source is read on its own: one that fails is reported as unavailable and the rest
 * still load. A source that ran out of time says so ("took too long") instead of looking like an error.
 * `models` is injected for tests. `level` 'summary' (an Admin) skips the Quark history, which only the Owner's
 * breakdown reads.
 */
async function loadUsageData({ models, window: windowDays = 30, now = Date.now(), level = 'full' }) {
  const { User, Draft, Campaign, VideoJob, HeroVideoJob, Blueprint, SocialInboxMessage } = models;
  const projection = level === 'full' ? { ...USAGE_USER_PROJECTION, 'credits.history': { $slice: -HISTORY_READ_CAP } } : USAGE_USER_PROJECTION;
  const users = await User.find({ staffRole: null, isCsm: { $ne: true }, ...NOT_A_WORKSPACE }, projection, { maxTimeMS: READ_OPTIONS.maxTimeMS }).lean();
  const since = new Date(now - FEATURE_DAYS * DAY);
  const usage = {}; const unavailable = {};
  const byName = { Draft, Campaign, VideoJob, HeroVideoJob, Blueprint, SocialInboxMessage };
  await Promise.all(usageSources(since).map(async (source) => {
    try { usage[source.key] = await perClient(byName[source.model], source.pipeline); }
    catch (error) {
      console.error(`[staff] usage: could not read ${source.key}:`, error.message);
      unavailable[source.key] = unreadable(source.what, error);
    }
  }));

  // Funnel: which of the clients who signed up in the window ever made content or published.
  const from = now - (WINDOWS.includes(Number(windowDays)) ? Number(windowDays) : 30) * DAY;
  const cohortIds = users.filter((u) => isCustomer(u) && toMs(u.createdAt) !== null && toMs(u.createdAt) >= from).map((u) => u._id);
  const funnelData = { contentIds: null, publishedIds: null };
  const ids = async (parts) => {
    const seen = new Set();
    for (const [model, pipeline] of parts) (await perClient(model, pipeline)).forEach((r) => seen.add(r._id));
    return [...seen];
  };
  const mine = { userId: { $in: cohortIds } };
  const [content, published] = await Promise.allSettled([
    ids([[Draft, byUser(mine)], [Campaign, byUser(mine)], [VideoJob, byUser(mine)]]),
    ids([...PUBLISHED_SIGNS.map((sign) => [Campaign, byUser({ ...mine, ...sign })]), [Draft, byUser({ ...mine, status: 'published' })]])
  ]);
  if (content.status === 'fulfilled') funnelData.contentIds = content.value;
  else { console.error('[staff] usage: could not read content records:', content.reason.message); funnelData.contentReason = unreadable('content records', content.reason); }
  if (published.status === 'fulfilled') funnelData.publishedIds = published.value;
  else { console.error('[staff] usage: could not read published posts:', published.reason.message); funnelData.publishedReason = unreadable('published posts', published.reason); }
  return { users, usage, unavailable, funnelData };
}

module.exports = { buildUsage, loadUsageData, usageSources, categoryOf, parseWindow, CATEGORIES, FEATURES, FUNNEL_STEPS, USAGE_USER_PROJECTION, HISTORY_READ_CAP };
