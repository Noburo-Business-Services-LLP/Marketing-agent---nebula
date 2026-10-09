const test = require('node:test');
const assert = require('node:assert');
const L = require('../services/staff/billingLedger');

const hex = (c) => c.repeat(24);
const owner = { _id: hex('a'), staffRole: 'owner' };
const admin = { _id: hex('b'), staffRole: 'admin' };
const csm = { _id: hex('c'), staffRole: 'csm', isCsm: true };
const NOW = Date.parse('2026-10-20T10:00:00Z');

function fake(clientOver = {}) {
  const records = new Map();
  const calls = { logs: [], paying: 0, settings: null };
  const client = { _id: hex('1'), email: 'c@x.test', managedBilling: { monthlyAmountInr: 25000, gstInclusive: false, gstPercent: 18, serviceStart: '2026-08' }, ...clientOver };
  const repo = {
    getClient: async (id) => (id === hex('1') ? client : id === hex('4') ? { _id: hex('4'), staffRole: 'csm', isCsm: true } : null),
    listRecords: async () => [...records.values()],
    getRecord: async (_c, period) => records.get(period) || null,
    upsertRecord: async (_c, period, set) => { records.set(period, { ...(records.get(period) || { period }), ...set }); },
    deleteRecord: async (_c, period) => { records.delete(period); },
    setSettings: async (_c, s) => { calls.settings = s; client.managedBilling = s; },
    markClientPaying: async () => { calls.paying += 1; },
  };
  return { repo, records, calls, client, record: async (row) => { calls.logs.push(row); } };
}

test('the owner\'s example: 25,000 including 18% GST is 21,186.44 net plus 3,813.56 GST; excluding GST it becomes 29,500', () => {
  assert.deepEqual(L.amountsFor(2500000, 18, true), { exPaise: 2118644, gstPercent: 18, gstPaise: 381356, totalPaise: 2500000, gstInclusive: true });
  assert.deepEqual(L.amountsFor(2500000, 18, false), { exPaise: 2500000, gstPercent: 18, gstPaise: 450000, totalPaise: 2950000, gstInclusive: false });
  for (const [amt, inc] of [[1, true], [99999, true], [123457, true], [250001, false], [3333333, false]]) {
    const a = L.amountsFor(amt, 18, inc);
    assert.equal(a.exPaise + a.gstPaise, a.totalPaise, `${amt} ${inc}`);
  }
  assert.equal(L.amountsFor(1000000, 0, true).gstPaise, 0);
});

test('rupee amounts become whole paise; nonsense is refused', () => {
  assert.equal(L.toPaise(25000), 2500000);
  assert.equal(L.toPaise('25,000.50'), 2500050);
  for (const bad of [0, -5, 'abc', 12.345, 1e9, null, undefined, NaN]) assert.equal(L.toPaise(bad), null, String(bad));
});

test('settings: amount, includes-GST switch, GST rate and start month are all checked', () => {
  assert.deepEqual(L.parseSettings({ monthlyAmountInr: 25000, gstInclusive: true, serviceStart: '2026-06-15' }).settings, { monthlyAmountInr: 25000, gstPercent: 18, gstInclusive: true, serviceStart: '2026-06' });
  assert.equal(L.parseSettings({ monthlyAmountInr: 25000, serviceStart: '2026-06' }).settings.gstInclusive, false);
  assert.equal(L.parseSettings({ monthlyAmountInr: 0, serviceStart: '2026-06' }).ok, false);
  assert.equal(L.parseSettings({ monthlyAmountInr: 100, serviceStart: 'June' }).ok, false);
  assert.equal(L.parseSettings({ monthlyAmountInr: 100, serviceStart: '2026-06', gstPercent: 7 }).ok, false);
  assert.equal(L.parseSettings({ monthlyAmountInr: 100, serviceStart: '2026-06', gstInclusive: 'yes' }).ok, false);
});

test('the ledger lists every month from the start to now, newest first, with the client\'s amounts', () => {
  const { rows, totals } = L.buildLedger({ settings: { monthlyAmountInr: 25000, gstInclusive: true, gstPercent: 18, serviceStart: '2026-08' }, records: [], now: NOW });
  assert.deepEqual(rows.map((r) => r.period), ['2026-10', '2026-09', '2026-08']);
  assert.deepEqual(rows.map((r) => r.label), ['Oct 2026', 'Sep 2026', 'Aug 2026']);
  assert.ok(rows.every((r) => r.status === 'not_invoiced' && r.totalPaise === 2500000 && r.exPaise === 2118644));
  assert.equal(totals.notInvoicedPaise, 7500000);
  assert.equal(totals.paidPaise, 0);
});

