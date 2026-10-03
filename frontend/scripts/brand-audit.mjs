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

/** Copy of the line with the contents of "..", '..' and `..` blanked (same length). */
function blankStrings(line) {
  let out = '';
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '\\') { out += '  '; i++; continue; }
      if (c === q) { q = null; out += c; } else out += ' ';
    } else if (c === '"' || c === '`' || (c === "'" && line.indexOf("'", i + 1) !== -1)) {
      q = c; out += c;
    } else out += c;
  }
  return out;
}

/** Remove comment text from one line; returns '' when the whole line is a comment. */
function stripComments(line, state) {
  if (!state.inBlock && line.trim().startsWith('//')) return '';
  const blank = blankStrings(line);
  const chars = line.split('');
  let i = 0;
  while (i < blank.length) {
    if (state.inBlock) {
      const end = blank.indexOf('*/', i);
      const stop = end === -1 ? blank.length : end + 2;
      for (let k = i; k < stop; k++) chars[k] = ' ';
      if (end === -1) return '';
      state.inBlock = false;
      i = stop;
      continue;
    }
    const open = blank.indexOf('/*', i);
    if (open === -1) break;
    const end = blank.indexOf('*/', open + 2);
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
