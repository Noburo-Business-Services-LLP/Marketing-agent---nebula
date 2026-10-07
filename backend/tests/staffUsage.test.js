// The Usage numbers: pure builder with fixtures. Feature use, sign-up funnel, Quarks by category, top feature per plan.
const test = require('node:test');
const assert = require('node:assert');
const { buildUsage, categoryOf, CATEGORIES, FEATURES, parseWindow, FUNNEL_STEPS } = require('../services/staff/usage');
const { quarkTotals } = require('../services/staff/money');
const { QUARK_COSTS } = require('../config/apiCosts');

const NOW = new Date('2026-10-07T06:30:00Z').getTime(); // month started 30 Sep 18:30 UTC (6.5 days ago)
const DAY = 86400000;
const ago = (d) => new Date(NOW - d * DAY);
const mk = (id, over = {}) => ({ _id: id, email: `${id}@x.com`, companyName: `Co ${id}`, createdAt: ago(60), onboardingCompleted: true, payments: [], plan: { tier: 'free', addons: [], subscriptions: [] }, credits: { balance: 100, history: [] }, ...over });
const rows = (o) => Object.entries(o).map(([k, n]) => ({ _id: k, n }));
const emptyUsage = () => ({ images: [], postsDrafted: [], postsPublished: [], videos: [], heroVideos: [], blueprints: [], repliesDrafted: [] });
const item = (u, key) => u.featureUse.items.find((i) => i.key === key);
const step = (u, key) => u.funnel.steps.find((s) => s.key === key);

test('feature use counts items over the last 30 days and the distinct clients behind them', () => {
  const users = [mk('a'), mk('b'), mk('c')];
  const usage = { ...emptyUsage(), images: rows({ a: 5, b: 2 }), postsDrafted: rows({ a: 3 }), videos: rows({ c: 1 }) };
  const u = buildUsage({ users, usage, now: NOW });
  assert.deepStrictEqual([item(u, 'images').count, item(u, 'images').clients], [7, 2]);
  assert.deepStrictEqual([item(u, 'postsDrafted').count, item(u, 'postsDrafted').clients], [3, 1]);
  assert.deepStrictEqual([item(u, 'videos').count, item(u, 'videos').clients], [1, 1]);
  assert.deepStrictEqual([item(u, 'blueprints').count, item(u, 'blueprints').clients], [0, 0]);
  assert.deepStrictEqual(u.featureUse.items.map((i) => i.key), FEATURES.map((f) => f.key));
  assert.strictEqual(u.featureUse.customers, 3);
  assert.strictEqual(u.featureUse.days, 30);
});

test('staff, CSM and hidden test accounts never count, even when they have usage rows', () => {
  const users = [mk('a'), mk('h', { isHidden: true }), mk('s', { staffRole: 'owner' }), mk('m', { isCsm: true })];
  const usage = { ...emptyUsage(), images: rows({ a: 1, h: 10, s: 10, m: 10 }), repliesDrafted: rows({ h: 4 }) };
  const u = buildUsage({ users, usage, now: NOW });
  assert.deepStrictEqual([item(u, 'images').count, item(u, 'images').clients], [1, 1]);
  assert.strictEqual(item(u, 'repliesDrafted').count, 0);
  assert.strictEqual(u.featureUse.customers, 1);
});

test('a source that could not be read says so plainly and does not invent a number', () => {
  const users = [mk('a')];
  const u = buildUsage({ users, usage: { ...emptyUsage(), images: rows({ a: 1 }) }, unavailable: { videos: 'We could not read the video jobs right now.' }, now: NOW });
  const v = item(u, 'videos');
  assert.strictEqual(v.available, false);
  assert.strictEqual(v.reason, 'We could not read the video jobs right now.');
  assert.strictEqual(v.count, undefined);
  assert.strictEqual(item(u, 'images').available, true);
});

