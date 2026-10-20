const test = require('node:test');
const assert = require('node:assert');
const sv = require('../services/studioVideo');
const chain = require('../services/studioVideoChain');
const { QUARK_COSTS } = require('../config/apiCosts');

const png = Buffer.from('PNGFRAME');

// ---- styles, languages, voice, platforms ----
test('the four old looks still work as aliases of the nearest new style', () => {
  assert.strictEqual(sv.styleOf('natural'), 'daily-life-vlog');
  assert.strictEqual(sv.styleOf('cinematic'), 'cinematic-commercial');
  assert.strictEqual(sv.styleOf('product'), 'product-advertisement');
  assert.strictEqual(sv.styleOf('festive'), 'festive-campaign');
  assert.strictEqual(sv.styleOf('storytelling'), 'storytelling');
  for (const old of ['natural', 'cinematic', 'product', 'festive']) assert.match(sv.assemblePrompt({ concept: 'x', style: old }), /./);
});

test('there are 22 styles, each with a label, hint, direction and cover image', () => {
  const keys = Object.keys(sv.STYLES);
  assert.strictEqual(keys.length, 22);
  const fs = require('node:fs'); const path = require('node:path');
  for (const k of keys) {
    const s = sv.STYLES[k];
    assert.ok(s.label && s.hint && s.direction.length > 40, k);
    assert.strictEqual(s.image, `/assets/video-styles/${k}.jpg`);
    assert.ok(fs.existsSync(path.join(__dirname, '..', '..', 'frontend', 'public', 'assets', 'video-styles', `${k}.jpg`)), k);
  }
});

test('the planner is asked for the spoken line in the chosen language and script', () => {
  const want = { hindi: 'Devanagari', tamil: 'Tamil script', telugu: 'Telugu script', kannada: 'Kannada script', malayalam: 'Malayalam script' };
  for (const [lang, script] of Object.entries(want)) {
    const q = sv.buildConceptPrompt({ idea: 'Sweets', style: 'storytelling', language: lang, brand: {} });
    assert.match(q, new RegExp(script));
    assert.match(q, /MUST be exactly those words, copied unchanged/);
  }
  assert.doesNotMatch(sv.buildConceptPrompt({ idea: 'x', language: 'english', brand: {} }), /written in \w+ script/);
  assert.match(sv.buildConceptPrompt({ idea: 'x', language: 'none', brand: {} }), /no speech, music only/);
});

test('the planner prompt states the real duration and orientation', () => {
  assert.match(sv.buildConceptPrompt({ idea: 'x', brand: {} }), /10 second vertical 9:16 marketing video/);
  const q = sv.buildConceptPrompt({ idea: 'x', brand: {}, clips: 3, aspectRatio: '16:9' });
  assert.match(q, /30 second horizontal 16:9/);
  assert.match(q, /3 clips of 10 seconds/);
  assert.match(q, /split between the 3 clips/);
  assert.match(q, /"parts": \[ 3 entries/);
});

test('a long concept is parsed into one part per clip, padded when the model returns too few', () => {
  const c = sv.parseConcept('{"title":"T","concept":"C","parts":[{"beats":["a","b"],"spokenLine":"One."},{"beats":["c"],"spokenLine":"Two."}]}', 3);
  assert.strictEqual(c.parts.length, 3);
  assert.deepStrictEqual(c.parts[2], { beats: [], spokenLine: '' });
  assert.deepStrictEqual(c.beats, ['a', 'b']);
  assert.strictEqual(c.spokenLine, 'One. Two.');
  assert.strictEqual(sv.parseConcept('{"concept":"C"}', 1).parts, undefined);
});

test('the voice goes into the prompt only when someone speaks', () => {
  assert.match(sv.assemblePrompt({ concept: 'x', spokenLine: 'Hi', language: 'english', voice: 'male' }), /The voice is a male voice\./);
  assert.match(sv.assemblePrompt({ concept: 'x', spokenLine: 'Hi', language: 'english' }), /The voice is a female voice\./);
  assert.doesNotMatch(sv.assemblePrompt({ concept: 'x', spokenLine: 'Hi', language: 'none', voice: 'male' }), /voice is a/);
  assert.strictEqual(sv.voiceOf('robot'), 'female');
});

test('the continuation sentence leads a later clip prompt and only then', () => {
  assert.ok(sv.assemblePrompt({ concept: 'x', continuation: true }).startsWith('Continue directly from the reference frame of the previous clip: same person, clothes, place, light and mood; the story moves on.'));
  assert.doesNotMatch(sv.assemblePrompt({ concept: 'x' }), /Continue directly/);
});

test('clips are limited to 1..6 and the shape to 9:16 or 16:9', () => {
  assert.deepStrictEqual([0, 1, 3.7, 6, 9, 'x', undefined].map(sv.clipsOf), [1, 1, 3, 6, 6, 1, 1]);
  assert.strictEqual(sv.aspectOf('1:1'), '9:16');
  assert.strictEqual(sv.aspectOf('4:5'), '9:16');
  assert.strictEqual(sv.aspectOf('16:9'), '16:9');
});

test('platforms are validated, de-duplicated and X means twitter', () => {
  assert.deepStrictEqual(sv.platformsOf(['Instagram', 'x', 'twitter', 'tiktok', 'youtube', 'instagram', 5]), ['instagram', 'twitter', 'youtube']);
  assert.deepStrictEqual(sv.platformsOf('instagram'), []);
});

test('shapeFor suggests wide only when every platform is wide-first', () => {
  assert.strictEqual(sv.shapeFor(['youtube']), '16:9');
  assert.strictEqual(sv.shapeFor(['youtube', 'linkedin']), '16:9');
  assert.strictEqual(sv.shapeFor(['youtube', 'instagram']), '9:16');
  assert.strictEqual(sv.shapeFor([]), '9:16');
  assert.strictEqual(sv.shapeFor(['instagram']), '9:16');
  assert.deepStrictEqual(sv.platformShapes(), { instagram: '9:16', facebook: '9:16', linkedin: '16:9', twitter: '9:16', youtube: '16:9' });
});

// ---- the chain ----
const ok = (name) => ({ ok: true, buffer: Buffer.from(name) });
function fakes(script) {
  const calls = [];
  let n = 0;
  return {
    calls,
    io: {
      generate: async (a) => { calls.push(a); const r = script[n] !== undefined ? script[n] : ok(`clip${n + 1}`); n += 1; return typeof r === 'function' ? r(a) : r; },
      lastFrame: async (b) => Buffer.from(`${png}:${b.toString()}`),
      concat: async (bufs) => Buffer.from(bufs.map((b) => b.toString()).join('+'))
    }
  };
}

test('clips are made in order, each continuing from the last frame of the one before with the same references', async () => {
  const f = fakes([]);
  const refs = [{ mimeType: 'image/jpeg', data: 'PERSON' }];
  const out = await chain.makeChain({ prompts: ['p1', 'p2', 'p3'], references: refs, aspectRatio: '9:16' }, f.io);
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.made, 3);
  assert.strictEqual(out.buffer.toString(), 'clip1+clip2+clip3');
  assert.deepStrictEqual(f.calls.map((c) => c.prompt), ['p1', 'p2', 'p3']);
  assert.deepStrictEqual(f.calls[0].references, refs);
  assert.strictEqual(f.calls[1].references.length, 2);
  assert.strictEqual(f.calls[1].references[0].mimeType, 'image/png');
  assert.strictEqual(Buffer.from(f.calls[1].references[0].data, 'base64').toString(), 'PNGFRAME:clip1');
  assert.strictEqual(Buffer.from(f.calls[2].references[0].data, 'base64').toString(), 'PNGFRAME:clip2');
  assert.strictEqual(f.calls[2].references[1], refs[0]);
});

