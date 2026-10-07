import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function sources(dir = ROOT, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!['node_modules', 'dist', 'tests', 'scripts', 'public'].includes(e.name)) sources(path.join(dir, e.name), out); }
    else if (/\.(tsx?|jsx?)$/.test(e.name)) out.push(path.join(dir, e.name));
  }
  return out;
}

test('the old shared-login admin pages are gone', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'pages/AdminDashboard.tsx')), false);
  assert.equal(fs.existsSync(path.join(ROOT, 'pages/AdminLogin.tsx')), false);
});

test('/admin and /admin/login send people to the normal sign-in', () => {
  const app = read('App.tsx');
  assert.doesNotMatch(app, /AdminDashboard|AdminLogin/);
  assert.match(app, /<Route path="\/admin\/login" element=\{<Navigate to="\/login" replace \/>\} \/>/);
  assert.match(app, /<Route path="\/admin" element=\{<Navigate to="\/login" replace \/>\} \/>/);
});

test('no source file still reads or writes the old adminToken or calls the old /admin API', () => {
  for (const f of sources()) {
    const text = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(text, /adminToken/, path.relative(ROOT, f));
    assert.doesNotMatch(text, /\/api\/admin|\$\{[A-Za-z_]+\}\/admin/, path.relative(ROOT, f));
  }
});
