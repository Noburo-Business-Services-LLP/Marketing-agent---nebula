const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const fin = require('../services/studioVideoFinish');
const chain = require('../services/studioVideoChain');

test('finishing options are sanitised: unknown transition falls back, endLine is clipped and cleaned, subtitles need a language', () => {
  assert.deepStrictEqual(fin.normalizeFinish({}, 'english'), { transition: 'fade', subtitles: false, logo: false, endLine: '' });
  assert.strictEqual(fin.normalizeFinish({ transition: 'wipe' }, 'english').transition, 'fade');
  assert.strictEqual(fin.normalizeFinish({ transition: 'zoom' }, 'english').transition, 'zoom');
  assert.strictEqual(fin.normalizeFinish({ transition: 'cut' }, 'english').transition, 'cut');
  assert.strictEqual(fin.normalizeFinish({ subtitles: true }, 'none').subtitles, false);
  assert.strictEqual(fin.normalizeFinish({ subtitles: true }, 'tamil').subtitles, true);
  assert.strictEqual(fin.normalizeFinish({ subtitles: 'yes' }, 'tamil').subtitles, false);
  const e = fin.normalizeFinish({ endLine: `  Hello\u0000\n\tworld ${'x'.repeat(100)}` }, 'english').endLine;
  assert.strictEqual(Array.from(e).length, 60);
  assert.match(e, /^Hello world x/);
  assert.strictEqual(fin.normalizeFinish({ endLine: 42 }, 'english').endLine, '');
});

test('the timeline shortens by one overlap per join, and a cut has no overlap', () => {
  assert.deepStrictEqual(fin.clipTimeline([10, 10, 10], 0.3), { starts: [0, 9.7, 19.4], total: 29.4 });
  assert.deepStrictEqual(fin.clipTimeline([10, 10], 0), { starts: [0, 10], total: 20 });
});

test('the crossfade join keeps picture and sound overlapping by the same amount', () => {
  const a = fin.xfadeArgs(['a', 'b', 'c'], '9:16', 'o', [10, 10, 10], 'fade');
  const g = a[a.indexOf('-filter_complex') + 1];
  assert.match(g, /\[v0\]\[v1\]xfade=transition=fade:duration=0.3:offset=9.700\[xv1\]/);
  assert.match(g, /\[xv1\]\[v2\]xfade=transition=fade:duration=0.3:offset=19.400\[xv2\]/);
  assert.match(g, /\[a0\]\[a1\]acrossfade=d=0.3:c1=tri:c2=tri\[xa1\]/);
  assert.match(g, /atrim=end=10.000/);
  assert.ok(a.includes('[xv2]') && a.includes('[xa2]'));
  assert.match(fin.xfadeArgs(['a', 'b'], '16:9', 'o', [10, 10], 'zoom').join(' '), /xfade=transition=zoomin:duration=0.4:offset=9.600/);
});

test('concat uses the transition, reports where each clip starts, and falls back to a cut when probing or fading fails', async () => {
  const calls = [];
  const io = { ffmpeg: async (args) => { calls.push(args); fs.writeFileSync(args[args.length - 1], 'joined'); }, probe: async () => ({ videoDurationSeconds: 10 }) };
  const r = await chain.concat([Buffer.from('1'), Buffer.from('2')], '9:16', io, 'fade');
  assert.deepStrictEqual({ starts: r.starts, seconds: r.seconds, buf: r.buffer.toString() }, { starts: [0, 9.7], seconds: 19.7, buf: 'joined' });
  assert.match(calls[0].join(' '), /xfade/);
  calls.length = 0;
  const cut = await chain.concat([Buffer.from('1'), Buffer.from('2')], '9:16', io, 'cut');
  assert.strictEqual(cut.seconds, null);
  assert.match(calls[0].join(' '), /concat=n=2/);
  calls.length = 0;
  const bad = { ffmpeg: async (args) => { calls.push(args); if (/xfade/.test(args.join(' '))) throw new Error('boom'); fs.writeFileSync(args[args.length - 1], 'cutjoin'); }, probe: async () => ({ videoDurationSeconds: 10 }) };
  assert.strictEqual((await chain.concat([Buffer.from('1'), Buffer.from('2')], '9:16', bad, 'zoom')).buffer.toString(), 'cutjoin');
  const noProbe = { ffmpeg: io.ffmpeg, probe: async () => { throw new Error('x'); } };
  assert.strictEqual((await chain.concat([Buffer.from('1'), Buffer.from('2')], '9:16', noProbe, 'fade')).seconds, null);
});