test('a single clip needs no ffmpeg at all', async () => {
  const f = fakes([]);
  delete f.io.lastFrame; delete f.io.concat;
  const out = await chain.makeChain({ prompts: ['p1'] }, f.io);
  assert.strictEqual(out.buffer.toString(), 'clip1');
});

test('a failing clip is tried once more', async () => {
  const f = fakes([ok('clip1'), { ok: false, message: 'busy' }, ok('clip2b')]);
  const out = await chain.makeChain({ prompts: ['p1', 'p2'] }, f.io);
  assert.strictEqual(out.made, 2);
  assert.strictEqual(f.calls.length, 3);
  assert.strictEqual(out.buffer.toString(), 'clip1+clip2b');
});

test('a clip that fails twice ends the chain with the clips already made', async () => {
  const f = fakes([ok('clip1'), { ok: false, message: 'busy' }, { ok: false, message: 'busy again' }]);
  const out = await chain.makeChain({ prompts: ['p1', 'p2', 'p3'] }, f.io);
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.made, 1);
  assert.strictEqual(out.total, 3);
  assert.strictEqual(out.message, 'busy again');
  assert.strictEqual(out.buffer.toString(), 'clip1');
  assert.strictEqual(f.calls.length, 3);
});

test('a refused idea (not retryable) is not retried', async () => {
  const f = fakes([{ ok: false, retryable: false, message: 'policy' }]);
  const out = await chain.makeChain({ prompts: ['p1', 'p2'] }, f.io);
  assert.strictEqual(out.ok, false);
  assert.strictEqual(f.calls.length, 1);
});

test('clip 1 failing twice is a total failure', async () => {
  const f = fakes([{ ok: false, message: 'x' }, { ok: false, message: 'y' }]);
  const out = await chain.makeChain({ prompts: ['p1', 'p2'] }, f.io);
  assert.deepStrictEqual({ ok: out.ok, made: out.made }, { ok: false, made: 0 });
});

test('a missing frame tool stops after the first clip with a plain message', async () => {
  const f = fakes([]);
  f.io.lastFrame = async () => { throw Object.assign(new Error('x'), { code: 'NO_FFMPEG' }); };
  const out = await chain.makeChain({ prompts: ['p1', 'p2'] }, f.io);
  assert.strictEqual(out.made, 1);
  assert.strictEqual(out.message, chain.NO_FFMPEG);
  assert.strictEqual(f.calls.length, 1);
});

test('if the clips cannot be joined, the first one is delivered', async () => {
  const f = fakes([]);
  f.io.concat = async () => { throw new Error('boom'); };
  const out = await chain.makeChain({ prompts: ['p1', 'p2'] }, f.io);
  assert.strictEqual(out.made, 1);
  assert.strictEqual(out.buffer.toString(), 'clip1');
});

