// Mechanical floor for the app voice rule (see docs/superpowers/specs/2026-10-03-nebulaa-app-voice-design.md).
// Reports, in customer-visible strings and JSX text of the scoped files: exclamation marks, emoji,
// banned slang/filler phrases, "Not X — Y" openers and em dashes. False positives are acceptable
// (use tests/voice-allowlist.json with a reason); false negatives are not.
// Usage: findVoiceViolations(rootDir, scopeFiles) -> [{ file, line, rule, text }]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from './brand-audit.mjs';

const BANNED = [
  'no fluff', 'game-changer', 'game changer', 'supercharge', 'unlock', 'seamless', 'vibe', 'gonna', 'wanna',
  'hey ', 'oops', 'yay', 'awesome', 'amazing', 'magic', 'while you slept', 'ready for your eye',
  'enjoy a slower day', "let's go", 'bestie', 'slay',
];
// "hey " is matched as a whole word so that "they " is not reported.
const BANNED_RES = BANNED.map((p) => ({ p, re: new RegExp(`(^|[^a-z])${p.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}`, 'i') }));
const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;
const NOT_EM = /^\s*Not\s[^—]*—/;
const CODE_START = /^(import|export|const|let|var|return|if|else|case|type|interface|function|async|await|default|break|continue|try|catch|switch|for|while)\b/;

/** Text segments of one comment-stripped line that a customer can see (string literals and JSX text). */
function visibleSegments(code) {
  const segs = [];
  // String literals: " ... ", ` ... ` (with ${} blanked) and ' ... ' (opening quote not after a word char).
  const re = /"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)(`|$)|(?<![\w])'((?:[^'\\]|\\.)*)'/g;
  let m;
  while ((m = re.exec(code))) {
    const body = m[1] ?? m[2] ?? m[4] ?? '';
    segs.push(body.replace(/\$\{[^}]*\}/g, ' '));
  }
  // JSX text between ">" or "}" and the next "<" or "{" (or end of line).
  const jsx = /(?:(?<![=\-\s])>(?!=)|\})([^<>{}]+)/g;
  while ((m = jsx.exec(code))) segs.push(m[1]);
  // Whole-line JSX text (continuation lines of a paragraph): no code punctuation outside {...}.
  const t = code.trim();
  const noExpr = t.replace(/\{[^{}]*\}/g, ' ');
  if (t && !CODE_START.test(t) && !/[;=()<>]/.test(noExpr) && /\s/.test(noExpr)) segs.push(noExpr);
  return segs;
}

function loadAllowlist(rootDir) {
  const p = path.join(rootDir, 'tests', 'voice-allowlist.json');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : [];
}

function rulesFor(seg) {
  const hit = [];
  // Text exclamation: "Saved!", "Done! Next", "Wow!". Code (!x, !==, className="!mb-0") is not text.
  if (/[\w.?)"'’”*]!|!(\s|$|["'’”)])/.test(seg)) hit.push('exclamation');
  if (EMOJI.test(seg.replace(/[©®™]/g, ''))) hit.push('emoji');
  for (const { p, re } of BANNED_RES) if (re.test(seg)) { hit.push(`banned:${p.trim()}`); }
  if (NOT_EM.test(seg)) hit.push('not-x-dash');
  // A lone dash ("—" or '—') is an empty-value placeholder, not a sentence.
  const noPlaceholder = seg.replace(/(['"`])—\1/g, '');
  if (/—/.test(noPlaceholder) && noPlaceholder.trim() !== '—') hit.push('em-dash');
  return hit;
}

export function findVoiceViolations(rootDir, scopeFiles) {
  const allow = loadAllowlist(rootDir);
  const violations = [];
  for (const rel of scopeFiles) {
    const abs = path.join(rootDir, rel);
    const state = { inBlock: false };
    fs.readFileSync(abs, 'utf8').split('\n').forEach((raw, i) => {
      const code = stripComments(raw, state);
      if (!code.trim()) return;
      if (allow.some((a) => a.file === rel && raw.includes(a.contains))) return;
      const rules = new Set();
      for (const seg of visibleSegments(code)) for (const r of rulesFor(seg)) rules.add(r);
      for (const rule of rules) violations.push({ file: rel, line: i + 1, rule, text: raw.trim() });
    });
  }
  return violations;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const scope = process.argv.length > 2 ? process.argv.slice(2)
    : JSON.parse(fs.readFileSync(path.join(root, 'tests', 'voice-scope.json'), 'utf8'));
  const v = findVoiceViolations(root, scope);
  for (const x of v) console.log(`${x.file}:${x.line}: [${x.rule}] ${x.text}`);
  console.log(`${v.length} violation(s)`);
  process.exit(v.length ? 1 : 0);
}