test('makeChain passes the transition to the join and returns its timing; a bare buffer still works', async () => {
  let seen = '';
  const gen = async () => ({ ok: true, buffer: Buffer.from('c') });
  const base = { generate: gen, lastFrame: async () => Buffer.from('f') };
  const a = await chain.makeChain({ prompts: ['a', 'b'], transition: 'zoom' }, { ...base, concat: async (b, ar, tr) => { seen = tr; return { buffer: Buffer.from('J'), starts: [0, 9.6], durations: [10, 10], seconds: 19.6 }; } });
  assert.strictEqual(seen, 'zoom');
  assert.deepStrictEqual(a.timing, { starts: [0, 9.6], durations: [10, 10], seconds: 19.6 });
  const b = await chain.makeChain({ prompts: ['a', 'b'] }, { ...base, concat: async () => Buffer.from('J') });
  assert.strictEqual(b.buffer.toString(), 'J');
  assert.strictEqual(b.timing, null);
});

test('chunks only ever break at spaces, so a Tamil or Hindi combined character is never split', () => {
  for (const line of ['இன்றே ஆர்டர் செய்யுங்கள் ஆயிரம் ரூபாய்க்கு மேல் வீட்டிலேயே இலவச டெலிவரி கிடைக்கும் இன்று மட்டும்', 'आज ही ऑर्डर करें हज़ार रुपये से ऊपर घर पर मुफ़्त डिलीवरी पाएं और बचत करें']) {
    const c = fin.chunkLine(line);
    assert.ok(c.length >= 2);
    assert.strictEqual(c.join(' '), line);
    for (const x of c) assert.ok(!/^\p{M}/u.test(x) && x === x.trim(), x);
  }
});

test('a spoken line is cut into short chunks of at most 6 words and 42 characters', () => {
  const line = 'Fresh cashew katli and Mysore pak made this morning are in our Diwali gift box today.';
  const c = fin.chunkLine(line);
  assert.ok(c.length >= 3);
  for (const x of c) assert.ok(x.split(' ').length <= 6 && x.length <= 42, x);
  assert.strictEqual(c.join(' '), line);
  assert.deepStrictEqual(fin.chunkLine('Happy Diwali!'), ['Happy Diwali!']);
  assert.deepStrictEqual(fin.chunkLine('   '), []);
  const long = fin.chunkLine('Supercalifragilistic expialidocious wonderfulness unbelievable extraordinary');
  for (const x of long) assert.ok(x.length <= 42 || x.split(' ').length === 1, x);
});

test('the script of a line picks the right Noto font, and every font file is bundled with its licence', () => {
  assert.strictEqual(fin.scriptOf('வணக்கம்', 'english'), 'tamil');
  assert.strictEqual(fin.scriptOf('नमस्ते', 'english'), 'devanagari');
  assert.strictEqual(fin.scriptOf('నమస్తే', 'x'), 'telugu');
  assert.strictEqual(fin.scriptOf('ನಮಸ್ಕಾರ', 'x'), 'kannada');
  assert.strictEqual(fin.scriptOf('നമസ്കാരം', 'x'), 'malayalam');
  assert.strictEqual(fin.scriptOf('Hello', 'hindi'), 'devanagari');
  assert.strictEqual(fin.scriptOf('Hello', 'english'), 'latin');
  for (const s of Object.values(fin.SCRIPTS)) assert.ok(fs.statSync(path.join(fin.FONT_DIR, s.file)).size > 50000, s.file);
  assert.ok(fs.existsSync(path.join(fin.FONT_DIR, 'NOTO-OFL.txt')));
});

