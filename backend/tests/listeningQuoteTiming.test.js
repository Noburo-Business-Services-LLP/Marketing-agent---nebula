const test = require('node:test');
const assert = require('node:assert');
const { safeQuoteText } = require('../services/listening/helpers');

// Worst-case timing of the quote safety filter. A comment is stored text from strangers, and a quote candidate is judged on
// every card load, so no 160-character string may make the filter slow (a regex that backtracks badly would stall the server).
const rep = (s, n = 160) => s.repeat(n).slice(0, n);
const HOSTILE = {
  'digits': rep('1'), 'digits with dashes': rep('1-'), 'digits with spaces': rep('1 '), 'digits in brackets': rep('(1)'),
  'plus and digit': rep('+1'), 'plus and space': rep('+ '), 'dots between digits': rep('1.'), 'phone-like groups': rep('98765 ', 27),
  'only @': rep('@'), 'at signs between words': rep('a @ '), 'full width at': rep('＠'), 'at and dot words': rep('at a dot '),
  'dot com words': rep('dot com '), 'bracket at': rep('[at] '), 'spaced letters': rep('f '), 'spaced word': rep('f u c k '),
  'spaced word 2': rep('s h i t '), 'spaced word 3': rep('k i l l '), 'dotted letters': rep('f.'), 'underscored letters': rep('f_'),
  'dashed letters': rep('f-'), 'stars after a letter': `f${'*'.repeat(150)}x`, 'stars inside a long word': `m${'*'.repeat(140)}!`,
  'stars between letters': rep('f*u*c*k '), 'nested obfuscation': rep('f.u_c-k*'), 'leet runs': rep('f@ck sh1t '), 'leet word repeated': rep('b!tch '),
  'repeated letters of a long word': rep('motherfuc'), 'one letter repeated': rep('s'), 'one letter then stars': rep('s*'),
  'a letter many times': `ass${'s'.repeat(150)}`, 'u many times': `motherf${'u'.repeat(150)}x`, 'o many times': `m${'o'.repeat(150)}`,
  'address-like': rep('12 a, '), 'address digits and street': rep('1 st '), 'street words': rep('road lane '), 'digits and letters': rep('1a '),
  'url pieces': rep('a.co '), 'www pieces': rep('www. '), 'dash words': rep('a-'), 'combining marks': rep('é'), 'tamil letters': rep('கூ'),
  'devanagari letters': rep('च'), 'emoji': rep('\u{1F600}', 80), 'zero width spaces': rep('a​'), 'tabs and newlines': rep('a\t\n '),
  'mixed junk': rep('1+a@ .*-_()[] ')
};

test('safeQuoteText: every hostile 160-character string finishes well under 50 ms', () => {
  // No warm-up here on purpose: the first request after a server starts must not stall either (the patterns used to compile
  // on their first uses, about 125 ms for plain text and another 90 ms for the first Tamil or emoji text).
  const slow = [];
  for (const [name, text] of Object.entries(HOSTILE)) {
    assert.ok(text.length <= 160, name);
    let worst = 0;
    for (let i = 0; i < 3; i++) {
      const t = process.hrtime.bigint();
      safeQuoteText(text);
      worst = Math.max(worst, Number(process.hrtime.bigint() - t) / 1e6);
    }
    if (worst >= 50) slow.push(`${name}: ${worst.toFixed(1)} ms`);
  }
  assert.deepStrictEqual(slow, []);
});

test('safeQuoteText: the timing cases still behave (long runs are rejected or shown unchanged, never cut)', () => {
  assert.strictEqual(safeQuoteText(rep('1')), null);
  assert.strictEqual(safeQuoteText(rep('@')), null);
  assert.strictEqual(safeQuoteText(`${'x'.repeat(161)}`), null);
  assert.strictEqual(safeQuoteText('A perfectly ordinary comment that is fine to show.'), 'A perfectly ordinary comment that is fine to show.');
});
