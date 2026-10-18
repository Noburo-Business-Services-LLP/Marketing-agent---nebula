/**
 * Subtitle timing from the REAL audio. Pure functions only: no network, no ffmpeg, no files.
 *
 * The video model says its own words at its own moments, so we do not guess when a line is spoken. The audio of the
 * joined video is transcribed (Whisper, `verbose_json` with segment and word timestamps) and only the TIMES are
 * used. What is shown on screen is always OUR intended line (Whisper's Tamil and Hindi spelling is imperfect), cut
 * into short chunks that share the real speech window of their clip in proportion to their length.
 *
 * Window of clip k = first speech segment start to last speech segment end that falls inside that clip. A clip
 * "owns" the stretch from its own start to the next clip's start (clips overlap by the fade), and a segment belongs
 * to the clip that holds its middle. Word timestamps, when given, can only tighten a window, never widen it.
 *
 * Guard: the heard words are compared with the intended line. When they are very different (similarity below
 * MIN_SIMILARITY) there are no subtitles at all, because wrong words on screen are worse than none.
 */

const CHUNK_WORDS = 6;
const CHUNK_CHARS = 42;
const CLIP_NOMINAL_S = 10;
// A caption shorter than this is unreadable: neighbours are merged until each lasts at least this long.
const MIN_CUE_SECONDS = 0.8;
// A speech window shorter than this shows nothing at all.
const MIN_WINDOW_SECONDS = 0.3;
// The closing line starts at stopAt; captions stop this much before it.
const STOP_GAP_S = 0.05;
// Whisper's own "this is not speech" rule (it hallucinates "Thank you." over music): no_speech_prob above this AND a poor
// average log-probability.
const NO_SPEECH_PROB = 0.6;
const POOR_LOGPROB = -1;
/**
 * Similarity (0 to 1) below which the spoken words are treated as a different line and subtitles are skipped.
 * Measured on the consonant skeleton (vowel signs and accents removed) so Whisper's loose Tamil and Hindi spelling
 * does not count against a line that was said correctly. Measured on the test fixtures: a line said
 * correctly with imperfect spelling scores 0.87 to 0.93, with a repeated phrase 0.79, with one word swapped 0.89;
 * unrelated sentences of the same language score 0 to 0.25. 0.3 is deliberately low: we only skip when the words are
 * clearly not the line.
 */
const MIN_SIMILARITY = 0.3;

const WHISPER_LANGUAGE = { english: 'en', hindi: 'hi', tamil: 'ta', telugu: 'te', kannada: 'kn', malayalam: 'ml' };
/** The ISO code Whisper wants for a video language, or null (then Whisper detects it). */
const whisperLanguage = (language) => WHISPER_LANGUAGE[String(language || '')] || null;

const cleanText = (v, max) => {
  const s = typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim() : '';
  return Array.from(s).slice(0, max).join('').trim();
};

/** Splits a spoken line into short caption chunks: at most about 6 words and 42 characters, of similar length. Cuts only at spaces. */
function chunkLine(line) {
  const words = cleanText(line, 400).split(' ').filter(Boolean);
  if (!words.length) return [];
  const len = (arr) => Array.from(arr.join(' ')).length;
  for (let n = Math.max(1, Math.ceil(words.length / CHUNK_WORDS)); n <= words.length; n += 1) {
    // Balanced split: walk the words and close a chunk once it has its share of the characters.
    const total = len(words);
    const chunks = []; let cur = [];
    words.forEach((w, i) => {
      cur.push(w);
      const left = words.length - i - 1; const need = n - chunks.length - 1;
      const share = (total * (chunks.length + 1)) / n;
      const used = len(chunks.flat().concat(cur));
      if (need > 0 && left >= need && (used >= share || left === need || cur.length >= CHUNK_WORDS)) { chunks.push(cur); cur = []; }
    });
    if (cur.length) chunks.push(cur);
    if (chunks.every((c) => c.length <= CHUNK_WORDS && len(c) <= CHUNK_CHARS) || n === words.length) return chunks.map((c) => c.join(' '));
  }
  return [words.join(' ')];
}

// ---- similarity ----

