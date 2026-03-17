import fs from 'node:fs';
import path from 'node:path';

const PATCH_MARKER = 'CODEX_PATCH_DISABLE_NET_USE';

function findViteDepChunkPath() {
  const chunksDir = path.join(
    process.cwd(),
    'node_modules',
    'vite',
    'dist',
    'node',
    'chunks'
  );
  if (!fs.existsSync(chunksDir)) return null;

  const candidateFiles = fs
    .readdirSync(chunksDir)
    .filter((f) => f.startsWith('dep-') && f.endsWith('.js'));

  for (const file of candidateFiles) {
    const fullPath = path.join(chunksDir, file);
    const contents = fs.readFileSync(fullPath, 'utf8');
    if (contents.includes('optimizeSafeRealPathSync') && contents.includes('exec("net use"')) {
      return fullPath;
    }
  }

  return null;
}

function findCallExpressionEnd(source, callStartIndex) {
  let index = callStartIndex;
  let parenDepth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let escaped = false;

  for (; index < source.length; index++) {
    const ch = source[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (inSingle) {
      if (ch === '\\') escaped = true;
      else if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === '\\') escaped = true;
      else if (ch === '"') inDouble = false;
      continue;
    }
    if (inTemplate) {
      if (ch === '\\') escaped = true;
      else if (ch === '`') inTemplate = false;
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === '`') {
      inTemplate = true;
      continue;
    }

    if (ch === '(') {
      parenDepth++;
      continue;
    }
    if (ch === ')') {
      parenDepth--;
      if (parenDepth === 0) {
        // include trailing semicolon if present
        let end = index + 1;
        while (end < source.length && /\s/.test(source[end])) end++;
        if (source[end] === ';') end++;
        return end;
      }
      continue;
    }
  }

  return null;
}

function patchViteNetUseExec(viteChunkPath) {
  const original = fs.readFileSync(viteChunkPath, 'utf8');
  if (original.includes(PATCH_MARKER)) return { changed: false, reason: 'already_patched' };

  const callNeedle = 'exec("net use"';
  const callStartIndex = original.indexOf(callNeedle);
  if (callStartIndex === -1) return { changed: false, reason: 'not_found' };

  const callEndIndex = findCallExpressionEnd(original, callStartIndex);
  if (!callEndIndex) return { changed: false, reason: 'could_not_parse' };

  const lineStart = original.lastIndexOf('\n', callStartIndex) + 1;
  const indent = original.slice(lineStart, callStartIndex).match(/^\s*/)?.[0] ?? '';

  const callExpr = original.slice(callStartIndex, callEndIndex);
  const callExprIndented = callExpr
    .split('\n')
    .map((line) => `${indent}  ${line.trimStart()}`)
    .join('\n');

  const replacement = [
    `${indent}/* ${PATCH_MARKER}: avoid child_process.exec("net use") on Windows when cmd.exe spawn is blocked */`,
    `${indent}try {`,
    callExprIndented,
    `${indent}} catch (e) {`,
    `${indent}  safeRealpathSync = fs__default.realpathSync.native;`,
    `${indent}}`,
  ].join('\n');

  const patched =
    original.slice(0, callStartIndex) + replacement + original.slice(callEndIndex);

  fs.writeFileSync(viteChunkPath, patched, 'utf8');
  return { changed: true, reason: 'patched' };
}

const viteChunkPath = findViteDepChunkPath();
if (!viteChunkPath) {
  console.warn('[patch-vite] Could not locate Vite dep chunk to patch.');
  process.exit(0);
}

const result = patchViteNetUseExec(viteChunkPath);
if (result.changed) {
  console.log(`[patch-vite] Patched Vite to avoid 'net use' exec: ${viteChunkPath}`);
} else {
  console.log(`[patch-vite] No changes (${result.reason}).`);
}

