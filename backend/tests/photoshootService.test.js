// The Photoshoot service: money, safety, ownership, restart. Every image call is a fake; the wallet and the job ledger
// are in memory (tests/helpers/fakePhotoshootRepo.js mirrors services/photoshoot/repo.js).
const test = require('node:test');
const assert = require('node:assert');
const { createPhotoshoot, MESSAGES, planPhotos, jobView, catalogue, publicIdOf } = require('../services/photoshoot/service');
const { createFakePhotoshootRepo } = require('./helpers/fakePhotoshootRepo');
const { QUARK_COSTS } = require('../config/apiCosts');
const caps = require('../config/photoshoot');
const { packOf } = require('../config/photoshootPacks');

const NOW = new Date('2026-10-19T06:00:00Z');
const U1 = '6a0000000000000000000001';
const U2 = '6a0000000000000000000002';
const CLIENT = '6a0000000000000000000003';
const AGENCY = '6a0000000000000000000004';
const P1 = '6d0000000000000000000001';
const P2 = '6d0000000000000000000002';
const P_NOPHOTO = '6d0000000000000000000003';
const P_OTHER = '6d0000000000000000000004';
const PLACE1 = '6e0000000000000000000001';
const PER = QUARK_COSTS.photoshoot_image;
const PNG = 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]).toString('base64');
let keyN = 0;
const key = () => `key-${String(++keyN).padStart(6, '0')}`;
const quiet = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };

const userOf = (id, extra = {}) => ({ _id: id, plan: { tier: 'starter' }, businessProfile: { name: 'Anu Bakes' }, ...extra });

function world({ wallet = {}, env = { ENABLE_PHOTOSHOOT: 'on' }, gens = [], guard = null, payers = {}, frozen = [], repo = createFakePhotoshootRepo(), now = null, runnerId = 'runner-a', refundFails = false, products = null, places = null } = {}) {
  const purse = new Map(Object.entries({ [U1]: 200, [U2]: 200, [AGENCY]: 200, ...wallet }));
  const money = []; const alerts = []; const queue = []; const spendRecords = [];
  const calls = { gen: 0, prompts: [], refs: [] };
  const clock = { t: now || NOW };
  const prods = products || [
    { _id: P1, user: U1, name: 'Brownie box', imageUrl: 'https://res.cloudinary.com/x/image/upload/nebula-product-images/a.png', images: ['https://res.cloudinary.com/x/image/upload/nebula-product-images/a2.png'] },
    { _id: P2, user: U1, name: 'Cake tin', imageUrl: 'https://res.cloudinary.com/x/image/upload/nebula-product-images/b.png', images: [] },
    { _id: P_NOPHOTO, user: U1, name: 'No photo', imageUrl: '', images: [] },
    { _id: P_OTHER, user: U2, name: 'Other shop', imageUrl: 'https://res.cloudinary.com/x/image/upload/nebula-product-images/c.png', images: [] },
    { _id: '6d0000000000000000000009', user: CLIENT, name: 'Client soap', imageUrl: 'https://res.cloudinary.com/x/image/upload/nebula-product-images/d.png', images: [] }
  ];
  const plcs = places || [{ _id: PLACE1, user: U1, name: 'Our shop', url: 'https://res.cloudinary.com/x/image/upload/nebula-env/s.png' }];
  const payerOf = (uid) => payers[uid] || uid;
  const deps = {
    repo,
    productsOf: async (uid, ids) => prods.filter((p) => String(p.user) === String(uid) && (!ids || ids.includes(String(p._id)))),
    placesOf: async (uid, ids) => plcs.filter((p) => String(p.user) === String(uid) && (!ids || ids.includes(String(p._id)))),
    createProduct: async (doc) => { const p = { _id: `6d00000000000000000000${String(prods.length + 10).padStart(2, '0')}`, ...doc }; prods.push(p); return p; },
    countUploadsSince: async (uid) => prods.filter((p) => String(p.user) === String(uid) && (p.tags || []).includes('photoshoot-upload')).length,
    upload: async () => ({ success: true, url: 'https://res.cloudinary.com/x/image/upload/nebula-product-images/new.png' }),
    settle: async () => null,
    spend: async (uid, cost, o) => {
      if (frozen.includes(uid)) return { success: false, frozen: true };
      const payer = payerOf(uid);
      if ((purse.get(payer) || 0) < cost) return { success: false };
      purse.set(payer, purse.get(payer) - cost);
      money.push({ type: 'spend', uid, payer, cost, action: o.action, ref: o.ref, units: o.units });
      return { success: true, payerId: payer, workspaceId: payer !== uid ? uid : null };
    },
    refundTo: async (uid, q, o) => {
      if (refundFails) return { ok: false };
      const payer = o.payerId || payerOf(uid);
      purse.set(payer, (purse.get(payer) || 0) + q);
      money.push({ type: 'refund', uid, payer, q, action: o.action, ref: o.ref });
      return { ok: true, payerId: payer };
    },
    guard: async (a) => (guard ? guard(a) : { ok: true }),
    // The charge proof, read from the in-memory money list (quarkBuckets.chargeProof in the real service).
    ledgerFor: async (id) => {
      const sp = money.find((m) => m.type === 'spend' && m.ref === String(id));
      return { spend: sp ? { payer: sp.payer, quarks: sp.cost } : null, refunded: money.some((m) => m.type === 'refund' && m.ref === String(id)) };
    },
    recordSpend: (a, u) => spendRecords.push([a, u]),
    loadRef: async (src) => (src ? { mimeType: 'image/png', data: Buffer.from(String(src)).toString('base64') } : null),
    generate: async (args) => {
      calls.gen += 1; calls.prompts.push(args.prompt); calls.refs.push(args.references.length);
      const next = gens.length ? gens.shift() : null;
      if (typeof next === 'function') return next(args);
      if (next) return next;
      return { ok: true, url: `https://res.cloudinary.com/x/image/upload/nebula-campaign-posts/p${calls.gen}.png` };
    },
    alert: (k, t) => alerts.push([k, t]),
    schedule: (fn) => queue.push(fn),
    env,
    now: () => clock.t,
    runnerId
  };
  const svc = createPhotoshoot(deps);
  const drain = async () => { for (let i = 0; i < 50 && queue.length; i += 1) await queue.shift()(); };
  return { svc, deps, repo, purse, money, alerts, queue, drain, calls, clock, spendRecords, prods };
}

// A generator that always fails for one scene of the marketplace pack ("from the side"), and works for the rest.
const sideFails = () => Array(30).fill((a) => (/from the side/.test(a.prompt) ? { ok: false, reason: 'provider' } : { ok: true, url: `https://res.cloudinary.com/x/image/upload/nebula-campaign-posts/${Math.random().toString(36).slice(2)}.png` }));
const body = (extra = {}) => ({ key: key(), pack: 'marketplace', productIds: [P1], ...extra });

