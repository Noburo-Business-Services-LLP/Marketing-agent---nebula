// backend/tests/weekService.test.js
const test = require('node:test');
const assert = require('node:assert');
const { createWeekService } = require('../services/week/weekService');

const NOW = new Date('2026-10-17T06:00:00Z');
// Approve only claims; this also makes the approved posts, as the route's follow-up does.
const ar = async (svc, extra = {}) => { const a = await svc.approve({ user: user(), now: NOW, ...extra }); const r = await svc.runApprovedPosts({ user: user(), now: NOW }); return { ...a, proposal: r.proposal || a.proposal }; };
const user = (extra = {}) => ({ _id: 'u1', isActive: true, onboardingCompleted: true, plan: { tier: 'starter' }, businessProfile: { name: 'Sweet Co', website: 'a.in', description: 'Custom cakes baked to order', targetAudience: 'Families' }, ...extra });
function world({ pool = 2000, genFails = false, deductOk = true, refundOk = true } = {}) {
  const store = new Map(); const log = { deduct: [], refund: [], generate: [], alerts: [] };
  const deps = {
    costs: { post: 11, carousel: 60, video: 161 },
    pool: async () => pool,
    cadence: async () => ({ reelsPerWeek: 1 }),
    calendarItemsForWeek: async () => [{ _id: 'c1', day: 13, format: 'image post', headline: 'Idea 1', contentPillar: 'P' }, { _id: 'c2', day: 14, format: 'image post', headline: 'Idea 2', contentPillar: 'P' }, { _id: 'c3', day: 15, format: 'carousel', headline: 'Five cakes', contentPillar: 'P' }, { _id: 'c4', day: 16, format: 'reel', headline: 'Behind the oven', contentPillar: 'P' }],
    planCalendarForWeek: async () => [],
    store: {
      find: async (q) => store.get(`${q.userId}:${q.weekStart}`) || null,
      create: async (doc) => { store.set(`${doc.userId}:${doc.weekStart}`, doc); return doc; },
      claimItem: async (q, itemId, from, to, extra = {}) => { const d = store.get(`${q.userId}:${q.weekStart}`); const it = d.items.find((i) => i.id === itemId); if (!it || it.status !== from) return false; it.status = to; Object.assign(it, extra); return true; },
      claimStale: async (q, itemId, before, at) => { const d = store.get(`${q.userId}:${q.weekStart}`); const it = d.items.find((i) => i.id === itemId); if (!it || it.status !== 'making' || !(new Date(it.makingAt) < before)) return false; it.makingAt = at; return true; },
      findOpen: async (userId, fromWeek) => [...store.values()].filter((d) => String(d.userId) === String(userId) && d.weekStart >= fromWeek && d.items.some((i) => ['approved', 'making'].includes(i.status))),
      settleItem: async (q, itemId, token, patch) => { const d = store.get(`${q.userId}:${q.weekStart}`); const it = d && d.items.find((i) => i.id === itemId); if (!it || it.status !== 'making' || new Date(it.makingAt).getTime() !== new Date(token).getTime()) return false; Object.assign(it, patch); return true; },
      flipCharged: async (q, itemId, token, from, to, extra = {}) => { if (log.flipFails && to === true && from === false) throw new Error('db down'); const d = store.get(`${q.userId}:${q.weekStart}`); const it = d && d.items.find((i) => i.id === itemId); if (!it || it.status !== 'making' || new Date(it.makingAt).getTime() !== new Date(token).getTime() || !!it.charged !== from) return false; it.charged = to; Object.assign(it, extra); return true; },
      setItem: async (q, itemId, patch) => { const d = store.get(`${q.userId}:${q.weekStart}`); Object.assign(d.items.find((i) => i.id === itemId), patch); },
      setStatus: async (q, status) => { store.get(`${q.userId}:${q.weekStart}`).status = status; }
    },
    deduct: async (id, action, n, why) => { log.deduct.push([id, action]); return { success: deductOk, payerId: 'payer1' }; },
    refund: async (id, action, n, why, opts) => { log.refund.push([id, action, opts]); return { success: refundOk }; },
    spendCheck: async () => (log.busy ? { ok: false } : { ok: true }),
    alertOwner: async (a) => { log.alerts.push(a); },
    generate: async (cal, item) => { log.generate.push(item._id || item.calendarItemId); if (genFails) throw new Error('image failed'); return { draftId: 'd' + log.generate.length }; },
    calendarFor: async () => ({ calendar: { _id: 'cal' }, find: (id) => ({ _id: id }), weekNumber: 3 }),
    markFirstApproval: async (id, at) => { if (!log.firstApproval) log.firstApproval = at; log.firstApprovalCalls = (log.firstApprovalCalls || 0) + 1; },
    now: () => NOW
  };
  return { svc: createWeekService(deps), log, store, deps };
}

