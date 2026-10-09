const test = require('node:test');
const assert = require('node:assert');
const { runBillingOnce } = require('../services/billingScheduler');

const NOW = Date.parse('2026-10-20T10:00:00Z'); // 20 Oct 2026, 15:30 in India

function setup({ clients, records = [], zohoFails = false, extraInvoices = [] }) {
  const store = new Map(records.map((r) => [`${r.client}|${r.period}`, r]));
  const made = [];
  const User = { find: () => ({ select: () => ({ lean: async () => clients }) }) };
  const ClientInvoice = {
    find: ({ client }) => ({ lean: async () => [...store.values()].filter((r) => r.client === client) }),
    findOne: ({ client, period }) => ({ lean: async () => store.get(`${client}|${period}`) || null }),
    updateOne: async ({ client, period }, u) => { store.set(`${client}|${period}`, { ...(store.get(`${client}|${period}`) || { client, period }), ...u.$set }); },
  };
  const zoho = {
    listInvoices: async () => extraInvoices,
    createManagedInvoice: async (p) => { if (zohoFails) throw new Error('Zoho is down'); made.push(p); return { invoiceId: `z${made.length}`, invoiceNumber: `INV-0001${made.length}`, customerId: 'cu', reused: false }; },
    markInvoiceSent: async () => true,
    getInvoice: async (id) => ({ lineItems: [], invoiceId: id, customerId: 'cu', subTotal: 21186.44, taxTotal: 3813.56, total: 25000, invoiceUrl: 'https://x.test/i' }),
    sharingUrl: async () => '',
  };
  const alerts = [];
  return { store, made, alerts, deps: { User, ClientInvoice, zoho, alert: (m) => alerts.push(m), logger: { log() {}, warn() {}, error() {} } } };
}
const client = (over = {}) => ({ _id: 'c1', email: 'a@b.test', firstName: 'A', companyName: 'Acme', managedBilling: { monthlyAmountInr: 25000, gstInclusive: true, gstPercent: 18, billingStart: '2026-06-05', termsDays: 15, autoInvoice: true, autoFrom: '2026-10' }, ...over });

test('the invoice for a month is made on its invoice day, dated that day, due after the terms, and never before', async () => {
  const a = setup({ clients: [client()] });
  const out = await runBillingOnce({ now: NOW, deps: a.deps });
  assert.equal(out.made, 1);
  const rec = a.store.get('c1|2026-10');
  assert.equal(rec.status, 'invoiced'); assert.equal(rec.invoiceNumber, 'INV-00011'); assert.equal(rec.note, 'Created automatically');
  assert.equal(new Date(rec.issuedOn).toISOString().slice(0, 10), '2026-10-05'); assert.equal(new Date(rec.dueOn).toISOString().slice(0, 10), '2026-10-20');
  assert.equal(a.made[0].date, '2026-10-05'); assert.equal(a.made[0].exInr, 21186.44); assert.match(a.made[0].description, /Oct 2026/);
  const early = setup({ clients: [client({ managedBilling: { ...client().managedBilling, billingStart: '2026-06-25' } })] });
  assert.equal((await runBillingOnce({ now: NOW, deps: early.deps })).made, 0, 'the 25th has not come yet');
});

test('it never reaches back before the automatic-from month, and never makes a month twice', async () => {
  const a = setup({ clients: [client({ managedBilling: { ...client().managedBilling, autoFrom: '2026-10' } })] });
  await runBillingOnce({ now: NOW, deps: a.deps });
  assert.deepEqual([...a.store.keys()], ['c1|2026-10']);
  const again = await runBillingOnce({ now: NOW, deps: a.deps });
  assert.equal(again.made, 0); assert.equal(a.made.length, 1);
  const catchUp = setup({ clients: [client({ managedBilling: { ...client().managedBilling, autoFrom: '2026-08' } })], records: [{ client: 'c1', period: '2026-09', status: 'void' }] });
  await runBillingOnce({ now: NOW, deps: catchUp.deps });
  assert.deepEqual([...catchUp.store.keys()].sort(), ['c1|2026-08', 'c1|2026-09', 'c1|2026-10'], 'a missed month after the start is caught up; a month with any record is left alone');
  assert.equal(catchUp.store.get('c1|2026-09').status, 'void');
});

test('clients without automatic invoices are never touched (the query asks only for those that switched it on)', async () => {
  let asked;
  const deps = setup({ clients: [] }).deps;
  deps.User = { find: (q) => { asked = q; return { select: () => ({ lean: async () => [] }) }; } };
  await runBillingOnce({ now: NOW, deps });
  assert.equal(asked['managedBilling.autoInvoice'], true); assert.equal(asked['plan.tier'], 'managed'); assert.equal(asked.staffRole, null);
});

test('a Zoho failure leaves no half-made month, the run goes on, and one alert is raised', async () => {
  const a = setup({ clients: [client(), client({ _id: 'c2' })], zohoFails: true });
  const out = await runBillingOnce({ now: NOW, deps: a.deps });
  assert.equal(out.made, 0); assert.equal(out.failed, 2); assert.equal(a.store.size, 0); assert.equal(a.alerts.length, 1); assert.match(a.alerts[0], /2 failed/);
});

test('one run makes at most 20 invoices', async () => {
  const many = Array.from({ length: 30 }, (_, i) => client({ _id: `c${i}` }));
  const a = setup({ clients: many });
  assert.equal((await runBillingOnce({ now: NOW, deps: a.deps })).made, 20);
});

test('a quarterly client is invoiced once a quarter on the invoice day, the invoice covers three months, and nothing is made in between', async () => {
  const q = client({ managedBilling: { ...client().managedBilling, cycleMonths: 3, billingStart: '2026-04-05', autoFrom: '2026-07' } });
  const a = setup({ clients: [q] });
  await runBillingOnce({ now: NOW, deps: a.deps });
  assert.deepEqual([...a.store.keys()].sort(), ['c1|2026-07', 'c1|2026-10']);
  assert.equal(a.store.get('c1|2026-10').months, 3);
  assert.match(a.made[1].description, /Oct – Dec 2026/);
  const again = await runBillingOnce({ now: NOW, deps: a.deps });
  assert.equal(again.made, 0);
});

test('a yearly invoice that already covers the months stops the scheduler from making monthly ones inside it', async () => {
  const y = client({ managedBilling: { ...client().managedBilling, cycleMonths: 12, billingStart: '2026-08-04', autoFrom: '2026-08' } });
  const a = setup({ clients: [y], records: [{ client: 'c1', period: '2026-08', months: 12, status: 'paid', invoiceNumber: 'INV-11' }] });
  assert.equal((await runBillingOnce({ now: NOW, deps: a.deps })).made, 0);
});