test('a pack is charged once, up front, for all its photos, and every photo is made', async () => {
  const w = world();
  const r = await w.svc.create(userOf(U1), body());
  assert.strictEqual(r.status, 202, JSON.stringify(r.body));
  assert.strictEqual(r.body.job.photoCount, 4);
  assert.strictEqual(w.purse.get(U1), 200 - 4 * PER);
  assert.deepStrictEqual(w.money.map((m) => [m.type, m.cost, m.units]), [['spend', 4 * PER, 4]]);
  assert.strictEqual(w.calls.gen, 0, 'nothing is made before the runner starts');
  await w.drain();
  assert.strictEqual(w.calls.gen, 4);
  const row = w.repo.rows[0];
  assert.strictEqual(row.status, 'done'); assert.strictEqual(row.outcome, 'ok');
  assert.strictEqual(row.inFlight, undefined); assert.strictEqual(row.quarks, 4 * PER); assert.strictEqual(row.payerId, U1);
  assert.ok(row.photos.every((p) => p.status === 'done' && p.attempts === 1 && /^https:/.test(p.url)));
  assert.strictEqual(w.money.length, 1, 'no refund when every photo was made');
  const view = (await w.svc.get(userOf(U1), row._id)).body.job;
  assert.strictEqual(view.done, 4); assert.strictEqual(view.notice, '');
  assert.ok(!JSON.stringify(view).includes('Rules for this photo'), 'the prompt never reaches the page');
  assert.ok(!('payerId' in view) && !('leaseOwner' in view));
});

test('the price comes from config/apiCosts.js: photos times the photo action', () => {
  const c = catalogue();
  assert.strictEqual(c.perPhoto.quarks, PER);
  for (const p of c.packs) assert.strictEqual(p.quarks, PER * packOf(p.key).defaultCount);
});

test('each call is counted on the job before it is made (ledger before call)', async () => {
  const w = world();
  const seen = [];
  w.deps.generate = async () => {
    const row = w.repo.rows[0];
    seen.push(row.photos.filter((p) => p.status === 'calling').map((p) => p.attempts));
    return { ok: true, url: 'https://res.cloudinary.com/x/image/upload/nebula-campaign-posts/z.png' };
  };
  const svc = createPhotoshoot(w.deps);
  await svc.create(userOf(U1), body());
  await w.drain();
  assert.strictEqual(seen.length, 4);
  for (const s of seen) assert.ok(s.length >= 1 && s.every((a) => a === 1), JSON.stringify(seen));
});

test('a failed photo gets exactly one more call; when it fails again only that photo is refunded', async () => {
  const w = world({ gens: sideFails() });
  await w.svc.create(userOf(U1), body());
  await w.drain();
  const row = w.repo.rows[0];
  assert.strictEqual(w.calls.gen, 5, '4 photos plus one more call for the photo that failed');
  const failed = row.photos.filter((p) => p.status === 'failed');
  assert.strictEqual(failed.length, 1);
  assert.strictEqual(failed[0].attempts, caps.MAX_CALLS_PER_PHOTO);
  assert.strictEqual(row.status, 'partial');
  assert.strictEqual(row.refundedQuarks, PER);
  assert.deepStrictEqual(w.money.filter((m) => m.type === 'refund').map((m) => [m.q, m.action, m.ref]), [[PER, 'photoshoot_image_refund', String(row._id)]]);
  assert.strictEqual(w.purse.get(U1), 200 - 3 * PER);
  assert.deepStrictEqual(w.spendRecords, [['photoshoot_image', 1]], 'the second call is added to the daily spend record');
  const view = (await w.svc.get(userOf(U1), row._id)).body.job;
  assert.match(view.notice, /1 of 4 photos could not be made\. You were not charged for it\./);
});

test('when no photo can be made, the whole price is returned, once', async () => {
  const fail = { ok: false, reason: 'provider' };
  const w = world({ gens: Array(8).fill(fail) });
  await w.svc.create(userOf(U1), body());
  await w.drain();
  const row = w.repo.rows[0];
  assert.strictEqual(row.status, 'failed'); assert.strictEqual(row.outcome, 'none');
  assert.strictEqual(row.refundedQuarks, 4 * PER);
  assert.strictEqual(w.purse.get(U1), 200);
  await w.svc.finalize(row._id); await w.svc.runJob(row._id);
  assert.strictEqual(w.money.filter((m) => m.type === 'refund').length, 1, 'never refunded twice');
});

test('a missing product photo at run time fails the photo without a second call and without calling the model', async () => {
  const w = world();
  w.deps.loadRef = async () => null;
  const svc = createPhotoshoot(w.deps);
  await svc.create(userOf(U1), body());
  await w.drain();
  assert.strictEqual(w.calls.gen, 0);
  const row = w.repo.rows[0];
  assert.ok(row.photos.every((p) => p.status === 'failed' && p.reason === 'no_reference' && p.attempts === 1));
  assert.strictEqual(w.purse.get(U1), 200);
});

test('a result that is not a stored https link counts as a failure', async () => {
  const w = world({ gens: Array(8).fill({ ok: true, url: 'data:image/png;base64,AAAA' }) });
  await w.svc.create(userOf(U1), body());
  await w.drain();
  assert.strictEqual(w.repo.rows[0].status, 'failed');
  assert.ok(w.repo.rows[0].photos.every((p) => !p.url));
});

test('not enough Quarks: refused before anything is made, nothing charged, the row is closed', async () => {
  const w = world({ wallet: { [U1]: 4 * PER - 1 } });
  const r = await w.svc.create(userOf(U1), body());
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.body.creditsExhausted, true);
  assert.match(r.body.message, new RegExp(`needs ${4 * PER} Quarks \\(about`));
  await w.drain();
  assert.strictEqual(w.calls.gen, 0);
  assert.strictEqual(w.repo.rows[0].status, 'refused'); assert.strictEqual(w.repo.rows[0].inFlight, undefined);
  // A new press can start once there is money.
  w.purse.set(U1, 500);
  assert.strictEqual((await w.svc.create(userOf(U1), body())).status, 202);
});

test('the same key is one job and one charge (double click, retry)', async () => {
  const w = world();
  const b = body();
  const a = await w.svc.create(userOf(U1), b);
  const again = await w.svc.create(userOf(U1), { ...b });
  assert.strictEqual(a.status, 202);
  assert.strictEqual(again.status, 200); assert.strictEqual(again.body.replay, true);
  assert.strictEqual(again.body.job.id, a.body.job.id);
  assert.strictEqual(w.money.length, 1);
  // Two presses at the same moment (the in-process lock).
  const w2 = world();
  const b2 = body();
  const [x, y] = await Promise.all([w2.svc.create(userOf(U1), b2), w2.svc.create(userOf(U1), { ...b2 })]);
  assert.deepStrictEqual([x.status, y.status].sort(), [202, 409]);
  assert.strictEqual(w2.money.length, 1);
});

