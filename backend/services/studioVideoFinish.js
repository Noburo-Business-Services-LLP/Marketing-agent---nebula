/**
 * Videos flow: finishing. Joins clips with a transition (fade, zoom or cut) and runs one finishing pass over the
 * joined video: subtitles, brand logo and a closing line. Every step that needs ffmpeg, ffprobe or the network
 * arrives through `io`, so the order of events and the filter graph can be tested without any of them.
 *
 * Text (subtitles and the closing line) is drawn with node-canvas (pango/harfbuzz) into small PNG plates using the
 * Noto Sans fonts bundled in backend/assets/fonts (no system fonts are assumed on the server) and overlaid by
 * ffmpeg. This is deliberate: the ffmpeg-static build's libass and drawtext do NOT shape Indic scripts (Tamil
 * vowel signs came out in the wrong place), while canvas shapes all six scripts correctly. User text never enters
 * a filter string; only fixed numbers and server-made paths do.
 *
 * TIMING comes from the real audio, never from a guess. Before captions are burned in, the audio of the joined video
 * is transcribed once (services/studioTranscribe.js, behind the spend guard, the spend row written BEFORE the call)
 * and only the times are used (services/studioSubtitleTiming.js): each clip's intended line is spread over the real
 * speech window of that clip. The words shown are always OUR intended line. If the timing cannot be had (a failure,
 * a timeout, no speech, a switch or the daily ceiling) or the spoken words do not match the line, the video gets NO
 * subtitles and a plain notice; finishing never fails or refunds a video. Logs hold counts only, never text.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const timing = require('./studioSubtitleTiming');
const { cleanText, chunkLine } = timing;
const { STUDIO_TRANSCRIBE_BLOCK_SECONDS } = require('../config/apiCosts');

const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
const TRANSITIONS = [
  { key: 'fade', label: 'Smooth fade' },
  { key: 'zoom', label: 'Quick zoom' },
  { key: 'cut', label: 'Cut' }
];
// seconds of overlap between two clips, and the ffmpeg xfade name
const TRANSITION_SPEC = { fade: { name: 'fade', seconds: 0.3 }, zoom: { name: 'zoomin', seconds: 0.4 }, cut: { name: '', seconds: 0 } };
const END_LINE_MAX = 60;
const END_CARD_SECONDS = 2;
const CLIP_NOMINAL_S = 10;
const FINISH_TIMEOUT_MS = 180000;
const AUDIO_TIMEOUT_MS = 60000;
const TRANSCRIBE_WAIT_MS = 75000; // a little over the request's own 60 s timeout

// Script -> font family inside the bundled file. Order matters only for detection of the first non-Latin script.
const SCRIPTS = {
  latin: { family: 'Noto Sans', file: 'NotoSans-Bold.ttf' },
  devanagari: { family: 'Noto Sans Devanagari', file: 'NotoSansDevanagari-Bold.ttf', re: /[ऀ-ॿ]/ },
  tamil: { family: 'Noto Sans Tamil', file: 'NotoSansTamil-Bold.ttf', re: /[஀-௿]/ },
  telugu: { family: 'Noto Sans Telugu', file: 'NotoSansTelugu-Bold.ttf', re: /[ఀ-౿]/ },
  kannada: { family: 'Noto Sans Kannada', file: 'NotoSansKannada-Bold.ttf', re: /[ಀ-೿]/ },
  malayalam: { family: 'Noto Sans Malayalam', file: 'NotoSansMalayalam-Bold.ttf', re: /[ഀ-ൿ]/ }
};
const LANGUAGE_SCRIPT = { english: 'latin', hindi: 'devanagari', tamil: 'tamil', telugu: 'telugu', kannada: 'kannada', malayalam: 'malayalam' };

const NOTICE = {
  subtitles: 'We could not add the subtitles, so this video has none.',
  logo: 'We could not add your logo, so this video has none.',
  endLine: 'We could not add the closing line, so this video has none.',
  noLogo: 'We could not find your logo in Brand assets, so this video has none.',
  noWords: 'This video has no spoken words, so there are no subtitles.',
  timing: 'We could not time the subtitles, so this video has none.',
  mismatch: 'The spoken words did not match the line, so this video has no subtitles.'
};

// ---- options ----

const truthy = (v) => v === true || v === 'true' || v === 1 || v === '1';

/** The four finishing choices, safe whatever the request held. Subtitles need a spoken language. */
function normalizeFinish(b, language) {
  const o = b && typeof b === 'object' ? b : {};
  return {
    transition: Object.prototype.hasOwnProperty.call(TRANSITION_SPEC, o.transition) ? o.transition : 'fade',
    subtitles: truthy(o.subtitles) && language !== 'none',
    logo: truthy(o.logo),
    endLine: cleanText(o.endLine, END_LINE_MAX)
  };
}

