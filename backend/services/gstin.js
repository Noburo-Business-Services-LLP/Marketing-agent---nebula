'use strict';
/**
 * GSTIN rules for the invoice details a customer can add: the 15 character format, the state code, and the check
 * character. Pure. A GSTIN that passes here can still be inactive on the GST portal; this only catches typing slips.
 */
const STATES = [
  ['01', 'JK', 'Jammu and Kashmir'], ['02', 'HP', 'Himachal Pradesh'], ['03', 'PB', 'Punjab'], ['04', 'CH', 'Chandigarh'],
  ['05', 'UT', 'Uttarakhand'], ['06', 'HR', 'Haryana'], ['07', 'DL', 'Delhi'], ['08', 'RJ', 'Rajasthan'],
  ['09', 'UP', 'Uttar Pradesh'], ['10', 'BR', 'Bihar'], ['11', 'SK', 'Sikkim'], ['12', 'AR', 'Arunachal Pradesh'],
  ['13', 'NL', 'Nagaland'], ['14', 'MN', 'Manipur'], ['15', 'MZ', 'Mizoram'], ['16', 'TR', 'Tripura'],
  ['17', 'ML', 'Meghalaya'], ['18', 'AS', 'Assam'], ['19', 'WB', 'West Bengal'], ['20', 'JH', 'Jharkhand'],
  ['21', 'OD', 'Odisha'], ['22', 'CT', 'Chhattisgarh'], ['23', 'MP', 'Madhya Pradesh'], ['24', 'GJ', 'Gujarat'],
  ['26', 'DN', 'Dadra and Nagar Haveli and Daman and Diu'], ['27', 'MH', 'Maharashtra'], ['29', 'KA', 'Karnataka'],
  ['30', 'GA', 'Goa'], ['31', 'LD', 'Lakshadweep'], ['32', 'KL', 'Kerala'], ['33', 'TN', 'Tamil Nadu'],
  ['34', 'PY', 'Puducherry'], ['35', 'AN', 'Andaman and Nicobar Islands'], ['36', 'TS', 'Telangana'],
  ['37', 'AP', 'Andhra Pradesh'], ['38', 'LA', 'Ladakh']
].map(([code, abbr, name]) => ({ code, abbr, name }));

const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const FORMAT = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const normalise = (v) => String(v == null ? '' : v).replace(/\s+/g, '').toUpperCase();

/** The check character for the first 14 characters. */
function checkChar(first14) {
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const value = CHARS.indexOf(first14[i]);
    const product = value * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return CHARS[(36 - (sum % 36)) % 36];
}

function validateGstin(input) {
  const g = normalise(input);
  if (!g) return { ok: false, empty: true, message: 'Enter the 15 character GSTIN.' };
  if (g.length !== 15 || !FORMAT.test(g)) return { ok: false, message: 'A GSTIN has 15 letters and numbers, for example 33ABCDE1234F1Z5. Please check it.' };
  const state = STATES.find((s) => s.code === g.slice(0, 2));
  if (!state) return { ok: false, message: 'The first two digits of this GSTIN are not a valid state code. Please check it.' };
  if (checkChar(g.slice(0, 14)) !== g[14]) return { ok: false, message: 'This GSTIN does not look right (the last character does not match). Please check it.' };
  return { ok: true, gstin: g, stateCode: state.code, stateAbbr: state.abbr, stateName: state.name, pan: g.slice(2, 12) };
}

const stateByAbbr = (abbr) => STATES.find((s) => s.abbr === String(abbr || '').toUpperCase()) || null;

module.exports = { STATES, validateGstin, checkChar, normalise, stateByAbbr };