test('one photoshoot at a time per account, across two server processes', async () => {
  const repo = createFakePhotoshootRepo();
  const a = world({ repo, runnerId: 'a' });
  const b = world({ repo, runnerId: 'b' });
  b.purse.set(U1, 200);
  assert.strictEqual((await a.svc.create(userOf(U1), body())).status, 202);
  const second = await b.svc.create(userOf(U1), body());
  assert.strictEqual(second.status, 409); assert.strictEqual(second.body.message, MESSAGES.inProgress);
  assert.strictEqual(b.money.length, 0);
});

test('caps: per minute, photos per India day (redos included), all accounts', async () => {
  const w = world({ wallet: { [U1]: 10000 } });
  for (let i = 0; i < caps.MAX_STARTS_PER_MINUTE; i += 1) { await w.svc.create(userOf(U1), body()); await w.drain(); }
  const r = await w.svc.create(userOf(U1), body());
  assert.strictEqual(r.status, 429); assert.strictEqual(r.body.limit, 'minute');

  const d = world({ wallet: { [U1]: 10000 } });
  let t = NOW.getTime();
  let made = 0;
  while (made + 8 <= caps.MAX_PHOTOS_PER_DAY) {
    d.clock.t = new Date(t += 61000);
    const ok = await d.svc.create(userOf(U1), body({ pack: 'festival', count: 8 }));
    assert.strictEqual(ok.status, 202, JSON.stringify(ok.body)); await d.drain(); made += 8;
  }
  d.clock.t = new Date(t += 61000);
  const over = await d.svc.create(userOf(U1), body({ pack: 'festival', count: 8 }));
  assert.strictEqual(over.status, 429); assert.strictEqual(over.body.limit, 'day');
  assert.strictEqual(over.body.left, caps.MAX_PHOTOS_PER_DAY - made);

  const g = world();
  for (let i = 0; i < caps.MAX_RUNNING_ALL_ACCOUNTS; i += 1) g.repo.rows.push({ _id: `r${i}`, user: `6a00000000000000000009${String(i).padStart(2, '0')}`, key: `k${i}`, status: 'running', inFlight: true, photos: [], createdAt: new Date(0), leaseOwner: 'x', leaseUntil: new Date(NOW.getTime() + 600000) });
  const busy = await g.svc.create(userOf(U1), body());
  assert.strictEqual(busy.status, 503); assert.strictEqual(busy.body.serviceBusy, true);
});

test('the spend guard refuses before any charge (Photoshoots switch, Pictures switch, daily ceiling)', async () => {
  for (const off of ['photoshoot_image', 'image_generated']) {
    const w = world({ guard: (a) => (a === off ? { ok: false, reason: 'switched_off' } : { ok: true }) });
    const r = await w.svc.create(userOf(U1), body());
    assert.strictEqual(r.status, 503); assert.match(r.body.message, /Nothing was charged/);
    assert.strictEqual(w.money.length, 0); assert.strictEqual(w.repo.rows.length, 0);
  }
});

test('a staff switch flipped mid-job stops the rest and refunds the photos not made', async () => {
  let off = false;
  const w = world({ guard: () => (off ? { ok: false, reason: 'switched_off' } : { ok: true }) });
  w.deps.generate = async () => { off = true; w.calls.gen += 1; return { ok: true, url: 'https://res.cloudinary.com/x/image/upload/nebula-campaign-posts/q.png' }; };
  const svc = createPhotoshoot(w.deps);
  await svc.create(userOf(U1), body());
  await w.drain();
  const row = w.repo.rows[0];
  assert.strictEqual(w.calls.gen, 2, 'the batch already started finishes, nothing new starts');
  assert.strictEqual(row.status, 'partial'); assert.strictEqual(row.outcome, 'switched_off');
  assert.strictEqual(row.refundedQuarks, 2 * PER);
});

test('the daily ceiling reached mid-job does not stop a job that was already counted', async () => {
  let full = false;
  const w = world({ guard: () => (full ? { ok: false, reason: 'daily_cap' } : { ok: true }) });
  w.deps.generate = async () => { full = true; return { ok: true, url: 'https://res.cloudinary.com/x/image/upload/nebula-campaign-posts/q.png' }; };
  const svc = createPhotoshoot(w.deps);
  await svc.create(userOf(U1), body());
  await w.drain();
  assert.strictEqual(w.repo.rows[0].status, 'done');
});

test('entitlement: free plan refused with the plan note; paid plans, agency clients and managed accounts allowed', async () => {
  const w = world();
  const free = await w.svc.create(userOf(U1, { plan: { tier: 'free' } }), body());
  assert.strictEqual(free.status, 403); assert.strictEqual(free.body.locked, 'upgrade'); assert.strictEqual(free.body.message, MESSAGES.upgrade);
  for (const tier of ['starter', 'professional', 'agency', 'managed']) {
    const x = world();
    assert.strictEqual((await x.svc.create(userOf(U1, { plan: { tier } }), body())).status, 202, tier);
  }
  assert.strictEqual((await world().svc.create({ _id: U1 }, body())).status, 202, 'an account from before plans counts as managed');
  const o = await w.svc.options(userOf(U1, { plan: { tier: 'free' } }));
  assert.strictEqual(o.entitled, false); assert.strictEqual(o.locked, 'upgrade');
  assert.ok(o.packs.length >= 6, 'packs and prices are still shown');
});

test('switch off: nothing is charged, the options say so', async () => {
  const w = world({ env: {} });
  const r = await w.svc.create(userOf(U1), body());
  assert.strictEqual(r.status, 503); assert.strictEqual(r.body.disabled, true); assert.strictEqual(r.body.message, MESSAGES.off);
  assert.strictEqual(w.money.length, 0); assert.strictEqual(w.repo.rows.length, 0);
  assert.strictEqual((await w.svc.options(userOf(U1))).enabled, false);
});

test('staff cannot start one outside a pass; inside a pass the client is charged', async () => {
  const w = world();
  const r = await w.svc.create(userOf(U1, { staffRole: 'support' }), body());
  assert.strictEqual(r.status, 403); assert.strictEqual(r.body.message, MESSAGES.staff);
  assert.strictEqual((await w.svc.options(userOf(U1, { isCsm: true }))).staff, true);
  const p = await w.svc.create(userOf(U1, { isCsm: true }), body(), { pass: true });
  assert.strictEqual(p.status, 202);
});

