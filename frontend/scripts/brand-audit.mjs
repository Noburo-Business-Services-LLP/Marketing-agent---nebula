// Finds customer-visible old product/agent names (Gravity, Pulsar, Orbit) in the frontend source.
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

/** Remove comment text from one line; returns '' when the whole line is a comment. */
function stripComments(line, state) {
  let s = line;
  if (state.inBlock) {
    const end = s.indexOf('*/');
    if (end === -1) return '';
    state.inBlock = false;
    s = s.slice(end + 2);
  }
  s = s.replace(/\/\*.*?\*\//g, '').replace(/<!--.*?-->/g, '');
  const open = s.indexOf('/*');
  if (open !== -1) {
    state.inBlock = true;
    s = s.slice(0, open);
  }
  const trimmed = s.trim();
  if (trimmed.startsWith('//') || trimmed.startsWith('*')) return '';
  // trailing "// ..." (not the one in "https://")
  s = s.replace(/(^|\s)\/\/.*$/, '$1');
  return s;
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
