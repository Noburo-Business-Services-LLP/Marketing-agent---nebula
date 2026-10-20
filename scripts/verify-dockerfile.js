#!/usr/bin/env node
'use strict';
/**
 * Static check of the backend images (hardening E6). No Docker needed:
 *   node scripts/verify-dockerfile.js            (checks Dockerfile.backend, Dockerfile and .dockerignore)
 * Rules for the FINAL stage of each API Dockerfile:
 *   - a non-root USER is set before the container starts (not root, not 0);
 *   - NODE_ENV=production and UV_THREADPOOL_SIZE are set with ENV;
 *   - a HEALTHCHECK runs node against /api/ready (no curl or wget, the slim image has neither);
 *   - ENTRYPOINT is docker-entrypoint.sh, which exists, is executable, uses NODE_HEAP_MB and execs node with
 *     --max-old-space-size (so node is PID 1 and gets SIGTERM);
 *   - every FROM names an exact Node minor (node:20.x.y-...), not a floating major tag.
 * .dockerignore must keep secrets, git, docs, tests and tool output out of the build context.
 * Exits 1 and lists the problems when a rule fails.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const API_DOCKERFILES = ['Dockerfile.backend', 'Dockerfile'];
const IGNORE_MUST = ['.git', 'node_modules', 'backend/.env', '.env', 'docs', 'backend/tests', 'frontend/tests', 'qa-reports', 'scratch', '.scannerwork', '*.md'];

// Joins backslash-continued lines and drops comments.
function instructions(text) {
  const out = [];
  let cur = '';
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!cur && (!line || line.startsWith('#'))) continue;
    if (line.endsWith('\\')) { cur += `${line.slice(0, -1)} `; continue; }
    cur += line;
    const m = /^([A-Za-z]+)\s+([\s\S]*)$/.exec(cur.trim());
    if (m) out.push({ op: m[1].toUpperCase(), args: m[2].trim() });
    cur = '';
  }
  return out;
}

function finalStage(list) {
  let start = 0;
  list.forEach((ins, i) => { if (ins.op === 'FROM') start = i; });
  return list.slice(start);
}

function envOf(stage) {
  const env = {};
  for (const ins of stage.filter((x) => x.op === 'ENV')) {
    const pairs = ins.args.match(/([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|'[^']*'|\S+)/g);
    if (pairs) for (const p of pairs) { const i = p.indexOf('='); env[p.slice(0, i)] = p.slice(i + 1).replace(/^["']|["']$/g, ''); } else {
      const [k, ...v] = ins.args.split(/\s+/); env[k] = v.join(' ');
    }
  }
  return env;
}

/** Problems found in one Dockerfile's text ([] when it passes). `readFile(rel)` reads repo files for the entrypoint. */
function verifyDockerfile(text, { readFile = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8'), statFile = (rel) => fs.statSync(path.join(ROOT, rel)) } = {}) {
  const problems = [];
  const all = instructions(text);
  if (!all.some((x) => x.op === 'FROM')) return ['no FROM'];
  for (const f of all.filter((x) => x.op === 'FROM')) {
    const image = f.args.split(/\s+/)[0];
    if (/^node:/.test(image) && !/^node:\d+\.\d+\.\d+-/.test(image)) problems.push(`FROM ${image}: pin an exact Node version (node:20.x.y-bookworm-slim)`);
  }
  const stage = finalStage(all);
  const users = stage.filter((x) => x.op === 'USER').map((x) => x.args.split(/[\s:]/)[0]);
  const lastUser = users[users.length - 1];
  if (!lastUser) problems.push('final stage has no USER (runs as root)');
  else if (lastUser === 'root' || lastUser === '0') problems.push(`final USER is ${lastUser}`);
  const env = envOf(stage);
  if (env.NODE_ENV !== 'production') problems.push('ENV NODE_ENV=production missing in the final stage');
  if (!/^\d+$/.test(String(env.UV_THREADPOOL_SIZE || ''))) problems.push('ENV UV_THREADPOOL_SIZE missing in the final stage');
  const hc = stage.filter((x) => x.op === 'HEALTHCHECK');
  if (!hc.length) problems.push('no HEALTHCHECK');
  else {
    const h = hc[hc.length - 1].args;
    if (!/\/api\/ready/.test(h)) problems.push('HEALTHCHECK must probe /api/ready');
    if (!/\bnode\b/.test(h)) problems.push('HEALTHCHECK must use node');
    if (/\b(curl|wget)\b/.test(h)) problems.push('HEALTHCHECK must not need curl or wget');
  }
  const ep = stage.filter((x) => x.op === 'ENTRYPOINT').pop();
  if (!ep || !/docker-entrypoint\.sh/.test(ep.args)) problems.push('ENTRYPOINT must be docker-entrypoint.sh');
  else {
    let script = '';
    try { script = readFile('backend/docker-entrypoint.sh'); } catch (_) { problems.push('backend/docker-entrypoint.sh is missing'); }
    if (script) {
      if (!/NODE_HEAP_MB/.test(script)) problems.push('entrypoint must read NODE_HEAP_MB');
      if (!/exec node --max-old-space-size=/.test(script)) problems.push('entrypoint must exec node --max-old-space-size=...');
      if (!/^#!\/bin\/sh/.test(script)) problems.push('entrypoint must start with #!/bin/sh');
      if (/\r/.test(script)) problems.push('entrypoint has Windows line endings');
      try { if (process.platform !== 'win32' && !(statFile('backend/docker-entrypoint.sh').mode & 0o111)) problems.push('entrypoint is not executable'); } catch (_) { /* reported above */ }
    }
  }
  const userIdx = stage.findIndex((x) => x.op === 'USER');
  const lastCmd = Math.max(...['CMD', 'ENTRYPOINT'].map((op) => stage.map((x) => x.op).lastIndexOf(op)));
  if (userIdx > -1 && lastCmd > -1 && userIdx > lastCmd) problems.push('USER must come before CMD/ENTRYPOINT');
  if (!stage.some((x) => x.op === 'RUN' && /chown[^&]*node:node[^&]*storage/.test(x.args))) problems.push('storage/ (and temp/) must be chowned to node');
  return problems;
}

function verifyDockerignore(text) {
  const lines = new Set(String(text).split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')));
  return IGNORE_MUST.filter((p) => !lines.has(p)).map((p) => `.dockerignore must exclude ${p}`);
}

function main() {
  const problems = [];
  for (const f of API_DOCKERFILES) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    for (const msg of verifyDockerfile(fs.readFileSync(p, 'utf8'))) problems.push(`${f}: ${msg}`);
  }
  const di = path.join(ROOT, '.dockerignore');
  if (!fs.existsSync(di)) problems.push('.dockerignore is missing');
  else problems.push(...verifyDockerignore(fs.readFileSync(di, 'utf8')));
  if (problems.length) { console.error(`verify-dockerfile: ${problems.length} problem(s)\n- ${problems.join('\n- ')}`); process.exit(1); }
  console.log(`verify-dockerfile: ok (${API_DOCKERFILES.join(', ')}, .dockerignore)`);
}

if (require.main === module) main();
module.exports = { verifyDockerfile, verifyDockerignore, instructions };
