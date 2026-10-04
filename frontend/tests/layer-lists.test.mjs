import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/visual-audit/gen-layer-lists.mjs', import.meta.url));

test('the generated LIGHT SEMANTICS block in index.html is up to date with gen-layer-lists.mjs', () => {
  // exits 1 (and throws here) when someone edited the block by hand or added classes without regenerating
  const out = execFileSync(process.execPath, [script, '--check'], { encoding: 'utf8' });
  assert.match(out, /up to date/);
});