const wantsFinish = (f) => !!(f && (f.subtitles || f.logo || f.endLine));

// ---- joining clips ----

/** Where each clip starts in the joined video, and the total, given each clip's length and the overlap. */
function clipTimeline(durations, overlap) {
  const starts = [];
  let t = 0;
  durations.forEach((d, i) => { const st = i === 0 ? 0 : t - overlap; starts.push(st); t = st + d; });
  return { starts, total: durations.length ? t : 0 };
}

/**
 * Cross-fading join: video with xfade, audio with acrossfade, so picture and sound overlap by the same amount and
 * stay in sync. `durations` are the clips' video lengths (seconds); audio is padded or trimmed to the same length
 * first. Clips are brought to one size and frame rate before joining.
 */
function xfadeArgs(files, aspectRatio, out, durations, transition) {
  const spec = TRANSITION_SPEC[transition];
  const T = spec.seconds;
  const w = aspectRatio === '16:9' ? 1280 : 720; const h = aspectRatio === '16:9' ? 720 : 1280;
  const inputs = files.flatMap((f) => ['-i', f]);
  const parts = [];
  files.forEach((_, i) => {
    parts.push(`[${i}:v:0]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,format=yuv420p[v${i}]`);
    parts.push(`[${i}:a:0]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=end=${durations[i].toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`);
  });
  let v = 'v0'; let a = 'a0'; let acc = durations[0];
  for (let i = 1; i < files.length; i += 1) {
    parts.push(`[${v}][v${i}]xfade=transition=${spec.name}:duration=${T}:offset=${(acc - T).toFixed(3)}[xv${i}]`);
    parts.push(`[${a}][a${i}]acrossfade=d=${T}:c1=tri:c2=tri[xa${i}]`);
    v = `xv${i}`; a = `xa${i}`; acc = acc + durations[i] - T;
  }
  return [...inputs, '-filter_complex', parts.join(';'), '-map', `[${v}]`, '-map', `[${a}]`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out];
}

// ---- captions (the chunker and the timing maths live in studioSubtitleTiming.js) ----

// ---- text plates (canvas) ----

/** The font family to use for a piece of text: the first non-Latin script in it, else the language's own script. */
function scriptOf(text, language) {
  for (const [key, sc] of Object.entries(SCRIPTS)) if (sc.re && sc.re.test(String(text))) return key;
  return LANGUAGE_SCRIPT[language] || 'latin';
}

const isPortrait = (W, H) => H >= W;
// The bottom margin keeps text clear of the app buttons on Reels and Shorts.
const bottomMargin = (W, H) => Math.round(H * (isPortrait(W, H) ? 0.22 : 0.10));

function endFontSize(W, H, text) {
  const n = Array.from(text).length;
  return Math.round(Math.min(W, H) * (n <= 24 ? 0.075 : n <= 40 ? 0.064 : 0.055));
}

const registered = new Set();
function fontStack(script, canvasLib) {
  const reg = (key) => {
    const name = `NebulaNoto-${key}`;
    if (!registered.has(key)) {
      const file = path.join(FONT_DIR, SCRIPTS[key].file);
      if (fs.existsSync(file)) { canvasLib.registerFont(file, { family: name, weight: 'bold' }); registered.add(key); }
    }
    return registered.has(key) ? `"${name}"` : null;
  };
  return [reg(script), reg('latin'), 'sans-serif'].filter(Boolean).join(', ');
}

function wrapRaw(ctx, text, maxW) {
  const lines = []; let cur = '';
  for (const word of text.split(' ').filter(Boolean)) {
    const t = cur ? `${cur} ${word}` : word;
    if (ctx.measureText(t).width <= maxW || !cur) cur = t; else { lines.push(cur); cur = word; }
  }
  if (cur) lines.push(cur);
  return lines;
}

