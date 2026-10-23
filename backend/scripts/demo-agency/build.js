'use strict';
/**
 * The established demo agency, built as plain data (dates counted back from `now`, so the demo never goes stale). Pure: no database,
 * no network. Pictures are returned as makers keyed by file name and are drawn by the seed script.
 * Rows follow the stored shapes the Zaya demo already uses (scripts/demo-brand/content.js, account.js, performance.js).
 */
const { PLANS, AGENCY: AGENCY_PRICES, chargePaise, QUARK_COSTS } = require('../../config/apiCosts');
const { INVOICE_ITEMS } = require('../../config/plans');
const { seeded } = require('../demo-brand/images');
const { AGENCY, TIMELINE, CLIENTS, TEMPLATES } = require('./constants');
const posters = require('./posters');

const DAY = 24 * 60 * 60 * 1000;
const IST = 5.5 * 3600 * 1000;
const OID = () => new (require('mongoose').Types.ObjectId)();
const TAG = 'demo-agency-pro';
const tagRef = (s) => `${TAG}:${s}`;
const SLOT_QUARKS = AGENCY_PRICES.slot.quarks;
const SLOT_INR = AGENCY_PRICES.slot.inr;

function monthsBefore(date, months) {
  const d = new Date(date.getTime()); const day = d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

function timeline(now = new Date()) {
  const lastCharge = new Date(now.getTime() - TIMELINE.daysSinceLastCharge * DAY); lastCharge.setUTCHours(4, 0, 0, 0);
  const charges = [];
  for (let i = TIMELINE.planCharges - 1; i >= 0; i -= 1) charges.push(monthsBefore(lastCharge, i));
  return { now, charges, nextCharge: monthsBefore(lastCharge, -1), createdAt: new Date(charges[0].getTime() - 40 * 60 * 1000) };
}

const joinedAt = (t, c) => new Date(t.charges[0].getTime() + c.joinedAfter * DAY);
const slotsAt = (i) => (i >= TIMELINE.slotFromCharge - 1 ? 1 : 0); // extra client slots paid in charge i (0-based)
const grantAt = (i) => PLANS.agency.quarks + SLOT_QUARKS * slotsAt(i);
const periodOf = (t, date) => { let k = 0; t.charges.forEach((c, i) => { if (date >= c) k = i; }); return k; };

const assetUrl = (base, slug, rel) => `${base}/demo-assets/agency/${slug}/${rel}`;
const FB_HANDLE = (c) => c.slug.replace(/-/g, '');
const postUrlFor = (c, platform, id) => {
  const code = String(id).replace(/[^a-z0-9]/gi, '');
  return platform === 'facebook' ? `https://www.facebook.com/${FB_HANDLE(c)}.demo/posts/${code}` : `https://www.instagram.com/p/${code}/`;
};

// Where each client's followers stand today and how many it had when it joined.
const FOLLOWERS = {
  'brew-and-beans': { instagram: [11800, 2900], facebook: [4300, 1500] }, 'lotus-dental': { instagram: [6400, 900], facebook: [3100, 700] },
  'urban-thread': { instagram: [24500, 8100], facebook: [6200, 2400] }, 'ironforge-fitness': { instagram: [9300, 4200], facebook: [2800, 1300] },
  'skyline-homes': { instagram: [5100, 1700], facebook: [7400, 3500] }, 'pure-pantry': { instagram: [17800, 9600], facebook: [4200, 2600] }
};
const finalFollowers = (c, p) => FOLLOWERS[c.slug][p][0];

/** The `ayrshare` fields of a client: two fake connected accounts, answered offline because the key starts with `demo-`. */
function ayrshareFor(c, t, logoUrl) {
  const connectedAt = new Date(joinedAt(t, c).getTime() + DAY);
  const handle = c.slug.replace(/-/g, '.');
  const ig = finalFollowers(c, 'instagram'); const fb = finalFollowers(c, 'facebook');
  return {
    profileKey: `demo-${TAG}-${c.slug}`, refId: tagRef(c.slug), title: `${c.name} (demo)`, createdAt: connectedAt,
    activeSocialAccounts: ['instagram', 'facebook'],
    displayNames: [
      { platform: 'instagram', username: handle, displayName: c.name, userImage: logoUrl, created: connectedAt.toISOString(),
        analytics: { followersCount: ig, followsCount: 380, mediaCount: 90 + Math.round(ig / 400), reachCount: Math.round(ig * 2.1), likeCount: Math.round(ig * 0.05), commentsCount: Math.round(ig * 0.006) } },
      { platform: 'facebook', username: c.name, displayName: c.name, userImage: logoUrl, created: new Date(connectedAt.getTime() + 6 * 60000).toISOString(),
        analytics: { followersCount: fb, fanCount: Math.round(fb * 0.97), pageFollows: 0, mediaCount: 140 + Math.round(fb / 60), pagePostsImpressionsUnique: Math.round(fb * 1.8), pagePostsImpressions: Math.round(fb * 2.4), pagePostEngagements: Math.round(fb * 0.07) } }
    ],
    lastCheckedAt: t.now, lastError: ''
  };
}

/** Business profile in the questionnaire shape. */
function businessProfileFor(c, logoUrl) {
  return {
    name: c.name, website: `https://${c.slug}.example`, industry: c.industry, niche: c.profile.niche, businessLocation: c.city,
    description: c.profile.description, heroProduct: c.profile.heroProduct, targetAudience: c.profile.targetAudience, targetCustomerProfile: c.profile.targetCustomerProfile,
    businessType: 'B2C', brandVoice: ['Friendly', 'Helpful and informative'], marketingGoals: ['More sales', 'More enquiries and calls'], contentLanguage: 'english',
    accountKind: 'one', competitors: [],
    brandAssets: { logoUrl, ogImage: '', favicon: '', brandColors: [c.palette.ink, c.palette.accent, c.palette.bg, c.palette.soft], images: [{ src: logoUrl, alt: `${c.name} logo`, isLogo: true }] }
  };
}

const wobble = (r, base, spread) => Math.round(base * (1 + (r() - 0.5) * spread));

/** One client's posts (published through the months, a few scheduled, a few waiting for approval), with campaigns and numbers. */
function buildClientPosts({ client: c, index, userId, t, base }) {
  const r = seeded(`agency:${c.slug}`); const start = new Date(joinedAt(t, c).getTime() + 2 * DAY); const now = t.now;
  const stepDays = 30 / c.perMonth;
  const plan = [];
  for (let d = start.getTime(); d < now.getTime() - 0.4 * DAY; d += (stepDays * (0.75 + r() * 0.5)) * DAY) plan.push({ at: new Date(d), status: 'published' });
  for (let k = 1; k <= 3; k += 1) plan.push({ at: new Date(now.getTime() + (k * 1.4 + r()) * DAY), status: 'scheduled' });
  plan.push({ at: new Date(now.getTime() + 6 * DAY), status: 'draft' }, { at: new Date(now.getTime() + 7.5 * DAY), status: 'draft' });
  const drafts = []; const campaigns = []; const files = new Map(); const performance = [];
  plan.forEach((p, n) => {
    const tpl = TEMPLATES[(n * 5 + index * 3) % TEMPLATES.length];
    const a = c.items[(n + index) % c.items.length]; const b = c.items[(n + index + 2) % c.items.length];
    const words = tpl(c, a, b);
    const carousel = n % 7 === 4; const tall = true; const layout = (n + index) % 4;
    const key = `p${String(n + 1).padStart(2, '0')}`;
    const rel = `${key}.jpg`;
    const dims = tall ? { w: 1080, h: 1350 } : { w: 1080, h: 1080 };
    files.set(rel, () => posters.postJpg(c, words, { layout, ...dims, seedKey: key }));
    let slides = [];
    if (carousel) {
      const second = TEMPLATES[(n * 5 + index * 3 + 5) % TEMPLATES.length](c, b, a); const third = TEMPLATES[(n * 5 + index * 3 + 9) % TEMPLATES.length](c, a, b);
      [[`${key}-s2.jpg`, second, (layout + 1) % 4], [`${key}-s3.jpg`, third, (layout + 2) % 4]].forEach(([f, w2, l2]) => files.set(f, () => posters.postJpg(c, w2, { layout: l2, ...dims, seedKey: f })));
      slides = [assetUrl(base, c.slug, rel), assetUrl(base, c.slug, `${key}-s2.jpg`), assetUrl(base, c.slug, `${key}-s3.jpg`)];
    }
    const imageUrl = assetUrl(base, c.slug, rel);
    const platforms = r() < 0.8 ? ['instagram', 'facebook'] : ['instagram'];
    const hashtags = [...c.tags, '#brightwave'].slice(0, 4);
    const caption = `${words.cap}\n\n${hashtags.join(' ')}`;
    const status = p.status; const at = p.at;
    const origin = status === 'draft' ? 'automation' : (r() < 0.6 ? 'automation' : 'manual');
    const createdAt = status === 'published' ? new Date(at.getTime() - (1 + Math.floor(r() * 3)) * DAY) : status === 'scheduled' ? new Date(now.getTime() - (1 + r() * 3) * DAY) : new Date(now.getTime() - (0.2 + r() * 1.2) * DAY);
    const objective = n % 5 === 1 ? 'sales' : n % 5 === 3 ? 'engagement' : 'awareness';
    const draft = {
      _id: OID(), userId, title: words.head === a.n ? a.n : `${words.head}: ${words.sub}`.slice(0, 110), caption, hashtags, cta: '', imageUrl, imageText: words.head,
      creativeConcept: `${c.name}: ${words.head}`, visualTreatment: 'brand colours with a simple drawing', platforms, language: 'English', tone: 'Friendly', objective,
      status, origin, sourceType: carousel ? 'carousel' : 'post', contentType: carousel ? 'carousel' : 'post', theme: '', aspectRatio: tall ? '4:5' : '1:1',
      carouselSlides: slides.map((u, k) => ({ order: k + 1, role: k === 0 ? 'hook' : k === slides.length - 1 ? 'payoff' : 'build', headline: k === 0 ? words.head : words.sub, imageText: words.head, imageUrl: u })),
      createdAt, updatedAt: createdAt
    };
    const campaignId = OID();
    if (status === 'published') {
      Object.assign(draft, { publishedAt: at, publishedPlatforms: platforms, scheduledDate: at, approvedAt: new Date(at.getTime() - (4 + r() * 20) * 3600 * 1000), updatedAt: at, campaignId });
    } else if (status === 'scheduled') {
      Object.assign(draft, { scheduledDate: at, plannedDate: at, approvedAt: new Date(now.getTime() - (0.3 + r() * 1.5) * DAY), campaignId });
    } else { draft.plannedDate = at; }
    if (status === 'published' || status === 'scheduled') {
      const posted = status === 'published'; const providerId = `${TAG}-${c.slug}-${n + 1}`;
      const postIds = Object.fromEntries(platforms.map((pl, k) => [pl, k === 0 ? providerId : `${providerId}-fb`]));
      const age = Math.max(0, (now.getTime() - at.getTime()) / DAY);
      const ramp = Math.min(1, 0.35 + age / 3); const noise = 0.8 + r() * 0.5 + (r() > 0.93 ? 0.7 : 0);
      const int = (v) => Math.max(0, Math.round(v));
      let numbers = null; let totals = null;
      if (posted) {
        numbers = {};
        for (const pl of platforms) {
          const f = finalFollowers(c, pl) * (0.8 + 0.2 * Math.min(1, (at.getTime() - joinedAt(t, c).getTime()) / (120 * DAY)));
          const reach = int(f * (pl === 'instagram' ? 0.2 : 0.12) * (carousel ? 1.25 : 1) * noise * ramp);
          const likes = int(reach * (pl === 'instagram' ? 0.05 + r() * 0.025 : 0.036 + r() * 0.014));
          numbers[pl] = { analytics: { reachCount: reach, impressionCount: int(reach * 1.25), likeCount: likes, commentsCount: int(likes * (0.04 + r() * 0.03)), savedCount: pl === 'instagram' ? int(likes * (carousel ? 0.3 : 0.1)) : 0, sharesCount: int(likes * 0.06) } };
        }
        totals = { impressions: 0, reach: 0, likes: 0, comments: 0, shares: 0, engagement: 0 };
        for (const node of Object.values(numbers)) { const a = node.analytics; totals.impressions += a.impressionCount; totals.reach += a.reachCount; totals.likes += a.likeCount; totals.comments += a.commentsCount; totals.shares += a.sharesCount; }
        totals.engagement = totals.likes + totals.comments + totals.shares;
      }
      campaigns.push({
        _id: campaignId, userId, name: draft.title, objective, platforms, status: posted ? 'posted' : 'scheduled', priority: 'medium', notes: '', selectedProducts: [], tone: 'friendly',
        aiGenerated: origin === 'automation',
        creative: { type: carousel ? 'carousel' : 'image', textContent: caption, imageUrls: slides.length ? slides : [imageUrl], videoUrl: '', captions: caption, hashtags, callToAction: '' },
        scheduling: { startDate: at, postTime: new Date(at.getTime() + IST).toISOString().slice(11, 16), timezone: 'Asia/Kolkata', frequency: 'once' },
        targeting: { demographics: '', ageRange: { min: 18, max: 55 }, gender: 'all', locations: ['India'], interests: [] },
        budget: { amount: 0, total: 0, daily: 0, spent: 0, currency: 'INR' },
        performance: totals ? { impressions: totals.impressions, clicks: 0, ctr: 0, engagement: totals.engagement, reach: totals.reach, likes: totals.likes, comments: totals.comments, shares: totals.shares, conversions: 0, spend: 0 } : undefined,
        socialPostId: providerId, socialPostIds: postIds, instagramPostId: providerId, scheduledFor: at, publishedAt: posted ? at : null,
        ayrshareStatus: posted ? 'success' : 'scheduled', ayrshareCheckedAt: posted ? new Date(Math.min(now.getTime(), at.getTime() + 600000)) : null,
        publishResult: { status: posted ? 'success' : 'scheduled', demo: true, postIds: platforms.map((pl) => ({ platform: pl, status: 'success', id: postIds[pl], ...(posted ? { postUrl: postUrlFor(c, pl, postIds[pl]) } : {}) })) },
        createdAt, updatedAt: posted ? at : createdAt
      });
      if (posted) performance.push({ key: `${c.slug}-${key}`, id: `${c.slug}-${key}`, campaignId, format: carousel ? 'carousel' : 'image', platforms, publishedAt: at, caption, hashtags, cta: '', tone: 'friendly', postId: postIds, thumbnail: imageUrl, numbers });
    }
    drafts.push(draft);
  });
  return { drafts, campaigns, files, performance, published: drafts.filter((d) => d.status === 'published') };
}

/** Daily follower snapshots from the day the client joined. */
function snapshotRows({ client: c, userId, t }) {
  const r = seeded(`snap:${c.slug}`); const rows = [];
  const from = Math.floor((t.now.getTime() - joinedAt(t, c).getTime()) / DAY);
  for (let daysAgo = from; daysAgo >= 0; daysAgo -= 1) {
    const day = new Date(t.now.getTime() - daysAgo * DAY);
    const date = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
    const tt = from ? (from - daysAgo) / from : 1; const platforms = {};
    let followers = 0; let reach = 0; let impressions = 0;
    for (const pl of ['instagram', 'facebook']) {
      const [fin, start] = FOLLOWERS[c.slug][pl];
      const f = daysAgo === 0 ? fin : Math.round((start + (fin - start) * (tt ** 0.85)) * (1 + (r() - 0.5) * 0.004));
      const rc = Math.round(f * (pl === 'instagram' ? 2.1 : 1.8) * (daysAgo === 0 ? 1 : 0.95 + r() * 0.1));
      platforms[pl] = { followers: f, following: 380, posts: 90 + Math.round(f / 400) - Math.round(daysAgo * 0.2), reach: rc, impressions: Math.round(rc * 1.2), engagementRate: Math.round((3.2 + 1.6 * tt + (r() - 0.5) * 0.3) * 100) / 100, likes: Math.round(f * 0.05 * (0.6 + 0.4 * tt)) };
      followers += f; reach += rc; impressions += platforms[pl].impressions;
    }
    rows.push({ userId, date, platforms, totals: { followers, reach, impressions, posts: platforms.instagram.posts } });
  }
  return rows;
}

/**
 * The agency's wallet story: each plan charge replaces what was left of last month's allowance, then every client's work
 * is a spend on the agency's pool that names the client (`workspace`). Counts of posts match the published posts above.
 */
function buildWallet({ t, ownerId, clients }) {
  const rows = []; let plan = 0; let used = 0;
  const push = (row) => rows.push({ user: ownerId, ...row, balanceAfter: plan });
  t.charges.forEach((at, i) => {
    if (plan > 0) { const gone = plan; plan = 0; push({ type: 'expiry', bucket: 'plan', quarks: -gone, action: 'plan_expired', ref: tagRef(`expiry-${i}`), createdAt: at }); }
    const grant = grantAt(i); plan = grant;
    push({ type: 'grant', bucket: 'plan', quarks: grant, action: 'plan_charge', ref: tagRef(`plan-${i + 1}`), note: slotsAt(i) ? 'Agency plan and extra client, monthly Quarks' : 'Agency plan, monthly Quarks', createdAt: new Date(at.getTime() + 1000) });
    const end = i + 1 < t.charges.length ? t.charges[i + 1] : t.now;
    const spends = [];
    clients.forEach((cl, ci) => {
      const joined = joinedAt(t, cl.def);
      if (joined >= end) return;
      const from = new Date(Math.max(at.getTime(), joined.getTime()));
      const span = end.getTime() - from.getTime();
      const posts = cl.published.filter((d) => d.publishedAt >= at && d.publishedAt < end).length;
      const regen = Math.ceil(posts * 1.3);
      const rr = seeded(`wal:${cl.def.slug}:${i}`);
      const add = (action, quarks, note, frac) => { if (quarks > 0) spends.push({ workspace: cl.id, action, quarks, note, createdAt: new Date(from.getTime() + span * Math.min(0.97, Math.max(0.03, frac))) }); };
      add('image_generated', QUARK_COSTS.image_generated * Math.ceil(regen / 2), 'Post pictures', 0.3 + rr() * 0.1);
      add('image_generated', QUARK_COSTS.image_generated * Math.floor(regen / 2), 'Post pictures', 0.75 + rr() * 0.1);
      add('campaign_text', QUARK_COSTS.campaign_text * (posts + 4), 'Captions and replies', 0.5 + rr() * 0.1);
      add('photoshoot_image', QUARK_COSTS.photoshoot_image * 8, 'Photoshoot, 8 photos', 0.2 + rr() * 0.3);
      if (i < t.charges.length - 1) add('photoshoot_image', QUARK_COSTS.photoshoot_image * 8, 'Photoshoot, 8 photos', 0.6 + rr() * 0.3);
      for (const v of cl.videos.filter((x) => x.createdAt >= from && x.createdAt < end)) spends.push({ workspace: cl.id, action: 'studio_video', quarks: QUARK_COSTS.studio_video, note: 'Short video', createdAt: v.createdAt });
    });
    spends.sort((a, b) => a.createdAt - b.createdAt).forEach((s, k) => {
      if (plan < s.quarks) throw new Error(`The agency pool would go below zero in month ${i + 1}; lower the spending in build.js.`);
      plan -= s.quarks; used += s.quarks;
      push({ type: 'spend', bucket: 'plan', quarks: -s.quarks, action: s.action, workspace: s.workspace, ref: tagRef(`spend-${i + 1}-${k + 1}`), note: s.note, createdAt: s.createdAt });
    });
  });
  const planExpiresAt = new Date(t.nextCharge.getTime() + 3 * DAY);
  const history = rows.slice(-100).map((r) => ({ action: r.action, amount: r.quarks, cost: r.quarks < 0 ? -r.quarks : 0, description: r.note || r.action, balanceAfter: r.balanceAfter, ref: r.ref, createdAt: r.createdAt, timestamp: r.createdAt }));
  return { rows, credits: { balance: plan, totalUsed: used, planBalance: plan, planExpiresAt, topupBalance: 0, topupHeld: 0, history } };
}

function buildPayments(t) {
  const rows = [];
  t.charges.forEach((at, i) => {
    rows.push({ razorpayOrderId: 'sub_demo_agency_pro_plan', razorpayPaymentId: `pay_demoAgencyProPlan${i + 1}`, amount: chargePaise(PLANS.agency.inr) / 100, currency: 'INR', credits: grantAt(i), status: 'paid', paidAt: at, item: INVOICE_ITEMS.agency || INVOICE_ITEMS.plan, exGstAmount: PLANS.agency.inr, invoiceUrl: '' });
    if (slotsAt(i)) rows.push({ razorpayOrderId: 'sub_demo_agency_pro_slot', razorpayPaymentId: `pay_demoAgencyProSlot${i + 1}`, amount: chargePaise(SLOT_INR) / 100, currency: 'INR', credits: 0, status: 'paid', paidAt: new Date(at.getTime() + 2 * 60000), item: INVOICE_ITEMS.slot, exGstAmount: SLOT_INR, invoiceUrl: '' });
  });
  return rows.sort((a, b) => a.paidAt - b.paidAt);
}

module.exports = { AGENCY, TAG, tagRef, timeline, joinedAt, grantAt, slotsAt, periodOf, assetUrl, ayrshareFor, businessProfileFor, buildClientPosts, snapshotRows, buildWallet, buildPayments, monthsBefore };
