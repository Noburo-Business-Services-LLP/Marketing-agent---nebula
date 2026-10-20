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
const SKIP_FILES = [/^pages\/staff\//, /^pages\/TermsAndConditions\.tsx$/, /^pages\/PrivacyPolicy\.tsx$/, /^pages\/RefundPolicy\.tsx$/];
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
  // The landing reads the public plans answer; until it arrives it shows PLANS_SNAPSHOT (utils/landingPlans.ts).
  // The snapshot must match the config: allowance, posts and videos, price, included clients and the extra client price.
  const cfg = await import(path.resolve(ROOT, '../backend/config/apiCosts.js'));
  const { PLANS, outputsFor, AGENCY } = cfg.default || cfg;
  const { PLANS_SNAPSHOT } = await import(path.join(ROOT, 'utils/landingPlans.ts'));
  for (const id of ['starter', 'professional', 'agency']) {
    const snap = PLANS_SNAPSHOT.plans.find((p) => p.id === id);
    assert.equal(snap.quarks, PLANS[id].quarks, `${id} Quarks`);
    assert.equal(snap.inr, PLANS[id].inr, `${id} price`);
    const o = outputsFor(PLANS[id].quarks);
    assert.ok(snap.features.includes(`Up to ${o.posts.toLocaleString('en-IN')} posts a month, or`), `landing shows ${o.posts} posts for ${id}`);
    assert.ok(snap.features.includes(`up to ${o.videos.toLocaleString('en-IN')} short videos with voice and music`), `landing shows ${o.videos} videos for ${id}`);
  }
  assert.equal(PLANS_SNAPSHOT.agency.includedClients, AGENCY.includedClients, 'included client brands');
  assert.equal(PLANS_SNAPSHOT.agency.slotInr, AGENCY.slot.inr, 'extra client price');
  const land = ['pages/LandingPage.tsx', 'constants/landingCopy.ts', 'utils/landingPlans.ts'].map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  assert.ok(!/7 days free|free for 7 days|no card needed/i.test(land));
});

/*
 * The plans page is for customers, who see posts and videos and never Quarks. Quark stays in code identifiers and API
 * field names only. The same rule covers the pure helpers the page prints, and the page must stay in the light theme.
 */
const QUARK = /\bquarks?\b/i;
const PLANS_PAGE_FILES = ['pages/TrialExpired.tsx', 'utils/agencyPlan.ts', 'components/ExtraClientDialog.tsx', 'components/CancelExtraClientDialog.tsx', 'components/AgencyDialog.tsx'];

test('the plans page and its helpers show no Quarks, credits, trial or 7 days to customers', () => {
  const bad = [];
  for (const rel of PLANS_PAGE_FILES) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const h of findWordingViolations(src)) bad.push(`${rel}:${h.line}  ${h.text.slice(0, 90)}`);
    let inBlock = false;
    src.split('\n').forEach((raw, i) => {
      let line = raw;
      if (inBlock) { const e = line.indexOf('*/'); if (e < 0) return; line = line.slice(e + 2); inBlock = false; }
      line = line.replace(/\/\*.*?\*\//g, '');
      const o = line.indexOf('/*'); if (o >= 0) { inBlock = true; line = line.slice(0, o); }
      line = line.replace(/(^|\s)\/\/.*$/, '$1');
      if (/^\s*\*/.test(line)) return;
      for (const t of visibleText(line)) if (QUARK.test(t)) bad.push(`${rel}:${i + 1}  ${t.trim().slice(0, 90)}`);
    });
  }
  // utils/plans.ts is not listed: its upgrade messages are shared with other pages (UpgradePrompt) and still name Quarks; the new plans-page helpers in it are covered by plansPage.test.mjs.
  assert.deepEqual(bad, []);
});

test('the plans page is light: no starfield, no hard-coded dark backgrounds', () => {
  const src = fs.readFileSync(path.join(ROOT, 'pages/TrialExpired.tsx'), 'utf8');
  assert.doesNotMatch(src, /Starfield|SpaceBg|GlassCard|nebulaa-gold|backdrop-blur|#070a12|#0d1219|#060910/i);
  assert.doesNotMatch(src, /text-white|bg-white\/|text-\[#ededed\]/);
  // The page renders inside the app shell (which carries the new logo), not as a separate dark screen.
  const app = fs.readFileSync(path.join(ROOT, 'App.tsx'), 'utf8');
  assert.ok(app.indexOf('<Layout ') > 0 && app.indexOf('path="/trial-expired"') > app.indexOf('<Layout '), 'the /trial-expired route is inside Layout');
  assert.equal((app.match(/path="\/trial-expired"/g) || []).length, 1);
});