function wrapLines(ctx, text, maxW) {
  const lines = []; let cur = '';
  for (const word of text.split(' ').filter(Boolean)) {
    const t = cur ? `${cur} ${word}` : word;
    if (ctx.measureText(t).width <= maxW || !cur) cur = t; else { lines.push(cur); cur = word; }
  }
  if (cur) lines.push(cur);
  if (lines.length < 2) return lines;
  // Balance: the narrowest width that still gives the same number of lines, so no line is left with one word.
  let lo = maxW / lines.length; let hi = maxW; let best = lines;
  for (let i = 0; i < 12; i += 1) {
    const mid = (lo + hi) / 2;
    const tryLines = wrapRaw(ctx, text, mid);
    if (tryLines.length <= lines.length) { best = tryLines; hi = mid; } else lo = mid;
  }
  return best;
}

/**
 * One text plate: white bold text on a soft dark rounded box, as a transparent PNG just big enough for it.
 * Returns { png, w, h }.
 */
function renderTextPlate({ text, script, size, maxWidth }) {
  const canvasLib = require('canvas');
  const family = fontStack(script, canvasLib);
  const pad = Math.round(size * 0.3);
  const measure = canvasLib.createCanvas(8, 8).getContext('2d');
  measure.font = `bold ${size}px ${family}`;
  const lines = wrapLines(measure, text, maxWidth - pad * 2);
  const lineH = Math.round(size * 1.3);
  const textW = Math.ceil(Math.max(...lines.map((l) => measure.measureText(l).width)));
  const w = Math.min(maxWidth, textW + pad * 2); const h = lines.length * lineH + pad * 2;
  const c = canvasLib.createCanvas(w, h); const ctx = c.getContext('2d');
  const r = Math.round(size * 0.3);
  ctx.fillStyle = 'rgba(0,0,0,0.62)';
  ctx.beginPath(); ctx.moveTo(r, 0); ctx.arcTo(w, 0, w, h, r); ctx.arcTo(w, h, 0, h, r); ctx.arcTo(0, h, 0, 0, r); ctx.arcTo(0, 0, w, 0, r); ctx.closePath(); ctx.fill();
  ctx.font = `bold ${size}px ${family}`; ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  lines.forEach((l, i) => ctx.fillText(l, w / 2, pad + (i + 0.5) * lineH));
  return { png: c.toBuffer('image/png'), w, h };
}

// ---- the finishing pass ----

const even = (n) => Math.max(2, Math.floor(n / 2) * 2);

/**
 * The ffmpeg graph for one finishing pass. Input 0 is the joined video; then (with hasLogo) input 1 is the logo
 * PNG; then one text-plate PNG per caption cue; then the closing-line plate. A corner logo (65% opaque) stays up
 * for the whole video, except while the closing line is on, when a larger centred logo takes its place above it.
 * cues: [{ start, end, h }] and endPlate: { h } | null describe the plates, in input order.
 */
function buildFinishGraph({ W, H, hasLogo, cues = [], endPlate = null, endStart = 0 }) {
  const parts = ['[0:v]format=yuv420p[f0]'];
  let cur = 'f0'; let n = 0;
  const next = () => { n += 1; return `f${n}`; };
  let idx = hasLogo ? 2 : 1;
  const mv = bottomMargin(W, H);
  const t = endStart.toFixed(3);
  if (hasLogo) {
    const portrait = isPortrait(W, H);
    const lw = even(W * 0.14); const lh = even(H * 0.08);
    const padX = Math.round(W * 0.04); const padY = Math.round(H * (portrait ? 0.06 : 0.05));
    parts.push(endPlate ? '[1:v]format=rgba,split=2[lg0][lg1]' : '[1:v]format=rgba[lg0]');
    parts.push(`[lg0]scale=${lw}:${lh}:force_original_aspect_ratio=decrease,colorchannelmixer=aa=0.65[lgs]`);
    const o = next();
    parts.push(`[${cur}][lgs]overlay=x=W-w-${padX}:y=${padY}${endPlate ? `:enable='lt(t,${t})'` : ''}[${o}]`);
    cur = o;
  }
  cues.forEach((c) => {
    const o = next();
    parts.push(`[${cur}][${idx}:v]overlay=x=(W-w)/2:y=${H - mv - c.h}:enable='between(t,${c.start.toFixed(2)},${c.end.toFixed(2)})'[${o}]`);
    cur = o; idx += 1;
  });
  if (endPlate) {
    const top = H - mv - endPlate.h;
    if (hasLogo) {
      const bw = even(W * 0.4); const bh = even(H * (isPortrait(W, H) ? 0.12 : 0.18));
      parts.push(`[lg1]scale=${bw}:${bh}:force_original_aspect_ratio=decrease[lgb]`);
      const o = next();
      parts.push(`[${cur}][lgb]overlay=x=(W-w)/2:y=${top - Math.round(H * 0.02)}-h:enable='gte(t,${t})'[${o}]`);
      cur = o;
    }
    const o = next();
    parts.push(`[${cur}][${idx}:v]overlay=x=(W-w)/2:y=${top}:enable='gte(t,${t})'[${o}]`);
    cur = o;
  }
  parts.push(`[${cur}]null[vout]`);
  return parts.join(';');
}

