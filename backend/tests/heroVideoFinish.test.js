const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const fin = require('../services/heroVideoFinish');

const META = { width: 720, height: 1280, hasLogo: false, hasAudio: true, durationSeconds: 15 };
const ALL_OFF = { realism: false, brandMark: false, fades: false, captions: false, loudnorm: false, endCard: { enabled: false } };

test('normalizeFinishOptions defaults and caps', () => {
  const d = fin.normalizeFinishOptions(undefined);
  assert.equal(typeof d.realism, 'boolean');
  assert.deepEqual(Object.keys(d).sort(), ['brandMark', 'captions', 'endCard', 'fades', 'loudnorm', 'realism']);
  assert.deepEqual(fin.normalizeFinishOptions('x'), d);
  assert.deepEqual(fin.normalizeFinishOptions([1]), d);
  const o = fin.normalizeFinishOptions({ endCard: { enabled: 1, ctaText: ` ${'a'.repeat(200)} `, tagline: 'b'.repeat(200), website: 'javascript:x' }, realism: 0, fades: 'yes' });
  assert.equal(o.endCard.ctaText.length, 60);
  assert.equal(o.endCard.tagline.length, 80);
  assert.equal(o.endCard.website, '');
  assert.equal(o.endCard.enabled, true);
  assert.equal(o.realism, false);
  assert.equal(o.fades, true);
  assert.equal(fin.normalizeFinishOptions({ endCard: { website: 'gravity.nebulaa.ai' } }).endCard.website, 'gravity.nebulaa.ai');
  assert.equal(fin.normalizeFinishOptions({ endCard: { website: 'https://gravity.nebulaa.ai/x' } }).endCard.website, 'https://gravity.nebulaa.ai/x');
  assert.equal(fin.normalizeFinishOptions({ endCard: { website: 'http://a.com' } }).endCard.website, '');
});

test('buildCaptionsSrt makes cues only for quoted beats', () => {
  const beats = [
    { time: '0-3s', beat: 'Wide shot, she looks up.' },
    { time: '3-7s', beat: 'She says "I finally found it."' },
    { time: '7-11.5s', beat: 'Close on the screen.' },
    { time: '11.5-15s', beat: 'Smiling: "Try it today."' }
  ];
  const srt = fin.buildCaptionsSrt(beats, '');
  assert.equal(srt,
    '1\n00:00:03,000 --> 00:00:07,000\nI finally found it.\n\n2\n00:00:11,500 --> 00:00:15,000\nTry it today.\n');
  assert.equal(fin.buildCaptionsSrt([], ''), '');
  assert.equal(fin.buildCaptionsSrt('nope', 'x'), '');
});

test('buildFinishFilterGraph toggles', () => {
  const off = fin.buildFinishFilterGraph(ALL_OFF, META);
  assert.ok(!/fade=t=in|eq=|curves=|noise=|crop=|overlay/.test(off.videoFilter));
  assert.ok(!off.audioFilter.includes('loudnorm'));
  const on = fin.buildFinishFilterGraph({ ...ALL_OFF, realism: true, fades: true, loudnorm: true }, META);
  for (const s of ['eq=', 'curves=', 'noise=', 'crop=720:1280', 'fade=t=in']) assert.ok(on.videoFilter.includes(s), s);
  assert.ok(on.audioFilter.includes('loudnorm'));
  const fadesOnly = fin.buildFinishFilterGraph({ ...ALL_OFF, fades: true }, META);
  assert.ok(fadesOnly.videoFilter.includes('fade=t=in') && !fadesOnly.videoFilter.includes('crop='));
  const realOnly = fin.buildFinishFilterGraph({ ...ALL_OFF, realism: true }, META);
  assert.ok(!realOnly.videoFilter.includes('fade=t=in'));
  const logo = fin.buildFinishFilterGraph({ ...ALL_OFF, brandMark: true }, { ...META, hasLogo: true });
  assert.ok(logo.videoFilter.includes('overlay'));
  const noLogo = fin.buildFinishFilterGraph({ ...ALL_OFF, brandMark: true }, META);
  assert.ok(!noLogo.videoFilter.includes('overlay'));
  const evil = fin.buildFinishFilterGraph({ ...ALL_OFF, realism: true, endCard: { enabled: true, ctaText: "EVIL';rm", website: 'EVILSITE', tagline: 'EVILTAG' } }, META);
  assert.ok(!/EVIL/.test(evil.videoFilter + evil.audioFilter));
});

