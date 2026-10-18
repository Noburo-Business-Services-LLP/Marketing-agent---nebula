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

function world({ balance = 1000 } = {}) {
  const w = { docs: {}, spends: [], refunds: [], updates: [], balance, nextId: 0 };
  const orig = {
    create: StudioVideo.create, count: StudioVideo.countDocuments, del: StudioVideo.deleteOne, upd: StudioVideo.updateOne, fou: StudioVideo.findOneAndUpdate, fo: StudioVideo.findOne,
    uf: User.findById, spend: quarkBuckets.spend, settle: quarkBuckets.settleWallet, refund: quarkBuckets.refundTo, guard: spendGuard.check
  };
  StudioVideo.create = async (d) => { const id = `v${++w.nextId}`; w.docs[id] = { _id: id, createdAt: new Date(), startedAt: new Date(), refunded: false, status: 'processing', ...d }; return w.docs[id]; };
  StudioVideo.countDocuments = async () => 0;
  StudioVideo.deleteOne = async ({ _id }) => { delete w.docs[_id]; };
  StudioVideo.updateOne = async (q, u) => { w.updates.push(u.$set); Object.assign(w.docs[q._id] || {}, u.$set); };
  StudioVideo.findOneAndUpdate = async (q, u, o) => {
    const d = w.docs[q._id]; if (!d || (q.refunded === false && d.refunded)) return null;
    const before = { ...d }; Object.assign(d, u.$set); return o && o.new === false ? before : d;
  };
  StudioVideo.findOne = async (q) => { const d = w.docs[q._id]; return d && d.status === (q.status || d.status) ? d : null; };
  User.findById = () => ({ select: () => ({ lean: async () => ({ companyName: 'Sri Lakshmi' }) }) });
  quarkBuckets.settleWallet = async () => null;
  quarkBuckets.spend = async (u, amount, meta) => { w.spends.push({ amount, meta }); if (w.balance < amount) return { success: false }; w.balance -= amount; return { success: true, payerId: 'payer1' }; };
  quarkBuckets.refundTo = async (u, amount, meta) => { w.refunds.push({ amount, meta }); w.balance += amount; return { ok: true }; };
  spendGuard.check = async () => ({ ok: true });
  w.restore = () => {
    Object.assign(StudioVideo, { create: orig.create, countDocuments: orig.count, deleteOne: orig.del, updateOne: orig.upd, findOneAndUpdate: orig.fou, findOne: orig.fo });
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