test('the join command re-encodes to h264 and aac and keeps audio, at the right size', () => {
  const a = chain.concatArgs(['a.mp4', 'b.mp4'], '16:9', 'o.mp4');
  const graph = a[a.indexOf('-filter_complex') + 1];
  assert.match(graph, /concat=n=2:v=1:a=1/);
  assert.match(graph, /scale=1280:720/);
  assert.ok(a.includes('libx264') && a.includes('aac'));
  assert.match(chain.concatArgs(['a', 'b'], '9:16', 'o')[chain.concatArgs(['a', 'b'], '9:16', 'o').indexOf('-filter_complex') + 1], /scale=720:1280/);
});

// ---- the route: price, charge, refunds, changes ----
const route = require('../routes/studioVideos');
const StudioVideo = require('../models/StudioVideo');
const User = require('../models/User');
const quarkBuckets = require('../services/quarkBuckets');
const spendGuard = require('../services/spendGuard');

const handler = (p, method) => route.stack.find((l) => l.route && l.route.path === p && l.route.methods[method]).route.stack.slice(-1)[0].handle;
const resp = () => { const r = { code: 200, body: null, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } }; return r; };
const quiet = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };
const flush = () => new Promise((r) => setTimeout(r, 30));

// A small Mongo-style matcher for the filters the route uses: equality, $ne, $lt, $in.
const matches = (d, q) => Object.entries(q).every(([k, c]) => {
  const v = d[k];
  if (c === null) return v === null || v === undefined; // Mongo: null also matches a missing field
  if (c && typeof c === 'object' && !(c instanceof Date) && !Array.isArray(c)) {
    if ('$ne' in c && String(v === undefined ? '' : v) === String(c.$ne)) return false;
    if ('$lt' in c && !(v < c.$lt)) return false;
    if ('$in' in c && !c.$in.some((x) => (x === null ? v === null || v === undefined : x === v))) return false;
    return true;
  }
  return String(v) === String(c);
});
const applyUpdate = (d, u) => { Object.assign(d, u.$set || {}); for (const [k, n] of Object.entries(u.$inc || {})) d[k] = (d[k] || 0) + n; };

function world({ balance = 1000 } = {}) {
  const w = { docs: {}, spends: [], refunds: [], updates: [], balance, nextId: 0 };
  const orig = {
    create: StudioVideo.create, count: StudioVideo.countDocuments, del: StudioVideo.deleteOne, upd: StudioVideo.updateOne, fou: StudioVideo.findOneAndUpdate, fo: StudioVideo.findOne,
    uf: User.findById, find: StudioVideo.find, proof: quarkBuckets.chargeProof, spend: quarkBuckets.spend, settle: quarkBuckets.settleWallet, refund: quarkBuckets.refundTo, guard: spendGuard.check
  };
  StudioVideo.create = async (d) => { const id = `v${++w.nextId}`; w.docs[id] = { _id: id, createdAt: new Date(), startedAt: new Date(), refunded: false, status: 'processing', ...d }; return w.docs[id]; };
  StudioVideo.countDocuments = async () => 0;
  StudioVideo.deleteOne = async ({ _id }) => { delete w.docs[_id]; };
  StudioVideo.updateOne = async (q, u) => { const d = w.docs[q._id]; if (!d || !matches(d, q)) return { modifiedCount: 0 }; w.updates.push(u.$set); applyUpdate(d, u); return { modifiedCount: 1 }; };
  StudioVideo.findOneAndUpdate = async (q, u, o) => {
    const d = w.docs[q._id]; if (!d || !matches(d, q)) return null;
    const before = { ...d }; applyUpdate(d, u); return o && o.new === false ? before : d;
  };
  StudioVideo.findOne = async (q) => { const d = w.docs[q._id]; return d && matches(d, q) ? d : null; };
  const chain = (rows) => ({ sort: () => chain(rows), limit: (n) => chain(rows.slice(0, n)), lean: async () => rows, then: (r, j) => Promise.resolve(rows).then(r, j) });
  StudioVideo.find = (q) => chain(Object.values(w.docs).filter((d) => matches(d, q)));
  // The charge proof, read from the fake wallet: a spend with this ref, and whether a refund with it exists.
  quarkBuckets.chargeProof = async (ref) => {
    if (w.proofThrows) throw new Error('db down');
    const sp = w.spends.find((x) => x.ok && x.meta.ref === ref);
    return { spend: sp ? { payer: 'payer1', quarks: sp.amount, source: 'ledger' } : null, refunded: w.refunds.some((x) => x.meta.ref === ref) };
  };
  User.findById = () => ({ select: () => ({ lean: async () => ({ companyName: 'Sri Lakshmi' }) }) });
  quarkBuckets.settleWallet = async () => null;
  quarkBuckets.spend = async (u, amount, meta) => { const rec = { amount, meta, ok: false }; w.spends.push(rec); if (w.spendThrows) throw new Error('db down'); if (w.balance < amount) return { success: false }; w.balance -= amount; rec.ok = true; return { success: true, payerId: 'payer1' }; };
  quarkBuckets.refundTo = async (u, amount, meta) => { if (w.refundFails) { w.refundTries = (w.refundTries || 0) + 1; return { ok: false }; } w.refunds.push({ amount, meta, user: u }); w.balance += amount; return { ok: true }; };
  spendGuard.check = async () => ({ ok: true });
  w.restore = () => {
    Object.assign(StudioVideo, { create: orig.create, countDocuments: orig.count, deleteOne: orig.del, updateOne: orig.upd, findOneAndUpdate: orig.fou, findOne: orig.fo, find: orig.find });
    quarkBuckets.chargeProof = orig.proof;
    User.findById = orig.uf; quarkBuckets.spend = orig.spend; quarkBuckets.settleWallet = orig.settle; quarkBuckets.refundTo = orig.refund; spendGuard.check = orig.guard;
    for (const k of Object.keys(route._io)) delete route._io[k];
  };
  return w;
}

