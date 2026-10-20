'use strict';
// E9 stage B step 1: Videos (Omni) on worker consumers (services/studioVideoConsumer.js, routes/studioVideos.js runClaimed).
// Fake StudioVideo model (in memory, Mongo-style filters), fake clock, fake Omni, fake clip storage, fake ffmpeg and a fake
// wallet. No network, no database, no provider.
const test = require('node:test');
const assert = require('node:assert');

const route = require('../routes/studioVideos');
const StudioVideo = require('../models/StudioVideo');
const User = require('../models/User');
const quarkBuckets = require('../services/quarkBuckets');
const spendGuard = require('../services/spendGuard');
const { StudioVideoConsumer, enabled } = require('../services/studioVideoConsumer');
const { createSemaphore } = require('../services/cpuSlots');
const { QUARK_COSTS } = require('../config/apiCosts');

const COST1 = QUARK_COSTS.studio_video;
const quiet = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };
const tick = () => new Promise((r) => setImmediate(r));
async function settle(n = 40) { for (let i = 0; i < n; i += 1) await tick(); }

// ---- a small Mongo-style model ----
const same = (v, c) => {
  if (c === null) return v === null || v === undefined;
  if (c instanceof Date) return v instanceof Date && v.getTime() === c.getTime();
  return String(v) === String(c);
};
const cmp = (v) => (v instanceof Date ? v.getTime() : v);
const matches = (d, q) => Object.entries(q).every(([k, c]) => {
  const v = d[k];
  if (c && typeof c === 'object' && !(c instanceof Date) && !Array.isArray(c)) {
    if ('$ne' in c && same(v, c.$ne)) return false;
    if ('$nin' in c && c.$nin.some((x) => same(v, x))) return false;
    if ('$in' in c && !c.$in.some((x) => same(v, x))) return false;
    if ('$lt' in c && !(v != null && cmp(v) < cmp(c.$lt))) return false;
    if ('$gt' in c && !(v != null && cmp(v) > cmp(c.$gt))) return false;
    return true;
  }
  return same(v, c);
});
const copy = (d) => (d ? { ...d, clipUrls: [...(d.clipUrls || [])] } : d);
const apply = (d, u) => { Object.assign(d, u.$set || {}); for (const [k, n] of Object.entries(u.$inc || {})) d[k] = (d[k] || 0) + n; d.updatedAt = new Date(); };
const query = (value) => {
  let rows = value;
  const q = {
    sort: (spec) => { if (Array.isArray(rows)) { const [[k, dir]] = Object.entries(spec); rows = rows.slice().sort((a, b) => (cmp(a[k]) - cmp(b[k])) * dir); } return q; },
    limit: (n) => { if (Array.isArray(rows)) rows = rows.slice(0, n); return q; },
    select: () => q,
    lean: () => q,
    then: (a, b) => Promise.resolve(Array.isArray(rows) ? rows.map(copy) : copy(rows)).then(a, b),
    catch: (b) => Promise.resolve(rows).catch(b)
  };
  return q;
};

function world({ balance = 10000 } = {}) {
  const w = { docs: {}, spends: [], refunds: [], balance, nextId: 0, gen: [], stored: new Map(), discarded: [], hang: null };
  const keys = ['create', 'countDocuments', 'deleteOne', 'updateOne', 'findOneAndUpdate', 'findOne', 'find', 'aggregate', 'findById'];
  const orig = {};
  for (const k of keys) orig[k] = StudioVideo[k];
  const o2 = { uf: User.findById, proof: quarkBuckets.chargeProof, spend: quarkBuckets.spend, settle: quarkBuckets.settleWallet, refund: quarkBuckets.refundTo, guard: spendGuard.check };
  const all = () => Object.values(w.docs);
  StudioVideo.create = async (d) => {
    const id = `v${++w.nextId}`;
    const now = new Date(w.clock ? w.clock.t : Date.now());
    w.docs[id] = { _id: id, createdAt: new Date(now.getTime() + w.nextId), startedAt: now, status: 'processing', refunded: false, refundState: '', workerId: null, leaseUntil: null, attempts: 0, releases: 0, leaseRequeues: 0, queuedAt: null, clipUrls: [], work: null, clipsDone: 0, ...d };
    return copy(w.docs[id]);
  };
  StudioVideo.countDocuments = async (q) => all().filter((d) => matches(d, q)).length;
  StudioVideo.deleteOne = async (q) => { const d = all().find((x) => matches(x, q)); if (d) delete w.docs[d._id]; return { deletedCount: d ? 1 : 0 }; };
  StudioVideo.updateOne = async (q, u) => { const d = all().find((x) => matches(x, q)); if (!d) return { matchedCount: 0, modifiedCount: 0 }; apply(d, u); return { matchedCount: 1, modifiedCount: 1 }; };
  StudioVideo.findOneAndUpdate = (q, u, o) => { const d = all().find((x) => matches(x, q)); if (!d) return query(null); const before = copy(d); apply(d, u); return query(o && o.new === false ? before : d); };
  StudioVideo.findOne = (q) => query(all().find((x) => matches(x, q)) || null);
  StudioVideo.findById = (id) => query(w.docs[id] || null);
  StudioVideo.find = (q) => query(all().filter((d) => matches(d, q)));
  StudioVideo.aggregate = async ([m, g]) => {
    const rows = all().filter((d) => matches(d, m.$match));
    const field = String(g.$group._id).replace(/^\$/, '');
    const groups = new Map();
    for (const d of rows) {
      const key = d[field] == null ? null : d[field];
      const e = groups.get(String(key)) || { _id: key, n: 0, oldest: null };
      e.n += 1;
      if (g.$group.oldest && d.queuedAt && (!e.oldest || d.queuedAt < e.oldest)) e.oldest = d.queuedAt;
      groups.set(String(key), e);
    }
    return [...groups.values()];
  };
  quarkBuckets.chargeProof = async (ref) => {
    const sp = w.spends.find((x) => x.ok && x.meta.ref === ref);
    return { spend: sp ? { payer: 'payer1', quarks: sp.amount, source: 'ledger' } : null, refunded: w.refunds.some((x) => x.meta.ref === ref) };
  };
  User.findById = () => ({ select: () => ({ lean: async () => ({ companyName: 'Sri Lakshmi' }) }) });
  quarkBuckets.settleWallet = async () => null;
  quarkBuckets.spend = async (u, amount, meta) => { const rec = { amount, meta, ok: false }; w.spends.push(rec); if (w.balance < amount) return { success: false }; w.balance -= amount; rec.ok = true; return { success: true, payerId: 'payer1' }; };
  quarkBuckets.refundTo = async (u, amount, meta) => { await tick(); w.refunds.push({ amount, meta, user: u }); w.balance += amount; return { ok: true }; };
  spendGuard.check = async () => ({ ok: true });

  // Fake Omni: each call is recorded; a gate can hold a call (a hung or slow provider).
  let clip = 0;
  Object.assign(route._io, {
    generate: async (a) => {
      w.gen.push(a.prompt);
      if (w.hang && w.hang(a)) { return new Promise((resolve) => { w.release = () => resolve({ ok: true, buffer: Buffer.from(`late:${a.prompt}`) }); }); }
      if (w.fail && w.fail(a)) return { ok: false, message: 'busy' };
      if (w.gate) await w.gate;
      return { ok: true, buffer: Buffer.from(`clip:${a.prompt}`) };
    },
    change: async ({ instruction }) => { w.gen.push(`change:${instruction}`); return { ok: true, buffer: Buffer.from(`changed:${instruction}`) }; },
    loadRefs: async () => [],
    lastFrame: async (b) => Buffer.from(`F:${b}`),
    concat: async (bufs) => Buffer.from(bufs.map(String).join('+')),
    storeClip: async (buf) => { const url = `https://cdn.test/clip/${++clip}`; w.stored.set(url, Buffer.from(buf)); return url; },
    loadClip: async (url) => w.stored.get(url) || null,
    store: async (buf) => { w.final = String(buf); return `https://cdn.test/final/${++clip}.mp4`; },
    discard: async (url) => { w.discarded.push(url); },
    logoUrl: async () => '',
    alert: () => {}
  });
  w.restore = () => {
    for (const k of keys) StudioVideo[k] = orig[k];
    User.findById = o2.uf; quarkBuckets.chargeProof = o2.proof; quarkBuckets.spend = o2.spend; quarkBuckets.settleWallet = o2.settle; quarkBuckets.refundTo = o2.refund; spendGuard.check = o2.guard;
    for (const k of Object.keys(route._io)) delete route._io[k];
    delete process.env.ENABLE_STUDIO_VIDEO_CONSUMER;
  };
  return w;
}

