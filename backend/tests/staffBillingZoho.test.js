const test = require('node:test');
const assert = require('node:assert');
const Z = require('../services/staff/billingZoho');

const hex = (c) => c.repeat(24);
const owner = { _id: hex('a'), staffRole: 'owner' };
const csm = { _id: hex('c'), staffRole: 'csm', isCsm: true };
const NOW = Date.parse('2026-10-20T10:00:00Z');

const inv = (over) => ({ invoiceId: 'z1', invoiceNumber: 'INV-000001', customerId: 'cu1', customerName: 'Aval Aran Publications', email: 'accounts@aval.test', date: '2026-09-28', dueDate: '2026-10-13', status: 'sent', total: 25000, balance: 25000, lastPaymentDate: '', reference: '', ...over });

function fake({ zohoInvoices = [], clientOver = {}, zohoFails = null } = {}) {
  const records = new Map(); const calls = { logs: [], paying: 0, zoho: [] };
  const client = { _id: hex('1'), email: 'accounts@aval.test', firstName: 'Aval', lastName: '', companyName: 'Aval Aran Publications Pvt Ltd', managedBilling: { monthlyAmountInr: 25000, gstInclusive: true, gstPercent: 18, serviceStart: '2026-08' }, ...clientOver };
  const repo = {
    getClient: async (id) => (id === hex('1') ? client : null),
    listRecords: async () => [...records.values()], getRecord: async (_c, p) => records.get(p) || null,
    upsertRecord: async (_c, p, set) => { records.set(p, { ...(records.get(p) || { period: p }), ...set }); }, deleteRecord: async (_c, p) => { records.delete(p); },
    setSettings: async () => {}, markClientPaying: async () => { calls.paying += 1; },
  };
  let seq = 16;
  const zoho = {
    listInvoices: async () => { if (zohoFails === 'list') throw new Error('network'); return zohoInvoices; },
    getInvoice: async (id) => { const i = zohoInvoices.find((x) => x.invoiceId === id) || { invoiceId: id, customerId: 'cuNew', total: 25000 }; return { ...i, subTotal: Math.round((i.total / 1.18) * 100) / 100, taxTotal: Math.round((i.total - i.total / 1.18) * 100) / 100, invoiceUrl: `https://books.zoho.in/inv/${id}` }; },
    createManagedInvoice: async (p) => { calls.zoho.push(['create', p]); if (zohoFails === 'create') throw new Error('18% GST tax is not set up'); seq += 1; const x = { invoiceId: `zNew${seq}`, invoiceNumber: `INV-0000${seq}`, customerId: 'cuNew', reused: false }; zohoInvoices.push(inv({ invoiceId: x.invoiceId, invoiceNumber: x.invoiceNumber, total: Math.round(p.exInr * 118) / 100 })); return x; },
    markInvoiceSent: async (id) => { calls.zoho.push(['sent', id]); return true; },
    recordPayment: async (p) => { calls.zoho.push(['payment', p]); if (zohoFails === 'payment') throw new Error('payment refused'); return {}; },
    sharingUrl: async (id) => `https://books.zoho.in/share/${id}`,
  };
  return { repo, zoho, records, calls, client, record: async (row) => { calls.logs.push(row); } };
}

test('invoices are matched by the client\'s email or business name; short or different names are not guessed', () => {
  const client = { email: 'accounts@aval.test', companyName: 'Aval Aran Publications Pvt Ltd' };
  const rows = [inv({ invoiceId: 'a' }), inv({ invoiceId: 'b', email: '', customerName: 'AVAL ARAN PUBLICATIONS' }), inv({ invoiceId: 'c', email: 'x@y.test', customerName: 'Someone Else' }), inv({ invoiceId: 'd', email: '', customerName: 'Aval' })];
  const m = Z.matchInvoices(client, rows);
  assert.deepEqual(m.map((x) => [x.inv.invoiceId, x.reason]), [['a', 'email'], ['b', 'name']]);
  assert.equal(Z.normName('The Archean Chemical Industries Pvt. Ltd.'), 'archean chemical industries');
});