test('agency client: charged to the pool, refunded to the pool, frozen client refused, posts wording', async () => {
  const w = world({ payers: { [CLIENT]: AGENCY }, gens: sideFails() });
  const client = userOf(CLIENT, { plan: { tier: 'agency' }, agency: { ownerId: AGENCY } });
  const r = await w.svc.create(client, body({ productIds: ['6d0000000000000000000009'] }), { pass: true });
  assert.strictEqual(r.status, 202, JSON.stringify(r.body));
  await w.drain();
  assert.strictEqual(w.purse.get(AGENCY), 200 - 3 * PER);
  assert.strictEqual(w.purse.get(CLIENT), undefined, 'nothing touches the client record');
  assert.deepStrictEqual(w.money.map((m) => [m.type, m.payer]), [['spend', AGENCY], ['refund', AGENCY]]);
  assert.strictEqual(w.repo.rows[0].payerId, AGENCY);
  const f = world({ payers: { [CLIENT]: AGENCY }, frozen: [CLIENT] });
  const fr = await f.svc.create(client, body({ productIds: ['6d0000000000000000000009'] }), { pass: true });
  assert.strictEqual(fr.status, 403); assert.strictEqual(fr.body.message, MESSAGES.frozen);
  const poor = world({ payers: { [CLIENT]: AGENCY }, wallet: { [AGENCY]: 1 } });
  const pr = await poor.svc.create(client, body({ productIds: ['6d0000000000000000000009'] }), { pass: true });
  assert.strictEqual(pr.status, 403); assert.ok(!/Quarks/.test(pr.body.message), pr.body.message);
  assert.strictEqual((await w.svc.options(client, { pass: true })).postsOnly, true);
});

test('only the caller\'s own products with a photo, and own place photos, are accepted', async () => {
  const w = world();
  for (const ids of [[P_OTHER], [P_NOPHOTO], [P1, P_OTHER], ['nope'], []]) {
    const r = await w.svc.create(userOf(U1), body({ productIds: ids }));
    assert.strictEqual(r.status, 400, JSON.stringify(ids));
  }
  const bad = await w.svc.create(userOf(U2), body({ pack: 'product', placeId: PLACE1, productIds: [P_OTHER] }));
  assert.strictEqual(bad.status, 400); assert.strictEqual(bad.body.message, MESSAGES.place);
  const notAllowed = await w.svc.create(userOf(U1), body({ pack: 'marketplace', placeId: PLACE1 }));
  assert.strictEqual(notAllowed.status, 400, 'the marketplace pack has no place option');
  assert.strictEqual(w.money.length, 0);
});

test('choices are checked against the pack (shape, count, background); too many photos refused', async () => {
  const w = world();
  for (const extra of [{ pack: 'nope' }, { aspectRatio: '9:16' }, { count: 5 }, { pack: 'product', background: 'neon' }, { pack: 'product', background: 'marble' }]) {
    assert.strictEqual((await w.svc.create(userOf(U1), body(extra))).status, 400, JSON.stringify(extra));
  }
  const many = await w.svc.create(userOf(U1), body({ pack: 'festival', count: 8, productIds: [P1, P2, '6d0000000000000000000005', '6d0000000000000000000006'] }));
  assert.strictEqual(many.status, 400); assert.strictEqual(many.body.message, MESSAGES.tooMany);
  assert.strictEqual((await w.svc.create(userOf(U1), { pack: 'marketplace', productIds: [P1] })).status, 400, 'a key is required');
});

test('several products multiply the photos; scenes follow the pack; a chosen place is used only where allowed', async () => {
  const w = world();
  const r = await w.svc.create(userOf(U1), body({ pack: 'product', count: 6, productIds: [P1, P2], placeId: PLACE1, background: 'grey' }));
  assert.strictEqual(r.status, 202);
  assert.strictEqual(r.body.job.photoCount, 12);
  assert.strictEqual(w.money[0].cost, 12 * PER);
  await w.drain();
  const row = w.repo.rows[0];
  assert.deepStrictEqual(row.photos.filter((p) => p.inPlace).map((p) => p.scene), ['setting', 'shelf', 'setting', 'shelf']);
  // Place photo and the product's second photo are sent as references; at most three.
  assert.ok(w.calls.refs.every((n) => n >= 1 && n <= 3));
  assert.ok(w.calls.prompts.some((p) => /second reference photo/.test(p)));
  assert.ok(w.calls.prompts.every((p) => /No people, no faces/.test(p) && /Do not add any logo/.test(p)));
  assert.ok(w.calls.prompts.some((p) => /soft light grey/.test(p)));
});

test('restart: a lost runner\'s job is taken over after its lease runs out, and a photo left calling is tried once more', async () => {
  const repo = createFakePhotoshootRepo();
  const a = world({ repo, runnerId: 'a' });
  await a.svc.create(userOf(U1), body());
  // Runner a starts, makes one photo, and "dies" in the middle of the second call (its queue is never drained).
  const row = repo.rows[0];
  await repo.claimLease(row._id, 'a', NOW, new Date(NOW.getTime() + caps.LEASE_MS));
  await repo.startPhoto(row._id, 'a', 0, NOW); await repo.finishPhoto(row._id, 0, { status: 'done', url: 'https://res.cloudinary.com/x/image/upload/nebula-campaign-posts/0.png', now: NOW });
  await repo.startPhoto(row._id, 'a', 1, NOW);
  // Another process before the lease ran out: nothing happens.
  const b = world({ repo, runnerId: 'b' });
  await b.svc.runJob(row._id);
  assert.strictEqual(b.calls.gen, 0);
  // After it ran out, the resume loop takes it over.
  b.clock.t = new Date(NOW.getTime() + caps.LEASE_MS + 1000);
  assert.strictEqual(await b.svc.resumeLost(), 1);
  await b.drain();
  assert.strictEqual(b.calls.gen, 3, 'photo 1 again (it had a call left), photos 2 and 3');
  assert.strictEqual(repo.rows[0].status, 'done');
  assert.strictEqual(repo.rows[0].photos[1].attempts, 2);
  assert.strictEqual(b.money.filter((m) => m.type === 'refund').length, 0);
});

