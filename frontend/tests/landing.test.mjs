// Guards for the public landing page: plain words only, an honest Inbox claim, and the plan order.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const land = fs.readFileSync(path.join(ROOT, 'pages/LandingPage.tsx'), 'utf8');

test('the landing page has no Quarks, credits, trial or 7 days wording', () => {
  for (const re of [/quarks?/i, /\bcredits?\b/i, /\btrials?\b/i, /7[- ]days?/i]) {
    assert.ok(!re.test(land), `landing page contains ${re}`);
  }
});

test('the workflow section shows all seven steps and keeps the Inbox honest', () => {
  const start = land.indexOf('const WORKFLOW = [');
  const end = land.indexOf('];', start);
  const block = land.slice(start, end);
  assert.equal((block.match(/title: '/g) || []).length, 7, 'seven workflow steps');
  const inbox = block.split('\n').find((l) => /Reply from one inbox/.test(l));
  assert.ok(inbox, 'a step about replying from one inbox');
  assert.ok(/drafted/.test(inbox) && /approve/.test(inbox), 'replies are drafted for approval');
  // Every mention of automatic sending on the page must say it is the owner's own choice.
  const sentences = land.split(/(?<=[.!?])\s+/);
  for (const s of sentences.filter((t) => /automatic/i.test(t))) {
    assert.ok(/unless you|only if you|until you|off/i.test(s), `unconditional automatic claim: ${s.slice(0, 120)}`);
  }
  assert.ok(!/replies? (you )?automatically|answers? (your )?(customers|messages|comments) automatically|replies on autopilot/i.test(land));
});

test('plan cards run Starter, then Growth, then Agency', () => {
  const plans = land.slice(land.indexOf('const PLANS = ['), land.indexOf('const ADDON_LINE'));
  const at = (n) => plans.indexOf(`name: '${n}'`);
  assert.ok(at('Starter') >= 0 && at('Starter') < at('Growth') && at('Growth') < at('Agency'));
  assert.ok(/md:grid-cols-3/.test(land), 'three columns on desktop');
});
