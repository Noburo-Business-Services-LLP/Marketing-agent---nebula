import test from 'node:test';
import assert from 'node:assert/strict';
import { isSafeCustomerMessage, customerMessage, gateMessage, SOCIAL_ADDON_MESSAGE, GENERIC_ERROR_MESSAGE } from '../utils/errors.ts';

test('plain messages are safe', () => {
  assert.equal(isSafeCustomerMessage('Failed to create social linking profile.'), true);
  assert.equal(isSafeCustomerMessage('The connection could not be started.'), true);
});

test('vendor, url, quota, plan, billing and key text is not safe', () => {
  for (const t of [
    'See https://example.com for details',
    'LLM gemini failed: You exceeded your current quota',
    'Google says no',
    'Ayrshare rejected the request',
    'OpenAI error',
    'Razorpay failed',
    'The Business Plan is required to access this endpoint.',
    'Check your billing details',
    'Invalid API key provided',
    'Over the QUOTA'
  ]) assert.equal(isSafeCustomerMessage(t), false, t);
});

test('long, empty and non-string values are not safe', () => {
  assert.equal(isSafeCustomerMessage('a'.repeat(201)), false);
  assert.equal(isSafeCustomerMessage('a'.repeat(200)), true);
  assert.equal(isSafeCustomerMessage(''), false);
  assert.equal(isSafeCustomerMessage(undefined), false);
  assert.equal(isSafeCustomerMessage({}), false);
});

test('customerMessage falls back to a plain sentence', () => {
  assert.equal(customerMessage('Quota exceeded'), GENERIC_ERROR_MESSAGE);
  assert.equal(customerMessage('Quota exceeded', 'Custom.'), 'Custom.');
  assert.equal(customerMessage('Try again.'), 'Try again.');
});

// Found by trying the staff screens against the real server: they pass the caught Error itself, so every
// plain server message ("Enter a whole number of Quarks, 1 or more.") was replaced by the generic sentence.
test('an Error object is read through its message', () => {
  assert.equal(customerMessage(new Error('Enter a whole number of Quarks, 1 or more.')), 'Enter a whole number of Quarks, 1 or more.');
  assert.equal(customerMessage(new Error('Ayrshare rejected the request')), GENERIC_ERROR_MESSAGE);
  assert.equal(customerMessage({ message: 'Your role cannot do this.' }), 'Your role cannot do this.');
  assert.equal(customerMessage(new Error(''), 'Could not add.'), 'Could not add.');
});

test('gateMessage: staff see the real reason, customers one plain sentence', () => {
  assert.equal(gateMessage('This needs an add-on. Please add it to your plan or upgrade.', true), 'This needs an add-on. Please add it to your plan or upgrade.');
  assert.equal(gateMessage('This needs an add-on. Please add it to your plan or upgrade.', false), SOCIAL_ADDON_MESSAGE);
  assert.equal(gateMessage(undefined, true), SOCIAL_ADDON_MESSAGE);
  assert.equal(isSafeCustomerMessage(SOCIAL_ADDON_MESSAGE), true);
  assert.equal(isSafeCustomerMessage('Connecting X is not available right now. Our team has been notified.'), true);
  assert.equal(isSafeCustomerMessage('X is not set up on our social service yet.'), true);
});