test('restart: a photo left calling with no call left fails and is refunded; a very old job is closed', async () => {
  const repo = createFakePhotoshootRepo();
  const a = world({ repo, runnerId: 'a' });
  await a.svc.create(userOf(U1), body());
  const row = repo.rows[0];
  row.photos[0].attempts = 1;
  await repo.claimLease(row._id, 'a', NOW, new Date(NOW.getTime() + 1000));
  await repo.startPhoto(row._id, 'a', 0, NOW);
  const b = world({ repo, runnerId: 'b', now: new Date(NOW.getTime() + 5000) });
  await b.svc.runJob(row._id);
  assert.strictEqual(repo.rows[0].photos[0].status, 'failed'); assert.strictEqual(repo.rows[0].photos[0].reason, 'lost');
  assert.strictEqual(repo.rows[0].status, 'partial');
  assert.strictEqual(b.money.find((m) => m.type === 'refund').q, PER);

  const repo2 = createFakePhotoshootRepo();
  const c = world({ repo: repo2, runnerId: 'c' });
  await c.svc.create(userOf(U1), body());
  const d = world({ repo: repo2, runnerId: 'd', now: new Date(NOW.getTime() + caps.MAX_AGE_MS + 60000) });
  await d.svc.runJob(repo2.rows[0]._id);
  assert.strictEqual(d.calls.gen, 0);
  assert.strictEqual(repo2.rows[0].status, 'failed'); assert.strictEqual(repo2.rows[0].outcome, 'stale');
  assert.strictEqual(d.money.find((m) => m.type === 'refund').q, 4 * PER);
});

test('reading a job whose runner was lost restarts it', async () => {
  const w = world();
  await w.svc.create(userOf(U1), body());
  w.queue.length = 0; // the runner never started (a restart right after the charge)
  w.clock.t = new Date(NOW.getTime() + 1000);
  await w.svc.get(userOf(U1), w.repo.rows[0]._id);
  await w.drain();
  assert.strictEqual(w.repo.rows[0].status, 'done');
});

test('a charge that cannot be recorded on the job is returned at once and nothing is called', async () => {
  const repo = createFakePhotoshootRepo({ fail: { markCharged: true } });
  const w = world({ repo });
  const r = await quiet(() => w.svc.create(userOf(U1), body()));
  assert.strictEqual(r.status, 503); assert.strictEqual(r.body.message, MESSAGES.ledger);
  await w.drain();
  assert.strictEqual(w.calls.gen, 0);
  assert.strictEqual(w.purse.get(U1), 200);
  assert.strictEqual(repo.rows[0].status, 'failed'); assert.strictEqual(repo.rows[0].outcome, 'ledger');
  const noRow = world({ repo: createFakePhotoshootRepo({ fail: { insert: true } }) });
  const r2 = await noRow.svc.create(userOf(U1), body());
  assert.strictEqual(r2.status, 503); assert.strictEqual(noRow.money.length, 0, 'no row, no charge');
});

test('a refund that does not land is flagged and raised', async () => {
  const w = world({ gens: Array(8).fill({ ok: false }), refundFails: true });
  await w.svc.create(userOf(U1), body());
  await w.drain();
  assert.strictEqual(w.repo.rows[0].refundFailed, true);
  assert.strictEqual(w.alerts[0][0], 'photoshoot_refund');
  const view = (await w.svc.get(userOf(U1), w.repo.rows[0]._id)).body.job;
  assert.match(view.notice, /We are returning your Quarks/);
});

test('another account never sees, changes or redoes a job, and its Library is its own', async () => {
  const w = world();
  await w.svc.create(userOf(U1), body());
  await w.drain();
  const id = w.repo.rows[0]._id;
  assert.strictEqual((await w.svc.get(userOf(U2), id)).status, 404);
  assert.strictEqual((await w.svc.list(userOf(U2))).body.jobs.length, 0);
  assert.strictEqual((await w.svc.library(userOf(U2))).body.photos.length, 0);
  assert.strictEqual((await w.svc.setInLibrary(userOf(U2), id, 0, false)).status, 404);
  assert.strictEqual((await w.svc.redo(userOf(U2), id, 0, { key: key() })).status, 404);
  assert.strictEqual((await w.svc.library(userOf(U1))).body.photos.length, 4);
});

test('Library: photos are in it by default and can be taken out and put back', async () => {
  const w = world();
  await w.svc.create(userOf(U1), body());
  await w.drain();
  const id = w.repo.rows[0]._id;
  const lib = (await w.svc.library(userOf(U1))).body.photos;
  assert.strictEqual(lib.length, 4);
  assert.deepStrictEqual(Object.keys(lib[0]).sort(), ['aspectRatio', 'createdAt', 'index', 'jobId', 'kind', 'pack', 'packTitle', 'product', 'scene', 'url'].sort());
  assert.strictEqual((await w.svc.setInLibrary(userOf(U1), id, 2, false)).status, 200);
  assert.strictEqual((await w.svc.library(userOf(U1))).body.photos.length, 3);
  assert.strictEqual((await w.svc.setInLibrary(userOf(U1), id, 2, true)).status, 200);
  assert.strictEqual((await w.svc.setInLibrary(userOf(U1), id, 2, 'yes')).status, 400);
});

test('make one photo again: priced as one photo, same scene, its own job, shown as a version of the original', async () => {
  const w = world({ gens: sideFails() });
  await w.svc.create(userOf(U1), body());
  await w.drain();
  const parent = w.repo.rows[0];
  assert.strictEqual(parent.status, 'partial');
  assert.strictEqual(parent.photos[1].status, 'failed');
  w.clock.t = new Date(NOW.getTime() + 61000);
  w.deps.generate = async () => ({ ok: true, url: 'https://res.cloudinary.com/x/image/upload/nebula-campaign-posts/again.png' });
  const before = w.purse.get(U1);
  const r = await createPhotoshoot(w.deps).redo(userOf(U1), parent._id, 1, { key: key() });
  assert.strictEqual(r.status, 202, JSON.stringify(r.body));
  assert.strictEqual(w.purse.get(U1), before - PER);
  await w.drain();
  const child = w.repo.rows[1];
  assert.strictEqual(child.kind, 'redo'); assert.strictEqual(child.parentIndex, 1); assert.strictEqual(child.photos[0].scene, parent.photos[1].scene);
  const view = (await w.svc.get(userOf(U1), parent._id)).body.job;
  assert.deepStrictEqual(view.versions.map((v) => [v.index, v.status, Boolean(v.url)]), [[1, 'done', true]]);
  assert.strictEqual((await w.svc.list(userOf(U1))).body.jobs.length, 1, 'a redo is not listed as its own photoshoot');
  assert.strictEqual((await w.svc.library(userOf(U1))).body.photos.length, 4, '3 originals and the new version');
  // Not while the original is still being made.
  const w2 = world();
  await w2.svc.create(userOf(U1), body());
  assert.strictEqual((await w2.svc.redo(userOf(U1), w2.repo.rows[0]._id, 0, { key: key() })).status, 409);
});