function missingFonts(scripts, fontDir = FONT_DIR) {
  return scripts.filter((s) => !fs.existsSync(path.join(fontDir, SCRIPTS[s].file)));
}

const defaultIo = () => {
  const hero = require('./heroVideoFinish');
  return {
    ffmpeg: (args, opts) => hero.runFfmpeg(args, opts),
    probe: (file) => hero.probeMedia(file),
    fetchLogo: async (url) => {
      const raw = await hero.fetchLogoBuffer(url);
      return raw ? hero.normalizeLogo(raw) : null;
    },
    // Mono 16 kHz AAC in an m4a: small, and what the transcription wants.
    extractAudio: (src, out) => hero.runFfmpeg(['-y', '-nostdin', '-hide_banner', '-i', src, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'aac', '-b:a', '32k', out], { timeoutMs: AUDIO_TIMEOUT_MS }),
    transcribe: (file, lang) => require('./studioTranscribe').transcribe(file, lang),
    spend: require('./spendGuard')
  };
};

async function withTemp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nebula-finish-'));
  try { return await fn(dir); } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* temp */ } }
}

/** Estimated billing units: the video length in seconds rounded UP to the next 6 seconds (never below one). */
function transcriptionUnits(seconds) {
  const n = Number(seconds);
  return Number.isFinite(n) && n > 0 ? Math.max(1, Math.ceil(n / STUDIO_TRANSCRIBE_BLOCK_SECONDS - 1e-9)) : 1;
}

const withDeadline = (promise, ms) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('timed out')), ms);
  Promise.resolve(promise).then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
});

/**
 * Real caption timing for a joined video. Never throws. Result: { cues, notice }; empty cues come with the plain notice.
 * Order matters: free checks first (switch and ceiling, audio extraction), then the spend row is written, and only if it
 * was saved is the one paid call made. There is exactly one attempt per video.
 * Logs: counts only.
 */
