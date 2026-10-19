const test = require('node:test');
const assert = require('node:assert');
const { createHomeSummary, changePct, pickPrevious } = require('../services/homeSummary');

const NOW = new Date('2026-10-14T06:00:00Z'); // Wednesday 11:30 IST
const oid = (n) => `u${n}`;
const paidUser = (extra = {}) => ({
  _id: oid(1), plan: { tier: 'starter', addons: ['publish', 'inbox', 'competitors'] }, onboardingCompleted: true, isActive: true,
  businessProfile: { businessName: 'Chai Co', businessType: 'cafe', businessLocation: 'Chennai', websiteUrl: 'https://chai.example', instagramHandle: 'chai', industry: 'food', targetAudience: 'locals', brandVoice: 'warm', contentLanguage: 'English' },
  connectedSocials: [{ platform: 'instagram' }, { platform: 'facebook' }], ayrshare: { activeSocialAccounts: ['instagram'] },
  credits: { balance: 400 }, setup: {}, ...extra
});
const snap = (date, totals, platforms = {}) => ({ date: new Date(date), totals, platforms });
function deps(over = {}) {
  const calls = [];
  const rec = (name, v) => async (...a) => { calls.push([name, ...a]); return typeof v === 'function' ? v(...a) : v; };
  return {
    calls,
    now: () => NOW,
    draftsWaiting: rec('draftsWaiting', 3),
    publishedBetween: rec('publishedBetween', (u, from) => (from.toISOString() === '2026-10-11T18:30:00.000Z' ? 2 : 4)),
    scheduledBetween: rec('scheduledBetween', 1),
    todayCampaigns: rec('todayCampaigns', []),
    recentItems: rec('recentItems', []),
    latestSnapshot: rec('latestSnapshot', snap('2026-10-14', { followers: 1200, reach: 5000, impressions: 9000 }, { instagram: { engagementRate: 4, followers: 800 }, facebook: { engagementRate: 2, followers: 400 } })),
    snapshotBefore: rec('snapshotBefore', snap('2026-10-07', { followers: 1100, reach: 4000 }, { instagram: { engagementRate: 3 }, facebook: { engagementRate: 1 } })),
    unreadMessages: rec('unreadMessages', 5),
    proposal: rec('proposal', null),
    planRuns: rec('planRuns', []),
    competitors: rec('competitors', []),
    productCounts: rec('productCounts', { count: 0, withPhotos: 0 }),
    walletBalance: rec('walletBalance', 400),
    ...over
  };
}
const build = (user, d, extra = {}) => createHomeSummary(d).build({ user, pass: false, ...extra });

test('changePct: a real percentage or nothing', () => {
  assert.strictEqual(changePct(110, 100), 10);
  assert.strictEqual(changePct(90, 100), -10);
  assert.strictEqual(changePct(1, 3), -66.7);
  assert.strictEqual(changePct(5, 0), null);
  assert.strictEqual(changePct(5, null), null);
  assert.strictEqual(changePct(NaN, 5), null);
  assert.strictEqual(changePct(0, 0), null);
});

test('the full picture for a paid account with data', async () => {
  const s = await build(paidUser(), deps());
  assert.strictEqual(s.numbers.followers.value, 1200);
  assert.strictEqual(s.numbers.followers.previous, 1100);
  assert.strictEqual(s.numbers.followers.changePct, 9.1);
  assert.strictEqual(s.numbers.followers.available, true);
  assert.strictEqual(s.numbers.followers.reason, null);
  assert.strictEqual(s.numbers.reach.value, 5000);
  assert.strictEqual(s.numbers.reach.changePct, 25);
  assert.strictEqual(s.numbers.engagement.value, 3); // mean of 4 and 2
  assert.strictEqual(s.numbers.engagement.unit, 'percent');
  assert.strictEqual(s.numbers.engagement.previous, 2);
  assert.strictEqual(s.numbers.postsPublishedThisWeek.value, 2);
  assert.strictEqual(s.numbers.postsPublishedThisWeek.previous, 4);
  assert.strictEqual(s.numbers.postsPublishedThisWeek.changePct, -50);
  assert.strictEqual(s.numbers.draftsWaiting.value, 3);
  assert.strictEqual(s.numbers.draftsWaiting.previous, null);
  assert.strictEqual(s.numbers.unrepliedMessages.value, 5);
  assert.strictEqual(s.numbers.unrepliedMessages.available, true);
  assert.strictEqual(s.week.start, '2026-10-12');
  assert.strictEqual(s.week.end, '2026-10-19');
  assert.deepStrictEqual(s.connected, { count: 2, platforms: ['instagram', 'facebook'] });
  assert.strictEqual(s.degraded.length, 0);
  assert.strictEqual(s.numbers.followers.asOf, '2026-10-14');
});

