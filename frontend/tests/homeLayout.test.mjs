import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  numberTiles, numbersMode, actionRows, planBanner, balanceView, greeting, headline, isNewAccount,
  describeHandoff, competitorsStrip, blockFailed, statusWord, DESCRIBE_MAX, HOME_CREATE_TILES, createTileHandoff,
} from '../utils/homeLayout.ts';

const n = (value, previous = null, changePct = null, extra = {}) => ({ value, previous, changePct, available: true, reason: null, unit: 'count', ...extra });
const none = (reason) => ({ value: null, previous: null, changePct: null, available: false, reason });
const base = (over = {}) => ({
  generatedAt: 'x',
  account: { tier: 'starter', free: false, paidTier: true, agencyOwner: false, clientWorkspace: false, managed: false, staff: false, pass: false, frozen: false, showsPostsNotQuarks: false },
  features: { inbox: true, competitors: true, publish: true },
  numbers: {
    reach: n(48200, 41000, 17.6), engagement: n(4.2, 3.8, 10.5, { unit: 'percent' }), followers: n(12450, 12200, 2, { change: 250 }),
    postsPublishedThisWeek: n(3, 5, -40), draftsWaiting: n(4), unrepliedMessages: n(6),
  },
  nextActions: [],
  week: { start: '', end: '', proposal: 'proposed', topUp: false, posts: { planned: 5, made: 0, published: 3, scheduled: 2 }, counts: null },
  plan: { state: 'ready', opened: true, eligible: true, stopped: false, completedAt: null },
  setup: { next: null, allDone: true, done: 4, total: 4 },
  balance: { available: true, quarks: 4200, posts: 381, videos: 26, showQuarks: true, text: '', paused: false },
  connected: { count: 2, platforms: ['instagram'] },
  competitors: { held: true, tracked: 4, needHandle: 2 },
  products: { count: 2, withPhotos: 1 },
  today: [], recent: [], degraded: [],
  ...over,
});

test('the numbers strip has six tiles in a fixed order with Indian formatting', () => {
  const tiles = numberTiles(base());
  assert.deepEqual(tiles.map((t) => t.key), ['reach', 'engagement', 'followers', 'posts', 'drafts', 'messages']);
  assert.equal(tiles[0].value, '48,200');
  assert.equal(tiles[1].value, '4.2%');
  assert.equal(tiles[2].value, '12,450');
  assert.equal(tiles[3].value, '3');
});

test('a change chip appears only when there is a comparison, with the direction in words', () => {
  const tiles = numberTiles(base());
  assert.deepEqual(tiles[0].chip, { text: 'Up 17.6%', dir: 'up' });
  assert.deepEqual(tiles[3].chip, { text: 'Down 40%', dir: 'down' });
  assert.equal(tiles[4].chip, null, 'drafts waiting has no comparison');
  const flat = numberTiles(base({ numbers: { ...base().numbers, reach: n(10, 10, 0) } }));
  assert.deepEqual(flat[0].chip, { text: 'No change', dir: 'flat' });
  const noPrev = numberTiles(base({ numbers: { ...base().numbers, reach: n(10, null, 12) } }));
  assert.equal(noPrev[0].chip, null, 'no previous value, no chip');
  const bad = numberTiles(base({ numbers: { ...base().numbers, reach: n(10, 5, NaN) } }));
  assert.equal(bad[0].chip, null);
});

test('a large number uses lakh and crore short forms and keeps the full figure for screen readers', () => {
  const t = numberTiles(base({ numbers: { ...base().numbers, reach: n(1250000, null, null) } }))[0];
  assert.equal(t.value, '12.5L');
  assert.match(t.label, /12,50,000/);
  assert.equal(numberTiles(base({ numbers: { ...base().numbers, reach: n(99999) } }))[0].value, '99,999');
});