let uid = 0;
const create = async (body) => { const res = resp(); await handler('/create', 'post')({ user: { userId: `u${++uid}` }, body }, res); return res; };
const longBody = (o = {}) => ({ concept: 'A shop owner shows sweets.', clips: 3, language: 'tamil', voice: 'male', platforms: ['youtube', 'x', 'bogus'], parts: [{ beats: ['a'], spokenLine: 'Ondru.' }, { beats: ['b'], spokenLine: 'Irandu.' }, { beats: ['c'], spokenLine: 'Moonru.' }], ...o });

test('the options list 22 styles with images, 7 languages, voices, lengths and platform shapes', async () => {
  const res = resp();
  await handler('/options', 'get')({ user: { userId: 'u0' } }, res);
  const b = res.body;
  assert.strictEqual(b.styles.length, 22);
  assert.deepStrictEqual(Object.keys(b.styles[0]).sort(), ['hint', 'image', 'key', 'label']);
  assert.deepStrictEqual(b.languages.map((l) => l.key), ['english', 'hindi', 'tamil', 'telugu', 'kannada', 'malayalam', 'none']);
  assert.deepStrictEqual(b.voices.map((v) => v.key), ['female', 'male']);
  assert.strictEqual(b.costPerClip, QUARK_COSTS.studio_video);
  assert.strictEqual(b.max, 6);
  assert.deepStrictEqual(b.lengths[2], { clips: 3, seconds: 30, quarks: 3 * QUARK_COSTS.studio_video });
  assert.strictEqual(b.platformShapes.youtube, '16:9');
  assert.deepStrictEqual(b.aspectRatios, ['9:16', '16:9']);
});

test('a 3-clip video costs 3 clips, is checked up front, charged once, and runs the clips in order', async () => {
  const w = world();
  try {
    const gen = []; let stored = null;
    Object.assign(route._io, {
      generate: async (a) => { gen.push(a); return ok(`c${gen.length}`); },
      lastFrame: async (b) => Buffer.from(`F:${b}`), concat: async (bufs) => Buffer.from(bufs.join('+')),
      store: async (buf) => { stored = buf.toString(); return 'https://cdn.example/v.mp4'; }, loadRefs: async () => []
    });
    const res = await create(longBody());
    assert.strictEqual(res.code, 202);
    assert.strictEqual(w.spends.length, 1);
    assert.strictEqual(w.spends[0].amount, 3 * QUARK_COSTS.studio_video);
    const v = res.body.video;
    assert.deepStrictEqual({ clips: v.clips, voice: v.voice, language: v.language, platforms: v.platforms, aspectRatio: v.aspectRatio, seconds: v.seconds }, { clips: 3, voice: 'male', language: 'tamil', platforms: ['youtube', 'twitter'], aspectRatio: '9:16', seconds: 30 });
    await flush();
    assert.strictEqual(gen.length, 3);
    assert.match(gen[0].prompt, /Ondru\./);
    assert.match(gen[0].prompt, /male voice/);
    assert.doesNotMatch(gen[0].prompt, /Continue directly/);
    assert.match(gen[1].prompt, /^Continue directly from the reference frame/);
    assert.match(gen[1].prompt, /Irandu\./);
    assert.match(gen[2].prompt, /Moonru\./);
    assert.strictEqual(stored, 'c1+c2+c3');
    const doc = w.docs.v1;
    assert.deepStrictEqual({ status: doc.status, seconds: doc.seconds, clipsDone: doc.clipsDone, refunds: w.refunds.length }, { status: 'completed', seconds: 30, clipsDone: 3, refunds: 0 });
  } finally { w.restore(); }
});

test('not enough Quarks for the whole video means nothing is made and nothing is kept', async () => {
  const w = world({ balance: 2 * QUARK_COSTS.studio_video });
  try {
    let called = false;
    route._io.generate = async () => { called = true; return ok('x'); };
    const res = await create(longBody());
    assert.strictEqual(res.code, 403);
    assert.strictEqual(res.body.creditsExhausted, true);
    assert.match(res.body.message, /30 second video needs/);
    assert.strictEqual(w.spends.length, 1);
    assert.deepStrictEqual(w.docs, {});
    await flush();
    assert.strictEqual(called, false);
  } finally { w.restore(); }
});

test('clip 2 failing twice delivers 10 seconds and returns the Quarks for the two clips not made, once', async () => {
  const w = world();
  try {
    const gen = [];
    Object.assign(route._io, {
      generate: async (a) => { gen.push(a); return gen.length === 1 ? ok('c1') : { ok: false, message: 'busy' }; },
      lastFrame: async () => png, concat: async () => { throw new Error('not needed'); },
      store: async () => 'https://cdn.example/v.mp4', loadRefs: async () => []
    });
    await create(longBody());
    await quiet(flush);
    assert.strictEqual(gen.length, 3); // clip 1, clip 2, clip 2 again
    const doc = w.docs.v1;
    assert.strictEqual(doc.status, 'completed');
    assert.strictEqual(doc.seconds, 10);
    assert.strictEqual(doc.clipsDone, 1);
    assert.match(doc.notice, /Only 1 of 3 parts could be made, so this video is 10 seconds instead of 30/);
    assert.strictEqual(w.refunds.length, 1);
    assert.strictEqual(w.refunds[0].amount, 2 * QUARK_COSTS.studio_video);
    assert.strictEqual(w.refunds[0].meta.payerId, 'payer1');
    assert.strictEqual(doc.quarks, QUARK_COSTS.studio_video);
    assert.strictEqual(w.balance, 1000 - QUARK_COSTS.studio_video);
  } finally { w.restore(); }
});