const SETTINGS = { slots: { image: 2, video: 2, omni: 2 }, cpu: 1, globalCeiling: 200, perUserRunning: 2, leaseMs: 60000, heartbeatMs: 1e9, maxAttempts: 2, shutdownGraceMs: 0, warnings: [] };
const directLease = { withLease: async (name, ttl, fn) => fn() };
function consumer(w, name, settings = {}) {
  const c = new StudioVideoConsumer({
    model: StudioVideo, workerId: `w:${name}`, settings: { ...SETTINGS, ...settings, slots: { ...SETTINGS.slots, ...(settings.slots || {}) } },
    now: () => w.clock.t, leaseLock: directLease, cpu: createSemaphore(1), alert: () => {}, sleep: async () => { await tick(); }
  });
  c.started = true; // drained by hand in the tests (no timers)
  return c;
}

const handler = (p, method) => route.stack.find((l) => l.route && l.route.path === p && l.route.methods[method]).route.stack.slice(-1)[0].handle;
const resp = () => { const r = { code: 200, body: null, headersSent: false, status(c) { r.code = c; return r; }, json(b) { r.body = b; r.headersSent = true; return r; } }; return r; };
let uid = 0;
async function create(w, body = {}, user = `u${++uid}`) {
  process.env.ENABLE_STUDIO_VIDEO_CONSUMER = 'on';
  const res = resp();
  await handler('/create', 'post')({ user: { userId: user }, body: { concept: 'A sweet shop at dusk.', clips: 1, language: 'english', ...body } }, res);
  return res;
}
const parts3 = { clips: 3, parts: [{ beats: ['a'], spokenLine: 'One.' }, { beats: ['b'], spokenLine: 'Two.' }, { beats: ['c'], spokenLine: 'Three.' }] };
const genFor = (w, word) => w.gen.filter((p) => p.includes(word)).length;
const clockAt = (t = 1_000_000) => ({ t });

// ---- the switch and the create ----
test('the switch is off by default and reads on/1/true/yes', () => {
  assert.strictEqual(enabled({}), false);
  for (const v of ['on', '1', 'true', 'YES']) assert.strictEqual(enabled({ ENABLE_STUDIO_VIDEO_CONSUMER: v }), true);
  assert.strictEqual(enabled({ ENABLE_STUDIO_VIDEO_CONSUMER: 'off' }), false);
});

test('switch on: create charges once, queues the video with its work, answers 202 shown as processing, and runs nothing in the request', async () => {
  const w = world(); w.clock = clockAt();
  try {
    const res = await create(w, parts3);
    assert.strictEqual(res.code, 202);
    assert.strictEqual(res.body.video.status, 'processing');
    assert.strictEqual(res.body.video.queued, true);
    assert.strictEqual(w.spends.length, 1);
    assert.strictEqual(w.spends[0].amount, 3 * COST1);
    const d = w.docs.v1;
    assert.strictEqual(d.status, 'queued');
    assert.ok(d.queuedAt instanceof Date);
    assert.strictEqual(d.work.kind, 'create');
    assert.strictEqual(d.work.prompts.length, 3);
    await settle();
    assert.strictEqual(w.gen.length, 0, 'nothing made until a consumer claims it');
  } finally { w.restore(); }
});

test('switch on: not enough Quarks deletes the row (nothing queued); a failed queue write refunds the proven charge', async () => {
  const w = world({ balance: COST1 }); w.clock = clockAt();
  try {
    const res = await create(w, parts3);
    assert.strictEqual(res.code, 403);
    assert.deepStrictEqual(w.docs, {});
    w.balance = 10 * COST1;
    const fou = StudioVideo.findOneAndUpdate;
    StudioVideo.findOneAndUpdate = (q, u, o) => (u.$set && u.$set.status === 'queued' ? query(null) : fou(q, u, o));
    const r2 = await quiet(() => create(w, {}));
    StudioVideo.findOneAndUpdate = fou;
    assert.strictEqual(r2.code, 500);
    const d = Object.values(w.docs)[0];
    assert.strictEqual(d.status, 'failed');
    assert.strictEqual(w.refunds.length, 1);
    assert.strictEqual(w.refunds[0].amount, COST1);
  } finally { w.restore(); }
});

test('switch off keeps the in-process path: the row is processing with no work and the request task makes it', async () => {
  const w = world(); w.clock = clockAt();
  try {
    const res = resp();
    await handler('/create', 'post')({ user: { userId: 'off1' }, body: { concept: 'x', clips: 1 } }, res);
    assert.strictEqual(res.code, 202);
    assert.strictEqual(w.docs.v1.work, null);
    // Old path: run() with io.work (as the existing route tests), here via the module-level generate fake is not used for one clip.
    route._io.work = async () => ({ ok: true, buffer: Buffer.from('inproc') });
    await settle(60);
    assert.strictEqual(w.docs.v1.status, 'completed');
    const c = consumer(w, 'A');
    assert.strictEqual(await c._drain(), 0, 'a consumer never claims an in-process row');
  } finally { w.restore(); }
});

