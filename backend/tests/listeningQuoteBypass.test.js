const test = require('node:test');
const assert = require('node:assert');
const { safeQuoteText } = require('../services/listening/helpers');

// I7: the quote safety filter must not be beaten by invisible characters, look-alike letters, extra separators,
// word forms, split phone numbers or spelled-out digits. Every row of BYPASS must be rejected; every row of HARMLESS must pass.
const wrap = (x) => `Honestly, ${x} and that is all I have to say.`;
const Z = '​';
const BYPASS = {
  'zero width space inside a word': wrap(`f${Z}uck`),
  'zero width non-joiner': wrap('fu‌ck'),
  'zero width joiners between every letter': wrap('f‍u‍c‍k'),
  'soft hyphen': wrap('sh­it'),
  'word joiner': wrap('sh⁠it'),
  'byte order mark inside': wrap('sh﻿it'),
  'left-to-right mark inside': wrap('sh‎it'),
  'Cyrillic с in crap': wrap('сrap'),
  'Cyrillic а in bastard': wrap('bаstard'),
  'Cyrillic с in fuck': wrap('fuсk'),
  'Cyrillic ѕ in shit': wrap('ѕhit'),
  'Greek omicron in cock': wrap('cοck'),
  'Cyrillic е and о in whore': wrap('whоrе'),
  'double dots between letters': wrap('f..u..c..k'),
  'spaced dashes between letters': wrap('f - u - c - k'),
  'emoji between letters': wrap('f\u{1F600}u\u{1F600}c\u{1F600}k'),
  'commas between letters': wrap('f,u,c,k'),
  'slashes between letters': wrap('f/u/c/k'),
  'accented letters': wrap('fúck'),
  'full width letters': wrap('ｆｕｃｋ'),
  'word form bitches': wrap('bitches'),
  'word form fuckin': wrap('fuckin'),
  'word form fucking': wrap('fucking'),
  'word form shitty': wrap('shitty'),
  'word form killing': wrap('killing'),
  'word form cheated': wrap('cheated'),
  'word form raped': wrap('raped'),
  'phone split by a comma': 'Please ring 98765,43210 when you are free today',
  'phone split by slashes': 'Please ring 987/654/3210 when you are free today',
  'phone split by dots': 'Please ring 98765.43210 when you are free today',
  'phone in brackets and dashes': 'Please ring (987) 654-3210 when you are free today',
  'phone in square brackets': 'Please ring [98765] [43210] when you are free today',
  'ten digit words': 'Please ring nine eight seven six five four three two one zero soon',
  'seven digit words with dashes': 'Please ring nine-eight-seven-six-five-four-three when you can',
  'digits mixed with digit words': 'Please ring 9 8 7 six five four three when you can please',
  'domain split by spaces': 'Photos are on example . com if you want to look',
  'domain with bracket dot': 'Photos are on example[.]com if you want to look',
  'domain with word dot in brackets': 'Photos are on example (dot) com if you want to look',
  'gap suck': wrap('suck'), 'gap pussy': wrap('pussy'), 'gap cock': wrap('cock'), 'gap twat': wrap('twat'),
  'gap wanker': wrap('wanker'), 'gap prick': wrap('prick'), 'gap kys': wrap('kys'),
  'gap bsdk': wrap('bsdk'), 'gap bkl': wrap('bkl'), 'gap lodu': wrap('lodu'), 'gap gaand': wrap('gaand'), 'gap kuttiya': wrap('kuttiya'),
  'gap saali': wrap('saali'), 'gap sunni': wrap('sunni'), 'gap dengu': wrap('dengu'), 'gap thayoli': wrap('thayoli'),
  'gap kunna': wrap('kunna'), 'gap tunne': wrap('tunne'), 'gap thevudiya': wrap('thevudiya'),
  'gap Devanagari chod': wrap('चोद'), 'gap Devanagari gaand': wrap('गांड'), 'gap Devanagari bhadwa': wrap('भड़वा'),
  'upper case with leet': wrap('SH1TTY'),
  'zero width AND homoglyph together': wrap(`с${Z}rap`)
};
const HARMLESS = [
  'The cake was fresh and arrived on time, thank you so much.',
  'Scunthorpe store was quick and the staff were really kind.',
  'We had 12 guests and 3 cakes for the party and it was lovely.',
  'Delivered in 2 days, 5 stars from our whole family today.',
  'The class was great and the glass cakes were lovely too.',
  'Hello there, the passage to the shell shop was easy to find.',
  'Scampi and assistance were both lovely and very friendly.',
  'The diner next door recommended this bakery, and I agree.',
  'The helper at the counter was patient and explained everything.',
  'Loved it. In fact it was the best birthday cake we ever had.',
  'It took 10 minutes to pick up and 5 more to pay, very smooth.',
  'Great cocktail cakes, the cockpit themed one was a big hit.',
  'சிறந்த சேவை, மிகவும் நன்றி உங்களுக்கு மீண்டும் வருவோம்',
  'बहुत अच्छा काम किया आपने, धन्यवाद, फिर से आएंगे जरूर',
  'Packing was neat, the colours matched the photo, and it was on time.',
  'Sussex Road branch was clean and the pastry chef was brilliant.'
];

test('bypass attempts: every one is rejected', () => {
  assert.ok(Object.keys(BYPASS).length >= 30);
  const leaked = Object.entries(BYPASS).filter(([, text]) => safeQuoteText(text) !== null).map(([name]) => name);
  assert.deepStrictEqual(leaked, []);
});

test('harmless comments still pass unchanged', () => {
  assert.ok(HARMLESS.length >= 15);
  const refused = HARMLESS.filter((t) => safeQuoteText(t) !== t);
  assert.deepStrictEqual(refused, []);
});

test('timing: 5,000 character hostile strings finish under 200 ms, with no warm-up', () => {
  const rep = (s, n = 5000) => s.repeat(Math.ceil(n / s.length)).slice(0, n);
  const hostile = [rep('1'), rep('1-'), rep('f '), rep('f.'), rep('f u c k '), rep('s'), rep('a@ '), rep('9 8 7 '), rep('nine '), rep('​'), rep('с'), rep('f..'), rep('[at] '), rep('ass'), rep('(1)'), rep('1,'), rep('a . com '), `f${'*'.repeat(4990)}x`];
  const slow = [];
  for (const text of hostile) {
    const t = process.hrtime.bigint();
    const out = safeQuoteText(text);
    const ms = Number(process.hrtime.bigint() - t) / 1e6;
    assert.strictEqual(out, null);
    if (ms >= 200) slow.push(`${text.slice(0, 10)}: ${ms.toFixed(1)} ms`);
  }
  assert.deepStrictEqual(slow, []);
});

test('timing: hostile 160-character strings with the new separators and look-alikes stay under 50 ms', () => {
  const rep = (s, n = 160) => s.repeat(Math.ceil(n / s.length)).slice(0, n);
  const hostile = [rep('f,'), rep('f/'), rep('f​'), rep('с'), rep('nine '), rep('9 eight '), rep('1,'), rep('1/'), rep('a . com '), rep('f \u{1F600} '), rep('bitche'), rep('fuckin'), rep('a[.]'), rep('f . '), rep('.,.,')];
  for (const text of hostile) {
    let worst = 0;
    for (let i = 0; i < 3; i++) { const t = process.hrtime.bigint(); safeQuoteText(text); worst = Math.max(worst, Number(process.hrtime.bigint() - t) / 1e6); }
    assert.ok(worst < 50, `${text.slice(0, 12)}: ${worst.toFixed(1)} ms`);
  }
});
