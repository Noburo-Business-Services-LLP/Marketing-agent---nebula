'use strict';
/**
 * POST /api/csp-report: what the report-only Content-Security-Policy would have blocked (config/csp.js).
 * COUNTS ONLY: the directive and the blocked origin ("inline", "eval", "data", or scheme + host of the address).
 * The page address, the script sample, file names and every other part of the report are never stored or logged
 * (they can carry user data). Each new pair is logged once; a summary of counts every 10 minutes while reports come.
 * Answers 204. Rate-limited per address at the mount (server-main.js).
 */

const KEYWORDS = new Set(['inline', 'eval', 'data', 'blob', 'self', 'wasm-eval', 'trusted-types-policy', 'trusted-types-sink']);
const MAX_KEYS = 300;

function blockedOrigin(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (!v) return 'none';
  if (KEYWORDS.has(v)) return v;
  if (v.startsWith('data:')) return 'data';
  if (v.startsWith('blob:')) return 'blob';
  try { const u = new URL(v); return `${u.protocol}//${u.host}`.slice(0, 120); } catch (_) { return 'other'; }
}

/** [{ directive, blocked }] from either report format (report-uri's {"csp-report": {...}} or the Reporting API list). */
function readReports(body) {
  const out = [];
  const add = (r) => {
    if (!r || typeof r !== 'object') return;
    const directive = String(r['effective-directive'] || r.effectiveDirective || r['violated-directive'] || r.violatedDirective || 'unknown').split(/\s+/)[0].slice(0, 40);
    out.push({ directive, blocked: blockedOrigin(r['blocked-uri'] || r.blockedURL || r.blockedUri) });
  };
  if (Array.isArray(body)) for (const item of body.slice(0, 20)) add(item && (item.body || item));
  else if (body && typeof body === 'object') add(body['csp-report'] || body.body || body);
  return out;
}

function createCspReporter({ log = console, now = Date.now, summaryEveryMs = 10 * 60 * 1000 } = {}) {
  const counts = new Map();
  let windowCounts = new Map();
  let lastSummary = now();

  function record(reports) {
    for (const { directive, blocked } of reports) {
      const key = `${directive} ${blocked}`;
      if (!counts.has(key)) {
        if (counts.size >= MAX_KEYS) continue;
        counts.set(key, 0);
        log.log(`[csp] report-only: ${directive} would block ${blocked} (first report)`);
      }
      counts.set(key, counts.get(key) + 1);
      windowCounts.set(key, (windowCounts.get(key) || 0) + 1);
    }
    if (now() - lastSummary >= summaryEveryMs && windowCounts.size) {
      const top = [...windowCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, n]) => `${k} x${n}`).join('; ');
      log.log(`[csp] report-only counts, last ${Math.round((now() - lastSummary) / 60000)} min: ${top}`);
      windowCounts = new Map();
      lastSummary = now();
    }
  }

  function handler(req, res) {
    try { record(readReports(req.body)); } catch (_) { /* a broken report is ignored */ }
    res.status(204).end();
  }

  return { handler, record, counts: () => Object.fromEntries(counts) };
}

module.exports = { createCspReporter, readReports, blockedOrigin };