test('a number that is not available is never a zero: it shows the reason and the right link', () => {
  const s = base({ numbers: { ...base().numbers, reach: none('Connect an account to see this.'), unrepliedMessages: none('Messages are part of the Inbox add-on.') } });
  const [reach, , , , , msgs] = numberTiles(s);
  assert.equal(reach.value, null);
  assert.equal(reach.prompt.text, 'Connect an account to see this.');
  assert.deepEqual(reach.prompt.link, { to: '/connect-socials', text: 'Connect an account' });
  assert.deepEqual(msgs.prompt.link, { to: '/trial-expired', text: 'See add-ons' });
  const paid = numberTiles(base({ numbers: { ...base().numbers, reach: none('Connecting accounts comes with a paid plan.') } }))[0];
  assert.deepEqual(paid.prompt.link, { to: '/trial-expired', text: 'See plans' });
  const first = numberTiles(base({ numbers: { ...base().numbers, reach: none('Your first numbers arrive within a day of connecting.') } }))[0];
  assert.equal(first.prompt.link, null);
  const failed = numberTiles(base({ numbers: { ...base().numbers, reach: none('We could not load this just now. Please try again in a moment.') } }))[0];
  assert.equal(failed.prompt.text, 'We could not load this just now.');
});

test('a client workspace never gets a plan or add-on link', () => {
  const s = base({ account: { ...base().account, clientWorkspace: true }, numbers: { ...base().numbers, unrepliedMessages: none('Messages are part of the Inbox add-on.'), reach: none('Connecting accounts comes with a paid plan.') } });
  const tiles = numberTiles(s);
  assert.equal(tiles[0].prompt.link, null);
  assert.equal(tiles[5].prompt.link, null);
});

test('a missing or broken number reads as not available, never as NaN', () => {
  const s = base({ numbers: { ...base().numbers, followers: undefined, reach: n(NaN) } });
  const tiles = numberTiles(s);
  assert.equal(tiles[2].value, null);
  assert.ok(tiles[2].prompt.text.length > 0);
  assert.equal(tiles[0].value, null);
});

test('the strip turns into one quiet line when nothing can be shown yet', () => {
  const why = 'Connect an account to see this.';
  const empty = base({ numbers: { reach: none(why), engagement: none(why), followers: none(why), postsPublishedThisWeek: n(0, 0), draftsWaiting: n(0), unrepliedMessages: none(why) } });
  assert.equal(numbersMode(empty), 'quiet');
  assert.equal(numbersMode(base()), 'full');
  const someDrafts = base({ numbers: { ...empty.numbers, draftsWaiting: n(4) } });
  assert.equal(numbersMode(someDrafts), 'full');
});

test('Do this next keeps the order, shows at most five and gives each row one button', () => {
  const acts = ['finish_profile', 'choose_plan', 'approve_week', 'review_drafts', 'reply_messages', 'connect_account', 'add_product_photo']
    .map((id, i) => ({ id, kind: 'setup', title: `T${i}`, detail: `D${i}`, to: id === 'approve_week' ? '/dashboard#this-week' : '/x', count: i }));
  const rows = actionRows(acts, { planBanner: false });
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map((r) => r.id), ['finish_profile', 'choose_plan', 'approve_week', 'review_drafts', 'reply_messages']);
  assert.equal(rows[0].primary, true);
  assert.ok(rows.slice(1).every((r) => !r.primary));
  assert.equal(rows[2].scrollTo, 'this-week', 'approve opens the This week card on the same page');
  assert.equal(rows[2].to, null);
  assert.ok(rows.every((r) => r.button.length > 0));
  assert.equal(rows[0].count, null, 'a count of 0 shows no badge');
  assert.equal(rows[3].count, 3);
});

test('plan rows are left to the plan banner when it is shown', () => {
  const acts = [{ id: 'plan_building', kind: 'plan', title: 'Building', detail: '', to: null, info: true }, { id: 'review_drafts', kind: 'drafts', title: 'Review', detail: '', to: '/drafts', count: 2 }];
  assert.deepEqual(actionRows(acts, { planBanner: true }).map((r) => r.id), ['review_drafts']);
  const info = actionRows(acts, { planBanner: false })[0];
  assert.equal(info.button, '');
  assert.equal(info.info, true);
});

