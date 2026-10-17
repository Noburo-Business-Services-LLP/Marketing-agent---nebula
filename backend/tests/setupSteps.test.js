const test = require('node:test');
const assert = require('node:assert');
const { setupSteps } = require('../services/week/setupSteps');
const full = { companyName: 'Sweet Co', businessProfile: { name: 'Sweet Co', website: 'sweetco.in', description: 'Custom cakes baked to order', targetAudience: 'Families' } };
const empty = { businessProfile: {} };
const st = (o = {}) => ({ connectedCount: 0, hasPlan: false, planOpened: false, firstWeekApproved: false, isPaid: true, ...o });

test('a brand new paying account is told to complete the profile first', () => {
  const r = setupSteps({ user: empty, state: st() });
  assert.deepStrictEqual(r.steps.map((s) => s.id), ['profile', 'socials', 'plan', 'week']);
  assert.strictEqual(r.next, 'profile');
  assert.strictEqual(r.allDone, false);
});
test('the order is suggested: socials can be done before the profile, and next is always the first undone step', () => {
  const r = setupSteps({ user: empty, state: st({ connectedCount: 1 }) });
  assert.strictEqual(r.steps.find((s) => s.id === 'socials').done, true);
  assert.strictEqual(r.next, 'profile');
});
test('the plan step waits until a plan exists, then asks to read it', () => {
  const waiting = setupSteps({ user: full, state: st({ connectedCount: 1 }) });
  assert.strictEqual(waiting.next, null, 'profile and socials done, plan not built yet: nothing to ask of the customer');
  const ready = setupSteps({ user: full, state: st({ connectedCount: 1, hasPlan: true }) });
  assert.strictEqual(ready.next, 'plan');
});
test('everything done', () => {
  const r = setupSteps({ user: full, state: st({ connectedCount: 2, hasPlan: true, planOpened: true, firstWeekApproved: true }) });
  assert.strictEqual(r.allDone, true);
  assert.strictEqual(r.next, null);
});
test('a free account sees a Choose a plan step instead of promises it cannot keep', () => {
  const r = setupSteps({ user: full, state: st({ isPaid: false, connectedCount: 0 }) });
  assert.deepStrictEqual(r.steps.map((s) => s.id), ['profile', 'socials', 'choose']);
  assert.strictEqual(r.steps.find((s) => s.id === 'choose').done, false);
});
test('no step title mentions credits, trials or Quarks', () => {
  const r = setupSteps({ user: empty, state: st() });
  r.steps.forEach((s) => assert.doesNotMatch(`${s.title} ${s.reason}`, /credit|trial|quark/i));
});