test('clip 1 failing returns every Quark and fails the video', async () => {
  const w = world();
  try {
    route._io.generate = async () => ({ ok: false, message: 'busy' });
    Object.assign(route._io, { store: async () => 'x', loadRefs: async () => [] });
    await create(longBody());
    await quiet(flush);
    const doc = w.docs.v1;
    assert.strictEqual(doc.status, 'failed');
    assert.match(doc.error, /Your Quarks were returned/);
    assert.strictEqual(w.refunds.length, 1);
    assert.strictEqual(w.refunds[0].amount, 3 * QUARK_COSTS.studio_video);
    assert.strictEqual(w.balance, 1000);
  } finally { w.restore(); }
});

test('a change to a longer video is refused, a change to a 10-second one is not', async () => {
  const w = world();
  try {
    const mk = (extra) => ({ _id: 'b1', user: 'uC', status: 'completed', videoUrl: 'https://cdn.example/v.mp4', title: 't', concept: 'c', references: [], ...extra });
    w.docs.b1 = mk({ clips: 3, seconds: 30 });
    const realFetch = global.fetch; global.fetch = async () => ({ ok: false });
    // The earlier video is read through the SSRF-safe helper; no real network in tests.
    const sf = require('../services/safeFetch'); const realSafe = sf.safeFetchBuffer;
    sf.safeFetchBuffer = async () => { throw new sf.SafeFetchError('network', 'offline in tests'); };
    const res = resp();
    await handler('/:id/change', 'post')({ user: { userId: 'uC' }, params: { id: 'b1' }, body: { instruction: 'make it brighter' } }, res);
    assert.strictEqual(res.code, 400);
    assert.strictEqual(res.body.message, 'Changes are available for 10-second videos. For a longer video, make a new version.');
    assert.strictEqual(w.spends.length, 0);
    w.docs.b1 = mk({ clips: 1, seconds: 10 });
    const ok1 = resp();
    await handler('/:id/change', 'post')({ user: { userId: 'uC' }, params: { id: 'b1' }, body: { instruction: 'make it brighter' } }, ok1);
    assert.strictEqual(ok1.code, 202);
    assert.strictEqual(w.spends[0].amount, QUARK_COSTS.studio_video);
    await quiet(flush);
    global.fetch = realFetch;
    sf.safeFetchBuffer = realSafe;
  } finally { w.restore(); }
});

test('a single clip is priced, charged and made as before, with voice and platforms stored', async () => {
  const w = world();
  try {
    let prompt = '';
    Object.assign(route._io, { work: async () => ({ ok: true, buffer: Buffer.from('c') }), store: async () => 'https://cdn.example/v.mp4' });
    const res = await create({ concept: 'A shop.', language: 'english', voice: 'female', spokenLine: 'Hello there.', style: 'natural', aspectRatio: '1:1', platforms: ['instagram'] });
    assert.strictEqual(res.code, 202);
    assert.strictEqual(w.spends[0].amount, QUARK_COSTS.studio_video);
    assert.strictEqual(res.body.video.aspectRatio, '9:16');
    assert.strictEqual(res.body.video.clips, 1);
    prompt = w.docs.v1.prompt;
    assert.match(prompt, /female voice/);
    assert.match(prompt, /Hello there\./);
    await flush();
    assert.strictEqual(w.docs.v1.status, 'completed');
  } finally { w.restore(); }
});

// ---- finishing: options, API contract, never failing a video over a finishing problem ----
test('the options list the transitions and say whether the account has a logo', async () => {
  const w = world();
  try {
    route._io.logoUrl = async () => 'https://cdn.example/logo.png';
    const res = resp(); await handler('/options', 'get')({ user: { userId: 'uL' } }, res);
    assert.deepStrictEqual(res.body.transitions, [{ key: 'fade', label: 'Smooth fade' }, { key: 'zoom', label: 'Quick zoom' }, { key: 'cut', label: 'Cut' }]);
    assert.strictEqual(res.body.hasLogo, true);
    route._io.logoUrl = async () => '';
    const res2 = resp(); await handler('/options', 'get')({ user: { userId: 'uL' } }, res2);
    assert.strictEqual(res2.body.hasLogo, false);
  } finally { w.restore(); }
});

