const test = require('node:test');
const assert = require('node:assert');
const { nextActions, RULE_ORDER, MAX_ACTIONS } = require('../services/homeActions');

const paid = { free: false, paidTier: true, agencyOwner: false, clientWorkspace: false, managed: false, staff: false, pass: false };
const base = () => ({
  account: { ...paid },
  profileComplete: true,
  plan: { state: 'ready', opened: true },
  week: { state: 'none', topUp: false, plannedPosts: 0 },
  draftsWaiting: 0,
  unreplied: { entitled: false, value: null },
  connected: { count: 2 },
  competitors: { held: false, needHandle: 0 },
  products: { count: 0, withPhotos: 0 }
});
const ids = (input, opts) => nextActions(input, opts).map((a) => a.id);
const withIn = (patch) => { const b = base(); for (const k of Object.keys(patch)) b[k] = typeof patch[k] === 'object' && patch[k] && !Array.isArray(patch[k]) && b[k] && typeof b[k] === 'object' ? { ...b[k], ...patch[k] } : patch[k]; return b; };

test('a settled paid account has nothing to do', () => {
  assert.deepStrictEqual(nextActions(base()), []);
});

test('every action carries id, kind, title, detail and a place to go', () => {
  const all = withIn({ profileComplete: false, plan: { state: 'failed' }, week: { state: 'proposed', plannedPosts: 5, topUp: true }, draftsWaiting: 3, unreplied: { entitled: true, value: 2 }, connected: { count: 0 }, competitors: { held: true, needHandle: 1 }, products: { count: 3, withPhotos: 1 } });
  for (const a of nextActions(all, { limit: 20 })) {
    assert.ok(a.id && a.kind && a.title && a.detail, a.id);
    assert.ok(typeof a.to === 'string' && a.to.startsWith('/'), a.id);
    assert.ok(!/[!—–]/.test(`${a.title} ${a.detail}`), `wording: ${a.id}`);
    assert.ok(!/credit|trial|7 days|gravity|pulsar|orbit/i.test(`${a.title} ${a.detail}`), `wording: ${a.id}`);
  }
});

test('rule 1: an unfinished business profile comes first', () => {
  assert.deepStrictEqual(ids(withIn({ profileComplete: false, draftsWaiting: 4 })).slice(0, 2), ['finish_profile', 'review_drafts']);
});

test('rule 2: a failed plan offers a retry; a plan being built is only information', () => {
  const failed = nextActions(withIn({ plan: { state: 'failed' } }));
  assert.strictEqual(failed[0].id, 'fix_plan');
  assert.strictEqual(failed[0].to, '/plan');
  const building = nextActions(withIn({ plan: { state: 'building' } }));
  assert.strictEqual(building[0].id, 'plan_building');
  assert.strictEqual(building[0].to, null);
  assert.strictEqual(building[0].info, true);
});

test('rule 3: read the plan once it is ready and never opened; not for a pass or a client workspace', () => {
  assert.deepStrictEqual(ids(withIn({ plan: { state: 'ready', opened: false } })), ['read_plan']);
  assert.deepStrictEqual(ids(withIn({ plan: { state: 'stale', opened: false } })), ['read_plan']);
  assert.deepStrictEqual(ids(withIn({ plan: { state: 'ready', opened: true } })), []);
  assert.deepStrictEqual(ids(withIn({ plan: { state: 'ready', opened: false }, account: { pass: true } })), []);
  assert.deepStrictEqual(ids(withIn({ plan: { state: 'ready', opened: false }, account: { clientWorkspace: true } })), []);
});

test('rule 4: a proposed week with posts can be approved', () => {
  const a = nextActions(withIn({ week: { state: 'proposed', plannedPosts: 4 } }));
  assert.strictEqual(a[0].id, 'approve_week');
  assert.strictEqual(a[0].count, 4);
  assert.match(a[0].title, /4 posts/);
  assert.deepStrictEqual(ids(withIn({ week: { state: 'proposed', plannedPosts: 0 } })), []);
  assert.deepStrictEqual(ids(withIn({ week: { state: 'approved', plannedPosts: 4 } })), []);
  assert.match(nextActions(withIn({ week: { state: 'proposed', plannedPosts: 1 } }))[0].title, /1 post\b/);
});

test('rule 5: a top-up is offered when the week cannot be paid for, never to a client workspace', () => {
  assert.deepStrictEqual(ids(withIn({ week: { topUp: true } })), ['top_up']);
  assert.deepStrictEqual(ids(withIn({ week: { topUp: true }, account: { clientWorkspace: true } })), []);
});

test('rule 6: drafts waiting give a count; zero, null and negative give nothing', () => {
  const a = nextActions(withIn({ draftsWaiting: 7 }));
  assert.strictEqual(a[0].id, 'review_drafts');
  assert.strictEqual(a[0].count, 7);
  // Needs approval lives in the Library now (navigation phase 2): the same count, the Library's approval view.
  assert.strictEqual(a[0].to, '/library?view=approve');
  assert.match(a[0].title, /^Approve 7 posts$/);
  assert.match(a[0].detail, /waiting for your approval/);
  assert.match(nextActions(withIn({ draftsWaiting: 1 }))[0].title, /^Approve 1 post$/);
  for (const v of [0, null, undefined, -2, NaN]) assert.deepStrictEqual(ids(withIn({ draftsWaiting: v })), [], String(v));
});

