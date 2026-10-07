// The demo seed's money data must agree with how the billing code stores things, and the Money builder must read it cleanly.
const test = require('node:test');
const assert = require('node:assert');
const { buildData } = require('../scripts/seed-staff-demo');
const { buildMoney } = require('../services/staff/money');

const NOW = new Date('2026-10-07T06:30:00Z').getTime();

test('seeded payments are realistic and the Money numbers add up', () => {
  const { clients } = buildData(NOW, 'x'.repeat(60));
  const users = clients.map((c) => ({ ...c, _id: c.key }));
  const m = buildMoney({ users, now: NOW, ayrshareProfiles: 0 });
  for (const w of [m.revenue.thisMonth, m.revenue.lastMonth, m.revenue.last30Days, m.revenue.allTime]) {
    assert.ok(Number.isInteger(w.totalPaise));
    assert.strictEqual(w.exGstPaise + w.gstPaise + w.unsplitPaise, w.totalPaise);
  }
  assert.ok(m.revenue.allTime.count > 20, 'enough payments to see');
  assert.ok(m.revenue.allTime.unsplitPaise > 0, 'some legacy payments with no GST split');
  assert.ok(m.renewals.items.length > 0, 'some renewals in the next 14 days');
  assert.ok(m.failures.payments.count > 0 && m.failures.renewals.count > 0, 'failures to look at');
  assert.ok(m.quarks.sold > 0 && m.quarks.spent > 0);
  assert.ok(m.quarks.possiblyIncompleteClients >= 1);
  // Paying stays as before: nobody who is not meant to pay got a paid payment.
  const hidden = users.filter((u) => u.isHidden);
  assert.ok(hidden.every((u) => !u.payments.some((p) => p.status === 'paid')));
  // No payment is dated before the account existed.
  users.forEach((u) => u.payments.forEach((p) => assert.ok(new Date(p.paidAt) >= new Date(u.createdAt), `${u.key} payment before sign-up`)));
});

test('the number of seeded social profiles is above the included 30 so the extra cost shows', () => {
  const { clients, staff } = buildData(NOW, 'x'.repeat(60));
  const n = [...clients, ...staff].filter((u) => u.ayrshare && u.ayrshare.profileKey).length;
  assert.ok(n > 30 && n <= 100, `profiles: ${n}`);
});