test('upload: the type is read from the bytes, the size and the name are checked, a product is made', async () => {
  const w = world();
  const ok = await w.svc.upload(userOf(U1), { name: '  Mango pickle 500 g ', imageData: PNG });
  assert.strictEqual(ok.status, 201, JSON.stringify(ok.body));
  assert.strictEqual(ok.body.product.name, 'Mango pickle 500 g');
  const made = w.prods[w.prods.length - 1];
  assert.strictEqual(String(made.user), U1); assert.deepStrictEqual(made.tags, ['photoshoot-upload']); assert.match(made.imageUrl, /^https:/);
  const fakePng = 'data:image/png;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>').toString('base64');
  for (const imageData of [fakePng, 'https://example.com/a.png', '', 'data:image/png;base64,']) {
    assert.strictEqual((await w.svc.upload(userOf(U1), { name: 'X', imageData })).status, 400, imageData.slice(0, 30));
  }
  const big = 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(caps.UPLOAD_MAX_BYTES + 10)]).toString('base64');
  assert.strictEqual((await w.svc.upload(userOf(U1), { name: 'Big', imageData: big })).body.reason, 'size');
  for (const name of ['', '   ', 'x'.repeat(caps.NAME_MAX + 1), '""']) assert.strictEqual((await w.svc.upload(userOf(U1), { name, imageData: PNG })).status, 400, name);
  assert.strictEqual((await w.svc.upload(userOf(U1, { staffRole: 'support' }), { name: 'X', imageData: PNG })).status, 403);
  // Tamil names are kept as typed.
  assert.strictEqual((await w.svc.upload(userOf(U1), { name: 'மாங்காய் ஊறுகாய்', imageData: PNG })).body.product.name, 'மாங்காய் ஊறுகாய்');
});

test('upload: at most UPLOADS_PER_HOUR an hour', async () => {
  const w = world();
  for (let i = 0; i < caps.UPLOADS_PER_HOUR; i += 1) assert.strictEqual((await w.svc.upload(userOf(U1), { name: `P${i}`, imageData: PNG })).status, 201);
  assert.strictEqual((await w.svc.upload(userOf(U1), { name: 'One more', imageData: PNG })).status, 429);
});

test('options: own products with photo flags (no data URLs sent back), own places, photos left today', async () => {
  const w = world({ products: [
    { _id: P1, user: U1, name: 'A', imageUrl: 'https://res.cloudinary.com/x/a.png' },
    { _id: P2, user: U1, name: 'B', imageUrl: PNG },
    { _id: P_NOPHOTO, user: U1, name: 'C', imageUrl: '' },
    { _id: P_OTHER, user: U2, name: 'D', imageUrl: 'https://res.cloudinary.com/x/d.png' }
  ] });
  const o = await w.svc.options(userOf(U1));
  assert.deepStrictEqual(o.products.map((p) => [p.name, p.hasPhoto, p.thumbnail]), [['A', true, 'https://res.cloudinary.com/x/a.png'], ['B', true, ''], ['C', false, '']]);
  assert.deepStrictEqual(o.places.map((p) => p.name), ['Our shop']);
  assert.strictEqual(o.left, caps.MAX_PHOTOS_PER_DAY);
  assert.strictEqual(o.enabled, true); assert.strictEqual(o.entitled, true); assert.strictEqual(o.postsOnly, false);
});

test('planPhotos and jobView are pure and never leak the prompt', () => {
  const pack = packOf('festival');
  const photos = planPhotos({ pack, products: [{ name: 'Sweets box' }], count: 4, background: '', aspectRatio: '4:5', placeChosen: false });
  assert.deepStrictEqual(photos.map((p) => p.scene), ['lights', 'flowers', 'gift', 'table']);
  const v = jobView({ _id: 'j', pack: 'festival', status: 'queued', photos, products: [{ name: 'Sweets box' }] });
  assert.strictEqual(v.status, 'running');
  assert.ok(v.photos.every((p) => p.status === 'waiting' && !('prompt' in p)));
});

// ---- review 2026-10-19: a charge that throws (S1), the refund claimed before paying (M1), upload gates (M5), keys (M7) ----
test('S1: a charge that throws after the debit landed is refunded at once, never closed as "no balance"', async () => {
  const w = world();
  const spend = w.deps.spend;
  w.deps.spend = async (...a) => { await spend(...a); throw new Error('reply lost'); };
  const svc = createPhotoshoot(w.deps);
  const r = await quiet(() => svc.create(userOf(U1), body()));
  assert.strictEqual(r.status, 503); assert.strictEqual(r.body.creditsExhausted, undefined);
  assert.strictEqual(w.purse.get(U1), 200, 'the debit was returned');
  const row = w.repo.rows[0];
  assert.notStrictEqual(row.status, 'refused'); assert.strictEqual(row.refunded, true); assert.strictEqual(row.inFlight, undefined);
  assert.strictEqual(w.money.filter((m) => m.type === 'refund').length, 1);
  await svc.sweepStale(); await w.drain();
  assert.strictEqual(w.money.filter((m) => m.type === 'refund').length, 1, 'once');
  assert.strictEqual(w.calls.gen, 0);
});

test('S1: a charge that throws with no sign of a debit is left for the stale sweep, which decides from the ledger later', async () => {
  const w = world();
  w.deps.spend = async () => { throw new Error('network'); };
  const svc = createPhotoshoot(w.deps);
  const r = await quiet(() => svc.create(userOf(U1), body()));
  assert.strictEqual(r.status, 503); assert.strictEqual(r.body.message, MESSAGES.chargeUnsure);
  assert.strictEqual(w.repo.rows[0].status, 'queued', 'not closed as refused');
  w.clock.t = new Date(NOW.getTime() + 4 * 60000);
  await svc.sweepStale();
  assert.strictEqual(w.repo.rows[0].status, 'failed'); assert.strictEqual(w.repo.rows[0].inFlight, undefined);
  assert.strictEqual(w.money.length, 0);
});

test('M1: a failed charged mark refunds only if it wins the refund claim (a stale sweep that refunded first is not doubled)', async () => {
  const repo = createFakePhotoshootRepo({ fail: { markCharged: true } });
  const w = world({ repo });
  const spend = w.deps.spend;
  // The charge is slow: the stale sweep finds the row, sees the spend and refunds it before markCharged runs.
  w.deps.spend = async (...a) => { const out = await spend(...a); w.clock.t = new Date(NOW.getTime() + 4 * 60000); await svc.sweepStale(); return out; };
  const svc = createPhotoshoot(w.deps);
  await quiet(() => svc.create(userOf(U1), body()));
  assert.strictEqual(w.money.filter((m) => m.type === 'refund').length, 1, 'refunded once');
  assert.strictEqual(w.purse.get(U1), 200);
});

test('M5: upload follows the switch and the plan like the rest of the studio', async () => {
  const off = world({ env: {} });
  assert.strictEqual((await off.svc.upload(userOf(U1), { name: 'Pickle', imageData: PNG })).status, 503);
  const w = world();
  const free = await w.svc.upload(userOf(U1, { plan: { tier: 'free' } }), { name: 'Pickle', imageData: PNG });
  assert.strictEqual(free.status, 403); assert.strictEqual(free.body.upgradeRequired, true);
  assert.strictEqual(w.prods.filter((p) => (p.tags || []).includes('photoshoot-upload')).length, 0, 'nothing stored');
});