async function timeSubtitles({ buffer, parts, language, join, endLine }, io) {
  const none = (notice, why) => { console.warn(`[videos] subtitle timing: none (${why})`); return { cues: [], notice }; };
  try {
    return await withTemp(async (dir) => {
      const input = path.join(dir, 'in.mp4'); const audio = path.join(dir, 'audio.m4a');
      fs.writeFileSync(input, buffer);
      let meta;
      try { meta = await io.probe(input); } catch (_) { return none(NOTICE.timing, 'unreadable video'); }
      const total = meta.videoDurationSeconds || meta.durationSeconds || 0;
      if (!(total > 1)) return none(NOTICE.timing, 'video too short');
      if (meta.hasAudio === false) return none(NOTICE.timing, 'no audio track');
      let verdict;
      try { verdict = await io.spend.check('studio_transcription'); } catch (_) { verdict = { ok: false }; }
      if (!verdict || verdict.ok === false) return none(NOTICE.timing, 'switched off or ceiling reached');
      try { await io.extractAudio(input, audio); } catch (_) { return none(NOTICE.timing, 'audio could not be extracted'); }
      const units = transcriptionUnits(total);
      // The spend row is written BEFORE the paid call. If it cannot be saved, no call is made (fail closed).
      let saved = null;
      try { saved = await io.spend.record('studio_transcription', units); } catch (_) { saved = null; }
      if (!saved) return none(NOTICE.timing, 'spend row not saved, no call made');
      let transcript;
      try {
        transcript = await withDeadline(io.transcribe(audio, timing.whisperLanguage(language)), io.transcribeTimeoutMs || TRANSCRIBE_WAIT_MS);
      } catch (e) { const code = /HTTP (\d{3})/.exec(e && e.message ? String(e.message) : ''); return none(NOTICE.timing, `transcription failed${code ? ` (HTTP ${code[1]})` : ''}`); }
      const n = (parts || []).length;
      const durations = join && Array.isArray(join.durations) && join.durations.length === n ? join.durations : (n <= 1 ? [total] : Array.from({ length: n }, () => CLIP_NOMINAL_S));
      const starts = join && Array.isArray(join.starts) && join.starts.length === n ? join.starts : (n <= 1 ? [0] : durations.map((_, i) => i * CLIP_NOMINAL_S));
      const stopAt = endLine ? Math.max(0, total - END_CARD_SECONDS) : Infinity;
      const r = timing.buildTimedCues({ parts, transcript, starts, durations, total, stopAt });
      console.log(`[videos] subtitle timing: ${r.status}, ${r.cues.length} cues, ${(transcript && transcript.segments && transcript.segments.length) || 0} segments, ${n} clips, ${units} units`);
      if (r.status === 'ok' && r.cues.length) return { cues: r.cues, notice: '' };
      return { cues: [], notice: r.status === 'mismatch' ? NOTICE.mismatch : NOTICE.timing };
    });
  } catch (_) {
    return none(NOTICE.timing, 'unexpected error');
  }
}

/**
 * One finishing run with the given features. Throws on any problem (the caller decides what to drop).
 * Returns { buffer, seconds, applied }.
 */
async function finishOnce({ buffer, features, cues: timedCues = [], language, logoPng }, io) {
  const inFeatures = features;
  return withTemp(async (dir) => {
    const input = path.join(dir, 'in.mp4'); const out = path.join(dir, 'out.mp4');
    fs.writeFileSync(input, buffer);
    const meta = await io.probe(input);
    const W = even(meta.width || 720); const H = even(meta.height || 1280);
    const total = meta.videoDurationSeconds || meta.durationSeconds || 0;
    if (!(total > 1)) throw new Error('video too short or unreadable');
    const endStart = Math.max(0, total - END_CARD_SECONDS);
    const endLine = inFeatures.endLine || '';
    const cues = inFeatures.subtitles ? timedCues : [];
    const used = new Set();
    cues.forEach((c) => used.add(scriptOf(c.text, language)));
    if (endLine) used.add(scriptOf(endLine, language));
    const lacking = missingFonts([...used]);
    if (lacking.length) throw new Error(`font missing: ${lacking.join(', ')}`);
    const maxW = Math.round(W * 0.88);
    const plates = [];
    const subSize = Math.round(Math.min(W, H) * 0.052);
    const files = [];
    const save = (plate, name) => { const f = path.join(dir, name); fs.writeFileSync(f, plate.png); files.push(f); };
    cues.forEach((c, i) => { const pl = renderTextPlate({ text: c.text, script: scriptOf(c.text, language), size: subSize, maxWidth: maxW }); plates.push({ start: c.start, end: c.end, h: pl.h }); save(pl, `cue${i}.png`); });
    let endPlate = null;
    if (endLine) { const pl = renderTextPlate({ text: endLine, script: scriptOf(endLine, language), size: endFontSize(W, H, endLine), maxWidth: maxW }); endPlate = { h: pl.h }; save(pl, 'end.png'); }
    const logoFile = path.join(dir, 'logo.png');
    if (logoPng) fs.writeFileSync(logoFile, logoPng);
    const graph = buildFinishGraph({ W, H, hasLogo: !!logoPng, cues: plates, endPlate, endStart });
    const args = ['-y', '-nostdin', '-hide_banner', '-i', input, ...(logoPng ? ['-i', logoFile] : []), ...files.flatMap((f) => ['-i', f]), '-filter_complex', graph, '-map', '[vout]', '-map', '0:a?',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out];
    await io.ffmpeg(args, { timeoutMs: FINISH_TIMEOUT_MS });
    const done = fs.readFileSync(out);
    if (!done.length) throw new Error('empty output');
    const applied = [];
    if (cues.length) applied.push('subtitles');
    if (logoPng) applied.push('logo');
    if (endLine) applied.push('endLine');
    return { buffer: done, seconds: total, applied, cueCount: cues.length };
  });
}