// ---- claims ----
test('two consumers never run the same video, and every video completes once', async () => {
  const w = world(); w.clock = clockAt();
  try {
    for (let i = 0; i < 4; i += 1) await create(w, { concept: `video ${i}` }, `two${i}`);
    const a = consumer(w, 'A'); const b = consumer(w, 'B');
    await Promise.all([a._drain(), b._drain(), a._drain(), b._drain()]);
    await settle(80);
    const docs = Object.values(w.docs);
    assert.ok(docs.every((d) => d.status === 'completed'), docs.map((d) => d.status).join());
    assert.strictEqual(w.gen.length, 4, 'one provider call per video');
    assert.strictEqual(a.stats.claims + b.stats.claims, 4);
    assert.ok(docs.every((d) => d.attempts === 1));
    assert.strictEqual(w.refunds.length, 0);
  } finally { w.restore(); }
});

test('concurrency = consumers x omni slots (3 x 2 = 6 videos at once)', async () => {
  const w = world(); w.clock = clockAt();
  try {
    for (let i = 0; i < 8; i += 1) await create(w, { concept: `c ${i}` }, `cc${i}`);
    let open; w.gate = new Promise((r) => { open = r; });
    const cs = ['A', 'B', 'C'].map((n) => consumer(w, n));
    await Promise.all(cs.map((c) => c._drain()));
    await settle();
    assert.strictEqual(w.gen.length, 6);
    assert.strictEqual(Object.values(w.docs).filter((d) => d.status === 'processing').length, 6);
    assert.strictEqual(Object.values(w.docs).filter((d) => d.status === 'queued').length, 2);
    open(); w.gate = null;
    await settle(120);
    assert.ok(Object.values(w.docs).every((d) => d.status === 'completed'));
  } finally { w.restore(); }
});

test('fair order and the per-account cap: other accounts start before an account\'s third video', async () => {
  const w = world(); w.clock = clockAt();
  try {
    for (let i = 0; i < 4; i += 1) await create(w, { concept: `a${i}` }, 'heavy');
    await create(w, { concept: 'b0' }, 'lightB');
    await create(w, { concept: 'c0' }, 'lightC');
    let open; w.gate = new Promise((r) => { open = r; });
    const c = consumer(w, 'A', { slots: { omni: 4 } });
    await c._drain();
    await settle();
    const running = Object.values(w.docs).filter((d) => d.status === 'processing');
    const by = (u) => running.filter((d) => String(d.user) === u).length;
    assert.strictEqual(by('lightB'), 1);
    assert.strictEqual(by('lightC'), 1);
    assert.strictEqual(by('heavy'), 2, 'cap 2 per account');
    open(); w.gate = null;
    await settle(150);
    assert.ok(Object.values(w.docs).every((d) => d.status === 'completed'));
  } finally { w.restore(); }
});

test('a video in its finishing step frees its provider slot (CPU slot instead)', async () => {
  const w = world(); w.clock = clockAt();
  try {
    await create(w, { concept: 'f1' }, 'fa'); await create(w, { concept: 'f2' }, 'fb');
    let openStore; const storeGate = new Promise((r) => { openStore = r; });
    const st = route._io.store; route._io.store = async (b) => { await storeGate; return st(b); };
    const c = consumer(w, 'A', { slots: { omni: 1 } });
    await c._drain();
    await settle(60);
    assert.strictEqual(w.gen.length, 2, 'the second video was claimed while the first one was finishing');
    openStore();
    await settle(80);
    assert.ok(Object.values(w.docs).every((d) => d.status === 'completed'));
  } finally { w.restore(); }
});

// ---- resume after a lost worker ----
test('a consumer that dies mid-chain is resumed: stored clips are not made again, nothing is charged again, no refund', async () => {
  const w = world(); w.clock = clockAt();
  try {
    await create(w, parts3, 'res1');
    const a = consumer(w, 'A');
    w.hang = (x) => /Two\./.test(x.prompt) && !w.hungOnce && (w.hungOnce = true);
    await a._drain();
    await settle(60);
    const d = w.docs.v1;
    assert.strictEqual(d.clipsDone, 1);
    assert.strictEqual(d.clipUrls.length, 1, 'clip 1 is stored');
    // A dies (no heartbeat): the lease runs out; another consumer's sweep re-queues and claims it.
    w.clock.t += 60000 + 20000 + 1;
    const b = consumer(w, 'B');
    const swept = await b.sweepLeases();
    assert.deepStrictEqual(swept, { requeued: 1, failed: 0 });
    assert.strictEqual(w.docs.v1.status, 'queued');
    await b._drain();
    await settle(80);
    assert.strictEqual(w.docs.v1.status, 'completed');
    assert.strictEqual(w.docs.v1.attempts, 2);
    assert.strictEqual(genFor(w, 'One.'), 1, 'clip 1 made once');
    assert.strictEqual(genFor(w, 'Three.'), 1);
    assert.strictEqual(w.final, 'clip:' + w.gen.find((p) => p.includes('One.')) + '+clip:' + w.gen.filter((p) => p.includes('Two.'))[1] + '+clip:' + w.gen.find((p) => p.includes('Three.')));
    assert.strictEqual(w.spends.length, 1);
    assert.strictEqual(w.refunds.length, 0);
    // The dead run wakes up late: its clip write matches nothing, its upload is deleted, it does not complete.
    const before = { ...w.docs.v1 };
    w.release();
    await settle(40);
    assert.strictEqual(w.docs.v1.status, 'completed');
    assert.strictEqual(w.docs.v1.videoUrl, before.videoUrl);
    assert.strictEqual(a.stats.lostRuns, 1);
    assert.ok(w.discarded.length >= 1, 'the late clip upload was deleted');
    assert.strictEqual(w.refunds.length, 0);
  } finally { w.restore(); }
});

test('lost twice = at the cap: failed with a full refund, once, even with two sweeps at the same moment', async () => {
  const w = world(); w.clock = clockAt();
  try {
    await create(w, parts3, 'cap1');
    w.hang = () => true;
    const a = consumer(w, 'A'); await a._drain(); await settle();
    w.clock.t += 81000;
    const b = consumer(w, 'B'); await b.sweepLeases(); await b._drain(); await settle();
    assert.strictEqual(w.docs.v1.attempts, 2);
    w.clock.t += 81000;
    const c = consumer(w, 'C'); const d = consumer(w, 'D');
    const [r1, r2] = await Promise.all([c.sweepLeases(), d.sweepLeases()]);
    await settle();
    assert.strictEqual(r1.failed + r2.failed, 1);
    assert.strictEqual(w.docs.v1.status, 'failed');
    assert.strictEqual(w.refunds.length, 1);
    assert.strictEqual(w.refunds[0].amount, 3 * COST1);
    assert.strictEqual(w.refunds[0].meta.payerId, 'payer1', 'back to the wallet that paid');
    assert.strictEqual(w.docs.v1.refundState, 'done');
  } finally { w.restore(); }
});