const skeleton = (s) => String(s == null ? '' : s).normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
function bigrams(s) {
  const a = Array.from(s); const m = new Map();
  if (a.length < 2) { if (a.length) m.set(a[0], 1); return m; }
  for (let i = 0; i < a.length - 1; i += 1) { const k = a[i] + a[i + 1]; m.set(k, (m.get(k) || 0) + 1); }
  return m;
}

/** Dice similarity of two texts on their consonant skeletons, 0 to 1. Tolerant of vowel signs, accents, spacing and punctuation. */
function similarity(a, b) {
  const x = skeleton(a); const y = skeleton(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const A = bigrams(x); const B = bigrams(y);
  let common = 0; let na = 0; let nb = 0;
  A.forEach((v) => { na += v; });
  B.forEach((v, k) => { nb += v; if (A.has(k)) common += Math.min(v, A.get(k)); });
  return na + nb ? (2 * common) / (na + nb) : 0;
}

// ---- windows ----

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Segments that are usable: finite, forward, inside the video (clipped to it), and not marked as non-speech by Whisper. */
function cleanSegments(segments, total) {
  const out = [];
  for (const s of Array.isArray(segments) ? segments : []) {
    if (!s || typeof s !== 'object') continue;
    let a = num(s.start); let b = num(s.end);
    if (a === null || b === null || b <= a) continue;
    if (a >= total || b <= 0) continue;
    a = Math.max(0, a); b = Math.min(total, b);
    if (b - a <= 0) continue;
    const ns = num(s.no_speech_prob); const lp = num(s.avg_logprob);
    if (ns !== null && ns > NO_SPEECH_PROB && lp !== null && lp < POOR_LOGPROB) continue;
    out.push({ start: a, end: b, text: typeof s.text === 'string' ? s.text : '' });
  }
  return out;
}

/**
 * The speech window of every clip: [{ start, end, heard } | null]. `starts[k]` is where clip k starts in the joined
 * video (the overlap with the clip before is already taken out); `total` is the joined video's length.
 */
function speechWindows({ segments, words, starts, total }) {
  const n = Array.isArray(starts) ? starts.length : 0;
  const T = num(total) !== null && total > 0 ? total : 0;
  const wins = Array.from({ length: n }, () => null);
  if (!n || !T) return wins;
  const cells = starts.map((s, k) => ({ from: k === 0 ? 0 : Math.max(0, num(s) || 0), to: k < n - 1 ? (num(starts[k + 1]) === null ? T : starts[k + 1]) : T }));
  const segs = cleanSegments(segments, T);
  const wordList = (Array.isArray(words) ? words : []).map((w) => (w && num(w.start) !== null && num(w.end) !== null && w.end > w.start ? { start: w.start, end: w.end } : null)).filter(Boolean);
  const bucket = Array.from({ length: n }, () => []);
  for (const s of segs) {
    const mid = (s.start + s.end) / 2;
    let k = cells.length - 1;
    for (let i = 0; i < n; i += 1) if (mid < cells[i].to) { k = i; break; }
    bucket[k].push(s);
  }
  bucket.forEach((list, k) => {
    if (!list.length) return;
    const cell = cells[k];
    let start = Math.max(cell.from, Math.min(...list.map((s) => s.start)));
    let end = Math.min(cell.to, Math.max(...list.map((s) => s.end)));
    if (!(end > start)) return;
    // Words can only tighten the window (a word is clipped to the window first).
    const inside = wordList.map((w) => ({ start: Math.max(w.start, start), end: Math.min(w.end, end) })).filter((w) => w.end > w.start);
    if (inside.length) { start = Math.min(...inside.map((w) => w.start)); end = Math.max(...inside.map((w) => w.end)); }
    wins[k] = { start, end, heard: list.map((s) => s.text).join(' ').trim() };
  });
  return wins;
}

// ---- cues ----

/**
 * Spreads caption chunks over a real speech window in proportion to their length. Each caption is held until the
 * next starts; the last ends with the window. A window too short for readable captions merges neighbours; one too
 * short for even a single caption shows nothing. Returns [{ start, end, text }].
 */
function placeChunks(chunks, window) {
  const list = (Array.isArray(chunks) ? chunks : []).filter((c) => typeof c === 'string' && c.trim());
  const a = window && num(window.start); const b = window && num(window.end);
  if (!list.length || a === null || b === null || b - a < MIN_WINDOW_SECONDS) return [];
  const dur = b - a;
  let items = list.map((text) => ({ text, w: Array.from(text).length + 4 }));
  const sum = () => items.reduce((x, i) => x + i.w, 0);
  while (items.length > 1 && items.some((i) => (dur * i.w) / sum() < MIN_CUE_SECONDS)) {
    let k = 0;
    items.forEach((it, i) => { if (it.w < items[k].w) k = i; });
    const left = k > 0 ? items[k - 1].w : Infinity; const right = k < items.length - 1 ? items[k + 1].w : Infinity;
    const j = left <= right ? k - 1 : k + 1;
    const lo = Math.min(j, k); const hi = Math.max(j, k);
    items.splice(lo, 2, { text: `${items[lo].text} ${items[hi].text}`, w: items[lo].w + items[hi].w });
  }
  const total = sum();
  const cues = []; let t = a;
  items.forEach((it, i) => {
    const end = i === items.length - 1 ? b : t + (dur * it.w) / total;
    cues.push({ start: t, end, text: it.text });
    t = end;
  });
  return cues;
}

/**
 * Caption cues from a transcript. parts[k].spokenLine is clip k's intended line; starts[k] places clip k in the joined
 * video; total is the video length; cues stop before `stopAt` (the closing line) when one is given.
 * Result: { status: 'ok' | 'nospeech' | 'mismatch', cues, similarities } where similarities[k] is the heard-versus-intended
 * score of clip k (null when the clip has no line or no speech). 'mismatch' and 'nospeech' come with no cues.
 */
function buildTimedCues({ parts, transcript, starts, durations, total, stopAt = Infinity }) {
  const list = Array.isArray(parts) ? parts : [];
  const st = list.map((_, k) => (Array.isArray(starts) && num(starts[k]) !== null ? starts[k] : k * CLIP_NOMINAL_S));
  const dur = list.map((_, k) => (Array.isArray(durations) && num(durations[k]) !== null ? durations[k] : CLIP_NOMINAL_S));
  const T = num(total) !== null && total > 0 ? total : (st.length ? st[st.length - 1] + dur[dur.length - 1] : 0);
  const t = transcript && typeof transcript === 'object' ? transcript : {};
  const wins = speechWindows({ segments: t.segments, words: t.words, starts: st, total: T });
  const stop = num(stopAt) !== null ? stopAt - STOP_GAP_S : Infinity;
  const similarities = list.map(() => null);
  const cues = [];
  let timed = 0; let bad = false;
  list.forEach((p, k) => {
    const line = cleanText(p && p.spokenLine, 400);
    const win = wins[k];
    if (!line || !win) return;
    timed += 1;
    similarities[k] = similarity(line, win.heard);
    if (similarities[k] < MIN_SIMILARITY) { bad = true; return; }
    const end = Math.min(win.end, stop, T);
    placeChunks(chunkLine(line), { start: win.start, end }).forEach((c) => cues.push(c));
  });
  if (!timed) return { status: 'nospeech', cues: [], similarities };
  if (bad) return { status: 'mismatch', cues: [], similarities };
  // Final safety: ordered, never negative, never overlapping, never past the video or the closing line.
  cues.sort((x, y) => x.start - y.start);
  const clean = []; let last = 0;
  for (const c of cues) {
    const s = Math.max(0, last, c.start); const e = Math.min(c.end, T, stop);
    if (e - s > 0.05) { clean.push({ start: s, end: e, text: c.text }); last = e; }
  }
  return clean.length ? { status: 'ok', cues: clean, similarities } : { status: 'nospeech', cues: [], similarities };
}

module.exports = {
  MIN_CUE_SECONDS, MIN_WINDOW_SECONDS, MIN_SIMILARITY, CHUNK_WORDS, CHUNK_CHARS,
  whisperLanguage, cleanText, chunkLine, similarity, speechWindows, placeChunks, buildTimedCues
};
