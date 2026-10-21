// The demo brand seed, Stage 2 (plan, Blueprint, calendars, posts, results, daily numbers): pure parts only, no database.
const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');

const K = require('../scripts/demo-brand/constants');
const safety = require('../scripts/demo-brand/safety');
const content = require('../scripts/demo-brand/content');
const perf = require('../scripts/demo-brand/performance');
const planMod = require('../scripts/demo-brand/plan');
const memoryMod = require('../scripts/demo-brand/memory');
const S = require('../services/draftStatus');
const { metricsFromRaw } = require('../services/performance/metrics');
const { OFFLINE_CHANNELS } = require('../config/blueprint');

const NOW = new Date('2026-10-21T06:00:00Z');
const DAY = 86400000;
const BASE = 'http://localhost:5000';
const UID = new mongoose.Types.ObjectId();
const productIds = Object.fromEntries(K.PRODUCTS.map((p) => [p.slug, new mongoose.Types.ObjectId()]));
const built = content.build({ userId: UID, now: NOW, base: BASE, productIds });
const rows = perf.performanceRows({ userId: UID, items: built.performanceItems, now: NOW });
const snaps = perf.snapshotRows({ userId: UID, now: NOW });
const planned = planMod.planRows({ userId: UID, createdAt: new Date('2026-05-06T04:00:00Z'), now: NOW, logoUrl: `${BASE}/demo-assets/zaya/brand/logo.png`, designedBase: (n) => `${BASE}/demo-assets/zaya/blueprint/page-${n}.jpg` });

const model = (n) => require(`../models/${n}`);

test('posts: the Library counts, worked out by the app\'s own status helpers, equal the targets', () => {
  assert.deepStrictEqual(built.summary, { ...content.TARGETS });
  assert.strictEqual(built.drafts.length, Object.values(content.TARGETS).reduce((a, b) => a + b, 0));
  assert.ok(Object.values(built.summary).every((n) => n > 0), 'every view is non-empty');
  // what the Needs approval view lists is exactly the automation posts that wait
  const needs = built.drafts.filter((d) => S.needsApproval(d));
  assert.strictEqual(needs.length, 8);
  assert.ok(needs.every((d) => d.origin === 'automation'));
  const manualWaiting = built.drafts.filter((d) => S.isAwaitingReview(d) && !S.needsApproval(d));
  assert.strictEqual(manualWaiting.length, 4);
  assert.ok(manualWaiting.every((d) => d.origin === 'manual'));
});

test('posts: dates are believable (posted never in the future, scheduled in the next two weeks, bin inside 14 days)', () => {
  const posted = built.drafts.filter((d) => d.status === 'published');
  assert.strictEqual(posted.length, 55);
  assert.ok(posted.every((d) => d.publishedAt.getTime() < NOW.getTime() - 3600 * 1000), 'no posted post is in the future');
  const oldest = Math.min(...posted.map((d) => d.publishedAt.getTime()));
  assert.ok(NOW.getTime() - oldest > 100 * DAY && NOW.getTime() - oldest < 150 * DAY, 'about four months of posting');
  const lastMonth = posted.filter((d) => NOW.getTime() - d.publishedAt.getTime() <= 30 * DAY).length;
  assert.ok(lastMonth >= 12 && lastMonth <= 24, `busier lately, ${lastMonth} in the last month`);
  for (const d of built.drafts.filter((x) => x.status === 'scheduled')) {
    assert.ok(d.scheduledDate > NOW && d.scheduledDate.getTime() <= NOW.getTime() + 14 * DAY, 'scheduled in the next two weeks');
    assert.ok(d.approvedAt && d.plannedDate && d.campaignId);
  }
  for (const d of built.drafts.filter((x) => x.status === 'approved')) assert.ok(d.approvedAt && d.plannedDate > NOW);
  for (const d of built.drafts.filter((x) => x.status === 'binned')) {
    assert.ok(d.binnedAt && d.binnedFrom, 'binned rows say when and from where');
    assert.ok(NOW.getTime() - d.binnedAt.getTime() < 14 * DAY, 'still restorable');
  }
  for (const d of built.drafts.filter((x) => x.status === 'archived')) assert.ok(d.archivedFrom);
  const days = new Set(posted.map((d) => (d.publishedAt.getUTCDay() + 6) % 7));
  assert.ok(days.size >= 5, 'posts spread over the week');
});