test('partial delivery after a resume: a later clip failing twice delivers the made clips and refunds the rest once', async () => {
  const w = world(); w.clock = clockAt();
  try {
    await create(w, parts3, 'part1');
    w.hang = (x) => /Two\./.test(x.prompt) && !w.hungOnce && (w.hungOnce = true);
    const a = consumer(w, 'A'); await a._drain(); await settle();
    w.clock.t += 81000;
    w.fail = (x) => /Three\./.test(x.prompt);
    const b = consumer(w, 'B'); await b.sweepLeases(); await quiet(async () => { await b._drain(); await settle(80); });
    const d = w.docs.v1;
    assert.strictEqual(d.status, 'completed');
    assert.strictEqual(d.clipsDone, 2);
    assert.strictEqual(d.quarks, 2 * COST1);
    assert.strictEqual(w.refunds.length, 1);
    assert.strictEqual(w.refunds[0].amount, COST1);
    assert.strictEqual(genFor(w, 'One.'), 1);
  } finally { w.restore(); }
});

test('clip 1 failing on the consumer path fails the video and refunds everything once', async () => {
  const w = world(); w.clock = clockAt();
  try {
    await create(w, parts3, 'f1');
    w.fail = () => true;
    const a = consumer(w, 'A'); await quiet(async () => { await a._drain(); await settle(60); });
    assert.strictEqual(w.docs.v1.status, 'failed');
    assert.strictEqual(w.refunds.length, 1);
    assert.strictEqual(w.refunds[0].amount, 3 * COST1);
  } finally { w.restore(); }
});

test('a late result after the lease was lost (one clip, during finishing) is discarded; the new run delivers', async () => {
  const w = world(); w.clock = clockAt();
  try {
    await create(w, {}, 'late1');
    let openStore; const g = new Promise((r) => { openStore = r; });
    const st = route._io.store; let first = true;
    route._io.store = async (b) => { if (first) { first = false; await g; } return st(b); };
    const a = consumer(w, 'A'); await a._drain(); await settle();
    assert.strictEqual(w.docs.v1.clipUrls.length, 1, 'the one clip is stored before finishing');
    w.clock.t += 81000;
    const b = consumer(w, 'B'); await b.sweepLeases(); await b._drain(); await settle(60);
    assert.strictEqual(w.docs.v1.status, 'completed');
    assert.strictEqual(w.gen.length, 1, 'the resumed run did not call Omni again');
    const url = w.docs.v1.videoUrl;
    openStore(); await settle(40);
    assert.strictEqual(w.docs.v1.videoUrl, url, 'the late upload did not replace the delivered video');
    assert.ok(w.discarded.some((u) => /final/.test(u)), 'the late upload was deleted');
    assert.strictEqual(w.refunds.length, 0);
  } finally { w.restore(); }
});

test('the heartbeat renews only its own claim; a taken-over run is marked lost', async () => {
  const w = world(); w.clock = clockAt();
  try {
    await create(w, parts3, 'hb1');
    w.hang = () => true;
    const a = consumer(w, 'A', { heartbeatMs: 5 });
    await a._drain(); await settle();
    const lease1 = w.docs.v1.leaseUntil.getTime();
    w.clock.t += 1000;
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(w.docs.v1.leaseUntil.getTime() > lease1, 'renewed');
    StudioVideo.updateOne({ _id: 'v1' }, { $set: { workerId: 'someone-else' } });
    await new Promise((r) => setTimeout(r, 20));
    const run = [...a.running.values()][0];
    assert.strictEqual(run.lost, true);
    w.release(); await settle();
  } finally { w.restore(); }
});

// ---- races, cancel, delete ----
test('a lease sweep after the video completed does nothing (the conditional write loses)', async () => {
  const w = world(); w.clock = clockAt();
  try {
    await create(w, {}, 'race1');
    const a = consumer(w, 'A'); await a._drain(); await settle(60);
    assert.strictEqual(w.docs.v1.status, 'completed');
    w.clock.t += 1e6;
    assert.deepStrictEqual(await consumer(w, 'B').sweepLeases(), { requeued: 0, failed: 0 });
    assert.strictEqual(w.refunds.length, 0);
  } finally { w.restore(); }
});

test('delete is refused while queued and while processing; a row removed while queued is simply not run', async () => {
  const w = world(); w.clock = clockAt();
  try {
    await create(w, {}, 'del1');
    const del = async (id) => { const res = resp(); await handler('/:id', 'delete')({ user: { userId: 'del1' }, params: { id } }, res); return res; };
    await del('v1');
    assert.ok(w.docs.v1, 'queued: not deleted');
    w.hang = () => true;
    const a = consumer(w, 'A'); await a._drain(); await settle();
    await del('v1');
    assert.ok(w.docs.v1, 'processing: not deleted');
    // Account deletion removes the row while it runs: the late result is not written and nothing is refunded.
    delete w.docs.v1;
    w.release(); await settle(40);
    assert.strictEqual(w.refunds.length, 0);
    assert.strictEqual(a.stats.lostRuns, 1);
    await create(w, {}, 'del2');
    delete w.docs.v2;
    assert.strictEqual(await consumer(w, 'B')._drain(), 0);
  } finally { w.restore(); }
});

test('a queued video nobody claims for 30 minutes is refunded once (sweep and list), shown as failed', async () => {
  const w = world(); w.clock = clockAt();
  try {
    await create(w, {}, 'q1');
    w.docs.v1.queuedAt = new Date(Date.now() - 31 * 60 * 1000);
    const res = resp();
    await handler('/', 'get')({ user: { userId: 'q1' } }, res);
    assert.strictEqual(res.body.videos[0].status, 'failed');
    assert.strictEqual(w.refunds.length, 1);
    await route.sweep();
    assert.strictEqual(w.refunds.length, 1, 'never twice');
    await create(w, {}, 'q2');
    w.docs.v2.queuedAt = new Date(Date.now() - 31 * 60 * 1000);
    const r = await route.sweep();
    assert.strictEqual(r.closed, 1);
    assert.strictEqual(w.refunds.length, 2);
    // A fresh queued video is left alone and is shown as being made.
    await create(w, {}, 'q3');
    const one = resp();
    await handler('/:id', 'get')({ user: { userId: 'q3' }, params: { id: 'v3' } }, one);
    assert.deepStrictEqual({ s: one.body.video.status, q: one.body.video.queued }, { s: 'processing', q: true });
  } finally { w.restore(); }
});

