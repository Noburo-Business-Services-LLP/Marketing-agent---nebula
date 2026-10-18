/**
 * ONE owner-approved real Whisper call, to prove the subtitle timing on a real video file. About one cent.
 *
 *   OPENAI_API_KEY=... I_APPROVED_ONE_WHISPER_CALL=yes node scripts/subtitle-real-proof.js <video.mp4> [--language ta] [--line "the intended spoken line"]
 *
 * What it does: extracts the audio of the file (mono 16 kHz m4a, like the app), sends it to OpenAI whisper-1 ONCE through
 * the same function the app uses (services/studioTranscribe.js, no retry), then works out the speech window and, when
 * --line is given, how closely the heard words match the line (the same similarity score the app uses to skip captions).
 * No database, no spend guard, no .env: the key is taken from the OPENAI_API_KEY of this one command only.
 * It prints only counts, times and the similarity score; of the transcript it shows at most the first 20 characters of each
 * segment. A sanitised result file (same limits) is saved and its path printed. It refuses to run without the approval flag,
 * for a missing file, or for audio over 90 seconds. A second call in the same run is blocked.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_SECONDS = 90;
const LANGS = ['en', 'hi', 'ta', 'te', 'kn', 'ml'];
const clip20 = (t) => Array.from(String(t || '').trim()).slice(0, 20).join('');

function parseArgs(argv) {
  const o = { file: '', language: null, line: '' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--language') { o.language = argv[i + 1] || ''; i += 1; }
    else if (argv[i] === '--line') { o.line = argv[i + 1] || ''; i += 1; }
    else if (!o.file) o.file = argv[i];
  }
  return o;
}

async function main(argv, deps = {}) {
  const env = deps.env || process.env;
  const out = deps.log || ((...a) => console.log(...a));
  const err = deps.err || ((...a) => console.error(...a));
  if (env.I_APPROVED_ONE_WHISPER_CALL !== 'yes') {
    err('Refusing to run: this makes ONE real, paid Whisper call (about one cent). Start it with I_APPROVED_ONE_WHISPER_CALL=yes');
    return 2;
  }
  const a = parseArgs(argv);
  if (!a.file || !fs.existsSync(a.file)) { err('Give the path of a video file that exists, for example: node scripts/subtitle-real-proof.js my-video.mp4 --language ta'); return 2; }
  if (a.language !== null && !LANGS.includes(a.language)) { err(`--language must be one of: ${LANGS.join(', ')} (or leave it out to let Whisper decide)`); return 2; }
  if (!env.OPENAI_API_KEY) { err('OPENAI_API_KEY is not set for this command: no call was made.'); return 3; }

  const hero = deps.hero || require('../services/heroVideoFinish');
  const timing = require('../services/studioSubtitleTiming');
  const costs = require('../config/apiCosts');
  const { transcriptionUnits } = require('../services/studioVideoFinish');

  const meta = await hero.probeMedia(a.file);
  const seconds = meta.durationSeconds || meta.videoDurationSeconds || 0;
  if (!(seconds > 0) || seconds > MAX_SECONDS) { err(`The file must be between 0 and ${MAX_SECONDS} seconds long (this one is ${seconds.toFixed ? seconds.toFixed(1) : seconds}).`); return 2; }
  if (meta.hasAudio === false) { err('The file has no audio track: nothing to transcribe, no call made.'); return 2; }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subtitle-proof-'));
  try {
    const audio = path.join(dir, 'audio.m4a');
    await hero.runFfmpeg(['-y', '-nostdin', '-hide_banner', '-i', a.file, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'aac', '-b:a', '32k', audio], { timeoutMs: 60000 });
    const units = transcriptionUnits(seconds);
    const estimate = units * costs.ACTION_USD.studio_transcription;
    out(`Video: ${seconds.toFixed(1)} s. Audio extracted (${fs.statSync(audio).size} bytes). About to make ONE Whisper call, estimated USD ${estimate.toFixed(4)} (${units} blocks of ${costs.STUDIO_TRANSCRIBE_BLOCK_SECONDS} s).`);

    let calls = 0;
    const real = deps.transcribe || ((f, l) => require('../services/studioTranscribe').transcribe(f, l, { env }));
    const once = async (f, l) => { calls += 1; if (calls > 1) throw new Error('SECOND CALL BLOCKED'); return real(f, l); };
    let t;
    try { t = await once(audio, a.language); } catch (e) { err(`The call failed (${String(e && e.message).slice(0, 60)}). Nothing was retried.`); return 4; }

    const segs = (t.segments || []);
    const win = timing.speechWindows({ segments: segs, words: t.words, starts: [0], total: seconds })[0];
    const sim = a.line && win ? timing.similarity(a.line, win.heard) : null;
    out(`Segments: ${segs.length}. Words with times: ${(t.words || []).length}.`);
    segs.forEach((s, i) => out(`  segment ${i + 1}: ${Number(s.start).toFixed(2)} to ${Number(s.end).toFixed(2)} s  "${clip20(s.text)}"`));
    if (win) out(`Speech window: ${win.start.toFixed(2)} to ${win.end.toFixed(2)} s (captions would show only inside it).`);
    else out('No speech window found: the app would skip subtitles and show the "could not time" note.');
    if (sim !== null) out(`Similarity of the heard words to the line: ${sim.toFixed(2)} (the app skips subtitles below ${timing.MIN_SIMILARITY}).${sim < timing.MIN_SIMILARITY ? ' This would be skipped.' : ' This would be kept.'}`);

    const result = {
      file: path.basename(a.file), seconds: Math.round(seconds * 10) / 10, language: a.language, calls, estimatedUsd: Math.round(estimate * 1e6) / 1e6,
      window: win ? { start: win.start, end: win.end } : null, similarity: sim === null ? null : Math.round(sim * 1000) / 1000, minSimilarity: timing.MIN_SIMILARITY,
      segments: segs.map((s) => ({ start: s.start, end: s.end, first20: clip20(s.text) })), wordCount: (t.words || []).length
    };
    const file = path.join(os.tmpdir(), `subtitle-real-proof-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(result, null, 2));
    out(`Saved the sanitised result (times and the first 20 characters of each segment only): ${file}`);
    out('Done. One call made.');
    return 0;
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* temp */ } }
}

module.exports = { main, parseArgs, clip20 };

if (require.main === module) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error('The proof stopped:', String(e && e.message).slice(0, 80)); process.exit(1); });
}
