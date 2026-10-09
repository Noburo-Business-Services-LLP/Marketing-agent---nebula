/**
 * Managed client billing with Zoho Books: pull a client's existing invoices into the month-by-month ledger, search Zoho,
 * create the invoice for a month, and mark a month paid while recording the payment in Zoho. Every rule lives here and is
 * tested with a fake Zoho and an in-memory repository; the routes only wire in the real ones. Staff action only:
 * Owner and Admin (permission manage_billing), through the billing ledger's own checks.
 */
const L = require('./billingLedger');

const refuse = (status, message) => ({ status, body: { success: false, message } });
const idOf = (v) => (v ? String(v._id || v.id || v) : '');
const DAY = 86400000;
const ZOHO_DOWN = 'We could not reach Zoho Books just now. Please try again in a minute.';

const COMPANY_WORDS = new Set(['pvt', 'private', 'ltd', 'limited', 'llp', 'inc', 'the', 'and', 'co', 'company', 'corp', 'corporation', 'india']);
function normName(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w && !COMPANY_WORDS.has(w)).join(' ').trim();
}

/** Which of Zoho's invoices belong to this client: the same email, or the same business name. Never guesses on short names. */
function matchInvoices(client, invoices) {
  const email = String(client.email || '').trim().toLowerCase();
  const names = [client.companyName, client.businessProfile && client.businessProfile.name].map(normName).filter((n) => n.length >= 3);
  const out = [];
  for (const inv of invoices) {
    if (email && inv.email && inv.email === email) { out.push({ inv, reason: 'email' }); continue; }
    const c = normName(inv.customerName);
    if (c && names.some((n) => n === c || (n.length >= 6 && c.length >= 6 && (c.includes(n) || n.includes(c))))) out.push({ inv, reason: 'name' });
  }
  return out;
}

/** The billing period an invoice covers, read from its product and description ("Annual Plan", "Quarterly"...), else the fallback. */
function detectCycleMonths(lineItems, fallback = 1) {
  const text = (lineItems || []).map((l) => `${l.name} ${l.description}`).join(' ').toLowerCase();
  if (/half[\s-]*year|semi[\s-]*annual|6\s*months?/.test(text)) return 6;
  if (/quarter|3\s*months?/.test(text)) return 3;
  if (/annual|yearly|12\s*months?|per\s*year/.test(text)) return 12;
  if (/monthly|per\s*month|1\s*month/.test(text)) return 1;
  return L.CYCLES.includes(fallback) ? fallback : 1;
}

const periodOfInvoice = (inv) => String(inv.date || '').slice(0, 7);
const paise = (n) => Math.round(Number(n || 0) * 100);

/**
 * What a sync would do, month by month. `details` maps invoiceId to the invoice's amounts. Drafts and voided invoices are
 * left alone, a month that already holds a different invoice is never overwritten, and one invoice is used per month.
 */