// ---- SIGTERM ----
test('SIGTERM hands a running video back (attempt not counted); another consumer resumes it', async () => {
  const w = world(); w.clock = clockAt();
  try {
    await create(w, parts3, 'sig1');
    w.hang = (x) => /Two\./.test(x.prompt) && !w.hungOnce && (w.hungOnce = true);
    const a = consumer(w, 'A'); await a._drain(); await settle();
    const r = await a.shutdown({ graceMs: 0 });
    assert.deepStrictEqual({ released: r.released, failed: r.failed }, { released: 1, failed: 0 });
    assert.deepStrictEqual({ s: w.docs.v1.status, a: w.docs.v1.attempts, rel: w.docs.v1.releases, wid: w.docs.v1.workerId }, { s: 'queued', a: 0, rel: 1, wid: null });
    assert.strictEqual(await a._drain(), 0, 'a stopping consumer claims nothing');
    const b = consumer(w, 'B'); await b._drain(); await settle(80);
    assert.strictEqual(w.docs.v1.status, 'completed');
    assert.strictEqual(genFor(w, 'One.'), 1);
    assert.strictEqual(w.refunds.length, 0);
    w.release(); await settle();
    assert.strictEqual(w.docs.v1.status, 'completed');
  } finally { w.restore(); }
});

test('a consumer that was never started skips the shutdown', async () => {
  const c = new StudioVideoConsumer({ model: {}, settings: SETTINGS });
  assert.deepStrictEqual(await c.shutdown({ graceMs: 0 }), { skipped: true });
});

// ---- rolling deploy ----
test('rolling deploy: in-process rows are never claimed or lease-swept; the old stale ceiling closes a consumer row once and its late result is discarded', async () => {
  const w = world(); w.clock = clockAt();
  try {
    // An in-process (old path) row: processing, no worker id.
    await StudioVideo.create({ user: 'old1', quarks: COST1, clips: 1, startedAt: new Date() });
    w.spends.push({ ok: true, amount: COST1, meta: { ref: 'v1' } });
    const a = consumer(w, 'A');
    w.clock.t += 1e7;
    assert.deepStrictEqual(await a.sweepLeases(), { requeued: 0, failed: 0 });
    assert.strictEqual(await a._drain(), 0);
    // A consumer row hit by the stale ceiling (old or new server's studio sweep) while its provider call hangs.
    await create(w, {}, 'old2');
    w.hang = () => true;
    await a._drain(); await settle();
    w.docs.v2.startedAt = new Date(Date.now() - 16 * 60 * 1000);
    w.docs.v1.startedAt = new Date(Date.now() - 16 * 60 * 1000);
    await quiet(() => route.sweep());
    assert.strictEqual(w.docs.v2.status, 'failed');
    assert.strictEqual(w.docs.v1.status, 'failed');
    const refunds = w.refunds.length;
    assert.strictEqual(refunds, 2);
    w.release(); await settle(40);
    assert.strictEqual(w.docs.v2.status, 'failed', 'the late result does not reopen the video');
    assert.strictEqual(w.refunds.length, refunds, 'no second refund');
  } finally { w.restore(); }
});

// ---- change ----
test('a change runs on the consumer path too, charged once', async () => {
  const w = world(); w.clock = clockAt();
  try {
    await StudioVideo.create({ user: 'ch1', status: 'completed', videoUrl: 'https://cdn.test/base.mp4', clips: 1, seconds: 10, quarks: COST1 });
    process.env.ENABLE_STUDIO_VIDEO_CONSUMER = 'on';
    const safeFetch = require('../services/safeFetch');
    const orig = safeFetch.safeFetchBuffer;
    safeFetch.safeFetchBuffer = async () => ({ buffer: Buffer.from('base') });
    try {
      const res = resp();
      await handler('/:id/change', 'post')({ user: { userId: 'ch1' }, params: { id: 'v1' }, body: { instruction: 'make it evening' } }, res);
      assert.strictEqual(res.code, 202);
      assert.strictEqual(w.docs.v2.status, 'queued');
      assert.strictEqual(w.docs.v2.work.kind, 'change');
      const a = consumer(w, 'A'); await a._drain(); await settle(60);
      assert.strictEqual(w.docs.v2.status, 'completed');
      assert.deepStrictEqual(w.gen, ['change:make it evening']);
      assert.strictEqual(w.spends.length, 1);
    } finally { safeFetch.safeFetchBuffer = orig; }
  } finally { w.restore(); }
});

// ---- metrics ----
test('metrics: queue depth, running, oldest wait, running per worker and this worker\'s slots and counters', async () => {
  const w = world(); w.clock = clockAt(Date.now());
  try {
    await create(w, {}, 'm1'); await create(w, {}, 'm2'); await create(w, {}, 'm3');
    w.docs.v3.queuedAt = new Date(w.clock.t - 90 * 1000);
    w.hang = (x) => !w.hungOnce && (w.hungOnce = true);
    const a = consumer(w, 'A', { slots: { omni: 1 } }); await a._drain(); await settle();
    const m = await a.metrics();
    assert.strictEqual(m.queueDepth, 2);
    assert.strictEqual(m.running, 1);
    assert.ok(m.oldestQueuedAgeSeconds >= 89, String(m.oldestQueuedAgeSeconds));
    assert.deepStrictEqual(m.runningByWorker, { 'w:A': 1 });
    assert.deepStrictEqual(m.thisWorker.slots, { omni: 1, cpu: 1 });
    assert.deepStrictEqual(m.thisWorker.slotsInUse, { omni: 1, finishing: 0 });
    assert.strictEqual(m.thisWorker.claims, 1);
    for (const k of ['leaseRequeues', 'leaseFailures', 'released', 'lostRuns', 'capHandBacks']) assert.strictEqual(typeof m.thisWorker[k], 'number', k);
    w.release(); await settle(60);
  } finally { w.restore(); }
});

test('GET /api/metrics/queue includes the Videos consumer', async () => {
  const metrics = require('../routes/metrics');
  const orig = { ...metrics.queues };
  metrics.queues.video = () => ({ metrics: async () => ({ queueDepth: 0 }) });
  metrics.queues.image = () => ({ metrics: async () => ({ queueDepth: 0 }) });
  metrics.queues.studio = () => ({ metrics: async () => ({ queueDepth: 3, running: 1 }) });
  try {
    const layer = metrics.stack.find((l) => l.route && l.route.path === '/queue');
    const res = resp(); res.set = () => res;
    await layer.route.stack.slice(-1)[0].handle({}, res);
    assert.deepStrictEqual(res.body.studioVideos, { queueDepth: 3, running: 1 });
    assert.ok(res.body.videoJobs && res.body.imageJobs);
  } finally { Object.assign(metrics.queues, orig); }
});

test('the CloudWatch data has a Queue=omni dimension for the Videos consumer', () => {
  const { toMetricData } = require('../services/queueMetricsEmitter');
  const data = toMetricData({ studio: { queueDepth: 4, oldestQueuedAgeSeconds: 12, running: 2, thisWorker: { slots: { omni: 2 }, slotsInUse: { omni: 1 } } } });
  const omni = data.filter((d) => d.Dimensions[0].Value === 'omni').map((d) => [d.MetricName, d.Value]);
  assert.deepStrictEqual(omni, [['QueueDepth', 4], ['OldestQueuedAge', 12], ['Running', 2], ['SlotsInUse', 1], ['SlotsTotal', 2]]);
});