test('the plan banner says what is happening and gives one plain action', () => {
  assert.equal(planBanner({ state: 'ready', stopped: false }), null);
  assert.equal(planBanner({ state: 'none', stopped: false }), null);
  assert.equal(planBanner({ state: 'building' }).action, null);
  assert.deepEqual(planBanner({ state: 'failed', stopped: false }).action, { label: 'Try again', to: '/plan' });
  assert.match(planBanner({ state: 'failed', stopped: true }).text, /more about your business/);
  assert.deepEqual(planBanner({ state: 'stale' }).action, { label: 'Open My plan', to: '/plan' });
  assert.equal(planBanner(undefined), null);
});

test('the balance is shown in posts and videos, with the Quark figure beside it only when the account sees Quarks', () => {
  assert.deepEqual(balanceView(base()), { state: 'ok', label: 'Enough for about', main: '381 posts or 26 videos', side: '4,200 Quarks', link: null });
  const agency = balanceView(base({ balance: { ...base().balance, showQuarks: false, quarks: null } }));
  assert.equal(agency.side, null);
  const client = balanceView(base({ account: { ...base().account, clientWorkspace: true }, balance: { ...base().balance, showQuarks: false, quarks: null } }));
  assert.equal(client.label, 'Shared with your agency: about');
  assert.equal(client.link, null);
  const zero = balanceView(base({ balance: { available: true, quarks: 0, posts: 0, videos: 0, showQuarks: true, text: '', paused: false } }));
  assert.equal(zero.state, 'empty');
  assert.deepEqual(zero.link, { to: '/trial-expired', text: 'Add more' });
  assert.equal(balanceView(base({ degraded: ['balance'] })).state, 'error');
  assert.equal(balanceView(base({ balance: { available: false, quarks: null, posts: null, videos: null, showQuarks: true, text: '', paused: false } })).state, 'error');
  assert.equal(balanceView(base({ balance: { ...base().balance, paused: true } })).state, 'paused');
  assert.equal(balanceView(base({ balance: { ...base().balance, videos: 0 } })).main, '381 posts');
  const managedZero = balanceView(base({ account: { ...base().account, managed: true }, balance: { ...base().balance, posts: 0, videos: 0, quarks: 0 } }));
  assert.equal(managedZero.link, null, 'managed accounts are never sent to buy');
});

test('the greeting follows the India clock and the business name', () => {
  assert.equal(greeting('Sunrise Bakery', new Date('2026-10-19T03:00:00Z')), 'Good morning, Sunrise Bakery');
  assert.equal(greeting('', new Date('2026-10-19T08:00:00Z')), 'Good afternoon');
  assert.equal(greeting('  ', new Date('2026-10-19T14:00:00Z')), 'Good evening');
});

test('the headline line is a plain sentence about the most useful fact', () => {
  assert.equal(headline(base()), '4 posts are waiting for your review.');
  assert.equal(headline(base({ numbers: { ...base().numbers, draftsWaiting: n(1) } })), '1 post is waiting for your review.');
  assert.equal(headline(base({ numbers: { ...base().numbers, draftsWaiting: n(0) }, nextActions: [] })), 'You are up to date.');
  assert.equal(headline(base({ numbers: { ...base().numbers, draftsWaiting: n(0) }, nextActions: [{ id: 'x', title: 'X' }] })), 'Here is what needs you today.');
  assert.match(headline(base({ setup: { next: 'profile', allDone: false, done: 0, total: 3 } })), /^Welcome/);
  const building = base({ numbers: { ...base().numbers, draftsWaiting: n(0) }, plan: { state: 'building' }, nextActions: [{ id: 'plan_building', title: 'B', info: true }] });
  assert.equal(headline(building, 0), 'Your plan is on its way. You can make a post in the meantime.');
});

