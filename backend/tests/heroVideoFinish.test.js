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
  const drawn = tmpName('.png');
  try {
    await fin.renderEndCardPng({ width: 360, height: 640, ctaText: 'Visit us today', website: 'example.com', tagline: '', brandColor: '#1d4ed8' }, drawn);
    const img = await require('canvas').loadImage(drawn);
    const c = createCanvas(360, 640); const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, 360, 640).data;
    // Text is lighter than the dark brand backdrop: some pixel in the middle band must differ strongly from the corner.
    let differing = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - d[0]) + Math.abs(d[i + 1] - d[1]) + Math.abs(d[i + 2] - d[2]) > 200) differing += 1;
    assert.ok(differing > 200, `text must really be drawn (differing pixels: ${differing})`);
  } finally { rm(drawn); }
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
// Injected resolver (the production seam is opts.lookup; request data can never reach it).
const lookupTo = (...addrs) => async () => addrs.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
const PUB = { lookup: lookupTo('93.184.216.34') };

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
    assert.equal(await fin.fetchLogoBuffer('https://brand.example.com/html', viaLocal(port, '/html'), PUB), null);
    assert.equal(await fin.fetchLogoBuffer('https://brand.example.com/big', viaLocal(port, '/big'), PUB), null);
    assert.equal(await fin.fetchLogoBuffer('https://brand.example.com/bh', viaLocal(port, '/bigheader'), PUB), null);
    assert.equal(await fin.fetchLogoBuffer('https://brand.example.com/r', viaLocal(port, '/redirect'), PUB), null);
    assert.equal(await fin.fetchLogoBuffer('https://brand.example.com/missing', viaLocal(port, '/missing'), PUB), null);
    const dead = await listen(() => {});
    const deadPort = dead.address().port;
    await closeSrv(dead);
    assert.equal(await fin.fetchLogoBuffer('https://unreachable.example.com/logo.png', viaLocal(deadPort), PUB), null);
    assert.equal(await fin.fetchLogoBuffer('https://brand.example.com/x', () => { throw new Error('boom'); }, PUB), null);
  } finally { await closeSrv(srv); }

  const png = smallPng();
  let seenUrl = null;
  const okFetch = async (url) => { seenUrl = url; return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } }); };
  const buf = await fin.fetchLogoBuffer('https://brand.example.com/logo.png', okFetch, PUB);
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.equals(png));
  assert.equal(seenUrl, 'https://brand.example.com/logo.png');
  // A redirect to another public https host is followed; one to a private host is not.
  const hop = async (url) => (url.includes('first')
    ? new Response(null, { status: 302, headers: { location: 'https://cdn.example.net/second.png' } })
    : new Response(png, { status: 200, headers: { 'content-type': 'image/png' } }));
  assert.ok(Buffer.isBuffer(await fin.fetchLogoBuffer('https://brand.example.com/first.png', hop, PUB)));
  const badHop = async () => new Response(null, { status: 301, headers: { location: 'https://10.0.0.5/x.png' } });
  assert.equal(await fin.fetchLogoBuffer('https://brand.example.com/first.png', badHop, PUB), null);
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
    assert.ok(m.audioDurationSeconds > 0, 'audio stream duration is probed');
    assert.ok(Math.abs(m.audioDurationSeconds - m.videoDurationSeconds) <= 0.05, `audio ${m.audioDurationSeconds} vs video ${m.videoDurationSeconds}`);
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
      inputPath: clip, outputPath: b, fetchImpl, lookup: PUB.lookup,
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


// ---------- Task 5 fix round 1 ----------

