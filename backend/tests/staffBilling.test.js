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
  assert.deepEqual(L.parseSettings({ monthlyAmountInr: 25000, gstInclusive: true, billingStart: '2026-06-15' }).settings, { monthlyAmountInr: 25000, gstPercent: 18, gstInclusive: true, billingStart: '2026-06-15', serviceStart: '2026-06', termsDays: 15, autoInvoice: false, cycleMonths: 1, planName: '', zohoItemId: '' });
  assert.equal(L.parseSettings({ monthlyAmountInr: 25000, serviceStart: '2026-06' }).settings.billingStart, '2026-06-01', 'an older month-only entry means the 1st');
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
  assert.deepEqual(f.calls.settings, { monthlyAmountInr: 25000, gstPercent: 18, gstInclusive: true, billingStart: '2026-06-01', serviceStart: '2026-06', termsDays: 15, autoInvoice: false, cycleMonths: 1, planName: '', zohoItemId: '' });
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

test('the billing day comes from the start date; the 29th to 31st become the last day of a short month', () => {
  const s = { billingStart: '2026-01-31' };
  assert.equal(L.plannedInvoiceDate(s, '2026-02'), '2026-02-28'); assert.equal(L.plannedInvoiceDate(s, '2026-03'), '2026-03-31'); assert.equal(L.plannedInvoiceDate(s, '2026-04'), '2026-04-30');
  assert.equal(L.plannedInvoiceDate({ billingStart: '2026-06-05' }, '2026-10'), '2026-10-05');
  assert.equal(L.plannedInvoiceDate({}, '2026-10'), null);
  assert.equal(L.plannedInvoiceDate({ billingStart: '2024-01-31' }, '2028-02'), '2028-02-29', 'leap years');
});

test('start dates are checked: real dates only; the payment terms and the automatic switch too', () => {
  for (const bad of ['2026-02-30', '2026-13-01', '05/06/2026', 'June 5', '']) assert.equal(L.parseSettings({ monthlyAmountInr: 100, billingStart: bad }).ok, false, bad);
  assert.equal(L.parseSettings({ monthlyAmountInr: 100, billingStart: '2026-06-05', termsDays: 91 }).ok, false);
  assert.equal(L.parseSettings({ monthlyAmountInr: 100, billingStart: '2026-06-05', termsDays: 7.5 }).ok, false);
  assert.equal(L.parseSettings({ monthlyAmountInr: 100, billingStart: '2026-06-05', autoInvoice: 'yes' }).ok, false);
  const ok = L.parseSettings({ monthlyAmountInr: 100, billingStart: '2026-06-05', termsDays: 30, autoInvoice: true }).settings;
  assert.equal(ok.termsDays, 30); assert.equal(ok.autoInvoice, true);
});

test('each month shows its invoice date, due date and paid date; planned ones follow the billing day and the terms', () => {
  const settings = { monthlyAmountInr: 25000, gstPercent: 18, billingStart: '2026-08-05', serviceStart: '2026-08', termsDays: 10 };
  const records = [{ period: '2026-09', status: 'paid', exPaise: 1, gstPercent: 18, gstPaise: 0, totalPaise: 1, invoiceNumber: 'INV-2', issuedOn: new Date('2026-09-07'), dueOn: new Date('2026-09-17'), paidOn: new Date('2026-09-12') }];
  const { rows } = L.buildLedger({ settings, records, now: NOW });
  const by = Object.fromEntries(rows.map((r) => [r.period, r]));
  assert.equal(by['2026-10'].invoiceDate, '2026-10-05'); assert.equal(by['2026-10'].dueDate, '2026-10-15'); assert.equal(by['2026-10'].paidDate, '');
  assert.equal(by['2026-09'].invoiceDate, '2026-09-07'); assert.equal(by['2026-09'].dueDate, '2026-09-17'); assert.equal(by['2026-09'].paidDate, '2026-09-12');
  assert.equal(by['2026-08'].invoiceDate, '2026-08-05');
});