test('funnel counts the clients who signed up in the window and how many reached each later step', () => {
  const users = [
    mk('a', { createdAt: ago(5) }),                                                   // everything, paying
    mk('b', { createdAt: ago(10), onboardingCompleted: false }),                      // signed up only
    mk('c', { createdAt: ago(20), connectedSocials: [{ platform: 'instagram' }] }),   // onboarded, content, connected
    mk('d', { createdAt: ago(60) }),                                                  // outside 30 days, inside 90
    mk('h', { createdAt: ago(3), isHidden: true })                                    // hidden: never counted
  ];
  users[0].connectedSocials = [{ platform: 'instagram' }];
  users[0].payments = [{ status: 'paid' }];
  const funnelData = { contentIds: ['a', 'c', 'd'], publishedIds: ['a'] };
  const u30 = buildUsage({ users, usage: emptyUsage(), funnelData, window: 30, now: NOW });
  assert.deepStrictEqual(u30.funnel.steps.map((s) => s.key), FUNNEL_STEPS.map((s) => s.key));
  assert.deepStrictEqual(u30.funnel.steps.map((s) => s.count), [3, 2, 2, 2, 1, 1]);
  assert.strictEqual(u30.funnel.days, 30);
  const u90 = buildUsage({ users, usage: emptyUsage(), funnelData, window: 90, now: NOW });
  assert.strictEqual(step(u90, 'signedUp').count, 4);
  assert.strictEqual(u90.funnel.days, 90);
});

test('funnel steps are nested: a client counts at a step only after every step before it', () => {
  // paid and published but never finished onboarding (a client set up by hand)
  const users = [mk('a', { createdAt: ago(5), onboardingCompleted: false, payments: [{ status: 'paid' }], connectedSocials: [{ platform: 'x' }] })];
  const u = buildUsage({ users, usage: emptyUsage(), funnelData: { contentIds: ['a'], publishedIds: ['a'] }, window: 30, now: NOW });
  assert.deepStrictEqual(u.funnel.steps.map((s) => s.count), [1, 0, 0, 0, 0, 0]);
  // ...but the raw "reached this step at all" is kept for the table
  assert.deepStrictEqual(u.funnel.steps.map((s) => s.reached), [1, 0, 1, 1, 1, 1]);
});

test('funnel conversion is whole percent of the previous step and of sign-ups, null when there is nothing to divide by', () => {
  const users = [mk('a', { createdAt: ago(2) }), mk('b', { createdAt: ago(2) }), mk('c', { createdAt: ago(2), onboardingCompleted: false })];
  const u = buildUsage({ users, usage: emptyUsage(), funnelData: { contentIds: ['a'], publishedIds: [] }, window: 30, now: NOW });
  assert.deepStrictEqual([step(u, 'signedUp').fromPrevious, step(u, 'signedUp').fromStart], [null, 100]);
  assert.deepStrictEqual([step(u, 'onboarded').fromPrevious, step(u, 'onboarded').fromStart], [67, 67]);
  assert.deepStrictEqual([step(u, 'firstContent').fromPrevious, step(u, 'firstContent').fromStart], [50, 33]);
  assert.deepStrictEqual([step(u, 'connected').fromPrevious, step(u, 'connected').fromStart], [0, 0]);
  assert.deepStrictEqual([step(u, 'published').fromPrevious, step(u, 'published').fromStart], [null, 0]); // previous step is empty
  const none = buildUsage({ users: [], usage: emptyUsage(), funnelData: { contentIds: [], publishedIds: [] }, now: NOW });
  assert.strictEqual(none.funnel.steps[0].count, 0);
  assert.strictEqual(none.funnel.steps[0].fromStart, null);
});

