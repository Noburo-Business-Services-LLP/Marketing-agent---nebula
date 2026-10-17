// backend/tests/weekService.test.js
const test = require('node:test');
const assert = require('node:assert');
const { createWeekService } = require('../services/week/weekService');

const NOW = new Date('2026-10-17T06:00:00Z');
const user = (extra = {}) => ({ _id: 'u1', isActive: true, onboardingCompleted: true, plan: { tier: 'starter' }, businessProfile: { name: 'Sweet Co', website: 'a.in', description: 'Custom cakes baked to order', targetAudience: 'Families' }, ...extra });
function world({ pool = 2000, genFails = false, deductOk = true } = {}) {
  const store = new Map(); const log = { deduct: [], refund: [], generate: [] };
  const deps = {
    costs: { post: 11, carousel: 60, video: 161 },
    pool: async () => pool,
    cadence: async () => ({ reelsPerWeek: 1 }),
    calendarItemsForWeek: async () => [{ _id: 'c1', day: 13, format: 'image post', headline: 'Idea 1', contentPillar: 'P' }, { _id: 'c2', day: 14, format: 'image post', headline: 'Idea 2', contentPillar: 'P' }, { _id: 'c3', day: 15, format: 'carousel', headline: 'Five cakes', contentPillar: 'P' }, { _id: 'c4', day: 16, format: 'reel', headline: 'Behind the oven', contentPillar: 'P' }],
    planCalendarForWeek: async () => [],
    store: {
      find: async (q) => store.get(`${q.userId}:${q.weekStart}`) || null,
      create: async (doc) => { store.set(`${doc.userId}:${doc.weekStart}`, doc); return doc; },
      claimItem: async (q, itemId, from, to) => { const d = store.get(`${q.userId}:${q.weekStart}`); const it = d.items.find((i) => i.id === itemId); if (!it || it.status !== from) return false; it.status = to; return true; },
      setItem: async (q, itemId, patch) => { const d = store.get(`${q.userId}:${q.weekStart}`); Object.assign(d.items.find((i) => i.id === itemId), patch); },
      setStatus: async (q, status) => { store.get(`${q.userId}:${q.weekStart}`).status = status; }
    },
    deduct: async (id, action, n, why) => { log.deduct.push([id, action]); return { success: deductOk }; },
    refund: async (id, action) => { log.refund.push([id, action]); return { success: true }; },
    generate: async (cal, item) => { log.generate.push(item._id || item.calendarItemId); if (genFails) throw new Error('image failed'); return { draftId: 'd' + log.generate.length }; },
    calendarFor: async () => ({ calendar: { _id: 'cal' }, find: (id) => ({ _id: id }), weekNumber: 3 }),
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
  const out = await svc.approve({ user: user(), now: NOW });
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
  await Promise.all([svc.approve({ user: user(), now: NOW }), svc.approve({ user: user(), now: NOW })]);
  assert.strictEqual(log.generate.length, 2);
  assert.strictEqual(log.deduct.length, 2);
});

test('a post whose image fails is refunded and shown as failed, not lost; a later approve can retry only the failed post', async () => {
  const { svc, log } = world({ genFails: true });
  await svc.getOrCreate({ user: user(), now: NOW });
  const out = await svc.approve({ user: user(), now: NOW });
  assert.strictEqual(log.refund.length, 2);
  assert.ok(out.proposal.items.filter((i) => i.kind === 'post').every((i) => i.status === 'failed'));
});

test('no pool means nothing is generated and the post is marked failed without a refund', async () => {
  const { svc, log } = world({ deductOk: false });
  await svc.getOrCreate({ user: user(), now: NOW });
  await svc.approve({ user: user(), now: NOW });
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
  await w.svc.approve({ user: user(), now: NOW });
  assert.strictEqual(w.log.generate.length, 2);
  // second press with the generator still broken: the two failed posts are tried again, once each
  await w.svc.approve({ user: user(), now: NOW });
  assert.strictEqual(w.log.generate.length, 4);
  assert.strictEqual(w.log.deduct.length, 4);
  assert.strictEqual(w.log.refund.length, 4);
});

test('made posts stay made on a second approve: nothing more is charged', async () => {
  const { svc, log } = world();
  await svc.getOrCreate({ user: user(), now: NOW });
  await svc.approve({ user: user(), now: NOW });
  const again = await svc.approve({ user: user(), now: NOW });
  assert.strictEqual(again.started, 0);
  assert.strictEqual(log.deduct.length, 2);
  assert.strictEqual(log.generate.length, 2);
});

test('the made post points at the real draft', async () => {
  const { svc } = world();
  await svc.getOrCreate({ user: user(), now: NOW });
  const out = await svc.approve({ user: user(), now: NOW });
  const refs = out.proposal.items.filter((i) => i.kind === 'post').map((i) => i.ref);
  assert.deepStrictEqual(refs, ['d1', 'd2']);
});

test('a post whose picture could not be made is refunded and failed even though the generator returned', async () => {
  const w = world();
  const svc = createWeekService({ ...w.deps, generate: async () => ({ draft: { _id: 'dx', imageUrl: '' } }) });
  await svc.getOrCreate({ user: user(), now: NOW });
  const out = await svc.approve({ user: user(), now: NOW });
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
  const out = await svc.approve({ user: user(), now: NOW });
  assert.deepStrictEqual(seen, ['From the plan']);
  assert.strictEqual(out.proposal.items[0].status, 'made');
  assert.strictEqual(w.log.deduct.length, 1);
});

test('skip week skips every open item and approve then does nothing', async () => {
  const { svc, log } = world();
  await svc.getOrCreate({ user: user(), now: NOW });
  assert.strictEqual((await svc.skipWeek({ user: user(), now: NOW })).ok, true);
  const out = await svc.approve({ user: user(), now: NOW });
  assert.strictEqual(out.started, 0);
  assert.strictEqual(log.deduct.length, 0);
});

test('the carousel and video prefills carry the idea', async () => {
  const { svc } = world();
  await svc.getOrCreate({ user: user(), now: NOW });
  const out = await svc.approve({ user: user(), now: NOW });
  const car = out.prefills.find((p) => p.target === 'carousel');
  const vid = out.prefills.find((p) => p.target === 'video');
  assert.deepStrictEqual(car, { itemId: car.itemId, target: 'carousel', route: '/campaigns', prefill: { mode: 'carousel', topic: 'Five cakes', platform: 'instagram', language: 'English' } });
  assert.deepStrictEqual(vid.prefill, { idea: 'Behind the oven', language: 'English' });
  assert.strictEqual(vid.route, '/reels');
});