test('automatic invoices start from the next invoice day and never reach back; turning it on keeps the first start month', async () => {
  const f = fake({ managedBilling: {} });
  await L.saveSettings({ actor: owner, clientId: hex('1'), input: { monthlyAmountInr: 25000, billingStart: '2026-06-05', autoInvoice: true }, ...f, now: Date.parse('2026-10-20T10:00:00Z') });
  assert.equal(f.calls.settings.autoFrom, '2026-11', 'the 5th of October has passed, so the first automatic invoice is November');
  const g = fake({ managedBilling: {} });
  await L.saveSettings({ actor: owner, clientId: hex('1'), input: { monthlyAmountInr: 25000, billingStart: '2026-06-25', autoInvoice: true }, ...g, now: Date.parse('2026-10-20T10:00:00Z') });
  assert.equal(g.calls.settings.autoFrom, '2026-10', 'the 25th is still ahead, so October counts');
  await L.saveSettings({ actor: owner, clientId: hex('1'), input: { monthlyAmountInr: 26000, billingStart: '2026-06-25', autoInvoice: true }, ...g, now: Date.parse('2026-12-01T10:00:00Z') });
  assert.equal(g.calls.settings.autoFrom, '2026-10', 'saving again does not move it');
  const h = fake({ managedBilling: {} });
  await L.saveSettings({ actor: owner, clientId: hex('1'), input: { monthlyAmountInr: 25000, billingStart: '2026-06-05' }, ...h, now: NOW });
  assert.equal(h.calls.settings.autoFrom, undefined);
});

test('the next invoice date is the next planned day with no invoice yet', () => {
  const s = { monthlyAmountInr: 1, billingStart: '2026-08-05' };
  assert.equal(L.nextInvoiceDate(s, [], NOW), '2026-11-05');
  assert.equal(L.nextInvoiceDate(s, [{ period: '2026-11' }], NOW), '2026-12-05');
  assert.equal(L.nextInvoiceDate({}, [], NOW), '');
});

test('editing dates: invoice, due and paid dates change; the paid date only on a paid month; order and future are checked', async () => {
  const f = fake();
  await L.markPaid({ actor: owner, clientId: hex('1'), period: '2026-09', input: { mode: 'bank', invoiceNumber: 'INV-2', paidOn: '2026-10-02' }, ...f, now: NOW });
  const ok = await L.editDates({ actor: owner, clientId: hex('1'), period: '2026-09', input: { invoiceDate: '2026-09-05', dueDate: '2026-09-20', paidDate: '2026-09-18' }, ...f, now: NOW });
  assert.equal(ok.status, 200);
  const r = f.records.get('2026-09');
  assert.equal(new Date(r.issuedOn).toISOString().slice(0, 10), '2026-09-05'); assert.equal(new Date(r.paidOn).toISOString().slice(0, 10), '2026-09-18');
  assert.equal(f.calls.logs.at(-1).action, 'billing_edit_dates');
  assert.equal((await L.editDates({ actor: owner, clientId: hex('1'), period: '2026-09', input: { paidDate: '2027-01-01' }, ...f, now: NOW })).status, 400);
  assert.equal((await L.editDates({ actor: owner, clientId: hex('1'), period: '2026-09', input: { dueDate: '2026-09-01' }, ...f, now: NOW })).status, 400);
  assert.equal((await L.editDates({ actor: owner, clientId: hex('1'), period: '2026-09', input: { invoiceDate: 'nope' }, ...f, now: NOW })).status, 400);
  assert.equal((await L.editDates({ actor: owner, clientId: hex('1'), period: '2026-09', input: {}, ...f, now: NOW })).status, 400);
  const g = fake(); await L.linkInvoice({ actor: owner, clientId: hex('1'), period: '2026-09', input: { invoiceNumber: 'INV-3' }, ...g, now: NOW });
  assert.equal((await L.editDates({ actor: owner, clientId: hex('1'), period: '2026-09', input: { paidDate: '2026-10-01' }, ...g, now: NOW })).status, 409);
  assert.equal((await L.editDates({ actor: owner, clientId: hex('1'), period: '2026-07', input: { invoiceDate: '2026-07-01' }, ...g, now: NOW })).status, 409, 'a month with no invoice has nothing to change');
  assert.equal((await L.editDates({ actor: csm, clientId: hex('1'), period: '2026-09', input: { invoiceDate: '2026-09-01' }, ...g, now: NOW })).status, 403);
});