/**
 * Finishes a joined video. Never throws and never fails the video: on any problem the video comes back as it was,
 * with a plain `notice` saying what is missing.
 * args: { buffer, features: {subtitles, logo, endLine}, parts, language, join:{starts,durations}, logoUrl }
 * Result: { buffer, notice, applied, seconds|null }
 */
async function finishVideo(args, ioIn = {}) {
  const io = { ...defaultIo(), ...ioIn };
  // args.cpu (the worker's CPU pool, E9 B1): a slot is held only around the ffmpeg and ffprobe steps, never during the logo
  // fetch or the transcription wait, so a slow provider call does not stop another video's ffmpeg.
  if (typeof args.cpu === 'function') {
    for (const k of ['ffmpeg', 'probe', 'extractAudio']) { const f = io[k]; io[k] = (...a) => args.cpu(() => f(...a)); }
  }
  const { buffer, parts, language, join, logoUrl } = args;
  const f = args.features || {};
  const asked = { subtitles: !!f.subtitles, logo: !!f.logo, endLine: cleanText(f.endLine, END_LINE_MAX) };
  if (!asked.subtitles && !asked.logo && !asked.endLine) return { buffer, notice: '', applied: [], seconds: null };
  const notes = [];
  if (asked.subtitles && !(Array.isArray(parts) ? parts : []).some((p) => cleanText(p && p.spokenLine, 400))) {
    asked.subtitles = false;
    notes.push(NOTICE.noWords);
  }
  if (!asked.subtitles && !asked.logo && !asked.endLine) return { buffer, notice: notes.join(' '), applied: [], seconds: null };
  let cues = [];
  if (asked.subtitles) {
    const timed = await timeSubtitles({ buffer, parts, language, join, endLine: asked.endLine }, io);
    cues = timed.cues;
    if (!cues.length) { asked.subtitles = false; notes.push(timed.notice); }
  }
  if (!asked.subtitles && !asked.logo && !asked.endLine) return { buffer, notice: notes.join(' '), applied: [], seconds: null };
  let logoPng = null;
  if (asked.logo) {
    try { logoPng = logoUrl ? await io.fetchLogo(logoUrl) : null; } catch (_) { logoPng = null; }
    if (!logoPng) notes.push(NOTICE.noLogo);
  }
  // Tier 1: everything asked. Tier 2: only the logo, if text was what failed. Otherwise the video as it was.
  const tiers = [{ subtitles: asked.subtitles, endLine: asked.endLine, logo: !!logoPng }];
  if (logoPng && (asked.subtitles || asked.endLine)) tiers.push({ subtitles: false, endLine: '', logo: true });
  const failedNote = (feat) => [feat.subtitles && NOTICE.subtitles, feat.endLine && NOTICE.endLine, feat.logo && NOTICE.logo].filter(Boolean);
  for (let i = 0; i < tiers.length; i += 1) {
    const t = tiers[i];
    if (!t.subtitles && !t.endLine && !t.logo) break;
    try {
      const r = await finishOnce({ buffer, features: t, cues, language, logoPng: t.logo ? logoPng : null }, io);
      const missing = [];
      if (asked.endLine && !t.endLine) missing.push(NOTICE.endLine);
      if (asked.subtitles && !t.subtitles) missing.push(NOTICE.subtitles);
      return { buffer: r.buffer, notice: [...notes, ...missing].join(' '), applied: r.applied, seconds: r.seconds };
    } catch (e) {
      console.error('[videos] finishing step failed:', e && (e.detail || e.message));
    }
  }
  const dropped = failedNote({ subtitles: asked.subtitles, endLine: asked.endLine, logo: !!logoPng });
  return { buffer, notice: [...notes, ...dropped].join(' '), applied: [], seconds: null };
}

module.exports = {
  TRANSITIONS, TRANSITION_SPEC, END_LINE_MAX, FONT_DIR, SCRIPTS, NOTICE,
  normalizeFinish, wantsFinish, clipTimeline, xfadeArgs, chunkLine, transcriptionUnits, timeSubtitles, renderTextPlate, buildFinishGraph, scriptOf, finishVideo, finishOnce, cleanText
};
