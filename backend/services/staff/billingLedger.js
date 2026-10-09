/**
 * The monthly billing ledger of a managed client: which months of service there have been, what each costs
 * (the client's fixed fee plus GST), and for each month the invoice and how it was paid. Every rule lives here
 * and is tested with an in-memory repository; the routes only wire in the database and the activity log.
 * Money is held in whole paise. Who is acting comes from the signed-in account, never from the request.
 */
const { can, isStaff } = require('./permissions');
const { isCustomer } = require('./clientActions');

const GST_RATES = [0, 5, 12, 18, 28];
const DEFAULT_GST = 18;
const PAID_MODES = ['bank', 'cheque', 'upi', 'cash', 'razorpay', 'other'];
const MODE_LABEL = { bank: 'Bank transfer', cheque: 'Cheque', upi: 'UPI', cash: 'Cash', razorpay: 'Razorpay', other: 'Other' };
const DEFAULT_DUE_DAYS = 15;
const MAX_FEE_INR = 10000000;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = 86400000;

const refuse = (status, message) => ({ status, body: { success: false, message } });
const idOf = (v) => (v ? String(v._id || v.id || v) : '');

/** Rupees (up to 2 decimals) to whole paise, or null when it is not a sensible amount. */
function toPaise(inr) {
  const n = typeof inr === 'string' ? Number(inr.replace(/,/g, '').trim()) : inr;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || n > MAX_FEE_INR) return null;
  const paise = Math.round(n * 100);
  return Math.abs(paise / 100 - n) < 1e-9 ? paise : null;
}

/**
 * The three amounts of one month. `enteredPaise` is the amount staff typed:
 * excluding GST (the default) it is the net and GST is added on top; including GST it is what the client pays
 * and the net is worked out from it (net = total / (1 + rate)), the GST being the rest. Everything in whole paise.
 */
function amountsFor(enteredPaise, gstPercent, gstInclusive = false) {
  if (gstInclusive) {
    const exPaise = Math.round((enteredPaise * 100) / (100 + gstPercent));
    return { exPaise, gstPercent, gstPaise: enteredPaise - exPaise, totalPaise: enteredPaise, gstInclusive: true };
  }
  const gstPaise = Math.round((enteredPaise * gstPercent) / 100);
  return { exPaise: enteredPaise, gstPercent, gstPaise, totalPaise: enteredPaise + gstPaise, gstInclusive: false };
}

