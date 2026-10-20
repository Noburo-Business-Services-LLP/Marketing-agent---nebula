#!/usr/bin/env node
'use strict';
/**
 * One-off codemod: stop route and controller handlers from sending a caught exception's text to the client.
 *
 *   node scripts/codemod-error-leaks.js [--write] [files...]     (default: dry run over routes/ and controllers/)
 *
 * Inside `res.json({...})` / `res.status(N).json({...})` of a 5xx-or-unspecified status it rewrites:
 *   - `error: err.message` (also details/detail/reason) next to an existing `message`  -> the field is removed
 *   - `error: err.message` with no `message`                                            -> `message: <fallback>` (the frontend reads message)
 *   - `message: err.message` / `message: err.message || 'Text'`                         -> the static fallback text
 * and puts a server-side `console.error` before the statement when the catch block does not already log the error.
 * Anything it is not sure about (4xx statuses, dynamic statuses, one-line catch blocks, other shapes) is listed as
 * MANUAL and left alone, to be reviewed by hand (those may be deliberate text from our own code).
 * routes/auth.js is covered like every other route.
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_TEXT = 'Something went wrong. Please try again.';
const SKIP = new Set([]);
const LEAK_VALUE = /^(error|err|e)\.message(?:\s*\|\|\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"))?$/;
const LEAK_KEYS = new Set(['error', 'details', 'detail', 'reason', 'errorMessage']);

function matchBrace(src, open) {
  // returns index of the matching close brace, string/template/comment aware
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c; i++;
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; }
    } else if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; }
    else if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 1; }
    else if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

function splitProps(body, base) {
  // top-level properties of an object literal body (text between the braces) with absolute offsets
  const props = []; let depth = 0; let start = 0;
  const push = (end) => { const raw = body.slice(start, end); if (raw.trim()) props.push({ start: base + start, end: base + end, raw }); };
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '"' || c === "'" || c === '`') { const q = c; i++; while (i < body.length && body[i] !== q) { if (body[i] === '\\') i++; i++; } }
    else if (c === '/' && body[i + 1] === '/') { while (i < body.length && body[i] !== '\n') i++; }
    else if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) { push(i); start = i + 1; }
  }
  push(body.length);
  return props;
}

function processFile(file, src) {
  const manual = []; const edits = []; let handlers = 0;
  const re = /(res\s*\.status\(([^)]*)\)\s*\.json|res\s*\.json)\(\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    const open = m.index + m[0].length - 1;
    const close = matchBrace(src, open);
    if (close < 0) continue;
    const body = src.slice(open + 1, close);
    if (!/(?:error|err|e)\.message/.test(body)) continue;
    const props = splitProps(body, open + 1).map((p) => {
      const mm = p.raw.match(/^\s*([A-Za-z_$][\w$]*)\s*:\s*([\s\S]*?)\s*$/);
      return { ...p, key: mm && mm[1], value: mm && mm[2] };
    });
    const line = src.slice(0, m.index).split('\n').length;
    const statusArg = m[2] === undefined ? null : m[2].trim();
    const statusNum = statusArg && /^\d+$/.test(statusArg) ? Number(statusArg) : null;
    const leaky = props.filter((p) => p.value && LEAK_VALUE.test(p.value));
    const other = props.filter((p) => p.value && !LEAK_VALUE.test(p.value) && /(?:error|err|e)\.message/.test(p.value));
    if (!leaky.length || other.length) { manual.push({ line, why: 'unrecognised shape', text: body.trim().slice(0, 100) }); continue; }
    if (statusArg !== null && !(statusNum >= 500)) { manual.push({ line, why: `status ${statusArg}`, text: body.trim().slice(0, 100) }); continue; }
    const errVar = leaky[0].value.match(/^(error|err|e)/)[1];
    // statement start must begin its own line so a log line can be inserted before it
    const stmtStart = src.lastIndexOf('\n', m.index) + 1;
    const before = src.slice(stmtStart, m.index);
    if (!/^\s*(return\s+)?$/.test(before)) { manual.push({ line, why: 'statement shares its line', text: body.trim().slice(0, 100) }); continue; }
    const msgProp = props.find((p) => p.key === 'message');
    const msgLeaky = msgProp && leaky.includes(msgProp);
    const fallbackOf = (p) => { const f = p.value.match(LEAK_VALUE)[2]; return f || `'${DEFAULT_TEXT}'`; };
    let out = body; const rel = (p) => [p.start - (open + 1), p.end - (open + 1)];
    // apply edits from the back so offsets stay valid
    const ops = [];
    for (const p of leaky) {
      const isErrKey = LEAK_KEYS.has(p.key);
      if (p.key === 'message') ops.push({ p, kind: 'replace', text: ` message: ${fallbackOf(p)}` });
      else if (isErrKey) {
        if (msgProp && !msgLeaky) ops.push({ p, kind: 'remove' });
        else if (msgLeaky) ops.push({ p, kind: 'remove' });
        else ops.push({ p, kind: 'replace', text: ` message: ${fallbackOf(p)}` });
      } else { manual.push({ line, why: `key ${p.key}`, text: body.trim().slice(0, 100) }); ops.length = 0; break; }
    }
    if (!ops.length) continue;
    // two error-ish keys and no message would create two messages: keep only the first as message
    const replacesToMessage = ops.filter((o) => o.kind === 'replace');
    if (replacesToMessage.length > 1) { manual.push({ line, why: 'two message candidates', text: body.trim().slice(0, 100) }); continue; }
    ops.sort((a, b) => b.p.start - a.p.start);
    for (const o of ops) {
      const [s, e] = rel(o.p);
      const seg = out.slice(s, e);
      const lead = seg.match(/^\s*/)[0];
      const trail = seg.match(/\s*$/)[0];
      if (o.kind === 'replace') {
        out = out.slice(0, s) + lead + o.text.trim() + trail + out.slice(e);
      } else if (out[e] === ',') {
        // not the last property: drop it and its comma, keep the next property's own spacing
        out = out.slice(0, s) + out.slice(e + 1);
      } else {
        // last property: drop it and the comma before it, keep the closing whitespace
        const prev = out.slice(0, s).lastIndexOf(',');
        const from = prev >= 0 && !out.slice(prev + 1, s).trim() ? prev : s;
        out = out.slice(0, from) + trail + out.slice(e);
      }
    }
    // does the enclosing code already log this error within the 12 lines before?
    const lines = src.slice(0, stmtStart).split('\n').slice(-13).join('\n');
    const logged = new RegExp(`(console\\.(error|warn|log)|logger\\.\\w+)\\([^;]*\\b${errVar}\\b`).test(lines);
    const indent = before.match(/^\s*/)[0];
    edits.push({ open: open + 1, close, text: out, insertAt: logged ? null : stmtStart, insert: logged ? '' : `${indent}console.error('${path.basename(file)} request failed:', ${errVar} && ${errVar}.message);\n` });
    handlers += 1;
  }
  // apply back to front
  edits.sort((a, b) => b.open - a.open);
  let result = src;
  for (const e of edits) {
    result = result.slice(0, e.open) + e.text + result.slice(e.close);
    if (e.insertAt !== null) result = result.slice(0, e.insertAt) + e.insert + result.slice(e.insertAt);
  }
  return { result, manual, handlers };
}