test('the week queries use the Monday to Sunday India week', async () => {
  const d = deps();
  await build(paidUser(), d);
  const pub = d.calls.filter((c) => c[0] === 'publishedBetween');
  assert.strictEqual(pub.length, 2);
  assert.strictEqual(pub[0][2].toISOString(), '2026-10-11T18:30:00.000Z');
  assert.strictEqual(pub[0][3].toISOString(), '2026-10-18T18:30:00.000Z');
  assert.strictEqual(pub[1][2].toISOString(), '2026-10-04T18:30:00.000Z');
  assert.strictEqual(pub[1][3].toISOString(), '2026-10-11T18:30:00.000Z');
});

test('Sunday late evening is still last week, Monday morning is the new week', async () => {
  const sunday = await createHomeSummary(deps({ now: () => new Date('2026-10-18T17:30:00Z') })).build({ user: paidUser() }); // 23:00 IST Sunday
  assert.strictEqual(sunday.week.start, '2026-10-12');
  const monday = await createHomeSummary(deps({ now: () => new Date('2026-10-18T18:31:00Z') })).build({ user: paidUser() }); // 00:01 IST Monday
  assert.strictEqual(monday.week.start, '2026-10-19');
});

test('a new account shows plain reasons, never zeros it cannot source', async () => {
  const user = paidUser({ plan: { tier: 'free' }, connectedSocials: [], ayrshare: {}, onboardingCompleted: false, businessProfile: {} });
  const s = await build(user, deps({ latestSnapshot: async () => null, snapshotBefore: async () => null, draftsWaiting: async () => 0, unreadMessages: async () => 0, publishedBetween: async () => 0, scheduledBetween: async () => 0 }));
  for (const k of ['reach', 'engagement', 'followers']) {
    assert.strictEqual(s.numbers[k].available, false, k);
    assert.strictEqual(s.numbers[k].value, null, k);
    assert.ok(s.numbers[k].reason && !/[!—]/.test(s.numbers[k].reason), k);
  }
  assert.strictEqual(s.numbers.unrepliedMessages.available, false);
  // These two are real counts, so 0 is a real answer.
  assert.strictEqual(s.numbers.draftsWaiting.value, 0);
  assert.strictEqual(s.numbers.draftsWaiting.available, true);
  assert.strictEqual(s.numbers.postsPublishedThisWeek.value, 0);
  assert.strictEqual(s.account.free, true);
  assert.strictEqual(s.plan.state, 'none');
  const first = s.nextActions.map((a) => a.id);
  assert.deepStrictEqual(first, ['finish_profile', 'choose_plan', 'connect_account']);
});

test('connected but no snapshot yet explains that numbers are coming', async () => {
  const s = await build(paidUser(), deps({ latestSnapshot: async () => null, snapshotBefore: async () => null }));
  assert.strictEqual(s.numbers.followers.available, false);
  assert.match(s.numbers.followers.reason, /within a day/i);
});

test('not connected gives the connect reason, even when an old snapshot exists', async () => {
  const s = await build(paidUser({ connectedSocials: [], ayrshare: {} }), deps());
  assert.strictEqual(s.numbers.reach.available, false);
  assert.match(s.numbers.reach.reason, /connect/i);
});