test('runFfmpeg rejects plainly on bad args and timeout', async () => {
  await assert.rejects(fin.runFfmpeg(['-i', '/no/such/file.mp4', '/no/out.mp4']), (e) => {
    assert.match(e.message, /could not be processed/i);
    assert.ok(!/ffmpeg/i.test(e.message));
    return true;
  });
  await assert.rejects(fin.runFfmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=600', '-f', 'null', '-'], { timeoutMs: 1 }),
    (e) => /could not be processed/i.test(e.message) && !/ffmpeg/i.test(e.message));
});

test('probeMedia reads a synthetic clip', async () => {
  const f = path.join(os.tmpdir(), `hero-finish-${process.pid}-${Date.now()}.mp4`);
  try {
    await fin.runFfmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
      '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', f]);
    const m = await fin.probeMedia(f);
    assert.equal(m.width, 720);
    assert.equal(m.height, 1280);
    assert.equal(m.hasAudio, true);
    assert.equal(m.fps, 24);
    assert.ok(m.durationSeconds > 1.5 && m.durationSeconds < 2.6);
    assert.equal(m.sampleRate, 44100);
  } finally { try { fs.unlinkSync(f); } catch (_) { /* gone */ } }
});

// ---------- Task 4 review follow-ups (Ruling 5) ----------

test('fade-out lands 0.4 s before the end only when the end card is off', () => {
  const opts = { ...ALL_OFF, fades: true, endCard: { enabled: false } };
  const g = fin.buildFinishFilterGraph(opts, META);
  assert.ok(g.videoFilter.includes('fade=t=out:st=14.600:d=0.4'), g.videoFilter);
  assert.ok(g.audioFilter.includes('afade=t=out:st=14.600:d=0.4'), g.audioFilter);
  const withCard = fin.buildFinishFilterGraph({ ...opts, endCard: { enabled: true } }, META);
  assert.ok(!withCard.videoFilter.includes('fade=t=out'));
  for (const d of [0, NaN, undefined, -3]) {
    const z = fin.buildFinishFilterGraph(opts, { ...META, durationSeconds: d });
    assert.ok(!z.videoFilter.includes('fade=t=out') && !z.audioFilter.includes('afade=t=out'), String(d));
  }
});

test('captions: curly quotes, several quotes, newlines inside a quote, malformed ranges', () => {
  const srt = fin.buildCaptionsSrt([
    { time: '0-2s', beat: 'He says “Hello there.” then "Bye."' },
    { time: '2-4s', beat: 'She says "line one\n\nline two"' },
    { time: '5-4s', beat: '"backwards"' },
    { time: 'abc', beat: '"no range"' },
    { time: null, beat: '"null"' },
    { time: '6-8s', beat: '""' }
  ], '');
  assert.equal(srt, '1\n00:00:00,000 --> 00:00:02,000\nHello there. Bye.\n\n2\n00:00:02,000 --> 00:00:04,000\nline one line two\n');
});

test('cleanWebsite rejects over-long strings instead of cutting them', () => {
  const long = `${'a'.repeat(195)}.com/${'b'.repeat(10)}`;
  assert.equal(fin.normalizeFinishOptions({ endCard: { website: `https://x.com/${'p'.repeat(200)}` } }).endCard.website, '');
  assert.equal(fin.normalizeFinishOptions({ endCard: { website: long } }).endCard.website, '');
});

// ---------- Task 5: end card, logo fetch, finishHeroClip ----------

