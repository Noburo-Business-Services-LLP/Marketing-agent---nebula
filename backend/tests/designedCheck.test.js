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
