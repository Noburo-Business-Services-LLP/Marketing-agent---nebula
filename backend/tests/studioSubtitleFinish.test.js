const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const fin = require('../services/studioVideoFinish');
const { createSpendGuard } = require('../services/spendGuard');

const EN = 'Order today and get free delivery to your home on everything above one thousand rupees.';
const TA = 'இன்றே ஆர்டர் செய்யுங்கள். ஆயிரம் ரூபாய்க்கு மேல் வீட்டிலேயே இலவச டெலிவரி.';
const seg = (start, end, text) => ({ start, end, text });

function rig(over = {}) {
  const events = []; const ffm = [];
  const io = {
    probe: async () => ({ width: 720, height: 1280, videoDurationSeconds: 10, durationSeconds: 10, hasAudio: true }),
    fetchLogo: async () => Buffer.from('png'),
    ffmpeg: async (args) => { ffm.push(args); fs.writeFileSync(args[args.length - 1], 'finished'); },
    extractAudio: async (src, out) => { events.push('extract'); fs.writeFileSync(out, 'audio'); },
    spend: {
      check: async (a) => { events.push(`check:${a}`); return { ok: true }; },
      record: async (a, u) => { events.push(`record:${a}:${u}`); return { totalUsd: 1 }; }
    },
    transcribe: async (file, lang) => { events.push(`transcribe:${lang}`); return { segments: [seg(2.1, 8.5, EN)], words: [] }; },
    ...over
  };
  return { io, events, ffm };
}
const job = (o = {}) => ({ buffer: Buffer.from('video'), features: { subtitles: true, logo: false, endLine: '' }, parts: [{ spokenLine: EN }], language: 'english', logoUrl: '', ...o });
const TIMING = 'We could not time the subtitles, so this video has none.';
const MISMATCH = 'The spoken words did not match the line, so this video has no subtitles.';

test('the notices are the plain agreed words', () => {
  assert.strictEqual(fin.NOTICE.timing, TIMING);
  assert.strictEqual(fin.NOTICE.mismatch, MISMATCH);
});