test('only one snapshot: the number shows, the comparison is empty', async () => {
  const s = await build(paidUser(), deps({ snapshotBefore: async () => null }));
  assert.strictEqual(s.numbers.followers.value, 1200);
  assert.strictEqual(s.numbers.followers.previous, null);
  assert.strictEqual(s.numbers.followers.changePct, null);
});

test('a snapshot that reports no reach is not shown as a zero', async () => {
  const s = await build(paidUser(), deps({ latestSnapshot: async () => snap('2026-10-14', { followers: 900, reach: 0 }, { instagram: { engagementRate: 0 } }) }));
  assert.strictEqual(s.numbers.reach.available, false);
  assert.match(s.numbers.reach.reason, /not reported/i);
  assert.strictEqual(s.numbers.engagement.available, false);
  assert.strictEqual(s.numbers.followers.available, true);
});

test('a snapshot older than three days is marked stale with its date', async () => {
  const s = await build(paidUser(), deps({ latestSnapshot: async () => snap('2026-10-08', { followers: 900, reach: 10 }, {}) }));
  assert.strictEqual(s.numbers.followers.stale, true);
  assert.strictEqual(s.numbers.followers.asOf, '2026-10-08');
});

test('falling followers keep their sign', async () => {
  const s = await build(paidUser(), deps({ latestSnapshot: async () => snap('2026-10-14', { followers: 1000, reach: 10 }), snapshotBefore: async () => snap('2026-10-07', { followers: 1100, reach: 10 }) }));
  assert.strictEqual(s.numbers.followers.changePct, -9.1);
  assert.strictEqual(s.numbers.followers.change, -100);
});

test('unreplied messages need the inbox add-on', async () => {
  const s = await build(paidUser({ plan: { tier: 'starter', addons: ['publish'] } }), deps());
  assert.strictEqual(s.numbers.unrepliedMessages.available, false);
  assert.match(s.numbers.unrepliedMessages.reason, /add-on/i);
  assert.strictEqual(s.features.inbox, false);
  const none = deps();
  await build(paidUser({ plan: { tier: 'starter', addons: ['publish'] } }), none);
  assert.ok(!none.calls.some((c) => c[0] === 'unreadMessages'), 'no query is made for a feature the account does not hold');
});

test('managed accounts hold everything', async () => {
  const s = await build(paidUser({ plan: undefined }), deps());
  assert.strictEqual(s.account.managed, true);
  assert.strictEqual(s.features.inbox, true);
  assert.strictEqual(s.features.competitors, true);
  assert.strictEqual(s.numbers.unrepliedMessages.available, true);
});

test('agency owner and client workspace flags', async () => {
  const owner = await build(paidUser({ plan: { tier: 'agency' } }), deps());
  assert.strictEqual(owner.account.agencyOwner, true);
  assert.strictEqual(owner.account.clientWorkspace, false);
  assert.strictEqual(owner.balance.showQuarks, false);
  assert.strictEqual(owner.balance.quarks, null);
  const ws = await build(paidUser({ plan: { tier: 'agency' }, agency: { ownerId: 'owner1', workspaceName: 'Client' } }), deps({ walletBalance: async () => 1000 }), { pass: true });
  assert.strictEqual(ws.account.agencyOwner, false);
  assert.strictEqual(ws.account.clientWorkspace, true);
  assert.strictEqual(ws.account.pass, true);
  assert.strictEqual(ws.balance.showQuarks, false);
  assert.ok(ws.balance.posts > 0);
  assert.ok(!ws.nextActions.some((a) => ['top_up', 'choose_plan', 'read_plan'].includes(a.id)));
});