test('a Zoho-linked month says the dates in Zoho are not changed', async () => {
  const f = fake(); f.records.set('2026-09', { period: '2026-09', status: 'invoiced', invoiceNumber: 'INV-4', zohoInvoiceId: 'z4', exPaise: 1, gstPercent: 18, gstPaise: 0, totalPaise: 1, issuedOn: new Date('2026-09-01'), dueOn: new Date('2026-09-16') });
  const out = await L.editDates({ actor: owner, clientId: hex('1'), period: '2026-09', input: { invoiceDate: '2026-09-03' }, ...f, now: NOW });
  assert.equal(out.body.inZoho, true); assert.match(out.body.note, /Zoho Books are not changed/);
});

test('billing cycles: the choices, the plan, and a clear message for anything else', () => {
  assert.deepEqual(L.CYCLES, [1, 3, 6, 12]);
  const ok = L.parseSettings({ monthlyAmountInr: 250000, billingStart: '2026-08-04', cycleMonths: 12, planName: ' SCALE ', zohoItemId: '3659166000000123456' }).settings;
  assert.equal(ok.cycleMonths, 12); assert.equal(ok.planName, 'SCALE'); assert.equal(ok.zohoItemId, '3659166000000123456');
  assert.equal(L.parseSettings({ monthlyAmountInr: 100, billingStart: '2026-08-04', cycleMonths: 5 }).settings.cycleMonths, 5, 'any whole number of months is allowed');
  for (const bad of [0, 37, 2.5, 'x']) assert.equal(L.parseSettings({ monthlyAmountInr: 100, billingStart: '2026-08-04', cycleMonths: bad }).ok, false, String(bad));
  assert.equal(L.parseSettings({ monthlyAmountInr: 100, billingStart: '2026-08-04', zohoItemId: 'x; drop' }).settings.zohoItemId, '', 'a malformed product id is dropped');
});

test('what a period covers is shown in words', () => {
  assert.equal(L.coverageLabel('2026-10', 1), 'Oct 2026'); assert.equal(L.coverageLabel('2026-10', 3), 'Oct – Dec 2026');
  assert.equal(L.coverageLabel('2026-08', 12), 'Aug 2026 – Jul 2027'); assert.equal(L.coverageLabel('2026-11', 6), 'Nov 2026 – Apr 2027');
  assert.equal(L.addMonths('2026-11', 3), '2027-02');
});

test('a yearly invoice covers its twelve months: no empty monthly rows appear inside it, and the next one is a year later', () => {
  const settings = { monthlyAmountInr: 295000, gstInclusive: true, gstPercent: 18, billingStart: '2026-08-04', cycleMonths: 12, termsDays: 15 };
  const records = [{ period: '2026-08', months: 12, status: 'paid', exPaise: 25000000, gstPercent: 18, gstPaise: 4500000, totalPaise: 29500000, invoiceNumber: 'INV-11', issuedOn: new Date('2026-08-04'), paidOn: new Date('2026-08-20') }];
  const { rows } = L.buildLedger({ settings, records, now: NOW });
  assert.equal(rows.length, 1); assert.equal(rows[0].label, 'Aug 2026 – Jul 2027'); assert.equal(rows[0].cycleLabel, 'Yearly'); assert.equal(rows[0].months, 12);
  assert.equal(L.nextInvoiceDate(settings, records, NOW), '2027-08-04');
  assert.equal(L.isCovered(records, '2027-07'), true); assert.equal(L.isCovered(records, '2027-08'), false);
});

test('a quarterly client has a row every three months from the start, not every month', () => {
  const settings = { monthlyAmountInr: 60000, gstPercent: 18, billingStart: '2026-04-10', cycleMonths: 3 };
  assert.deepEqual(L.cycleStarts(settings, '2026-10'), ['2026-04', '2026-07', '2026-10']);
  const { rows } = L.buildLedger({ settings, records: [], now: NOW });
  assert.deepEqual(rows.map((r) => r.period), ['2026-10', '2026-07', '2026-04']); assert.equal(rows[0].label, 'Oct – Dec 2026'); assert.equal(rows[0].invoiceDate, '2026-10-10');
  assert.equal(L.firstAutoPeriod(settings, NOW), '2027-01', 'the 10th of October has passed: the next quarter');
  assert.equal(L.firstAutoPeriod({ ...settings, billingStart: '2026-04-25' }, NOW), '2026-10', 'the 25th is still ahead');
});

