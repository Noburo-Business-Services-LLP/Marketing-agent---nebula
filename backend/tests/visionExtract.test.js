const test = require('node:test');
const assert = require('node:assert');
const { extractFromFile, parseExtraction, buildExtractPrompt } = require('../services/visionExtract');

const reply = (obj) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(obj) } }] }) });

test('what is printed becomes a brief and details; empty things stay empty', async () => {
  const io = { apiKey: 'k', model: 'gpt-5.5', fetch: async () => reply({ sensitive: false, kind: 'pamphlet', businessName: 'TRM Santhi', summary: 'Diwali sale on furniture', brief: 'Up to 30% off sofa sets this Diwali.', headline: 'Diwali Sale', offer: 'Up to 30% off', items: ['Sofa set from Rs 24,999', 'Bed Rs 18,000'], phone: '', address: 'Cuddalore', hours: '', tagline: '', dates: 'till 30 Oct', notes: '' }) };
  const out = await extractFromFile({ type: 'image', dataUrl: 'data:image/png;base64,AA==' }, { languageLabel: 'English' }, io);
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.details.offer, 'Up to 30% off');
  assert.strictEqual(out.details.items, 'Sofa set from Rs 24,999\nBed Rs 18,000');
  assert.strictEqual(out.details.phone, '');
  assert.strictEqual(out.dates, 'till 30 Oct');
});

test('a personal or financial document is refused, and nothing from it is returned', async () => {
  const io = { apiKey: 'k', fetch: async () => reply({ sensitive: true, summary: 'A bank statement', brief: 'x', phone: '9999999999' }) };
  const out = await extractFromFile({ type: 'pdf', dataUrl: 'data:application/pdf;base64,AA==', name: 'a.pdf' }, {}, io);
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.sensitive, true);
  assert.strictEqual(out.details, undefined);
});

test('an unreadable or empty answer is reported plainly, and a failed call never throws', async () => {
  const empty = await extractFromFile({ type: 'image', dataUrl: 'data:image/png;base64,AA==' }, {}, { apiKey: 'k', fetch: async () => reply({}) });
  assert.strictEqual(empty.ok, false);
  assert.match(empty.message, /No printed text was found/);
  const failed = await extractFromFile({ type: 'image', dataUrl: 'data:image/png;base64,AA==' }, {}, { apiKey: 'k', fetch: async () => { throw new Error('net'); } });
  assert.strictEqual(failed.ok, false);
});

test('a PDF goes to the model as a file part, a picture as an image part, and the prompt forbids inventing', async () => {
  const seen = [];
  const io = { apiKey: 'k', model: 'gpt-5.5', fetch: async (u, o) => { seen.push(JSON.parse(o.body)); return reply({ summary: 's', brief: 'b' }); } };
  await extractFromFile({ type: 'pdf', dataUrl: 'data:application/pdf;base64,AA==', name: 'menu.pdf' }, {}, io);
  await extractFromFile({ type: 'image', dataUrl: 'data:image/png;base64,AA==' }, {}, io);
  assert.strictEqual(seen[0].messages[0].content[1].type, 'file');
  assert.strictEqual(seen[0].messages[0].content[1].file.filename, 'menu.pdf');
  assert.strictEqual(seen[1].messages[0].content[1].type, 'image_url');
  assert.match(buildExtractPrompt(), /Never invent/);
  assert.strictEqual(seen[0].max_completion_tokens, 6000);
});

test('parseExtraction caps lengths and tolerates junk', () => {
  assert.deepStrictEqual(parseExtraction('not json').details.items, '');
  const p = parseExtraction('{"items": ' + JSON.stringify(Array.from({ length: 20 }, (_, i) => `item ${i}`)) + '}');
  assert.strictEqual(p.details.items.split('\n').length, 12);
});
