const test = require('node:test');
const assert = require('node:assert');
const g = require('../services/gstin');

test('a real published sample GSTIN passes', () => {
  const v = g.validateGstin('27AAPFU0939F1ZV');
  assert.strictEqual(v.ok, true);
  assert.strictEqual(v.stateAbbr, 'MH');
  assert.strictEqual(v.pan, 'AAPFU0939F');
});

test('spaces and lower case are tolerated, and the check character is verified', () => {
  const first14 = '33ABCDE1234F1Z';
  const full = first14 + g.checkChar(first14);
  assert.strictEqual(g.validateGstin(` ${full.toLowerCase().slice(0, 8)} ${full.toLowerCase().slice(8)} `).ok, true);
  const wrong = first14 + (full.endsWith('7') ? '8' : '7');
  const bad = g.validateGstin(wrong);
  assert.strictEqual(bad.ok, false);
  assert.match(bad.message, /last character does not match/);
});

test('wrong length, bad shape and unknown state codes are refused with a plain message', () => {
  assert.match(g.validateGstin('33ABCDE1234F1Z').message, /15 letters and numbers/);
  assert.match(g.validateGstin('33ABCDE1234F1X7').message, /15 letters and numbers/);
  const first14 = '99ABCDE1234F1Z';
  assert.match(g.validateGstin(first14 + g.checkChar(first14)).message, /state code/);
  assert.strictEqual(g.validateGstin('').empty, true);
});

test('every state has a code and a two letter abbreviation for Zoho, and Tamil Nadu is 33', () => {
  assert.strictEqual(g.stateByAbbr('tn').code, '33');
  assert.ok(g.STATES.every((s) => /^\d{2}$/.test(s.code) && /^[A-Z]{2}$/.test(s.abbr) && s.name));
  assert.strictEqual(new Set(g.STATES.map((s) => s.abbr)).size, g.STATES.length);
});