test('M7: a key is one request: a pack key is not replayed for a redo, nor a redo key for another photo', async () => {
  const w = world();
  const b = body();
  const a = await w.svc.create(userOf(U1), b);
  await w.drain();
  const asRedo = await w.svc.redo(userOf(U1), a.body.job.id, 0, { key: b.key });
  assert.strictEqual(asRedo.status, 409); assert.strictEqual(asRedo.body.message, MESSAGES.keyReused);
  const k = key();
  assert.strictEqual((await w.svc.redo(userOf(U1), a.body.job.id, 0, { key: k })).status, 202);
  await w.drain();
  assert.strictEqual((await w.svc.redo(userOf(U1), a.body.job.id, 1, { key: k })).status, 409);
  assert.strictEqual((await w.svc.create(userOf(U1), { ...body(), key: k })).status, 409);
  assert.strictEqual(w.money.filter((m) => m.type === 'spend').length, 2);
});

test('delete one photo: it leaves the job and the Library, its stored picture is removed, money and counts stay', async () => {
  const w = world();
  const removed = [];
  w.deps.deleteImage = async (url) => { removed.push(url); return { success: true }; };
  const svc = createPhotoshoot(w.deps);
  await svc.create(userOf(U1), body());
  await w.drain();
  const job = w.repo.rows[0];
  const url = job.photos[2].url;
  const money = JSON.stringify(w.money); const refunded = job.refunded; const quarks = job.quarks;
  const r = await svc.deletePhoto(userOf(U1), job._id, 2);
  assert.strictEqual(r.status, 200); assert.strictEqual(r.body.deleted, true);
  assert.deepStrictEqual(removed, [url]);
  const view = (await svc.get(userOf(U1), job._id)).body.job;
  assert.strictEqual(view.photos.length, 3); assert.ok(!view.photos.some((p) => p.index === 2));
  assert.strictEqual((await svc.library(userOf(U1))).body.photos.length, 3);
  assert.ok(!JSON.stringify(view).includes(url));
  assert.strictEqual(JSON.stringify(w.money), money, 'no charge and no refund moved');
  assert.strictEqual(w.repo.rows[0].refunded, refunded); assert.strictEqual(w.repo.rows[0].quarks, quarks);
  assert.strictEqual(w.repo.rows[0].photoCount, job.photoCount);
  // Twice is a plain not found; the photo cannot be made again or put back in the Library.
  assert.strictEqual((await svc.deletePhoto(userOf(U1), job._id, 2)).status, 404);
  assert.strictEqual((await svc.setInLibrary(userOf(U1), job._id, 2, true)).status, 404);
  assert.strictEqual((await svc.redo(userOf(U1), job._id, 2, { key: key() })).status, 404);
  assert.strictEqual(removed.length, 1);
});

test('delete one photo: only your own, only when finished, a bad index or id is refused, a host failure changes nothing', async () => {
  const w = world();
  w.deps.deleteImage = async () => { throw new Error('host down'); };
  const svc = createPhotoshoot(w.deps);
  await svc.create(userOf(U1), body());
  const id = w.repo.rows[0]._id;
  // Still running (queued work not yet drained).
  assert.strictEqual((await svc.deletePhoto(userOf(U1), id, 0)).status, 409);
  assert.ok(w.repo.rows[0].photos.every((p) => !p.deleted));
  await w.drain();
  assert.strictEqual((await svc.deletePhoto(userOf(U2), id, 0)).status, 404, 'someone else\'s job');
  assert.strictEqual((await svc.deletePhoto(userOf(U1), 'nope', 0)).status, 400);
  assert.strictEqual((await svc.deletePhoto(userOf(U1), id, -1)).status, 400);
  assert.strictEqual((await svc.deletePhoto(userOf(U1), id, 'x')).status, 400);
  assert.strictEqual((await svc.deletePhoto(userOf(U1), id, 99)).status, 404);
  const quiet2 = console.warn; console.warn = () => {};
  try { assert.strictEqual((await svc.deletePhoto(userOf(U1), id, 0)).status, 200, 'the host failing is best effort'); } finally { console.warn = quiet2; }
  assert.strictEqual(w.repo.rows[0].photos[0].deleted, true);
});

test('delete one photo: a photo that did not finish cannot be deleted, a version leaves the page and the original shows again', async () => {
  const w = world({ gens: sideFails() });
  const svc = createPhotoshoot(w.deps);
  await svc.create(userOf(U1), body());
  await w.drain();
  const parent = w.repo.rows[0];
  assert.strictEqual(parent.photos[1].status, 'failed');
  assert.strictEqual((await svc.deletePhoto(userOf(U1), parent._id, 1)).status, 404, 'not made, nothing to delete');
  w.clock.t = new Date(NOW.getTime() + 61000);
  w.deps.generate = async () => ({ ok: true, url: 'https://res.cloudinary.com/x/image/upload/nebula-campaign-posts/again.png' });
  await createPhotoshoot(w.deps).redo(userOf(U1), parent._id, 1, { key: key() });
  await w.drain();
  const child = w.repo.rows[1];
  assert.strictEqual((await svc.get(userOf(U1), parent._id)).body.job.versions.length, 1);
  assert.strictEqual((await svc.deletePhoto(userOf(U1), child._id, 0)).status, 200);
  assert.strictEqual((await svc.get(userOf(U1), parent._id)).body.job.versions.length, 0);
  assert.strictEqual((await svc.library(userOf(U1))).body.photos.length, 3);
});

test('publicIdOf only ever names one of our stored pictures', () => {
  assert.strictEqual(publicIdOf('https://res.cloudinary.com/x/image/upload/v17/nebula-campaign-posts/abc_1.png'), 'nebula-campaign-posts/abc_1');
  assert.strictEqual(publicIdOf('https://res.cloudinary.com/x/image/upload/nebula-campaign-posts/p1.png?x=1'), 'nebula-campaign-posts/p1');
  for (const bad of ['', null, 'http://res.cloudinary.com/x/image/upload/a.png', 'https://evil.example/image/upload/a.png', 'https://res.cloudinary.com/x/video/upload/a.mp4', 'https://res.cloudinary.com/x/image/upload/../a.png', 'data:image/png;base64,AAAA']) assert.strictEqual(publicIdOf(bad), '', String(bad));
});

