// Pure gate rules for summarize.mjs (unit tested in frontend/tests/audit-gate.test.mjs).
//
// Statuses a route x width can have. Only 'ok' is a usable measurement; every other status fails
// the gate and never counts as "0 failures":
//   MISSING        no result file (e.g. a crash stopped the run before this route)
//   STALE          a result file older than the run start given with --since (left over from an
//                  earlier run, so it does not measure the current code)
//   ERROR          the audit threw
//   BLANK          the app crashed (nothing mounted)
//   EMPTY          the page rendered but the audit checked 0 text elements (nothing was measured)
//   REDIRECT       landed elsewhere than expectHash/path
//   TAB-NOT-FOUND  the tab to click was not found
export const REQUIRED_WIDTHS = [1280, 375];

export function rowStatus(spec, d, opts = {}) {
  if (!d) return 'MISSING';
  if (opts.since != null) {
    const at = Date.parse(d.at || '');
    if (!Number.isFinite(at) || at < opts.since) return 'STALE';
  }
  if (d.error) return 'ERROR';
  if (d.blank) return 'BLANK';
  // Static pages served by the audit server (e.g. /__layer-fixtures) are matched by their URL path.
  if (spec.url) {
    let path = '';
    try { path = new URL(d.url || '', 'http://x').pathname; } catch { /* ignore */ }
    if (path !== spec.url) return 'REDIRECT';
    return Number(d.checked) > 0 ? 'ok' : 'EMPTY';
  }
  const want = '#' + (spec.expectHash || spec.path);
  const got = d.finalHash || '';
  if (got !== want && !(want === '#/' && (got === '' || got === '#'))) return 'REDIRECT';
  if (spec.click && d.clicked === false) return 'TAB-NOT-FOUND';
  if (!(Number(d.checked) > 0)) return 'EMPTY';
  return 'ok';
}

// Widths the run covered vs the widths the gate requires. A run narrowed with --widths can
// never PASS: it is reported as PARTIAL and the gate exits non-zero.
export function missingWidths(widths, required = REQUIRED_WIDTHS) {
  return required.filter((w) => !widths.includes(w));
}

// rows: [{ scope: 'in'|'duplicate'|'other', status, pass }]
export function gateVerdict(rows, widths, required = REQUIRED_WIDTHS) {
  const gated = rows.filter((r) => r.scope !== 'other');
  const inScope = rows.filter((r) => r.scope === 'in');
  const allPass = gated.every((r) => r.status === 'ok') && inScope.every((r) => r.pass);
  if (!allPass) return { gate: 'FAIL', exitCode: 1 };
  const missing = missingWidths(widths, required);
  if (missing.length) return { gate: `PARTIAL (widths: ${widths.join(',')})`, exitCode: 1, missingWidths: missing };
  return { gate: 'PASS', exitCode: 0 };
}

// --since accepts an ISO date/time or epoch milliseconds.
export function parseSince(value) {
  if (value == null || value === true) return null;
  const n = /^\d+$/.test(String(value)) ? Number(value) : Date.parse(String(value));
  if (!Number.isFinite(n)) throw new Error(`--since: cannot read "${value}" as a date`);
  return n;
}