test('the consumer starts only with the switch on AND job consumers on', () => {
  const { startStudioVideoConsumer } = require('../services/studioVideoConsumer');
  assert.strictEqual(startStudioVideoConsumer({ env: { RUN_BACKGROUND: '1' } }), null, 'switch off');
  assert.strictEqual(startStudioVideoConsumer({ env: { ENABLE_STUDIO_VIDEO_CONSUMER: 'on', RUN_BACKGROUND: '0' } }), null, 'web task without consumers');
  assert.strictEqual(startStudioVideoConsumer({ env: { ENABLE_STUDIO_VIDEO_CONSUMER: 'on', RUN_BACKGROUND: '1', RUN_JOB_CONSUMERS: '0' } }), null, 'consumers off');
});

// ---- money review of B1: lost reply after the queue flip (finding 1) ----
// The flip to 'queued' lands in Mongo but the call throws (a lost reply). `claimFirst` also lets a worker take the row before the throw.
function flipLandsThenThrows(w, { claimFirst = false } = {}) {
  const fou = StudioVideo.findOneAndUpdate;
  StudioVideo.findOneAndUpdate = (q, u, o) => {
    if (u.$set && u.$set.status === 'queued' && q.workerId === null) {
      const d = Object.values(w.docs).find((x) => matches(x, q));
      apply(d, u);
      if (claimFirst) Object.assign(d, { status: 'processing', workerId: 'w:B', attempts: 1, leaseUntil: new Date(w.clock.t + 60000) });
      return { lean: () => q, then: (a, b) => Promise.reject(new Error('network')).then(a, b) };
    }
    return fou(q, u, o);
  };
  return () => { StudioVideo.findOneAndUpdate = fou; };
}

test('lost reply after the queue flip, nobody claimed yet: the user gets 202 (not 500), the row stays queued, charged once, no refund', async () => {
  const w = world(); w.clock = clockAt();
  const undo = flipLandsThenThrows(w);
  try {
    const r = await quiet(() => create(w, {}));
    undo();
    assert.strictEqual(r.code, 202);
    assert.strictEqual(r.body.video.status, 'processing');
    assert.strictEqual(r.body.video.queued, true);
    assert.strictEqual(w.docs.v1.status, 'queued');
    assert.strictEqual(w.refunds.length, 0);
    assert.strictEqual(w.spends.filter((s) => s.ok).length, 1);
    await consumer(w, 'A')._drain(); await settle(60);
    assert.strictEqual(w.docs.v1.status, 'completed', 'a consumer still delivers it');
    assert.strictEqual(w.spends.filter((s) => s.ok).length, 1, 'no second charge');
  } finally { undo(); w.restore(); }
});

test('lost reply after the queue flip, a worker claimed it first: 202, the LIVE claim is not failed, no refund, the run delivers', async () => {
  const w = world(); w.clock = clockAt();
  const undo = flipLandsThenThrows(w, { claimFirst: true });
  try {
    const r = await quiet(() => create(w, {}));
    undo();
    assert.strictEqual(r.code, 202);
    assert.strictEqual(w.docs.v1.status, 'processing');
    assert.strictEqual(w.docs.v1.workerId, 'w:B');
    assert.strictEqual(w.refunds.length, 0);
  } finally { undo(); w.restore(); }
});

test('the change route answers a lost queue reply the same way (202, queued, no refund)', async () => {
  const w = world(); w.clock = clockAt();
  try {
    await StudioVideo.create({ user: 'chx', status: 'completed', videoUrl: 'https://cdn.test/base.mp4', clips: 1, seconds: 10, quarks: COST1 });
    process.env.ENABLE_STUDIO_VIDEO_CONSUMER = 'on';
    const undo = flipLandsThenThrows(w);
    try {
      const res = resp();
      await quiet(() => handler('/:id/change', 'post')({ user: { userId: 'chx' }, params: { id: 'v1' }, body: { instruction: 'make it evening' } }, res));
      assert.strictEqual(res.code, 202);
      assert.strictEqual(w.docs.v2.status, 'queued');
      assert.strictEqual(w.refunds.length, 0);
    } finally { undo(); }
  } finally { w.restore(); }
});

test('settleUnstarted never fails a row a worker already holds (filter workerId null)', async () => {
  const w = world(); w.clock = clockAt();
  try {
    await StudioVideo.create({ user: 'su1', quarks: COST1, clips: 1, workerId: 'w:B', attempts: 1 });
    w.spends.push({ ok: true, amount: COST1, meta: { ref: 'v1' } });
    await route._money.settleUnstarted(w.docs.v1);
    assert.strictEqual(w.docs.v1.status, 'processing');
    assert.strictEqual(w.refunds.length, 0);
    // An unclaimed processing row (the flip never landed) is still failed and refunded.
    await StudioVideo.create({ user: 'su2', quarks: COST1, clips: 1 });
    w.spends.push({ ok: true, amount: COST1, meta: { ref: 'v2' } });
    await route._money.settleUnstarted(w.docs.v2);
    assert.strictEqual(w.docs.v2.status, 'failed');
    assert.strictEqual(w.refunds.length, 1);
  } finally { w.restore(); }
});

// ---- money review of B1: stale closes close only the claim they read (finding 2) ----
// Reads the stale row, then (before the close writes) a consumer re-claims it: the close must match nothing.
async function staleThenReclaimed(w, runIt) {
  await create(w, {}, 'sc1');
  const a = consumer(w, 'A'); w.hang = () => true; await a._drain(); await settle();
  w.docs.v1.startedAt = new Date(Date.now() - 16 * 60 * 1000);
  const find = StudioVideo.find;
  StudioVideo.find = (q) => {
    const rows = find(q);
    const hooked = { sort: () => hooked, limit: () => hooked, lean: () => hooked, select: () => hooked, then: (x, y) => rows.then((r) => {
      // the re-claim lands right after the read: another worker, attempt 2, fresh start
      if (w.docs.v1.status === 'processing') Object.assign(w.docs.v1, { workerId: 'w:B', attempts: 2, startedAt: new Date() });
      return r;
    }).then(x, y) };
    return hooked;
  };
  try { await quiet(() => runIt()); } finally { StudioVideo.find = find; }
}

test('studio sweep: a re-claim between the read and the close is not failed', async () => {
  const w = world(); w.clock = clockAt();
  try {
    await staleThenReclaimed(w, () => route.sweep());
    assert.strictEqual(w.docs.v1.status, 'processing');
    assert.strictEqual(w.docs.v1.workerId, 'w:B');
    assert.strictEqual(w.refunds.length, 0);
  } finally { w.restore(); }
});

test('GET / (list): a re-claim between the read and the close is not failed', async () => {
  const w = world(); w.clock = clockAt();
  try {
    await staleThenReclaimed(w, async () => { await handler('/', 'get')({ user: { userId: 'sc1' } }, resp()); });
    assert.strictEqual(w.docs.v1.status, 'processing');
    assert.strictEqual(w.refunds.length, 0);
  } finally { w.restore(); }
});

