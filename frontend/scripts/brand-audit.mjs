// Finds customer-visible old product/agent names (Gravity, Pulsar, Orbit) in the frontend source.
// Matches only the capitalised / all-caps forms (Gravity, GRAVITY, Pulsar, Orbit). Lowercase visible
// text (e.g. a placeholder like gravity_official) must be checked by hand.
// Usage: findBrandViolations(rootDir) -> [{ file, line, text }]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXTS = new Set(['.ts', '.tsx', '.html']);
const SKIP_DIRS = new Set(['node_modules', 'tests', 'scripts', 'public', 'dist', '.git']);
const WORD = /\b(Gravity|GRAVITY|Pulsar|Orbit)\b/;

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), out);
    } else if (EXTS.has(path.extname(entry.name))) {
      out.push(path.join(dir, entry.name));
    }
  }
}

/**
 * Copy of the line with the contents of same-line "..." and `...` strings blanked (same length).
 * Single quotes are NOT treated as delimiters: apostrophes in JSX text and comments are ambiguous,
 * and over-reporting is acceptable here while missing a violation is not.
 */
function blankStrings(line) {
  const chars = line.split('');
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === '"' || c === '`') {
      let j = i + 1;
      while (j < line.length && line[j] !== c) j += line[j] === '\\' ? 2 : 1;
      if (j < line.length) {
        for (let k = i + 1; k < j; k++) chars[k] = ' ';
        i = j + 1;
        continue;
      }
    }
    i++;
  }
  return chars.join('');
}

/** Index of the next real block-comment opener at or after `from`, or -1. */
function findOpener(blank, from) {
  let at = from;
  for (;;) {
    const idx = blank.indexOf('/*', at);
    if (idx === -1) return -1;
    const prev = idx === 0 ? ' ' : blank[idx - 1];
    // After a JSX tag, a bare /* is text unless it is the {/* ... */} form.
    const jsxText = prev !== '{' && /<[A-Za-z]/.test(blank.slice(0, idx));
    if (/[\s{};,(]/.test(prev) && !jsxText) return idx;
    at = idx + 1;
  }
}

/** Remove comment text from one line; returns '' when the whole line is a comment. */
function stripComments(line, state) {
  if (!state.inBlock && line.trim().startsWith('//')) return '';
  const blank = blankStrings(line);
  const chars = line.split('');
  let i = 0;
  while (i < blank.length) {
    if (state.inBlock) {
      const end = line.indexOf('*/', i);
      const stop = end === -1 ? blank.length : end + 2;
      for (let k = i; k < stop; k++) chars[k] = ' ';
      if (end === -1) return '';
      state.inBlock = false;
      i = stop;
      continue;
    }
    const open = findOpener(blank, i);
    if (open === -1) break;
    const end = line.indexOf('*/', open + 2);
    const stop = end === -1 ? blank.length : end + 2;
    for (let k = open; k < stop; k++) chars[k] = ' ';
    if (end === -1) { state.inBlock = true; break; }
    i = stop;
  }
  let s = chars.join('');
  const b2 = blankStrings(s);
  const t = s.trim();
  if (t.startsWith('*') || t === '') return t === '' ? '' : '';
  // Trailing "// ..." comment: only in code context (not after a JSX tag, which would be text),
  // and never the "//" of a URL.
  const m = /(^|\s)\/\/(?!\/)/.exec(b2);
  if (m && !/<[A-Za-z]/.test(b2.slice(0, m.index))) s = s.slice(0, m.index);
  return s.replace(/<!--.*?-->/g, '');
}

function loadAllowlist(rootDir) {
  const p = path.join(rootDir, 'tests', 'brand-allowlist.json');
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function findBrandViolations(rootDir) {
  const allow = loadAllowlist(rootDir);
  const files = [];
  walk(rootDir, files);
  const violations = [];
  for (const abs of files.sort()) {
    const rel = path.relative(rootDir, abs).split(path.sep).join('/');
    const state = { inBlock: false };
    fs.readFileSync(abs, 'utf8').split('\n').forEach((raw, i) => {
      const code = stripComments(raw, state);
      if (!WORD.test(code)) return;
      if (allow.some((a) => a.file === rel && raw.includes(a.contains))) return;
      violations.push({ file: rel, line: i + 1, text: raw.trim() });
    });
  }
  return violations;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const v = findBrandViolations(root);
  for (const x of v) console.log(`${x.file}:${x.line}: ${x.text}`);
  console.log(`${v.length} violation(s)`);
  process.exit(v.length ? 1 : 0);
}
