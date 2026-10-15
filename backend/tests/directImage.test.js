const test = require('node:test');
const assert = require('node:assert');
const { languageKind, textMismatchesLanguage, hexToName, humanizeColours, buildDirectPrompt, generateDirectPost, requiredNumbers, missingNumbers, extraNumbers } = require('../services/directImage');

test('the request carries the brief and real facts, forbids invented details, and names the logo', () => {
  const p = buildDirectPrompt({
    brief: 'Diwali furniture sale: up to 30% off sofa sets', brand: { name: 'TRM Santhi', industry: 'Home &amp; Furniture', location: 'Cuddalore' },
    language: 'tamil_english_mix', aspectRatio: '4:5', hasLogo: true, details: { phone: '98765 43210' }, productCount: 0,
  });
  assert.match(p, /TRM Santhi, a Home & Furniture business in Cuddalore/);
  assert.match(p, /up to 30% off/);
  assert.match(p, /mix of Tamil \(Tamil script\) and English/);
  assert.match(p, /phone number "98765 43210"/);
  assert.match(p, /Do not invent phone numbers/);
  assert.match(p, /first attached picture is the business logo/);
});

test('without a logo it says so, and nothing about a logo reference appears', () => {
  const p = buildDirectPrompt({ brief: 'x', brand: { name: 'A' }, language: 'english', aspectRatio: '1:1', hasLogo: false, noLogo: true });
  assert.match(p, /Do not draw any logo, emblem or brand mark/);
  assert.doesNotMatch(p, /first attached picture/);
});

test('numbers from the brief are required, and found or missing is judged on what was read', () => {
  const req = requiredNumbers({ brief: 'Combo box at Rs 299, 10% off, from 2,00,000' });
  assert.ok(req.includes('299') && req.includes('10') && req.includes('200000'));
  assert.deepStrictEqual(missingNumbers(['299', '10'], '₹299 only! 10 % OFF'), []);
  assert.deepStrictEqual(missingNumbers(['299', '10'], 'Combo box ₹199'), ['299', '10']);
});

test('a picture missing a required number is made once more, and the better one is kept', async () => {
  const calls = [];
  const io = {
    fetchReference: async () => ({ mimeType: 'image/png', data: 'AA==' }),
    generate: async (prompt) => { calls.push(prompt); return { success: true, imageUrl: `https://img/${calls.length}.jpg`, model: 'gpt-image-2' }; },
    readText: async (url) => (url.endsWith('/1.jpg') ? 'Combo box' : 'Combo box ₹299'),
  };
  const out = await generateDirectPost({ brief: 'Combo box at Rs 299', brand: { name: 'Mishra' }, language: 'english', aspectRatio: '4:5', logoUrl: 'https://l/logo.png', details: {} }, io);
  assert.strictEqual(out.success, true);
  assert.strictEqual(calls.length, 2);
  assert.match(calls[1], /must clearly show these numbers exactly: 299/);
  assert.strictEqual(out.imageUrl, 'https://img/2.jpg');
  assert.deepStrictEqual(out.missing, []);
  assert.strictEqual(out.logoPlacedByModel, true);
});

test('when the model fails it reports failure so the older chain can run', async () => {
  const out = await generateDirectPost({ brief: 'x', brand: {}, language: 'english', aspectRatio: '1:1' }, { generate: async () => ({ success: false, error: 'boom' }), fetchReference: async () => null });
  assert.strictEqual(out.success, false);
  assert.strictEqual(out.error, 'boom');
});

