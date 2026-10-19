// The Home drafts service: money, safety and ownership. Every model call is faked; the wallet and the ledger are in memory.
const test = require('node:test');
const assert = require('node:assert');
const { createHomeDrafts, MESSAGES, checkModel, prices, istDay } = require('../services/homeDrafts/service');
const { createFakeDraftModel } = require('./helpers/fakeHomeDraftDb');
const { QUARK_COSTS } = require('../config/apiCosts');
const caps = require('../config/homeDrafts');

const NOW = new Date('2026-10-15T12:00:00Z');
const DAY = 864e5;
const U1 = '6a0000000000000000000001';
const U2 = '6a0000000000000000000002';
const CLIENT = '6a0000000000000000000003';
const AGENCY = '6a0000000000000000000004';
const C1 = '6b0000000000000000000001';
const C2 = '6b0000000000000000000002';
const COMMENT = QUARK_COSTS.home_witty_comment;
const POST = QUARK_COSTS.home_response_post;
const OK_COMMENT = JSON.stringify({ comment: 'Lovely reel, the slow-motion pour made us hungry.' });
const OK_POST = JSON.stringify({ caption: 'Warm brownies from our oven this evening, baked slowly with care and shared with the people we love. #brownie #homebaker', imageIdea: 'A close photo of a warm brownie tray on a wooden table by a window.' });
const DECENT = '{"decent":true,"reasons":[]}';
const NOT_DECENT = '{"decent":false,"reasons":["mocks a shop"]}';
const REF = `${C1}.p-ABC1`;
const quiet = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };
let keyN = 0;
const key = () => `key-${String(++keyN).padStart(6, '0')}`;

const userOf = (id, extra = {}) => ({
  _id: id, plan: { tier: 'starter', addons: ['competitors'] },
  businessProfile: { name: 'Anu Bakes', industry: 'Home bakery', description: 'Eggless brownie and cakes from a home kitchen', contentLanguage: 'tamil' }, ...extra
});
const competitor = (id, userId, extra = {}) => ({ _id: id, userId, name: 'Sweet Truth', socialHandles: { instagram: 'sweettruth_chennai' }, isActive: true, handleStatus: 'confirmed', createdAt: new Date('2026-06-01'), ...extra });
const snapshot = (competitorId, userId, extra = {}) => ({
  userId, competitorId, weekStart: '2026-10-12', ok: true,
  posts: [{ at: new Date(NOW - DAY), type: 'video', likes: 300, comments: 12, url: 'https://www.instagram.com/p/ABC1/' }, { at: new Date(NOW - 2 * DAY), type: 'image', likes: 40, comments: 1, url: 'https://www.instagram.com/p/ABC2/' }],
  topPost: { url: 'https://www.instagram.com/p/ABC1/', likes: 300, comments: 12, type: 'Video', caption: 'Sweet Truth hazelnut brownie is finally here for the weekend' }, hashtags: ['brownie'], ...extra
});

function world({ users = {}, wallet = {}, competitors, snapshots, writes = [], checks = [], env = { ENABLE_COMPETITOR_DRAFTS: 'on' }, guard = null, Draft = createFakeDraftModel(), payers = {}, frozen = [], now = () => NOW } = {}) {
  const purse = new Map(Object.entries({ [U1]: 100, [U2]: 100, [AGENCY]: 100, ...wallet }));
  const money = [];
  const alerts = [];
  const calls = { write: 0, check: 0, spend: 0, refund: 0, guard: [], prompts: [], checksSeen: [] };
  const comps = competitors || [competitor(C1, U1), competitor(C2, U2, { name: 'Cake Zone', socialHandles: { instagram: 'cakezone' } })];
  const snaps = snapshots || [snapshot(C1, U1), snapshot(C2, U2)];
  const payerOf = (uid) => payers[uid] || uid;
  const deps = {
    Draft: () => Draft,
    competitorsFor: async (uid) => comps.filter((c) => String(c.userId) === String(uid)),
    snapshotsFor: async (uid, cid) => snaps.filter((s) => String(s.competitorId) === String(cid)),
    pillarsFor: async () => ['Fresh bakes'],
    productsFor: async () => ['Brownie box'],
    settle: async () => null,
    spend: async (uid, cost, o) => {
      calls.spend++;
      if (frozen.includes(uid)) return { success: false, frozen: true };
      const payer = payerOf(uid);
      if ((purse.get(payer) || 0) < cost) return { success: false };
      purse.set(payer, purse.get(payer) - cost);
      money.push({ type: 'spend', uid, payer, cost, action: o.action, ref: o.ref });
      return { success: true, payerId: payer };
    },
    refundTo: async (uid, q, o) => {
      calls.refund++;
      const payer = o.payerId || payerOf(uid);
      purse.set(payer, (purse.get(payer) || 0) + q);
      money.push({ type: 'refund', uid, payer, cost: q, action: o.action, ref: o.ref });
      return { ok: true, payerId: payer };
    },
    findSpend: async (ref) => { const m = money.find((x) => x.type === 'spend' && x.ref === ref); return m ? { user: m.payer, workspace: m.payer !== m.uid ? m.uid : undefined, quarks: -m.cost } : null; },
    findRefund: async (ref) => money.find((x) => x.type === 'refund' && x.ref === ref) || null,
    guard: async (a) => { calls.guard.push(a); return guard ? guard(a) : { ok: true }; },
    write: async (prompt) => {
      calls.write++; calls.prompts.push(prompt);
      const next = writes.length ? writes.shift() : null;
      if (typeof next === 'function') return next(prompt);
      return next === null ? (prompt.system.includes('"caption"') ? OK_POST : OK_COMMENT) : next;
    },
    check: async (prompt) => {
      calls.check++; calls.checksSeen.push(prompt);
      const next = checks.length ? checks.shift() : DECENT;
      return typeof next === 'function' ? next(prompt) : next;
    },
    alert: (k) => alerts.push(k),
    env,
    now
  };
  const svc = createHomeDrafts(deps);
  const user = (id = U1, extra = {}) => ({ ...userOf(id), ...(users[id] || {}), ...extra });
  return { svc, deps, Draft, purse, money, calls, alerts, user };
}
const make = (w, kind = 'witty_comment', body = {}, u = w.user()) => w.svc.make(u, kind, { ref: REF, key: key(), ...body });
const net = (w, payer = U1) => w.money.filter((m) => m.payer === payer).reduce((n, m) => n + (m.type === 'spend' ? -m.cost : m.cost), 0);

