import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('every plan and add-on has cover art, and the Plans page uses it', () => {
  const art = fs.readFileSync(path.join(ROOT, 'components/PlanArt.tsx'), 'utf8');
  for (const id of ['starter', 'professional', 'agency', 'publish', 'competitors', 'inbox', 'bundle']) {
    assert.ok(new RegExp(`\\n  ${id}: \\{`).test(art), `art for ${id}`);
  }
  assert.ok(art.includes('aria-hidden="true"'), 'decorative only');
  const page = fs.readFileSync(path.join(ROOT, 'pages/TrialExpired.tsx'), 'utf8');
  assert.ok(page.includes('<PlanArt id={plan.id}') && page.includes('<PlanArt id={a.id}') && page.includes('<PlanArt id="topup"'));
});
