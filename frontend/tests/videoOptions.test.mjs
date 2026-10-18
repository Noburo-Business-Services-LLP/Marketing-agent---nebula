import test from 'node:test';
import assert from 'node:assert/strict';
import * as v from '../utils/videoOptions.ts';

const shapes = { instagram: '9:16', facebook: '9:16', linkedin: '16:9', twitter: '9:16', youtube: '16:9' };

test('shape follows the platforms, vertical on a tie, null with none', () => {
  assert.equal(v.shapeForPlatforms(['instagram', 'facebook'], shapes), '9:16');
  assert.equal(v.shapeForPlatforms(['youtube', 'linkedin', 'instagram'], shapes), '16:9');
  assert.equal(v.shapeForPlatforms(['youtube', 'instagram'], shapes), '9:16');
  assert.equal(v.shapeForPlatforms([], shapes), null);
  assert.equal(v.shapeForPlatforms(['unknown'], shapes), null);
});

test('suggestion hint names the platforms that suit a shape', () => {
  const label = (id) => ({ instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube' }[id] || id);
  assert.equal(v.suggestionHint('9:16', ['instagram', 'facebook', 'youtube'], shapes, label), 'Suggested for Instagram and Facebook');
  assert.equal(v.suggestionHint('16:9', ['instagram'], shapes, label), '');
});

test('style tiles keep the default first and show the chosen one when collapsed', () => {
  const s = Array.from({ length: 22 }, (_, i) => ({ key: `s${i}` }));
  s[13] = { key: 'daily-life-vlog' };
  const ordered = v.orderStyles(s);
  assert.equal(ordered[0].key, 'daily-life-vlog');
  assert.equal(ordered.length, 22);
  assert.equal(new Set(ordered.map((x) => x.key)).size, 22);
  assert.equal(v.visibleStyles(ordered, 'daily-life-vlog', false).length, 8);
  assert.equal(v.visibleStyles(ordered, 'daily-life-vlog', true).length, 22);
  const shown = v.visibleStyles(ordered, 's20', false);
  assert.equal(shown.length, 8);
  assert.ok(shown.some((x) => x.key === 's20'));
});

test('image falls back to the svg of the same name once', () => {
  assert.equal(v.styleImageFallback('/assets/video-styles/a.jpg'), '/assets/video-styles/a.svg');
  assert.equal(v.styleImageFallback('/assets/video-styles/a.svg'), null);
});

test('only four languages carry the new speech note', () => {
  for (const l of ['hindi', 'telugu', 'kannada', 'malayalam']) assert.equal(v.isNewSpeech(l), true);
  for (const l of ['english', 'tamil', 'none']) assert.equal(v.isNewSpeech(l), false);
});

test('a short balance says how many parts it covers', () => {
  const o = { perClip: 100, clipSeconds: 10 };
  assert.equal(v.shortBalanceMessage({ ...o, balance: 1000, clips: 3 }), '');
  assert.match(v.shortBalanceMessage({ ...o, balance: 250, clips: 3 }), /enough for 2 parts \(20 seconds\)/);
  assert.match(v.shortBalanceMessage({ ...o, balance: 100, clips: 3 }), /enough for 1 part \(10 seconds\)/);
  assert.match(v.shortBalanceMessage({ ...o, balance: 40, clips: 1 }), /top up/);
  assert.equal(v.shortBalanceMessage({ ...o, balance: null, clips: 3 }), '');
  assert.equal(v.affordableClips(250, 100, 6), 2);
  assert.equal(v.affordableClips(9000, 100, 6), 6);
});

test('price line counts videos at the chosen length', () => {
  assert.equal(v.priceLine({ seconds: 30, clips: 3, total: 300, balance: 700 }), 'A 30 second video · you have enough for 2 videos like this');
  assert.equal(v.priceLine({ seconds: 10, clips: 1, total: 100, balance: 100 }), 'A 10 second video · you have enough for 1 video like this');
  assert.equal(v.priceLine({ seconds: 10, clips: 1, total: 100, balance: null }), 'A 10 second video');
  assert.equal(v.priceLine({ seconds: 10, clips: 1, total: 0, balance: 5 }), '');
  assert.equal(v.priceLine({ seconds: 30, clips: 3, total: 300, balance: 250 }), 'A 30 second video');
});

test('parts are padded or trimmed to the number of clips and edits stay local', () => {
  const fb = { beats: ['a', 'b'], spokenLine: 'hello' };
  const p = v.padParts([{ beats: ['x'], spokenLine: 'one' }], 3, fb);
  assert.equal(p.length, 3);
  assert.equal(p[0].spokenLine, 'one');
  assert.deepEqual(p[1].beats, ['a', 'b']);
  assert.equal(p[1].spokenLine, '');
  assert.equal(v.padParts([{ beats: [], spokenLine: 'x' }, { beats: [], spokenLine: 'y' }], 1).length, 1);
  const e = v.editPartLine(p, 1, 'new');
  assert.equal(e[1].spokenLine, 'new');
  assert.equal(p[1].spokenLine, '');
  assert.deepEqual(v.editPartBeats(p, 0, 'one\n\n two ')[0].beats, ['one', 'two']);
});

test('progress and change rules', () => {
  assert.equal(v.progressLabel(3, 0), 'Part 1 of 3');
  assert.equal(v.progressLabel(3, 1), 'Part 2 of 3');
  assert.equal(v.progressLabel(3, 9), 'Part 3 of 3');
  assert.equal(v.progressLabel(1, 0), '');
  assert.equal(v.canChange(10), true);
  assert.equal(v.canChange(20), false);
});

test('wording has no banned words and no Quarks', () => {
  const words = [v.NEW_SPEECH_NOTE, v.NO_CHANGE_NOTE, v.lengthLine(30, 3), v.lengthLine(10, 1),
    v.priceLine({ seconds: 30, clips: 3, total: 300, balance: 700 }),
    v.shortBalanceMessage({ balance: 50, perClip: 100, clips: 3, clipSeconds: 10 }),
    v.shortBalanceMessage({ balance: 250, perClip: 100, clips: 3, clipSeconds: 10 })].join(' ');
  assert.doesNotMatch(words, /credit|trial|7 days|quark|—/i);
});

test('server sentences with Quarks are put in plain words', () => {
  assert.equal(v.plainMessage('A 30 second video needs 480 Quarks. Please top up or choose a plan.'), 'You do not have enough left for this. Please top up or choose a plan.');
  assert.equal(v.plainMessage('The video could not be made. Your Quarks were returned.'), 'The video could not be made. You were not charged.');
  assert.equal(v.plainMessage('Plan the video first.'), 'Plan the video first.');
  assert.doesNotMatch(v.plainMessage('This needs 100 Quarks. Please top up.'), /quark/i);
});
