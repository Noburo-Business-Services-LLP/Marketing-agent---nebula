'use strict';
/**
 * Consent at sign-up. The customer ticks one box for the Terms and the Privacy Policy; we keep when they agreed and to
 * which version, and nothing else about it (no address, no device). That is the record needed to show consent was given.
 */
const { TERMS_VERSION, PRIVACY_VERSION } = require('../config/legalVersions');

const MESSAGE = 'Please agree to the Terms and the Privacy Policy to continue.';
const accepted = (v) => v === true || v === 'true';

/** express-validator custom check for the sign-up form. */
const acceptedTermsCheck = (value) => {
  if (!accepted(value)) throw new Error(MESSAGE);
  return true;
};

/** What is stored on the new account. */
function consentRecord(now = new Date(), source = 'signup') {
  return { termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, acceptedAt: now, source };
}

module.exports = { MESSAGE, accepted, acceptedTermsCheck, consentRecord };