test('in overlay mode the logo corner is reserved and no logo picture is sent to the model', async () => {
  const sent = [];
  const io = { fetchReference: async () => { sent.push('ref'); return { mimeType: 'image/png', data: 'AA==' }; }, generate: async (prompt, o) => { sent.push(prompt); return { success: true, imageUrl: 'data:image/png;base64,AA==', model: 'gpt-image-2' }; } };
  const out = await generateDirectPost({ brief: 'x', brand: { name: 'A' }, language: 'english', aspectRatio: '4:5', logoUrl: 'https://l/logo.png', overlayLogo: true, logoPosition: 'top-right', details: {} }, io);
  assert.strictEqual(out.success, true);
  assert.ok(!sent.includes('ref'));
  assert.match(sent[0], /top right corner of the picture calm/);
  assert.doesNotMatch(sent[0], /first attached picture/);
  assert.strictEqual(out.logoPlacedByModel, false);
});

test('a number nobody supplied is caught, and the picture is remade without it', async () => {
  assert.deepStrictEqual(extraNumbers('Sale 30% off, phone 98765 43210', 'UP TO 30% OFF 18+ years 98765 43210'), ['18']);
  const calls = [];
  const io = {
    fetchReference: async () => null,
    generate: async (prompt) => { calls.push(prompt); return { success: true, imageUrl: `https://img/${calls.length}.jpg`, model: 'gpt-image-2' }; },
    readText: async (url) => (url.endsWith('/1.jpg') ? 'Up to 30% off. 18+ years of trust' : 'Up to 30% off'),
  };
  const out = await generateDirectPost({ brief: 'Sale: up to 30% off', brand: { name: 'TRM' }, language: 'english', aspectRatio: '4:5', details: {} }, io);
  assert.strictEqual(calls.length, 2);
  assert.match(calls[1], /do not show any number that was not given, such as: 18/);
  assert.strictEqual(out.imageUrl, 'https://img/2.jpg');
  assert.deepStrictEqual(out.extra, []);
});

test('a series picture carries the shared look, its own exact text, the previous picture and the frames', async () => {
  const sent = [];
  const refsSeen = [];
  const io = {
    fetchReference: async (u) => { refsSeen.push(u); return { mimeType: 'image/png', data: 'AA==' }; },
    generate: async (prompt, o) => { sent.push(prompt); return { success: true, imageUrl: 'https://img/1.jpg', model: 'gpt-image-2' }; },
    readText: async () => 'Fresh bread every morning',
    addFrames: async (url) => ({ applied: true, imageUrl: url + '?framed' }),
  };
  const { generateDirectSeriesImage } = require('../services/directImage');
  const out = await generateDirectSeriesImage({
    brief: 'Show the morning bake', imageText: 'Fresh bread every morning', brand: { name: 'Sunrise Bakery' }, language: 'english', aspectRatio: '4:5',
    series: { label: 'slide 2 of 5 in a swipe carousel', role: 'build', concept: 'Warm morning light', visualSystem: 'Cream and terracotta', mechanism: 'a line carries across slides' },
    logoUrl: 'https://l/logo.png', overlayLogo: true, logoPosition: 'bottom-right', productUrls: ['https://p/1.png'], continuityUrl: 'https://img/prev.jpg',
    headerUrl: 'https://h/h.png', details: {},
  }, io);
  assert.strictEqual(out.success, true);
  assert.strictEqual(out.imageUrl, 'https://img/1.jpg?framed');
  assert.match(sent[0], /slide 2 of 5 in a swipe carousel/);
  assert.match(sent[0], /Warm morning light/);
  assert.match(sent[0], /"Fresh bread every morning"/);
  assert.match(sent[0], /last attached picture is the previous one/);
  assert.match(sent[0], /bottom right corner of the picture calm/);
  assert.match(sent[0], /LAYOUT RESERVE/);
  assert.deepStrictEqual(refsSeen, ['https://p/1.png', 'https://img/prev.jpg']);
});

test('a longer number does not count as showing a shorter required one', () => {
  assert.deepStrictEqual(missingNumbers(['1499'], 'Diwali feast ₹14999 only'), ['1499']);
  assert.deepStrictEqual(missingNumbers(['1499'], 'Diwali feast ₹1,499 only'), []);
  assert.deepStrictEqual(missingNumbers(['200000'], '₹2,00,000 chit'), []);
  assert.deepStrictEqual(missingNumbers(['299'], 'Rs. 299/-'), []);
});

