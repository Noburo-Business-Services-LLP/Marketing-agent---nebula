import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { languageGlyph, voiceName, voiceLine, SHAPE_CHOICES, partsLine, platformShort, tileColumns, YOURS_TITLE, YOURS_LINE } from '../utils/videoOptionTiles.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('each spoken language shows a sample of its own script; no speech shows the music note', () => {
  assert.equal(languageGlyph('english', 'English'), 'A');
  assert.equal(languageGlyph('tamil', 'Tamil'), 'த');
  assert.equal(languageGlyph('hindi', 'Hindi'), 'हि');
  for (const k of ['telugu', 'kannada', 'malayalam']) assert.ok(languageGlyph(k, k).length > 0, k);
  assert.equal(languageGlyph('none', 'No speech, music only'), null);
  assert.equal(languageGlyph('swahili', 'swahili'), 'S', 'an unknown language falls back to its first letter');
  assert.equal(languageGlyph('', ''), 'A');
});

test('voice, shape, length and platform words', () => {
  assert.equal(voiceName('female', 'Female voice'), 'Female');
  assert.equal(voiceName('male', 'Male voice'), 'Male');
  assert.equal(voiceName('robot', 'Robot'), 'Robot');
  assert.ok(voiceLine('female') && voiceLine('male'));
  assert.deepEqual(SHAPE_CHOICES.map((s) => [s.value, s.name, s.use]), [['9:16', 'Vertical', 'Reels, Shorts, Stories'], ['16:9', 'Wide', 'YouTube, websites, LinkedIn']]);
  assert.equal(partsLine(1), 'Made in one part');
  assert.equal(partsLine(3), 'Made in 3 parts');
  assert.equal(partsLine(0), 'Made in one part');
  assert.equal(platformShort('gmb', 'Google Business'), 'Google');
  assert.equal(platformShort('twitter', 'X'), 'X');
});

test('rows fill their width: equal columns, two across on a phone for four or more, icons stay one row', () => {
  assert.equal(tileColumns(4, false), 4);
  assert.equal(tileColumns(4, true), 2);
  assert.equal(tileColumns(7, true), 2);
  assert.equal(tileColumns(3, true), 3);
  assert.equal(tileColumns(2, true), 2);
  assert.equal(tileColumns(5, true, true), 5);
  assert.equal(tileColumns(0, false), 1);
});

test('the words follow the voice rules', () => {
  const all = [YOURS_TITLE, YOURS_LINE, voiceLine('female'), voiceLine('male'), partsLine(2), ...SHAPE_CHOICES.map((s) => s.use)].join(' ');
  assert.ok(!/\b(credit|trial|7 days)\b/i.test(all));
  assert.ok(!/[!—]/.test(all));
});

test('the Videos options keep every choice and send the same data', () => {
  const page = read('pages/CreateVideo.tsx');
  // Same state setters and the same payload as before the redesign.
  for (const s of ['onChange={setLanguage}', 'onChange={setVoice}', 'onToggle={togglePlatform}', 'pickShape(v as Shape)', 'setClips(Number(v))',
    'setTransition(transitionOf(v))', 'onChange={setSubtitles}', 'onChange={setWantLogo}', 'checked={wantLogo && hasLogo}', 'disabled={!hasLogo}',
    "language !== 'none' &&", 'showSubtitles(language) &&', 'showTransitions(clips) &&', 'isNewSpeech(language) &&', 'id="end-line"']) {
    assert.ok(page.includes(s), s);
  }
  assert.ok(page.includes("...finishPayload({ clips, language, transition, subtitles, logo: wantLogo, hasLogo, endLine })"), 'the payload is unchanged');
  assert.ok(page.includes('{lengthLine(seconds, clips)}') && page.includes('{priceLine &&') && page.includes('{shortMsg &&'), 'the length lines stay');
  assert.ok(!page.includes('type="checkbox"'), 'no bare checkboxes');
  assert.ok(page.includes('<h3 className="nb-vopt-divider"><span>{YOURS_TITLE}</span></h3>') && page.includes('{YOURS_LINE}'));
});

test('the option tiles are radio groups and switches with roving focus', () => {
  const src = read('components/video/VideoOptions.tsx');
  assert.ok(src.includes('role="radiogroup"') && src.includes('role="radio"') && src.includes('aria-checked={on}'));
  assert.ok(src.includes('role="switch"') && src.includes('aria-checked={checked}'));
  assert.ok(src.includes('aria-pressed={on}'), 'platforms are toggle buttons');
  assert.ok(src.includes('stepChoice(choices.length, i, e.key)'), 'arrow keys move and choose');
  const css = read('components/video/videoOptions.css');
  assert.ok(css.includes(':focus-visible'), 'visible focus');
  assert.ok(!/#1B2A4A|#0B1220|#14203A;?\s*}/i.test(css), 'no dark navy panel');
});