test('a 3-clip video is joined with the chosen transition, finished with subtitles, logo and closing line, and keeps its price', async () => {
  const w = world();
  try {
    let joinTr = ''; let finArgs = null;
    Object.assign(route._io, {
      generate: async () => ok('c'), lastFrame: async () => png, loadRefs: async () => [],
      concat: async (b, ar, tr) => { joinTr = tr; return { buffer: Buffer.from('J'), starts: [0, 9.6, 19.2], durations: [10, 10, 10], seconds: 29.2 }; },
      logoUrl: async () => 'https://cdn.example/logo.png',
      finish: async (a) => { finArgs = a; return { buffer: Buffer.from('F'), notice: '', seconds: 29.25 }; },
      store: async (buf) => `https://cdn.example/${buf}.mp4`
    });
    const res = await create(longBody({ transition: 'zoom', subtitles: true, logo: true, endLine: `  Thanks\u0007 ${'y'.repeat(80)}` }));
    assert.strictEqual(res.code, 202);
    assert.strictEqual(w.spends[0].amount, 3 * QUARK_COSTS.studio_video);
    const v = res.body.video;
    assert.deepStrictEqual({ transition: v.transition, subtitles: v.subtitles, logo: v.logo, len: Array.from(v.endLine).length }, { transition: 'zoom', subtitles: true, logo: true, len: 60 });
    await flush();
    assert.strictEqual(joinTr, 'zoom');
    assert.strictEqual(finArgs.logoUrl, 'https://cdn.example/logo.png');
    assert.strictEqual(finArgs.parts.length, 3);
    assert.deepStrictEqual(finArgs.join.starts, [0, 9.6, 19.2]);
    const d = w.docs.v1;
    assert.deepStrictEqual({ status: d.status, url: d.videoUrl, seconds: d.seconds, notice: d.notice }, { status: 'completed', url: 'https://cdn.example/F.mp4', seconds: 29.3, notice: '' });
  } finally { w.restore(); }
});

test('without finishing choices the default is a fade, nothing is finished and the real joined length is stored', async () => {
  const w = world();
  try {
    let fin = false; let joinTr = '';
    Object.assign(route._io, {
      generate: async () => ok('c'), lastFrame: async () => png, loadRefs: async () => [],
      concat: async (b, ar, tr) => { joinTr = tr; return { buffer: Buffer.from('J'), starts: [0, 9.7], durations: [10, 10], seconds: 19.7 }; },
      finish: async () => { fin = true; return { buffer: Buffer.from('F'), notice: '' }; }, store: async () => 'https://cdn.example/v.mp4'
    });
    const res = await create(longBody({ clips: 2 }));
    assert.deepStrictEqual({ t: res.body.video.transition, s: res.body.video.subtitles, l: res.body.video.logo, e: res.body.video.endLine }, { t: 'fade', s: false, l: false, e: '' });
    await flush();
    assert.strictEqual(joinTr, 'fade'); assert.strictEqual(fin, false);
    assert.strictEqual(w.docs.v1.seconds, 19.7);
  } finally { w.restore(); }
});

test('a finishing problem never fails or refunds the video: it is delivered unfinished with a plain notice', async () => {
  const w = world();
  try {
    Object.assign(route._io, {
      generate: async () => ok('c'), lastFrame: async () => png, loadRefs: async () => [],
      concat: async () => Buffer.from('J'), finish: async () => { throw new Error('ffmpeg exploded'); }, store: async (b) => `https://cdn.example/${b}.mp4`
    });
    await quiet(async () => { await create(longBody({ clips: 2, subtitles: true })); await flush(); });
    const d = w.docs.v1;
    assert.strictEqual(d.status, 'completed');
    assert.strictEqual(d.videoUrl, 'https://cdn.example/J.mp4');
    assert.strictEqual(d.notice, 'We could not add the subtitles, so this video has none.');
    assert.strictEqual(w.refunds.length, 0);
  } finally { w.restore(); }
});

test('a single clip is finished too, and subtitles are ignored when there is no spoken language', async () => {
  const w = world();
  try {
    let args = null;
    Object.assign(route._io, {
      work: async () => ({ ok: true, buffer: Buffer.from('c') }), logoUrl: async () => 'https://cdn.example/l.png',
      finish: async (a) => { args = a; return { buffer: Buffer.from('F'), notice: 'We could not find your logo in Brand assets, so this video has none.' }; },
      store: async (b) => `https://cdn.example/${b}.mp4`
    });
    const res = await create({ concept: 'A shop.', language: 'none', subtitles: true, logo: true, endLine: 'Visit us' });
    assert.strictEqual(res.body.video.subtitles, false);
    await flush();
    assert.deepStrictEqual({ s: args.features.subtitles, l: args.features.logo, e: args.features.endLine }, { s: false, l: true, e: 'Visit us' });
    assert.strictEqual(w.docs.v1.videoUrl, 'https://cdn.example/F.mp4');
    assert.match(w.docs.v1.notice, /could not find your logo/);
  } finally { w.restore(); }
});

// ---- money safety: refunds only for proven charges, claim-then-pay, no delivery after a refund ----
const COST1 = QUARK_COSTS.studio_video;
const old = (ms) => new Date(Date.now() - ms);
const seedSpent = (w, id, quarks, extra = {}) => {
  w.spends.push({ amount: quarks, meta: { ref: id }, ok: true });
  w.docs[id] = { _id: id, user: 'uS', status: 'processing', refunded: false, refundState: '', refundTries: 0, quarks, clips: Math.round(quarks / COST1) || 1, startedAt: old(16 * 60 * 1000 * 6), payer: 'payer1', ...extra };
  return w.docs[id];
};
const getVideo = async (id, user = 'uS') => { const res = resp(); await handler('/:id', 'get')({ user: { userId: user }, params: { id } }, res); return res; };