test('the week is proposed once and the same document comes back the second time', async () => {
  const { svc } = world();
  const a = await svc.getOrCreate({ user: user(), now: NOW });
  const b = await svc.getOrCreate({ user: user(), now: NOW });
  assert.strictEqual(a.eligible, true);
  assert.strictEqual(a.proposal.weekStart, '2026-10-12');
  assert.deepStrictEqual(a.proposal.items, b.proposal.items);
});

test('free, staff and incomplete accounts get no proposal', async () => {
  for (const patch of [{ plan: { tier: 'free' } }, { staffRole: 'owner' }, { businessProfile: { name: 'x' } }]) {
    const { svc } = world();
    const r = await svc.getOrCreate({ user: user(patch), now: NOW });
    assert.strictEqual(r.eligible, false);
  }
});

test('approve makes each post once and charges once; carousels and videos are only approved and returned with a prefill', async () => {
  const { svc, log } = world();
  await svc.getOrCreate({ user: user(), now: NOW });
  const out = await ar(svc);
  assert.strictEqual(log.generate.length, 2);
  assert.strictEqual(log.deduct.length, 2);
  const byKind = Object.fromEntries(out.proposal.items.map((i) => [i.kind, i.status]));
  assert.strictEqual(byKind.post, 'made');
  assert.strictEqual(byKind.carousel, 'approved');
  assert.strictEqual(byKind.video, 'approved');
  const car = out.proposal.items.find((i) => i.kind === 'carousel');
  assert.ok(out.prefills.some((p) => p.itemId === car.id && p.target === 'carousel'));
});

test('pressing Approve twice at the same moment makes and charges each post once', async () => {
  const { svc, log } = world();
  await svc.getOrCreate({ user: user(), now: NOW });
  await Promise.all([ar(svc), ar(svc)]);
  assert.strictEqual(log.generate.length, 2);
  assert.strictEqual(log.deduct.length, 2);
});

test('a post whose image fails is refunded and shown as failed, not lost; a later approve can retry only the failed post', async () => {
  const { svc, log } = world({ genFails: true });
  await svc.getOrCreate({ user: user(), now: NOW });
  const out = await ar(svc);
  assert.strictEqual(log.refund.length, 2);
  assert.ok(out.proposal.items.filter((i) => i.kind === 'post').every((i) => i.status === 'failed'));
});

test('no pool means nothing is generated and the post is marked failed without a refund', async () => {
  const { svc, log } = world({ deductOk: false });
  await svc.getOrCreate({ user: user(), now: NOW });
  await ar(svc);
  assert.strictEqual(log.generate.length, 0);
  assert.strictEqual(log.refund.length, 0);
});

test('skip and swap only work while an item is still proposed', async () => {
  const { svc } = world();
  const { proposal } = await svc.getOrCreate({ user: user(), now: NOW });
  const id = proposal.items[0].id;
  assert.strictEqual((await svc.change({ user: user(), itemId: id, action: 'swap', topic: 'New idea', now: NOW })).ok, true);
  assert.strictEqual((await svc.change({ user: user(), itemId: id, action: 'skip', now: NOW })).ok, true);
  assert.strictEqual((await svc.change({ user: user(), itemId: id, action: 'skip', now: NOW })).ok, false, 'already skipped');
});

test('a failed post is retried by a later approve, and a made post is never made again', async () => {
  const w = world({ genFails: true });
  await w.svc.getOrCreate({ user: user(), now: NOW });
  await ar(w.svc);
  assert.strictEqual(w.log.generate.length, 2);
  // second press with the generator still broken: the two failed posts are tried again, once each
  await ar(w.svc);
  assert.strictEqual(w.log.generate.length, 4);
  assert.strictEqual(w.log.deduct.length, 4);
  assert.strictEqual(w.log.refund.length, 4);
});

test('made posts stay made on a second approve: nothing more is charged', async () => {
  const { svc, log } = world();
  await svc.getOrCreate({ user: user(), now: NOW });
  await ar(svc);
  const again = await ar(svc);
  assert.strictEqual(again.started, 0);
  assert.strictEqual(log.deduct.length, 2);
  assert.strictEqual(log.generate.length, 2);
});

