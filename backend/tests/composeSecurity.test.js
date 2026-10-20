const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

test('the main compose file starts no tunnel and binds the API to this machine only', () => {
  const src = fs.readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf8');
  const code = src.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
  assert.ok(!/ngrok/i.test(code), 'no ngrok service');
  assert.match(code, /"127\.0\.0\.1:5000:5000"/);
  assert.ok(!/^\s*-\s*"5000:5000"/m.test(code));
});

test('the tunnel is a separate, local-only override', () => {
  const src = fs.readFileSync(path.join(ROOT, 'docker-compose.tunnel.yml'), 'utf8');
  assert.match(src, /LOCAL DEVELOPMENT ONLY/);
  assert.match(src, /"127\.0\.0\.1:4040:4040"/);
});