test('rule 7: unread messages only for an account that holds the inbox', () => {
  assert.deepStrictEqual(ids(withIn({ unreplied: { entitled: true, value: 3 } })), ['reply_messages']);
  assert.deepStrictEqual(ids(withIn({ unreplied: { entitled: false, value: 3 } })), []);
  assert.deepStrictEqual(ids(withIn({ unreplied: { entitled: true, value: null } })), []);
  assert.deepStrictEqual(ids(withIn({ unreplied: { entitled: true, value: 0 } })), []);
});

test('rule 8: connect an account when none is connected', () => {
  const a = nextActions(withIn({ connected: { count: 0 } }));
  assert.strictEqual(a[0].id, 'connect_account');
  assert.strictEqual(a[0].to, '/connect-socials');
  assert.match(a[0].detail, /still make posts/i);
});

test('rule 9: a competitor handle to confirm, only with the competitors add-on', () => {
  const a = nextActions(withIn({ competitors: { held: true, needHandle: 2 } }));
  assert.strictEqual(a[0].id, 'confirm_competitor');
  assert.strictEqual(a[0].count, 2);
  assert.deepStrictEqual(ids(withIn({ competitors: { held: false, needHandle: 2 } })), []);
});

test('rule 10: products without a photo', () => {
  const a = nextActions(withIn({ products: { count: 5, withPhotos: 2 } }));
  assert.strictEqual(a[0].id, 'add_product_photo');
  assert.strictEqual(a[0].count, 3);
  assert.deepStrictEqual(ids(withIn({ products: { count: 5, withPhotos: 5 } })), []);
  assert.deepStrictEqual(ids(withIn({ products: { count: 0, withPhotos: 0 } })), []);
  assert.deepStrictEqual(ids(withIn({ products: { count: 2, withPhotos: 9 } })), []); // bad data never goes negative
});

test('the order is fixed and the list is capped', () => {
  const all = withIn({ profileComplete: false, plan: { state: 'ready', opened: false }, week: { state: 'proposed', plannedPosts: 5, topUp: true }, draftsWaiting: 3, unreplied: { entitled: true, value: 2 }, connected: { count: 0 }, competitors: { held: true, needHandle: 1 }, products: { count: 3, withPhotos: 1 } });
  assert.strictEqual(MAX_ACTIONS, 5);
  const every = ids(all, { limit: 50 });
  assert.deepStrictEqual(every, ['finish_profile', 'read_plan', 'approve_week', 'top_up', 'review_drafts', 'reply_messages', 'connect_account', 'confirm_competitor', 'add_product_photo']);
  assert.deepStrictEqual(ids(all), every.slice(0, 5));
  assert.deepStrictEqual(ids(all, { limit: 2 }), every.slice(0, 2));
  assert.deepStrictEqual(ids(all, { limit: 0 }), []);
  assert.deepStrictEqual(ids(all, { limit: -3 }), []);
  assert.deepStrictEqual(RULE_ORDER.filter((id) => every.includes(id)), every);
});

test('the same input always gives the same answer (no ties are broken by chance)', () => {
  const all = withIn({ draftsWaiting: 3, unreplied: { entitled: true, value: 2 }, connected: { count: 0 } });
  assert.deepStrictEqual(nextActions(all), nextActions(JSON.parse(JSON.stringify(all))));
});

test('free accounts see only setup and plan actions', () => {
  const free = withIn({ account: { free: true, paidTier: false }, profileComplete: false, connected: { count: 0 }, draftsWaiting: 6, unreplied: { entitled: true, value: 4 }, products: { count: 2, withPhotos: 0 }, competitors: { held: true, needHandle: 1 }, week: { state: 'proposed', plannedPosts: 3, topUp: true }, plan: { state: 'failed' } });
  assert.deepStrictEqual(ids(free, { limit: 20 }), ['finish_profile', 'choose_plan', 'connect_account']);
  assert.deepStrictEqual(ids(withIn({ account: { free: true, paidTier: false } })), ['choose_plan']);
  const choose = nextActions(withIn({ account: { free: true, paidTier: false } }))[0];
  assert.strictEqual(choose.to, '/trial-expired');
});

test('agency client workspaces never see billing or plan-choice actions', () => {
  const ws = withIn({ account: { clientWorkspace: true, agencyOwner: false }, week: { state: 'proposed', plannedPosts: 2, topUp: true }, draftsWaiting: 2 });
  assert.deepStrictEqual(ids(ws, { limit: 20 }), ['approve_week', 'review_drafts']);
  const wsFree = withIn({ account: { clientWorkspace: true, free: true, paidTier: false } });
  assert.deepStrictEqual(ids(wsFree, { limit: 20 }), []);
  for (const a of nextActions(withIn({ account: { clientWorkspace: true }, week: { topUp: true }, plan: { state: 'failed' } }), { limit: 20 })) {
    assert.ok(!['billing'].includes(a.kind), a.id);
  }
});

test('managed accounts are never asked to choose a plan or top up from a block', () => {
  assert.deepStrictEqual(ids(withIn({ account: { managed: true, paidTier: false, free: false } })), []);
});

test('staff looking at their own account get nothing', () => {
  assert.deepStrictEqual(nextActions(withIn({ account: { staff: true }, profileComplete: false, draftsWaiting: 9 })), []);
});

test('missing or broken input never throws', () => {
  assert.deepStrictEqual(nextActions(undefined), []);
  assert.deepStrictEqual(nextActions(null), []);
  assert.deepStrictEqual(nextActions({}), []);
  assert.doesNotThrow(() => nextActions({ account: null, plan: 'x', week: 5, products: [], draftsWaiting: 'many' }));
});