test('spend throwing deletes the record and refunds nothing', async () => {
  const w = world();
  try {
    w.spendThrows = true;
    const res = await quiet(() => create(longBody()));
    assert.strictEqual(res.code, 500);
    assert.deepStrictEqual(w.docs, {});
    assert.strictEqual(w.refunds.length, 0);
  } finally { w.restore(); }
});

test('spend throwing after the debit landed closes the record with a proven refund, once', async () => {
  const w = world();
  try {
    const realSpend = quarkBuckets.spend;
    quarkBuckets.spend = async (...a) => { await realSpend(...a); throw new Error('lost the answer'); };
    const res = await quiet(() => create(longBody()));
    assert.strictEqual(res.code, 500);
    assert.strictEqual(w.docs.v1.status, 'failed');
    assert.strictEqual(w.refunds.length, 1);
    assert.strictEqual(w.refunds[0].amount, 3 * COST1);
    assert.strictEqual(w.balance, 1000);
  } finally { w.restore(); }
});

test('a stale video with no charge proof is closed without any refund', async () => {
  const w = world();
  try {
    w.docs.v9 = { _id: 'v9', user: 'uS', status: 'processing', refunded: false, quarks: 3 * COST1, clips: 3, startedAt: old(3 * 60 * 60 * 1000) };
    const res = await quiet(() => getVideo('v9'));
    assert.strictEqual(res.body.video.status, 'failed');
    assert.match(res.body.video.error, /not charged/);
    assert.strictEqual(w.refunds.length, 0);
    assert.strictEqual(w.balance, 1000);
  } finally { w.restore(); }
});

test('a stale video with proof is refunded once to the payer, never more than the proof', async () => {
  const w = world();
  try {
    seedSpent(w, 'v5', 2 * COST1, { quarks: 6 * COST1, clips: 6 }); // record claims more than was charged
    await quiet(() => getVideo('v5'));
    await quiet(() => getVideo('v5'));
    assert.strictEqual(w.refunds.length, 1);
    assert.strictEqual(w.refunds[0].amount, 2 * COST1);
    assert.strictEqual(w.refunds[0].meta.payerId, 'payer1');
    assert.strictEqual(w.refunds[0].meta.ref, 'v5');
    assert.strictEqual(w.docs.v5.refundState, 'done');
    assert.strictEqual(w.docs.v5.refunded, true);
  } finally { w.restore(); }
});

test('a refund that already exists is not paid again', async () => {
  const w = world();
  try {
    seedSpent(w, 'v6', COST1);
    w.refunds.push({ amount: COST1, meta: { ref: 'v6' } });
    await quiet(() => getVideo('v6'));
    assert.strictEqual(w.refunds.length, 1);
    assert.strictEqual(w.docs.v6.status, 'failed');
  } finally { w.restore(); }
});

test('a failed refund keeps the claim, sets refundFailed and alerts; the sweep pays it once, only after 2 minutes', async () => {
  const w = world();
  const alerts = []; route._io.alert = (t, final) => alerts.push({ t, final });
  try {
    seedSpent(w, 'v7', 2 * COST1);
    w.refundFails = true;
    await quiet(() => getVideo('v7'));
    const d = w.docs.v7;
    assert.deepStrictEqual({ status: d.status, state: d.refundState, failed: d.refundFailed, amount: d.refundAmount, payer: d.refundPayer, refunded: d.refunded }, { status: 'failed', state: 'refunding', failed: true, amount: 2 * COST1, payer: 'payer1', refunded: false });
    assert.strictEqual(alerts.length, 1);
    w.refundFails = false;
    await route.sweep(); // too soon
    assert.strictEqual(w.refunds.length, 0);
    const r = await quiet(() => route.sweep({ now: Date.now() + 3 * 60 * 1000 }));
    assert.strictEqual(r.paid, 1);
    assert.strictEqual(w.refunds.length, 1);
    assert.strictEqual(w.docs.v7.refundState, 'done');
    await route.sweep({ now: Date.now() + 10 * 60 * 1000 });
    assert.strictEqual(w.refunds.length, 1);
  } finally { w.restore(); }
});

test('a crash after the refund was paid but before it was marked is finished by the sweep without paying twice', async () => {
  const w = world();
  try {
    seedSpent(w, 'v8', COST1, { status: 'failed', refundState: 'refunding', refundAmount: COST1, refundPayer: 'payer1', refundStartedAt: old(5 * 60 * 1000) });
    w.refunds.push({ amount: COST1, meta: { ref: 'v8' } });
    const r = await route.sweep();
    assert.strictEqual(r.paid, 1);
    assert.strictEqual(w.refunds.length, 1);
    assert.strictEqual(w.docs.v8.refundState, 'done');
  } finally { w.restore(); }
});

test('the sweep gives up after the retry limit with an alert for a person', async () => {
  const w = world();
  const alerts = []; route._io.alert = (t, final) => alerts.push({ t, final });
  try {
    seedSpent(w, 'v4', COST1, { status: 'failed', refundState: 'refunding', refundAmount: COST1, refundPayer: 'payer1', refundStartedAt: old(5 * 60 * 1000), refundTries: 4 });
    w.refundFails = true;
    await quiet(() => route.sweep());
    assert.ok(alerts.some((a) => a.final && /by hand/.test(a.t)));
    assert.strictEqual(w.docs.v4.refundTries, 5);
    await quiet(() => route.sweep({ now: Date.now() + 60 * 60 * 1000 }));
    assert.strictEqual(w.docs.v4.refundTries, 5); // no more tries
  } finally { w.restore(); }
});