const http = require('http');
const { createCanvas } = require('canvas');

function tmpName(ext) { return path.join(os.tmpdir(), `hero-t5-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`); }
function rm(f) { try { fs.rmSync(f, { recursive: true, force: true }); } catch (_) { /* gone */ } }
function pngSize(buf) { return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), sig: buf.slice(1, 4).toString() }; }
function smallPng() { const c = createCanvas(64, 32); const x = c.getContext('2d'); x.fillStyle = '#e11d48'; x.fillRect(0, 0, 64, 32); return c.toBuffer('image/png'); }

async function makeClip(file, { audio = true, seconds = 2 } = {}) {
  const args = ['-y', '-f', 'lavfi', '-i', `testsrc2=size=720x1280:rate=24:duration=${seconds}`];
  if (audio) args.push('-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=44100:duration=${seconds}`);
  args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p');
  if (audio) args.push('-c:a', 'aac', '-ac', '2');
  args.push(file);
  await fin.runFfmpeg(args);
}

test('renderEndCardPng renders the requested size for awkward text', async () => {
  const ctas = ['Visit us today', 'Say "hi"', 'Time: now', '100% free', "It's here", 'Go 🚀 now', 'x'.repeat(300), `${'word '.repeat(60)}`, ''];
  for (const ctaText of ctas) {
    const out = tmpName('.png');
    try {
      await fin.renderEndCardPng({ width: 720, height: 1280, ctaText, website: 'example.com', tagline: 'Fresh: 50% "off"', brandColor: '#ffcc00' }, out);
      const s = pngSize(fs.readFileSync(out));
      assert.deepEqual(s, { w: 720, h: 1280, sig: 'PNG' }, ctaText.slice(0, 20));
    } finally { rm(out); }
  }
  const out = tmpName('.png');
  try {
    await fin.renderEndCardPng({ width: 1280, height: 720, ctaText: 'Wide', website: '', tagline: '', logoBuffer: smallPng() }, out);
    assert.deepEqual(pngSize(fs.readFileSync(out)), { w: 1280, h: 720, sig: 'PNG' });
    await fin.renderEndCardPng({ width: 720, height: 1280, ctaText: 'Bad logo', logoBuffer: Buffer.from('not an image'), brandColor: 'red;}' }, out);
    assert.deepEqual(pngSize(fs.readFileSync(out)), { w: 720, h: 1280, sig: 'PNG' });
  } finally { rm(out); }
});

function listen(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}
const closeSrv = (srv) => new Promise((r) => srv.close(() => r()));
// Sends the request for a public-looking https URL to a local plain-http server instead (no live network).
const viaLocal = (port, p = '/') => (url, init) => fetch(`http://127.0.0.1:${port}${p}`, init);

test('fetchLogoBuffer returns null on every failure and a Buffer on success', async () => {
  let hits = 0;
  const srv = await listen((req, res) => {
    hits += 1;
    if (req.url === '/html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html></html>'); return; }
    if (req.url === '/big') {
      res.writeHead(200, { 'content-type': 'image/png' });
      const chunk = Buffer.alloc(256 * 1024, 1);
      res.on('error', () => {});
      for (let i = 0; i < 24; i += 1) res.write(chunk);
      res.end();
      return;
    }
    if (req.url === '/bigheader') { res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(6 * 1024 * 1024) }); res.end(); return; }
    if (req.url === '/redirect') { res.writeHead(302, { location: 'https://127.0.0.1/logo.png' }); res.end(); return; }
    res.writeHead(404); res.end();
  });
  const port = srv.address().port;
  try {
    assert.equal(await fin.fetchLogoBuffer(`http://127.0.0.1:${port}/logo.png`), null);
    assert.equal(await fin.fetchLogoBuffer('javascript:alert(1)'), null);
    assert.equal(await fin.fetchLogoBuffer(''), null);
    assert.equal(await fin.fetchLogoBuffer(undefined), null);
    assert.equal(hits, 0, 'non-https URLs must never be requested');
    assert.equal(await fin.fetchLogoBuffer('https://brand.example.com/html', viaLocal(port, '/html')), null);
    assert.equal(await fin.fetchLogoBuffer('https://brand.example.com/big', viaLocal(port, '/big')), null);
    assert.equal(await fin.fetchLogoBuffer('https://brand.example.com/bh', viaLocal(port, '/bigheader')), null);
    assert.equal(await fin.fetchLogoBuffer('https://brand.example.com/r', viaLocal(port, '/redirect')), null);
    assert.equal(await fin.fetchLogoBuffer('https://brand.example.com/missing', viaLocal(port, '/missing')), null);
    const dead = await listen(() => {});
    const deadPort = dead.address().port;
    await closeSrv(dead);
    assert.equal(await fin.fetchLogoBuffer('https://unreachable.example.com/logo.png', viaLocal(deadPort)), null);
    assert.equal(await fin.fetchLogoBuffer('https://brand.example.com/x', () => { throw new Error('boom'); }), null);
  } finally { await closeSrv(srv); }

  const png = smallPng();
  let seenUrl = null;
  const okFetch = async (url) => { seenUrl = url; return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } }); };
  const buf = await fin.fetchLogoBuffer('https://brand.example.com/logo.png', okFetch);
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.equals(png));
  assert.equal(seenUrl, 'https://brand.example.com/logo.png');
  // A redirect to another public https host is followed; one to a private host is not.
  const hop = async (url) => (url.includes('first')
    ? new Response(null, { status: 302, headers: { location: 'https://cdn.example.net/second.png' } })
    : new Response(png, { status: 200, headers: { 'content-type': 'image/png' } }));
  assert.ok(Buffer.isBuffer(await fin.fetchLogoBuffer('https://brand.example.com/first.png', hop)));
  const badHop = async () => new Response(null, { status: 301, headers: { location: 'https://10.0.0.5/x.png' } });
  assert.equal(await fin.fetchLogoBuffer('https://brand.example.com/first.png', badHop), null);
});

