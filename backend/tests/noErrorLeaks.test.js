const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * No route or controller may send a caught exception's text to the client. A call that answers the client
 * (res.json / res.send / res.write / an SSE send) must not contain `error.message`, `err.message` or `e.message`
 * unless it is in the reviewed allowlist below, with the reason it is safe.
 * routes/auth.js is checked by the other hardening change (it is listed in SKIPPED until that lands).
 */
const ROOT = path.join(__dirname, '..');
const DIRS = ['routes', 'controllers'];
const SKIPPED = new Set(['routes/auth.js']);

const ALLOWED = [
  { file: 'routes/ads.js', has: "error.code === 'NO_PROFILE_KEY'", reason: 'our own refusal text thrown by services/ayrshareGuard (connect your own profile first); any other error gets a plain 500' },
  { file: 'routes/analytics.js', has: "error.code === 'NO_PROFILE_KEY'", reason: 'the same deliberate ayrshareGuard sentence (403)' },
  { file: 'routes/account.js', has: 'e.already ? 409 : 403', reason: '`e` is the eligibility RESULT object of services/accountDeletion (its own plain sentence), not a caught exception' },
  { file: 'routes/account.js', has: 'canDelete: e.ok', reason: 'same eligibility RESULT object: its plain sentence tells the customer why deletion is not available' },
  { file: 'routes/campaigns.js', has: 'error.status === 400', reason: 'services/listPage throws "That page link is not valid" (our own text, status 400) for a bad cursor' },
  { file: 'routes/drafts.js', has: 'error.status === 400', reason: 'same listPage bad-cursor sentence' },
  { file: 'routes/campaigns.js', has: 'NO_POSTS_MESSAGE', reason: 'only the exact sentence we throw ourselves is passed on; any other exception is replaced' },
  { file: 'controllers/socialInboxController.js', has: 'error.statusCode', reason: 'services/socialInboxService.httpError() builds these (validation sentences we wrote, with a statusCode); anything else is a plain 500' }
];

function callArgs(src, start) {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') { const q = c; i++; while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; } }
    else if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; }
    else if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  return src.slice(start);
}

function offenders() {
  const found = [];
  for (const d of DIRS) {
    for (const f of fs.readdirSync(path.join(ROOT, d)).filter((n) => n.endsWith('.js'))) {
      const rel = `${d}/${f}`;
      if (SKIPPED.has(rel)) continue;
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      const re = /\b(?:res\s*\.\s*(?:status\([^)]*\)\s*\.\s*)?(?:json|send|write)|sendEvent|send)\s*\(/g;
      let m;
      while ((m = re.exec(src))) {
        const args = callArgs(src, m.index + m[0].length - 1);
        if (!/\b(?:error|err|e)\s*(?:&&\s*(?:error|err|e)\s*)?\.\s*message\b/.test(args)) continue;
        // include the lines around the call so the allowlist can key on the guard condition
        const line = src.slice(0, m.index).split('\n').length;
        const context = src.split('\n').slice(Math.max(0, line - 3), line + args.split('\n').length).join('\n');
        if (ALLOWED.some((a) => a.file === rel && context.includes(a.has))) continue;
        found.push(`${rel}:${line}: ${args.replace(/\s+/g, ' ').slice(0, 110)}`);
      }
    }
  }
  return found;
}

test('no route or controller sends error.message / err.message / e.message to the client', () => {
  const found = offenders();
  assert.deepStrictEqual(found, [], `these send exception text to the client:\n${found.join('\n')}`);
});

test('every allowlist entry is still needed and states its reason', () => {
  for (const a of ALLOWED) {
    assert.ok(a.reason && a.reason.length > 20, `${a.file} needs a reason`);
    const src = fs.readFileSync(path.join(ROOT, a.file), 'utf8');
    assert.ok(src.includes(a.has), `${a.file}: allowlist entry "${a.has}" no longer matches the source, remove it`);
  }
});

test('the checker itself catches the patterns the audit found', () => {
  const sample = "res.status(500).json({ success: false, message: 'x', error: error.message }); res.json({ error: err.message }); send('error', { message: e.message || 'x' });";
  const re = /\b(?:res\s*\.\s*(?:status\([^)]*\)\s*\.\s*)?(?:json|send|write)|sendEvent|send)\s*\(/g;
  let n = 0; let m;
  while ((m = re.exec(sample))) { if (/\b(?:error|err|e)\s*\.\s*message\b/.test(callArgs(sample, m.index + m[0].length - 1))) n++; }
  assert.strictEqual(n, 3);
});