test('GET /:id: a re-claim between the read and the close is not failed', async () => {
  const w = world(); w.clock = clockAt();
  try {
    await create(w, {}, 'sc2');
    const a = consumer(w, 'A'); w.hang = () => true; await a._drain(); await settle();
    w.docs.v1.startedAt = new Date(Date.now() - 16 * 60 * 1000);
    const findOne = StudioVideo.findOne;
    StudioVideo.findOne = (q) => {
      const rows = findOne(q);
      return { then: (x, y) => rows.then((r) => { Object.assign(w.docs.v1, { workerId: 'w:B', attempts: 2, startedAt: new Date() }); return r; }).then(x, y) };
    };
    try { await quiet(() => handler('/:id', 'get')({ user: { userId: 'sc2' }, params: { id: 'v1' } }, resp())); } finally { StudioVideo.findOne = findOne; }
    assert.strictEqual(w.docs.v1.status, 'processing');
    assert.strictEqual(w.refunds.length, 0);
  } finally { w.restore(); }
});

test('a stale in-process row (no worker, attempts 0 or missing) is still closed and refunded once', async () => {
  const w = world(); w.clock = clockAt();
  try {
    await StudioVideo.create({ user: 'old', quarks: COST1, clips: 1, startedAt: new Date(Date.now() - 16 * 60 * 1000) });
    w.spends.push({ ok: true, amount: COST1, meta: { ref: 'v1' } });
    delete w.docs.v1.attempts; // a row written before the field existed
    await quiet(() => route.sweep());
    assert.strictEqual(w.docs.v1.status, 'failed');
    assert.strictEqual(w.refunds.length, 1);
  } finally { w.restore(); }
});

// ---- money review of B1: a claim that resolves after SIGTERM (finding 3) ----
test('a claim in flight when shutdown() runs is handed back (attempt not counted) and the video is not started', async () => {
  const w = world(); w.clock = clockAt();
  try {
    await create(w, {}, 'sd1');
    const a = consumer(w, 'A');
    let open; const gate = new Promise((r) => { open = r; });
    const fou = StudioVideo.findOneAndUpdate;
    StudioVideo.findOneAndUpdate = (q, u, o) => {
      if (!(u.$set && u.$set.status === 'processing' && u.$set.workerId)) return fou(q, u, o);
      const held = { lean: () => held, then: (x, y) => gate.then(() => fou(q, u, o)).then(x, y) };
      return held;
    };
    const draining = a._drain();
    await settle(10);
    const r = await a.shutdown({ graceMs: 0 });
    assert.strictEqual(r.finished, true, 'nothing running yet: shutdown does not wait for the claim');
    open(); await draining; await settle(40);
    StudioVideo.findOneAndUpdate = fou;
    assert.deepStrictEqual({ s: w.docs.v1.status, a: w.docs.v1.attempts, wid: w.docs.v1.workerId }, { s: 'queued', a: 0, wid: null });
    assert.strictEqual(w.gen.length, 0, 'the video was not started');
    assert.strictEqual(a.running.size, 0);
    assert.strictEqual(w.refunds.length, 0);
    // Another consumer takes it normally.
    await consumer(w, 'B')._drain(); await settle(60);
    assert.strictEqual(w.docs.v1.status, 'completed');
    assert.strictEqual(w.gen.length, 1);
  } finally { w.restore(); }
});

// ---- missing tests the money review listed: hand-back paths ----
test('_overCap: over the per-account cap after a claim, the row goes back to queued with the attempt not counted; at the cap it stays', async () => {
  const w = world(); w.clock = clockAt();
  try {
    await create(w, { concept: 'one' }, 'oc1'); await create(w, { concept: 'two' }, 'oc1');
    const b = consumer(w, 'B', { perUserRunning: 1 });
    await b._claim('v1'); // another worker already runs one of this account's videos
    const a = consumer(w, 'A', { perUserRunning: 1 });
    const claimed = await a._claim('v2');
    assert.strictEqual(w.docs.v2.status, 'processing');
    assert.strictEqual(await a._overCap(claimed), true);
    assert.deepStrictEqual({ s: w.docs.v2.status, a: w.docs.v2.attempts, wid: w.docs.v2.workerId }, { s: 'queued', a: 0, wid: null });
    assert.strictEqual(a.stats.capHandBacks, 1);
    const roomy = consumer(w, 'C', { perUserRunning: 2 });
    const again = await roomy._claim('v2');
    assert.strictEqual(await roomy._overCap(again), false);
    assert.strictEqual(w.docs.v2.status, 'processing');
    // A claim that is no longer ours is not touched by the hand-back.
    Object.assign(w.docs.v2, { workerId: 'w:Z', attempts: 5 });
    assert.strictEqual(await a._handBack(again), false);
    assert.strictEqual(w.docs.v2.workerId, 'w:Z');
  } finally { w.restore(); }
});

test('MAX_RELEASES: a video handed back at SIGTERM three times is failed and fully refunded once on the next shutdown', async () => {
  const w = world(); w.clock = clockAt();
  try {
    await create(w, parts3, 'mr1');
    w.hang = (x) => /Two\./.test(x.prompt) && !w.hungOnce && (w.hungOnce = true);
    const a = consumer(w, 'A'); await a._drain(); await settle();
    assert.strictEqual(w.docs.v1.clipUrls.length, 1);
    w.docs.v1.releases = 3; // three hand-backs already
    const r = await a.shutdown({ graceMs: 0 });
    assert.deepStrictEqual({ released: r.released, failed: r.failed }, { released: 0, failed: 1 });
    assert.strictEqual(w.docs.v1.status, 'failed');
    assert.strictEqual(w.refunds.length, 1);
    assert.strictEqual(w.refunds[0].amount, 3 * COST1);
    assert.ok(w.discarded.some((u) => /clip/.test(u)), 'the stored clips were deleted');
    assert.strictEqual(a.stats.shutdownFailed, 1);
    w.release(); await settle();
    assert.strictEqual(w.refunds.length, 1, 'never twice');
  } finally { w.restore(); }
});

// ---- money review of B1: orphan clip files (finding 4) ----
const CLIP = (n) => `https://cdn.test/clip/${n}`;

