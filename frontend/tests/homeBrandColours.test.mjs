// Owner requests of 2026-10-19: Home is light all the way through (no dark navy panel, no dark blue), the Home idea box
// looks like Create content's, and competitors show their picture (our stored copy) or initials.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { avatarView, AVATAR_TONES } from '../utils/competitorsHome.ts';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const lum = (hex) => {
  const n = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// Navy and dark blues the app used before (ink #14203A, its hover #22304F, the blue marks and the Scheduled chip).
const NAVY = /#14203A|#22304F|#1B2A4A|#1F5487|#23609B|rgb\(20 32 58|rgba\(20, ?32, ?58/i;

test('Home, the competitor tiles and the draft sheet have no navy or dark blue left', () => {
  for (const f of ['components/home/home.css', 'components/home/draftSheet.css', 'components/CompetitorTiles.css', 'components/ideaBox.css', 'components/home/HomeBlocks.tsx', 'components/home/DraftSheet.tsx', 'components/CompetitorTiles.tsx', 'components/CompetitorAvatar.tsx']) {
    assert.doesNotMatch(read(f), NAVY, f);
  }
  const blocks = read('components/home/HomeBlocks.tsx');
  assert.doesNotMatch(blocks, /nb-darkpanel|data-nb-surface="dark"/, 'Do this next is no longer a dark panel');
  assert.match(blocks, /className="nb-home-next"/);
  assert.match(read('components/home/home.css'), /\.nb-home \{[^}]*--gv-text-primary: #2B1D0E/, 'Home text is brown ink');
});

test('the Do this next card and the draft sheet keep AA contrast (computed)', () => {
  const cream = ['#FFF9EC', '#FFF1D2']; // both ends of the card's gradient
  const pairs = [
    ['#2B1D0E', 'heading and titles'], ['#5E4A31', 'detail line'], ['#8A5200', 'eyebrow'], ['#6B4A1C', '"5 things"'], ['#4F3F2B', 'empty line'],
  ];
  for (const bg of cream) for (const [fg, what] of pairs) assert.ok(ratio(fg, bg) >= 4.5, `${what} ${ratio(fg, bg).toFixed(2)} on ${bg}`);
  assert.ok(ratio('#6B3F00', '#FFE2A1') >= 4.5, 'numbered badge and count');
  assert.ok(ratio('#1A1208', '#F5A623') >= 4.5, 'gold primary button and first badge');
  assert.ok(ratio('#2B1D0E', '#FFFFFF') >= 4.5, 'quiet buttons');
  assert.ok(ratio('#7A4A00', '#FFF1D2') >= 3, 'focus ring on the card');
  assert.ok(ratio('#7A4A00', '#FFFDF8') >= 3, 'focus ring on the page');
  assert.ok(ratio('#5C3600', '#FFF0C7') >= 4.5, 'chosen tone in the sheet');
  assert.ok(ratio('#7A4A00', '#FFF0C7') >= 4.5, 'Scheduled chip');
  assert.ok(ratio('#8A4A0B', '#FFE9CC') >= 4.5, 'messages mark');
  const sheet = read('components/home/draftSheet.css');
  assert.match(sheet, /\.nb-hd-btn\[data-primary="true"\] \{ border-color: #F5A623; background: #F5A623; color: #1A1208; \}/, 'one gold primary button');
});

test('the Home idea box uses the shared idea box classes and opts out of the app-wide field border', () => {
  const blocks = read('components/home/HomeBlocks.tsx');
  assert.match(blocks, /import '\.\.\/ideaBox\.css'/);
  assert.match(blocks, /className="nb-home-describe nb-ideabox"/);
  assert.match(blocks, /className="nb-ideabox-field gravity-bare"/);
  const css = read('components/ideaBox.css');
  // the same values as Create content's idea box
  assert.match(css, /border-radius: 12px; border: 1px solid var\(--gv-border-default\); background: var\(--gv-panel\)/);
  assert.match(css, /:focus-within \{ border-color: var\(--gv-accent\); box-shadow: 0 0 0 3px rgb\(var\(--gv-accent-rgb\) \/ 0\.10\)/);
  assert.match(css, /placeholder[^{]*\{ color: var\(--gv-text-muted\)/);
  const create = read('pages/GravityCreate.tsx');
  assert.match(create, /rounded-xl border border-\[var\(--gv-border-default\)\] bg-\[var\(--gv-panel\)\]/, 'Create still uses the values the shared class copies');
  assert.doesNotMatch(read('components/home/home.css'), /\.nb-home-describe \{[^}]*border:/, 'Home draws no border of its own');
});

const STORED = 'https://res.cloudinary.com/demo/image/upload/v1760000000/nebula-competitor-avatars/64b7f0c2a1b2c3d4e5f60718.webp';

test('competitor picture: only our stored copy is loaded, else initials; the colour is stable per handle', () => {
  assert.equal(avatarView('Sweet Co Bakery', 'sweetco', STORED).src, STORED);
  for (const bad of [null, undefined, '', 'https://scontent.cdninstagram.com/v/x.jpg', 'http://res.cloudinary.com/demo/image/upload/v1/nebula-competitor-avatars/a.webp',
    'https://res.cloudinary.com/demo/image/upload/v1/nebula-campaign-posts/a.jpg', `${STORED}?x=1`, 'javascript:alert(1)', 'data:image/png;base64,AAAA']) {
    assert.equal(avatarView('Sweet Co', 'sweetco', bad).src, null, String(bad));
  }
  assert.equal(avatarView('Sweet Co Bakery', 'sweetco', null).initials, 'SC');
  assert.equal(avatarView('crumbandco', 'crumbandco', null).initials, 'C');
  assert.equal(avatarView('  ', '', null).initials, 'C');
  assert.equal(avatarView('Ārya Sweets', 'arya', null).initials, 'ĀS');
  assert.equal(avatarView('Sweet Co', 'sweetco', null).alt, '@sweetco');
  assert.equal(avatarView('Sweet Co', '', null).alt, 'Sweet Co');
  const a = avatarView('Sweet Co', 'sweetco', null).tone;
  assert.equal(avatarView('Another Name', '@SweetCo', null).tone, a, 'same handle, same colour');
  const tones = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'].map((h) => avatarView('X', `shop${h}`, null).tone));
  assert.ok(tones.size >= 3, 'handles spread over the colours');
  for (const [bg, fg] of AVATAR_TONES) assert.ok(ratio(fg, bg) >= 4.5, `${fg} on ${bg}`);
  // the CSS uses the same pairs
  const css = read('components/CompetitorTiles.css');
  AVATAR_TONES.forEach(([bg, fg], i) => assert.match(css, new RegExp(`\\.nb-cav\\[data-tone="${i}"\\] \\{ background: ${bg}; color: ${fg}; \\}`)));
});

test('the picture is lazy, has the handle as its text, falls back to initials on error, and shows in tiles and the sheet header', () => {
  const comp = read('components/CompetitorAvatar.tsx');
  assert.match(comp, /loading="lazy"/);
  assert.match(comp, /alt=\{v\.alt\}/);
  assert.match(comp, /onError=\{\(\) => setBroken\(true\)\}/);
  assert.match(comp, /referrerPolicy="no-referrer"/);
  assert.match(read('components/CompetitorTiles.tsx'), /<CompetitorAvatar name=\{v\.name\} handle=\{card\.handle\} url=\{card\.avatarUrl\} \/>/);
  assert.match(read('components/home/DraftSheet.tsx'), /<CompetitorAvatar name=\{source\.name\} handle=\{source\.handle\} url=\{source\.avatarUrl\} \/>/);
});