test('a slow job that finishes after it was stopped and refunded does not publish its video', async () => {
  const w = world();
  try {
    const d = seedSpent(w, 'v3', COST1, { startedAt: new Date() });
    let release; const gate = new Promise((r) => { release = r; });
    const discarded = [];
    const job = route.run(d, async () => { await gate; return { ok: true, buffer: Buffer.from('x') }; }, { store: async () => 'https://cdn.example/late.mp4', discard: async (u) => discarded.push(u) });
    await route._money.fail(d, 'The video took too long and was stopped. Your Quarks were returned. Please try again.');
    release(); await job;
    assert.strictEqual(w.docs.v3.status, 'failed');
    assert.strictEqual(w.docs.v3.videoUrl, undefined);
    assert.deepStrictEqual(discarded, ['https://cdn.example/late.mp4']);
    assert.strictEqual(w.refunds.length, 1);
  } finally { w.restore(); }
});

test('the list closes the caller\'s own stale videos (and returns them as failed)', async () => {
  const w = world();
  try {
    seedSpent(w, 'v2', COST1);
    const res = resp();
    await quiet(() => handler('/', 'get')({ user: { userId: 'uS' } }, res));
    assert.strictEqual(res.body.videos.find((v) => v.id === 'v2').status, 'failed');
    assert.strictEqual(w.refunds.length, 1);
  } finally { w.restore(); }
});

test('the sweep closes lost processing videos once and leaves fresh ones alone', async () => {
  const w = world();
  try {
    seedSpent(w, 'a1', COST1);
    seedSpent(w, 'a2', COST1, { startedAt: new Date() });
    const r1 = await quiet(() => route.sweep());
    const r2 = await quiet(() => route.sweep());
    assert.deepStrictEqual([r1.closed, r2.closed], [1, 0]);
    assert.strictEqual(w.refunds.length, 1);
    assert.strictEqual(w.docs.a2.status, 'processing');
  } finally { w.restore(); }
});

test('the spend guard is told one unit per clip', async () => {
  const w = world();
  try {
    Object.assign(route._io, { generate: async () => ok('c'), lastFrame: async () => png, concat: async (b) => Buffer.from(b.join('+')), store: async () => 'https://cdn.example/v.mp4', loadRefs: async () => [] });
    await create(longBody());
    assert.strictEqual(w.spends[0].meta.units, 3);
    await flush();
  } finally { w.restore(); }
});

test('a fail and a finish racing for the same video pay the refund once', async () => {
  const w = world();
  try {
    const d = seedSpent(w, 'r1', 3 * COST1, { clips: 3, startedAt: new Date() });
    await Promise.all([route._money.fail(d, 'stopped'), route._money.finishShort(d, 1, 3, 'https://cdn.example/s.mp4', 10, '', { discard: async () => {} })]);
    assert.strictEqual(w.refunds.length, 1);
    assert.ok(w.refunds[0].amount <= 3 * COST1);
    assert.strictEqual(w.balance, 1000 + w.refunds[0].amount);
  } finally { w.restore(); }
});

test('a short video lowers its cost in the same update as the refund claim', async () => {
  const w = world();
  try {
    const d = seedSpent(w, 'r2', 3 * COST1, { clips: 3, startedAt: new Date() });
    await route._money.finishShort(d, 1, 3, 'https://cdn.example/s.mp4', 10);
    assert.strictEqual(w.docs.r2.quarks, COST1);
    assert.strictEqual(w.refunds[0].amount, 2 * COST1);
    assert.strictEqual(w.docs.r2.status, 'completed');
  } finally { w.restore(); }
});

test('two creates at once for one account: only the free slot is used', async () => {
  const w = world();
  try {
    let n = 0; StudioVideo.countDocuments = async () => { await flush(); return n; };
    const origCreate = StudioVideo.create;
    StudioVideo.create = async (d) => { n += 1; return origCreate(d); };
    Object.assign(route._io, { generate: async () => ok('c'), lastFrame: async () => png, concat: async (b) => Buffer.from('x'), store: async () => 'x', loadRefs: async () => [], work: async () => ({ ok: true, buffer: Buffer.from('x') }) });
    const body = { concept: 'A shop.' };
    const one = (u) => { const res = resp(); return handler('/create', 'post')({ user: { userId: u }, body }, res).then(() => res); };
    n = 1; // one video already being made
    const rs = await Promise.all([one('uR'), one('uR')]);
    assert.deepStrictEqual(rs.map((r) => r.code).sort(), [202, 429]);
    await flush();
  } finally { w.restore(); }
});

test('a failed reference picture is refunded with the ref of its charge, once, and only when charged', async () => {
  const w = world();
  try {
    route._io.image = async () => ({ success: false, error: 'provider down' });
    const res = resp();
    await quiet(() => handler('/reference', 'post')({ user: { userId: 'uQ' }, body: { kind: 'person' } }, res));
    assert.strictEqual(res.code, 502);
    assert.ok(res.body.ref);
    assert.strictEqual(w.spends[0].meta.ref, res.body.ref);
    assert.strictEqual(w.refunds.length, 1);
    assert.strictEqual(w.refunds[0].meta.ref, res.body.ref);
    assert.strictEqual(w.refunds[0].amount, QUARK_COSTS.studio_reference);
  } finally { w.restore(); }
});
