const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { acceptedTermsCheck, consentRecord, accepted, MESSAGE } = require('../services/consent');
const { TERMS_VERSION, PRIVACY_VERSION } = require('../config/legalVersions');

test('sign-up needs the box ticked: true or "true" passes, anything else is refused with a plain message', () => {
  assert.strictEqual(acceptedTermsCheck(true), true);
  assert.strictEqual(acceptedTermsCheck('true'), true);
  for (const bad of [false, 'false', undefined, null, '', 0, 1, 'yes']) {
    assert.throws(() => acceptedTermsCheck(bad), new RegExp(MESSAGE));
  }
  assert.strictEqual(accepted('true'), true);
  assert.strictEqual(accepted(1), false);
});

test('the record keeps the time and the versions agreed to, and nothing personal', () => {
  const at = new Date('2026-10-16T05:00:00Z');
  const r = consentRecord(at);
  assert.deepStrictEqual(r, { termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, acceptedAt: at, source: 'signup' });
  assert.match(TERMS_VERSION, /^\d{4}-\d{2}-\d{2}$/);
});

test('the sign-up route checks the box and stores the record', () => {
  const src = fs.readFileSync(path.join(__dirname, '../routes/auth.js'), 'utf8');
  assert.ok(src.includes("body('acceptedTerms').custom(require('../services/consent').acceptedTermsCheck)"));
  assert.ok(src.includes("consent: require('../services/consent').consentRecord()"));
});
