/**
 * Numbers for the staff Money page (Owner only): revenue, plan mix, payments, renewals, failures,
 * Quarks sold and spent, and Ayrshare profiles. `buildMoney` is pure. Every amount is integer paise.
 * What cannot be worked out from stored data is returned as { available: false, reason } or carries a note.
 * Days and months are counted in India time. Staff, CSM and hidden test accounts are not customers.
 */
const { PLANS, ADDONS, TOPUP_PACKS, USD_PER_QUARK, gstPaise, chargePaise } = require('../../config/apiCosts');
const { PLAN_PRESENTATION, INVOICE_ITEMS } = require('../../config/plans');
const { resolveTier } = require('../../config/entitlements');
const { AYRSHARE } = require('../../config/vendorPlans');
const { paymentFailureMessage } = require('../providerErrors');
const { dayKey } = require('./home');

const DAY = 86400000;
const IST_OFFSET_MIN = 330;
const RENEWAL_DAYS = 14;
const FAILURE_DAYS = 30;
const HISTORY_CAP_WARN = 50; // the app keeps only the last 50 to 100 history entries per account

const toMs = (v) => { const t = v ? new Date(v).getTime() : NaN; return Number.isFinite(t) ? t : null; };
const toPaise = (n) => (Number.isFinite(Number(n)) ? Math.round(Number(n) * 100) : null);
const idOf = (u) => String((u && (u._id || u.id)) || '');
const isCustomer = (u) => !u.staffRole && !u.isCsm && !u.isHidden;

