import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findVoiceViolations } from '../scripts/voice-audit.mjs';

function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-'));
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  }
  return dir;
}
const rules = (v) => v.map((x) => `${x.line}:${x.rule}`);

test('reports a violating JSX line for each rule', () => {
  const dir = fixture({
    'a.tsx': [
      '<p>Your posts are ready!</p>',
      '<p>Posts are live 🎉</p>',
      '<p>Enjoy a slower day.</p>',
      '<p>Unlock your reach</p>',
      "<p>Hey there</p>",
      '<h2>Not a tool — a team</h2>',
      '<p>Drafted, scheduled — posted.</p>',
      'const a = "Oops, try again";',
      'toast("Saved!");',
    ].join('\n'),
  });
  const r = rules(findVoiceViolations(dir, ['a.tsx']));
  assert.ok(r.includes('1:exclamation'));
  assert.ok(r.includes('2:emoji'));
  assert.ok(r.includes('3:banned:enjoy a slower day'));
  assert.ok(r.includes('4:banned:unlock'));
  assert.ok(r.includes('5:banned:hey'));
  assert.ok(r.includes('6:not-x-dash'));
  assert.ok(r.includes('6:em-dash'));
  assert.ok(r.includes('7:em-dash'));
  assert.ok(r.includes('8:banned:oops'));
  assert.ok(r.includes('9:exclamation'));
});

test('plain text, code operators and comments are not reported', () => {
  const dir = fixture({
    'a.tsx': [
      '<p>Review each post, then approve the ones you want.</p>',
      'if (!ready && a !== b) return null;',
      'const c = x != null ? 1 : 2;',
      '// Oops! magic comment — not shown',
      '{/* Hey! unlock */}',
      '/* yay',
      ' still a comment! */',
      '<p>They review it.</p>',
      '<input placeholder="Search your posts" />',
      '<p className="a-b">Plain sentence.</p>',
    ].join('\n'),
  });
  assert.deepEqual(findVoiceViolations(dir, ['a.tsx']), []);
});

test('multi-line JSX paragraphs are scanned', () => {
  const dir = fixture({ 'a.tsx': '<p>\n  Nebulaa prepares the week ahead\n  and schedules it — done!\n</p>' });
  const r = rules(findVoiceViolations(dir, ['a.tsx']));
  assert.ok(r.includes('3:exclamation') && r.includes('3:em-dash'));
});

test('files outside the scope are not scanned', () => {
  const dir = fixture({ 'a.tsx': '<p>Yay!</p>', 'b.tsx': '<p>Fine.</p>' });
  assert.deepEqual(findVoiceViolations(dir, ['b.tsx']), []);
});

test('scanner honours the allowlist', () => {
  const dir = fixture({
    'a.tsx': '<p>Plan — Pro</p>\n<p>Done — really</p>',
    'tests/voice-allowlist.json': JSON.stringify([{ file: 'a.tsx', contains: 'Plan — Pro', reason: 'test' }]),
  });
  assert.deepEqual(findVoiceViolations(dir, ['a.tsx']).map((x) => x.line), [2]);
});

test('the rewritten files have zero voice violations', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const scope = JSON.parse(fs.readFileSync(path.join(root, 'tests', 'voice-scope.json'), 'utf8'));
  const v = findVoiceViolations(root, scope);
  assert.equal(v.length, 0, v.map((x) => `${x.file}:${x.line} [${x.rule}] ${x.text}`).join('\n'));
});
