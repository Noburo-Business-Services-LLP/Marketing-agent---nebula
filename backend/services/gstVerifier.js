/**
 * GST Verification Service
 * Validates GST numbers against India's GST database via public API.
 * 
 * GST format: 22AAAAA0000A1Z5 (15 chars)
 * - Chars 1-2:  State code (01-37)
 * - Chars 3-12: PAN of the entity
 * - Char 13:    Entity number (1-9, A-Z)
 * - Char 14:    'Z' (default)
 * - Char 15:    Checksum digit
 */

const GST_REGEX = /^[0-3][0-9][A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

/**
 * Validate GST format only (offline check)
 */
function isValidGSTFormat(gst) {
  if (!gst || typeof gst !== 'string') return false;
  return GST_REGEX.test(gst.trim().toUpperCase());
}

/**
 * Verify GST against government database via free API
 * Returns { valid, legalName, tradeName, status, stateCode } or { valid: false, error }
 */
async function verifyGST(gstNumber) {
  const gst = (gstNumber || '').trim().toUpperCase();

  if (!isValidGSTFormat(gst)) {
    return { valid: false, error: 'Invalid GST format. Must be 15 characters (e.g. 22AAAAA0000A1Z5).' };
  }

  try {
    // Use the free GST search API (Sheet2API / public GST portal proxy)
    const response = await fetch(`https://sheet.gstincheck.co.in/check/${process.env.GST_API_KEY || 'free'}/${gst}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      // Fallback: if API is down, accept format-valid GST with a warning
      console.warn(`GST API returned ${response.status}, falling back to format-only validation`);
      return { valid: true, legalName: '', tradeName: '', status: 'unverified', fallback: true };
    }

    const data = await response.json();

    if (data.flag === true && data.data) {
      const info = data.data;
      return {
        valid: true,
        legalName: info.lgnm || '',
        tradeName: info.tradeNam || '',
        status: info.sts || '',
        stateCode: info.stj || '',
        registrationDate: info.rgdt || '',
        taxpayerType: info.dty || ''
      };
    } else {
      return { valid: false, error: data.message || 'GST number not found in government records.' };
    }
  } catch (err) {
    console.error('GST verification API error:', err.message);
    // If network error, accept format-valid GST with fallback flag
    return { valid: true, legalName: '', tradeName: '', status: 'unverified', fallback: true };
  }
}

module.exports = { verifyGST, isValidGSTFormat };