test('posts: no base64 anywhere, every picture link is a demo-assets link, provider ids are fake', () => {
  const everything = JSON.stringify({ d: built.drafts, c: built.campaigns, k: built.calendars, r: rows, p: planned });
  assert.ok(!/data:[a-z]+\/[a-z0-9.+-]+;base64/i.test(everything) && !/base64,/i.test(everything), 'no inline pictures');
  const links = [];
  for (const d of built.drafts) { links.push(d.imageUrl, ...d.carouselSlides.map((s) => s.imageUrl)); }
  for (const c of built.campaigns) links.push(...c.creative.imageUrls);
  for (const k of built.calendars) links.push(k.coverImageUrl);
  for (const r of rows) links.push(...r.assets.images, ...r.assets.thumbnails);
  links.push(...planned.blueprint.designed.pages.map((p) => p.imageUrl));
  assert.ok(links.length > 200);
  for (const u of links) assert.ok(u.startsWith(`${BASE}${safety.ASSET_PATH}/`), u);
  const ids = built.campaigns.map((c) => c.socialPostId);
  assert.strictEqual(new Set(ids).size, ids.length);
  assert.ok(ids.every((i) => /^demo-zaya-post-\d+$/.test(i)));
  for (const c of built.campaigns) assert.ok(Object.values(c.socialPostIds).every((i) => i.startsWith('demo-zaya-post-')));
  assert.ok(rows.every((r) => r.postId.startsWith('demo-zaya-post-')));
  // every scheduled and posted post links to a real campaign and the markers match what `remove` deletes
  const campaignIds = new Set(built.campaigns.map((c) => String(c._id)));
  for (const d of built.drafts.filter((x) => ['scheduled', 'published'].includes(x.status))) assert.ok(campaignIds.has(String(d.campaignId)));
  assert.ok(built.drafts.every((d) => safety.hasMarker('Draft', d)));
  assert.ok(built.campaigns.every((c) => safety.hasMarker('Campaign', c)));
  assert.ok(built.calendars.every((k) => safety.hasMarker('ContentCalendar', k)));
  assert.ok(rows.every((r) => safety.hasMarker('AIContentPerformance', r)));
  assert.ok(safety.hasMarker('Blueprint', planned.plan) && safety.hasMarker('Blueprint', planned.blueprint));
});

test('every built row passes the real Mongoose schema', () => {
  const check = (name, list) => list.forEach((row, i) => { const e = new (model(name))(row).validateSync(); assert.ok(!e, `${name} ${i}: ${e && e.message}`); });
  check('Draft', built.drafts);
  check('Campaign', built.campaigns);
  check('ContentCalendar', built.calendars);
  check('AIContentPerformance', rows);
  check('SocialSnapshot', snaps);
  check('Blueprint', [planned.plan, planned.blueprint]);
});