function planSync({ client, matches, records, details }) {
  const byPeriod = new Map(records.map((r) => [r.period, r]));
  const used = new Set();
  const claimed = []; // periods this run already links, so a yearly invoice covers the months inside it
  const settings = client.managedBilling || {};
  const proposals = [];
  for (const { inv, reason } of [...matches].sort((a, b) => String(a.inv.date).localeCompare(String(b.inv.date)))) {
    const base = { invoiceNumber: inv.invoiceNumber, invoiceId: inv.invoiceId, period: periodOfInvoice(inv), zohoStatus: inv.status, matchedBy: reason };
    const label = L.PERIOD.test(base.period) ? L.labelOf(base.period) : '';
    const skip = (why) => proposals.push({ ...base, label, action: 'skip', reason: why, totalPaise: paise(inv.total) });
    if (!L.PERIOD.test(base.period)) { skip('The invoice has no valid date.'); continue; }
    if (inv.status === 'draft') { skip('Still a draft in Zoho Books (not issued).'); continue; }
    if (inv.status === 'void') { skip('Cancelled in Zoho Books.'); continue; }
    const have = byPeriod.get(base.period);
    const d0 = details[inv.invoiceId] || {};
    const totalZ = paise(d0.total != null ? d0.total : inv.total), balZ = paise(d0.balance != null ? d0.balance : inv.balance);
    const paid = inv.status === 'paid' || (totalZ > 0 && balZ <= 0 && (inv.status === 'partially_paid' || inv.status === 'overdue' || inv.status === 'sent'));
    const partial = !paid && totalZ > 0 && balZ > 0 && balZ < totalZ;
    if (!have && L.isCovered([...records, ...claimed], base.period)) { skip('Already covered by another invoice.'); continue; }
    if (have && have.invoiceNumber === inv.invoiceNumber) {
      if ((paid && have.status !== 'paid') || (partial && have.status === 'invoiced')) { /* Zoho shows more paid than the ledger does: update below */ }
      else { skip('Already linked.'); continue; }
    } else if (have) { skip(`${label} already has ${have.invoiceNumber || 'a record'}.`); continue; }
    if (used.has(base.period)) { skip(`Another invoice is already used for ${label}.`); continue; }
    used.add(base.period);
    const d = details[inv.invoiceId] || {};
    const months = detectCycleMonths(d.lineItems, Number(settings.cycleMonths) || 1);
    const planName = (d.lineItems && d.lineItems[0] && d.lineItems[0].name) || settings.planName || '';
    // The net is the total minus the GST: an invoice with a discount has a larger sub-total than what was actually charged.
    const total = paise(d.total != null ? d.total : inv.total), gst = paise(d.taxTotal), ex = total > gst ? total - gst : 0;
    const rate = ex > 0 ? Math.round((gst / ex) * 100) : (settings.gstPercent == null ? L.DEFAULT_GST : settings.gstPercent);
    claimed.push({ period: base.period, months, status: 'invoiced' });
    proposals.push({
      ...base, label: L.coverageLabel(base.period, months), months, planName, action: paid ? 'link_paid' : partial ? 'link_partial' : 'link_invoiced', totalPaise: total, paidPaise: paid ? total : partial ? totalZ - balZ : 0,
      amounts: { exPaise: ex > 0 ? ex : total, gstPercent: L.GST_RATES.includes(rate) ? rate : (settings.gstPercent == null ? L.DEFAULT_GST : settings.gstPercent), gstPaise: ex > 0 ? gst : 0, totalPaise: total, gstInclusive: Boolean(settings.gstInclusive) },
      invoiceUrl: d.invoiceUrl || '', issuedOn: inv.date, dueOn: inv.dueDate || '', paidOn: inv.lastPaymentDate || inv.date,
    });
  }
  return proposals;
}

/** Preview or apply: pull this client's invoices from Zoho into the ledger. */
async function syncFromZoho({ actor, clientId, apply, repo, zoho, record }) {
  const t = await L.loadTarget({ actor, clientId, repo });
  if (t.error) return t.error;
  let matches; const details = {};
  try {
    matches = matchInvoices(t.client, await zoho.listInvoices({ force: true }));
    for (const m of matches.slice(0, 30)) if (m.inv.status !== 'draft' && m.inv.status !== 'void') details[m.inv.invoiceId] = await zoho.getInvoice(m.inv.invoiceId);
  } catch (e) {
    console.error('[billing] zoho sync failed:', e.message);
    return refuse(502, ZOHO_DOWN);
  }
  const records = await repo.listRecords(clientId);
  const proposals = planSync({ client: t.client, matches, records, details });
  const todo = proposals.filter((p) => p.action !== 'skip');
  if (!apply) return { status: 200, body: { success: true, found: matches.length, proposals: proposals.map(publicProposal), willLink: todo.length } };
  let sawPaid = false;
  for (const p of todo) {
    const set = {
      ...p.amounts, months: p.months, planName: p.planName, invoiceNumber: p.invoiceNumber, invoiceUrl: p.invoiceUrl, zohoInvoiceId: p.invoiceId,
      issuedOn: new Date(p.issuedOn), dueOn: p.dueOn ? new Date(p.dueOn) : new Date(new Date(p.issuedOn).getTime() + L.DEFAULT_DUE_DAYS * DAY), recordedBy: idOf(actor),
    };
    if (p.action === 'link_paid' || p.action === 'link_partial') {
      const full = p.action === 'link_paid';
      Object.assign(set, { status: full ? 'paid' : 'partial', payments: [{ amountPaise: p.paidPaise, paidOn: new Date(p.paidOn), mode: 'other', reference: 'Recorded in Zoho Books' }], paidPaise: p.paidPaise, paidOn: new Date(p.paidOn), paidMode: 'other', paidReference: 'Recorded in Zoho Books' });
      sawPaid = true;
    } else Object.assign(set, { status: 'invoiced' });
    await repo.upsertRecord(clientId, p.period, set);
  }
  if (sawPaid) await repo.markClientPaying(clientId);
  await record({ actor, action: 'billing_zoho_sync', client: clientId, details: { linked: todo.length, skipped: proposals.length - todo.length } });
  return { status: 200, body: { success: true, linked: todo.length, skipped: proposals.length - todo.length } };
}