test('the finishing graph places the corner logo, the closing logo and the text plates in order', () => {
  const g = fin.buildFinishGraph({ W: 720, H: 1280, hasLogo: true, cues: [{ start: 1, end: 3, h: 100 }, { start: 3, end: 5, h: 100 }], endPlate: { h: 120 }, endStart: 8 });
  assert.match(g, /\[1:v\]format=rgba,split=2\[lg0\]\[lg1\]/);
  assert.match(g, /colorchannelmixer=aa=0.65/);
  assert.match(g, /overlay=x=W-w-29:y=77:enable='lt\(t,8.000\)'/);
  assert.match(g, /\[2:v\]overlay=x=\(W-w\)\/2:y=898:enable='between\(t,1.00,3.00\)'/);
  assert.match(g, /\[3:v\]overlay=x=\(W-w\)\/2:y=898:enable='between\(t,3.00,5.00\)'/);
  assert.match(g, /\[4:v\]overlay=x=\(W-w\)\/2:y=878:enable='gte\(t,8.000\)'/);
  assert.match(g, /\[lgb\]overlay=.*:enable='gte\(t,8.000\)'/);
  assert.match(g, /\[vout\]$/);
  const none = fin.buildFinishGraph({ W: 720, H: 1280, hasLogo: false, cues: [{ start: 1, end: 2, h: 90 }], endPlate: null, endStart: 8 });
  assert.match(none, /\[1:v\]overlay/);
  assert.doesNotMatch(none, /colorchannelmixer/);
});

const tinyVideo = () => Buffer.from('video');
// Timing is faked everywhere: no network, no paid call (see studioSubtitleFinish.test.js for the timing paths).
const fakeTiming = (line = 'Hello there friends.') => ({
  extractAudio: async (src, out) => { fs.writeFileSync(out, 'audio'); },
  spend: { check: async () => ({ ok: true }), record: async () => ({ totalUsd: 1 }) },
  transcribe: async () => ({ segments: [{ start: 1, end: 4, text: line }], words: [] })
});
const goodIo = (log = []) => ({
  ...fakeTiming(),
  probe: async () => ({ width: 720, height: 1280, videoDurationSeconds: 10, durationSeconds: 10 }),
  fetchLogo: async () => Buffer.from('png'),
  ffmpeg: async (args) => { log.push(args); fs.writeFileSync(args[args.length - 1], 'finished'); }
});
const base = (o = {}) => ({ buffer: tinyVideo(), features: { subtitles: true, logo: true, endLine: 'Thank you' }, parts: [{ spokenLine: 'Hello there friends.' }], language: 'english', logoUrl: 'https://x/logo.png', ...o });

test('finishing runs one ffmpeg pass with the logo, the text plates and the closing line', async () => {
  const log = [];
  const r = await fin.finishVideo(base(), goodIo(log));
  assert.strictEqual(log.length, 1);
  assert.strictEqual(r.buffer.toString(), 'finished');
  assert.deepStrictEqual(r.applied, ['subtitles', 'logo', 'endLine']);
  assert.strictEqual(r.notice, '');
  assert.strictEqual(r.seconds, 10);
  const a = log[0];
  assert.strictEqual(a.filter((x) => x === '-i').length >= 4, true);
  assert.ok(a.includes('[vout]'));
});

test('nothing asked means nothing is run', async () => {
  const log = [];
  const r = await fin.finishVideo(base({ features: { subtitles: false, logo: false, endLine: '' } }), goodIo(log));
  assert.strictEqual(log.length, 0);
  assert.strictEqual(r.buffer.toString(), 'video');
});