test('the made post points at the real draft', async () => {
  const { svc } = world();
  await svc.getOrCreate({ user: user(), now: NOW });
  const out = await ar(svc);
  const refs = out.proposal.items.filter((i) => i.kind === 'post').map((i) => i.ref);
  assert.deepStrictEqual(refs, ['d1', 'd2']);
});

test('a post whose picture could not be made is refunded and failed even though the generator returned', async () => {
  const w = world();
  const svc = createWeekService({ ...w.deps, generate: async () => ({ draft: { _id: 'dx', imageUrl: '' } }) });
  await svc.getOrCreate({ user: user(), now: NOW });
  const out = await ar(svc);
  assert.strictEqual(w.log.refund.length, 2);
  assert.ok(out.proposal.items.filter((i) => i.kind === 'post').every((i) => i.status === 'failed' && i.error === 'generation_failed'));
});

test('a pool that pays for nothing is shown but not stored, so a top-up can still make a week', async () => {
  const w = world({ pool: 5 });
  const a = await w.svc.getOrCreate({ user: user(), now: NOW });
  assert.strictEqual(a.reason, 'empty');
  assert.strictEqual(a.proposal.items.length, 0);
  assert.strictEqual(w.store.size, 0);
});

test('a week with no calendar and no plan says so instead of making an empty week', async () => {
  const w = world();
  const svc = createWeekService({ ...w.deps, calendarItemsForWeek: async () => [], planCalendarForWeek: async () => [] });
  const r = await svc.getOrCreate({ user: user(), now: NOW });
  assert.strictEqual(r.eligible, false);
  assert.strictEqual(r.reason, 'no_plan');
});

test('a duplicate-key race on create returns the document that won', async () => {
  const w = world();
  const winner = { userId: 'u1', weekStart: '2026-10-12', status: 'proposed', items: [{ id: 'x', kind: 'post', status: 'proposed' }] };
  let first = true;
  const store = { ...w.deps.store, find: async (q) => (first ? null : winner), create: async () => { first = false; const e = new Error('dup'); e.code = 11000; throw e; } };
  const svc = createWeekService({ ...w.deps, store });
  const r = await svc.getOrCreate({ user: user(), now: NOW });
  assert.strictEqual(r.proposal, winner);
});

test('a plan-sourced post with no calendar is made from a one-off row and charged once', async () => {
  const w = world();
  const seen = [];
  const svc = createWeekService({
    ...w.deps,
    calendarItemsForWeek: async () => [],
    planCalendarForWeek: async () => [{ day: 1, pillar: 'P', format: 'image post', hook: { text: 'From the plan' } }],
    calendarFor: async ({ item }) => ({ calendar: { userId: 'u1' }, find: (id, it) => ({ headline: it.topic }), weekNumber: 1 }),
    generate: async (cal, row) => { seen.push(row.headline); return { draftId: 'dp' }; }
  });
  await svc.getOrCreate({ user: user(), now: NOW });
  const out = await ar(svc);
  assert.deepStrictEqual(seen, ['From the plan']);
  assert.strictEqual(out.proposal.items[0].status, 'made');
  assert.strictEqual(w.log.deduct.length, 1);
});

test('skip week skips every open item and approve then does nothing', async () => {
  const { svc, log } = world();
  await svc.getOrCreate({ user: user(), now: NOW });
  assert.strictEqual((await svc.skipWeek({ user: user(), now: NOW })).ok, true);
  const out = await ar(svc);
  assert.strictEqual(out.started, 0);
  assert.strictEqual(log.deduct.length, 0);
});

test('the carousel and video prefills carry the idea', async () => {
  const { svc } = world();
  await svc.getOrCreate({ user: user(), now: NOW });
  const out = await ar(svc);
  const car = out.prefills.find((p) => p.target === 'carousel');
  const vid = out.prefills.find((p) => p.target === 'video');
  assert.deepStrictEqual(car, { itemId: car.itemId, target: 'carousel', route: '/campaigns', prefill: { mode: 'carousel', topic: 'Five cakes', platform: 'instagram', language: 'English' } });
  assert.deepStrictEqual(vid.prefill, { idea: 'Behind the oven', language: 'English' });
  assert.strictEqual(vid.route, '/reels');
});