test('an invoice or payment records the period length, the typed one first, then the client\'s cycle', async () => {
  const f = fake({ managedBilling: { monthlyAmountInr: 60000, gstInclusive: false, gstPercent: 18, billingStart: '2026-07-01', serviceStart: '2026-07', cycleMonths: 3, planName: 'SCALE' } });
  await L.linkInvoice({ actor: owner, clientId: hex('1'), period: '2026-07', input: { invoiceNumber: 'INV-Q' }, ...f, now: NOW });
  assert.equal(f.records.get('2026-07').months, 3); assert.equal(f.records.get('2026-07').planName, 'SCALE');
  await L.markPaid({ actor: owner, clientId: hex('1'), period: '2026-10', input: { mode: 'bank', invoiceNumber: 'INV-Y', months: 12 }, ...f, now: NOW });
  assert.equal(f.records.get('2026-10').months, 12);
  assert.equal(L.recordMonths({ existing: null, input: { months: 7 }, client: { managedBilling: { cycleMonths: 6 } } }), 7, 'any length from 1 to 36 is accepted');
  assert.equal(L.recordMonths({ existing: null, input: { months: 99 }, client: { managedBilling: { cycleMonths: 6 } } }), 6, 'an invalid typed length is ignored');
});

test('part payments: the first payment leaves a balance, the next ones continue from it, and the period is paid only when the total is reached', async () => {
  const f = fake({ managedBilling: { monthlyAmountInr: 295000, gstInclusive: true, gstPercent: 18, billingStart: '2026-08-04', serviceStart: '2026-08', cycleMonths: 12 } });
  // a yearly invoice of 2,95,000 where the client pays 1,00,000 now
  const first = await L.markPaid({ actor: owner, clientId: hex('1'), period: '2026-08', input: { mode: 'bank', invoiceNumber: 'INV-11', paymentAmountInr: 100000, paidOn: '2026-08-10', balanceDueOn: '2026-11-10' }, ...f, now: NOW });
  assert.equal(first.status, 200); assert.equal(first.body.partial, true); assert.equal(first.body.balancePaise, 19500000);
  let r = f.records.get('2026-08');
  assert.equal(r.status, 'partial'); assert.equal(r.paidPaise, 10000000); assert.equal(r.payments.length, 1); assert.equal(new Date(r.balanceDueOn).toISOString().slice(0, 10), '2026-11-10'); assert.equal(f.calls.paying, 1);
  const view = L.buildLedger({ settings: f.client.managedBilling, records: [r], now: NOW });
  assert.equal(view.rows[0].status, 'partial'); assert.equal(view.rows[0].balancePaise, 19500000); assert.equal(view.rows[0].paidPaise, 10000000); assert.equal(view.rows[0].balanceDueOn, '2026-11-10');
  assert.equal(view.totals.paidPaise, 10000000); assert.equal(view.totals.outstandingPaise, 19500000); assert.equal(view.totals.billedPaise, 29500000);
  const second = await L.markPaid({ actor: owner, clientId: hex('1'), period: '2026-08', input: { mode: 'upi', paymentAmountInr: 65000, paidOn: '2026-09-20' }, ...f, now: NOW });
  assert.equal(second.body.partial, true); assert.equal(second.body.balancePaise, 13000000);
  assert.equal(f.records.get('2026-08').payments.length, 2); assert.equal(new Date(f.records.get('2026-08').balanceDueOn).toISOString().slice(0, 10), '2026-11-10', 'the expected date is kept');
  const last = await L.markPaid({ actor: owner, clientId: hex('1'), period: '2026-08', input: { mode: 'bank', paidOn: '2026-10-05' }, ...f, now: NOW });
  assert.equal(last.body.partial, false);
  r = f.records.get('2026-08'); assert.equal(r.status, 'paid'); assert.equal(r.paidPaise, 29500000); assert.equal(r.payments.length, 3); assert.equal(r.balanceDueOn, null);
  assert.equal((await L.markPaid({ actor: owner, clientId: hex('1'), period: '2026-08', input: { mode: 'bank' }, ...f, now: NOW })).status, 409, 'nothing more to pay');
});

