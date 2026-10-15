const test = require('node:test');
const assert = require('node:assert');
const { buildSuggestPrompt } = require('../routes/createAssist');

test('the suggestion prompt carries the idea and the profile facts, and forbids inventing anything', () => {
  const p = buildSuggestPrompt({ idea: 'Diwali offer: 30% off on sofas', mode: 'carousel', languageLabel: 'Tamil', profile: { name: 'TRM Santhi', industry: 'Furniture', location: 'Cuddalore', phone: '9876543210' } });
  assert.match(p, /Diwali offer: 30% off on sofas/);
  assert.match(p, /Name: TRM Santhi/);
  assert.match(p, /Phone on the account: 9876543210/);
  assert.match(p, /a carousel/);
  assert.match(p, /LANGUAGE for headline, offer, items and tagline: Tamil/);
  assert.match(p, /Never invent a price, discount, date, phone number, address, hours, product or claim/);
  assert.match(p, /must be an empty string/);
});
