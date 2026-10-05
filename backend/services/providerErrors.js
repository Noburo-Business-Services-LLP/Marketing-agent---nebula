/**
 * Provider error helpers (pure).
 * Customers must never see vendor names, URLs, plan names, quota numbers or raw provider text.
 */

const MESSAGES = {
  ai: 'This feature is temporarily unavailable. Please try again later.',
  social: 'Connecting social media accounts is temporarily unavailable. Please try again later, or contact support if this continues.',
  default: 'Something went wrong. Please try again later.'
};

function textOf(err) {
  if (err === null || err === undefined) return '';
  if (typeof err === 'string') return err;
  const parts = [err.message, err.error, err.action, err.code, err.status, err.statusCode];
  if (err.response && typeof err.response === 'object') {
    parts.push(err.response.status, err.response.data && JSON.stringify(err.response.data));
  }
  return parts.filter((p) => p !== undefined && p !== null).map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
}

function statusOf(err) {
  if (!err || typeof err !== 'object') return null;
  return err.status || err.statusCode || (err.response && err.response.status) || null;
}

function isProviderLimitError(err) {
  const text = textOf(err);
  const status = Number(statusOf(err));
  if (status === 429 || status === 403) return true;
  if (/RESOURCE_EXHAUSTED|quota|billing|exceeded your current/i.test(text)) return true;
  if (/Business Plan|Paid Plan Required|Premium|suspended/i.test(text)) return true;
  if (/(["']?code["']?\s*[:=]\s*|\bcode\s+)(169|276)\b/i.test(text)) return true;
  if (err && typeof err === 'object' && [169, 276].includes(Number(err.code))) return true;
  return false;
}

function friendlyMessage(err, context) {
  return MESSAGES[context] || MESSAGES.default;
}

module.exports = { isProviderLimitError, friendlyMessage };