test('a payment can never be more than the balance; a bad amount is refused', async () => {
  const f = fake();
  await L.markPaid({ actor: owner, clientId: hex('1'), period: '2026-09', input: { mode: 'bank', invoiceNumber: 'INV-9', paymentAmountInr: 10000 }, ...f, now: NOW });
  const over = await L.markPaid({ actor: owner, clientId: hex('1'), period: '2026-09', input: { mode: 'bank', paymentAmountInr: 20000 }, ...f, now: NOW });
  assert.equal(over.status, 400); assert.match(over.body.message, /more than the balance/);
  assert.equal((await L.markPaid({ actor: owner, clientId: hex('1'), period: '2026-09', input: { mode: 'bank', paymentAmountInr: 'abc' }, ...f, now: NOW })).status, 400);
  assert.equal((await L.markPaid({ actor: owner, clientId: hex('1'), period: '2026-09', input: { mode: 'bank', paymentAmountInr: 0 }, ...f, now: NOW })).status, 400);
});

test('undo removes the latest payment only; with none left it goes back to invoiced; a period with a payment cannot be cancelled', async () => {
  const f = fake();
  await L.markPaid({ actor: owner, clientId: hex('1'), period: '2026-09', input: { mode: 'bank', invoiceNumber: 'INV-9', paymentAmountInr: 10000, paidOn: '2026-09-02' }, ...f, now: NOW });
  await L.markPaid({ actor: owner, clientId: hex('1'), period: '2026-09', input: { mode: 'upi', paymentAmountInr: 5000, paidOn: '2026-09-12' }, ...f, now: NOW });
  assert.equal((await L.setVoid({ actor: owner, clientId: hex('1'), period: '2026-09', voided: true, ...f })).status, 409);
  await L.undoPaid({ actor: owner, clientId: hex('1'), period: '2026-09', ...f });
  let r = f.records.get('2026-09'); assert.equal(r.status, 'partial'); assert.equal(r.paidPaise, 1000000); assert.equal(r.payments.length, 1);
  await L.undoPaid({ actor: owner, clientId: hex('1'), period: '2026-09', ...f });
  r = f.records.get('2026-09'); assert.equal(r.status, 'invoiced'); assert.equal(r.paidPaise, 0); assert.equal(r.payments.length, 0);
  assert.equal((await L.undoPaid({ actor: owner, clientId: hex('1'), period: '2026-09', ...f })).status, 409);
});

test('a discounted or special price is simply the amount typed for that period, and the plan name is free text', async () => {
  const f = fake({ managedBilling: { monthlyAmountInr: 25000, gstInclusive: true, gstPercent: 18, billingStart: '2026-08-04', serviceStart: '2026-08', cycleMonths: 4, planName: 'Custom (negotiated)' } });
  await L.linkInvoice({ actor: owner, clientId: hex('1'), period: '2026-08', input: { invoiceNumber: 'INV-S', amountInr: 70000, note: 'Discounted from 1,00,000' }, ...f, now: NOW });
  const r = f.records.get('2026-08');
  assert.equal(r.totalPaise, 7000000); assert.equal(r.exPaise + r.gstPaise, 7000000); assert.equal(r.months, 4); assert.equal(r.planName, 'Custom (negotiated)'); assert.equal(r.note, 'Discounted from 1,00,000');
  assert.deepEqual(L.cycleStarts(f.client.managedBilling, '2027-03'), ['2026-08', '2026-12', '2027-04'].filter((p) => p <= '2027-03'));
  assert.equal(L.coverageLabel('2026-08', 4), 'Aug – Nov 2026');
});

