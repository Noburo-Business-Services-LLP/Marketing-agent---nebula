/**
 * Recurring revenue for the staff Money page: MRR, ARR, who is paying, on trial, or has stopped, and MRR month by month.
 * Pure. Amounts are whole paise, before GST. A yearly or quarterly invoice counts as one share per month it covers.
 * History comes from the managed-client billing ledger; online plans are counted for the current month only.
 */
const L = require('./billingLedger');
const { PLANS } = require('../../config/apiCosts');
const { isPaying } = require('./clientStatus');
const { resolveTier } = require('../../config/entitlements');

const shift = (period, n) => { const [y, m] = period.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
const idOf = (u) => String((u && (u._id || u.id)) || '');
const name = (u) => (u.businessProfile && u.businessProfile.name) || u.companyName || [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || '';

function buildRecurring({ users = [], records = [], now = Date.now(), months = 12 }) {
  const customers = users.filter((u) => !u.staffRole && !u.isCsm && !u.isHidden);
  const thisMonth = L.periodOf(new Date(now));
  const byClient = new Map(); // clientId -> Map(period -> monthly ex-GST paise)

  for (const r of records) {
    if (!r || r.status === 'void' || !r.exPaise) continue;
    const cid = String(r.client);
    const span = L.validMonths(r.months) || 1;
    const per = Math.round(r.exPaise / span);
    const m = byClient.get(cid) || new Map();
    for (let i = 0; i < span; i++) m.set(shift(r.period, i), per);
    byClient.set(cid, m);
  }

  const meta = new Map();
  let onlineMrr = 0; let onlinePaying = 0;
  for (const u of customers) {
    const id = idOf(u); const b = u.managedBilling || {};
    const ended = b.endedMonth && L.PERIOD.test(b.endedMonth) ? b.endedMonth : '';
    meta.set(id, { u, ended });
    const m = byClient.get(id);
    if (m && ended) for (const p of [...m.keys()]) if (p > ended) m.delete(p);
    // The current month before its invoice exists: the client's own billing settings.
    if (b.monthlyAmountInr && isPaying(u) && (!ended || ended >= thisMonth)) {
      const start = (b.billingStart || (b.serviceStart ? `${b.serviceStart}-01` : '')).slice(0, 7);
      const covered = m && m.has(thisMonth);
      if (start && start <= thisMonth && !covered) {
        const cycle = L.validMonths(b.cycleMonths) || 1;
        const a = L.amountsFor(Math.round(b.monthlyAmountInr * 100), b.gstPercent == null ? L.DEFAULT_GST : b.gstPercent, Boolean(b.gstInclusive));
        const mm = m || new Map(); mm.set(thisMonth, Math.round(a.exPaise / cycle)); byClient.set(id, mm);
      }
    }
    const tier = resolveTier(u);
    if (PLANS[tier] && u.subscription && u.subscription.status === 'active' && (u.plan.subscriptions || []).some((s) => s && s.kind === 'plan' && s.active)) {
      onlineMrr += PLANS[tier].inr * 100; onlinePaying += 1;
    }
  }

  const first = [...byClient.values()].reduce((min, m) => { for (const p of m.keys()) if (!min || p < min) min = p; return min; }, '');
  let start = shift(thisMonth, -(months - 1));
  if (first && first > start) start = first;
  const valueAt = (cid, p) => (byClient.get(cid) && byClient.get(cid).get(p)) || 0;
  const series = [];
  for (let p = start; p <= thisMonth && series.length < 60; p = shift(p, 1)) {
    const prev = shift(p, -1);
    let mrr = 0; let clients = 0; let newN = 0; let lostN = 0; let newV = 0; let lostV = 0;
    for (const cid of byClient.keys()) {
      const v = valueAt(cid, p); const pv = valueAt(cid, prev);
      if (v) { mrr += v; clients += 1; }
      if (v && !pv) { newN += 1; newV += v; }
      if (!v && pv) { lostN += 1; lostV += pv; }
    }
    series.push({ period: p, label: L.labelOf(p), mrrPaise: mrr, clients, newClients: newN, lostClients: lostN, newMrrPaise: newV, lostMrrPaise: lostV });
  }

  const nowPoint = series.find((s) => s.period === thisMonth) || { mrrPaise: 0, clients: 0 };
  let paying = 0; let trial = 0; const endedList = [];
  for (const { u, ended } of meta.values()) {
    const stopped = ended && ended < thisMonth;
    if (stopped) {
      const m = byClient.get(idOf(u)); const lastVal = m && m.get(ended);
      endedList.push({ clientId: idOf(u), name: name(u), endedMonth: ended, endedLabel: L.labelOf(ended), reason: (u.managedBilling && u.managedBilling.endReason) || '', mrrLostPaise: lastVal || 0 });
      continue;
    }
    if (isPaying(u)) paying += 1;
    else if (!(u.trial && u.trial.isExpired)) trial += 1;
  }
  endedList.sort((a, b) => b.endedMonth.localeCompare(a.endedMonth));

  const managedMrr = nowPoint.mrrPaise;
  return {
    now: {
      mrrPaise: managedMrr + onlineMrr, arrPaise: (managedMrr + onlineMrr) * 12, managedMrrPaise: managedMrr, onlineMrrPaise: onlineMrr,
      payingCustomers: paying, onTrial: trial, stopped: endedList.length, managedBilled: nowPoint.clients, onlineSubscribers: onlinePaying
    },
    months: series,
    stopped: endedList.slice(0, 50),
    note: 'MRR is the monthly value before GST. A yearly or quarterly invoice counts one share in each month it covers. History is from managed-client billing; online plans count for the current month only.'
  };
}

module.exports = { buildRecurring };
