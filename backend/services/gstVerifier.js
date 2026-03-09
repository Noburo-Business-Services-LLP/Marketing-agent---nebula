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

const https = require('https');

const GST_REGEX = /^[0-3][0-9][A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

/**
 * Validate GST format only (offline check)
 */
function isValidGSTFormat(gst) {
  if (!gst || typeof gst !== 'string') return false;
  return GST_REGEX.test(gst.trim().toUpperCase());
}

/**
 * Make HTTPS GET request (works on all Node.js versions)
 */
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'Accept': 'application/json' }, timeout: 10000 }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid JSON')); }
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
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
    const apiKey = process.env.GST_API_KEY || 'free';
    const data = await httpsGet(`https://sheet.gstincheck.co.in/check/${apiKey}/${gst}`);

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
      return { valid: false, error: 'This GST number does not exist. Please enter a valid GST number.' };
    }
  } catch (err) {
    console.error('GST verification API error:', err.message);
    // If API is down/timeout, accept format-valid GST with fallback flag
    return { valid: true, legalName: '', tradeName: '', status: 'unverified', fallback: true };
  }
}

module.exports = { verifyGST, isValidGSTFormat };