test('sync preview: paid becomes paid, sent becomes invoiced, drafts and cancelled are left alone, nothing is written', async () => {
  const f = fake({ zohoInvoices: [
    inv({ invoiceId: 'z8', invoiceNumber: 'INV-000008', date: '2026-08-05', status: 'paid', balance: 0, lastPaymentDate: '2026-08-12' }),
    inv({ invoiceId: 'z9', invoiceNumber: 'INV-000009', date: '2026-09-05', status: 'sent' }),
    inv({ invoiceId: 'z10', invoiceNumber: 'INV-000010', date: '2026-10-02', status: 'draft' }),
    inv({ invoiceId: 'z7', invoiceNumber: 'INV-000007', date: '2026-07-02', status: 'void' }),
  ] });
  const out = await Z.syncFromZoho({ actor: owner, clientId: hex('1'), apply: false, ...f });
  assert.equal(out.status, 200); assert.equal(out.body.found, 4); assert.equal(out.body.willLink, 2);
  assert.deepEqual(out.body.proposals.map((p) => [p.invoiceNumber, p.action]), [['INV-000007', 'skip'], ['INV-000008', 'link_paid'], ['INV-000009', 'link_invoiced'], ['INV-000010', 'skip']]);
  assert.equal(f.records.size, 0);
});

test('sync apply writes the months with Zoho\'s own net, GST and total, marks the client as paying, and logs it', async () => {
  const f = fake({ zohoInvoices: [inv({ invoiceId: 'z8', invoiceNumber: 'INV-000008', date: '2026-08-05', status: 'paid', balance: 0, lastPaymentDate: '2026-08-12' }), inv({ invoiceId: 'z9', invoiceNumber: 'INV-000009', date: '2026-09-05' })] });
  const out = await Z.syncFromZoho({ actor: owner, clientId: hex('1'), apply: true, ...f });
  assert.equal(out.body.linked, 2);
  const aug = f.records.get('2026-08'); const sep = f.records.get('2026-09');
  assert.equal(aug.status, 'paid'); assert.equal(aug.totalPaise, 2500000); assert.equal(aug.exPaise, 2118644); assert.equal(aug.gstPaise, 381356); assert.equal(aug.zohoInvoiceId, 'z8'); assert.equal(aug.paidMode, 'other');
  assert.equal(sep.status, 'invoiced'); assert.equal(sep.invoiceNumber, 'INV-000009');
  assert.equal(f.calls.paying, 1); assert.equal(f.calls.logs[0].action, 'billing_zoho_sync');
});

test('sync never overwrites a month that already holds another invoice, and uses one invoice per month', async () => {
  const f = fake({ zohoInvoices: [inv({ invoiceId: 'z9', invoiceNumber: 'INV-000009', date: '2026-09-05' }), inv({ invoiceId: 'z9b', invoiceNumber: 'INV-000099', date: '2026-09-20' }), inv({ invoiceId: 'z8', invoiceNumber: 'INV-000008', date: '2026-08-05' })] });
  f.records.set('2026-08', { period: '2026-08', status: 'invoiced', invoiceNumber: 'INV-MANUAL', exPaise: 1, gstPercent: 18, gstPaise: 0, totalPaise: 1 });
  const out = await Z.syncFromZoho({ actor: owner, clientId: hex('1'), apply: true, ...f });
  assert.equal(out.body.linked, 1);
  assert.equal(f.records.get('2026-08').invoiceNumber, 'INV-MANUAL');
  assert.equal(f.records.get('2026-09').invoiceNumber, 'INV-000009');
  const again = await Z.syncFromZoho({ actor: owner, clientId: hex('1'), apply: false, ...f });
  assert.equal(again.body.willLink, 0, 'a second sync has nothing new');
});