test('fetchLogoBuffer resolves the host and rejects non-public addresses (every hop)', async () => {
  const png = smallPng();
  let calls = 0;
  const okFetch = async () => { calls += 1; return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } }); };
  const U = 'https://brand.example.com/logo.png';
  for (const bad of ['10.0.0.5', '169.254.169.254', '127.0.0.1', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:10.0.0.5', '::ffff:7f00:1', 'ff02::1']) {
    assert.equal(await fin.fetchLogoBuffer(U, okFetch, { lookup: lookupTo(bad) }), null, bad);
  }
  assert.equal(calls, 0, 'nothing may be requested for a rejected address');
  assert.equal(await fin.fetchLogoBuffer(U, okFetch, { lookup: lookupTo('93.184.216.34', '10.0.0.5') }), null, 'mixed answer');
  assert.equal(await fin.fetchLogoBuffer(U, okFetch, { lookup: async () => [] }), null, 'no answer');
  assert.equal(await fin.fetchLogoBuffer(U, okFetch, { lookup: async () => { throw new Error('ENOTFOUND'); } }), null, 'lookup failure');
  assert.equal(await fin.fetchLogoBuffer('https://127.0.0.1.nip.io/x.png', okFetch, { lookup: lookupTo('127.0.0.1') }), null, 'nip.io style');
  assert.ok(Buffer.isBuffer(await fin.fetchLogoBuffer(U, okFetch, { lookup: lookupTo('93.184.216.34') })));
  assert.ok(Buffer.isBuffer(await fin.fetchLogoBuffer(U, okFetch, { lookup: lookupTo('2606:2800:220:1:248:1893:25c8:1946') })));
  // A redirect hop whose name resolves privately is refused even though its text looks public.
  const lookup = async (h) => [{ address: h === 'internal-name.example.net' ? '10.1.2.3' : '93.184.216.34', family: 4 }];
  const hop = async (url) => (url.includes('first')
    ? new Response(null, { status: 302, headers: { location: 'https://internal-name.example.net/second.png' } })
    : new Response(png, { status: 200, headers: { 'content-type': 'image/png' } }));
  assert.equal(await fin.fetchLogoBuffer('https://brand.example.com/first.png', hop, { lookup }), null);
  // Default resolver (real DNS, no network needed): a literal private IP never gets that far.
  assert.equal(await fin.fetchLogoBuffer('https://10.0.0.5/x.png', okFetch), null);
});

test('pinned fetch connects to the validated address, not a fresh DNS answer', async () => {
  let seenHost = null;
  const srv = await listen((req, res) => { seenHost = req.headers.host; res.writeHead(200, { 'content-type': 'image/png' }); res.end(smallPng()); });
  const port = srv.address().port;
  try {
    const res = await fin._pinnedFetch(`http://brand.example.com:${port}/a.png`, { headers: { accept: 'image/*' } }, '127.0.0.1', http);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.ok((await res.arrayBuffer()).byteLength > 0);
    assert.equal(seenHost, `brand.example.com:${port}`);
  } finally { await closeSrv(srv); }
});

test('image-bomb headers are rejected before decode', async () => {
  const hdr = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(hdr, 0);
  hdr.writeUInt32BE(13, 8); hdr.write('IHDR', 12, 'ascii'); hdr.writeUInt32BE(30000, 16); hdr.writeUInt32BE(30000, 20);
  assert.deepEqual(fin.readImageDimensions(hdr), { width: 30000, height: 30000 });
  assert.equal(await fin.loadLogoImage(hdr), null);
  assert.deepEqual(fin.readImageDimensions(smallPng()), { width: 64, height: 32 });
  const c = createCanvas(40, 20); c.getContext('2d').fillRect(0, 0, 40, 20);
  assert.deepEqual(fin.readImageDimensions(c.toBuffer('image/jpeg')), { width: 40, height: 20 });
  const webp = Buffer.alloc(30); webp.write('RIFF', 0); webp.write('WEBP', 8); webp.write('VP8X', 12);
  webp.writeUIntLE(29999, 24, 3); webp.writeUIntLE(29999, 27, 3);
  assert.deepEqual(fin.readImageDimensions(webp), { width: 30000, height: 30000 });
  assert.equal(await fin.loadLogoImage(webp), null);
  assert.ok(await fin.loadLogoImage(smallPng()));
});

test('finishHeroClip timeout during a slow logo fetch cleans the work folder and partials', { timeout: 60000 }, async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hero-t5-out-'));
  const clip = tmpName('.mp4');
  const countWork = () => fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('hero-finish-') && !n.endsWith('.mp4')).length;
  const before = countWork();
  try {
    await makeClip(clip);
    const slow = (url, init) => new Promise((resolve, reject) => {
      const t = setTimeout(() => resolve(new Response(smallPng(), { status: 200, headers: { 'content-type': 'image/png' } })), 20000);
      if (init && init.signal) init.signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); });
    });
    const t0 = Date.now();
    await assert.rejects(fin.finishHeroClip({
      inputPath: clip, outputPath: path.join(outDir, 'z.mp4'), timeoutMs: 300, fetchImpl: slow, lookup: PUB.lookup,
      brand: { logoUrl: 'https://brand.example.com/logo.png' }
    }), (e) => /could not be processed/i.test(e.message) && !/ffmpeg|ffprobe|canvas|timed out/i.test(e.message));
    assert.ok(Date.now() - t0 < 5000, 'prompt');
    assert.deepEqual(fs.readdirSync(outDir), [], 'no partial output left');
    assert.ok(countWork() <= before, 'work folder removed');
  } finally { rm(clip); rm(outDir); }
});
