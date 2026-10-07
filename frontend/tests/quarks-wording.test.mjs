import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Customer-facing wording scanner.
 *
 * Fails on "credit(s)", "trial" (incl. "free trial") and "7 days" / "7-day"
 * when they appear in text a customer can read: JSX text and string literals
 * with more than one word (or the capitalised single words "Credits"/"Trial").
 *
 * What is allowed, and why:
 *  - comments (line, block, JSX)
 *  - identifiers, imports, class names and API fields (creditsRemaining,
 *    getCredits, /credits, 'trial-expired', 'credits-updated', reason
 *    'credits'): they are never JSX text or multi-word literals
 *  - single lowercase tokens in quotes such as 'credits' or 'trial'
 *  - the Meta ad category "Credit, loans, financial services" (BoostPostModal)
 *  - analytics windows, e.g. "Last 7 days", "previous 7 days", "Reach (7 days)"
 *  - lucide icon names (CreditCard) are identifiers, not text
 *  - files excluded below: the staff area is staff-only, and the legal
 *    pages (Terms, Privacy) are contract text that needs a lawyer's edit
 *  - console.* lines (developer logs)
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', 'dist', 'tests', 'public', 'scripts', 'scratch']);
const SKIP_FILES = [/^pages\/staff\//, /^pages\/TermsAndConditions\.tsx$/, /^pages\/PrivacyPolicy\.tsx$/];
const WORDS = /\bcredits?\b|\btrials?\b|\b7[- ]days?\b/i;
const ALLOWED_PHRASES = [/(last|previous) 7 days/i, /\(7 days\)/i, /Credit, loans/];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), out); }
    else if (/\.(tsx?|html)$/.test(e.name)) out.push(path.join(dir, e.name));
  }
  return out;
}

export function visibleText(line) {
  const parts = [];
  for (const m of line.matchAll(/(['"`])((?:\\.|(?!\1).)*?)\1/g)) {
    const s = m[2];
    if (/\s/.test(s.trim()) || /^(Credits?|Trials?)$/.test(s)) parts.push(s);
  }
  for (const m of line.matchAll(/>([^<>{}]+)</g)) parts.push(m[1]);
  // A bare line of JSX text that wraps from the line above.
  if (/^\s*[A-Za-z][A-Za-z ,.'-]* [A-Za-z ,.'-]*$/.test(line)) parts.push(line);
  return parts;
}

export function findWordingViolations(src) {
  const hits = [];
  let inBlock = false;
  src.split('\n').forEach((raw, i) => {
    let line = raw;
    if (inBlock) { const e = line.indexOf('*/'); if (e < 0) return; line = line.slice(e + 2); inBlock = false; }
    line = line.replace(/\/\*.*?\*\//g, '').replace(/\{\s*\}/g, '');
    const o = line.indexOf('/*'); if (o >= 0) { inBlock = true; line = line.slice(0, o); }
    line = line.replace(/(^|\s)\/\/.*$/, '$1');
    if (/^\s*\*/.test(line) || /console\.\w+\(/.test(line)) return;
    for (let text of visibleText(line)) {
      for (const a of ALLOWED_PHRASES) text = text.replace(new RegExp(a.source, 'gi'), '');
      if (WORDS.test(text)) hits.push({ line: i + 1, text: text.trim() });
    }
  });
  return hits;
}

test('scanner flags customer text and ignores identifiers, comments and analytics windows', () => {
  const src = [
    '<p>You have 5 credits left.</p>',
    '  will use credits faster.',
    "alert('Your free trial ends in 7 days');",
    'const reason = "credits";',
    "window.addEventListener('credits-updated', fn);",
    '// 7-day trial comment',
    '<span>Last 7 days</span>',
    'const creditsRemaining = res.creditsRemaining;',
    '{/* credits note */}',
    "const h = ['User', 'Credits'];",
  ].join('\n');
  assert.deepEqual(findWordingViolations(src).map((h) => h.line), [1, 2, 3, 10]);
});

test('no customer-facing credits, trial or 7-day wording in the frontend', () => {
  const bad = [];
  for (const f of walk(ROOT)) {
    const rel = path.relative(ROOT, f).split(path.sep).join('/');
    if (SKIP_FILES.some((r) => r.test(rel))) continue;
    for (const h of findWordingViolations(fs.readFileSync(f, 'utf8'))) bad.push(`${rel}:${h.line}  ${h.text.slice(0, 90)}`);
  }
  assert.deepEqual(bad, []);
});

test('landing page plan figures come from the backend PLANS config', async () => {
  const cfg = await import(path.resolve(ROOT, '../backend/config/apiCosts.js'));
  const PLANS = (cfg.default || cfg).PLANS;
  const land = fs.readFileSync(path.join(ROOT, 'pages/LandingPage.tsx'), 'utf8');
  for (const id of ['starter', 'professional']) {
    const q = PLANS[id].quarks ?? PLANS[id].credits ?? PLANS[id].allowance;
    assert.ok(Number.isInteger(q), `PLANS.${id} has a Quark allowance`);
    assert.ok(land.includes(`${q.toLocaleString('en-US')} Quarks a month`), `landing shows ${q} for ${id}`);
  }
  assert.ok(!/7 days free|free for 7 days|no card needed/i.test(land));
});
