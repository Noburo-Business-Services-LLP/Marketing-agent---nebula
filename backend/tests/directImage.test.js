const test = require('node:test');
const assert = require('node:assert');
const { buildDirectPrompt, generateDirectPost, requiredNumbers, missingNumbers, extraNumbers } = require('../services/directImage');

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
  assert.match(p, /Do not add any logo/);
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
