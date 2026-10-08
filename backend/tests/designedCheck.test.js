const test = require('node:test');
const assert = require('node:assert');
const { buildStyleSpec, buildPagePrompt } = require('../services/blueprint/designedPrompt');
const { matchTranscript, pageAccepted } = require('../services/blueprint/designedCheck');

test('the style paragraph carries the brand colours and forbids celebrity faces', () => {
  const s = buildStyleSpec({ businessName: 'Bean Co', industry: 'coffee', colours: [{ hex: '#1f7a7a' }, '#D4A017', 'red'] });
  assert.match(s, /#1f7a7a, #D4A017/); assert.doesNotMatch(s, /red/); assert.match(s, /coffee/); assert.match(s, /Never a celebrity/);
});

test('the page prompt prints exactly the planned lines, reserves the logo corner and forbids drawing a logo', () => {
  const p = buildPagePrompt({ kind: 'content', title: 'Content pillars', kicker: 'The themes your content returns to.', lines: ['Origin stories', 'Shows where the beans come from'], visual: 'three icon cards' }, 'STYLE');
  for (const s of ['STYLE', '"Origin stories"', '"Shows where the beans come from"', 'Content pillars', 'three icon cards', 'top-left corner', 'Do not draw any logo']) assert.ok(p.includes(s), s);
  assert.match(buildPagePrompt({ kind: 'cover', title: 'Bean Co', kicker: 'Brand Growth Blueprint', lines: [] }, 'S'), /COVER PAGE/);
  assert.match(buildPagePrompt({ kind: 'closing', title: 'Thank you', kicker: 'x', lines: ['a@b.ai'] }, 'S'), /CLOSING PAGE/);
});

test('transcript matching tolerates case, punctuation and spacing', () => {
  const m = matchTranscript(['Origin stories', 'Meet the farm behind your cup'], 'ORIGIN  STORIES!  meet the farm, behind your cup.');
  assert.equal(m.coverage, 1); assert.deepEqual(m.missing, []); assert.ok(pageAccepted(m));
});

test('missing lines are reported and a page below 75 percent is refused', () => {
  const m = matchTranscript(['One idea here', 'Two idea there', 'Three more words', 'Four last words'], 'one idea here two idea there');
  assert.equal(m.coverage, 0.5); assert.equal(m.missing.length, 2); assert.equal(pageAccepted(m), false);
});

test('an invented price or count fails the page, a planned one and small day numbers do not', () => {
  assert.deepEqual(matchTranscript(['Offer, Rs 24,999'], 'offer rs 24,999 day 7 of 30').invented, []);
  const bad = matchTranscript(['Offer, Rs 24,999'], 'offer rs 24,999 and 12,500 off, 500 customers');
  assert.deepEqual(bad.invented.sort(), ['12500', '500']);
  assert.equal(pageAccepted(bad), false);
});

test('a page with no planned lines passes on coverage', () => {
  assert.equal(matchTranscript([], 'anything').coverage, 1);
});

const { rejectionNote } = require('../services/blueprint/designedCheck');

test('words that are not in the Blueprint fail the page (found in the real test run: "Affluent audience", "Trusted brand")', () => {
  const lines = ['Your shop is known for honest prices on daily-use items', 'Customers ask most about steel and copper cookware'];
  const transcript = [
    'WHAT CAN BE CONFIRMED ABOUT YOUR BUSINESS TODAY', 'Where you are today',
    'HOME GOODS', 'AFFLUENT AUDIENCE', 'TRUSTED BRAND', 'STEADY GROWTH',
    'Your shop is known for honest prices on daily-use items', 'Customers ask most about steel and copper cookware',
  ].join('\n');
  const m = matchTranscript(lines, transcript, { allowed: ['Where you are today', 'What can be confirmed about your business today'] });
  assert.equal(m.coverage, 1);
  assert.ok(m.extraWords > 3);
  assert.deepEqual(m.extraLines.sort(), ['AFFLUENT AUDIENCE', 'HOME GOODS', 'STEADY GROWTH', 'TRUSTED BRAND']);
  assert.equal(pageAccepted(m), false);
  assert.match(rejectionNote(m), /Words that are not in your Blueprint/);
});

test('the heading, the small label and the planned lines are not counted as extra', () => {
  const m = matchTranscript(['Show one product in use every morning'], 'WHO YOU SPEAK TO\nAudience and positioning\nShow one product in use every morning', { allowed: ['Audience and positioning', 'Who you speak to'] });
  assert.deepEqual(m.extraLines, []); assert.ok(pageAccepted(m));
});

test('a planned line printed twice fails the page (found in the real test run on page 4)', () => {
  const line = 'Show one product in use every morning';
  const m = matchTranscript([line], `${line}\nShow one product\nin use every morning\n${line}`);
  assert.deepEqual(m.duplicates, [line]);
  assert.equal(pageAccepted(m), false);
  assert.match(rejectionNote(m), /twice/);
});

test('a line wrapped into pieces by the reader is not a duplicate and not extra', () => {
  const line = 'Show one product in use every morning';
  const m = matchTranscript([line], 'Show one product\nin use every\nmorning');
  assert.deepEqual(m.duplicates, []); assert.deepEqual(m.extraLines, []); assert.ok(pageAccepted(m));
});

test('a stray word or two from reading noise is tolerated; numbers inside the heading are allowed', () => {
  const m = matchTranscript(['Reply to every comment within a day'], 'Reply to every comment within a day\nNebula', { allowed: ['Your first 30 days'] });
  assert.ok(m.extraWords <= 3); assert.ok(pageAccepted(m));
  assert.deepEqual(matchTranscript([], 'Your first 30 days', { allowed: ['Your first 30 days'] }).invented, []);
});

test('a small percentage that was not planned is invented (found in the real run: "15% OFF")', () => {
  const m = matchTranscript(['Show one product in use every morning'], 'Show one product in use every morning\n15% OFF');
  assert.deepEqual(m.invented, ['15']); assert.equal(pageAccepted(m), false);
  assert.deepEqual(matchTranscript(['Save 15% on the first order'], 'Save 15% on the first order').invented, []);
});

test('a misspelled small label fails the page (found in the second real run: "What he competitors you named")', () => {
  const heading = ['Competitor read', 'What the competitors you named say about themselves.'];
  const bad = matchTranscript([], 'What he competitors you named say about themselves\nCompetitor read', { allowed: heading, headings: heading });
  assert.deepEqual(bad.headingWordsMissing, ['the']);
  assert.equal(pageAccepted(bad), false);
  assert.match(rejectionNote(bad), /misspelled/);
  const good = matchTranscript([], 'What the competitors you named say about themselves\nCompetitor read', { allowed: heading, headings: heading });
  assert.deepEqual(good.headingWordsMissing, []); assert.ok(pageAccepted(good));
});
