import test from 'node:test';
import assert from 'node:assert/strict';
import { isSafeCustomerMessage, customerMessage, GENERIC_ERROR_MESSAGE } from '../utils/errors.ts';

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
