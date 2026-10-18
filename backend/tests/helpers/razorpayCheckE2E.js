'use strict';
/**
 * Optional full run of scripts/razorpay-test-check.js with a FAKE Razorpay against a LOCAL throwaway MongoDB (not part of
 * `node --test`: it needs a Mongo). No real Razorpay call, no real database, no keys.
 *   MONGODB_URI=mongodb://127.0.0.1:27099/nebulaa_dev node tests/helpers/razorpayCheckE2E.js [second|nosecond] [wrongprice]
 * Start a local Mongo first, for example:  docker run -d --rm --name rzpcheck-mongo -p 127.0.0.1:27099:27017 mongo:7
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'e2e-only-jwt-secret-not-real';
const { main } = require('../../scripts/razorpay-test-check');
const { createFakeRazorpay } = require('./fakeRazorpayLifecycle');

(async () => {
  const second = (process.argv[2] || 'second') === 'second';
  const wrongPrice = process.argv.includes('wrongprice');
  const fake = createFakeRazorpay();
  const env = {
    I_APPROVED_RAZORPAY_TEST: 'yes', RAZORPAY_KEY_ID: 'rzp_test_E2EFAKEKEY01', RAZORPAY_KEY_SECRET: 'e2e-fake-secret-value-0001',
    MONGODB_URI: process.env.MONGODB_URI, JWT_SECRET: process.env.JWT_SECRET
  };
  const lines = [];
  const ask = async (q) => {
    lines.push(`ASK: ${q.slice(0, 70)}`);
    if (/Press Enter once you have paid/.test(q)) for (const id of fake.pendingSubscriptionIds()) fake.pay(id, wrongPrice ? { amount: 100 } : {});
    if (/SECOND time/.test(q)) return second ? 'y' : '';
    return '';
  };
  const code = await main({
    env, argv: ['run'], out: (s) => console.log(s), ask, sdk: fake.sdk, noDotenv: true, noSignals: true,
    timing: { intervalMs: 5, timeoutMs: 200, invoiceTimeoutMs: 200, settleMs: 150, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) },
    cleanupFile: require('path').join(require('os').tmpdir(), 'nebulaa-razorpay-test-check-e2e.json')
  });
  console.log(`E2E exit code ${code}; fake Razorpay calls ${fake.calls.length}; subscriptions left not cancelled: ${Object.values(fake.subs).filter((s) => s.status !== 'cancelled').length}`);
  process.exit(code);
})().catch((e) => { console.error(e); process.exit(1); });
