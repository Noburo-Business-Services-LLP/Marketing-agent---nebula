/**
 * Hero Studio: server-side finishing core (options, captions, filter graph, process runner, probe).
 * Imports with no side effects, no Mongo and no network at load time.
 * Only fixed, validated values ever enter a filter string; user text reaches the video only through
 * the canvas-rendered end card image and the captions SRT file (both at server-generated paths).
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dns = require('dns');
const net = require('net');
const https = require('https');
const { Readable } = require('stream');
const { isPublicHttpsUrl, isPublicIp } = require('./heroVideoService');

const PROCESS_ERROR = 'The video could not be processed.';
const DEFAULT_TIMEOUT_MS = 180000;
const FADE_IN_S = 0.3;
const FADE_OUT_S = 0.4;
const LOUDNORM = 'loudnorm=I=-16:TP=-1.5:LRA=11';
const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const HTTPS_RE = /^https:\/\/(?=.{1,253}(?:[/?#:]|$))(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::\d{1,5})?(?:[/?#]\S{0,200})?$/i;

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const bool = (v, dflt) => (v === undefined || v === null ? dflt : !!v);

function cleanWebsite(v) {
  if (typeof v !== 'string' || v.trim().length > 200) return '';
  const s = v.trim();
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
    const line = (m[1] || m[2]).replace(/\s+/g, ' ').trim();
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
  if (o.loudnorm && m.hasAudio !== false) a.push(LOUDNORM);

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

async function probeMedia(filePath, opts = {}) {
  if (typeof filePath !== 'string' || !filePath) throw plainError('bad path');
  const out = await runProcess(resolveFfprobePath(),
    ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', filePath],
    { timeoutMs: opts.timeoutMs || 30000, collect: true });
  let j;
  try { j = JSON.parse(out); } catch (e) { throw plainError('unreadable probe output'); }
  const streams = Array.isArray(j.streams) ? j.streams : [];
  const vs = streams.find((s) => s.codec_type === 'video');
  const as = streams.find((s) => s.codec_type === 'audio');
  if (!vs) throw plainError('no video stream');
  const dur = parseFloat((j.format && j.format.duration) || vs.duration || 0);
  const vdur = parseFloat(vs.duration || 0);
  const adur = as ? parseFloat(as.duration || 0) : 0;
  return {
    width: vs.width,
    height: vs.height,
    fps: parseFps(vs.avg_frame_rate || vs.r_frame_rate),
    durationSeconds: Number.isFinite(dur) ? dur : 0,
    hasAudio: !!as,
    sampleRate: as ? parseInt(as.sample_rate, 10) || 0 : 0,
    channels: as ? parseInt(as.channels, 10) || 0 : 0,
    frameRate: String(vs.avg_frame_rate || vs.r_frame_rate || ''),
    audioDurationSeconds: Number.isFinite(adur) && adur > 0 ? adur : 0,
    videoDurationSeconds: Number.isFinite(vdur) && vdur > 0 ? vdur : (Number.isFinite(dur) ? dur : 0)
  };
}

// ---------------------------------------------------------------------------
// Brand mark fetch
// ---------------------------------------------------------------------------

const LOGO_MAX_BYTES = 5 * 1024 * 1024;
const LOGO_TIMEOUT_MS = 10000;
const LOGO_MAX_REDIRECTS = 3;

async function cancelBody(res) {
  try { if (res && res.body && typeof res.body.cancel === 'function') await res.body.cancel(); } catch (_) { /* ignore */ }
}

async function readCapped(res, cap) {
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    const parts = [];
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.byteLength;
      if (n > cap) { try { await reader.cancel(); } catch (_) { /* ignore */ } return null; }
      parts.push(Buffer.from(value));
    }
    return Buffer.concat(parts);
  }
  const ab = await res.arrayBuffer();
  return ab.byteLength > cap ? null : Buffer.from(ab);
}

// Resolves a host and returns ONE address to connect to, or null when the host is unresolvable or ANY of
// its addresses is not public (so a mixed answer cannot be used to slip through).
async function resolvePublicAddress(host, lookup) {
  const list = await lookup(host);
  if (!Array.isArray(list) || !list.length) return null;
  const addrs = list.map((x) => (x && typeof x === 'object' ? x.address : x));
  if (!addrs.every((a) => isPublicIp(a))) return null;
  return addrs[0];
}