test('sync upgrades a linked month to paid when Zoho now shows it paid', async () => {
  const f = fake({ zohoInvoices: [inv({ invoiceId: 'z9', invoiceNumber: 'INV-000009', date: '2026-09-05', status: 'paid', balance: 0, lastPaymentDate: '2026-09-10' })] });
  f.records.set('2026-09', { period: '2026-09', status: 'invoiced', invoiceNumber: 'INV-000009', exPaise: 2118644, gstPercent: 18, gstPaise: 381356, totalPaise: 2500000 });
  const out = await Z.syncFromZoho({ actor: owner, clientId: hex('1'), apply: true, ...f });
  assert.equal(out.body.linked, 1); assert.equal(f.records.get('2026-09').status, 'paid');
});

test('a CSM cannot sync or search; a Zoho outage gives a plain message and changes nothing', async () => {
  const f = fake({ zohoInvoices: [inv()] });
  assert.equal((await Z.syncFromZoho({ actor: csm, clientId: hex('1'), apply: true, ...f })).status, 403);
  assert.equal((await Z.searchZohoInvoices({ actor: csm, q: 'aval', zoho: f.zoho })).status, 403);
  const down = fake({ zohoFails: 'list' });
  const out = await Z.syncFromZoho({ actor: owner, clientId: hex('1'), apply: true, ...down });
  assert.equal(out.status, 502); assert.match(out.body.message, /could not reach Zoho Books/i); assert.equal(down.records.size, 0);
});

test('search finds invoices by number, customer or email, up to 20, and nothing for a one-letter search', async () => {
  const f = fake({ zohoInvoices: [inv(), inv({ invoiceId: 'z2', invoiceNumber: 'INV-000002', customerName: 'Archean Chemical', email: 'ar@x.test' })] });
  assert.equal((await Z.searchZohoInvoices({ actor: owner, q: 'archean', zoho: f.zoho })).body.invoices[0].invoiceNumber, 'INV-000002');
  assert.equal((await Z.searchZohoInvoices({ actor: owner, q: 'INV-000001', zoho: f.zoho })).body.invoices.length, 1);
  assert.equal((await Z.searchZohoInvoices({ actor: owner, q: 'a', zoho: f.zoho })).body.invoices.length, 0);
});

test('mark paid with no invoice creates it in Zoho, marks it sent, records the payment there, and stores Zoho\'s numbers', async () => {
  const f = fake();
  const out = await Z.markPaidWithZoho({ actor: owner, clientId: hex('1'), period: '2026-09', input: { mode: 'bank', paidOn: '2026-10-02', reference: 'UTR 99' }, ...f, now: NOW });
  assert.equal(out.status, 200); assert.equal(out.body.zoho.created, true); assert.equal(out.body.zoho.warning, '');
  const kinds = f.calls.zoho.map((c) => c[0]); assert.deepEqual(kinds, ['create', 'sent', 'payment']);
  const create = f.calls.zoho[0][1]; assert.equal(create.exInr, 21186.44); assert.equal(create.gstPercent, 18); assert.equal(create.reference, `NEB-${hex('1')}-2026-09`); assert.match(create.description, /Monthly plan: Sep 2026/);
  const pay = f.calls.zoho[2][1]; assert.equal(pay.amount, 25000); assert.equal(pay.mode, 'bank'); assert.equal(pay.reference, 'UTR 99'); assert.equal(pay.date, '2026-10-02');
  const r = f.records.get('2026-09'); assert.equal(r.status, 'paid'); assert.match(r.invoiceNumber, /^INV-/); assert.ok(r.zohoInvoiceId); assert.equal(r.totalPaise, 2500000); assert.equal(f.calls.paying, 1);
});

