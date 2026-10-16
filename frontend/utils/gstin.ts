/**
 * A quick check of a GSTIN while the person types, mirroring backend/services/gstin.js. The server checks again and
 * is the one that decides; this only saves a round trip for a typing slip.
 */
const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const FORMAT = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const STATE_CODES = new Set(['01','02','03','04','05','06','07','08','09','10','11','12','13','14','15','16','17','18','19','20','21','22','23','24','26','27','29','30','31','32','33','34','35','36','37','38']);

const ABBR: Record<string, string> = { '01':'JK','02':'HP','03':'PB','04':'CH','05':'UT','06':'HR','07':'DL','08':'RJ','09':'UP','10':'BR','11':'SK','12':'AR','13':'NL','14':'MN','15':'MZ','16':'TR','17':'ML','18':'AS','19':'WB','20':'JH','21':'OD','22':'CT','23':'MP','24':'GJ','26':'DN','27':'MH','29':'KA','30':'GA','31':'LD','32':'KL','33':'TN','34':'PY','35':'AN','36':'TS','37':'AP','38':'LA' };

/** The state a GSTIN belongs to (its first two digits), as Zoho's two letter code, or '' when it cannot be told yet. */
export const stateFromGstin = (v: string): string => ABBR[normaliseGstin(v).slice(0, 2)] || '';

export const normaliseGstin = (v: string): string => String(v || '').replace(/\s+/g, '').toUpperCase();

export function checkChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const product = CHARS.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return CHARS[(36 - (sum % 36)) % 36];
}

/** '' when it is fine (or empty, because a GSTIN is optional), otherwise one plain sentence about what to fix. */
export function gstinProblem(input: string): string {
  const g = normaliseGstin(input);
  if (!g) return '';
  if (g.length < 15) return g.length < 5 ? '' : 'A GSTIN has 15 letters and numbers. Keep typing.';
  if (g.length > 15 || !FORMAT.test(g)) return 'A GSTIN has 15 letters and numbers, for example 33ABCDE1234F1Z5. Please check it.';
  if (!STATE_CODES.has(g.slice(0, 2))) return 'The first two digits are not a valid state code. Please check it.';
  if (checkChar(g.slice(0, 14)) !== g[14]) return 'This GSTIN does not look right: the last character does not match. Please check it.';
  return '';
}
