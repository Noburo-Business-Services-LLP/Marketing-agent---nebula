'use strict';
/**
 * The demo brand's posts and calendars: about 90 Drafts in every state, the Campaigns behind scheduled and posted ones,
 * and five monthly ContentCalendars (four done, the current month in progress). Pure: no database, no network.
 *
 *   needs approval 8 (automation, waiting for a yes)      drafts 4 (made by hand, not finished)
 *   approved 4        scheduled 10 (next two weeks)        posted 55 (about four months back, never in the future)
 *   archived 6        bin 3 (restorable for 14 days)
 *
 * Every picture is drawn locally (a poster per post: product, headline, brand colours, 4:5) and stored as a link to
 * <asset base>/demo-assets/zaya/posts/... Never base64. Every Campaign carries a fake provider post id
 * `demo-zaya-post-<n>`; the demo guard (services/demoProfile.js) answers every provider call for this account offline.
 */
const mongoose = require('mongoose');
const images = require('./images');
const { seeded } = images;
const perf = require('./performance');
const bank = require('./contentBank');
const { BRAND, PRODUCTS } = require('./constants');
const { assetUrl } = require('./safety');

const DAY = 86400000;
const IST = 330 * 60000;
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const TARGETS = Object.freeze({ needsApproval: 8, drafts: 4, approved: 4, scheduled: 10, posted: 55, archived: 6, binned: 3 });
const POSTER_SIZE = { width: 864, height: 1080 };

const bySlug = Object.fromEntries(PRODUCTS.map((p) => [p.slug, p]));
const ENDERS = ['Vanakkam from the Zaya studio.', 'Azhagu starts with a simple ritual.', 'Romba nandri for being part of this.', 'Paati would approve.', 'Semma glow, simple steps.'];

// ---- date helpers (India time)
const istParts = (d) => { const x = new Date(d.getTime() + IST); return { y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate(), wd: (x.getUTCDay() + 6) % 7 }; };
const stamp = (y, m, d, h = 12, mi = 0) => new Date(Date.UTC(y, m - 1, d, h, mi) - IST);
const monthKey = (d) => { const p = istParts(d); return `${p.y}-${String(p.m).padStart(2, '0')}`; };

