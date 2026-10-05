const test = require('node:test');
const assert = require('node:assert');
const { isProviderLimitError, friendlyMessage } = require('../services/providerErrors');

const RAW = {
  gemini: new Error('LLM gemini failed: You exceeded your current quota, please check your plan and billing details. Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0, model: gemini-2.5-pro Please retry in 16h30m'),
  plan: new Error('The Business Plan is required to access this endpoint. Find out more about the business plan. https://www.ayrshare.com/business-plan-for-multiple-users/'),
  suspended: '{"code":276,"message":"this account has been suspended..."}',
  paid: { code: 169, action: 'Paid Plan Required' }
};
const BANNED = /gemini|google|ayrshare|http|quota|plan|billing|169|276|!/i;

test('limit errors are recognised', () => {
  for (const e of Object.values(RAW)) assert.strictEqual(isProviderLimitError(e), true);
  assert.strictEqual(isProviderLimitError({ status: 403 }), true);
  assert.strictEqual(isProviderLimitError({ status: 429 }), true);
  assert.strictEqual(isProviderLimitError(new Error('RESOURCE_EXHAUSTED')), true);
});

test('ordinary errors are not limit errors', () => {
  assert.strictEqual(isProviderLimitError(new Error('Cast to ObjectId failed')), false);
  assert.strictEqual(isProviderLimitError(null), false);
  assert.strictEqual(isProviderLimitError({ status: 400, message: 'bad request' }), false);
});

test('friendly messages are plain, leak nothing and end with a full stop', () => {
  for (const e of Object.values(RAW)) {
    for (const ctx of ['ai', 'social', undefined, 'other']) {
      const m = friendlyMessage(e, ctx);
      assert.ok(!BANNED.test(m), m);
      assert.ok(m.endsWith('.'), m);
    }
  }
  assert.strictEqual(friendlyMessage(RAW.gemini, 'ai'), 'This feature is temporarily unavailable. Please try again later.');
  assert.match(friendlyMessage(RAW.plan, 'social'), /^Connecting social media accounts/);
  assert.strictEqual(friendlyMessage(null), 'Something went wrong. Please try again later.');
});