test('subtitles use the real speech window: the cues in the ffmpeg graph start and end inside it, and the order is check, spend row, then the paid call', async () => {
  const { io, events, ffm } = rig();
  const r = await fin.finishVideo(job({ language: 'english' }), io);
  assert.deepStrictEqual(events, ['check:studio_transcription', 'extract', 'record:studio_transcription:2', 'transcribe:en']);
  assert.deepStrictEqual(r.applied, ['subtitles']);
  assert.strictEqual(r.notice, '');
  const graph = ffm[0][ffm[0].indexOf('-filter_complex') + 1];
  const times = [...graph.matchAll(/between\(t,([\d.]+),([\d.]+)\)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.ok(times.length >= 2);
  assert.ok(times[0][0] >= 2.1 - 0.011 && times[times.length - 1][1] <= 8.5 + 0.011, JSON.stringify(times));
  assert.ok(times.every(([a, b]) => a >= 2.09 && b <= 8.51 && b > a));
});

test('the language is passed to the transcription as a code, and the transcription is called exactly once even if the first finishing pass fails', async () => {
  const quiet = console.error; console.error = () => {};
  try {
    let calls = 0; let lang = null; let n = 0;
    const { io, ffm } = rig({
      transcribe: async (f, l) => { calls += 1; lang = l; return { segments: [seg(2, 8, TA)], words: [] }; },
      ffmpeg: async (args) => { n += 1; if (n === 1) throw new Error('filter error'); fs.writeFileSync(args[args.length - 1], 'logo only'); }
    });
    const r = await fin.finishVideo(job({ features: { subtitles: true, logo: true, endLine: '' }, parts: [{ spokenLine: TA }], language: 'tamil', logoUrl: 'x' }), io);
    assert.strictEqual(calls, 1); assert.strictEqual(lang, 'ta'); assert.strictEqual(n, 2);
    assert.deepStrictEqual(r.applied, ['logo']);
    assert.match(r.notice, /could not add the subtitles/);
  } finally { console.error = quiet; }
});

test('two clips: the clip start offsets from the join place each line in its own window', async () => {
  const { io, ffm } = rig({
    probe: async () => ({ width: 720, height: 1280, videoDurationSeconds: 19.7, durationSeconds: 19.7 }),
    transcribe: async () => ({ segments: [seg(2, 7, EN), seg(12, 18, 'Visit us this Sunday for the big festival sale.')], words: [] })
  });
  const r = await fin.finishVideo(job({ parts: [{ spokenLine: EN }, { spokenLine: 'Visit us this Sunday for the big festival sale.' }], join: { starts: [0, 9.7], durations: [10, 10] } }), io);
  assert.deepStrictEqual(r.applied, ['subtitles']);
  const graph = ffm[0][ffm[0].indexOf('-filter_complex') + 1];
  const times = [...graph.matchAll(/between\(t,([\d.]+),([\d.]+)\)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.ok(times.every(([a, b]) => (a >= 1.99 && b <= 7.01) || (a >= 11.99 && b <= 18.01)), JSON.stringify(times));
  assert.ok(times.some(([a]) => a < 9) && times.some(([a]) => a > 11));
});

const failureCases = {
  'record returns nothing (the spend row could not be saved): no paid call is made': { over: { spend: { check: async () => ({ ok: true }), record: async () => null } }, paidCalls: 0 },
  'record throws: no paid call is made': { over: { spend: { check: async () => ({ ok: true }), record: async () => { throw new Error('db down'); } } }, paidCalls: 0 },
  'the staff switch or the daily ceiling refuses': { over: { spend: { check: async () => ({ ok: false, reason: 'switched_off' }), record: async () => ({}) } }, paidCalls: 0 },
  'the spend check itself throws': { over: { spend: { check: async () => { throw new Error('x'); }, record: async () => ({}) } }, paidCalls: 0 },
  'audio cannot be extracted': { over: { extractAudio: async () => { throw new Error('no audio'); } }, paidCalls: 0 },
  'the video cannot be read': { over: { probe: async () => { throw new Error('bad'); } }, paidCalls: 0 },
  'the transcription throws': { over: { transcribe: async () => { throw new Error('HTTP 500'); } }, paidCalls: 1 },
  'the transcription returns nothing': { over: { transcribe: async () => null }, paidCalls: 1 },
  'the transcription finds no speech': { over: { transcribe: async () => ({ segments: [], words: [] }) }, paidCalls: 1 },
  'the transcription never answers (timeout)': { over: { transcribe: () => new Promise(() => {}), transcribeTimeoutMs: 30 }, paidCalls: 1 }
};
for (const [name, c] of Object.entries(failureCases)) {
  test(`failure path, ${name}: the plain notice and the video untouched`, async () => {
    const quiet = [console.error, console.warn, console.log]; console.error = console.warn = console.log = () => {};
    try {
      let paid = 0;
      const base = rig();
      const io = { ...base.io, ...c.over };
      const inner = io.transcribe;
      io.transcribe = (...a) => { paid += 1; return inner(...a); };
      const r = await fin.finishVideo(job(), io);
      assert.strictEqual(paid, c.paidCalls);
      assert.strictEqual(r.buffer.toString(), 'video');
      assert.strictEqual(r.notice, TIMING);
      assert.deepStrictEqual(r.applied, []);
      assert.strictEqual(base.ffm.length, 0);
    } finally { [console.error, console.warn, console.log] = quiet; }
  });
}

test('failure path: with the logo also asked, the logo is still added and the notice is kept', async () => {
  const { io } = rig({ spend: { check: async () => ({ ok: true }), record: async () => null } });
  const r = await fin.finishVideo(job({ features: { subtitles: true, logo: true, endLine: '' }, logoUrl: 'x' }), io);
  assert.strictEqual(r.notice, TIMING);
  assert.deepStrictEqual(r.applied, ['logo']);
});

test('spoken words that do not match the line: no subtitles and the mismatch notice', async () => {
  const { io, ffm } = rig({ transcribe: async () => ({ segments: [seg(1, 8, 'The weather is lovely and the children are playing in the park')], words: [] }) });
  const r = await fin.finishVideo(job(), io);
  assert.strictEqual(r.notice, MISMATCH);
  assert.strictEqual(r.buffer.toString(), 'video');
  assert.strictEqual(ffm.length, 0);
});

test('the guard really refuses when the kill switch (AI_KILLED) or the daily ceiling says so', async () => {
  const sw = (disabled) => ({ find: () => ({ lean: async () => (disabled ? [{ provider: 'studio_transcription', disabled: true }] : []) }) });
  const spendOf = (total) => ({ findOne: () => ({ lean: async () => ({ totalUsd: total }) }), findOneAndUpdate: async () => ({ totalUsd: total, alerted100: true, alerted70: true }) });
  const mk = (env, off, total) => createSpendGuard({ env, cacheMs: 0, Switch: () => sw(off), Spend: () => spendOf(total), alert: async () => {} });
  for (const guard of [mk({}, true, 0), mk({ AI_KILLED: 'studio_transcription' }, false, 0), mk({ AI_DAILY_SPEND_CAP_USD: '5' }, false, 5.01)]) {
    let paid = 0;
    const { io } = rig({ spend: guard, transcribe: async () => { paid += 1; return { segments: [seg(1, 5, EN)] }; } });
    const r = await fin.finishVideo(job(), io);
    assert.strictEqual(paid, 0); assert.strictEqual(r.notice, TIMING); assert.strictEqual(r.buffer.toString(), 'video');
  }
  let paid = 0;
  const { io } = rig({ spend: mk({}, false, 0), transcribe: async () => { paid += 1; return { segments: [seg(1, 5, EN)] }; } });
  assert.strictEqual((await fin.finishVideo(job(), io)).notice, ''); assert.strictEqual(paid, 1);
});

test('no transcription is made when subtitles were not asked for, or when there are no spoken words', async () => {
  let paid = 0;
  const { io } = rig({ transcribe: async () => { paid += 1; return { segments: [] }; } });
  await fin.finishVideo(job({ features: { subtitles: false, logo: true, endLine: 'Thanks' }, logoUrl: 'x' }), io);
  await fin.finishVideo(job({ parts: [{ spokenLine: '' }] }), io);
  assert.strictEqual(paid, 0);
});

test('the units recorded are the video length rounded up to the next 6 seconds', async () => {
  const { io, events } = rig({ probe: async () => ({ width: 720, height: 1280, videoDurationSeconds: 29.6, durationSeconds: 29.6 }), transcribe: async () => ({ segments: [seg(1, 5, EN)] }) });
  await fin.finishVideo(job(), io);
  assert.ok(events.includes('record:studio_transcription:5'));
});

test('logs hold counts and ids only: never the transcript, the intended line or the key', async () => {
  const lines = [];
  const grab = (...a) => lines.push(a.map(String).join(' '));
  const saved = [console.log, console.warn, console.error, console.info, process.env.OPENAI_API_KEY];
  console.log = console.warn = console.error = console.info = grab;
  process.env.OPENAI_API_KEY = 'sk-test-SECRETKEY123';
  try {
    const { io } = rig({ transcribe: async () => ({ segments: [seg(1, 8, 'SECRETWORDS hello there friends')], words: [] }) });
    await fin.finishVideo(job({ parts: [{ spokenLine: 'INTENDEDLINE hello there friends' }] }), io);
    const { io: io2 } = rig({ transcribe: async () => { throw new Error('boom SECRETWORDS sk-test-SECRETKEY123'); } });
    await fin.finishVideo(job(), io2);
  } finally { [console.log, console.warn, console.error, console.info] = saved; if (saved[4] === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = saved[4]; }
  const all = lines.join('\n');
  assert.ok(!/SECRETWORDS|INTENDEDLINE|SECRETKEY|sk-test/.test(all), all);
});