const publicProposal = (p) => ({ paidPaise: p.paidPaise || 0, period: p.period, months: p.months || 1, planName: p.planName || '', label: p.label, invoiceNumber: p.invoiceNumber, zohoStatus: p.zohoStatus, action: p.action, reason: p.reason || '', totalPaise: p.totalPaise, matchedBy: p.matchedBy });

/** Search the organisation's invoices by number, customer or email (for the "Find in Zoho" box). */
async function searchZohoInvoices({ actor, q, zoho }) {
  const { isStaff, can } = require('./permissions');
  if (!isStaff(actor) || !can(actor, 'manage_billing')) return refuse(403, 'Your role cannot do this.');
  const term = String(q || '').trim().toLowerCase();
  if (term.length < 2) return { status: 200, body: { success: true, invoices: [] } };
  let rows;
  try { rows = await zoho.listInvoices(); } catch (e) { console.error('[billing] zoho search failed:', e.message); return refuse(502, ZOHO_DOWN); }
  const hits = rows.filter((i) => [i.invoiceNumber, i.customerName, i.email, i.reference].some((v) => String(v || '').toLowerCase().includes(term))).slice(0, 20);
  return { status: 200, body: { success: true, invoices: hits.map((i) => ({ invoiceNumber: i.invoiceNumber, customerName: i.customerName, date: i.date, status: i.status, totalPaise: paise(i.total), balancePaise: paise(i.balance) })) } };
}

/** The plans (products) of the Zoho Books organisation, as suggestions for the plan field. Never a limit: any name may be typed. */
async function listZohoItems({ actor, zoho }) {
  const { isStaff, can } = require('./permissions');
  if (!isStaff(actor) || !can(actor, 'manage_billing')) return refuse(403, 'Your role cannot do this.');
  try { return { status: 200, body: { success: true, items: (await zoho.listItems()).map((i) => ({ itemId: i.itemId, name: i.name, description: i.description, ratePaise: paise(i.rate) })) } }; }
  catch (e) { console.error('[billing] zoho items failed:', e.message); return { status: 200, body: { success: true, items: [] } }; }
}

const monthName = (period) => L.labelOf(period);
const referenceFor = (clientId, period) => `NEB-${clientId}-${period}`;

/**
 * Creates the Zoho invoice of one month (marked sent) and returns what to store. Throws a plain Error on any Zoho problem.
 * `existing` is the month's record, whose amounts win over the client's current amount.
 */
