import test from 'node:test';
import assert from 'node:assert/strict';
import { bulkChoices, bulkRequest, bulkSummary, bulkResultNote } from '../utils/staffBulk.ts';

const v = { csmId: '', amount: '', tier: '', addons: [] };

test('each role sees only the actions it may use', () => {
  const owner = { toggle_client: true, add_quarks: true, assign_csm: true, set_plan: true, hide_client: true };
  const admin = { ...owner, add_quarks: false };
  assert.deepEqual(bulkChoices(owner).map((c) => c.value), ['on', 'off', 'csm', 'quarks', 'plan', 'features_add', 'features_remove', 'paying_on', 'paying_off', 'hide', 'show']);
  assert.equal(bulkChoices(admin).some((c) => c.value === 'quarks'), false);
  assert.deepEqual(bulkChoices({}), []);
});

test('requests carry the right fields and refuse incomplete input', () => {
  assert.deepEqual(bulkRequest('off', v, ['1']).body, { ids: ['1'], op: 'set_active', active: false });
  assert.deepEqual(bulkRequest('csm', { ...v, csmId: 'c1' }, ['1']).body, { ids: ['1'], op: 'assign_csm', csmId: 'c1' });
  assert.deepEqual(bulkRequest('csm', v, ['1']).body, { ids: ['1'], op: 'assign_csm', csmId: null });
  assert.equal(bulkRequest('quarks', { ...v, amount: '0' }, ['1']).ok, false);
  assert.equal(bulkRequest('quarks', { ...v, amount: '12.5' }, ['1']).ok, false);
  assert.deepEqual(bulkRequest('quarks', { ...v, amount: '500' }, ['1', '2']).body, { ids: ['1', '2'], op: 'add_quarks', amount: 500 });
  assert.equal(bulkRequest('plan', v, ['1']).ok, false);
  assert.deepEqual(bulkRequest('plan', { ...v, tier: 'managed' }, ['1']).body, { ids: ['1'], op: 'set_plan', tier: 'managed' });
  assert.equal(bulkRequest('features_add', v, ['1']).ok, false);
  assert.deepEqual(bulkRequest('features_remove', { ...v, addons: ['inbox'] }, ['1']).body, { ids: ['1'], op: 'set_features', mode: 'remove', addons: ['inbox'] });
  assert.equal(bulkRequest('on', v, []).ok, false);
});

test('the confirmation sentence says what will happen and to how many', () => {
  assert.match(bulkSummary('off', v, 3), /Switch off 3 clients\? They will not be able to sign in/);
  assert.match(bulkSummary('quarks', { ...v, amount: '500' }, 4), /500 Quarks to each of 4 clients\? That is 2,000 Quarks in total/);
  assert.match(bulkSummary('plan', { ...v, tier: 'managed' }, 1), /1 client to Managed\? Managed accounts have every feature on and are not asked to pay/);
  assert.match(bulkSummary('csm', { ...v, csmId: 'c1' }, 2, 'Priya'), /Assign Priya to 2 clients/);
  assert.match(bulkSummary('features_add', { ...v, addons: ['publish', 'inbox'] }, 2), /Publish and schedule, Inbox and auto-reply to 2 clients/);
});

test('the result note counts what changed and why some were skipped', () => {
  assert.equal(bulkResultNote({ updated: 1, skipped: [] }), '1 client updated.');
  assert.equal(bulkResultNote({ updated: 3, skipped: [{ reason: 'Not a client account.' }, { reason: 'Not a client account.' }] }), '3 clients updated. 2 skipped: Not a client account.');
});

test('marking clients as paying sends the right request and asks in plain words', () => {
  assert.deepEqual(bulkRequest('paying_on', { ...v, note: ' INV-16 ' }, ['1']).body, { ids: ['1'], op: 'set_billing', paying: true, note: 'INV-16' });
  assert.deepEqual(bulkRequest('paying_on', v, ['1']).body, { ids: ['1'], op: 'set_billing', paying: true });
  assert.deepEqual(bulkRequest('paying_off', v, ['1']).body, { ids: ['1'], op: 'set_billing', paying: false });
  assert.match(bulkSummary('paying_on', v, 9), /Mark 9 clients as paying customers\? They will show as Paying in the staff area\. Nobody is charged\./);
  assert.match(bulkSummary('paying_off', v, 1), /Mark 1 client as not paying/);
});