test('in a series an extra number alone does not cause a second picture', async () => {
  const { generateDirectSeriesImage } = require('../services/directImage');
  let calls = 0;
  const io = {
    fetchReference: async () => null,
    generate: async () => { calls += 1; return { success: true, imageUrl: `https://img/${calls}.jpg`, model: 'gpt-image-2' }; },
    readText: async () => 'Up to 30% off. 18+ years of trust',
  };
  const out = await generateDirectSeriesImage({ brief: 'Sale up to 30% off', brand: { name: 'TRM' }, language: 'english', aspectRatio: '4:5', details: {} }, io);
  assert.strictEqual(calls, 1);
  assert.deepStrictEqual(out.extra, ['18']);
});

test('colour codes never reach the model as text: they become colour names', () => {
  assert.strictEqual(hexToName('#011636'), 'deep navy blue');
  assert.strictEqual(hexToName('#FFE0B2'), 'soft peach');
  assert.strictEqual(humanizeColours('Palette: #011636 and #FFE0B2, accent #F5A623.'), 'Palette: deep navy blue and soft peach, accent orange.');
  const p = buildDirectPrompt({ brief: 'Use navy #011636 background', brand: { name: 'Nebulaa', colours: ['#011636', '#FFE0B2'] }, language: 'english', aspectRatio: '4:5', series: { label: 'post 1 of 3', concept: 'Dark #011636 world with #FFE0B2 cards', visualSystem: '' } });
  assert.doesNotMatch(p, /#?011636/);
  assert.doesNotMatch(p, /FFE0B2/i);
  assert.match(p, /never print colour codes/);
});

test('campaign posts are told to differ from each other, carousel slides are not', () => {
  const base = { brief: 'x', brand: { name: 'A' }, language: 'english', aspectRatio: '4:5', series: { label: 'post 2 of 6 in a campaign' } };
  assert.match(buildDirectPrompt({ ...base, variety: true }), /own scene, subject and composition/);
  assert.doesNotMatch(buildDirectPrompt(base), /own scene, subject and composition/);
});

test('a headline in the wrong language is treated as an idea to express, not as exact text', () => {
  assert.deepStrictEqual(languageKind('tamil_english_mix'), { base: 'tamil', mix: true });
  assert.deepStrictEqual(languageKind('Tamil'), { base: 'tamil', mix: false });
  assert.strictEqual(textMismatchesLanguage('Another day, another blank caption box.', 'tamil'), true);
  assert.strictEqual(textMismatchesLanguage('இந்த தீபாவளி உங்கள் வியாபாரம்', 'tamil'), false);
  assert.strictEqual(textMismatchesLanguage('இந்த தீபாவளி', 'english'), true);
  assert.strictEqual(textMismatchesLanguage('Another day', 'tamil_english_mix'), false);
  const p = buildDirectPrompt({ brief: 'x', imageText: 'Another day, another blank caption box.', brand: { name: 'A' }, language: 'tamil', aspectRatio: '4:5' });
  assert.match(p, /should express this idea/);
  assert.doesNotMatch(p, /Show this text on the picture exactly/);
  assert.match(p, /Use no English words except brand names/);
  const ok = buildDirectPrompt({ brief: 'x', imageText: 'இந்த தீபாவளி', brand: { name: 'A' }, language: 'tamil', aspectRatio: '4:5' });
  assert.match(ok, /Show this text on the picture exactly/);
});

test('a campaign post carries no recurring device and is told not to add light streaks', () => {
  const p = buildDirectPrompt({ brief: 'x', brand: { name: 'A' }, language: 'english', aspectRatio: '4:5', series: { label: 'post 1 of 3 in a campaign', concept: 'Warm', visualSystem: 'Cream' }, variety: true });
  assert.doesNotMatch(p, /Recurring device/);
  assert.match(p, /No decorative light streaks/);
});