const claimed = (w) => [...w.store.values()][0];

test('approve only claims: it returns at once without generating or charging', async () => {
  const w = world();
  await w.svc.getOrCreate({ user: user(), now: NOW });
  const out = await w.svc.approve({ user: user(), now: NOW });
  assert.strictEqual(w.log.generate.length, 0);
  assert.strictEqual(w.log.deduct.length, 0);
  assert.strictEqual(out.started, 2);
  assert.deepStrictEqual(out.proposal.items.filter((i) => i.kind === 'post').map((i) => i.status), ['approved', 'approved']);
  assert.strictEqual(out.prefills.length, 2);
});

test('runApprovedPosts called twice at once makes and charges each post once', async () => {
  const w = world();
  await w.svc.getOrCreate({ user: user(), now: NOW });
  await w.svc.approve({ user: user(), now: NOW });
  await Promise.all([w.svc.runApprovedPosts({ user: user(), now: NOW }), w.svc.runApprovedPosts({ user: user(), now: NOW })]);
  assert.strictEqual(w.log.generate.length, 2);
  assert.strictEqual(w.log.deduct.length, 2);
});

test('a post stuck making for 11 minutes is retried without a second charge; one stuck for 2 minutes is left alone', async () => {
  const w = world();
  await w.svc.getOrCreate({ user: user(), now: NOW });
  await w.svc.approve({ user: user(), now: NOW });
  const [p1, p2] = claimed(w).items.filter((i) => i.kind === 'post');
  Object.assign(p1, { status: 'making', charged: true, makingAt: new Date(NOW.getTime() - 11 * 60000) });
  Object.assign(p2, { status: 'making', charged: true, makingAt: new Date(NOW.getTime() - 2 * 60000) });
  await w.svc.runApprovedPosts({ user: user(), now: NOW });
  assert.strictEqual(p1.status, 'made');
  assert.strictEqual(p2.status, 'making');
  assert.strictEqual(w.log.generate.length, 1);
  assert.strictEqual(w.log.deduct.length, 0, 'already charged, not charged again');
});

test('a charge is recorded on the post and cleared when it is refunded', async () => {
  const ok = world();
  await ok.svc.getOrCreate({ user: user(), now: NOW });
  await ar(ok.svc);
  assert.ok(claimed(ok).items.filter((i) => i.kind === 'post').every((i) => i.charged === true));
  const bad = world({ genFails: true });
  await bad.svc.getOrCreate({ user: user(), now: NOW });
  await ar(bad.svc);
  assert.ok(claimed(bad).items.filter((i) => i.kind === 'post').every((i) => i.charged === false && i.status === 'failed'));
});

test('the first approved week is stamped once, and only when something was approved', async () => {
  const w = world();
  await w.svc.getOrCreate({ user: user(), now: NOW });
  await w.svc.approve({ user: user(), now: NOW });
  assert.strictEqual(w.log.firstApprovalCalls, 1);
  await w.svc.approve({ user: user(), now: NOW });
  assert.strictEqual(w.log.firstApprovalCalls, 1, 'nothing left to claim, so no second stamp attempt');
});

test('weekCosts is built only from the price list', () => {
  const { weekCosts } = require('../services/week/weekService');
  const { QUARK_COSTS } = require('../config/apiCosts');
  assert.deepStrictEqual(weekCosts(), { post: QUARK_COSTS.image_generated, carousel: 5 * QUARK_COSTS.carousel_generated, video: QUARK_COSTS.studio_video });
});

const posts = (w) => [...w.store.values()][0].items.filter((i) => i.kind === 'post');

test('I1: a refund that fails keeps the charge, fails the post as refund_failed, alerts the owner, and a retry is not charged again', async () => {
  const w = world({ genFails: true, refundOk: false });
  await w.svc.getOrCreate({ user: user(), now: NOW });
  await ar(w.svc);
  assert.ok(posts(w).every((i) => i.charged === true && i.status === 'failed' && i.error === 'refund_failed'));
  assert.strictEqual(w.log.alerts.length, 2);
  assert.strictEqual(w.log.deduct.length, 2);
  await ar(w.svc);
  assert.strictEqual(w.log.deduct.length, 2, 'a post already paid for is not charged again');
});

test('M2: the refund goes to the wallet that was charged', async () => {
  const w = world({ genFails: true });
  await w.svc.getOrCreate({ user: user(), now: NOW });
  await ar(w.svc);
  assert.ok(w.log.refund.every((r) => r[2] && r[2].payerId === 'payer1'));
});