// One GET over https/http that connects to `address` (already validated) regardless of what DNS says now,
// while TLS (SNI), certificate checks and the Host header still use the real hostname. DNS rebinding cannot
// swap the target after the check. Returns a standard Response; redirects are NOT followed.
function pinnedFetch(url, init, address, transport = https) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { reject(e); return; }
    const family = address.includes(':') ? 6 : 4;
    const signal = init && init.signal;
    const req = transport.request({
      protocol: u.protocol, hostname: u.hostname, port: u.port || undefined, path: `${u.pathname}${u.search}`,
      method: 'GET', headers: { ...(init && init.headers), host: u.host },
      servername: net.isIP(u.hostname) ? undefined : u.hostname,
      lookup: (h, o, cb) => (o && o.all ? cb(null, [{ address, family }]) : cb(null, address, family)),
      signal
    }, (res) => {
      const headers = new Headers();
      for (const [k, v] of Object.entries(res.headers)) if (typeof v === 'string') headers.set(k, v); else if (Array.isArray(v)) headers.set(k, v.join(', '));
      const bodyless = res.statusCode < 200 || res.statusCode === 204 || res.statusCode === 304 || (res.statusCode >= 300 && res.statusCode < 400);
      if (bodyless) res.resume();
      resolve(new Response(bodyless ? null : Readable.toWeb(res), { status: res.statusCode, headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

const defaultLookup = (host) => dns.promises.lookup(host, { all: true, verbatim: true });

/**
 * Downloads a brand logo. Public https only. Every hop (the first URL and each redirect, followed by hand)
 * is resolved, rejected unless every address is public, and then connected to at the checked address.
 * 10 s, 5 MB, image/* only. Resolves null on any failure; never throws.
 * `opts.lookup` (async host -> [{address}]) and `fetchImpl` are test seams for server code only; with an
 * injected `fetchImpl` the request is made by that function (no pinning), so production never passes one.
 */
async function fetchLogoBuffer(url, fetchImpl, opts = {}) {
  const f = typeof fetchImpl === 'function' ? fetchImpl : null;
  if (!isPublicHttpsUrl(url)) return null;
  const lookup = typeof opts.lookup === 'function' ? opts.lookup : defaultLookup;
  const ms = Math.min(LOGO_TIMEOUT_MS, opts.timeoutMs > 0 ? opts.timeoutMs : LOGO_TIMEOUT_MS);
  const ctrl = new AbortController();
  const aborted = new Promise((_, rej) => ctrl.signal.addEventListener('abort', () => rej(new Error('aborted'))));
  aborted.catch(() => {});
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    let current = url.trim();
    for (let hop = 0; hop <= LOGO_MAX_REDIRECTS; hop += 1) {
      if (!isPublicHttpsUrl(current)) return null;
      const host = new URL(current).hostname.toLowerCase().replace(/\.$/, '');
      const address = await Promise.race([resolvePublicAddress(host, lookup), aborted]);
      if (!address) return null;
      const init = { redirect: 'manual', signal: ctrl.signal, headers: { accept: 'image/*' } };
      const res = await Promise.race([f ? f(current, init) : pinnedFetch(current, init, address), aborted]);
      if (!res || !res.headers || typeof res.headers.get !== 'function') return null;
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        await cancelBody(res);
        if (!loc) return null;
        try { current = new URL(loc, current).toString(); } catch (_) { return null; }
        continue;
      }
      const type = String(res.headers.get('content-type') || '').toLowerCase();
      const len = Number(res.headers.get('content-length'));
      if (!res.ok || !type.startsWith('image/') || (Number.isFinite(len) && len > LOGO_MAX_BYTES)) {
        await cancelBody(res);
        return null;
      }
      const buf = await Promise.race([readCapped(res, LOGO_MAX_BYTES), aborted]);
      return buf && buf.length ? buf : null;
    }
    return null;
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// End card (node-canvas)
// ---------------------------------------------------------------------------

const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
const FONT_FILE = path.join(FONT_DIR, 'Inter-Bold.ttf');
let cardFamily = null;

function endCardFamily() {
  if (cardFamily) return cardFamily;
  cardFamily = 'sans-serif';
  try {
    if (fs.existsSync(FONT_FILE)) {
      require('canvas').registerFont(FONT_FILE, { family: 'HeroCardInter', weight: 'bold' });
      cardFamily = '"HeroCardInter", sans-serif';
    }
  } catch (_) { /* fall back to the default sans */ }
  return cardFamily;
}

function cleanCardText(v, max) {
  if (typeof v !== 'string') return '';
  const s = v.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(s).slice(0, max).join('');
}

function parseHexColor(v) {
  const m = typeof v === 'string' ? v.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i) : null;
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

const rgb = (c, k = 1) => `rgb(${c.map((x) => Math.round(x * k)).join(',')})`;

function wrapText(ctx, text, maxW) {
  const lines = [];
  let cur = '';
  for (const word of text.split(' ').filter(Boolean)) {
    const tryLine = cur ? `${cur} ${word}` : word;
    if (ctx.measureText(tryLine).width <= maxW) { cur = tryLine; continue; }
    if (cur) lines.push(cur);
    cur = '';
    if (ctx.measureText(word).width <= maxW) { cur = word; continue; }
    for (const ch of Array.from(word)) {
      if (cur && ctx.measureText(cur + ch).width > maxW) { lines.push(cur); cur = ch; } else cur += ch;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Largest size whose wrapped lines fit maxW x maxH; at the minimum size, extra lines are cut with an ellipsis.
function fitText(ctx, text, { family, maxW, maxH, maxLines, startPx, minPx, gap = 1.2 }) {
  const lo = Math.max(8, Math.round(minPx));
  for (let px = Math.round(startPx); px >= lo; px -= 2) {
    ctx.font = `bold ${px}px ${family}`;
    const lines = wrapText(ctx, text, maxW);
    if (lines.length <= maxLines && lines.length * px * gap <= maxH) return { px, lines };
  }
  ctx.font = `bold ${lo}px ${family}`;
  let lines = wrapText(ctx, text, maxW);
  const cap = Math.max(1, Math.min(maxLines, Math.floor(maxH / (lo * gap))));
  if (lines.length > cap) {
    lines = lines.slice(0, cap);
    let last = Array.from(lines[cap - 1]);
    while (last.length && ctx.measureText(`${last.join('')}…`).width > maxW) last.pop();
    lines[cap - 1] = `${last.join('')}…`;
  }
  return { px: lo, lines };
}

const LOGO_MAX_PIXELS = 40e6;

// Reads width/height from the PNG, JPEG, WebP or GIF header without decoding. null when not recognised.
function readImageDimensions(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 24) return null;
  if (buf.readUInt32BE(0) === 0x89504e47 && buf.toString('latin1', 12, 16) === 'IHDR') {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.toString('latin1', 0, 3) === 'GIF') return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  if (buf.length >= 30 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    const kind = buf.toString('latin1', 12, 16);
    if (kind === 'VP8X') return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
    if (kind === 'VP8 ' && buf.length >= 30) return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (kind === 'VP8L') {
      const bits = buf.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    return null;
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i += 1; continue; }
      const m = buf[i + 1];
      if (m === 0xff) { i += 1; continue; }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      const len = buf.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      }
      i += 2 + len;
    }
  }
  return null;
}

async function loadLogoImage(buf) {
  if (!Buffer.isBuffer(buf) || !buf.length || buf.length > LOGO_MAX_BYTES) return null;
  const dim = readImageDimensions(buf);
  if (dim && !(dim.width > 0 && dim.height > 0 && dim.width * dim.height <= LOGO_MAX_PIXELS)) return null;
  try {
    const img = await require('canvas').loadImage(buf);
    if (!(img.width > 0 && img.height > 0) || img.width * img.height > LOGO_MAX_PIXELS) return null;
    return img;
  } catch (_) {
    return null;
  }
}

// Re-encodes any decodable logo as a PNG no larger than 512 px, so ffmpeg only ever sees a plain PNG.
async function normalizeLogo(buf) {
  endCardFamily();
  const img = await loadLogoImage(buf);
  if (!img) return null;
  const k = Math.min(1, 512 / Math.max(img.width, img.height));
  const w = Math.max(2, Math.round(img.width * k));
  const h = Math.max(2, Math.round(img.height * k));
  const c = require('canvas').createCanvas(w, h);
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  return c.toBuffer('image/png');
}

async function renderEndCardPng(spec, outPath) {
  const s = isObj(spec) ? spec : {};
  const W = Number.isFinite(s.width) && s.width >= 16 && s.width <= 4096 ? Math.floor(s.width) : 0;
  const H = Number.isFinite(s.height) && s.height >= 16 && s.height <= 4096 ? Math.floor(s.height) : 0;
  if (!W || !H || typeof outPath !== 'string' || !outPath) throw plainError('bad end card size');
  const family = endCardFamily();
  const { createCanvas } = require('canvas');
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const unit = Math.min(W, H);

  const brand = parseHexColor(s.brandColor);
  const grad = ctx.createLinearGradient(0, 0, W * 0.3, H);
  if (brand) { grad.addColorStop(0, rgb(brand)); grad.addColorStop(1, rgb(brand, 0.55)); } else { grad.addColorStop(0, '#1f2937'); grad.addColorStop(1, '#0b1220'); }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  const lum = brand ? (0.2126 * brand[0] + 0.7152 * brand[1] + 0.0722 * brand[2]) / 255 : 0;
  const ink = lum > 0.62 ? '17,24,39' : '255,255,255';

  const portrait = H >= W;
  let top = H * (portrait ? 0.3 : 0.22);
  const logo = await loadLogoImage(s.logoBuffer);
  if (logo) {
    const k = Math.min((W * 0.42) / logo.width, (H * (portrait ? 0.14 : 0.22)) / logo.height);
    const lw = logo.width * k;
    const lh = logo.height * k;
    const ly = H * (portrait ? 0.2 : 0.12);
    ctx.drawImage(logo, (W - lw) / 2, ly, lw, lh);
    top = ly + lh + unit * 0.08;
  }

  const maxW = W * 0.84;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const blocks = [];
  const cta = cleanCardText(s.ctaText, 300);
  if (cta) blocks.push({ ...fitText(ctx, cta, { family, maxW, maxH: H * 0.3, maxLines: 5, startPx: unit * 0.11, minPx: unit * 0.045 }), alpha: 1 });
  const site = cleanCardText(s.website, 200);
  if (site) blocks.push({ ...fitText(ctx, site, { family, maxW, maxH: unit * 0.08, maxLines: 1, startPx: unit * 0.055, minPx: unit * 0.03 }), alpha: 0.85 });
  const tag = cleanCardText(s.tagline, 200);
  if (tag) blocks.push({ ...fitText(ctx, tag, { family, maxW, maxH: unit * 0.12, maxLines: 2, startPx: unit * 0.042, minPx: unit * 0.028 }), alpha: 0.7 });

  const gapBetween = unit * 0.05;
  const heights = blocks.map((b) => b.lines.length * b.px * 1.2);
  const total = heights.reduce((x, y) => x + y, 0) + gapBetween * Math.max(0, blocks.length - 1);
  const bottom = H * 0.88;
  let y = Math.max(top, top + (bottom - top - total) / 2);
  blocks.forEach((b, i) => {
    ctx.font = `bold ${b.px}px ${family}`;
    ctx.fillStyle = `rgba(${ink},${b.alpha})`;
    b.lines.forEach((line, j) => ctx.fillText(line, W / 2, y + (j + 0.5) * b.px * 1.2));
    y += heights[i] + gapBetween;
  });

  await fs.promises.writeFile(outPath, canvas.toBuffer('image/png'));
}

// ---------------------------------------------------------------------------
// finishHeroClip
// ---------------------------------------------------------------------------

const END_CARD_S = 2.0;
const XFADE_S = 0.4;
const FINISH_TIMEOUT_MS = 120000;
const CAPTION_STYLE = 'FontName=Inter,Bold=1,FontSize=13,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=1.5,Shadow=0,Alignment=2,MarginV=36';

/**
 * Escapes a value for an ffmpeg filter option inside a -filter_complex graph: first for the option
 * parser (\ ' :), then for the graph parser (\ ' [ ] , ;). Used for server-generated paths and fixed styles.
 */
function escapeFilterValue(v) {
  const level1 = String(v).replace(/[\\':]/g, (m) => `\\${m}`);
  return level1.replace(/[\\'[\],;]/g, (m) => `\\${m}`);
}

const even = (n) => Math.max(2, Math.floor(n / 2) * 2);
const displayWebsite = (w) => String(w || '').replace(/^https:\/\//i, '').replace(/\/$/, '');

async function finishInner(args, timeoutMs) {
  const { inputPath, outputPath, options, brand, beatSheet, dialogue, fetchImpl } = args;
  const deadline = Date.now() + timeoutMs;
  const left = () => {
    const ms = deadline - Date.now();
    if (ms <= 0) throw plainError('timed out');
    return ms;
  };
  if (typeof inputPath !== 'string' || !inputPath || typeof outputPath !== 'string' || !outputPath) throw plainError('bad paths');
  let work = null;
  let partial = null;
  try {
    const st = await fs.promises.stat(inputPath).catch(() => null);
    if (!st || !st.isFile()) throw plainError('input missing');
    const outDir = path.dirname(path.resolve(outputPath));
    const ost = await fs.promises.stat(outDir).catch(() => null);
    if (!ost || !ost.isDirectory()) throw plainError('output folder missing');
    left();
    work = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'hero-finish-'));

    const meta = await probeMedia(inputPath, { timeoutMs: left() });
    const vdur = meta.videoDurationSeconds;
    if (!(vdur > XFADE_S + 0.1) || !(meta.width > 0 && meta.height > 0)) throw plainError('clip too short or unreadable');
    const W = even(meta.width);
    const H = even(meta.height);
    const fps = /^\d+\/[1-9]\d*$/.test(meta.frameRate || '') && meta.fps > 0 && meta.fps <= 120 ? meta.frameRate : '24';
    const opts = normalizeFinishOptions(options);
    const b = isObj(brand) ? brand : {};
    const applied = [];

    let logoPng = null;
    if ((opts.brandMark || opts.endCard.enabled) && typeof b.logoUrl === 'string' && b.logoUrl) {
      const raw = await fetchLogoBuffer(b.logoUrl, fetchImpl, { timeoutMs: left(), lookup: args.lookup });
      if (raw) logoPng = await normalizeLogo(raw);
    }
    left();

    const inputs = ['-i', inputPath];
    const markOn = opts.brandMark && !!logoPng;
    if (markOn) {
      const logoFile = path.join(work, 'logo.png');
      await fs.promises.writeFile(logoFile, logoPng);
      inputs.push('-i', logoFile);
    }
    const g = buildFinishFilterGraph({ ...opts, loudnorm: false }, { width: W, height: H, hasLogo: markOn, hasAudio: meta.hasAudio, durationSeconds: vdur });
    if (opts.realism) applied.push('realism');
    if (markOn) applied.push('brandMark');
    if (opts.fades) applied.push('fades');

    const parts = [markOn ? g.videoFilter.replace('[vout]', '[vg]') : `[0:v]${g.videoFilter}[vg]`];
    let cur = 'vg';
    if (opts.captions) {
      const srt = buildCaptionsSrt(beatSheet, dialogue);
      if (srt) {
        const srtFile = path.join(work, 'captions.srt');
        await fs.promises.writeFile(srtFile, srt, 'utf8');
        parts.push(`[${cur}]subtitles=filename=${escapeFilterValue(srtFile)}:fontsdir=${escapeFilterValue(FONT_DIR)}:force_style=${escapeFilterValue(CAPTION_STYLE)}[vcap]`);
        cur = 'vcap';
        applied.push('captions');
      }
    }
    parts.push(`[${cur}]scale=${W}:${H},setsar=1,fps=${fps},format=yuv420p[vm]`);

    const cardOn = opts.endCard.enabled;
    if (cardOn) {
      const cardFile = path.join(work, 'card.png');
      await renderEndCardPng({
        width: W,
        height: H,
        ctaText: opts.endCard.ctaText || str(b.name, 60),
        website: displayWebsite(opts.endCard.website || cleanWebsite(b.website)),
        tagline: opts.endCard.tagline,
        logoBuffer: logoPng,
        brandColor: b.color
      }, cardFile);
      left();
      inputs.push('-loop', '1', '-framerate', fps, '-t', END_CARD_S.toFixed(1), '-i', cardFile);
      parts.push(`[${markOn ? 2 : 1}:v]scale=${W}:${H},setsar=1,fps=${fps},format=yuv420p[vcard]`);
      parts.push(`[vm][vcard]xfade=transition=fade:duration=${XFADE_S}:offset=${(vdur - XFADE_S).toFixed(3)}[vout]`);
    } else {
      parts.push('[vm]null[vout]');
    }

    const sr = [44100, 48000].includes(meta.sampleRate) ? meta.sampleRate : 48000;
    const cl = meta.channels === 1 ? 'mono' : 'stereo';
    const afmt = `aformat=sample_fmts=fltp:sample_rates=${sr}:channel_layouts=${cl}`;
    if (meta.hasAudio) {
      parts.push(`[0:a]${g.audioFilter},${afmt},apad,atrim=end=${vdur.toFixed(3)},asetpts=PTS-STARTPTS[am]`);
      let a = 'am';
      if (cardOn) {
        parts.push(`anullsrc=r=${sr}:cl=${cl},atrim=end=${END_CARD_S.toFixed(1)},${afmt}[abed]`);
        parts.push(`[am][abed]acrossfade=d=${XFADE_S}:c1=tri:c2=tri[ax]`);
        a = 'ax';
      }
      parts.push(`[${a}]${opts.loudnorm ? `${LOUDNORM},` : ''}aresample=${sr},${afmt}[aout]`);
      if (opts.loudnorm) applied.push('loudnorm');
    }
    if (cardOn) applied.push('endCard');

    partial = path.join(outDir, `.hero-finish-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`);
    const ff = ['-y', '-nostdin', '-hide_banner', ...inputs, '-filter_complex', parts.join(';'), '-map', '[vout]'];
    if (meta.hasAudio) ff.push('-map', '[aout]', '-c:a', 'aac', '-b:a', '192k', '-ar', String(sr));
    else ff.push('-an');
    ff.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', fps, '-movflags', '+faststart', '-f', 'mp4', partial);
    await runFfmpeg(ff, { timeoutMs: left() });
    const out = await probeMedia(partial, { timeoutMs: left() });
    left();
    await fs.promises.rename(partial, outputPath);
    partial = null;
    return { outputPath, durationSeconds: out.durationSeconds, applied };
  } catch (e) {
    throw e && e.message === PROCESS_ERROR ? e : plainError(e && e.message);
  } finally {
    if (partial) await fs.promises.rm(partial, { force: true }).catch(() => {});
    if (work) await fs.promises.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Finishes a hero clip: grade, brand mark, fades, optional captions, loudness, then a 2.0 s end card
 * joined by a 0.4 s crossfade (video and audio). Rejects with a plain message on any failure or once
 * `timeoutMs` (default 120 s) has passed; temp files are always removed and the output appears atomically.
 */
function finishHeroClip(args) {
  const a = isObj(args) ? args : {};
  const timeoutMs = Number.isFinite(a.timeoutMs) && a.timeoutMs > 0 ? a.timeoutMs : FINISH_TIMEOUT_MS;
  let timer = null;
  // Backstop only: every step inside already runs against the same deadline.
  const guard = new Promise((_, reject) => { timer = setTimeout(() => reject(plainError('timed out')), timeoutMs + 5000); });
  return Promise.race([finishInner(a, timeoutMs), guard]).finally(() => clearTimeout(timer));
}

module.exports = {
  normalizeFinishOptions, buildCaptionsSrt, buildFinishFilterGraph,
  resolveFfmpegPath, runFfmpeg, probeMedia,
  fetchLogoBuffer, renderEndCardPng, readImageDimensions, loadLogoImage, _pinnedFetch: pinnedFetch, finishHeroClip, escapeFilterValue
};
