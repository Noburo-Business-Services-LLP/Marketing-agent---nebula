import test from 'node:test';
import assert from 'node:assert/strict';
import { startSlotPurchase } from '../utils/slotPurchase.ts';

// A stand-in for the payment window. No network and no real checkout script is ever loaded.
function fakeWindow(behaviour) {
  const made = [];
  class FakeRazorpay {
    constructor(opts) { this.opts = opts; this.handlers = {}; made.push(this); }
    on(name, fn) { this.handlers[name] = fn; }
    open() { behaviour(this); }
  }
  globalThis.window = { Razorpay: FakeRazorpay };
  return made;
}
const PAID = { razorpay_payment_id: 'pay_1', razorpay_subscription_id: 'sub_1', razorpay_signature: 'sig_1' };
const CREATED = { success: true, key: 'rzp_test_key', subscription_id: 'sub_1', prefill: { name: 'A' } };

function run(api) {
  const events = [];
  const p = startSlotPurchase(api, {
    description: 'Extra client, monthly',
    onConfirmed: (message, limit) => events.push(['confirmed', message, limit]),
    onProblem: (m, paid) => events.push(paid === undefined ? ['problem', m] : ['problem', m, paid]),
    onClosed: () => events.push(['closed']),
  });
  return { p, events };
}

test('a paid and confirmed extra client reports the new client limit', async () => {
  const made = fakeWindow((r) => r.opts.handler(PAID));
  const calls = [];
  const { p, events } = run({
    createSlotSubscription: async () => CREATED,
    verifySubscription: async (r) => { calls.push(r); return { success: true, kind: 'slot', clientLimit: 7, message: 'Your extra client is added.' }; },
  });
  await p;
  assert.equal(made.length, 1);
  assert.equal(made[0].opts.key, 'rzp_test_key');
  assert.equal(made[0].opts.subscription_id, 'sub_1');
  assert.deepEqual(calls, [PAID]);
  assert.deepEqual(events, [['confirmed', 'Your extra client is added. You can now have 7 clients.', 7]]);
});

test('a 409 on confirming is shown plainly: still being confirmed, do not pay again, refunds take working days', async () => {
  fakeWindow((r) => r.opts.handler(PAID));
  const err = Object.assign(new Error('Your payment was received, but the extra client could not be added yet. Our team has been told.'), { status: 409 });
  const { p, events } = run({ createSlotSubscription: async () => CREATED, verifySubscription: async () => { throw err; } });
  await p;
  assert.equal(events.length, 1);
  assert.equal(events[0][0], 'problem');
  assert.equal(events[0][2], true, 'after the payment was taken the dialog must not invite a second payment');
  assert.match(events[0][1], /^Your payment was received/);
  assert.match(events[0][1], /do not pay again/i);
  assert.match(events[0][1], /several working days/);
  assert.doesNotMatch(events[0][1], /instant|immediate/i);
});

test('a refusal when starting (at the most clients, not an agency) opens no payment window', async () => {
  const made = fakeWindow(() => assert.fail('the payment window must not open'));
  const refusal = Object.assign(new Error('You are at the most clients one agency account can have (25). Contact us for a larger set-up.'), { status: 400 });
  for (const create of [async () => { throw refusal; }, async () => ({ success: false, message: 'Client slots are part of the Agency plan.' })]) {
    const { p, events } = run({ createSlotSubscription: create, verifySubscription: async () => assert.fail('no confirm') });
    await p;
    assert.equal(events[0][0], 'problem');
    assert.equal(events[0][2], false);
    assert.match(events[0][1], /most clients|Agency plan/);
  }
  assert.equal(made.length, 0);
});

test('closing the window, a failed payment, a missing window and an unconfirmed answer each end cleanly', async () => {
  fakeWindow((r) => r.opts.modal.ondismiss());
  let r1 = run({ createSlotSubscription: async () => CREATED, verifySubscription: async () => assert.fail('no confirm') });
  await r1.p;
  assert.deepEqual(r1.events, [['closed']]);

  fakeWindow((r) => r.handlers['payment.failed']({ error: { description: 'Your card was declined.' } }));
  r1 = run({ createSlotSubscription: async () => CREATED, verifySubscription: async () => assert.fail('no confirm') });
  await r1.p;
  assert.deepEqual(r1.events, [['problem', 'Your card was declined.', false]]);

  globalThis.window = {};
  r1 = run({ createSlotSubscription: async () => CREATED, verifySubscription: async () => assert.fail('no confirm') });
  await r1.p;
  assert.match(r1.events[0][1], /payment window could not be opened/);

  fakeWindow((r) => r.opts.handler(PAID));
  r1 = run({ createSlotSubscription: async () => CREATED, verifySubscription: async () => ({ success: false }) });
  await r1.p;
  assert.equal(r1.events[0][0], 'problem');
  assert.doesNotMatch(r1.events[0][1], /undefined/);
});

test('a network failure while confirming never leaks technical text', async () => {
  fakeWindow((r) => r.opts.handler(PAID));
  const { p, events } = run({ createSlotSubscription: async () => CREATED, verifySubscription: async () => { throw new TypeError('Failed to fetch'); } });
  await p;
  assert.equal(events[0][2], true);
  assert.match(events[0][1], /could not confirm/i);
  assert.match(events[0][1], /do not pay again/i);
  assert.doesNotMatch(events[0][1], /fetch/i);
});