test('the studio sweep, GET / and GET /:id delete the stored clips of a video they close as stale', async () => {
  const w = world(); w.clock = clockAt();
  try {
    for (const [u, via] of [['oc1', 'sweep'], ['oc2', 'list'], ['oc3', 'one']]) {
      await create(w, {}, u);
      const id = Object.keys(w.docs).pop();
      Object.assign(w.docs[id], { status: 'processing', workerId: 'w:A', attempts: 1, startedAt: new Date(Date.now() - 16 * 60 * 1000), clipUrls: [CLIP(`${via}1`), CLIP(`${via}2`)] });
      if (via === 'sweep') await quiet(() => route.sweep());
      if (via === 'list') await quiet(() => handler('/', 'get')({ user: { userId: u } }, resp()));
      if (via === 'one') await quiet(() => handler('/:id', 'get')({ user: { userId: u }, params: { id } }, resp()));
      assert.strictEqual(w.docs[id].status, 'failed', via);
      assert.deepStrictEqual(w.discarded.filter((x) => x.includes(`${via}`)), [CLIP(`${via}1`), CLIP(`${via}2`)], via);
    }
    assert.strictEqual(w.refunds.length, 3);
  } finally { w.restore(); }
});

test('the 30-minute queued close of a re-queued row that already has clips deletes those clips', async () => {
  const w = world(); w.clock = clockAt();
  try {
    await create(w, parts3, 'qc1');
    Object.assign(w.docs.v1, { clipUrls: [CLIP('q1')], queuedAt: new Date(Date.now() - 31 * 60 * 1000) });
    await route.sweep();
    assert.strictEqual(w.docs.v1.status, 'failed');
    assert.deepStrictEqual(w.discarded, [CLIP('q1')]);
    assert.strictEqual(w.refunds.length, 1);
  } finally { w.restore(); }
});

test('a resume that stops at an unreadable stored clip deletes the stored links beyond the resumed prefix (chain)', async () => {
  const w = world(); w.clock = clockAt();
  try {
    await create(w, parts3, 'rc1');
    w.stored.set(CLIP('a1'), Buffer.from('clip:A1')); // readable
    w.stored.set(CLIP('a3'), Buffer.from('clip:A3')); // readable, but after the unreadable one
    w.docs.v1.clipUrls = [CLIP('a1'), CLIP('a2-missing'), CLIP('a3')];
    await consumer(w, 'A')._drain(); await settle(80);
    assert.strictEqual(w.docs.v1.status, 'completed');
    assert.strictEqual(genFor(w, 'One.'), 0, 'clip 1 resumed');
    assert.strictEqual(genFor(w, 'Two.'), 1);
    assert.strictEqual(genFor(w, 'Three.'), 1);
    assert.ok(w.discarded.includes(CLIP('a2-missing')) && w.discarded.includes(CLIP('a3')));
    assert.ok(!w.discarded.slice(0, 2).includes(CLIP('a1')), 'the resumed prefix is kept until the video completes');
  } finally { w.restore(); }
});

test('a single-clip resume with an unreadable stored clip makes the clip again and deletes the dead link', async () => {
  const w = world(); w.clock = clockAt();
  try {
    await create(w, {}, 'rc2');
    w.docs.v1.clipUrls = [CLIP('gone')];
    await consumer(w, 'A')._drain(); await settle(60);
    assert.strictEqual(w.docs.v1.status, 'completed');
    assert.strictEqual(w.gen.length, 1);
    assert.ok(w.discarded.includes(CLIP('gone')));
  } finally { w.restore(); }
});

test('account deletion finds the stored clip files (the cleanup matches the nebula-studio-clips folder)', () => {
  const { extractAssets } = require('../services/cloudinaryCleanup');
  const row = JSON.stringify({ clipUrls: ['https://res.cloudinary.com/demo/video/upload/v17/nebula-studio-clips/abc123.mp4'], videoUrl: 'https://res.cloudinary.com/demo/video/upload/v18/nebula-studio-videos/fin.mp4' });
  assert.deepStrictEqual(extractAssets(row).map((a) => a.publicId).sort(), ['nebula-studio-clips/abc123', 'nebula-studio-videos/fin']);
});

// ---- missing tests the review listed: keepClip ----
test('a failed storeClip leaves a prefix gap: later clips are not stored, the video still completes, nothing is made twice', async () => {
  const w = world(); w.clock = clockAt();
  try {
    await create(w, parts3, 'sk1');
    const real = route._io.storeClip; let calls = 0;
    route._io.storeClip = async (b) => { calls += 1; if (calls === 2) throw new Error('upload down'); return real(b); };
    await quiet(async () => { await consumer(w, 'A')._drain(); await settle(80); });
    assert.strictEqual(w.docs.v1.status, 'completed');
    assert.strictEqual(w.docs.v1.clipsDone, 3);
    assert.strictEqual(calls, 2, 'clip 3 was not uploaded after the gap');
    assert.strictEqual(genFor(w, 'One.') + genFor(w, 'Two.') + genFor(w, 'Three.'), 3);
    assert.strictEqual(w.refunds.length, 0);
    assert.strictEqual(w.discarded.length, 1, 'the one stored clip is deleted on completion');
  } finally { w.restore(); }
});

test('keepClip where the write lands but the call throws: the clip stays recorded and its file is not deleted', async () => {
  const w = world(); w.clock = clockAt();
  try {
    await create(w, parts3, 'kl1');
    const uo = StudioVideo.updateOne; let thrown = false;
    StudioVideo.updateOne = async (q, u) => {
      const r = await uo(q, u);
      if (!thrown && u.$set && u.$set.clipUrls && u.$set.clipUrls.length === 1) { thrown = true; throw new Error('lost reply'); }
      return r;
    };
    w.hang = (x) => /Two\./.test(x.prompt) && !w.hungOnce && (w.hungOnce = true);
    const a = consumer(w, 'A');
    await quiet(async () => { await a._drain(); await settle(60); });
    StudioVideo.updateOne = uo;
    assert.strictEqual(thrown, true);
    assert.strictEqual(w.docs.v1.clipUrls.length, 1);
    assert.strictEqual(w.docs.v1.clipsDone, 1);
    assert.ok(w.stored.has(w.docs.v1.clipUrls[0]));
    assert.deepStrictEqual(w.discarded, [], 'the recorded clip was not deleted');
    // A resume uses it: clip 1 is not made again.
    w.clock.t += 81000;
    const b = consumer(w, 'B'); await b.sweepLeases(); await b._drain(); await settle(80);
    assert.strictEqual(w.docs.v1.status, 'completed');
    assert.strictEqual(genFor(w, 'One.'), 1);
  } finally { w.restore(); }
});

test('keepClip where the write did NOT land and the call threw: the upload is deleted', async () => {
  const w = world(); w.clock = clockAt();
  try {
    await create(w, parts3, 'kl2');
    const uo = StudioVideo.updateOne; let thrown = false;
    StudioVideo.updateOne = async (q, u) => {
      if (!thrown && u.$set && u.$set.clipUrls && u.$set.clipUrls.length === 1) { thrown = true; throw new Error('write failed'); }
      return uo(q, u);
    };
    await quiet(async () => { await consumer(w, 'A')._drain(); await settle(80); });
    StudioVideo.updateOne = uo;
    assert.strictEqual(w.docs.v1.status, 'completed');
    assert.ok(w.discarded.length >= 1);
    assert.strictEqual(w.refunds.length, 0);
  } finally { w.restore(); }
});