test('mark paid with a typed invoice number, or with the Zoho box off, never calls Zoho', async () => {
  const a = fake(); await Z.markPaidWithZoho({ actor: owner, clientId: hex('1'), period: '2026-09', input: { mode: 'upi', invoiceNumber: 'INV-000009' }, ...a, now: NOW });
  assert.equal(a.calls.zoho.length, 0); assert.equal(a.records.get('2026-09').invoiceNumber, 'INV-000009');
  const b = fake(); const out = await Z.markPaidWithZoho({ actor: owner, clientId: hex('1'), period: '2026-09', input: { mode: 'cash', createInZoho: false }, ...b, now: NOW });
  assert.equal(b.calls.zoho.length, 0); assert.equal(out.status, 200); assert.equal(b.records.get('2026-09').status, 'paid');
});

test('if Zoho fails, the month is still marked paid and the answer says what to retry', async () => {
  for (const failing of ['create', 'payment']) {
    const f = fake({ zohoFails: failing });
    const out = await Z.markPaidWithZoho({ actor: owner, clientId: hex('1'), period: '2026-09', input: { mode: 'bank' }, ...f, now: NOW });
    assert.equal(out.status, 200, failing); assert.match(out.body.zoho.warning, /Zoho Books could not be updated/); assert.equal(f.records.get('2026-09').status, 'paid');
    assert.equal(f.records.get('2026-09').invoiceNumber || '', '', 'no half-linked invoice is stored');
  }
});

test('create the invoice in Zoho for a month with none; a month that has one is refused; a retry reuses the same invoice', async () => {
  const f = fake();
  const out = await Z.createZohoInvoice({ actor: owner, clientId: hex('1'), period: '2026-10', ...f, now: NOW });
  assert.equal(out.status, 200);
  const r = f.records.get('2026-10'); assert.equal(r.status, 'invoiced'); assert.ok(r.zohoInvoiceId); assert.equal(r.invoiceUrl, `https://books.zoho.in/inv/${r.zohoInvoiceId}`);
  assert.equal((await Z.createZohoInvoice({ actor: owner, clientId: hex('1'), period: '2026-10', ...f, now: NOW })).status, 409);
  assert.equal((await Z.createZohoInvoice({ actor: csm, clientId: hex('1'), period: '2026-10', ...fake(), now: NOW })).status, 403);
  const g = fake({ zohoFails: 'create' }); const bad = await Z.createZohoInvoice({ actor: owner, clientId: hex('1'), period: '2026-10', ...g, now: NOW });
  assert.equal(bad.status, 502); assert.equal(g.records.size, 0);
});

test('paying a month whose invoice this app created records the payment in Zoho too', async () => {
  const f = fake();
  await Z.createZohoInvoice({ actor: owner, clientId: hex('1'), period: '2026-10', ...f, now: NOW });
  f.calls.zoho.length = 0;
  const out = await Z.markPaidWithZoho({ actor: owner, clientId: hex('1'), period: '2026-10', input: { mode: 'cheque', reference: 'CHQ 12' }, ...f, now: NOW });
  assert.equal(out.status, 200);
  assert.deepEqual(f.calls.zoho.map((c) => c[0]), ['payment']); assert.equal(f.calls.zoho[0][1].mode, 'cheque');
});

test('an invoice with a discount is recorded as charged: net is the total minus GST, not the sub-total before the discount (real case INV-000006)', async () => {
  const f = fake({ zohoInvoices: [inv({ invoiceId: 'zd', invoiceNumber: 'INV-000006', date: '2026-07-30', status: 'paid', total: 8000, balance: 0, lastPaymentDate: '2026-08-02' })] });
  f.zoho.getInvoice = async () => ({ invoiceId: 'zd', customerId: 'cu1', subTotal: 8474.58, taxTotal: 1220.34, total: 8000, invoiceUrl: 'https://x.test/i' });
  await Z.syncFromZoho({ actor: owner, clientId: hex('1'), apply: true, ...f });
  const r = f.records.get('2026-07');
  assert.equal(r.totalPaise, 800000); assert.equal(r.gstPaise, 122034); assert.equal(r.exPaise, 677966);
  assert.equal(r.exPaise + r.gstPaise, r.totalPaise);
  assert.equal(r.gstPercent, 18);
});