test('I2: a runner that lost the post to a takeover writes nothing and refunds nothing', async () => {
  const w = world();
  let release; const gate = new Promise((r) => { release = r; });
  let calls = 0;
  const svcA = createWeekService({ ...w.deps, generate: async () => { calls += 1; if (calls === 1) { await gate; throw new Error('slow then failed'); } return { draftId: 'dB' }; } });
  const svcB = createWeekService({ ...w.deps, generate: async () => ({ draftId: 'dB' }) });
  await svcA.getOrCreate({ user: user(), now: NOW });
  await svcA.approve({ user: user(), now: NOW, itemIds: ['2026-10-12:0'] });
  const runA = svcA.runApprovedPosts({ user: user(), now: NOW });
  await new Promise((r) => setImmediate(r));
  const later = new Date(NOW.getTime() + 11 * 60000);
  await svcB.runApprovedPosts({ user: user(), now: later });
  assert.strictEqual(posts(w)[0].status, 'made');
  release();
  await runA;
  assert.strictEqual(posts(w)[0].status, 'made', 'the old runner did not overwrite');
  assert.strictEqual(w.log.deduct.length, 1);
  assert.strictEqual(w.log.refund.length, 0, 'no refund for a post that was made');
});

test('I3: a run that crosses Monday midnight still writes to the proposal week, and recovery covers earlier weeks', async () => {
  const w = world();
  await w.svc.getOrCreate({ user: user(), now: NOW });
  await w.svc.approve({ user: user(), now: NOW });
  const nextWeek = new Date('2026-10-18T19:00:00Z'); // Monday 00:30 in India
  const r = await w.svc.runApprovedPosts({ user: user(), now: nextWeek });
  assert.strictEqual(r.made, 2);
  assert.ok(posts(w).every((i) => i.status === 'made' && i.charged === true));
  assert.strictEqual([...w.store.keys()].length, 1);
});

test('I4: when the spend guard refuses, nothing is charged or made and the post stays approved', async () => {
  const w = world();
  w.log.busy = true;
  await w.svc.getOrCreate({ user: user(), now: NOW });
  await w.svc.approve({ user: user(), now: NOW });
  const r = await w.svc.runApprovedPosts({ user: user(), now: NOW });
  assert.strictEqual(r.busy, true);
  assert.strictEqual(w.log.deduct.length, 0);
  assert.strictEqual(w.log.generate.length, 0);
  assert.ok(posts(w).every((i) => i.status === 'approved'));
  w.log.busy = false;
  await w.svc.runApprovedPosts({ user: user(), now: NOW });
  assert.ok(posts(w).every((i) => i.status === 'made'));
});

test('I6: a calendar row that was already made is adopted, not charged or made again', async () => {
  const w = world();
  const svc = createWeekService({ ...w.deps, calendarFor: async () => ({ calendar: {}, find: (id) => ({ _id: id, generatedDraftId: 'old1', status: 'generated' }), weekNumber: 1 }) });
  await svc.getOrCreate({ user: user(), now: NOW });
  await svc.approve({ user: user(), now: NOW });
  await svc.runApprovedPosts({ user: user(), now: NOW });
  assert.strictEqual(w.log.deduct.length, 0);
  assert.strictEqual(w.log.generate.length, 0);
  assert.ok(posts(w).every((i) => i.status === 'made' && i.ref === 'old1'));
});

test('I7: if the charge cannot be recorded it is refunded at once and the post fails', async () => {
  const w = world();
  w.log.flipFails = true;
  await w.svc.getOrCreate({ user: user(), now: NOW });
  await ar(w.svc);
  assert.strictEqual(w.log.generate.length, 0);
  assert.strictEqual(w.log.refund.length, 2);
  assert.ok(posts(w).every((i) => i.status === 'failed' && i.error === 'charge_not_recorded'));
});

test('M1: swap writes the topic and checks proposed in one step', async () => {
  const w = world();
  const { proposal } = await w.svc.getOrCreate({ user: user(), now: NOW });
  const id = proposal.items[0].id;
  await w.svc.approve({ user: user(), now: NOW, itemIds: [id] });
  assert.strictEqual((await w.svc.change({ user: user(), itemId: id, action: 'swap', topic: 'Late', now: NOW })).ok, false);
  assert.notStrictEqual(posts(w)[0].topic, 'Late');
});
