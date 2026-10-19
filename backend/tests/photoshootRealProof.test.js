// The real-proof script for the Photoshoot studio never makes a call without the owner's yes, and the real-database check
// refuses any database but nebulaa_dev and uses fakes only.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

test('the real-proof script refuses to run without CONFIRM_REAL_PHOTOSHOOT=yes, before any call', () => {
  const env = { ...process.env, CONFIRM_REAL_PHOTOSHOOT: '', OPENAI_API_KEY: '' };
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/photoshoot-real-proof.js')], { env, encoding: 'utf8', timeout: 20000 });
  assert.strictEqual(r.status, 2);
  assert.match(r.stdout, /Refusing/);
});

test('the real-database check only uses nebulaa_dev, blanks the key and fakes every image call', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/photoshoot-check.js'), 'utf8');
  assert.match(src, /process\.env\.OPENAI_API_KEY = '';/);
  assert.match(src, /const DEV_DB = 'nebulaa_dev';/);
  assert.match(src, /if \(name !== DEV_DB\) throw new Error/);
  assert.match(src, /outside call blocked by the check/);
  assert.ok(!/generateOpenAIImage|api\.openai\.com/.test(src));
});