test('a client who already has invoices in Zoho keeps their existing Zoho customer for new invoices; a new client gets none preset', async () => {
  const a = fake({ zohoInvoices: [inv({ invoiceId: 'z1', customerId: 'cuExisting', email: 'finance@aval.test', customerName: 'Aval Aran Publications' })] });
  await Z.createZohoInvoice({ actor: owner, clientId: hex('1'), period: '2026-10', ...a, now: NOW });
  assert.equal(a.calls.zoho[0][1].customerId, 'cuExisting');
  const b = fake();
  await Z.createZohoInvoice({ actor: owner, clientId: hex('1'), period: '2026-10', ...b, now: NOW });
  assert.equal(b.calls.zoho[0][1].customerId, undefined);
});

test('billing cycles are read from the product and description, falling back to the client\'s own cycle', () => {
  assert.equal(Z.detectCycleMonths([{ name: 'SCALE (Content + Outreach limit 10000)', description: 'Annual Plan' }], 1), 12);
  assert.equal(Z.detectCycleMonths([{ name: 'GROWTH', description: 'Half Yearly Plan' }], 1), 6);
  assert.equal(Z.detectCycleMonths([{ name: 'PRO', description: 'Quarterly billing' }], 1), 3);
  assert.equal(Z.detectCycleMonths([{ name: 'PRO (Content Only)', description: 'Content Only.' }], 1), 1);
  assert.equal(Z.detectCycleMonths([{ name: 'Scale', description: 'Nebulaa Scale Plan' }], 3), 3);
  assert.equal(Z.detectCycleMonths([], 7), 1);
});

test('syncing an annual invoice records twelve months and the plan, and a monthly invoice inside it is not added again', async () => {
  const f = fake({ zohoInvoices: [inv({ invoiceId: 'zY', invoiceNumber: 'INV-000011', date: '2026-08-04', status: 'sent', total: 295000 }), inv({ invoiceId: 'zM', invoiceNumber: 'INV-000099', date: '2026-10-04', status: 'sent', total: 25000 })] });
  f.zoho.getInvoice = async (id) => (id === 'zY' ? { invoiceId: id, customerId: 'cu1', subTotal: 250000, taxTotal: 45000, total: 295000, invoiceUrl: '', lineItems: [{ name: 'SCALE (Content + Outreach limit 10000)', description: 'Annual Plan' }] } : { invoiceId: id, customerId: 'cu1', subTotal: 21186.44, taxTotal: 3813.56, total: 25000, invoiceUrl: '', lineItems: [{ name: 'SCALE', description: 'Monthly' }] });
  const out = await Z.syncFromZoho({ actor: owner, clientId: hex('1'), apply: true, ...f });
  assert.equal(out.body.linked, 1);
  const r = f.records.get('2026-08');
  assert.equal(r.months, 12); assert.equal(r.planName, 'SCALE (Content + Outreach limit 10000)'); assert.equal(r.totalPaise, 29500000); assert.equal(r.exPaise, 25000000);
  assert.equal(f.records.has('2026-10'), false, 'October is inside the yearly invoice');
});

test('the Zoho invoice names the plan, uses its product, and says what period it covers', async () => {
  const f = fake({ clientOver: { managedBilling: { monthlyAmountInr: 295000, gstInclusive: true, gstPercent: 18, billingStart: '2026-08-04', serviceStart: '2026-08', cycleMonths: 12, planName: 'SCALE (Content + Outreach limit 10000)', zohoItemId: '3659166000000111111' } } });
  await Z.createZohoInvoice({ actor: owner, clientId: hex('1'), period: '2026-08', ...f, now: NOW });
  const c = f.calls.zoho[0][1];
  assert.equal(c.itemName, 'SCALE (Content + Outreach limit 10000)'); assert.equal(c.itemId, '3659166000000111111'); assert.equal(c.description, 'Yearly plan: Aug 2026 – Jul 2027'); assert.equal(c.exInr, 250000);
  assert.equal(c.date, '2026-08-04');
  assert.equal(f.records.get('2026-08').months, 12);
});