test('funnel without stored content or publish data says why instead of guessing', () => {
  const users = [mk('a', { createdAt: ago(2) })];
  const u = buildUsage({ users, usage: emptyUsage(), funnelData: null, now: NOW });
  assert.strictEqual(u.funnel.available, false);
  assert.match(u.funnel.reason, /could not/i);
  const partial = buildUsage({ users, usage: emptyUsage(), funnelData: { contentIds: ['a'], publishedIds: null, publishedReason: 'We could not read published posts right now.' }, now: NOW });
  assert.strictEqual(partial.funnel.available, true);
  assert.strictEqual(step(partial, 'published').available, false);
  assert.strictEqual(step(partial, 'published').reason, 'We could not read published posts right now.');
  // the next step cannot be counted without it (steps are nested), so it says so too
  assert.strictEqual(step(partial, 'paid').available, false);
});

test('window must be 30 or 90 days', () => {
  assert.deepStrictEqual([parseWindow(undefined), parseWindow('30'), parseWindow('90'), parseWindow(90)], [{ ok: true, days: 30 }, { ok: true, days: 30 }, { ok: true, days: 90 }, { ok: true, days: 90 }]);
  for (const bad of ['7', '60', 'abc', '-30', '30; drop', ['30', '90'], {}]) assert.strictEqual(parseWindow(bad).ok, false, String(bad));
});

const hist = (action, amount, daysAgo, extra = {}) => ({ action, amount, createdAt: ago(daysAgo), ...extra });
const spendUsers = () => [mk('a', { credits: { history: [
  hist('image_generated', -10, 1), hist('campaign_full', -30, 2), hist('campaign_text', -4, 1),
  hist('video_base', -50, 1), hist('video_generated', -200, 1), hist('hero_video_clip', -700, 2), hist('blueprint', -60, 3),
  hist('chat_message', -2, 1), hist('mystery_action', -5, 1),
  hist('image_generated_refund', 10, 1), hist('hero_video_clip_refund', 700, 2),
  hist('staff_grant', 500, 1),                                 // not spending
  hist('social_connect_instagram', undefined, 1, { cost: -50 }), // reward, not spending
  hist('image_generated', -99, 20)                              // last month
] } }), mk('b', { credits: { history: [{ action: 'campaign_text', cost: 3, timestamp: ago(1) }] } })];

test('Quark spend is grouped into images, captions, video, hero, blueprint and other, with refunds taken off their own category', () => {
  const q = buildUsage({ users: spendUsers(), usage: emptyUsage(), now: NOW }).quarks;
  assert.strictEqual(q.available, true);
  const by = Object.fromEntries(q.categories.map((c) => [c.key, c.quarks]));
  assert.deepStrictEqual(CATEGORIES.map((c) => c.key), ['images', 'captions', 'video', 'hero', 'blueprint', 'other']);
  assert.deepStrictEqual(by, { images: 30, captions: 7, video: 250, hero: 0, blueprint: 60, other: 7 });
  // image_generated 10 refunded fully, campaign_full 30 stays; captions 4 + legacy cost 3; other = chat 2 + unknown 5
  assert.strictEqual(q.total, 354);
  assert.strictEqual(q.categories.reduce((n, c) => n + c.quarks, 0), q.total);
});

test('Quark spend total equals the Money page figure for the same accounts (same history rules)', () => {
  const users = spendUsers();
  assert.strictEqual(buildUsage({ users, usage: emptyUsage(), now: NOW }).quarks.total, quarkTotals(users, NOW).spent);
});

test('Quark spend shares are whole percents of the total, none when nothing was spent', () => {
  const q = buildUsage({ users: spendUsers(), usage: emptyUsage(), now: NOW }).quarks;
  assert.strictEqual(q.categories.find((c) => c.key === 'video').percent, Math.round((250 / 354) * 100));
  const empty = buildUsage({ users: [mk('a')], usage: emptyUsage(), now: NOW }).quarks;
  assert.strictEqual(empty.total, 0);
  assert.ok(empty.categories.every((c) => c.percent === null));
});

