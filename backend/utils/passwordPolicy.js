'use strict';
/**
 * The rule for a NEW password (B10): sign-up, change-password and reset-password. Existing accounts keep signing in
 * with whatever they have. At least 10 characters, a letter and a number, not one of the very common passwords in
 * data/common-passwords.txt (a curated list of a few hundred, not an exhaustive 10k list), and not the email's name.
 */
const fs = require('fs');
const path = require('path');

const MIN_LENGTH = 10;
const MAX_LENGTH = 200;
const FILE = path.join(__dirname, '..', 'data', 'common-passwords.txt');

let common = null;
/** The deny list, read once into a Set of lower-case entries. */
function commonPasswords() {
  if (common) return common;
  let lines = [];
  try { lines = fs.readFileSync(FILE, 'utf8').split(/\r?\n/); } catch (e) { console.warn('[password policy] common-passwords.txt not readable:', e && e.message); }
  common = new Set(lines.map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith('#')));
  return common;
}

const MSG = {
  short: `Please use at least ${MIN_LENGTH} characters. A short phrase of a few words is easy to remember.`,
  long: `Please use at most ${MAX_LENGTH} characters.`,
  letter: 'Please include at least one letter.',
  number: 'Please include at least one number.',
  common: 'That password is too common and easy to guess. Please choose another one.',
  email: 'Please choose a password that is not your email address.'
};

/** '' when the new password is acceptable, otherwise a friendly message saying what to change. */
function checkPassword(password, { email = '' } = {}) {
  if (typeof password !== 'string' || password.length < MIN_LENGTH) return MSG.short;
  if (password.length > MAX_LENGTH) return MSG.long;
  if (!/[a-zA-Z]/.test(password)) return MSG.letter;
  if (!/\d/.test(password)) return MSG.number;
  const lower = password.toLowerCase();
  if (commonPasswords().has(lower)) return MSG.common;
  const name = String(email || '').toLowerCase().split('@')[0];
  if (name && (lower === name || lower === String(email).toLowerCase())) return MSG.email;
  return '';
}

/** express-validator `.custom()` for a new password field; uses req.body.email when there is one. */
function passwordRule(value, { req } = {}) {
  const message = checkPassword(value, { email: (req && req.body && req.body.email) || (req && req.user && req.user.email) || '' });
  if (message) throw new Error(message);
  return true;
}

module.exports = { checkPassword, passwordRule, commonPasswords, MIN_LENGTH, MAX_LENGTH, MSG };