test('prices come from config/apiCosts.js only, with the posts equivalent beside them', () => {
  const p = prices();
  assert.strictEqual(p.witty_comment.quarks, QUARK_COSTS.home_witty_comment);
  assert.strictEqual(p.response_post.quarks, QUARK_COSTS.home_response_post);
  assert.match(p.witty_comment.price, /^\d+ Quarks \(about \d+ posts?'s? worth\)$/);
  assert.match(p.response_post.worth, /^about \d+ posts?'s? worth$/, 'agencies see the posts equivalent without Quarks');
});

test('a decent comment: one charge, one writing call, one check, the draft shown and kept on the ledger row', async () => {
  const w = world();
  const r = await make(w);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.deepStrictEqual(r.body.draft, { comment: 'Lovely reel, the slow-motion pour made us hungry.' });
  assert.strictEqual(r.body.quarks, COMMENT);
  assert.strictEqual(w.calls.write, 1); assert.strictEqual(w.calls.check, 1); assert.strictEqual(w.calls.refund, 0);
  assert.strictEqual(net(w), -COMMENT);
  const row = w.Draft.rows[0];
  assert.strictEqual(row.status, 'done'); assert.strictEqual(row.outcome, 'ok'); assert.strictEqual(row.attempts, 1); assert.strictEqual(row.checks, 1);
  assert.strictEqual(row.quarks, COMMENT); assert.strictEqual(row.payerId, U1); assert.strictEqual(row.inFlight, undefined); assert.strictEqual(row.day, istDay(NOW));
  assert.strictEqual(w.money[0].action, 'home_witty_comment'); assert.strictEqual(w.money[0].ref, String(row._id));
  assert.deepStrictEqual(w.calls.guard, ['home_witty_comment', 'campaign_text'], 'the drafts switch and the Writing switch are both checked');
});

test('a response post: caption and picture idea, charged at its own price', async () => {
  const w = world();
  const r = await make(w, 'response_post');
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.draft.caption.length > 40 && r.body.draft.imageIdea.length > 10);
  assert.strictEqual(net(w), -POST);
  assert.strictEqual(w.money[0].action, 'home_response_post');
});

test('the writer never sees the competitor name, handle or caption, and the stored caption never reaches the result', async () => {
  const w = world({ writes: [(p) => JSON.stringify({ comment: 'Sweet Truth hazelnut brownie is finally here for the weekend' }), (p) => JSON.stringify({ comment: 'Love the hazelnut brownie is finally here vibe.' })] });
  const r = await make(w);
  for (const prompt of w.calls.prompts) {
    const all = `${prompt.system}\n${prompt.user}`.toLowerCase();
    for (const bad of ['sweet truth', 'sweettruth', 'hazelnut', 'finally here', 'cake zone']) assert.ok(!all.includes(bad), bad);
  }
  assert.strictEqual(r.status, 422, 'an echo of the name or caption is never shown');
  assert.ok(!JSON.stringify(r.body).toLowerCase().includes('hazelnut'));
  assert.strictEqual(net(w), 0, 'refunded');
});

test('the second check fails closed: an invalid answer, a wrong shape or an error shows nothing and refunds', async () => {
  for (const bad of ['not json', '{"safe":true}', '{"decent":"yes","reasons":[]}', () => { throw new Error('timeout'); }]) {
    const w = world({ checks: [bad] });
    const r = await quiet(() => make(w));
    assert.strictEqual(r.status, 502, String(bad));
    assert.strictEqual(r.body.draft, undefined);
    assert.strictEqual(r.body.message, MESSAGES.failed);
    assert.strictEqual(r.body.refunded, true);
    assert.strictEqual(w.calls.write, 1, 'no second writing call after a failed check');
    assert.strictEqual(net(w), 0);
    assert.strictEqual(w.Draft.rows[0].outcome, 'check_unavailable');
    assert.strictEqual(w.Draft.rows[0].refunded, true);
  }
});

test('at most one more try: a first draft that fails a check is written again once, then the plain refusal', async () => {
  // local filter blocks the first, the second passes
  let w = world({ writes: [JSON.stringify({ comment: 'Unlike them, we bake fresh.' }), OK_COMMENT] });
  let r = await make(w);
  assert.strictEqual(r.status, 200); assert.strictEqual(w.calls.write, 2); assert.strictEqual(w.calls.check, 1, 'the blocked draft never reaches the model check');
  assert.deepStrictEqual(w.Draft.rows[0].reasons, ['phrase']);
  // the model says no twice
  w = world({ checks: [NOT_DECENT, NOT_DECENT] });
  r = await make(w);
  assert.strictEqual(r.status, 422); assert.strictEqual(r.body.message, 'We could not write a draft we are happy with. Nothing was charged.');
  assert.strictEqual(w.calls.write, caps.MAX_ATTEMPTS); assert.strictEqual(w.calls.check, 2);
  assert.strictEqual(w.Draft.rows[0].outcome, 'blocked_model'); assert.strictEqual(net(w), 0);
  // the local filter twice
  w = world({ writes: [JSON.stringify({ comment: 'What a joke, honestly.' }), JSON.stringify({ comment: 'Pathetic reel, sorry.' })] });
  r = await make(w);
  assert.strictEqual(r.status, 422); assert.strictEqual(w.calls.write, 2); assert.strictEqual(w.calls.check, 0);
  assert.strictEqual(w.Draft.rows[0].outcome, 'blocked_local'); assert.ok(w.Draft.rows[0].reasons.length > 0);
  assert.ok(w.Draft.rows[0].reasons.every((x) => /^[a-z]+$/.test(x)), 'rule codes only, never the text');
  assert.strictEqual(w.Draft.rows[0].result, undefined, 'a refused draft is never stored');
  // an unreadable writing reply counts as a failed try
  w = world({ writes: ['not json', 'still not json'] });
  r = await make(w);
  assert.strictEqual(r.status, 422); assert.deepStrictEqual(w.Draft.rows[0].reasons, ['shape']); assert.strictEqual(net(w), 0);
});

test('a writing call that fails stops at once (no second paid call) and refunds', async () => {
  const w = world({ writes: [() => { throw new Error('OpenAI HTTP 500'); }] });
  const r = await quiet(() => make(w));
  assert.strictEqual(r.status, 502); assert.strictEqual(r.body.message, MESSAGES.failed);
  assert.strictEqual(w.calls.write, 1); assert.strictEqual(w.calls.check, 0); assert.strictEqual(net(w), 0);
  assert.strictEqual(w.Draft.rows[0].outcome, 'write_failed');
});

test('ownership: another account\'s post, an untracked competitor or a made-up post is refused before any charge', async () => {
  const w = world({ competitors: [competitor(C1, U1), competitor(C2, U2), ...[1, 2, 3, 4, 5].map((i) => competitor(`6b00000000000000000000a${i}`, U1, { createdAt: new Date(`2026-07-0${i}`) }))] });
  for (const ref of [`${C2}.p-ABC1`, REF, `${C1}.p-NOPE`, `${C1}.t-123`, 'junk', `${C1}.p-ABC1 `]) {
    const r = await make(w, 'witty_comment', { ref });
    assert.ok([400, 404].includes(r.status), `${ref}: ${r.status}`);
  }
  assert.strictEqual(w.calls.spend, 0); assert.strictEqual(w.calls.write, 0); assert.strictEqual(w.Draft.rows.length, 0);
});

test('snapshots of another account are never used, even if a store returned them', async () => {
  const w = world({ snapshots: [snapshot(C1, U2)] });
  const r = await make(w);
  assert.strictEqual(r.status, 404); assert.strictEqual(w.calls.spend, 0);
});

test('entitlement: free and paid without the add-on are refused with a plain message; managed and agency may use it', async () => {
  const w = world();
  let r = await make(w, 'witty_comment', {}, w.user(U1, { plan: { tier: 'free' } }));
  assert.strictEqual(r.status, 403); assert.strictEqual(r.body.locked, 'upgrade'); assert.strictEqual(r.body.message, MESSAGES.upgrade);
  r = await make(w, 'witty_comment', {}, w.user(U1, { plan: { tier: 'professional', addons: ['publish'] } }));
  assert.strictEqual(r.status, 403); assert.strictEqual(r.body.locked, 'addon'); assert.strictEqual(r.body.message, MESSAGES.addon);
  assert.strictEqual(w.calls.spend, 0);
  r = await make(w, 'witty_comment', {}, w.user(U1, { plan: {} }));
  assert.strictEqual(r.status, 200, 'managed accounts are never blocked');
  r = await make(w, 'witty_comment', {}, w.user(U1, { plan: { tier: 'agency' } }));
  assert.strictEqual(r.status, 200);
});

test('switch off (the default), staff themselves and bad input are refused without any work', async () => {
  let w = world({ env: {} });
  let r = await make(w);
  assert.strictEqual(r.status, 503); assert.strictEqual(r.body.disabled, true); assert.strictEqual(r.body.message, MESSAGES.off);
  w = world();
  r = await make(w, 'witty_comment', {}, w.user(U1, { staffRole: 'admin' }));
  assert.strictEqual(r.status, 403);
  r = await w.svc.make(w.user(U1, { isCsm: true }), 'witty_comment', { ref: REF, key: key() }, { pass: true });
  assert.strictEqual(r.status, 200, 'a CSM inside a client acts as the client');
  for (const body of [{ key: 'short' }, { key: 'bad key with spaces' }, { ref: 5 }, { ref: { $gt: '' } }]) {
    r = await make(w, 'witty_comment', body);
    assert.strictEqual(r.status, 400, JSON.stringify(body));
  }
  r = await make(w, 'rival_post');
  assert.strictEqual(r.status, 400);
  r = await w.svc.make({}, 'witty_comment', { ref: REF, key: key() });
  assert.strictEqual(r.status, 401);
  assert.strictEqual(w.calls.spend, 1);
});

test('idempotency: the same key again returns the same draft and is never charged twice', async () => {
  const w = world();
  const k = key();
  const a = await w.svc.make(w.user(), 'witty_comment', { ref: REF, key: k });
  const b = await w.svc.make(w.user(), 'witty_comment', { ref: REF, key: k });
  assert.strictEqual(a.status, 200); assert.strictEqual(b.status, 200); assert.strictEqual(b.body.replay, true);
  assert.deepStrictEqual(b.body.draft, a.body.draft);
  assert.strictEqual(w.calls.spend, 1); assert.strictEqual(w.calls.write, 1); assert.strictEqual(net(w), -COMMENT);
  // a refused key stays refused, and is not charged again either
  const w2 = world({ checks: [NOT_DECENT, NOT_DECENT] });
  const k2 = key();
  await w2.svc.make(w2.user(), 'witty_comment', { ref: REF, key: k2 });
  const again = await w2.svc.make(w2.user(), 'witty_comment', { ref: REF, key: k2 });
  assert.strictEqual(again.status, 422); assert.strictEqual(again.body.replay, true); assert.strictEqual(w2.calls.spend, 1); assert.strictEqual(net(w2), 0);
});

test('a double click (two requests at once, same key) charges once; two different requests at once: one waits', async () => {
  const w = world();
  const k = key();
  const [a, b] = await Promise.all([w.svc.make(w.user(), 'witty_comment', { ref: REF, key: k }), w.svc.make(w.user(), 'witty_comment', { ref: REF, key: k })]);
  assert.deepStrictEqual([a.status, b.status].sort(), [200, 409]);
  assert.strictEqual(w.calls.spend, 1); assert.strictEqual(net(w), -COMMENT);
  const [c, d] = await Promise.all([make(w), make(w)]);
  assert.deepStrictEqual([c.status, d.status].sort(), [200, 409]);
  assert.strictEqual(w.calls.spend, 2);
});

test('two server processes (no shared memory) still run one request per account: the database lock decides', async () => {
  const Draft = createFakeDraftModel();
  const w = world({ Draft });
  const other = createHomeDrafts({ ...w.deps });
  const [a, b] = await Promise.all([w.svc.make(w.user(), 'witty_comment', { ref: REF, key: key() }), other.make(w.user(), 'witty_comment', { ref: REF, key: key() })]);
  assert.deepStrictEqual([a.status, b.status].sort(), [200, 409]);
  assert.strictEqual(w.calls.spend, 1);
  assert.strictEqual(Draft.rows.length, 1, 'the second insert was refused by the one-in-flight index');
});

test('caps: per minute, per India day, refused drafts per day, and all accounts per day; nothing is charged when capped', async () => {
  // per minute
  let w = world();
  for (let i = 0; i < caps.MAX_PER_MINUTE; i++) assert.strictEqual((await make(w)).status, 200);
  let r = await make(w);
  assert.strictEqual(r.status, 429); assert.strictEqual(r.body.limit, 'minute');
  // per day: rows of today that reached the model
  const fill = (Draft, n, extra = {}) => { for (let i = 0; i < n; i++) Draft.rows.push({ _id: `x${i}`, userId: U1, key: `old-${i}-${Math.random()}`, kind: 'witty_comment', day: istDay(NOW), attempts: 1, status: 'done', createdAt: new Date(NOW - 3600e3), ...extra }); };
  w = world(); fill(w.Draft, caps.MAX_DRAFTS_PER_DAY);
  r = await make(w);
  assert.strictEqual(r.status, 429); assert.strictEqual(r.body.limit, 'day'); assert.strictEqual(r.body.message, MESSAGES.perDay);
  w = world(); fill(w.Draft, caps.MAX_DRAFTS_PER_DAY, { day: istDay(new Date(NOW - DAY)) });
  assert.strictEqual((await make(w)).status, 200, 'yesterday does not count');
  w = world(); fill(w.Draft, caps.MAX_BLOCKED_PER_DAY, { status: 'blocked', attempts: 0 });
  r = await make(w);
  assert.strictEqual(r.status, 429); assert.strictEqual(r.body.limit, 'blocked');
  w = world(); fill(w.Draft, caps.MAX_DRAFTS_ALL_ACCOUNTS_PER_DAY, { userId: U2 });
  r = await make(w);
  assert.strictEqual(r.status, 503); assert.strictEqual(r.body.serviceBusy, true);
  assert.strictEqual(w.calls.spend, 0);
});

test('spend guard: a reached ceiling or a staff switch refuses before any ledger row, charge or call', async () => {
  for (const off of ['home_witty_comment', 'campaign_text']) {
    const w = world({ guard: (a) => (a === off ? { ok: false, reason: 'switched_off' } : { ok: true }) });
    const r = await make(w);
    assert.strictEqual(r.status, 503); assert.strictEqual(r.body.message, MESSAGES.busy);
    assert.strictEqual(w.Draft.rows.length, 0); assert.strictEqual(w.calls.spend, 0); assert.strictEqual(w.calls.write, 0);
  }
});

test('not enough Quarks: the request is closed as refused, nothing is called, and the message names the price', async () => {
  const w = world({ wallet: { [U1]: COMMENT - 1 } });
  const r = await make(w);
  assert.strictEqual(r.status, 403); assert.strictEqual(r.body.creditsExhausted, true);
  assert.match(r.body.message, new RegExp(`^This draft needs ${COMMENT} Quarks \\(about`));
  assert.strictEqual(w.calls.write, 0); assert.strictEqual(w.Draft.rows[0].status, 'refused'); assert.strictEqual(w.Draft.rows[0].inFlight, undefined);
});

test('an agency client pays from the agency pool and is refunded to it; a frozen client is refused', async () => {
  const w = world({ competitors: [competitor(C1, CLIENT)], snapshots: [snapshot(C1, CLIENT)], payers: { [CLIENT]: AGENCY }, checks: [NOT_DECENT, NOT_DECENT] });
  const client = w.user(CLIENT, { plan: { tier: 'agency' } });
  const r = await make(w, 'witty_comment', {}, client);
  assert.strictEqual(r.status, 422);
  assert.deepStrictEqual(w.money.map((m) => [m.type, m.payer]), [['spend', AGENCY], ['refund', AGENCY]]);
  assert.strictEqual(w.purse.get(AGENCY), 100);
  assert.strictEqual(w.Draft.rows[0].payerId, AGENCY);
  const w2 = world({ competitors: [competitor(C1, CLIENT)], snapshots: [snapshot(C1, CLIENT)], payers: { [CLIENT]: AGENCY }, frozen: [CLIENT] });
  const f = await make(w2, 'witty_comment', {}, w2.user(CLIENT, { plan: { tier: 'agency' } }));
  assert.strictEqual(f.status, 403); assert.strictEqual(f.body.message, MESSAGES.frozen); assert.strictEqual(w2.calls.write, 0);
});

test('ledger before the call: no ledger row means no charge and no call; a lost counter write stops and refunds', async () => {
  let w = world({ Draft: createFakeDraftModel({ failCreate: true }) });
  let r = await make(w);
  assert.strictEqual(r.status, 503); assert.strictEqual(w.calls.spend, 0); assert.strictEqual(w.calls.write, 0);
  w = world({ Draft: createFakeDraftModel({ failInc: true }) });
  r = await quiet(() => make(w));
  assert.strictEqual(w.calls.write, 0, 'the writing call is never made when its count could not be stored');
  assert.strictEqual(net(w), 0); assert.ok(r.status >= 500);
  w = world({ Draft: createFakeDraftModel({ failCharge: true }) });
  r = await quiet(() => make(w));
  assert.strictEqual(w.calls.write, 0, 'a charge that is not on the ledger is given straight back and nothing is called');
  assert.strictEqual(net(w), 0); assert.strictEqual(r.status, 503);
});

test('a request lost in a restart is closed on the next request, and its Quarks go back once', async () => {
  let t = NOW.getTime();
  const w = world({ now: () => new Date(t) });
  w.Draft.rows.push({ _id: 'lost1', userId: U1, key: 'lost-key-1', kind: 'witty_comment', day: istDay(NOW), status: 'charged', inFlight: true, attempts: 1, checks: 0, quarks: COMMENT, payerId: U1, refunded: false, startedAt: new Date(t - caps.STALE_MS - 1000), createdAt: new Date(t - caps.STALE_MS - 1000) });
  t += 61000;
  const r = await make(w);
  assert.strictEqual(r.status, 200);
  const lost = w.Draft.rows.find((x) => x._id === 'lost1');
  assert.strictEqual(lost.status, 'failed'); assert.strictEqual(lost.outcome, 'stale'); assert.strictEqual(lost.refunded, true); assert.strictEqual(lost.inFlight, undefined);
  assert.deepStrictEqual(w.money.filter((m) => m.type === 'refund').map((m) => m.ref), ['lost1']);
  await w.svc.recoverStale(U1);
  assert.strictEqual(w.money.filter((m) => m.type === 'refund').length, 1, 'never refunded twice');
});

test('a refund that does not land is flagged on the row and raised as an alert, and the message says so', async () => {
  const w = world({ checks: [NOT_DECENT, NOT_DECENT] });
  w.deps.refundTo = async () => ({ ok: false });
  const svc = createHomeDrafts(w.deps);
  const r = await svc.make(w.user(), 'witty_comment', { ref: REF, key: key() });
  assert.strictEqual(r.status, 422); assert.strictEqual(r.body.refunded, false); assert.strictEqual(r.body.message, MESSAGES.refundLate);
  assert.strictEqual(w.Draft.rows[0].refundFailed, true); assert.deepStrictEqual(w.alerts, ['home_draft_refund']);
});

test('Tamil and Hindi drafts go through the same checks: a decent one is shown, an unkind one is refused', async () => {
  let w = world({ writes: [JSON.stringify({ comment: 'ரொம்ப அழகான ரீல், பார்த்தாலே பசிக்குது.' })] });
  let r = await make(w, 'witty_comment', { language: 'tamil' });
  assert.strictEqual(r.status, 200); assert.strictEqual(r.body.language, 'tamil');
  assert.ok(w.calls.prompts[0].system.includes('Tamil, in Tamil script'));
  w = world({ writes: [JSON.stringify({ comment: 'இது மொக்கை போஸ்ட்' }), JSON.stringify({ comment: 'यह केक बकवास है, सच में' })] });
  r = await make(w, 'witty_comment', { language: 'hindi' });
  assert.strictEqual(r.status, 422); assert.strictEqual(w.calls.check, 0); assert.strictEqual(net(w), 0);
});

test('options: prices, the switch, entitlement, languages and drafts left today; staff get nothing', async () => {
  const w = world();
  await make(w);
  const o = await w.svc.options(w.user());
  assert.strictEqual(o.enabled, true); assert.strictEqual(o.entitled, true); assert.strictEqual(o.language, 'tamil');
  assert.strictEqual(o.left, caps.MAX_DRAFTS_PER_DAY - 1);
  assert.strictEqual(o.prices.witty_comment.quarks, COMMENT);
  assert.deepStrictEqual(o.languages.map((l) => l.key), ['english', 'tamil', 'hindi', 'telugu', 'kannada', 'malayalam']);
  assert.strictEqual(o.postsOnly, false);
  assert.strictEqual((await w.svc.options(w.user(U1, { plan: { tier: 'agency' } }))).postsOnly, true, 'an agency sees posts, not Quarks');
  assert.strictEqual((await w.svc.options(w.user(CLIENT, { agency: { ownerId: AGENCY } }))).postsOnly, true, 'so does its client workspace');
  assert.deepStrictEqual(await w.svc.options(w.user(U1, { staffRole: 'admin' })), { staff: true });
  const off = await world({ env: {} }).svc.options(w.user(U1, { plan: { tier: 'free' } }));
  assert.strictEqual(off.enabled, false); assert.strictEqual(off.entitled, false); assert.strictEqual(off.locked, 'upgrade');
});

test('the check runs on the cheapest configured text model, through the same provider routing with no fallback', () => {
  assert.strictEqual(checkModel({}), 'gpt-6.1-sol');
  assert.strictEqual(checkModel({ TEXT_MODEL_REGIONAL: 'r-model' }), 'r-model');
  assert.strictEqual(checkModel({ LISTENING_MODEL: 'gpt-4o-mini', TEXT_MODEL_REGIONAL: 'r' }), 'gpt-4o-mini');
  assert.strictEqual(checkModel({ DECENCY_CHECK_MODEL: 'd', LISTENING_MODEL: 'l' }), 'd');
  const src = require('node:fs').readFileSync(require.resolve('../services/homeDrafts/service.js'), 'utf8');
  assert.strictEqual((src.match(/noFallback: true/g) || []).length, 2, 'both calls are pinned: a failure is never a second paid call elsewhere');
});

test('every customer message follows the wording rule', () => {
  const guard = require('../config/competitorWording');
  for (const [k, m] of Object.entries(MESSAGES)) {
    assert.ok(guard.every((re) => !re.test(m)), `${k}: ${m}`);
    assert.ok(/^[A-Z]/.test(m) && /\.$/.test(m), k);
  }
});

// ---- crash between the charge and the "charged" mark, silent refund failure, refunded-yet-delivered race ----
const lostRow = (t, extra = {}) => ({ _id: 'crash1', userId: U1, key: 'crash-key-1', kind: 'witty_comment', day: istDay(NOW), status: 'started', inFlight: true, chargedConfirmed: false, attempts: 0, checks: 0, quarks: COMMENT, payerId: U1, refunded: false, startedAt: new Date(t - caps.STALE_MS - 5000), leaseAt: new Date(t - caps.STALE_MS - 5000), createdAt: new Date(t - 1000), ...extra });

test('crash after the charge but before the charged mark: a stale row is refunded once, to the wallet that paid', async () => {
  const w = world();
  w.Draft.rows.push(lostRow(NOW.getTime()));
  await w.deps.spend(U1, COMMENT, { action: 'home_witty_comment', ref: 'crash1' });
  assert.strictEqual(net(w), -COMMENT);
  await w.svc.recoverStale(U1);
  const row = w.Draft.rows[0];
  assert.strictEqual(row.status, 'failed'); assert.strictEqual(row.outcome, 'stale'); assert.strictEqual(row.refunded, true); assert.strictEqual(row.inFlight, undefined);
  assert.strictEqual(net(w), 0);
  assert.deepStrictEqual(w.money.filter((m) => m.type === 'refund').map((m) => [m.ref, m.cost, m.payer]), [['crash1', COMMENT, U1]]);
  await w.svc.recoverStale(U1);
  assert.strictEqual(w.money.filter((m) => m.type === 'refund').length, 1, 'recovery run twice refunds once');
});

test('crash after the charge for an agency client: the refund goes to the agency pool that paid', async () => {
  const w = world({ payers: { [CLIENT]: AGENCY }, wallet: { [CLIENT]: 0 } });
  w.Draft.rows.push(lostRow(NOW.getTime(), { userId: CLIENT, key: 'crash-key-2', payerId: CLIENT }));
  await w.deps.spend(CLIENT, COMMENT, { action: 'home_witty_comment', ref: 'crash1' });
  assert.strictEqual(w.purse.get(AGENCY), 100 - COMMENT);
  await w.svc.recoverStale(CLIENT);
  assert.strictEqual(w.purse.get(AGENCY), 100); assert.strictEqual(w.purse.get(CLIENT), 0);
  assert.deepStrictEqual(w.money.filter((m) => m.type === 'refund').map((m) => m.payer), [AGENCY]);
  assert.strictEqual(w.Draft.rows[0].refunded, true);
});

test('crash before the charge: the stale row is closed with no refund', async () => {
  const w = world();
  w.Draft.rows.push(lostRow(NOW.getTime()));
  await w.svc.recoverStale(U1);
  assert.strictEqual(w.Draft.rows[0].status, 'failed'); assert.strictEqual(w.Draft.rows[0].inFlight, undefined);
  assert.strictEqual(w.calls.refund, 0); assert.strictEqual(w.money.length, 0);
});

test('a stale unconfirmed row is not refunded again when the ledger already shows a refund, and a failed lookup leaves it open', async () => {
  const w = world();
  w.Draft.rows.push(lostRow(NOW.getTime()));
  await w.deps.spend(U1, COMMENT, { action: 'home_witty_comment', ref: 'crash1' });
  await w.deps.refundTo(U1, COMMENT, { action: 'home_witty_comment_refund', ref: 'crash1', payerId: U1 });
  w.calls.refund = 0;
  await w.svc.recoverStale(U1);
  assert.strictEqual(w.calls.refund, 0); assert.strictEqual(net(w), 0);
  const v = world();
  v.Draft.rows.push(lostRow(NOW.getTime()));
  v.deps.findSpend = async () => { throw new Error('ledger down'); };
  await createHomeDrafts(v.deps).recoverStale(U1);
  assert.strictEqual(v.Draft.rows[0].inFlight, true, 'still open, looked at again later');
});

test('the intent (quarks, payer) is on the row before the charge is made', async () => {
  const w = world();
  let seen = null;
  const spend = w.deps.spend;
  w.deps.spend = async (...a) => { seen = { ...w.Draft.rows[0] }; return spend(...a); };
  const svc = createHomeDrafts(w.deps);
  const r = await svc.make(w.user(), 'witty_comment', { ref: REF, key: key() });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(seen.quarks, COMMENT); assert.strictEqual(seen.chargedConfirmed, false); assert.ok(seen.payerId);
  assert.strictEqual(w.Draft.rows[0].chargedConfirmed, true);
});

test('the charged mark and the refund both failing: refundFailed is set, refunded stays false, and an alert is raised', async () => {
  const w = world({ Draft: createFakeDraftModel({ failCharge: true }) });
  w.deps.refundTo = async () => ({ ok: false });
  const svc = createHomeDrafts(w.deps);
  const r = await quiet(() => svc.make(w.user(), 'witty_comment', { ref: REF, key: key() }));
  const row = w.Draft.rows[0];
  assert.strictEqual(r.status, 503); assert.strictEqual(r.body.refunded, false);
  assert.strictEqual(row.refundFailed, true); assert.strictEqual(row.refunded, false); assert.notStrictEqual(row.outcome, 'ok');
  assert.deepStrictEqual(w.alerts, ['home_draft_refund']);
});

test('the charged mark failing alone: the Quarks go back once and the row says so', async () => {
  const w = world({ Draft: createFakeDraftModel({ failCharge: true }) });
  await quiet(() => make(w));
  assert.strictEqual(net(w), 0); assert.strictEqual(w.Draft.rows[0].refunded, true); assert.strictEqual(w.calls.refund, 1);
});

test('a row closed and refunded by another process is never delivered', async () => {
  const w = world();
  w.deps.check = async () => { const d = w.Draft.rows[0]; d.refunded = true; d.status = 'failed'; d.outcome = 'stale'; delete d.inFlight; return DECENT; };
  const svc = createHomeDrafts(w.deps);
  const r = await svc.make(w.user(), 'witty_comment', { ref: REF, key: key() });
  assert.notStrictEqual(r.status, 200); assert.strictEqual(r.body.draft, undefined); assert.strictEqual(r.body.success, false);
  assert.notStrictEqual(w.Draft.rows[0].status, 'done'); assert.strictEqual(w.Draft.rows[0].result, undefined);
});

test('the lease: a live row with an old start but a fresh lease is not reaped, and every step refreshes it', async () => {
  let t = NOW.getTime();
  const w = world({ now: () => new Date(t) });
  w.Draft.rows.push(lostRow(t, { leaseAt: new Date(t - 1000) }));
  await w.svc.recoverStale(U1);
  assert.strictEqual(w.Draft.rows[0].inFlight, true);
  const w2 = world({ now: () => new Date(t) });
  w2.deps.write = async () => { t += 90000; return OK_COMMENT; };
  w2.deps.check = async () => { assert.strictEqual(new Date(w2.Draft.rows[0].leaseAt).getTime(), t, 'refreshed when the check was counted, after the slow write'); t += 90000; return DECENT; };
  const svc = createHomeDrafts(w2.deps);
  const r = await svc.make(w2.user(), 'witty_comment', { ref: REF, key: key() });
  assert.strictEqual(r.status, 200);
  assert.ok(new Date(w2.Draft.rows[0].startedAt).getTime() <= NOW.getTime() + 1, 'startedAt is the creation time');
});

test('STALE_MS is longer than the worst case of one request, computed from the timeouts', () => {
  const worst = 2 * 20000 + 2 * 20000 + caps.MAX_ATTEMPTS * (caps.CALL_TIMEOUT_MS + caps.CALL_TIMEOUT_MS);
  assert.strictEqual(caps.DB_TIMEOUT_MS, 20000);
  assert.ok(caps.STALE_MS > worst, `${caps.STALE_MS} must exceed ${worst}`);
  assert.ok(caps.STALE_MS > caps.WORST_CASE_MS);
});
