const test = require('node:test');
const assert = require('node:assert');
const { buildRecurring } = require('../services/staff/recurring');

const NOW = Date.parse('2026-10-15T10:00:00Z');
const rec = (client, period, ex, months = 1, status = 'paid') => ({ client, period, exPaise: ex, months, status });
const u = (id, over = {}) => ({ _id: id, email: `${id}@x.test`, companyName: id, plan: { tier: 'managed', paidManually: true }, ...over });

test('MRR sums monthly value before GST; a yearly invoice counts a twelfth each month', () => {
  const r = buildRecurring({ now: NOW, users: [u('a'), u('b')], records: [rec('a', '2026-10', 2000000), rec('b', '2026-01', 24000000, 12)] });
  assert.equal(r.now.mrrPaise, 2000000 + 2000000);
  assert.equal(r.now.arrPaise, r.now.mrrPaise * 12);
  assert.equal(r.now.payingCustomers, 2);
});

test('a client who ended is out of MRR and ARR from the next month, and listed as stopped', () => {
  const users = [u('a'), u('b', { managedBilling: { endedMonth: '2026-08', endReason: 'Too costly', monthlyAmountInr: 10000, billingStart: '2026-05-01' } })];
  const records = [rec('a', '2026-08', 1000000), rec('a', '2026-09', 1000000), rec('a', '2026-10', 1000000), rec('b', '2026-06', 500000), rec('b', '2026-07', 500000), rec('b', '2026-08', 500000), rec('b', '2026-09', 500000)];
  const r = buildRecurring({ now: NOW, users, records });
  const m = Object.fromEntries(r.months.map((x) => [x.period, x]));
  assert.equal(m['2026-08'].mrrPaise, 1500000);
  assert.equal(m['2026-09'].mrrPaise, 1000000);
  assert.equal(m['2026-09'].lostClients, 1);
  assert.equal(m['2026-09'].lostMrrPaise, 500000);
  assert.equal(r.now.mrrPaise, 1000000);
  assert.equal(r.now.payingCustomers, 1);
  assert.deepEqual(r.stopped.map((x) => [x.name, x.endedMonth, x.reason, x.mrrLostPaise]), [['b', '2026-08', 'Too costly', 500000]]);
});

test('this month counts from the billing settings before its invoice exists; trial and hidden accounts are separate', () => {
  const users = [
    u('a', { managedBilling: { monthlyAmountInr: 11800, gstInclusive: true, gstPercent: 18, billingStart: '2026-09-01', cycleMonths: 1 } }),
    { _id: 't', email: 't@x.test', plan: { tier: 'free' } },
    u('h', { isHidden: true })
  ];
  const r = buildRecurring({ now: NOW, users, records: [] });
  assert.equal(r.now.mrrPaise, 1000000);
  assert.equal(r.now.onTrial, 1);
  assert.equal(r.now.payingCustomers, 1);
});
