/**
 * GST Verification Service
 * Validates GST numbers using format check + Luhn mod-36 checksum.
 * 
 * GST format: 22AAAAA0000A1Z5 (15 chars)
 * - Chars 1-2:  State code (01-37)
 * - Chars 3-12: PAN of the entity
 * - Char 13:    Entity number (1-9, A-Z)
 * - Char 14:    'Z' (default)
 * - Char 15:    Checksum digit (Luhn mod-36)
 */

const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const GST_REGEX = /^[0-3][0-9][A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

// Valid Indian state codes (01-37 + 97 for Other Territory)
const VALID_STATE_CODES = new Set([
  '01','02','03','04','05','06','07','08','09','10',
  '11','12','13','14','15','16','17','18','19','20',
  '21','22','23','24','25','26','27','28','29','30',
  '31','32','33','34','35','36','37','97'
]);

/**
 * Validate GST format (regex check)
 */
function isValidGSTFormat(gst) {
  if (!gst || typeof gst !== 'string') return false;
  return GST_REGEX.test(gst.trim().toUpperCase());
}

/**
 * Verify GST check digit using Luhn mod-36 algorithm
 */
function verifyChecksum(gstin) {
  let total = 0;
  for (let i = 0; i < 14; i++) {
    const val = CHARS.indexOf(gstin[i]);
    const factor = (i % 2 === 0) ? 1 : 2;
    const product = val * factor;
    total += Math.floor(product / 36) + (product % 36);
  }
  const checkDigit = (36 - (total % 36)) % 36;
  return CHARS[checkDigit] === gstin[14];
}

/**
 * Verify GST number offline using format + state code + checksum validation
 * Returns { valid, stateCode } or { valid: false, error }
 */
async function verifyGST(gstNumber) {
  const gst = (gstNumber || '').trim().toUpperCase();

  // Step 1: Format check
  if (!isValidGSTFormat(gst)) {
    return { valid: false, error: 'Invalid GST format. Must be 15 characters (e.g. 22AAAAA0000A1Z5).' };
  }

  // Step 2: State code check
  const stateCode = gst.substring(0, 2);
  if (!VALID_STATE_CODES.has(stateCode)) {
    return { valid: false, error: 'Invalid state code in GST number.' };
  }

  // Step 3: Checksum verification (Luhn mod-36)
  if (!verifyChecksum(gst)) {
    return { valid: false, error: 'Invalid GST number. Checksum verification failed.' };
  }

  return {
    valid: true,
    stateCode,
    legalName: '',
    tradeName: '',
    status: 'format-verified'
  };
}

module.exports = { verifyGST, isValidGSTFormat };