function shuffle(list, r) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i -= 1) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ---- the words
const firstWord = (ing) => String(ing).toLowerCase().split(/[\s(]/)[0].replace(/-based$/, '');
const ingredientLine = (ing) => bank.INGREDIENT_LINES[firstWord(ing)] || `${ing}.`;

/** The 56 per-product posts (7 for each of the 8 products). */
function productSpecs() {
  const out = [];
  PRODUCTS.forEach((p, i) => {
    const L = bank.PRODUCT_LINES[p.slug];
    const tags = (extra) => ['#ZayaNaturals', `#${L.short.replace(/\s+/g, '')}`, ...extra];
    const ender = (n) => ENDERS[(i + n) % ENDERS.length];
    out.push({ key: `${p.slug}-ritual`, pillar: 'Ritual and ingredients', fmt: 'image', product: p.slug, head: `${L.when}: ${L.short}`, title: `The ${L.short} ritual`,
      caption: `${L.when} ritual: ${p.name}.\n${L.how}\n${p.benefits[0]}, made in small batches in Chennai.${i % 2 ? `\n${ender(0)}` : ''}`, tags: tags(['#AyurvedaSkincare', '#SkincareRitual']), cta: 'shop_now', theme: 'Ritual' });
    out.push({ key: `${p.slug}-inside`, pillar: 'Ritual and ingredients', fmt: 'carousel', product: p.slug, head: `What is inside ${L.short}`, title: `What is inside ${p.name}`,
      caption: `Swipe to see what is inside ${p.name}, in plain words:\n${p.ingredients.slice(0, 4).map(ingredientLine).join('\n')}\nEvery ingredient is named on the label, with where it comes from.`, tags: tags(['#IngredientStory', '#CleanBeauty']), cta: 'learn_more', theme: 'Ingredients' });
    out.push({ key: `${p.slug}-howto`, pillar: 'Skin education', fmt: 'reel', product: p.slug, head: `How to use ${L.short}`, title: `How to use ${p.name} in 30 seconds`,
      caption: `How to use ${p.name} in thirty seconds.\n${L.how}\nSave this reel for your next routine.${i % 3 === 0 ? `\n${ender(1)}` : ''}`, tags: tags(['#SkincareHowTo', '#ReelsIndia']), cta: 'shop_now', theme: 'How to' });
    out.push({ key: `${p.slug}-story`, pillar: 'Customer glow stories', fmt: 'image', product: p.slug, head: `"${L.quote.split('.')[0]}."`, title: `${L.person.split(',')[0]} on ${L.short}`,
      caption: `"${L.quote}"\n${L.person}, shared with her permission.\nThank you for the kind words. ${ender(2)}`, tags: tags(['#CustomerLove', '#GlowStories']), cta: '', theme: 'Customer story' });
    out.push({ key: `${p.slug}-offer`, pillar: 'Offers and festivals', fmt: 'image', product: p.slug, head: L.offer.split('.')[0], title: `Offer: ${L.short}`,
      caption: `${L.offer}\nNo code needed. Shipping across India.`, tags: tags(['#Offer', '#ShopSmall']), cta: 'shop_now', theme: 'Offer' });
    out.push({ key: `${p.slug}-myth`, pillar: 'Skin education', fmt: 'carousel', product: p.slug, head: `Myth: ${L.myth.replace(/\.$/, '')}`, title: `Myth or fact: ${L.short}`,
      caption: `Myth: ${L.myth}\nFact: ${L.fact}\nSwipe for the full answer and save it for later.`, tags: tags(['#MythVsFact', '#SkinEducation']), cta: 'learn_more', theme: 'Myth or fact' });
    out.push({ key: `${p.slug}-batch`, pillar: 'Founder story', fmt: 'reel', product: p.slug, head: `Batch day: ${L.short}`, title: `Behind the batch: ${L.short}`,
      caption: `${L.batch}\nEvery batch is poured and labelled by hand in Chennai.${i % 2 === 0 ? `\n${ender(3)}` : ''}`, tags: tags(['#BehindTheScenes', '#HandMade']), cta: '', theme: 'Behind the scenes' });
  });
  return out;
}

const cap = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Everything the seed can post, tagged by when it fits. */
function allSpecs() {
  return {
    any: [...productSpecs(), ...bank.FOUNDER, ...bank.EDUCATION],
    past: bank.PAST_SEASONAL,
    soon: bank.SOON
  };
}

// ---- the plan of the 90 posts: which spec gets which state and date
function assign(now) {
  const r = seeded('zaya-stage2-assign');
  const { any, past, soon } = allSpecs();
  const reels = shuffle(any.filter((s) => s.fmt === 'reel'), r);
  const others = shuffle(any.filter((s) => s.fmt !== 'reel'), r);
  const T = istParts(now);
  const out = [];
  const add = (spec, status, fields) => out.push({ spec, status, ...fields });

  // posted: 8 seasonal on their own days + 47 spread over the last 140 days, busier lately
  const postedAny = shuffle([...reels.splice(0, 17), ...others.splice(0, 30)], r);
  const slots = Array.from({ length: postedAny.length }, (_, i) => {
    const t = (i + 0.5) / postedAny.length;
    let daysAgo = 1 + Math.floor(140 * ((1 - t) ** 1.12));
    if (r() < 0.45) { // nudge to the nearest Friday or Sunday, never into the future
      const at = new Date(now.getTime() - daysAgo * DAY);
      const wd = istParts(at).wd;
      const shifts = [4 - wd, 6 - wd, -1 - wd, -3 - wd].sort((a, b) => Math.abs(a) - Math.abs(b));
      const shift = shifts[0];
      daysAgo = Math.max(1, daysAgo - shift);
    }
    return daysAgo;
  }).sort((a, b) => b - a);
  const hourFor = (reel) => { const x = r(); return reel ? (x < 0.65 ? [19, 20, 21][Math.floor(r() * 3)] : x < 0.85 ? 13 : 9) : (x < 0.5 ? [19, 20, 21][Math.floor(r() * 3)] : x < 0.75 ? 9 : 14); };
  postedAny.forEach((spec, i) => {
    const day = istParts(new Date(now.getTime() - slots[i] * DAY));
    add(spec, 'published', { at: stamp(day.y, day.m, day.d, hourFor(spec.fmt === 'reel'), [0, 15, 30, 45][Math.floor(r() * 4)]) });
  });
  past.forEach((spec) => {
    const [mm, dd] = spec.md.split('-').map(Number);
    let y = T.y;
    if (stamp(y, mm, dd, 19, 0) > new Date(now.getTime() - DAY)) y -= 1;
    add(spec, 'published', { at: stamp(y, mm, dd, 19, 30) });
  });
  // scheduled: 8 festive + 2 from the pool, over the next two weeks
  const offsets = [1, 2, 3, 5, 6, 8, 9, 10, 12, 13];
  const hours = [19, 9, 20, 19, 13, 20, 19, 9, 20, 19];
  const sched = soon.filter((s) => s.group === 'scheduled');
  const seq = [sched[0], sched[1], reels.shift(), sched[2], sched[3], sched[4], others.shift(), sched[5], sched[6], sched[7]];
  seq.forEach((spec, i) => {
    const d = istParts(new Date(now.getTime() + offsets[i] * DAY));
    add(spec, 'scheduled', { at: stamp(d.y, d.m, d.d, hours[i], i % 2 ? 30 : 0) });
  });
  // needs approval: 5 festive + 3 from the pool (automation)
  const waiting = [...soon.filter((s) => s.group === 'approval'), ...others.splice(0, 3)];
  waiting.forEach((spec, i) => {
    const d = istParts(new Date(now.getTime() + [2, 4, 6, 7, 9, 10, 12, 14][i] * DAY));
    add(spec, i % 4 === 3 ? 'draft' : 'completed', { at: stamp(d.y, d.m, d.d, 19, 0), origin: 'automation' });
  });
  // approved: 4 waiting to be scheduled
  others.splice(0, 4).forEach((spec, i) => {
    const d = istParts(new Date(now.getTime() + [3, 5, 7, 11][i] * DAY));
    add(spec, 'approved', { at: stamp(d.y, d.m, d.d, 19, 0), origin: i < 2 ? 'automation' : 'manual' });
  });
  // drafts made by hand
  others.splice(0, 4).forEach((spec) => add(spec, 'draft', { origin: 'manual' }));
  // archived (6) and bin (3)
  const arch = others.splice(0, 6);
  arch.forEach((spec, i) => add(spec, 'archived', { origin: i % 2 ? 'manual' : 'automation', from: i < 4 ? 'draft' : 'approved', ageDays: 25 + i * 9 }));
  others.splice(0, 3).forEach((spec, i) => add(spec, 'binned', { origin: i === 1 ? 'manual' : 'automation', from: i === 2 ? 'approved' : 'draft', ageDays: [2, 6, 11][i] }));
  return { items: out, left: { reels: reels.length, others: others.length } };
}

/**
 * The full build. `productIds`: slug -> ObjectId. `videoUrls`: slug -> link of that product's locally made video (Stage 3; reels
 * of a product that has one point at it, the rest have none). `base`: the asset base. Returns { drafts, campaigns, calendars,
 * posters, performanceItems, summary }. Rows are plain objects ready for validateSync / insertMany.
 */
function build({ userId, now, base, productIds, videoUrls = {} }) {
  const r = seeded('zaya-stage2-rows');
  const { items, left } = assign(now);
  if (left.reels || left.others) throw new Error(`content pool left over: ${JSON.stringify(left)}`);
  const OID = () => new mongoose.Types.ObjectId();
  const posterRel = (key) => `posts/${key}.jpg`;
  const posters = new Map();

  // calendars for the current month and the four before it
  const T = istParts(now);
  const months = Array.from({ length: 5 }, (_, i) => { const idx = T.y * 12 + (T.m - 1) - (4 - i); return { y: Math.floor(idx / 12), m: (idx % 12) + 1 }; });
  const THEMES = { 6: 'Summer glow: sun care and light routines', 7: 'Monsoon care: hair, humidity and calm skin', 8: 'Festive season begins: Onam and Raksha Bandhan', 9: 'Ritual season: Ganesh Chaturthi and the Navratri build-up', 10: 'Navratri to Diwali: gifting begins' };
  const calendars = months.map((mo, i) => ({
    id: OID(), month: `${mo.y}-${String(mo.m).padStart(2, '0')}`, y: mo.y, m: mo.m, name: MONTH_NAMES[mo.m - 1], variant: i,
    theme: THEMES[mo.m] || `${MONTH_NAMES[mo.m - 1]}: rituals and stories`, items: [], current: i === 4
  }));
  const calendarFor = (d) => calendars.find((c) => c.month === monthKey(d)) || null;

  const drafts = []; const campaigns = []; const performanceItems = [];
  let postNo = 0;
  const ordered = items.slice().sort((a, b) => ((a.at && a.at.getTime()) || 0) - ((b.at && b.at.getTime()) || 0));
  for (const it of ordered) {
    const s = it.spec;
    const product = bySlug[s.product] || bySlug[PRODUCTS[0].slug];
    const productId = productIds ? productIds[product.slug] : null;
    const rel = posterRel(s.key);
    if (!posters.has(rel)) posters.set(rel, () => images.posterJpg(product, s.head, POSTER_SIZE));
    const imageUrl = assetUrl(base, rel);
    const slides = s.fmt === 'carousel' ? [imageUrl, assetUrl(base, `products/${product.slug}-2.jpg`), assetUrl(base, `products/${product.slug}-1.jpg`)] : [];
    const origin = it.origin || (it.status === 'published' || it.status === 'scheduled' ? (r() < 0.55 ? 'automation' : 'manual') : 'manual');
    const status = it.status === 'published' ? 'published' : it.status;
    const at = it.at || null;
    const onFb = r() < 0.6;
    const platforms = ['instagram', ...(onFb ? ['facebook'] : []), ...(s.fmt === 'reel' && r() < 0.3 ? ['youtube'] : []), ...(s.pillar === 'Founder story' && s.fmt !== 'reel' && r() < 0.6 ? ['linkedin'] : [])];
    const id = OID();
    const caption = s.caption;
    const tags = s.tags.slice(0, 6);
    const day = at ? istParts(at) : null;
    const cal = origin === 'automation' && at ? calendarFor(at) : null;
    const createdAt = at && (status === 'published') ? new Date(at.getTime() - (1 + Math.floor(r() * 3)) * DAY) :
      status === 'scheduled' || status === 'approved' ? new Date(now.getTime() - (2 + Math.floor(r() * 4)) * DAY) :
        status === 'archived' || status === 'binned' ? new Date(now.getTime() - (it.ageDays + 12) * DAY) :
          new Date(now.getTime() - (0.4 + r() * 1.6) * DAY);
    const draft = {
      _id: id, userId, title: cap(s.title, 120), caption, hashtags: tags, cta: s.cta === 'shop_now' ? 'Shop now on our website' : s.cta === 'learn_more' ? 'Learn more' : '',
      imageUrl, imageText: s.head, creativeConcept: `${product.name} on a brand-colour backdrop`, visualTreatment: 'plum, rose gold, cream and sage', platforms,
      language: 'English', tone: 'Warm and knowledgeable', objective: s.pillar === 'Offers and festivals' ? 'sales' : s.pillar === 'Customer glow stories' ? 'engagement' : 'awareness',
      status, origin, sourceType: origin === 'automation' ? 'calendar' : s.fmt === 'reel' ? 'reel' : s.fmt === 'carousel' ? 'carousel' : 'post',
      contentType: s.fmt === 'reel' ? 'reel' : s.fmt === 'carousel' ? 'carousel' : 'post', theme: cap(s.theme || '', 60),
      carouselSlides: slides.map((u, n) => ({ order: n + 1, role: ['hook', 'build', 'payoff'][n], headline: n === 0 ? s.head : [product.name, 'Shop the ritual'][n - 1], imageText: n === 0 ? s.head : '', imageUrl: u })),
      createdAt, updatedAt: createdAt
    };
    const videoUrl = s.fmt === 'reel' ? (videoUrls[product.slug] || '') : '';
    if (videoUrl) draft.creative = { type: 'reel', videoUrl };
    if (cal && day) { draft.contentCalendarId = cal.id; draft.calendarWeek = Math.min(6, Math.ceil(day.d / 7)); draft.calendarDay = day.d; }
    else if (origin === 'automation' && day) { draft.calendarDay = day.d; }
    if (status === 'published') {
      Object.assign(draft, { publishedAt: at, publishedPlatforms: platforms, scheduledDate: at, approvedAt: origin === 'automation' ? new Date(at.getTime() - 20 * 3600 * 1000 - r() * 2 * DAY) : null, plannedDate: origin === 'automation' ? at : null, updatedAt: at });
    } else if (status === 'scheduled') {
      Object.assign(draft, { scheduledDate: at, plannedDate: at, approvedAt: new Date(now.getTime() - (0.3 + r() * 1.5) * DAY) });
    } else if (status === 'approved') {
      Object.assign(draft, { plannedDate: at, approvedAt: new Date(now.getTime() - (0.2 + r() * 1.2) * DAY) });
    } else if (status === 'completed' || (status === 'draft' && origin === 'automation')) {
      draft.plannedDate = at;
    } else if (status === 'archived') {
      Object.assign(draft, { archivedFrom: it.from, updatedAt: new Date(now.getTime() - it.ageDays * DAY) });
    } else if (status === 'binned') {
      Object.assign(draft, { binnedAt: new Date(now.getTime() - it.ageDays * DAY), binnedFrom: it.from, updatedAt: new Date(now.getTime() - it.ageDays * DAY) });
    }
    // the Campaign behind a scheduled or posted post
    if (status === 'published' || status === 'scheduled') {
      postNo += 1;
      const campaignId = OID();
      const providerId = `demo-zaya-post-${postNo}`;
      const postIds = Object.fromEntries(platforms.map((p, n) => [p, n === 0 ? providerId : `${providerId}-${p === 'facebook' ? 'fb' : p === 'youtube' ? 'yt' : 'li'}`]));
      const posted = status === 'published';
      const numbers = posted ? perf.numbersFor({ key: s.key, format: s.fmt, platforms, publishedAt: at }, now) : null;
      const totals = numbers ? perf.totalsOf(numbers) : null;
      campaigns.push({
        _id: campaignId, userId, name: cap(s.title, 120), objective: draft.objective === 'sales' ? 'sales' : draft.objective, platforms, status: posted ? 'posted' : 'scheduled',
        priority: 'medium', notes: '', selectedProducts: productId ? [productId] : [], tone: 'warm', aiGenerated: origin === 'automation',
        creative: { type: s.fmt === 'reel' ? 'reel' : s.fmt === 'carousel' ? 'carousel' : 'image', textContent: caption, imageUrls: slides.length ? slides : [imageUrl], videoUrl, captions: caption, hashtags: tags, callToAction: s.cta },
        scheduling: { startDate: at, postTime: new Date(at.getTime() + IST).toISOString().slice(11, 16), timezone: 'Asia/Kolkata', frequency: 'once' },
        targeting: { demographics: '', ageRange: { min: 18, max: 55 }, gender: 'all', locations: ['India'], interests: ['skincare', 'ayurveda'] },
        budget: { amount: 0, total: 0, daily: 0, spent: 0, currency: 'INR' },
        performance: totals ? { impressions: totals.impressions, clicks: 0, ctr: 0, engagement: totals.engagement, reach: totals.reach, likes: totals.likes, comments: totals.comments, shares: totals.shares, conversions: 0, spend: 0 } : undefined,
        socialPostId: providerId, socialPostIds: postIds, instagramPostId: providerId,
        scheduledFor: at, publishedAt: posted ? at : null, ayrshareStatus: posted ? 'success' : 'scheduled', ayrshareCheckedAt: posted ? new Date(Math.min(now.getTime(), at.getTime() + 600000)) : null,
        publishResult: { status: posted ? 'success' : 'scheduled', demo: true, postIds: platforms.map((p) => ({ platform: p, status: 'success', id: postIds[p] })) },
        createdAt, updatedAt: posted ? at : createdAt
      });
      draft.campaignId = campaignId;
      if (posted) performanceItems.push({ key: s.key, id: s.key, campaignId, productId, productName: product.name, category: product.category, format: s.fmt, platforms, publishedAt: at, caption, hashtags: tags, cta: draft.cta, tone: 'warm', postId: postIds, thumbnail: imageUrl, numbers });
    }
    // the calendar item for automation posts
    if (cal && day) {
      const calStatus = status === 'published' ? 'published' : status === 'scheduled' ? 'scheduled' : status === 'approved' ? 'approved' : 'generated';
      cal.items.push({ day: day.d, format: s.fmt === 'carousel' ? 'carousel' : s.fmt === 'reel' ? 'reel' : 'post', contentPillar: s.pillar, headline: s.head, creativeConcept: `${product.name} on a brand-colour backdrop`,
        productNeeded: product.name, shootType: 'product', cta: draft.cta, objective: draft.objective, status: calStatus, generatedCampaignId: draft.campaignId || null, scheduledFor: at });
    }
    drafts.push(draft);
  }

  // calendars: weeks of items, the cover, the state
  const calendarRows = calendars.map((c) => {
    const weeks = [];
    for (const item of c.items.sort((a, b) => a.day - b.day)) {
      const n = Math.min(6, Math.ceil(item.day / 7));
      let w = weeks.find((x) => x.weekNumber === n);
      if (!w) { w = { weekNumber: n, items: [] }; weeks.push(w); }
      w.items.push(item);
    }
    const rel = `calendar/${c.month}.jpg`;
    posters.set(rel, () => images.calendarCoverJpg(c.name, c.theme, c.variant));
    const generatedAt = stamp(c.y, c.m, 1, 8, 0);
    return {
      _id: c.id, userId, businessName: BRAND.name, niche: BRAND.niche, businessVertical: 'Beauty & Wellness', businessType: 'B2C', language: 'English', month: c.month,
      autoGenerate: true, autoGenerateLimit: 7, autoGeneratedCount: c.items.length, approved: true, weeks, themeTitle: c.theme.split(':')[0], themeSummary: c.theme,
      coverImageUrl: assetUrl(base, rel), coverImagePrompt: `${c.name}: ${c.theme}`, coverStatus: 'ready', generatedAt, lastAutoRunAt: c.current ? new Date(now.getTime() - DAY) : stamp(c.y, c.m, 28, 6, 0),
      createdAt: generatedAt, updatedAt: c.current ? now : stamp(c.y, c.m, 28, 6, 0)
    };
  });

  return { drafts, campaigns, calendars: calendarRows, posters, performanceItems, summary: summaryOf(drafts) };
}

/** Library counts for a built set, worked out with the app's own status helpers (the same rules GET /drafts/counts uses). */
function summaryOf(drafts) {
  const S = require('../../services/draftStatus');
  const c = { needsApproval: 0, drafts: 0, approved: 0, scheduled: 0, posted: 0, archived: 0, binned: 0 };
  for (const d of drafts) {
    if (S.needsApproval(d)) c.needsApproval += 1;
    else if (S.isAwaitingReview(d)) c.drafts += 1;
    else if (d.status === 'approved') c.approved += 1;
    else if (d.status === 'scheduled') c.scheduled += 1;
    else if (d.status === 'published') c.posted += 1;
    else if (d.status === 'archived') c.archived += 1;
    else if (d.status === 'binned') c.binned += 1;
  }
  return c;
}

module.exports = { TARGETS, productSpecs, allSpecs, assign, build, summaryOf };