test('calendars: four finished months and the current one, each with a local cover and its posts', () => {
  assert.deepStrictEqual(built.calendars.map((k) => k.month), ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
  assert.ok(built.calendars.every((k) => k.coverStatus === 'ready' && k.approved && k.themeSummary));
  assert.ok(built.calendars.filter((k) => k.weeks.length > 0).length >= 4, 'months with items');
  const items = built.calendars.flatMap((k) => k.weeks.flatMap((w) => w.items));
  assert.ok(items.length >= 25);
  assert.ok(items.some((i) => i.status === 'published') && items.some((i) => i.status === 'scheduled'));
  for (const d of built.drafts.filter((x) => x.contentCalendarId)) assert.ok(built.calendars.some((k) => String(k._id) === String(d.contentCalendarId)));
});

test('results: figures sit in the service\'s own shape and tell the story (reels ahead, Fridays and Sundays, evenings)', () => {
  assert.ok(rows.length >= 55);
  for (const r of rows) {
    assert.deepStrictEqual(r.metrics, metricsFromRaw(r.rawAnalytics, r.platform), 'metrics come from the raw answer');
    assert.ok(r.metrics.likes > 0 && r.metrics.reach > 0 && r.metrics.comments >= 0);
    assert.ok(r.publishedAt.getTime() < NOW.getTime() && r.measuredAt.getTime() <= NOW.getTime());
  }
  const ig = rows.filter((r) => r.platform === 'instagram');
  const avg = (xs) => xs.reduce((a, r) => a + r.metrics.likes, 0) / Math.max(1, xs.length);
  const ratio = avg(ig.filter((r) => r.contentType === 'reel')) / avg(ig.filter((r) => r.contentType === 'post'));
  assert.ok(ratio > 1.8 && ratio < 3.6, `reels about 2.5 times image posts, got ${ratio.toFixed(2)}`);
  const er = ig.map((r) => r.metrics.engagementRate);
  assert.ok(er.every((x) => x > 0.5 && x < 10));
  const tiers = new Set(rows.map((r) => r.learning.tier));
  assert.ok(tiers.has('winner') && tiers.has('low'));
  const last30 = rows.filter((r) => NOW.getTime() - r.publishedAt.getTime() <= 30 * DAY);
  assert.ok(last30.length >= 8, 'enough recent posts for findings (at least 5 measured, 8 for timing)');
});

test('daily numbers: 181 days for every connected platform, ending on the stored followers, growing', () => {
  assert.strictEqual(snaps.length, perf.WINDOW_DAYS + 1);
  assert.ok(snaps.every((s, i) => i === 0 || s.date > snaps[i - 1].date), 'oldest first, one per day');
  const last = snaps[snaps.length - 1];
  const stored = { instagram: 34280, facebook: 12940, youtube: 3870, linkedin: 1460 };
  for (const [p, n] of Object.entries(stored)) {
    assert.strictEqual(last.platforms[p].followers, n, p);
    assert.ok(snaps[0].platforms[p].followers < n * 0.6, `${p} grew a lot over 180 days`);
  }
  assert.ok(last.platforms.instagram.engagementRate >= 3 && last.platforms.instagram.engagementRate <= 6.1);
  assert.ok(last.platforms.instagram.reach > 50000);
  const month = snaps[snaps.length - 31].platforms.instagram.followers;
  assert.ok(last.platforms.instagram.followers / month > 1.03 && last.platforms.instagram.followers / month < 1.15, 'a believable month of growth');
});

test('plan: the stored shape carries every level, with offline channels tagged Suggested', () => {
  const plan = planned.plan.result.plan;
  assert.strictEqual(plan.pillars.length, 5);
  assert.strictEqual(plan.calendar.length, 30);
  assert.strictEqual(plan.icp.who.length, 3, 'three customer segments');
  assert.ok(plan.channels.length >= 3 && plan.effort.length === plan.channels.length);
  assert.strictEqual(plan.roadmap.length, 3);
  assert.ok(plan.metrics.length >= 3 && plan.metrics.length <= 5);
  const allowed = OFFLINE_CHANNELS.map((o) => o.id);
  assert.ok(plan.offline.length >= 1 && plan.offline.length <= 3 && plan.offline.every((o) => allowed.includes(o.id) && o.mode === 'offline' && o.reason.tag === 'proposed' && o.youDo.every((y) => y.tag === 'proposed')));
  assert.strictEqual(plan.mix.offline, plan.offline.length);
  assert.strictEqual(plan.mix.online, plan.channels.length);
  assert.ok(plan.mix.channels.some((c) => c.mode === 'offline') && plan.mix.channels.some((c) => c.mode === 'online'));
  assert.strictEqual(planned.plan.kind, 'plan');
  assert.strictEqual(planned.plan.status, 'completed');
  assert.ok(planned.plan.completedAt < NOW);
  assert.strictEqual(planned.plan.result.pages.length, 9);
  // the Blueprint: free summary with its designed edition, made soon after sign-up
  assert.strictEqual(planned.blueprint.kind, 'blueprint');
  assert.ok(planned.blueprint.completedAt.getTime() - new Date('2026-05-06T04:00:00Z').getTime() < 2 * 3600 * 1000);
  assert.strictEqual(planned.blueprint.designed.status, 'completed');
  assert.strictEqual(planned.blueprint.designed.pages.length, planned.deck.length);
});

test('memory: the summary groups learned items by source (the items themselves come from the app\'s runner)', () => {
  const s = memoryMod.summarise({ learnedItems: [{ source: 'plan' }, { source: 'plan' }, { source: 'results' }], learnedSources: { plan: { state: 'learned', evidenceCount: 4, itemCount: 2 } } });
  assert.deepStrictEqual(s.bySource, { plan: 2, results: 1 });
  assert.strictEqual(s.items, 3);
  assert.strictEqual(memoryMod.summarise(null).items, 0);
});
