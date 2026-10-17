import test from 'node:test';
import assert from 'node:assert/strict';
import { cardModel } from '../utils/setup.ts';
const steps = (done) => ['profile', 'socials', 'plan', 'week'].map((id, i) => ({ id, title: id, done: done[i], reason: '', minutes: 1 }));
test('the card shows the next step with its route, and hides when everything is done', () => {
  const m = cardModel({ steps: steps([false, false, false, false]), next: 'profile', allDone: false });
  assert.equal(m.show, true);
  assert.equal(m.nextStep.to, '/settings?tab=business');
  assert.equal(cardModel({ steps: steps([true, true, true, true]), next: null, allDone: true }).show, false);
});
test('every step has a route and a free account is sent to choose a plan', () => {
  const m = cardModel({ steps: [{ id: 'choose', title: 'Choose a plan', done: false, reason: '', minutes: 1 }], next: 'choose', allDone: false });
  assert.equal(m.nextStep.to, '/trial-expired');
  for (const [id, to] of [['socials', '/connect-socials'], ['plan', '/plan'], ['week', '/']]) assert.equal(cardModel({ steps: [{ id, title: id, done: false, reason: '', minutes: 1 }], next: id, allDone: false }).nextStep.to, to);
});
test('when nothing is asked of the customer yet the card says what is happening instead of a button', () => {
  const m = cardModel({ steps: steps([true, true, false, false]), next: null, allDone: false });
  assert.equal(m.show, true);
  assert.equal(m.nextStep, null);
  assert.match(m.waiting, /plan/i);
});
test('no setup answer means no card', () => {
  assert.equal(cardModel(null).show, false);
});