async function createZohoInvoiceFor({ client, clientId, period, amounts, zoho, now, issuedOn, months }) {
  const b = client.managedBilling || {};
  const span = L.CYCLES.includes(Number(months)) ? Number(months) : (L.CYCLES.includes(Number(b.cycleMonths)) ? Number(b.cycleMonths) : 1);
  const date = new Date(issuedOn || now).toISOString().slice(0, 10);
  const terms = (client.managedBilling && client.managedBilling.termsDays) == null ? L.DEFAULT_DUE_DAYS : client.managedBilling.termsDays;
  const due = new Date(new Date(date).getTime() + terms * DAY).toISOString().slice(0, 10);
  // A client who already has invoices in Zoho keeps that customer record, whatever email it holds (no duplicate customers).
  const known = matchInvoices(client, await zoho.listInvoices()).map((m) => m.inv.customerId).filter(Boolean);
  const counts = known.reduce((m, c) => ((m[c] = (m[c] || 0) + 1), m), {});
  const customerId = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || undefined;
  const made = await zoho.createManagedInvoice({
    customerId, email: client.email, firstName: client.firstName || '', lastName: client.lastName || '', companyName: client.companyName || (client.businessProfile && client.businessProfile.name) || '',
    exInr: amounts.exPaise / 100, gstPercent: amounts.gstPercent, itemId: b.zohoItemId || undefined,
    itemName: b.planName || 'Nebulaa managed marketing service', description: `${L.CYCLE_LABEL[span]} plan: ${L.coverageLabel(period, span)}`, reference: referenceFor(clientId, period), date, dueDate: due,
  });
  if (!made.reused) await zoho.markInvoiceSent(made.invoiceId);
  const d = await zoho.getInvoice(made.invoiceId);
  const url = d.invoiceUrl || (await zoho.sharingUrl(made.invoiceId)) || '';
  const total = paise(d.total), gst = paise(d.taxTotal), ex = total > gst ? total - gst : 0;
  return {
    made, detail: d, months: span, planName: b.planName || '', invoiceUrl: url, issuedOn: new Date(date), dueOn: new Date(due),
    amounts: total > 0 && ex > 0 ? { exPaise: ex, gstPercent: amounts.gstPercent, gstPaise: gst, totalPaise: total, gstInclusive: amounts.gstInclusive } : amounts,
  };
}

/** Create the invoice of a month in Zoho (no payment): for a month with no invoice yet. */
async function createZohoInvoice({ actor, clientId, period, input = {}, repo, zoho, record, now = Date.now() }) {
  const t = await L.loadTarget({ actor, clientId, repo });
  if (t.error) return t.error;
  if (!L.PERIOD.test(period)) return refuse(400, 'That month is not valid.');
  const existing = await repo.getRecord(clientId, period);
  if (existing && existing.status === 'void') return refuse(409, 'This month was cancelled. Restore it first.');
  if (existing && existing.invoiceNumber) return refuse(409, `This month already has invoice ${existing.invoiceNumber}.`);
  const amounts = L.monthAmounts({ client: t.client, existing, override: null });
  if (!amounts) return refuse(400, 'Set the client\'s monthly amount first.');
  let made;
  const invoiceDay = input.issuedOn || (existing && existing.issuedOn) || L.plannedInvoiceDate(t.client.managedBilling, period) || L.todayIst(now);
  try { made = await createZohoInvoiceFor({ client: t.client, clientId, period, amounts, zoho, now, issuedOn: invoiceDay }); }
  catch (e) { console.error('[billing] zoho invoice failed:', e.message); return refuse(502, `The invoice could not be created in Zoho Books: ${e.message}`); }
  await repo.upsertRecord(clientId, period, { ...made.amounts, months: made.months, planName: made.planName, status: existing && existing.status === 'paid' ? 'paid' : 'invoiced', invoiceNumber: made.made.invoiceNumber, invoiceUrl: made.invoiceUrl, zohoInvoiceId: made.made.invoiceId, issuedOn: made.issuedOn, dueOn: made.dueOn, recordedBy: idOf(actor) });
  await record({ actor, action: 'billing_zoho_invoice', client: clientId, details: { period, invoiceNumber: made.made.invoiceNumber } });
  return { status: 200, body: { success: true, invoiceNumber: made.made.invoiceNumber } };
}

/**
 * Mark a month paid. When the month has no invoice, the invoice is created in Zoho Books first (unless staff turn it off or
 * link their own) and the payment is recorded there too. If Zoho fails, the month is still marked paid (the money arrived)
 * and the answer says what to retry.
 */