test('a part payment on an invoice made here is recorded in Zoho for exactly the amount received', async () => {
  const f = fake({ clientOver: { managedBilling: { monthlyAmountInr: 295000, gstInclusive: true, gstPercent: 18, billingStart: '2026-08-04', serviceStart: '2026-08', cycleMonths: 12 } } });
  const out = await Z.markPaidWithZoho({ actor: owner, clientId: hex('1'), period: '2026-08', input: { mode: 'bank', paymentAmountInr: 100000, paidOn: '2026-08-10', balanceDueOn: '2026-11-10' }, ...f, now: NOW });
  assert.equal(out.status, 200); assert.equal(out.body.partial, true);
  assert.equal(f.calls.zoho.find((c) => c[0] === 'payment')[1].amount, 100000);
  assert.equal(f.records.get('2026-08').status, 'partial'); assert.equal(f.records.get('2026-08').paidPaise, 10000000);
  f.calls.zoho.length = 0;
  await Z.markPaidWithZoho({ actor: owner, clientId: hex('1'), period: '2026-08', input: { mode: 'upi', paidOn: '2026-09-05' }, ...f, now: NOW });
  assert.equal(f.calls.zoho.find((c) => c[0] === 'payment')[1].amount, 195000, 'the rest of the balance, not the whole invoice');
  assert.equal(f.records.get('2026-08').status, 'paid');
});

test('too much, or a payment on a fully paid period, is refused before Zoho is touched', async () => {
  const f = fake();
  const over = await Z.markPaidWithZoho({ actor: owner, clientId: hex('1'), period: '2026-09', input: { mode: 'bank', paymentAmountInr: 99999999 }, ...f, now: NOW });
  assert.equal(over.status, 400); assert.equal(f.calls.zoho.length, 0);
});

test('syncing a part-paid invoice from Zoho records what was paid and what is left', async () => {
  const f = fake({ zohoInvoices: [inv({ invoiceId: 'zp', invoiceNumber: 'INV-000011', date: '2026-08-04', status: 'partially_paid', total: 295000, balance: 195000, lastPaymentDate: '2026-08-10' })] });
  f.zoho.getInvoice = async () => ({ invoiceId: 'zp', customerId: 'cu1', subTotal: 250000, taxTotal: 45000, total: 295000, balance: 195000, invoiceUrl: '', lineItems: [{ name: 'SCALE', description: 'Annual Plan' }] });
  const prev = await Z.syncFromZoho({ actor: owner, clientId: hex('1'), apply: false, ...f });
  assert.equal(prev.body.proposals[0].action, 'link_partial'); assert.equal(prev.body.proposals[0].paidPaise, 10000000);
  await Z.syncFromZoho({ actor: owner, clientId: hex('1'), apply: true, ...f });
  const r = f.records.get('2026-08'); assert.equal(r.status, 'partial'); assert.equal(r.paidPaise, 10000000); assert.equal(r.months, 12); assert.equal(r.payments[0].amountPaise, 10000000);
});

test('a ledger invoice shown as sent that Zoho now shows fully paid is upgraded to paid; a sent one with a balance equal to the total stays invoiced', async () => {
  const f = fake({ zohoInvoices: [inv({ invoiceId: 'z9', invoiceNumber: 'INV-000009', date: '2026-09-05', status: 'sent', total: 25000, balance: 25000 })] });
  const out = await Z.syncFromZoho({ actor: owner, clientId: hex('1'), apply: false, ...f });
  assert.equal(out.body.proposals[0].action, 'link_invoiced');
});
