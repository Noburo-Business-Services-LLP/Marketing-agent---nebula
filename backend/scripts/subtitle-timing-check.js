/**
 * Local check of the real-timing subtitles. NO network and NO paid call: the transcription is a FAKE that returns speech
 * windows chosen here. Everything else is real: a generated video, ffmpeg audio extraction, the real finishing pass
 * (node-canvas text plates, ffmpeg overlay graph), then frames extracted from the finished video.
 *
 *   node scripts/subtitle-timing-check.js
 *
 * The generated video is a plain dark colour, so any near-white pixel in the caption band can only come from a caption.
 * For each fake speech window the check extracts frames INSIDE the window (a caption must be on) and OUTSIDE it (none),
 * for a one-clip and a two-clip (with fade overlap) video, then checks the failure paths leave the video byte for byte
 * unchanged with the plain notice. Prints a PASS/FAIL table and exits 1 on any FAIL.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const ffmpeg = require('ffmpeg-static');
const fin = require('../services/studioVideoFinish');

const W = 360; const H = 640;
const TA = 'இன்றே ஆர்டர் செய்யுங்கள். ஆயிரம் ரூபாய்க்கு மேல் வீட்டிலேயே இலவச டெலிவரி.';
// What the fake Whisper "hears": the same line with its imperfect Tamil spelling. Only its TIMES are used.
const TA_HEARD = TA.replace('ஆர்டர்', 'ஓடர்');
const TA2 = 'நாளை முதல் எங்கள் புதிய கடை திறக்கப்படும் அனைவரும் வருக.';
const rows = [];
const record = (name, ok, detail = '') => { rows.push({ name, ok, detail }); };

function makeVideo(file, seconds) {
  execFileSync(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=0x203040:s=${W}x${H}:r=24:d=${seconds}`, '-f', 'lavfi', '-i', `sine=f=300:d=${seconds}`, '-shortest',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file]);
}

// White pixels in the band where captions sit (the middle-lower part of the frame).
function whitePixels(file, t) {
  const y0 = Math.round(H * 0.55); const h = Math.round(H * 0.25);
  const raw = execFileSync(ffmpeg, ['-v', 'error', '-ss', t.toFixed(3), '-i', file, '-frames:v', '1', '-vf', `crop=${W}:${h}:0:${y0},format=gray`, '-f', 'rawvideo', '-'], { maxBuffer: 1e8 });
  let n = 0; for (const b of raw) if (b > 200) n += 1;
  return n;
}
const ON_MIN = 150; // pixels; a caption has hundreds, a bare background has none

function ioFor(transcribe, extra = {}) {
  const hero = require('../services/heroVideoFinish');
  return {
    ffmpeg: (a, o) => hero.runFfmpeg(a, o), probe: (f) => hero.probeMedia(f),
    extractAudio: (src, out) => hero.runFfmpeg(['-y', '-nostdin', '-hide_banner', '-i', src, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'aac', '-b:a', '32k', out], { timeoutMs: 60000 }),
    spend: { check: async () => ({ ok: true }), record: async () => ({ totalUsd: 0 }) },
    transcribe, ...extra
  };
}

async function scenario(dir, label, { seconds, parts, join, windows, heard, language = 'tamil' }) {
  const src = path.join(dir, `${label}.mp4`); const out = path.join(dir, `${label}-out.mp4`);
  makeVideo(src, seconds);
  const buffer = fs.readFileSync(src);
  let calls = 0;
  const transcribe = async (file, lang) => { calls += 1; record(`${label}: transcribe called once with an audio file and language ${language}`, calls === 1 && fs.existsSync(file) && lang === (language === 'tamil' ? 'ta' : 'en')); return { segments: windows.map(([a, b], i) => ({ start: a, end: b, text: heard[i] })), words: [] }; };
  const r = await fin.finishVideo({ buffer, features: { subtitles: true, logo: false, endLine: '' }, parts, language, join }, ioFor(transcribe));
  record(`${label}: subtitles applied, no notice`, r.applied.includes('subtitles') && r.notice === '', `applied=${r.applied} notice="${r.notice}"`);
  fs.writeFileSync(out, r.buffer);
  const dur = Number(execFileSync(require('ffprobe-static').path, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString());
  record(`${label}: duration unchanged (${seconds}s)`, Math.abs(dur - seconds) < 0.15, `${dur.toFixed(2)}s`);
  const M = 0.3;
  windows.forEach(([a, b], i) => {
    const inside = [a + M, (a + b) / 2, b - M].filter((t) => t > a && t < b);
    inside.forEach((t) => { const n = whitePixels(out, t); record(`${label}: caption ON at ${t.toFixed(2)}s (window ${i + 1}: ${a}-${b}s)`, n >= ON_MIN, `${n} white px`); });
    [a - M, b + M].forEach((t) => {
      if (t < 0 || t > seconds - 0.2) return;
      if (windows.some(([x, y]) => t >= x - 0.01 && t <= y + 0.01)) return;
      const n = whitePixels(out, t); record(`${label}: caption OFF at ${t.toFixed(2)}s (outside window ${i + 1})`, n < 20, `${n} white px`);
    });
  });
  const gap = [0.3, seconds - 0.4];
  gap.forEach((t) => { if (!windows.some(([x, y]) => t >= x - M && t <= y + M)) { const n = whitePixels(out, t); record(`${label}: caption OFF at ${t.toFixed(2)}s (edge of the video)`, n < 20, `${n} white px`); } });
}

async function failure(dir, name, transcribe, expectedNotice, extra = {}) {
  const src = path.join(dir, 'f.mp4'); makeVideo(src, 8);
  const buffer = fs.readFileSync(src);
  const quiet = [console.log, console.warn, console.error]; console.log = console.warn = console.error = () => {};
  let r;
  try { r = await fin.finishVideo({ buffer, features: { subtitles: true, logo: false, endLine: '' }, parts: [{ spokenLine: TA }], language: 'tamil' }, ioFor(transcribe, extra)); } finally { [console.log, console.warn, console.error] = quiet; }
  record(`failure (${name}): video unchanged and the plain notice`, r.buffer.equals(buffer) && r.notice === expectedNotice, `notice="${r.notice}"`);
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subtitle-check-'));
  try {
    // One clip: the speech starts at 2.1 s and ends at 6.4 s of a 10 s clip (captions must not start at 1 s or run on).
    await scenario(dir, 'one clip', { seconds: 10, parts: [{ spokenLine: TA }], join: null, windows: [[2.1, 6.4]], heard: [TA_HEARD] });
    // Two clips joined with a 0.3 s fade: clip 2 starts at 7.7 s. Speech 1.5-5 s and 10.0-13.2 s.
    await scenario(dir, 'two clips', { seconds: 15.7, parts: [{ spokenLine: TA }, { spokenLine: TA2 }], join: { starts: [0, 7.7], durations: [8, 8] }, windows: [[1.5, 5], [10, 13.2]], heard: [TA_HEARD, TA2] });
    const nothing = async () => ({ segments: [], words: [] });
    await failure(dir, 'transcription throws', async () => { throw new Error('HTTP 500'); }, fin.NOTICE.timing);
    await failure(dir, 'no speech found', nothing, fin.NOTICE.timing);
    await failure(dir, 'spend guard off', async () => { throw new Error('must not be called'); }, fin.NOTICE.timing, { spend: { check: async () => ({ ok: false }), record: async () => ({}) } });
    await failure(dir, 'spend row not saved', async () => { throw new Error('must not be called'); }, fin.NOTICE.timing, { spend: { check: async () => ({ ok: true }), record: async () => null } });
    await failure(dir, 'words do not match', async () => ({ segments: [{ start: 1, end: 5, text: 'The weather is lovely and the children are playing in the park' }], words: [] }), fin.NOTICE.mismatch);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  const w = Math.max(...rows.map((r) => r.name.length));
  console.log(`\n${'CHECK'.padEnd(w)}  RESULT  DETAIL`);
  rows.forEach((r) => console.log(`${r.name.padEnd(w)}  ${r.ok ? 'PASS  ' : 'FAIL  '}  ${r.detail}`));
  const bad = rows.filter((r) => !r.ok).length;
  console.log(`\n${rows.length - bad} PASS, ${bad} FAIL`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('check crashed:', e && e.message); process.exit(2); });
