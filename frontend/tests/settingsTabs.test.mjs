import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Owner rule (2026-10-19): nothing unbuilt is shown. No notification setting is saved or honoured by any sender yet
// (audit in docs/superpowers/OWNER-REQUESTS-LEDGER.md), so Settings shows no Notifications tab and no email toggle.
const src = fs.readFileSync(new URL('../pages/Settings.tsx', import.meta.url), 'utf8');

test('Settings has no Notifications tab and no unsaved email toggle', () => {
  assert.ok(!src.includes("'Notifications'"));
  assert.ok(!/not available yet/i.test(src));
  assert.ok(!src.includes('emailNotifications'));
  assert.ok(!/weekly digests/i.test(src));
  assert.ok(src.includes("['Profile', 'Business Profile', 'Security', 'Billing']"));
});
