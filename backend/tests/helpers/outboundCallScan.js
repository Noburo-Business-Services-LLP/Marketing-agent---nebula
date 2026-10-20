'use strict';
// Finds every outbound HTTP call in the backend's runtime code (routes, services, controllers, utils, middleware,
// config, models and the top-level server files). Used by tests/safeFetchGuard.test.js (hardening C4).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DIRS = ['routes', 'services', 'controllers', 'utils', 'middleware', 'config', 'models'];
const TOP = ['server.js', 'server-main.js', 'bootstrap.js'];
// A call: plain fetch( (not .fetch( of an SDK), the usual fetch wrappers, axios, and node http/https requests.
const CALL = /(?<![.\w$])(fetch|fetchImpl|fetchFn|doFetch|fetchWithTimeout|axios(?:\.(?:get|post|put|patch|delete|head|request))?|https?\.(?:get|request)|(?:client|protocol|transport|lib)\.(?:get|request))\(/g;
const FIXED = /^\s*[`'"]https:\/\/[a-z0-9.-]+\.[a-z]{2,}[/?`'"]/i;

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); } else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

function files() {
  const out = [];
  for (const d of DIRS) { const p = path.join(ROOT, d); if (fs.existsSync(p)) walk(p, out); }
  for (const f of TOP) { const p = path.join(ROOT, f); if (fs.existsSync(p)) out.push(p); }
  return out;
}

/** [{ file (relative, posix), line, text, callee, fixed }] */
function scan() {
  const found = [];
  for (const abs of files()) {
    const rel = path.relative(ROOT, abs).split(path.sep).join('/');
    const lines = fs.readFileSync(abs, 'utf8').split('\n');
    lines.forEach((text, i) => {
      const t = text.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
      for (const m of text.matchAll(CALL)) {
        const before = text.slice(0, m.index);
        if (/function\s*$|function\s+$/.test(before) || /\bfunction\s+\w*\s*$/.test(before)) continue; // a definition
        // The first argument may start on the next line.
        let rest = text.slice(m.index + m[0].length);
        if (!rest.trim() && lines[i + 1] !== undefined) rest = lines[i + 1];
        found.push({ file: rel, line: i + 1, text: t, callee: m[1], fixed: FIXED.test(rest) });
      }
    });
  }
  return found;
}

module.exports = { scan };
