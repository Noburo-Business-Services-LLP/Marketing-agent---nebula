/**
 * Longer videos: several 10 second clips made one after another, each continuing from the last frame of the one
 * before, then joined into one MP4. Everything that touches the network or ffmpeg arrives through `io`, so the
 * order of events can be tested without either. Never throws; returns a plain result.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const CLIP_SECONDS = 10;
const NO_FFMPEG = 'Longer videos need a video tool that is not available right now.';

function ffmpegPath() {
  try { return require('ffmpeg-static'); } catch (_) { return null; }
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const bin = ffmpegPath();
    if (!bin) return reject(Object.assign(new Error('ffmpeg missing'), { code: 'NO_FFMPEG' }));
    let err = '';
    const child = spawn(bin, ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr.on('data', (d) => { err += d.toString().slice(0, 2000); });
    child.on('error', (e) => reject(e));
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.slice(-300)}`))));
  });
}

async function withTemp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nebula-chain-'));
  try { return await fn(dir); } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* temp */ } }
}

/** The last frame of a clip as a PNG buffer. */
async function lastFrame(buffer, io = {}) {
  const run = io.ffmpeg || runFfmpeg;
  return withTemp(async (dir) => {
    const input = path.join(dir, 'in.mp4'); const out = path.join(dir, 'last.png');
    fs.writeFileSync(input, buffer);
    await run(['-sseof', '-0.3', '-i', input, '-update', '1', '-frames:v', '1', out]);
    const png = fs.readFileSync(out);
    if (!png.length) throw new Error('empty frame');
    return png;
  });
}

/** Joins clips into one MP4 (re-encoded h264/aac, audio kept). Clips are brought to one size and frame rate first. */
function concatArgs(files, aspectRatio, out) {
  const w = aspectRatio === '16:9' ? 1280 : 720; const h = aspectRatio === '16:9' ? 720 : 1280;
  const inputs = files.flatMap((f) => ['-i', f]);
  const prep = files.map((_, i) => `[${i}:v:0]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24[v${i}];[${i}:a:0]aresample=44100,aformat=channel_layouts=stereo[a${i}]`);
  const join = files.map((_, i) => `[v${i}][a${i}]`).join('');
  const graph = `${prep.join(';')};${join}concat=n=${files.length}:v=1:a=1[v][a]`;
  return [...inputs, '-filter_complex', graph, '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out];
}

async function concat(buffers, aspectRatio, io = {}) {
  if (buffers.length === 1) return buffers[0];
  const run = io.ffmpeg || runFfmpeg;
  return withTemp(async (dir) => {
    const files = buffers.map((b, i) => { const f = path.join(dir, `c${i}.mp4`); fs.writeFileSync(f, b); return f; });
    const out = path.join(dir, 'all.mp4');
    await run(concatArgs(files, aspectRatio, out));
    return fs.readFileSync(out);
  });
}

const frameFailure = (e) => (e && e.code === 'NO_FFMPEG' ? NO_FFMPEG : 'The next part of the video could not be started.');

/**
 * Makes `total` clips in order.
 *   prompts[k]  the full prompt for clip k (clips after the first already start with the continuation sentence)
 *   io.generate({ prompt, references, aspectRatio }) -> { ok, buffer, message, retryable }
 *   io.lastFrame(buffer) -> PNG buffer     io.concat(buffers, aspectRatio) -> buffer
 *   io.onClip(done)  called after each clip is made
 * Result: { ok:true, buffer, made, total, message } or { ok:false, made:0, message }.
 * made < total means a shorter video is returned and the caller refunds the rest.
 */
async function makeChain({ prompts, references = [], aspectRatio = '9:16' }, io = {}) {
  const total = prompts.length;
  const generate = io.generate;
  const frameOf = io.lastFrame || ((b) => lastFrame(b));
  const join = io.concat || ((bufs, ar) => concat(bufs, ar));
  const made = [];
  let stopMessage = '';
  for (let k = 0; k < total; k += 1) {
    let refs = references;
    if (k > 0) {
      try {
        const png = await frameOf(made[k - 1]);
        refs = [{ mimeType: 'image/png', data: Buffer.from(png).toString('base64') }, ...references];
      } catch (e) {
        stopMessage = frameFailure(e);
        break;
      }
    }
    let out = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      out = await generate({ prompt: prompts[k], references: refs, aspectRatio, clip: k + 1 });
      if (out && out.ok) break;
      if (out && out.retryable === false) break; // a refused idea is not retried
    }
    if (!out || !out.ok) { stopMessage = (out && out.message) || 'A clip could not be made.'; break; }
    made.push(out.buffer);
    if (io.onClip) { try { await io.onClip(made.length); } catch (_) { /* progress is best effort */ } }
  }
  if (!made.length) return { ok: false, made: 0, total, message: stopMessage || 'The video could not be made this time.' };
  let buffer = made[0]; let count = made.length;
  if (made.length > 1) {
    try { buffer = await join(made, aspectRatio); } catch (e) {
      // The pieces could not be joined: keep the first one rather than nothing.
      buffer = made[0]; count = 1; stopMessage = stopMessage || 'The clips could not be joined.';
    }
  }
  return { ok: true, buffer, made: count, total, message: count < total ? stopMessage : '' };
}

module.exports = { makeChain, lastFrame, concat, concatArgs, runFfmpeg, ffmpegPath, CLIP_SECONDS, NO_FFMPEG };