test('a new account is one that has not started setup', () => {
  assert.equal(isNewAccount(base()), false);
  assert.equal(isNewAccount(base({ setup: { next: 'profile', allDone: false, done: 0, total: 3 } })), true);
  assert.equal(isNewAccount(base({ setup: { next: 'plan', allDone: false, done: 2, total: 4 } })), false);
  assert.equal(isNewAccount(null), false);
});

test('the describe box hands the idea to Create or Videos through the one-shot prefill', () => {
  assert.deepEqual(describeHandoff('post', '  Diwali sweets box  ', 'Tamil'), { target: 'carousel', route: '/campaigns', data: { mode: 'single', topic: 'Diwali sweets box', language: 'Tamil', source: 'home' } });
  assert.deepEqual(describeHandoff('video', 'Kneading dough', null), { target: 'video', route: '/reels', data: { idea: 'Kneading dough', source: 'home' } });
  assert.equal(describeHandoff('post', '   ', 'English'), null);
  assert.equal(describeHandoff('post', 'x'.repeat(DESCRIBE_MAX + 50), '').data.topic.length, DESCRIBE_MAX);
});

test('the create tiles open the right screen and mode', () => {
  // Photoshoot joined on 2026-10-19, once its page existed (tests/photoshoot.test.mjs covers it).
  assert.deepEqual(HOME_CREATE_TILES.map((t) => t.key), ['single', 'carousel', 'campaign', 'video', 'photoshoot']);
  assert.deepEqual(createTileHandoff('carousel'), { target: 'carousel', route: '/campaigns', data: { mode: 'carousel', source: 'home' } });
  assert.deepEqual(createTileHandoff('video'), { target: null, route: '/reels', data: null });
});

test('the competitors strip shows only when there is something to show', () => {
  assert.equal(competitorsStrip({ held: false, tracked: 0, needHandle: 0 }), null);
  assert.equal(competitorsStrip({ held: true, tracked: 0, needHandle: 0 }), null);
  assert.deepEqual(competitorsStrip({ held: true, tracked: 4, needHandle: 2 }), { title: '4 competitors tracked', detail: '2 need a confirmed handle.', to: '/competitors' });
  assert.equal(competitorsStrip({ held: true, tracked: 1, needHandle: 0 }).title, '1 competitor tracked');
});

test('a degraded source is reported per block', () => {
  assert.equal(blockFailed(base({ degraded: ['today'] }), 'today'), true);
  assert.equal(blockFailed(base(), 'today'), false);
  assert.equal(blockFailed(null, 'today'), false);
});

test('post status is spelled out in words', () => {
  assert.equal(statusWord('posted'), 'Posted');
  assert.equal(statusWord('published'), 'Posted');
  assert.equal(statusWord('scheduled'), 'Scheduled');
  assert.equal(statusWord('failed'), 'Needs attention');
  assert.equal(statusWord('weird'), 'Planned');
});

test('the Home page keeps the tour anchors, uses the summary only and has no outside pictures', () => {
  const src = ['pages/GravityHome.tsx', 'components/home/HomeBlocks.tsx', 'components/SetupCard.tsx', 'components/ThisWeekCard.tsx']
    .map((f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')).join('\n');
  assert.match(src, /data-tour="this-week"/);
  assert.match(src, /data-tour="setup"/);
  assert.doesNotMatch(src, /getDrafts|getCampaigns/);
  assert.doesNotMatch(src, /src="http/);
  assert.doesNotMatch(src, /unsplash/i);
});

test('the approval tile is "Needs approval" and opens the Library approval view (navigation phase 2)', () => {
  const tile = numberTiles(base()).find((t) => t.key === 'drafts');
  assert.equal(tile.title, 'Needs approval');
  assert.equal(tile.to, '/library?view=approve');
  assert.equal(tile.value, '4');
  const src = fs.readFileSync(new URL('../scripts/visual-audit/mock-session.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /to: '\/drafts'/, 'the preview data links to the Library too');
});