test('statuses: invoiced, overdue after 15 days, paid, void; totals add up', () => {
  const records = [
    { period: '2026-08', status: 'paid', exPaise: 2500000, gstPercent: 18, gstPaise: 450000, totalPaise: 2950000, invoiceNumber: 'INV-1', paidMode: 'bank', paidOn: new Date('2026-09-02') },
    { period: '2026-09', status: 'invoiced', exPaise: 2500000, gstPercent: 18, gstPaise: 450000, totalPaise: 2950000, invoiceNumber: 'INV-2', issuedOn: new Date('2026-09-25') },
    { period: '2026-10', status: 'invoiced', exPaise: 2500000, gstPercent: 18, gstPaise: 450000, totalPaise: 2950000, invoiceNumber: 'INV-3', issuedOn: new Date('2026-10-15') },
  ];
  const { rows, totals } = L.buildLedger({ settings: { monthlyAmountInr: 25000, gstPercent: 18, serviceStart: '2026-08' }, records, now: NOW });
  assert.deepEqual(rows.map((r) => r.status), ['invoiced', 'overdue', 'paid']);
  assert.equal(rows[2].paidModeLabel, 'Bank transfer');
  assert.equal(totals.paidPaise, 2950000); assert.equal(totals.outstandingPaise, 5900000); assert.equal(totals.billedPaise, 8850000);
  const withVoid = L.buildLedger({ settings: { monthlyAmountInr: 25000, gstPercent: 18, serviceStart: '2026-10' }, records: [{ period: '2026-10', status: 'void', exPaise: 0, gstPercent: 18, gstPaise: 0, totalPaise: 0 }], now: NOW });
  assert.equal(withVoid.rows[0].status, 'void'); assert.equal(withVoid.totals.notInvoicedPaise, 0);
});

test('only Owner and Admin can see or change billing; staff accounts and strangers are not found', async () => {
  for (const actor of [owner, admin]) assert.equal((await L.viewBilling({ actor, clientId: hex('1'), repo: fake().repo, now: NOW })).status, 200);
  const f = fake();
  assert.equal((await L.viewBilling({ actor: csm, clientId: hex('1'), repo: f.repo })).status, 403);
  assert.equal((await L.saveSettings({ actor: csm, clientId: hex('1'), input: {}, ...f })).status, 403);
  assert.equal((await L.viewBilling({ actor: owner, clientId: hex('4'), repo: f.repo })).status, 404);
  assert.equal((await L.viewBilling({ actor: owner, clientId: hex('9'), repo: f.repo })).status, 404);
});

test('saving settings stores the amount and the includes-GST switch, and logs it', async () => {
  const f = fake();
  const out = await L.saveSettings({ actor: admin, clientId: hex('1'), input: { monthlyAmountInr: 25000, gstInclusive: true, serviceStart: '2026-06' }, ...f });
  assert.equal(out.status, 200);
  assert.deepEqual(f.calls.settings, { monthlyAmountInr: 25000, gstPercent: 18, gstInclusive: true, serviceStart: '2026-06' });
  assert.equal(f.calls.logs[0].action, 'billing_settings');
  assert.equal((await L.saveSettings({ actor: admin, clientId: hex('1'), input: { monthlyAmountInr: 'x', serviceStart: '2026-06' }, ...f })).status, 400);
});

test('linking an invoice records it against the month with the client\'s amounts; bad links are refused', async () => {
  const f = fake({ managedBilling: { monthlyAmountInr: 25000, gstInclusive: true, gstPercent: 18, serviceStart: '2026-08' } });
  const ok = await L.linkInvoice({ actor: owner, clientId: hex('1'), period: '2026-09', input: { invoiceNumber: ' INV-000016 ', invoiceUrl: 'https://books.zoho.in/x', issuedOn: '2026-09-28' }, ...f, now: NOW });
  assert.equal(ok.status, 200);
  const r = f.records.get('2026-09');
  assert.equal(r.status, 'invoiced'); assert.equal(r.invoiceNumber, 'INV-000016'); assert.equal(r.totalPaise, 2500000); assert.equal(r.exPaise, 2118644); assert.equal(r.gstInclusive, true);
  assert.equal(new Date(r.dueOn).getTime() - new Date(r.issuedOn).getTime(), 15 * 86400000);
  for (const input of [{ invoiceNumber: '' }, { invoiceNumber: 'x'.repeat(41) }, { invoiceNumber: 'A', invoiceUrl: 'http://insecure.test' }, { invoiceNumber: 'A', invoiceUrl: 'javascript:alert(1)' }, { invoiceNumber: 'A', issuedOn: 'not a date' }]) {
    assert.equal((await L.linkInvoice({ actor: owner, clientId: hex('1'), period: '2026-09', input, ...fake() })).status, 400, JSON.stringify(input));
  }
  assert.equal((await L.linkInvoice({ actor: owner, clientId: hex('1'), period: '2026-13', input: { invoiceNumber: 'A' }, ...fake() })).status, 400);
});