test('clients whose Quark history may have been trimmed are counted, with the same rule as Money', () => {
  const full = Array.from({ length: 50 }, (_, i) => hist('image_generated', -1, 1 + (i % 5) * 0.1));
  const users = [mk('a', { credits: { history: full } }), mk('b', { credits: { history: [hist('image_generated', -1, 1)] } })];
  const q = buildUsage({ users, usage: emptyUsage(), now: NOW }).quarks;
  assert.strictEqual(q.possiblyIncompleteClients, 1);
  assert.strictEqual(q.possiblyIncompleteClients, quarkTotals(users, NOW).possiblyIncompleteClients);
  assert.match(q.note, /50 to 100/);
});

test('every Quark action the app can charge for has a category chosen on purpose', () => {
  for (const action of Object.keys(QUARK_COSTS)) {
    assert.ok(categoryOf(action, true), `${action} has no explicit category`);
  }
  assert.strictEqual(categoryOf('image_generated'), 'images');
  assert.strictEqual(categoryOf('campaign_text'), 'captions');
  assert.strictEqual(categoryOf('video_scene_clip'), 'video');
  assert.strictEqual(categoryOf('hero_video_clip'), 'hero');
  assert.strictEqual(categoryOf('blueprint'), 'blueprint');
  assert.strictEqual(categoryOf('chat_message'), 'other');
  assert.strictEqual(categoryOf('something_new'), 'other');
  assert.strictEqual(categoryOf(undefined), 'other');
});

test('top feature per plan comes from the 30-day feature use of the clients on that plan', () => {
  const users = [mk('a'), mk('b'), mk('c', { plan: { tier: 'starter' } }), mk('d', { plan: { tier: 'professional' } }), mk('e', { plan: undefined })];
  const usage = { ...emptyUsage(), images: rows({ a: 4, c: 1 }), postsDrafted: rows({ a: 1, b: 2, c: 9 }), videos: rows({ e: 3 }) };
  const t = buildUsage({ users, usage, now: NOW }).topByTier;
  assert.strictEqual(t.available, true);
  const tier = (id) => t.tiers.find((x) => x.id === id);
  assert.deepStrictEqual(t.tiers.map((x) => x.id), ['free', 'starter', 'professional', 'managed']);
  assert.deepStrictEqual([tier('free').clients, tier('free').top.key, tier('free').top.count, tier('free').top.clients], [2, 'images', 4, 1]);
  assert.deepStrictEqual([tier('starter').top.key, tier('starter').top.count], ['postsDrafted', 9]);
  assert.strictEqual(tier('professional').top, null);
  assert.deepStrictEqual([tier('managed').top.key, tier('managed').top.count], ['videos', 3]);
});

test('top feature ignores a feature whose numbers are unavailable', () => {
  const users = [mk('a')];
  const u = buildUsage({ users, usage: { ...emptyUsage(), images: rows({ a: 1 }), videos: rows({ a: 50 }) }, unavailable: { videos: 'x' }, now: NOW });
  assert.strictEqual(u.topByTier.tiers.find((x) => x.id === 'free').top.key, 'images');
  assert.match(u.topByTier.note, /not counted/i);
});

test('the Admin summary hides Quark spending and says it is for the Owner; the Owner sees it', () => {
  const full = buildUsage({ users: spendUsers(), usage: emptyUsage(), level: 'full', now: NOW });
  const summary = buildUsage({ users: spendUsers(), usage: emptyUsage(), level: 'summary', now: NOW });
  assert.strictEqual(full.level, 'full');
  assert.strictEqual(full.quarks.available, true);
  assert.strictEqual(summary.level, 'summary');
  assert.strictEqual(summary.quarks.available, false);
  assert.strictEqual(summary.quarks.restricted, true);
  assert.match(summary.quarks.reason, /Owner/);
  assert.strictEqual(summary.quarks.categories, undefined);
  assert.ok(summary.featureUse && summary.funnel && summary.topByTier);
});
