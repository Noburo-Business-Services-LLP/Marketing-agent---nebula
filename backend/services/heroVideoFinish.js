/**
 * Hero Studio: server-side finishing core (options, captions, filter graph, process runner, probe).
 * Imports with no side effects, no Mongo and no network. The end card and finishHeroClip arrive in a later task.
 * Only fixed, validated values ever enter a filter string; user text never does.
 */
const { spawn } = require('child_process');

const PROCESS_ERROR = 'The video could not be processed.';
const DEFAULT_TIMEOUT_MS = 180000;
const FADE_IN_S = 0.3;
const FADE_OUT_S = 0.4;
const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const HTTPS_RE = /^https:\/\/(?=.{1,253}(?:[/?#:]|$))(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::\d{1,5})?(?:[/?#]\S{0,200})?$/i;

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const bool = (v, dflt) => (v === undefined || v === null ? dflt : !!v);

function cleanWebsite(v) {
  const s = str(v, 200);
  if (!s || /\s/.test(s)) return '';
  return HOST_RE.test(s) || HTTPS_RE.test(s) ? s : '';
}

function normalizeFinishOptions(raw) {
  const r = isObj(raw) ? raw : {};
  const e = isObj(r.endCard) ? r.endCard : {};
  return {
    realism: bool(r.realism, true),
    brandMark: bool(r.brandMark, true),
    fades: bool(r.fades, true),
    endCard: {
      enabled: bool(e.enabled, true),
      ctaText: str(e.ctaText, 60),
      website: cleanWebsite(e.website),
      tagline: str(e.tagline, 80)
    },
    captions: bool(r.captions, false),
    loudnorm: bool(r.loudnorm, true)
  };
}

function srtTime(sec) {
  const total = Math.max(0, Math.round(sec * 1000));
  const p = (n, w) => String(n).padStart(w, '0');
  return `${p(Math.floor(total / 3600000), 2)}:${p(Math.floor(total / 60000) % 60, 2)}:${p(Math.floor(total / 1000) % 60, 2)},${p(total % 1000, 3)}`;
}

function parseRange(time) {
  const m = typeof time === 'string' ? time.match(/(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)/) : null;
  if (!m) return null;
  const a = parseFloat(m[1]);
  const b = parseFloat(m[2]);
  return b > a ? { a, b } : null;
}

function quotedLines(text) {
  const out = [];
  const re = /"([^"]+)"|“([^”]+)”/g;
  let m;
  while ((m = re.exec(String(text || '')))) {
    const line = (m[1] || m[2]).trim();
    if (line) out.push(line);
  }
  return out;
}

// Cue text comes from the quoted spoken line inside each beat; `dialogue` is accepted for the
// signature but not needed, since each beat already carries its own line.
function buildCaptionsSrt(beatSheet, dialogue) { // eslint-disable-line no-unused-vars
  if (!Array.isArray(beatSheet)) return '';
  const cues = [];
  for (const b of beatSheet) {
    if (!isObj(b)) continue;
    const range = parseRange(b.time);
    const lines = quotedLines(b.beat);
    if (!range || !lines.length) continue;
    cues.push(`${cues.length + 1}\n${srtTime(range.a)} --> ${srtTime(range.b)}\n${lines.join(' ')}\n`);
  }
  return cues.join('\n');
}

const int = (v, dflt) => (Number.isFinite(v) && v >= 2 && v <= 8192 ? Math.floor(v) : dflt);

/**
 * Without a logo, videoFilter is a plain -vf chain ("null" when nothing applies).
 * With hasLogo and brandMark, videoFilter is a -filter_complex graph: input 0 is the clip, input 1 is the
 * logo image, and the result is labelled [vout]. The logo is overlaid after the grade so it does not sway.
 */
function buildFinishFilterGraph(options, meta) {
  const o = normalizeFinishOptions(options);
  const m = isObj(meta) ? meta : {};
  const W = int(m.width, 720) - (int(m.width, 720) % 2);
  const H = int(m.height, 1280) - (int(m.height, 1280) % 2);
  const dur = Number.isFinite(m.durationSeconds) && m.durationSeconds > 1 ? m.durationSeconds : 0;
  const hasEndCard = o.endCard.enabled;
  const v = [];
  if (o.realism) {
    v.push(
      'eq=contrast=0.90:saturation=0.92:gamma=1.03',
      "curves=all='0/0.02 1/0.98'",
      'unsharp=5:5:-0.35:5:5:0',
      'noise=alls=4:allf=t',
      'scale=trunc(iw*1.05/2)*2:trunc(ih*1.05/2)*2',
      `crop=${W}:${H}:x='(iw-${W})/2+sin(2*PI*t*1.3)*7+sin(2*PI*t*3.1)*2.5':y='(ih-${H})/2+cos(2*PI*t*1.1)*7+cos(2*PI*t*2.7)*2.5'`
    );
  }
  const a = [];
  if (o.fades) {
    v.push(`fade=t=in:st=0:d=${FADE_IN_S}`);
    a.push(`afade=t=in:st=0:d=${FADE_IN_S}`);
    if (!hasEndCard && dur) {
      const st = (dur - FADE_OUT_S).toFixed(3);
      v.push(`fade=t=out:st=${st}:d=${FADE_OUT_S}`);
      a.push(`afade=t=out:st=${st}:d=${FADE_OUT_S}`);
    }
  }
  if (o.loudnorm && m.hasAudio !== false) a.push('loudnorm=I=-16:TP=-1.5:LRA=11');

  let videoFilter;
  if (o.brandMark && m.hasLogo) {
    const lw = Math.max(2, Math.floor((W * 0.14) / 2) * 2);
    const pad = Math.round(W * 0.04);
    const chain = v.length ? v.join(',') : 'null';
    videoFilter = `[0:v]${chain}[v0];[1:v]format=rgba,scale=${lw}:-2,colorchannelmixer=aa=0.65[lg];[v0][lg]overlay=x=W-w-${pad}:y=${pad}[vout]`;
  } else {
    videoFilter = v.length ? v.join(',') : 'null';
  }
  return { videoFilter, audioFilter: a.length ? a.join(',') : 'anull' };
}

function resolveFfmpegPath() {
  return require('ffmpeg-static');
}

function resolveFfprobePath() {
  return require('ffprobe-static').path;
}

function plainError(detail) {
  const err = new Error(PROCESS_ERROR);
  Object.defineProperty(err, 'detail', { value: String(detail || '').slice(-1500), enumerable: false });
  return err;
}

function runProcess(bin, args, { timeoutMs = DEFAULT_TIMEOUT_MS, collect = false } = {}) {
  return new Promise((resolve, reject) => {
    if (!Array.isArray(args) || args.some((x) => typeof x !== 'string')) return reject(plainError('bad arguments'));
    let child;
    let settled = false;
    let out = '';
    let errTail = '';
    let timer = null;
    const done = (fn, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(val);
    };
    try {
      child = spawn(bin, args, { stdio: ['ignore', collect ? 'pipe' : 'ignore', 'pipe'] });
    } catch (e) {
      return reject(plainError(e && e.message));
    }
    timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (_) { /* already gone */ }
      done(reject, plainError('timed out'));
    }, Math.max(1, timeoutMs));
    if (collect) child.stdout.on('data', (d) => { out += d; if (out.length > 1e6) out = out.slice(-1e6); });
    child.stderr.on('data', (d) => { errTail = (errTail + d).slice(-2000); });
    child.on('error', (e) => done(reject, plainError(e && e.message)));
    child.on('close', (code) => (code === 0 ? done(resolve, out) : done(reject, plainError(`exit ${code}: ${errTail}`))));
  });
}