test('a month can carry its own amount (a changed rate), worked out in the client\'s mode', async () => {
  const f = fake({ managedBilling: { monthlyAmountInr: 25000, gstInclusive: false, gstPercent: 18, serviceStart: '2026-08' } });
  await L.linkInvoice({ actor: owner, clientId: hex('1'), period: '2026-10', input: { invoiceNumber: 'INV-9', amountInr: 30000 }, ...f, now: NOW });
  assert.equal(f.records.get('2026-10').exPaise, 3000000); assert.equal(f.records.get('2026-10').totalPaise, 3540000);
});

test('marking a month paid records how, when and the reference, and marks the client as paying', async () => {
  const f = fake();
  const out = await L.markPaid({ actor: admin, clientId: hex('1'), period: '2026-09', input: { paidOn: '2026-10-02', mode: 'bank', reference: 'UTR 12345', invoiceNumber: 'INV-2', invoiceUrl: 'https://books.zoho.in/inv2' }, ...f, now: NOW });
  assert.equal(out.status, 200);
  const r = f.records.get('2026-09');
  assert.equal(r.status, 'paid'); assert.equal(r.paidMode, 'bank'); assert.equal(r.paidReference, 'UTR 12345'); assert.equal(r.invoiceNumber, 'INV-2'); assert.equal(r.totalPaise, 2950000);
  assert.equal(f.calls.paying, 1);
  assert.equal(f.calls.logs[0].action, 'billing_mark_paid');
  assert.equal((await L.markPaid({ actor: admin, clientId: hex('1'), period: '2026-09', input: { mode: 'crypto' }, ...fake(), now: NOW })).status, 400);
  assert.equal((await L.markPaid({ actor: admin, clientId: hex('1'), period: '2026-09', input: { mode: 'upi', paidOn: '2027-01-01' }, ...fake(), now: NOW })).status, 400);
});

test('a paid month cannot be re-linked until the payment is undone; undo goes back to invoiced, or clears a month with no invoice', async () => {
  const f = fake();
  await L.markPaid({ actor: owner, clientId: hex('1'), period: '2026-09', input: { mode: 'upi', invoiceNumber: 'INV-2' }, ...f, now: NOW });
  assert.equal((await L.linkInvoice({ actor: owner, clientId: hex('1'), period: '2026-09', input: { invoiceNumber: 'INV-X' }, ...f })).status, 409);
  assert.equal((await L.undoPaid({ actor: owner, clientId: hex('1'), period: '2026-09', ...f })).status, 200);
  assert.equal(f.records.get('2026-09').status, 'invoiced'); assert.equal(f.records.get('2026-09').paidMode, null);
  const g = fake();
  await L.markPaid({ actor: owner, clientId: hex('1'), period: '2026-08', input: { mode: 'cash' }, ...g, now: NOW });
  await L.undoPaid({ actor: owner, clientId: hex('1'), period: '2026-08', ...g });
  assert.equal(g.records.has('2026-08'), false);
  assert.equal((await L.undoPaid({ actor: owner, clientId: hex('1'), period: '2026-08', ...g })).status, 409);
});

test('a month can be cancelled and restored; a paid month cannot be cancelled', async () => {
  const f = fake();
  assert.equal((await L.setVoid({ actor: owner, clientId: hex('1'), period: '2026-10', voided: true, ...f })).status, 200);
  assert.equal(f.records.get('2026-10').status, 'void');
  assert.equal((await L.markPaid({ actor: owner, clientId: hex('1'), period: '2026-10', input: { mode: 'bank' }, ...f, now: NOW })).status, 409);
  await L.setVoid({ actor: owner, clientId: hex('1'), period: '2026-10', voided: false, ...f });
  assert.equal(f.records.has('2026-10'), false);
  await L.markPaid({ actor: owner, clientId: hex('1'), period: '2026-09', input: { mode: 'bank' }, ...f, now: NOW });
  assert.equal((await L.setVoid({ actor: owner, clientId: hex('1'), period: '2026-09', voided: true, ...f })).status, 409);
});

test('without a monthly amount a month cannot be billed by guesswork', async () => {
  const f = fake({ managedBilling: {} });
  assert.equal((await L.linkInvoice({ actor: owner, clientId: hex('1'), period: '2026-09', input: { invoiceNumber: 'INV-1' }, ...f })).status, 400);
  assert.equal((await L.linkInvoice({ actor: owner, clientId: hex('1'), period: '2026-09', input: { invoiceNumber: 'INV-1', amountInr: 5000 }, ...f })).status, 200);
});