async function markPaidWithZoho({ actor, clientId, period, input = {}, repo, zoho, record, now = Date.now() }) {
  const t = await L.loadTarget({ actor, clientId, repo });
  if (t.error) return t.error;
  if (!L.PERIOD.test(period)) return refuse(400, 'That month is not valid.');
  const pay = L.parsePayment(input, now);
  if (!pay.ok) return refuse(400, pay.message);
  const existing = await repo.getRecord(clientId, period);
  const typedInvoice = input.invoiceNumber !== undefined && String(input.invoiceNumber).trim() !== '';
  const hasInvoice = typedInvoice || Boolean(existing && existing.invoiceNumber);
  const ours = Boolean(existing && existing.zohoInvoiceId); // an invoice this app created in Zoho: its payments are recorded there too
  const wantCreate = !hasInvoice && input.createInZoho !== false && !(existing && existing.status === 'void');
  const amounts = L.monthAmounts({ client: t.client, existing, override: input.amountInr ? L.toPaise(input.amountInr) : null });
  if (!amounts) return refuse(400, 'Set the client\'s amount first, or type the amount.');
  // How much this payment is (the whole balance unless a smaller amount was typed), checked before anything is sent to Zoho.
  const plan = L.planPayment({ existing, totalPaise: amounts.totalPaise, requestedPaise: pay.payment.amountPaise });
  if (plan.error) return refuse(existing && L.paidPaiseOf(existing) >= amounts.totalPaise ? 409 : 400, plan.error);
  const day = pay.payment.paidOn.toISOString().slice(0, 10);
  let warning = '';
  let extra = {};
  try {
    if (wantCreate) {
      const made = await createZohoInvoiceFor({ client: t.client, clientId, period, amounts, zoho, now, months: input.months, issuedOn: (existing && existing.issuedOn) || L.plannedInvoiceDate(t.client.managedBilling, period) || pay.payment.paidOn });
      await zoho.recordPayment({ customerId: made.detail.customerId || made.made.customerId, invoiceId: made.made.invoiceId, amount: plan.amt / 100, date: day, mode: pay.payment.mode, reference: pay.payment.reference });
      extra = { invoiceNumber: made.made.invoiceNumber, invoiceUrl: made.invoiceUrl, zohoInvoiceId: made.made.invoiceId, amounts: made.amounts, months: made.months };
    } else if (ours && input.recordInZoho !== false) {
      const d = await zoho.getInvoice(existing.zohoInvoiceId);
      await zoho.recordPayment({ customerId: d.customerId, invoiceId: existing.zohoInvoiceId, amount: plan.amt / 100, date: day, mode: pay.payment.mode, reference: pay.payment.reference });
    }
  } catch (e) {
    console.error('[billing] zoho step failed:', e.message);
    warning = `Recorded here, but Zoho Books could not be updated (${e.message}). Use "Create invoice in Zoho" to retry.`;
    extra = {};
  }
  const out = await L.markPaid({ actor, clientId, period, input: { ...input, ...(extra.invoiceNumber ? { invoiceNumber: extra.invoiceNumber, invoiceUrl: extra.invoiceUrl || undefined } : {}) }, repo, record, now });
  if (out.status === 200 && extra.zohoInvoiceId) await repo.upsertRecord(clientId, period, { zohoInvoiceId: extra.zohoInvoiceId, months: extra.months, ...extra.amounts });
  if (out.status === 200 && (warning || extra.invoiceNumber)) out.body = { ...out.body, zoho: { created: Boolean(extra.invoiceNumber), invoiceNumber: extra.invoiceNumber || '', warning } };
  return out;
}

/**
 * The automatic invoice of one billing period, made by the scheduler (no staff member acting). Nothing is made for a period that
 * already has any record, the invoice carries the period's planned invoice date, and a retry reuses the same Zoho invoice.
 */
async function createZohoInvoiceAuto({ client, clientId, period, repo, zoho, now = Date.now() }) {
  const existing = await repo.getRecord(clientId, period);
  if (existing) return { created: false, reason: 'The period already has a record.' };
  const amounts = L.monthAmounts({ client, existing: null, override: null });
  const day = L.plannedInvoiceDate(client.managedBilling, period);
  if (!amounts || !day) return { created: false, reason: 'Billing is not fully set up.' };
  const made = await createZohoInvoiceFor({ client, clientId, period, amounts, zoho, now, issuedOn: day });
  await repo.upsertRecord(clientId, period, { ...made.amounts, months: made.months, planName: made.planName, status: 'invoiced', invoiceNumber: made.made.invoiceNumber, invoiceUrl: made.invoiceUrl, zohoInvoiceId: made.made.invoiceId, issuedOn: made.issuedOn, dueOn: made.dueOn, note: 'Created automatically' });
  return { created: true, invoiceNumber: made.made.invoiceNumber };
}

module.exports = { listZohoItems, detectCycleMonths, createZohoInvoiceAuto, normName, matchInvoices, planSync, syncFromZoho, searchZohoInvoices, createZohoInvoice, markPaidWithZoho, referenceFor };