test('the balance shows posts and videos with the Quark figure beside it', async () => {
  const s = await build(paidUser(), deps({ walletBalance: async () => 400 }));
  assert.strictEqual(s.balance.quarks, 400);
  assert.strictEqual(s.balance.showQuarks, true);
  assert.ok(s.balance.posts >= 1);
  assert.ok(Number.isInteger(s.balance.videos));
  assert.match(s.balance.text, /^400 Quarks \(about \d+ posts?/);
  const none = await build(paidUser(), deps({ walletBalance: async () => 0 }));
  assert.strictEqual(none.balance.posts, 0);
  assert.strictEqual(none.balance.text, '0 Quarks');
});

test('the weekly proposal gives planned and made posts, and an unmade week is "none"', async () => {
  const none = await build(paidUser(), deps());
  assert.strictEqual(none.week.proposal, 'none');
  assert.strictEqual(none.week.posts.planned, null);
  const prop = { status: 'approved', items: [
    { kind: 'post', status: 'made' }, { kind: 'post', status: 'made' }, { kind: 'post', status: 'approved' }, { kind: 'post', status: 'skipped' },
    { kind: 'carousel', status: 'proposed' }, { kind: 'video', status: 'proposed' }
  ] };
  const s = await build(paidUser(), deps({ proposal: async () => prop }));
  assert.strictEqual(s.week.proposal, 'approved');
  assert.strictEqual(s.week.posts.planned, 3);
  assert.strictEqual(s.week.posts.made, 2);
  assert.deepStrictEqual(s.week.counts, { posts: 3, carousels: 1, videos: 1 });
});

test('a week that could not be paid for asks for a top-up', async () => {
  const prop = { status: 'approved', items: [{ kind: 'post', status: 'failed', error: 'no_pool' }, { kind: 'post', status: 'proposed' }] };
  const s = await build(paidUser(), deps({ proposal: async () => prop, planRuns: async () => [{ status: 'completed', completedAt: NOW }] }));
  assert.strictEqual(s.week.topUp, true);
  assert.ok(s.nextActions.some((a) => a.id === 'top_up'));
});

test('plan states: none, building, ready, stale, failed', async () => {
  const at = (days) => new Date(NOW.getTime() - days * 86400000);
  const state = async (runs, user = paidUser()) => (await build(user, deps({ planRuns: async () => runs }))).plan;
  assert.strictEqual((await state([])).state, 'none');
  assert.strictEqual((await state([{ status: 'processing', createdAt: at(0), heartbeatAt: new Date(NOW.getTime() - 60000) }])).state, 'building');
  assert.strictEqual((await state([{ status: 'processing', createdAt: at(1), heartbeatAt: at(1) }])).state, 'none'); // a dead run is not "building"
  assert.strictEqual((await state([{ status: 'completed', completedAt: at(3), createdAt: at(3) }])).state, 'ready');
  assert.strictEqual((await state([{ status: 'completed', completedAt: at(60), createdAt: at(60) }])).state, 'stale');
  assert.strictEqual((await state([{ status: 'failed', createdAt: at(1) }])).state, 'failed');
  assert.strictEqual((await state([{ status: 'stopped', createdAt: at(1) }])).state, 'failed');
  assert.strictEqual((await state([{ status: 'failed', createdAt: at(0) }, { status: 'completed', completedAt: at(9), createdAt: at(9) }])).state, 'ready'); // a failed refresh keeps the last plan
  const opened = await state([{ status: 'completed', completedAt: at(3), createdAt: at(3) }], paidUser({ setup: { planOpenedAt: at(2) } }));
  assert.strictEqual(opened.opened, true);
});

test('competitor handles that need a decision are counted only with the add-on', async () => {
  const rows = [
    { _id: 'a', name: 'A', socialHandles: { instagram: 'a_handle' }, handleStatus: 'confirmed', createdAt: new Date(3) },
    { _id: 'b', name: 'B', socialHandles: {}, createdAt: new Date(2) },
    { _id: 'c', name: 'C', socialHandles: { instagram: 'c.ok' }, handleStatus: 'suggested', createdAt: new Date(1) },
    { _id: 'd', name: 'D', socialHandles: { instagram: 'd.ok' }, handleStatus: 'confirmed', tracking: { pausedAt: new Date() }, createdAt: new Date(0) }
  ];
  const s = await build(paidUser(), deps({ competitors: async () => rows }));
  assert.strictEqual(s.competitors.held, true);
  assert.strictEqual(s.competitors.tracked, 4);
  assert.strictEqual(s.competitors.needHandle, 3);
  const without = await build(paidUser({ plan: { tier: 'starter', addons: ['publish'] } }), deps({ competitors: async () => rows }));
  assert.strictEqual(without.competitors.held, false);
  assert.strictEqual(without.competitors.needHandle, 0);
});

test('products without a photo feed the photo action', async () => {
  const s = await build(paidUser(), deps({ productCounts: async () => ({ count: 4, withPhotos: 1 }) }));
  assert.deepStrictEqual(s.products, { count: 4, withPhotos: 1 });
  assert.ok(s.nextActions.some((a) => a.id === 'add_product_photo' && a.count === 3));
});

test('one failing source does not break Home: that block says so, the rest stay, and the result is marked degraded', async () => {
  const s = await build(paidUser(), deps({ latestSnapshot: async () => { throw new Error('boom'); }, draftsWaiting: async () => { throw new Error('boom'); } }));
  assert.strictEqual(s.numbers.followers.available, false);
  assert.match(s.numbers.followers.reason, /could not load/i);
  assert.strictEqual(s.numbers.draftsWaiting.available, false);
  assert.strictEqual(s.numbers.unrepliedMessages.value, 5);
  assert.deepStrictEqual(s.degraded.sort(), ['drafts', 'snapshots']);
  assert.ok(!JSON.stringify(s).includes('boom'), 'no raw error text reaches the customer');
});

test('today and recent items are small, safe and sorted by real time', async () => {
  const rows = [
    { _id: 'x2', name: 'Later', status: 'scheduled', platforms: ['instagram'], scheduledFor: new Date('2026-10-14T10:30:00Z'), creative: { textContent: 'L'.repeat(300), imageUrls: ['https://cdn.example/b.jpg'] } },
    { _id: 'x1', name: 'Earlier', status: 'scheduled', platforms: ['facebook'], scheduledFor: new Date('2026-10-14T03:30:00Z'), creative: { imageUrls: ['data:image/png;base64,AAAA'] } }
  ];
  const s = await build(paidUser(), deps({ todayCampaigns: async () => rows, recentItems: async () => [
    { image: 'https://cdn.example/1.jpg', platform: 'instagram', when: new Date('2026-10-13') }, { image: 'data:image/png;base64,AAAA', platform: 'x', when: null }, { image: '', platform: 'x' }
  ] }));
  assert.deepStrictEqual(s.today.map((t) => t.id), ['x1', 'x2']);
  assert.ok(s.today[1].subtitle.length <= 80);
  assert.strictEqual(s.today[0].image, null, 'an inline image is never sent');
  assert.strictEqual(s.today[1].image, 'https://cdn.example/b.jpg');
  assert.strictEqual(s.recent.length, 1);
  assert.strictEqual(s.recent[0].image, 'https://cdn.example/1.jpg');
});

test('staff on their own page get an empty, flagged picture', async () => {
  const s = await build(paidUser({ staffRole: 'admin' }), deps());
  assert.strictEqual(s.account.staff, true);
  assert.deepStrictEqual(s.nextActions, []);
});

test('the summary is small', async () => {
  const s = await build(paidUser(), deps());
  assert.ok(JSON.stringify(s).length < 6000, `${JSON.stringify(s).length} bytes`);
});

test('pickPrevious takes the newest snapshot that is at least a week older', () => {
  const rows = [snap('2026-10-09', { followers: 1 }), snap('2026-10-06', { followers: 2 }), snap('2026-10-01', { followers: 3 })];
  assert.strictEqual(pickPrevious(rows, new Date('2026-10-14')).totals.followers, 2);
  assert.strictEqual(pickPrevious([snap('2026-10-13', {})], new Date('2026-10-14')), null);
  assert.strictEqual(pickPrevious([], new Date('2026-10-14')), null);
});