async function runFfmpeg(args, opts = {}) {
  await runProcess(resolveFfmpegPath(), args, { timeoutMs: opts.timeoutMs });
}

function parseFps(s) {
  const [n, d] = String(s || '').split('/').map(Number);
  return n && d ? Math.round((n / d) * 100) / 100 : (n || 0);
}

async function probeMedia(filePath) {
  if (typeof filePath !== 'string' || !filePath) throw plainError('bad path');
  const out = await runProcess(resolveFfprobePath(),
    ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', filePath], { timeoutMs: 30000, collect: true });
  let j;
  try { j = JSON.parse(out); } catch (e) { throw plainError('unreadable probe output'); }
  const streams = Array.isArray(j.streams) ? j.streams : [];
  const vs = streams.find((s) => s.codec_type === 'video');
  const as = streams.find((s) => s.codec_type === 'audio');
  if (!vs) throw plainError('no video stream');
  const dur = parseFloat((j.format && j.format.duration) || vs.duration || 0);
  return {
    width: vs.width,
    height: vs.height,
    fps: parseFps(vs.avg_frame_rate || vs.r_frame_rate),
    durationSeconds: Number.isFinite(dur) ? dur : 0,
    hasAudio: !!as,
    sampleRate: as ? parseInt(as.sample_rate, 10) || 0 : 0
  };
}

module.exports = {
  normalizeFinishOptions, buildCaptionsSrt, buildFinishFilterGraph,
  resolveFfmpegPath, runFfmpeg, probeMedia
};