const periodOf = (date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
function labelOf(period) { const [y, m] = period.split('-'); return `${MONTHS[Number(m) - 1]} ${y}`; }
function nextPeriod(period) { const [y, m] = period.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; }

const CYCLES = [1, 3, 6, 12];
const CYCLE_LABEL = { 1: 'Monthly', 3: 'Quarterly', 6: 'Half-yearly', 12: 'Yearly' };
/** The month `n` months after `period` (n may be 0). */
function addMonths(period, n) { let p = period; for (let i = 0; i < n; i += 1) p = nextPeriod(p); return p; }
/** What a billing period covers, for example "Oct 2026", "Oct – Dec 2026" or "Aug 2026 – Jul 2027". */
function coverageLabel(period, months = 1) {
  if (!months || months <= 1) return labelOf(period);
  const last = addMonths(period, months - 1);
  const [y1, m1] = period.split('-'); const [y2, m2] = last.split('-');
  return y1 === y2 ? `${MONTHS[Number(m1) - 1]} – ${MONTHS[Number(m2) - 1]} ${y2}` : `${labelOf(period)} – ${labelOf(last)}`;
}
/** True when some record already covers `period` (a yearly invoice covers its twelve months). */
function isCovered(records, period) {
  return (records || []).some((r) => r.status !== 'void' && r.period <= period && period < addMonths(r.period, r.months || 1));
}
/** The first month of every billing period of a client, from the billing start up to `upTo`. */
function cycleStarts(settings, upTo) {
  const start = settings && (settings.billingStart ? settings.billingStart.slice(0, 7) : settings.serviceStart);
  if (!start || !PERIOD.test(start)) return [];
  const step = CYCLES.includes(Number(settings.cycleMonths)) ? Number(settings.cycleMonths) : 1;
  const out = [];
  for (let p = start; p <= upTo && out.length < 600; p = addMonths(p, step)) out.push(p);
  return out;
}

const daysInMonth = (period) => { const [y, m] = period.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
const IST_MS = 5.5 * 3600 * 1000;
/** Today's date in India as 'YYYY-MM-DD' (billing days are Indian calendar days). */
const todayIst = (now = Date.now()) => new Date(now + IST_MS).toISOString().slice(0, 10);

/** The invoice date of a service month: the client's billing day in that month (the 31st becomes the last day of a short month). */
function plannedInvoiceDate(settings, period) {
  const start = settings && settings.billingStart;
  if (!start || !PERIOD.test(period)) return null;
  const day = Number(String(start).slice(8, 10)) || 1;
  return `${period}-${String(Math.min(day, daysInMonth(period))).padStart(2, '0')}`;
}

/** The first billing period an automatic invoice may be made for: the next one whose invoice day is still ahead. */
function firstAutoPeriod(settings, now = Date.now()) {
  const today = todayIst(now);
  const horizon = addMonths(today.slice(0, 7), 13);
  for (const p of cycleStarts(settings, horizon)) {
    const d = plannedInvoiceDate(settings, p);
    if (d && d > today) return p;
  }
  return addMonths(today.slice(0, 7), 1);
}

/** 'YYYY-MM' or 'YYYY-MM-DD' to 'YYYY-MM', or null. */
function parseStart(value) {
  const s = String(value || '').trim();
  const m = s.match(/^(\d{4})-(0[1-9]|1[0-2])(-\d{2})?$/);
  return m ? `${m[1]}-${m[2]}` : null;
}

function parseDate(value) {
  if (value === undefined || value === null || value === '') return { ok: true, date: null };
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return { ok: false };
  return { ok: true, date: d };
}

/** The client's billing settings from a form: amount, GST mode and rate, the first billing date, payment terms, automatic invoices. */
function parseSettings(input = {}) {
  const amount = toPaise(input.monthlyAmountInr);
  if (amount === null) return { ok: false, message: 'Enter the amount they pay each billing period, in rupees (for example 25000).' };
  if (input.gstInclusive !== undefined && typeof input.gstInclusive !== 'boolean') return { ok: false, message: 'Say whether the amount includes GST or not.' };
  const gstPercent = input.gstPercent === undefined || input.gstPercent === '' ? DEFAULT_GST : Number(input.gstPercent);
  if (!GST_RATES.includes(gstPercent)) return { ok: false, message: `GST must be one of ${GST_RATES.join(', ')} percent.` };
  // The first billing date fixes the invoice day of every later month. A plain month (older entries) means the 1st.
  const raw = String(input.billingStart || input.serviceStart || '').trim();
  let billingStart = null;
  if (/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(raw)) { const d = new Date(`${raw}T00:00:00Z`); if (!Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === raw) billingStart = raw; }
  else if (/^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) billingStart = `${raw}-01`;
  if (!billingStart) return { ok: false, message: 'Enter the date billing starts, for example 2026-06-05.' };
  const termsDays = input.termsDays === undefined || input.termsDays === '' ? DEFAULT_DUE_DAYS : Number(input.termsDays);
  if (!Number.isInteger(termsDays) || termsDays < 0 || termsDays > 90) return { ok: false, message: 'Payment terms must be a whole number of days from 0 to 90.' };
  if (input.autoInvoice !== undefined && typeof input.autoInvoice !== 'boolean') return { ok: false, message: 'Say whether invoices are made automatically or not.' };
  const cycleMonths = input.cycleMonths === undefined || input.cycleMonths === '' ? 1 : Number(input.cycleMonths);
  if (!CYCLES.includes(cycleMonths)) return { ok: false, message: 'Choose how often they are billed: monthly, quarterly, half-yearly or yearly.' };
  const planName = String(input.planName || '').trim().slice(0, 80);
  const zohoItemId = /^[0-9]{6,30}$/.test(String(input.zohoItemId || '').trim()) ? String(input.zohoItemId).trim() : '';
  return { ok: true, settings: { monthlyAmountInr: amount / 100, gstPercent, gstInclusive: input.gstInclusive === true, billingStart, serviceStart: billingStart.slice(0, 7), termsDays, autoInvoice: input.autoInvoice === true, cycleMonths, planName, zohoItemId } };
}

/** The invoice details of a month. */
function parseInvoice(input = {}) {
  const invoiceNumber = String(input.invoiceNumber || '').trim();
  if (!invoiceNumber || invoiceNumber.length > 40) return { ok: false, message: 'Enter the invoice number from Zoho Books (40 characters at most).' };
  let invoiceUrl = String(input.invoiceUrl || '').trim();
  if (invoiceUrl) {
    try { const u = new URL(invoiceUrl); if (u.protocol !== 'https:') throw new Error('x'); } catch (_) { return { ok: false, message: 'The invoice link must be a full https:// address, or left empty.' }; }
    if (invoiceUrl.length > 500) return { ok: false, message: 'The invoice link is too long.' };
  }
  const issued = parseDate(input.issuedOn);
  if (!issued.ok) return { ok: false, message: 'The invoice date is not a valid date.' };
  let exPaise = null;
  if (input.amountInr !== undefined && input.amountInr !== null && input.amountInr !== '') {
    exPaise = toPaise(input.amountInr);
    if (exPaise === null) return { ok: false, message: 'The amount is not valid.' };
  }
  const note = String(input.note || '').trim().slice(0, 300);
  return { ok: true, invoice: { invoiceNumber, invoiceUrl, issuedOn: issued.date, enteredPaise: exPaise, note } };
}

/** How and when a month was paid. */
function parsePayment(input = {}, now = Date.now()) {
  if (!PAID_MODES.includes(input.mode)) return { ok: false, message: 'Choose how it was paid: bank transfer, cheque, UPI, cash, Razorpay or other.' };
  const paid = parseDate(input.paidOn || new Date(now).toISOString().slice(0, 10));
  if (!paid.ok || !paid.date) return { ok: false, message: 'The payment date is not a valid date.' };
  if (paid.date.getTime() > now + DAY) return { ok: false, message: 'The payment date cannot be in the future.' };
  return { ok: true, payment: { paidOn: paid.date, mode: input.mode, reference: String(input.reference || '').trim().slice(0, 100), note: String(input.note || '').trim().slice(0, 300) } };
}

/**
 * The months of service from the start month to the current month, newest first, each with its status:
 * not_invoiced, invoiced, overdue (invoiced and past its due date), paid or void.
 */
function buildLedger({ settings, records = [], now = Date.now() }) {
  const s = settings || {};
  const byPeriod = new Map(records.map((r) => [r.period, r]));
  const thisMonth = periodOf(new Date(now));
  const periods = new Set(records.map((r) => r.period));
  // The billing periods still to come or not yet invoiced: every cycle start up to this month that no invoice already covers.
  if (s.monthlyAmountInr) for (const p of cycleStarts({ ...s, billingStart: s.billingStart || (s.serviceStart ? `${s.serviceStart}-01` : '') }, thisMonth)) if (!isCovered(records, p)) periods.add(p);
  const feePaise = s.monthlyAmountInr ? Math.round(s.monthlyAmountInr * 100) : 0;
  const terms = s.termsDays == null ? DEFAULT_DUE_DAYS : s.termsDays;
  const cycle = CYCLES.includes(Number(s.cycleMonths)) ? Number(s.cycleMonths) : 1;
  const plan = (period) => plannedInvoiceDate(s.billingStart ? s : (s.serviceStart ? { ...s, billingStart: `${s.serviceStart}-01` } : s), period);
  const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
  const rows = [...periods].sort().reverse().map((period) => {
    const r = byPeriod.get(period);
    const amounts = r ? { exPaise: r.exPaise, gstPercent: r.gstPercent, gstPaise: r.gstPaise, totalPaise: r.totalPaise, gstInclusive: Boolean(r.gstInclusive) } : amountsFor(feePaise, s.gstPercent == null ? DEFAULT_GST : s.gstPercent, Boolean(s.gstInclusive));
    let status = 'not_invoiced';
    if (r) {
      status = r.status;
      if (status === 'invoiced') {
        const due = r.dueOn ? new Date(r.dueOn).getTime() : (r.issuedOn ? new Date(r.issuedOn).getTime() + terms * DAY : null);
        if (due !== null && due < now) status = 'overdue';
      }
    }
    const months = (r && r.months) || cycle;
    return {
      period, label: coverageLabel(period, months), months, cycleLabel: CYCLE_LABEL[months] || `${months} months`, planName: (r && r.planName) || s.planName || '', status, ...amounts,
      invoiceNumber: (r && r.invoiceNumber) || '', invoiceUrl: (r && r.invoiceUrl) || '', zohoInvoiceId: (r && r.zohoInvoiceId) || '',
      issuedOn: (r && r.issuedOn) || null, paidOn: (r && r.paidOn) || null,
      invoiceDate: r && r.issuedOn ? iso(r.issuedOn) : (plan(period) || ''),
      dueDate: r && r.dueOn ? iso(r.dueOn) : (r && r.issuedOn ? iso(new Date(r.issuedOn).getTime() + terms * DAY) : (plan(period) ? iso(new Date(`${plan(period)}T00:00:00Z`).getTime() + terms * DAY) : '')),
      paidDate: r && r.paidOn ? iso(r.paidOn) : '',
      paidMode: (r && r.paidMode) || null, paidModeLabel: r && r.paidMode ? MODE_LABEL[r.paidMode] : '',
      paidReference: (r && r.paidReference) || '', note: (r && r.note) || ''
    };
  });
  const counted = rows.filter((x) => x.status !== 'void');
  const sum = (list) => list.reduce((n, x) => n + x.totalPaise, 0);
  return {
    rows,
    totals: {
      billedPaise: sum(counted.filter((x) => x.status !== 'not_invoiced')),
      paidPaise: sum(counted.filter((x) => x.status === 'paid')),
      outstandingPaise: sum(counted.filter((x) => x.status === 'invoiced' || x.status === 'overdue')),
      notInvoicedPaise: sum(counted.filter((x) => x.status === 'not_invoiced')),
    }
  };
}

// ---- actions ----------------------------------------------------------------------------------------------

async function loadTarget({ actor, clientId, repo }) {
  if (!isStaff(actor) || !can(actor, 'manage_billing')) return { error: refuse(403, 'Your role cannot do this.') };
  const client = await repo.getClient(clientId);
  if (!client || !isCustomer(client)) return { error: refuse(404, 'That client was not found.') };
  return { client };
}

/** The date of the next invoice that has not been made yet (today or later), or '' when billing is not set up. */
function nextInvoiceDate(settings, records, now = Date.now()) {
  const s = settings && settings.billingStart ? settings : (settings && settings.serviceStart ? { ...settings, billingStart: `${settings.serviceStart}-01` } : null);
  if (!s || !s.monthlyAmountInr) return '';
  const today = todayIst(now);
  for (const p of cycleStarts(s, addMonths(today.slice(0, 7), 13))) {
    const d = plannedInvoiceDate(s, p);
    if (d && d >= today && !isCovered(records, p) && !(records || []).some((r) => r.period === p)) return d;
  }
  return '';
}

async function viewBilling({ actor, clientId, repo, now = Date.now() }) {
  const t = await loadTarget({ actor, clientId, repo });
  if (t.error) return t.error;
  const records = await repo.listRecords(clientId);
  const settings = t.client.managedBilling || {};
  return { status: 200, body: { success: true, cycles: CYCLES.map((m) => ({ value: m, label: CYCLE_LABEL[m] })), settings: { monthlyAmountInr: settings.monthlyAmountInr || null, gstInclusive: Boolean(settings.gstInclusive), gstPercent: settings.gstPercent == null ? DEFAULT_GST : settings.gstPercent, billingStart: settings.billingStart || (settings.serviceStart ? `${settings.serviceStart}-01` : ''), termsDays: settings.termsDays == null ? DEFAULT_DUE_DAYS : settings.termsDays, cycleMonths: CYCLES.includes(Number(settings.cycleMonths)) ? Number(settings.cycleMonths) : 1, planName: settings.planName || '', zohoItemId: settings.zohoItemId || '', autoInvoice: Boolean(settings.autoInvoice), autoFrom: settings.autoFrom || '' }, nextInvoiceDate: nextInvoiceDate(settings, records, now), paidModes: PAID_MODES.map((m) => ({ value: m, label: MODE_LABEL[m] })), ...buildLedger({ settings, records, now }) } };
}

async function saveSettings({ actor, clientId, input, repo, record, now = Date.now() }) {
  const t = await loadTarget({ actor, clientId, repo });
  if (t.error) return t.error;
  const p = parseSettings(input);
  if (!p.ok) return refuse(400, p.message);
  // Turning automatic invoices on never reaches back: it starts from the next invoice day.
  const before = t.client.managedBilling || {};
  const settings = { ...p.settings };
  if (settings.autoInvoice) settings.autoFrom = before.autoInvoice && before.autoFrom ? before.autoFrom : firstAutoPeriod(settings, now);
  await repo.setSettings(clientId, settings);
  await record({ actor, action: 'billing_settings', client: clientId, details: { monthlyAmountInr: settings.monthlyAmountInr, gstInclusive: settings.gstInclusive, gstPercent: settings.gstPercent, billingStart: settings.billingStart, termsDays: settings.termsDays, autoInvoice: settings.autoInvoice } });
  return { status: 200, body: { success: true, settings } };
}

/** The amounts for a month: an amount typed now (in the client's mode), else the month's own record, else the client's monthly amount. */
function monthAmounts({ client, existing, override }) {
  const b = client.managedBilling || {};
  const rate = b.gstPercent == null ? DEFAULT_GST : b.gstPercent;
  if (override !== null && override !== undefined) return amountsFor(override, rate, Boolean(b.gstInclusive));
  if (existing) return { exPaise: existing.exPaise, gstPercent: existing.gstPercent, gstPaise: existing.gstPaise, totalPaise: existing.totalPaise, gstInclusive: Boolean(existing.gstInclusive) };
  if (!b.monthlyAmountInr) return null;
  return amountsFor(Math.round(b.monthlyAmountInr * 100), rate, Boolean(b.gstInclusive));
}

/** How many months a record covers: typed now, else what it already had, else the client's billing cycle. */
function recordMonths({ existing, input, client }) {
  const typed = Number(input && input.months);
  if (CYCLES.includes(typed)) return typed;
  if (existing && existing.months) return existing.months;
  const c = Number((client.managedBilling || {}).cycleMonths);
  return CYCLES.includes(c) ? c : 1;
}

/** Link an invoice from Zoho Books to a month (no payment yet). */
async function linkInvoice({ actor, clientId, period, input, repo, record, now = Date.now() }) {
  const t = await loadTarget({ actor, clientId, repo });
  if (t.error) return t.error;
  if (!PERIOD.test(period)) return refuse(400, 'That month is not valid.');
  const p = parseInvoice(input);
  if (!p.ok) return refuse(400, p.message);
  const existing = await repo.getRecord(clientId, period);
  if (existing && existing.status === 'paid') return refuse(409, 'This month is already paid. Undo the payment first if you need to change the invoice.');
  const amounts = monthAmounts({ client: t.client, existing, override: p.invoice.enteredPaise });
  if (!amounts) return refuse(400, 'Set the client\'s monthly amount first, or type the amount for this invoice.');
  const issuedOn = p.invoice.issuedOn || (existing && existing.issuedOn) || new Date(now);
  const months = recordMonths({ existing, input, client: t.client });
  await repo.upsertRecord(clientId, period, { ...amounts, months, planName: (existing && existing.planName) || (t.client.managedBilling || {}).planName || '', status: 'invoiced', invoiceNumber: p.invoice.invoiceNumber, invoiceUrl: p.invoice.invoiceUrl, issuedOn, dueOn: new Date(new Date(issuedOn).getTime() + (((t.client.managedBilling || {}).termsDays == null ? DEFAULT_DUE_DAYS : t.client.managedBilling.termsDays)) * DAY), note: p.invoice.note || (existing && existing.note) || '', recordedBy: idOf(actor) });
  await record({ actor, action: 'billing_link_invoice', client: clientId, details: { period, invoiceNumber: p.invoice.invoiceNumber } });
  return { status: 200, body: { success: true } };
}

/** Mark a month as paid. An invoice can be linked in the same step. */
async function markPaid({ actor, clientId, period, input, repo, record, now = Date.now() }) {
  const t = await loadTarget({ actor, clientId, repo });
  if (t.error) return t.error;
  if (!PERIOD.test(period)) return refuse(400, 'That month is not valid.');
  const pay = parsePayment(input, now);
  if (!pay.ok) return refuse(400, pay.message);
  const existing = await repo.getRecord(clientId, period);
  if (existing && existing.status === 'void') return refuse(409, 'This month was cancelled. Restore it first.');
  let invoice = null;
  if (input.invoiceNumber !== undefined && String(input.invoiceNumber).trim() !== '') {
    const link = parseInvoice(input);
    if (!link.ok) return refuse(400, link.message);
    invoice = link.invoice;
  }
  const amounts = monthAmounts({ client: t.client, existing, override: invoice ? invoice.enteredPaise : null });
  if (!amounts) return refuse(400, 'Set the client\'s monthly amount first, or type the amount.');
  const set = { ...amounts, months: recordMonths({ existing, input, client: t.client }), planName: (existing && existing.planName) || (t.client.managedBilling || {}).planName || '', status: 'paid', paidOn: pay.payment.paidOn, paidMode: pay.payment.mode, paidReference: pay.payment.reference, recordedBy: idOf(actor) };
  if (invoice) Object.assign(set, { invoiceNumber: invoice.invoiceNumber, invoiceUrl: invoice.invoiceUrl, issuedOn: invoice.issuedOn || (existing && existing.issuedOn) || pay.payment.paidOn });
  if (pay.payment.note || invoice?.note) set.note = pay.payment.note || invoice.note;
  await repo.upsertRecord(clientId, period, set);
  await repo.markClientPaying(clientId);
  await record({ actor, action: 'billing_mark_paid', client: clientId, details: { period, mode: pay.payment.mode, totalPaise: amounts.totalPaise, invoiceNumber: (invoice && invoice.invoiceNumber) || (existing && existing.invoiceNumber) || '' } });
  return { status: 200, body: { success: true } };
}

/** Undo a payment: the month goes back to invoiced (or to not invoiced when it never had an invoice). */
async function undoPaid({ actor, clientId, period, repo, record }) {
  const t = await loadTarget({ actor, clientId, repo });
  if (t.error) return t.error;
  if (!PERIOD.test(period)) return refuse(400, 'That month is not valid.');
  const existing = await repo.getRecord(clientId, period);
  if (!existing || existing.status !== 'paid') return refuse(409, 'This month is not marked as paid.');
  if (existing.invoiceNumber) await repo.upsertRecord(clientId, period, { status: 'invoiced', paidOn: null, paidMode: null, paidReference: '' });
  else await repo.deleteRecord(clientId, period);
  await record({ actor, action: 'billing_undo_paid', client: clientId, details: { period } });
  return { status: 200, body: { success: true } };
}

/** Cancel a month (for example a free month) or bring it back. */
async function setVoid({ actor, clientId, period, voided, repo, record }) {
  const t = await loadTarget({ actor, clientId, repo });
  if (t.error) return t.error;
  if (!PERIOD.test(period)) return refuse(400, 'That month is not valid.');
  const existing = await repo.getRecord(clientId, period);
  if (existing && existing.status === 'paid') return refuse(409, 'This month is paid. Undo the payment first.');
  if (voided) {
    const amounts = monthAmounts({ client: t.client, existing, override: null }) || amountsFor(0, DEFAULT_GST, false);
    await repo.upsertRecord(clientId, period, { ...amounts, status: 'void', recordedBy: idOf(actor) });
  } else if (existing) {
    if (existing.invoiceNumber) await repo.upsertRecord(clientId, period, { status: 'invoiced' });
    else await repo.deleteRecord(clientId, period);
  }
  await record({ actor, action: voided ? 'billing_void' : 'billing_restore', client: clientId, details: { period } });
  return { status: 200, body: { success: true } };
}

/** Change the invoice date, due date or paid date of one month (the paid date only on a paid month). */
async function editDates({ actor, clientId, period, input = {}, repo, record, now = Date.now() }) {
  const t = await loadTarget({ actor, clientId, repo });
  if (t.error) return t.error;
  if (!PERIOD.test(period)) return refuse(400, 'That month is not valid.');
  const existing = await repo.getRecord(clientId, period);
  if (!existing || existing.status === 'void') return refuse(409, 'This month has no invoice to change yet. Link or create the invoice first.');
  const set = {};
  const dateOf = (key, label) => { if (input[key] === undefined || input[key] === '') return { ok: true, skip: true }; const d = parseDate(input[key]); if (!d.ok || !d.date) return { ok: false, message: `The ${label} is not a valid date.` }; return { ok: true, date: d.date }; };
  const inv = dateOf('invoiceDate', 'invoice date'); if (!inv.ok) return refuse(400, inv.message); if (!inv.skip) set.issuedOn = inv.date;
  const due = dateOf('dueDate', 'due date'); if (!due.ok) return refuse(400, due.message); if (!due.skip) set.dueOn = due.date;
  const paid = dateOf('paidDate', 'paid date'); if (!paid.ok) return refuse(400, paid.message);
  if (!paid.skip) {
    if (existing.status !== 'paid') return refuse(409, 'Only a paid month has a paid date. Mark it paid first.');
    if (paid.date.getTime() > now + DAY) return refuse(400, 'The paid date cannot be in the future.');
    set.paidOn = paid.date;
  }
  if (Object.keys(set).length === 0) return refuse(400, 'Choose a date to change.');
  const issued = set.issuedOn || existing.issuedOn; const dueOn = set.dueOn || existing.dueOn;
  if (issued && dueOn && new Date(dueOn).getTime() < new Date(issued).getTime()) return refuse(400, 'The due date cannot be before the invoice date.');
  await repo.upsertRecord(clientId, period, set);
  await record({ actor, action: 'billing_edit_dates', client: clientId, details: { period, ...Object.fromEntries(Object.entries(set).map(([k, v]) => [k, new Date(v).toISOString().slice(0, 10)])) } });
  return { status: 200, body: { success: true, inZoho: Boolean(existing.zohoInvoiceId), note: existing.zohoInvoiceId ? 'Changed here. The invoice and payment dates in Zoho Books are not changed: update them there too if they need to match.' : '' } };
}

module.exports = { CYCLES, CYCLE_LABEL, addMonths, coverageLabel, isCovered, cycleStarts, recordMonths, plannedInvoiceDate, firstAutoPeriod, nextInvoiceDate, todayIst, editDates, loadTarget, monthAmounts, toPaise, amountsFor, periodOf, labelOf, nextPeriod, parseSettings, parseInvoice, parsePayment, buildLedger, viewBilling, saveSettings, linkInvoice, markPaid, undoPaid, setVoid, PAID_MODES, GST_RATES, DEFAULT_GST, DEFAULT_DUE_DAYS, PERIOD };
