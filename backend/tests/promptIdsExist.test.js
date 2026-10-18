const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const reg = require('../services/promptRegistry');

// A prompt id used in code but missing from the registry throws "Unknown prompt" at run time (calendar covers broke this way).
test('every prompt id passed to buildPrompt exists in the registry', () => {
  const ids = new Set();
  for (const dir of ['routes', 'services']) {
    for (const f of fs.readdirSync(path.join(__dirname, '..', dir))) {
      if (!f.endsWith('.js')) continue;
      const src = fs.readFileSync(path.join(__dirname, '..', dir, f), 'utf8');
      for (const m of src.matchAll(/buildPrompt\([^,()]*,\s*'([a-zA-Z]+\.[a-zA-Z]+)'/g)) ids.add(m[1]);
    }
  }
  assert.ok(ids.size > 10);
  const have = Object.keys(reg.PROMPTS || reg.REGISTRY || {});
  assert.ok(have.length > 10);
  const missing = [...ids].filter((i) => !have.includes(i));
  assert.deepEqual(missing, []);
});