test('logo overlay graph executes on a synthetic clip', async () => {
  const clip = tmpName('.mp4');
  const logo = tmpName('.png');
  const out = tmpName('.mp4');
  try {
    await makeClip(clip, { audio: false });
    fs.writeFileSync(logo, smallPng());
    const g = fin.buildFinishFilterGraph({ ...ALL_OFF, brandMark: true, realism: true }, { width: 720, height: 1280, hasLogo: true, hasAudio: false, durationSeconds: 2 });
    await fin.runFfmpeg(['-y', '-i', clip, '-i', logo, '-filter_complex', g.videoFilter, '-map', '[vout]', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', out]);
    const m = await fin.probeMedia(out);
    assert.equal(m.width, 720);
    assert.equal(m.height, 1280);
  } finally { rm(clip); rm(logo); rm(out); }
});

test('finishHeroClip with defaults appends the end card', { timeout: 180000 }, async () => {
  const clip = tmpName('.mp4');
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hero-t5-out-'));
  const out = path.join(outDir, 'finished.mp4');
  try {
    await makeClip(clip);
    const r = await fin.finishHeroClip({
      inputPath: clip, outputPath: out,
      options: { endCard: { ctaText: 'Visit us today', website: 'example.com' } },
      brand: { name: 'Acme', color: '#1d4ed8' }
    });
    assert.equal(r.outputPath, out);
    const m = await fin.probeMedia(out);
    assert.equal(m.width, 720);
    assert.equal(m.height, 1280);
    assert.equal(m.fps, 24);
    assert.equal(m.hasAudio, true);
    assert.equal(m.sampleRate, 44100);
    assert.ok(Math.abs(m.durationSeconds - (2 + 2.0 - 0.4)) <= 0.1, `duration ${m.durationSeconds}`);
    assert.ok(Math.abs(r.durationSeconds - m.durationSeconds) <= 0.05);
    for (const s of ['realism', 'fades', 'loudnorm', 'endCard']) assert.ok(r.applied.includes(s), s);
    assert.ok(!r.applied.includes('brandMark'), 'no logo was given');
    assert.deepEqual(fs.readdirSync(outDir), ['finished.mp4']);
  } finally { rm(clip); rm(outDir); }
});

test('finishHeroClip: end card off keeps the length; captions and logo burn in', { timeout: 180000 }, async () => {
  const clip = tmpName('.mp4');
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hero-t5-out-'));
  try {
    await makeClip(clip);
    const a = path.join(outDir, 'a.mp4');
    const r1 = await fin.finishHeroClip({ inputPath: clip, outputPath: a, options: { endCard: { enabled: false } }, brand: { name: 'Acme' } });
    const m1 = await fin.probeMedia(a);
    assert.ok(Math.abs(m1.durationSeconds - 2) <= 0.1, `duration ${m1.durationSeconds}`);
    assert.ok(!r1.applied.includes('endCard'));
    const b = path.join(outDir, 'b.mp4');
    const png = smallPng();
    const fetchImpl = async () => new Response(png, { status: 200, headers: { 'content-type': 'image/png' } });
    const r2 = await fin.finishHeroClip({
      inputPath: clip, outputPath: b, fetchImpl,
      options: { captions: true, endCard: { ctaText: 'Say "hi": 100% 🚀' } },
      brand: { name: 'Acme', logoUrl: 'https://brand.example.com/logo.png' },
      beatSheet: [{ time: '0-1.5s', beat: 'She says "It\'s 100%: done, [really]; ok"' }]
    });
    for (const s of ['brandMark', 'captions', 'endCard']) assert.ok(r2.applied.includes(s), s);
    const m2 = await fin.probeMedia(b);
    assert.ok(Math.abs(m2.durationSeconds - 3.6) <= 0.1, `duration ${m2.durationSeconds}`);
  } finally { rm(clip); rm(outDir); }
});

test('finishHeroClip on a silent clip makes video only', { timeout: 180000 }, async () => {
  const clip = tmpName('.mp4');
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hero-t5-out-'));
  try {
    await makeClip(clip, { audio: false });
    const out = path.join(outDir, 'silent.mp4');
    const r = await fin.finishHeroClip({ inputPath: clip, outputPath: out, options: {}, brand: {} });
    const m = await fin.probeMedia(out);
    assert.equal(m.hasAudio, false);
    assert.ok(Math.abs(m.durationSeconds - 3.6) <= 0.1, `duration ${m.durationSeconds}`);
    assert.ok(!r.applied.includes('loudnorm'));
  } finally { rm(clip); rm(outDir); }
});

test('finishHeroClip rejects plainly and cleans up', { timeout: 60000 }, async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hero-t5-out-'));
  const clip = tmpName('.mp4');
  const plain = (e) => /could not be processed/i.test(e.message) && !/ffmpeg|ffprobe|canvas/i.test(e.message);
  const tmpBefore = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('hero-finish-')).length;
  try {
    await assert.rejects(fin.finishHeroClip({ inputPath: '/no/such/clip.mp4', outputPath: path.join(outDir, 'x.mp4') }), plain);
    await assert.rejects(fin.finishHeroClip({ inputPath: 42, outputPath: path.join(outDir, 'x.mp4') }), plain);
    await assert.rejects(fin.finishHeroClip({}), plain);
    await makeClip(clip);
    const t0 = Date.now();
    await assert.rejects(fin.finishHeroClip({ inputPath: clip, outputPath: path.join(outDir, 'y.mp4'), timeoutMs: 1 }), plain);
    assert.ok(Date.now() - t0 < 5000, 'timeout must be prompt');
    assert.deepEqual(fs.readdirSync(outDir), []);
    const tmpAfter = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('hero-finish-')).length;
    assert.ok(tmpAfter <= tmpBefore, 'work folders removed');
  } finally { rm(clip); rm(outDir); }
});
