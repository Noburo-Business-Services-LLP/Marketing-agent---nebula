const test = require('node:test');
const assert = require('node:assert');
const qb = require('../services/quarkBuckets');
const bp = require('../services/billingPlans');

const NOW = new Date('2026-10-20T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

test('a plan charge sets the monthly bucket and ends it a few days after the paid month', () => {
  const end = Math.floor(new Date('2026-11-19T00:00:00Z').getTime() / 1000);
  const b = bp.buildChargeUpdate({ kind: 'plan', key: 'starter', subscriptionId: 's1' }, { paymentId: 'p1', paidPaise: 117882, subscription: { current_end: end }, now: NOW });
  assert.strictEqual(b.update.$set['credits.planBalance'], 2100);
  assert.strictEqual(b.update.$inc['credits.balance'], 2100);
  assert.strictEqual(+b.update.$set['credits.planExpiresAt'], end * 1000 + qb.PLAN_GRACE_DAYS * DAY);
});

test('a renewal releases held top-up Quarks together with the new allowance', () => {
  const b = bp.buildChargeUpdate({ kind: 'plan', key: 'professional', subscriptionId: 's1' }, { paymentId: 'p2', paidPaise: 235882, now: NOW, heldToRelease: 250 });
  assert.strictEqual(b.update.$inc['credits.balance'], 3500 + 250);
  assert.strictEqual(b.update.$inc['credits.topupBalance'], 250);
  assert.strictEqual(b.update.$inc['credits.topupHeld'], -250);
});

test('a top-up adds to its bucket and is valid for 60 days from the purchase', () => {
  const b = bp.buildChargeUpdate({ kind: 'topup', key: 1000, orderId: 'o1' }, { paymentId: 'p3', paidPaise: 118000, now: NOW });
  assert.strictEqual(b.quarks, 500);
  assert.strictEqual(b.update.$inc['credits.topupBalance'], 500);
  assert.strictEqual(+b.update.$set['credits.topupExpiresAt'], NOW.getTime() + 60 * DAY);
});

test('summarise: expired buckets do not count, and kept Quarks are what remains', () => {
  const credits = { balance: 900, planBalance: 400, planExpiresAt: new Date(NOW.getTime() - 1), topupBalance: 300, topupExpiresAt: new Date(NOW.getTime() + DAY) };
  const s = qb.summarise({ credits }, NOW);
  assert.strictEqual(s.plan, 0);
  assert.strictEqual(s.topup, 300);
  assert.strictEqual(s.kept, 600);
});

test('summarise never reports more in a bucket than the balance holds', () => {
  const s = qb.summarise({ credits: { balance: 100, planBalance: 500, topupBalance: 500 } }, NOW);
  assert.ok(s.plan + s.topup + s.kept === 100);
});

test('spend pipeline takes the monthly bucket first', () => {
  const stage = qb.spendPipeline(50, { action: 'x' })[0].$set;
  assert.deepStrictEqual(stage['credits.balance'], { $subtract: ['$credits.balance', 50] });
  assert.ok(stage['credits.planBalance'] && stage['credits.topupBalance']);
});
