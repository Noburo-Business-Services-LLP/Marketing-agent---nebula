/**
 * The ONE real transcription call of the Videos flow: OpenAI `whisper-1`, used only to learn WHEN words are spoken
 * (the text shown on screen is always our own line). `transcribe(audioPath, language)` is the function the finishing
 * pass takes as an injectable `io.transcribe`; tests and checks replace it with a fake.
 *
 * Rules, all deliberate:
 *   - ONE attempt. There is no retry, because a retried request is billed again. A failure is thrown to the caller.
 *   - The key is read from process.env.OPENAI_API_KEY at call time and goes only into the Authorization header. It is
 *     never logged, and no error message carries the key, the reply body or any transcript text.
 *   - A timeout aborts the request.
 *   - Under the node test runner the real network is refused unless a fake `fetch` is passed in, so no test can spend money.
 */
const fs = require('fs');

const URL = 'https://api.openai.com/v1/audio/transcriptions';
const TIMEOUT_MS = 60000;
const MAX_BYTES = 24 * 1024 * 1024; // the endpoint accepts up to 25 MB

const fail = (msg) => new Error(msg);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Keeps only what the timing needs from a verbose_json reply (times, text and Whisper's own non-speech hints). */
function normalize(body) {
  const b = body && typeof body === 'object' ? body : {};
  const segments = (Array.isArray(b.segments) ? b.segments : []).map((s) => {
    if (!s || typeof s !== 'object' || num(s.start) === null || num(s.end) === null) return null;
    const o = { start: s.start, end: s.end, text: typeof s.text === 'string' ? s.text : '' };
    if (num(s.no_speech_prob) !== null) o.no_speech_prob = s.no_speech_prob;
    if (num(s.avg_logprob) !== null) o.avg_logprob = s.avg_logprob;
    return o;
  }).filter(Boolean);
  const words = (Array.isArray(b.words) ? b.words : []).map((w) => (w && num(w.start) !== null && num(w.end) !== null ? { start: w.start, end: w.end, word: typeof w.word === 'string' ? w.word : '' } : null)).filter(Boolean);
  return { segments, words, duration: num(b.duration) };
}

/**
 * Transcribes one audio file. `language` is an ISO code (ta, hi, en, te, kn, ml) or null to let Whisper detect it.
 * opts (tests and the proof script): fetch, env, timeoutMs.
 */
async function transcribe(audioPath, language, opts = {}) {
  const env = opts.env || process.env;
  const fetchFn = opts.fetch || (process.env.NODE_TEST_CONTEXT ? null : globalThis.fetch);
  if (!fetchFn) throw fail('transcription over the network is not allowed while tests run');
  const key = env.OPENAI_API_KEY;
  if (!key) throw fail('transcription key is not set');
  const audio = fs.readFileSync(audioPath);
  if (!audio.length || audio.length > MAX_BYTES) throw fail('transcription audio has a bad size');
  const form = new FormData();
  form.append('file', new Blob([audio], { type: 'audio/mp4' }), 'audio.m4a');
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'segment');
  form.append('timestamp_granularities[]', 'word');
  if (language) form.append('language', String(language));
  const ctl = new AbortController();
  const ms = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : TIMEOUT_MS;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, ms);
  try {
    let res;
    try {
      res = await fetchFn(URL, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal: ctl.signal });
    } catch (_) {
      throw fail(timedOut ? 'transcription timed out' : 'transcription failed (network)');
    }
    if (!res || !res.ok) throw fail(`transcription failed (HTTP ${res && res.status})`);
    let body;
    try { body = await res.json(); } catch (_) { throw fail(timedOut ? 'transcription timed out' : 'transcription reply unreadable'); }
    return normalize(body);
  } finally { clearTimeout(timer); }
}

module.exports = { transcribe, normalize, URL, TIMEOUT_MS };