test('a part-paid period that is past its balance date shows as late', () => {
  const rec = { period: '2026-08', months: 12, status: 'partial', exPaise: 1, gstPercent: 18, gstPaise: 0, totalPaise: 29500000, paidPaise: 10000000, payments: [{ amountPaise: 10000000, paidOn: new Date('2026-08-10'), mode: 'bank' }], invoiceNumber: 'INV-1', issuedOn: new Date('2026-08-04'), dueOn: new Date('2026-08-19'), balanceDueOn: new Date('2026-10-01') };
  assert.equal(L.buildLedger({ settings: { monthlyAmountInr: 295000, billingStart: '2026-08-04', cycleMonths: 12 }, records: [rec], now: NOW }).rows[0].late, true);
  assert.equal(L.buildLedger({ settings: { monthlyAmountInr: 295000, billingStart: '2026-08-04', cycleMonths: 12 }, records: [{ ...rec, balanceDueOn: new Date('2026-12-01') }], now: NOW }).rows[0].late, false);
});

test('an invoice with no date typed gets the period\'s planned invoice date, not the date it was linked or paid', async () => {
  const f = fake({ managedBilling: { monthlyAmountInr: 295000, gstInclusive: true, gstPercent: 18, billingStart: '2026-08-04', serviceStart: '2026-08', cycleMonths: 12 } });
  await L.markPaid({ actor: owner, clientId: hex('1'), period: '2026-08', input: { mode: 'bank', invoiceNumber: 'INV-11', paymentAmountInr: 100000, paidOn: '2026-10-09' }, ...f, now: NOW });
  assert.equal(new Date(f.records.get('2026-08').issuedOn).toISOString().slice(0, 10), '2026-08-04');
  const g = fake({ managedBilling: { monthlyAmountInr: 25000, gstPercent: 18, billingStart: '2026-09-07', serviceStart: '2026-09' } });
  await L.linkInvoice({ actor: owner, clientId: hex('1'), period: '2026-09', input: { invoiceNumber: 'INV-12' }, ...g, now: NOW });
  assert.equal(new Date(g.records.get('2026-09').issuedOn).toISOString().slice(0, 10), '2026-09-07');
  await L.linkInvoice({ actor: owner, clientId: hex('1'), period: '2026-10', input: { invoiceNumber: 'INV-13', issuedOn: '2026-10-01' }, ...g, now: NOW });
  assert.equal(new Date(g.records.get('2026-10').issuedOn).toISOString().slice(0, 10), '2026-10-01', 'a typed date wins');
});

test('ending billing stores the last month and a reason; resuming clears it; no new periods appear after it', async () => {
  const L = require('../services/staff/billingLedger');
  const calls = [];
  const repo = { getClient: async () => ({ _id: hex('1'), managedBilling: { monthlyAmountInr: 10000, billingStart: '2026-05-01', cycleMonths: 1 } }), setEnded: async (...a) => { calls.push(a); } };
  const logs = [];
  const bad = await L.endBilling({ actor: { _id: hex('a'), staffRole: 'owner' }, clientId: hex('1'), input: { endedMonth: 'soon' }, repo, record: async () => {} });
  assert.equal(bad.status, 400);
  const ok = await L.endBilling({ actor: { _id: hex('a'), staffRole: 'owner' }, clientId: hex('1'), input: { endedMonth: '2026-08', reason: 'Too costly' }, repo, record: async (r) => logs.push(r.action) });
  assert.equal(ok.status, 200);
  assert.deepEqual(calls[0].slice(1), ['2026-08', 'Too costly']);
  await L.endBilling({ actor: { _id: hex('a'), staffRole: 'owner' }, clientId: hex('1'), input: { endedMonth: '' }, repo, record: async (r) => logs.push(r.action) });
  assert.deepEqual(logs, ['billing_end', 'billing_resume']);
  const ledger = L.buildLedger({ settings: { monthlyAmountInr: 10000, billingStart: '2026-05-01', cycleMonths: 1, endedMonth: '2026-08' }, records: [], now: Date.parse('2026-10-15T00:00:00Z') });
  assert.deepEqual(ledger.rows.map((r) => r.period), ['2026-08', '2026-07', '2026-06', '2026-05']);
});