function displayName(u) {
  const bp = u.businessProfile || {};
  return bp.name || u.companyName || [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || '';
}

/** Start of an India-time calendar month, `back` months before the one containing `ms`. */
function monthStart(ms, back = 0) {
  const s = new Date(ms + IST_OFFSET_MIN * 60000);
  return Date.UTC(s.getUTCFullYear(), s.getUTCMonth() - back, 1) - IST_OFFSET_MIN * 60000;
}

const TIER_LABELS = { free: 'Free', managed: 'Managed', starter: PLAN_PRESENTATION.starter.name, professional: PLAN_PRESENTATION.professional.name };

/** Names a payment from our own plan, add-on and pack names. Provider text is never used. */
function describePayment(user, p) {
  const subs = (user.plan && user.plan.subscriptions) || [];
  const rec = subs.find((s) => s && p.razorpayOrderId && s.subscriptionId === p.razorpayOrderId);
  if (rec && rec.kind === 'plan' && PLAN_PRESENTATION[rec.key]) return `${PLAN_PRESENTATION[rec.key].name} plan`;
  if (rec && rec.kind === 'addon' && ADDONS[rec.key]) return `${ADDONS[rec.key].label} add-on`;
  if (p.item === INVOICE_ITEMS.topup) {
    const pack = TOPUP_PACKS.find((k) => k.quarks === Number(p.credits));
    return pack ? `Quark pack, ${pack.quarks.toLocaleString('en-IN')} Quarks` : 'Quark pack';
  }
  if (p.item === INVOICE_ITEMS.plan) return 'Plan';
  if (p.item === INVOICE_ITEMS.addon) return 'Add-on';
  return 'Payment';
}

/** One payment as paise: total always; the ex-GST and GST split only when the ex-GST amount was stored. */
function paise(p) {
  const total = toPaise(p.amount);
  const ex = toPaise(p.exGstAmount);
  if (total === null) return null;
  if (ex === null || ex < 0 || ex > total) return { total, ex: null, gst: null };
  return { total, ex, gst: total - ex };
}

function flatPayments(users) {
  const out = [];
  users.forEach((u) => (Array.isArray(u.payments) ? u.payments : []).forEach((p, i) => {
    if (!p) return;
    const at = toMs(p.paidAt);
    out.push({ u, p, at, i });
  }));
  return out;
}

function sumWindow(rows, from, to) {
  const w = { exGstPaise: 0, gstPaise: 0, unsplitPaise: 0, totalPaise: 0, count: 0 };
  for (const r of rows) {
    if (r.at === null || r.at < from || r.at >= to) continue;
    w.count += 1; w.totalPaise += r.m.total;
    if (r.m.ex === null) w.unsplitPaise += r.m.total; else { w.exGstPaise += r.m.ex; w.gstPaise += r.m.gst; }
  }
  return w;
}

function revenueOf(users, now) {
  const all = flatPayments(users).filter((r) => r.p.status === 'paid');
  const inr = []; let other = 0;
  for (const r of all) {
    const cur = String(r.p.currency || 'INR').toUpperCase();
    const m = paise(r.p);
    if (cur !== 'INR' || !m) { other += 1; continue; }
    inr.push({ ...r, m });
  }
  const start = monthStart(now, 0); const prev = monthStart(now, 1);
  const series30 = [];
  const days = {};
  inr.forEach((r) => { if (r.at !== null) { const k = dayKey(r.at); (days[k] = days[k] || []).push(r); } });
  for (let i = 29; i >= 0; i--) {
    const k = dayKey(now - i * DAY);
    const w = sumWindow(days[k] || [], -Infinity, Infinity);
    series30.push({ day: k, exGstPaise: w.exGstPaise, gstPaise: w.gstPaise, unsplitPaise: w.unsplitPaise, totalPaise: w.totalPaise });
  }
  const unsplitAny = inr.some((r) => r.m.ex === null);
  return {
    currency: 'INR',
    thisMonth: sumWindow(inr, start, now + 1),
    lastMonth: sumWindow(inr, prev, start),
    last30Days: sumWindow(inr, now - 30 * DAY, now + 1),
    allTime: sumWindow(inr, -Infinity, Infinity),
    series30,
    otherCurrencyPayments: other,
    note: 'Collected money from paid payment records, in rupees, in India time. Refunded and failed payments are not counted.'
      + (unsplitAny ? ' Some older payments have no stored amount before GST, so they are counted in the total but not split.' : '')
  };
}

function planMixOf(customers) {
  const tiers = ['free', 'starter', 'professional', 'managed'].map((id) => ({ id, label: TIER_LABELS[id], count: 0 }));
  const addons = Object.keys(ADDONS).map((id) => ({ id, label: ADDONS[id].label, count: 0 }));
  let mrr = 0;
  for (const u of customers) {
    tiers.find((t) => t.id === resolveTier(u)).count += 1;
    for (const s of (u.plan && u.plan.subscriptions) || []) {
      if (!s || !s.active) continue;
      if (s.kind === 'addon' && ADDONS[s.key]) { addons.find((a) => a.id === s.key).count += 1; mrr += ADDONS[s.key].inr * 100; }
      else if (s.kind === 'plan' && PLANS[s.key]) mrr += PLANS[s.key].inr * 100;
    }
  }
  return {
    customers: customers.length, tiers, addons,
    monthlyRecurring: { exGstPaise: Math.round(mrr), note: 'Estimate: the config price of every active plan and add-on subscription, before GST.' }
  };
}

function paymentRow(u, p, i) {
  const m = paise(p) || { total: 0, ex: null, gst: null };
  return {
    id: `${idOf(u)}:${i}`, // our own key; the provider's payment id is not sent
    at: toMs(p.paidAt) !== null ? new Date(p.paidAt).toISOString() : null,
    clientId: idOf(u), clientName: displayName(u),
    what: describePayment(u, p),
    totalPaise: m.total, exGstPaise: m.ex, gstPaise: m.gst,
    status: ['paid', 'failed', 'refunded'].includes(p.status) ? p.status : 'paid'
  };
}

function buildPayments({ users, page = 1, pageSize = 10 }) {
  const rows = flatPayments(users.filter(isCustomer))
    .sort((a, b) => (b.at || 0) - (a.at || 0))
    .map(({ u, p, i }) => paymentRow(u, p, i));
  const size = Math.max(1, Math.min(50, Number(pageSize) || 10));
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.max(1, Math.min(pages, Number(page) || 1));
  return { total: rows.length, page: current, pages, pageSize: size, rows: rows.slice((current - 1) * size, current * size) };
}

function renewalsOf(customers, now) {
  const items = [];
  for (const u of customers) {
    const tier = u.plan && u.plan.tier;
    const next = toMs(u.subscription && u.subscription.nextBillingAt);
    if (!PLANS[tier] || !PLAN_PRESENTATION[tier]) continue;
    if (!(u.subscription && u.subscription.status === 'active')) continue;
    if (!((u.plan.subscriptions || []).some((s) => s && s.kind === 'plan' && s.active))) continue;
    if (next === null || next < now || next > now + RENEWAL_DAYS * DAY) continue;
    items.push({ clientId: idOf(u), clientName: displayName(u), what: `${PLAN_PRESENTATION[tier].name} plan`, at: new Date(next).toISOString(), totalPaise: chargePaise(PLANS[tier].inr), exGstPaise: PLANS[tier].inr * 100, gstPaise: gstPaise(PLANS[tier].inr), _t: next });
  }
  items.sort((a, b) => a._t - b._t);
  items.forEach((i) => delete i._t);
  return {
    windowDays: RENEWAL_DAYS, items, totalPaise: items.reduce((n, i) => n + i.totalPaise, 0),
    note: 'Plan renewals only, at the current config price. Add-on renewal dates are not stored, so add-ons are not listed here.'
  };
}

function failuresOf(customers, now) {
  const from = now - FAILURE_DAYS * DAY;
  const failedPayments = [];
  const renewals = [];
  for (const u of customers) {
    (u.payments || []).forEach((p) => {
      const at = toMs(p && p.paidAt);
      if (p && p.status === 'failed' && at !== null && at >= from && at <= now) {
        failedPayments.push({ clientId: idOf(u), clientName: displayName(u), what: describePayment(u, p), at: new Date(at).toISOString(), totalPaise: (paise(p) || { total: 0 }).total, reason: paymentFailureMessage('failed'), _t: at });
      }
    });
    const status = u.subscription && u.subscription.status;
    if (status === 'halted' || status === 'cancelled') {
      const at = toMs(u.subscription.currentPeriodEnd) ?? toMs(u.subscription.nextBillingAt);
      if (at === null || (at >= from && at <= now)) {
        const rec = ((u.plan && u.plan.subscriptions) || []).find((x) => x && x.kind === 'plan' && PLAN_PRESENTATION[x.key]);
        const tier = PLAN_PRESENTATION[u.plan && u.plan.tier] ? u.plan.tier : rec && rec.key; // the account is back on free by now; the record says which plan it was
        renewals.push({ clientId: idOf(u), clientName: displayName(u), kind: status, what: PLAN_PRESENTATION[tier] ? `${PLAN_PRESENTATION[tier].name} plan` : 'Plan', at: at === null ? null : new Date(at).toISOString(), reason: paymentFailureMessage(status), _t: at === null ? -Infinity : at });
      }
    }
  }
  const byNewest = (a, b) => b._t - a._t;
  failedPayments.sort(byNewest); renewals.sort(byNewest);
  [...failedPayments, ...renewals].forEach((i) => delete i._t);
  return {
    windowDays: FAILURE_DAYS,
    payments: { count: failedPayments.length, items: failedPayments },
    renewals: { count: renewals.length, items: renewals },
    note: 'Failed payments are listed only if they were recorded as failed; the app stores successful payments, so declined card attempts may be missing. A stopped or cancelled plan is dated by the end of its last paid period, because the date it stopped is not stored; plans with no stored date are listed without one.'
  };
}

/** Quarks sold (paid payments this month) and spent (this month's history, refunds taken off). */
function quarkTotals(customers, now) {
  const start = monthStart(now, 0);
  let sold = 0; let spent = 0; let refunded = 0; let granted = 0; let incomplete = 0;
  for (const u of customers) {
    (u.payments || []).forEach((p) => { const at = toMs(p && p.paidAt); if (p && p.status === 'paid' && at !== null && at >= start && at <= now) sold += Number(p.credits) || 0; });
    const hist = (u.credits && Array.isArray(u.credits.history)) ? u.credits.history : [];
    let oldest = Infinity;
    for (const h of hist) {
      const at = toMs(h && (h.createdAt || h.timestamp));
      if (at === null) continue;
      oldest = Math.min(oldest, at);
      if (at < start || at > now) continue;
      const amount = Number(h.amount);
      if (h.action === 'staff_grant') granted += Number.isFinite(amount) ? amount : 0;
      else if (Number.isFinite(amount) && amount < 0) spent += -amount;
      else if (Number.isFinite(amount) && amount > 0 && String(h.action || '').endsWith('_refund')) refunded += amount;
      else if (!Number.isFinite(amount) && Number(h.cost) > 0) spent += Number(h.cost);
    }
    if (hist.length >= HISTORY_CAP_WARN && oldest >= start) incomplete += 1;
  }
  const net = Math.max(0, spent - refunded);
  return { sold, spent: net, refunded, grantedByStaff: granted, possiblyIncompleteClients: incomplete, spentGross: spent };
}

function quarksOf(customers, now) {
  const t = quarkTotals(customers, now);
  return {
    available: true, monthStart: new Date(monthStart(now, 0)).toISOString(),
    sold: t.sold, spent: t.spent, refunded: t.refunded, grantedByStaff: t.grantedByStaff,
    possiblyIncompleteClients: t.possiblyIncompleteClients,
    usdPerQuark: USD_PER_QUARK, spentValueUsdCents: Math.round(t.spent * USD_PER_QUARK * 100),
    note: 'Sold is the Quarks on paid payments this month. Spent is counted from each client\'s recent Quark history (the app keeps only the last 50 to 100 entries per client), so a very busy client can be undercounted. Quarks added by staff are shown apart and are not sold.'
  };
}

function ayrshareOf(profiles) {
  if (!Number.isInteger(profiles) || profiles < 0) return { available: false, reason: 'We could not count the social profiles right now.', estimate: true };
  const extra = Math.max(0, profiles - AYRSHARE.includedProfiles);
  return {
    available: true, estimate: true, profiles, included: AYRSHARE.includedProfiles, extra, maxProfiles: AYRSHARE.maxProfiles,
    perExtraProfileUsdCents: Math.round(AYRSHARE.extraProfileUsd * 100),
    extraUsdCents: extra * Math.round(AYRSHARE.extraProfileUsd * 100),
    planUsdPerMonth: AYRSHARE.planUsdPerMonth,
    note: 'Estimate: accounts that have a social profile, against the profiles the plan includes. The extra-profile rate is from our own config, not from an invoice.'
  };
}

function buildMoney({ users, ayrshareProfiles = null, now = Date.now(), page = 1, pageSize = 10 }) {
  const customers = users.filter(isCustomer);
  return {
    generatedAt: new Date(now).toISOString(),
    revenue: revenueOf(customers, now),
    planMix: planMixOf(customers),
    payments: buildPayments({ users: customers, page, pageSize }),
    renewals: renewalsOf(customers, now),
    failures: failuresOf(customers, now),
    quarks: quarksOf(customers, now),
    ayrshare: ayrshareOf(ayrshareProfiles)
  };
}

/** Reads what Money needs. Customers only; Ayrshare profiles are counted over every account (staff included, as they use a slot too). */
async function loadMoneyData({ models }) {
  const { User } = models;
  const users = await User.find({ staffRole: null, isCsm: { $ne: true } }, {
    email: 1, firstName: 1, lastName: 1, companyName: 1, 'businessProfile.name': 1, isHidden: 1, staffRole: 1, isCsm: 1,
    plan: 1, subscription: 1, payments: 1, 'credits.history': 1
  }).lean();
  let ayrshareProfiles = null;
  try { ayrshareProfiles = await User.countDocuments({ 'ayrshare.profileKey': { $exists: true, $nin: ['', null] } }); }
  catch (error) { console.error('[staff] could not count social profiles:', error.message); }
  return { users, ayrshareProfiles };
}

module.exports = { buildMoney, buildPayments, describePayment, monthStart, quarkTotals, loadMoneyData };