function main() {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const root = path.join(__dirname, '..');
  let files = args.filter((a) => !a.startsWith('--'));
  if (!files.length) {
    files = [];
    for (const d of ['routes', 'controllers']) for (const f of fs.readdirSync(path.join(root, d))) if (f.endsWith('.js')) files.push(path.join(d, f));
  }
  let total = 0; let changedFiles = 0;
  for (const f of files) {
    const rel = f.replace(/\\/g, '/');
    if (SKIP.has(rel)) { console.log(`SKIP ${rel}`); continue; }
    const abs = path.isAbsolute(f) ? f : path.join(root, f);
    const src = fs.readFileSync(abs, 'utf8');
    const { result, manual, handlers } = processFile(abs, src);
    if (handlers) { total += handlers; changedFiles += 1; if (write) fs.writeFileSync(abs, result); }
    if (handlers || manual.length) console.log(`${rel}: ${handlers} rewritten, ${manual.length} manual`);
    for (const x of manual) console.log(`   MANUAL line ${x.line} (${x.why}): ${x.text.replace(/\s+/g, ' ')}`);
  }
  console.log(`${write ? 'WROTE' : 'DRY RUN'}: ${total} handlers in ${changedFiles} files`);
}
if (require.main === module) main();
module.exports = { processFile };