// ---- settle sweep: a job closed with a recorded refund that was never paid ------------------------------------------
const MIN = 60 * 1000;
/** A paid, fully closed job whose refund is recorded but not paid: what a crash between close and refund leaves. */
async function crashed(w, { ageMin = 10, status = 'partial', refunded = 20, extra = {} } = {}) {
  const row = await w.repo.insert({ user: U1, key: key(), kind: 'pack', pack: 'marketplace', day: '2026-10-20', status: 'running', inFlight: true, photoCount: 4, quarksPerPhoto: 20, quarks: 80, payerId: U1,
    photos: [0, 1, 2, 3].map((i) => ({ index: i, status: i === 3 ? 'failed' : 'done' })), ...extra });
  w.purse.set(U1, w.purse.get(U1) - 80);
  w.money.push({ type: 'spend', uid: U1, payer: U1, cost: 80, action: 'photoshoot_image', ref: String(row._id) });
  await w.repo.finalize(row._id, { status, outcome: status, refundedQuarks: refunded, now: new Date(w.clock.t.getTime() - ageMin * MIN) });
  return row._id;
}
const refundsOf = (w, id) => w.money.filter((m) => m.type === 'refund' && m.ref === String(id));

test('settle: a crash between close and refund is paid once, to the payer, then settled', async () => {
  const w = world({ payers: { [U1]: AGENCY } });
  const id = await crashed(w, { extra: { payerId: AGENCY } });
  const before = w.purse.get(AGENCY);
  assert.strictEqual(await w.svc.sweepUnsettled(), 1);
  assert.strictEqual(refundsOf(w, id).length, 1); assert.strictEqual(refundsOf(w, id)[0].q, 20); assert.strictEqual(refundsOf(w, id)[0].payer, AGENCY);
  assert.strictEqual(w.purse.get(AGENCY), before + 20);
  assert.ok(w.repo.rows[0].refundSettledAt);
  assert.strictEqual(await w.svc.sweepUnsettled(), 0);
  assert.strictEqual(refundsOf(w, id).length, 1, 'a second run pays nothing');
});

test('settle: the refund is never more than was recorded or charged', async () => {
  const w = world();
  const id = await crashed(w, { refunded: 500 });
  await w.svc.sweepUnsettled();
  assert.strictEqual(refundsOf(w, id)[0].q, 80);
  const w2 = world();
  const id2 = await crashed(w2, { refunded: 20 });
  await w2.svc.sweepUnsettled();
  assert.strictEqual(refundsOf(w2, id2)[0].q, 20);
});

test('settle: a refund row already in the ledger only marks the job settled', async () => {
  const w = world();
  const id = await crashed(w);
  w.money.push({ type: 'refund', uid: U1, payer: U1, q: 20, action: 'photoshoot_image_refund', ref: String(id) });
  const before = w.purse.get(U1);
  assert.strictEqual(await w.svc.sweepUnsettled(), 1);
  assert.strictEqual(refundsOf(w, id).length, 1);
  assert.strictEqual(w.purse.get(U1), before);
  assert.ok(w.repo.rows[0].refundSettledAt);
});

test('settle: a refund that fails is flagged for the retry loop and raised like the others', async () => {
  const w = world({ refundFails: true });
  const id = await crashed(w);
  assert.strictEqual(await w.svc.sweepUnsettled(), 0);
  assert.strictEqual(w.repo.rows[0].refundFailed, true); assert.ok(!w.repo.rows[0].refundSettledAt);
  assert.strictEqual(w.alerts[0][0], 'photoshoot_refund');
  assert.strictEqual(refundsOf(w, id).length, 0);
  assert.strictEqual(await w.svc.sweepUnsettled(), 0, 'left to the retry loop, not tried again here');
});

test('settle: a ledger that cannot be read pays nothing now and tries again after the hold', async () => {
  const w = world();
  const id = await crashed(w);
  const blind = createPhotoshoot({ ...w.deps, ledgerFor: async () => { throw new Error('db down'); } });
  await blind.sweepUnsettled();
  assert.strictEqual(refundsOf(w, id).length, 0);
  assert.strictEqual(await w.svc.sweepUnsettled(), 0, 'still held');
  w.clock.t = new Date(w.clock.t.getTime() + 6 * MIN);
  assert.strictEqual(await w.svc.sweepUnsettled(), 1);
  assert.strictEqual(refundsOf(w, id).length, 1);
});

test('settle: young jobs, running and queued jobs, refused jobs and jobs with no refund are left alone', async () => {
  const w = world();
  const young = await crashed(w, { ageMin: 1 });
  const none = await crashed(w, { refunded: 0, status: 'done' });
  const running = await w.repo.insert({ user: U2, key: key(), kind: 'pack', status: 'running', inFlight: true, quarks: 80, payerId: U2, refundedQuarks: 20, finishedAt: new Date(w.clock.t.getTime() - 10 * MIN), photos: [] });
  const queued = await w.repo.insert({ user: U1, key: key(), kind: 'pack', status: 'queued', refundedQuarks: 20, finishedAt: new Date(w.clock.t.getTime() - 10 * MIN), photos: [] });
  assert.strictEqual(await w.svc.sweepUnsettled(), 0);
  assert.strictEqual(w.money.filter((m) => m.type === 'refund').length, 0);
  assert.ok([young, none, running._id, queued._id].every((i) => !w.repo.rows.find((r) => String(r._id) === String(i)).refundSettledAt));
  w.clock.t = new Date(w.clock.t.getTime() + 5 * MIN); // the young one grows up
  assert.strictEqual(await w.svc.sweepUnsettled(), 1);
  assert.strictEqual(refundsOf(w, young).length, 1);
});

test('settle: concurrent sweeps pay once', async () => {
  const w = world();
  const id = await crashed(w);
  const other = createPhotoshoot({ ...w.deps }); // a second process on the same database and wallet
  await Promise.all([w.svc.sweepUnsettled(), other.sweepUnsettled(), w.svc.sweepUnsettled(), other.sweepUnsettled()]);
  assert.strictEqual(refundsOf(w, id).length, 1);
  assert.ok(w.repo.rows[0].refundSettledAt);
});

test('settle: finalize marks a paid refund settled, so a normal job never needs the sweep; it runs from resumeLost', async () => {
  const w = world({ gens: Array(8).fill({ ok: false }) });
  await w.svc.create(userOf(U1), body());
  await w.drain();
  const row = w.repo.rows[0];
  assert.strictEqual(row.status, 'failed'); assert.ok(row.refundedQuarks > 0);
  assert.ok(row.refundSettledAt, 'settled right after the refund');
  w.clock.t = new Date(w.clock.t.getTime() + 10 * MIN);
  await w.svc.sweepUnsettled();
  assert.strictEqual(w.money.filter((m) => m.type === 'refund').length, 1, 'nothing paid again');
  const c = await crashed(w);
  await w.svc.resumeLost();
  assert.strictEqual(refundsOf(w, c).length, 1, 'resumeLost runs the settle sweep');
});
