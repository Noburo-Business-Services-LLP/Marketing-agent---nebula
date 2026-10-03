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
