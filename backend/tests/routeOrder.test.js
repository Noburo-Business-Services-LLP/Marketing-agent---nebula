const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// A route that names a limiter or guard before its `const` line throws at startup
// ("Cannot access ... before initialization") and the server never boots.
test('every route file defines a limiter before any route uses it', () => {
  const dir = path.join(__dirname, '..', 'routes');
  const problems = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const lines = fs.readFileSync(path.join(dir, file), 'utf8').split('\n');
    const declared = new Map();
    lines.forEach((line, i) => {
      const m = line.match(/^const\s+(\w*[Ll]imiter\w*)\s*=/);
      if (m) declared.set(m[1], i);
    });
    lines.forEach((line, i) => {
      if (!/^\s*router\.(get|post|put|patch|delete|use)\(/.test(line)) return;
      for (const [name, at] of declared) {
        if (new RegExp(`\\b${name}\\b`).test(line) && i < at) problems.push(`${file}:${i + 1} uses ${name} before line ${at + 1}`);
      }
    });
  }
  assert.deepStrictEqual(problems, []);
});