test('a brand without a logo skips the logo and says so; the rest is still added', async () => {
  const log = [];
  const r = await fin.finishVideo(base({ logoUrl: '' }), goodIo(log));
  assert.match(r.notice, /could not find your logo/);
  assert.deepStrictEqual(r.applied, ['subtitles', 'endLine']);
});

test('if the full pass fails the logo alone is tried, and then the video is delivered as it was, with a plain notice', async () => {
  const quiet = console.error; console.error = () => {};
  try {
    const log = [];
    const io = goodIo(log);
    io.ffmpeg = async (args) => { log.push(args); if (log.length === 1) throw new Error('filter error'); fs.writeFileSync(args[args.length - 1], 'logoonly'); };
    const r = await fin.finishVideo(base(), io);
    assert.strictEqual(r.buffer.toString(), 'logoonly');
    assert.deepStrictEqual(r.applied, ['logo']);
    assert.match(r.notice, /could not add the subtitles, so this video has none\./);
    assert.match(r.notice, /closing line/);
    const io2 = goodIo(); io2.ffmpeg = async () => { throw new Error('dead'); };
    const r2 = await fin.finishVideo(base({ features: { subtitles: true, logo: false, endLine: '' } }), io2);
    assert.strictEqual(r2.buffer.toString(), 'video');
    assert.strictEqual(r2.notice, 'We could not add the subtitles, so this video has none.');
    const io3 = goodIo(); io3.probe = async () => { throw new Error('no probe'); };
    assert.strictEqual((await fin.finishVideo(base(), io3)).buffer.toString(), 'video');
  } finally { console.error = quiet; }
});

test('subtitles with no spoken words are skipped with a plain notice', async () => {
  const r = await fin.finishVideo(base({ parts: [{ spokenLine: '' }], features: { subtitles: true, logo: false, endLine: '' } }), goodIo());
  assert.strictEqual(r.buffer.toString(), 'video');
  assert.match(r.notice, /no spoken words/);
});

// One real ffmpeg run on a tiny generated video (5 s: captions follow the faked speech window and stop before the closing line): proves the filter graph is valid, fonts included.
let ffmpegBin = null;
try { ffmpegBin = require('ffmpeg-static'); if (ffmpegBin && !fs.existsSync(ffmpegBin)) ffmpegBin = null; } catch (_) { ffmpegBin = null; }
test('real ffmpeg: the finishing pass works on a tiny 5 second generated video with Tamil subtitles, a logo and a closing line', { skip: !ffmpegBin && 'ffmpeg-static is not installed' }, async () => {
  const { execFileSync } = require('node:child_process');
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finish-smoke-'));
  try {
    const src = path.join(dir, 'src.mp4');
    execFileSync(ffmpegBin, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=s=360x640:r=24:d=5', '-f', 'lavfi', '-i', 'sine=d=5', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', src]);
    const logo = path.join(dir, 'logo.png');
    execFileSync(ffmpegBin, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=120x60', '-frames:v', '1', logo]);
    const r = await fin.finishVideo({
      buffer: fs.readFileSync(src), features: { subtitles: true, logo: true, endLine: 'தீபாவளி நல்வாழ்த்துகள்!' },
      parts: [{ spokenLine: 'எங்கள் தீபாவளி இனிப்பு பெட்டியில் இன்று புதிய காஜு கட்லி இருக்கிறது.' }], language: 'tamil', logoUrl: 'x'
    }, { ...fakeTiming('எங்கள் தீபாவளி இனிப்பு பெட்டியில் இன்று புதிய காஜு கட்லி இருக்கிறது.'), fetchLogo: async () => fs.readFileSync(logo), probe: async (f) => ({ width: 360, height: 640, videoDurationSeconds: 5, durationSeconds: 5 }) });
    assert.strictEqual(r.notice, '');
    assert.deepStrictEqual(r.applied, ['subtitles', 'logo', 'endLine']);
    assert.ok(r.buffer.length > 1000);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
