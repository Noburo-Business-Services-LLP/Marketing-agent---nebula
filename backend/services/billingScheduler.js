'use strict';
// Makes each managed client's monthly invoice in Zoho Books on their invoice day, for clients who have automatic invoices
// switched on (off by default). It never reaches back: only months from the client's "automatic from" month onwards.
// Safe to run often and from several servers: a month that already has a record is skipped, and the Zoho invoice carries
// a fixed reference so a retry reuses it instead of making a second one.
const L = require('./staff/billingLedger');
const { createZohoInvoiceAuto } = require('./staff/billingZoho');

const MAX_PER_RUN = 20;

async function runBillingOnce({ now = Date.now(), deps = {} } = {}) {
  const User = deps.User || require('../models/User');
  const ClientInvoice = deps.ClientInvoice || require('../models/ClientInvoice');
  const zoho = deps.zoho || require('./zohoBooks');
  // One email as soon as a month fails, then at most one every 12 hours while it keeps failing.
  const alerter = deps.alerter || require('./opsAlerts').createAlerter({ env: { ...process.env, ALERT_THRESHOLD: '1', ALERT_COOLDOWN_MINUTES: '720' } });
  const alert = deps.alert || ((m) => { try { alerter.recordFailure('billing', m); } catch (_) { /* alerting never stops the run */ } });
  const log = deps.logger || console;
  const repo = {
    listRecords: (id) => ClientInvoice.find({ client: id }).lean(),
    getRecord: (id, period) => ClientInvoice.findOne({ client: id, period }).lean(),
    upsertRecord: (id, period, set) => ClientInvoice.updateOne({ client: id, period }, { $set: set, $setOnInsert: { client: id, period } }, { upsert: true }),
  };
  const clients = await User.find({ 'managedBilling.autoInvoice': true, 'plan.tier': 'managed', isActive: { $ne: false }, staffRole: null, isCsm: { $ne: true }, 'agency.ownerId': null }) // managed clients only; a client workspace is never invoiced
    .select('email firstName lastName companyName businessProfile.name managedBilling').lean();
  const today = L.todayIst(now);
  let made = 0; const failures = [];
  outer: for (const client of clients) {
    const s = client.managedBilling || {};
    const from = s.autoFrom && L.PERIOD.test(s.autoFrom) ? s.autoFrom : L.firstAutoPeriod(s, now);
    const records = await repo.listRecords(String(client._id));
    for (const p of L.cycleStarts(s, today.slice(0, 7))) {
      if (p < from || L.isCovered(records, p)) continue;
      if (s.endedMonth && p > s.endedMonth) continue;
      const day = L.plannedInvoiceDate(s, p);
      if (!day || day > today) continue;
      if (made >= MAX_PER_RUN) { log.warn('[billing] run limit reached; the rest continues next hour'); break outer; }
      try {
        const out = await createZohoInvoiceAuto({ client, clientId: String(client._id), period: p, repo, zoho, now });
        if (out.created) { made += 1; log.log(`[billing] invoice ${out.invoiceNumber} made automatically for ${L.coverageLabel(p, s.cycleMonths || 1)}`); }
      } catch (e) {
        failures.push(`${p}: ${e.message}`);
        log.error(`[billing] automatic invoice failed for ${L.coverageLabel(p, s.cycleMonths || 1)}: ${e.message}`);
      }
    }
  }
  if (failures.length) alert(`automatic invoices: ${failures.length} failed, first: ${failures[0]}`);
  return { clients: clients.length, made, failed: failures.length };
}

function startBillingScheduler({ intervalMs = 60 * 60 * 1000, logger = console } = {}) {
  if (String(process.env.ENABLE_BILLING_SCHEDULER || 'true').toLowerCase() === 'false') {
    logger.log('[billing] Scheduler disabled via ENABLE_BILLING_SCHEDULER=false');
    return () => {};
  }
  logger.log(`[billing] Scheduler started (interval ${intervalMs}ms)`);
  // Invoices: through a lease (services/leaseLock.js), kept for half the interval after a good run.
  const tick = require('./leaseLock').leased('scheduler:billing', 30 * 60 * 1000, () => runBillingOnce(), { cooldownMs: intervalMs / 2 });
  const run = () => tick().catch((err) => logger.error('[billing] Scheduler error:', err.message));
  const timer = setInterval(run, intervalMs);
  setTimeout(run, 60 * 1000);
  return () => clearInterval(timer);
}

module.exports = { runBillingOnce, startBillingScheduler };
